"""Regression tests for the namespace/thread pre-synthesis readiness gate."""

from pathlib import Path

from hardware.readiness import CORE_SOURCES, artifact_is_fresh, stamp_text
from scripts.check_hardware_namespace_thread_readiness import check_contract


def test_live_namespace_thread_contract_passes():
    assert check_contract()


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