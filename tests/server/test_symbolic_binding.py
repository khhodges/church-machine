import copy
import json
import subprocess

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
    assert linked[2] == (2 << 27) | (14 << 23) | (8 << 15) | (3 << 5) | 1
    assert linked[-1] == 0x4A030011
    assert words[2] == FAULT


def test_bare_historical_call_never_becomes_selector_zero():
    words, contract, owner, target = fixture()
    contract["calls"][0]["full_name"] = target["name"]
    original = copy.deepcopy((words, contract))
    linked, report = bind(words, contract, owner, [owner, target])
    assert linked[2] == FAULT
    assert report["status"] == "unresolved"
    assert report["calls"][0]["methodSelector"] is None
    assert "no declared method" in report["calls"][0]["reason"]
    assert (words, contract) == original


def test_first_named_method_matches_actual_assembler():
    words, contract, owner, target = fixture()
    target["methods"][0]["index"] = 0
    linked, _ = bind(words, contract, owner, [owner, target])
    result = subprocess.run(["node", "-e", """
const A = require('./simulator/assembler');
const a = new A({'ide.Target': {Run: {index: 0}}});
a.setLocalClistSlots({'ide.Target': 1});
const r = a.assemble('CALL ide.Target, Run');
if(r.errors.length) throw Error(JSON.stringify(r.errors));
console.log(r.words[0]);
"""], capture_output=True, text=True, check=True)
    assert linked[2] == int(result.stdout) == 0x17040021


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


def historical_words():
    """Read shared frozen bytes; never invoke a compiler to create legacy CALLs."""
    proc = subprocess.run(
        ["node", "-e", "console.log(JSON.stringify(require('./tests/fixtures/legacy-symbolic-calls').native))"],
        text=True, capture_output=True, check=True, timeout=30)
    return json.loads(proc.stdout)


def test_real_compiler_rejects_unresolved_calls():
    source = ("abstraction ide.Caller {\ncapabilities { SELF E, ide.Target E }\n"
              "method Run() {\nCALL ide.Target.Run\nRETURN\n}\n}\n")
    proc = subprocess.run(["node", "server/compile_worker.js"], input=json.dumps({
        "source": source, "language": "javascript", "tier": 2}),
        text=True, capture_output=True, check=True, timeout=30)
    result = json.loads(proc.stdout)
    assert not result["ok"], result
    assert "Cannot encode CALL" in result["error"]
    assert "words" not in result


def test_historical_integrity_covered_symbolic_contract():
    words = historical_words()
    contract = embedded(words)
    assert contract["owner"] == "ide.Probe"
    assert contract["calls"][0]["full_name"] == "ide.SelfTest.Run"
    assert words[contract["calls"][0]["word_offset"]] == FAULT
    compact_zero = words[:]
    compact_zero[-(compact_zero[0] & 255)] = 0
    assert embedded(compact_zero) == contract
    for row in (0, 1):
        injected = compact_zero[:]
        injected[len(injected) - (injected[0] & 255) + row] = 0x46000006
        with pytest.raises(ValueError, match="must remain unresolved"):
            embedded(injected)


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
