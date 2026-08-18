#!/usr/bin/env python3
"""Guard: detect any net changes to server/lumps/ across a test run.

Usage:
  python3 scripts/check_lumps_dir_clean.py --snapshot FILE
      Hash every regular file and symlink in server/lumps/ and write the
      result to FILE (JSON).  Call this BEFORE running tests.

  python3 scripts/check_lumps_dir_clean.py --verify FILE
      Compare the current state of server/lumps/ against the snapshot in
      FILE.  Exits 0 when identical, exits 1 (with a loud banner) if any
      file was modified, deleted, or created without being cleaned up.

  python3 scripts/check_lumps_dir_clean.py --selftest
      Run a quick self-test against a temporary scratch directory and exit.

Modified or deleted files → always FAIL (these corrupt the canonical lumps).
New files left behind      → always FAIL (tests must restore what they touch).

The one intentional exception: if server/lumps/ does not exist at snapshot
time, the verify step is skipped with a warning rather than failing, because
a completely absent directory means the test environment was not set up.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile

ROOT      = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LUMPS_DIR = os.path.join(ROOT, "server", "lumps")

_SENTINEL = "__LUMPS_DIR_MISSING__"


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _take_snapshot(lumps_dir: str) -> dict:
    """Return a JSON-serialisable snapshot of *lumps_dir*.

    Each entry maps filename → {"kind": "file"|"link", "val": sha256|target}.
    Returns {"__LUMPS_DIR_MISSING__": True} when the directory is absent.
    """
    if not os.path.isdir(lumps_dir):
        return {_SENTINEL: True}
    result: dict = {}
    for name in sorted(os.listdir(lumps_dir)):
        p = os.path.join(lumps_dir, name)
        if os.path.islink(p):
            result[name] = {"kind": "link", "val": os.readlink(p)}
        elif os.path.isfile(p):
            result[name] = {"kind": "file", "val": _sha256_file(p)}
    return result


def cmd_snapshot(snapshot_file: str) -> None:
    snap = _take_snapshot(LUMPS_DIR)
    with open(snapshot_file, "w") as fh:
        json.dump(snap, fh, indent=2)
    if _SENTINEL in snap:
        print(
            f"[lumps-guard] WARNING: {LUMPS_DIR} does not exist; "
            "snapshot records directory-absent sentinel."
        )
    else:
        print(
            f"[lumps-guard] Snapshot of {len(snap)} entries saved to {snapshot_file}"
        )


def _compare(before: dict, after: dict) -> list[str]:
    """Return a list of human-readable problem descriptions (empty = clean)."""
    if _SENTINEL in before:
        # Directory was absent before the run; we can't meaningfully compare.
        return []

    problems: list[str] = []

    for name, bentry in before.items():
        if name not in after:
            problems.append(f"  DELETED:              {name}")
            continue
        aentry = after[name]
        if bentry["kind"] != aentry["kind"]:
            problems.append(
                f"  KIND CHANGED:         {name}"
                f"  ({bentry['kind']} → {aentry['kind']})"
            )
        elif bentry["kind"] == "file" and bentry["val"] != aentry["val"]:
            problems.append(f"  MODIFIED:             {name}")
        elif bentry["kind"] == "link" and bentry["val"] != aentry["val"]:
            problems.append(
                f"  SYMLINK RETARGETED:   {name}"
                f"  ({bentry['val']} → {aentry['val']})"
            )

    for name in after:
        if name not in before and name != _SENTINEL:
            problems.append(f"  CREATED (not cleaned up): {name}")

    return problems


def cmd_verify(snapshot_file: str) -> None:
    with open(snapshot_file) as fh:
        before = json.load(fh)

    after = _take_snapshot(LUMPS_DIR)
    problems = _compare(before, after)

    if not problems:
        n = len([k for k in after if k != _SENTINEL])
        print(
            f"[lumps-guard] server/lumps/ is clean — "
            f"no changes detected ({n} entries checked)."
        )
        return

    bar = "━" * 54
    lines = [
        "",
        bar,
        "  LUMPS-GUARD FAILURE: server/lumps/ was mutated by the",
        "  test run and not fully restored.",
        "",
        "  Changed entries:",
    ] + problems + [
        "",
        "  A test wrote into server/lumps/ without a proper",
        "  snapshot/restore fixture.  This can corrupt the",
        "  canonical SelfTest lump and crash the IDE server",
        "  (hardware/boot_rom.py asserts word[510]==0x4A000006",
        "  at import time).",
        "",
        "  Fix: wrap the offending test module in a",
        "  lumps_dir_snapshot fixture — see the pattern in",
        "  tests/boot/test_boot_abstr_cw_cc.py.",
        bar,
    ]
    print("\n".join(lines), file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

def cmd_selftest() -> None:  # pragma: no cover
    """Smoke-test the snapshot/compare logic against a temp directory."""
    import struct

    with tempfile.TemporaryDirectory() as tmp:
        fake_lumps = os.path.join(tmp, "lumps")
        os.makedirs(fake_lumps)

        # Create two initial files
        f1 = os.path.join(fake_lumps, "aaa.lump")
        f2 = os.path.join(fake_lumps, "bbb.lump")
        with open(f1, "wb") as fh:
            fh.write(struct.pack(">I", 0xDEADBEEF))
        with open(f2, "wb") as fh:
            fh.write(struct.pack(">I", 0x12345678))

        snap_file = os.path.join(tmp, "snap.json")

        # Capture snapshot against fake_lumps by temporarily monkey-patching LUMPS_DIR
        global LUMPS_DIR
        _saved = LUMPS_DIR
        try:
            LUMPS_DIR = fake_lumps

            # Test 1: clean round-trip should produce no problems
            before = _take_snapshot(fake_lumps)
            after  = _take_snapshot(fake_lumps)
            assert _compare(before, after) == [], "clean round-trip should have no problems"

            # Test 2: modified file
            with open(f1, "wb") as fh:
                fh.write(struct.pack(">I", 0xCAFEBABE))
            after2 = _take_snapshot(fake_lumps)
            probs2 = _compare(before, after2)
            assert any("MODIFIED" in p for p in probs2), f"expected MODIFIED, got {probs2}"

            # Restore
            with open(f1, "wb") as fh:
                fh.write(struct.pack(">I", 0xDEADBEEF))

            # Test 3: deleted file
            os.remove(f2)
            after3 = _take_snapshot(fake_lumps)
            probs3 = _compare(before, after3)
            assert any("DELETED" in p for p in probs3), f"expected DELETED, got {probs3}"

            # Restore
            with open(f2, "wb") as fh:
                fh.write(struct.pack(">I", 0x12345678))

            # Test 4: new file created
            f3 = os.path.join(fake_lumps, "ccc.lump")
            with open(f3, "wb") as fh:
                fh.write(b"\x00" * 4)
            after4 = _take_snapshot(fake_lumps)
            probs4 = _compare(before, after4)
            assert any("CREATED" in p for p in probs4), f"expected CREATED, got {probs4}"
            os.remove(f3)

            # Test 5: missing directory at snapshot time → no problems reported
            # (represented by the sentinel; compare() bails early)
            before5 = {_SENTINEL: True}
            after5  = _take_snapshot(fake_lumps)
            probs5  = _compare(before5, after5)
            assert probs5 == [], f"missing-dir sentinel should skip compare, got {probs5}"

            # Test 6: empty directory at snapshot time, then file created →
            # CREATED must be reported (empty dict ≠ dir-absent sentinel)
            empty_lumps = os.path.join(tmp, "empty_lumps")
            os.makedirs(empty_lumps)
            _saved2 = LUMPS_DIR
            try:
                LUMPS_DIR = empty_lumps
                before6 = _take_snapshot(empty_lumps)
                assert before6 == {}, f"empty dir should snapshot as empty dict, got {before6}"
                f_new = os.path.join(empty_lumps, "new.lump")
                with open(f_new, "wb") as fh:
                    fh.write(b"\x00" * 4)
                after6 = _take_snapshot(empty_lumps)
                probs6 = _compare(before6, after6)
                assert any("CREATED" in p for p in probs6), \
                    f"empty-before: expected CREATED when file added to empty dir, got {probs6}"
            finally:
                LUMPS_DIR = _saved2

            # Test 7: sequential post-run safety — simulate a writer that mutates
            # then restores before verify runs (models what run-all-tests.sh does:
            # snapshot → launch parallel sessions → all teardowns complete → verify).
            # The verify step must report CLEAN, not a spurious failure, because it
            # only runs after the writer has restored the directory.
            before7 = _take_snapshot(fake_lumps)
            # Writer mutates
            with open(f1, "wb") as fh:
                fh.write(struct.pack(">I", 0xDEADDEAD))
            # Writer restores (teardown)
            with open(f1, "wb") as fh:
                fh.write(struct.pack(">I", 0xDEADBEEF))
            after7 = _take_snapshot(fake_lumps)
            probs7 = _compare(before7, after7)
            assert probs7 == [], (
                f"sequential guard: transient mutation+restore should be invisible "
                f"to post-run verify, got {probs7}"
            )

            print("[lumps-guard] self-test PASSED (7/7 checks)")

        finally:
            LUMPS_DIR = _saved


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Snapshot and verify server/lumps/ integrity across a test run.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--snapshot",
        metavar="FILE",
        help="Save a hash snapshot of server/lumps/ to FILE.",
    )
    group.add_argument(
        "--verify",
        metavar="FILE",
        help="Compare current server/lumps/ against FILE; exit 1 if changed.",
    )
    group.add_argument(
        "--selftest",
        action="store_true",
        help="Run built-in smoke tests and exit.",
    )

    args = parser.parse_args()

    if args.snapshot:
        cmd_snapshot(args.snapshot)
    elif args.verify:
        cmd_verify(args.verify)
    else:
        cmd_selftest()


if __name__ == "__main__":
    main()
