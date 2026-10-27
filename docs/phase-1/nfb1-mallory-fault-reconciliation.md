# NFB1 — Mallory fault-mechanism reconciliation

## Finding

**The retained Mallory instruction is rejected at the source capability's
C-list bounds check. It does not reach a target RW object's data-access check.**

This is a capability-bounded access denial, but it is not evidence that a
permission check on a fetched target capability or a read/write of the RW
object was exercised. The distinction must be explicit in the tutorial.

No runtime code, saved image, or physical hardware was modified. Two isolated
current-RTL tests were added and passed. Historical evidence and fresh model
results are distinguished below.

## Exact retained inputs

Evidence directory:
`docs/phase-1/reload-evidence/new-layout-amoeba-runtime/`

- `candidate-le.bin`: 65,536 bytes.
- Verified SHA-256:
  `2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451`.
- `physical-runtime-reload-status.json`: retained correlated, CRC-valid
  reason-2 snapshot.
- `full-program-result.json`: retained model endpoint and fault-source result.
- `production-executable-replay-program.json`: retained production-executable
  replay reporting the same fault code and address.

The historical [physical reload report](installed-image-reload-result.md)
records BOUNDS `0x08` at byte NIA `0x2e08`, including trace counters 38/39.
The observed instruction word in the retained candidate is `0x070b0020`,
mapped in the retained report to **`LOAD CR1, CR6, #2`**.

| Evidence | Value |
| --- | --- |
| Mallory Namespace slot | 17 |
| Mallory allocation base | word 2944 / byte `0x2e00` |
| Header at that base | `0xf8801002`; C-list count = 2 |
| Faulting instruction | byte `0x2e08` |
| Snapshot CR6 GT | `0x4a000011` |
| Snapshot CR6 location | `0x2ff8` |
| Snapshot CR6 inclusive limit | 1 |
| Requested C-list index | 2 |
| Legal C-list indices | 0 and 1 |
| Retained model source | `mload: 1`, stage 7 |

The snapshot's DR0 is zero, consistent with the compact instruction's
effective index of 2. The retained model reports CR6 as the same three-word
capability. The candidate's two C-list words are `0x4a000011` at `0x2ff8`
and `0x32000011` at `0x2ffc`.

The would-be index-2 read address is `0x3000`, outside this two-entry C-list.
Do not confuse that calculated address with an observed memory read.

## RTL check sequence

Current `hardware/load.py` first latches the LOAD operands and checks
structural destination restrictions. CR1 is not a prohibited structural
destination in this case. It then delegates to `ChurchMLoad`.

Current `hardware/mload.py` follows:

1. **FETCH_SRC:** capture the source CR capability.
2. **CHECK_L:** reject a NULL source or inadequate L authority, accounting
   for the normal CR6 L authorization. This is not Namespace M elevation.
3. **CHECK_BOUNDS:** evaluate the inclusive source-capability limit:
   `index <= limit`.
4. **FETCH_GT:** read the target GT only if the preceding checks succeed.
5. **CHECK_NS / Namespace gate:** validate the fetched target descriptor,
   including the applicable version/seal checks.

For the captured operands, `2 <= 1` is false. CHECK_BOUNDS raises BOUNDS
before FETCH_GT, so no target capability is read. Its downstream Namespace
gate is not entered for this request.

Thus the answer to the review's “before or as the capability check?” question
is **not an exclusive choice**:

- It is **a capability check**: the bounds carried by the source CR6
  capability constrain which C-list entry may be accessed.
- It is **before the target-capability checks**: there is no successful
  target fetch, target version/seal validation, or target RW data access.
- It follows the source NULL/L checks; it is not evidence that all capability
  checks were bypassed or never consulted.

Source comments anticipating NO_CAPABILITY do not describe this endpoint.
This report explains the observed implementation outcome; it does not
independently approve an ISA change or rewrite historical source comments.

## Fresh isolated replay

Command:

```sh
python3 -m pytest tests/hardware/test_mallory_fault_reconciliation.py -q --disable-warnings
```

Result: **2 passed**.

The tests verify the retained image hash, instruction, C-list count, and
CRC-valid snapshot operands before driving the current mLoad RTL:

| Case | Result |
| --- | --- |
| Captured CR6, index 2, normal CR6 L authorization, no Namespace M elevation | BOUNDS; zero memory-read requests, zero memory writes, zero CR writes before fault |
| Same CR6, index 1 | Reaches GT fetch at `0x2ffc`; no fault before that fetch |

The second case is a positive control for the bounds stage, not a claim that
the complete in-range LOAD or target Namespace validation succeeds.

These tests exercise mLoad, not a whole-program replay, Thread continuation,
the physical loader, or a newly programmed FPGA. The snapshot and older model
provide correlation; the fresh unit replay explains the boundary mechanism.

## Physical-evidence limits

The retained board trace and snapshot agree with the retained model's endpoint
and the current mLoad replay. However:

- The prior board's build number 20 is reused and is not an exact bitstream
  identity attestation.
- The prior report describes operator-attested bitstream installation, not
  configuration readback.
- Full installed RAM equality was not established.
- Physical telemetry does not expose every internal mLoad state or prove
  the complete absence of unrelated writes throughout the full execution.

Therefore the internal check ordering is established by source inspection
and isolated RTL evidence consistent with the recorded board result, not by
a new internal hardware capture. Exact NFB1 physical acceptance remains open.

## Consequence for the tutorial

The truthful explanation for this retained example is:

> Mallory tries to load a capability from C-list entry 2. Its CR6 permits
> only entries 0 and 1. The machine reports BOUNDS before fetching another
> capability or carrying out a target-object read/write.

Do not label this as a NO_CAPABILITY fault, a failed target RW permission
check, or proven corruption of the RW object.

The intended “one RW object in Mallory” lesson can explain the distinction
between possessing a data object and acquiring authority through a bounded
C-list. If NFB1 is to demonstrate an actual attempted RW-object operation
instead, that needs a deliberately authored additional case with its exact
instruction, capability, boundary and expected check approved and tested.
No such new instruction or grant was introduced here.

The proposed continued Thread execution, Amoeba stop-polling, MTBF escalation,
and corrected-Mallory adoption remain NFB1 implementation requirements.
This investigation does not retroactively turn the historical fault-stop
into proof of those behaviors.

## Disposition

The recorded BOUNDS mechanism is reconciled at the retained-model/current-RTL
level. The tutorial can now describe this C-list denial precisely.
Design-owner approval of that explanation, any additional RW-access case,
and exact-build physical acceptance remain separate gates.
