# Memory Manager Design

**v2.0 — 2026-04-30**
**CONFIDENTIAL**

## Domain-Separated Allocation, Passkey Billing, and a Self-Organising Namespace

**Status: DRAFT — design questions resolved; ready for implementation approval**
**Author: design session 2026-04-29 / 2026-04-30**
**Depends on: `docs/golden-tokens.md`, `docs/abstractions.md`, `docs/Lump-Architecture.md`**

---

## 1. Motivation

The Church Machine is a capability computer. Every object a program can touch — a memory
region, a callable service, a hardware device, a connection to a machine on the far side
of the planet — is represented by a single 32-bit Golden Token. The hardware enforces
the token's permission bits on every instruction that uses it. There is no other access
control mechanism. There is no privileged mode. There is no kernel call gate. There are
only tokens.

This purity is the machine's greatest strength. It is also a standard that the current
memory implementation fails to meet.

| Problem | Consequence |
|---|---|
| `Memory.Allocate` returns a raw address, not a GT | The caller can construct arbitrary memory references — no capability discipline |
| No power-of-2 quantisation | Lump sizes are arbitrary; the hardware bounds model is not enforced at allocation time |
| No domain separation | A code region and a capability-list region are indistinguishable at the GT level — the hardware cannot enforce their different use rules |
| `Mint.Create` ignores the `perms` argument | GT permission bits are never encoded; every issued GT is identical and meaningless (see [Mint spec](./mint.md) for the corrected specification) |
| No identity or quota on memory requests | Any caller with an E-GT to Memory can exhaust physical RAM without limit or attribution |

This document specifies a replacement that closes all five gaps. It consists of four
cooperating abstractions — `PhysicalPool`, `TuringMemory`, `ChurchMemory`, and `Billing`
— unified by a thin orchestration layer `LumpFactory`. Together they complete the
capability model for memory, making the hardware's promise hold all the way down to the
allocator.

Beyond fixing these five bugs, this document also records the discovered architecture of
the Namespace itself: how slots are assigned, how lumps arrive and depart, how threads
claim cores, and how Tunnels extend a namespace across any number of cooperating machines
anywhere on earth. That architecture — described in §9 — requires no new code. It is
already how the system behaves. This document names it.

---

## 2. Reference: GT Word Bit Layout

Every GT is a single 32-bit word. The hardware checks specific bits on every instruction
that uses it. No instruction reveals the physical address behind the token. The
[Mint spec](./mint.md) is the specification for how this word is assembled at issuance time.

```
Bit  31   30   29   28   27   26   25   24─23   22────16   15────────0
     ┌────┬────┬────┬────┬────┬────┬────┬──────┬──────────┬───────────┐
     │ B  │ E  │ S  │ L  │ X  │ W  │ R  │ type │  gt_seq  │  slot_id  │
     └────┴────┴────┴────┴────┴────┴────┴──────┴──────────┴───────────┘
      [31]  [30] [29] [28] [27] [26] [25] [24:23]  [22:16]    [15:0]
```

Seven permission bits occupy [31:25] as a unit. B is the highest; R is the lowest.

| Field | Bits | Width | Meaning |
|---|---|---|---|
| `slot_id` | [15:0] | 16 | Index into the Namespace table (hardware looks up base + limit) |
| `gt_seq` | [22:16] | 7 | Revocation freshness counter; must match NS Entry Word 2 `gt_seq` |
| `type` | [24:23] | 2 | `00`=NULL `01`=Inform `10`=Outform `11`=Abstract |
| `R` | [25] | 1 | Read permission (Turing domain) |
| `W` | [26] | 1 | Write permission (Turing domain) |
| `X` | [27] | 1 | Execute permission (Turing domain) |
| `L` | [28] | 1 | Load capability (Church domain) |
| `S` | [29] | 1 | Save capability (Church domain) |
| `E` | [30] | 1 | Enter (call) permission (Church domain) |
| `B` | [31] | 1 | Bind flag — 1 = GT may be propagated via `mSave` to another c-list |

### 2.1 Permission rules

```
Turing domain:  R (bit 25)   W (bit 26)   X (bit 27)
Church domain:  L (bit 28)   S (bit 29)   E (bit 30)
```

**Domain purity**: A GT may carry Turing bits OR Church bits, never both. Mixed bits
raise `DOMAIN_PURITY` at mint time.

**E isolation**: Within the Church domain, E must be standalone. `LE`, `SE`, and `LSE`
are all invalid. An Enter token is the key to call an abstraction; Load/Save tokens are
the keys to the capability list inside it. They must never be the same key.

```
Valid Turing:   R  W  X  RW  RX  WX  RWX
Valid Church:   L  S  E  LS          (E alone only)
Invalid:        RL WL XE RE LSE LE SE   (any cross-domain or E+L/S combination)
```

