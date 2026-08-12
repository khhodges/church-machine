# Wukong Board Boot Programs

For the agreed verification and redesign workflow—banner/IDE receipt checks,
standard-instruction editing, LUMP sizing, and DMEM placement review—see
[`docs/wukong-callhome-redesign-plan.md`](wukong-callhome-redesign-plan.md).

## Overview

This document explains the two resident programs in the Wukong DMEM image:
factory `SelfTest` at NS slot 6 and the selectable `WukongCallHome` abstraction
at NS slot 7. Neither is in the boot ROM; the boot ROM contains only the
3-instruction `BOOT_PROGRAM` (see `docs/StartupCM.md`).

`SelfTest` is the factory boot target, matching the simulator lightning-bolt
default. `WukongCallHome` remains available for an explicit boot-entry selection
and runs the LED/UART diagnostic loop.

---

## Boot ROM vs DMEM LUMP

| | Boot ROM | SelfTest LUMP | WukongCallHome LUMP |
|---|---|---|
| Location | ROM BRAM (`_WUKONG_ROM` in `wukong_top.py`) | DMEM byte `0x600`, NS slot 6 | DMEM byte `0x1200`, NS slot 7 |
| Size | 3 instructions (`BOOT_PROGRAM`) | 512-word canonical image | 73 instructions (`WUKONG_NUC_PROGRAM`) |
| Executed by default | Always (ROM[0..2] on every power-on) | Yes — `Thread.caps[0]` contains `0x4A000006` | Only if the IDE or boot config selects NS slot 7 |
| Standalone safe | — | Runs the canonical self-test | Yes — loops without calling into an application c-list |

**The 3-instruction boot ROM (`BOOT_PROGRAM`) always runs first:**
```
ROM[0]  LOAD   CR15, CR15[0]   ; load NS root from DMEM
ROM[1]  CHANGE CR12, CR15, #1  ; switch to Boot.Thread
ROM[2]  CALL   CR0             ; enter boot entry via Thread.caps[0]
```

On factory power-on, `Thread.caps[0]` contains the SelfTest E-GT
`0x4A000006`; ROM[2] enters SelfTest at NIA `0x604`.

To enter WukongCallHome on power-on, replace the factory entry with its NS-slot-7
E-GT in the boot image/build configuration and rebuild/reflash the bitstream.

---

## Factory image layout

The resident regions are deliberately separated:

| Region | DMEM byte range | Purpose |
|---|---:|---|
| SelfTest | `0x600–0xDFF` | Canonical 512-word factory image |
| Boot.Thread | `0xE00–0x11FF` | 256-word thread allocation |
| WukongCallHome | `0x1200–0x13FF` | 128-word selectable diagnostic allocation |

`Thread.caps[0]` is at DMEM word `1140` (`0xE00 + 244`), not word 244:
the relocated thread prevents the namespace table and resident LUMPs from
overlapping.

---

## What WukongCallHome Does

`WUKONG_NUC_PROGRAM` is a 73-instruction loop that runs forever:

```
1. Turn LED0 on
2. Transmit "CM:WUKONG\r\n" over UART at 57600 baud, polling STATUS between bytes
3. Delay ~0.498 s  (on-phase, 380 × 16383 iterations at 50 MHz)
4. Turn LED0 off
5. Delay ~0.498 s  (off-phase)
6. Jump back to step 1
```

Because the loop never calls into the c-list for anything other than device I/O,
it is safe on a board with a zero-filled c-list.

### Register allocation

| Register | Role |
|----------|------|
| DR0 | Zero register (never written) |
| DR1 | Constant 1 — LED "on" value **and** DREAD STATUS offset (DR1=1 after setup) |
| DR2 | Inner delay counter |
| DR3 | Outer delay counter |
| DR5 | UART byte scratch |
| DR6 | UART STATUS read |
| DR7 | STATUS−1 scratch (EQ=0 means UART busy) |

### Timing at 50 MHz

