# CTMM / W7 — revised Phase 1 and Phase 2 test plan

**Review baseline: 29 October 2026.** Incorporates the owner's supplied methodology
review. This is a test-plan revision, not new test evidence, an ISA change, or
authorization to install images, flash hardware, or implement unresolved designs.

## 1. Governing security argument

**Correct execution is not complete security qualification.** The structural
argument has two co-equal obligations:

1. **Complete mediation:** every route to protected memory, authority, execution
   ownership or device effects is subject to the specified check, or is explicitly
   identified as a trusted provisioning route outside the evaluated attacker model.
2. **Correct grants:** initial and subsequently issued authority, including
   privileged interfaces, is no broader than the approved application policy.

A faithfully enforced over-broad grant can defeat confinement without a hardware
defect. Therefore a mediation proof cannot substitute for the grant audit.
Grant correctness is an application/provisioning obligation, not a new hardware
policy that assigns meaning to GTs or automatically repairs programmer choices.

For each claim record: **mechanism → invariant → reviewed route inventory →
grant policy → coverage argument → tests → exact evidence → residual limits**.
Tests support this argument; green-cell counts do not constitute it.
Finite-state proofs are possible for bounded models, not automatically tractable
for the entire machine. State each proof's abstraction and assumptions.

## 2. Fixed scope and result reporting

Keep **claim classification**, **execution status**, and **evidence level**
in separate fields. Passed/Partially evidenced depend on results and cannot
honestly be assigned before running tests. Required/Deferred/Trust assumption/
Fundamental limitation describe the claim's scope or nature and are fixed now.

- A required claim can be Not run, Blocked, Failed, Partially evidenced or Passed.
- Deferred is not Passed. A trust assumption or fundamental limitation is not a
  test success and must not contribute to a pass percentage.
- A failed or inconvenient required test cannot be relabelled as a limitation.
- A failed enforced boundary cannot be relabelled as administrator trust.
- Reclassification requires a dated owner-approved decision, rationale,
  affected claims and retained original disposition; never overwrite history.
- Planned Phase 2 contracts below are test objectives, not approved mechanisms.
  Missing numeric bounds or semantics block the affected gate until fixed before
  execution. No silently selected defaults, recovery policies or weaker oracles.

Phase 1 retains the all-Resident profile and the current Factory Build scope:
IDE/UART first, then Ethernet and standalone FPGA singletons. UART-only success
is not Phase 1 completion. Eviction/Lazy placement is not introduced by this plan.
Two-Namespaces-on-one-FPGA networking and remote invocation belong to Phase 2.
Phase 2 does not automatically authorize eviction or a different memory manager.

### W7 disposition

These dispositions split local and distributed claims without changing historical
Threat Map results. Required means required to claim closure of that objective;
unimplemented approved-scope mechanisms remain blocked, not implicitly deferred.

