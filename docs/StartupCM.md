# Church Machine — Wukong A7 Startup Sequence

Complete end-to-end startup: from Vivado synthesis through bridge connection to
the first instruction of your chosen abstraction.

---

## Overview

The Wukong A7 startup has two distinct phases:

| Phase | Who | What |
|---|---|---|
| **A — Synthesis** | Vivado toolchain | Bakes boot ROM + DMEM init data + NS table into the bitstream |
| **B — Power-on** | Hardware init sequencer | Writes DMEM from bitstream-embedded data, pulses boot_start, CM runs |

> **Key difference from the previous platform:** The Wukong has no companion
> firmware processor and no over-UART boot-image upload. All DMEM initialisation
> data (NS table, boot lumps, c-list) is embedded into the bitstream at synthesis
> time by the hardware init sequencer. The CM boots from this baked-in state
> immediately on power-on — no IDE connection is required to boot.
>
> The bridge (`hardware/wukong_bridge.py`) is used for **trace observation** and
> **step/run/halt control** after the CM is already running — not for boot loading.

---

## Phase A — Vivado Synthesis (required when changing the boot image or CM logic)

Synthesis runs on a machine with Vivado installed (Wukong droplet or local). It
produces a `.bit` file that embeds:

### What gets baked in

#### 1. Boot ROM — 3 hardcoded instructions

Encoded into a read-only BRAM tile inside the bitstream. **Fixed in silicon** until
re-synthesis.

```
ROM address  Hex          Mnemonic
  0          0x077F8000   LOAD   AL, CR15, CR15[0]   — load NS root from DMEM NS slot 0
  1          0x27678001   CHANGE AL, CR12, CR15, #1  — switch to Boot.Thread (NS slot 1)
  2          0x17000000   CALL   AL, CR0             — enter IDE-chosen first abstraction
```

Source: `hardware/boot_rom.py` → `BOOT_PROGRAM`

#### 2. DMEM init data — NS table + boot lumps + c-list

The hardware init sequencer writes every non-zero DMEM word in the first ~50
cycles after GSR (Global Set/Reset). This data is embedded verbatim in the
bitstream. It includes:

- **NS table** — all namespace slots (word 0 = Boot.NS GT, word 1 = Boot.Thread GT,
  further slots for resident abstractions)
- **Boot.Thread lump** — NS slot 1; contains the thread caps zone including
  `thread[+244]` (the boot entry E-GT)
- **Boot.Abstr lump** — NS slot 6 (LED flash abstraction)
- **DEMO_CLIST** — the c-list for the boot abstraction context (DMEM words 256–319)
- **Thread.caps[0]** — `DMEM word 1140` (`threadBase=896 + THREAD_CAPS_OFFSET=244`);
  the boot-entry E-GT slot used by `CALL CR0`; `0x4A000006` (SelfTest) in the
  factory image

> **Factory entry:** `Thread.caps[0]` contains the SelfTest E-GT
> `0x4A000006`. The boot ROM's CALL reaches SelfTest at NIA `0x604`.
> To configure another static entry, replace that E-GT in the boot image/build
> configuration and rebuild the bitstream. Alternatively, upload a freshly built
> bitstream to the IDE via `/upload/wukong-bit`.

Source: `hardware/wukong_top.py` → `WUKONG_DEMO_NAMESPACE`, `WUKONG_DEMO_CLIST`

#### 3. `halted = Signal(init=1)` — CM starts frozen

The CM is born halted. The init sequencer writes DMEM, then pulses `boot_start`
to release the CM. Until `boot_start` fires, no instruction fetch occurs.

### Synthesis commands

```bash
# On the Wukong droplet — pull latest sources, regenerate RTL, then build:
git pull

# Step 1 — Regenerate Church Machine RTL from Amaranth HDL:
python3 -m hardware.gen_rtlil --wukong
# Output: build/church_wukong_xc7a100t.v

# Step 2 — Copy the generated Verilog to hardware/ where the TCL script looks for it:
cp build/church_wukong_xc7a100t.v hardware/

# Step 3 — Run Vivado batch build from the hardware/ directory:
#   The TCL script expects church_wukong_xc7a100t.v and wukong_xc7a100t.xdc
#   both in the same directory where vivado is invoked.
cd hardware
vivado -mode batch -source wukong_xc7a100t.tcl
# Output: church_wukong_xc7a100t.bit  (in hardware/ directory)
# With ILA debug probes (Vivado Standard/Enterprise license only):
#   vivado -mode batch -source wukong_xc7a100t.tcl -tclargs --insert-ila

# Step 4 — Program the board:
# Option A — Vivado Hardware Manager (GUI):
#   open_hw_manager → connect → Program Device → church_wukong_xc7a100t.bit
# Option B — xc3sprog (Chromebook Linux with Platform Cable USB II):
#   xc3sprog -c xpc -p 0 church_wukong_xc7a100t.bit
```

