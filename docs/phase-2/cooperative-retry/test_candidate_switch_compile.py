import pytest
from candidate_test_support import module


def compile_switch(instruction, candidate):
    return module("amoeba_fixture").run_compile(dict(
        source=f"""abstraction candidate.SwitchProbe {{
        capabilities {{ SELF E, candidate.NamespaceLinks L }}
        method Run() {{
            {instruction}
            RETURN
        }}
    }}""", language="assembly", tier=0,
        _candidate_namespace_handoff=candidate))


def switches(result):
    words = result["words"]
    return [word for word in words[1:((words[0] >> 10) & 8191)+1] if word >> 27 == 5]


def test_candidate_compiles_required_zero_target_without_word_translation():
    r = compile_switch("SWITCH CR6, #1", True)
    assert r["ok"], r
    assert switches(r) == [0x2f030001]
    # Opt-in must not leak into later workers or reinterpret historical source.
    legacy = compile_switch("SWITCH CR15, CR6, #1", False)
    assert legacy["ok"], legacy
    assert switches(legacy) == [0x2f7b0001]
    assert not compile_switch("SWITCH CR6, #1", False)["ok"]


@pytest.mark.parametrize("instruction", [
    "SWITCH CR15, CR6, #1", "SWITCH CR6, #32768", "SWITCH CR6, #-1"])
def test_candidate_rejects_old_form_and_truncated_indices(instruction):
    assert not compile_switch(instruction, True)["ok"]
