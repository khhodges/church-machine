# Common networked capability lifecycle

Status: agreed architectural direction, with proposed acceptance conditions.
This document does not claim current implementation completeness or authorize
artifact activation, image installation, or FPGA programming.

## Priority and next-action record

Review baseline: 2026-11-01. Update this section when new evidence changes a
status. Merged code, isolated tests, complete-image acceptance, and physical
acceptance are separate milestones.

**Primary objective remains Phase 1:** align approved ISA, simulator, exact
bitstream and physical acceptance, then deliver the MCS/UART development
handoff. The second developer's normal workflow is to use the IDE over UART
without JTAG. Persistent flash programming requires separate approval.

| Work | Evidence now available | What is not yet established here |
| --- | --- | --- |
| Per-Thread authored initialization | Designer/build work and reviewed Alice/Mallory selection preparation have merged | A merge alone does not prove current installed image, successful actor execution, or physical acceptance |
| Authored Thread RTL startup | Isolated scheduler replay compares unchanged generated Thread bodies, registers, heaps and continuations | Full-core execution and complete public upload dependencies; the replay explicitly provisions selected dependencies in its fixture |
| Phase 1 bitstream and UART handoff | Existing release evidence remains the starting point | Latest exact-candidate closure must be reconciled; this review did not query remote builds or program hardware |
| Common network transparency | Architectural direction agreed; contract and gaps below | Runtime implementation and cross-FPGA acceptance remain deferred |

**Do next:** reconcile the merged Alice/Mallory and RTL evidence with the exact
current Phase 1 candidate and W7 tracker. Produce one bounded acceptance list:
claim, exact artifact, evidence, remaining blocker, and next action. Check the
current public upload's selected dependencies before using the isolated replay
as evidence of complete-image readiness. Do not repair unrelated paths unless
they demonstrably block the selected release.

**Then:** close those demonstrated release blockers, finish exact-candidate
validation and the UART handoff, and seek separate approval for any physical
programming. Do not promote old model results into evidence for newer bytes.

**Later:** implement this common lifecycle in the dependency order below.
Do not start parallel networking features or a general test-cleanup programme
ahead of the handoff. Historical workflow failures require diagnosis before
they can be called current release blockers.

Evidence anchors:
- [Authored Thread RTL scope](../tests/hardware/AUTHORED_THREAD_STARTUP.md).
- Reviewed selection: `server/alice-mallory-thread-selection.json`;
  preparation: `scripts/prepare_alice_mallory_threads.py`.
- [Earlier combined validation status](phase-1/combined-validation-status-20261029.md)
  is dated historical evidence, not a live build-status report.
- `docs/phase-1/CTMM_W7_Threat_Test_Plan.xlsx`: reconcile freshness before
  claiming current threat or release closure.

## 1. Agreed common model

One simple, standardized set of networked capability mechanisms applies to
Abstractions, Threads and Namespaces. Object-specific state handling does not
justify a separate networking mechanism.

A Namespace is a **local representation of a C-List of Networked GTs**.
Its local physical placement is not the portable identity of its references.
Saving the Namespace does not inherently mean recursively saving all objects
it references.

Amoeba `Self.Save` is program-controlled. It saves Thread execution state,
including machine register state, and performs the save-to-Outform transition.
Later an authorized owner, potentially a networked abstraction, may reactivate
the Thread on the same or another FPGA. Namespaces use the same common
lifecycle, with their own state representation.

This is not automatic eviction. Lazy loading materializes the saved object
when required; it does not independently choose suspension or ownership policy.

## 2. Required dependency order

1. Networked identity and authority, independent of physical placement.
2. Local Namespace representation of those networked capabilities.
3. Common save, Outform/Inform resolution, and materialization semantics.
4. Object-specific validation and activation using those same semantics.
5. Cross-FPGA acceptance of complete operations, including failure cases.

## 3. Proposed operational contract

These conditions express the intended model; unresolved choices in section 5
must not be silently implemented as settled policy.

