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

### Hardware Fault Code Mapping (authoritative table)

`ChurchSimulator.FAULT_CODES` in `simulator/simulator.js` is the single source
of truth for fault code numbers.  The bridge lookup table, firmware lookup
table, and IDE decoder **must all stay in sync with this table**.

Fault codes fall into three categories:

**Hardware faults** — assigned numeric codes; detected and latched by the FPGA;
carried verbatim in `CM_FAULT[4:0]` and in the `fault_code` CALLHOME field.

**Logic / arithmetic errors** — some have hardware codes (range check, stack),
others are software-detected in the simulator execution model.

**Software-originated faults** — fired from `.catch` handler escalation, Tier 2
IRQ, or explicit `fault()` calls in system abstractions.  These have `null`
hardware codes and can never appear in `CM_FAULT`; they are simulator-only.

---

#### Special Codes

| Code | Name | Meaning |
|------|------|---------|
| 0x00 | `UNKNOWN` | No fault code assigned, or code not recognised. Sentinel value — `CM_FAULT` reads 0 when `fault_valid=0` (normal running). When `fault=1` arrives in a CALLHOME packet with `fault_code=0`, display as `UNKNOWN` rather than silently suppressing. Bridge: `_FAULT_NAMES.get(fault_code, "UNKNOWN")` — fall back to `UNKNOWN`, not `"FAULT_0xNN"`. |

---

#### Category 1 — Permission & Capability Faults (hardware codes 0x01–0x0F)

| Code | Name | Meaning |
|------|------|---------|
| 0x01 | `PERM_R` | Capability lacks Read permission |
| 0x02 | `PERM_W` | Capability lacks Write permission |
| 0x03 | `PERM_X` | Capability lacks Execute permission |
| 0x04 | `PERM_L` | Capability lacks Lambda permission |
| 0x05 | `PERM_S` | Capability lacks Save permission |
| 0x06 | `PERM_E` | Capability lacks Enter permission |
| 0x07 | `NULL_CAP` | CR holds a null (zero) Golden Token |
| 0x08 | `BOUNDS` | Access outside lump bounds |
| 0x09 | `VERSION` | GT version field does not match NS entry |
| 0x0A | `SEAL` | GT CRC seal is invalid (tampered or corrupt) |
| 0x0B | `INVALID_OP` | Opcode is reserved or not implemented |
| 0x0C | `TPERM_RSV` | TPERM preset index is reserved (10–12 or out of range) |
| 0x0D | `DOMAIN_PURITY` | Church/Turing domain boundary violated |
| 0x0E | `BIND` / `PERM_B` | B (Bind) bit = 0; GT is not bindable to a C-list. Fires from mLoad bind check — same family as PERM_R…PERM_E. `PERM_B` is the preferred display name. |
| 0x0F | `F_BIT` | Far-capability (F=1) used locally — requires HTTP tunnel |

#### Category 2 — Stack, Range, and Logic Errors (hardware codes 0x10–0x18)

| Code | Name | Meaning |
|------|------|---------|
| 0x10 | `STACK_OVERFLOW` / `RANGE` | Stack grew past `sp_max`, **or** address fell outside valid lump range. These share one hardware code. Display as `STACK_OVERFLOW` when the NIA is inside a CALL/RETURN sequence; display as `RANGE` otherwise. |
| 0x11 | `ABSENT_OUTFORM` | Outform slot is null at RETURN time |
| 0x12 | `STACK_CORRUPT` | Stack sentinel word has been overwritten |
| 0x13 | `STACK_UNDERFLOW` | RETURN attempted with empty call stack |
| 0x14 | *(unassigned)* | Reserved for future use |
| 0x15 | `OUTFORM_CRC` | Outform lump CRC failed |
| 0x16 | `OUTFORM_ALLOC` | Outform allocation failed (out of memory) |
| 0x17 | `OUTFORM_MINT` | Outform MINT (mint new GT) operation failed |
| 0x18 | `OUTFORM_HDR` | Outform header word malformed |
| 0x19 | `INT_OVERFLOW` | **(proposed — unassigned today)** Integer arithmetic overflow from IADD/ISUB when the result exceeds the 32-bit signed range. Currently undetected in hardware; should be added to `ChurchSimulator.FAULT_CODES` and the hardware mALU unit. |
| 0x1A–0x1F | *(unassigned)* | Reserved for future logic-error codes |

#### Category 3 — Software-Originated Faults (no hardware code; simulator only)

