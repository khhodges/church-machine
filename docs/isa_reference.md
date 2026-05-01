# Church Machine ISA Reference

**Version 1.0 — May 2026**
**Authoritative sources: `simulator/simulator.js`, `simulator/assembler.js`, `hardware/*.py`**

This document is the single definitive specification for all 20 Church Machine
instructions. Where existing documents conflict with what is stated here, this
document takes precedence. Simulator/hardware deviations are called out
explicitly; see `docs/HARDWARE-DEVIATIONS.md` for the full deviation register.

---

## 1. Instruction Word Format

Every instruction is a 32-bit word with a fixed layout:

```
 31      28 27    24 23    20 19    16 15             1 0
┌──────────┬─────────┬────────┬────────┬────────────────┬───┐
│  opcode  │  cond   │  fld_a │  fld_b │     imm15      │ 0 │
│  (4 b)   │  (4 b)  │  (4 b) │  (4 b) │    (15 b)      │(1)│
└──────────┴─────────┴────────┴────────┴────────────────┴───┘
```

- **Bit 0** is always 0 (word-aligned; a 1 here is a FAULT).
- **opcode** (bits 31:28): selects one of the 20 instructions (0–19). Values 20–15 are reserved and fault.
- **cond** (bits 27:24): condition under which the instruction executes (see §2).
- **fld_a** (bits 23:20): first register operand — CR or DR index depending on instruction.
- **fld_b** (bits 19:16): second register operand — CR or DR index depending on instruction.
- **imm15** (bits 15:1): 15-bit immediate; interpretation varies per instruction.

The **all-zero word** `0x00000000` (opcode=LOAD, cond=EQ, all fields zero) is
accepted by the assembler as `HALT` or `NOP`. The simulator treats an all-zero
instruction word encountered during normal execution as a warm reboot (not a halt
and not a fault). See §4 (HALT/NOP note) for implications.

---

## 2. Condition Codes

The `cond` field gates execution on the current flag state. If the condition is
false, the instruction is skipped (PC advances, no side effects, no faults).

| Code | Mnemonic | Meaning                    | Flags tested        |
|------|----------|----------------------------|---------------------|
|  0   | EQ       | Equal / Zero               | Z = 1               |
|  1   | NE       | Not equal / Non-zero       | Z = 0               |
|  2   | LT       | Less than (signed)         | N ≠ V               |
|  3   | LE       | Less than or equal (signed)| Z = 1 or N ≠ V      |
|  4   | GT       | Greater than (signed)      | Z = 0 and N = V     |
|  5   | GE       | Greater than or equal      | N = V               |
|  6   | CS / CC  | Carry set                  | C = 1               |
|  7   | CC       | Carry clear                | C = 0               |
|  8   | MI       | Minus / Negative           | N = 1               |
|  9   | PL       | Plus / Non-negative        | N = 0               |
| 10   | VS       | Overflow set               | V = 1               |
| 11   | VC       | Overflow clear             | V = 0               |
| 12   | HI       | Unsigned higher            | C = 1 and Z = 0     |
| 13   | LS       | Unsigned lower or same     | C = 0 or Z = 1      |
| 14   | AL       | Always (unconditional)     | (none)              |
| 15   | NV       | Never (no-op)              | (none — always skip)|

`AL` (always) is the normal unconditional form. `NV` is a no-op regardless of flags.

---

## 3. Register Files

### 3.1 Capability Registers (CR0–CR15)

Sixteen 64-bit capability registers. Each holds a **Guard Token (GT)**: a
type-tagged, permission-bearing, hardware-verified reference to an object.

| Range    | Name                 | Notes                                          |
|----------|----------------------|------------------------------------------------|
| CR0–CR5  | User CRs             | General-purpose; caller context preserved by CALL |
| CR6      | C-list root          | E-permission token for current abstraction's c-list; re-derived by CALL/RETURN |
| CR7–CR11 | User CRs             | General-purpose; caller context preserved by CALL |
| CR12     | Thread stack         | Privileged; system-wide; unchanged by CALL/RETURN; only writeable via CHANGE |
| CR13     | Interrupt handler    | Privileged; system-wide; only writeable via SWITCH (hardware: PassKey gate) |
| CR14     | Code register (CLOOMC) | Privileged; per-thread; set by CALL, re-derived by RETURN; X-only |
| CR15     | Namespace root       | Privileged; per-thread; only writeable via SWITCH (hardware: PassKey gate) |

**Privilege zone**: CR12–CR15 cannot appear as operands in LOAD, SAVE, TPERM,
LAMBDA instructions. CALL, RETURN, CHANGE, and SWITCH are the only Church-domain
instructions that touch them.

### 3.2 Data Registers (DR0–DR15)

Sixteen 32-bit integer registers.

