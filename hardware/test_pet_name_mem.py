"""Hardware simulation tests for pet-name memory gating of LAZY_RESOLVE (Task #1526).

Tests confirm:
  T1  ChurchELoadCall — named slot NULL GT   → lazy_resolve_irq fires
  T2  ChurchELoadCall — unnamed slot NULL GT → NULL_CAP hard fault
  T3  ChurchXLoadLambda — named slot NULL GT   → lazy_resolve_irq fires
  T4  ChurchXLoadLambda — unnamed slot NULL GT → NULL_CAP hard fault
  T5  PetNameMemory — write then read back
  T6  PetNameMemory — out-of-range read → 0
  T7  PetNameMemory — init_named pre-marks slots at reset

The fused-unit tests (T1–T4) use enable_seal_check=False to avoid supplying
cryptographically-valid NS-entry seals.  All memory reads return 0, which:
  - supplies a NULL GT (0x00000000) for the c-list slot fetch (FETCH_GT)
  - supplies zero for NS[0] entry (lump base=0, authority=0, abstract_gt=0)
With gt_seq=0 in both the NULL GT and the NS authority word, CHECK_VERSION
passes in the ns_gate FSM (no-op when seal-check is disabled).

C-list cap register (CR6 = CR_CLIST) values:
  word0_gt  — INFORM, Church dom, E-perm  (dom=1, perm=0b100, gt_type=1)
  word1_location — 0x0200   (c-list lump base byte address)
  word2_w2  — 0x40          (limit_offset[15:0]=64; index=5 < 64 → bounds OK)

CR15 namespace:
  word1_location — 0x1000   (NS table byte address)
  word2_w2       — 0xFF     (NS slot limit; slot_id=0 from NULL GT < 255 → OK)

Run with:
    python -m hardware.test_pet_name_mem
"""

import sys
from amaranth import *
from amaranth.sim import Simulator

from .fused_unit import ChurchELoadCall, ChurchXLoadLambda
from .pet_name_mem import PetNameMemory, PET_NAME_MEM_DEPTH
from .hw_types import FaultType, CR_CLIST
from .boot_rom import DEMO_CLIST_NAMED_SLOTS


# ---------------------------------------------------------------------------
# Helpers — cap-register dict constructors
# ---------------------------------------------------------------------------

def _gt_dict(gt_type=0, dom=0, perm=0, slot_id=0, gt_seq=0, b_flag=0):
    return {
        "slot_id": slot_id, "gt_seq": gt_seq, "gt_type": gt_type,
        "dom": dom, "perm": perm, "b_flag": b_flag,
    }


def _cap_dict(gt_type=0, dom=0, perm=0, slot_id=0, gt_seq=0,
              word1_location=0, word2_w2=0):
    return {
        "word0_gt": _gt_dict(gt_type=gt_type, dom=dom, perm=perm,
                             slot_id=slot_id, gt_seq=gt_seq),
        "word1_location": word1_location,
        "word2_w2": word2_w2,
    }


# INFORM L-perm Church-domain c-list cap (used for CR0 in ELoadCall tests).
# ELoadCall restricts cr_src to 0–5 (MAX_SRC_REG=5); m_elevated is only True
# when mload_src==CR_CLIST which never occurs in phase 0 for cr_src<=5.
# Therefore the source cap must carry L-permission to pass mLoad's CHECK_L.
# Church L-perm encoding: dom=1, perm[0]=1 (L is bit 0 in 3-bit Church perm).
CLIST_CAP = _cap_dict(
    gt_type=1,      # GT_TYPE_INFORM
    dom=1,          # Church domain
    perm=0b001,     # L permission (bit 0 in Church domain)
    word1_location=0x0200,   # c-list lump base
    word2_w2=0x40,           # limit_offset[15:0]=64 > index=5
)

# Namespace cap (CR15): NS table at 0x1000, 255 slots
NS_CAP = _cap_dict(word1_location=0x1000, word2_w2=0xFF)

