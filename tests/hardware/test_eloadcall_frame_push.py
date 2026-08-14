"""tests/hardware/test_eloadcall_frame_push.py

Tests for the ELOADCALL call-stack frame push (Task #2617).

Test groups
-----------
1. Signal interface  — ChurchELoadCall exposes all required frame-push ports
   including the new thread_hdr and cr12_thread inputs.
2. FSM state ordering — PUSH_CR5_CR12 before PUSH_ARM; PUSH_BOUNDS replaces
   the old PUSH_CHECK.
3. Sentinel return PC — _SENTINEL_RETURN_PC = 3 is used in the frame word.
4. FaultType bit-width — fault_type is Signal(5) so STACK_OVERFLOW (0x10) and
   STACK_CORRUPT (0x12) are not truncated.
5. Frame-word encoding — combinatorial formula for the frame word.
6. Full DUT simulation — ChurchELoadCall elaborated end-to-end, driven through
   all three mload phases (with DISTINCT phase-0 and phase-1 GTs), DISPATCH,
   and the PUSH_* frame-push states.  Verifies:
     • Three DMEM writes (callee E-GT from phase-1, frame word, new STO).
     • callee E-GT is the phase-1 CR6 GT, not the phase-0 loaded_cap GT.
     • nia_set asserted with the correct fast-path NIA.
     • PUSH_CR5_CR12 faults: null CR5 → NULL_CAP, no-R CR5 → PERM_R,
       null CR12 → NULL_CAP.
     • PUSH_BOUNDS faults: STO > sp_max → STACK_CORRUPT, STO < sp_min → STACK_OVERFLOW.
"""

import pathlib
import re
import pytest

from amaranth import *
from amaranth.lib.data import View
from amaranth.sim import Simulator

from hardware.fused_unit import ChurchELoadCall
from hardware.hw_types import FaultType, PERM_E
from hardware.layouts import CAP_REG_LAYOUT

# ─── Source text helpers ───────────────────────────────────────────────────────

FUSED_SRC = pathlib.Path("hardware/fused_unit.py").read_text()


def _state_def_pos(name: str) -> int:
    pattern = f'm.State("{name}")'
    idx = FUSED_SRC.find(pattern)
    assert idx >= 0, f"FSM state {name!r} not found in hardware/fused_unit.py"
    return idx


def _first_next_in_state(name: str) -> str:
    start = _state_def_pos(name)
    snippet = FUSED_SRC[start:]
    m = re.search(r'm\.next\s*=\s*"([^"]+)"', snippet)
    assert m, f"No m.next found in state {name!r}"
    return m.group(1)


# ─── Thin simulation wrappers ──────────────────────────────────────────────────

class _FrameWordEncoder(Elaboratable):
    """Thin wrapper for the frame_word combinatorial formula.

    bit[31]     = SZ = 1  (CALL/ELOADCALL frame tag)
    bits[30:16] = sentinel_return_pc = 3  (NIA=0x0C = boot ROM BRANCH -1)
    bits[15:0]  = prev_STO
    A dummy sync register allows add_clock.
    """
    _SENTINEL_RETURN_PC = 3

    def __init__(self):
        self.sto_in     = Signal(32)
        self.frame_word = Signal(32)
        self._tick_reg  = Signal()

    def elaborate(self, platform):
        m = Module()
        m.d.sync += self._tick_reg.eq(~self._tick_reg)
        m.d.comb += self.frame_word.eq(
            Cat(self.sto_in[:16],
                Const(self._SENTINEL_RETURN_PC, 15),
                Const(1, 1))
        )
        return m


