---
name: UartTx DONE-gap double-increment
description: Any TX requester gating on ~busy alone skips every other byte — UartTx has a 1-cycle DONE state (busy=0, start ignored)
---

UartTx (hardware/uart_tx.py) has a one-cycle DONE state between bytes where
`busy=0` and `done=1` but `start` is IGNORED (only IDLE accepts start).

**Rule:** any arbitrator/requester that advances a byte counter or fires an
ack on `~busy` alone double-increments across the DONE cycle and silently
skips every other byte. Gate on `tx_free = ~busy & ~done`.

**Why:** the 4-byte boot sentinel came out as `BC <TU>` (2 bytes, wrong
values) — the bridge never recognized it, so the board looked completely
dead over UART even though the bitstream was fine otherwise. Cost a full
JTAG/bridge/serial debugging session before RTL sim exposed it.

**How to apply:** in wukong_top.py the UART TX arbitrator (banner, sentinel,
upload_ack, trace_tx_ack) all use `tx_free`. Any NEW requester added to the
arbitrator must use `tx_free`, never bare `~uart_tx.busy`. Fixed in
BUILD_VERSION=3.

**Verification trick:** /tmp-style Amaranth sim with clk_freq=100, baud=1,
sim_mode=True; decode uart_tx_pin by sampling mid-bit. Distinguishes RTL
regression from board/cable issues in minutes.
