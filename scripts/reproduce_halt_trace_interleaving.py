#!/usr/bin/env python3
"""Offline evidence probe: frozen UART arbitration, not a full-board simulation.

Never opens a serial port or sends network requests. It exercises the exact
combinational TX arbiter copied from the frozen source, with a Halt response
arriving while a trace packet is partway through transmission.
"""
import argparse
import hashlib
from pathlib import Path
import struct
import sys
import textwrap
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from amaranth import Const, Module, Mux, Signal
from amaranth.sim import Simulator
from hardware.wukong_bridge import (
    TRACE_EV_LOAD_SHADOW, decode_trace_packet, try_parse_halt_state_frame,
)


def reproduce(source, nonce):
    start = source.index("        m.d.comb += [\n            uart_tx.data.eq(")
    end = source.index("\n        is_mmio_read", start)
    arbiter = textwrap.dedent(source[start:end])
    m = Module()
    signals = {
        name: Signal(width, name=name) for name, width in {
            "cm_tx_start": 1, "banner_req": 1, "banner_byte": 8,
            "sentinel_req": 1, "sentinel_phase": 2, "upload_ack_req": 1,
            "halt_state_req": 1, "halt_state_byte": 8,
            "snapshot_tx_req": 1, "snapshot_tx_byte": 8,
            "trace_tx_req": 1, "trace_tx_byte": 8,
            "tx_free": 1, "trace_tx_ack": 1, "snapshot_tx_ack": 1,
        }.items()
    }
    uart = SimpleNamespace(data=Signal(8), start=Signal())
    scope = dict(signals, m=m, Mux=Mux, C=Const, uart_tx=uart,
                 core=SimpleNamespace(dmem_wr_data=Signal(32)),
                 N_INIT=2460, _TU_VERSION_CALL_3PKT=2, _BUILD_VERSION=20)
    exec(compile(arbiter, "<frozen TX arbiter>", "exec"), scope)
    trace = (b"\xaa" + struct.pack(">I", 0x1814) +
             bytes([TRACE_EV_LOAD_SHADOW]) + struct.pack(">I", 0) + b"\x00\x00")
    halt = bytes([0xAD, 1, 1, 1, nonce, 0xAC ^ nonce])
    assert try_parse_halt_state_frame(halt)["nonce"] == nonce
    emitted = bytearray()

    async def bench(ctx):
        ctx.set(signals["tx_free"], 1)
        ctx.set(signals["trace_tx_req"], 1)
        for offset, byte in enumerate(trace):
            ctx.set(signals["trace_tx_byte"], byte)
            if offset == 9:
                ctx.set(signals["halt_state_req"], 1)
                for response_byte in halt:
                    ctx.set(signals["halt_state_byte"], response_byte)
                    await ctx.delay(1e-9)
                    assert ctx.get(uart.start) == 1
                    assert ctx.get(signals["trace_tx_ack"]) == 0
                    emitted.append(ctx.get(uart.data))
                ctx.set(signals["halt_state_req"], 0)
            await ctx.delay(1e-9)
            assert ctx.get(signals["trace_tx_ack"]) == 1
            emitted.append(ctx.get(uart.data))

    sim = Simulator(m)
    sim.add_testbench(bench)
    sim.run()
    assert emitted == trace[:9] + halt + trace[9:]
    decoded = decode_trace_packet(emitted[:12])
    assert decoded["nia"] == 0x1814
    assert decoded["payload_gt"] == 0xAD
    assert decoded["flags"] == 1
    assert not decoded["fault_valid"]
    assert len(emitted[12:]) == 6
    # A correctly serialized stream yields a normal trace and valid response.
    serialized = trace + halt
    assert decode_trace_packet(serialized[:12])["payload_gt"] == 0
    assert try_parse_halt_state_frame(serialized, 12)["nonce"] == nonce
    print(f"REPRODUCED nonce={nonce}: payload=0xAD, flags=1, "
          "fault_valid=false, six bytes left before next trace.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(
        "generated-artifacts/factory-continuation-bitstream/"
        "factory-continuation-build/sources/hardware/wukong_top.py"))
    args = parser.parse_args()
    source = args.source.read_text()
    print("Frozen source SHA256:", hashlib.sha256(source.encode()).hexdigest())
    for nonce in (1, 2):
        reproduce(source, nonce)
    print("Scope: extracted combinational arbitration only; not physical raw-byte proof.")


if __name__ == "__main__":
    main()
