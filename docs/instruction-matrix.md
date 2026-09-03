# Church Machine Instruction Cross-Reference Matrix

> **HISTORICAL IMPLEMENTATION AUDIT.** Opcode numbering, source line numbers,
> instruction inventory, and unchecked verification rows in this matrix record
> an earlier implementation. Use `docs/isa_reference.md` for the current ISA.
> The SWITCH encoding and authorization section below has been normalized to
> the current Task 3193 contract.

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

This document maps each instruction across all implementation layers for verification.

## Legend
- **Opcode**: 5-bit binary opcode
- **Cycles**: Minimum execution cycles (N = number of registers for LDM/STM)
- **Latency**: Total latency including memory access (+mem = memory-dependent)
- **JS Line**: Line number in `web/simulator.js`
- **Verilog**: Definition in `verilog/ctmm_pkg.sv`
- **UI Def**: Definition in `web/app.js` (churchInstrFormats/turingInstrFormats)
- **Tutorial**: Which tutorial lesson covers this instruction

---

## Church Instructions (Capability Operations)

| Instruction | Opcode | Binary | Cycles | Latency | JS Line | Verilog Line | UI Defined | Tutorial |
|:------------|:-------|:-------|:-------|:--------|:--------|:-------------|:-----------|:---------|
| LOAD        | 01     | 00001  | 3      | 3+mem   | 478     | 157          | Yes        | Lesson 4 |
| SAVE        | 02     | 00010  | 3      | 3+mem   | 537     | 158          | Yes        | Lesson 4 |
| CALL        | 03     | 00011  | 4      | 4+mem   | 743     | 159          | Yes        | Lesson 4 |
| RETURN      | 04     | 00100  | 3      | 3+mem   | 821     | 160          | Yes        | Lesson 4 |
| CHANGE      | 05     | 00101  | 2      | 2+mem   | 844     | 161          | Yes        | Lesson 4 |
| SWITCH      | 06     | 00110  | 2      | 2+mem   | 856     | 162          | Yes        | Lesson 4 |
| TPERM       | 07     | 00111  | 1      | 1       | 385     | 163          | Yes        | Lesson 7 |
| LOADX       | 08     | 01000  | 4      | 4+mem   | 561     | 164          | Yes        | Lesson 5 |
| SAVEX       | 09     | 01001  | 4      | 4+mem   | 608     | 165          | Yes        | Lesson 5 |
| LDM         | 10     | 01010  | 2+N    | 2+N×mem | 641     | 166          | Yes        | Lesson 6 |
| STM         | 11     | 01011  | 2+N    | 2+N×mem | 677     | 167          | Yes        | Lesson 6 |

### Verification Checklist - Church Instructions

- [ ] LOAD: Verify L permission check, bounds check, MAC validation
- [ ] SAVE: Verify S permission check, B-bit on source, bounds check
- [ ] CALL: Verify E permission, DR/CR mask handling, DR8-15 auto-clear
- [ ] RETURN: Verify stack pop, context restore (mask field not implemented — skip mask handling)
- [ ] CHANGE: Verify thread switch, monitor clearing
- [ ] SWITCH: Verify destination-M-gated isolated LOAD
- [x] TPERM: Flag model Z=1=pass/Z=0=fail confirmed. Valid presets 0-9 (CLEAR through LS). Codes 10-12 unconditionally reserved (RSV3/RSV4/RSV5, FAULT `TPERM_RSV`); code 13 = FRAME (call-stack query: Z=1 if real return frame present; no GT read); code 14 = EXACT (bit-exact identity check: Z=1 iff CRd.word0 == CRs.word0); code 15 = RSV1 (FAULT `TPERM_RSV`). Assembler now rejects reserved presets 10/11/12/15 (and B-variants 26/27/28/31) at compile time with a named error. Conditional execution (EQ/NE etc.) works via standard condition-check gate before dispatch. B-modifier (bit 4 of preset) recognised by assembler and simulator; hardware decoder currently reads only 4 bits — B-modifier clears GT B-bit in software only until the field is widened to silicon. Named B-variants: RB, RWB, XB, RXB, RWXB, LB, SB, EB, LSB.
- [ ] LOADX: Verify monitor set, same validation as LOAD
- [ ] SAVEX: Verify monitor check, conditional store, result in DR
- [ ] LDM: Verify per-register mLoad validation, register list
- [ ] STM: Verify per-register mSave validation, B-bit per CR

---

## Turing Instructions (Data Operations)

