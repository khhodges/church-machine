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
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
DEFAULT_OUTPUT = BUILD / "church_wukong_xc7a100t.provenance.json"

sys.path.insert(0, str(ROOT))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
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


def _tracked_file_hashes() -> dict[str, str]:
    from hardware.readiness import WUKONG_SOURCES

    paths = list(WUKONG_SOURCES) + [
        "hardware/wukong_xc7a100t.tcl",
        "hardware/wukong_xc7a100t.xdc",
    ]
    return {relative: _sha256(ROOT / relative) for relative in paths}


def _build_record(vivado_version: str | None, wns: str | None) -> dict:
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
    )
    failures = []
    for key in ("hardware_sources_sha256", "input_files_sha256", "sentinel", "boot_layout"):
        if record.get(key) != current.get(key):
            failures.append(key)
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
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    output = args.output if args.output.is_absolute() else ROOT / args.output
    if args.verify:
        return _verify(output)
    _write_atomic(output, _build_record(args.vivado_version, args.wns))
    print(f"Written: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())