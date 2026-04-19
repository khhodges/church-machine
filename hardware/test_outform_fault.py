"""Negative test: injecting a corrupt outform lump causes a visible fault code
and the outform FSM returns to IDLE so the machine is not permanently wedged.

Tests the full fault chain:
  ChurchOutformIoT → outform_fault / outform_fault_type
  ChurchMLoad (WAIT_OUTFORM path) → sub_fault_type, FAULT → IDLE

Run with:  python -m hardware.test_outform_fault
"""

import sys
from amaranth import *
from amaranth.sim import Simulator

from .outform_iot import ChurchOutformIoT
from .mload import ChurchMLoad
from .hw_types import FaultType

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TUNNEL_REQ_LEN = 6   # outform sends 6 bytes (gt_raw 4B + slot_id 2B)
IOT_HDR_LEN    = 8   # lean header: 4B payload_len + 4B CRC-32


def _pack32_le(v):
    return [(v >> (8 * i)) & 0xFF for i in range(4)]


# ---------------------------------------------------------------------------
# GT / CAP_REG helper constants
# (derived from layouts.py GT_LAYOUT / CAP_REG_LAYOUT / hw_types.py)
# GT_LAYOUT (word0, 32 bits):
#   [15:0]  slot_id   (16 bits)
#   [22:16] gt_seq    ( 7 bits)
#   [24:23] gt_type   ( 2 bits)  GT_TYPE_INFORM=1, GT_TYPE_OUTFORM=2
#   [30:25] perms     ( 6 bits)  PERM_L is bit index 3 within perms
#   [31]    b_flag    ( 1 bit )
# CAP_REG_LAYOUT (128 bits):
#   [31:0]   word0_gt
#   [63:32]  word1_location
#   [95:64]  word2_w2   (WORD2_LAYOUT: limit_offset[20:0] | gt_seq[6:0] | spare[3:0])
#   [127:96] word3_w3
# ---------------------------------------------------------------------------

_GT_TYPE_INFORM  = 0b01
_GT_TYPE_OUTFORM = 0b10
_PERM_L          = 3      # bit position within the perms field


def _word0_gt(gt_type, slot_id=1, perms=0):
    """Pack a 32-bit GT word."""
    return (
        (slot_id & 0xFFFF)
        | ((gt_type & 0x3) << 23)
        | ((perms   & 0x3F) << 25)
    )


def _cap_reg(word0_gt, word1_location=0, word2_w2=0, word3_w3=0):
    """Pack a 128-bit CAP_REG value."""
    return (
          (word0_gt & 0xFFFFFFFF)
        | ((word1_location & 0xFFFFFFFF) << 32)
        | ((word2_w2       & 0xFFFFFFFF) << 64)
        | ((word3_w3       & 0xFFFFFFFF) << 96)
    )


# ---------------------------------------------------------------------------
# Test 1: ChurchOutformIoT raises OUTFORM_CRC on a bad CRC lump
# ---------------------------------------------------------------------------

