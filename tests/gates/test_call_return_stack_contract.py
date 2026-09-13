"""Structural gates for the hardware CALL/RETURN stack contract."""

from pathlib import Path


def test_call_latches_root_request_and_poison_frame():
    source = Path("hardware/call.py").read_text()
    assert "root_frame_latched = Signal()" in source
    assert "root_frame_latched.eq(self.boot_window)" in source
    assert "Const(0x7FFF, 15)" in source
    assert "Mux(root_frame_latched, callee_egt_latched" in source
    assert source.index('with m.State("STACK_WRITE_EGT")') < source.index(
        'with m.State("STACK_WRITE_FRAME")')
    assert source.index('with m.State("STACK_WRITE_FRAME")') < source.index(
        'with m.State("STACK_WRITE_SP")')


def test_return_validates_before_pop_and_handles_root_marker():
    source = Path("hardware/ret.py").read_text()
    assert "self.thread_hdr = Signal(32)" in source
    assert 'with m.State("VALIDATE_FRAME")' in source
    assert "companion_valid" in source
    assert 'with m.State("VALIDATE_COMPANION")' in source
    assert "self.mload_direct.eq(1)" in source
    assert "self.mload_validate_only.eq(1)" in source
    assert "GT_TYPE_ABSTRACT" not in source[source.index("companion_valid"):source.index("companion_valid") + 350]
    assert "FaultType.STACK_UNDERFLOW" in source
    assert "return_pc_latched == 0x7FFF" in source
    assert source.index('with m.State("VALIDATE_FRAME")') < source.index(
        'with m.State("POP_STACK")')


def test_change_requires_canonical_dormant_two_word_frame():
    source = Path("hardware/change.py").read_text()
    assert "incoming_indicator[:12] + 2" in source


def test_eloadcall_saves_prephase1_caller_identity_and_pc():
    source = Path("hardware/fused_unit.py").read_text()
    assert "self.caller_pc = Signal(15)" in source
    assert 'with m.State("READ_CALLER_CR6")' in source
    assert "caller_egt_latched.eq(caller_egt_norm)" in source
    assert "(caller_pc_latched + 1)[:15]" in source
    assert "local_mem_wr_data.eq(caller_egt_latched)" in source