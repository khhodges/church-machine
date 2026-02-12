# Deterministic Garbage Collection

## The G Permission Bit

The G (Garbage) permission bit is a flag on Golden Tokens that participates in the garbage collection process. Its behavior is unified across all implementations:

- **On every namespace access** (LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH), the G bit is reset (cleared to 0) on the accessed namespace entry.
- This means that actively used entries automatically signal their liveness through normal program execution.
- **During the Mark phase**, the G bit is set (to 1) on all non-empty namespace entries, marking them as potentially reclaimable.
- **After Scan**, entries still marked with G=1 have not been accessed since the last Mark and are candidates for reclamation.

This G-bit reset is enforced through the **mLoad master validation path** — every namespace access routes through mLoad, which always resets G as a side effect. This is true in software (both simulators), SystemVerilog, and Amaranth HDL implementations.

---

## The mLoad Rule and G-bit Reset

The G-bit reset is not a separate mechanism — it is an integral part of the mLoad validation pipeline. mLoad is the single trusted path for all namespace access:

```
mLoad Validation Pipeline:
  1. Permission check (L/M on source)
  2. Bounds check (index within C-List)
  3. Fetch GT from C-List
  4. Namespace bounds check (GT.offset within CR15 range)
  5. Fetch namespace entry (Location, Limit, Seals)
  6. MAC/seal validation
  7. G-bit reset on accessed namespace entry  ← GC integration point
  8. Thread update (save GT with G=0 for suspension)
  9. Write result to destination register
```

Step 7 is unconditional — it happens on every successful namespace access regardless of the instruction type or permission domain. This ensures that **reachability determines liveness, not permissions**.

For write-path instructions (SAVE, RETURN), the G-bit reset is applied to the namespace entries accessed during the operation, even though these instructions use different validation subroutines (mSave for SAVE, direct E-permission check for RETURN).

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
- Thread table entries (Sim-32)

**Tree walk rules:**
- Reachability in the tree determines liveness, not parent permissions
- No permission filtering during scan — an entry is reachable if it can be reached through any path, regardless of whether the path has L, M, or any other permission
- Nested C-Lists (Sim-64) or referenced entries (Sim-32) are followed recursively
- A visited set prevents infinite loops in cyclic structures

### Phase 3: Sweep

The Sweep phase reclaims entries that are still marked with G=1 after scanning.

- Any namespace entry still marked after Scan is unreachable — no live capability register, call stack frame, or thread table entry references it.
- The entry is cleared (reclaimed).
- **Sim-32**: The entry's version is bumped (incremented within the 5-bit field), invalidating any stale Golden Tokens.
- **Sim-64**: The entry is removed from the namespace tree.

---

## Version Bumping and Token Invalidation (Sim-32)

Version bumping is the mechanism that prevents use-after-free vulnerabilities. When a namespace entry is reclaimed during Sweep:

1. The entry's version number is incremented.
2. Any outstanding Golden Token that references this entry still contains the old version number.
3. When that stale token is later used in a LOAD or CALL, the version check fails (the token's version does not match the entry's new version).
4. The operation FAULTs, preventing access to the recycled entry.

This provides strong temporal safety: even if an old token is retained in a register or data structure, it cannot be used to access a namespace entry that has been reclaimed and potentially reassigned to a different resource.

---

## Sim-64: GC Integration

In Sim-64, garbage collection is integrated directly into the mLoad path:

- When any Church instruction accesses a namespace entry through mLoad, the G bit on that entry is cleared.
- The GC operates on the namespace hierarchy, traversing the tree of namespaces rooted at CR15.
- The Scan phase walks the full DNA tree without permission filtering — any reachable node has its G bit cleared.
- The Mark-Scan-Sweep cycle can be triggered to identify unreferenced entries by checking which entries still have their G bit set.

---

## Sim-32: GC Integration

In Sim-32, garbage collection uses the same G-bit mechanism through mLoad:

- **mLoad resets G**: When mLoad validates a namespace access, it resets G=0 on the accessed entry. This happens during every LOAD, SAVE, CALL, RETURN, CHANGE, and SWITCH.
- **mLoadByIndex resets G**: Direct namespace index access also resets G=0.
- The three phases (Mark, Scan, Sweep) can be triggered independently through the Dashboard UI.
- The namespace table is a flat array of up to 32,768 entries.

### Dashboard UI (Sim-32)

The Sim-32 Dashboard provides four GC control buttons:

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

## Comparison

| Aspect | Sim-64 (CTMM) | Sim-32 (RV32-Cap) |
|--------|---------------|-------------------|
| **G-bit Reset Trigger** | Every mLoad call (all Church instructions) | Every mLoad/mLoadByIndex call (all Church instructions) |
| **Namespace Structure** | Hierarchical (tree of namespaces) | Flat table (up to 32,768 entries) |
| **Scan Algorithm** | DNA tree walk from CR15 root, no permission filtering | DNA tree walk from registers + call stack + thread table, no permission filtering |
| **Version Bumping** | Not used (tree removal) | 5-bit version incremented on Sweep |
| **Token Invalidation** | Entry removal from tree | Version mismatch detection |
| **User Control** | Dashboard buttons (Mark, Scan, Sweep, GC Cycle) | Dashboard buttons (Mark, Scan, Sweep, GC Cycle) |
| **Hardware Support** | g_bit_reset/g_bit_addr signals in mLoad, SAVE, RETURN | g_bit_reset/g_bit_addr signals in mLoad, SAVE, RETURN |

## Key Design Principle

The G-bit reset happens on **every** namespace access because reachability determines liveness, not permissions. An entry accessed through a SAVE (S permission) is just as live as one accessed through a LOAD (L permission). The mLoad path enforces this uniformly.
