# Wukong Boot Verification Procedure

This checklist confirms the Wukong XC7A100T board boots correctly after
re-flashing with the fixed bitstream.  Run it at the workbench after every
new synthesis — it covers all three acceptance criteria.

---

## Prerequisites

| Item | Detail |
|------|--------|
| Board | QMTECH Wukong V3 (XC7A100T-2FGG676C) |
| JTAG programmer | Digilent JTAG-HS2, Platform Cable USB II, or equivalent |
| UART adapter | Any CH340/CP2102/FTDI — TX→F3, RX→E3, GND→GND (3.3V TTL) |
| Bitstream | `church_wukong_xc7a100t.bit` (built by `wukong_xc7a100t.tcl`) |
| Serial terminal | PuTTY / minicom / `python -m serial.tools.miniterm` |
| Python packages | `pip install pyserial requests` |

---

## Step 1 — Build a fresh bitstream

From your workstation (requires Vivado 2020.x or later, WebPACK edition is free):

```bash
# 1. Generate the Verilog netlist
cd /path/to/church-machine
python -m hardware.gen_rtlil --wukong          # writes church_wukong_xc7a100t.v

# 2. Synthesise + implement + write bitstream  (~15–40 min)
cd <dir containing the .v and .xdc>
vivado -mode batch -source hardware/wukong_xc7a100t.tcl

# Output: church_wukong_xc7a100t.bit
```

> **Tip:** The build script enforces a timing gate: if WNS < 0, the TCL
> script calls `error` and Vivado exits non-zero **before** writing a
> bitstream.  A clean build prints `Timing clean (WNS = … ns)` and then
> the expected LED behaviour summary.  No manual timing check is needed —
> a broken bitstream can never be silently produced.
>
> To override for research builds only (not production):
> ```
> vivado -mode batch -source hardware/wukong_xc7a100t.tcl -tclargs --allow-timing-violations
> ```

---

## Step 2 — Flash the board

**Option A — Vivado Hardware Manager (recommended)**

```tcl
open_hw_manager
connect_hw_server -allow_non_jtag
open_hw_target
set_property PROGRAM.FILE {church_wukong_xc7a100t.bit} [lindex [get_hw_devices] 0]
program_hw_devices [lindex [get_hw_devices] 0]
```

**Option B — xc3sprog (Linux / Chromebook)**

```bash
xc3sprog -c xpc -p 0 church_wukong_xc7a100t.bit
```

**Option C — openFPGALoader**

```bash
openFPGALoader -b arty_a7_100t church_wukong_xc7a100t.bit
```

---

## Step 3 — Acceptance criteria

### (a) 0xBB sentinel — UART confirms boot path completed

Open a serial terminal on the UART adapter port at **57600 8N1** before
powering / resetting the board.

```bash
python -m serial.tools.miniterm --raw /dev/ttyUSB0 57600
```

Within **~1 second** of power-on (or pressing the reset button), you should
see a single `0xBB` byte arrive.  In miniterm `--raw` mode it appears as a
non-printable byte; to see it as hex use:

```bash
python3 -c "
import serial, sys
s = serial.Serial('/dev/ttyUSB0', 57600, timeout=3)
b = s.read(1)
print('Sentinel:', hex(b[0]) if b else 'TIMEOUT — sentinel NOT received')
s.close()
"
```

**Pass:** `Sentinel: 0xbb`
**Fail:** `TIMEOUT` → the boot FSM hw_init sequencer did not complete or
`boot_triggered` never fired; check DMEM init logic in `wukong_top.py`.

---

### (b) LED[1] (G20) — heartbeat stops, goes OFF (normal = no fault)

RTL truth table (`self.led[1].eq(~fault_latched)`, active-LOW):

| Phase | fault_latched | led[1] pin | D2 (active-LOW) |
|-------|:-------------:|:----------:|:---------------:|
| Booting | — | `hb_blink` | 1 Hz heartbeat blink |
| Running, no fault | 0 | HIGH | **OFF** |
| Running, fault latched | 1 | LOW | ON (fault indicator) |

Observe **D2** (the LED mapped to G20) after flashing.  It should blink for
roughly the first 1–2 seconds while DMEM initialises, then **stop blinking
and go OFF** (pin driven HIGH, LED extinguished — the normal healthy state).