**Instruction–bit mapping** (the only bits the hardware checks per instruction):

| Instruction | Bit checked | Fault if 0 |
|---|---|---|
| `DREAD  DR, GT, offset` | R (25) | `DATA_PERM` |
| `DWRITE GT, offset, DR` | W (26) | `DATA_PERM` |
| execute via CR14 | X (27) | `EXEC_PERM` |
| `mLoad  CR, GT, offset` | L (28) | `CAP_LOAD` |
| `mSave  CR, GT, offset` | S (29) | `CAP_SAVE` |
| `CALL   GT` | E (30) | `ENTER_PERM` |
| `mSave  CR, dest, GT` (propagate GT itself) | B (31) | `BIND` |

### 2.2 Abstract GT word layout

The Abstract type (`type=11`) treats the GT word itself as the value — no NS lookup,
no lump, nothing callable. Used for hardware device handles and for the Passkey P-GT.

```
Bit  31──27   26  25   24─23   22────16   15──────0
     ┌────────┬───┬───┬──────┬──────────┬──────────┐
     │ab_type │ R │ W │  11  │  gt_seq  │  ab_data │
     │ 5 bits │   │   │(Abs) │  7 bits  │  16 bits │
     └────────┴───┴───┴──────┴──────────┴──────────┘
```

`ab_type` values currently allocated:

| Value | Constant | Use |
|---|---|---|
| `0x00` | `AB_TYPE_IO` | Hardware device handle (LED, UART, Button, Timer, Display) |
| `0x01` | `AB_TYPE_M_ELEVATION` | M-bit authority token — sets CRn(M=1) |
| `0x02` | `AB_TYPE_PGT` | Billing Passkey — see §6 |

---

## 3. Layer 0 — `PhysicalPool`

The existing `Memory` abstraction is refactored into a low-level page dispenser. It has
no opinion about domain, permissions, or GTs. It is **kernel-internal only** — no
user-visible E-GT is ever issued for PhysicalPool. Only `TuringMemory` and
`ChurchMemory` hold a capability to it.

### 3.1 Size quantisation

All lumps must be exactly 2ⁿ words, where 6 ≤ n ≤ 14 (64 words through 16 384 words).
This matches the hardware `n-6` field in the lump header described in
`docs/Lump-Architecture.md` and the ZIP-derivation rule in `docs/abstractions.md §ZIP → Header Word`.

The thread lump sizes established in `simulator/app-memory.js` —
`THREAD_FS = 256 words` (full stack), `THREAD_HS = 64 words` (half stack),
`THREAD_SS = 32 words` (slim stack) — all satisfy the 2ⁿ constraint (n = 8, 6, 5
respectively) and serve as concrete quota inputs when TuringMemory.Allocate is called
for thread lumps at boot.

```
Claim(requestedWords):
    exp = 6
    while (1 << exp) < requestedWords:
        exp = exp + 1
    if exp > 14:
        fault LUMP_TOO_LARGE
    quantisedWords = 1 << exp

    base    = read(freePointer)
    newFree = base + quantisedWords
    write(freePointer, newFree)
    return (base, quantisedWords, exp)
```

Quantisation happens **before** the Billing charge (§6), so the charge is always the
real committed size — a caller cannot request 63 words to get 64 words for the price
of 63.

### 3.2 Methods

| Method | Parameters | Returns | Notes |
|---|---|---|---|
| `Claim(requestedWords)` | words ≥ 1 | `(base, quantisedWords, exp)` | Quantises then commits |
| `Release(base)` | physical base | `0` | Returns block to free pool |

---

## 4. Layer 1a — `TuringMemory`

Issues **only Turing-domain GTs**. A caller holding an E-GT to TuringMemory
can never receive an L-, S-, or E-permissioned region regardless of what they request.
The encoding is structural — `Mint.Encode` is called with Turing bits only.

### 4.1 GT patterns issued

| Method | B | E | S | L | X | W | R | type | Meaning |
|---|---|---|---|---|---|---|---|---|---|
| `Allocate` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | Inform | General read/write data region |
| `AllocCode` | 0 | 0 | 0 | 0 | 1 | 0 | 1 | Inform | Read + execute; no write after load |

`AllocCode` withholds W deliberately: code is immutable once installed. The hardware
will allow the instruction pointer to enter the region (X) and allow a debugger to read
it (R), but writing new instructions into a live code region is structurally prevented.

### 4.2 Methods

