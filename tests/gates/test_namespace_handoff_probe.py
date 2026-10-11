"""Narrow Amaranth Namespace-root probe, NOT full core handoff certification.

See test_namespace_handoff_core.py for ordinary full-core instruction evidence
and its explicitly failing handoff gate. These unit successes do not waive it.

Two actual ChurchSwitch transactions share external register/memory models.
The second resolves a slot populated only under the root installed by the first.
Units here are bytes and ascending RTL descriptors, unlike the JS fixture's
word-addressed descending table. Geometry reconciliation remains a release gate.
"""
import pytest
from amaranth.sim import Simulator
from hardware.switch import ChurchSwitch
from hardware.hw_types import GT_TYPE_INFORM, PERM_MASK_L, make_gt
from hardware.integrity32 import integrity32


def cap(slot, location, limit):
    return (make_gt(gt_type=GT_TYPE_INFORM, perms=PERM_MASK_L, slot_id=slot)
            | (location << 32) | (limit << 64))


@pytest.mark.parametrize("selected_root", [0x2000, 0x3000])
def test_switch_lookup_follows_installed_root(selected_root):
    dut = ChurchSwitch()
    memory = {}
    # Two distinct roots with a different slot present in each.
    for root, slot, location, limit in [
        (0x2000, 1, 0x3000, 3),  # capability selecting the other Namespace
        (0x3000, 2, 0x5000, 7),  # destination-only object
    ]:
        addr = root + 16 * slot
        memory.update({addr: location, addr + 4: limit,
                       addr + 8: integrity32(location, limit), addr + 12: 0})
    memory[0x1000] = make_gt(gt_type=GT_TYPE_INFORM, perms=PERM_MASK_L, slot_id=1)
    memory[0x1004] = make_gt(gt_type=GT_TYPE_INFORM, perms=PERM_MASK_L, slot_id=2)
    crs = [0] * 16
    crs[6] = cap(3, 0x1000, 1)
    crs[15] = cap(0, 0x2000, 3)
    original = dict(memory)

    async def bench(ctx):
        async def transaction(target, row):
            pending = None
            reads, writes, consumes = [], [], []
            ctx.set(dut.cr_src, 6)
            ctx.set(dut.target, target)
            ctx.set(dut.target_m, 1)  # precondition; not regulator execution
            ctx.set(dut.index, row)
            ctx.set(dut.cr15_namespace.as_value(), crs[15])
            ctx.set(dut.cr_rd_data.as_value(), crs[6])
            ctx.set(dut.mem_rd_valid, 0)
            ctx.set(dut.switch_start, 1)
            await ctx.tick()
            ctx.set(dut.switch_start, 0)
            terminal = None
            for _ in range(160):
                ctx.set(dut.mem_rd_valid, pending is not None)
                ctx.set(dut.mem_rd_data, memory.get(pending, 0))
                await ctx.delay(1e-9)
                read = ctx.get(dut.mem_addr) if ctx.get(dut.mem_rd_en) else None
                write = ((ctx.get(dut.cr_wr_addr), ctx.get(dut.cr_wr_data.as_value()))
                         if ctx.get(dut.cr_wr_en) else None)
                if read is not None:
                    reads.append(read)
                if ctx.get(dut.m_consume_en):
                    consumes.append(ctx.get(dut.m_consume_target))
                assert not ctx.get(dut.thread_wr_en), "isolated reload must not save a Thread"
                if ctx.get(dut.switch_fault):
                    terminal = "fault"
                elif ctx.get(dut.switch_complete):
                    terminal = "complete"
                await ctx.tick()
                if write is not None:
                    writes.append(write)
                    crs[write[0]] = write[1]
                pending = read
                if terminal:
                    return terminal, reads, writes, consumes
            raise AssertionError("SWITCH did not terminate")

        if selected_root == 0x3000:
            result, reads, writes, consumes = await transaction(15, 0)
            assert result == "complete"
            assert writes and writes[-1][0] == 15
            assert (crs[15] >> 32) & 0xFFFFFFFF == 0x3000
            assert consumes == [3]
        result, reads, writes, consumes = await transaction(14, 1)
        assert selected_root + 0x20 in reads
        assert (0x3000 if selected_root == 0x2000 else 0x2000) + 0x20 not in reads
        if selected_root == 0x3000:
            assert result == "complete"
            assert (crs[14] >> 32) & 0xFFFFFFFF == 0x5000
            assert consumes == [2]
        else:
            assert result == "fault"
            assert not writes
            assert not consumes
        assert memory == original

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
