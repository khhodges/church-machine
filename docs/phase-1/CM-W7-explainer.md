# Continuations, capabilities, and CM — a W7-oriented explainer

**Status:** Revised review copy, not an implementation specification or proof.
Based on the user-supplied “Toward Resolving the W7 Problems” explainer,
2026-10-16. The uploaded original is preserved unchanged.

W7 provides a useful context for discussing capability security and
first-class continuations. The concerns below are general continuation and
capability design concerns relevant to that discussion; they are **not claims
of demonstrated defects in W7**. Specific historical comparisons require
primary-source citations, which this review does not supply.

CM proposes machine-enforced Thread and capability rules. Hardware enforcement
changes the implementation boundary; it does not automatically make those
rules correct or stronger than a correctly implemented trusted runtime.

## Evidence labels

- **Architectural rule:** a stated contract, not evidence of implementation.
- **Proposed/reviewed:** a design direction whose mechanism remains to be built
  or qualified.
- **Requires verification:** needs concrete implementation and test evidence.
- **Open:** a design choice or boundary still to be resolved.

This explainer makes no formal-proof or FPGA-qualification claim. The local
[Master ISA](01-isa/instruction-set.md) remains authoritative for existing
instruction behavior; [Amobea V1](Amobea-V1.md) records the Thread-service
proposal and its outstanding decisions.

## 1. Continuation reuse

A reusable captured continuation may re-execute effects when invoked again.
That behavior can be intentional; it becomes a hazard where an operation is
intended to be one-shot.

**CM proposal — proposed/reviewed:** a retained checkpoint grants at most one
successful restoration. Its consumption state must:

- Be checked through an explicitly authorized restore operation.
- Be excluded from the state restored by rollback.
- Remain associated with the checkpoint's identity when bytes are copied.
- Prevent a resumed checkpoint from remaining available for another restore.

This is an affine, at-most-once **checkpoint restoration entitlement**, not a
rule that every capability is consumed on use. Ordinary capabilities may
authorize repeated operations and may be deliberately copied or delegated.
Copying a capability is not, by itself, forgery.

**Requires verification:** copies of one checkpoint share one consumption
identity; copying bytes cannot create an independent restore entitlement.
The mechanism and its protection are not established merely by this statement.

## 2. Capture consistency and execution ownership

Continuation capture is not inherently inconsistent: a runtime or machine can
define a coherent capture boundary. CM must specify and enforce its own.

**CM proposal — proposed/reviewed:** a protected running bit records active
Thread ownership, not whether the IDE is advancing execution. Pause and
single-step retain ownership. Capture of the current Thread's continuation
occurs at a defined boundary without requiring `CHANGE` and without releasing
ownership.

The proposed activation check rejects a distinct target Thread already marked
active. It preserves the existing self-target `CHANGE` behavior: save and resume
the newly captured continuation while continuously holding ownership.

**Open:** physical bit placement and the complete ownership-commit protocol.
The live Thread indicator reserves bits 13–27; the saved continuation frame
uses those positions for NIA. The earlier claim that the live indicator was
full confused these formats. Allocating a reserved live bit requires coordinated
validator/writer changes and must not alter saved-frame NIA. A bit alone does
not establish a consistent snapshot: capture ordering and exclusion of
conflicting writers must be demonstrated.

The running bit prevents conflicting ownership; checkpoint consumption
prevents repeated restoration. Neither substitutes for the other.

## 3. Confused-deputy protection

**Architectural distinction:** authority to invoke a method is not unrestricted
authority over all memory. Endpoint names, slot numbers, and tuple references
must not be treated as independent grants of memory access.

That distinction does not by itself solve the confused-deputy problem. A
service may hold valid capabilities of its own and still misuse them on behalf
of an insufficiently authorized caller.

**Required service contract:** validate that the requested operation on the
selected object is authorized, not merely that the service possesses access.
The binding between caller authority, target identity, and operation must be
explicit.

**Requires verification:** a stale tuple reference cannot access a later
allocation. Bounds checks alone do not establish this property; allocation
identity, reuse rules, and negative tests are needed.

## 4. Containment, delegation, and revocation

**Architectural rule:** another Thread does not automatically acquire access
to a Thread's records or protected continuation merely by naming them.
Thread-local storage is not automatically private to every abstraction running
within that Thread.

**Requires verification:** interfaces preserve intended authority boundaries.
Claims that private authority is never returned must be checked against actual
methods and their permitted delegation behavior, not inferred from the
presence of capabilities.

**Checkpoint proposal:** capture and restore each require explicit validated
authority. Existing capabilities may suffice; an IDE reservation or a region
of zeros is not authorization to modify protected state.

**Open:** the exact checkpoint binding, lifetime, revocation, and reset policy.
Consumption protection must last as long as a checkpoint remains valid.
If reset discards consumption bookkeeping, it must also invalidate the
affected checkpoints unless another enforceable mechanism prevents replay.
Existing generation checks must not be described as proof of general
revocation without examining reuse and lifetime conditions.

## 5. Rollback is not a transaction on the outside world

**Scope limitation, not a proof:** restoring a continuation does not undo a
message already sent, a telephone connection already established, or a device
operation already performed.

Even the first restore can repeat effects performed after capture. At-most-once
checkpoint restoration therefore does not imply exactly-once external effects.
Those require a separate application/protocol design where needed.

The rollback scope must state whether it includes continuation state alone,
selected records, or a defined heap snapshot. Restored execution and data must
be consistent. The heap-restoration policy remains open.

## 6. Interrupted restore and fail-closed commitment

**Recommended contract — proposed/reviewed:** restored execution must never
begin while the checkpoint remains reusable. Consumption and resumption need
one defined commit protocol.

If they cannot be made atomic, effective consumption must precede resumption.
A fault may leave a checkpoint consumed without resuming, but must not leave
an already resumed checkpoint reusable. This accepts possible loss of a
checkpoint rather than replay; it does not promise automatic retry.

**Requires verification:** fault/reset injection around each commit boundary,
protection of consumption state, and invalidation of stale checkpoint copies.
Hard-fault policy alone does not prove that every partial state is contained.

Ownership acquisition also needs a closed inventory of paths. CHANGE, SWITCH,
bootstrap, checkpoint restoration, and fault/watchdog/reset recovery must each
be classified as acquiring, releasing, preserving, or not touching ownership.
Unlisted paths must not acquire it.

Every resume path must enforce the applicable live-metadata invariants:
neither running ownership nor checkpoint consumption may be overwritten by
historical state. Shared checks are desirable where practical, but one literal
function or hardware path is not required. Equivalent enforcement and absence
of bypasses must be demonstrated.

## Conclusion

CM proposes explicit machine-enforced rules for continuation ownership,
checkpoint reuse, and capability-authorized access. These are distinct
mechanisms with distinct proof obligations, not consequences of hardware
enforcement alone.

Phase 1 tuple storage and IDE support remain separable from the gated
continuation/rollback increment. Their own allocation, isolation, and
validation requirements still need evidence.

Before making stronger security claims, settle the open contracts and attach
implementation-specific tests, fault-injection results, and hardware evidence.
Before attributing a limitation specifically to W7, provide a primary-source
reference.
