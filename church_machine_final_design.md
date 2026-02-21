# Church Machine — Final Design

## 1. Architecture Overview

The Church Machine is a 32-bit capability-secured processor. All access control is enforced by a single gate — **mLoad** — which validates Golden Tokens (GTs) before any memory, device, or register access. There are no privilege rings, no MMU, no separate I/O instructions, and no superuser. The GT is the only key to any resource.

Two computational domains coexist:

- **Church domain** — the visible programming model. Lambda calculus, capability management, namespace operations. Church is the armor: the security interface.
- **Turing domain** — hidden inside safe abstractions. Integer arithmetic, bitfield manipulation, data access. Turing is the sword: atomic implementations invisible to the caller.

Programs cannot branch to arbitrary addresses. All control flow passes through mLoad-validated GTs. Safe abstractions are entered via CALL (E permission) or LAMBDA (X permission) and exited only via RETURN.

---

## 2. Register Architecture

### Context Registers (CR0–CR15)

CRs hold cached namespace entry data — they are the program's view of Golden Tokens.

| Register | Purpose |
|----------|---------|
| CR0–CR7 | General-purpose GT holders |
| CR8 | Thread identity |
| CR15 | Namespace root |

Each CR caches three words from the namespace entry it was loaded from:

- **word0** — the GT itself (32-bit Golden Token)
- **word1** — limit/flags word from namespace
- **word2** — version/seal word from namespace

### Data Registers (DR0–DR15)

DRs hold 32-bit unsigned integer values. They are the Turing domain's working storage. DRs have no capability significance — they are pure data.

### Condition Flags

ARM-style condition flags, set by MCMP, IADD, and ISUB:

| Flag | Meaning |
|------|---------|
| Z | Zero — result is zero |
| N | Negative — result bit 31 is set |
| C | Carry — unsigned overflow |
| V | Overflow — signed overflow |

---

## 3. Golden Token Format (Sim-32)

32 bits, packed as:

```
[31:25]  Version   (7 bits)   — revocation counter
[24:8]   Index     (17 bits)  — namespace slot
[7:2]    Perms     (6 bits)   — permission bits
[1:0]    Type      (2 bits)   — NULL GT variant
```

### Permission Bits (bits 7:2)

| Bit | Name | Gate | Instruction |
|-----|------|------|-------------|
| 2 | R | Read data | DREAD, BFEXT |
| 3 | W | Write data | DWRITE, BFINS |
| 4 | X | Execute in-scope | LAMBDA |
| 5 | L | Load from c-list | LOAD |
| 6 | S | Save to c-list | SAVE (requires B=1) |
| 7 | E | Enter abstraction | CALL |

### Type Field (bits 1:0)

The type field classifies NULL GT variants only. It does NOT determine whether an object is code or data — that is determined solely by the R/W/X permission bits.

| Value | Name | Meaning |
|-------|------|---------|
| 0 | Inform | Inbound remote reference |
| 1 | Outform | Outbound remote reference (HTTPS/RPC) |
| 2 | NULL | Revoked or empty |
| 3 | Abstract | Abstract constant (unforgeable value) |

---

## 4. Namespace Entry Format

Each namespace entry is 3 words (96 bits):

### Word 0 — Location (32 bits)

Base address in the unified address space. The MSB byte determines the target:

```
0x00–0xFD  Normal memory (DATA objects, abstraction storage)
0xFE       Attached devices (I/O, peripherals)
0xFF       Machine register bank
```

### Word 1 — Limit and Flags (32 bits)

```
[31]    B — Bind bit (SAVE requires B=1; defaults to 0)
[30]    F — Flip bit (GC phase marker)
[29]    G — G-bit (liveness for GC; toggled by mLoad)
[28]    C — Chainable (supports method chaining)
[27:26] T — GT type echoed from token
[25:17] Reserved
[16:0]  Limit (17 bits) — bounds for offset checking
```

### Word 2 — Version and Seals (32 bits)

Cryptographic seal for tamper detection. Validated by mLoad on every access.

---

## 5. Unified Address Space

All resources — memory, devices, and the machine's own registers — occupy segments of a single flat address space. Protection is uniform: without a GT whose address field points to a segment, that segment is unreachable. There are no special instructions for I/O or register access. The same DREAD/DWRITE/BFEXT/BFINS instructions work on any address — mLoad validates the GT, and the address determines the target.

```
 Address Space (32-bit)
 ┌─────────────────────────────────┐
 │  0x00000000 – 0xFDFFFFFF       │  Normal memory
 │  DATA objects, abstraction      │  GT required (R/W)
 │  storage, program state         │
 ├─────────────────────────────────┤
 │  0xFE000000 – 0xFEFFFFFF       │  Attached devices
 │  I/O registers, peripherals    │  GT required (R/W)
 ├─────────────────────────────────┤
 │  0xFF000000 – 0xFFFFFFFF       │  Machine register bank
 │  CRs, DRs, flags, control      │  GT required (R/W)
 └─────────────────────────────────┘
```