# Null cap (unwritten CR register)
NULL_CAP_DICT = _cap_dict()


# ---------------------------------------------------------------------------
# ELoadCall DUT shim
# ---------------------------------------------------------------------------

class _ELoadCallDUT(Elaboratable):
    """Wrap ChurchELoadCall with a direct pet_name_rd_data driver."""

    def __init__(self):
        self.u = ChurchELoadCall(enable_seal_check=False)
        self.pet_name_rd_data_in = Signal(1)

    def elaborate(self, platform):
        m = Module()
        m.submodules.u = self.u
        m.d.comb += self.u.pet_name_rd_data.eq(self.pet_name_rd_data_in)
        return m


async def _drive_eloadcall_null(ctx, dut, *, pet_named: bool):
    """Drive ChurchELoadCall through the full mLoad sequence with a NULL GT
    in c-list slot 5, then return (lazy_resolve_irq, fault_type).

    Memory responses: always 0 (NULL GT for slot, zero NS entry).
    CR file: CR6 → CLIST_CAP; all others → NULL_CAP_DICT.
    """
    u = dut.u

    ctx.set(dut.pet_name_rd_data_in, 1 if pet_named else 0)
    ctx.set(u.cr15_namespace, NS_CAP)
    ctx.set(u.mem_rd_valid, 0)
    ctx.set(u.mem_rd_data, 0)

    # ELOADCALL CR0[5] → CR1 (cr_src must be 0–5; CR0 has L-perm via CLIST_CAP)
    ctx.set(u.cr_src, 0)
    ctx.set(u.cr_dst, 1)
    ctx.set(u.index, 5)
    ctx.set(u.mask, 0)
    ctx.set(u.call_imm, 0)

    ctx.set(u.start, 1)
    await ctx.tick()
    ctx.set(u.start, 0)

    for _ in range(80):
        # Serve CR file: CR0 = L-perm c-list cap; all others = null
        cr_addr = ctx.get(u.cr_rd_addr)
        ctx.set(u.cr_rd_data, CLIST_CAP if cr_addr == 0 else NULL_CAP_DICT)

        # Serve memory reads with 0 (NULL GT for slot; zero NS entry)
        if ctx.get(u.mem_rd_en):
            ctx.set(u.mem_rd_data, 0)
            ctx.set(u.mem_rd_valid, 1)
        else:
            ctx.set(u.mem_rd_valid, 0)

        await ctx.tick()

        lazy_irq  = ctx.get(u.lazy_resolve_irq)
        fault_flag = ctx.get(u.fault)
        if lazy_irq or fault_flag:
            return lazy_irq, ctx.get(u.fault_type)
        if not ctx.get(u.busy):
            break

    return ctx.get(u.lazy_resolve_irq), ctx.get(u.fault_type)


# ---------------------------------------------------------------------------
# T1: ELoadCall named NULL GT → lazy_resolve_irq fires
# ---------------------------------------------------------------------------

def test_eloadcall_named_null_fires_irq():
    """T1: NULL GT in a named c-list slot → lazy_resolve_irq=1, no fault."""
    dut = _ELoadCallDUT()

    async def tb(ctx):
        lazy_irq, fault_type = await _drive_eloadcall_null(ctx, dut, pet_named=True)
        assert lazy_irq == 1, (
            f"T1 FAIL: expected lazy_resolve_irq=1, got {lazy_irq}, "
            f"fault_type={fault_type}"
        )
        assert fault_type == int(FaultType.NONE), (
            f"T1 FAIL: expected no fault, got fault_type={fault_type}"
        )
        print("  T1 PASS: named NULL GT → lazy_resolve_irq=1")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(tb)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_eloadcall_named_null_fires_irq")


# ---------------------------------------------------------------------------
# T2: ELoadCall unnamed NULL GT → NULL_CAP hard fault
# ---------------------------------------------------------------------------

