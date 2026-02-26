# Trusted Security Base

## What Is the Trusted Security Base?

The Trusted Security Base (TSB) is the minimal set of logic that **every** capability operation must pass through. In a conventional system, the "trusted computing base" includes an operating system kernel, a hypervisor, privileged CPU modes, and memory management units -- millions of lines of code that attackers can exploit. The CTMM architecture eliminates all of that. The entire TSB is a single module: **mLoad**.

**mLoad is the sole trusted path for writing to capability registers.**

This document describes the TSB for both implementations, focused on the Sim-32 (RV32-Cap) design. The Sim-64 (Amaranth HDL) implementation follows the same architectural principles with a wider GT format.

---

## Part 1: Sim-32 (RV32-Cap) Trusted Security Base

### Golden Token Layout (32-bit)

```
[31:25] Version     (7 bits)   -- GC invalidation (128 generations)
[24:8]  Index       (17 bits)  -- Namespace entry index (0-131,071)
[7:2]   Permissions (6 bits)   -- E, S, L, X, W, R
[1:0]   Type        (2 bits)   -- Inform/Outform/NULL/Abstract
```

Each capability register is 128 bits wide (4 x 32-bit words):

| Word | Content |
|------|---------|
| word0 | The 32-bit Golden Token |
| word1 | Location (physical address from namespace entry) |
| word2 | Limit (bounds from namespace entry) |
| word3 | VersionSeals: Version(7) + FNV Seal(25) |

### Permission Bits -- Only Six, Mutually Exclusive

The GT stores exactly 6 permission bits. These are access rights, not metadata:

| Bit | Name | Domain | Description |
|-----|------|--------|-------------|
| 0 | R | Turing | Read data |
| 1 | W | Turing | Write data |
| 2 | X | Turing | Execute code |
| 3 | L | Church | Load capability from C-List |
| 4 | S | Church | Save capability to namespace |
| 5 | E | Church | Enter abstraction |

**Domain Purity Rule**: Turing (R, W, X) xor Church (L, S, E). A GT may carry permissions from one domain or the other, never both. Enforced in hardware at TPERM time.

### What Is NOT in the GT

| Item | Where It Lives | Why Not in GT |
|------|---------------|---------------|
| M (Machine/Microcode) | Transient signal during mLoad | Prevents privilege escalation -- no user code can set or observe it |
| B (Bind) | Namespace entry metadata | Policy about whether a capability can be copied -- property of the slot, not the token |
| F (Far/Foreign) | Namespace entry metadata | Whether the resource is remote -- property of where it lives, not what you can do with it |
| G (Garbage) | Implicit in version mechanism | Sim-32 uses version bump for GC, not a G-bit flag |

### mLoad Validation Pipeline (Sim-32)

Five Church instructions write Golden Tokens into capability registers: LOAD, CALL, RETURN, CHANGE, and SWITCH. Every one of them routes through mLoad. SAVE writes to the namespace (not CRs). LAMBDA reads an existing GT and jumps (no CR write).

The mLoad validation sequence in Sim-32 (`simulator.js`):

```
mLoad(source_capability, required_permission, index, destCR):

  1. Permission Check
     Does the source capability have L or M permission?
     Failure → FAULT

  2. Bounds Check
     Is the index within the namespace table?
     Failure → FAULT

  3. Fetch Golden Token
     Read the GT from the C-List at the given index.

  4. Version Match
     Does the GT's version (bits [31:25]) match the
     namespace entry's version (VersionSeals bits [31:25])?
     Failure → FAULT (stale token -- entry was GC'd and recycled)

  5. MAC/Seal Validation
     Recompute 25-bit FNV seal from Location + Limit.
     Does it match the stored seal (VersionSeals bits [24:0])?
     Failure → FAULT (tampered namespace entry)

  6. G-bit Reset
     Clear G=0 on the accessed namespace entry.
     (GC integration: proves this entry is reachable)

  7. Write to Destination CR
     Write the full 128-bit capability (GT + Location + Limit + VersionSeals)
     to the destination register. This is the SOLE path for all CR writes.

  8. Thread Table Shadow Update
     Write the CR to Thread[CRd] in the thread table.
     Keeps the thread table continuously current.
```

Any failure at any step triggers an immediate FAULT. There is no partial write, no speculative execution past a fault, no recovery path.

### Version-Based Garbage Collection (Sim-32)

Sim-32 uses a 7-bit version field (128 generations) for deterministic GC:

1. **Mark**: Set G=1 on all non-empty namespace entries
2. **Scan**: Walk reachability tree from all live roots (CRs, call stack, thread table), clearing G=0 on reachable entries
3. **Sweep**: Entries still marked G=1 are unreachable -- increment their version, invalidating all outstanding GTs that reference the old version

When a stale GT is later used, mLoad detects the version mismatch and faults. This prevents use-after-free without any runtime overhead on the fast path.

### Security Invariants (Sim-32)

1. **No CR Write Without mLoad**: Every capability register write passes through mLoad's validation pipeline. There is no alternative path.
2. **No Privilege Escalation**: M is a transient signal during microcode execution. No user instruction can set, test, or observe it.
3. **No NULL Dereference**: mLoad checks GT type before validation. NULL GTs immediately fault.
4. **No Out-of-Bounds Access**: Every C-List access is bounds-checked. Every namespace offset is validated.
5. **No Domain Mixing**: TPERM enforces domain purity -- Turing (RWX) xor Church (LSE), never both.
6. **No Stale Access**: Version mismatch detection catches GC'd entries. 7-bit version gives 128 generations.
7. **No Tampered Entries**: 25-bit FNV seal integrity check on every mLoad access.
8. **Failsafe Fault Handling**: All failures route to a single FAULT handler.

