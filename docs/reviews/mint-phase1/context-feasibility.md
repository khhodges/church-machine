# Mint protected-context feasibility — bounded result

**2026-10-17 · Source inspection and isolated synthetic execution only.**

Baseline: [README](README.md), [implementation plan §§3–4](implementation-plan.md),
and [G1–G3](open-issues.md). No policy is superseded. This is an investigation
deliverable, **not closure of W1, G1, G2 or G3**, nor a working Mint service.

## Result

**The inspected architecture does not provide a demonstrated legal software
path for the complete contract.** Protected CALL records supply useful
machine-owned evidence, but Mint cannot treat their existence as permission to
read them, and PkVerify cannot treat its immediate caller as Mint's requester.
There is also an executable Lambda entry/continuation mismatch.

| Gate | What is feasible with inspected mechanisms | What is still blocked |
|---|---|---|
| G1 | CALL records caller E; ordinary RETURN validates it; masks can retain an existing CR1; Lambda preserves capability scope | A legally provisioned same-artifact internal X entry, consistent validated Lambda continuation, and authorized creation/materialization of a new result capability |
| G2 | Machine-owned caller E survives nested CALL in protected memory | Service-facing attestation, original-admission binding, and protected E-identity→hierarchy/configuration mapping |
| G3 | Bounded validation of one presented ordinary return frame is reusable evidence | Non-mutating complete traversal/enumeration of all live/suspended contexts, Lambda representation, and exclusion until publication |

**Do not implement a Mint workaround.** No host `callStack`, broad Thread R cap,
widened CR5, external NSRW access, separate privileged Lambda LUMP, fabricated
descriptor, permissive verifier, or dependency guess is authorized.

## Evidence boundary and reproduction

Runtime sources were inspected at repository revision
`e20274f0e7f7d610f8dbd6be00a910bfe7f9d8a8`. The supplemental
[source fingerprints](context-source-hashes.sha256) freeze the files discussed
below; the original review's source fingerprints and Q&A digest remain intact.

Run from repository root:

```sh
python3 -m pytest tests/mint_phase1/test_context_feasibility.py -q
sha256sum -c docs/reviews/mint-phase1/context-source-hashes.sha256
python3 docs/reviews/mint-phase1/verify_review.py
```

Fixtures:
[shared raw words](../../../tests/mint_phase1/context-vectors.json),
[JS probe](../../../tests/mint_phase1/context_probe.js),
[Amaranth probes and comparator](../../../tests/mint_phase1/test_context_feasibility.py).
The Python suite invokes the JS probe once. Test RAM and register construction
are **harness privilege**, not legal service provisioning. No fixture imports
the server, opens a live image/catalog, uses secrets, sends network requests,
or operates hardware.

These are Amaranth **component simulations**, not generated-Verilog, full-core,
exact-bitstream or physical evidence. CALL and RETURN component benches stub
mLoad responses explicitly. The stale-token case injects a failed validation
response; it does not prove the RTL Namespace gate. JS uses its real in-memory
Namespace validation. A separate three-signal core-wiring slice reproduces a
Lambda latch timing problem; it is not a full-core test.

The tests intentionally assert the current mismatches. A green suite means
the bounded findings reproduced, **not that G1–G3 pass**.

Recorded run: **15 tests passed**. All 11 supplemental runtime fingerprints
matched; the documentation checker passed 124 local links/fragments, the
57-record Q&A digest, all 37 original source fingerprints and its independent
arithmetic checks. `git diff --check` passed. No application runtime was changed
or restarted, and no browser/hardware acceptance test was run.

## G1 — same-artifact Lambda and result path

Source: [ChurchLambda](../../../hardware/lambda_unit.py), CHECK_PERM/EXECUTE;
[ChurchReturn](../../../hardware/ret.py), IDLE/LAMBDA_FAST;
[core](../../../hardware/core.py), `u_lambda.nia_set`, `lambda_pc_reg`,
`u_lambda.saved_nia`, cLoad/return-mask wiring;
[simulator](../../../simulator/simulator.js), `_execLambda`,
`_readProtectedCallFrame`, `_execReturnCore`.

1. A normal X token resolves to the object's descriptor, not an arbitrary Mint
   label. RTL Lambda checks non-NULL and Turing X, then places **descriptor
   location** in NIA. It has no checked label-offset operand or method selector.
   A full-LUMP descriptor can therefore jump to the header. CALL's derived CR14
   applies a +4 code-base adjustment; that is not a general label-view grant.
   TPERM does not provide an internal-label location constructor. A manually
   modified location in a test register is not a legal linking mechanism.
