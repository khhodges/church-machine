# Church Machine — Ti60 F225 Startup Sequence

Complete end-to-end startup: from Efinity synthesis through DMEM loading to the first
instruction of your chosen abstraction.

---

## Overview

The Church Machine startup has three distinct phases:

| Phase | Who | What |
|---|---|---|
| **A — Synthesis** | Efinity toolchain | Bakes fixed logic + boot ROM into the bitstream |
| **B — RAM Load** | IDE via UART | Writes NS table + LUMP binaries into DMEM |
| **C — Boot ROM** | CM hardware | Executes 3 fixed instructions, enters your abstraction |

Phase B **must complete** before Phase C will succeed. The boot ROM instructions
dereference addresses in DMEM — if DMEM is empty, all three fault immediately and
the board loops at NIA=0.

---

## Phase A — Efinity Synthesis (one-time, baked into the bitstream)

Run once on your Efinity machine. Output: `build/church_ti60_f225.v` → `.bit` file.

### What gets baked in

#### 1. Boot ROM — 3 hardcoded instructions (NIA 0x000–0x008)

Encoded into BRAM init data inside the bitstream. **Fixed in silicon** — cannot
be changed without re-synthesis.

```
Word address   Hex          Mnemonic
  0x000        0x077F8000   LOAD   AL, CR15, CR15[0]   — load namespace GT from DMEM NS slot 0
  0x001        0x27678001   CHANGE AL, CR12, CR15, #1  — switch to Boot.Thread (NS slot 1)
  0x002        0x17000000   CALL   AL, CR0             — enter IDE-chosen first abstraction
```

Source: `hardware/boot_rom.py` → `BOOT_PROGRAM`
Encoding: `encode_church(opcode, CondCode.AL, cr_dst, cr_src, imm)`

#### 2. NUC_PROGRAM — LED blink demo (NIA 0x010–…)

A fallback LED blink program also baked into the boot ROM region. Used when no
PATCH_LUMP has been received and the board first powers on. Visible in the NIA
stream as NIA=0x00000010 repeating.

#### 3. Debug FSM

The UART snooper that receives PATCH_LUMP and FREE_RUN opcodes. Baked into the
CM top-level logic. Source: `hardware/ti60_f225.py`.

#### 4. Sapphire RISC-V SoC

The companion firmware processor. Prints the boot greeting and CALLHOME JSON.
Source: `hardware/soc_combined/firmware/main.c`.

#### 5. `halted = Signal(init=1)` — CM starts frozen

The CM core is born halted. No instruction fetch occurs until the Debug FSM
explicitly releases it. This is a hardware register initialised to 1 in the
bitstream — **the CM cannot run until the IDE says so**.

### Synthesis commands

```bash
# On your Efinity machine — regenerate Verilog first:
python3 -m hardware.gen_verilog --ti60

# Then open build/church_ti60_f225.v in Efinity and synthesise normally.
# Flash the resulting .bit file to the Ti60 F225 via JTAG.
```

---

## Phase B — IDE Loads DMEM (every power cycle / reset)

DMEM is volatile. Every time the board powers on or resets, it is empty.
The IDE must reload the boot image before the CM can run.

### B1 — Board powers on

```
halted = 1          CM frozen — no instruction fetch
DMEM   = 0x000…    all zeros — NS table absent, no lumps
Sapphire RISC-V starts immediately (it has its own ROM)
```

### B2 — Sapphire prints greeting + CALLHOME

Within ~200 ms of power-on the RISC-V firmware sends two lines over UART:

```
CHURCH Ti60 SoC+CM v1.1
CALLHOME:{"board":"Ti60F225","uid":"c0ffee0100000001","fw_major":1,"fw_minor":0,"boot_ok":1,"nia":"0x00000010","boot_count":N}
```

The `nia` field in CALLHOME shows where the CM is currently executing.
`0x00000010` = NUC_PROGRAM (LED blink fallback) — confirms the CM is running
but DMEM is empty and no real boot has occurred yet.

### B3 — IDE detects the board

**Option A — WebSerial (Chrome/Edge, direct USB)**

```
IDE Dashboard → Ti60 Connect → 🔌 Connect
```

Requires: Chrome or Edge, direct USB connection.
Not available inside a preview iframe — open `/simulator/` in its own tab.

**Option B — Via Bridge (local_bridge.py)**

For ChromeOS/Crostini, Linux, or any case where WebSerial is unavailable:

```bash
# On host machine with USB access:
python3 local_bridge.py /dev/ttyUSB2 115200 8766 --ide=https://<your-replit-url>
```

