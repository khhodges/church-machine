# CTMM Instruction Cross-Reference Matrix

This document maps each instruction across all implementation layers for verification.

## Legend
- **Opcode**: 5-bit binary opcode from Verilog
- **JS Line**: Line number in `web/simulator.js`
- **Verilog**: Definition in `verilog/ctmm_pkg.sv`
- **UI Def**: Definition in `web/app.js` (churchInstrFormats/turingInstrFormats)
- **Tutorial**: Which tutorial lesson covers this instruction

---

## Church Instructions (Capability Operations)

| Instruction | Opcode | Binary | JS Line | Verilog Line | UI Defined | Tutorial |
|-------------|--------|--------|---------|--------------|------------|----------|
| LOAD        | 01     | 00001  | 478     | 157          | Yes        | Lesson 4 |
| SAVE        | 02     | 00010  | 537     | 158          | Yes        | Lesson 4 |
| CALL        | 03     | 00011  | 743     | 159          | Yes        | Lesson 4 |
| RETURN      | 04     | 00100  | 821     | 160          | Yes        | Lesson 4 |
| CHANGE      | 05     | 00101  | 844     | 161          | Yes        | Lesson 4 |
| SWITCH      | 06     | 00110  | 856     | 162          | Yes        | Lesson 4 |
| TPERM       | 07     | 00111  | 385     | 163          | Yes        | Lesson 7 |
| LOADX       | 08     | 01000  | 561     | 164          | Yes        | Lesson 5 |
| SAVEX       | 09     | 01001  | 608     | 165          | Yes        | Lesson 5 |
| LDM         | 10     | 01010  | 641     | 166          | Yes        | Lesson 6 |
| STM         | 11     | 01011  | 677     | 167          | Yes        | Lesson 6 |

### Verification Checklist - Church Instructions

- [ ] LOAD: Verify L permission check, bounds check, MAC validation
- [ ] SAVE: Verify S permission check, B-bit on source, bounds check
- [ ] CALL: Verify E permission, DR/CR mask handling, DR8-15 auto-clear
- [ ] RETURN: Verify stack pop, context restore, mask handling
- [ ] CHANGE: Verify thread switch, monitor clearing
- [ ] SWITCH: Verify C-List context switch
- [ ] TPERM: Verify preset codes 0-13, FAULT on 14-15
- [ ] LOADX: Verify monitor set, same validation as LOAD
- [ ] SAVEX: Verify monitor check, conditional store, result in DR
- [ ] LDM: Verify per-register mLoad validation, register list
- [ ] STM: Verify per-register mSave validation, B-bit per CR

---

## Turing Instructions (Data Operations)

| Instruction | Opcode | Binary | JS Line | Verilog Line | UI Defined | Tutorial |
|-------------|--------|--------|---------|--------------|------------|----------|
| MOV         | 16     | 10000  | TBD     | 175          | Yes        | -        |
| ADD         | 17     | 10001  | TBD     | 176          | Yes        | -        |
| SUB         | 18     | 10010  | TBD     | 177          | Yes        | -        |
| MUL         | 19     | 10011  | TBD     | 178          | Yes        | -        |
| DIV         | 20     | 10100  | TBD     | 179          | Yes        | -        |
| AND         | 21     | 10101  | TBD     | 180          | Yes        | -        |
| ORR         | 22     | 10110  | TBD     | 181          | Yes        | -        |
| EOR         | 23     | 10111  | TBD     | 182          | Yes        | -        |
| LSL         | 24     | 11000  | TBD     | 183          | Yes        | -        |
| LSR         | 25     | 11001  | TBD     | 184          | Yes        | -        |
| ASR         | 26     | 11010  | TBD     | 185          | Yes        | -        |
| CMP         | 27     | 11011  | TBD     | 186          | Yes        | -        |
| TST         | 28     | 11100  | TBD     | 187          | Yes        | -        |
| LDI         | 29     | 11101  | 700     | 188          | Yes        | Lesson 7 |
| B           | 30     | 11110  | TBD     | 189          | Yes        | -        |
| BL          | 31     | 11111  | TBD     | 190          | Yes        | -        |

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
|------|-------|-------------|----------|-------------|------------------|
| 0    | CLEAR | (none)      | -        | [ ]         | [ ]              |
| 1    | R     | R           | Data     | [ ]         | [ ]              |
| 2    | RW    | R,W         | Data     | [ ]         | [ ]              |
| 3    | X     | X           | Data     | [ ]         | [ ]              |
| 4    | RX    | R,X         | Data     | [ ]         | [ ]              |
| 5    | RWX   | R,W,X       | Data     | [ ]         | [ ]              |
| 6    | L     | L           | Lambda   | [ ]         | [ ]              |
| 7    | S     | S           | Lambda   | [ ]         | [ ]              |
| 8    | E     | E           | Lambda   | [ ]         | [ ]              |
| 9    | B     | B           | Lambda   | [ ]         | [ ]              |
| 10   | M     | M           | Lambda   | [ ]         | [ ]              |
| 11   | F     | F           | Lambda   | [ ]         | [ ]              |
| 12   | G     | G           | Lambda   | [ ]         | [ ]              |
| 13   | LS    | L,S         | Combo    | [ ]         | [ ]              |
| 14   | RSVD  | FAULT       | Reserved | [ ]         | [ ]              |
| 15   | RSVD  | FAULT       | Reserved | [ ]         | [ ]              |