| ID | Phase 1 classification | Phase 1 closure objective | Phase 2 extension / disposition |
| --- | --- | --- | --- |
| W7-01 | Required testable | Authorized revoke; copied GT N sweep; destroyed objects; reuse/ABA and generation limits; stated cost bound | Remote stale copies and restart/reuse semantics; no implied global instantaneous revocation |
| W7-02 | Required testable | Separate no-authority, permission, type, identity and bounds cases across all mediated routes | Forged remote references, wrong destination and protocol inputs |
| W7-03 | Required testable | Enumerate production roots, dynamic grants, debug/readback and privileged ingress; prove exclusion or authorized mediation | Remote administration and endpoint authority audit |
| W7-04 | Required testable | Birth-authority census and subsequent issuance; approved requester and privileged-service policy | Explicit delegation and attenuation across Namespace boundaries |
| W7-05 | Required local testable; distributed subclaim deferred | Exact local seal/type/identity oracle and unauthorized unseal rejection | Qualified Namespace pairs and authenticated remote envelopes |
| W7-06 | Required testable | Approved memory, CPU and service bounds; neighbor progress under exhaustion; no assumed GC/eviction | Per-endpoint quotas, message floods and resource amplification |
| W7-07 | Required resident persistence testable | Authority-preserving approved save/install/reset lifecycle; retained-state contract | Remote persistence/restart; eviction remains outside scope unless separately approved |
| W7-08 | Required testable | Specify hard-fault/stop outcome and elapsed-time bound; depth sweep and exemption authority | Remote timeout/cancellation promises; distinguish containment from caller return |
| W7-09 | Required testable; implementation gated | One-shot retained checkpoint identity, copies, reset lifetime and consume/handoff atomicity | Replay across remote retries/restarts only if checkpoint transport is approved |
| W7-10 | Required testable; contract gated | Define permitted interference; whole-update exclusion and interruption behavior | Interleaved invocations, duplicate messages and partition/reconnect behavior |
| W7-11 | Required testable | Define originating principal and complete call-chain attribution | Authenticate and correlate principal/delegation across endpoints |
| W7-12 | Required bounded confinement testable | Enumerate callee storage/outward channels; verify only approved result interface; separately scope timing/covert channels | Trace cross-Namespace channels and remote deputies; no blanket noninterference claim |
| W7-13 | Fundamental limitation | No claim to decide whether arbitrary programs might divulge input; restricted confinement claims remain testable under W7-12 | Limitation remains; cannot close by adding networking tests |
| W7-14 | Trust assumption, with required boundary tests | Name manufacturing/toolchain/administrator powers and provenance assumptions; test exclusion of unauthorized access to those powers | Extend trusted endpoint/key/provisioning inventory; trust is not PASS |
| W7-15 | Deferred to Phase 2 | No Phase 1 distributed/remote-invocation closure claimed | Required Phase 2 tests after protocol, authority and failure contracts are approved |

The workbook's **Scope baseline** enumerates all existing 113 completeness rows,
not only these 15. Existing work status is retained. Non-W7 engineering and
documentation requirements remain required at their stated scope; no new
assumptions or limitations are introduced for convenience.

## 3. Method for establishing route-inventory completeness

The route inventory is itself a reviewed, fallible artifact—not proof by assertion.
The table below is its **seed**, not a claim that code has already been exhaustively
traced. Every row starts Unreviewed for coverage.

1. Freeze the candidate source, generated RTL, image, configuration and build
   hashes. Identify deployment modes, enabled/dormant interfaces and attacker
   access to each. A source symbol alone does not prove the mapped path exists.
2. Enumerate protected sinks first: data/Namespace memory, GT storage and issuance,
   Thread frames/ownership, checkpoint consume state, reset/start selectors, MMIO
   and external outputs. Trace every read/write/execute/control driver backward.
3. Independently enumerate ingress: every instruction family, reset pin, UART
   command/parser, installation FSM, debug/readback/snapshot path, privileged
   method, boot initializer and Phase 2 network endpoint. Trace forward to sinks.
4. Reconcile the two lists. Any sink driver without an ingress classification,
   or ingress with an unexplained effect, blocks inventory acceptance.
5. For each route retain exact source/RTL references, guard predicate, checked
   authority, latch/acceptance point, use/commit point, shared resources,
   intervening actors, rejected side effects and evidence IDs. Record all modes.
6. Enumerate intermediate states between check and use. Identify what can run,
   mutate or reset in each state, including alternate bus masters and diagnostics.
   Prove exclusion, immutable/latching validity, or revalidation as specified.
   Do not introduce retries, version updates or repair behavior to pass a test.
7. A named second reviewer checks omitted paths and counterexamples. Record
   reviewer/date/open questions. Unreachable/dormant claims require build-specific
   reachability or tie-off evidence, not an unused UI button.
8. Bind inventory revision to exact build hashes. Changed drivers, FSMs, grants,
   reset behavior or interfaces invalidate affected coverage and tests.

### Route inventory