# ─── GT / cap constants ────────────────────────────────────────────────────────
#
# GT_LAYOUT (32-bit):
#   bits[15:0]  = slot_id
#   bits[24:16] = gt_seq
#   bits[26:25] = gt_type  (01=Inform)
#   bit[27]     = dom      (1=Church, 0=Turing)
#   bits[30:28] = perm     (Church: bit0=L, bit1=S, bit2=E; Turing: bit0=R)
#   bit[31]     = b_flag
#
# Church Inform GT with E+L perms, slot=2 (phase-0 c-list cap):
#   (1<<25) | (1<<27) | (0b101<<28) | 2 = 0x5A000002
#
# Church Inform GT with E+L perms, slot=3 (phase-1 c-list cap, callee E-GT):
#   (1<<25) | (1<<27) | (0b101<<28) | 3 = 0x5A000003
#
# Turing Inform GT with R-perm, slot=5 (valid CR5 heap cap GT):
#   (1<<25) | (1<<28) | 5 = 0x12000005
#   (dom=0→Turing, perm[0]=R, gt_type=0b01)
#
# Turing Inform GT, NO R-perm, slot=5 (invalid CR5 for PERM_R test):
#   (1<<25) | 5 = 0x02000005   (perm[0]=0, dom=0)
#
# Turing Inform GT, slot=10 (valid CR12 thread cap GT):
#   (1<<25) | 10 = 0x0200000A
#
# NULL GT (gt_type=0b00, all other fields 0):
#   0x00000000
#
# CAP_REG_LAYOUT is 96 bits:
#   bits[31:0]  = word0_gt (GT_LAYOUT)
#   bits[63:32] = word1_location
#   bits[95:64] = word2_w2

_INFORM_EL_SLOT2    = (1 << 25) | (1 << 27) | (0b101 << 28) | 2   # 0x5A000002
_INFORM_EL_SLOT3    = (1 << 25) | (1 << 27) | (0b101 << 28) | 3   # 0x5A000003 — phase-1 GT
_CR5_VALID_GT       = (1 << 25) | (1 << 28) | 5                    # 0x12000005 — Turing Inform, R-perm
_CR5_VALID_NO_R_GT  = (1 << 25) | 5                                # 0x02000005 — Turing Inform, NO R-perm
_CR12_VALID_GT      = (1 << 25) | 10                               # 0x0200000A — Turing Inform, non-null

# NS integrity words:
#   integrity32(W0=0x700, W1=0xFF) = ROL(0x700,7) ^ ROL(0xFF,13) ^ 0xDEADBEEF
#     = 0x038000 ^ 0x001FE000 ^ 0xDEADBEEF = 0xDEB1DEEF
#   integrity32(W0=0x800, W1=0xFF) = ROL(0x800,7) ^ ROL(0xFF,13) ^ 0xDEADBEEF
#     = 0x040000 ^ 0x001FE000 ^ 0xDEADBEEF = 0xDEB65EEF
_NS_INTEGRITY_SLOT2 = 0xDEB1DEEF
_NS_INTEGRITY_SLOT3 = 0xDEB65EEF

# Thread header (LUMP_HEADER_LAYOUT):
#   n_minus_6=0 (bits[26:23]) → lump_sz = 2^(0+6) = 64 words
#   cw=10       (bits[22:10]) → code words = 10
#   cc=4        (bits[7:0])   → c-list slots = 4
#   typ=0       (bits[9:8])   → normal lump
#
#   Derived stack bounds:
#     sp_max = 64 - 12 - 1 = 51
#     sp_min = 64 - 10 - 10 = 44
#
#   Packed: (cc=4) | (cw=10 << 10) | (n_minus_6=0 << 23) = 0x00002804
_THREAD_HDR = 0x00002804
_SP_MAX     = 51   # thread_hdr-derived upper bound (>sp_max → STACK_CORRUPT)
_SP_MIN     = 44   # thread_hdr-derived lower bound (<sp_min → STACK_OVERFLOW)
_STO_VALID  = 48   # 44 ≤ 48 ≤ 51 → passes PUSH_BOUNDS
_STO_CORRUPT   = 55   # > sp_max (51) → STACK_CORRUPT
_STO_OVERFLOW  = 42   # < sp_min (44) → STACK_OVERFLOW


def _make_cap(word0_gt: int, word1_location: int, word2_w2: int) -> int:
    """Pack 3 words into a 96-bit CAP_REG_LAYOUT integer."""
    return (
        (int(word0_gt)        & 0xFFFFFFFF) |
        ((int(word1_location) & 0xFFFFFFFF) << 32) |
        ((int(word2_w2)       & 0xFFFFFFFF) << 64)
    )


