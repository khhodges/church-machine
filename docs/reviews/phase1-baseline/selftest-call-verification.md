# Selected Phase 1 SelfTest CALL and status evidence

Date: 17 October 2026. Requirements: **RES-SelfTest / SIM-05**.
Status: **bounded simulator evidence established; startup qualification remains open**.

Authority is the [approved target](approved-target-namespace.md) and the frozen
[selection evidence](selftest-api-identity-evidence.json), not the current
manifest, sidecar, repository example or historical `ns-state.json`.
This extends **BASE-07**, without replacing its historical freshness observation.
Raw results: [selftest-call-evidence.json](selftest-call-evidence.json).
Reproducer: `node scripts/probe_phase1_selftest.js`.
Regression: `node tests/simulator/test_phase1_selftest_call.js`.

## Exact input and entry inspection

The inspected selection remains **SelfTest, Resident, slot 6, sequence 0,
not boot**; selected filename `SelfTest.1.8b19abd7.lump`, recorded revision
metadata 98. Revision metadata comes from the frozen selection, not from
executable interpretation or current catalog activity.

Full binary SHA-256:
`65f6e254b1f0a164f2d2163239f28e4521d792d8d96800b26cdbff607f77b5de`.
The probe verifies that hash before interpreting or loading any word; missing
or changed bytes stop the probe rather than trigger reselection/recompilation.

All word offsets are zero-based **within the LUMP**, including its header.
Simulator logical PC is word offset minus one.

| Word | Bytes / meaning |
|---|---|
| 0 | `fa87d001`: 2048 words, cw=500, cc=1 |
| 1 | `00000002`: legacy numbered-method entry, target LUMP word 2 |
| 2 | `af084000`: `IADD DR1, DR0, #0` |
| 3 | `070b0000`: `LOAD CR1, CR6[0]` (SELF) |
| 499 | `af084000`: explicit successful result write, DR1=0 |
| 500 | `1f000000`: RETURN |
| 2047 | `4a000006`: SELF E capability for slot 6, sequence 0 |

The current simulator's numbered CALL decoder accepts a positive bare entry
bounded by cw, translating it to logical PC = entry minus one. Thus method 1
reads word 1 = 2 and enters logical PC 1 / LUMP word 2. It does **not** execute
the bare entry as a LOAD, require a BRANCH-encoded table, or consult the API
method array to dispatch this legacy binary.

No source was compiled or compared to infer this result. The probe derives
the 84 conditional-branch / failure-write / RETURN triples directly from
selected executable words. Status codes cover 1–81; tests 17, 34 and 39 each
have two independently reachable guards. Every failure write is an immediate
IADD to **DR1**, not DR0, followed by RETURN. Each passing branch skips those
two words. Exact locations and words are retained in `statusExits`.

## Three separate findings

| Question | Evidence and conclusion |
|---|---|
| Identity/API | Still defective: the exact embedded API names `RunAbstraction`, declares `methods:[]`, and claims DR0 as the return register. The bytecode instead uses DR1 for status. Successful dispatch does not correct any of these API facts or establish admission. |
| Method-entry compatibility | **Method 1 is compatible with the current ChurchSimulator** for these exact bytes. Synthetic caller word `17000001` enters slot 6 / word 2. Method 2 is not a callable entry: `17000002` reads ordinary instruction `af084000`, faults `INVALID_OP`, and never executes the body. Empty API methods therefore neither prove incompatibility of method 1 nor authorize arbitrary numbered methods. |
| Diagnostic execution and reporting | Natural run returns after 332 total steps including CALL and RETURN; all 84 guards take their pass branches, then word 499 writes zero to DR1. Independently forcing each guard to fail yields 84 genuine returns with the expected nonzero DR1 code retained at the caller. DR0 remains zero. |

### Natural run

The caller resumes at slot 60, logical PC 1 (the instruction after CALL).
Its protected stack offset returns to 241. The fixture's initial host mirror
shows 243, but CALL reads protected Thread state 241, pushes to 239, then
RETURN restores 241. The assertion uses that protected value, not the stale
synthetic boot-helper mirror. This is not a claim that a live boot fault was
found or fixed.

