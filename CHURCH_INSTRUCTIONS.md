# Church Instructions Reference

## Overview

The Church instructions implement capability-based access control as hardware-enforced operations. They are the mechanism by which software interacts with Golden Tokens (GTs), capability registers (CRs), and the Namespace. Named after Alonzo Church, these instructions embody the lambda calculus principle of controlled access through abstraction.

Both the Sim-64 (CTMM) and Sim-32 (RV32-Cap) simulators implement the same six core Church instructions. The architectural purpose, security model, and operational semantics are identical. Only the encoding format, token width, and implementation details differ.

---

## Shared Architectural Principles

These rules apply identically to both simulators:

1. **CR0-CR7 Only**: Church instructions can only address CR0-CR7 via 3-bit register encoding. System registers CR8-CR15 are physically unreachable through instruction encoding.
2. **SWITCH Is the Gate**: The only way to write to system registers CR8-CR15 is through the privileged SWITCH instruction.
3. **Permission Domains Are Mutually Exclusive**: Church (L, S), Turing (R, W, X), Lambda (E), and Meta (B, M, F, G) permissions cannot be mixed within a single operation context.
4. **Failsafe FAULT**: Every validation failure (permission, bounds, version) routes to a FAULT handler.
5. **C-List Mediation**: LOAD and SAVE operate through capability-mediated access, never through raw memory addressing.

---

## The Six Church Instructions

### 1. LOAD — Load Capability from C-List

**Purpose**: Retrieve a Golden Token from a C-List entry and place it into a capability register.

**Required Permission**: L (Load) on the C-List capability

**Operation**:
1. Check that the C-List capability has L permission → FAULT if not
2. Use the index operand to locate the entry
3. Validate bounds (index must be within valid range) → FAULT if not
4. Copy the capability into the destination CR

| Detail | Sim-64 (CTMM) | Sim-32 (RV32-Cap) |
|--------|---------------|-------------------|
| **Mnemonic** | `LOAD CRd, CRs, idx` | `CAP.LOAD CRd, CRs, index` |
| **Source C-List** | Any CR (CRs) as C-List source, explicit index operand | Any CR (CRs) as source, 15-bit immediate index |
| **Permission Check** | L or M on source CR | L on source CR |
| **GT Validation** | Implicit (capability object integrity) | Version match + MAC seal validation on source GT |
| **MAC Validation** | Yes — hardware hash checked on loaded GT | Yes — 27-bit FNV seal in VersionSeals checked on target namespace entry |
| **G-bit Reset** | Yes — G bit cleared on namespace access (GC signal) | No (GC uses separate Mark-Scan-Sweep cycle) |
| **Bounds Check** | Against source C-List entry count | Against namespaceTable length |
| **GT Width** | 64-bit (Offset + Permissions + Spare) | 32-bit (Version + Index + Permissions + Type) |
| **Result** | Loaded capability object stored in destination CR | 128-bit CR filled: word0=new GT, word1=location, word2=limit, word3=versionSeals from namespace entry |
| **Encoding** | 5-bit opcode, condition[4], I-bit, CRd[3], CRs[3], idx | opcode=0x2B, J-type: CRd[11:9], CRs[14:12], index[29:15] |

---

### 2. SAVE — Save Capability to C-List

**Purpose**: Store a Golden Token from a capability register into a C-List or namespace entry.

**Required Permission**: S (Save) on the C-List capability

**Operation**:
1. Check that the C-List capability has S permission → FAULT if not
2. Use the index operand to locate the target entry
3. Validate bounds → FAULT if not
4. Copy the capability from the source CR into the target entry

| Detail | Sim-64 (CTMM) | Sim-32 (RV32-Cap) |
|--------|---------------|-------------------|
| **Mnemonic** | `SAVE CRd, CRs, idx` | `CAP.SAVE CRsrc, CRdst, index` |
| **Destination** | Any CR (CRd) as C-List destination, explicit index | Any CR (CRdst) as destination, 15-bit immediate index |
| **Permission Check (C-List)** | S or M on destination CR | S on destination CR |
| **Permission Check (source)** | B or M on source CR (Bind permission required) | None |
| **Bounds Check** | Against destination C-List size | Index must be < 32,768; namespace table auto-extends |
| **Seal Recompute** | N/A | Yes — MAC seal recomputed from Location+Limit, preserving existing version |
| **Storage** | Writes capability object into C-List entry | Writes CR word1 (location), word2 (limit), word3 (recomputed versionSeals) into namespace table |
| **Encoding** | 5-bit opcode, condition[4], I-bit, CRd[3], CRs[3], idx | opcode=0x7B, J-type: CRsrc[11:9], CRdst[14:12], index[29:15] |