```
abstraction TuringMemory {
    capabilities {
        PhysicalPool        // c-list[0]: E-GT — raw allocator
        Mint                // c-list[1]: E-GT — GT encoder
        Navana              // c-list[2]: E-GT — NS table writer
        Billing             // c-list[3]: E-GT — quota enforcer
    }

    public method Allocate(requestedWords, pgt):
        (exp, quantised) = PhysicalPool.quantiseOnly(requestedWords)
        Billing.Charge(pgt, quantised)          // faults QUOTA_EXCEEDED if over budget
        (base, size, exp) = PhysicalPool.Claim(requestedWords)
        gt = Mint.Encode(base, exp, perms=RW, bindable=0, far=0)
        nsSlot = Navana.Add(base, size)
        gt[15:0] = nsSlot
        return gt

    public method AllocCode(requestedWords, pgt):
        (exp, quantised) = PhysicalPool.quantiseOnly(requestedWords)
        Billing.Charge(pgt, quantised)
        (base, size, exp) = PhysicalPool.Claim(requestedWords)
        gt = Mint.Encode(base, exp, perms=RX, bindable=0, far=0)
        nsSlot = Navana.Add(base, size)
        gt[15:0] = nsSlot
        return gt

    public method Free(gt, pgt):
        nsSlot = gt[15:0]
        (base, size) = Navana.Remove(nsSlot)
        PhysicalPool.Release(base)
        Billing.TopUp(pgt, size)
        return 0
}
```

---

## 5. Layer 1b — `ChurchMemory`

Issues **only Church-domain GTs**. A caller holding an E-GT to ChurchMemory
can never receive an R-, W-, or X-permissioned region.

The E isolation rule (§2.1) means E-GTs are issued only by `AllocAbstract`, which
does not allocate a new physical region — it wraps an existing NS entry in an
Enter-capable handle. L and S are never combined with E.

### 5.1 GT patterns issued

| Method | B | E | S | L | X | W | R | type | Meaning |
|---|---|---|---|---|---|---|---|---|---|
| `Allocate` | 1 | 0 | 1 | 1 | 0 | 0 | 0 | Inform | Read/write capability list region |
| `AllocCList` | 1 | 0 | 0 | 1 | 0 | 0 | 0 | Inform | Read-only sealed c-list |
| `AllocAbstract` | 1 | 1 | 0 | 0 | 0 | 0 | 0 | Inform | Enter-only handle (E standalone) |

B=1 is the default for Church GTs because capabilities are designed to propagate: you
obtain a service reference and pass it to collaborators via `mSave`.

`AllocCList` withholds S: the capability list was written at construction time and is
sealed. The caller can inspect it (L) but cannot install new capabilities into it.

`AllocAbstract` issues a standalone E-GT for an existing NS entry. No new physical
memory is claimed — it wraps an already-installed lump. This is how user code obtains a
callable reference to a resident service.

### 5.2 Methods

```
abstraction ChurchMemory {
    capabilities {
        PhysicalPool        // c-list[0]
        Mint                // c-list[1]
        Navana              // c-list[2]
        Billing             // c-list[3]
    }

    public method Allocate(requestedWords, pgt):
        (exp, quantised) = PhysicalPool.quantiseOnly(requestedWords)
        Billing.Charge(pgt, quantised)
        (base, size, exp) = PhysicalPool.Claim(requestedWords)
        gt = Mint.Encode(base, exp, perms=LS, bindable=1, far=0)
        nsSlot = Navana.Add(base, size)
        gt[15:0] = nsSlot
        return gt

    public method AllocCList(requestedWords, pgt):
        (exp, quantised) = PhysicalPool.quantiseOnly(requestedWords)
        Billing.Charge(pgt, quantised)
        (base, size, exp) = PhysicalPool.Claim(requestedWords)
        gt = Mint.Encode(base, exp, perms=L, bindable=1, far=0)
        nsSlot = Navana.Add(base, size)
        gt[15:0] = nsSlot
        return gt

    public method AllocAbstract(existingNsSlot):
        // No physical allocation — wraps an already-installed NS entry.
        // No Billing charge — memory was charged at AllocCode/Allocate time.
        gt = Mint.Encode(nsBase=0, exp=0, perms=E, bindable=1, far=0)
        gt[15:0] = existingNsSlot
        return gt

    public method Free(gt, pgt):
        nsSlot = gt[15:0]
        (base, size) = Navana.Remove(nsSlot)
        PhysicalPool.Release(base)
        Billing.TopUp(pgt, size)
        return 0
}
```

---

## 6. Layer 2 — `Billing` and the Passkey P-GT

### 6.1 What the P-GT is

The Passkey Golden Token (P-GT) is an **Abstract-type GT** that acts as an unforgeable
identity credential and quota key. It is passive: it cannot be `CALL`ed, `mLoad`ed
from, or `DREAD`ed. The hardware enforces this because the Abstract type performs no
NS lookup and the R/W bits are both zero. The caller can only hold it in a register and
pass it as a parameter to memory APIs.

### 6.2 P-GT word layout