| Instruction | Opcode | Binary | Cycles | Latency | JS Line | Verilog Line | UI Defined | Tutorial |
|:------------|:-------|:-------|:-------|:--------|:--------|:-------------|:-----------|:---------|
| MOV         | 16     | 10000  | 1      | 1       | TBD     | 175          | Yes        | -        |
| ADD         | 17     | 10001  | 1      | 1       | TBD     | 176          | Yes        | -        |
| SUB         | 18     | 10010  | 1      | 1       | TBD     | 177          | Yes        | -        |
| MUL         | 19     | 10011  | 3      | 3       | TBD     | 178          | Yes        | -        |
| DIV         | 20     | 10100  | 12     | 12      | TBD     | 179          | Yes        | -        |
| AND         | 21     | 10101  | 1      | 1       | TBD     | 180          | Yes        | -        |
| ORR         | 22     | 10110  | 1      | 1       | TBD     | 181          | Yes        | -        |
| EOR         | 23     | 10111  | 1      | 1       | TBD     | 182          | Yes        | -        |
| LSL         | 24     | 11000  | 1      | 1       | TBD     | 183          | Yes        | -        |
| LSR         | 25     | 11001  | 1      | 1       | TBD     | 184          | Yes        | -        |
| ASR         | 26     | 11010  | 1      | 1       | TBD     | 185          | Yes        | -        |
| CMP         | 27     | 11011  | 1      | 1       | TBD     | 186          | Yes        | -        |
| TST         | 28     | 11100  | 1      | 1       | TBD     | 187          | Yes        | -        |
| LDI         | 29     | 11101  | 1      | 1       | 700     | 188          | Yes        | Lesson 7 |
| B           | 30     | 11110  | 1      | 1-3     | TBD     | 189          | Yes        | -        |
| BL          | 31     | 11111  | 1      | 1-3     | TBD     | 190          | Yes        | -        |

### Verification Checklist - Turing Instructions

- [ ] LDI: Verify 22-bit immediate, zero-extension to 64-bit
- [ ] MOV: Verify register-to-register copy
- [ ] ADD/SUB: Verify 64-bit arithmetic, NZCV flags
- [ ] MUL/DIV: Verify 64-bit multiply/divide
- [ ] AND/ORR/EOR: Verify bitwise operations
- [ ] LSL/LSR/ASR: Verify shift operations
- [ ] CMP/TST: Verify flag setting only (no result)
- [ ] B/BL: Verify branch, BL saves return address

---

## TPERM Preset Codes

| Code | Name  | Permissions | Category | Verified JS | Verified Verilog |
|:-----|:------|:------------|:---------|:------------|:-----------------|
| 0    | CLEAR | (none)      | -        | [ ]         | [x] Amaranth     |
| 1    | R     | R           | Data     | [ ]         | [x] Amaranth     |
| 2    | RW    | R,W         | Data     | [ ]         | [x] Amaranth     |
| 3    | X     | X           | Data     | [ ]         | [x] Amaranth     |
| 4    | RX    | R,X         | Data     | [ ]         | [x] Amaranth     |
| 5    | RWX   | R,W,X       | Data     | [ ]         | [x] Amaranth     |
| 6    | L     | L           | Lambda   | [ ]         | [x] Amaranth     |
| 7    | S     | S           | Lambda   | [ ]         | [x] Amaranth     |
| 8    | E     | E           | Lambda   | [ ]         | [x] Amaranth     |
| 9    | LS    | L,S         | Combo    | [ ]         | [x] Amaranth     |
| 10   | RSV3  | FAULT (`TPERM_RSV`) | Unconditionally reserved | [ ] | [x] Amaranth |
| 11   | RSV4  | FAULT (`TPERM_RSV`) | Unconditionally reserved | [ ] | [x] Amaranth |
| 12   | RSV5  | FAULT (`TPERM_RSV`) | Unconditionally reserved | [ ] | [x] Amaranth |
| 13   | FRAME | —           | Call-stack query: Z=1 if real return frame present; no GT read | [x] JS | [x] Amaranth |
| 14   | EXACT | —           | Bit-exact identity check: Z=1 iff CRd.word0 == CRs.word0 | [x] JS | [x] Amaranth |
| 15   | RSV1  | FAULT (`TPERM_RSV`) | Unconditionally reserved | [ ] | [x] Amaranth |

---

## Security Boundaries

### CR Register Accessibility

| Register | Purpose           | Instruction Addressable | Notes |
|:---------|:------------------|:------------------------|:------|
| CR0-CR11 | General-purpose   | Yes (4-bit encoding)    | Programmer registers; CR6=C-List, CR8-CR11=free GP |
| CR12     | Thread Stack       | Privileged zone        | System-wide thread stack register; unchanged by CHANGE |
| CR13     | Interrupt         | Privileged zone         | System-wide interrupt handler; unchanged by CHANGE |
| CR14     | Code/[CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html)       | Privileged zone         | Per-thread code GT; re-derived by CALL via mLoad |
| CR15     | Namespace root    | Privileged zone         | Hardwired at boot; defines system security boundary |

### Boot Sequence — Privileged Register Initialization