# ─── 1. Signal interface ───────────────────────────────────────────────────────

class TestELoadCallSignalInterface:
    """ChurchELoadCall must expose all frame-push ports including new inputs."""

    def _dut(self):
        return ChurchELoadCall()

    def test_has_cr5_heap_input(self):
        assert hasattr(self._dut(), "cr5_heap")

    def test_has_thread_base_input(self):
        assert hasattr(self._dut(), "thread_base")

    def test_has_thread_hdr_input(self):
        """thread_hdr (LUMP_HEADER_LAYOUT) required for sp_max / sp_min bounds."""
        assert hasattr(self._dut(), "thread_hdr")

    def test_has_cr12_thread_input(self):
        """cr12_thread required for the PUSH_CR5_CR12 null check."""
        assert hasattr(self._dut(), "cr12_thread")

    def test_has_mem_wr_addr_output(self):
        assert hasattr(self._dut(), "mem_wr_addr")

    def test_has_mem_wr_data_output(self):
        assert hasattr(self._dut(), "mem_wr_data")

    def test_has_mem_wr_en_output(self):
        assert hasattr(self._dut(), "mem_wr_en")

    def test_fault_type_is_5_bits(self):
        """fault_type must be Signal(5) so STACK_OVERFLOW (0x10) and
        STACK_CORRUPT (0x12) are not truncated to 0."""
        u = self._dut()
        assert u.fault_type.shape().width == 5, (
            f"fault_type is {u.fault_type.shape().width} bits; "
            "must be 5 bits so FaultType.STACK_OVERFLOW (0x10) is not truncated"
        )


# ─── 2. FSM state ordering ─────────────────────────────────────────────────────

class TestELoadCallFSMOrdering:
    """PUSH_CR5_CR12 must precede PUSH_ARM; PUSH_BOUNDS replaces old PUSH_CHECK."""

    def test_dispatch_before_push_cr5_cr12(self):
        assert _state_def_pos("DISPATCH") < _state_def_pos("PUSH_CR5_CR12")

    def test_push_cr5_cr12_before_push_arm(self):
        assert _state_def_pos("PUSH_CR5_CR12") < _state_def_pos("PUSH_ARM")

    def test_push_arm_before_push_read_sto(self):
        assert _state_def_pos("PUSH_ARM") < _state_def_pos("PUSH_READ_STO")

    def test_push_bounds_between_push_read_sto_and_push_egt(self):
        assert (
            _state_def_pos("PUSH_READ_STO")
            < _state_def_pos("PUSH_BOUNDS")
            < _state_def_pos("PUSH_EGT")
        )

    def test_push_read_sto_transitions_to_push_bounds(self):
        assert _first_next_in_state("PUSH_READ_STO") == "PUSH_BOUNDS"

    def test_push_sto_transitions_to_complete(self):
        assert _first_next_in_state("PUSH_STO") == "COMPLETE"

    def test_dispatch_fast_path_goes_to_push_cr5_cr12(self):
        """call_imm==0 branch in DISPATCH must go to PUSH_CR5_CR12."""
        dispatch_start = _state_def_pos("DISPATCH")
        fetch_method_start = _state_def_pos("FETCH_METHOD_ENTRY")
        dispatch_body = FUSED_SRC[dispatch_start:fetch_method_start]
        parts = dispatch_body.split("with m.Else():")
        assert len(parts) >= 2, "DISPATCH body must contain an if/else split"
        if_branch = parts[0]
        assert '"PUSH_CR5_CR12"' in if_branch, (
            "DISPATCH fast-path (call_imm==0) must transition to PUSH_CR5_CR12"
        )
        assert '"COMPLETE"' not in if_branch

    def test_fetch_method_entry_success_goes_to_push_cr5_cr12(self):
        start = _state_def_pos("FETCH_METHOD_ENTRY")
        end   = _state_def_pos("PUSH_CR5_CR12")
        assert '"PUSH_CR5_CR12"' in FUSED_SRC[start:end]

    def test_push_check_state_removed(self):
        """PUSH_CHECK has been replaced by PUSH_BOUNDS; must not exist."""
        assert 'm.State("PUSH_CHECK")' not in FUSED_SRC, (
            "PUSH_CHECK state found — should have been replaced by PUSH_BOUNDS"
        )

    def test_callee_egt_latched_in_call_p1_done(self):
        """callee_egt_latched must be assigned inside CALL_P1_DONE, not earlier."""
        p1_done_start = _state_def_pos("CALL_P1_DONE")
        call_p2_start = _state_def_pos("CALL_P2")
        window = FUSED_SRC[p1_done_start:call_p2_start]
        assert "callee_egt_latched" in window, (
            "callee_egt_latched must be latched in CALL_P1_DONE (phase-1 CR6 GT)"
        )