```
Bit  31──27        26  25   24─23   22────16   15──────────0
     ┌────────────┬───┬───┬──────┬──────────┬──────────────┐
     │ 0b00010    │ 0 │ 0 │  11  │  gt_seq  │  account_id  │
     │ (P-GT cls) │ R │ W │(Abs) │ freshness│  (16 bits)   │
     └────────────┴───┴───┴──────┴──────────┴──────────────┘
```

`ab_type = 0b00010` (0x02) is the P-GT class identifier — chosen to avoid collision
with `AB_TYPE_IO` (0x00) and `AB_TYPE_M_ELEVATION` (0x01) which are already in use.
`account_id` is a 16-bit opaque key that Billing uses to look up the quota record.
`gt_seq` is a freshness counter that increments on each reissue, invalidating any copies
of an old P-GT without requiring the caller to return it.

The P-GT word itself costs zero words of physical memory. It is pure state in the
32-bit register — no lump, no NS entry, no allocation.

### 6.3 Quota records (inside Billing, never visible to callers)

Billing maintains a private table of quota records. Callers have no GT to this table.

| Field | Type | Meaning |
|---|---|---|
| `account_id` | 16-bit | Key; matches P-GT `ab_data` field |
| `words_remaining` | 32-bit | Current allocation budget in words |
| `words_used` | 32-bit | Cumulative words ever committed |
| `quota_class` | 4-bit | Controls default limits and B-bit policy |

**Quota classes:**

| Class | Default words | Bindable P-GT | Typical holder |
|---|---|---|---|
| `basic` (0) | 4 096 | No (B=0) | Student, single program |
| `standard` (1) | 65 536 | No (B=0) | Application developer |
| `premium` (2) | 524 288 | Yes (B=1) | Trusted service abstraction |
| `system` (3) | Unlimited | Yes (B=1) | Navana, boot chain only |

The system-class P-GT is issued by Billing during `Navana.Init` before any user code
runs. It is never placed in a user-accessible c-list.

### 6.4 Billing methods

```
abstraction Billing {
    capabilities {
        Mint                // c-list[0]: to build P-GT words
    }

    // Issue — create a new P-GT for an account.
    public method Issue(account_id, initial_words, quota_class):
        write(quotaTable[account_id], initial_words)
        write(classTable[account_id], quota_class)
        pgt = build_abstract_gt(ab_type=0b00010,
                                R=0, W=0,
                                gt_seq=freshSeq(),
                                ab_data=account_id)
        pgt[31] = (quota_class >= premium) ? 1 : 0   // B-bit
        return pgt

    // Charge — validate and atomically decrement quota.
    public method Charge(pgt, requested_words):
        if pgt[24:23] != 0b11        → fault BAD_PGT_TYPE
        if pgt[31:27] != 0b00010     → fault BAD_PGT_CLASS
        account_id = pgt[15:0]
        remaining  = read(quotaTable[account_id])
        if remaining < requested_words → fault QUOTA_EXCEEDED
        write(quotaTable[account_id], remaining - requested_words)
        return 1

    // TopUp — return words to the quota (called by TuringMemory.Free / ChurchMemory.Free).
    public method TopUp(pgt, words):
        account_id = pgt[15:0]
        remaining  = read(quotaTable[account_id])
        write(quotaTable[account_id], remaining + words)
        return remaining + words

    // Revoke — zero the quota; future Charge calls fault QUOTA_EXCEEDED.
    public method Revoke(account_id):
        write(quotaTable[account_id], 0)
        return 0

    // Reissue — bump gt_seq to invalidate existing P-GT copies; return new P-GT.
    public method Reissue(account_id):
        pgt = build_abstract_gt(ab_type=0b00010,
                                R=0, W=0,
                                gt_seq=freshSeq(),
                                ab_data=account_id)
        return pgt

    // Balance — read remaining quota.
    public method Balance(pgt):
        account_id = pgt[15:0]
        return read(quotaTable[account_id])
}
```

### 6.5 Why revocation works without recalling the P-GT

The P-GT is an Abstract GT — no NS entry, no hardware `gt_seq` check. Billing validates
the P-GT by inspecting the `ab_type` and `ab_data` fields directly and then consulting
its internal table. When `Revoke(account_id)` zeros the quota, every subsequent
`Billing.Charge(pgt, n)` for any P-GT carrying that `account_id` will fault
`QUOTA_EXCEEDED` regardless of how many copies of the P-GT exist in how many c-lists.

To invalidate copies entirely (not just block usage), `Reissue` bumps the `gt_seq`
field of newly issued P-GTs and Billing records the current valid sequence per account.
Old copies with a stale `gt_seq` are then additionally rejected at `Charge` time.

---

## 7. Layer 3 — `LumpFactory` (unified entry point)