---

## Phase B — Power-on Boot (automatic, every power cycle)

No IDE connection required. The board boots from the baked-in bitstream data.

### B1 — GSR fires, init sequencer runs

```
GSR asserted (bitstream load complete)
  → All FFs and BRAMs initialised to their bitstream init values
  → init sequencer starts: writes every non-zero DMEM word via BRAM write port
  → Takes ~50 cycles (one write per non-zero word)
  → Pulses boot_start after the last write
```

### B2 — CM released, boot ROM executes

```
boot_start pulse
  → CM fetch pipeline enabled (halted = 0)
  → NIA = 0x00000000, fetches from boot ROM BRAM
```

The 3-instruction boot ROM executes immediately:

```
ROM[0]  LOAD AL, CR15, CR15[0]
  → Reads DMEM NS slot 0 (Boot.NS lump, written by init sequencer)
  → CR15 ← Boot.NS namespace capability

ROM[1]  CHANGE AL, CR12, CR15, #1
  → RESTORE_CALL: loads Boot.Thread lump from DMEM (NS slot 1)
  → Switches processor context to Boot.Thread
  → CR0 ← thread[+244] = the boot entry E-GT (LED flash default)
  → CR6 ← c-list base; CR14 ← abstraction descriptor

ROM[2]  CALL AL, CR0
  → Enters the boot entry abstraction (LED flash, or IDE-configured choice)
```

### B3 — Boot sentinel + NULL fault (standalone power-on)

Immediately before the CM starts executing, the hardware sends a boot sentinel
over UART (57600 8N1, UART TX on pin E3):

```
New bitstreams (current):   0xBC  N_INIT  TU_VERSION
Old bitstreams (stale):     0xBB  N_INIT
```

On **standalone power-on** (factory bitstream, `Thread.caps[0]` =
`0x4A000006` at DMEM word 1140), the CM executes ROM[2] `CALL CR0` and enters
SelfTest at NIA `0x604`. To configure another boot entry, replace that E-GT in
the boot image/build configuration and rebuild/reflash the bitstream.

- `N_INIT` — count of non-zero DMEM words written by the init sequencer (low byte).
  The bridge computes a partial expected count from `WUKONG_DEMO_NAMESPACE` and
  `WUKONG_DEMO_CLIST` and warns if the board's byte does not match. This is an
  advisory hint — a mismatch means the bitstream may have been built from a
  different source revision, not a fatal error.
- `TU_VERSION` — TraceUnit FSM capability version. `0x02` = current (3-packet CALL
  sequences). Stale bitstreams show wrong CR6/CR14 state in the IDE.

### LED status at boot

```
Booting  (POR + init sequencer, ~50 cycles):
  led[0] G21  solid ON   (CM booting indicator — active-LOW: FPGA drives LOW)
  led[1] G20  1 Hz blink (clock-alive heartbeat)

Running  (after boot_start):
  led[0] G21  blinks ~1 Hz via MMIO reg 0 writes (CM-controlled)
  led[1] G20  OFF (no fault); blinks ON if fault_latched is set
```

---

## Bridge — Trace Observation and Step/Run/Halt Control

The bridge is **not required to boot** the board. It is used to observe and
control a running CM.

### Starting the bridge

```bash
python3 hardware/wukong_bridge.py --port=/dev/ttyUSB0 --ide=https://<your-replit-url>
# Use --insecure for a local HTTP server:
python3 hardware/wukong_bridge.py --port=/dev/ttyUSB0 --ide=http://localhost:5000 --insecure
```

On Windows 11, the same bridge runs natively with a `COM` port:

```powershell
py .\wukong_bridge.py --port=COM3 --ide=https://<your-replit-url>
# Or let pyserial choose the first visible serial adapter:
py .\wukong_bridge.py --port=auto --ide=https://<your-replit-url>
```

Install the Windows dependencies with `py -m pip install pyserial requests`.
See [`docs/bridge-setup-windows.md`](bridge-setup-windows.md) for the complete
Device Manager and troubleshooting steps.

### What the bridge does

