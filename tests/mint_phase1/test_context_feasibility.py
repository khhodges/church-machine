"""Isolated same-byte JS / Amaranth component probes, NOT a Mint implementation.

Only test-owned RAM/registers are used. mLoad responses in the component benches
are explicit stubs: this does not prove NS validation, cLoad, core integration,
legal capability provisioning, generated RTL, or physical-board behavior.
"""
import json
from pathlib import Path
import subprocess

import pytest
from amaranth.sim import Simulator
from amaranth import Elaboratable, Module, Signal

from hardware.call import ChurchCall
from hardware.decoder import ChurchDecoder
from hardware.dread import ChurchDRead
from hardware.hw_types import FaultType
from hardware.lambda_unit import ChurchLambda
from hardware.ret import ChurchReturn
from hardware.thread_design import thread_layout

HERE = Path(__file__).resolve().parent
V = json.loads((HERE / "context-vectors.json").read_text())
N = lambda value: int(value, 0) if isinstance(value, str) else value
BASE = 0x4000
CODE = 0x8000


def cap(gt, location=0, limit=0):
    return N(gt) | (location << 32) | (limit << 64)


def simulate(dut, bench):
    sim = Simulator(dut)
    sim.add_clock(1e-6, if_exists=True)
    sim.add_testbench(bench)
    sim.run()


@pytest.fixture(scope="module")
def js():
    output = subprocess.check_output(
        ["node", str(HERE / "context_probe.js")], text=True, cwd=HERE.parents[1],
        timeout=30,
    )
    return json.loads(output)


def test_shared_instruction_bytes_decode():
    dut = ChurchDecoder()

    async def bench(ctx):
        ctx.set(dut.instr_valid, 1)
        for word, opcode, dst in [
            (V["call_word"], 2, 0), (V["lambda_word"], 7, 9),
            *[(word, 3, 0) for word in V["return_words"]],
        ]:
            ctx.set(dut.instruction, N(word))
            assert ctx.get(dut.church_op) == opcode
            assert ctx.get(dut.cr_dst) == dst
            if opcode == 3:
                assert ctx.get(dut.return_mask) == N(word) & 0xfff

    simulate(dut, bench)


def run_call(caller, callee, pc, sto):
    dut = ChurchCall()
    regs = {
        0: cap(callee, CODE, 63),
        6: cap((N(caller) & ~0x70000000) | 0x10000000, CODE + 252, 0),
        14: cap((N(caller) & ~0x78000000) | 0x40000000, CODE, 7),
    }
    memory = {CODE: N(V["code_header"]), BASE + 68: 0x1000 | sto}
    writes = []

    async def bench(ctx):
        ctx.set(dut.cr_src, 0)
        ctx.set(dut.thread_base, BASE)
        ctx.set(dut.thread_hdr, N(V["thread_header"]))
        ctx.set(dut.cr12_thread.as_value(), cap(0x02000001, BASE, 255))
        ctx.set(dut.cr5_heap.as_value(), cap(0x32000001, BASE + 72, 193))
        ctx.set(dut.caller_pc, pc)
        ctx.set(dut.call_start, 1)
        await ctx.tick()
        ctx.set(dut.call_start, 0)
        pending = None
        mload_pending = False
        for _ in range(150):
            ctx.set(dut.cr_rd_data.as_value(), regs.get(ctx.get(dut.cr_rd_addr), 0))
            ctx.set(dut.cr14_code.as_value(), regs[14])
            ctx.set(dut.mload_done, mload_pending)
            mload_pending = bool(ctx.get(dut.mload_start))
            if mload_pending:
                dst = ctx.get(dut.mload_cr_dst)
                regs[dst] = cap(
                    callee if dst == 6 else (N(callee) & ~0x78000000) | 0x40000000,
                    CODE, 63,
                )
            ctx.set(dut.mem_rd_valid, 0)
            if pending is not None:
                assert ctx.get(dut.mem_rd_en)
                assert ctx.get(dut.mem_rd_addr) == pending
                ctx.set(dut.mem_rd_data, memory[pending])
                ctx.set(dut.mem_rd_valid, 1)
                pending = None
            elif ctx.get(dut.mem_rd_en):
                pending = ctx.get(dut.mem_rd_addr)
            if ctx.get(dut.cr_wr_en):
                regs[ctx.get(dut.cr_wr_addr)] = ctx.get(dut.cr_wr_data.as_value())
            if ctx.get(dut.mem_wr_en):
                address, data = ctx.get(dut.mem_wr_addr), ctx.get(dut.mem_wr_data)
                writes.append((address, data))
                memory[address] = data
            assert not ctx.get(dut.call_fault), ctx.get(dut.fault_type)
            if ctx.get(dut.call_normal_complete):
                return
            await ctx.tick()
        raise AssertionError("CALL timeout")

    simulate(dut, bench)
    return writes