def test_eloadcall_unnamed_null_hard_fault():
    """T2: NULL GT in an unnamed c-list slot → NULL_CAP fault, IRQ silent."""
    dut = _ELoadCallDUT()

    async def tb(ctx):
        lazy_irq, fault_type = await _drive_eloadcall_null(ctx, dut, pet_named=False)
        assert lazy_irq == 0, (
            f"T2 FAIL: expected lazy_resolve_irq=0, got {lazy_irq}"
        )
        assert fault_type == int(FaultType.NULL_CAP), (
            f"T2 FAIL: expected NULL_CAP={int(FaultType.NULL_CAP)}, "
            f"got fault_type={fault_type}"
        )
        print("  T2 PASS: unnamed NULL GT → NULL_CAP fault, no IRQ")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(tb)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_eloadcall_unnamed_null_hard_fault")


# ---------------------------------------------------------------------------
# XLoadLambda DUT shim
# ---------------------------------------------------------------------------

class _XLoadLambdaDUT(Elaboratable):
    """Wrap ChurchXLoadLambda with a direct pet_name_rd_data driver."""

    def __init__(self):
        self.u = ChurchXLoadLambda(enable_seal_check=False)
        self.pet_name_rd_data_in = Signal(1)

    def elaborate(self, platform):
        m = Module()
        m.submodules.u = self.u
        m.d.comb += self.u.pet_name_rd_data.eq(self.pet_name_rd_data_in)
        return m


async def _drive_xloadlambda_null(ctx, dut, *, pet_named: bool):
    """Drive ChurchXLoadLambda through the full mLoad sequence with a NULL GT
    in c-list slot 3, then return (lazy_resolve_irq, fault_type).
    """
    u = dut.u

    ctx.set(dut.pet_name_rd_data_in, 1 if pet_named else 0)
    ctx.set(u.cr15_namespace, NS_CAP)
    ctx.set(u.mem_rd_valid, 0)
    ctx.set(u.mem_rd_data, 0)
    ctx.set(u.saved_nia, 0x1000)

    # XLOADLAMBDA CR6[3] → CR0
    ctx.set(u.cr_src, CR_CLIST)   # 6
    ctx.set(u.cr_dst, 0)
    ctx.set(u.index, 3)

    ctx.set(u.start, 1)
    await ctx.tick()
    ctx.set(u.start, 0)

    for _ in range(80):
        cr_addr = ctx.get(u.cr_rd_addr)
        ctx.set(u.cr_rd_data, CLIST_CAP if cr_addr == CR_CLIST else NULL_CAP_DICT)

        if ctx.get(u.mem_rd_en):
            ctx.set(u.mem_rd_data, 0)
            ctx.set(u.mem_rd_valid, 1)
        else:
            ctx.set(u.mem_rd_valid, 0)

        await ctx.tick()

        lazy_irq   = ctx.get(u.lazy_resolve_irq)
        fault_flag = ctx.get(u.fault)
        if lazy_irq or fault_flag:
            return lazy_irq, ctx.get(u.fault_type)
        if not ctx.get(u.busy):
            break

    return ctx.get(u.lazy_resolve_irq), ctx.get(u.fault_type)


# ---------------------------------------------------------------------------
# T3: XLoadLambda named NULL GT → lazy_resolve_irq fires
# ---------------------------------------------------------------------------

def test_xloadlambda_named_null_fires_irq():
    """T3: NULL GT in a named c-list slot via XLOADLAMBDA → lazy_resolve_irq=1."""
    dut = _XLoadLambdaDUT()

    async def tb(ctx):
        lazy_irq, fault_type = await _drive_xloadlambda_null(ctx, dut, pet_named=True)
        assert lazy_irq == 1, (
            f"T3 FAIL: expected lazy_resolve_irq=1, got {lazy_irq}, "
            f"fault_type={fault_type}"
        )
        assert fault_type == int(FaultType.NONE), (
            f"T3 FAIL: expected no fault, got fault_type={fault_type}"
        )
        print("  T3 PASS: named NULL GT (XLOADLAMBDA) → lazy_resolve_irq=1")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(tb)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_xloadlambda_named_null_fires_irq")


