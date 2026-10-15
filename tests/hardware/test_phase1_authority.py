"""H03/H06/H07/H08: isolated RTL gates with independent synthetic memory."""
import pytest
from amaranth.sim import Simulator
from hardware.ns_gate import ChurchNSGate
from hardware.dread import ChurchDRead
from hardware.dwrite import ChurchDWrite
from hardware.tperm import ChurchTperm
from hardware.change import ChurchChange
from hardware.msave import ChurchMSave
from phase1_support import MASK, seal


def simulate(dut, bench):
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("mutation", [None, *range(62), "F", "G"])
def test_h06_each_integrity_bit_and_independent_fg(mutation):
    dut = ChurchNSGate(enable_seal_check=True)
    location, authority = 0x1000, 0xff
    memory = {0x8020: location, 0x8024: authority,
              0x8028: seal(location, authority), 0x802c: 0xa5a51234}
    if isinstance(mutation, int):
        memory[0x8020 if mutation < 32 else 0x8024] ^= 1 << (mutation % 32)
    elif mutation in ("F", "G"):
        memory[0x8024] |= 1 << (31 if mutation == "F" else 30)
    async def bench(ctx):
        ctx.set(dut.gt_word0, 0x02000002)
        ctx.set(dut.cr15_namespace.as_value(), 0x1a000000 | (0x8000 << 32) | (255 << 64))
        ctx.set(dut.ns_gate_start, 1)
        await ctx.tick()
        ctx.set(dut.ns_gate_start, 0)
        for _ in range(64):
            request, addr = ctx.get(dut.mem_rd_en), ctx.get(dut.mem_addr)
            if ctx.get(dut.ns_gate_fault):
                assert isinstance(mutation, int), mutation
                assert not ctx.get(dut.ns_gate_done)
                return
            if ctx.get(dut.ns_gate_done):
                assert not isinstance(mutation, int), mutation
                assert ctx.get(dut.raw_base) == location
                assert ctx.get(dut.raw_w2) == memory[0x8024]
                assert ctx.get(dut.ns_cache_token32) == 0xa5a51234
                return
            await ctx.tick()
            ctx.set(dut.mem_rd_valid, request)
            ctx.set(dut.mem_rd_data, memory.get(addr, 0xdead0000))
        pytest.fail("NS integrity gate timeout")
    simulate(dut, bench)


@pytest.mark.parametrize("bit", range(9))
@pytest.mark.parametrize("stale", [False, True])
def test_h06_full_nine_bit_generation_equality(bit, stale):
    dut = ChurchNSGate(enable_seal_check=True)
    sequence = 1 << bit
    authority = 255 | (sequence << 21)
    memory = {0x20: 0x1000, 0x24: authority, 0x28: seal(0x1000, authority), 0x2c: 0}
    async def bench(ctx):
        ctx.set(dut.gt_word0, 0x02000002 | ((0 if stale else sequence) << 16))
        ctx.set(dut.cr15_namespace.as_value(), 0x1a000000 | (255 << 64))
        ctx.set(dut.ns_gate_start, 1)
        await ctx.tick()
        ctx.set(dut.ns_gate_start, 0)
        for _ in range(64):
            request, addr = ctx.get(dut.mem_rd_en), ctx.get(dut.mem_addr)
            if ctx.get(dut.ns_gate_fault) or ctx.get(dut.ns_gate_done):
                assert bool(ctx.get(dut.ns_gate_fault)) == stale
                assert bool(ctx.get(dut.ns_gate_done)) != stale
                # Gate has no write interface: versions cannot be repaired here.
                assert memory[0x24] == authority
                return
            await ctx.tick()
            ctx.set(dut.mem_rd_valid, request)
            ctx.set(dut.mem_rd_data, memory.get(addr, 0xdead0000))
        pytest.fail("NS generation gate timeout")
    simulate(dut, bench)


