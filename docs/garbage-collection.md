# Deterministic Garbage Collection

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

## The G-bit Liveness Mechanism

G (Garbage) is a liveness flag used in the garbage collection process. It is **not** a GT permission bit -- it is part of the GC infrastructure. The two simulators implement G differently:

- **Sim-64 (CM)**: G is a 1-bit field in the 64-bit GT layout (bit 57). It is reset (cleared to 0) on every namespace access through mLoad, and set to 1 during the Mark phase.
- **Church Machine (Sim-32)**: G is tracked in the namespace entry (`WORD2_LAYOUT.g_bit`, bit 28), not in the GT itself. Liveness is determined by version matching — when a namespace entry is swept, its 7-bit `gt_seq` is bumped, instantly invalidating all stale GTs whose `gt_seq` no longer matches.

In both implementations, the liveness signal is integrated into the mLoad validation path:

- **On every namespace access** (LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH), the liveness flag is reset on the accessed namespace entry.
- This means that actively used entries automatically signal their liveness through normal program execution.
- **During the Mark phase**, all non-empty namespace entries are marked as potentially reclaimable.
- **After Scan**, entries not accessed since the last Mark are candidates for reclamation.

This liveness reset is enforced through the **mLoad master validation path** -- every namespace access routes through mLoad, which always updates liveness as a side effect.

---

## The mLoad Rule and G-bit Reset

The G-bit reset is not a separate mechanism — it is an integral part of the mLoad validation pipeline. mLoad is the single trusted path for all namespace access:

```
mLoad Validation Pipeline:
  1. Permission check (L/M on source, or null for restoration)
  2. Bounds check (index within C-List)
  3. Fetch GT from C-List
  4. Namespace bounds check (GT.offset within CR15 range)
  5. Fetch namespace entry (Location, Limit, Seals)
  6. MAC/seal validation
  7. G-bit reset on accessed namespace entry  ← GC integration point
  8. Write capability to destination CR       ← sole path for all CR writes
  9. Thread table shadow update at Thread[CRd] ← keeps thread table current
```

Step 7 is unconditional — it happens on every successful namespace access regardless of the instruction type or permission domain. This ensures that **reachability determines liveness, not permissions**.

Steps 8-9 enforce the Golden Rule: mLoad is the sole path for all CR writes. Every CR write automatically updates the thread table shadow, keeping it continuously current. This eliminates the need for CHANGE to save CR state — only data registers and PC need saving during context switches.

For RETURN, mLoad revalidates the caller's E-GT (Word 0 of the frame) and resets its G-bit. The NS split then re-derives CR6 (c-list) and CR14 (code) from the caller's namespace entry — if the entry was recycled during the call (version bumped by a GC sweep), mLoad detects the version mismatch and faults, preventing use-after-free of recycled capabilities. CR5 (Heap GT) is a thread register installed by CHANGE from the thread's Zone ④ bounds — it is not part of the CALL/RETURN save/restore path.

For write-path instructions (SAVE), the G-bit reset is applied to the namespace entries accessed during the operation through the mSave validation subroutine.

---

## Three-Phase Mark-Scan-Sweep Cycle

Both simulators implement deterministic garbage collection through a three-phase cycle. Unlike traditional GC systems that rely on non-deterministic tracing, this cycle is explicit and predictable.

### Phase 1: Mark

The Mark phase flags all non-empty namespace entries as potentially reclaimable by setting G=1.

- Every namespace entry that contains valid data has its G bit set.
- This is a conservative starting point: all entries are assumed unreachable until proven otherwise.

### Phase 2: Scan (DNA Tree Walk)

The Scan phase walks the full reachability tree from all live roots, clearing G=0 on all reachable entries.

**Live roots include:**
- All capability registers (CR0-CR15)
- All call stack frames
- Thread table entries

**Tree walk rules:**
- Reachability in the tree determines liveness, not parent permissions
- No permission filtering during scan — an entry is reachable if it can be reached through any path, regardless of whether the path has L, M, or any other permission
- Nested C-Lists and referenced entries are followed recursively
- A visited set prevents infinite loops in cyclic structures

### Phase 3: Sweep

