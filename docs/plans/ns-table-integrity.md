# NS Table Integrity Correction Plan

**Date:** 2026-05-13
**Status:** Approved for build
**Scope:** Simulator JS only — no FPGA hardware, no Python backend, no lump binaries

---

## Background & Agreed Architecture

The Church Machine architectural specifications (docs/abstract-io-addressing.md,
docs/patent-ctmm-unified.md, docs/architecture.md) state:

> "No namespace entry. No CRC validation. No lump. The address *is* the identity."
> "No namespace lookup ever occurs for an Abstract GT."
> "GT IS the value — constants (pi), immutable credentials, PassKey tokens."

The NS table has exactly two legitimate uses:

- **Inform (gtType=1):** A resident lump in physical memory.
- **Outform (gtType=2):** A lump not yet fetched; placeholder until mode-2 lazy-load promotes it to Inform.

**Abstract GTs (gtType=3) must never have NS entries.** The NS table must never be
used as a hidden pool, scratch area, or per-slot alias for anything that is not a
real lump.

An abstraction is a functionally secure digital computation. Its lump memory is
protected by the abstraction boundary. Internal pool memory is an implementation
detail — no external NS entries should pierce that boundary.

---

## Violations Found (Full Audit)

### V1 — Pool per-slot NS entries at slots 50–63 (CRITICAL)

**File:** `simulator/simulator.js` lines 407–428
**What:** `lazyLoad()` writes 14 individual R-only NS entries at `POOL_NS_BASE=50`
through slot 63 to back pool memory for `Constants.Add()`.
**Why wrong:**

1. Directly conflicts with NS slot 50 (Scheduler.IRQ.Thread).
2. Punches 14 holes through the Constants abstraction boundary — any holder of
   one of these GTs can read Constants' internal pool memory directly, bypassing
   the abstraction entirely.
3. No user approval for any of these NS slots.

### V2 — Pool aggregate NS entry at slot 219 (CRITICAL)

**File:** `simulator/simulator.js` lines 414–418
**What:** `lazyLoad()` writes an aggregate pool-W Inform GT at NS slot
`200 + slotIndex + 1` (= slot 219 for Constants).
**Why wrong:** Same abstraction-boundary violation. Exposes a writable NS-backed
window into Constants' internal pool area.

### V3 — `pool-W` capability in Constants c-list (CRITICAL)

**File:** `simulator/boot_uploads.js` line 382
**What:** Constants entry declares `{ type: 'pool-W' }` as a second capability.
This is what triggers V1 and V2 in `lazyLoad()`.
**Why wrong:** The pool is internal to Constants. No capability is needed to
write to your own lump memory from within your own methods.

### V4 — `Constants.Add()` returns an Abstract-labelled Inform GT (CRITICAL)

**File:** `simulator/system_abstractions.js` lines 2550–2610
**What:** After writing pool memory, `Constants.Add()` calls
`sim.createGT(0, poolNsSlot, {R:1,...}, 3)` — using the Inform GT constructor
with type=3. The result is a malformed GT: the tag says Abstract but it encodes
an NS slot index, exactly like an Inform GT. It then writes NS-sourced data into
CR0.word1/word2/word3.
**Why wrong:**

1. Uses the wrong constructor.
2. The returned value in CR0 is lost when the caller does any CHANGE (CALL,
   context switch, thread restore) that overwrites CR0 before the value is used.
3. The value only "survives" if the pool NS entry remains valid — violating the
   "no NS lookup for Abstract GTs" rule.

### V5 — `writeNSEntry()` accepts gtType=3 without complaint (STRUCTURAL)

**File:** `simulator/simulator.js` line 762
**What:** `writeNSEntry()` has no guard against `gtType === 3`.
**Why wrong:** Any future task agent can repeat V1/V2 without triggering any
error. The rule must be enforced at the function boundary.

### V6 — Import paths default to gtType=0 (NULL) (LATENT)

**File:** `simulator/app-run.js` lines 9699, 9713
**What:** `gtType = (item.entry && item.entry.gtType) || 0` — defaults to NULL
when no entry type is specified in imported JSON.
**Why wrong:** A NULL NS entry is not a valid Inform or Outform entry. Should
default to 1 (Inform).

### V7 — localStorage restore can write any gtType (LATENT)

**File:** `simulator/app-run.js` line 9773
**What:** `item.entry.gtType || 0` restores whatever was serialised, including
a previously saved gtType=3 entry.
**Why wrong:** Must clamp to valid values (1 or 2 only) on restore.

---

## Fix Plan

### FIX-1: Remove pool-W from Constants capabilities

**File:** `simulator/boot_uploads.js`
**Change:** Remove `{ type: 'pool-W' }` from the Constants entry's `capabilities`
array. Constants now has exactly one capability: `[{ type: 'self-data-R' }]`.
**Effect:** `lazyLoad()` finds no `poolWIdx`, so V1 and V2 never execute.

### FIX-2: Remove pool loader block from lazyLoad()

