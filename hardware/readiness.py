"""Shared source-freshness and layout checks for hardware build artifacts."""

from __future__ import annotations

import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent

CORE_SOURCES = (
    "hardware/core.py",
    "hardware/call.py",
    "hardware/ret.py",
    "hardware/fused_unit.py",
    "hardware/layouts.py",
    "hardware/ns_gate.py",
    "hardware/mload.py",
    "hardware/stack_frame.py",
    "hardware/boot_rom.py",
    "hardware/hw_types.py",
)

WUKONG_SOURCES = CORE_SOURCES + (
    "hardware/wukong_top.py",
    "hardware/gen_rtlil.py",
)


def source_fingerprint(paths: tuple[str, ...]) -> str:
    """Return a deterministic digest of the source inputs for an artifact."""
    digest = hashlib.sha256()
    for relative in paths:
        path = ROOT / relative
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def artifact_stamp(paths: tuple[str, ...]) -> str:
    return f"CM-HARDWARE-SOURCES-SHA256: {source_fingerprint(paths)}"


def stamp_text(text: str, paths: tuple[str, ...]) -> str:
    """Add/replace the freshness marker without changing generated semantics."""
    marker = artifact_stamp(paths)
    lines = text.splitlines(keepends=True)
    lines = [line for line in lines if not line.startswith("// " + "CM-HARDWARE-SOURCES-SHA256:")]
    return "// " + marker + "\n" + "".join(lines)


def artifact_is_fresh(path: Path, paths: tuple[str, ...]) -> tuple[bool, str]:
    if not path.exists():
        return False, f"{path} is missing"
    first_line = path.open("r", encoding="utf-8", errors="replace").readline().strip()
    expected = "// " + artifact_stamp(paths)
    if first_line != expected:
        return False, f"{path} has no current hardware source fingerprint"
    return True, f"{path} matches current hardware sources"