# ---------------------------------------------------------------------------
# T4: XLoadLambda unnamed NULL GT → NULL_CAP hard fault
# ---------------------------------------------------------------------------

def test_xloadlambda_unnamed_null_hard_fault():
    """T4: NULL GT in an unnamed c-list slot via XLOADLAMBDA → NULL_CAP fault."""
    dut = _XLoadLambdaDUT()

    async def tb(ctx):
        lazy_irq, fault_type = await _drive_xloadlambda_null(ctx, dut, pet_named=False)
        assert lazy_irq == 0, (
            f"T4 FAIL: expected lazy_resolve_irq=0, got {lazy_irq}"
        )
        assert fault_type == int(FaultType.NULL_CAP), (
            f"T4 FAIL: expected NULL_CAP={int(FaultType.NULL_CAP)}, "
            f"got fault_type={fault_type}"
        )
        print("  T4 PASS: unnamed NULL GT (XLOADLAMBDA) → NULL_CAP fault, no IRQ")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(tb)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_xloadlambda_unnamed_null_hard_fault")


# ---------------------------------------------------------------------------
# PetNameMemory unit tests
# ---------------------------------------------------------------------------

def test_pet_name_mem_write_and_read():
    """T5: Write slot 7 → rd_data returns 1; other slots stay 0."""
    dut = PetNameMemory()

    async def tb(ctx):
        ctx.set(dut.rd_addr, 7)
        await ctx.tick()
        assert ctx.get(dut.rd_data) == 0, "T5 FAIL: slot 7 should start at 0"

        ctx.set(dut.wr_en, 1)
        ctx.set(dut.wr_addr, 7)
        ctx.set(dut.wr_data, 1)
        await ctx.tick()
        ctx.set(dut.wr_en, 0)

        ctx.set(dut.rd_addr, 7)
        await ctx.tick()
        v = ctx.get(dut.rd_data)
        assert v == 1, f"T5 FAIL: slot 7 should be 1 after write, got {v}"

        ctx.set(dut.rd_addr, 8)
        await ctx.tick()
        v2 = ctx.get(dut.rd_data)
        assert v2 == 0, f"T5 FAIL: slot 8 should still be 0, got {v2}"

        print("  T5 PASS: write slot 7 → rd_data=1; slot 8 stays 0")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(tb)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_pet_name_mem_write_and_read")


def test_pet_name_mem_out_of_range():
    """T6: rd_addr >= PET_NAME_MEM_DEPTH always returns 0."""
    dut = PetNameMemory(init_named=list(range(PET_NAME_MEM_DEPTH)))  # all named

    async def tb(ctx):
        ctx.set(dut.rd_addr, PET_NAME_MEM_DEPTH)
        await ctx.tick()
        v = ctx.get(dut.rd_data)
        assert v == 0, f"T6 FAIL: out-of-range rd_addr should return 0, got {v}"

        ctx.set(dut.rd_addr, 0xFFFF)
        await ctx.tick()
        v2 = ctx.get(dut.rd_data)
        assert v2 == 0, f"T6 FAIL: rd_addr=0xFFFF should return 0, got {v2}"

        print("  T6 PASS: out-of-range rd_addr → rd_data=0")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(tb)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_pet_name_mem_out_of_range")


def test_pet_name_mem_init_named():
    """T7: init_named pre-marks slots without any runtime write."""
    dut = PetNameMemory(init_named=[0, 3, 15])

    async def tb(ctx):
        for slot, expected in [(0, 1), (3, 1), (15, 1), (1, 0), (4, 0)]:
            ctx.set(dut.rd_addr, slot)
            await ctx.tick()
            v = ctx.get(dut.rd_data)
            assert v == expected, (
                f"T7 FAIL: slot {slot}: expected {expected}, got {v}"
            )
        print("  T7 PASS: init_named [0,3,15] → rd_data=1; others 0")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(tb)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_pet_name_mem_init_named")


