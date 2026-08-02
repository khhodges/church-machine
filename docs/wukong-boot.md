# Wukong Board Boot Program

## Overview

The Wukong FPGA board executes a 73-instruction ROM program from word 0 on every power-up.
This document explains what the program does, why it exists, and how to read and simulate it
in the Church Machine IDE.

## The NULL_CAP Standalone Problem

The standard `BOOT_PROGRAM` used on the Ti60 board contains this instruction at word 2:

```
CALL CR0, CR0    ; 0x17000000
```

On a board connected to the IDE, `Thread.caps[0]` is populated by `setBootEntrySlot()` with
an E-GT pointing to the boot entry LUMP (e.g. SelfTest or WukongCallHome).  The CALL works.

On a **standalone** Wukong board — powered on without an IDE connection — `Thread.caps[0]` is
`NULL` (0x00000000) because no IDE has ever configured the boot slot.  `CALL CR0,CR0` faults
`NULL_CAP` immediately, leaving the board stuck.

## The Solution: WUKONG_NUC_PROGRAM

`WUKONG_NUC_PROGRAM` is the Wukong-specific ROM program.  It never executes `CALL` at all.
Instead it loops forever:

```
1. Turn LED0 on
2. Transmit "CM:WUKONG\r\n" over UART at 57600 baud, polling STATUS between bytes
3. Delay ~0.498 s  (on-phase, 380 × 16383 iterations at 50 MHz)
4. Turn LED0 off
5. Delay ~0.498 s  (off-phase)
6. Jump back to step 1
```

Because the loop never calls into the c-list for anything other than device I/O, it is
completely safe on a board with a zero-filled c-list.

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
addressing the STATUS word.  This keeps the encoded instruction word identical to
`encode_turing(DREAD, ..., imm=1)` in Python.

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
2. The editor shows the CLOOMC source.  Click **Step** to step through instructions.
3. Switch to the **Ti60 view** — LED0 toggles at each `DWRITE CR3` instruction.
4. The UART output panel shows each character of "CM:WUKONG\r\n" as it is written.

The program is an **infinite loop** — it has no RETURN.  This is intentional: the physical
FPGA also loops forever until reset.

## C-List Differences (LUMP vs Hardware)

The hardware ROM program loads capabilities from the Wukong boot c-list:

| Word | Instruction | Hardware slot |
|------|-------------|---------------|
| 0 | `LOAD CR3, CR6[5]` | Slot 5 = LED_DEV |
| 1 | `LOAD CR4, CR6[6]` | Slot 6 = UART_DEV |

The CLOOMC LUMP uses its own two-entry c-list:

| Word | Instruction | LUMP slot |
|------|-------------|-----------|
| 0 | `LOAD CR3, LED0` | c-list[0] = LED0 (RW) |
| 1 | `LOAD CR4, UART_TX` | c-list[1] = UART_TX (W) |

**Words 2-72 are bit-for-bit identical** to `WUKONG_NUC_PROGRAM[2:73]`.
The divergence check (`scripts/check_wukong_callhome_divergence.js`) enforces this.

## Divergence Guard

The CI script `scripts/check_wukong_callhome_divergence.js` assembles
`wukong_callhome.cloomc` and compares the result against `WUKONG_NUC_PROGRAM`:

```
node scripts/check_wukong_callhome_divergence.js
```

Exit 0 = consistent.  Exit 1 = diverged; fix the `.cloomc` file to match `boot_rom.py`.

**If you edit `WUKONG_NUC_PROGRAM` in `hardware/boot_rom.py`, you MUST also update
`simulator/examples/wukong_callhome.cloomc` and rebuild the LUMP by running:**

```
node scripts/build_wukong_callhome_lump.js
```

## Relevant Files

| File | Role |
|------|------|
| `simulator/examples/wukong_callhome.cloomc` | Human-readable CLOOMC source (73 instructions) |
| `hardware/boot_rom.py` | `WUKONG_NUC_PROGRAM` — Python-encoded list, build-time source of truth |
| `hardware/wukong_top.py` | `_WUKONG_ROM` — fills the FPGA BRAM from `WUKONG_NUC_PROGRAM` |
| `scripts/build_wukong_callhome_lump.js` | Assembles + packages the LUMP binary |
| `scripts/check_wukong_callhome_divergence.js` | CI guard — fails if CLOOMC drifts from Python |
| `server/lumps/` | Built `.lump` + `.json` files |
