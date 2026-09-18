#!/usr/bin/env python3
"""Atomically migrate the reviewed bootstrap Namespace layout.

The repair is intentionally deterministic: it starts from the pre-repair
CapabilityTest NS[2] binding, verifies that exact historical artifact, binds
the separately approved current CapabilityTest artifact at NS[10], restores
NS[2] as the physical UART descriptor, and publishes Namespace state, image,
provenance, and the compatibility config projection as one guarded transition.
Historical LUMP bytes and catalog rows are never regenerated or relabeled.
"""
import argparse
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
RESIDENTS = {"SelfTest": (6, 0x4A000006), "WukongCallHome": (7, 0x4A000007),
             "CapabilityTest": (10, 0x4A00000A)}
SOURCE_CAPABILITY = {
    "slot": 2,
    "filename": "CapabilityTest.2.6fd9df21.lump",
    "token": "4a000002",
    "sha256": "1ec3fd949e040d4ea851f8d93f1bd54230679f2e8b7fca07e6d586c4335d475c",
}
CURRENT_CAPABILITY = {
    "slot": 10,
    "filename": "CapabilityTest.1.e2b69e5b.lump",
    "token": "4a00000a",
    "sha256": "6591292b249120aa0a62306237e314f2289ffae42a64bc7556fba336f9330f19",
}


def _run(command, env=None):
    subprocess.run(command, cwd=ROOT, check=True, env=env)


def _exchange(left, right):
    """Atomically exchange two same-filesystem directory names (Linux)."""
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = libc.renameat2
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                          ctypes.c_char_p, ctypes.c_uint]
    if renameat2(-100, os.fsencode(left), -100, os.fsencode(right), 2) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def _reconcile_approvals(directory):
    """Remove only approvals which no longer have any immutable body."""
    digests = {}
    for body in directory.glob("*.lump"):
        if body.is_symlink() and not body.exists():
            raise ValueError(f"broken historical lump symlink: {body.name}")
        if body.is_file():
            digests[hashlib.sha256(body.read_bytes()).hexdigest()] = body.name
    path = directory / "approvals.json"
    envelope = json.loads(path.read_text())
    if not isinstance(envelope.get("approvals"), dict):
        raise ValueError("approvals.json has no approvals map")
    envelope["approvals"] = {key: value for key, value in envelope["approvals"].items()
                             if key in digests}
    path.write_text(json.dumps(envelope, indent=2) + "\n")


def _approval_and_manifest_binding(directory, artifact):
    """Verify one exact immutable artifact against approval and catalog."""
    body_path = directory / artifact["filename"]
    if not body_path.is_file():
        raise ValueError(f"required reviewed artifact is missing: {artifact['filename']}")
    digest = hashlib.sha256(body_path.read_bytes()).hexdigest()
    if digest != artifact["sha256"]:
        raise ValueError(
            f"{artifact['filename']} has SHA-256 {digest}, expected reviewed "
            f"{artifact['sha256']}")
    approvals = json.loads((directory / "approvals.json").read_text()).get("approvals", {})
    approval = approvals.get(digest)
    if not isinstance(approval, dict) or approval.get("bootstrap_t") != artifact["token"]:
        raise ValueError(
            f"{artifact['filename']} is not approved for bootstrap token "
            f"{artifact['token']}")
    manifest = json.loads((directory / "manifest.json").read_text())
    active = [
        row for row in manifest
        if isinstance(row, dict) and not row.get("archived")
        and row.get("filename") == artifact["filename"]
        and str(row.get("token", "")).lower() == artifact["token"]
    ]
    if len(active) != 1:
        raise ValueError(
            f"{artifact['filename']} lacks one exact active manifest binding")
    return approval, active[0]


