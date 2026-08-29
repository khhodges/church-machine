"""Shared source-freshness and layout checks for hardware build artifacts."""

from __future__ import annotations

import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Source manifests — complete transitive closure of Python files that affect
# each generated output artifact.  Any file listed here, when changed, must
# trigger regeneration of the corresponding artifact.
#
# CORE_SOURCES: every hardware/*.py module imported (directly or transitively)
# when gen_verilog.py is executed, plus gen_verilog.py itself (whose
# post-processing logic — e.g. _fix_macc_cells — also affects the output).
# readiness.py is excluded: it provides the fingerprinting mechanism only and
# has no effect on the generated Verilog/RTLIL circuit.
#
# WUKONG_SOURCES: CORE_SOURCES plus gen_rtlil.py (which has its own
# post-processing) and the Wukong-only modules imported at generation time
# (wukong_top.py imports uart_tx.py and uart_rx.py).
# ---------------------------------------------------------------------------

CORE_SOURCES: tuple[str, ...] = (
    "hardware/boot_rom.py",
    "hardware/call.py",
    "hardware/change.py",
    "hardware/church_outform.py",
    "hardware/cload.py",
    "hardware/core.py",
    "hardware/decoder.py",
    "hardware/dread.py",
    "hardware/dwrite.py",
    "hardware/fused_unit.py",
    "hardware/gc_unit.py",
    "hardware/gen_verilog.py",
    "hardware/hw_types.py",
    "hardware/integrity32.py",
    "hardware/irq_dispatch.py",
    "hardware/lambda_unit.py",
    "hardware/layouts.py",
    "hardware/load.py",
    "hardware/mload.py",
    "hardware/mload_seq.py",
    "hardware/msave.py",
    "hardware/ns_gate.py",
    "hardware/outform.py",
    "hardware/outform_iot.py",
    "hardware/perm_check.py",
    "hardware/pet_name_mem.py",
    "hardware/registers.py",
    "hardware/ret.py",
    "hardware/save.py",
    "hardware/stack_frame.py",
    "hardware/switch.py",
    "hardware/tperm.py",
    "hardware/thread_design.py",
)

WUKONG_SOURCES: tuple[str, ...] = CORE_SOURCES + (
    "hardware/gen_rtlil.py",
    "hardware/uart_rx.py",
    "hardware/uart_tx.py",
    "hardware/wukong_top.py",
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


def stamp_text(
    text: str, paths: tuple[str, ...], comment_prefix: str = "// "
) -> str:
    """Add/replace the freshness marker without changing generated semantics."""
    marker = artifact_stamp(paths)
    lines = text.splitlines(keepends=True)
    prefixes = ("// ", "# ")
    lines = [
        line for line in lines
        if not any(line.startswith(prefix + "CM-HARDWARE-SOURCES-SHA256:")
                   for prefix in prefixes)
    ]
    return comment_prefix + marker + "\n" + "".join(lines)


def artifact_is_fresh(path: Path, paths: tuple[str, ...]) -> tuple[bool, str]:
    if not path.exists():
        return False, f"{path} is missing"
    first_line = path.open("r", encoding="utf-8", errors="replace").readline().strip()
    expected = artifact_stamp(paths)
    if first_line not in ("// " + expected, "# " + expected):
        return False, f"{path} has no current hardware source fingerprint"
    return True, f"{path} matches current hardware sources"