@pytest.mark.parametrize("write", [False, True])
@pytest.mark.parametrize("index,mag,subtract,limit", [
    (0, 0, False, 0), (0, 1023, False, 1023),
    (1023, 1023, True, 0), (1024, 1023, True, 1),
    (0, 1, True, 1023), (0, 1023, True, 1023),
    (1024, 0, False, 1023), (MASK, 1, False, 1023),
    (0x7fffffff, 1023, False, 1023), (0x80000000, 1023, True, 1023),
])
def test_h03_h06_data_index_commit_or_no_effect(write, index, mag, subtract, limit):
    dut = ChurchDWrite() if write else ChurchDRead()
    offset = index + (-mag if subtract else mag)
    valid = 0 <= offset <= limit
    cap = (0x22000003 if write else 0x12000003) | (0x1000 << 32) | (limit << 64)
    async def bench(ctx):
        ctx.set(dut.cr_rd_data.as_value(), cap)
        ctx.set(dut.cr_src, 2)
        ctx.set(dut.imm, int(subtract) << 14 | mag << 4 | 11)
        ctx.set(dut.dr_src if write else dut.dr_dst, 4)
        ctx.set(dut.dr_rd_data, 0xd15ea5e5 if write else index)
        if write:
            ctx.set(dut.dr_rd_data2, index)
        else:
            ctx.set(dut.dmem_rd_data, 0xd15ea5e5)
        ctx.set(dut.start, 1)
        await ctx.tick()
        ctx.set(dut.start, 0)
        accesses, commits = [], []
        for _ in range(24):
            if ctx.get(dut.dmem_wr_en if write else dut.dmem_rd_en):
                accesses.append(ctx.get(dut.dmem_addr))
                if write:
                    assert ctx.get(dut.dmem_wr_data) == 0xd15ea5e5
            if write:
                assert not ctx.get(dut.m_bit_wr_en)
            elif ctx.get(dut.dr_wr_en):
                commits.append((ctx.get(dut.dr_wr_addr), ctx.get(dut.dr_wr_data)))
            if ctx.get(dut.fault):
                assert not valid, (index, mag, subtract)
                assert accesses == [] and commits == []
                return
            if ctx.get(dut.done):
                assert valid
                assert accesses == [0x1000 + offset * 4]
                assert commits == ([] if write else [(4, 0xd15ea5e5)])
                return
            await ctx.tick()
        pytest.fail("data access timeout")
    simulate(dut, bench)


@pytest.mark.parametrize("preset", [14, 15, 31])
@pytest.mark.parametrize("left,right", [
    (0, 0), (1, 0x02000001), (0xf9ffffff, 0x02000001),
    (0x02000001, 1), (0x02000001, 0x02000001),
    (0x02000001, 0x82000001), (0x04000001, 0x04000001),
])
def test_h07_raw_null_b_and_exact_bits(preset, left, right):
    dut = ChurchTperm()
    null = lambda gt: (gt >> 25 & 3) == 0
    fault = preset == 31 or preset == 14 and (null(left) or null(right))
    async def bench(ctx):
        ctx.set(dut.cr_target, 2)
        ctx.set(dut.cr_src, 3)
        ctx.set(dut.preset, preset)
        ctx.set(dut.tperm_start, 1)
        await ctx.tick()
        ctx.set(dut.tperm_start, 0)
        for _ in range(24):
            ctx.set(dut.cr_rd_data.as_value(),
                    (left if ctx.get(dut.cr_rd_addr) == 2 else right) | (0xa5a5 << 32))
            assert not ctx.get(dut.cr_wr_en)
            if ctx.get(dut.tperm_fault):
                assert fault
                assert not ctx.get(dut.tperm_complete)
                return
            if ctx.get(dut.tperm_complete):
                assert not fault
                assert ctx.get(dut.tperm_z_result) == (null(left) if preset == 15 else left == right)
                return
            await ctx.tick()
        pytest.fail("TPERM timeout")
    simulate(dut, bench)


