import importlib.util
import json
import subprocess
from pathlib import Path

spec = importlib.util.spec_from_file_location("isa_oracle", Path(__file__).with_name("oracle.py"))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)


def test_literal_words_and_ranges():
    rows = oracle.vectors()
    assert len({r["id"] for r in rows}) == len(rows)
    sample = next(r for r in rows if r["id"] == "LOAD-r11-plus-3-0")
    assert sample["word"] == 0x0713003b
    sample = next(r for r in rows if r["id"] == "SAVE-r11-minus-3-6")
    assert sample["word"] == 0x0f13403b
    assert sample["expected"]["index"] == 3
    assert next(r for r in rows if r["id"] == "LOAD-r11-plus-1-4294967295")["expected"]["arithmetic_fault"]
    assert next(r for r in rows if r["id"] == "LOAD-r0-minus-1-0")["expected"]["arithmetic_fault"]


def test_condition_truth_table_anchors():
    for flags in range(16):
        assert oracle.condition(14, flags)
        assert not oracle.condition(15, flags)
        for even in range(0, 14, 2):
            assert oracle.condition(even, flags) != oracle.condition(even+1, flags)
    assert oracle.condition(8, 4)
    assert not oracle.condition(8, 6)
    assert oracle.condition(10, 9)
    assert not oracle.condition(10, 1)


def test_mutated_results_cannot_pass():
    v = next(r for r in oracle.vectors() if r["kind"] == "mcmp")
    observed = dict(z=0, before=dict(dr=[0, 255, 7], pc=2),
                    after=dict(dr=[0, 255, 7], pc=3), retired=True, fault=None, writes=[])
    assert not oracle.judge(v, observed)
    for key, value in [("z", 1), ("retired", False), ("fault", 9), ("writes", [1]),
                       ("reads", [1]), ("retire_word", 0)]:
        assert oracle.judge(v, {**observed, key: value})
    assert oracle.judge(v, {**observed, "after": dict(dr=[0, 255, 8], pc=3)})
    assert oracle.judge(v, {**observed, "after": dict(dr=[0, 255, 7], pc=3, cr=[1])})
    index = oracle.vectors()[0]
    assert oracle.judge(index, dict(index=48, arithmetic_fault=False))
    assert oracle.judge(index, dict(index=None, arithmetic_fault=True))


def test_real_step_fixture_detects_load_and_contains_overflow():
    rows = oracle.vectors()
    selected = [next(r for r in rows if r["id"] == name) for name in
                ("LOAD-r11-minus-3-6", "LOAD-r11-plus-1-4294967295")]
    report = json.loads(subprocess.check_output(
        ["node", str(Path(__file__).with_name("simulator.cjs"))],
        input=json.dumps(selected), text=True, timeout=60))
    valid, invalid = report["vectors"]
    assert valid["before"]["cr"][2]["word0"] == 0
    assert valid["after"]["cr"][2]["word0"] == valid["gt"]
    assert valid["retired"] and not valid["fault"]
    assert invalid["fault"] == "BOUNDS"
    assert invalid["reads"] == []  # Code fetch is not an operand access.
    assert invalid["writes"] == []
    assert invalid["before"] == invalid["after"]