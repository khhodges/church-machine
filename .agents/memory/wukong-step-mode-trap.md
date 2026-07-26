---
name: Wukong standalone step_mode trap
description: CM halts immediately after boot in step mode (init=1), never executes ROM without bridge sending 'r'
---

## The trap

`wukong_top.py` declares `step_mode = Signal(init=1)`. This causes the CM to
halt after every retired instruction and wait for an `'s'` byte over UART RX
before executing the next one.  On standalone FPGA with no bridge connected,
UART RX is always empty → the CM never executes a single instruction of
WUKONG_NUC_PROGRAM.

Symptoms: LEDs stay in the pre-boot heartbeat pattern (D1 solid ON, D2 blinking)
OR the CM boots (D1/D2 switch state) but then immediately stalls — no LED blink
from the ROM, no UART output, no change across multiple reflash attempts.

## Fix

For standalone / bridge-less operation, set `init=0`:

```python
step_mode = Signal(init=0)   # 0 = free-run (standalone-safe)
```

The bridge can still send `'h'` (0x68) at any time to enter step mode.

**Why:** The `init=1` default is correct when the IDE bridge is always present
(it sends `'r'` to start the CM).  Without the bridge the CM is permanently
halted.  This caused three consecutive "no change" builds before the root cause
was found.

**How to apply:** Any Wukong standalone bitstream (no bridge) must have
`step_mode init=0`.  Bridge-connected builds can keep `init=1`.