Then in IDE: **🌉 Via Bridge** — the IDE polls the server for CALLHOME packets.
The bridge tunnels UART bytes to the IDE server; no direct browser→bridge
connection required.

**Option C — Tunnel mode (board already registered)**

If the board sent CALLHOME while the bridge was running, the IDE server caches it.
Click **🌉 Via Bridge** — it finds the last CALLHOME immediately without a
power-cycle.

### B4 — IDE sends PATCH_LUMP frames over UART

After detecting the board the IDE fetches the boot image from the server:

```
GET /api/boot-image/binary
```

This endpoint (`server/boot_image.py`) assembles a single binary containing:
- **NS table** — all namespace slots (0 = Boot.NS GT, 1 = Boot.Thread GT,
  2..N = further slots)
- **Boot.Thread lump** — NS slot 1; contains the thread caps zone including
  `thread[+244]` = IDE-chosen abstraction E-GT (set by `setBootEntrySlot()`)
- **Boot.Abstr lump** — NS slot 3 (LED flash default, or whatever the lightning
  bolt points to)
- **Any resident lumps** ticked in the Resident Lumps tab

The IDE then sends the binary as one or more PATCH_LUMP frames over UART:

```
Frame format: [0xBE][0xEF][addrHi][addrLo][countHi][countLo]
              [N×4 bytes, little-endian] [CRC16_CCITT Hi][CRC16_CCITT Lo]

ACK from FPGA: [addrHi][addrLo][countHi][countLo]
NAK from FPGA: [0x15]  (CRC mismatch)
```

**What happens on the FPGA for each frame:**

```
Debug FSM sees 0xBE 0xEF
  → sets pl_active = 1        (DMEM write mux switches from CPU to FSM)
  → CM remains halted         (halted = 1 still)
  → receives addr, count, N×4 bytes
  → assembles 32-bit LE words
  → drives pl_wr_en + pl_wr_addr + pl_wr_data for each word
  → BRAM write port: word written to DMEM[pl_addr .. pl_addr+N-1]
  → verifies CRC
  → sends 4-byte ACK
  → sets pl_active = 0, goes to HALTED state
  (CM still halted — more frames may follow)
```

Source: `hardware/ti60_f225.py` states `PL_WAIT_EF` → `PL_WRITE_WORD` → `PL_ACK`

### B5 — IDE sets the lightning bolt (boot entry slot)

The IDE writes an E-GT for the user's chosen first abstraction into
`Thread.caps[0]` (word address = thread_lump_base + THREAD_CAPS_OFFSET + 0,
i.e. `thread[+244]`).

Source: `simulator/app-absdetail.js` → `setBootEntrySlot(ns_slot)`

Default: NS slot 3 (Boot.Abstr LED flash).

This GT is read by `CHANGE` during Phase C and lands in CR0, which `CALL` then enters.

### B6 — IDE sends FREE_RUN command

After all frames are ACK'd, the IDE sends two bytes:

```
[0xBE][0xAA]   — FREE_RUN opcode
```

Source: `simulator/webserial.js` → `runFPGA()`

**What happens on the FPGA:**

```
Debug FSM sees 0xBE 0xAA
  → pl_active = 0             (DMEM write mux released back to CPU)
  → core.free_run_start = 1   (one-cycle pulse — resets CM fetch pipeline)
  → core.free_run_nia   = 0   (start address = byte 0 = NIA 0x00000000)
  → halted = 0                ← THE RELEASE: CM is now live
  → FSM enters FREE_RUN state
```

Source: `hardware/ti60_f225.py` line ~779, state `PL_WAIT_EF` / `0xAA` branch

---

## Phase C — Boot ROM Executes (3 instructions)

DMEM is now fully populated. The CM fetch pipeline starts at NIA 0x00000000.

```
NIA 0x000  →  0x077F8000  LOAD AL, CR15, CR15[0]
```
Hardware reads DMEM at NS slot 0 (the Boot.NS entry). This 3-word namespace GT
is loaded into CR15. CR15 is now the live namespace capability for this thread.

```
NIA 0x004  →  0x27678001  CHANGE AL, CR12, CR15, #1
```
Hardware performs RESTORE_CALL using CR15 as the namespace source, NS slot 1
(Boot.Thread). The thread lump is read from DMEM. The CHANGE FSM:
- Switches the processor context to Boot.Thread
- Restores CR0–CR11 from the thread's caps zone (`thread[+244..+255]`)
  - **CR0 ← thread[+244]** = the IDE-chosen abstraction E-GT (lightning bolt)
- Transparently loads **CR6** (c-list base) and **CR14** (abstraction descriptor)
  from the lump header — no explicit instructions needed for these