---

### 3. CALL — Protected Call Through Capability

**Purpose**: Invoke a protected abstraction (service/function) referenced by a Golden Token, saving context for later return.

**Operation**:
1. Check required permission on the target CR → FAULT if not
2. Validate the GT → FAULT if invalid
3. Push return context onto the call stack
4. Transfer control to the target abstraction

| Detail | Sim-64 (CTMM) | Sim-32 (RV32-Cap) |
|--------|---------------|-------------------|
| **Mnemonic** | `CALL CRs [, mask]` | `CAP.CALL CRs` |
| **Required Permission** | L (Load) on source CR — used to access C-List for loading new context | E (Enter) on source CR — direct entry permission |
| **GT Validation** | Implicit (capability object integrity) | Version match + MAC seal validation on both source GT and target namespace entry |
| **Saved Context** | Return NIA, CR6, CR7, bound GT list | PC, CR5, CR6, CR7 pushed to call stack (max 256 frames) |
| **Stack Overflow** | Software-managed depth tracking | FAULT if call stack full (256 frames). Updates stackSpace/stackFrames indicators. |
| **Register Clearing** | 11-bit mask field specifies which DRs (1-5) and CRs (0-5) to clear/preserve on entry; DR0 always preserved, DR6-15 always cleared | CR5 cleared after push (software clears others) |
| **New Context** | CR6 loaded with target's nodal C-List, CR7 loaded with Access Code (X permission) | CR6 set to callee C-List (M-bit set), CR7 set to callee code, PC set to namespace entry location |
| **Stack** | Software-managed call stack with depth tracking | Hardware call stack with 256-frame limit, stackSpace/stackFrames indicators |
| **Encoding** | 5-bit opcode, condition[4], CRs[3], mask bits | opcode=0x5B, J-type: CRs[14:12] |

**Note on permission difference**: Sim-64 uses L because CALL's first action is loading the target's C-List entries (a Load operation). Sim-32 uses E because it treats CALL as entering an abstraction directly. Both achieve the same security goal — only authorized callers can invoke protected services.

---

### 4. RETURN — Return from Protected Call

**Purpose**: Restore context saved by a previous CALL and resume execution at the caller.

**Required Permission**: None (return is always permitted if a saved context exists)

**Operation**:
1. Check that a saved context exists on the call stack → FAULT if empty
2. Pop the saved context
3. Restore CR6 (caller's C-List) and CR7 (caller's code reference)
4. Resume execution at the saved return address

| Detail | Sim-64 (CTMM) | Sim-32 (RV32-Cap) |
|--------|---------------|-------------------|
| **Mnemonic** | `RETURN` | `CAP.RETURN` |
| **Permission Check** | None | None |
| **Restored Registers** | CR6, CR7, NIA (next instruction address) | CR5, CR6 (M-bit set), CR7, PC (set to saved PC + 4) |
| **Bound GT Surrender** | Yes — CRs marked as bound during CALL are cleared to NULL | No |
| **Stack Underflow** | FAULT: "Stack underflow - no procedure to return from" | FAULT: "No saved context to restore" |
| **Stack Indicators** | N/A | Updates stackFrames (true if frames remain) and stackSpace (true, always room after pop) |
| **Encoding** | 5-bit opcode, condition[4], no operands | opcode=0x0B, funct3=000, no operands |

---

### 5. CHANGE — Change Thread Context

**Purpose**: Create or set a new thread identity by writing to CR8 (Thread register). This is the mechanism for context switching between threads.

**Operation**:
1. Obtain source capability (from register or C-List lookup)
2. Write to CR8 (Thread identity)
3. Advance the PC