These fire via `this.fault(type, msg)` inside the simulator execution model.
They cannot appear in `CM_FAULT` — they have `null` in `FAULT_CODES`.  When
they appear in a fault log entry forwarded to the IDE, `fault_code` is 0 and
`fault_name` is the string below.

| Name | When it fires |
|------|---------------|
| `HANDLER` | `DWRITE` / `DREAD` MMIO dispatch hit an unrecognised handler name |
| `MATH_ERROR` | Division by zero, NaN, or Infinity from a Pure Math / Symbolic front-end expression |
| `CATCH_ESCALATE` | `.catch` handler **threw** an exception internally; fault escalates past Tier 1. The fault log records `catchInvoked=true` and `catchThrew=true`. **(Add this name to `FAULT_CODES` as `null`.)** |
| `CATCH_FAULT` | `.catch` handler **explicitly called** `fault()` to signal that it cannot handle the condition and wants Tier 2 / Tier 3 to take over. Distinct from `CATCH_ESCALATE` (handler crash) vs a deliberate escalation request. **(Add to `FAULT_CODES` as `null`.)** |
| `BOOT` | Boot-time invariant violated (missing NS slot, null thread, etc.) |
| `DOMAIN_ERROR` | Operand type incompatible with the current execution domain |
| `LUMP_MAGIC` | Lump header magic byte wrong (lump not installed or memory zeroed) |
| `LUMP_SIZE` | Lump size field inconsistent with allocation |
| `LUMP_LAYOUT` | Lump internal layout invalid |
| `LUMP_OOM` | Lump allocator out of memory |
| `CODE_NOT_RESIDENT` | CALL target lump is absent and the Loader is not available |
| `LAZY_RESOLVE_PENDING` | GT slot is a pending sentinel (0xFEEDxxxx) — lazy-load in progress |
| `PRIVATE_METHOD` | Method called on an abstraction that does not export it |
| `NO_CODE` | Abstraction or method body is empty / zero-length |
| `PERM` | Generic permission failure (composite; not tied to a single PERM_* code) |
| `PERMISSION` | Alias for `PERM`; used by older internal paths — normalise to `PERM` in the IDE display |
| `TYPE` | Operand type mismatch in a typed-dispatch operation |
| `THREAD` | Thread-table corruption or invalid thread index |
| `PRIV_REG` | Access to a privileged register outside M-elevation |

---

#### Notes on specific codes

**`PERM_B` / `BIND` (0x0E):** The B (Bind) bit sits at GT word0 bit 31, separate
from the 3-bit permission field.  A GT with `B=0` cannot be written into a C-list.
`PERM_B` is the display name the Devices panel and fault popup should show — it is
consistent with `PERM_R` through `PERM_E`.  The code stays 0x0E; only the label
shown to users changes.

**`STACK_OVERFLOW` / `RANGE` (0x10 shared):** Both names are registered to 0x10 in
`ChurchSimulator.FAULT_CODES`.  The bridge and IDE should disambiguate using
`fault_instr` (from Layer C APB3 register): if the faulting instruction is `CALL`
or `RETURN`, display `STACK_OVERFLOW`; otherwise display `RANGE`.  Without Layer C
(no new bitstream), display both: `STACK_OVERFLOW / RANGE`.

**`INT_OVERFLOW` (0x19 proposed):** IADD and ISUB can silently wrap today.  Adding
a hardware overflow check and fault code 0x19 requires:
1. Add `INT_OVERFLOW: 0x19` to `ChurchSimulator.FAULT_CODES`.
2. Add overflow detection to the mALU unit in `hardware/core.py`.
3. Add `INT_OVERFLOW` to the bridge lookup table and firmware table.
This is a Track 3 (bitstream) change.

**`CATCH_ESCALATE` and `CATCH_FAULT`:** Both are simulator-only today; they will
never appear in `CM_FAULT`.  They must appear in `fault_name` in the CALLHOME
payload when the simulator's fault log is forwarded to the IDE (Track 4-D IDE
panel should show the tier and whether a catch handler was involved).

---

### Four-Layer Enrichment Plan

#### Layer A — Bridge (Python, no firmware change, no bitstream)

**File:** `hardware/soc_combined/callhome_bridge.py`

Add `fault_name` to the POST payload by looking up `fault_code` in a local
copy of the fault code table:

```python
_FAULT_NAMES = {
    0x00:"UNKNOWN",                                        # sentinel / unrecognised
    0x01:"PERM_R",  0x02:"PERM_W",  0x03:"PERM_X",
    0x04:"PERM_L",  0x05:"PERM_S",  0x06:"PERM_E",
    0x07:"NULL_CAP", 0x08:"BOUNDS", 0x09:"VERSION",
    0x0A:"SEAL",    0x0B:"INVALID_OP", 0x0C:"TPERM_RSV",
    0x0D:"DOMAIN_PURITY", 0x0E:"PERM_B", 0x0F:"F_BIT",   # 0x0E: display as PERM_B
    0x10:"STACK_OVERFLOW", 0x11:"ABSENT_OUTFORM",
    0x12:"STACK_CORRUPT",  0x13:"STACK_UNDERFLOW",
    0x15:"OUTFORM_CRC",    0x16:"OUTFORM_ALLOC",
    0x17:"OUTFORM_MINT",   0x18:"OUTFORM_HDR",
    0x19:"INT_OVERFLOW",                                   # proposed — add when Track 3 lands
}

# In _handle_callhome_json():
payload["fault_name"] = _FAULT_NAMES.get(fault_code, "UNKNOWN")  # never raw hex
```

> **`cr14` field:** `callhome_bridge.py` already contains
> `cr14 = pkt.get("cr14", None)` in `_handle_callhome_json()` — it is
> already forwarded in the POST payload when present.  The bridge requires no
> change for this field.  Only the firmware (Layer B) needs updating to emit it.

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
  "boot_ok":1, "boot_reason":2, "fault":1, "fault_code":7, "fault_name":"NULL_CAP",
  "fw_major":1, "fw_minor":0
}
```

**Full CALLHOME after Layer C (new bitstream):**

```json
{
  "board":"Ti60F225", "uid":"...", "nia":"0x00000008",
  "boot_ok":1, "boot_reason":2, "fault":1, "fault_code":7, "fault_name":"NULL_CAP",
  "fault_gt":"0x01800003", "fault_instr":"0xD8000000",
  "fault_cr14":"0x01C00003", "fault_stage":3,
  "fw_major":1, "fw_minor":0
}
```

> **`boot_reason` field:** The simulator already computes this in `_bootStep` B:00
> (`boot_reason=0` cold, `boot_reason=2` fault-recovery) and sends it via
> `Tunnel.Register`.  The hardware firmware must emit the same field so the IDE
> can show "Fault recovery boot" vs "Cold boot" in the Devices panel without
> having to infer it from `fault` alone.  Firmware logic: `boot_reason = (fault_latched_at_boot) ? 2 : 0`.

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

---

## Confirmed Operational Gotchas

These were confirmed against the real Ti60 hardware during development.
They apply to every session connecting the bridge to the board.

### Baud rate is 57600 — firmware comment is wrong

The `main.c` header comment says **"115200 baud"** but the Ti60 SoC UART
runs at **57600 baud** (25 MHz crystal, `UART_CLOCKDIV = 53`).  Connecting
at 115200 produces garbage or silence.

Correct bridge command:
```
python3 ~/church_project/SoC/callhome_bridge.py \
  --port /dev/ttyUSB2 --baud 57600 \
  --ide "https://<replit-dev-url>"
```

The Sapphire SoC UART resets `UART_CLOCKDIV` to `0x00` on power-up (not to
any sensible default).  The firmware writes `UART_CLOCKDIV = 53` (`0x35`)
immediately on startup — before the first `uart_puts` — to establish 57600
baud.  If the firmware ever forgets this write the UART is silent.

The header comment in `main.c` incorrectly states "115200 baud".  Ignore it.
**Confirmed working value: `UART_CLOCKDIV = 53` → 57600 baud at 25 MHz.**
Do not change the baud rate without also reflashing firmware with a matching
`UART_CLOCKDIV` value.

### Bridge `--flag VALUE` and `--flag=VALUE` are both accepted

The original arg parser only accepted `--flag=VALUE` (equals form).
`--ide https://...` (space-separated) was silently ignored, leaving
`_IDE_SERVER_URL = None` — CALLHOME packets arrived at the bridge but were
never forwarded to the IDE.

The parser was fixed: both forms now work for `--port`, `--baud`, and
`--ide`.  Either of the following is valid:

```
--ide "https://..."          # space form — now works
--ide="https://..."          # equals form — always worked
```

If CALLHOME packets appear in the terminal but the Devices panel in the IDE
stays blank, re-check the `--ide` argument — it is the most likely culprit.
