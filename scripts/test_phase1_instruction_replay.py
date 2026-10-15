"""Guard fixture reuse and fail-closed generated-Verilog comparison."""
import subprocess
import sys
import pytest
from amaranth import Elaboratable, Module, Signal
from scripts.replay_phase1_instruction_rtl import cases
from scripts.check_corrected_generated_rtl import Recorder


def test_matrix_reuses_all_operand_cases_and_selected_independent_cases():
    matrix = cases()
    assert len(matrix) == 42
    assert sum(item[0] == "operands" for item in matrix) == 35
    assert sum(item[1] == "test_false_condition_has_no_core_effect"
               for item in matrix) == 4
    assert len({(suite, name, repr(parameters))
                for suite, name, parameters in matrix}) == len(matrix)


def test_release_cache_setup_is_idempotent_in_fresh_process():
    # Do not leak global Amaranth patches into other pytest fixtures.
    subprocess.run([sys.executable, "-c", """
from amaranth import Signal
from amaranth.hdl._ast import Operator
from hardware.gen_rtlil import install_elaboration_caches
install_elaboration_caches()
first = Operator.shape
install_elaboration_caches()
assert Operator.shape is first
assert (Signal(32) + Signal(32)).shape().width == 33
"""], check=True, timeout=30)


class Wire(Elaboratable):
    def __init__(self):
        self.input = Signal(4, name="stimulus")
        self.output = Signal(4)

    def elaborate(self, platform):
        m = Module()
        m.d.comb += self.output.eq(self.input)
        return m


@pytest.mark.parametrize("corrupt", [False, True])
@pytest.mark.parametrize("sliced", [False, True])
def test_combinational_replay_detects_mismatch(corrupt, sliced):
    dut = Wire()
    recorder = Recorder(dut)
    recorder.release_converter = True

    async def bench(ctx):
        if sliced:
            ctx.set(dut.input, 15)
            ctx.set(dut.input[3], 0)
            ctx.set(dut.input[:2], 0)
            ctx.set(dut.input[:2], 3)
        else:
            ctx.set(dut.input, 7)
        assert ctx.get(dut.output) == 7
        if corrupt:
            # Corrupt the recorded expectation, not the DUT. Icarus must reject.
            kind, index, _ = recorder.events[-1]
            recorder.events[-1] = (kind, index, 6)

    recorder.add_testbench(bench)
    if corrupt:
        with pytest.raises(RuntimeError, match="expected 6"):
            recorder.run()
    else:
        recorder.run()