| Route ID | Route / protected effect | Required mediation and negative evidence | Phase |
| --- | --- | --- | --- |
| R01 | Ordinary data read/write/execute and MMIO | Type, permission, live identity, range, side effects; every operand/address mode | 1 |
| R02 | Capability LOAD/SAVE, NULL and capability movement | No forgery or unintended authority; NULL discards destination authority under approved semantics | 1 |
| R03 | CALL/RETURN and service dispatch | Entry authority, method bounds, protected frames and exact continuation | 1 |
| R04 | CHANGE/SWITCH, root selection and Thread ownership | Admitted target, complete context, ownership transitions, all ownership writers | 1 |
| R05 | Boot ROM, initializer, cold/warm start | Exact approved image and entry; no stale roots or inherited unauthorized grants | 1 |
| R06 | Fault/watchdog capture, recovery and checkpoint restore | Fault precedence; protected evidence; authorized transitions; consume state not rollback-restored | 1 |
| R07 | Mint creation, replacement, destruction and credential issuance | Approved requester/proof policy; exact effects and grant census; no test-only bypass credited | 1 |
| R08 | GC/reuse, generation history and Cleaner publication | Destroy/reuse fence; no live stale authority or simultaneous usable owners | 1 |
| R09 | Installation/reload FSM, including dormant entry points | Hold excludes all interfering writers/execution through readback; fail closed on incomplete transfer | 1 |
| R10 | Memory readback and diagnostic observation | Explicit read authority; no unintended confidential exposure or state mutation; current-operation correlation | 1 |
| R11 | Snapshot/debug/trace paths | Every reader/writer classified; output disclosure and integrity bounds; no debug bypass of protected state | 1 |
| R12 | Raw UART, bridge and host command ingress | Enumerate opcodes/framing and delivery/replay; raw access cannot bypass approved control boundary | 1 |
| R13 | M6/reset pin and reset-related control writers | Defined actor/access assumptions; exact reset effects; no stale ownership or unverified start | 1 |
| R14 | IDE/compiler/save and selected-image authority | Exact bytes, revisions and grant decisions; stale requests cannot substitute an image or policy | 1 |
| R15 | Ethernet standalone evidence/control and singletons | Approved endpoint/control scope, journal retention, incident identity and continuity; no invented protocol | 1 |
| R16 | Two-Namespace messaging, delegation and remote administration | Every endpoint, parser, authority translation and reply path; wrong-peer/replay/restart denial | 2 |

Do not exclude readback from the security boundary merely because it is used to
verify installation. The observer can itself disclose or modify protected state.

## 4. Correct-grant audit

Produce a grant ledger per exact image and lifecycle state. Fields: principal,
object/service, capability/type/rights, issuing authority, provenance, approved
purpose, intended recipient, delegation limits, lifetime/revocation, reachable
outputs, and observed versus expected grant. Include derived/dynamic authority.

### Grant audit

| ID | Census / policy | Required evidence | Blocker |
| --- | --- | --- | --- |
| G-A | Boot and every Thread root/C-list | Expected versus installed grants; transitive reachability plus dynamic issuers | Missing root or assumed default authority |
| G-B | Object birth and first credential | Approved minimal rights; explicitly review Create-only / empty Replace-Destroy / Genesis-only admin policy against current contract | Review examples are not authority to provision that policy |
| G-C | Privileged services and deputy requests | Authorized requester, object-scoped proof where required, exact target and action; negative confused-deputy cases | Permissive test verifier or synthetic frame treated as production authorization |
| G-D | Mutation, reuse and revocation | Grants before/during/after destroy, reuse, reset and interruption | Old copies or historical generations become usable |
| G-E | Checkpoint and execution ownership | Holders, copies, consume state, protected metadata and reset lifetime | Ordinary fault recovery substituted for one-shot evidence |
| G-F | Debug, readback, reset, installation and administration | Actors permitted to invoke each route and exact information/effects exposed | “Trusted” actor implicitly grants all interfaces |
| G-G | Callee confinement | All persistent storage and outward authority; approved result interface; explicit timing/covert scope | Access checks misreported as whole-program information-flow proof |
| G-H | Remote delegation and endpoint identity | Sender/receiver grants, allowed attenuation, namespace identity, restart epoch/lifetime | Local grant copied into remote context without approved binding |

Hardware rejects violations of its architectural checks. The audit rejects a
candidate whose otherwise-valid grants violate the approved application policy.
These are distinct failure diagnoses.

## 5. First concrete slice: check-to-use reconciliation