> **A.1 — DR0 is hardwired zero.**
>
> DR0 reads as 0 at all times. After every instruction that produces a result,
> the simulator unconditionally writes 0 to DR0 (`simulator.js` line 2748:
> `this._writeDR(0, 0)`). Writes targeting DR0 are silently discarded — the
> value is immediately overwritten back to 0.
>
> This enables two universal idioms, replacing MOV and load-immediate opcodes
> that would otherwise need their own encodings:
>
> | Idiom | Instruction | Effect |
> |-------|-------------|--------|
> | Register copy | `IADD DRd, DR0, DRs` | DRd ← DRs |
> | Load immediate | `IADD DRd, DR0, #k` | DRd ← k (0 ≤ k ≤ 16383) |
>
> Any instruction that writes a computed result into DR0 (e.g., `IADD DR0, DR1, DR2`)
> always reads back 0 on the next instruction. This is not a bug — it is the
> intended architectural property. Do not use DR0 as a scratch register.

### 3.3 Permission Bits (GT word0)

The permission field of a GT encodes the following access rights:

| Bit | Symbol | Meaning                                      |
|-----|--------|----------------------------------------------|
|  30 | E      | Execute — may call the abstraction            |
|  29 | S      | Save — may store a GT into this object's c-list |
|  28 | L      | Load — may load a GT from this object's c-list |
|  27 | X      | Code — execute raw instructions from lump memory |
|  26 | W      | Write — may write data words into lump memory |
|  25 | R      | Read — may read data words from lump memory   |
|  31 | B      | Busy — object lock; clearable by TPERM B-modifier |

**Domain purity rule**: X may not coexist with L, S, or E in the same GT's
effective permission set. A GT that would combine X with any of L/S/E is invalid
and causes TPERM to fault with `TPERM_RSV` when the combination is tested.

---

## 4. HALT / NOP (all-zero word)

```
Encoding: 0x00000000
Assembler aliases: HALT, NOP
```

The all-zero word is architecturally the instruction `LOAD AL, CR0, CR0, #0`
— a conditional LOAD that would load CR0 from `CR0[0]`. In practice, an
all-zero instruction word is used to mark the end of a code region.

**Simulator behaviour:** an all-zero word encountered during execution triggers
a warm reboot sequence, not a halt. Execution does not pause cleanly; the boot
ROM re-runs. Writers of code lumps should never allow execution to fall through
to an all-zero word unless a reboot is the intended outcome.

---

---

## 5. Flag Behaviour — Quick Reference

Four flags: **N** (negative), **Z** (zero), **C** (carry), **V** (overflow).

> **A.2 — BFEXT and BFINS never write any flags.**
>
> Both bitfield instructions (`_execBfext`, `_execBfins` in `simulator.js`) return
> a result object with no flag assignments. The flag register is left exactly as it
> was by the last flag-writing instruction. The most common mistake:
>
> ```
> BFEXT  DR1, DR2, 0, 8      ; extract byte — flags are NOT updated
> BRANCH EQ, handle_zero     ; tests Z from a previous instruction, not from the extract
> ```
>
> To test whether the extracted value is zero, follow BFEXT with `MCMP DR1, DR0`
> (compare the result against the hardwired-zero register), then branch.

Flag-writing summary across all 20 instructions:

| Instruction | N | Z | C | V | Notes |
|-------------|---|---|---|---|-------|
| LOAD        | — | — | — | — | |
| SAVE        | — | — | — | — | |
| CALL        | — | — | — | — | |
| RETURN      | — | — | — | — | |
| CHANGE      | — | — | — | — | |
| SWITCH      | — | — | — | — | |
| TPERM       | ✓ | ✓ | 0 | 0 | N = !Z; C and V always cleared |
| LAMBDA      | — | — | — | — | |
| ELOADCALL   | — | — | — | — | |
| XLOADLAMBDA | — | — | — | — | |
| DREAD       | — | — | — | — | |
| DWRITE      | — | — | — | — | |
| BFEXT       | — | — | — | — | **Flags unchanged — see A.2 above** |
| BFINS       | — | — | — | — | **Flags unchanged — see A.2 above** |
| MCMP        | ✓ | ✓ | ✓ | ✓ | Subtraction flags: a − b; no result register |
| IADD        | ✓ | ✓ | ✓ | ✓ | Addition flags |
| ISUB        | ✓ | ✓ | ✓ | ✓ | Subtraction flags |
| BRANCH      | — | — | — | — | Reads flags, never writes them |
| SHL         | ✓ | ✓ | ✓ | 0 | C = last bit shifted out; V always 0 |
| SHR         | ✓ | ✓ | ✓ | 0 | C = last bit shifted out; V always 0 |

*(Instruction entries for opcodes 0–19 follow in §6 onwards — to be added.)*
