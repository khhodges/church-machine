"""Regression tests for the namespace/thread pre-synthesis readiness gate,
and for the hardware-source-freshness fingerprint mechanism.

Run with:  python -m pytest hardware/test_readiness.py -v
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from hardware.readiness import (
    CORE_SOURCES,
    WUKONG_SOURCES,
    artifact_is_fresh,
    artifact_stamp,
    stamp_text,
)
from hardware.gen_verilog import generate_core_iot_verilog
from scripts.check_hardware_namespace_thread_readiness import (
    check_artifacts,
    check_contract,
)

ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# Namespace/thread pre-synthesis contract
# ---------------------------------------------------------------------------

def test_live_namespace_thread_contract_passes():
    assert check_contract()


# ---------------------------------------------------------------------------
# artifact_is_fresh — positive path
# ---------------------------------------------------------------------------

def test_artifact_without_stamp_is_rejected(tmp_path: Path):
    artifact = tmp_path / "generated.v"
    artifact.write_text("module generated;\nendmodule\n", encoding="utf-8")
    fresh, detail = artifact_is_fresh(artifact, CORE_SOURCES)
    assert not fresh
    assert "fingerprint" in detail


def test_generated_stamp_matches_sources(tmp_path: Path):
    artifact = tmp_path / "generated.v"
    artifact.write_text(stamp_text("module generated;\n", CORE_SOURCES), encoding="utf-8")
    fresh, _ = artifact_is_fresh(artifact, CORE_SOURCES)
    assert fresh


# ---------------------------------------------------------------------------
# artifact_is_fresh — error paths
# ---------------------------------------------------------------------------

def test_missing_file_is_reported_stale(tmp_path: Path):
    """A file that does not exist must be flagged as stale, not raise."""
    missing = tmp_path / "nonexistent.v"
    fresh, detail = artifact_is_fresh(missing, CORE_SOURCES)
    assert not fresh
    assert "missing" in detail


def test_wrong_fingerprint_is_reported_stale(tmp_path: Path):
    """A file whose first line has a valid-looking but outdated hash is stale."""
    artifact = tmp_path / "stale.v"
    stale_stamp = "// CM-HARDWARE-SOURCES-SHA256: " + "0" * 64
    artifact.write_text(stale_stamp + "\nmodule stale;\nendmodule\n", encoding="utf-8")
    fresh, detail = artifact_is_fresh(artifact, CORE_SOURCES)
    assert not fresh
    assert "fingerprint" in detail


def test_empty_file_is_reported_stale(tmp_path: Path):
    """A completely empty file has no stamp and must be flagged as stale."""
    artifact = tmp_path / "empty.v"
    artifact.write_text("", encoding="utf-8")
    fresh, detail = artifact_is_fresh(artifact, CORE_SOURCES)
    assert not fresh


def test_wukong_stamp_is_different_from_core_stamp():
    """CORE and WUKONG source sets must produce distinct fingerprints."""
    assert artifact_stamp(CORE_SOURCES) != artifact_stamp(WUKONG_SOURCES)


def test_generated_iot_verilog_passes_readiness_and_rejects_stale_stamp(
    tmp_path: Path,
):
    """The IoT generator must emit the stamp consumed by the readiness gate."""
    output_path = Path(generate_core_iot_verilog(tmp_path))

    messages = check_artifacts(tmp_path)
    assert output_path.name == "church_core_iot.v"
    assert any("church_core_iot.v" in message for message in messages)

    lines = output_path.read_text(encoding="utf-8").splitlines(keepends=True)
    lines[0] = "// CM-HARDWARE-SOURCES-SHA256: " + "0" * 64 + "\n"
    output_path.write_text("".join(lines), encoding="utf-8")

    with pytest.raises(AssertionError, match="regenerate before synthesis"):
        check_artifacts(tmp_path)


# ---------------------------------------------------------------------------
# Source-list completeness — CORE_SOURCES covers gen_verilog import closure
# ---------------------------------------------------------------------------

def _hw_module_files(*import_names: str) -> frozenset[Path]:
    """Return a fresh-process import closure for the named hardware modules.

    The old in-process probe accidentally included modules imported by earlier
    tests, making the core closure appear to depend on Wukong-only sources.
    A subprocess measures only imports caused by this specific generator.
    """
    program = """
import importlib
import json
import sys
from pathlib import Path

root = Path.cwd()
for name in json.loads(sys.argv[1]):
    importlib.import_module(name)
result = []
for mod_name, mod in sys.modules.items():
    if not mod_name.startswith("hardware.") or mod_name.startswith("hardware.test_"):
        continue
    filename = getattr(mod, "__file__", None)
    if filename is None:
        continue
    try:
        result.append(str(Path(filename).relative_to(root)))
    except ValueError:
        pass
print(json.dumps(sorted(set(result))))
"""
    proc = subprocess.run(
        [sys.executable, "-c", program, json.dumps(import_names)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return frozenset(Path(item) for item in json.loads(proc.stdout))


# Files that live inside the hardware package but deliberately do NOT affect
# any generated artifact (fingerprinting utility and the package init).
_EXCLUDED_FROM_COVERAGE = frozenset([
    Path("hardware/readiness.py"),
    Path("hardware/__init__.py"),
])


def test_core_sources_covers_gen_verilog_closure():
    """Every hardware module loaded during gen_verilog import must be in CORE_SOURCES.

    This prevents silent drift when a new sub-module is added to the circuit
    without being registered in the source manifest.
    """
    closure = _hw_module_files("hardware.gen_verilog")
    declared = frozenset(Path(p) for p in CORE_SOURCES)
    uncovered = closure - declared - _EXCLUDED_FROM_COVERAGE
    assert not uncovered, (
        "CORE_SOURCES is missing the following modules that are loaded by "
        "gen_verilog and would affect generated Verilog output:\n"
        + "\n".join(f"  {p}" for p in sorted(uncovered))
        + "\nAdd them to CORE_SOURCES in hardware/readiness.py."
    )


def test_wukong_sources_covers_gen_rtlil_closure():
    """Every hardware module loaded during gen_rtlil import (including the
    lazily-imported wukong_top and its dependencies) must be in WUKONG_SOURCES.
    """
    # wukong_top is imported inside generate_rtlil() at function-call time, so
    # we import it explicitly here to simulate what happens during generation.
    closure = _hw_module_files("hardware.gen_rtlil", "hardware.wukong_top")
    declared = frozenset(Path(p) for p in WUKONG_SOURCES)
    uncovered = closure - declared - _EXCLUDED_FROM_COVERAGE
    assert not uncovered, (
        "WUKONG_SOURCES is missing the following modules that are loaded "
        "during RTLIL generation and would affect the output:\n"
        + "\n".join(f"  {p}" for p in sorted(uncovered))
        + "\nAdd them to WUKONG_SOURCES in hardware/readiness.py."
    )


def test_core_sources_files_all_exist():
    """Every path in CORE_SOURCES must exist on disk."""
    missing = [p for p in CORE_SOURCES if not (ROOT / p).exists()]
    assert not missing, f"CORE_SOURCES references non-existent files: {missing}"


def test_wukong_sources_files_all_exist():
    """Every path in WUKONG_SOURCES must exist on disk."""
    missing = [p for p in WUKONG_SOURCES if not (ROOT / p).exists()]
    assert not missing, f"WUKONG_SOURCES references non-existent files: {missing}"
