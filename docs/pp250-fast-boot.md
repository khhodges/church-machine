# PP250 Fast Boot — Design & Implementation Plan

## Background

The PP250 (Plessey UK, 1972) responded to any fault with a hardware-enforced
three-instruction boot sequence.  There was no countdown, no firmware
handshake, no polling loop.  Fault detected → three instructions executed →
machine running again.  The whole recovery was measured in nanoseconds.

The Church Machine inherits this principle.  The three boot instructions are
already burned into `hardware/boot_rom.py`:

```
[0] LOAD   AL, CR15, CR15[0]   — load full namespace into CR15
[1] CHANGE AL, CR12, CR15, #1  — switch to Boot.Thread; CRs 0-11 restored from thread caps
[2] CALL   AL, CR0,  CR0       — enter the IDE-configured boot entry abstraction
```

The hardware boot FSM in `hardware/core.py` runs these in six clock cycles:

```
IDLE → FAULT_RST → LOAD_NS → INIT_THRD → INIT_CLIST → LOAD_NUC → COMPLETE
```

At 25 MHz that is **240 nanoseconds** from `boot_start` pulse to
`boot_complete` high.  At 50 MHz (with PLL) it is 120 ns.

---

## Problem: What Is Actually Slow Today

The hardware itself is instant.  The firmware (`hardware/soc_combined/firmware/main.c`)
wraps the 240 ns hardware boot in **≥ 7 seconds of pure waiting** before the
CM is even kicked:

| Delay | Duration | Code location | Why it exists |
|-------|----------|---------------|---------------|
| "CONNECT NOW" countdown | **5.0 s** | Step 2b — `delay_loops` × 5 | Give a late terminal time to open |
| Poll `CM_STATUS_BOOT_COMPLETE` | **up to 8.0 s** | Step 3 wait loop | Timeout guard |
| Button-hold kick (`CM_CTRL_PRESSED`) | **1.04 s** | After poll | Assert `boot_start` long enough |

Total worst-case cold-boot delay before first CALLHOME: **≈ 14 seconds**.

### On fault: nothing recovers the machine

The monitor loop reads `CM_STATUS_FAULT_LATCHED` every second and includes
the fault code in the CALLHOME JSON.  It does **not** pulse `CM_CTRL_PRESSED`
to re-assert `boot_start`.  The CM sits in a faulted COMPLETE state forever.
Recovery requires a full power-cycle, which re-runs the 14-second sequence.

This is the opposite of the PP250 model.

---

## Hardware Boot FSM — Current State

`hardware/core.py`, signal `boot_state_reg` (3-bit), driven by `self.boot_start`:

```python
with m.Case(BootState.IDLE):
    with m.If(self.boot_start):
        m.d.sync += boot_state_reg.eq(BootState.FAULT_RST)
with m.Case(BootState.FAULT_RST):
    m.d.sync += boot_state_reg.eq(BootState.LOAD_NS)
with m.Case(BootState.LOAD_NS):
    m.d.sync += boot_state_reg.eq(BootState.INIT_THRD)
with m.Case(BootState.INIT_THRD):
    m.d.sync += boot_state_reg.eq(BootState.INIT_CLIST)
with m.Case(BootState.INIT_CLIST):
    m.d.sync += boot_state_reg.eq(BootState.LOAD_NUC)
with m.Case(BootState.LOAD_NUC):
    m.d.sync += boot_state_reg.eq(BootState.COMPLETE)
with m.Case(BootState.COMPLETE):
    m.d.sync += boot_state_reg.eq(BootState.COMPLETE)   # stays here until fault or reboot
```

A `u_return.reboot_request` already drives `boot_state_reg → FAULT_RST`
(core.py line 734).  `fault_valid` does **not** directly trigger this path —
it is only exposed on the APB3 STATUS register for firmware to read.

---

## Three-Track Implementation Plan

### Track 1 — Firmware Only (no new bitstream)

**File:** `hardware/soc_combined/firmware/main.c`

**Goal:** Cut cold boot from ≥ 14 s to ≤ 0.5 s.  Add fault recovery without
power-cycle.

#### Change 1 — Remove the 5-second countdown