| Detail | Sim-64 (CTMM) | Sim-32 (RV32-Cap) |
|--------|---------------|-------------------|
| **Mnemonic** | `CHANGE CRs` (I=0) or `CHANGE CRn, idx` (I=1) | `CAP.CHANGE CRs` |
| **Permission Check** | I=1: L on C-List CR for lookup; I=0: none on source (capability object checked) | E (Enter) on source CR |
| **I-bit Variant** | Yes — I=0 uses register, I=1 uses C-List lookup | No (register only) |
| **Target** | Always CR8 (Thread) | Full atomic thread swap via thread table |
| **What Gets Written** | New thread GT created with name `THREAD_<source>`, R/W permissions, new golden key | Saves current x0-x31, CR0-CR8, PC to thread table; loads target thread context. CR9-CR15 unchanged. |
| **Exclusive Monitor** | Cleared for current thread (ARM CLREX semantics) | Not implemented |
| **Encoding** | 5-bit opcode, condition[4], I-bit, CRs[3] | opcode=0x0B, funct3=001, cr_src=rs2[2:0] |

---

### 6. SWITCH — Copy Capability to System Register

**Purpose**: Write a capability into one of the system registers CR8-CR15. This is the only instruction that can modify system registers, making it the privilege gate.

**Operation**:
1. Check required permission on the source capability → FAULT if not
2. Determine the target system register from the 3-bit target field (CR8 + target)
3. Copy the capability into the target system register

| Detail | Sim-64 (CTMM) | Sim-32 (RV32-Cap) |
|--------|---------------|-------------------|
| **Mnemonic** | `SWITCH CRs, target` (I=0) or `SWITCH CRn, idx, target` (I=1) | `CAP.SWITCH CRs, target` |
| **Permission Check** | I=1: L on C-List CR; I=0: L or E on source CR | M (Machine) on source CR |
| **I-bit Variant** | Yes — I=0 uses register, I=1 uses C-List lookup | No (register only) |
| **Target Field** | 3-bit: 0=CR8(Thread), 1=CR9(Interrupt), 2=CR10(DFault), 3-6=CR11-14(future), 7=CR15(Namespace) | 3-bit: 0=CR8, 1=CR9, ..., 7=CR15 (same mapping) |
| **Target Encoding** | Instruction operand (parsed from args) | Instruction bits [24:22] |
| **Bounds Check** | Implicit (target 0-7 maps to CR8-CR15) | destIdx must be ≤ 15, FAULT otherwise |
| **Exclusive Monitor** | Cleared if target is CR8 | Not implemented |
| **Encoding** | 5-bit opcode, condition[4], I-bit, CRs[3], target[3] | opcode=0x0B, funct3=010, cr_src=rs2[2:0], tgt=[24:22] |

**Note on permission difference**: Sim-64 requires L or E because SWITCH may load from a C-List (needing L) or enter a new context (needing E). Sim-32 requires M (Machine) because SWITCH is treated as a privileged machine-level operation.

---

## TPERM — Test Permission (Sim-32)

**Purpose**: Test the permissions, validity, type, and stack indicators of a Golden Token and write the result to a data register.

**Mnemonic**: `CAP.TPERM rd, CRs`

**Encoding**: opcode=0x0B, funct3=011, CRs in rs2[22:20], result in rd[11:7]

**Result Layout (rd)**:
| Bits | Field | Description |
|------|-------|-------------|
| [9:0] | Permissions | R, W, X, L, S, E, B, M, F, G from CRs Golden Token |
| [10] | stackFrames | 1 = at least one frame on call stack (RETURN safe) |
| [11] | stackSpace | 1 = room for at least one more frame (CALL safe) |
| [12] | Valid | 1 = GT passes version and MAC validation |
| [14:13] | Type | GT type: 00=Inform, 01=Outform, 10=Literal, 11=Abstract |
| [31:15] | (Reserved) | Zero |

---

## Additional Church Instructions (Sim-64 Only)

The CTMM simulator includes five additional Church instructions not present in the RV32-Cap simulator. These provide atomic operations, bulk transfers, and permission management:

| Instruction | Purpose | Permission |
|-------------|---------|------------|
| **LOADX** | Load Exclusive — same as LOAD but sets an exclusive monitor for atomic operations | L or M |
| **SAVEX** | Save Exclusive — conditional save that only succeeds if the exclusive monitor is still valid | S or M |
| **LDM** | Load Multiple — load multiple CRs from consecutive C-List entries in one instruction | L or M |
| **STM** | Store Multiple — store multiple CRs to consecutive C-List entries in one instruction | S or M |
| **TPERM** | Test Permission — check permission bits and bounds on a GT, setting condition flags (P, B, Z) | None |

