# Church Machine ISA Encoding Reference

All values verified against `simulator/assembler.js`. This document is the
complete specification needed to implement an encoder with no guesswork.

---

## 1. Word Format

Every instruction is a single 32-bit word with this fixed layout:

```
 31      27 26    23 22   19 18   15 14            0
 ┌─────────┬────────┬───────┬───────┬───────────────┐
 │ opcode  │  cond  │ fld_a │ fld_b │    imm15      │
 │  5 bits │ 4 bits │ 4 bits│ 4 bits│   15 bits     │
 └─────────┴────────┴───────┴───────┴───────────────┘
```

Encoding expression:

```
word = ((opcode & 0x1F) << 27)
     | ((cond   & 0x0F) << 23)
     | ((fld_a  & 0x0F) << 19)
     | ((fld_b  & 0x0F) << 15)
     | ( imm15  & 0x7FFF)
```

There is **no mode-select bit** separating "register" from "immediate" in the
last field. Semantics are fixed per opcode — determined entirely by the opcode
number, not by any flag bit in the word.

Special case: `HALT` and `NOP` both assemble to the all-zero word `0x00000000`.

---

## 2. Opcode Table — bits [31:27]

| Dec | Hex  | Mnemonic    |
|-----|------|-------------|
|  0  | 0x00 | LOAD        |
|  1  | 0x01 | SAVE        |
|  2  | 0x02 | CALL        |
|  3  | 0x03 | RETURN      |
|  4  | 0x04 | CHANGE      |
|  5  | 0x05 | SWITCH      |
|  6  | 0x06 | TPERM       |
|  7  | 0x07 | LAMBDA      |
|  8  | 0x08 | ELOADCALL   |
|  9  | 0x09 | XLOADLAMBDA |
| 10  | 0x0A | DREAD       |
| 11  | 0x0B | DWRITE      |
| 12  | 0x0C | BFEXT       |
| 13  | 0x0D | BFINS       |
| 14  | 0x0E | MCMP        |
| 15  | 0x0F | IADD        |
| 16  | 0x10 | ISUB        |
| 17  | 0x11 | BRANCH      |
| 18  | 0x12 | SHL         |
| 19  | 0x13 | SHR         |

Opcodes 20–31 are undefined (disassembler emits `???`).

---

## 3. Condition Code Table — bits [26:23]

The condition suffix is appended directly to the mnemonic. The default (always
execute) is `AL = 14`; when AL is used the suffix is omitted entirely.

| Dec | Suffix      | Meaning                              |
|-----|-------------|--------------------------------------|
|  0  | EQ          | Equal / Z set                        |
|  1  | NE          | Not equal / Z clear                  |
|  2  | CS  (= HS)  | Carry set / Unsigned higher or same  |
|  3  | CC  (= LO)  | Carry clear / Unsigned lower         |
|  4  | MI          | Minus / negative                     |
|  5  | PL          | Plus / positive or zero              |
|  6  | VS          | Overflow set                         |
|  7  | VC          | Overflow clear                       |
|  8  | HI          | Unsigned higher                      |
|  9  | LS          | Unsigned lower or same               |
| 10  | GE          | Signed greater or equal              |
| 11  | LT          | Signed less than                     |
| 12  | GT          | Signed greater than                  |
| 13  | LE          | Signed less or equal                 |
| 14  | *(none)*    | AL — always (default)                |
| 15  | NV          | Never (encodes, never executes)      |

Aliases accepted by the assembler: `HS` → 2, `LO` → 3.

Example: `IADDLT DR0, DR1, DR2` encodes opcode=0x0F, cond=11.

---

## 4. Per-Opcode Field Usage

### Capability register (CR) instructions

| Op | Mnemonic    | fld_a     | fld_b     | imm15                                        |
|----|-------------|-----------|-----------|----------------------------------------------|
|  0 | LOAD        | CR dst    | CR base   | unsigned byte offset (0–32767)               |
|  1 | SAVE        | CR src    | CR base   | unsigned byte offset (0–32767)               |
|  2 | CALL        | CR target | 0         | 0                                            |
|  3 | RETURN      | CR target | 0         | 0                                            |
|  4 | CHANGE      | CR dst    | 0         | slot index (unsigned)                        |
|  5 | SWITCH      | 0         | CR src    | new permission — lower 3 bits (0–7)          |
|  6 | TPERM       | CR dst    | 0         | 5-bit preset code (see §6)                   |
|  7 | LAMBDA      | CR dst    | 0         | 0                                            |
|  8 | ELOADCALL   | CR dst    | CR src    | unsigned offset                              |
|  9 | XLOADLAMBDA | CR dst    | CR src    | unsigned offset                              |

### Data register (DR) / mixed instructions

