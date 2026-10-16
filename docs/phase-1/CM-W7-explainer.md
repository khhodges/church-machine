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

## 7. What CM adds to the comparison

The strongest distinction is not simply "hardware rather than software."
CM makes Thread storage, continuation state, capability checks, device access,
and failure handling explicit parts of a machine contract that can be tested
at instruction and memory boundaries.

These are positive CM design commitments. They do not establish that W7 or
Scheme 48 cannot provide analogous services through a runtime or extension.
Comparative claims about a particular W7/S48 implementation still need a
specified version, configuration, and evidence.

### Defined shared tuple memory per Thread

**Phase 1 scope; concrete record demonstration available.** A Thread provides
an authorized heap in which successive methods can share defined tuple records.
"Shared" means shared by authorized processing within that Thread, not a
global heap automatically accessible to other Threads.

The telephony example keeps caller identity, telephone number, routing,
endpoint, conditions, and call state together. Methods update the same record
as processing progresses; a return from one method does not by itself end
the record's lifetime. Each format specifies fields, types, bounds, and layout.
Allocation ownership and stale-reference handling remain explicit obligations.

The CM distinction is a defined relationship between tuple storage, Thread
lifetime, and machine-enforced heap authority—not a claim that Scheme lacks
records or mutable shared data. The proposed Thread interface generalizes the
example; it is not yet evidence that every generic tuple operation is complete.

### Protected continuation separate from application data

**Architectural structure; service contract still under review.** The protected
continuation frame and the live Thread indicator are distinct from ordinary
heap tuples. Amobea/Thread methods are intended to encapsulate capture and
restore while machine permissions enforce the boundary.

The Thread structure supports continuation saving without requiring a Thread
switch. The callable save contract must define its capture boundary and resume
point; a method name does not itself provide protected-state write authority.
This gives the comparison concrete objects and access boundaries to inspect,
rather than treating a continuation as an unrestricted dump of writable memory.

### Checkpoints and rollback with a defined lifetime

**Proposed/reviewed, not delivered hardware behavior.** A checkpoint retains a
particular continuation; rollback explicitly requests restoration. Neither is
identical to ordinary CALL/RETURN or CHANGE.

The proposed contract adds authorized capture/restore, one-shot consumption,
copy/replay resistance, and reset-lifetime rules. The selected data-restoration
scope must be stated separately from execution restoration. IDE-reserved space
is a possible retention location, not protection by itself.

The distinction is the explicit lifecycle and failure contract. It does not
claim that continuation mechanisms inherently lack discipline elsewhere, or
that CM rollback reverses external device effects.

### Capability-controlled MMIO

**Architectural rule; exact device provisioning and qualification require
evidence.** Physical device operations are part of CM's authority model:
knowing an MMIO address is not sufficient authority to access it. A permitted
operation must use the applicable capability and satisfy the relevant access
checks and device-register contract.

Phase 1's watchdog is a concrete example: its control word is governed by a
Genesis-provisioned MMIO GT, not granted automatically to every Thread.
Phase 1 Mint exclusion of MMIO creation does not remove that platform object.
Device-side effects must not occur from rejected accesses, and rollback must
not automatically replay recorded MMIO writes as though they were heap data.

This extends the comparison beyond language-level objects to authority over
physical I/O. It is not a claim that W7/S48 cannot wrap devices securely; CM's
specific access path and device behavior must be demonstrated.

### Additional machine-level distinctions

- **Execution ownership — proposed extension:** the running bit separates
  active Thread ownership from debugger pause and from checkpoint consumption.
  Self-target CHANGE remains valid. This is a concrete exclusion contract,
  not merely an IDE state flag.
- **Watchdog containment — specified hardware contract:** elapsed-time expiry
  and controlled context capture can be tested independently of a callee
  voluntarily returning. Phase 1 starts with an authorized debug exemption,
  so bounded-expiry claims require the watchdog to be enabled. A watchdog fault
  is not automatically a successful return to the caller.
- **Namespace identity and generation checks — architectural rules:** accesses
  resolve through explicit capability identity and destination validation.
  Revocation/reuse claims must account for finite generation fields and
  retained copies; constant-time checks alone do not prove indefinite replay
  resistance.
- **IDE/runtime agreement — demonstration plus Phase 1 scope:** JSON inspection
  and partial updates use an explicit tuple schema, while callable examples
  operate on the same record layout. The IDE is a review and editing tool,
  not an alternate source of machine authority.
- **Artifact-to-hardware evidence — qualification objective:** the LUMP,
  Namespace configuration, simulator result, generated RTL, and tested
  bitstream must be identified precisely. Reproducibility supports the claim;
  it does not eliminate toolchain or silicon trust.

The [W7++ test objectives](W7-plus-plus-test-objectives.md) translate these
distinctions into additional CM-specific acceptance cases.

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
