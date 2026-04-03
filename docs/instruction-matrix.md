# Church Machine Instruction Cross-Reference Matrix

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
- [ ] RETURN: Verify stack pop, context restore, mask handling
- [ ] CHANGE: Verify thread switch, monitor clearing
- [ ] SWITCH: Verify C-List context switch
- [x] TPERM: Flag model Z=1=pass/Z=0=fail confirmed. Valid presets 0-9 (CLEAR through LS). Codes 10-15 reserved/ignored (Z=0, no FAULT): codes 10-12 violate E isolation (LE/SE/LSE expose abstraction internals); code 13 violates domain purity (cross-domain); codes 14-15 unassigned. Conditional execution (EQ/NE etc.) works via standard condition-check gate before dispatch. B-flag (bit 4 of imm) clears GT B-bit on pass. Named B-variants: RB, RWB, XB, RXB, RWXB, LB, SB, EB, LSB.
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
| 10   | —     | —           | Reserved — E+L illegal (E must be standalone) | [ ] | [x] Amaranth |
| 11   | —     | —           | Reserved — E+S illegal (E must be standalone) | [ ] | [x] Amaranth |
| 12   | —     | —           | Reserved — E+L+S illegal (E must be standalone) | [ ] | [x] Amaranth |
| 13   | —     | —          | Reserved — cross-domain preset; illegal, raises FAULT | [ ] | [x] Amaranth |
| 14   | RSVD  | FAULT       | Reserved | [ ]         | [x] Amaranth     |
| 15   | RSVD  | FAULT       | Reserved | [ ]         | [x] Amaranth     |

---

## Security Boundaries

### CR Register Accessibility

| Register | Purpose           | Instruction Addressable | Notes |
|:---------|:------------------|:------------------------|:------|
| CR0-CR11 | General-purpose   | Yes (4-bit encoding)    | Programmer registers; CR6=C-List, CR8-CR11=free GP |
| CR12     | Thread/Fault      | Privileged zone         | Thread identity + per-thread fault handler |
| CR13     | Interrupt         | Privileged zone         | System-wide interrupt handler; unchanged by CHANGE |
| CR14     | Code/[CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html)       | Privileged zone         | Per-thread code GT; re-derived by CALL via mLoad |
| CR15     | Namespace root    | Privileged zone         | Hardwired at boot; defines system security boundary |

### Boot Sequence — Privileged Register Initialization

The five-phase boot sequence initializes the privileged zone (CR12–CR15):

1. **CR15 (Namespace)**: Loaded at B:00 from hardwired boot GT — M permission only; points to the NS table
2. **CR12 (Thread Identity)**: Loaded at B:02 via mLoad from NS Slot 1 — zero perms, Inform-type; encodes lump base and bounds
3. **CR14 (Code/[CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html))**: Derived at B:04 from NS Slot 2 metadata — X permission; instruction fetch source
4. **CR13 (Interrupt)**: Loaded at B:03 or by SWITCH from a PassKey capability — system-wide, unchanged by CHANGE

After boot:
- CR12–CR15 are the privileged zone; only accessible via CALL (re-derives CR6/CR14), CHANGE (saves/restores CR12/CR14/CR15), or SWITCH (CR13/CR15 only, with PassKey)
- CR0–CR11 are the programmer-accessible GP registers (4-bit instruction field)
- SWITCH uses a 3-bit Tgt field (CR8–CR15 address range); only Tgt=101₂ (CR13) and Tgt=111₂ (CR15) are valid

### Verification Points

- [ ] JS: Check CR index validation in LOAD/SAVE — normal instructions must not address CR12-CR15
- [ ] JS: Verify boot sequence initializes CR15, CR12, CR14 in correct phase order
- [ ] Verilog: Check CRd/CRn field width (3 bits) in decoder
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
| SWITCH target field | All | 3-bit Tgt field addresses CR8-CR15 (Tgt+8); valid targets: CR13 (Tgt=101₂) and CR15 (Tgt=111₂) only | IMPLEMENTED |

---

## SWITCH/CHANGE Instruction Encoding

### SWITCH Format (32 bits)
```
[31:27] = 00110 (Opcode = 6)
[26:23] = Cond  (4-bit condition code)
[22]    = I     (0=Register source, 1=C-List lookup)
[21:19] = CRn   (Source register CR0-CR7, or C-List reference for I=1)
[18:16] = Tgt   (Target system register: 0=CR8, 1=CR9, ... 7=CR15)
[15:6]  = Idx   (10-bit C-List index when I=1, ignored when I=0)
[5:0]   = spare
```

### CHANGE Format (32 bits)
```
[31:27] = 00101 (Opcode = 5)
[26:23] = Cond  (4-bit condition code)
[22]    = I     (0=Register source, 1=C-List lookup)
[21:19] = CRn   (Source register CR0-CR7, or C-List reference for I=1)
[18:16] = spare (CHANGE always targets CR8)
[15:6]  = Idx   (10-bit C-List index when I=1, ignored when I=0)
[5:0]   = spare
```

### I-bit Variants

| I | Source | Example |
|:--|:-------|:--------|
| 0 | Register | `SWITCH CR2, CR15` - Install PassKey in CR2 into CR15 (Namespace) |
| 1 | C-List | `SWITCH CR6[5], CR15` - Lookup entry 5 in CR6's C-List, install to CR15 |

### Target Field Mapping

Only **CR13** (Tgt=101₂) and **CR15** (Tgt=111₂) are valid SWITCH targets. All other values produce an INVALID_OP fault.

| Tgt[2:0] | Register | SWITCH Validity | Notes |
|:---------|:---------|:----------------|:------|
| 000 | CR8 | FAULT — not a valid SWITCH target | CR8 is a GP register; not addressable via SWITCH |
| 001 | CR9 | FAULT — not a valid SWITCH target | GP register |
| 010 | CR10 | FAULT — not a valid SWITCH target | GP register |
| 011 | CR11 | FAULT — not a valid SWITCH target | GP register |
| 100 | CR12 | FAULT — reserved | Thread Identity (managed by CHANGE only) |
| 101 | CR13 | **Valid** — IRQ Thread | Required CRs.word1_location: `0xFFFFFFFE` |
| 110 | CR14 | FAULT — reserved | Transient (re-derived by cLoad on each CALL) |
| 111 | CR15 | **Valid** — Namespace | Required CRs.word1_location: `0xFFFFFFFF` |

### PassKey Requirements

SWITCH replaces the old M-permission check with two mandatory PassKey checks on the source register **CRs**:

1. **Abstract GT check**: CRs.word0_gt.gt_type must equal `11₂` (GT_TYPE_ABSTRACT). Any Inform, Outform, or NULL GT faults with INVALID_OP.
2. **Sentinel address check**: CRs.word1_location must equal the reserved hardware sentinel for the target:
   - CR13: `0xFFFFFFFE` (all-1s − 1)
   - CR15: `0xFFFFFFFF` (all-1s)
   A mismatch (e.g. presenting a CR13 PassKey to the CR15 target) faults with INVALID_OP.

Source must be CR0–CR7 (3-bit encoding prevents direct access to CR8–CR15).

---

## Notes

- Opcode format: 5-bit, with Church instructions 00001-01011, Turing 10000-11111
- CR fields: 3-bit only (0-7), physically preventing CR8-15 access
- LDI uses Turing format but is documented with Church for immediate loading
- TPERM_PRESET in JS is separate case from TPERM (line 708 vs 385)
