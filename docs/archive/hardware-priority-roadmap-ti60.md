# Hardware Priority Roadmap

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

Seven open hardware tasks must be executed in the right sequence to avoid
rework.  This document defines that order and records the rationale for each
dependency.

---

## Dependency overview

```
[#149 Verify Ti60 primitives]
        │
        ▼
[#148 Ti60 top-level design]
        │
        ▼
[#147 ACK-timeout robustness]
        │
        ▼
[#146 Flash BL702 firmware]          [#16 Tang Nano MMIO LEDs]
                                              │
                                              ▼
[#145 Show firmware version]         [#17 Wire Navana.Init]
```

Tasks #16 → #17 (Tang Nano / Navana track) are independent of the Ti60 track
and can run in parallel once #149 is underway.  Task #18 ("Wire Navana.Init
into boot sequence + CLOOMC assembly examples") is a duplicate of Task #17 with
the same title and scope; it must be cancelled before work begins.

---

## Step-by-step execution order

### Step 0 — Cancel duplicate task #18

Task #18 ("Wire Navana.Init into boot sequence + CLOOMC assembly examples") is
registered in the backlog with a title and description identical to Task #17.
Both tasks cover the same deliverable; #18 must be cancelled before work begins
so the Navana track is only executed once.

---

### Step 1 — Verify Efinix primitive names (Task #149) ✦ gating

**Why first:** All Ti60 synthesis work depends on the correct Efinix primitive
interface.  If the port names or instruction code turn out to be wrong after
synthesis is attempted, every subsequent Ti60 file must be reworked.

**What to do:**

Audit `church_machine/ti60_callhome.py` (and `hardware/ti60_f225.py` if it
instantiates any primitives) against the *Efinix Titanium FPGA Primitive Guide*
for the installed Efinity version.  Specifically confirm:

| Item | Current assumption | Must verify |
|:-----|:-------------------|:------------|
| Primitive name | `EFX_USR_JTAG` | Check guide; may also appear as `EFX_JTAG_CTRL` |
| Input port — clock | `i_TCK` | Exact case and prefix |
| Input port — mode | `i_TMS` | Exact case and prefix |
| Input port — data | `i_TDI` | Exact case and prefix |
| Output port — data | `o_TDO` | Exact case and prefix |
| USERID instruction | `0x08` | Confirm 8-bit IR width and instruction code |
| UID register width | 64 bits | Confirm data register is 64-bit |

Update the `Instance(...)` call in `church_machine/ti60_callhome.py` and add a
comment citing the primitive guide section and Efinity version number.

**Relevant files:**
- `church_machine/ti60_callhome.py` — lines 219–224 (`EFX_USR_JTAG` instance)
- `hardware/ti60_f225.py`
- Efinix Titanium FPGA Primitive Guide (local Efinity install, `docs/` folder)

---

### Step 2 — Build Ti60 top-level design (Task #148)

**Why second:** The ACK-timeout patch (Step 3) and firmware-flash feature
(Step 4) are only testable once a complete synthesisable top-level exists.

**What to do:**

Create `hardware/ti60_top.py` (or equivalent) that:

1. Instantiates `Ti60CallHome` and wires `uart_rx` / `uart_tx` to the FTDI
   UART pins defined in `hardware/ti60_f225.py`.
2. Gates the normal boot FSM on `callhome.callhome_done` (see the integration
   example in `church_machine/ti60_callhome.py`, lines 36–45).
3. Instantiates `ChurchCore` and connects instruction/data memory, namespaces,
   and C-list using Efinix EBR tiles.
4. Drives `USER_LED[3:0]` with the standard boot/run/fault/halt colour scheme.
5. Can be submitted to Efinity IDE for synthesis without modification.

**Relevant files:**
- `church_machine/ti60_callhome.py` — call-home module to integrate
- `hardware/ti60_f225.py` — pin/clock definitions
- `hardware/ti60_f225.isf`, `hardware/ti60_f225.sdc` — existing constraints

---

### Step 3 — Add ACK timeout to Ti60 call-home (Task #147)

**Why third:** Once the top-level exists the board can be tested in the field
without a host bridge attached.  Without the timeout the machine hangs
indefinitely in `WAIT_ACK` (FSM state in `church_machine/ti60_callhome.py`,
line 353), making standalone use impossible.

**Status:** `Ti60CallHome.__init__` already accepts an `ack_timeout` parameter
(line 188) and the FSM already contains the timeout counter and `ack_timed_out`
signal (lines 317–364).  The parameter defaults to `clk_freq * 2` (2 seconds).
Verify the implementation is complete end-to-end and add a simulation test that
confirms `callhome_done` asserts after the timeout when no ACK bytes arrive.

**Relevant files:**
- `church_machine/ti60_callhome.py` — `WAIT_ACK` state (line 353), timeout
  counter (lines 317–364), `ack_timed_out` (line 315)

