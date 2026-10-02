"""Runner regression tests; these do not bless current implementation failures."""
import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from contracts import condition, judge, vectors


def test_literal_compact_vectors():
    cases = {v["id"]: v for v in vectors()}
    assert cases["load-index-0"]["word"] == 0x07108030
    assert cases["load-index-1"]["word"] & 0x7fff == 0x003b
    assert cases["load-index-2"]["word"] & 0x7fff == 0x403b
    assert [cases[f"load-index-{i}"]["index"] for i in range(3)] == [3, 8, 2]
    assert cases["save-index-7"]["index"] is None
    assert cases["save-index-8"]["index"] is None


def test_truth_table_independent_masks():
    # Bit f is set when the condition accepts NZCV=f (N least significant).
    masks = [0xcccc, 0x3333, 0xf0f0, 0x0f0f, 0xaaaa, 0x5555,
             0xff00, 0x00ff, 0x3030, 0xcfcf, 0xaa55, 0x55aa,
             0x2211, 0xddee, 0xffff, 0]
    assert [sum(int(condition(c, f)) << f for f in range(16))
            for c in range(16)] == masks


def observation(v):
    state = dict(dr=v["dr"].copy(), flags=v["flags"], pc_word=0,
                 cr=[[0, 0, 0] for _ in range(16)], m=0)
    state["cr"][14] = [0x5200001e, 4100, 3]
    return dict(initial=state, final=copy.deepcopy(state), index=v.get("index"),
                terminal="fault", data_reads=[], writes=[])


def test_index_mismatch_and_forbidden_effects_stay_failing():
    v = next(v for v in vectors() if v["id"] == "load-index-1")
    r = observation(v)
    assert judge(v, r) == []
    r["index"] = v["word"] & 0x7fff  # known hardware bug, not an expected value
    r["writes"] = [dict(word=8, value=123)]
    assert "compact effective index" in judge(v, r)
    assert "forbidden memory write" in judge(v, r)
    r["terminal"] = "timeout"
    assert "bounded completion" in judge(v, r)


def test_mcmp_equality_catches_wrong_operand_without_guessing_cv():
    v = next(v for v in vectors() if v["id"] == "mcmp-2")
    r = observation(v)
    r["terminal"] = "retire"
    r["final"]["pc_word"] = 1
    for cv in (0, 4, 8, 12):
        r["final"]["flags"] = cv | 2
        assert judge(v, r) == []
    r["final"]["flags"] = 0
    assert "MCMP two-register equality/Z" in judge(v, r)


def test_false_predicate_must_preserve_flags_and_destination():
    v = vectors()[0]
    r = observation(v)
    r["terminal"] = "retire"
    r["final"]["pc_word"] = 1
    assert judge(v, r) == []
    r["final"]["dr"][2] = 0
    r["final"]["flags"] = 2
    assert set(judge(v, r)) == {"DR result/preservation", "false predicate flag preservation"}