2. JS validates X through mLoad, keeps CR6 and CR14 scope, pushes/caches a
   one-word protected Lambda continuation, changes STO and advances PC inline.
   RTL Lambda has no stack-write port. RTL RETURN's leaf path instead takes
   `lambda_pc`, requires current CR14 Inform X, and requests same-code cLoad.
   It does not read/pop the JS Lambda frame. The fixture shows these different
   state transitions for the same instruction/GT words.
3. The inspected core drives `saved_nia = nia_reg + 4`, updates `nia_reg` when
   Lambda asserts `nia_set`, and captures `saved_nia` on Lambda COMPLETE.
   In the isolated wiring slice, acceptance NIA=4 and target=2048 produce saved
   continuation **2052**, not **8**. This is additional bounded failure evidence,
   not a proposed new continuation convention or a full-core acceptance result.
4. `LAMBDA_FAST` does not independently validate a saved continuation against
   the original entry bounds. Later cLoad/fetch checks cannot establish that the
   saved value was the original wrapper continuation. Nested CALL clears the
   core's leaf latch; the JS one-word continuation remains a different model.
   Mint's planned dispatcher must remain a leaf, but that restriction alone
   does not fix entry, capture or validation.
5. RETURN masks retain **current** CR values. Mask `0x002` can retain CR1;
   it cannot turn DR bits into a capability. The JS probe proves retention
   of an already present capability; RTL probe proves accepted-mask latching.
   Core/register-bank cleanup and cLoad completion are not exercised by these
   component probes. The proposed private RW/L result-cell alias still grants
   capability-manufacturing power and requires explicit provisioning approval.

**Disposition:** no new binding, opcode, internal X alias, return-frame format
or result-cell alias is selected here. Settle the Master ISA's explicitly open
Lambda-continuation oracle, then demonstrate the approved entry and return
with real linking, cLoad/fetch bounds and result LOAD. Correct capture timing
under that contract; do not use a host return stack to hide it.

## G2 — original requester without raw Thread access

Source: [ChurchCall](../../../hardware/call.py), READ_CALLER_CR6,
STACK_WRITE_EGT/STACK_WRITE_FRAME/STACK_UPDATE_SP;
[stack arithmetic](../../../hardware/stack_frame.py);
[ChurchReturn](../../../hardware/ret.py), VALIDATE_COMPANION/VALIDATE_FRAME;
simulator `_execCallCore`, `_deriveEnterCompanionGT`, `_readProtectedCallFrame`.

The ordinary CALL companion is normalized from **the caller's CR6 identity**
to Inform Church E before switching to callee scope. It is not the target
CR0, a caller DR, a public name, or the Owner field of an Abstract PassKey.
RETURN revalidates it and reconstructs context rather than trusting diagnostic
host snapshots.

The shared fixture starts with STO=241, caller slot 2, synthetic Mint slot 3,
and verifier slot 4 (test labels, **not live Phase 1 slot assignments**).

| Transition | Protected companion | Frame word | New STO |
|---|---|---|---|
| requester→Mint, PC 1 | `4a000002` at Thread[240] | `000050f1` at [241] | 239 |
| Mint→PkVerify, PC 2 | `4a000003` at Thread[238] | `000070ef` at [239] | 237 |

JS and RTL CALL write identical words in companion→frame→indicator order.
RTL memory addresses are bytes; JS RAM addresses are words. Ordinary return
PC 2 corresponds to RTL NIA offset 8 in the component fixture. This does not
claim complete integrated code-base/absolute-NIA equivalence.

The lower record still names the requester; the top record names Mint.
Returning first to Mint, then the requester works in JS even after a forged
diagnostic shadow and then deletion of the shadow. Caller-supplied DR identity
does not select the companion. **None of this exports an attestation to Mint.**
Repeated RETURN is a destructive transfer, not a read-only query.

The permission-free Thread GT does not grant DREAD: the same synthetic read
of Thread word 17 fails before RTL memory access. JS calls this PERMISSION;
RTL reports PERM_R. Protected STO is outside the declared heap. That geometry
does **not** prove resistance to every broader alias; no such alias is granted
or used here. The separate owning-Thread heap-access question remains separate.