# ─── 3. Sentinel return PC ─────────────────────────────────────────────────────

class TestELoadCallSentinelReturnPC:
    def test_sentinel_return_pc_is_3(self):
        assert "_SENTINEL_RETURN_PC = 3" in FUSED_SRC

    def test_sentinel_constant_used_in_frame_word(self):
        assert "Const(_SENTINEL_RETURN_PC, 15)" in FUSED_SRC


# ─── 4. FaultType bit-width ────────────────────────────────────────────────────

class TestFaultTypeValues:
    def test_stack_overflow_value_is_0x10(self):
        assert FaultType.STACK_OVERFLOW == 0x10

    def test_stack_overflow_requires_5_bits(self):
        """0x10 = 16 needs 5 bits; 4-bit truncation → 0 (NONE)."""
        assert FaultType.STACK_OVERFLOW.bit_length() == 5

    def test_stack_corrupt_value_is_0x12(self):
        assert FaultType.STACK_CORRUPT == 0x12

    def test_stack_corrupt_requires_5_bits(self):
        assert FaultType.STACK_CORRUPT.bit_length() == 5


# ─── 5. Frame-word encoding ────────────────────────────────────────────────────

def _run_frame_word(sto_value: int) -> int:
    dut = _FrameWordEncoder()
    results = {}

    async def process(ctx):
        ctx.set(dut.sto_in, sto_value)
        await ctx.tick()
        results["frame_word"] = ctx.get(dut.frame_word)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/dev/null"):
        sim.run()
    return results["frame_word"]


class TestFrameWordEncoding:
    """Behavioral sim: frame word SZ=1, sentinel_pc=3, prev_STO in bits[15:0]."""

    def test_sz_flag_is_set(self):
        fw = _run_frame_word(48)
        assert (fw >> 31) & 1 == 1, f"frame_word[31] (SZ) must be 1; got {fw:#010x}"

    def test_sentinel_return_pc_is_3(self):
        fw = _run_frame_word(48)
        return_pc = (fw >> 16) & 0x7FFF
        assert return_pc == 3, f"frame_word bits[30:16] = {return_pc}, expected 3"

    def test_prev_sto_preserved_in_low_bits(self):
        for sto in (_STO_VALID, 128, 10, 2):
            fw = _run_frame_word(sto)
            prev_sto = fw & 0xFFFF
            assert prev_sto == sto & 0xFFFF

    def test_frame_word_for_sto_valid(self):
        """STO=48 → SZ=1 | sentinel=3 | prev_STO=48."""
        fw = _run_frame_word(_STO_VALID)
        expected = (1 << 31) | (3 << 16) | _STO_VALID
        assert fw == expected, f"got {fw:#010x}, expected {expected:#010x}"