**UART → IDE (board → server):**
- `0xAA`-prefixed 12-byte trace packets decoded and POSTed to `/hardware/wukong/trace`
- `0xBC`/`0xBB` boot sentinel parsed and POSTed to `/hardware/wukong/boot-info`
- ASCII bytes (bit 7 clear) printed as CM program output

**IDE → UART (server → board)** — polled every 50 ms from `/hardware/wukong/command`:

| Command | Byte sent | Effect |
|:--------|:----------|:-------|
| `"s"` | `b's'` | Step — execute one instruction |
| `"r"` | `b'r'` | Run free |
| `"h"` | `b'h'` | Halt immediately |
| `"b"` + NIA | `b'b'` + 4-byte big-endian NIA | Set/clear breakpoint |

### Trace packet format (12 bytes)

```
[0]     0xAA      magic
[1..4]  NIA       retiring instruction NIA (uint32 big-endian)
[5]     ev_type   TRACE_EV_* (which CR changed, or stack push/pop)
[6..9]  payload   GT word0 (uint32 big-endian); 0 for push/pop events
[10]    flags     bits[3:0] = NZCV; bits[7:4] = 0
[11]    fault     bits[4:0]=fault_code; bit[6]=fault_valid; bit[7]=bp_hit
```

Multi-event instructions emit multiple consecutive packets with the same NIA:
- `LOAD` → 2 packets (LOAD.shadow, LOAD.new)
- `CHANGE` → 3 packets (CHANGE.push, CHANGE.CR12, CHANGE.CR5)
- `CALL` → 3 packets (CALL.CR6, CALL.CR14, CALL.push)
- `RETURN` → 3 packets (RETURN.pop, RETURN.CR6, RETURN.CR14)

---

## Typical End-to-End Session (reference)

**Two scenarios — choose based on your bitstream:**

**Scenario A — Factory bitstream (Thread.caps[0] = SelfTest at DMEM word 1140):**
```
1.  Flash church_wukong_xc7a100t.bit (factory build)
2.  Power cycle the Wukong A7 board
3.  Board sends boot sentinel:  0xBC N_INIT TU_VERSION
4.  CM executes ROM[0]  LOAD CR15, CR15[0]
5.  CM executes ROM[1]  CHANGE CR12, CR15, #1
6.  CM executes ROM[2]  CALL CR0     ← enters SelfTest at NIA 0x604
7.  Start bridge:  python3 hardware/wukong_bridge.py --port=/dev/ttyUSB0 --ide=https://...
8.  Bridge receives the boot trace and SelfTest events; IDE shows the factory
     SelfTest execution state
```

**Scenario B — Configured bitstream (Thread.caps[0] set to a valid boot E-GT):**
```
1.  Set DMEM word 244 in hardware/wukong_top.py dmem_init, rebuild, flash
2.  Power cycle the Wukong A7 board
3.  Board sends boot sentinel:  0xBC N_INIT TU_VERSION
4.  CM executes ROM[0]  LOAD CR15, CR15[0]
5.  CM executes ROM[1]  CHANGE CR12, CR15, #1
6.  CM executes ROM[2]  CALL CR0     ← enters configured boot abstraction
7.  led[0] begins blinking at ~1 Hz (CM running LED abstraction, if boot entry = SelfTest/WukongCallHome)
8.  Start bridge:  python3 hardware/wukong_bridge.py --port=/dev/ttyUSB0 --ide=https://...
9.  IDE shows boot sentinel OK, trace packets stream in
10. Use IDE step/run/halt controls as needed
```

---

## File Reference

| File | Role |
|---|---|
| `hardware/boot_rom.py` | `BOOT_PROGRAM`, `WUKONG_DEMO_NAMESPACE`, `WUKONG_DEMO_CLIST` |
| `hardware/gen_rtlil.py` | Generates Wukong RTL from Amaranth HDL (`--wukong` flag) |
| `hardware/wukong_top.py` | Wukong A7 top-level — init sequencer, boot ROM, MMIO, UART |
| `hardware/wukong_bridge.py` | USB-Serial bridge — trace observation and step/run/halt control |
| `hardware/uart_tx.py` | 8N1 UART transmitter (boot sentinel + CM UART output) |
| `hardware/uart_rx.py` | 8N1 UART receiver (step/run/halt/breakpoint commands from IDE) |

---

> **Historical reference:** The previous FPGA platform used an over-UART boot-image
> upload protocol (PATCH_LUMP / FREE_RUN) with a companion RISC-V firmware.
> That sequence is preserved at
> [`docs/archive/StartupCM-ti60.md`](archive/StartupCM-ti60.md).