```c
/* BEFORE (Step 2b) */
uart_puts("CONNECT NOW — APB3 init in 5s\r\n");
for (uint32_t cd = 5; cd > 0; cd--) {
    uart_puts("  T-");
    uart_putc('0' + (char)cd);
    uart_puts("\r\n");
    delay_loops(LOOPS_PER_SECOND);   // 5 × 1 s = 5 s wasted
}

/* AFTER */
uart_puts("CONNECT NOW\r\n");        // immediate; CALLHOME repeats every second anyway
```

Late-connecting terminals will see the CALLHOME announcement within 1 second
of connecting.  No information is lost.

#### Change 2 — Shorten the button-hold kick from 1.04 s to 5 ms

`boot_start` is sampled on the rising edge of the clock.  One clock at 25 MHz
is 40 ns.  The firmware only needs to hold `CM_CTRL_PRESSED` long enough for
the APB3 write to complete — microseconds, not seconds.

```c
/* BEFORE */
CM_CTRL = CM_CTRL_PRESSED;
delay_loops(LOOPS_PER_SECOND + LOOPS_PER_SECOND / 25);  /* ~1.04 s */
CM_CTRL = CM_CTRL_RELEASED;

/* AFTER */
CM_CTRL = CM_CTRL_PRESSED;
delay_loops(CLK_HZ / 200);   /* 5 ms — plenty for APB3 write + clock sync */
CM_CTRL = CM_CTRL_RELEASED;
```

#### Change 3 — Add fault recovery in the monitor loop

When `FAULT_LATCHED` is detected: log it to UART, then immediately re-pulse
`CM_CTRL_PRESSED` to fire `boot_start`.  The hardware FSM runs the three boot
instructions in 240 ns and `boot_complete` goes high again.

```c
/* Inside the monitor for(;;) loop, after reading CM_STATUS: */
if (status & CM_STATUS_FAULT_LATCHED) {
    uart_puts(" FAULT=");
    uart_puthex32(CM_FAULT & 0x1F);
    uart_puts("\r\n");
    uart_puts("[PP250] FAULT_RST — pulsing boot_start\r\n");
    CM_CTRL = CM_CTRL_PRESSED;
    delay_loops(CLK_HZ / 200);          /* 5 ms */
    CM_CTRL = CM_CTRL_RELEASED;
    /* Wait for CM to re-complete boot (hardware takes 6 cycles = 240 ns) */
    for (uint32_t t = 0; t < 10; t++) {
        if (CM_STATUS & CM_STATUS_BOOT_COMPLETE) break;
        delay_loops(CLK_HZ / 1000);     /* 1 ms per poll, 10 ms max */
    }
    uart_puts("[PP250] boot_complete after fault recovery\r\n");
}
```

**Result after Track 1:**

| Metric | Before | After |
|--------|--------|-------|
| Cold boot to first CALLHOME | ≥ 14 s | ≤ 0.5 s |
| Fault recovery | power-cycle required | ≤ 10 ms |
| New bitstream required | — | No |

---

### Track 2 — Simulator Mirrors Hardware

**File:** `simulator/simulator.js`

The simulator's `_bootStep()` state machine has 8 steps driven one at a time
by `step()`.  After Track 1 the hardware recovers in ≤ 10 ms; the simulator
must match that feel — instant, not step-by-step.

#### Add `_fastBoot()`

New method that executes all boot state in one synchronous call, replacing
the step-loop for fault-recovery paths.

```
_fastBoot()
  1. FAULT_RST — clear all CRs/DRs, flags, stack; set mElevation=true; log fault message
  2. LOAD_NS   — CR15 ← NS Slot 0 (namespace root)
  3. LOAD_NUC  — CR12 ← thread; heap/sp_max; CR6 ← E-GT for boot entry;
                 sentinel frame pushed; CR14 ← code lump; PC=0;
                 mElevation=false; bootComplete=true
  4. setTimeout(() => _asyncCallHome(), 0)  — fire CALLHOME after boot, non-blocking
```

The existing `_bootStep()` state machine is kept intact for the interactive
Pipeline view / single-step educational mode.

#### Wire into fault paths

- `fault()` — after writing the `faultLog` entry: call `_fastBoot()` instead of halting
- `_tier3Recovery()` — replace `_returnToBoot()` with `_fastBoot()`

#### Update tests

