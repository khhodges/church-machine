"""Offline full-image transfer through the exact retry BIT's upload FSM.

Runs the frozen production state helper, not a rewritten protocol model.
It exercises decoded UART bytes, not serial pins, CPU execution, or a board.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
from types import SimpleNamespace


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    args = parser.parse_args()
    source = args.source.resolve()
    top_path = source / "hardware/wukong_top.py"
    digest = hashlib.sha256(top_path.read_bytes()).hexdigest()
    expected = "e53518f1c77869d1a880d567626d04fc27e7b847f0e9d7ff4590d366d30a1779"
    if digest != expected:
        raise ValueError("Upload source is not the frozen tested retry source")
    raw = args.image.read_bytes()
    if len(raw) != 65536:
        raise ValueError("Expected a complete 64 KiB image")
    words = struct.unpack("<16384I", raw)
    frame = struct.pack(">I", len(raw)) + struct.pack(">16384I", *words)

    sys.path.insert(0, str(source))
    from amaranth import Elaboratable, Module, Signal
    from amaranth.sim import Simulator
    import hardware.wukong_top as top
    if Path(top.__file__).resolve() != top_path:
        raise ValueError("Frozen import isolation failed")

    class Harness(Elaboratable):
        def __init__(self):
            self.start = Signal()
            self.rx = SimpleNamespace(valid=Signal(), data=Signal(8))
            self.wr = Signal()
            self.addr = Signal(14)
            self.data = Signal(32)
            self.ack = Signal()
            self.accept = Signal()

        def elaborate(self, platform):
            m = Module()
            count = Signal(2)
            with m.FSM():
                with m.State("IDLE"):
                    with m.If(self.start):
                        m.d.sync += count.eq(0)
                        m.next = "UPLOAD_LEN"
                top._add_upload_fsm_states(
                    m, uart_valid=self.rx.valid, uart_data=self.rx.data,
                    up_len_bytes=[Signal(8) for _ in range(4)], up_len_cnt=count,
                    up_byte_cnt=Signal(17), up_word_buf=[Signal(8) for _ in range(3)],
                    up_byte_in_word=Signal(2), upload_wr_addr_r=Signal(14),
                    upload_wr_en=self.wr, upload_wr_addr=self.addr, upload_wr_data=self.data,
                    upload_watchdog=Signal(12), watchdog_limit=1000,
                    upload_ack_req=self.ack, upload_ack_accepted=self.accept,
                    debug_state=Signal(3))
            return m

    dut = Harness()
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    writes = []
    counts = []

    async def observe(ctx):
        while True:
            if ctx.get(dut.wr):
                writes.append((ctx.get(dut.addr), ctx.get(dut.data)))
            await ctx.tick()

    async def transfer(ctx):
        for _ in range(2):
            writes.clear()
            ctx.set(dut.start, 1)
            await ctx.tick()
            ctx.set(dut.start, 0)
            for byte in frame:
                assert not ctx.get(dut.ack), "Premature completion ACK"
                ctx.set(dut.rx.data, byte)
                ctx.set(dut.rx.valid, 1)
                await ctx.tick()
                ctx.set(dut.rx.valid, 0)
                await ctx.tick().repeat(2)
            assert ctx.get(dut.ack), "Missing completion ACK"
            assert writes == list(enumerate(words)), "Address or memory-word mismatch"
            counts.append(len(writes))
            # ACK backpressure must not duplicate writes or return to receive.
            await ctx.tick().repeat(4)
            assert ctx.get(dut.ack) and len(writes) == len(words)
            ctx.set(dut.accept, 1)
            await ctx.tick()
            ctx.set(dut.accept, 0)
            await ctx.tick()
            assert not ctx.get(dut.ack)

    sim.add_testbench(transfer)
    sim.add_testbench(observe, background=True)
    sim.run()
    print(json.dumps(dict(
        result="PASS", image_sha256=hashlib.sha256(raw).hexdigest(),
        frozen_upload_source_sha256=digest, words_per_transfer=counts,
        byte_order="big-endian wire / little-endian image",
        scope="Frozen upload FSM, full image twice, exact addresses/words, ACK backpressure",
        physical_commands_sent=False, serial_pin_timing_tested=False,
        cpu_startup_tested=False, flash_changed=False), indent=2))


if __name__ == "__main__":
    main()