---

## Part 2: Sim-64 (Amaranth HDL) Trusted Security Base

The Sim-64 hardware implementation follows the same architectural principles with a 64-bit GT and synthesizable HDL. The Sim-64 design will be finalised independently -- each simulator swims in its own private space.

### Golden Token Layout (64-bit)

```
 63    58 57 56 55 54       32 31                    0
 ┌──────┬──┬─────┬───────────┬────────────────────────┐
 │perms │G │type │   spare   │        offset          │
 │(6)   │  │(2)  │   (23)    │        (32)            │
 └──────┴──┴─────┴───────────┴────────────────────────┘
```

Same 6 permission bits (R, W, X, L, S, E). Same domain purity rule. Key differences from Sim-32:

| Aspect | Sim-32 | Sim-64 |
|--------|--------|--------|
| GT width | 32-bit | 64-bit |
| Namespace index | 17-bit Index (131K entries) | 32-bit Offset |
| GC mechanism | 7-bit version bump on sweep | G-bit cleared on access, spare field as version |
| Integrity check | 25-bit FNV seal | Hardware MAC hash |
| CR width | 128-bit (4 x 32-bit words) | 256-bit (4 x 64-bit words) |
| Implementation | Software simulator (JavaScript) | Synthesizable Amaranth HDL |

### mLoad FSM (Amaranth HDL -- 218 lines, 14 states)

The Sim-64 mLoad is a 14-state finite state machine implementing the same validation pipeline as Sim-32, but in synthesizable hardware:

```
IDLE → FETCH_SRC → CHECK_L → CHECK_BOUNDS → FETCH_W0
     → CHECK_NS → FETCH_W1 → FETCH_W2 → FETCH_W3
     → CHECK_MAC → RESET_G → UPDATE_THREAD → COMPLETE
     Any failure → FAULT
```

The `cr_wr_en` signal that gates capability register writes exists **only** in mLoad's COMPLETE state. No other module in the entire design can assert it for capability operations.

Five Church instruction modules instantiate their own private mLoad submodule and wire `sub_m_elevated = 1` for transient M elevation:

| Module | Instruction | Notes |
|--------|-------------|-------|
| `load.py` | CAP.LOAD | C-List fetch mode |
| `call.py` | CALL | C-List fetch mode, destination CR6 |
| `ret.py` | RETURN | Direct GT mode (`sub_direct=1`), revalidates saved GTs |
| `change.py` | CHANGE | Thread context switch |
| `switch.py` | SWITCH | System register write (CR8-CR15) |

### Permission Check Module (Amaranth HDL -- 111 lines)

The `perm_check.py` module provides combinational validation logic alongside mLoad:

- NULL GT detection
- Per-bit permission fault reporting (R, W, X, L, S, E)
- Domain purity enforcement: `has_turing & has_church` → `DOMAIN_PURITY` fault
- Bounds checking
- MAC validation
- Fault priority chain: NULL_CAP → PERM → BOUNDS → MAC → DOMAIN_PURITY

### Total TSB Size

The entire Sim-64 trusted security base is **329 lines** of synthesizable Amaranth HDL:
- mLoad: 218 lines
- perm_check: 111 lines

Compare this to:
- Linux kernel: ~30 million lines
- Windows kernel: ~50 million lines
- seL4 (formally verified): ~10,000 lines

Two orders of magnitude smaller than seL4. Five orders of magnitude smaller than Linux. Every line synthesises to hardware gates. The security guarantees are enforced by physics, not by promises.

---

## Part 3: Architectural Comparison

### What Both Implementations Share

1. **mLoad is the sole trusted path** for all CR writes
2. **6 permission bits** (R, W, X, L, S, E) stored in the GT
3. **Domain purity** -- Turing xor Church, never both
4. **M is transient** -- microcode elevation only, never stored
5. **B and F are namespace metadata** -- not GT permission bits
6. **Single FAULT handler** -- all validation failures, no partial writes
7. **GC integration** -- every mLoad access contributes to liveness tracking
8. **Version-based stale detection** -- prevents use-after-free

### Where They Differ

| Aspect | Sim-32 | Sim-64 |
|--------|--------|--------|
| TSB implementation | Software (JavaScript mLoad function) | Hardware (Amaranth HDL FSM) |
| GC stale detection | Version field in GT (7-bit, 128 generations) | G-bit in GT + spare field as version |
| Integrity validation | 25-bit FNV seal | Hardware MAC |
| Namespace capacity | 131K entries (17-bit index) | 4B entries (32-bit offset) |
| ISA | RISC-V RV32I + custom opcodes | Custom ARM-style encoding |
| Target | Software simulation, future FPGA | Synthesizable for FPGA/ASIC |

### The Core Guarantee

In both implementations, the security guarantee is identical:

**No instruction, no microcode sequence, no hardware path can write a Golden Token into a capability register without passing through mLoad's complete validation pipeline. If mLoad rejects an operation, it faults. Period.**

This is the architecture that Kenneth James Hamer-Hodges designed: not "security bolted on", but **security built in** -- at the only gate that matters.