**Pass:** D2 transitions from blinking → OFF within ~2 s of power-on.
**Fail:** D2 keeps blinking → `boot_triggered` never asserted (hw_init stalled).
D2 stays ON after heartbeat stops → fault latched during BOOT_PROGRAM execution.
D2 never blinks at all → clock not reaching logic (BUFG inference failed).

---

### (c) 'r' command — led[0] (G21) blinks via wukong_bridge.py

Start the bridge (substitute your IDE URL and serial port):

```bash
python3 hardware/wukong_bridge.py \
    --port=/dev/ttyUSB0 \
    --ide=https://<your-replit-url> \
    --insecure
```

Or for a quick local test without the IDE, send `'r'` directly:

```bash
python3 -c "
import serial, time
s = serial.Serial('/dev/ttyUSB0', 57600, timeout=2)
time.sleep(0.5)
s.write(b'r')           # run-free command
print('run sent')
# Read any trace packets for 3 s
import time; t0=time.time()
while time.time()-t0 < 3:
    b = s.read(128)
    if b: print('RX:', b.hex())
s.close()
"
```

**Pass:** D1 (G21) blinks at approximately **1 Hz** after `'r'` is sent.
The NUC_PROGRAM loop writes to MMIO reg 0 (LED0_RGB) once per iteration;
at 50 MHz the loop produces roughly that rate.

**Fail:** D1 stays solid ON (boot phase still active), stays OFF (inverted
logic error), or does not change after `'r'` → CM is not executing the NUC
loop or the MMIO write is missing.

---

## Automated smoke test

Criteria (a) and (c) can be verified without touching the IDE by running the
smoke-test script directly from the workstation that has the board attached.
Criterion (b) — D2 goes OFF — still requires a visual check at the bench.

### Quick start

```bash
# Install the only dependency if you haven't already
pip install pyserial

# Run the smoke test (adjust --port as needed)
python3 scripts/wukong_boot_smoke.py --port /dev/ttyUSB0
```

Example passing output:

```
Wukong boot smoke test  —  /dev/ttyUSB0 @ 57600 baud
------------------------------------------------------------
[a] Waiting up to 3.0 s for 0xBB sentinel …
[a] PASS — 0xBB received after 0.83 s (buffer offset 0)
[c] Sending 'r' (run-free) …
[c] Waiting up to 3.0 s for a non-fault trace packet …
[c] PASS — first non-fault trace packet received after 0.12 s  NIA=0x00000001  instr=0x...
------------------------------------------------------------
RESULT: PASS — board booted and is executing correctly.
NOTE:   Criterion (b) — D2 goes OFF — must be verified visually.
```

Exit code `0` = pass, `1` = failure.  The script prints a clear failure
message with triage hints when either criterion is not met.

### Options

| Flag | Default | Purpose |
|------|---------|---------|
| `--port PORT` | `/dev/ttyUSB0` | Serial device |
| `--baud BAUD` | `57600` | Baud rate |
| `--sentinel-timeout S` | `3` | Seconds to wait for 0xBB |
| `--trace-timeout S` | `3` | Seconds to collect trace after `'r'` |

### When to run it

- **Before every re-flash** — confirms the current bitstream still boots, so
  you have a baseline before overwriting it.
- **After every re-flash** — confirms the new bitstream passes without manual
  observation.
- **In CI / pre-merge hooks** — wire it into your build pipeline on any
  machine that has a board attached and the `pyserial` package installed.

### What it does not cover

| Gap | How to close it |
|-----|----------------|
| Criterion (b) — D2 LED | Visual check; no UART equivalent |
| Fault-packet content | Script reports fault count; manual triage still needed |
| Sustained execution beyond first packet | Extend `--trace-timeout` or run the full bridge |

---

## Fault-triage quick reference

| Symptom | Likely cause |
|---------|-------------|
| Both LEDs solid ON immediately | GSR fired, clock never reached — check BUFG inference (see wukong_v3-pinout.md) |
| D2 heartbeats forever | `boot_triggered` never fires — DMEM hw_init stalled |
| D2 stays ON after heartbeat stops | Fault latched during BOOT_PROGRAM — check BOOT_PROGRAM encoding |
| D2 never blinks, stays OFF | Clock not reaching logic; IBUF→BUFG chain absent |
| 0xBB not received | UART not wired or sentinel_req never asserted |
| D1 stays solid ON after `'r'` | CM halted in step_mode=1; bridge not connected |
| D1 stays OFF after boot | Active-LOW inversion missing; mmio_led_reg not written |
| Trace packets with `fault_valid=True` | CM fault before reaching NUC loop — check BOOT_PROGRAM encoding |

