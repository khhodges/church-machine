"""Differential, byte-sized Namespace allocation checks. Never repairs rows."""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import threading

_mutex = threading.RLock()
_local = threading.local()


@contextlib.contextmanager
def namespace_guard(state_path):
    """Shared reentrant process/thread lock, also used by standalone admission."""
    key = os.path.abspath(state_path)
    with _mutex:
        held = getattr(_local, "held", set())
        if key in held:
            yield
            return
        path = Path(key).parent / ".namespace-commit.lock"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a+") as stream:
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
            _local.held = held | {key}
            try:
                yield
            finally:
                _local.held = held
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def read_config(path):
    if not path or not Path(path).is_file():
        return {}
    return json.loads(Path(path).read_text())


def _integer(value):
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError("an integer word address or size is required")
    return int(value, 0) if isinstance(value, str) else int(value)


def _physical(row):
    from server.boot_image import image_artifact_selected
    if row.get("symbolic") is True or row.get("implementationMissing") is True:
        return False
    if row.get("type") == "Device":
        return False
    try:
        if (not row.get("filename") and row.get("type") != "Thread"
                and _integer(row.get("location", 0)) >= 0x40000000):
            return False
    except (ValueError, TypeError):
        pass
    return (row.get("slot") == 1 or row.get("type") == "Thread"
            or (str(row.get("name", "")).startswith("Thread.")
                and not row.get("filename")) or image_artifact_selected(row))


def _signature(row):
    if not row or not _physical(row):
        return None
    location = row.get("location", 16 if row.get("slot") == 1 else None)
    try:
        location = _integer(location)
    except (ValueError, TypeError):
        pass
    digest = row.get("binary_hash") or row.get("binaryHash")
    return (location, row.get("filename"),
            digest.lower() if isinstance(digest, str) else digest,
            row.get("type") == "Thread" or row.get("slot") == 1
            or (str(row.get("name", "")).startswith("Thread.") and not row.get("filename")))


def _range(row, directory, config, pending):
    slot = row["slot"]
    try:
        # The architectural initial Thread begins immediately after the V2
        # header when a legacy design omits its explicit address.
        start = _integer(row.get("location", 16) if slot == 1 else row["location"])
        if start < 0:
            raise ValueError("negative address")
        if _signature(row)[-1]:
            size = _integer(config.get("step1", {}).get("threadLumpWords"))
            if size < 64 or size & (size - 1):
                raise ValueError("invalid configured Thread allocation")
        else:
            filename = row.get("filename")
            if not isinstance(filename, str) or Path(filename).name != filename:
                raise ValueError("an exact saved filename is required")
            raw = pending.get(filename)
            if raw is None:
                path = Path(directory) / filename
                if path.is_symlink():
                    raise ValueError("a mutable artifact alias cannot establish allocation")
                raw = path.read_bytes()
            if not isinstance(raw, bytes) or len(raw) < 4 or len(raw) % 4:
                raise ValueError("malformed LUMP bytes")
            header = int.from_bytes(raw[:4], "big")
            size = 1 << (((header >> 23) & 15) + 6)
            if (header >> 27 != 31 or size * 4 != len(raw)
                    or 1 + ((header >> 10) & 8191) + (header & 255) > size):
                raise ValueError("header and full allocation disagree")
            expected = row.get("binary_hash") or row.get("binaryHash")
            if expected and hashlib.sha256(raw).hexdigest() != str(expected).lower():
                raise ValueError("selected bytes differ from their saved hash")
        return slot, start, start + size
    except (OSError, ValueError, TypeError, KeyError) as exc:
        raise ValueError(
            f"NS[{slot}] allocation cannot be established: {exc}. "
            "Supply an exact saved body and explicit placement, or keep it design-only.") from exc


def validate_allocation_change(before, after, directory, config=None, *,
                               pending=None, before_config=None):
    """Reject changed claims that collide; unchanged legacy defects stay editable.

    Config is the saved architecture geometry, not generated image evidence.
    Pending maps exact filenames to bytes that will be atomically published.
    """
    pending = pending or {}
    if before_config is not None and callable(config):
        config = config()
    old = {r["slot"]: r for r in before}
    new = {r["slot"]: r for r in after}
    geometry_keys = ("totalNamespaceWords", "nsSlotsMax", "threadLumpWords", "threadCount")
    geometry_changed = before_config is not None and any(
        before_config.get("step1", {}).get(k) != (config or {}).get("step1", {}).get(k)
        for k in geometry_keys)
    changed = {slot for slot, row in new.items()
               if _signature(row) is not None and (
                   geometry_changed or _signature(row) != _signature(old.get(slot))
                   or (row.get("filename") in pending
                       and hashlib.sha256(pending[row["filename"]]).hexdigest()
                       != (old.get(slot, {}).get("binary_hash")
                           or old.get(slot, {}).get("binaryHash"))))}
    for row in after:
        if row.get("slot") == 0 and row.get("location") != old.get(0, {}).get("location"):
            if _integer(row.get("location", 0)) != 0:
                raise ValueError("NS[0] Namespace header is fixed at word zero; no allocation changed.")
    if not changed and not geometry_changed:
        return
    config = config() if callable(config) else config or {}
    claims = [_range(row, directory, config, pending) for row in after if _physical(row)]
    step = config.get("step1", {})
    threads = [row for row in after if _signature(row) is not None and _signature(row)[-1]]
    if not any(r.get("slot") == 1 for r in after):
        default_thread = {"slot": 1, "name": "Boot.Thread", "location": 16, "type": "Thread"}
        claims.append(_range(default_thread, directory, config, pending))
        threads.append(default_thread)
    if len(threads) < _integer(step.get("threadCount", 1)):
        raise ValueError("Generated Thread allocations are not fully placed in the Namespace; assign their exact locations before adding memory.")
    try:
        total, slots = _integer(step["totalNamespaceWords"]), _integer(step["nsSlotsMax"])
        if total <= 16 + slots * 4 or slots < 1:
            raise ValueError("invalid architecture capacity")
    except (KeyError, ValueError, TypeError) as exc:
        raise ValueError("Namespace allocation requires saved totalNamespaceWords and nsSlotsMax; no allocation was changed.") from exc
    reserved = [("header", 0, 16), ("table", total - slots * 4, total)]
    for slot, start, end in claims:
        if slot not in changed:
            continue
        if start < 0 or end > total:
            raise ValueError(f"NS[{slot}] full allocation [0x{start:X},0x{end:X}) exceeds Namespace RAM [0x0,0x{total:X}); no allocation changed.")
        for other, left, right in claims + reserved:
            if other == slot:
                continue
            if start < right and left < end:
                label = f"NS[{other}]" if isinstance(other, int) else f"reserved Namespace {other}"
                raise ValueError(
                    f"NS[{slot}] full allocation [0x{start:X},0x{end:X}) overlaps "
                    f"{label} [0x{left:X},0x{right:X}) (word addresses). "
                    "Choose free memory or keep the entry design-only; no allocation changed.")


def validate_document(state_path, rows, directory, config=None, **kwargs):
    path = Path(state_path)
    before = json.loads(path.read_text()).get("abstractions", []) if path.exists() else []
    validate_allocation_change(before, rows, directory, config, **kwargs)