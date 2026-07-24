# Wukong V2 — Pre-Tapeout Audit Findings

Full hardware build chain audit before synthesising a new A7 bitstream.
Items are ordered by severity. Each file is a self-contained plan: root cause,
exact files to touch, change plan, acceptance criteria, and risks.

## Critical — V2 cannot function without these

| File | Item |
|------|------|
| [c1-wukong-uart.md](c1-wukong-uart.md) | Add UART TX/RX (MMIO reg 5, CLOCKDIV=108 for 57600 @ 50 MHz) |
| [c2-wukong-boot-program.md](c2-wukong-boot-program.md) | Replace missing BOOT_PROGRAM with Wukong-specific 3-instruction sequence |
| [c3-demo-namespace-address.md](c3-demo-namespace-address.md) | Fix Boot.NS slot 0 location (0x1FC00 → 0x0000 for Wukong) |

## High — Bugs that surface in any real CLOOMC program

| File | Item |
|------|------|
| [h1-cr15-limit-mismatch.md](h1-cr15-limit-mismatch.md) | CR15 boot limit = 18 but only 8 NS slots exist |
| [h2-irq-null-base-fault.md](h2-irq-null-base-fault.md) | IRQ_NULL_BASE (0x14) missing from simulator fault table |
| [h3-outform-timeout-fault.md](h3-outform-timeout-fault.md) | OUTFORM_TIMEOUT (0x19) missing from simulator fault table |
| [h4-demo-clist-minimal.md](h4-demo-clist-minimal.md) | Wukong c-list has only LED slot; all other devices blocked |

## Medium — Gaps that limit V2 capability

| File | Item |
|------|------|
| [m1-lambda-nia-cache.md](m1-lambda-nia-cache.md) | LAMBDA has no NIA cache in hardware (deferred to V3) |
| [m2-rst-n-unconnected.md](m2-rst-n-unconnected.md) | rst_n button constrained but unconnected |
| [m3-led2-no-physical-pin.md](m3-led2-no-physical-pin.md) | MMIO reg 2 (LED2) has no physical pin |
| [m4-range-fault-naming.md](m4-range-fault-naming.md) | RANGE/STACK_OVERFLOW naming collision in simulator |

## What was confirmed clean

All ISA-level constants match exactly between hardware and simulator:
opcodes (Church 0–9, Turing 16–25), condition codes (ARM order), GT bit layout (v2.0),
instruction encoding ([31:27] opcode, [26:23] cond, [22:19] dst, [18:15] src,
[14:0] imm), permission masks, integrity32, TPERM presets, fault codes 0x00–0x13,
Wukong clock/reset/LED wiring (active-LOW, no BUFG, reset_less=True, GSR),
BRAM hw_init sequencer, mLoad NS gate.

## Recommended sequencing for V2

```
C3 → C2 → C1 → H4   (NS fix before boot, UART, then full c-list)
H2 + H3 + M4         (fault table cleanup — one commit)
H1                   (after confirming limit intent)
M2 → M3              (polish — independent)
M1                   (deferred to V3)
```
