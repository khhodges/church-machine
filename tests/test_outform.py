"""
Simulation tests for ChurchOutform lazy-load FSM.

Scenarios:
  1. STORE golden path  — valid 32-byte header, n=6, STORE inflate, correct CRC
  2. Bad signature      — sig != 0x04034B50                       -> OUTFORM_FAULT_SIG
  3. Flags bit-3 set    — streaming mode                          -> OUTFORM_FAULT_FLAGS
  4. Bad n              — ucomp_size not power-of-2 word count    -> OUTFORM_FAULT_N
  5. CRC mismatch       — inflated CRC != stored CRC              -> OUTFORM_FAULT_CRC32
  6. Allocator fault    — alloc_fault asserted                    -> OUTFORM_FAULT_ALLOC
  7. Mint fault         — mint_fault asserted                     -> OUTFORM_FAULT_MINT
"""

import sys
import os
import zlib
import struct
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from amaranth import *
from amaranth.sim import Simulator

from hardware.outform import (
    ChurchOutform,
    OUTFORM_FAULT_SIG, OUTFORM_FAULT_FLAGS, OUTFORM_FAULT_METHOD,
    OUTFORM_FAULT_N, OUTFORM_FAULT_CRC32, OUTFORM_FAULT_ALLOC, OUTFORM_FAULT_MINT,
    ZIP_SIGNATURE, METHOD_STORE, METHOD_DEFLATE, HDR_LEN, TUNNEL_REQ_LEN,
)

MAX_TICKS = 8000


# ── Header construction ───────────────────────────────────────────────────────

def build_header(
    sig=ZIP_SIGNATURE,
    flags=0x0000,
    method=METHOD_STORE,
    crc32=0x00000000,
    comp_size=256,
    ucomp_size=256,
    fname_len=0,
    extra_len=0,
):
    """32-byte outform tunnel header (task-spec layout, CRC at offset 16)."""
    hdr  = struct.pack("<I", sig & 0xFFFFFFFF)        # 0-3  signature
    hdr += struct.pack("<H", 0x0014)                  # 4-5  version needed 2.0
    hdr += struct.pack("<H", flags & 0xFFFF)          # 6-7  GP bit flag
    hdr += struct.pack("<H", method & 0xFFFF)         # 8-9  compression method
    hdr += struct.pack("<I", 0x00000000)              # 10-13 mod time + date
    hdr += struct.pack("<H", 0x0000)                  # 14-15 reserved
    hdr += struct.pack("<I", crc32 & 0xFFFFFFFF)      # 16-19 CRC-32
    hdr += struct.pack("<I", comp_size & 0xFFFFFFFF)  # 20-23 compressed size
    hdr += struct.pack("<I", ucomp_size & 0xFFFFFFFF) # 24-27 uncompressed size
    hdr += struct.pack("<H", fname_len & 0xFFFF)      # 28-29 filename length L
    hdr += struct.pack("<H", extra_len & 0xFFFF)      # 30-31 extra field length E
    assert len(hdr) == HDR_LEN
    return hdr


def crc32_of(data: bytes) -> int:
    return zlib.crc32(data) & 0xFFFFFFFF


# ── Simulation helpers ────────────────────────────────────────────────────────

async def send_bytes(ctx, dut, data: bytes):
    """Feed data bytes one at a time (rx_valid=1 for one cycle, 0 for one cycle)."""
    for b in data:
        ctx.set(dut.rx_valid, 1)
        ctx.set(dut.rx_data, int(b))
        await ctx.tick()
        ctx.set(dut.rx_valid, 0)
        await ctx.tick()


async def drain_tx_phase(ctx, dut):
    """Wait for TUNNEL_CONNECT to finish (tx_valid drops back to 0)."""
    for _ in range(20):
        await ctx.tick()
        if ctx.get(dut.tx_valid):
            break
    for _ in range(MAX_TICKS):
        if not ctx.get(dut.tx_valid):
            return
        await ctx.tick()
    raise AssertionError("drain_tx_phase: timed out")


async def wait_inflate_ready(ctx, dut, max_ticks=20):
    """After alloc_done, wait until FSM has entered INFLATE (busy & not alloc_req)."""
    for _ in range(max_ticks):
        await ctx.tick()
        req = ctx.get(dut.alloc_req)
        if not req:
            return
    raise AssertionError("wait_inflate_ready: still in ALLOC after many ticks")


async def respond_alloc(ctx, dut, base_addr):
    """Poll for alloc_req, respond with alloc_done, then wait for INFLATE entry."""
    for _ in range(MAX_TICKS):
        await ctx.tick()
        if ctx.get(dut.alloc_req):
            ctx.set(dut.alloc_base, base_addr)
            ctx.set(dut.alloc_done, 1)
            await ctx.tick()
            ctx.set(dut.alloc_done, 0)
            for _ in range(6):
                await ctx.tick()
            return
    raise AssertionError("respond_alloc: timed out waiting for alloc_req")