# ─── 6. Full DUT simulation ────────────────────────────────────────────────────
#
# Memory / register layout
# ========================
# CR0  (cr_src=0): Church Inform E+L, c-list base=0x200, limit=0xFF  — caller cap
# CR1  (cr_dst=1): written by mload phase 0; read back in LOAD_DONE
# CR6  (CR_CLIST):  written by mload phase 1 with INFORM_EL_SLOT3 (≠ phase-0 GT)
# CR7  (CR_NUCLEUS): written by mload phase 2
# CR14 (CR_CLOOMC): ns_base=0x600 cap (used for NIA in fast path)
# cr15_namespace:   NS table base=0x500, limit=8 entries
# cr5_heap:         valid Turing Inform R-perm GT; Heap[0] at word1_location=0x400
# cr12_thread:      valid non-null GT; thread lump base at word1_location=0x100
# thread_base:      0x100
# thread_hdr:       _THREAD_HDR (sp_max=51, sp_min=44)
#
# DMEM layout
# ===========
# 0x200  phase-0 c-list GT: INFORM_EL_SLOT2 (0x5A000002)
# 0x520  NS slot 2 word0_location  = 0x700  (lump base for phase-0 result)
# 0x524  NS slot 2 word1_authority = 0xFF
# 0x528  NS slot 2 word2_integrity = 0xDEB1DEEF
# 0x52C  NS slot 2 word3_abstract_gt = 0
# 0x700  phase-1 c-list GT: INFORM_EL_SLOT3 (0x5A000003)  ← DIFFERENT from phase 0
# 0x530  NS slot 3 word0_location  = 0x800  (lump base for phase-1 result)
# 0x534  NS slot 3 word1_authority = 0xFF
# 0x538  NS slot 3 word2_integrity = 0xDEB65EEF
# 0x53C  NS slot 3 word3_abstract_gt = 0
# 0x800  phase-2 c-list GT (m_elevated → NS check bypassed): INFORM_EL_SLOT2
# 0x400  Heap[0] = STO value (parametrised)
#
# Expected writes (STO=48, thread_base=0x100)
# ===========================================
# (0x1BC, 0x5A000003)  callee E-GT at thread_base+(STO-1)*4  ← SLOT3, not SLOT2
# (0x1C0, 0x80030030)  frame word  at thread_base+STO*4     (SZ=1, sentinel=3, prev=48)
# (0x400, 46)          new STO (48-2)


