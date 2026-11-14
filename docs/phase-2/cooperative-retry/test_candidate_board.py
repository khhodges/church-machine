"""Local board elaboration only; no vendor tool or physical access."""
from amaranth.back import rtlil
from candidate_test_support import module
from test_candidate_core import prepared, _install_amaranth_elaboration_caches
from test_candidate_qualified_delivery import records
import pytest


@pytest.mark.parametrize("qualified", [False, True])
def test_candidate_board_has_real_clock_and_uart_without_feedback(qualified):
    words, binding = prepared()
    _install_amaranth_elaboration_caches()
    top = module("candidate_board").CandidateBoard(words, binding,
        delivery_records=records() if qualified else None)
    text = rtlil.convert(top, ports=top.ports())
    assert "MMCME2_BASE" in text
    assert "BUFGCE" in text
    assert "uart_rx_pin" in text and "uart_tx_pin" in text
    assert top.runtime.core.memory_bytes == 131072
