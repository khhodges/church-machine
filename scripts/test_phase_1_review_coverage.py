"""The crosswalk checks documentary coverage, never hardware conformance."""
import pytest
import audit_phase_1_review_coverage as audit


def test_all_decisions_have_dispositions():
    report = audit.render()
    rows = [line for line in report.splitlines()
            if line.startswith("| ") and line.split("|")[1].strip().isdigit()]
    assert len(rows) == 86
    assert "**not execution or a pass**" in report
    assert "oracle gaps explicitly remain" in report


def test_changed_ledger_cannot_silently_reuse_section_numbers(tmp_path, monkeypatch):
    changed = tmp_path / "review.md"
    changed.write_text(audit.SOURCE.read_text() + "\nChanged evidence.\n")
    monkeypatch.setattr(audit, "SOURCE", changed)
    with pytest.raises(AssertionError, match="Frozen ledger changed"):
        audit.render()


def test_missing_acceptance_case_is_rejected(tmp_path, monkeypatch):
    changed = tmp_path / "plan.md"
    changed.write_text(audit.PLAN.read_text().replace("| H17 |", "| REMOVED |"))
    monkeypatch.setattr(audit, "PLAN", changed)
    with pytest.raises(AssertionError, match="Missing acceptance case H17"):
        audit.render()