The Sweep phase reclaims entries that are still marked with G=1 after scanning.

- Any namespace entry still marked after Scan is unreachable — no live capability register, call stack frame, or thread table entry references it.
- The entry is cleared (reclaimed).
- The entry's version is bumped (incremented within the 7-bit field), invalidating any stale Golden Tokens.

---

## Version Bumping and Token Invalidation (Church Machine)

Version bumping is the mechanism that prevents use-after-free vulnerabilities. When a namespace entry is reclaimed during Sweep:

1. The entry's version number is incremented.
2. Any outstanding Golden Token that references this entry still contains the old version number.
3. When that stale token is later used in a LOAD or CALL, the version check fails (the token's version does not match the entry's new version).
4. The operation FAULTs, preventing access to the recycled entry.

This provides strong temporal safety: even if an old token is retained in a register or data structure, it cannot be used to access a namespace entry that has been reclaimed and potentially reassigned to a different resource.

---

## GC Integration

Garbage collection uses the G-bit mechanism through mLoad:

- **mLoad resets G**: When mLoad validates a namespace access, it resets G=0 on the accessed entry. This happens during every LOAD, SAVE, CALL, RETURN, CHANGE, and SWITCH.
- **mLoadByIndex resets G**: Direct namespace index access also resets G=0.
- The three phases (Mark, Scan, Sweep) can be triggered independently through the Dashboard UI.
- The namespace table is a flat array of up to 65,536 entries (16-bit `object_id`).

### Dashboard UI (Church Machine)

The Church Machine Dashboard provides four GC control buttons:

| Button | Action |
|--------|--------|
| **Mark** | Executes the Mark phase only. Sets G=1 on all non-empty namespace entries. |
| **Scan** | Executes the Scan phase only. Walks DNA tree from all live roots, clearing G=0 on reachable entries. |
| **Sweep** | Executes the Sweep phase only. Reclaims entries still marked with G=1 and bumps their versions. |
| **GC Cycle** | Executes all three phases in sequence (Mark, then Scan, then Sweep). |

The Namespace Browser displays a G column showing the current G-bit state for each entry.

---

## Hardware Implementation

### SystemVerilog

The mLoad micro-routine (`ctmm_mload.sv`) implements G-bit reset as a dedicated pipeline state:

- **SUB_RESET_G**: After MAC validation, if the fetched GT has G=1, this state asserts `g_bit_reset` and provides the namespace address via `g_bit_addr` (CR15.Location + GT.offset + 16, pointing to Word 3/Seals).
- The `g_bit_reset`/`g_bit_addr` interface is used by external logic to clear the G bit in the namespace memory.
- Write-path instructions (SAVE via `ctmm_save.sv`, RETURN via `ctmm_return.sv`) also reset G-bits for their accessed namespace entries using the same interface.

### Amaranth HDL

The mLoad module (`ctmm_amaranth/mload.py`) mirrors the SystemVerilog implementation:

- A `RESET_G` state asserts `g_bit_reset` and computes `g_bit_addr`.
- SAVE (`save.py`) and RETURN (`ret.py`) include their own G-bit reset states using the same signal interface.

---

## Summary

| Aspect | Detail |
|--------|--------|
| **G-bit Reset Trigger** | Every mLoad/mLoadByIndex call (all Church instructions) |
| **Namespace Structure** | Flat table (up to 65,536 entries, 16-bit `object_id`) |
| **Scan Algorithm** | DNA tree walk from registers + call stack + thread table, no permission filtering |
| **Version Bumping** | 7-bit version incremented on Sweep |
| **Token Invalidation** | Version mismatch detection |
| **User Control** | Dashboard buttons (Mark, Scan, Sweep, GC Cycle) |
| **Hardware Support** | g_bit_reset/g_bit_addr signals in mLoad, SAVE, RETURN |

## Key Design Principle

The G-bit reset happens on **every** namespace access because reachability determines liveness, not permissions. An entry accessed through a SAVE (S permission) is just as live as one accessed through a LOAD (L permission). The mLoad path enforces this uniformly.

---

## See Also

- [Lump-Architecture.md](Lump-Architecture.md) — Lump object structure, Header Word encoding, and zone layout
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
