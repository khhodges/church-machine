"""Binding evidence must survive resident filtering, not assignment changes."""
import copy

import pytest

from server.simulation_preparation import symbolic_snapshot_key, portable_snapshot_key


@pytest.fixture(params=["symbolic", "portable"])
def key_fn(request):
    if request.param == "symbolic":
        return symbolic_snapshot_key
    return lambda binding, rows, bindings: portable_snapshot_key(b"exact source", binding, rows, bindings)


def context():
    rows = [
        dict(slot=6, name="ide.Entry", seq=3, filename="entry.lump",
             binary_hash="a" * 64, type="Inform", load_policy="Resident"),
        dict(slot=14, name="ide.Other", seq=7, filename="other.lump",
             binary_hash="b" * 64, type="Inform", load_policy="Lazy"),
    ]
    bindings = [dict(slot=r["slot"], filename=r["filename"], binaryHash=r["binary_hash"])
                for r in rows]
    return rows, bindings


def test_same_assignment_key_with_resident_only_body_subset(key_fn):
    rows, bindings = context()
    key = key_fn(bindings[0], rows, bindings)
    projected = copy.deepcopy(rows)
    for row in projected:
        row["load_policy"] = "Resident"
        row["resident"] = True
    assert key_fn(bindings[0], projected, bindings[:1]) == key


@pytest.mark.parametrize("field,value", [
    ("slot", 15), ("seq", 8), ("filename", "replacement.lump"),
    ("binary_hash", "c" * 64), ("name", "ide.Renamed"),
])
def test_lazy_assignment_changes_invalidate_evidence(field, value, key_fn):
    rows, bindings = context()
    before = key_fn(bindings[0], rows, bindings[:1])
    rows[1][field] = value
    assert key_fn(bindings[0], rows, bindings[:1]) != before