`LumpFactory` is a thin orchestration layer for callers who want a single method rather
than calling TuringMemory and ChurchMemory separately. It enforces domain purity as a
pre-flight check before touching either allocator.

```
abstraction LumpFactory {
    capabilities {
        TuringMemory        // c-list[0]
        ChurchMemory        // c-list[1]
        Billing             // c-list[2]
    }

    public method AllocAndMint(requestedWords, domain, permsBits, bindable, far, pgt):
        turingBits = permsBits & 0b000111
        churchBits = permsBits & 0b111000
        if turingBits != 0 and churchBits != 0 → fault DOMAIN_PURITY

        if domain == 0:
            if permsBits & 0b000100:   // X bit set → code region
                return TuringMemory.AllocCode(requestedWords, pgt)
            else:
                return TuringMemory.Allocate(requestedWords, pgt)
        else:
            eBit  = permsBits & 0b100000
            lsBit = permsBits & 0b011000
            if eBit and lsBit → fault E_ISOLATION
            if eBit:
                return ChurchMemory.AllocAbstract(...)
            elif lsBit == 0b010000:   // L only → sealed c-list
                return ChurchMemory.AllocCList(requestedWords, pgt)
            else:
                return ChurchMemory.Allocate(requestedWords, pgt)

    public method Free(gt, pgt):
        domain = (gt[28] | gt[29] | gt[30]) ? 1 : 0
        if domain == 1:
            return ChurchMemory.Free(gt, pgt)
        else:
            return TuringMemory.Free(gt, pgt)
}
```

---

## 8. How the GT word differs by source

A caller receiving a GT from either allocator sees the domain encoded directly in bits
25–30. This is the only information they have — no physical address is ever visible.

```
Source                   │B │E │S │L │X │W │R │type      │ Hardware use
─────────────────────────┼──┼──┼──┼──┼──┼──┼──┼──────────┼──────────────────────────
TuringMemory.Allocate    │0 │0 │0 │0 │0 │1 │1 │01 Inform │ DREAD + DWRITE
TuringMemory.AllocCode   │0 │0 │0 │0 │1 │0 │1 │01 Inform │ DREAD + execute (CR14)
ChurchMemory.Allocate    │1 │0 │1 │1 │0 │0 │0 │01 Inform │ mLoad + mSave (c-list RW)
ChurchMemory.AllocCList  │1 │0 │0 │1 │0 │0 │0 │01 Inform │ mLoad only (c-list RO)
ChurchMemory.AllocAbst.  │1 │1 │0 │0 │0 │0 │0 │01 Inform │ CALL (enter abstraction)
Billing.Issue (P-GT)     │* │0 │0 │0 │0 │0 │0 │11 Abstr  │ none (passive credential)
```

*P-GT B-bit = 0 for basic/standard, 1 for premium/system.

**Hardware enforcement of the table above:**
- Row 1 (R,W): `DREAD` and `DWRITE` succeed; `CALL` faults (E=0); `mLoad` faults (L=0)
- Row 2 (R,X): `DREAD` succeeds; `DWRITE` faults (W=0 — code immutable); execute succeeds
- Row 3 (L,S): `mLoad` and `mSave` succeed; `DREAD` faults (R=0); `CALL` faults (E=0)
- Row 4 (L): `mLoad` succeeds; `mSave` faults (S=0); c-list is sealed
- Row 5 (E): `CALL` succeeds; `mLoad` faults (L=0); `mSave` faults (S=0)
- Row 6 (P-GT): no instruction succeeds; hardware treats it as a bare value

---

## 9. Namespace Architecture

### 9.1 The Namespace is a sparse, self-organising registry

The Namespace table is a flat indexed array of up to 65 535 entries. Each entry
occupies three words and records the base address, size, and revocation sequence of one
lump. An empty entry costs three zeroed words. The hardware is indifferent to gaps —
a CALL to NS[4] costs exactly the same as a CALL to NS[31].

This sparsity is not a defect. It is the foundation of a self-organising system.

**Current live registry** (from `server/lumps/manifest.json` — the only authoritative
source):

| NS Slot | Abstraction | Notes |
|---|---|---|
| 3 | LED flash | Hardware boot lump |
| 12 | LED | Full LED abstraction (Set, Clear, Toggle, State) |
| 16 | SlideRule | Complete IEEE-754 floating-point library (22 methods) |
| 16 | SlideRule (Haskell) | Hardware-safe floating-point variant (reduced method set) |
| 18 | Constants | π, e, φ, 0, 1 — with user constant pool |
| 19 | Loader | |
| 31 | Tunnel | Remote namespace bridge (see §9.5) |
| — | WordString | Built; slot assigned at first load |

All other slots are empty and available. The new memory abstractions specified in §§3–7
will occupy whichever slots are free when they are implemented and pass tests.

