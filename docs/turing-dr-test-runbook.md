# Turing DR Test — Ti60 F225 Hardware Runbook

**v1.0 — 2026-04-29**

This runbook describes how any team member can build, flash, and interpret the
**Turing DR Test** (`led_turing_full`) on a physical Sipeed Ti60 F225 board.
The test has been validated in simulation; this document makes the hardware
run repeatable.

> **Note on source versions:** `simulator/app-run.js` contains two definitions
> of the `led_turing_full` key. The second definition (lines ~4393–5567) is the
> active one — it implements the 6-phase binary-counter design described here.
> The earlier definition (phases A–I, lines ~3584–4272) is shadowed and not
> loaded by the IDE.

---

## What the test does

`led_turing_full` is a visual full-ISA burn-in that exercises all 10 Turing
instructions across all 16 data registers (DR0–DR15):

> `DREAD  DWRITE  BFEXT  BFINS  MCMP  IADD  ISUB  BRANCH  SHL  SHR`

Six sequential phases run. LEDs 3–5 display the current phase as a 3-bit
binary counter. LED0 lights briefly at every phase transition (heartbeat).
LED1 pulses once for each individual check that passes (sub-test pulse).
LED2 is the **FAULT LED** — it latches permanently ON if anything fails.

When all six phases pass, all six LEDs blink together three times, then the
test restarts automatically from Phase 1.

---

## Prerequisites

| Item | Notes |
|:-----|:------|
| Sipeed Ti60 F225 Development Kit | USB-C cable connected to port J4 |
| Efinity IDE installed locally | Download from <https://www.efinixinc.com/efinity-ide>; register a (free) 30-day licence if needed |
| Efinity pin constraint file | `pinout.csv` is part of the local Efinity project; not committed to the repo — obtain from the person who set up the Ti60 project |
| `openFPGALoader` installed | `sudo apt install openfpgaloader` on Ubuntu/Debian |
| Project repo checked out | Any recent commit on `main` |

---

## Step 1 — Assemble `led_turing_full` in the IDE

1. Open the Church Machine IDE in your browser.
2. Click the **Boot** button (or click **Step** six times) to initialise the
   machine.
3. In the example tabs, click **Turing DR Test ✦** (shown in green).
   The editor loads the `led_turing_full` assembly source.
4. Click **Assemble**.  
   Confirm: the console shows no errors and a LUMP is produced.
5. *(Optional)* Click **Run** in the simulator to verify the LED strip
   animates through all six phases before touching hardware.

---

## Step 2 — Generate RTL

Run from the project root:

```bash
python3 -c "
from hardware.ti60_f225 import ChurchTi60F225
from amaranth.back import rtlil
m = ChurchTi60F225(sim_mode=False)
with open('build/church_ti60_f225.rtlil', 'w') as f:
    f.write(rtlil.convert(m, ports=[m.uart_tx, m.uart_rx, m.push_button] + m.led))
print('RTL generated: build/church_ti60_f225.rtlil')
"
```

Quick sanity check (no Efinity needed):
```bash
python3 -c "from hardware.ti60_f225 import ChurchTi60F225; print('OK')"
```

---

## Step 3 — Synthesise, place-and-route, and generate bitstream

All four commands must run on a machine with **Efinity IDE** installed.
`pinout.csv` is the Efinity pin constraints file for the Ti60 project —
it must be present in the working directory.

```bash
# Step 3a — Synthesis (target: EFT90A, 50 MHz)
efinity -t build/church_ti60_f225.rtlil -d EFT90A -p pinout.csv \
        -o build/church_ti60_f225.edf

# If timing cannot close at 50 MHz, try 25 MHz:
# efinity -t build/church_ti60_f225.rtlil -d EFT90A --freq 25 -p pinout.csv \
#         -o build/church_ti60_f225.edf

# Step 3b — Place and route
efinity --pnr build/church_ti60_f225.edf -p pinout.csv \
        -o build/church_ti60_f225_pnr.edf

# Step 3c — Bitstream
efinity --bitstream build/church_ti60_f225_pnr.edf \
        -o build/church_ti60_f225.fs
```

Expected outputs:

| File | Typical size |
|:-----|:-------------|
| `build/church_ti60_f225.edf` | ~500 KB Edif netlist |
| `build/church_ti60_f225_pnr.edf` | PnR netlist + timing report |
| `build/church_ti60_f225.fs` | 1–2 MB binary bitstream |

---

## Step 4 — Flash the Ti60 F225 board

Connect the board via USB-C to J4. Confirm USB enumeration:

```bash
lsusb | grep -i efinix
```

Then flash:

```bash
# CLI (recommended)
openFPGALoader -b ti60f225 build/church_ti60_f225.fs

# GUI alternative (Efinity Programmer)
efinity --program build/church_ti60_f225.fs
```

If `openFPGALoader` times out:
```bash
openFPGALoader -b ti60f225 --verbose build/church_ti60_f225.fs
```

The board resets immediately after a successful flash and begins the
16-cycle boot sequence. After the 3-second startup delay the firmware
prints `CHURCH Ti60 v1.0` on the UART console (115200 baud, J4).

---

## Step 5 — Watch the LED sequence

Once the machine has booted and `led_turing_full` is running, the
following LED behaviour is expected.

### LED roles during the test

| LED | Role | Normal behaviour |
|:----|:-----|:----------------|
| **LED0** | Heartbeat | Briefly lights at the start of each phase |
| **LED1** | Sub-test pulse | Flickers rapidly as individual register checks pass |
| **LED2** | **FAULT** | Off during a passing run; latches ON permanently on failure |
| **LED3** | Phase bit 0 (LSB) | Part of 3-bit phase counter |
| **LED4** | Phase bit 1 | Part of 3-bit phase counter |
| **LED5** | Phase bit 2 (MSB) | Part of 3-bit phase counter |

### Phase map

LEDs 3–5 encode the current phase in binary (LED5 = bit 2, LED3 = bit 0).
The pattern is set at the **start** of each phase and remains visible while
that phase's sub-tests are running.

| Phase | LED5 | LED4 | LED3 | Instructions under test | What it checks |
|:------|:----:|:----:|:----:|:------------------------|:---------------|
| **Ph 1** | 0 | 0 | **1** | `IADD`, `ISUB`, `MCMP` | Loads a seed into each DR2–DR15, adds 3, subtracts seed+3, compares to zero |
| **Ph 2** | 0 | **1** | 0 | `ISUB`, `IADD`, `MCMP` | Subtracts varying constants from each DR and verifies zero |
| **Ph 3** | 0 | **1** | **1** | `SHL`, `MCMP` | Walks a single bit from position 0 to 31 across every DR, verifying overflow |
| **Ph 4** | **1** | 0 | 0 | `SHR`, `MCMP` | Logical right-shift and arithmetic shift-right (sign extension) on every DR |
| **Ph 5** | **1** | 0 | **1** | `BFEXT`, `BFINS`, `MCMP` | Bitfield extraction and insertion at varied positions and widths |
| **Ph 6** | **1** | **1** | 0 | `DREAD`, `DWRITE` | Round-trip I/O: writes each DR to the LED registers, reads back, compares |

A healthy board cycles through all six phases in a few seconds. LED1
flickers continuously throughout. LED0 lights briefly at each phase
boundary.

### PASS blink signature

After Phase 6 completes successfully:

1. All six LEDs turn **ON** simultaneously.
2. Brief pause (~200-count software delay loop).
3. All six LEDs turn **OFF**.
4. Brief pause (~100-count software delay loop).
5. Steps 1–4 repeat — **three full ON/OFF blinks total**.
6. Test restarts from Phase 1 and loops indefinitely.

> **In plain English:** you will see all LEDs flash together, three
> times, with a short gap between each flash. Then the phase counter
> reappears as the test restarts. If the three-blink cycle keeps repeating
> every few seconds, the board is passing on every loop.

---

## LED2 FAULT latch — diagnosis

### What it looks like

When any assertion fails, the firmware immediately executes the `fail:` handler:

- LED0, LED1, LED3, LED4, LED5 → **OFF**
- LED2 → **ON permanently** (the red FAULT LED)
- Execution enters an infinite `BRANCH fail` loop — the machine is halted

The board will stay in this state until power-cycled or reflashed.