```
inner loop:  16383 iterations × ~4 cycles ≈ 65 532 cycles
outer loop:    380 iterations  → 380 × 65 532 ≈ 24 902 160 cycles ≈ 0.498 s/phase
total period:  on + off ≈ 0.996 s  →  ~1 Hz blink
```

### UART busy-poll pattern

Each of the 11 banner bytes is sent with this 5-instruction sequence:

```
IADD  DR5, DR0, #char     ; load byte value
DWRITE DR5, CR4, 0, DR0   ; write to TX register  (word offset 0)
poll:
DREAD  DR6, CR4, 0, DR1   ; read STATUS register  (word offset = DR1 = 1)
ISUB   DR7, DR6, #1        ; DR7=0 iff STATUS=1=busy
BRANCHEQ poll              ; while busy: retry
```

The DREAD uses the 4-operand indexed form (`base=0, DRx=DR1`) so `offset = DR1 = 1`,
addressing the STATUS word. This keeps the encoded instruction word identical to
`encode_turing(DREAD, ..., imm=1)` in Python.

---

## C-List Differences (LUMP vs Hardware)

The LUMP version loads capabilities from its own 2-entry c-list:

| Word | Instruction | LUMP slot |
|------|-------------|-----------|
| 0 | `LOAD CR3, LED0` | c-list[0] = LED0 (RW) |
| 1 | `LOAD CR4, UART_TX` | c-list[1] = UART_TX (W) |

When running from the hardware boot c-list (if selected as NS slot 7 boot entry):

| Word | Instruction | Hardware slot |
|------|-------------|---------------|
| 0 | `LOAD CR3, CR6[5]` | Slot 5 = LED_DEV |
| 1 | `LOAD CR4, CR6[6]` | Slot 6 = UART_DEV |

**Words 2-72 are bit-for-bit identical** to `WUKONG_NUC_PROGRAM[2:73]`.
The divergence check (`scripts/check_wukong_callhome_divergence.js`) enforces this.

---

## CLOOMC Source

The authoritative human-readable form of `WUKONG_NUC_PROGRAM` is:

```
simulator/examples/wukong_callhome.cloomc
```

Opening this file in the IDE shows all 73 instructions with labels (`setup`, `loop_top`,
`banner_send`, `on_delay`, `off_delay`) and inline comments matching the word-offset table
in `hardware/boot_rom.py`.

### Simulating in the IDE

1. Open the LUMP library and click **WukongCallHome**.
2. The editor shows the CLOOMC source. Click **Step** to step through instructions.
3. Switch to the **Wukong view** — LED0 toggles at each `DWRITE CR3` instruction.
4. The UART output panel shows each character of "CM:WUKONG\r\n" as it is written.

The program is an **infinite loop** — it has no RETURN. This is intentional: the physical
FPGA also loops forever until reset.

---

## Divergence Guard

The CI script `scripts/check_wukong_callhome_divergence.js` assembles
`wukong_callhome.cloomc` and compares the result against `WUKONG_NUC_PROGRAM`:

```
node scripts/check_wukong_callhome_divergence.js
```

Exit 0 = consistent. Exit 1 = diverged; fix the `.cloomc` file to match `boot_rom.py`.

**If you edit `WUKONG_NUC_PROGRAM` in `hardware/boot_rom.py`, you MUST also update
`simulator/examples/wukong_callhome.cloomc` and rebuild the LUMP by running:**

```
node scripts/build_wukong_callhome_lump.js
```

---

## Relevant Files

| File | Role |
|------|------|
| `simulator/examples/wukong_callhome.cloomc` | Human-readable CLOOMC source (73 instructions) |
| `hardware/boot_rom.py` | `WUKONG_NUC_PROGRAM` — Python-encoded list, build-time source of truth |
| `hardware/wukong_top.py` | `WUKONG_DEMO_NAMESPACE` — includes WukongCallHome LUMP body at NS slot 7 |
| `scripts/build_wukong_callhome_lump.js` | Assembles + packages the LUMP binary |
| `scripts/check_wukong_callhome_divergence.js` | CI guard — fails if CLOOMC drifts from Python |
| `server/lumps/` | Built `.lump` + `.json` files |
