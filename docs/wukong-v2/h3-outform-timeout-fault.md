# H3 — FaultType OUTFORM_TIMEOUT (0x19) Missing from Simulator

## Priority
**High** — Same class of problem as H2. When hardware fires fault code `0x19`, the
simulator's fault decoder shows an unnamed entry.

## Root Cause
`hardware/hw_types.py` defines:
```python
OUTFORM_TIMEOUT = 0x19
```

`simulator/simulator.js`, `ChurchSimulator.FAULT_CODES`, ends at `OUTFORM_HDR = 0x18`
with no `0x19` entry. The hardware fires `0x19` when an Outform operation (capability
minting / output formation) times out waiting for the Outform FSM to complete.

## What `OUTFORM_TIMEOUT` Means
During an Outform flow, the hardware waits for an external Outform FSM to signal
completion. If the FSM does not respond within its deadline, the hardware aborts and
raises fault `0x19`. The fault name should convey:
"the Outform (capability minting) operation timed out."

## Files to Change

| File | Change |
|------|--------|
| `simulator/simulator.js` | Add `OUTFORM_TIMEOUT: 0x19` to `ChurchSimulator.FAULT_CODES` after `OUTFORM_HDR` |
| `simulator/assembler.js` | If `assembler.js` has its own fault table, add the same entry |
| `docs/isa_reference.md` | Add `OUTFORM_TIMEOUT = 0x19` to the fault-type table in § 9 |

## Exact Diff (simulator/simulator.js)
Locate the block around line 7545:
```js
OUTFORM_HDR: 0x18,
```
Change to:
```js
OUTFORM_HDR: 0x18,
OUTFORM_TIMEOUT: 0x19,
```

## Human-Readable Label
> "Outform timed out (capability minting did not complete)"

## Acceptance Criteria
1. `ChurchSimulator.FAULT_CODES.OUTFORM_TIMEOUT === 0x19` evaluates to `true`.
2. `docs/isa_reference.md` fault table includes `OUTFORM_TIMEOUT = 0x19`.
3. IDE fault panel displays the human-readable label for fault 0x19.
4. No existing test is broken.

## Cross-Check: Full Fault Table After H2 + H3
The complete hardware fault table from `hw_types.py` should map 1-to-1 with the
simulator after both H2 and H3 are applied:

| Code | Name |
|------|------|
| 0x00 | NONE |
| 0x01 | PERM_R |
| 0x02 | PERM_W |
| 0x03 | PERM_X |
| 0x04 | PERM_L |
| 0x05 | PERM_S |
| 0x06 | PERM_E |
| 0x07 | NULL_CAP |
| 0x08 | BOUNDS |
| 0x09 | VERSION |
| 0x0A | SEAL |
| 0x0B | INVALID_OP |
| 0x0C | TPERM_RSV |
| 0x0D | DOMAIN_PURITY |
| 0x0E | BIND |
| 0x0F | F_BIT |
| 0x10 | STACK_OVERFLOW |
| 0x11 | ABSENT_OUTFORM |
| 0x12 | STACK_CORRUPT |
| 0x13 | STACK_UNDERFLOW |
| 0x14 | IRQ_NULL_BASE ← added by H2 |
| 0x15 | OUTFORM_CRC |
| 0x16 | OUTFORM_ALLOC |
| 0x17 | OUTFORM_MINT |
| 0x18 | OUTFORM_HDR |
| 0x19 | OUTFORM_TIMEOUT ← added by H3 |

## Risks
- Low risk. Purely additive change to a lookup table.
- Resolve alongside H2 in the same commit to keep the fault table in sync.

## Depends On
Independent. Can be bundled with H2 in a single commit.