def test_outform_iot_crc_fault():
    """The outform IoT unit should raise outform_fault with OUTFORM_CRC when
    the received lump's CRC-32 doesn't match the stored CRC, and it must
    return to IDLE (outform_busy=0) so the processor isn't wedged."""

    dut = ChurchOutformIoT()

    results = {}

    async def testbench(ctx):
        # ── Reset / initial state ──────────────────────────────────────────
        ctx.set(dut.outform_start, 0)
        ctx.set(dut.tx_ack,        0)
        ctx.set(dut.rx_valid,      0)
        ctx.set(dut.rx_data,       0)
        ctx.set(dut.alloc_done,    0)
        ctx.set(dut.alloc_fault,   0)
        ctx.set(dut.alloc_base,    0x1000)
        ctx.set(dut.mint_done,     0)
        ctx.set(dut.mint_fault,    0)
        ctx.set(dut.gt_raw,        0xDEADBEEF)
        ctx.set(dut.slot_id,       0x0001)
        await ctx.tick()

        # ── Trigger start ─────────────────────────────────────────────────
        ctx.set(dut.outform_start, 1)
        await ctx.tick()
        ctx.set(dut.outform_start, 0)

        # ── TUNNEL_HUNT: ack all 6 TX bytes ──────────────────────────────
        for _ in range(TUNNEL_REQ_LEN):
            ctx.set(dut.tx_ack, 1)
            await ctx.tick()
        ctx.set(dut.tx_ack, 0)

        # ── TUNNEL_CONNECT: send one RX byte so FSM enters RECV_HDR_LEAN ─
        ctx.set(dut.rx_valid, 1)
        ctx.set(dut.rx_data,  0x00)
        await ctx.tick()
        ctx.set(dut.rx_valid, 0)
        await ctx.tick()

        # ── RECV_HDR_LEAN: send 8-byte lean header ────────────────────────
        # payload_len = 256 (0x100) — 64 words, n=6 → valid
        # CRC stored  = 0xDEADBEEF  (deliberately wrong)
        payload_len = 64 * 4       # 256 bytes
        bad_crc     = 0xDEADBEEF
        hdr_bytes   = _pack32_le(payload_len) + _pack32_le(bad_crc)
        for b in hdr_bytes:
            ctx.set(dut.rx_valid, 1)
            ctx.set(dut.rx_data,  b)
            await ctx.tick()
        ctx.set(dut.rx_valid, 0)
        await ctx.tick()

        # ── DERIVE_N / ALLOC: wait for alloc request then ack it ─────────
        # Give a few cycles for DERIVE_N → ALLOC transition.
        for _ in range(3):
            await ctx.tick()

        # Ack the alloc (we're in ALLOC state, base = 0x1000).
        ctx.set(dut.alloc_done, 1)
        await ctx.tick()
        ctx.set(dut.alloc_done, 0)

        # ── RECV_PAYLOAD: send 256 bytes of payload (all zeros) ───────────
        for _ in range(payload_len):
            ctx.set(dut.rx_valid, 1)
            ctx.set(dut.rx_data,  0x00)
            await ctx.tick()
        ctx.set(dut.rx_valid, 0)
        await ctx.tick()

        # ── CHECK_CRC32: one cycle for the check ──────────────────────────
        # The CRC of 256 zero bytes != 0xDEADBEEF, so fault fires.
        for _ in range(3):
            await ctx.tick()

        results["fault"]      = ctx.get(dut.outform_fault)
        results["fault_type"] = ctx.get(dut.outform_fault_type)
        results["busy"]       = ctx.get(dut.outform_busy)

        # Wait a couple more ticks — FSM must have returned to IDLE.
        for _ in range(3):
            await ctx.tick()
        results["busy_after"] = ctx.get(dut.outform_busy)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)

    with sim.write_vcd("/dev/null"):
        sim.run()

    ok = True
    print("=== Test 1: outform IoT CRC fault recovery ===")
    print(f"  outform_fault_type : {results.get('fault_type')} "
          f"(expected {int(FaultType.OUTFORM_CRC)} = OUTFORM_CRC)")
    print(f"  outform_busy after : {results.get('busy_after')} (expected 0 = not wedged)")

    if results.get("fault_type") != int(FaultType.OUTFORM_CRC):
        print("FAIL: wrong fault type — expected OUTFORM_CRC (0x15).")
        ok = False
    if results.get("busy_after") != 0:
        print("FAIL: outform_busy still high — processor is wedged!")
        ok = False
    if ok:
        print("PASS")
    return ok


# ---------------------------------------------------------------------------
# Test 2: ChurchMLoad WAIT_OUTFORM → FAULT → IDLE with correct fault type
#
# The FSM is driven step-by-step through:
#   IDLE → FETCH_SRC → CHECK_L → CHECK_BOUNDS → FETCH_GT
#          → TRIGGER_OUTFORM → WAIT_OUTFORM
# then outform_fault_in is asserted with OUTFORM_MINT, and the test verifies:
#   - sub_fault_type == OUTFORM_MINT
#   - sub_fault fires for exactly one cycle
#   - sub_busy falls to 0 (IDLE) within a bounded number of cycles
# ---------------------------------------------------------------------------

