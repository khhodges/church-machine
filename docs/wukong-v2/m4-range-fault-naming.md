# M4 — RANGE/STACK_OVERFLOW Naming Collision in Simulator

## Priority
**Low** — Both `STACK_OVERFLOW` and `RANGE` are assigned value `0x10` in
`simulator/simulator.js`. They refer to the same fault code. Depending on how the
simulator's fault decoder iterates its table, the displayed name for fault `0x10`
may be either "STACK_OVERFLOW" (the canonical hardware name) or "RANGE" (a
simulator-internal alias), making fault diagnosis inconsistent.

## Root Cause
`simulator/simulator.js`, `ChurchSimulator.FAULT_CODES`:
```js
STACK_OVERFLOW: 0x10,   // line 7543
// ...
RANGE: 0x10,            // line 7545
```

`hardware/hw_types.py` has only `STACK_OVERFLOW = 0x10`. There is no `RANGE` fault
code in the hardware.

`RANGE` was likely added as a convenience alias for the simulator's fetch-bounds check
(when NIA exceeds CR14's code fence, the simulator may internally call this a "range"
violation). The hardware emits `STACK_OVERFLOW` for the same code.

## Correct Canonical Name
The hardware spec (`hardware/hw_types.py`) is authoritative. The canonical name for
fault code `0x10` is **`STACK_OVERFLOW`**. The `RANGE` alias is a simulator artifact
with no hardware counterpart.

## Proposed Fix

### Step 1 — Search for all uses of `RANGE` fault in the simulator
```
grep -rn 'RANGE' simulator/ --include='*.js'
```
Find every location where the simulator emits or tests fault code `RANGE` (not the
generic English word "range"). Determine whether any code path should emit
`STACK_OVERFLOW` instead.

### Step 2 — Decision: alias or rename
- **If `RANGE` is used only in the lookup table**: Remove the duplicate entry; keep
  only `STACK_OVERFLOW: 0x10`.
- **If `RANGE` is referenced by simulator fault-raising code**: Rename those call sites
  to use `STACK_OVERFLOW`, then remove the `RANGE` entry from the table.
- **If `RANGE` is referenced by UI fault-display code**: Replace display references
  with `STACK_OVERFLOW` and update any user-visible label to say "Stack overflow
  (out-of-range access)".

### Step 3 — If the fetch-bounds check is conceptually different from STACK_OVERFLOW
If the fetch-bounds violation (NIA > CR14 code fence) is semantically different from
a stack overflow and deserves its own fault code, the correct fix is:
- Assign it a **new, unused fault code** (currently 0x1A onward are unused in hardware)
- Coordinate with the hardware team to assign e.g. `FETCH_BOUNDS = 0x1A` in
  `hw_types.py`
- Update both hardware and simulator

This is the larger, correct fix if the two conditions are genuinely distinct.

## Files to Change

| File | Change |
|------|--------|
| `simulator/simulator.js` | Remove duplicate `RANGE: 0x10` entry; OR rename to `STACK_OVERFLOW` if currently used under that name |
| Any simulator JS that emits `FAULT_CODES.RANGE` | Rename to `FAULT_CODES.STACK_OVERFLOW` |
| `docs/isa_reference.md` | Confirm fault table shows `STACK_OVERFLOW = 0x10` with no RANGE alias |

## Acceptance Criteria
1. Only one entry in `FAULT_CODES` has value `0x10`.
2. That entry's key is `STACK_OVERFLOW` (matching `hw_types.py`).
3. No remaining reference to `FAULT_CODES.RANGE` anywhere in the codebase.
4. The fault panel in the IDE displays "Stack overflow" for fault `0x10`.
5. All existing simulator tests that test fault `0x10` still pass.

## Risks
- **RANGE used in test fixtures**: if any test file asserts `sim.FAULT_CODES.RANGE`,
  removing it breaks the test. Grep for `FAULT_CODES.RANGE` before removing.
- **Fetch-bounds vs stack overflow**: if these are genuinely different faults that
  just happen to share a code today, the correct fix (new code) is more disruptive.
  This decision should be made before implementation.

## Depends On
Independent. Should be done alongside H2 and H3 to complete the fault table cleanup
in a single pass.