---

## Security Boundaries

### CR Register Accessibility

| Register | Purpose           | Instruction Addressable | Notes |
|----------|-------------------|-------------------------|-------|
| CR0-CR7  | User capabilities | Yes (3-bit encoding)    | Normal instruction access |
| CR8      | Thread identity   | Boot only               | Hardwired GT at offset 3, M permission |
| CR9-CR14 | Reserved          | No                      | Future use |
| CR15     | Namespace root    | Boot only               | Hardwired GT at offset 0, M permission |
| CR6      | Current C-List    | Read via LOAD/SWITCH    | Modified by SWITCH |
| CR7      | Nucleus           | Read via LOAD           | Boot-time initialization |

### Boot Sequence CR8/CR15 Initialization

The boot sequence is the **only** time CR8 and CR15 can be addressed:

1. **CR15 (Namespace)**: Loaded from hardwired boot GT at offset 0
   - Permissions: M only (Meta-machine access)
   - Points to the root Namespace table

2. **CR8 (Thread)**: Loaded from hardwired boot GT at offset 3
   - Permissions: M only (Meta-machine access)
   - Identifies the current thread

After boot completes:
- CR8 can only be modified via CHANGE instruction
- CR15 is immutable (root namespace)
- 3-bit instruction encoding physically prevents addressing CR8-CR15

### Verification Points

- [ ] JS: Check CR index validation in LOAD/SAVE/LDM/STM (must be 0-7 after boot)
- [ ] JS: Verify boot sequence loads CR8/CR15 with M-only permissions
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
|-------|----------|-------------|--------|
| Opcode width | UI (app.js) | All Church instructions showed 6-bit opcodes, should be 5-bit | FIXED |
| Index width | UI (app.js) | LOAD/SAVE showed 13-bit index, should be 10-bit (1024 entries) | FIXED |
| Bit order | UI (app.js) | Format showed Cond before Op, should be Op first per Verilog [31:27] | FIXED |
| CR8/CR15 access | JS Simulator | LOAD allows writing to CR8/CR15 - OK for boot, but should be restricted after | DOCUMENTED |
| Boot GT permissions | JS Simulator | Boot GTs for CR8/CR15 should have M permission only | VERIFY |
| Boot offsets | JS Simulator | CR15=offset 0, CR8=offset 3 (hardwired) | VERIFY |
| SWITCH target field | All | Added 3-bit target for CR8-CR15: 0=CR8, 1=CR9, 2=CR10, 7=CR15 | IMPLEMENTED |

---

## Notes

- Opcode format: 5-bit, with Church instructions 00001-01011, Turing 10000-11111
- CR fields: 3-bit only (0-7), physically preventing CR8-15 access
- LDI uses Turing format but is documented with Church for immediate loading
- TPERM_PRESET in JS is separate case from TPERM (line 708 vs 385)
