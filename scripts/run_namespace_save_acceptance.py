#!/usr/bin/env python3
"""Namespace acceptance with disposable state; never reuse the live server."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def live_hashes():
    files = [ROOT / "server/boot-config.json", ROOT / "server/ide-hierarchy.json"]
    for name in ("server/lumps", "server/build-snapshots", "hardware/build"):
        files.extend(p for p in (ROOT / name).rglob("*") if p.is_file())
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in files if p.is_file()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("endpoints", "browser"))
    parser.add_argument("--profile", choices=("legacy", "phase1"), default="legacy")
    parser.add_argument("--remaining", nargs="?", const="boot", choices=("boot", "profiles", "node"),
                        help="Browser follow-up: boot segment, Phase 1 profiles, or IDE node only")
    args = parser.parse_args()
    before = live_hashes()
    try:
        with tempfile.TemporaryDirectory(prefix="church-namespace-acceptance-") as tmp:
            directory = Path(tmp)
            # Copy the COMPLETE configuration, not just the LUMP directory.
            for name in ("lumps", "build-snapshots"):
                shutil.copytree(ROOT / "server" / name, directory / name)
            for name in ("boot-config.json", "church_machine.db"):
                shutil.copy2(ROOT / "server" / name, directory / name)
            hierarchy = ROOT / "server/ide-hierarchy.json"
            if hierarchy.exists():
                shutil.copy2(hierarchy, directory / "ide-hierarchy.json")
            else:
                # Clean checkouts may not have an operator-assigned node.
                # Explicitly retain that absence in private storage.
                (directory / "ide-hierarchy.json").write_text("null\n")
            if args.profile == "phase1":
                design = directory / "lumps/design-drafts/phase1.json"
                if not design.exists():
                    # Ignored runtime drafts need not exist in a clean checkout.
                    # Use the frozen approved snapshot, never current catalog picks.
                    design.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(ROOT / "tests/fixtures/phase1_namespace_target.json", design)
                    print("No saved Phase 1 draft: using frozen approved acceptance fixture", flush=True)
            env = dict(os.environ,
                       CHURCH_NAMESPACE_SAVE_ACCEPTANCE="1",
                       REPORT_TOKEN="namespace-acceptance-test-only",
                       CHURCH_TEST_ISOLATED_MODE="1",
                       CHURCH_TEST_LUMPS_DIR=str(directory / "lumps"),
                       CHURCH_TEST_BOOT_CONFIG_PATH=str(directory / "boot-config.json"),
                       CHURCH_TEST_BUILD_SNAPSHOTS_DIR=str(directory / "build-snapshots"),
                       CHURCH_TEST_IDE_HIERARCHY_PATH=str(directory / "ide-hierarchy.json"),
                       CHURCH_TEST_DB_PATH=str(directory / "church_machine.db"))
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            if port == 5000:
                raise RuntimeError("Refusing live development port")
            env["E2E_PORT"] = str(port)
            target = ("namespace_phase1_acceptance" if args.profile == "phase1"
                      else "namespace_save_acceptance")
            # Playwright's existing config rejects existing-server reuse when
            # isolated mode is set and passes all five paths to its web server.
            command = (["python3", "-m", "pytest",
                        f"tests/server/test_{target}.py",
                        "tests/server/test_namespace_ide_node_acceptance.py", "-q", "--tb=short"]
                       if args.mode == "endpoints" else
                       ["npx", "playwright", "test",
                        f"tests/e2e/{target}.spec.js",
                        "tests/e2e/namespace_ide_node_acceptance.spec.js"])
            if args.mode == "endpoints" and args.profile == "phase1":
                command.append("tests/server/test_namespace_phase1_save_atomicity.py")
            if args.remaining:
                if args.mode != "browser":
                    raise ValueError("--remaining applies only to browser acceptance")
                if args.remaining == "node":
                    command.extend(["--grep", "IDE node isolated"])
                elif args.profile == "legacy":
                    if args.remaining != "boot":
                        raise ValueError("profiles follow-up requires --profile phase1")
                    command.extend(["--grep", "Namespace boot selection and incomplete design"])
                else:
                    # Only the unexecuted profile/boot segment, on the approved
                    # private snapshot; not a repeat of the completed edit journey.
                    env["CHURCH_PHASE1_ACCEPTANCE_REMAINING"] = args.remaining
                    design.write_text((ROOT / "tests/fixtures/phase1_namespace_target.json").read_text())
            subprocess.run(command, cwd=ROOT, env=env, check=True)
    finally:
        after = live_hashes()
        changed = sorted(p for p in before.keys() | after.keys()
                         if before.get(p) != after.get(p))
        if changed:
            raise RuntimeError(f"Live artifact preservation failed: {changed}")
        print(f"Live artifact preservation: {len(before)} files byte-identical", flush=True)


if __name__ == "__main__":
    main()