These six families implement the requested cross-document reconciliation method.
They are planned analyses/tests, not findings that the listed mechanisms are safe.
Each needs a cut-point matrix of actors × intermediate states × protected sinks,
covering before-check, after-check/before-use, each multiword write, publication,
ownership commit and post-commit observation.

### Check-to-use families

| ID | Family and source | What might run in the gap | Required oracle / unresolved gate |
| --- | --- | --- | --- |
| C01 | Cleaner: mint-cleaner-gt-queues-proposal.md | Producer, consumer, allocator, debug reader, reset between validation and publication | No published object retains usable working authority; whole publication/exclusion and queue contract must be approved |
| C02 | Amobea: Amobea-V1.md | Another CHANGE/restore, pause/step, fault/reset between running/consume check and handoff | At most the specified execution owner; no second checkpoint restore; metadata not restored from history; running/consume contract gates execution |
| C03 | Reload: factory-build-verified-install-approval.md; guarded-runtime-loader.md | CPU, DMA/other writers, raw UART, installation FSM, reset during upload/readback/start | Hold spans entire approved operation; complete byte equality before Start; interrupted/mismatched transfer remains unverified and stopped |
| C04 | GC/reuse: mint-destroy-v1-development.md; mint-create-cut-points.md | Old GT copies and reallocation between identity validation and object use | No stale-generation access after approved revoke/reuse point; sweep wrap/history; restored-ABA evidence remains an open issue |
| C05 | Factory Build: factory-build-verified-install-approval.md | Readback/snapshot/debug, M6, UART and stale host commands between approval and activation | Selected revision, verified-installed image and execution identity stay bound; observer paths cannot silently mutate/disclose state |
| C06 | Three-Thread scenario: nfb1-starting-baseline.md; nfb1-mallory-fault-reconciliation.md | Alice/Mallory scheduling, privileged deputy, reset/recovery while a selected authority changes | Exact first fault and no unauthorized side effect; retain Alice evidence; no-capability, permission and BOUNDS cases remain distinct |

Required reconciliation output per family: document claims, actual frozen-code
paths, contradictory/missing contracts, proposed resolution for owner approval,
test fixture and oracle, and reviewer sign-off. An unresolved contradiction blocks
the affected claim; this plan does not silently choose one document's semantics.

### Mallory case matrix

| ID | Distinct case | Fixture and observable outcome | Must not substitute |
| --- | --- | --- | --- |
| M0 | No capability | Missing authorized reference; exact first denial and unchanged target | Current demonstration is supporting evidence for this case only |
| M1 | Insufficient permission | Otherwise-valid live GT; deny only the requested operation; authorized control succeeds | Missing-reference fault |
| M2 | Destroyed object | Retain copies, perform authorized destroy, attempt use before reuse | Permission denial unrelated to object lifetime |
| M3 | Reused slot / ABA | Retain old copies through reuse, generation boundaries and allowed reset history | Fresh-slot allocator tests |
| M4 | Out-of-bounds offset | Valid type, identity and rights; exact boundary and crossing accesses; reconcile BOUNDS 0x08 against current ISA/fixture before freezing oracle | Earlier LOAD failure or ambiguous trace-shaped instruction |
| M5 | Confused deputy | Caller lacks target authority, deputy possesses it; deny unauthorized request while authorized control works | Direct caller memory-access denial |

For every negative case record the faulting instruction/PC, authority context,
expected reason, actual first reason, state before/after, and independent target
effect check. A different earlier fault is a test setup failure, not the intended
case passing. Diagnostic GT grants are not approval to alter the live image.

## 6. Phase 1 execution gates

### Phase gates