def test_nested_caller_evidence_is_not_original_requester_api(js):
    outer = run_call(V["caller_e"], V["mint_e"], 1, 241)
    inner = run_call(V["mint_e"], V["verifier_e"], 2, 239)
    assert outer == [
        (BASE + 240 * 4, N(V["caller_e"])),
        (BASE + 241 * 4, N(V["outer_frame"])),
        (BASE + 68, 0x1000 | 239),
    ]
    assert inner == [
        (BASE + 238 * 4, N(V["mint_e"])),
        (BASE + 239 * 4, N(V["inner_frame"])),
        (BASE + 68, 0x1000 | 237),
    ]
    assert [outer[0][1], outer[1][1], inner[0][1], inner[1][1]] == js["nested"]


def run_return(case, *, leaf=False, mask=0):
    dut = ChurchReturn()
    memory = {BASE + 68: 0x1000 | 239,
              BASE + 240 * 4: N(case["companion"]),
              BASE + 241 * 4: N(case["frame"])}
    result = {"writes": [], "reads": [], "nia": [], "validation": []}

    async def bench(ctx):
        ctx.set(dut.thread_base, BASE)
        ctx.set(dut.thread_hdr, N(V["thread_header"]))
        ctx.set(dut.cr12_thread.as_value(), cap(0x02000001, BASE, 255))
        ctx.set(dut.cr5_heap.as_value(), cap(0x32000001, BASE + 72, 193))
        ctx.set(dut.cr14_code.as_value(), cap(V["caller_x"], CODE, 7))
        ctx.set(dut.lambda_active, leaf)
        ctx.set(dut.lambda_pc, 8)
        ctx.set(dut.return_mask, mask)
        ctx.set(dut.return_start, 1)
        await ctx.tick()
        ctx.set(dut.return_start, 0)
        ctx.set(dut.return_mask, mask ^ 0xfff)  # must use accepted mask
        pending = None
        mload_pending = False
        for _ in range(100):
            ctx.set(dut.mem_rd_valid, 0)
            ctx.set(dut.mload_done, mload_pending)
            ctx.set(dut.mload_fault, mload_pending and case["name"] == "stale")
            ctx.set(dut.mload_fault_type, int(FaultType.STACK_CORRUPT))
            mload_pending = bool(ctx.get(dut.mload_start))
            if mload_pending:
                assert ctx.get(dut.mload_validate_only)
                result["validation"].append(ctx.get(dut.mload_direct_gt))
            if pending is not None:
                assert ctx.get(dut.mem_rd_en)
                assert ctx.get(dut.mem_rd_addr) == pending
                ctx.set(dut.mem_rd_data, memory[pending])
                ctx.set(dut.mem_rd_valid, 1)
                pending = None
            elif ctx.get(dut.mem_rd_en):
                pending = ctx.get(dut.mem_rd_addr)
                result["reads"].append(pending)
            if ctx.get(dut.mem_wr_en):
                result["writes"].append((ctx.get(dut.mem_wr_addr), ctx.get(dut.mem_wr_data)))
            if ctx.get(dut.nia_set):
                result["nia"].append(ctx.get(dut.nia_value))
            if ctx.get(dut.fault_valid) or ctx.get(dut.complete):
                result["ok"] = not bool(ctx.get(dut.fault_valid))
                result["fault"] = ctx.get(dut.fault_type)
                result["mask"] = ctx.get(dut.return_mask_latched)
                result["cload_e"] = ctx.get(dut.cload_e_gt)
                return
            await ctx.tick()
        raise AssertionError("RETURN timeout")

    simulate(dut, bench)
    return result


@pytest.mark.parametrize("case", V["return_cases"], ids=lambda c: c["name"])
def test_same_protected_bytes_return_or_reject_without_host_stack(case, js):
    r = run_return(case)
    assert r["ok"] == case["ok"] == js["returns"][case["name"]]["ok"]
    if case["ok"]:
        assert r["writes"] == [(BASE + 68, 0x1000 | 241)]
        assert r["nia"] == [8]  # JS pc=2, RTL byte offset=8
        assert r["cload_e"] == N(V["caller_e"])
    else:
        assert r["writes"] == r["nia"] == []
    if case["name"] == "stale":
        assert r["validation"] == [N(case["companion"])]


