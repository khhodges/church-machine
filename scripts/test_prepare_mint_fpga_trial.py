import copy
import json
import subprocess
import sys

import pytest

from scripts import prepare_mint_fpga_trial as trial
from scripts.prepare_mint_fpga_trial import construct, native_code, validate, LAYOUT


@pytest.fixture(scope="module")
def candidate():
    code = native_code()
    design, words = construct(code)
    return code, design, words


def test_exact_saved_candidate(candidate):
    code, design, words = candidate
    assert validate(design, words, code)["status"] == "candidate-bindings-validated"
    assert words[20 * 4] == design["cr15"]["baseBytes"] == 0
    assert words[LAYOUT["ide.MintState"][1] // 4 + 5] == 32768


@pytest.mark.parametrize("offset,value", [
    (1, 2048), (2, 2049), (3, 6), (4, 65), (5, 8192),
    (5, 32769), (6, 800), (8, 32), (7, 18), (7, 256),
    (64 + 32, 0), (64 + 32, 1024), (64 + 32, 511),
    (64 + 32, 4096), (1023, 0xffffffff),
])
def test_reject_bad_state(candidate, offset, value):
    code, design, original = candidate
    words = original.copy()
    words[3072 + offset] = value
    with pytest.raises(ValueError):
        validate(design, words, code)


@pytest.mark.parametrize("at,value", [
    (80, 4), (81, 2047), (32 * 4, 32768),
    (1024 + 1024 - 5, 0x32000013),  # substitute pool for state
    (2048 + 63, 0x32000012),  # verifier public alias to private state
    (6144 + 255, 0x32000014),  # Thread alias to Namespace RW
    (1025, 0),  # altered native instruction
])
def test_reject_image_changes(candidate, at, value):
    code, design, original = candidate
    words = original.copy()
    words[at] = value
    with pytest.raises(ValueError):
        validate(design, words, code)


@pytest.mark.parametrize("change", [
    {"installationAllowed": True}, {"publicClists": {"caller": [0x32000012]}},
    {"cr15": {"baseBytes": 4096, "limitWords": 1023}},
    {"historyOrigin": "inferred-from-empty-table"},
])
def test_reject_unreviewed_design(candidate, change):
    code, original, words = candidate
    design = copy.deepcopy(original)
    design.update(change)
    with pytest.raises(ValueError):
        validate(design, words, code)


@pytest.mark.parametrize("name", ["mint", "pkverify"])
@pytest.mark.parametrize("field", ["source", "code"])
def test_reject_changed_executable_with_unchanged_declarations(candidate, name, field):
    original, design, words = candidate
    code = copy.deepcopy(original)
    if field == "source":
        code[name]["source"] = code[name]["source"].replace("IADD DR1, DR0, #1", "IADD DR1, DR0, #0")
        assert code[name]["source"] != original[name]["source"]
    else:
        code[name]["code"][1] ^= 1
    assert code[name]["capabilities"] == original[name]["capabilities"]
    with pytest.raises(ValueError, match="identity changed"):
        construct(code)
    with pytest.raises(ValueError, match="identity changed"):
        validate(design, words, code)


@pytest.fixture
def saved(candidate, tmp_path):
    code, design, words = candidate
    for name, data in [("saved-design", design), ("native-code", code),
                       ("evidence", validate(design, words, code))]:
        (tmp_path / f"{name}.json").write_text(json.dumps(data))
    (tmp_path / "candidate.bin").write_bytes(trial.encoded(words))
    return tmp_path


def edit_json(path, change):
    data = json.loads(path.read_text())
    change(data)
    path.write_text(json.dumps(data))


def test_saved_snapshot_and_cli(saved, candidate):
    verified = trial.verify_saved_candidate(saved)
    assert verified["image"] == trial.encoded(candidate[2])
    assert verified["code"] == candidate[0]
    result = subprocess.run(
        [sys.executable, str(trial.ROOT / "scripts/prepare_mint_fpga_trial.py"),
         "--verify", str(saved)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == verified["evidence"]
    (saved / "candidate.bin").write_bytes(b"")
    assert verified["image"] == trial.encoded(candidate[2])  # no later reread


@pytest.mark.parametrize("filename", [
    "saved-design.json", "native-code.json", "candidate.bin", "evidence.json",
])
def test_missing_saved_file(saved, filename):
    (saved / filename).unlink()
    with pytest.raises(ValueError, match="Saved Mint trial rejected"):
        trial.verify_saved_candidate(saved)


@pytest.mark.parametrize("length", [0, 1, trial.WORDS * 4 - 1, trial.WORDS * 4 - 4,
                                    trial.WORDS * 4 + 4])
def test_binary_length(saved, length):
    path = saved / "candidate.bin"
    path.write_bytes((path.read_bytes() + b"\0" * 4)[:length])
    with pytest.raises(ValueError, match="exactly"):
        trial.verify_saved_candidate(saved)


@pytest.mark.parametrize("field", ["imageSha256", "designSha256", "nativeCodeSha256",
                                  "status", "checks", "notEstablished", "format"])
def test_altered_evidence(saved, field):
    edit_json(saved / "evidence.json", lambda data: data.update({field: "altered"}))
    with pytest.raises(ValueError, match="evidence"):
        trial.verify_saved_candidate(saved)


@pytest.mark.parametrize("filename,change", [
    ("saved-design.json", lambda d: d.update(installationAllowed=0)),
    ("saved-design.json", lambda d: d["bindings"]["ide.Mint"].update(slot=10)),
    ("native-code.json", lambda d: d["mint"].update(source=d["mint"]["source"] + "\n")),
    ("native-code.json", lambda d: d["mint"]["code"].__setitem__(1, 0)),
    ("native-code.json", lambda d: d["mint"]["capabilities"][0].update(extra="altered")),
    ("native-code.json", lambda d: d["mint"]["capabilities"][0].update(rights=["R"])),
])
def test_altered_saved_metadata(saved, filename, change):
    edit_json(saved / filename, change)
    with pytest.raises(ValueError):
        trial.verify_saved_candidate(saved)


def test_rehashed_declaration_metadata_still_rejected(saved):
    edit_json(saved / "native-code.json",
              lambda d: d["mint"]["capabilities"][0].update(extra="altered"))
    code = json.loads((saved / "native-code.json").read_text())
    edit_json(saved / "evidence.json",
              lambda d: d.update(nativeCodeSha256=trial.sha(trial.canonical(code))))
    with pytest.raises(ValueError, match="declarations"):
        trial.verify_saved_candidate(saved)


@pytest.mark.parametrize("filename", ["saved-design.json", "native-code.json",
                                     "candidate.bin", "evidence.json"])
def test_mixed_generation_files(saved, candidate, monkeypatch, tmp_path, filename):
    # A separately constructed later review cut has different source, native
    # words and evidence. Mixing any one old file into it must fail closed.
    code = copy.deepcopy(candidate[0])
    code["mint"]["source"] += "\n"
    code["mint"]["code"][1] ^= 1
    pins = dict(trial.PINS)
    pins["mint"] = (trial.sha(code["mint"]["source"].encode()),
                    trial.sha(trial.encoded(code["mint"]["code"])))
    monkeypatch.setattr(trial, "PINS", pins)
    monkeypatch.setattr(trial, "native_code", lambda: copy.deepcopy(code))
    design, words = construct(code)
    later = tmp_path / "later"
    later.mkdir()
    for name, data in [("saved-design", design), ("native-code", code),
                       ("evidence", validate(design, words, code))]:
        (later / f"{name}.json").write_text(json.dumps(data))
    (later / "candidate.bin").write_bytes(trial.encoded(words))
    assert trial.verify_saved_candidate(later)["image"] == trial.encoded(words)
    (later / filename).write_bytes((saved / filename).read_bytes())
    with pytest.raises(ValueError):
        trial.verify_saved_candidate(later)


@pytest.mark.parametrize("field", ["source", "code", "capabilities"])
def test_changed_current_compiler(saved, candidate, monkeypatch, field):
    current = copy.deepcopy(candidate[0])
    if field == "source":
        current["mint"][field] += "\n"
    elif field == "code":
        current["mint"][field][1] ^= 1
    else:
        current["mint"][field][0]["extra"] = True
    monkeypatch.setattr(trial, "native_code", lambda: current)
    with pytest.raises(ValueError):
        trial.verify_saved_candidate(saved)


@pytest.mark.parametrize("contents", ['{', '{"format":1,"format":2}', 'null', '[]'])
def test_malformed_saved_json(saved, contents):
    (saved / "native-code.json").write_text(contents)
    with pytest.raises(ValueError, match="Saved Mint trial rejected"):
        trial.verify_saved_candidate(saved)


def test_cli_rejection(saved):
    (saved / "candidate.bin").write_bytes(b"short")
    result = subprocess.run(
        [sys.executable, str(trial.ROOT / "scripts/prepare_mint_fpga_trial.py"),
         "--verify", str(saved)], capture_output=True, text=True)
    assert result.returncode != 0
    assert not result.stdout
    assert "Saved Mint trial rejected" in result.stderr
