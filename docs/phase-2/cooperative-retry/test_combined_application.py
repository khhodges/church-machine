"""Cheap application/control preflight, NOT UART/SHA/full-top acceptance.

The real core executes exact prepared images. A read-only test peripheral
supplies the already compiled bodies at their declared interface. No registers,
PC, descriptors or continuations are changed by the test driver after boot.
"""
import pytest
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.test_phase2_guarded_llr import GUARD
from prepare_combined_review import build
import struct


@pytest.mark.parametrize("sizes", [(64, 256), (256, 64)])
def test_authored_application_selects_old_new_old_without_host_entry_changes(sizes):
    # Shrink is an application preflight, NOT an additional approved whole image.
    inputs, images = build(*sizes)
    words = struct.unpack("<16384I", images["user-b"]["bytes"])
    mem = dict(enumerate(words))
    old, old_caller, new, new_caller = inputs["records"]
    core = ChurchCore(expected_boot_guard=GUARD, watchdog_clock_hz=20000)
    sim = Simulator(core)
    sim.add_clock(1e-6)

    async def bench(ctx):
        selector, index, status = 0, 0, 4
        results = []
        saw_handoff = False
        old_snapshot = None
        thread_snapshot = None
        retired_last = False
        issued = []

        async def tick():
            nonlocal selector, index, status, saw_handoff, old_snapshot, thread_snapshot, retired_last
            addr = ctx.get(core.dmem_addr)
            read = ctx.get(core.dmem_rd_en)
            data = mem.get(addr // 4, 0)
            if read:
                if addr == 0x4000001c:
                    r = old if selector == 0 else new
                    assert status in (4, 5) and index < len(r["words"])
                    data = r["words"][index]
                    index += 1
                    status = 5
                elif addr == 0x40000020:
                    data = status
                elif addr == 0x40000024:
                    data = selector
                elif addr == 0x40000028:
                    data = selector + 1
            if ctx.get(core.dmem_wr_en):
                value = ctx.get(core.dmem_wr_data)
                if addr == 0x40000028:
                    assert value == selector + 1
                    r = old if selector == 0 else new
                    assert index == len(r["words"])
                    assert [mem[r["baseByte"] // 4 + i] for i in range(r["sizeWords"])] == r["words"]
                    assert [mem[r["slot"] * 4 + i] for i in range(4)] == r["descriptor"]
                    if selector:
                        assert [mem[old["baseByte"] // 4 + i] for i in range(old["sizeWords"])] == old_snapshot
                        assert [mem[0x3000 // 4 + i] for i in range(256)] == thread_snapshot
                    status = 6
                else:
                    assert addr < 65536
                    mem[addr // 4] = value
            if ctx.get(core.llr_complete):
                saw_handoff = True
            if ctx.get(core.retire_valid) and not retired_last:
                nia = ctx.get(core.retire_nia)
                if nia == old["baseByte"] + 12 and selector == 0:
                    assert status == 6 and saw_handoff
                    selector, index, status = 1, 0, 4
                    old_snapshot = [mem[old["baseByte"] // 4 + i] for i in range(old["sizeWords"])]
                    thread_snapshot = [mem[0x3000 // 4 + i] for i in range(256)]
            retired_last = bool(ctx.get(core.retire_valid))
            assert not ctx.get(core.ns_wr_en)
            assert not ctx.get(core.clist_wr_en)
            await ctx.tick()
            ctx.set(core.dmem_rd_valid, read)
            ctx.set(core.dmem_rd_data, data)
            assert not ctx.get(core.fault_valid), (
                f"fault={ctx.get(core.fault):#x} nia={ctx.get(core.imem_addr):#x}"
                f" selector={selector} word={index} results={results}")

        async def issue(rom=None, finish=None):
            address = ctx.get(core.imem_addr)
            instruction = rom if rom is not None else mem[address // 4]
            caller_result = ctx.get(core.debug_dr_words[10]) if address in (
                old_caller["baseByte"] + 20, new_caller["baseByte"] + 20) else None
            issued.append((hex(address), hex(instruction)))
            ctx.set(core.imem_from_reset_rom, rom is not None)
            ctx.set(core.imem_fetch_address, address)
            ctx.set(core.imem_data, rom if rom is not None else mem[address // 4])
            ctx.set(core.imem_valid, 1)
            for _ in range(3000):
                done = finish() if finish else ctx.get(core.retire_valid)
                await tick()
                ctx.set(core.imem_valid, 0)
                if done:
                    if caller_result is not None:
                        results.append(caller_result)
                    # RETURN's NIA pulse precedes its ordinary CR6 cLoad.
                    # Give the read bus time to finish that reconstruction
                    # before sending another one-cycle instruction pulse.
                    for _ in range(200 if instruction >> 27 == 3 else 3):
                        await tick()
                    return
            pytest.fail(f"instruction did not terminate at {address:#x}; "
                        f"now={ctx.get(core.imem_addr):#x} history={issued[-18:]}")

        ctx.set(core.defer_fault_reset, 1)
        ctx.set(core.boot_start, 1)
        await tick()
        ctx.set(core.boot_start, 0)
        for _ in range(3000):
            if ctx.get(core.boot_thread_validated):
                break
            await tick()
        assert ctx.get(core.boot_thread_validated)
        await issue(0x27000001, lambda: ctx.get(core.boot_thread_activated))
        await issue(0x17000001, lambda: ctx.get(core.boot_complete))
        for _ in range(5000):
            # The original CALL hands off without retiring. Its completion
            # boundary here is the core's actual LLR completion, not a new PC.
            await issue(finish=lambda: ctx.get(core.retire_valid) | ctx.get(core.llr_complete))
            if len(results) == 3:
                break
        assert results == [17, 29, 17]

    sim.add_testbench(bench)
    sim.run()