### 9.2 Slot assignment policy: first-come, first-served; lowest free first

**A lump earns its slot number. No slot is pre-allocated to an unbuilt abstraction.**

When a lump is installed, it takes the lowest available slot number above the thread
block (§9.3). This keeps the active population clustered at the bottom of the table.
The high end of the 65 535-slot space may never be reached — on a device that runs
SlideRule and LED all day, the high-water mark stays in the low tens. The NS table's
memory footprint (which lives at the top of physical RAM, `high-water × 3 words`) is
therefore proportional to peak concurrent occupancy, not to the total number of
abstractions ever designed.

### 9.3 Thread slots — the degree of parallelism

Threads are lumps. They occupy NS slots. The first block of NS slots — from 0 to T−1
— is reserved at boot for threads, where T is the **degree of parallelism**: an
IDE-configured setting that determines how many threads this namespace can run
simultaneously. Each thread slot holds a complete thread lump: header, data register
file, capability list, stack, and heap.

```
NS[0]       Thread 0   ┐
NS[1]       Thread 1   │  IDE-configured parallelism degree T
NS[2]       Thread 2   │  These are the "cores" of this namespace
…                      │
NS[T−1]     Thread T−1 ┘
NS[T]       ← first free slot for arriving lumps
NS[T+1…]    dynamic lump space (lowest-free-first)
```

The thread count is the only pre-planned assignment in the namespace. Everything above
NS[T−1] fills in as lumps arrive.

### 9.4 Lump lifecycle: lazy load and two-case eviction

**Lazy load**: A lump does not occupy a slot until something calls it for the first
time. The Outform GT mechanism handles this — an Outform GT is a promise that the lump
will be fetched and installed on first call. The caller sees no difference; from its
perspective the CALL always works. The slot number appears in the issued GT only after
installation.

**Eviction — two cases:**

| Case | Behaviour | When |
|---|---|---|
| **Early return** | Lump finishes quickly; slot held | Called frequently; holding the slot avoids reload overhead on the next call. Acts as a warm cache entry. |
| **Slow return** | Lump finishes slowly; slot surrendered | Infrequent use or memory pressure. Slot returns to the free pool immediately. |

**Why eviction is safe — the `gt_seq` counter:**

Every GT records the `gt_seq` value current at the time the lump was installed. When a
surrendered slot is reused by a different lump, the new NS entry receives a fresh
`gt_seq`. The hardware rejects every outstanding GT for the old occupant with a
`VERSION` fault on the very next use. No explicit recall of old GTs is needed. Revocation
is automatic, zero-cost, and immediate.

**The complete slot lifecycle:**

```
slot empty
  → lump arrives (lazy load)      — slot filled, gt_seq = N, E-GTs issued
  → early return                   — slot held,  gt_seq unchanged, GTs still valid
  → slow return / eviction         — slot cleared, memory freed
  → new lump arrives               — slot refilled, gt_seq = N+1, old GTs dead
```

### 9.5 Natural memory balance and GC as tidy-up

Because surrendered slots become the new lowest-free candidates, the active lump
population churns in place near the bottom of the table. The high-water mark rises only
when peak concurrent occupancy genuinely grows — and it falls again when slow-return
lumps drain and GC compacts the remaining gaps.

In a traditional managed runtime, GC is a **necessity**: fragmentation eventually makes
allocation impossible and the system stalls. Here, fragmentation cannot block allocation.
The next free slot is always usable regardless of gaps around it. GC is therefore a
**tidy-up** — it runs when convenient to lower the high-water mark and reduce the NS
table's footprint in RAM. It is never urgent. It is never a survival operation.

The system memory footprint therefore tracks actual use, not worst-case planning:

```
physical RAM

  ┌─────────────────────────────┐ ← top of RAM
  │  NS table (3 words × HWM)  │  grows from top downward
  │  HWM = peak concurrent      │  stays small on quiet devices
  ├─────────────────────────────┤
  │  lump memory (power-of-2)  │  grows from bottom upward
  │  only what is actually      │  Billing quotas prevent runaway
  │  installed right now        │
  └─────────────────────────────┘ ← base of RAM
```

### 9.6 Tunnels — a namespace that spans the world

A Tunnel is an ordinary lump occupying an ordinary NS slot. From the caller's
perspective, calling through a Tunnel is identical to calling any local service: present
an E-GT, pass arguments in data registers, receive a result. The permission model —
domain purity, `gt_seq` revocation, B-bit propagation — applies at every use, without
exception.

What happens inside the Tunnel is that the capability call is serialised and dispatched
to a **remote namespace of the same type** running on another machine. That machine
executes the call in one of its own thread slots and returns the result across the
connection.

