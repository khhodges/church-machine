#!/usr/bin/env python3
"""Atomically regenerate and fail-closed validate frozen bootstrap residents."""
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
GENERATORS = ("build_selftest_lump.js", "build_wukong_callhome_lump.js",
              "build_capability_test_lump.js")
RESIDENTS = {"SelfTest": (6, 0x4A000006), "WukongCallHome": (7, 0x4A000007),
             "CapabilityTest": (10, 0x4A00000A)}


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
        active = [entry for entry in manifest if entry.get("abstraction") == name
                  and not entry.get("archived", False)]
        if (len(active) != 1 or active[0].get("token") != row.get("token")
                or active[0].get("filename") != row["filename"]):
            raise ValueError(f"{name} does not have exactly one active canonical manifest binding")
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
        if name == "SelfTest":
            # Boot generation binds Next.GT to the selected LightningBolt.
            raw_words[alloc - cc + 1] = RESIDENTS["CapabilityTest"][1]
        if loaded_words != raw_words:
            raise ValueError(f"{name} loaded resident body drift")
        tails[name] = words[location + alloc - cc:location + alloc]
    # These are continuation rows, not CapabilityTest's diagnostic SelfTest
    # capability: SelfTest Next is row 1; CapabilityTest ELOADCALL is last.
    edges = {"SelfTest": [tails["SelfTest"][1] & 0xffff],
             "CapabilityTest": [tails["CapabilityTest"][-1] & 0xffff],
             "WukongCallHome": []}
    if (tails["SelfTest"][1] != 0x4A00000A or
            tails["CapabilityTest"][-1] != 0x4A000007):
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
    """Stage all products, validate them, then swap one directory boundary."""
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
        try:
            shutil.copytree(target, stage, dirs_exist_ok=True, symlinks=True)
            for generator in GENERATORS:
                _run(["node", str(ROOT / "scripts" / generator), "--out-dir", str(stage)])
            _reconcile_approvals(stage)
            code = ("import json,os,sys;from server.boot_image import generate_boot_image;"
                    "p=sys.argv[1];c=json.load(open('server/boot-config.json'));"
                    "open(os.path.join(p,'boot-image.bin'),'wb').write(generate_boot_image(c,p,boot_entry_slot=c['bootEntrySlot'],require_entry_resident=True))")
            _run([sys.executable, "-c", code, str(stage)])
            _synchronize_resident_locations(stage)
            _validate_stage(stage)
            if fault_after_stage:
                raise RuntimeError("injected bootstrap migration failure")
            _exchange(target, stage)
            try:
                if fault_during_publication:
                    raise RuntimeError("injected publication failure")
            except Exception:
                _exchange(target, stage)
                raise
        finally:
            if stage.exists():
                shutil.rmtree(stage)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lumps-dir", default=ROOT / "server" / "lumps")
    parser.add_argument("--fault-after-stage", action="store_true")
    parser.add_argument("--fault-during-publication", action="store_true")
    args = parser.parse_args()
    migrate(args.lumps_dir, args.fault_after_stage, args.fault_during_publication)


if __name__ == "__main__":
    main()