---

### Step 4 — FPGA MMIO LED router — Tang Nano 20K (Task #16) ✦ parallel track

**Why here (parallel with Steps 1–3):** This task is independent of the Ti60
track.  It can begin as soon as Step 1 is underway.  It must be complete before
Step 5, because `Navana.Init` is only meaningful on hardware when real GPIO is
wired up.

**What to do:**

Wire the Church Machine MMIO write path through to the physical GPIO LED pins
on the Tang Nano 20K:

1. Identify the MMIO address range reserved for LEDs (see
   `docs/hardware-tang-nano-20k.md` and `hardware/tang_nano_20k.py`).
2. In the Tang Nano 20K top-level (`hardware/tang_nano_20k.py`), decode writes
   to that address and drive the corresponding `USER_LED` output pins.
3. Confirm the pin assignments against `hardware/tang_nano_20k.cst`.
4. Verify with a short assembly program that writing to the LED MMIO address
   toggles the physical LEDs.

**Relevant files:**
- `hardware/tang_nano_20k.py` — top-level
- `hardware/tang_nano_20k.cst` — pin constraints
- `docs/hardware-tang-nano-20k.md` — board reference

---

### Step 5 — Wire Navana.Init into boot sequence (Task #17)

**Why fifth:** `Navana.Init` mints the LED PassKey and installs the LED driver
abstraction.  On hardware it only has effect after Step 4 gives programs real
GPIO control of the LEDs.

**What to do:**

Call `Navana.Init` during the boot sequence so that:

1. The LED PassKey is minted and placed in the namespace at boot time.
2. The LED driver abstraction is installed and available to user programs without
   any manual setup.
3. The boot sequence on both Tang Nano 20K and Ti60 F225 targets runs
   `Navana.Init` before releasing to user code.

**Relevant files:**
- Boot ROM and boot sequence entry points in `hardware/boot_rom.py` and
  `church_machine/boot_rom.py`
- Navana / LED driver implementation (search `hardware/` and `church_machine/`
  for `Navana` or `navana`)

---

### Step 6 — Flash BL702 firmware from the IDE (Task #146)

**Why sixth:** The BL702 firmware being flashed should be the
ACK-timeout-hardened build produced after Step 3.  Flashing an older build
before the timeout fix is confirmed would leave field units in the hanging state.

**What to do:**

Add a "Flash Firmware" action to the Hardware menu in the browser IDE:

1. The browser sends a flash request to the local bridge (BL702 side).
2. The bridge writes the firmware image to BL702 flash using the existing
   BL702 ISP protocol.
3. The IDE shows a progress indicator and confirms success or surfaces the
   error message.

**Relevant files:**
- `hardware/bl702_firmware.c` — BL702 firmware source
- `hardware/uart_crc16.py` and `hardware/uart_rx.py` / `hardware/uart_tx.py`
  — UART transport layer used by the bridge
- `server/` — IDE server endpoints
- `web/` — IDE frontend Hardware menu

---

### Step 7 — Show firmware version in Devices view (Task #145)

**Why last:** This is pure UI polish.  The major/minor version and build
signature are already stored in the database (inserted by the call-home packet,
bytes 3–8 of the 23-byte packet in `church_machine/ti60_callhome.py`).
Displaying them is only useful once boards are running a known, stable firmware
version — i.e., after Step 6.

**What to do:**

In the Devices view of the browser IDE, surface per-board firmware information
in the board detail panel:

- Firmware version string: `v{major}.{minor}`
- Build signature (hex, 4 bytes)
- Last-seen timestamp

No hardware changes are required; the data is already in the database.

**Relevant files:**
- `server/` — API endpoint that serves device/board data
- `web/` — Devices view frontend component
- `church_machine/ti60_callhome.py` — packet layout reference (lines 15–25)

---

## Cancellation: Task #18

Task #18 ("Wire Navana.Init into boot sequence + CLOOMC assembly examples") is
an exact duplicate of Task #17.  It must be cancelled — not deferred — before
any work on the Navana track begins, to avoid parallel duplicate effort.

---

## Summary table

| Order | Task | Depends on | Track |
|:-----:|:-----|:-----------|:------|
| 0 | Cancel #18 (duplicate) | — | housekeeping |
| 1 | #149 Verify Ti60 primitives | — | Ti60 ✦ gating |
| 2 | #148 Ti60 top-level design | #149 | Ti60 |
| 3 | #147 ACK-timeout robustness | #148 | Ti60 |
| 4 | #16 Tang Nano MMIO LEDs | — (parallel) | Tang Nano ✦ gating |
| 5 | #17 Wire Navana.Init | #16 | Tang Nano |
| 6 | #146 Flash BL702 firmware | #147 | firmware |
| 7 | #145 Show firmware version | #146 | IDE polish |
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