def _migrate_namespace_layout(directory):
    """Move only the live CapabilityTest binding from NS[2] to reviewed NS[10]."""
    state_path = directory / "ns-state.json"
    state = json.loads(state_path.read_text())
    rows = state.get("abstractions")
    if not isinstance(rows, list):
        raise ValueError("source ns-state.json has no rich abstractions list")
    _approval_and_manifest_binding(directory, SOURCE_CAPABILITY)
    current_approval, current_manifest = _approval_and_manifest_binding(
        directory, CURRENT_CAPABILITY)
    active_capability_rows = [
        row for row in rows
        if isinstance(row, dict) and row.get("name") == "CapabilityTest"
        and row.get("archived") is not True
    ]
    # A completed reviewed migration is safely idempotent.  This matters for
    # interrupted deployments: re-running the exact command must validate and
    # republish the same plan, never infer a second move from the already
    # repaired state.
    if (
        len(active_capability_rows) == 1
        and active_capability_rows[0].get("slot") == CURRENT_CAPABILITY["slot"]
        and active_capability_rows[0].get("filename") == CURRENT_CAPABILITY["filename"]
        and str(active_capability_rows[0].get("token", "")).lower()
        == CURRENT_CAPABILITY["token"]
    ):
        if not any(
            isinstance(row, dict) and row.get("slot") == SOURCE_CAPABILITY["slot"]
            and row.get("name") == "UART_DEV"
            for row in rows
        ):
            raise ValueError("completed migration lacks the restored UART_DEV NS[2] row")
        return state
    source_rows = [
        row for row in rows
        if isinstance(row, dict)
        and row.get("name") == "CapabilityTest"
        and row.get("slot") == SOURCE_CAPABILITY["slot"]
        and row.get("filename") == SOURCE_CAPABILITY["filename"]
        and str(row.get("token", "")).lower() == SOURCE_CAPABILITY["token"]
    ]
    if len(source_rows) != 1:
        raise ValueError(
            "source Namespace must contain exactly the reviewed CapabilityTest "
            "binding at NS[2]")
    if sum(
        1 for row in rows
        if isinstance(row, dict) and row.get("name") == "CapabilityTest"
        and row.get("archived") is not True
    ) != 1:
        raise ValueError("source Namespace has ambiguous active CapabilityTest rows")
    target_rows = [
        row for row in rows
        if isinstance(row, dict) and row.get("slot") == CURRENT_CAPABILITY["slot"]
        and row.get("archived") is not True
    ]
    if target_rows:
        raise ValueError("target NS[10] is occupied in the original Namespace state")
    source = source_rows[0]
    rows.remove(source)
    migrated = dict(source)
    migrated.update({
        "slot": CURRENT_CAPABILITY["slot"],
        "token": CURRENT_CAPABILITY["token"],
        "filename": CURRENT_CAPABILITY["filename"],
        "issue_n": current_manifest.get("issue_n", current_approval.get("issue_n")),
        "lump_version": current_manifest.get(
            "lump_version", current_approval.get("issue_n")),
        "binary_hash": CURRENT_CAPABILITY["sha256"],
        "resident": True,
        "boot_resident": True,
        "load_policy": "Resident",
        "ns_slot_policy": "static",
        "boot": True,
    })
    for row in rows:
        if isinstance(row, dict):
            row.pop("boot", None)
    rows.append(migrated)
    # The old physical register descriptor is restored as UART_DEV; no
    # historical CapabilityTest identity is relabeled in the catalog.
    rows.append({
        "name": "UART_DEV",
        "slot": 2,
        "location": "0x40000014",
        "type": "Inform",
        "f": 0,
        "g": 1,
        "limit": "0x00002",
        "seq": 0,
        "seal": "0xDEADF4CF",
    })
    rows.sort(key=lambda row: row.get("slot", 0))
    state["abstractions"] = rows
    state_path.write_text(json.dumps(state, indent=2) + "\n")
    return state


