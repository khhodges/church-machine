import copy
import hashlib
import json
import struct
import subprocess
from pathlib import Path

import pytest

from server.symbolic_binding import SCHEMA, FAULT, bind, embedded, validate


def fixture():
    contract = {"schema": SCHEMA, "owner": "ide.Caller",
        "dependencies": [
            {"name": "SELF", "rights": ["E"], "relocation_row": 0, "symbolic_self": True},
            {"name": "ide.Target", "rights": ["E"], "relocation_row": 1, "symbolic_self": False}],
        "calls": [{"row": 1, "word_offset": 2, "full_name": "ide.Target.Run",
                   "source_line": 7, "condition": 14}]}
    words = [(31 << 27) | (2 << 10) | 2, 2, FAULT] + [0] * 59 + [0xFEED5E1F, 0]
    owner = {"name": "ide.Caller", "slot": 16, "seq": 2, "rights": ["E"], "methods": []}
    target = {"name": "ide.Target", "slot": 17, "seq": 3, "rights": ["E"],
              "methods": [{"name": "Run", "index": 2}]}
    return words, contract, owner, target


def test_missing_destination_remains_unresolved_without_mutation():
    words, contract, owner, _ = fixture()
    original = copy.deepcopy((words, contract))
    linked, report = bind(words, contract, owner, [owner])
    assert report["status"] == "unresolved"
    assert linked[2] == FAULT and linked[-1] == 0
    assert linked[-2] == 0x4A020010
    assert (words, contract) == original


def test_named_method_resolves_only_at_bind():
    words, contract, owner, target = fixture()
    linked, report = bind(words, contract, owner, [owner, target])
    assert report["status"] == "bound"
    assert linked[2] == (2 << 27) | (14 << 23) | (6 << 15) | (3 << 5) | 1
    assert linked[-1] == 0x4A030011
    assert words[2] == FAULT


@pytest.mark.parametrize("failure", ["duplicate", "missing_method", "no_rights"])
def test_unusable_destination_does_not_guess(failure):
    words, contract, owner, target = fixture()
    targets = [owner, target]
    if failure == "duplicate":
        targets.append({**target, "slot": 18})
    elif failure == "missing_method":
        target["methods"] = []
    else:
        target["rights"] = []
    linked, report = bind(words, contract, owner, targets)
    assert linked[2] == FAULT
    assert report["calls"][0]["status"] == "unresolved"


@pytest.mark.parametrize("field,value", [("word_offset", 0), ("word_offset", 3),
                                        ("row", 32), ("condition", 16)])
def test_invalid_relocations_are_rejected(field, value):
    words, contract, _, _ = fixture()
    contract["calls"][0][field] = value
    with pytest.raises(ValueError):
        validate(contract, 2, words)


def test_real_compiler_emits_integrity_covered_symbolic_contract():
    source = ("abstraction ide.Caller {\ncapabilities { SELF E, ide.Target E }\n"
              "method Run() {\nCALL ide.Target.Run\nRETURN\n}\n}\n")
    proc = subprocess.run(["node", "server/compile_worker.js"], input=json.dumps({
        "source": source, "language": "javascript", "tier": 2}),
        text=True, capture_output=True, check=True, timeout=30)
    result = json.loads(proc.stdout)
    assert result["ok"], result
    contract = embedded(result["words"])
    assert contract["owner"] == "ide.Caller"
    assert contract["calls"][0]["full_name"] == "ide.Target.Run"
    assert result["words"][contract["calls"][0]["word_offset"]] == FAULT


@pytest.mark.parametrize("target_type,expected", [("Thread", "bound"), ("Namespace", "bound"),
                                                 ("Device", "unresolved"), ("Inform", "unresolved")])
def test_zero_rights_are_structural_identity_not_an_invented_grant(target_type, expected):
    words, contract, owner, target = fixture()
    contract["calls"] = []
    contract["dependencies"][1]["rights"] = []
    target.update(type=target_type, rights=[])
    linked, report = bind(words, contract, owner, [owner, target])
    assert report["status"] == expected
    assert linked[-1] == (0x02030011 if expected == "bound" else 0)
    assert words[-1] == 0


def test_device_linking_does_not_widen_requested_rights():
    words, contract, owner, target = fixture()
    contract["calls"] = []
    contract["dependencies"][1]["rights"] = ["R"]
    target.update(type="Device", rights=["R", "W"])
    linked, report = bind(words, contract, owner, [owner, target])
    assert report["status"] == "bound"
    assert linked[-1] == 0x12030011
    contract["dependencies"][1]["rights"] = ["R", "W"]
    target["rights"] = ["R"]
    linked, report = bind(words, contract, owner, [owner, target])
    assert report["status"] == "unresolved" and linked[-1] == 0