> **Important:** the fail handler clears LED3–5 immediately before latching
> LED2. This means the phase counter is **not visible** after the fault has
> been latched. To identify which phase failed you must either:
> - **Watch live**: observe which LED3–5 pattern was showing just before all
>   LEDs went dark and LED2 lit up, or
> - **Read UART**: connect a serial terminal at 115200 baud before running;
>   the firmware emits a fault code line at the point of failure.

### Identifying the failing phase from live observation

If you watched the board when the fault happened, the LED3–5 pattern that was
visible immediately before the FAULT latch identifies the failing phase:

| LED3–5 pattern just before FAULT | Failing phase |
|:---------------------------------|:--------------|
| `001` (LED3 only) | Phase 1 — IADD/ISUB arithmetic on DR2–DR15 |
| `010` (LED4 only) | Phase 2 — ISUB arithmetic |
| `011` (LED3 + LED4) | Phase 3 — SHL bit walk |
| `100` (LED5 only) | Phase 4 — SHR / arithmetic shift-right |
| `101` (LED5 + LED3) | Phase 5 — BFEXT/BFINS bitfield operations |
| `110` (LED5 + LED4) | Phase 6 — DREAD/DWRITE round-trip |

### Diagnosing via UART

Connect a serial terminal to J4 before running the test:

```bash
picocom -b 115200 /dev/ttyUSB0
```

On fault the firmware outputs:
```
S:<NIA hex>F:<fault code hex>HALT
```

The NIA (next instruction address) identifies the exact failing assertion in
the `led_turing_full` source. Cross-reference against the assembly listing in
`simulator/app-run.js` (the active `led_turing_full` definition, lines ~4393–5567).

### Recovery steps

1. Note which phase the fault occurred in (from live observation or UART).
2. Power-cycle the board (unplug USB-C, wait 2 s, reconnect).
3. Run `led_turing_full` in the simulator first to confirm it passes there.
4. If the simulator passes but hardware faults, check:
   - Clock integrity: is the board running at 50 MHz? Try a 25 MHz bitstream.
   - Power supply: USB port must supply ≥ 500 mA.
5. If the fault occurs consistently in the same phase on hardware, file an
   issue with the phase number and UART output.

---

## UART console

Connect a serial terminal to J4 (USB-C) at 115200 8N1.

First, identify the device node:

```bash
# Linux
ls /dev/ttyUSB* /dev/ttyACM*

# macOS
ls /dev/tty.usbserial* /dev/tty.SLAB_USBtoUART*

# Windows — check Device Manager under Ports (COM & LPT)
```

Then open a terminal session:

```bash
picocom -b 115200 /dev/ttyUSB0
# or
minicom -D /dev/ttyUSB0 -b 115200
# or on Windows: use PuTTY at COM<N>, 115200 8N1
```

If `/dev/ttyUSB0` is permission-denied on Linux, add yourself to the `dialout`
group:
```bash
sudo usermod -aG dialout $USER
# log out and back in for this to take effect
```

On a clean boot:
```
CHURCH Ti60 v1.0
<NIA hex>HALT
```

On fault detection:
```
S:<NIA hex>F:<fault code hex>HALT
```

---

## Pass video

*(To be recorded and linked here once the first successful hardware run is captured.)*

When recording, capture at least two full PASS blink cycles so the three-blink
signature is clearly visible. Upload to the team shared drive and add the link below:

**Pass video:** *(pending)*

---

## Quick-reference checklist

```
[ ] Board connected via USB-C to J4
[ ] lsusb shows Efinix / FTDI device
[ ] pinout.csv available in working directory
[ ] RTL generated without import errors
[ ] Synthesis completed (build/church_ti60_f225.edf exists)
[ ] PnR completed (timing report shows ≥ 50 MHz, or accepted 25 MHz fall-back)
[ ] Bitstream generated (build/church_ti60_f225.fs, 1–2 MB)
[ ] openFPGALoader flash succeeded without timeout
[ ] Board powered up; UART prints "CHURCH Ti60 v1.0"
[ ] LED3–5 cycle through 001 → 010 → 011 → 100 → 101 → 110
[ ] LED2 stays OFF throughout
[ ] All 6 LEDs blink together × 3 at end of each full run
[ ] Test restarts from Phase 1 (LED3 lights up again)
```

---

*Confidential — Church Machine project — 2026-04-29*
