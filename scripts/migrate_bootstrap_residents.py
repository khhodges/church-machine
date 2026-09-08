#!/usr/bin/env python3
"""Atomically regenerate the complete frozen bootstrap-resident catalog."""
import argparse
import ctypes
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
GENERATORS = (
    "build_selftest_lump.js",
    "build_wukong_callhome_lump.js",
    "build_capability_test_lump.js",
)


def _run(command):
    subprocess.run(command, cwd=ROOT, check=True)


def _exchange(left, right):
    """Atomically exchange two same-filesystem directory names (Linux)."""
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = libc.renameat2
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                          ctypes.c_char_p, ctypes.c_uint]
    if renameat2(-100, os.fsencode(left), -100, os.fsencode(right), 2) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def migrate(lumps_dir, fault_after_stage=False, fault_during_publication=False):
    """Stage all products, validate them, then swap one directory boundary."""
    target = Path(lumps_dir).resolve()
    parent = target.parent
    lock_path = Path(tempfile.gettempdir()) / (
        "lumps-history-transition-"
        + __import__("hashlib").sha256(str(target).encode()).hexdigest()[:16]
        + ".lock")
    with open(lock_path, "a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        # A process killed after a successful exchange can leave only the old
        # revision under its staging name.  The live target is already the new
        # revision; cleanup is safe and repeatable while holding the shared
        # server transition lock.
        for stale in parent.glob(".bootstrap-stage-*"):
            if stale.is_dir():
                shutil.rmtree(stale)
        stage = Path(tempfile.mkdtemp(prefix=".bootstrap-stage-", dir=parent))
        try:
            shutil.copytree(target, stage, dirs_exist_ok=True, symlinks=True)
            # A prior interrupted/destructive generator may have removed a
            # tracked historical body while leaving its hash-bound approval.
            # Restore those immutable bytes from repository history before
            # deriving the new active revision; never synthesize history.
            for historical in (
                    "CapabilityTest.1.e4fe164d.lump",
                    "CapabilityTest.1.878a5b27.lump",
                    "WukongCallHome.1.d54e2115.lump"):
                destination = stage / historical
                with open(destination, "wb") as output:
                    subprocess.run(
                        ["git", "show", f"HEAD:server/lumps/{historical}"],
                        cwd=ROOT, check=True, stdout=output)
            # Repair the historical aliases from immutable archived binaries.
            aliases = {
                "CapabilityTest.1.ac2b4b1b.lump": "CapabilityTest_v15.lump",
                "CapabilityTest.1.e158180f.lump": "CapabilityTest_v16.lump",
                "CapabilityTest.1.2d9ec45d.lump": "CapabilityTest_v17.lump",
                "CapabilityTest.1.2cdca9f6.lump": "CapabilityTest_v18.lump",
                "CapabilityTest.1.faf715c2.lump": "CapabilityTest_v19.lump",
                "CapabilityTest.1.36b34aa3.lump": "CapabilityTest_v20.lump",
                "CapabilityTest.2.4dc5c64e.lump": "CapabilityTest_v21.lump",
            }
            for alias, archive in aliases.items():
                path = stage / alias
                if path.exists() or path.is_symlink():
                    path.unlink()
                path.symlink_to(archive)
            for generator in GENERATORS:
                _run(["node", str(ROOT / "scripts" / generator),
                      "--out-dir", str(stage)])
            # Preserve the replaced Wukong artifact as explicit history.  An
            # approval whose exact historical bytes are no longer available
            # cannot remain authoritative; remove only that dangling
            # CapabilityTest record, leaving every backed approval untouched.
            manifest_path = stage / "manifest.json"
            manifest = json.loads(manifest_path.read_text())
            if not any(row.get("filename") == "WukongCallHome.1.d54e2115.lump"
                       for row in manifest):
                manifest.append({
                    "token": "85fcac64", "abstraction": "WukongCallHome",
                    "filename": "WukongCallHome.1.d54e2115.lump",
                    "lump_version": 8, "archived": True,
                })
            if not any(row.get("filename") == "CapabilityTest.1.878a5b27.lump"
                       for row in manifest):
                manifest.append({
                    "token": "7e661a33", "abstraction": "CapabilityTest",
                    "filename": "CapabilityTest.1.878a5b27.lump",
                    "variant_group": "capabilitytest-history",
                    "lump_version": 1, "archived": True,
                })
            manifest_path.write_text(json.dumps(manifest, indent=2))
            approvals_path = stage / "approvals.json"
            envelope = json.loads(approvals_path.read_text())
            envelope["approvals"].pop(
                "90bb895861580e8ac3c1cfe92d78babb0aeb32d48710a088798ec6819b353cf8",
                None)
            approvals_path.write_text(json.dumps(envelope, indent=2) + "\n")
            code = (
                "import json,os,sys;"
                "from server.boot_image import generate_boot_image;"
                "p=sys.argv[1];c=json.load(open('server/boot-config.json'));"
                "b=generate_boot_image(c,p,boot_entry_slot=c['bootEntrySlot'],"
                "require_entry_resident=True);"
                "open(os.path.join(p,'boot-image.bin'),'wb').write(b)"
            )
            _run([sys.executable, "-c", code, str(stage)])
            state = json.loads((stage / "ns-state.json").read_text())
            approved = json.loads((stage / "approvals.json").read_text())["approvals"]
            expected = {"SelfTest": 0x4A000006, "WukongCallHome": 0x4A000007,
                        "CapabilityTest": 0x4A00000A}
            for row in state["abstractions"]:
                if row.get("name") not in expected:
                    continue
                raw = (stage / row["filename"]).read_bytes()
                header = int.from_bytes(raw[:4], "big")
                allocation = 1 << (((header >> 23) & 15) + 6)
                cc = header & 255
                row0 = int.from_bytes(
                    raw[(allocation - cc) * 4:(allocation - cc + 1) * 4], "big")
                digest = __import__("hashlib").sha256(raw).hexdigest()
                assert row0 == expected[row["name"]]
                assert row["token"] == f"{row0:08x}"
                assert approved[digest]["bootstrap_t"] == f"{row0:08x}"
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