def _run_eloadcall_dut(
    sto_value: int = _STO_VALID,
    cr5_gt: int = _CR5_VALID_GT,
    cr12_gt: int = _CR12_VALID_GT,
    call_imm: int = 0,
    max_ticks: int = 400,
):
    """Run a full ChurchELoadCall DUT simulation.

    Parameters
    ----------
    sto_value : STO word read from Heap[0].
    cr5_gt    : word0_gt for the cr5_heap cap (controls PUSH_CR5_CR12 CR5 check).
    cr12_gt   : word0_gt for the cr12_thread cap (controls PUSH_CR5_CR12 CR12 check).
    call_imm  : 0 = fast path, >0 = indexed method dispatch.

    Returns
    -------
    dict with keys: completed, faulted, fault_type, nia_value, writes
    """
    dut = ChurchELoadCall(enable_seal_check=None)

    # Simulated register file (96-bit values)
    cr_reg = [0] * 16
    cr_reg[0]  = _make_cap(_INFORM_EL_SLOT2, 0x200, 0xFF)   # source cap (caller c-list)
    cr_reg[14] = _make_cap(_INFORM_EL_SLOT2, 0x600, 0xFF)   # CLOOMC cap (ns_base=0x600)

    # Simulated DMEM (sparse: byte_addr → 32-bit word).
    #
    # Phase-0 integrity: integrity32(W0=0x700, W1=0xFF) = 0xDEB1DEEF
    # Phase-1 integrity: integrity32(W0=0x800, W1=0xFF) = 0xDEB65EEF
    # Phase-2 is m_elevated (mload_src=CR_CLIST=6) → bypasses integrity check.
    mem = {
        # Phase 0: caller c-list → INFORM_EL_SLOT2 → NS slot 2
        0x200: _INFORM_EL_SLOT2,
        0x520: 0x700,                # NS slot 2 word0_location (lump base)
        0x524: 0xFF,                 # NS slot 2 word1_authority
        0x528: _NS_INTEGRITY_SLOT2,  # NS slot 2 word2_integrity
        0x52C: 0,                    # NS slot 2 word3_abstract_gt

        # Phase 1: lump c-list → INFORM_EL_SLOT3 (DIFFERENT GT!) → NS slot 3
        0x700: _INFORM_EL_SLOT3,     # ← distinct from phase-0 GT so callee_egt differs
        0x530: 0x800,                # NS slot 3 word0_location
        0x534: 0xFF,                 # NS slot 3 word1_authority
        0x538: _NS_INTEGRITY_SLOT3,  # NS slot 3 word2_integrity
        0x53C: 0,                    # NS slot 3 word3_abstract_gt

        # Phase 2: m_elevated, no integrity check; reuse INFORM_EL_SLOT2 at 0x800
        0x800: _INFORM_EL_SLOT2,

        # Stack read
        0x400: sto_value,            # Heap[0] = STO
    }

    results = {
        "completed":  False,
        "faulted":    False,
        "fault_type": 0,
        "nia_value":  0,
        "writes":     [],
    }

    async def testbench(ctx):
        # Static inputs.
        ctx.set(dut.cr_src,    0)
        ctx.set(dut.cr_dst,    1)
        ctx.set(dut.index,     0)
        ctx.set(dut.call_imm,  call_imm)
        ctx.set(dut.mask,      0)
        ctx.set(dut.thread_base,               0x100)
        ctx.set(dut.thread_hdr,                _THREAD_HDR)
        ctx.set(dut.cr5_heap.as_value(),       _make_cap(cr5_gt,  0x400, 0))
        ctx.set(dut.cr12_thread.as_value(),    _make_cap(cr12_gt, 0x100, 0))
        ctx.set(dut.cr15_namespace.as_value(), _make_cap(0, 0x500, 8))
        ctx.set(dut.pet_name_rd_data,          0)
        ctx.set(dut.mem_rd_valid,              0)
        ctx.set(dut.mem_rd_data,               0)
        ctx.set(dut.cr_rd_data.as_value(),     0)

        # Pulse start for one cycle
        ctx.set(dut.start, 1)
        await ctx.tick()
        ctx.set(dut.start, 0)

        prev_rd_en   = False
        prev_rd_addr = 0

        for _tick in range(max_ticks):
            # 1. Provide CR read data (combinatorial — always valid for current addr).
            cr_addr = ctx.get(dut.cr_rd_addr)
            ctx.set(dut.cr_rd_data.as_value(), cr_reg[cr_addr])

            # 2. Provide memory read data (1-cycle latency model).
            if prev_rd_en:
                ctx.set(dut.mem_rd_valid, 1)
                ctx.set(dut.mem_rd_data,  mem.get(prev_rd_addr, 0))
            else:
                ctx.set(dut.mem_rd_valid, 0)
                ctx.set(dut.mem_rd_data,  0)

            # 3. Advance clock.
            await ctx.tick()

            # 4. Process DUT outputs after clock edge.
            if ctx.get(dut.cr_wr_en):
                wr_addr = ctx.get(dut.cr_wr_addr)
                wr_data = ctx.get(dut.cr_wr_data.as_value())
                cr_reg[wr_addr] = wr_data

            if ctx.get(dut.mem_wr_en):
                results["writes"].append(
                    (ctx.get(dut.mem_wr_addr), ctx.get(dut.mem_wr_data))
                )

            # 5. Check termination.
            if ctx.get(dut.complete):
                results["completed"]  = True
                results["nia_value"]  = ctx.get(dut.nia_value)
                break
            if ctx.get(dut.fault):
                results["faulted"]    = True
                results["fault_type"] = ctx.get(dut.fault_type)
                break

            # 6. Save mem-bus state for next iteration.
            prev_rd_en   = bool(ctx.get(dut.mem_rd_en))
            prev_rd_addr = ctx.get(dut.mem_addr)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    return results


