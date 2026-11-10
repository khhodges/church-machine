"""Preflight only: unchanged localized compiler words through retained ChurchCore.

Run with a fresh prepare_starter directory on PYTHONPATH. No UART, image
allowlist edit, debug register write or host-selected instruction continuation.
Reset-ROM instructions use the existing guarded boot harness convention.
This is NOT the combined-top adoption acceptance test.
"""
import json
from pathlib import Path
import subprocess

import pytest
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.test_phase2_guarded_llr import guarded_fixture, GUARD

HERE = Path(__file__).resolve().parent


@pytest.mark.parametrize("name,value", [("old", 17), ("new", 29)])
def test_exact_compiler_body_in_retained_core(name, value, record_property):
    inputs = json.loads(subprocess.check_output(
        ["node", str(HERE / "combined_inputs.js")], text=True))
    r = next(row for row in inputs["records"] if row["name"] == name)
    mem = guarded_fixture()
    # Test-only initial memory. SYSTEM performs its ordinary initial CHANGE;
    # USER's existing CALL uses the selected exact revision via its home CR2.
    for i, word in enumerate(r["words"]):
        mem[r["baseByte"] + i * 4] = word
    for i, word in enumerate(r["descriptor"]):
        mem[r["slot"] * 16 + i * 4] = word
    mem[0x3000 + (244 + 2) * 4] = r["gt"]
    core = ChurchCore(expected_boot_guard=GUARD, watchdog_clock_hz=1000000)
    sim = Simulator(core)
    sim.add_clock(1e-6)

    async def bench(ctx):
        async def tick():
            addr = ctx.get(core.dmem_addr)
            read = ctx.get(core.dmem_rd_en)
            data = mem.get(addr, 0)
            if ctx.get(core.dmem_wr_en):
                mem[addr] = ctx.get(core.dmem_wr_data)
            assert not ctx.get(core.ns_wr_en)
            assert not ctx.get(core.clist_wr_en)
            await ctx.tick()
            ctx.set(core.dmem_rd_valid, read)
            ctx.set(core.dmem_rd_data, data)
            assert not ctx.get(core.fault_valid), (
                f"fault={ctx.get(core.fault):#x} nia={ctx.get(core.imem_addr):#x}")

        async def issue(rom=None, done=None):
            address = ctx.get(core.imem_addr)
            ctx.set(core.imem_from_reset_rom, rom is not None)
            ctx.set(core.imem_fetch_address, address)
            ctx.set(core.imem_data, mem.get(address, 0) if rom is None else rom)
            ctx.set(core.imem_valid, 1)
            for _ in range(3000):
                retired = ctx.get(core.retire_valid)
                finished = done() if done else retired
                await tick()
                ctx.set(core.imem_valid, 0)
                if finished:
                    for _ in range(3):
                        await tick()
                    return
            pytest.fail(f"instruction did not finish at {address:#x}")

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
        for _ in range(12):
            if ctx.get(core.imem_addr) == 0x400C:
                break
            await issue()
        assert ctx.get(core.imem_addr) == 0x400C, 'normal RETURN to original caller'
        assert ctx.get(core.debug_dr_words[1]) == value
        assert [mem[r["baseByte"] + i * 4] for i in range(r["sizeWords"])] == r["words"]
        record_property("compiler_input_sha256_le", r["localizedSha256LE"])
        record_property("scope", "retained-core compiler-body preflight only")

    sim.add_testbench(bench)
    sim.run()