| Gate | Phase | Required deliverable / acceptance | Current evidence / readiness |
| --- | --- | --- | --- |
| P1-00 | 1 | Freeze requirements, nature classifications, attacker model, oracles, bounds, ownership and exact candidate identities | This plan supplies baseline; missing service/recovery/network contracts remain blockers |
| P1-01 | 1 | Reviewed bidirectional route inventory and separate grant ledger; every unexplained route blocks affected closure | Seed inventories only; no exhaustive code review claimed |
| P1-02 | 1 | Component and whole-core cases for every mechanism, Mallory case and cut-point; exhaustive finite fields where feasible, justified partitions otherwise | Existing focused evidence retained; full coverage pending |
| P1-03 | 1 | Same-byte simulator/RTL/vendor comparison of specified committed state; bind exact fixture and distinguish boot from recovery coverage | Combined vendor boot and Amaranth recovery passed; mapped recovery/full conformance not established |
| P1-04 | 1 | Exact checkpoint implementation, timing/DRC, output hashes and build receipt | Build last reported opening checkpoint; no completed implementation result supplied |
| P1-05 | 1 | Separately authorized physical load; correct device/BIT identity; complete installed data-image readback under hold before explicit Start | Combined candidate not yet physically qualified |
| P1-06 | 1 | Physical M0-M5, lifecycle, ownership/checkpoint, quota/watchdog, concurrency and confinement cases with approved bounds | Not established by current boot/recovery pass; contract-gated items stay blocked |
| P1-07 | 1 | Repeated cold/warm boot, reset/interruption, normal workloads, fault/recovery; preserve incident identity and independent side effects | Requires exact-board trials and approved trial counts, intervals and outcomes |
| P1-08 | 1 | Completed Mint and approved Mint/Amobea template-based Thread initialization; Ethernet standalone singleton operation and evidence continuity | Required Factory Build scope; unresolved contracts cannot be waived by UART success |
| P1-09 | 1 | Independent coverage review, fixed-scope exceptions, qualified reliability statistics and signed evidence manifest | Required before bounded Phase 1 security conclusion |
| P2-00 | 2 | Approve protocol, two-Namespace topology, endpoint/delegation identity, failure model, bounds and remote lifecycle contracts | Planned; no new network semantics approved |
| P2-01 | 2 | Inventory all remote routes/grants and repeat local adversarial suite under cross-Namespace traffic | Requires P2-00 and relevant Phase 1 mechanism evidence |
| P2-02 | 2 | Remote adversarial/failure matrix with exact two-endpoint images and verified-installed bytes | Not run |
| P2-03 | 2 | Independently review distributed coverage and residual assumptions; retain separate local/remote verdicts | Not run; W7-15 remains deferred in Phase 1 |

The physical candidate must satisfy the current
[verified-install contract](factory-build-verified-install-approval.md):
hold execution and other writers throughout upload/readback, compare the complete
selected data image, correlate verification to this operation, and permit Start
only after equality and explicit authorization. A hash of the host file, sentinel,
successful download, startup HIGH, or a handful of matching words is not complete
installed-byte equality.

FPGA configuration identity and installed Namespace/RAM image equality are
different evidence. Record BIT hash, device/programming receipt and observed
configuration identity separately from the complete data-image readback. Do not
claim that RAM readback proves configuration-bitstream equality. If a programming
path lacks the required readback, P1-05 is blocked; no diagnostic bypass is implied.

Define repetitions, maximum permitted elapsed time, permitted fault outcomes,
load, observation window and stop rules before each campaign. Log every attempt
including failures. Reliability/MTBF conclusions require the approved measurement
contract, exposure and statistical interpretation, not “ran once without fault.”

## 7. Phase 2 adversarial campaign

Start with two Namespaces on one FPGA as scoped. Keep same-FPGA shared resources
visible in the threat model; this is not proof of isolation between physical
machines. A later multi-device campaign requires separate topology approval.

### Remote tests