@pytest.mark.parametrize("defect", ["permission", "header_type", "header_cc", "header_size"])
def test_h08_thread_admission_distinct_approved_faults(defect):
    """No frame packing assumption is needed to reject these single defects."""
    dut = ChurchChange()
    header = 0xf900820c  # marker=31, allocation=256, cw=32, Thread=2, cc=12
    if defect == "header_type":
        header ^= 2 << 8
    elif defect == "header_cc":
        header ^= 1
    elif defect == "header_size":
        header ^= 1 << 23
    memory = {0x10: 0x1000, 0x14: 255, 0x18: seal(0x1000, 255),
              0x1c: 0, 0x1000: header}
    operand = 0x12000001 if defect == "permission" else 0x02000001
    async def bench(ctx):
        ctx.set(dut.ordinary, 1)
        # Unit interface (not instruction encoding); destination routing is
        # checked independently at the full-core boundary.
        ctx.set(dut.cr_src, 2)
        ctx.set(dut.cr_dst, 2)
        ctx.set(dut.cr_rd_data.as_value(), operand)
        ctx.set(dut.cr15_namespace.as_value(), 0x1a000000 | (255 << 64))
        ctx.set(dut.change_start, 1)
        await ctx.tick()
        ctx.set(dut.change_start, 0)
        for _ in range(96):
            assert not ctx.get(dut.cr_wr_en)
            assert not ctx.get(dut.dr_wr_en)
            assert not ctx.get(dut.mem_wr_en)
            assert not ctx.get(dut.nia_restore_en)
            assert not ctx.get(dut.flags_restore_en)
            assert not ctx.get(dut.change_complete)
            if ctx.get(dut.change_fault):
                assert ctx.get(dut.fault_type) == (0x1e if defect == "permission" else 0x1d)
                return
            request, addr = ctx.get(dut.mem_rd_en), ctx.get(dut.mem_rd_addr)
            await ctx.tick()
            ctx.set(dut.mem_rd_valid, request)
            ctx.set(dut.mem_rd_data, memory.get(addr, 0xdead0000))
        pytest.fail("Thread admission timeout")
    simulate(dut, bench)


@pytest.mark.parametrize("write", [False, True])
@pytest.mark.parametrize("gt,allowed", [
    (0, False), (0xf9ffffff, False),  # literal/nonliteral NULL
    (0x04000003, False),             # Outform is not installed DATA authority
    (0x02000003, False),             # permissionless Inform
    (0x3a000003, False),             # Church L/S is not Turing R/W
    (0x32000003, True),              # Inform DATA R/W
])
def test_h06_domain_type_permission_no_unauthorized_memory(write, gt, allowed):
    dut = ChurchDWrite() if write else ChurchDRead()
    async def bench(ctx):
        ctx.set(dut.cr_rd_data.as_value(), gt | 0x1000 << 32 | 3 << 64)
        ctx.set(dut.cr_src, 2)
        ctx.set(dut.imm, 0)
        ctx.set(dut.dr_src if write else dut.dr_dst, 4)
        ctx.set(dut.dr_rd_data, 0xa5a51234 if write else 0)
        if write:
            ctx.set(dut.dr_rd_data2, 0)
        else:
            ctx.set(dut.dmem_rd_data, 0xa5a51234)
        ctx.set(dut.start, 1)
        await ctx.tick()
        ctx.set(dut.start, 0)
        accessed = False
        for _ in range(24):
            access = ctx.get(dut.dmem_wr_en if write else dut.dmem_rd_en)
            if access:
                assert allowed
                assert ctx.get(dut.dmem_addr) == 0x1000
                accessed = True
            if write:
                assert not ctx.get(dut.m_bit_wr_en)
            elif ctx.get(dut.dr_wr_en):
                assert allowed
                assert ctx.get(dut.dr_wr_data) == 0xa5a51234
            if ctx.get(dut.fault):
                assert not allowed and not accessed
                return
            if ctx.get(dut.done):
                assert allowed and accessed
                return
            await ctx.tick()
        pytest.fail("permission gate timeout")
    simulate(dut, bench)