All branch flags and target words, the terminal status write, and the actual
RETURN pre/post state are retained. A zero DR1 alone is never the verdict:
completion also requires a real RETURN, the caller continuation and restored
protected stack state, without a fault.

### Failure controls

Each control starts a new isolated simulator, runs the same selected bytes
through CALL method 1, and changes **only condition flags** immediately before
one derived guard, making its passing branch not taken. Earlier guards execute
normally. No instruction, PC, capability, API, SELF or saved artifact is patched.

For every control the report retains:

- exact guard word, original flags and injected flags;
- skipped passing branch and next word (the failure write);
- attempted DR writes **and actual retained values**, including zero-register
  cleanup writes, without suppressing, redirecting or repairing them;
- failure RETURN word, DR0/DR1 before and after return, caller slot/PC and STO.

For example, guard word 35 normally passes test 1. With its passing condition
forced false, word 36 (`af084001`) writes and retains DR1=1; word 37 returns,
and the caller receives DR1=1. The same procedure covers all 84 guards,
including the second guards for codes 17, 34 and 39.

These controls establish failure-path observability, not independent proof
that every arithmetic/permission condition is correct against the ISA.
The injected flags are explicitly synthetic, not naturally observed failures.

The method-2 negative control captures the fault **before host recovery**.
DR1 happens to be zero then; the recorded termination is FAULT, not success.
No arbitrary fault is treated as a continuation.

## Isolation and acceptance boundaries

The binary is copied to an OS temporary directory, hash-checked there and
loaded into private simulator memory at slot 6 without rewriting any word.
The synthetic caller is at slot 60; simulator setup supplies a private Thread.
This exercises real fetch/decode/CALL/body/RETURN, but **not** the approved
Phase 1 Namespace, selected CapabilityTest caller, boot preparation, an IDE
admission flow, or a live simulator session.

The approved **CapabilityTest boot slot 10 remains unchanged**. No replacement
SelfTest, approval record, Namespace design, image or source revision is
generated or selected. No network/device command, live activation, installation,
RTL generation, build, flash or hardware action is performed.

Every selected word is compared after each run, including embedded metadata
and SELF. Before/after inventory covers **1214 existing files** under
`server/lumps` plus the existing boot configuration, including saved selection,
binary, manifest, approval and image files; all remain unchanged. Temporary
input copies are removed even on failure. Raw evidence records the inventory
digest and hashes of the probe, frozen pin and loaded simulator dependencies.

| Acceptance area | Result |
|---|---|
| RES-SelfTest bounded simulator entry/status behavior | Evidence established for the exact selected hash and method 1 |
| RES-SelfTest identity/public API and complete startup behavior | **Needs verification / correction**; not closed |
| SIM-05 approved Phase 1 startup integration | **Needs verification**; synthetic caller is not exact boot integration |
| RTL / generated image / physical board | **Not exercised; not qualified** |

The strict source/entry freshness guard was not weakened or rerun. Its
historical format-drift observation is compatible with this legacy entry
working in the current simulator. It is not a reason to silently replace
the selection, nor a qualification of another consumer.

## Verification

- `node tests/simulator/test_phase1_selftest_call.js`: passed; natural run,
  84 distinct forced-failure returns, method-2 rejection, changed/truncated
  selected-input rejection and unchanged saved files.
- `node scripts/probe_phase1_selftest.js`: passed; generated the linked evidence.
- `python3 -m pytest tests/server/test_phase1_selftest_api_identity.py -q`:
  **12 passed**.
- Read-only preview capture: connection refused because the IDE was not
  serving. No server was started and no UI acceptance is claimed. This task
  changes offline evidence/tests only.

The [identity correction proposal](selftest-api-correction-proposal.md) remains
unapplied. Any subsequent candidate needs exact-source/API provenance, an
explicit old/new executable comparison and separate adoption authority.