async def respond_alloc_fault(ctx, dut):
    """Poll for alloc_req, respond with alloc_fault for one cycle."""
    for _ in range(MAX_TICKS):
        await ctx.tick()
        if ctx.get(dut.alloc_req):
            ctx.set(dut.alloc_fault, 1)
            await ctx.tick()
            ctx.set(dut.alloc_fault, 0)
            return
    raise AssertionError("respond_alloc_fault: timed out")


async def respond_mint_done(ctx, dut, result_gt_val):
    """Poll for mint_call then respond with mint_done + mint_result_gt.

    Checks BEFORE the first tick: mint_call is a 1-clock combinatorial pulse
    (asserted only while the FSM is in MINT state).  The FSM may already be in
    MINT when this helper is called, so ticking first would miss it.
    """
    for _ in range(MAX_TICKS + 1):
        if ctx.get(dut.mint_call):
            ctx.set(dut.mint_result_gt, result_gt_val)
            ctx.set(dut.mint_done, 1)
            await ctx.tick()  # FSM: MINT → MINT_WAIT (mint_done=1 held)
            await ctx.tick()  # FSM: MINT_WAIT → COMPLETE (mint_done=1 visible)
            ctx.set(dut.mint_done, 0)
            return
        await ctx.tick()
    raise AssertionError("respond_mint_done: timed out waiting for mint_call")


async def respond_mint_fault(ctx, dut):
    """Poll for mint_call then assert mint_fault for one cycle.

    Checks BEFORE the first tick for the same reason as respond_mint_done.
    """
    for _ in range(MAX_TICKS + 1):
        if ctx.get(dut.mint_call):
            ctx.set(dut.mint_fault, 1)
            await ctx.tick()  # FSM: MINT → MINT_WAIT (mint_fault=1 held)
            await ctx.tick()  # FSM: MINT_WAIT → FAULT (mint_fault=1 visible)
            ctx.set(dut.mint_fault, 0)
            return
        await ctx.tick()
    raise AssertionError("respond_mint_fault: timed out waiting for mint_call")


async def wait_terminal(ctx, dut):
    """Wait for outform_done or outform_fault; return (done, fault, fault_type, result_gt).

    Checks BEFORE the first tick because FAULT/COMPLETE are 1-clock combinatorial
    pulses; the caller may already be at the terminal state on entry.
    """
    for _ in range(MAX_TICKS + 1):
        done  = ctx.get(dut.outform_done)
        fault = ctx.get(dut.outform_fault)
        if done or fault:
            ftype = ctx.get(dut.outform_fault_type)
            rgt   = ctx.get(dut.result_gt)
            return done, fault, ftype, rgt
        await ctx.tick()
    raise AssertionError("wait_terminal: timed out without COMPLETE or FAULT")


# ── Scenario 1: STORE golden path ────────────────────────────────────────────

def test_store_golden():
    """n=6 (256 bytes), valid header, correct CRC, Mint succeeds."""
    payload = bytes(range(256))
    crc     = crc32_of(payload)
    hdr     = build_header(crc32=crc, comp_size=256, ucomp_size=256)
    dut     = ChurchOutform()

    async def process(ctx):
        ctx.set(dut.gt_raw, 0xDEADBEEF)
        ctx.set(dut.slot_id, 7)
        ctx.set(dut.outform_start, 1)
        await ctx.tick()
        ctx.set(dut.outform_start, 0)

        await drain_tx_phase(ctx, dut)
        await send_bytes(ctx, dut, hdr)
        await respond_alloc(ctx, dut, 0x10000)
        await send_bytes(ctx, dut, payload)
        await respond_mint_done(ctx, dut, 0xCAFEF00D)

        done, fault, ftype, rgt = await wait_terminal(ctx, dut)
        assert done  == 1,          f"expected outform_done, got done={done} fault={fault} ftype={ftype:#x}"
        assert fault == 0,          f"unexpected outform_fault ftype={ftype:#x}"
        assert rgt   == 0xCAFEF00D, f"result_gt=0x{rgt:08X}"

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/outform_golden.vcd"):
        sim.run()
    print("PASS: test_store_golden")


# ── Scenario 2: Bad signature ─────────────────────────────────────────────────

def test_bad_sig():
    hdr = build_header(sig=0xDEADBEEF)
    dut = ChurchOutform()

    async def process(ctx):
        ctx.set(dut.outform_start, 1)
        await ctx.tick()
        ctx.set(dut.outform_start, 0)
        await drain_tx_phase(ctx, dut)
        await send_bytes(ctx, dut, hdr)

        done, fault, ftype, _ = await wait_terminal(ctx, dut)
        assert fault == 1,                 f"expected fault, got done={done}"
        assert ftype == OUTFORM_FAULT_SIG, f"fault_type=0x{ftype:02X}"

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/outform_badsig.vcd"):
        sim.run()
    print("PASS: test_bad_sig")