`simulator/test_fault_recovery.js` Tier 3 assertions currently expect
`bootComplete=false` after `_tier3Recovery()`.  With fast-boot these must change:

- `bootComplete` must be `true` immediately after fault
- `halted` must be `false`
- `pc` must be `0`
- Machine must accept `step()` without any manual boot steps

**Result after Track 2:** Simulator fault recovery is instant, matching
Track 1 hardware behaviour.  No bitstream needed.

---

### Track 3 — Hardware Auto-Reboot on Fault (new bitstream)

**File:** `hardware/core.py`

True PP250 behaviour: the hardware itself detects `fault_valid` and immediately
re-enters `FAULT_RST` without any firmware involvement.  No APB3 pulse needed.

#### Add auto-reboot on `fault_valid`

In the sync domain, add a priority condition alongside the existing
`u_return.reboot_request` path (core.py line 734):

```python
with m.If(u_return.reboot_request | (self.fault_valid & self.boot_complete)):
    m.d.sync += [boot_state_reg.eq(BootState.FAULT_RST), nia_reg.eq(0)]
```

Cycle-by-cycle sequence on any fault:

| Cycle | `boot_state_reg` | What happens |
|-------|-----------------|--------------|
| N | COMPLETE | `fault_valid` high — instruction faulted |
| N+1 | FAULT_RST | all CRs/DRs cleared |
| N+2 | LOAD_NS | CR15 loaded |
| N+3 | INIT_THRD | CR12 loaded |
| N+4 | INIT_CLIST | C-list loaded |
| N+5 | LOAD_NUC | CR14 + PC set |
| N+6 | COMPLETE | `boot_complete` high — CM running again |

**Total hardware fault recovery: 6 clock cycles = 240 ns at 25 MHz.**

Firmware still reads `CM_STATUS_FAULT_LATCHED` (sticky bit) and logs it in
the CALLHOME packet.  Track 1 Change 3 simplifies to logging only — no
manual pulse needed.

**Requires:** Re-synthesis in Efinix Efinity → new `.bit` bitstream →
`run_efx_pgm.sh` to flash Ti60 F225.

---

## Track 4 — GT Fault Telemetry: Full Diagnostics to the IDE

### Why this matters

Golden Tokens are the performance and security primitive of the Church Machine.
Every capability violation is a GT event.  The simulator fault popup already
shows the full story — which instruction faulted, which GT was involved, which
pipeline stage caught it, which abstraction was active — but **none of that
reaches the IDE from real hardware today**.

The board currently sends only a 5-bit fault code.  The IDE receives:

```json
{"board":"Ti60F225", "uid":"...", "nia":"0x00000008",
 "boot_ok":1, "fault":1, "fault_code":7, "fw_major":1, "fw_minor":0}
```

`fault_code: 7` is `NULL_CAP`.  The IDE has no idea which instruction caused
it, which GT was the empty capability, or which abstraction was running.

### What the simulator fault popup already computes

```javascript
{
  type:                   'NULL_CAP',       // fault type string
  faultCode:              0x07,             // numeric hardware code
  faultingMnemonic:       'CALL',           // which ISA instruction faulted
  involvedGT:             0x01800003,       // GT word0 that caused the violation
  pipelineStage:          'ELOADCALL',      // which pipeline unit caught it
  faultingAbstractionSlot: 3,              // CR14[15:0] — active abstraction NS slot
  faultingAbstractionLabel: 'Boot.Abstr',  // pet name from nsLabels[]
  tier:                   1,               // recovery tier attempted
  catchInvoked:           false,
  irqInvoked:             false,
  tier3Recovery:          false
}
```

Every field maps to a hardware signal that exists in the core but is not
yet exposed over APB3.

---

### Current APB3 Register Map (Ti60 hardware today)

```
Offset  Name        Access   Width  Contents
+0x00   CTRL        W/R      1 bit  cm_pb (0=pressed/boot_start, 1=released)
+0x04   STATUS      RO       3 bit  boot_complete | fault_valid | fault_latched
+0x08   NIA         RO      32 bit  next instruction address at last fault
+0x0C   FAULT       RO       5 bit  fault code (FaultType enum, 32 values)
+0x10   UID_LO      RO      32 bit  board UID low word
+0x14   UID_HI      RO      32 bit  board UID high word
```

