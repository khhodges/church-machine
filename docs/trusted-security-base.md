# Trusted Security Base

## What Is the Trusted Security Base?

The Trusted Security Base (TSB) is the minimal set of logic that **every** capability operation must pass through. In a conventional system, the "trusted computing base" includes an operating system kernel, a hypervisor, privileged CPU modes, and memory management units -- millions of lines of code that attackers can exploit. The Church Machine architecture eliminates all of that. The entire TSB is a single module: **mLoad**.

**mLoad is the sole trusted path for writing to capability registers.**

This document describes the Church Machine's TSB design.

---

## Part 1: Church Machine Trusted Security Base

### Golden Token Layout (32-bit)

```
31      25 24  23 22      16 15           0
┌─────────┬──────┬──────────┬─────────────┐
│B R W X  │ typ  │  gt_seq  │  object_id  │
│ L S E   │ [2]  │   [7]    │    [16]     │
│  [7]    │      │          │             │
└─────────┴──────┴──────────┴─────────────┘
```

| Bits    | Field        | Description |
|---------|-------------|-------------|
| [15:0]  | `object_id`  | Namespace slot index (0–65,535) |
| [22:16] | `gt_seq`     | Revocation counter — must match NS Entry Word 1 `gt_seq` |
| [24:23] | `typ`        | GT class: 00=NULL, 01=Real, 10=Abstract, 11=Outform |
| [30:25] | permissions  | R(25) W(26) X(27) L(28) S(29) E(30) |
| [31]    | `B`          | Bind flag — stored in GT bit [31] |

Each capability register is 128 bits wide (4 x 32-bit words):

| Word  | Content |
|-------|---------|
| word0 | The 32-bit Golden Token |
| word1 | Lump base address (NS Entry Word 0) |
| word2 | NS Entry Word 1: `spare[31:28] \| gt_seq[27:21] \| limit_offset[20:0]` |
| word3 | NS Entry Word 2: `spare[31:17] \| g_bit[16] \| CRC-16[15:0]` |

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

### What Is NOT in the GT Permission Bits

| Item | Where It Lives | Notes |
|------|---------------|-------|
| M (Machine/Microcode) | Transient signal during mLoad (`sub_m_elevated`) | Prevents privilege escalation — no user code can set or observe it |
| G (Garbage) | NS Entry Word 2 bit [16] (`g_bit`) | Cleared on every ChurchNSGate access to prove liveness for GC |

Note: **B (Bind) IS stored in GT Word 0 bit [31]** (`b_flag` in GT_LAYOUT). It is not a namespace metadata field separate from the GT — it travels with the GT.

### mLoad Validation Pipeline (Church Machine)

Five Church instructions write Golden Tokens into capability registers: LOAD, CALL, RETURN, CHANGE, and SWITCH. Every one of them routes through mLoad. SAVE writes to the namespace (not CRs). LAMBDA reads an existing GT and jumps (no CR write).

The mLoad + ChurchNSGate validation sequence:

```
mLoad(source_capability, required_permission, index, destCR):

  1. Permission Check
     Does the source capability have L or M permission?
     Failure → FAULT

  2. Bounds Check
     Is the index within the C-List range?
     Failure → FAULT

  3. Fetch Golden Token
     Read the GT from the C-List at the given index.

  4. gt_seq Match (ChurchNSGate — CHECK_VERSION)
     Does GT gt_seq [22:16] match NS Entry Word 1 gt_seq [27:21]?
     Failure → FAULT VERSION (stale token — entry was revoked or GC'd)

  5. CRC-16/CCITT Integrity (ChurchNSGate — CHECK_VERSION)
     Recompute CRC-16/CCITT (poly=0x1021, init=0xFFFF) over:
       gt_word0[24:0] + NS Entry Word 0 + NS Entry Word 1  [89 bits]
     Compare against NS Entry Word 2 bits [15:0] (crc field).
     Failure → FAULT SEAL (tampered NS entry)

  6. G-bit Reset (ChurchNSGate — CHECK_VERSION)
     Clear G=0 on the accessed namespace entry (NS Entry Word 2 bit [16]).
     (GC integration: proves this entry is reachable)

  7. Write to Destination CR (mLoad — COMPLETE)
     Write the full 128-bit capability (GT + NS Entry data)
     to the destination register. This is the SOLE path for all CR writes.

  8. Thread Table Shadow Update (mLoad — UPDATE_THREAD)
     Write the GT word to the thread table shadow.
     Keeps the thread table continuously current.
```

Any failure at any step triggers an immediate FAULT. There is no partial write, no speculative execution past a fault, no recovery path.

### gt_seq-Based Garbage Collection (Church Machine)

Church Machine uses a 7-bit `gt_seq` field (128 revocation generations) for deterministic GC:

1. **Mark**: Set G=1 on all non-empty namespace entries (NS Entry Word 2 `g_bit`)
2. **Scan**: Walk reachability tree from all live roots (CRs, call stack, thread table), clearing G=0 on reachable entries (via ChurchNSGate on every LOAD/CALL)
3. **Sweep**: Entries still marked G=1 are unreachable — increment their `gt_seq` in NS Entry Word 1, invalidating all outstanding GTs that reference the old `gt_seq`

When a stale GT is later used, ChurchNSGate detects the `gt_seq` mismatch and faults. This prevents use-after-free without any runtime overhead on the fast path.

### Security Invariants (Church Machine)

1. **No CR Write Without mLoad**: Every capability register write passes through mLoad's validation pipeline. There is no alternative path.
2. **No Privilege Escalation**: M is a transient signal during microcode execution. No user instruction can set, test, or observe it.
3. **No NULL Dereference**: mLoad checks GT type before validation. NULL GTs immediately fault.
4. **No Out-of-Bounds Access**: Every C-List access is bounds-checked. Every namespace offset is validated.
5. **No Domain Mixing**: TPERM enforces domain purity -- Turing (RWX) xor Church (LSE), never both.
6. **No Stale Access**: gt_seq mismatch detection catches revoked/GC'd entries. 7-bit gt_seq gives 128 revocation generations.
7. **No Tampered Entries**: CRC-16/CCITT integrity check on every ChurchNSGate access.
8. **Failsafe Fault Handling**: All failures route to a single FAULT handler.

---

## Part 2: Church Machine Hardware (Amaranth HDL) Trusted Security Base

The Church Machine hardware implementation realises the same GT format in synthesizable Amaranth HDL.

### Golden Token Layout (32-bit, `GT_LAYOUT` in `hardware/layouts.py`)

```
31      25 24  23 22      16 15           0
┌─────────┬──────┬──────────┬─────────────┐
│B R W X  │ typ  │  gt_seq  │  object_id  │
│ L S E   │ [2]  │   [7]    │    [16]     │
│  [7]    │      │          │             │
└─────────┴──────┴──────────┴─────────────┘
```

Same 6 permission bits (R, W, X, L, S, E). Same domain purity rule. Same 32-bit width as the golden format:

| Aspect | Simulator (pre-hardware) | Hardware (HDL) |
|--------|--------------------------|----------------|
| GT width | 32-bit | 32-bit |
| Namespace slot | 17-bit Index (131K entries) — simulator-era | 16-bit `object_id` (65,536 entries) |
| GC mechanism | G-bit + version field | G-bit in NS Entry Word 2 + `gt_seq` revocation |
| Integrity check | 25-bit FNV seal — simulator-era | CRC-16/CCITT over 89-bit input |
| CR width | 128-bit (4 x 32-bit words) | 128-bit (4 x 32-bit words) |
| Implementation | Software simulator | Synthesizable Amaranth HDL |

### mLoad FSM (Amaranth HDL -- 218 lines, 14 states)

The hardware mLoad is a 14-state finite state machine implementing the same validation pipeline in synthesizable hardware:

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

The entire Church Machine trusted security base is approximately **329 lines** of synthesizable Amaranth HDL (at time of writing):
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
3. **B flag in GT bit [31]** (`b_flag`) — bind policy travels with the token
4. **Domain purity** -- Turing xor Church, never both
5. **M is transient** -- microcode elevation only, never stored
6. **Single FAULT handler** -- all validation failures, no partial writes
7. **GC integration** -- every NS access clears g_bit (G=0 = reachable)
8. **gt_seq-based stale detection** -- prevents use-after-free

### Where They Differ

| Aspect | Simulator (pre-hardware) | Hardware (HDL) |
|--------|--------------------------|----------------|
| TSB implementation | Software (JavaScript mLoad function) | Amaranth HDL FSM (ChurchMLoad + ChurchNSGate) |
| GC stale detection | G-bit in NS entry + version field in GT (7-bit, 128 generations) | G-bit in NS Entry Word 2 + `gt_seq` revocation counter |
| Integrity validation | 25-bit FNV-1a seal (simulator-era) | CRC-16/CCITT over 89-bit input |
| Namespace capacity | Up to 131K entries (17-bit Index) | Up to 65,536 entries (16-bit `object_id`) |
| ISA | RISC-V RV32I + custom opcodes | Custom ARM-style encoding |
| Target | Software simulation | Synthesizable for FPGA/ASIC |

### The Core Guarantee

In both implementations, the security guarantee is identical:

**No instruction, no microcode sequence, no hardware path can write a Golden Token into a capability register without passing through mLoad's complete validation pipeline. If mLoad rejects an operation, it faults. Period.**

This is the architecture that Kenneth James Hamer-Hodges designed: not "security bolted on", but **security built in** -- at the only gate that matters.