def _synchronize_resident_locations(directory):
    """Record the generated image's exact resident word locations in ns-state."""
    image = (directory / "boot-image.bin").read_bytes()
    words = struct.unpack(f"<{len(image) // 4}I", image)
    state_path = directory / "ns-state.json"
    state = json.loads(state_path.read_text())
    for name, (slot, _expected_gt) in RESIDENTS.items():
        rows = [row for row in state.get("abstractions", [])
                if row.get("name") == name and row.get("slot") == slot
                and row.get("resident") is True
                and row.get("boot_resident") is True]
        if len(rows) != 1:
            raise ValueError(f"expected exactly one active frozen resident {name} row")
        descriptor = words[len(words) - (slot + 1) * 4:
                           len(words) - (slot + 1) * 4 + 4]
        location, authority, seal, token = descriptor
        rows[0].update({
            "location": f"0x{location:08X}",
            "limit": f"0x{authority & 0x1FFFFF:05X}",
            "seq": (authority >> 21) & 0x1FF,
            "g": (authority >> 30) & 1,
            "f": (authority >> 31) & 1,
            "seal": f"0x{seal:08X}",
            "token": f"{token:08x}",
        })
    state_path.write_text(json.dumps(state, indent=2) + "\n")


def _synchronize_namespace_descriptors(directory):
    """Copy generated descriptor words into every live rich Namespace row."""
    image = (directory / "boot-image.bin").read_bytes()
    words = struct.unpack(f"<{len(image) // 4}I", image)
    state_path = directory / "ns-state.json"
    state = json.loads(state_path.read_text())
    for row in state.get("abstractions", []):
        if not isinstance(row, dict) or not isinstance(row.get("slot"), int):
            continue
        slot = row["slot"]
        base = len(words) - (slot + 1) * 4
        if base < 0 or base + 3 >= len(words):
            raise ValueError(f"Namespace descriptor NS[{slot}] is outside image")
        location, authority, seal, token = words[base:base + 4]
        if location == 0 and authority == 0:
            continue
        row.update({
            "location": f"0x{location:08X}",
            "limit": f"0x{authority & 0x1FFFFF:05X}",
            "seq": (authority >> 21) & 0x1FF,
            "g": (authority >> 30) & 1,
            "f": (authority >> 31) & 1,
            "seal": f"0x{seal:08X}",
        })
    state_path.write_text(json.dumps(state, indent=2) + "\n")