class TestELoadCallDUTFastPath:
    """Full DUT simulation: fast-path (call_imm=0) with STO=48 (within bounds).

    Phase-0 GT = INFORM_EL_SLOT2 (0x5A000002).
    Phase-1 GT = INFORM_EL_SLOT3 (0x5A000003) — different cap.
    callee_egt_latched is taken from CR6 (phase-1 result) = INFORM_EL_SLOT3.
    """

    @pytest.fixture(scope="class")
    def sim_results(self):
        return _run_eloadcall_dut(sto_value=_STO_VALID)

    def test_completes_without_fault(self, sim_results):
        assert sim_results["completed"], (
            "ELOADCALL fast path must complete without fault. "
            f"faulted={sim_results['faulted']}, fault_type={sim_results['fault_type']:#x}"
        )
        assert not sim_results["faulted"]

    def test_three_writes_occurred(self, sim_results):
        assert len(sim_results["writes"]) == 3, (
            f"Expected exactly 3 frame-push writes; got {len(sim_results['writes'])}: "
            f"{sim_results['writes']}"
        )

    def test_first_write_is_callee_egt_phase1_gt(self, sim_results):
        """Write 1: callee E-GT (phase-1 CR6 GT = INFORM_EL_SLOT3) at (STO-1).

        With STO=48, thread_base=0x100:
          addr = 0x100 + (48-1)*4 = 0x100 + 0xBC = 0x1BC

        Critical: data must be INFORM_EL_SLOT3 (0x5A000003), NOT the phase-0
        cap INFORM_EL_SLOT2 (0x5A000002).  The two GTs differ because mem[0x700]
        (phase-1 c-list entry) is distinct from mem[0x200] (phase-0 c-list entry).
        """
        addr, data = sim_results["writes"][0]
        assert addr == 0x1BC, f"callee E-GT addr: expected 0x1BC, got {addr:#x}"
        assert data == _INFORM_EL_SLOT3, (
            f"callee E-GT data: expected INFORM_EL_SLOT3 ({_INFORM_EL_SLOT3:#010x}), "
            f"got {data:#010x}. "
            "If data is 0x5A000002 (INFORM_EL_SLOT2), the fix is incomplete: "
            "callee_egt_latched is still sourced from phase-0 loaded_cap, "
            "not from the phase-1 CR6.word0_gt latch in CALL_P1_DONE."
        )

    def test_second_write_is_frame_word(self, sim_results):
        """Write 2: frame word at thread_base + STO*4 = 0x1C0."""
        addr, data = sim_results["writes"][1]
        assert addr == 0x1C0, f"frame word addr: expected 0x1C0, got {addr:#x}"
        expected_frame = (1 << 31) | (3 << 16) | _STO_VALID   # SZ=1, sentinel=3, prev=48
        assert data == expected_frame, (
            f"frame word: expected {expected_frame:#010x}, got {data:#010x}"
        )

    def test_third_write_is_new_sto(self, sim_results):
        """Write 3: new STO = 48 - 2 = 46 at Heap[0] (0x400)."""
        addr, data = sim_results["writes"][2]
        assert addr == 0x400, f"STO write addr: expected 0x400, got {addr:#x}"
        assert data == _STO_VALID - 2, f"new STO: expected {_STO_VALID - 2}, got {data}"

    def test_nia_is_ns_base_plus_4(self, sim_results):
        """Fast path NIA = ns_base + 4 = 0x600 + 4 = 0x604."""
        assert sim_results["nia_value"] == 0x604, (
            f"NIA: expected 0x604, got {sim_results['nia_value']:#010x}"
        )


