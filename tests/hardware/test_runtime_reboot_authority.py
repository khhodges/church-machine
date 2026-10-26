"""Small RTL checks complement the full-top exact-image UART replay."""
import hashlib
import json
from pathlib import Path
from amaranth.sim import Simulator
from hardware.registers import ChurchRegisters
from hardware.wukong_top import TraceEventDecoder


def test_exact_candidate_core_reboot():
    from scripts.probe_runtime_reboot_core import probe
    probe()  # Includes cold/warm equality, shadow difference and endpoint checks.


def test_retained_physical_reboot_snapshots_and_shadow():
    path = Path(__file__).resolve().parents[2] / (
        "docs/phase-1/reload-evidence/new-layout-amoeba-runtime/"
        "physical-runtime-reload-events.json")
    raw = path.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == (
        "b41d05a56e4cbf498ef7a6bdfaff8104ba8e644b821f830edc81a91ea9c57d00")
    events = json.loads(raw)["events"]
    before_upload = [e for e in events if e.get("snapshot") and e["nia"] == 4]
    assert len(before_upload) == 3  # Two reboot snapshots and the later STOP.
    for snapshot in before_upload:
        assert snapshot["crc_valid"] and not snapshot["m_flag"]
        assert snapshot["cr"][:15] == [[0, 0, 0]] * 15
        assert snapshot["cr"][15] == [0x1a2e0001, 0, 0x05c000ff]
    packets = {e["bridge_trace_counter"]: e for e in events
               if "bridge_trace_counter" in e}
    assert set(packets) == set(range(1, 40))
    assert packets[7]["nia"] == packets[8]["nia"] == 0x3504
    assert packets[7]["ev_type"] == 1
    assert packets[7]["payload_gt"] == 0x4a000011
    assert packets[8]["ev_type"] == 2 and packets[8]["payload_gt"] == 0


def test_reset_clears_descriptor_words_and_m_authority():
    regs = ChurchRegisters()
    sim = Simulator(regs)
    sim.add_clock(1e-6)

    async def bench(ctx):
        for index in range(16):
            ctx.set(regs.cr_word_wr_en, 1)
            ctx.set(regs.cr_word_wr_addr, index)
            for word, value in enumerate((0x4a000011, 0x2ff8, 1)):
                ctx.set(regs.cr_word_sel, word)
                ctx.set(regs.cr_word_wr_data, value)
                await ctx.tick()
        ctx.set(regs.m_bit_device_wr_en, 1)
        ctx.set(regs.m_bit_device_word, 0xffff)
        await ctx.tick()
        assert ctx.get(regs.m_bit_device_state) == 0xffff
        ctx.set(regs.clear_all, 1)
        await ctx.tick()
        # Reset must beat simultaneous ordinary descriptor and M-bit writes.
        assert ctx.get(regs.m_bit_device_state) == 0
        assert all(ctx.get(w) == 0 for row in regs.debug_cr_words for w in row)

    sim.add_testbench(bench)
    sim.run()


def test_skipped_load_word_is_still_labelled_load_by_trace_decoder():
    decoder = TraceEventDecoder()
    sim = Simulator(decoder)

    async def bench(ctx):
        ctx.set(decoder.instr, 2)  # Exact word at candidate byte 0x3504: LOAD.EQ
        ctx.set(decoder.load_shadow_gt, 0x4a000011)
        ctx.set(decoder.load_new_gt, 0)
        assert ctx.get(decoder.event_count) == 2
        assert ctx.get(decoder.event_type[0]) == 1
        assert ctx.get(decoder.event_data[0]) == 0x4a000011
        assert ctx.get(decoder.event_type[1]) == 2
        assert ctx.get(decoder.event_data[1]) == 0

    sim.add_testbench(bench)
    sim.run()