Because cooperating namespaces share the same lump structure and slot conventions, a GT
that is valid locally is structurally meaningful remotely. The capability model is
end-to-end: there is no point in the chain where trust is assumed rather than enforced.

```
Tokyo namespace                    London namespace
  Thread 0 – 3                       Thread 0 – 3
  SlideRule    NS[12]                 SlideRule    NS[12]
  Constants    NS[18]                 Constants    NS[18]
  Tunnel ─────────────────────────►  (receives CALL, executes in Thread 1, returns)
  NS[31]
```

A Paris namespace can hold Tunnels to both. Chains of Tunnels can span any number of
machines. Each hop is just a CALL through an E-GT. The security model holds at every
hop because the hardware enforces it at the point of use, not at the point of trust.

This is distributed computing without a privileged runtime, without a trusted
intermediary, and without any mechanism other than the one the hardware already enforces
locally. A sensor in Helsinki and a display wall in São Paulo can cooperate through a
chain of capability calls that looks, to every piece of code involved, exactly like
calling a local service.

---

## 10. Boot sequence changes

`Navana.Init` currently calls `Memory.Allocate` and `Mint.Create` directly. After this
change it:

1. Receives a system-class P-GT from Billing (issued during Billing's own init, before
   Navana.Init runs — Billing is installed first).
2. Uses that P-GT for every allocation in Init.
3. Calls `TuringMemory.AllocCode` for code lumps (SlideRule, Constants).
4. Calls `TuringMemory.Allocate` for working-memory buffers (LED, UART, Stack, DijkstraFlag).
5. Calls `ChurchMemory.AllocAbstract` to wrap each installed lump in an E-GT for the Scheduler.

```
Before (current navana.cloomc):
    srBase    = call(Memory.Allocate(16384))     // raw address, no domain
    srGT      = call(Mint.Create(16384, 5))      // perms ignored, no GT encoding

After:
    srGT      = call(TuringMemory.AllocCode(16384, systemPgt))    // GT(R,X, Inform)
    srEnterGT = call(ChurchMemory.AllocAbstract(srGT.nsSlot))     // GT(E, Inform)
```

---

## 11. Migration of existing callers

| Current call in navana.cloomc | Migrated to | GT issued |
|---|---|---|
| `Memory.Allocate(16384)` — SlideRule code | `TuringMemory.AllocCode(16384, pgt)` | R, X |
| `Memory.Allocate(256)` — Constants | `TuringMemory.AllocCode(256, pgt)` | R, X |
| `Memory.Allocate(1024)` — Scheduler | `TuringMemory.Allocate(1024, pgt)` | R, W |
| `Memory.Allocate(512)` — Stack | `TuringMemory.Allocate(512, pgt)` | R, W |
| `Memory.Allocate(256)` — DijkstraFlag | `TuringMemory.Allocate(256, pgt)` | R, W |
| `Memory.Allocate(64)` — LED buffer | `TuringMemory.Allocate(64, pgt)` | R, W |
| `Memory.Allocate(512)` — UART buffer | `TuringMemory.Allocate(512, pgt)` | R, W |
| `Mint.Create(16384, 5)` — SlideRule GT | `ChurchMemory.AllocAbstract(slot)` | E |
| `Mint.Create(256, 5)` — Constants GT | `ChurchMemory.AllocAbstract(slot)` | E |

---

## 12. Files to create or change

| File | Action | Description |
|---|---|---|
| `simulator/cloomc/memory.cloomc` | Rename + rework | Becomes `physical_pool.cloomc`; only `Claim` and `Release`; no perms |
| `simulator/cloomc/mint.cloomc` | Rework | Replace `Create` with `Encode(base, exp, permsBits, bindable, far)` |
| `simulator/cloomc/navana.cloomc` | Update | Use TuringMemory + ChurchMemory + system P-GT in `Init`; fix stale "NS slot 0" comment on line 1 (actual slot is 5) |
| `simulator/cloomc/billing.cloomc` | **New** | Billing abstraction as specified in §6 |
| `simulator/cloomc/turing_memory.cloomc` | **New** | TuringMemory as specified in §4 |
| `simulator/cloomc/church_memory.cloomc` | **New** | ChurchMemory as specified in §5 |
| `simulator/cloomc/lump_factory.cloomc` | **New** | LumpFactory as specified in §7 |
| `simulator/system_abstractions.js` | Update | Register new abstractions; assign slots by first-come-first-served policy per §9.2 |
| `simulator/boot_uploads.js` | Update | Lines 24–39: stale NS slot comment block (NS[2]=Boot.Memory etc.) does not match the live manifest; remove or replace with the §9.1 live registry |

---

## 13. Design decisions — resolved 2026-04-30

All four questions below were open at draft time and are now decided. No further
questions block implementation.