---

## Step 4 — Fault-halt verification (Aug-7 bitstream and later)

This step verifies the new `fault_halt` RTL change: any retired instruction with
`fault_valid=True` automatically enters step-mode and halts the CM, exactly like
a breakpoint hit.  This lets the IDE single-step through the fault without the CM
silently retrying.

**RTL location:** `hardware/wukong_top.py` lines 527–532:

```python
fault_halt = Signal()
m.d.comb += fault_halt.eq(core.retire_valid & core.retire_fault_valid)

with m.If(bp_hit | fault_halt):
    m.d.sync += [step_mode.eq(1), step_halted.eq(1)]
```

### Procedure

1. Start the bridge in the normal way (CM will be free-running):

   ```bash
   python3 hardware/wukong_bridge.py \
       --port=/dev/ttyUSB0 \
       --ide=https://<your-replit-url> \
       --insecure
   ```

2. In the IDE, load a LUMP that performs a **NULL_CAP CALL** — the simplest
   deliberate fault.  Example one-liner assembly:

   ```
   CALL CR0, CR0[0]    ; CR0 is NULL → NULL_CAP fault (fault_code=5)
   ```

   Any NULL-cap access (LOAD, SAVE, or CALL through a zero GT) works equally.

3. Send **`'r'`** (run-free) from the IDE, then **`'h'`** immediately after to
   let the CM reach the fault before the bridge can halt it, or just let it run
   until the fault trace packet appears.

4. **Expected observations:**

   | Signal | Expected |
   |--------|----------|
   | Bridge console | Trace packet with `fault_valid=True`, `fault_code=NULL_CAP (5)`, `bp_hit=False` |
   | Bridge console | `step_halted` state — subsequent `'s'` (step) commands do nothing until `'r'` |
   | D2 (G20) | **ON** (LED active-LOW: FPGA drives LOW = lit) because `fault_latched` is now 1 |
   | D1 (G21) | Stops blinking — CM is halted |

5. Confirm the bridge console line contains `FAULT=` with a non-zero code:

   ```
   NIA=0x00000002  RESULT  FAULT=NULL_CAP(5)  bp_hit=False
   ```

6. **Recovery:** Send `'r'` to exit step-mode.  D1 resumes blinking.
   D2 stays ON until the board is power-cycled or reset (`fault_latched` is a
   sticky latch; it only clears on GSR).

### Pass / Fail criteria

| # | Check | Pass | Fail |
|---|-------|------|------|
| d1 | Trace packet has `fault_valid=True` | Yes | Bridge shows no fault packets |
| d2 | CM halts (no further trace packets without `'s'`) | Yes | CM keeps running after fault |
| d3 | D2 (G20) lights ON after fault | Yes | D2 stays OFF |
| d4 | `'s'` (step) unblocks one retire, re-halts | Yes | No response to step command |

> **If d1 passes but d2 fails** (CM does not halt): the `fault_halt` signal is
> not reaching `step_mode` / `step_halted`.  Check that `bp_hit | fault_halt` is
> wired into the sync update at lines 530–532 of `wukong_top.py`.

> **If d2 passes but d3 fails** (D2 stays OFF): `fault_latched` is not connected
> to the LED mux.  Check the `led[1]` drive in the boot-phase / run-phase mux at
> the bottom of `wukong_top.py`.

---

## Recording your result

Once all four checks pass, note the outcome here (or in CHANGELOG.md):

```
Date: ___________
Bitstream: church_wukong_xc7a100t.bit  (Aug-7 build, WNS=5.19 ns)
Bitstream SHA256: (sha256sum church_wukong_xc7a100t.bit)
(a) 0xBC sentinel received:         YES / NO
(b) D2 goes OFF (no fault):         YES / NO
(c) D1 blinks ~1 Hz after 'r':      YES / NO
(d) Fault-halt: NULL_CAP → halt:    YES / NO
    d1 FAULT= trace packet:         YES / NO
    d2 CM halts after fault:        YES / NO
    d3 D2 ON after fault:           YES / NO
    d4 's' steps one retire:        YES / NO
Notes:
```