# ---------------------------------------------------------------------------
# T8: DWRITE integration — write-port → named → lazy_resolve_irq;
#     unwritten slot → hard NULL_CAP fault.
#
# This wires a real PetNameMemory (no init_named) to a ChurchELoadCall and
# confirms the runtime write path:
#   wr_en=1, wr_addr=slot, wr_data=1  →  rd_data=1  →  lazy_resolve_irq=1
#   (unwritten slot)                  →  rd_data=0  →  NULL_CAP fault
# ---------------------------------------------------------------------------

class _IntegratedDUT(Elaboratable):
    """PetNameMemory + ChurchELoadCall connected exactly as in core.py."""

    def __init__(self):
        self.u = ChurchELoadCall(enable_seal_check=False)
        self.mem = PetNameMemory()

    def elaborate(self, platform):
        m = Module()
        m.submodules.u   = self.u
        m.submodules.mem = self.mem
        m.d.comb += [
            self.mem.rd_addr.eq(self.u.pet_name_rd_addr),
            self.u.pet_name_rd_data.eq(self.mem.rd_data),
        ]
        return m


async def _drive_integrated(ctx, dut, *, slot_index: int, pre_mark: bool):
    """Write to PetNameMemory (or not), then drive ELOADCALL with NULL GT at
    slot_index and return (lazy_resolve_irq, fault_type).
    """
    u, mem = dut.u, dut.mem

    # Optionally mark the slot as named via the write port
    if pre_mark:
        ctx.set(mem.wr_en, 1)
        ctx.set(mem.wr_addr, slot_index)
        ctx.set(mem.wr_data, 1)
        await ctx.tick()
        ctx.set(mem.wr_en, 0)

    ctx.set(u.cr15_namespace, NS_CAP)
    ctx.set(u.mem_rd_valid, 0)
    ctx.set(u.mem_rd_data, 0)

    ctx.set(u.cr_src, 0)
    ctx.set(u.cr_dst, 1)
    ctx.set(u.index, slot_index)
    ctx.set(u.mask, 0)
    ctx.set(u.call_imm, 0)

    ctx.set(u.start, 1)
    await ctx.tick()
    ctx.set(u.start, 0)

    for _ in range(80):
        cr_addr = ctx.get(u.cr_rd_addr)
        ctx.set(u.cr_rd_data, CLIST_CAP if cr_addr == 0 else NULL_CAP_DICT)

        if ctx.get(u.mem_rd_en):
            ctx.set(u.mem_rd_data, 0)
            ctx.set(u.mem_rd_valid, 1)
        else:
            ctx.set(u.mem_rd_valid, 0)

        await ctx.tick()

        lazy_irq   = ctx.get(u.lazy_resolve_irq)
        fault_flag = ctx.get(u.fault)
        if lazy_irq or fault_flag:
            return lazy_irq, ctx.get(u.fault_type)
        if not ctx.get(u.busy):
            break

    return ctx.get(u.lazy_resolve_irq), ctx.get(u.fault_type)