@pytest.mark.parametrize("word", V["return_words"])
def test_return_mask_is_latched_not_a_capability_materializer(word, js):
    mask = N(word) & 0xfff
    r = run_return(V["return_cases"][0], mask=mask)
    assert r["ok"] and r["mask"] == mask
    assert js["masks"][str(mask)] == bool(mask & 2)
    # RTL register cleanup is a core/register-bank integration responsibility,
    # not implemented in this unit; no claim of integrated mask equivalence.


def test_lambda_entry_and_continuation_divergence_is_explicit(js):
    dut = ChurchLambda()
    jumps = []

    async def bench(ctx):
        ctx.set(dut.cr_target, 9)
        # Same artifact's full X descriptor. NOT a fabricated internal-label view.
        ctx.set(dut.cr_rd_data.as_value(), cap(V["caller_x"], 512 * 4, 63))
        ctx.set(dut.lambda_start, 1)
        await ctx.tick()
        ctx.set(dut.lambda_start, 0)
        for _ in range(20):
            assert not ctx.get(dut.lambda_fault)
            if ctx.get(dut.nia_set):
                jumps.append(ctx.get(dut.nia_value))
            if ctx.get(dut.lambda_complete):
                return
            await ctx.tick()
        raise AssertionError("LAMBDA timeout")

    simulate(dut, bench)
    assert jumps == [512 * 4]  # descriptor base/header, not an internal label
    assert js["lambda"] == {"pc": 2, "sto": 240}  # inline + protected frame
    r = run_return(V["return_cases"][0], leaf=True, mask=2)
    assert r["ok"] and r["nia"] == [8]
    assert r["reads"] == r["writes"] == []  # RTL leaf latch, not a frame pop
    assert r["cload_e"] == N(V["caller_e"])


def test_stack_is_outside_declared_heap_not_a_service_read_grant():
    layout = thread_layout(256, 32)
    assert layout["valid"]
    assert layout["heap_start"] == 18 and layout["heap_end"] == 211
    assert layout["stack_start"] == 212 and layout["stack_end"] == 243
    assert 17 < layout["heap_start"] < layout["heap_end"] < 240
    # Geometry only. Does not certify protection against over-broad aliases,
    # prove a DREAD implementation's bounds, or grant a scanner access.


def test_thread_identity_is_not_read_authority(js):
    dut = ChurchDRead()
    reads = []
    faults = []

    async def bench(ctx):
        word = N(V["thread_read_word"])
        ctx.set(dut.cr_src, (word >> 15) & 15)
        ctx.set(dut.dr_dst, (word >> 19) & 15)
        ctx.set(dut.imm, word & 0x7fff)
        ctx.set(dut.cr_rd_data.as_value(), cap(0x02000001, BASE, 255))
        ctx.set(dut.start, 1)
        await ctx.tick()
        ctx.set(dut.start, 0)
        for _ in range(12):
            if ctx.get(dut.dmem_rd_en):
                reads.append(ctx.get(dut.dmem_addr))
            if ctx.get(dut.fault):
                faults.append(ctx.get(dut.fault_type))
                return
            await ctx.tick()
        raise AssertionError("DREAD did not reject permission-free Thread")

    simulate(dut, bench)
    assert reads == [] and faults == [int(FaultType.PERM_R)]
    assert js["threadReadFault"] == "PERMISSION"
    assert js["suspendedDependency"] == N(V["caller_e"])


class LambdaContinuationSlice(Elaboratable):
    """Exact relevant core.py latch wiring; not the full core/fetch pipeline."""
    def __init__(self):
        self.unit = ChurchLambda()
        self.nia = Signal(32, init=4)
        self.continuation = Signal(32)

    def elaborate(self, platform):
        m = Module()
        m.submodules.unit = u = self.unit
        m.d.comb += u.saved_nia.eq(self.nia + 4)
        with m.If(u.nia_set):
            m.d.sync += self.nia.eq(u.nia_value)
        with m.If(u.lambda_complete & ~u.lambda_fault):
            m.d.sync += self.continuation.eq(u.saved_nia)
        return m


def test_core_wiring_slice_captures_target_plus_four_not_acceptance_nia():
    dut = LambdaContinuationSlice()

    async def bench(ctx):
        u = dut.unit
        ctx.set(u.cr_rd_data.as_value(), cap(V["caller_x"], 512 * 4, 63))
        ctx.set(u.lambda_start, 1)
        await ctx.tick()
        ctx.set(u.lambda_start, 0)
        for _ in range(20):
            if ctx.get(u.lambda_complete):
                await ctx.tick()
                assert ctx.get(dut.continuation) == 512 * 4 + 4
                assert ctx.get(dut.continuation) != 8
                return
            await ctx.tick()
        raise AssertionError("Lambda wiring slice timeout")

    simulate(dut, bench)
