---
name: Wukong live debug channel
description: How to elicit trace from a silent/halted Wukong board via the prod command channel; boot-burst-missed trap
---

- The boot sentinel + trace burst is **one-shot at configuration**. JTAG programming drops the USB-serial port, crashing/blinding the bridge at exactly that moment — so a "silent" board after programming usually means the burst was missed, not that the image is bad.
- To make a running new-bitstream board speak on demand: `POST /hardware/wukong/command {"cmd":"s"}` (step) — the retire emits a trace packet visible in `GET /hardware/wukong/status`. Commands: s=step, r=run, h=halt, b=breakpoint(+4-byte NIA), u=upload. 'b' is breakpoint, NOT boot.
- `WKN........D` on the UART = old-bitstream call-home loop fingerprint; the reset push-button reloads from SPI flash (PROG_B), wiping a JTAG-loaded .bit.
- **Why:** first successful end-to-end HW trace (Aug 2026) was achieved via the step poke after the boot burst was missed twice.
- A board frozen at NIA=0x200 emitting misframed packets (0xAA magic leaking into payload fields) = the boot-ROM false-halt bug; always compare the bitstream build time against the latest wukong_top.py fix commit before suspecting the source — a .bit built minutes before a fix looks identical to "broken Amaranth".
- `/fpga` page has Board Controls (Step/Run/Halt/BP/Upload) posting to the same endpoints — no IDE needed to drive the board.
