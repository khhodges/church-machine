"""Synthetic current-layout fixtures; never rewrite historical boot artifacts."""
import pytest
from amaranth.sim import Simulator
from hardware.boot_thread_validation import BootThreadValidation
from hardware.core import ChurchCore
from hardware.integrity32 import integrity32
from hardware.hw_types import FaultType


def image():
    words = [0] * 16384
    words[:4] = [0xf8810100, 0, 17, 0]
    for slot, base, limit in [(1, 0, 255), (2, 256, 255), (3, 512, 63)]:
        words[slot * 4:slot * 4 + 4] = [base, limit, integrity32(base, limit), 0]
    words[256] = 0xf900820c
    words[273] = 0x10f1
    words[498:501] = [0x4a000003, 0x0ffff0f3, 0x4a000003]
    words[512] = 0xf8000401
    return words


@pytest.mark.parametrize("case,expected,resume", [
    ("root", 0, False), ("suspended", 0, True), ("top_continuation", 0, True),
    ("bad_pointer", FaultType.STACK_CORRUPT, False),
    ("bad_link", FaultType.STACK_CORRUPT, False),
    ("bad_egt", FaultType.STACK_CORRUPT, False),
    ("reserved", FaultType.STACK_CORRUPT, False),
    ("bad_seal", FaultType.SEAL, False),
    ("stale_version", FaultType.VERSION, False),
])
def test_boot_validates_root_or_suspension(case, expected, resume):
    words = image()
    if case not in ("root", "top_continuation", "bad_seal", "stale_version"):
        words[273] = 0x10ef
        words[496:498] = [0x4a000003, 0x10f1]
        words[500] = 0  # CR0 need not equal the suspended executable.
    if case == "top_continuation":
        words[499] = 0x10f3
    if case == "bad_pointer":
        words[273] = 0x1001
    if case == "bad_link":
        words[497] ^= 1
    if case == "bad_egt":
        words[496] = 0
    if case == "reserved":
        words[273] |= 1 << 13
    if case == "bad_seal":
        words[10] ^= 1
    if case == "stale_version":
        words[9] |= 1 << 21
        words[10] = integrity32(words[8], words[9])
    dut = BootThreadValidation(expected_guard=0)
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(dut.namespace_slots, 64)
        ctx.set(dut.start, 1)
        await ctx.tick()
        ctx.set(dut.start, 0)
        for _ in range(150):
            if ctx.get(dut.fault) or ctx.get(dut.done):
                assert ctx.get(dut.fault_type) == expected
                assert bool(ctx.get(dut.done)) == (expected == 0)
                if not expected:
                    assert bool(ctx.get(dut.resume)) == resume
                return
            rd, address = ctx.get(dut.mem_en), ctx.get(dut.mem_addr)
            await ctx.tick()
            ctx.set(dut.mem_valid, rd)
            ctx.set(dut.mem_data, words[address // 4] if rd else 0)
        pytest.fail("validator timed out")
    sim.add_testbench(bench)
    sim.run()


def test_early_boot_fault_reports_once_and_rearms_on_each_retry():
    words = image()
    words[273] = 0  # invalid protected indicator: never suppress this check
    core = ChurchCore(expected_boot_guard=0)
    sim = Simulator(core)
    sim.add_clock(1e-6)

    async def bench(ctx):
        async def tick():
            rd, address = ctx.get(core.dmem_rd_en), ctx.get(core.dmem_addr)
            assert not ctx.get(core.dmem_wr_en)
            await ctx.tick()
            ctx.set(core.dmem_rd_valid, rd)
            ctx.set(core.dmem_rd_data, words[address // 4] if rd else 0)
        ctx.set(core.defer_fault_reset, 1)
        ctx.set(core.boot_start, 1)
        await tick()
        ctx.set(core.boot_start, 0)
        for attempt in range(3):
            for _ in range(150):
                if ctx.get(core.fault_valid):
                    break
                await tick()
            else:
                pytest.fail("no fault on retry")
            assert ctx.get(core.fault) == FaultType.STACK_CORRUPT
            assert ctx.get(core.retire_valid) and ctx.get(core.retire_fault_valid)
            assert not ctx.get(core.boot_complete)
            for _ in range(10):
                await tick()
                assert ctx.get(core.fault_valid)
                assert not ctx.get(core.retire_valid), "no duplicate snapshot triggers"
            if attempt < 2:
                ctx.set(core.reboot_req, 1)  # top-level authorized reboot boundary
                await tick()
                ctx.set(core.reboot_req, 0)
                await tick()
                assert not ctx.get(core.fault_valid)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("case,expected", [
    ("root", 0), ("suspended", 0),
    ("home_version", FaultType.VERSION), ("entry_version", FaultType.VERSION),
    ("entry_seal", FaultType.SEAL), ("pc_bounds", FaultType.STACK_CORRUPT),
])
def test_core_continuation_uses_existing_return_authority_checks(case, expected):
    from scripts.probe_boot_continuation_core import replay_words
    words = image()
    if case == "root":
        words[512] = 0xf8000801  # method table plus one executable word
        words[513] = 2
    if case != "root":
        words[273] = 0x10ef
        words[496:498] = [0x4a000003, 0x10f1]
        words[500] = 0
    if case == "home_version":
        words[501] = 0x02010003
    if case == "entry_version":
        words[496] |= 1 << 16
    if case == "entry_seal":
        words[14] ^= 1
    if case == "pc_bounds":
        words[497] |= 1 << 13  # PC 1 lies outside a one-word code body.
    result = replay_words(words)
    assert result["fault"] == expected
    assert result["complete"] == (expected == 0)
    if not expected:
        assert result["cr"][12][0] == 0x02000002
        assert result["cr"][14][0] & 65535 == 3
        assert result["nia"] == 512 * 4 + (8 if case == "root" else 4)