| ID | Attack / failure | Required acceptance oracle before running |
| --- | --- | --- |
| N01 | Wrong peer, Namespace, object, method or malformed message | Authenticated destination and authority binding; no foreign read/write/execute effect |
| N02 | Duplicated, delayed, reordered, truncated and replayed requests/replies | Approved delivery/idempotency contract; no duplicated privileged effect or misattributed reply; do not assume exactly-once transport |
| N03 | Revoke/destroy/reuse while a request is queued or in flight | Defined authorization linearization point and remote stale-reference semantics |
| N04 | Endpoint reset/restart, reconnect, partition and timeout | No authority resurrection; bounded specified failure; no automatic weakening or invented rollback |
| N05 | Delegation, excessive rights and a cross-Namespace deputy | Approved attenuation and requester policy; wrong principal denied; authorized control succeeds |
| N06 | Flooding, queue/memory exhaustion and slow peer | Fixed quotas/backpressure and elapsed bounds; unrelated local and remote progress as promised |
| N07 | Persistent state and concurrent requests across interruption | Approved commit/exclusion semantics; no partially published authority; retained history cannot undo consumption/revocation |
| N08 | Exfiltration, attribution and evidence loss | Enumerated outward channels, authenticated event correlation and source identity; explicit covert-channel exclusions |
| N09 | Remote administration/debug/install and local raw-interface bypass | Same route/grant discipline as Phase 1; remote authentication cannot excuse an unmediated local bypass |

Run valid controls alongside each rejection. Repeat affected Phase 1 cases while
remote traffic contends for memory, services and execution resources. Record
results per endpoint and shared resource, not a single undifferentiated PASS.

## 8. Evidence contract and release conclusion

### Evidence record

| Field | Required content |
| --- | --- |
| Claim identity | W7/CM/route/grant/case IDs; fixed phase and nature; precise property |
| Contract and coverage | Approved oracle revision, bounds, attacker powers, partitions/sweeps, excluded channels |
| Implementation identity | Source/generated RTL/checkpoint/BIT hashes, tool versions and build configuration |
| Fixture identity | Exact LUMP/image/Namespace/grant-ledger hashes and expected initial state |
| Installation identity | Device/session, programming evidence, complete installed-byte comparison and hold/Start correlation |
| Execution evidence | Commands, timestamp/timebase, raw traces, registers/memory/effects, first fault, termination |
| Interference evidence | Cut point, concurrent actor, state mutation, rejection and no-unauthorized-effect check |
| Result | Not run/Blocked/Failed/Partially evidenced/Passed; observation level; all attempted runs |
| Nature disposition | Required, Deferred, Trust assumption or Fundamental limitation; prior locked baseline |
| Review | Named preparer/reviewer, completeness challenge, open contradictions and approved reclassification history |
| Integrity | Hash manifest for evidence files; immutable history; no prior-run telemetry reused as current evidence |
| Comparative claim | Actual reproducible W7/S48 baseline when claiming comparative superiority; no invented W7 failure |

Current bounded evidence remains: combined vendor initialization/boot PASS and
combined Amaranth recovery PASS; implementation last reported in progress;
combined physical acceptance pending. This plan creates no new PASS and does
not upgrade those bounded tests into W7 closure.

A permitted conclusion is:

> For the identified FPGA configuration and complete verified-installed data
> images, the listed Phase 1 (or Phase 2) claims passed at the stated evidence
> levels, with a reviewed mediation inventory and grant audit. Deferred claims,
> trusted components, fundamental limits, untested channels and residual risks
> are explicitly listed.

Do not say “all W7 threats defeated.” An unresolved required claim prevents the
full phase-security conclusion even when the application demonstration works.

## 9. Sources and change boundary

- Owner's supplied methodology review, 29 October 2026.
- [Existing W7/CM objectives](W7-plus-plus-test-objectives.md) and unchanged
  [original threat workbook](CTMM_W7_Threat_Test_Plan.xlsx) sheets.
- [Master ISA](01-isa/instruction-set.md) and
  [hardware acceptance](04-release/isa-to-fpga-alignment-plan.md).
- [Factory Build / verified installation](factory-build-verified-install-approval.md),
  [Amobea](Amobea-V1.md), [Cleaner](mint-cleaner-gt-queues-proposal.md),
  [Mint interruption evidence](mint-create-cut-points.md),
  [destroy/reuse evidence](mint-destroy-v1-development.md),
  [baseline](nfb1-starting-baseline.md) and
  [Mallory reconciliation](nfb1-mallory-fault-reconciliation.md).
- [Recorded combined validation](combined-validation-status-20261029.md).

The workbook's added planning sheets mirror this document's tables. They are
planning/coverage records and do not change the original threat results or the
113-row implementation-progress denominator. Source code and contract review,
test implementation and physical campaigns remain separate work.
