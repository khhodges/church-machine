"""Named Namespace design specifications, separate from approved artifacts."""
import hashlib
import json
import os
import tempfile
from contextlib import contextmanager
import fcntl


def geometry(designs):
    if not isinstance(designs, list) or len(designs) > 64:
        raise ValueError("Expected at most 64 Namespace designs")
    result, names, base = [], set(), 0
    for i, design in enumerate(designs):
        if not isinstance(design, dict) or set(design) != {
                "name", "sizeWords", "slotCount", "members"}:
            raise ValueError("Each design requires name, sizeWords, slotCount and members")
        name, size, count, members = (design[k] for k in
                                    ("name", "sizeWords", "slotCount", "members"))
        if (not isinstance(name, str) or name != name.strip() or not name
                or len(name) > 128 or any(ord(c) < 32 for c in name)
                or name.casefold() in names):
            raise ValueError("Namespace names must be unique, nonempty, bounded names")
        if i == 0 and name != "Boot.Namespace":
            raise ValueError("The first design must be Boot.Namespace")
        if type(size) is not int or not 8192 <= size <= 131072 or size & (size - 1):
            raise ValueError("Namespace size must be a power of two from 8192 to 131072 words (current capability extent)")
        if type(count) is not int or not 3 <= count <= 8191 or 16 + count * 4 > size:
            raise ValueError("Namespace slot capacity must fit its header and allocation")
        if (not isinstance(members, list) or len(members) > count - 2
                or any(not isinstance(m, str) or not m.strip() or m != m.strip()
                       or len(m) > 128 or any(ord(c) < 32 for c in m) for m in members)
                or len({m.casefold() for m in members}) != len(members)):
            raise ValueError("Members must be unique names within the available slot capacity")
        names.add(name.casefold())
        header = (0x1f << 27) | ((size.bit_length() - 1 - 13) << 23) | (count << 10) | (1 << 8)
        result.append(dict(name=name, baseWord=base, sizeWords=size, limit=size-1,
                           metadataWord=base+size-4, tableStartWord=base+size-count*4,
                           endWord=base+size-1, headerWord=header, slotCount=count))
        base += size
    return result


def _revision(designs):
    return hashlib.sha256(json.dumps(designs, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@contextmanager
def _lock(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def _read(path):
    try:
        with open(path, encoding="utf-8") as src:
            designs = json.load(src)["designs"]
    except FileNotFoundError:
        designs = []
    return dict(revision=_revision(designs), designs=designs, geometries=geometry(designs))


def read(path):
    with _lock(path):
        return _read(path)


def save(path, payload):
    if not isinstance(payload, dict) or set(payload) != {"revision", "designs"}:
        raise ValueError("Expected revision and designs only")
    layouts = geometry(payload["designs"])
    with _lock(path):
        current = _read(path)
        if payload["revision"] != current["revision"]:
            raise ValueError("Namespace designs changed; reload before saving. No data was changed.")
        fd, temp = tempfile.mkstemp(prefix=".namespace-designs-", dir=os.path.dirname(path))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as dst:
                json.dump({"designs": payload["designs"]}, dst, allow_nan=False)
                dst.flush()
                os.fsync(dst.fileno())
            os.replace(temp, path)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)
        return dict(revision=_revision(payload["designs"]), designs=payload["designs"],
                    geometries=layouts)