Nothing above `+0x14` exists.  The fault GT, the faulting instruction word,
the active CR14, and the pipeline stage are all visible inside the Amaranth
core but have no APB3 window.

---

### Hardware Fault Code Mapping (already canonical in simulator)

`ChurchSimulator.FAULT_CODES` in `simulator/simulator.js` is the single source
of truth for fault code numbers.  The same table must live in the bridge and
firmware so that `fault_code: 7` → `"NULL_CAP"` without IDE involvement.

```
0x01 PERM_R       0x02 PERM_W       0x03 PERM_X
0x04 PERM_L       0x05 PERM_S       0x06 PERM_E
0x07 NULL_CAP     0x08 BOUNDS       0x09 VERSION
0x0A SEAL         0x0B INVALID_OP   0x0C TPERM_RSV
0x0D DOMAIN_PURITY  0x0E BIND       0x0F F_BIT
0x10 STACK_OVERFLOW 0x11 ABSENT_OUTFORM 0x12 STACK_CORRUPT
0x13 STACK_UNDERFLOW 0x15 OUTFORM_CRC 0x16 OUTFORM_ALLOC
0x17 OUTFORM_MINT    0x18 OUTFORM_HDR
```

---

### Four-Layer Enrichment Plan

#### Layer A — Bridge (Python, no firmware change, no bitstream)

**File:** `hardware/soc_combined/callhome_bridge.py`

Add `fault_name` to the POST payload by looking up `fault_code` in a local
copy of the fault code table:

```python
_FAULT_NAMES = {
    0x01:"PERM_R", 0x02:"PERM_W", 0x03:"PERM_X",
    0x04:"PERM_L", 0x05:"PERM_S", 0x06:"PERM_E",
    0x07:"NULL_CAP", 0x08:"BOUNDS", 0x09:"VERSION",
    0x0A:"SEAL", 0x0B:"INVALID_OP", 0x0C:"TPERM_RSV",
    0x0D:"DOMAIN_PURITY", 0x0E:"BIND", 0x0F:"F_BIT",
    0x10:"STACK_OVERFLOW", 0x11:"ABSENT_OUTFORM",
    0x12:"STACK_CORRUPT", 0x13:"STACK_UNDERFLOW",
    0x15:"OUTFORM_CRC", 0x16:"OUTFORM_ALLOC",
    0x17:"OUTFORM_MINT", 0x18:"OUTFORM_HDR",
}

# In _handle_callhome_json():
payload["fault_name"] = _FAULT_NAMES.get(fault_code, f"FAULT_0x{fault_code:02X}")
```

The bridge also decodes the `fault_gt` field (when firmware provides it —
see Layer B) into human-readable form for the console summary line:

```
[CALL HOME] Ti60F225  UID=...  NIA=0x00000008  FAULT=NULL_CAP
            GT=0x01800003  type=Abstract  perm=E  slot=3 (Boot.Abstr)
```

**No bitstream needed.  Deploy by copying updated bridge to the Penguin.**

---

#### Layer B — Firmware (no new bitstream if APB3 registers absent; full if present)

**File:** `hardware/soc_combined/firmware/main.c`

When the Track 4 APB3 registers exist (Layer C below), the firmware reads
them at fault time and adds them to the CALLHOME JSON:

```c
/* Extended CALLHOME — fields added when Track 4 APB3 registers are present */
uart_puts(",\"fault_name\":\"");
uart_puts(fault_code_name(fault_code));          /* lookup table */
uart_puts("\",\"fault_gt\":\"0x");
uart_puthex32(CM_FAULT_GT);                      /* +0x18 — see Layer C */
uart_puts("\",\"fault_instr\":\"0x");
uart_puthex32(CM_FAULT_INSTR);                   /* +0x1C */
uart_puts("\",\"fault_cr14\":\"0x");
uart_puthex32(CM_FAULT_CR14);                    /* +0x20 */
uart_puts("\",\"fault_stage\":");
uart_putdec(CM_FAULT_STAGE & 0xFu);              /* +0x24 */
```

Before Layer C is ready, the firmware emits `fault_name` only (derived from
the existing `CM_FAULT` register — no new hardware needed).

**Firmware-only CALLHOME after Layer A + B (no new bitstream):**