**Q2 — Billing table storage — Decision: reissue fresh accounts at every boot**

The Billing quota table is ephemeral. On every boot, Billing creates accounts from
scratch: the system-class account is issued during `Navana.Init`, and any user-class
accounts are provisioned at that time by the boot policy. Quotas reset on power cycle.

Rationale: The boot sequence already brings all abstractions up fresh. Adding persistent
storage for quota records — whether in reserved RAM or flash — would require a
persistence layer that does not yet exist and imposes ordering constraints on the boot
sequence. The benefit (surviving reboots with the same quota balances) is not required
for the current use cases. If persistent quotas are needed in the future they can be
added as a separate Billing extension without changing the core Charge/TopUp/Revoke
interface.

Consequence: The `account_id` values in the quota table are ephemeral. A P-GT held
across a reboot refers to an `account_id` that no longer exists in the new Billing
table; `Charge` will fault `QUOTA_EXCEEDED` (table entry absent → remaining = 0).
This is safe and expected: the caller must obtain a fresh P-GT after any reboot.

**Q3 — P-GT freshness enforcement — Decision: Billing maintains `current_seq` per account**

Billing adds a `current_seq` field to each quota record. `Billing.Charge` rejects any
P-GT whose `gt_seq` field does not match the stored `current_seq` for that `account_id`
with a `BAD_PGT_SEQ` fault. `Billing.Reissue` increments `current_seq` and returns a
new P-GT with the updated sequence.

Rationale: §6.5 already promises that stale P-GTs are rejected at `Charge` time after
a `Reissue`. That promise requires the sequence to be tracked. Revoke-by-zeroing alone
is sufficient to block future charges but does not invalidate outstanding copies held in
c-lists that the caller may have distributed. The `current_seq` check closes that gap
without requiring any recall of old P-GTs. The check is a single word comparison inside
`Billing.Charge` — zero additional cost to the common path.

Updated quota record (add one field to §6.3 table):

| Field | Type | Meaning |
|---|---|---|
| `account_id` | 16-bit | Key; matches P-GT `ab_data` field |
| `words_remaining` | 32-bit | Current allocation budget in words |
| `words_used` | 32-bit | Cumulative words ever committed |
| `quota_class` | 4-bit | Controls default limits and B-bit policy |
| `current_seq` | 7-bit | Valid sequence counter; must match P-GT `gt_seq` |

`Billing.Issue` sets `current_seq = freshSeq()`. `Billing.Reissue` increments
`current_seq` before building the new P-GT word.

**Q4 — `AllocAbstract` memory charging — Decision: no charge**

`ChurchMemory.AllocAbstract` issues no Billing charge. The current design is correct.

Rationale: `AllocAbstract` allocates no physical memory and claims no new NS slot. It
returns a 32-bit E-GT value that the caller stores in one word of their existing c-list.
That c-list word was already charged to the caller's quota when their c-list lump was
allocated via `ChurchMemory.Allocate`. No additional resource is consumed per E-GT
beyond the c-list word it occupies.

Unbounded E-GT proliferation cannot occur: each E-GT must reside in a c-list word,
c-list capacity is quota-bounded, and quota is enforced at `ChurchMemory.Allocate` time.
A caller cannot obtain more E-GTs than they have c-list words, and they cannot obtain
more c-list words than their quota allows. No flat fee is needed.

**Q7 — `ab_type` value for P-GT — Decision: confirm `ab_type = 0x02`**

`AB_TYPE_PGT = 0x02` is confirmed as the P-GT class identifier. The value is not
allocated to any other use. The full allocation table is:

| Value | Constant | Use |
|---|---|---|
| `0x00` | `AB_TYPE_IO` | Hardware device handle (LED, UART, Button, Timer, Display) |
| `0x01` | `AB_TYPE_M_ELEVATION` | M-bit authority token — sets CRn(M=1) |
| `0x02` | `AB_TYPE_PGT` | Billing Passkey |

§6.2 and `Billing.Charge`'s validation mask (`pgt[31:27] != 0b00010`) are consistent
with this value and require no change. §2.2 has been updated to use the `AB_TYPE_PGT`
constant name.

*Previously resolved questions:*
- *Q1 (NS renumbering strategy): resolved — first-come-first-served per §9.2; no pre-assignment; no renumbering.*
- *Q5 (backward-compat Memory shim): resolved — Memory stays at its current slot until PhysicalPool passes tests and replaces it.*
- *Q6 (LumpFactory necessity): deferred — LumpFactory earns a slot when it is built and tested, or is omitted if TuringMemory/ChurchMemory prove sufficient in practice.*

---

*This document describes design intent only. No source files have been modified.
All design questions in §13 are now resolved. Implementation may begin after this
document is approved.*

---
*Confidential — Kenneth Hamer-Hodges — April 2026*
