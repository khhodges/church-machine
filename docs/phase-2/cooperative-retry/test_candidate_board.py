"""Local board elaboration only; no vendor tool or physical access."""
from amaranth.back import rtlil
from candidate_test_support import module
from test_candidate_core import prepared, _install_amaranth_elaboration_caches


def test_candidate_board_has_real_clock_and_uart_without_feedback():
    words, binding = prepared()
    _install_amaranth_elaboration_caches()
    top = module("candidate_board").CandidateBoard(words, binding)
    text = rtlil.convert(top, ports=top.ports())
    assert "MMCME2_BASE" in text
    assert "BUFGCE" in text
    assert "uart_rx_pin" in text and "uart_tx_pin" in text
    assert top.runtime.core.memory_bytes == 131072