```json
{
  "board":"Ti60F225", "uid":"...", "nia":"0x00000008",
  "boot_ok":1, "fault":1, "fault_code":7, "fault_name":"NULL_CAP",
  "fw_major":1, "fw_minor":0
}
```

**Full CALLHOME after Layer C (new bitstream):**

```json
{
  "board":"Ti60F225", "uid":"...", "nia":"0x00000008",
  "boot_ok":1, "fault":1, "fault_code":7, "fault_name":"NULL_CAP",
  "fault_gt":"0x01800003", "fault_instr":"0xD8000000",
  "fault_cr14":"0x01C00003", "fault_stage":3,
  "fw_major":1, "fw_minor":0
}
```

---

#### Layer C — New APB3 Fault Registers (new bitstream)

**Files:** `hardware/core.py` + APB3 bridge module

Four new read-only registers, latched at the moment `fault_valid` fires and
held until the next `boot_start` pulse (i.e. stable for firmware to read
during the monitor loop):

```
Offset   Name           Width   Contents
+0x18    FAULT_GT       32 bit  GT word0 of the capability that caused the fault
                                (from mLoad/perm pipeline; latched on fault_valid)
+0x1C    FAULT_INSTR    32 bit  instruction word at the faulting NIA
                                (from fetch stage; latched on fault_valid)
+0x20    FAULT_CR14     32 bit  CR14 word0 at fault time
                                (active abstraction GT → bits[15:0] = NS slot)
+0x24    FAULT_STAGE    4 bit   pipeline stage that raised fault_valid:
                                0=DECODE  1=PERM  2=MWIN  3=ELOADCALL
                                4=LAMBDA  5=RETURN  6=BOUNDS  7=DREAD/DWRITE
```

Amaranth HDL pattern (inside the APB3 bridge module):

```python
fault_gt_latch    = Signal(32)
fault_instr_latch = Signal(32)
fault_cr14_latch  = Signal(32)
fault_stage_latch = Signal(4)

with m.If(u_core.fault_valid & u_core.boot_complete):
    m.d.sync += [
        fault_gt_latch.eq(u_core.fault_gt),        # new output signal on core
        fault_instr_latch.eq(u_core.fault_instr),  # new output signal on core
        fault_cr14_latch.eq(u_core.fault_cr14),    # new output signal on core
        fault_stage_latch.eq(u_core.fault_stage),  # new output signal on core
    ]

# APB3 read mux (existing pattern):
with m.Case(0x18 >> 2):
    m.d.comb += apb_prdata.eq(fault_gt_latch)
with m.Case(0x1C >> 2):
    m.d.comb += apb_prdata.eq(fault_instr_latch)
with m.Case(0x20 >> 2):
    m.d.comb += apb_prdata.eq(fault_cr14_latch)
with m.Case(0x24 >> 2):
    m.d.comb += apb_prdata.eq(Cat(fault_stage_latch, Const(0, 28)))
```

New output signals on `hardware/core.py` (`ChurchMachineCore`):

```python
self.fault_gt    = Signal(32)   # GT word0 involved in fault (from perm/mLoad units)
self.fault_instr = Signal(32)   # instruction word at fault NIA
self.fault_cr14  = Signal(32)   # CR14 word0 at fault time
self.fault_stage = Signal(4)    # which pipeline stage raised fault_valid
```

**Requires:** Re-synthesis in Efinix Efinity → new `.bit` → flash Ti60.

---

#### Layer D — IDE Devices Panel (JavaScript, no bitstream)

**File:** `simulator/index.html` + Devices panel JS

The bridge already POSTs to the IDE `/callhome` endpoint.  The server stores
the payload in `_latest_callhome_data`.  The Devices panel JS reads it on
each poll.

Additions:

1. **Fault name badge** — replace raw `fault_code: 7` with `NULL_CAP` in the
   panel's fault line.  Derived from `fault_name` field (available after
   Layer A — no bitstream needed).

2. **GT detail row** — when `fault_gt` is present (Layer C onwards), decode
   the 32-bit word inline using the same GT field layout as the simulator:
   - `bits[24:23]` → GT type (Null / Inform / Outform / Abstract)
   - `dom[27]` + `perm[30:28]` → permission string (E / S / L / X / W / R)
   - `bits[15:0]` → slot index → look up pet name from last-known namespace