### Save
- The program initiates save under its existing authority.
- Capture a consistent state at a defined execution boundary.
- For a Thread, preserve DRs, capability state, heap, private stack and canonical
  continuation. Never replace saved execution state with original design values.
- For a Namespace, preserve its networked capability list and required structural
  meaning; source physical addresses are not destination authority.
- Complete durable publication before reporting the save-to-Outform transition
  as successful or discarding required resident state.
- Failure is explicit; do not report a partial save as a completed transition.

### Load and resolve
- Identify and authenticate the exact saved object through the common mechanism.
- Allocate destination-local storage and validate the object's structure.
- Resolve local representations without silently broadening capability rights
  or treating unresolved references as address-zero authority.
- Preserve the networked meaning of saved references. Do not assume matching
  source and destination slot numbers identify the same objects.
- Publish a valid resident Inform representation only after required validation;
  fetching bytes alone does not authorize execution.

### Reactivate
- The owner controls reactivation using the common capability authority rules.
- Threads resume the saved canonical continuation; authored initialization is
  used for initial creation, not as a fallback for failed restoration.
- Namespace activation uses its valid destination-local representation.
- CHANGE/SWITCH must not expose a mixed old/new context if loading or validation
  fails. Exact failure and handoff sequencing must be specified before coding.
- Transparency preserves capability meaning, not an illusion that network
  failures, unavailable objects or incompatible execution profiles cannot occur.

## 4. Implementation gap map

Source-review findings; not a new test or hardware acceptance result.

| Area | Present evidence | Work needed under the common contract |
| --- | --- | --- |
| Thread residency | `server/boot_image.py` forces effective Thread policy to Resident | Remove this restriction only with a working common save/load lifecycle; do not merely enable a selector |
| Initial versus saved state | `server/thread_initial_design.py` applies fresh build inputs; prepared-entry handling is not a runtime checkpoint service | Specify and implement execution-state save without reusing initialization as restoration |
| Simulator ingress | `simulator/simulator.js` has authenticated `receiveLump` checks and resident publication helpers | Verify their applicability to all object types, Namespace contexts and asynchronous activation; do not bypass identity checks |
| Thread/Namespace activation | CHANGE and SWITCH validate context/geometry; `simulator/namespace-runtime-core.js` handles Namespace switching | Define common resolution before activation and verify failure boundaries |
| RTL ingress | `hardware/church_outform.py` deliberately faults OUTFORM_UNAUTH; legacy promotion states are unreachable from that entry | Provide the required authenticated ingress before enabling promotion; CRC/token checks alone are not its replacement |
| RTL Namespace activation | `hardware/switch.py` expects a resolved Inform candidate | Supply validated local resolution through the common mechanism before switching roots |
| Cross-FPGA state | Local Namespace descriptors and capability caches encode local placement | Specify the portable list/state format and destination representation without inventing a second GT identity scheme |
| Documentation | `docs/network-transparency.md` is an older planned design, including RPC/tunnel descriptions | Reconcile its transport and lifecycle claims with this agreed model before implementation; do not treat old prose as implemented behavior |

## 5. Decisions still required

- Exact `Self.Save` continuation and execution handoff: which instruction is
  next after resume, and who completes saving after the Thread stops executing?
- Serialization of networked capability references, protected context and
  structural registers versus reconstructed local caches.
- How a consistent Namespace list is captured while authorized modifications
  may occur; no implicit recursive object snapshot is assumed.
- Owner policy for repeated activation: transfer, replication, or other explicit
  semantics. Do not invent a universal single-copy rule.
- Destination compatibility checks and treatment of board-local resources.
- Durable-publication acknowledgement and failure semantics.

## 6. Acceptance after the current release priority

For each object kind, exercise save, reload and owner-authorized activation on
the same machine and a different compatible machine. Compare portable identity
and state, not physical addresses. Include stale references, interrupted saves,
failed authentication, allocation exhaustion, unresolved dependencies and
failed activation. Verify no broadened authority or partial active context.

Keep evidence levels separate: simulator, isolated RTL, full-core exact image,
vendor build, and physical execution. No level implies the next.