The five-phase boot sequence initializes the privileged zone (CR12–CR15):

1. **CR15 (Namespace)**: Loaded at B:00 from hardwired boot GT — M permission only; points to the NS table
2. **CR12 (Thread Stack)**: Loaded at B:02 via mLoad from NS Slot 1 — zero perms, Inform-type; encodes lump base and bounds
3. **CR14 (Code/[CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html))**: Derived at B:04 from NS Slot 2 metadata — X permission; instruction fetch source
4. **CR13 (Interrupt)**: Loaded at B:03 or by destination-M-authorized SWITCH — system-wide, unchanged by CHANGE

After boot:
- CR12–CR15 are the isolated zone. SWITCH can load all four only when the selected destination's latched M bit is set.
- CR0–CR11 are the programmer-accessible GP registers (4-bit instruction field)
- SWITCH uses the full four-bit destination field for CR12–CR15 and a CR0–CR11 c-list source.

### Verification Points

- [ ] JS: Check CR index validation in LOAD/SAVE — normal instructions must not address CR12-CR15
- [ ] JS: Verify boot sequence initializes CR15, CR12, CR14 in correct phase order
- [ ] Verilog: Check CRd/CRn field width (4 bits, [22:19]) in decoder
- [ ] Tutorial: Verify explanation of CR8-15 protection

---

## Files to Review

1. **web/simulator.js** - JavaScript instruction execution
2. **verilog/ctmm_pkg.sv** - Opcode definitions, permission bits
3. **verilog/ctmm_decoder.sv** - Instruction decoding logic
4. **verilog/ctmm_core.sv** - Execution control
5. **web/app.js** - UI instruction formats (churchInstrFormats, turingInstrFormats)
6. **web/app.js** - Tutorial lessons (lessons array starting ~line 4255)

---

## Discrepancies Found

| Issue | Location | Description | Status |
|:------|:---------|:------------|:-------|
| Opcode width | UI (app.js) | All Church instructions showed 6-bit opcodes, should be 5-bit | FIXED |
| Index width | UI (app.js) | LOAD/SAVE showed 13-bit index, should be 10-bit (1024 entries) | FIXED |
| Bit order | UI (app.js) | Format showed Cond before Op, should be Op first per Verilog [31:27] | FIXED |
| CR8/CR15 access | JS Simulator | LOAD allows writing to CR8/CR15 - OK for boot, but should be restricted after | DOCUMENTED |
| Boot GT permissions | JS Simulator | Boot GTs for CR8/CR15 should have M permission only | VERIFY |
| Boot offsets | JS Simulator | CR15=offset 0, CR8=offset 3 (hardwired) | VERIFY |
| SWITCH operand fields | All | fld_a=CR12–CR15 destination, fld_b=CR0–CR11 source, imm15=c-list row | IMPLEMENTED |

---

## SWITCH/CHANGE Instruction Encoding

### SWITCH Format (32 bits)
```
[31:27] = 00101 (Opcode = 5)
[26:23] = Cond  (4-bit condition code)
[22:19] = CRd   (isolated destination CR12–CR15)
[18:15] = CRs   (c-list source CR0–CR11)
[14:0]  = row   (c-list row)
```

### CHANGE Format (32 bits)
```
[31:27] = 00100 (Opcode = 4)
[26:23] = Cond  (4-bit condition code)
[22:21] = 11    (fixed — marks the privileged-register bank)
[20:19] = Tgt   (2-bit privileged target: 0=CR12, 1=CR13, 2=CR14, 3=CR15)
[18:15] = CRs   (4-bit source capability register)
[14:0]  = Idx   (15-bit NS slot index)
```

### CHANGE Variants

| CRd [22:19] | Tgt [20:19] | Destination | Semantics |
|:------------|:------------|:------------|:----------|
| 1100 (12) | 00 | CR12 | Install data-fault-handler GT (system-wide) |
| 1101 (13) | 01 | CR13 | Install interrupt-handler GT (system-wide)  |
| 1110 (14) | 10 | CR14 | Context switch (per-thread save/restore)    |
| 1111 (15) | 11 | CR15 | Context switch (per-thread save/restore)    |

### SWITCH Authorization

CRd must be CR12–CR15 and CRs must be CR0–CR11; either malformed/non-isolated
operand faults `INVALID_OP`. The instruction latches CRd.M at acceptance.
M-clear faults `PERM_L`. The source follows ordinary LOAD rules and therefore
needs L but no M. Success consumes CRd.M.

---

## Notes

- Opcode format: 5-bit, with Church instructions 00001-01011, Turing 10000-11111
- CR fields: 4-bit (0-11 programmer-accessible; 12-15 privileged — hardware faults on normal access)
- LDI uses Turing format but is documented with Church for immediate loading
- TPERM_PRESET in JS is separate case from TPERM (line 708 vs 385)
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