class TestELoadCallDUTPushCR5CR12:
    """PUSH_CR5_CR12: null CR5, no-R CR5, null CR12 all fault before any write."""

    @pytest.fixture(scope="class")
    def results_null_cr5(self):
        return _run_eloadcall_dut(sto_value=_STO_VALID, cr5_gt=0)

    @pytest.fixture(scope="class")
    def results_no_r_cr5(self):
        return _run_eloadcall_dut(sto_value=_STO_VALID, cr5_gt=_CR5_VALID_NO_R_GT)

    @pytest.fixture(scope="class")
    def results_null_cr12(self):
        return _run_eloadcall_dut(sto_value=_STO_VALID, cr12_gt=0)

    def test_null_cr5_faults_null_cap(self, results_null_cr5):
        assert results_null_cr5["faulted"], "Null CR5 must fault"
        assert results_null_cr5["fault_type"] == FaultType.NULL_CAP, (
            f"Expected NULL_CAP ({FaultType.NULL_CAP:#x}), "
            f"got {results_null_cr5['fault_type']:#x}"
        )

    def test_null_cr5_no_writes(self, results_null_cr5):
        assert results_null_cr5["writes"] == [], (
            f"Null CR5 fault must produce zero DMEM writes; got {results_null_cr5['writes']}"
        )

    def test_no_r_cr5_faults_perm_r(self, results_no_r_cr5):
        assert results_no_r_cr5["faulted"], "CR5 without R-perm must fault"
        assert results_no_r_cr5["fault_type"] == FaultType.PERM_R, (
            f"Expected PERM_R ({FaultType.PERM_R:#x}), "
            f"got {results_no_r_cr5['fault_type']:#x}"
        )

    def test_no_r_cr5_no_writes(self, results_no_r_cr5):
        assert results_no_r_cr5["writes"] == []

    def test_null_cr12_faults_null_cap(self, results_null_cr12):
        assert results_null_cr12["faulted"], "Null CR12 must fault"
        assert results_null_cr12["fault_type"] == FaultType.NULL_CAP, (
            f"Expected NULL_CAP ({FaultType.NULL_CAP:#x}), "
            f"got {results_null_cr12['fault_type']:#x}"
        )

    def test_null_cr12_no_writes(self, results_null_cr12):
        assert results_null_cr12["writes"] == []


class TestELoadCallDUTPushBoundsCorrupt:
    """PUSH_BOUNDS: STO > sp_max triggers STACK_CORRUPT, no writes."""

    @pytest.fixture(scope="class")
    def sim_results(self):
        return _run_eloadcall_dut(sto_value=_STO_CORRUPT)

    def test_faults(self, sim_results):
        assert sim_results["faulted"], (
            f"STO={_STO_CORRUPT} > sp_max={_SP_MAX} must trigger a fault"
        )
        assert not sim_results["completed"]

    def test_fault_type_is_stack_corrupt(self, sim_results):
        ftype = sim_results["fault_type"]
        assert ftype == FaultType.STACK_CORRUPT, (
            f"STO={_STO_CORRUPT} fault_type={ftype:#x}, "
            f"expected STACK_CORRUPT ({FaultType.STACK_CORRUPT:#x}). "
            "Ensure PUSH_BOUNDS upper-bound check (STO > sp_max) is implemented."
        )

    def test_no_dmem_writes(self, sim_results):
        """STACK_CORRUPT must not corrupt DMEM — no writes should occur."""
        assert sim_results["writes"] == [], (
            f"STACK_CORRUPT must produce zero DMEM writes; got {sim_results['writes']}"
        )


class TestELoadCallDUTPushBoundsOverflow:
    """PUSH_BOUNDS: STO < sp_min triggers STACK_OVERFLOW, no writes.

    Also catches the old 4-bit truncation bug: Signal(4) drops bit4 of 0x10
    (STACK_OVERFLOW), producing fault_type=0x0 (NONE).
    """

    @pytest.fixture(scope="class")
    def sim_results(self):
        return _run_eloadcall_dut(sto_value=_STO_OVERFLOW)

    def test_faults(self, sim_results):
        assert sim_results["faulted"], (
            f"STO={_STO_OVERFLOW} < sp_min={_SP_MIN} must trigger a fault"
        )
        assert not sim_results["completed"]

    def test_fault_type_is_stack_overflow(self, sim_results):
        ftype = sim_results["fault_type"]
        assert ftype == FaultType.STACK_OVERFLOW, (
            f"STO={_STO_OVERFLOW} fault_type={ftype:#x}, "
            f"expected STACK_OVERFLOW ({FaultType.STACK_OVERFLOW:#x}). "
            "If fault_type=0x0 (NONE), Signal(4) truncation of 0x10 is still present."
        )

    def test_no_dmem_writes(self, sim_results):
        assert sim_results["writes"] == [], (
            f"STACK_OVERFLOW must produce zero DMEM writes; got {sim_results['writes']}"
        )