| Op | Mnemonic | fld_a  | fld_b  | imm15                                                      |
|----|----------|--------|--------|------------------------------------------------------------|
| 10 | DREAD    | DR dst | CR base| unsigned offset                                            |
| 11 | DWRITE   | DR src | CR base| unsigned offset                                            |
| 12 | BFEXT    | DR dst | CR base| `(pos & 0x1F) << 5 \| (width & 0x1F)` — bits [9:5]=pos, [4:0]=width |
| 13 | BFINS    | DR src | CR base| `(pos & 0x1F) << 5 \| (width & 0x1F)` — bits [9:5]=pos, [4:0]=width |
| 14 | MCMP     | DR op1 | DR op2 | 0 — result goes to condition flags only, no writeback      |
| 15 | IADD     | DR dst | DR src1| `imm15[3:0]` = DR src2 number (a register, NOT a literal)  |
| 16 | ISUB     | DR dst | DR src1| `imm15[3:0]` = DR src2 number (a register, NOT a literal)  |
| 17 | BRANCH   | 0      | 0      | signed 15-bit PC-relative offset; bit 14 is the sign bit   |
| 18 | SHL      | DR dst | DR src | `imm15[4:0]` = shift amount (0–31)                         |
| 19 | SHR      | DR dst | DR src | `imm15[5]`=1 for ASR / 0 for LSR; `imm15[4:0]`=shift amount |

#### Instruction-specific notes

**BRANCH** — `imm15` is a signed 15-bit value; bit 14 is the sign bit.  
Sign-extend for display: `soff = (imm & 0x4000) ? (imm | 0xFFFF8000) : imm`.  
Labels assemble to their absolute instruction index stored directly in imm15.

**MCMP** — No destination field. fld_a and fld_b both hold DR operand numbers.
The comparison result is written only to the condition flags register. imm15 is
always zero.

**IADD / ISUB** — The third operand is always a DR register, never a literal
constant. It is packed into the lower 4 bits of imm15 (`imm & 0xF`). Bits
[14:4] of imm15 are unused (zero).

**BFEXT / BFINS** — imm packing: `imm = (pos << 5) | width`, occupying bits
[9:0] of imm15. Bits [14:10] are unused (zero).

**SHR ASR** — arithmetic (sign-extending) right shift: set `imm15[5] = 1`.  
Logical right shift: `imm15[5] = 0`. Shift amount is `imm15[4:0]`.

---

## 5. Register Numbering

Both register files use the same 4-bit encoding 0–15 in fld_a / fld_b:

| Register | Assembly syntax | Field value |
|----------|----------------|-------------|
| CR0–CR15 | `CR0` … `CR15` | 0–15 in fld_a or fld_b |
| DR0–DR15 | `DR0` … `DR15` | 0–15 in fld_a, fld_b, or imm15[3:0] |

CRs and DRs are **separate register files**. The opcode determines which file is
accessed. The same 4-bit encoding is reused in both fields independently; there
is no shared namespace at the hardware level.

---

## 6. TPERM Preset Codes — bits [4:0] of imm15 (opcode 6 only)

Bit 4 (`imm & 0x10`) is the **Bound (B) flag**. Bits [3:0] select the base
permission preset. The assembled word uses the numeric code directly.

| Code | Name    | Code | Name     |
|------|---------|------|----------|
| 0x00 | CLEAR   | 0x10 | B        |
| 0x01 | R       | 0x11 | RB       |
| 0x02 | RW      | 0x12 | RWB      |
| 0x03 | X       | 0x13 | XB       |
| 0x04 | RX      | 0x14 | RXB      |
| 0x05 | RWX     | 0x15 | RWXB     |
| 0x06 | L       | 0x16 | LB       |
| 0x07 | S       | 0x17 | SB       |
| 0x08 | E       | 0x18 | EB       |
| 0x09 | LS      | 0x19 | LSB      |
| 0x0A | LE      | 0x1A | LEB      |
| 0x0B | SE      | 0x1B | SEB      |
| 0x0C | LSE     | 0x1C | LSEB     |
| 0x0D | RWXLSE  | 0x1D | RWXLSEB  |
| 0x0E | *(rsv)* | 0x0F | *(rsv)*  |

Permission bit key: **R**=Read, **W**=Write, **X**=Execute, **L**=Load
(load capability), **S**=Save (store capability), **E**=Enter
(enter enclave / abstraction), **B**=Bound (capability is bounds-checked).

If a numeric value is given instead of a named preset, the assembler uses the
lower 5 bits of that number directly (`imm & 0x1F`).

---

## Quick-Reference: Encoding Pseudocode

```python
def encode(opcode, cond=14, fld_a=0, fld_b=0, imm15=0):
    return (
        ((opcode & 0x1F) << 27) |
        ((cond   & 0x0F) << 23) |
        ((fld_a  & 0x0F) << 19) |
        ((fld_b  & 0x0F) << 15) |
        ( imm15  & 0x7FFF)
    )

# Examples
IADD_DR0_DR1_DR2 = encode(opcode=15, fld_a=0, fld_b=1, imm15=2)
BRANCH_minus4    = encode(opcode=17, imm15=(-4) & 0x7FFF)
TPERM_CR0_RWX   = encode(opcode=6,  fld_a=0, imm15=0x05)
MCMP_DR0_DR1    = encode(opcode=14, fld_a=0, fld_b=1)
HALT_or_NOP     = 0x00000000
```
