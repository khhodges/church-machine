# H2 — FaultType IRQ_NULL_BASE (0x14) Missing from Simulator

## Priority
**High** — When hardware fires fault code `0x14`, the simulator's fault decoder
displays an empty/unnamed entry. Developers see a numeric fault code with no
explanation, making fault diagnosis in the IDE painful.

## Root Cause
`hardware/hw_types.py` defines:
```python
IRQ_NULL_BASE = 0x14
```

`simulator/simulator.js`, `ChurchSimulator.FAULT_CODES`, has no entry for `0x14`.
The hardware can fire this code when the IRQ dispatch unit finds that the IRQ base
vector (the NS slot registered as the interrupt handler entry) is a NULL GT. The
simulator produces a gap in the fault table between `STACK_UNDERFLOW = 0x13` and
`OUTFORM_CRC = 0x15`.

## What `IRQ_NULL_BASE` Means
The three-tier fault recovery (documented in `docs/instruction-set.md § Three-Tier
Fault Recovery`) uses a scheduler IRQ slot. If that slot contains a NULL GT when an
IRQ fires, the hardware emits fault code `0x14`. The fault name should convey:
"the IRQ dispatch base vector was NULL — no interrupt handler installed."

## Files to Change

| File | Change |
|------|--------|
| `simulator/simulator.js` | Add `IRQ_NULL_BASE: 0x14` to `ChurchSimulator.FAULT_CODES` between `STACK_UNDERFLOW` and `OUTFORM_CRC` |
| `simulator/assembler.js` | If `assembler.js` has its own fault table, add the same entry there |
| `docs/isa_reference.md` | Add `IRQ_NULL_BASE = 0x14` to the fault-type table in § 9 |

## Exact Diff (simulator/simulator.js)
Locate the block around line 7544:
```js
STACK_UNDERFLOW: 0x13,
// --- gap at 0x14 ---
OUTFORM_CRC: 0x15,
```
Change to:
```js
STACK_UNDERFLOW: 0x13,
IRQ_NULL_BASE: 0x14,
OUTFORM_CRC: 0x15,
```

## Human-Readable Label
The IDE displays fault names to the user. The label for `IRQ_NULL_BASE` should be:
> "IRQ handler not installed (null base vector)"

If the simulator translates fault codes to user-visible descriptions in a separate
map (e.g. a `FAULT_DESCRIPTIONS` object), add the same entry there.

## Acceptance Criteria
1. `ChurchSimulator.FAULT_CODES.IRQ_NULL_BASE === 0x14` evaluates to `true` in the
   browser console.
2. No existing test or simulator code is broken by the addition.
3. `docs/isa_reference.md` fault table includes `IRQ_NULL_BASE = 0x14`.
4. The IDE fault panel displays "IRQ handler not installed (null base vector)" when
   fault code 0x14 is received from hardware.

## Risks
- Low risk. This is a purely additive change to a lookup table.
- Verify no other fault code between 0x13 and 0x15 exists in either hardware or
  simulator before inserting; the audit found the gap is exactly at 0x14.

## Depends On
Independent of all other items. Trivial size. Can be done in under an hour.