def test_mload_wait_outform_fault_type():
    """Walk ChurchMLoad into WAIT_OUTFORM then inject an outform fault.

    Verifies that:
    1. The specific fault code (OUTFORM_MINT) is propagated to sub_fault_type.
    2. sub_fault fires during the FAULT state.
    3. The FSM returns to IDLE (sub_busy=0) — no permanent wedge.
    """

    dut = ChurchMLoad(enable_seal_check=False)
    results = {}

    # Build a valid source capability (c-list register) in dict form
    # (required by Amaranth 0.5.x ctx.set() for StructLayout signals):
    #   gt_type = INFORM (non-null), PERM_L set, location = 0x00010000,
    #   word2_w2 limit_offset = 100 (so index 0 is in-bounds).
    _perms_with_L = 1 << _PERM_L        # perms field value with PERM_L bit
    _src_cap_dict = {
        "word0_gt": {
            "slot_id": 1,
            "gt_seq":  0,
            "gt_type": _GT_TYPE_INFORM,
            "perms":   _perms_with_L,
            "b_flag":  0,
        },
        "word1_location": 0x00010000,   # c-list base address
        "word2_w2":       100,          # limit_offset = 100 → index 0 in bounds
        "word3_w3":       0,
    }

    # Build the outform GT word (plain integer; mem_rd_data is Signal(32)).
    # gt_type bits [24:23] = GT_TYPE_OUTFORM = 0b10 → bit 24 = 1, bit 23 = 0
    _outform_gt_word = _word0_gt(gt_type=_GT_TYPE_OUTFORM, slot_id=2)

    async def testbench(ctx):
        # ── Set up background signals ──────────────────────────────────────
        ctx.set(dut.cr_rd_data,         _src_cap_dict)   # CR read returns src cap
        ctx.set(dut.mem_rd_data,        _outform_gt_word)  # memory returns outform GT
        ctx.set(dut.mem_rd_valid,       1)               # memory always ready
        ctx.set(dut.cr15_namespace,     {
            "word0_gt": {"slot_id": 0, "gt_seq": 0, "gt_type": 0, "perms": 0, "b_flag": 0},
            "word1_location": 0, "word2_w2": 0, "word3_w3": 0,
        })                                               # namespace cap (unused here)
        ctx.set(dut.sub_m_elevated,     0)
        ctx.set(dut.sub_index,          0)
        ctx.set(dut.sub_cr_src,         0)
        ctx.set(dut.sub_cr_dst,         1)
        ctx.set(dut.sub_direct,         0)
        ctx.set(dut.gbit_reset_done,    1)
        ctx.set(dut.outform_fault_in,   0)
        ctx.set(dut.outform_fault_type_in, 0)
        ctx.set(dut.outform_done_in,    0)

        # Settle in IDLE.
        await ctx.tick()

        # ── IDLE: assert sub_start for one cycle ──────────────────────────
        ctx.set(dut.sub_start, 1)
        await ctx.tick()
        # After tick: FSM = FETCH_SRC; cr_src_reg=0, direct_mode=0 latched.
        ctx.set(dut.sub_start, 0)

        # ── FETCH_SRC: cr_rd_data is captured → src_cap latched ───────────
        await ctx.tick()
        # After tick: FSM = CHECK_L; src_cap = _src_cap_val.

        # ── CHECK_L: not null, has PERM_L → pass ──────────────────────────
        await ctx.tick()
        # After tick: FSM = CHECK_BOUNDS.

        # ── CHECK_BOUNDS: index 0 < limit 100 → pass ──────────────────────
        await ctx.tick()
        # After tick: FSM = FETCH_GT.

        # ── FETCH_GT: mem_rd_valid=1, mem_rd_data[23:24]=OUTFORM → branch ─
        await ctx.tick()
        # After tick: FSM = TRIGGER_OUTFORM; outform regs latched.

        # ── TRIGGER_OUTFORM: pure pass-through → WAIT_OUTFORM ─────────────
        await ctx.tick()
        # After tick: FSM = WAIT_OUTFORM.

        # ── Assert outform fault BEFORE the next tick (WAIT_OUTFORM cycle) ─
        ctx.set(dut.outform_fault_in,      1)
        ctx.set(dut.outform_fault_type_in, int(FaultType.OUTFORM_MINT))
        await ctx.tick()
        # After tick: FSM = FAULT; fault_type_reg = OUTFORM_MINT (sync write).
        ctx.set(dut.outform_fault_in,      0)
        ctx.set(dut.outform_fault_type_in, 0)

        # During the FAULT cycle sub_fault (combinatorial) = 1 and
        # sub_fault_type = fault_type_reg = OUTFORM_MINT.
        results["sub_fault"]      = ctx.get(dut.sub_fault)
        results["sub_fault_type"] = ctx.get(dut.sub_fault_type)

        await ctx.tick()
        # After tick: FSM = IDLE; FAULT state unconditionally → IDLE.
        results["sub_busy_after"] = ctx.get(dut.sub_busy)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)

    with sim.write_vcd("/dev/null"):
        sim.run()

    ok = True
    print("\n=== Test 2: mLoad WAIT_OUTFORM → FAULT path (specific fault type) ===")
    print(f"  sub_fault      : {results.get('sub_fault')} (expected 1 during FAULT state)")
    print(f"  sub_fault_type : {results.get('sub_fault_type')} "
          f"(expected {int(FaultType.OUTFORM_MINT)} = OUTFORM_MINT)")
    print(f"  sub_busy after : {results.get('sub_busy_after')} (expected 0 = IDLE)")

    if results.get("sub_fault") != 1:
        print("FAIL: sub_fault was not asserted during the FAULT state.")
        ok = False
    if results.get("sub_fault_type") != int(FaultType.OUTFORM_MINT):
        print(
            f"FAIL: sub_fault_type = {results.get('sub_fault_type')}, "
            f"expected {int(FaultType.OUTFORM_MINT)} (OUTFORM_MINT)."
        )
        ok = False
    if results.get("sub_busy_after") != 0:
        print("FAIL: mLoad still busy after FAULT — machine is wedged!")
        ok = False
    if ok:
        print("PASS")
    return ok


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    all_ok = True
    all_ok &= test_outform_iot_crc_fault()
    all_ok &= test_mload_wait_outform_fault_type()

    if all_ok:
        print("\nAll outform fault-recovery tests passed.")
    else:
        print("\nSome tests FAILED.")
        sys.exit(1)
