"""Selected non-LUMP destinations participate without executable grants."""
from server import namespace_binding_targets as targets


def test_configured_names_and_exact_descriptors(monkeypatch):
    monkeypatch.setattr(targets, "configuration", lambda: {
        "node": "ide", "aliases": {"Thread.2": "ide.Thread2", "Boot.Thread": "ide.BootThread"}})
    context = targets.naming_context()
    assert targets.qualified_name("LED_DEV", context) == "ide.LED_DEV"
    assert targets.qualified_name("Thread.2", context) == "ide.Thread2"
    assert targets.qualified_name("Boot.Thread", context) == "ide.BootThread"
    assert targets.qualified_name("SelfTest", context) == "ide.SelfTest"
    assert targets.qualified_name("foreign.Device", context) == "foreign.Device"
    document = {"rows": [
        dict(slot=3, name="LED_DEV", kind="mmio", sequence=7, address=0x40000000, limit=4),
        dict(slot=11, name="Thread.2", kind="thread", sequence=2, words=256),
        dict(slot=10, name="ide.Caller", kind="lump", sequence=0),
    ]}
    rows = targets.non_lump_rows(document)
    assert len(rows) == 2
    assert rows[0] == dict(slot=3, name="LED_DEV", seq=7, type="Data",
                           rights=["R", "W"], address=0x40000000, limit=4)
    assert rows[1]["rights"] == []
    assert all("E" not in row["rights"] and "L" not in row["rights"] for row in rows)


def test_missing_ide_configuration_does_not_invent_a_node(monkeypatch):
    monkeypatch.setattr(targets, "configuration", lambda: None)
    assert targets.qualified_name("LED_DEV", targets.naming_context()) == "LED_DEV"


def test_actual_symbolic_bind_resolves_devices_and_threads_without_extra_rights():
    from server.symbolic_binding import bind
    from server.portable_binding import mint_gt
    contract = {"schema": "church.symbolic-lump-binding/v1", "owner": "ide.Caller",
        "dependencies": [
            {"name": "SELF", "rights": ["E"], "symbolic_self": True, "relocation_row": 0},
            {"name": "ide.LED_DEV", "rights": ["R"], "symbolic_self": False, "relocation_row": 1},
            {"name": "ide.Thread2", "rights": [], "symbolic_self": False, "relocation_row": 2}],
        "calls": []}
    words = [(31 << 27) | (1 << 10) | 3, 0] + [0]*59 + [0xFEED5E1F, 0, 0]
    owner = dict(name="ide.Caller", slot=10, seq=0, rights=["E"], type="Inform")
    selected = [owner, dict(name="ide.LED_DEV", slot=3, seq=7, rights=["R", "W"], type="Data"),
                dict(name="ide.Thread2", slot=11, seq=2, rights=[], type="Thread")]
    result, report = bind(words, contract, owner, selected)
    assert report["status"] == "bound"
    assert result[-2] == mint_gt(7, 3, ["R"], 1)
    assert result[-1] == mint_gt(2, 11, [], 1)
    assert words[-2:] == [0, 0]