def _write_generated_provenance(directory, image, config):
    """Bind staged image bytes to staged state/catalog/config inputs."""
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from server.boot_image import build_boot_image_provenance

    provenance = build_boot_image_provenance(
        image, str(directory), ns_state_path=str(directory / "ns-state.json"))
    provenance["origin"] = "generated"
    config_inputs = {
        key: value for key, value in config.items() if key != "slotLabels"
    }
    provenance["boot_config_sha256"] = hashlib.sha256(json.dumps(
        config_inputs, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    provenance["source_sha256"] = {
        "ns_state": hashlib.sha256((directory / "ns-state.json").read_bytes()).hexdigest(),
        "manifest": hashlib.sha256((directory / "manifest.json").read_bytes()).hexdigest(),
    }
    (directory / "boot-image.provenance.json").write_text(
        json.dumps(provenance, sort_keys=True, indent=2) + "\n")


def _validate_stage(directory):
    """Validate the exact catalog and boot graph before publication."""
    for path in directory.iterdir():
        if path.is_symlink() and not path.exists():
            raise ValueError(f"broken symlink in bootstrap catalog: {path.name}")
    manifest = json.loads((directory / "manifest.json").read_text())
    state = json.loads((directory / "ns-state.json").read_text())
    approvals = json.loads((directory / "approvals.json").read_text()).get("approvals", {})
    selected = {}
    for name, (slot, expected_gt) in RESIDENTS.items():
        rows = [row for row in state.get("abstractions", []) if row.get("name") == name
                and row.get("resident") is True
                and row.get("boot_resident") is True]
        if len(rows) != 1 or rows[0].get("slot") != slot:
            raise ValueError(f"expected exactly one active frozen resident {name} row")
        row = rows[0]
        body = directory / row.get("filename", "")
        if not body.is_file():
            raise ValueError(f"{name} resident body is missing")
        raw = body.read_bytes()
        if len(raw) < 4 or len(raw) % 4:
            raise ValueError(f"{name} resident body is malformed")
        header = int.from_bytes(raw[:4], "big")
        alloc, cc = 1 << (((header >> 23) & 15) + 6), header & 255
        if ((header >> 27) & 31) != 31 or alloc * 4 != len(raw) or not 1 <= cc <= alloc:
            raise ValueError(f"{name} resident header/allocation is invalid")
        row0 = int.from_bytes(raw[(alloc - cc) * 4:(alloc - cc + 1) * 4], "big")
        approval = approvals.get(hashlib.sha256(raw).hexdigest())
        if (row0 != expected_gt or row.get("token") != f"{row0:08x}" or
                not approval or approval.get("bootstrap_t") != f"{row0:08x}" or
                approval.get("bootstrap_runtime_gt") != row0):
            raise ValueError(f"{name} row0/token/bootstrap_t approval mismatch")
        active = [
            entry for entry in manifest
            if entry.get("abstraction") == name
            and not entry.get("archived", False)
            and entry.get("token") == row.get("token")
            and entry.get("filename") == row["filename"]
        ]
        if len(active) != 1:
            raise ValueError(
                f"{name} does not have exactly one active canonical manifest "
                "binding for its Namespace-selected artifact")
        selected[name] = (row, raw, alloc, cc)
    body_digests = {hashlib.sha256(path.read_bytes()).hexdigest()
                    for path in directory.glob("*.lump") if path.is_file()}
    if set(approvals) - body_digests:
        raise ValueError("approval without current or archived binary")

    # generate_boot_image has already validated structural descriptors; inspect
    # its serialized W3 and boot continuation graph independently here.
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from server.boot_image import read_namespace_header_info
    image = (directory / "boot-image.bin").read_bytes()
    read_namespace_header_info(image)
    words, total = struct.unpack(f"<{len(image) // 4}I", image), len(image) // 4
    tails = {}
    for name, (row, raw, alloc, cc) in selected.items():
        ns_base = total - (row["slot"] + 1) * 4
        location = words[ns_base]
        if row.get("location") != f"0x{location:08X}":
            raise ValueError(f"{name} Namespace-state location drift")
        authority, seal = words[ns_base + 1], words[ns_base + 2]
        if (row.get("limit") != f"0x{authority & 0x1FFFFF:05X}"
                or row.get("seq") != ((authority >> 21) & 0x1FF)
                or row.get("g") != ((authority >> 30) & 1)
                or row.get("f") != ((authority >> 31) & 1)
                or row.get("seal") != f"0x{seal:08X}"):
            raise ValueError(f"{name} Namespace-state authority/seal drift")
        if location < 0 or location + alloc > total:
            raise ValueError(f"{name} resident body address is outside boot image")
        if words[location] != int.from_bytes(raw[:4], "big"):
            raise ValueError(f"{name} boot-image resident header drift")
        if words[ns_base + 3] != RESIDENTS[name][1]:
            raise ValueError(f"{name} boot-image descriptor W3 drift")
        raw_words = list(struct.unpack(f">{len(raw) // 4}I", raw))
        loaded_words = list(words[location:location + alloc])
        if name == "SelfTest" and cc >= 2:
            # Legacy SelfTest revisions may carry a Next.GT continuation row.
            # Newer standalone revisions need only their SELF row.
            raw_words[alloc - cc + 1] = RESIDENTS["CapabilityTest"][1]
        if loaded_words != raw_words:
            raise ValueError(f"{name} loaded resident body drift")
        tails[name] = words[location + alloc - cc:location + alloc]
    # These are continuation rows, not CapabilityTest's diagnostic SelfTest
    # capability: SelfTest Next is row 1; CapabilityTest ELOADCALL is last.
    edges = {"SelfTest": ([tails["SelfTest"][1] & 0xffff]
                           if len(tails["SelfTest"]) >= 2 else []),
             "CapabilityTest": [tails["CapabilityTest"][-1] & 0xffff],
             "WukongCallHome": []}
    if ((len(tails["SelfTest"]) >= 2
            and tails["SelfTest"][1] != 0x4A00000A)
            or tails["CapabilityTest"][-1] != 0x4A000007):
        raise ValueError("resident E-only startup links drift")
    visited, visiting = set(), set()
    def visit(name):
        if name in visiting:
            raise ValueError("resident startup graph is cyclic")
        if name not in visited:
            visiting.add(name)
            for slot in edges[name]:
                visit(next(n for n, spec in RESIDENTS.items() if spec[0] == slot))
            visiting.remove(name)
            visited.add(name)
    for name in RESIDENTS:
        visit(name)


def migrate(lumps_dir, fault_after_stage=False, fault_during_publication=False):
    """Stage all products, validate them, then swap image/state/config together."""
    target = Path(lumps_dir).resolve()
    parent = target.parent
    lock_path = Path(tempfile.gettempdir()) / (
        "lumps-history-transition-" + hashlib.sha256(str(target).encode()).hexdigest()[:16] + ".lock")
    with open(lock_path, "a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        for stale in parent.glob(".bootstrap-stage-*"):
            if stale.is_dir():
                shutil.rmtree(stale)
        stage = Path(tempfile.mkdtemp(prefix=".bootstrap-stage-", dir=parent))
        config_path = target.parent / "boot-config.json"
        old_config = config_path.read_bytes() if config_path.exists() else None
        config_source = config_path if config_path.exists() else ROOT / "server" / "boot-config.json"
        config = json.loads(config_source.read_text())
        config["bootEntrySlot"] = CURRENT_CAPABILITY["slot"]
        config_stage = parent / (stage.name + ".boot-config")
        try:
            shutil.copytree(target, stage, dirs_exist_ok=True, symlinks=True)
            # Verify exact immutable source/current artifacts before touching
            # state.  This is the reviewed migration, not a catalog rebuild.
            _migrate_namespace_layout(stage)
            code = (
                "import json,os,sys;"
                "from server.boot_image import generate_boot_image;"
                "p,cpath=sys.argv[1:];"
                "c=json.load(open(cpath));"
                "img=generate_boot_image(c,p,boot_entry_slot=10,"
                "require_entry_resident=True);"
                "open(os.path.join(p,'boot-image.bin'),'wb').write(img)"
            )
            config_stage.write_text(json.dumps(config, indent=2) + "\n")
            _run([sys.executable, "-c", code, str(stage), str(config_stage)])
            _synchronize_namespace_descriptors(stage)
            image = (stage / "boot-image.bin").read_bytes()
            _write_generated_provenance(stage, image, config)
            _validate_stage(stage)
            if fault_after_stage:
                raise RuntimeError("injected bootstrap migration failure")
            _exchange(target, stage)
            try:
                os.replace(config_stage, config_path)
                if fault_during_publication:
                    raise RuntimeError("injected publication failure")
            except Exception:
                _exchange(target, stage)
                if old_config is None:
                    try:
                        config_path.unlink()
                    except FileNotFoundError:
                        pass
                else:
                    config_path.write_bytes(old_config)
                raise
        finally:
            if stage.exists():
                shutil.rmtree(stage)
            try:
                config_stage.unlink()
            except FileNotFoundError:
                pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lumps-dir", default=ROOT / "server" / "lumps")
    parser.add_argument("--fault-after-stage", action="store_true")
    parser.add_argument("--fault-during-publication", action="store_true")
    args = parser.parse_args()
    migrate(args.lumps_dir, args.fault_after_stage, args.fault_during_publication)


if __name__ == "__main__":
    main()