# ── Scenario 3: Flags bit-3 set ───────────────────────────────────────────────

def test_flags_bit3():
    hdr = build_header(flags=0x0008)
    dut = ChurchOutform()

    async def process(ctx):
        ctx.set(dut.outform_start, 1)
        await ctx.tick()
        ctx.set(dut.outform_start, 0)
        await drain_tx_phase(ctx, dut)
        await send_bytes(ctx, dut, hdr)

        done, fault, ftype, _ = await wait_terminal(ctx, dut)
        assert fault == 1,                   f"expected fault, got done={done}"
        assert ftype == OUTFORM_FAULT_FLAGS, f"fault_type=0x{ftype:02X}"

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/outform_flags.vcd"):
        sim.run()
    print("PASS: test_flags_bit3")


# ── Scenario 4: Bad n ─────────────────────────────────────────────────────────

def test_bad_n():
    # word_count = 260/4 = 65 — not a power of 2
    hdr = build_header(ucomp_size=260, comp_size=260)
    dut = ChurchOutform()

    async def process(ctx):
        ctx.set(dut.outform_start, 1)
        await ctx.tick()
        ctx.set(dut.outform_start, 0)
        await drain_tx_phase(ctx, dut)
        await send_bytes(ctx, dut, hdr)

        done, fault, ftype, _ = await wait_terminal(ctx, dut)
        assert fault == 1,                "expected fault, got done={done}"
        assert ftype == OUTFORM_FAULT_N,  f"fault_type=0x{ftype:02X}"

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/outform_badn.vcd"):
        sim.run()
    print("PASS: test_bad_n")


# ── Scenario 5: CRC mismatch ──────────────────────────────────────────────────

def test_crc_mismatch():
    payload = bytes(range(256))
    bad_crc = 0xDEADC0DE
    hdr     = build_header(crc32=bad_crc, comp_size=256, ucomp_size=256)
    dut     = ChurchOutform()

    async def process(ctx):
        ctx.set(dut.outform_start, 1)
        await ctx.tick()
        ctx.set(dut.outform_start, 0)
        await drain_tx_phase(ctx, dut)
        await send_bytes(ctx, dut, hdr)
        await respond_alloc(ctx, dut, 0x20000)
        await send_bytes(ctx, dut, payload)

        done, fault, ftype, _ = await wait_terminal(ctx, dut)
        assert fault == 1,                    f"expected fault, got done={done}"
        assert ftype == OUTFORM_FAULT_CRC32,  f"fault_type=0x{ftype:02X}"

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/outform_crc.vcd"):
        sim.run()
    print("PASS: test_crc_mismatch")


# ── Scenario 6: Allocator fault ───────────────────────────────────────────────

def test_alloc_fault():
    hdr = build_header(ucomp_size=256, comp_size=256)
    dut = ChurchOutform()

    async def process(ctx):
        ctx.set(dut.outform_start, 1)
        await ctx.tick()
        ctx.set(dut.outform_start, 0)
        await drain_tx_phase(ctx, dut)
        await send_bytes(ctx, dut, hdr)
        await respond_alloc_fault(ctx, dut)

        done, fault, ftype, _ = await wait_terminal(ctx, dut)
        assert fault == 1,                   f"expected fault, got done={done}"
        assert ftype == OUTFORM_FAULT_ALLOC, f"fault_type=0x{ftype:02X}"

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/outform_alloc.vcd"):
        sim.run()
    print("PASS: test_alloc_fault")


# ── Scenario 7: Mint fault ────────────────────────────────────────────────────

def test_mint_fault():
    payload = bytes(range(256))
    crc     = crc32_of(payload)
    hdr     = build_header(crc32=crc, comp_size=256, ucomp_size=256)
    dut     = ChurchOutform()

    async def process(ctx):
        ctx.set(dut.outform_start, 1)
        await ctx.tick()
        ctx.set(dut.outform_start, 0)
        await drain_tx_phase(ctx, dut)
        await send_bytes(ctx, dut, hdr)
        await respond_alloc(ctx, dut, 0x30000)
        await send_bytes(ctx, dut, payload)
        await respond_mint_fault(ctx, dut)

        done, fault, ftype, _ = await wait_terminal(ctx, dut)
        assert fault == 1,                  f"expected fault, got done={done}"
        assert ftype == OUTFORM_FAULT_MINT, f"fault_type=0x{ftype:02X}"

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/outform_mint.vcd"):
        sim.run()
    print("PASS: test_mint_fault")


if __name__ == "__main__":
    test_store_golden()
    test_bad_sig()
    test_flags_bit3()
    test_bad_n()
    test_crc_mismatch()
    test_alloc_fault()
    test_mint_fault()
    print("\nAll ChurchOutform tests passed.")