Without the right GT, any address range is simply unreachable. The machine register bank is not special — it is protected by the same mechanism as a DATA object or a peripheral. A GT with address MSB=0xFF addresses the machine's own registers as a bank from offset zero to the last register or bit. A GT with address MSB=0xFE addresses attached devices the same way.

This is the core security property: **one gate, one mechanism, uniform protection**.

---

## 6. mLoad — The Single Guard

Every instruction that accesses a resource funnels through mLoad. There are no exceptions and no bypasses (except M-elevation during boot and atomic abstraction execution).

mLoad performs three checks:

1. **Version check** — GT version matches namespace entry version (detects revocation)
2. **Seal check** — cryptographic seal on namespace entry is valid (detects tampering)
3. **Permission check** — GT has the required permission bit for the requested operation

If any check fails, mLoad routes to FAULT. There is one fault handler.

### Permission Gate Table

| Required Permission | Instructions |
|---------------------|-------------|
| R (Read) | DREAD, BFEXT |
| W (Write) | DWRITE, BFINS |
| X (Execute in-scope) | LAMBDA |
| L (Load from c-list) | LOAD |
| S (Save to c-list) | SAVE (also requires B=1 on NS entry) |
| E (Enter abstraction) | CALL |

On successful access, mLoad toggles the G-bit in the namespace entry, marking it live for the garbage collector.

---

## 7. Instruction Set

### 7.1 Church Domain (Opcodes 0–9)

Church instructions are the visible programming model. They operate on CRs and the namespace.

| Opcode | Mnemonic | Operands | Description |
|--------|----------|----------|-------------|
| 0 | LOAD | CRd, CRs, imm | Load GT from namespace slot into CR. Permission: L |
| 1 | SAVE | CRd, CRs, imm | Save GT to namespace slot. Permission: S, requires B=1 |
| 2 | CALL | CRd | Enter abstraction. Permission: E. Saves context, transfers control |
| 3 | RETURN | CRd | Exit abstraction. Restores caller context |
| 4 | CHANGE | CRd, imm | Attenuate permissions on a GT (can only remove, never add) |
| 5 | SWITCH | CRs, imm | Switch active namespace domain |
| 6 | TPERM | CRd, preset | Test permission bits on a GT. Sets Z flag |
| 7 | LAMBDA | CRd | Apply GT in-scope (lightweight reduction). Permission: X |
| 8 | ELOADCALL | CRd, CRs, imm | Fused LOAD + TPERM(E) + CALL. One-cycle entry |
| 9 | XLOADLAMBDA | CRd, CRs, imm | Fused LOAD + TPERM(X) + LAMBDA. One-cycle reduction |

All Church instructions support ARM-style conditional execution via a 4-bit condition suffix (EQ, NE, CS, CC, MI, PL, VS, VC, HI, LS, GE, LT, GT, LE, AL, NV).

### 7.2 Turing Domain (Opcodes 10–17)

Turing instructions exist only inside safe abstractions. They operate on DRs and on memory/devices/registers addressed through GTs. They cannot be used to escape an abstraction or forge capabilities.

| Opcode | Mnemonic | Operands | Description |
|--------|----------|----------|-------------|
| 10 | DREAD | DRd, CRs, imm | Read word at [CRs + offset] into DR. Permission: R |
| 11 | DWRITE | DRd, CRs, imm | Write DR to [CRs + offset]. Permission: W |
| 12 | BFEXT | DRd, CRs, pos, width | Extract bitfield from word at CRs address into DR. Permission: R |
| 13 | BFINS | DRd, CRs, pos, width | Insert bitfield from DR into word at CRs address. Permission: W |
| 14 | MCMP | DRa, DRb | Compare two DRs. Sets Z, N, C, V flags |
| 15 | IADD | DRd, DRa, DRb | Integer add: DRd = DRa + DRb. Sets flags |
| 16 | ISUB | DRd, DRa, DRb | Integer subtract: DRd = DRa - DRb. Sets flags |
| 17 | BRANCH | offset | Conditional branch within abstraction. Bounded by abstraction limits |
| 18 | SHL | DRd, DRs, shamt | Logical shift left: DRd = DRs << shamt. Sets Z, N, C (last bit out) |
| 19 | SHR | DRd, DRs, shamt [ASR] | Shift right: logical (default) or arithmetic (ASR). Sets Z, N, C |

RETURN (opcode 3) is shared between domains — it is the only exit from a Turing abstraction.

Turing instructions also support ARM-style conditional execution.

### 7.3 Special

