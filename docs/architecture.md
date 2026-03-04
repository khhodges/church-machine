# Church Machine Architecture

## Overview

The Church Machine is a capability-secured processor that enforces security at the instruction level. There is no operating system, no privileged mode, no superuser. Every memory access — read or write — passes through a hardware validation gate (mLoad or mSave) that checks an unforgeable Golden Token before permitting the operation.

## Design Principles

### No Ambient Authority

Traditional systems grant programs implicit access to resources. The Church Machine requires explicit capability tokens for every operation. A program can only access what it holds tokens for.

### Domain Purity

The instruction set is split into two domains:

- **Church domain** (10 instructions): Capability manipulation — LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, XLOADLAMBDA
- **Turing domain** (10 instructions + shared RETURN): Data processing — DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR

A code object (CLOOMC) belongs to the DATA domain — it is data stored in memory, accessed via X permission. Code is never a Church-domain entity. The Church domain handles capabilities (GTs, c-lists); the Turing domain handles computation. A code object may contain Church instructions or Turing instructions, but the object itself is always data. This separation is enforced in hardware.

### Abstractions as Security Blocks

An abstraction is a security block — a protected unit of functionality with measurable reliability. Each abstraction has:

- A c-list (CR6 target) containing its capabilities
- Code (CR7 target at c-list[0]) — a DATA-domain object implementing its methods
- Entry via CALL (E-GT); LAMBDA (X-GT) is a method within abstractions, not a separate security block
- MTBF (Mean Time Between Failures) measured by fault reports over time in the namespace

Abstractions are not OS calls — they are namespace entries accessed via Golden Tokens. Every fault against an abstraction is counted and tracked. The abstraction's MTBF is the ratio of uptime to fault count, providing a continuous reliability measure for each security block in the namespace.

### Polymorphic Abstraction Interface

Every abstraction — regardless of type or layer — shares the same four structural operations: create, destroy, call, inspect. This uniformity is intentional. The polymorphic interface ensures that creating a math library works the same as creating a hardware driver or a social networking tool. The pattern is repetitive by design.

### Hardware Device Access (L/S Domain)

All hardware devices (UART, LED, Button, Timer, Display) are accessed through Church domain permissions (L/S/E) — NOT Turing domain (R/W). This enforces capability-gated device access:

- **L (Load)**: Read data from device (receive bytes, read button state, read timer)
- **S (Save)**: Write data to device (send bytes, set LEDs, start timer, write display)
- **E (Enter)**: Call the device abstraction via CALL instruction

R, W, and X permissions are NOT permitted on hardware devices.

## Golden Token Format

```
31        25 24          8 7      2 1  0
| Version  |    Index    | Perms  |Type|
|  7 bits  |   17 bits   | 6 bits |2 b |
```

### Version (7 bits)

Monotonically increasing counter. Must match the version stored in the namespace entry. On mismatch, the GT is dead — access FAULTs. Revocation is instant: increment the namespace version, and every copy of every GT referencing that entry dies on next use.

### Index (17 bits)

Points to a namespace entry. Supports up to 131,072 entries.

### Permissions (6 bits)

| Bit | Name | Gate | Domain |
|-----|------|------|--------|
| 0 | R | DREAD | Turing |
| 1 | W | DWRITE | Turing |
| 2 | X | LAMBDA | Church |
| 3 | L | LOAD | Church |
| 4 | S | SAVE | Church |
| 5 | E | CALL | Church |

R, W are data permissions (Turing domain access). X, L, S, E are capability permissions (Church domain access).

### Type (2 bits)

| Value | Type | Meaning |
|-------|------|---------|
| 00 | NULL | Zero value — no capability. A zeroed GT is naturally NULL. |
| 01 | Inform | GT points to memory via an NS entry — abstractions, data objects, lumps |
| 10 | Outform | GT points to remote memory (F-bit auto-set, tunneled access) |
| 11 | Abstract | GT IS the value — constants (pi), immutable credentials, escale variables |

All abstractions use **Inform (01)** GTs. The Inform GT points to a namespace entry, which points to a memory lump. CALL uses the clistCount field in the NS entry's word1 to split the lump into code (CR7) and c-list (CR6) regions.

## Register Architecture

### Context Registers (CR0–CR15)

128-bit registers holding Golden Tokens. Each CR stores four 32-bit words:

- **word0**: The GT itself (version + index + perms + type)
- **word1**: Location/base address, plus B-bit (bit 31) and F-bit (bit 30)
- **word2**: Limit/bounds
- **word3**: Seal (FNV-1a hash for integrity)

