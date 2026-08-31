#!/usr/bin/env python3
"""Create and verify an auditable provenance record for a Wukong FPGA build.

The record binds the exact generated Verilog consumed by Vivado to its Python
source closure, the Boot layout, sentinel build version, constraints, and the
resulting .bit/.mcs hashes.  It intentionally lives beside the build outputs;
it is not a release catalog and must not be treated as one.

Typical use:
    python3 scripts/wukong_build_provenance.py
    python3 scripts/wukong_build_provenance.py --vivado-version 2026.1 --wns 1.23
    python3 scripts/wukong_build_provenance.py --verify
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
DEFAULT_OUTPUT = BUILD / "church_wukong_xc7a100t.provenance.json"
BITSTREAM_NAME = "church_wukong_xc7a100t.bit"
MCS_NAME = "church_wukong_xc7a100t.mcs"

sys.path.insert(0, str(ROOT))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _git_commit() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _git_tree_clean() -> bool:
    """Return whether the source commit can be used as a reproducible baseline."""
    try:
        changed = subprocess.check_output(
            ["git", "status", "--porcelain=v1"], cwd=ROOT,
            text=True, stderr=subprocess.DEVNULL,
        ).splitlines()
        # Generated build outputs are intentionally tracked for distribution
        # and change as part of regeneration; they are not source ambiguity.
        source_paths = (
            "hardware/", "server/lumps/boot-image.bin",
            "pyproject.toml", "uv.lock",
        )
        return not any(
            len(line) > 3 and line[3:].strip().startswith(source_paths)
            for line in changed
        )
    except (OSError, subprocess.CalledProcessError):
        return False


def _boot_input_hashes() -> dict[str, str]:
    """Hash serialized boot inputs separately from the generator source set."""
    candidates = ("hardware/boot_rom.py", "server/lumps/boot-image.bin")
    return {
        relative: _sha256(ROOT / relative)
        for relative in candidates
        if (ROOT / relative).is_file()
    }


def _tracked_file_hashes() -> dict[str, str]:
    from hardware.readiness import WUKONG_SOURCES

    paths = list(WUKONG_SOURCES) + [
        "hardware/wukong_xc7a100t.tcl",
        "hardware/wukong_xc7a100t.xdc",
    ]
    return {relative: _sha256(ROOT / relative) for relative in paths}


def _build_record(vivado_version: str | None, wns: str | None,
                  release_verified: bool = False) -> dict:
    from hardware.boot_rom import (
        BOOT_PROGRAM,
        SELFTEST_NS_SLOT,
        WUKONG_CALLHOME_BASE_BYTE,
        WUKONG_CALLHOME_NS_SLOT,
        WUKONG_SELFTEST_BASE_BYTE,
        WUKONG_THREAD_BASE_WORD,
    )
    from hardware.readiness import source_fingerprint, WUKONG_SOURCES
    from hardware.wukong_top import WUKONG_BUILD_VERSION, WUKONG_N_INIT

    artifacts = {}
    for name in (
        "church_wukong_xc7a100t.il",
        "church_wukong_xc7a100t.v",
        "church_wukong_xc7a100t.bit",
        "church_wukong_xc7a100t.mcs",
    ):
        path = BUILD / name
        if path.is_file():
            artifacts[name] = {
                "sha256": _sha256(path),
                "size_bytes": path.stat().st_size,
            }

    return {
        "schema_version": 1,
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "source_commit": _git_commit(),
        "source_tree_clean": _git_tree_clean(),
        "boot_inputs_sha256": _boot_input_hashes(),
        "release_status": "verified" if release_verified else "unverified",
        "sentinel": {
            "magic_hex": "0xBC",
            "build_version": WUKONG_BUILD_VERSION,
            "n_init": WUKONG_N_INIT,
            "tu_version": 2,
        },
        "hardware_sources_sha256": source_fingerprint(WUKONG_SOURCES),
        "input_files_sha256": _tracked_file_hashes(),
        "boot_layout": {
            "boot_program_words": [f"0x{word:08X}" for word in BOOT_PROGRAM[:4]],
            "selftest_ns_slot": SELFTEST_NS_SLOT,
            "selftest_base_byte": WUKONG_SELFTEST_BASE_BYTE,
            "thread_base_word": WUKONG_THREAD_BASE_WORD,
            "callhome_ns_slot": WUKONG_CALLHOME_NS_SLOT,
            "callhome_base_byte": WUKONG_CALLHOME_BASE_BYTE,
        },
        "artifacts": artifacts,
        "vivado": {
            "part": "xc7a100tfgg676-2",
            "version": vivado_version,
            "wns_ns": wns,
        },
    }


def _write_atomic(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, prefix=path.name + ".", delete=False
    ) as fh:
        json.dump(record, fh, indent=2, sort_keys=True)
        fh.write("\n")
        temp_name = fh.name
    os.replace(temp_name, path)


def _verify_release_bundle(path: Path) -> int:
    """Verify the mergeable release files without rebinding them to current source."""
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"FAIL: cannot read provenance record {path}: {exc}", file=sys.stderr)
        return 1

    if not isinstance(record, dict):
        print("FAIL: provenance record must be a JSON object", file=sys.stderr)
        return 1

    failures = []
    if record.get("schema_version") != 1:
        failures.append("schema_version")
    if record.get("release_status") != "verified":
        failures.append("release_status")
    if record.get("source_tree_clean") is not True:
        failures.append("source_tree_clean")

    source_commit = record.get("source_commit")
    if not isinstance(source_commit, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", source_commit):
        failures.append("source_commit")
    sentinel = record.get("sentinel")
    build_version = sentinel.get("build_version") if isinstance(sentinel, dict) else None
    if not isinstance(build_version, int) or isinstance(build_version, bool):
        failures.append("sentinel:build_version")

    artifacts = record.get("artifacts")
    if not isinstance(artifacts, dict):
        artifacts = {}
        failures.append("artifacts")
    build_dir = path.parent
    for name in (BITSTREAM_NAME, MCS_NAME):
        expected = artifacts.get(name)
        artifact_path = build_dir / name
        if not isinstance(expected, dict):
            failures.append(f"provenance:{name}")
            continue
        if not artifact_path.is_file():
            failures.append(f"missing:{name}")
            continue
        if expected.get("sha256") != _sha256(artifact_path):
            failures.append(f"sha256:{name}")
        if expected.get("size_bytes") != artifact_path.stat().st_size:
            failures.append(f"size:{name}")

    bit_path = build_dir / BITSTREAM_NAME
    sidecar_path = build_dir / f"{BITSTREAM_NAME}.meta.json"
    try:
        sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        sidecar = None
        failures.append(f"missing_or_invalid:{sidecar_path.name}")
    if not isinstance(sidecar, dict):
        failures.append(f"invalid_shape:{sidecar_path.name}")

    bit_record = artifacts.get(BITSTREAM_NAME)
    if not isinstance(bit_record, dict):
        bit_record = {}
    if isinstance(sidecar, dict) and bit_path.is_file():
        if sidecar.get("md5") != _md5(bit_path):
            failures.append("sidecar:md5")
        if sidecar.get("sha256") != bit_record.get("sha256"):
            failures.append("sidecar:sha256")
        if sidecar.get("size_bytes") != bit_record.get("size_bytes"):
            failures.append("sidecar:size_bytes")
        if sidecar.get("source_commit") != source_commit:
            failures.append("sidecar:source_commit")
        if sidecar.get("version") != build_version:
            failures.append("sidecar:version")

    if failures:
        print("FAIL: release bundle mismatch: " + ", ".join(failures), file=sys.stderr)
        return 1
    print(f"OK: verified release bundle: {path}")
    return 0


def _verify(path: Path) -> int:
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"FAIL: cannot read provenance record {path}: {exc}", file=sys.stderr)
        return 1
    if record.get("schema_version") != 1:
        print("FAIL: unsupported or missing provenance schema version", file=sys.stderr)
        return 1

    current = _build_record(
        (record.get("vivado") or {}).get("version"),
        (record.get("vivado") or {}).get("wns_ns"),
        record.get("release_status") == "verified",
    )
    failures = []
    for key in (
        "hardware_sources_sha256", "input_files_sha256", "sentinel",
        "boot_layout", "source_tree_clean", "boot_inputs_sha256",
    ):
        if record.get(key) != current.get(key):
            failures.append(key)
    if record.get("source_tree_clean") is not True:
        failures.append("source_tree_not_clean")
    from hardware.readiness import artifact_is_fresh, WUKONG_SOURCES
    for relative in ("build/church_wukong_xc7a100t.il", "build/church_wukong_xc7a100t.v"):
        fresh, _ = artifact_is_fresh(ROOT / relative, WUKONG_SOURCES)
        if not fresh:
            failures.append(f"stale:{relative}")
    for name, expected in (record.get("artifacts") or {}).items():
        actual = (current.get("artifacts") or {}).get(name)
        if actual != expected:
            failures.append(f"artifact:{name}")
    if record.get("source_commit") != current.get("source_commit"):
        failures.append("source_commit")
    if failures:
        print("FAIL: provenance mismatch: " + ", ".join(failures), file=sys.stderr)
        return 1
    print(f"OK: provenance verified: {path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--vivado-version", default=None)
    parser.add_argument("--wns", default=None, help="Clean implementation WNS in ns")
    parser.add_argument(
        "--release-verified", action="store_true",
        help="Attest a vendor-built release (only after reviewing Vivado evidence)",
    )
    verification = parser.add_mutually_exclusive_group()
    verification.add_argument("--verify", action="store_true")
    verification.add_argument(
        "--verify-release", action="store_true",
        help="Verify the tracked .bit, sidecar, provenance, and .mcs release bundle",
    )
    args = parser.parse_args()
    output = args.output if args.output.is_absolute() else ROOT / args.output
    if args.verify:
        return _verify(output)
    if args.verify_release:
        return _verify_release_bundle(output)
    if args.release_verified and (not args.vivado_version or args.wns is None):
        parser.error("--release-verified requires --vivado-version and --wns")
    _write_atomic(output, _build_record(
        args.vivado_version, args.wns, args.release_verified
    ))
    print(f"Written: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())