# H1 — CR15 boot limit = 18 vs NS_SLOT_COUNT = 8

## Priority
**High** — The inconsistency is architecturally confusing and allows programs to
attempt NS accesses to uninitialised slots 8–17, producing a SEAL fault instead of a
cleaner BOUNDS fault. It also silently signals that the runtime expects to extend the
namespace to 18 slots, which is unconfirmed.

## Root Cause
`hardware/core.py`, `LOAD_NS` state, line ~869:
```python
boot_cap_wr_data.eq(Cat(C(0x02000000, 32), C(0, 32), C(18, 32)))
#                                                        ^^ limit_offset
```
`word2_w2 = 18` is hardcoded. `hardware/boot_rom.py` defines `NS_SLOT_COUNT = 8` and
initialises exactly 8 slots. The mLoad bounds check (`slot_id < limit_offset`) passes
for any slot 0–17. Slots 8–17 are zeroes in DMEM; the integrity32 gate fires SEAL.

## Two Valid Interpretations

### Interpretation A — Bug: limit should be 8
The 18 was carried over from an older prototype that had 18 slots. Fix: set
`word2_w2 = NS_SLOT_COUNT` in `core.py`. Accessing any uninitialised slot now
produces `BOUNDS` rather than `SEAL`.

### Interpretation B — Design intent: reserve space for runtime extension
The runtime can dynamically add NS slots up to index 17 by writing valid entries to
DMEM words 32–67 (the reserved zero zone). The limit of 18 is intentional headroom.
If this is the design intent, it must be documented explicitly and the DMEM init
layout must zero the headroom deliberately (it already does).

## Decision Needed
Before implementing, confirm which interpretation is correct. The task description
below assumes **Interpretation A** (limit = NS_SLOT_COUNT = 8), which is the safer
and more conservative default. If Interpretation B is chosen, the fix is different
(document the headroom, keep limit=18, add a comment in `core.py`).

## Files to Change (Interpretation A)

| File | Change |
|------|--------|
| `hardware/hw_types.py` | Confirm `NS_SLOT_COUNT = 8` is exported from here (or from `boot_rom.py`) |
| `hardware/core.py` | Replace `C(18, 32)` with `C(NS_SLOT_COUNT, 32)` in the `LOAD_NS` state |
| `hardware/test_ns_limit.py` | New: simulation test verifying that accessing NS slot 8 produces `BOUNDS` after the fix |

## Files to Change (Interpretation B — documentation only)

| File | Change |
|------|--------|
| `hardware/core.py` | Add comment: `# 18 = max NS entries; only 8 initialised; runtime may add more` |
| `hardware/boot_rom.py` | Add comment explaining headroom above `NS_SLOT_COUNT = 8` |

## Acceptance Criteria (Interpretation A)
1. Amaranth simulation: accessing NS slot 8 via `LOAD CR0, CR_CLIST[8]` produces
   `FaultType.BOUNDS`, not `FaultType.SEAL`.
2. Accessing slot 7 (last valid slot) succeeds without fault.
3. The `NS_SLOT_COUNT` constant is the single source of truth for both the boot FSM
   limit and the `DEMO_NAMESPACE` build loop.
4. Existing boot tests still pass (no regression from the limit change).

## Risks
- If any existing test or boot program relies on slots 8–17 being accessible (even to
  SEAL-fault on them), tightening the limit to 8 will produce BOUNDS instead. Grep
  for `ns_slot` values > 7 in all test files before merging.
- On the Ti60, the boot FSM also uses `C(18, 32)`. If the Ti60 runtime relies on the
  18-slot headroom, the fix must only target the Wukong path or be made conditional
  on a parameter.

## Depends On
Independent. Can be resolved before or after C1–C3.