Special assignments:
- **CR6**: Current capability list (c-list) — entered via CALL
- **CR7**: Current code object (CLOOMC) — instruction fetch source
- **CR8**: Thread identity
- **CR9**: Interrupt handler
- **CR10**: Default fault handler
- **CR15**: Namespace root

### Data Registers (DR0–DR15)

32-bit integer registers. DR0 is hardwired to zero.

### Flags

ARM-style condition flags: N (negative), Z (zero), C (carry), V (overflow). Set by Turing arithmetic instructions (IADD, ISUB, MCMP). All instructions support conditional execution via 4-bit condition codes.

## Memory Architecture

### Unified Address Space

```
0x0000 – 0xFCFF    General memory (code + data objects)
0xFD00 – 0xFDFF    Namespace table (NS entries)
0xFE00 – 0xFEFF    Device I/O (UART, LED, Button, Timer, Display) — L/S access only
0xFF00 – 0xFFFF    Machine registers (read-only inspection)
```

All segments are accessed through the same GT gate via mLoad.

### Namespace Entries

Each namespace entry is 3 words (96 bits):

- **Word 0**: Location (32-bit base address of the object)
- **Word 1**: B(31) | F(30) | G(29) | chain(28) | type(27:26) | clistCount(25:17) | Limit(16:0)
- **Word 2**: Version(31:25) | Seal(24:0) — 7-bit version + 25-bit FNV-1a integrity hash

### word1 Layout

```
Bit 31:    B (Bind) — defaults 0, auto-cleared by CALL
Bit 30:    F (Far) — set for Outform GTs
Bit 29:    G (GC mark) — used by PP250 garbage collector
Bit 28:    chain — reserved for linked entries
Bits 27:26: type — 00=NULL, 01=Inform, 10=Outform, 11=Abstract
Bits 25:17: clistCount — number of c-list slots (0-511)
Bits 16:0:  limit — object size limit (0-131071)
```

When `clistCount > 0`, the NS entry describes an abstraction lump. CALL splits the lump:
- `clistStart = (limit + 1) - clistCount`
- **CR7** (code): location = base, limit = clistStart - 1, permissions = X-only (hardcoded)
- **CR6** (c-list): location = base + clistStart, limit = clistCount - 1, permissions = L-only (hardcoded)
- PC = 0

When `clistCount = 0`, the entry is a plain data object (no lump split).

Seal = FNV-1a(word0, word1[16:0]). Recomputed and verified on every mLoad access (step 3). If word0 or word1 are tampered, the seal check fails.

## Boot Sequence

The boot sequence follows a deterministic flow:

1. **FAULT_RST**: All CRs cleared to NULL, all DRs zeroed. M-Elevation ON.
2. **LOAD_NS**: CR15 initialized with GT to Namespace Root (Slot 0).
3. **INIT_THRD**: CR8 initialized with Thread Identity (Slot 1).
4. **INIT_CLIST**: CR6 loaded with Boot C-List (Slot 2).
5. **LOAD_NUC**: CR7 loaded with Boot Code (CLOOMC from Slot 3). PC = 0.
6. **COMPLETE**: M-Elevation OFF. Machine begins executing boot code.

After boot, the code CALLs Salvation (NS[4]) to verify the security pipeline. Salvation proves LOAD, TPERM, and LAMBDA work correctly, then transitions to Navana (NS[5]). Navana does not RETURN — it becomes the permanent namespace controller, managing all abstractions, intrusion detection (IDS), and system lifecycle indefinitely.

## Security Pipeline (mLoad)

Every read-side memory access passes through this 7-step pipeline:

1. **GT Type Check** — NULL type → FAULT
2. **Version Match** — GT version must equal NS entry version
3. **Seal Verify** — FNV-1a hash must match NS entry seal
4. **Bounds Check** — Access address must be within [location, location + limit)
5. **Permission Check** — Required permission bit must be set in GT
6. **F-bit Check** — F=1 means far/foreign object (requires tunnel)
7. **Data Delivery** — Access permitted, data returned

mSave (write gate) performs the symmetric check for c-list writes, additionally requiring B=1 (bindable) on the source GT.

## B-bit (Bind)

Namespace entry word1, bit 31. Controls whether a GT can be saved into another c-list:

- B=0 (default): GT cannot be copied to other c-lists — mSave FAULTs
- B=1: GT is bindable — mSave permits the write

CALL automatically clears B on all preserved CRs passed to the callee ("no bind by default"). Explicit TPERM with B modifier enables binding.

## Instruction Fetch

Instruction fetch uses CR7 (CLOOMC):

- PC is an offset within the current code object, not an absolute address
- Bounds checked against CR7's limit
- CALL sets PC=0 and CR7 to callee's CLOOMC
- RETURN restores saved CR7 and PC

## CALL / RETURN