**File:** `simulator/simulator.js`
**Change:** Delete the entire `if (poolWIdx >= 0) { ... }` block (currently lines
407–428). Remove the `poolWIdx` variable declaration on line 394.
**Effect:** NS slots 50–63 are never touched by the loader. NS slot 219 is never
created. The Constants lump has exactly one NS entry (slot 218, self-data-R).

### FIX-3: Rewrite Constants.Add() — Pi pattern

**File:** `simulator/system_abstractions.js`
**Change:** Replace the entire body of `Constants.Add()` with the Pi pattern:

- Take XYZ from `sim.dr[0]`.
- Find pool base: `lumpBase + 1 + hdr.cw + BUILTIN_DATA`.
- Scan bitmap at `poolBase + POOL_SIZE` for a free slot N.
- Write XYZ to `sim.memory[poolBase + N]`.
- Mark bitmap slot N as used.
- Return `{ ok: true, result: N }` — slot index N lands in DR0.

The constant lives in Constants' lump memory permanently, protected by the
Constants abstraction boundary. Survives all CHANGEs. No NS entry. No GT
of any kind is returned. The caller holds integer N just as they hold the name
"Pi" — it is their key to retrieve the value via Constants.Get(N).

### FIX-4: Add Constants.Get(N)

**File:** `simulator/system_abstractions.js`
**Change:** Bind a new method `Constants.Get` after `Constants.Add`:

- Read N from `sim.dr[0]`.
- Bounds-check N against POOL_SIZE.
- Check bitmap to confirm slot N is allocated.
- Return `{ ok: true, result: sim.memory[poolBase + N] }` — value lands in DR0.

**Also add** a method stub to the Constants entry in `simulator/boot_uploads.js`:

```js
{ name: 'Get', code: [0x070B0000, 0x57008001, 0x1F000000] }
```

(Exact opcodes to be confirmed against the Add stub pattern at the same offset.)

### FIX-5: Guard writeNSEntry() against gtType=3

**File:** `simulator/simulator.js`
**Change:** Add at the top of `writeNSEntry()`:

```js
if (gtType === 3) {
    throw new Error(
        `writeNSEntry(slot ${idx}): Abstract GTs (gtType=3) must never have NS entries. ` +
        `The NS table is only for Inform (1) and Outform (2) entries. ` +
        `See docs/abstract-io-addressing.md.`
    );
}
```

**Effect:** Any future attempt to create an NS entry for an Abstract GT throws
immediately with a diagnostic message citing the spec. Task agents cannot repeat
V1/V2.

### FIX-6: Fix import path gtType defaults

**File:** `simulator/app-run.js`
**Lines:** 9699 and 9713
**Change:**

```js
// Before:
const gtType = (item.entry && item.entry.gtType) || 0;
// After:
const gtType = (item.entry && item.entry.gtType != null) ? item.entry.gtType : 1;
```

### FIX-7: Clamp gtType on localStorage restore

**File:** `simulator/app-run.js`
**Line:** 9773
**Change:** Clamp restored gtType to 1 or 2 only. If gtType=3 is found in
storage, warn to the console and treat as Inform (1).

### FIX-8: Remove pool display from app-lumps.js

**File:** `simulator/app-lumps.js`
**Line:** ~2036
**Change:** Remove the `pool[${p}]` span in the c-list display. The pool is an
internal implementation detail of the Constants lump. It has no c-list entry and
should not appear in the lump viewer.

---

## Files Changed Summary

| File | Change |
|---|---|
| `simulator/boot_uploads.js` | Remove `pool-W` capability; add `Get` method stub |
| `simulator/simulator.js` | Remove poolWIdx + pool block from `lazyLoad()`; add gtType=3 guard to `writeNSEntry()` |
| `simulator/system_abstractions.js` | Rewrite `Constants.Add()`; add `Constants.Get()` |
| `simulator/app-run.js` | Fix gtType defaults (x2) and localStorage restore clamp |
| `simulator/app-lumps.js` | Remove pool c-list display |

**Files NOT changed:** All Python, all lump binaries, all test fixtures, all docs
(architecture is already correctly specified — this corrects the implementation
to match it).

---

## Test Validation

Run in order after build:

1. `lump-consistency` — Constants lump cc drops from 2 to 1; sidecar JSON must be updated.
2. `assembler-tests` — constants_dot unit tests must still pass.
3. `boot-image-matches-sim` — NS slot 50 (Scheduler.IRQ.Thread) must be clean.
4. `boot-image-loads-and-boots` — boot sequence must complete cleanly.
5. `fault-recovery-tests` — Scheduler.IRQ (NS slot 50) must not be clobbered.
6. `e2e-tests` — full regression.

---

## Acceptance Criteria

- `writeNSEntry(slot, ..., 3, ...)` throws in all environments.
- NS slot 50 is exclusively Scheduler.IRQ.Thread after boot — no pool entry ever overwrites it.
- NS slots 51–63 are untouched by the loader.
- `Constants.Add(xyz)` returns N in DR0; `Constants.Get(N)` returns xyz in DR0.
- The Constants lump c-list has exactly one entry (self-data-R at NS 218).
- All six test suites pass.
- `grep -r 'pool-W\|POOL_NS_BASE\|poolWIdx' simulator/` returns zero hits outside deleted code.