3. **Abstraction label** — `fault_cr14[15:0]` gives the NS slot of the
   abstraction that was running when the fault fired.  Display as pet name
   (e.g. "Boot.Abstr", "Math.Add") never as a raw slot number.

4. **Pipeline stage** — `fault_stage` int → human string using a small map:
   ```javascript
   const STAGE_NAMES = ['Decode','Permission','M-Window','ELOAD/CALL',
                         'Lambda','Return','Bounds','Data R/W'];
   ```

**Display principle:** GT hex words are never shown raw to the user.
Every GT field is translated to a pet name, permission label, or type badge.

---

## Files Changed Per Track

| File | T1 | T2 | T3 | T4-A | T4-B | T4-C | T4-D |
|------|:--:|:--:|:--:|:----:|:----:|:----:|:----:|
| `hardware/soc_combined/firmware/main.c` | ✓ | — | ✓ | — | ✓ | ✓ | — |
| `hardware/soc_combined/callhome_bridge.py` | — | — | — | ✓ | — | — | — |
| `simulator/simulator.js` | — | ✓ | — | — | — | — | — |
| `simulator/test_fault_recovery.js` | — | ✓ | — | — | — | — | — |
| `hardware/core.py` | — | — | ✓ | — | — | ✓ | — |
| APB3 bridge HDL module | — | — | — | — | — | ✓ | — |
| `simulator/index.html` + Devices JS | — | — | — | — | — | — | ✓ |
| `server/app.py` | — | — | — | — | — | — | ✓ |
| `docs/instruction-set.md` | — | ✓ | ✓ | — | — | — | — |

---

## Recommended Build Order

1. **Track 1** — firmware only; recompile and flash today.
   Confirm cold boot ≤ 0.5 s and fault recovery ≤ 10 ms over UART at 57600 baud.

2. **Track 4-A** — bridge Python change; deploy to Penguin by copying file.
   Confirm `fault_name` appears in Devices panel on next CALLHOME.

3. **Track 4-B (partial)** — firmware emits `fault_name` field; no new registers yet.
   Verify end-to-end: board faults → terminal shows `NULL_CAP` → IDE Devices panel shows it.

4. **Track 2** — simulator matches firmware; run `fault-recovery-tests` and
   update Tier 3 assertions.

5. **Track 3 + Track 4-C** — both require a new bitstream; do them in the
   same synthesis run.  Hardware auto-reboots on fault; APB3 exposes GT,
   instruction, CR14, pipeline stage.

6. **Track 4-B (full)** — firmware reads the four new APB3 registers and
   emits the complete CALLHOME fault payload.

7. **Track 4-D** — IDE Devices panel decodes GT fields and shows pet names.
   `fault_code: 7` is gone; the panel shows `NULL_CAP — CALL — Boot.Abstr`.

---

## Timing Summary

| Phase | Cold boot to CALLHOME | Fault recovery | GT in CALLHOME |
|-------|-----------------------|----------------|----------------|
| Today (pre-change) | ≥ 14 s | power-cycle required | No |
| After T1 + T4-A/B | ≤ 0.5 s | ≤ 10 ms | Name only |
| After T3 + T4-C/D | ≤ 0.5 s | 240 ns (6 cycles) | Full GT + stage |
| PP250 original | — | nanoseconds | N/A |

---

## Notes

- `CLK_HZ = 25000000` (25 MHz). If PLL ×2 is enabled later, change timing
  figures to 50 MHz / 120 ns per cycle.
- `LOOPS_PER_SECOND = CLK_HZ / 4 = 6,250,000` — each `delay_loops(n)` call
  burns approximately `n × 4` clock cycles.
- `CM_CTRL_PRESSED = 0`, `CM_CTRL_RELEASED = 1` (active-low push_button).
- The three boot instructions (`LOAD`, `CHANGE`, `CALL`) are fixed in
  `hardware/boot_rom.py`; they do not change across any of the three tracks.
- GT hex words must **never** be shown raw in the IDE.  Every GT field is
  decoded to a type badge, permission label, or pet name before display.
- `ChurchSimulator.FAULT_CODES` in `simulator/simulator.js` is the single
  authoritative source for fault code numbers.  The bridge lookup table
  (`_FAULT_NAMES`) and any firmware lookup must stay in sync with it.