CALL performs (single NS entry with clistCount):
1. Validate E permission on target Inform GT
2. mLoad resolves GT → validates version, seal, E-perm
3. Parse word1 → extract clistCount and limit
4. If clistCount > 0 (abstraction lump):
   - clistStart = (limit + 1) - clistCount
   - CR7 (code): location = base, limit = clistStart - 1, perms = **X-only** (hardcoded)
   - CR6 (c-list): location = base + clistStart, limit = clistCount - 1, perms = **L-only** (hardcoded)
5. Save caller's CR6, CR7, PC to call stack
6. Clear B-bit on preserved CRs
7. Set PC = 0

CR7 and CR6 permissions are architectural invariants — X-only for code, L-only for c-list. The E-GT grants Enter permission to reach the abstraction; CALL enforces the internal domain split. This resolves R001.

RETURN restores:
1. Pop saved CR6, CR7, PC from call stack
2. Resume at saved PC

## LAMBDA

Lightweight in-scope code application:
1. Validate X permission on target GT
2. Save current PC as lambda return point
3. Execute target code in current scope (no c-list switch)
4. Machine-status fast path: if target code is a single instruction, execute inline

## Garbage Collection (PP250)

Deterministic four-phase garbage collection:

1. **Scan** — Walk namespace entries, mark reachable via G-bit
2. **Identify** — Find unreachable entries (G-bit not set)
3. **Clear** — Reclaim unreachable entries
4. **Flip** — Toggle GC polarity for next cycle

PP250 excludes HALT — the machine always returns to boot sequence. Namespace and memory persist across reboots (warm reboot).

## Revocation

Revocation is instant, global, and unforgeable:

1. Increment the version on the namespace entry
2. Every outstanding GT referencing that entry now has a version mismatch
3. Next mLoad check FAULTs — no need to find or track copies
4. Re-grant by creating a new GT with the new version

## Network Transparency

Outform GTs (type=10) with F-bit=1 represent remote resources:

- Access triggers tunnel protocol (HTTPS/RPC)
- Same GT format, same permission model
- mLoad detects F-bit and routes to Tunnel abstraction
- Transparent to application code

## Navana as Master Controller

Navana (NS[5]) is the sole namespace entry writer. All NS table modifications go through Navana:

- **Navana.Add**: Find free NS slot, write 3-word entry with clistCount, return nsIndex + version
- **Navana.Remove**: Revoke GT (increment version), free NS slot
- **Navana.Abstraction.Add**: Process upload.json, allocate lump (power-of-2), write code + c-list, create NS entry, forge E-GT
- **Navana.Abstraction.Update**: Re-carve lump or migrate to larger allocation
- **Navana.Abstraction.Remove**: Revoke GT, free lump, clear NS slot

The one exception: boot writes Navana's own NS entry via mElevation (raw write). After boot, mElevation is dropped and Navana controls all subsequent writes. Mint.Create delegates NS entry creation to Navana.Add.

### Upload Format

```json
{
  "abstraction": "Name",
  "type": "abstraction",
  "grants": ["E"],
  "capabilities": [{ "target": 7, "name": "Memory", "grants": ["E"] }],
  "methods": [{ "name": "Method", "code": [0x12345678] }]
}
```

Navana.Abstraction.Add validates: codeSize + clistCount <= allocSize, each capability target exists and creator holds sufficient permissions, clistCount <= 511, allocSize is power-of-2.

## CLOOMC++ Compiler

Multi-language compiler targeting Church Machine 20-instruction set:

- **JavaScript front-end** (Phase 1): JS subset → 32-bit code words
- **Haskell front-end** (Phase 1b, planned): Lambda calculus → Church Machine instructions

### Resident Object Model

The c-list is the compiler's symbol table for external references. The Resident Object Model maps abstraction names to c-list offsets so that `call(Memory.Allocate(size))` compiles to the correct LOAD offset + CALL sequence. Offsets are generated directly from the upload's capabilities array — the compiler never guesses.

### Calling Convention

| Registers | Purpose | Saved by |
|-----------|---------|----------|
| DR0-DR3 | Arguments / return values | Caller |
| DR4-DR11 | Local variables | Callee |
| DR12-DR15 | Temporaries (compiler scratch) | Caller |

### Language Mapping

JavaScript constructs map to Church Machine instructions:
- `var x = read(addr)` → DREAD
- `write(addr, val)` → DWRITE
- `x + y` → IADD, `x - y` → ISUB
- `if (x == y)` → MCMP + BRANCH.EQ
- `call(Abstraction.Method(args))` → LOAD from c-list + CALL
- `return(val)` → RETURN
- `x << n` → SHL, `x >> n` → SHR
- `bitfield(x, pos, width)` → BFEXT / BFINS