`TPERM FRAME` is not an escape hatch: at most it supplies a predicate, not
identity, hierarchy or chain coverage. Its current JS branch uses `callStack`,
which is explicitly disallowed as Mint authority. The inspected
[RTL TPERM](../../../hardware/tperm.py) takes a `stack_has_frame` input and
exports no caller evidence.

**Minimum proposed authority, NOT APPROVED:** a protected context producer
captures the validated outer Mint caller once, binds it to Namespace/configuration,
one admission and an immutable request, and resolves hierarchy through a
Genesis-controlled mapping. Mint→PkVerify passes only a protected, scoped
attestation; neither service receives raw frames, arbitrary offsets or a
reusable general Thread-read capability. Identical public words must not pass.
Capture must precede nested calls; replay, changed configuration, mismatched
request, missing mapping and stale E validation must hard-fault. Exact transport,
representation, storage, bounds and ABI remain to be designed and approved.

## G3 — live-return dependency access

Single-frame validation is not an all-context scan. The fixtures include a
distinct synthetic suspended image whose pending caller is absent from the
active Thread's non-root frames. No host history is needed to RETURN from the
presented image. A malformed suspended frame faults without advancing STO.
This is **not** execution of CHANGE or a service enumeration API.

The shared ordinary-frame cases exercise valid return, poison root, missing
companion, non-E companion, corrupt predecessor and stale identity. Invalid
cases make no RETURN memory/NIA commit. JS and RTL fault labels differ; the
suite compares accept/reject and mutation boundaries, not numeric fault parity.
The protected predecessor/address relation prevents these malformed links from
being accepted. It does not prove arbitrary whole-chain validation.

| Producer/lifecycle | Source-grounded obligation for a future complete check |
|---|---|
| CALL / RETURN | Include every pending E identity, resolved code and C-list, continuation and active code. Inspect without popping; validate generations, geometry and termination. |
| Lambda entry/exit | First settle the divergent latch/one-word-frame model; include its active and suspended continuation dependencies, not just E companions. |
| CHANGE / hardware Thread switching | [change.py](../../../hardware/change.py) saves outgoing E/frame/indicator and validates incoming context; simulator `_execChangeCore` has its own save/restore path. Account for both incoming and outgoing images and hidden active state. |
| SWITCH | [switch.py](../../../hardware/switch.py) changes root and enters destination context; simulator `_execSwitch` is separate. Scope the inventory to authenticated configuration/root identity, not reused slot numbers. |
| Boot, context creation, suspension and retirement | Enumerate all configured live/suspended contexts and active roots from protected lifecycle authority. Treat canonical poison roots as terminators, not usable return targets. Do not infer absence from an empty host stack. |
| Fault/reset and publication interval | Invalid/missing/unreadable context hard-faults, never means “unused.” No activation/new frame/root change may invalidate a successful check before publication; this needs G4, including non-software actors. |

**Minimum proposed authority, NOT APPROVED:** bounded protected traversal
returns only a target-use veto / admission-bound clearance, not raw stack data.
A clearance is usable only for the exact target incarnation and the same
enforced exclusion interval; it is not a reusable boolean certificate.
Complete context inventory, corruption behavior, no-side-effect validation,
worst-case bounds/watchdog budget, and lifecycle exclusion must be demonstrated.
No scanner is implemented. A continuously maintained dependency index would
add more trusted machinery and is not recommended as an unreviewed shortcut.

## Approval boundary and next evidence

**Approval status: pending; no new authority granted.**

Recommended next decision: whether to authorize designing the narrow protected
caller-attestation and live-use-check interface above, explicitly excluding raw
Thread access. That does not approve an opcode, ABI, hierarchy registry,
provisioning key, alias or TSB implementation. Bring those concrete details back
for approval before implementation. Resolve Lambda representation/entry as a
separate consequential ISA/binding decision; do not infer it from this decision.

Still required after decisions: legal loader/alias authority, integrated
CALL→Mint→Lambda→PkVerify→RETURN tests with real gates, original-requester
spoof/replay rejection, complete lifecycle inventory and scan→publication race
tests. Generated RTL, exact builds and physical tests remain NOT RUN.

No residency, source draft, operational service, production setting, live
Namespace, LUMP, image or hardware was changed. This is not a legacy Mint
C-list test and does not revisit HARDFAULT candidate selection.