def test_boot_named_slots_from_authoritative_set():
    """T9: PetNameMemory initialised from DEMO_CLIST_NAMED_SLOTS.

    Verifies the authoritative boot-time init policy:
      slot 4 (freed, not in set) → rd_data=0 (unnamed → hard NULL_CAP fault)
      slot 5 (Navana E-GT, in set) → rd_data=1 (named → lazy_resolve_irq)

    Uses a standalone PetNameMemory (not integrated with ELoadCall) because
    rd_addr is a combinatorial output in the integrated DUT and cannot be
    overridden by a testbench.  T1–T4 and T8 cover the full pipeline path.
    """
    dut = PetNameMemory(init_named=list(DEMO_CLIST_NAMED_SLOTS))

    async def tb(ctx):
        # Sub-test A: slot 4 (freed, excluded from DEMO_CLIST_NAMED_SLOTS)
        assert 4 not in DEMO_CLIST_NAMED_SLOTS, (
            "T9A prerequisite: slot 4 must not be in DEMO_CLIST_NAMED_SLOTS"
        )
        ctx.set(dut.rd_addr, 4)
        await ctx.tick()
        v4 = ctx.get(dut.rd_data)
        assert v4 == 0, (
            f"T9A FAIL: boot-init slot 4 (freed) should be unnamed "
            f"(rd_data=0), got {v4}"
        )

        # Sub-test B: slot 5 (Navana E-GT, in DEMO_CLIST_NAMED_SLOTS) is named
        assert 5 in DEMO_CLIST_NAMED_SLOTS, (
            "T9B prerequisite: slot 5 must be in DEMO_CLIST_NAMED_SLOTS"
        )
        ctx.set(dut.rd_addr, 5)
        await ctx.tick()
        v5 = ctx.get(dut.rd_data)
        assert v5 == 1, (
            f"T9B FAIL: boot-init slot 5 (Navana) should be named "
            f"(rd_data=1), got {v5}"
        )

        print("  T9A PASS: boot init — slot 4 (freed) → rd_data=0 (unnamed)")
        print("  T9B PASS: boot init — slot 5 (Navana) → rd_data=1 (named)")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(tb)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_boot_named_slots_from_authoritative_set")


def test_dwrite_integration():
    """T8: Real PetNameMemory write port → named slot fires lazy_resolve_irq;
    unwritten slot stays hard NULL_CAP fault.
    Uses PetNameMemory with no init_named (all zeros at reset).
    """
    dut = _IntegratedDUT()

    async def tb(ctx):
        # Sub-test A: slot 20 unwritten → hard NULL_CAP fault
        lazy_irq, fault_type = await _drive_integrated(
            ctx, dut, slot_index=20, pre_mark=False
        )
        assert lazy_irq == 0, (
            f"T8A FAIL: unwritten slot should not fire IRQ, got {lazy_irq}"
        )
        assert fault_type == int(FaultType.NULL_CAP), (
            f"T8A FAIL: expected NULL_CAP={int(FaultType.NULL_CAP)}, "
            f"got fault_type={fault_type}"
        )
        print("  T8A PASS: unwritten slot → NULL_CAP hard fault")

        # Sub-test B: write slot 9 as named → lazy_resolve_irq fires
        lazy_irq, fault_type = await _drive_integrated(
            ctx, dut, slot_index=9, pre_mark=True
        )
        assert lazy_irq == 1, (
            f"T8B FAIL: named slot after write should fire lazy_resolve_irq, "
            f"got {lazy_irq}, fault_type={fault_type}"
        )
        assert fault_type == int(FaultType.NONE), (
            f"T8B FAIL: expected no fault, got {fault_type}"
        )
        print("  T8B PASS: write slot 9 as named → lazy_resolve_irq=1")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(tb)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_dwrite_integration")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    print("=" * 65)
    print("Pet-Name Memory + LAZY_RESOLVE Gating Tests (Task #1526)")
    print("=" * 65)

    tests = [
        test_eloadcall_named_null_fires_irq,
        test_eloadcall_unnamed_null_hard_fault,
        test_xloadlambda_named_null_fires_irq,
        test_xloadlambda_unnamed_null_hard_fault,
        test_pet_name_mem_write_and_read,
        test_pet_name_mem_out_of_range,
        test_pet_name_mem_init_named,
        test_boot_named_slots_from_authoritative_set,
        test_dwrite_integration,
    ]
    passed = 0
    failed = 0
    for t in tests:
        try:
            t()
            passed += 1
        except Exception as exc:
            import traceback
            print(f"FAIL: {t.__name__}: {exc}")
            traceback.print_exc()
            failed += 1

    print("=" * 65)
    print(f"Results: {passed} passed, {failed} failed")
    if failed:
        print("SOME TESTS FAILED")
        sys.exit(1)
    else:
        print("ALL TESTS PASSED")


if __name__ == "__main__":
    main()
