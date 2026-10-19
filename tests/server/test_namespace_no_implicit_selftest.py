"""Default design generation must not select a historical SelfTest implicitly."""
from server.namespace_design_v1 import seed, phase1_seed


def test_new_designs_do_not_insert_selftest():
    for document in (seed({}), phase1_seed()):
        assert all(row["name"] != "SelfTest" for row in document["rows"])
        assert len([row for row in document["rows"] if row.get("boot")]) == 1


def test_legacy_membership_cannot_restore_default_selftest():
    document = seed({"abstractions": [{"name": "SelfTest", "slot": 6}]})
    assert all(row["name"] != "SelfTest" for row in document["rows"])
