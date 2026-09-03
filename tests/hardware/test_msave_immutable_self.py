"""Hardware regression: SAVE may never overwrite c-list row 0."""

from amaranth.sim import Simulator

from hardware.hw_types import FaultType
from hardware.msave import ChurchMSave
from hardware.save import ChurchSave


def _run_msave(index, immutable_row0=False):
    dut = ChurchMSave()
    observed = {"writes": [], "fault": None}

    async def testbench(ctx):
        ctx.set(dut.sub_start, 1)
        ctx.set(dut.sub_index, index)
        ctx.set(dut.sub_immutable_row0, immutable_row0)
        await ctx.tick()
        ctx.set(dut.sub_start, 0)

        for _ in range(8):
            observed["writes"].append(ctx.get(dut.mem_wr_en))
            if ctx.get(dut.sub_fault):
                observed["fault"] = ctx.get(dut.sub_fault_type)
                return
            await ctx.tick()

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    sim.run()
    return observed


def test_msave_cr6_row_zero_faults_before_any_memory_or_permission_path():
    """CR6's row-0 selector faults before any memory or permission path."""
    result = _run_msave(0, immutable_row0=True)

    assert result["fault"] == int(FaultType.IMMUTABLE_SELF_CAP)
    assert not any(result["writes"])


def test_msave_latches_immutable_selector_with_transaction():
    """A live selector change after start cannot bypass the row-0 barrier."""
    dut = ChurchMSave()
    observed = {"writes": [], "fault": None}

    async def testbench(ctx):
        ctx.set(dut.sub_start, 1)
        ctx.set(dut.sub_index, 0)
        ctx.set(dut.sub_immutable_row0, 1)
        await ctx.tick()
        ctx.set(dut.sub_start, 0)
        ctx.set(dut.sub_immutable_row0, 0)

        for _ in range(8):
            observed["writes"].append(ctx.get(dut.mem_wr_en))
            if ctx.get(dut.sub_fault):
                observed["fault"] = ctx.get(dut.sub_fault_type)
                return
            await ctx.tick()

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    sim.run()

    assert observed["fault"] == int(FaultType.IMMUTABLE_SELF_CAP)
    assert not any(observed["writes"])


def test_msave_nonzero_cr6_row_retains_existing_permission_fault_path():
    """The CR6 guard must not block ordinary nonzero c-list writes."""
    result = _run_msave(1, immutable_row0=True)

    # Default operands lack B, so row 1 reaches the existing BIND gate.
    assert result["fault"] == int(FaultType.BIND)
    assert not any(result["writes"])


def test_save_instruction_wrapper_propagates_immutable_row_zero_fault():
    """The accepted CR6 SAVE is protected if decoder inputs advance mid-flight."""
    dut = ChurchSave()
    observed = {"fault": None, "writes": []}

    async def testbench(ctx):
        # The wrapper will read these as null capabilities; index zero must still
        # produce IMMUTABLE_SELF_CAP before operand-dependent fault paths.
        ctx.set(dut.save_start, 1)
        ctx.set(dut.cr_src, 6)
        ctx.set(dut.cr_dst, 1)
        ctx.set(dut.index, 0)
        ctx.set(dut.cr_rd_data.as_value(), 0)
        await ctx.tick()
        ctx.set(dut.save_start, 0)
        # A decoder may present its next instruction while this SAVE is
        # multi-cycle. The CR6 classification must remain bound to the
        # accepted instruction, not this later destination register.
        ctx.set(dut.cr_src, 5)

        for _ in range(14):
            observed["writes"].append(ctx.get(dut.mem_wr_en))
            if ctx.get(dut.save_fault):
                observed["fault"] = ctx.get(dut.fault_type)
                return
            await ctx.tick()

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    sim.run()

    assert observed["fault"] == int(FaultType.IMMUTABLE_SELF_CAP)
    assert not any(observed["writes"])


def test_save_non_cr6_row_zero_retains_existing_bind_fault():
    """Non-CR6 architectural row 0 must not be captured by the CR6-only rule."""
    dut = ChurchSave()
    observed = {"fault": None, "writes": []}

    async def testbench(ctx):
        ctx.set(dut.save_start, 1)
        ctx.set(dut.cr_src, 5)
        ctx.set(dut.cr_dst, 1)
        ctx.set(dut.index, 0)
        ctx.set(dut.cr_rd_data.as_value(), 0)
        await ctx.tick()
        ctx.set(dut.save_start, 0)

        for _ in range(14):
            observed["writes"].append(ctx.get(dut.mem_wr_en))
            if ctx.get(dut.save_fault):
                observed["fault"] = ctx.get(dut.fault_type)
                return
            await ctx.tick()

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    sim.run()

    assert observed["fault"] == int(FaultType.BIND)
    assert not any(observed["writes"])