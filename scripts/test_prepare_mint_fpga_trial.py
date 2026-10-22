import copy

import pytest

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
