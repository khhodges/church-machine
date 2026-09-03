from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

CURRENT_DOCS = [
    "docs/instruction-set.md",
    "docs/isa_reference.md",
    "docs/switch-lifecycle.md",
    "docs/church-instructions.md",
    "docs/call-stack.md",
    "docs/namespace-security.md",
]


def test_current_switch_docs_share_fault_and_register_contract():
    for relative in CURRENT_DOCS:
        text = (ROOT / relative).read_text()
        assert "CR12–CR15" in text, relative
        assert "CR0–CR11" in text, relative
        assert "INVALID_OP" in text, relative
        assert "PERM_L" in text, relative


def test_current_switch_docs_do_not_claim_passkey_or_sentinel_authority():
    forbidden = (
        "PassKey-gated",
        "Install PassKey",
        "SWITCH CRs, target",
        "only Tgt=101",
        "only `Tgt=5`",
    )
    for relative in CURRENT_DOCS:
        text = (ROOT / relative).read_text()
        for phrase in forbidden:
            assert phrase not in text, f"{relative}: stale phrase {phrase!r}"


def test_old_design_documents_and_figure_are_explicitly_historical():
    for relative in (
        "docs/gt-literals.md",
        "docs/abstract-io-addressing.md",
        "docs/instruction-matrix.md",
    ):
        assert "HISTORICAL" in (ROOT / relative).read_text(), relative

    figure = (ROOT / "docs/figures/switch-lifecycle.html").read_text()
    assert "Current contract" in figure
    assert "Archived PassKey-era lifecycle diagram" in figure
    assert "<details>" in figure


def test_patent_snapshots_are_explicitly_non_authoritative():
    for relative in (
        "docs/patent-ctmm-io-addressing-2026.md",
        "docs/patent-ctmm-consolidated-2026.md",
    ):
        text = (ROOT / relative).read_text()
        assert "HISTORICAL PATENT SNAPSHOT / NON-AUTHORITATIVE" in text, relative
        assert "claims are superseded" in text, relative


def test_capability_test_documents_explicit_immediate_m_provisioning():
    source = (ROOT / "simulator/examples/capability_test.cloomc").read_text()
    lifecycle = (ROOT / "docs/switch-lifecycle.md").read_text()
    for text in (source, lifecycle):
        assert "immediately before CapabilityTest execution" in text
        assert "not an assumed initial state" in text or "not a test assumption" in text