These instructions exist in Sim-64 because its custom ISA has room for dedicated opcodes. Sim-32 uses the standard RISC-V opcode space with 4 dedicated custom opcodes (0x2B=LOAD, 0x5B=CALL, 0x7B=SAVE) plus custom-0 (0x0B) with funct3 selecting: 000=RETURN, 001=CHANGE, 010=SWITCH, 011=TPERM (100-111 reserved).

---

## Encoding Comparison

### Sim-64 (CTMM) — Custom ARM-style Encoding
```
[31:27] Opcode (5 bits) — each Church instruction has its own opcode
[26:23] Condition (4 bits) — ARM-style conditional execution (N,Z,C,V)
[22]    I-bit — 0=register source, 1=C-List lookup
[21:0]  Operands (22 bits) — CRs, indices, target fields
```
Every instruction can be conditionally executed based on the condition flags. This is unique to Sim-64.

### Sim-32 (RV32-Cap) — RISC-V Custom Opcode Encoding

**Dedicated opcodes (J-type format)**:
```
LOAD:  opcode=0x2B  — CAP.LOAD CRd, CRs, index
       [31:17] index (15 bits), [14:12] CRs (3 bits), [11:9] CRd (3 bits), [6:0] 0101011

CALL:  opcode=0x5B  — CAP.CALL CRs
       [14:12] CRs (3 bits), [6:0] 1011011

SAVE:  opcode=0x7B  — CAP.SAVE CRsrc, CRdst, index
       [31:17] index (15 bits), [14:12] CRdst (3 bits), [11:9] CRsrc (3 bits), [6:0] 1111011
```

**Custom-0 opcode (R-type format)**:
```
opcode=0x0B (custom-0), funct3 selects instruction:
  000 = RETURN    — CAP.RETURN (no operands)
  001 = CHANGE    — CAP.CHANGE CRs (CRs in rs2[22:20])
  010 = SWITCH    — CAP.SWITCH CRs, target (CRs in rs2[22:20], target in [24:22])
  011 = TPERM     — CAP.TPERM rd, CRs (CRs in rs2[22:20], result in rd[11:7])
  100-111 = (reserved for future Church instructions)
```
No conditional execution — RISC-V uses explicit branch instructions instead.

---

## Implementation Differences Summary

| Aspect | Sim-64 (CTMM) | Sim-32 (RV32-Cap) |
|--------|---------------|-------------------|
| **CALL permission** | L (Load — accesses C-List) | E (Enter — enters abstraction) |
| **SWITCH permission** | L or E | M (Machine) |
| **CHANGE behavior** | Creates new thread GT with R/W permissions | Full atomic thread swap: saves x0-x31, CR0-CR8, PC to thread table; loads target context |
| **CHANGE permission** | None (I=0) / L (I=1 for C-List lookup) | E (Enter) on source CR |
| **I-bit variants** | Yes — CHANGE and SWITCH support register (I=0) and C-List lookup (I=1) | No — register mode only |
| **Bind validation** | SAVE requires B or M on source | Not enforced |
| **MAC validation** | LOAD validates hardware hash | LOAD and CALL validate 27-bit FNV seal in VersionSeals; SAVE recomputes seal |
| **G-bit management** | LOAD clears G bit on namespace access | Deterministic Mark-Scan-Sweep GC cycle with version bump on sweep |
| **Exclusive monitors** | CHANGE clears thread's exclusive monitor | Not implemented |
| **Bound GT surrender** | RETURN clears CRs bound during CALL | Not implemented |
| **Register clearing** | CALL uses mask to selectively clear DRs/CRs | Not implemented |
| **Conditional execution** | All instructions support ARM-style conditions | None (RISC-V branches) |

---

## Security Model Summary

Both simulators enforce the same core security invariants:

| Principle | Enforcement |
|-----------|-------------|
| No direct system register access | CR0-CR7 only in instruction encoding (3-bit field) |
| Privilege through SWITCH only | Only SWITCH writes to CR8-CR15 |
| Permission before access | Every Church instruction checks permissions before operating |
| Failure handling | All violations route to FAULT handler |
| Capability-mediated access | LOAD/SAVE go through C-List capabilities, never raw memory |
| Mutually exclusive domains | Church (L,S) / Turing (R,W,X) / Lambda (E) / Meta (B,M,F,G) |
