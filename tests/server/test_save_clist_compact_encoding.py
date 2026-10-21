"""Exercise the production save guard without publishing any user artifacts."""
from pathlib import Path
import pytest


SOURCE = (Path(__file__).resolve().parents[2] / "server" / "app.py").read_text()
START = SOURCE.index("    _CLIST_SAVE_OPS = ")
END = SOURCE.index("\n    _bootstrap_binding = ", START)
from unittest.mock import Mock
SCOPE = {"logging": Mock()}
exec("def check(hdr, words):\n" + SOURCE[START:END] + "\n    return None\n", SCOPE)
check = SCOPE["check"]


def validate(op, row=1, dr=0, subtract=False, cr=6, cc=11):
    SCOPE["logging"].reset_mock()
    instruction = (op << 27) | (cr << 15) | (row << 4) | dr
    if subtract:
        instruction |= 0x4000
    header = (31 << 27) | (2 << 10) | cc
    return check(header, [header, 0xB8000001, instruction])


@pytest.mark.parametrize("op", [0, 1])
@pytest.mark.parametrize("row", [0, 1, 10])
def test_valid_compact_rows(op, row):
    assert validate(op, row) is None


@pytest.mark.parametrize("op", [0, 1])
@pytest.mark.parametrize("row", [11, 16, 1023])
def test_out_of_range_rows_are_advisory_and_keep_runtime_fault(op, row):
    assert validate(op, row) is None
    args = SCOPE["logging"].warning.call_args.args
    assert args[1:] == (2, row, 11)


@pytest.mark.parametrize("op", [0, 1])
@pytest.mark.parametrize("dr", range(1, 16))
def test_runtime_register_index_is_not_a_static_row(op, dr):
    assert validate(op, 1023, dr=dr) is None


@pytest.mark.parametrize("op", [0, 1])
def test_subtraction_requires_runtime_validation(op):
    assert validate(op, 1023, subtract=True) is None


def test_other_register_and_ambient_clist_are_not_local_rows():
    assert validate(0, 1023, cr=5) is None
    assert validate(0, 1023, cc=0) is None


def test_legacy_fused_call_method_bits_are_not_row_bits():
    header = (31 << 27) | (1 << 10) | 11
    for row in (1, 10, 11):
        result = check(header, [header, (8 << 27) | (6 << 15) | (5 << 5) | row])
        assert result is None