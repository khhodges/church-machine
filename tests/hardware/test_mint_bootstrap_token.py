"""Source-wiring regressions for the dormant bootstrap Mint in both profiles.

Evaluate the actual source GT expressions, not a duplicate encoder. These tests
do not claim full-core execution, RAM arbitration, or reset/drain coverage.
"""

import ast
from pathlib import Path

import pytest


CORE = Path(__file__).resolve().parents[2] / "hardware" / "core.py"
TREE = ast.parse(CORE.read_text())


def eq_calls(tree, signal):
    return [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "eq"
        and ast.unparse(node.func.value) == signal
    ]


def state_blocks(name):
    return [
        node for node in ast.walk(TREE)
        if isinstance(node, ast.With)
        and any(
            isinstance(item.context_expr, ast.Call)
            and ast.unparse(item.context_expr.func) == "m.State"
            and item.context_expr.args
            and isinstance(item.context_expr.args[0], ast.Constant)
            and item.context_expr.args[0].value == name
            for item in node.items
        )
    ]


def test_both_profiles_write_full_result_gt_to_w3():
    blocks = state_blocks("MINT_WRITE_NS3")
    assert len(blocks) == 2
    for block in blocks:
        writes = eq_calls(block, "mint_ns_wr_data")
        assert len(writes) == 1
        assert ast.unparse(writes[0].args[0]) == "mint_e_gt_d"
        assert ast.unparse(eq_calls(block, "mint_ns_wr_en")[0].args[0]) == "1"
        address = eq_calls(block, "mint_ns_addr")[0].args[0]
        assert isinstance(address, ast.BinOp) and isinstance(address.op, ast.Add)
        assert isinstance(address.right, ast.Constant) and address.right.value == 12


@pytest.mark.parametrize("slot", [0, 1, 10, 255, 65535])
def test_full_church_inform_e_gt_in_both_profiles(slot):
    expressions = eq_calls(TREE, "mint_e_gt_d")
    assert len(expressions) == 2
    # Independent bit-layout expectation: E=bit30, Church=bit27,
    # Inform=bit25, bootstrap generation=1 at bit16, 16-bit slot.
    expected = 0x4A010000 | slot
    from hardware.hw_types import GT_DOM_BIT, GT_TYPE_INFORM
    for assignment in expressions:
        expression = ast.Expression(body=assignment.args[0])
        actual = eval(compile(expression, str(CORE), "eval"), {"__builtins__": {}}, {
            "GT_DOM_BIT": GT_DOM_BIT,
            "GT_TYPE_INFORM": GT_TYPE_INFORM,
            "mint_slot_id_reg": slot,
        })
        assert actual == expected


def test_caller_publication_uses_same_gt():
    blocks = state_blocks("MINT_WRITE_CLIST")
    assert len(blocks) == 2
    for block in blocks:
        writes = eq_calls(block, "mint_clist_wr_data_d")
        assert len(writes) == 1
        assert ast.unparse(writes[0].args[0]) == "mint_e_gt_d"