| Encoding | Mnemonic | Description |
|----------|----------|-------------|
| 0x00000000 | HALT/NOP | Stop execution / no operation |

---

## 8. Condition Codes

All instructions can be conditionally executed using a 4-bit condition field, following ARM conventions:

| Code | Suffix | Meaning | Flags |
|------|--------|---------|-------|
| 0 | EQ | Equal / zero | Z=1 |
| 1 | NE | Not equal / nonzero | Z=0 |
| 2 | CS/HS | Carry set / unsigned >= | C=1 |
| 3 | CC/LO | Carry clear / unsigned < | C=0 |
| 4 | MI | Minus / negative | N=1 |
| 5 | PL | Plus / positive or zero | N=0 |
| 6 | VS | Overflow set | V=1 |
| 7 | VC | Overflow clear | V=0 |
| 8 | HI | Unsigned higher | C=1, Z=0 |
| 9 | LS | Unsigned lower or same | C=0 or Z=1 |
| 10 | GE | Signed >= | N=V |
| 11 | LT | Signed < | N!=V |
| 12 | GT | Signed > | Z=0, N=V |
| 13 | LE | Signed <= | Z=1 or N!=V |
| 14 | AL | Always (default) | — |
| 15 | NV | Never | — |

---

## 9. Safe Turing Abstractions

A safe Turing abstraction is a hidden Turing implementation inside a Church-callable namespace entry. The pattern:

1. **Church program** holds a GT with E permission pointing to the abstraction
2. **CALL** enters the abstraction — mLoad validates the GT, context is saved
3. **Inside**: Turing instructions (DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR) execute atomically. The caller cannot see or interfere with the implementation
4. **RETURN** exits — caller's context is restored, results are visible through the namespace

The caller sees only the Church interface. The Turing implementation is invisible, atomic, and confined. There is no way to branch into an abstraction at an arbitrary point — CALL is the only entry, RETURN is the only exit.

### M-Elevation

During boot and during atomic abstraction execution, M-elevation allows mLoad to bypass permission checks. This enables trusted system code (boot sequence, GC, capability manager) to operate on the namespace without holding explicit permissions. M-elevation is not a privilege level — it is a hardware state that is active only during these bounded operations.

---

## 10. Garbage Collection (PP250)

GC is itself a safe Turing abstraction (namespace slot 24, E permission). It implements deterministic, four-phase collection:

1. **Scan** — examine all namespace entries
2. **Identify** — entries whose G-bit doesn't match expected polarity are garbage
3. **Clear** — zero out garbage entries (location, limit, seals)
4. **Flip** — invert expected polarity for next cycle

The G-bit is bidirectional: mLoad toggles it on every access, and GC reads it to determine liveness. After GC completes, the polarity is flipped so the next cycle starts clean.

GC executes with M-elevation — it can read and modify any namespace entry. But it is entered via CALL with a valid GT, and exits via RETURN. The calling program cannot observe or interfere with the GC implementation.

---

## 11. Dispatch Styles

Abstractions support three dispatch methods:

| Style | Entry | Performance | Security |
|-------|-------|-------------|----------|
| Symbolic resolver | CALL | Moderate | Highest — dynamic method lookup |
| LAMBDA fast-path | LAMBDA (X) | Fast | High — in-scope reduction |
| Compiled binary | CALL | Fastest | High — static entry point |

---

## 12. Instruction Encoding (32-bit)

```
[31:28]  Condition (4 bits)  — ARM-style condition code
[27:23]  Opcode    (5 bits)  — instruction (0–17)
[22:19]  CRd/DRd   (4 bits)  — destination register
[18:15]  CRs/DRs   (4 bits)  — source register
[14:0]   Immediate (15 bits) — offset, slot index, bitfield position/width
```

For BFEXT/BFINS, the immediate field encodes position and width. For BRANCH, it encodes a signed offset bounded within the abstraction. For IADD/ISUB, it encodes a third register in the lower bits. For SHL, the immediate encodes shift amount (bits 0-4). For SHR, bits 0-4 encode shift amount and bit 5 selects arithmetic (1) vs logical (0) mode.

---

## 13. Design Principles

1. **One gate** — mLoad is the single point of access control for all resources
2. **One mechanism** — Golden Tokens are the only protection mechanism
3. **Uniform address space** — memory, devices, and machine registers are all address ranges behind the same GT gate
4. **No special cases** — no privilege rings, no MMU, no separate I/O instructions, no superuser
5. **Domain purity** — Church (security interface) and Turing (hidden implementation) are separated by the abstraction boundary
6. **Minimal Turing ISA** — 11 instructions, integer only, no floating point (FP is Church-domain via abstractions)
7. **Capabilities cannot be forged** — only attenuated (CHANGE), loaded (LOAD), or saved (SAVE with B=1)
8. **Failsafe default** — all validation failures route to a single FAULT handler
