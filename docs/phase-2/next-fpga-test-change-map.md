# Next FPGA candidate — change and provisioning map

Design review only. Maintained RTL is approved as the source base; no code
implementation, synthesis, installation or physical testing is authorized here.
Inspected repository revision: `360164dcda97f696e0199e9733db918c30e6d431`.
This identifies the inspection, not the final candidate manifest.

## Required changes and evidence

| Area and inspected source | Change/provisioning required | Focused acceptance |
| --- | --- | --- |
| RAM and bus paths: `cooperative-retry/starter_top.py` | Checked banked 128 KiB allocation area plus 16 KiB staging. Widen every CPU/fetch/Namespace/C-list/inspection/write/observation path; preserve arbitration and accepted-write behavior. | Distinct low/high addresses, last-word/one-past, overflow/misalignment, cross-region writes and fetches. No truncate-before-check. |
| Whole-image admission: `starter_transport.py`, `starter_lifecycle.py`, `starter_sha256.py` in `cooperative-retry/` | Replace fixed 64 KiB assumptions with an explicit candidate profile. Define exactly which bytes are transferred/hashed, staging initialization, epoch and start authorization. Preserve historical profiles. | Exact receive/hash bounds, partial/wrong-length/extra bytes, abort/restart, no execution before admitted START. Extend existing general-image/lifecycle/SHA tests. |
| LUMP receiver: `cooperative-retry/amoeba_protocol.py`, `amoeba_receiver.py` | Namespace-qualified selected-artifact identity, bounded staging and request ownership. Current CLA1/CAR1 cannot distinguish equal slots in different roots. Specify versioned framing before changing either endpoint. | Wrong root/slot/version/digest/length; duplicate/stale replies; reset and counter exhaustion; backpressure. Preserve successful exact publication evidence. |
| Trusted Boot entry: `hardware/fault_entry.py`, `core.py`, `fault_stash.py`, starter wrapper | Derive Boot Namespace/Thread binding from exact prepared inputs, pass it explicitly to the core and revalidate it. Generalize binding and outgoing-save limits beyond 64 KiB without weakening checks. Resolve entry-continuation wording below. | Extend `hardware/test_fault_boot_binding.py` and `hardware/test_fault_entry_integration.py`; cross-root fault attribution, high-address source, accepted-write completion, catastrophic LED path. |
| Native service and application entry: `simulator/examples/amoeba_loader.cloomc`, local candidate preparation | Explicit cross-root request/completion records, software round-robin, private grant tables and first-entry loading. Preserve only-Amoeba initial executable residency. | One pending CALL per owner, another USER progresses, all-waiting self-CHANGE, exact once-only resume and no implicit SYSTEM loading trap. |
| Fresh Mallory attempts and observation | Specify authorized initializer/template, which generation advances, stale-work disposal, Alice state ownership and read-back, fault/progress correlation. No hardware version increment or ad hoc host memory repair. | 100 fresh rejected attempts with Alice progress after each; sufficient legal generation/counter headroom; exact forbidden operation rejected. |

Paths under `cooperative-retry/` above are relative to `docs/phase-2/`.
Named existing tests are extension points, not claims of new test passes.

## Provisioning ledger required before the candidate is frozen

| Item | Required explicit inputs | State |
| --- | --- | --- |
| Physical allocation | Exact sizes and nonoverlapping ranges for both roots, Threads, code, private data, records, templates and staging | Aggregate target approved; exact ledger pending |
| Namespace identities | Both full root identities and descriptor generations; Slot 2 Threads and initial frames | Roles approved; exact selected bytes pending |
| Boot fault authority | Exact Boot root/Thread identity, admitted-image hash and normal boot guard; no discovery through the attacker C-list | Retained continuation approved; larger-image adaptation and exact bindings pending |
| Application service entry | Executable binding and initialization order before dispatching USERs | Route approved; bootstrap sequence pending |
| Loader grants | Per-root selected target/digest/geometry plus separately bounded destination authority; no caller-selected arbitrary destination | New two-root table pending |
| Request/completion records | Owner Namespace and full versioned Thread identity, target identity, session/request lifetime, private storage and allowed writers | Fields/ownership requirements known; exact ABI pending |
| SWITCH and scheduling grants | Authorized destination root transitions and per-Namespace USER selection; no authority inferred from request data | Exact C-lists and CR15.M ownership pending |
| Restart | Approved template, initializer grants, version policy and invalidation of old pending work | Repeated-attempt goal approved; mechanism pending |
| Observation | Exact fault origin, attack sequence, Alice read-back, request/publication/resume identity and board/image correlation | Acceptance approved; format and bounded buffers pending |

Do not invent absent grants or select saved revisions implicitly to fill this
ledger. Pending software definitions are not proof of an RTL defect and must
remain separate from hardware conformance/build gates.

## Entry-continuation discrepancy resolved for this candidate

The Master ISA's older fault section describes a configured handler at offset
zero with canonical root/flags. Maintained `FaultStash` explicitly preserves
Boot's suspended frame, stack indicator and flags. `FaultBootBinding` selects
foundational Namespace/Thread identity only, not a separate handler.
`test_fault_boot_binding.py` asserts no handler field; the integration test
expects Boot's retained continuation, not a manufactured handler.

The user approved retaining the maintained Boot-continuation behavior in this
candidate, consistent with the later retained-continuation recovery direction.
The candidate specification now explicitly supersedes the older wording for
this scope without rewriting historical contracts. Distinguish Boot's valid service
continuation from the faulted Mallory context, which remains evidence and is
not resumed. Boot's outstanding service/request state must tolerate the
injected fault facts; preserving a continuation alone is not proof of that.

Do not silently edit the master contract or reintroduce a separate handler
selector while implementing the wrapper. Bindings and tests must preserve the
approved retained continuation, including when service requests are outstanding.

## Engineering sequence after design approval

1. Specify the exact image/request profiles with the approved Boot continuation.
2. Build the checked memory/address layer and admission changes in isolation.
3. Integrate Namespace-aware receiver and explicit trusted Boot wiring.
4. Provision native startup/scheduling/restart candidates, without modifying
   live saved inputs; run the approved local integrated acceptance.
5. Review a frozen source/input manifest and vendor-build readiness.
6. Obtain separate vendor-build and physical-test authorizations.

Only the current design-review work is authorized. No new tests were run for
this source map, and no runtime or hardware files were changed.