@pytest.mark.parametrize("authorized", [False, True])
def test_h06_mmio_write_requires_namespace_authority(authorized):
    dut = ChurchDWrite()
    async def bench(ctx):
        # Dedicated M-bit device descriptor: port and slot are existing board
        # wiring, not a new Phase 1 address-allocation decision.
        ctx.set(dut.cr_rd_data.as_value(), 0x3200000d | 0xffffff1c << 32)
        ctx.set(dut.cr_src, 2)
        ctx.set(dut.dr_src, 4)
        ctx.set(dut.imm, 0)
        ctx.set(dut.dr_rd_data, 0x5a5a)
        ctx.set(dut.dr_rd_data2, 0)
        ctx.set(dut.namespace_authorized, authorized)
        ctx.set(dut.start, 1)
        await ctx.tick()
        ctx.set(dut.start, 0)
        writes = []
        for _ in range(24):
            assert not ctx.get(dut.dmem_wr_en)
            if ctx.get(dut.m_bit_wr_en):
                assert authorized
                writes.append(ctx.get(dut.m_bit_wr_word))
            if ctx.get(dut.fault):
                assert not authorized and writes == []
                return
            if ctx.get(dut.done):
                assert authorized and writes == [0x5a5a]
                return
            await ctx.tick()
        pytest.fail("MMIO gate timeout")
    simulate(dut, bench)


@pytest.mark.parametrize("row", [0, 31, 32, 65536, MASK])
@pytest.mark.parametrize("defect", [None, "S", "B", "seal", "generation"])
def test_h06_save_committed_memory_and_forbidden_writes(row, defect):
    dut = ChurchMSave(enable_seal_check=True)
    source = 0x82000003 if defect != "B" else 0x02000003
    destination = 0xaa000002 if defect != "S" else 0x8a000002
    authority = 63 | ((1 << 21) if defect == "generation" else 0)
    memory = {0x8030: 0x3000, 0x8034: authority,
              0x8038: seal(0x3000, authority) ^ int(defect == "seal")}
    target = {0x2000+4*i: 0x5a000000+i for i in range(32)}
    before = dict(target)
    valid = row <= 31 and defect is None
    async def bench(ctx):
        ctx.set(dut.sub_src_gt, source)
        ctx.set(dut.sub_dst_cap.as_value(), destination | 0x2000 << 32 | 31 << 64)
        ctx.set(dut.sub_index, row)
        ctx.set(dut.cr15_namespace.as_value(), 0x1a000000 | 0x8000 << 32 | 255 << 64)
        ctx.set(dut.mem_wr_done, 1)
        ctx.set(dut.sub_start, 1)
        await ctx.tick()
        ctx.set(dut.sub_start, 0)
        # Accepted source/index must be latched.
        ctx.set(dut.sub_src_gt, 0)
        ctx.set(dut.sub_index, MASK)
        writes = []
        for _ in range(64):
            request, addr = ctx.get(dut.mem_rd_en), ctx.get(dut.mem_rd_addr)
            ctx.set(dut.mem_rd_valid, request)
            ctx.set(dut.mem_rd_data, memory.get(addr, 0xdeadbeef))
            if ctx.get(dut.mem_wr_en):
                assert valid
                address, payload = ctx.get(dut.mem_wr_addr), ctx.get(dut.mem_wr_data)
                assert (address, payload) == (0x2000+4*row, source)
                writes.append((address, payload))
                target[address] = payload
            if ctx.get(dut.sub_fault):
                assert not valid and not writes and target == before
                return
            if ctx.get(dut.sub_done):
                assert valid and writes == [(0x2000+4*row, source)]
                expected = dict(before)
                expected[0x2000+4*row] = source
                assert target == expected
                return
            await ctx.tick()
        pytest.fail("SAVE validation timeout")
    simulate(dut, bench)