```
NIA 0x008  →  0x17000000  CALL AL, CR0
```
Hardware performs CALL through the E-GT now in CR0. This enters the chosen
first abstraction. If CR0 is NULL (thread[+244] was never set), the hardware
raises NULL_CAP and the board loops.

---

## LED Status at Every Step

The Ti60 F225 has **3 physical LEDs** (LED0–LED2) on GPIO pins GPIOR_P_07/08/09. The step-by-step LED guide, pre-boot signal definitions, and fault indicator are documented canonically at **[docs/HARDWARE.md § 3. LED Pin Assignments](HARDWARE.md#3-led-pin-assignments)**.

> **Note:** An older 4-LED table that appeared in this section reflected an earlier hardware revision. The physical board has 3 user LEDs. See HARDWARE.md § 3 for the authoritative assignments.

---

## IDE Options During / After Boot

### NIA stream — live instruction trace

After connecting (WebSerial or Bridge), the IDE opens a live NIA stream:

```
IDE Dashboard → Ti60 Connect → NIA stream panel
```

Each `NIA=0xNNNNNNNN` line from the UART is decoded and annotated in real time:
```
NIA → 0x00000000  [0x077F8000]  LOAD AL, CR15, CR15[0]
NIA → 0x00000004  [0x27678001]  CHANGE AL, CR12, CR15, #1
NIA → 0x00000008  [0x17000000]  CALL AL, CR0
```

Source: `simulator/app-ti60-connect.js` → `_decodeNIA()`, `_niaTunnelStream()`

The decoder knows two code regions:
1. **Boot ROM** (baked into bitstream) — NIA 0x000–0x0FC
2. **Boot.Abstr LUMP code** — NIA range = lump_base+1 … lump_base+cw

### CALLHOME telemetry

Every reboot the Sapphire firmware sends a CALLHOME JSON line. The IDE server
records it. The Connect panel shows:
- `boot_ok` — did the firmware consider the CM boot successful?
- `nia` — last NIA seen before the CM reached steady state
- `boot_count` — how many times this board has called home

### Reboot detection

While the NIA tunnel stream is active, any new CALLHOME packet is detected
and triggers `_finishSteps()` automatically — re-registering the device and
re-running TEST-09 confirmation without any user action.

### TEST-09 — launch test confirmation

On successful CALLHOME the IDE calls:
```
POST /api/launch-tests/report   { status: 'passing', note: 'Ti60 CALLHOME confirmed' }
GET  /api/launch-tests/confirm
```
This marks the Ti60 call-home test as passing in the IDE database.

---

## Tested End-to-End Boot Session (reference)

The following sequence was observed on board uid=`c0ffee0100000001`, /dev/ttyUSB2:

```
1.  Power on Ti60
2.  Sapphire prints:  CHURCH Ti60 SoC+CM v1.1
3.  Sapphire prints:  CALLHOME:{…"nia":"0x00000010"…}   ← NUC_PROGRAM (DMEM empty)
4.  IDE: 🌉 Via Bridge  →  CALLHOME detected
5.  IDE: PATCH_LUMP (NS table + Thread + Boot.Abstr)  →  4-byte ACK each
6.  IDE: 0xBE 0xAA (FREE_RUN)  →  halted=0
7.  CM executes NIA=0x000  LOAD CR15, CR15[0]
8.  CM executes NIA=0x004  CHANGE CR12, CR15, #1
9.  CM executes NIA=0x008  CALL CR0
10. NIA stream shows NIA=0x00000140 (Boot.Abstr LED flash first code word)
11. LED begins blinking on the board
```

If step 5 is skipped (no PATCH_LUMP), DMEM is zero and LOAD faults → board
stays at NIA=0x00000000 repeating (the symptom seen in the original boot loop).

---

## File Reference

| File | Role |
|---|---|
| `hardware/boot_rom.py` | `BOOT_PROGRAM` — 3 instruction source-of-truth |
| `hardware/gen_verilog.py` | Generates `build/church_ti60_f225.v` from BOOT_PROGRAM |
| `hardware/ti60_f225.py` | Debug FSM — PATCH_LUMP + FREE_RUN hardware logic |
| `server/boot_image.py` | `BOOT_ROM_WORDS`, `/api/boot-image/binary` endpoint |
| `simulator/webserial.js` | `patchLump()`, `runFPGA()` — UART protocol sender |
| `simulator/app-ti60-connect.js` | Connect UI, NIA stream, CALLHOME handling |
| `simulator/app-absdetail.js` | `setBootEntrySlot()` — writes E-GT to thread[+244] |
| `hardware/soc_combined/firmware/main.c` | Sapphire RISC-V firmware, CALLHOME printer |
