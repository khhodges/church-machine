# Next FPGA test candidate — stepwise specification

Status: design in review, not build-ready or hardware-qualified.
Each consequential decision is reviewed with the user before proceeding.
No synthesis, transfer, programming, saved-image replacement, or live
Namespace changes are authorized by this specification.

## Confirmed: two resident Namespaces

The candidate must support two Namespaces resident together in one physical
memory map. Switching between them must not require replacing the image.
Resident Namespace structures do not imply resident application code:
the native loading test still starts with only Amoeba executable code resident.

Initial loading tests may exercise one Namespace before cross-Namespace tests.
Networking remains a later campaign; two resident Namespaces do not imply
automatic cross-Namespace authority.

## Existing architecture requirements carried forward

- Boot/service Namespace holds MMIO and Namespace GTs and runs FPGA services.
- The application Namespace has its starter Thread at Slot 2 and may have
  additional Threads.
- Amoeba is shared by Threads and organizes round-robin execution.
- Thread private data uses CR5.
- Physical allocations are disjoint. Shared physical memory does not imply
  shared mutable objects or authority.

These are design requirements, not claims that the current single-USER loader
implements cross-Namespace scheduling or service access.

## Confirmed: target board

The second Wukong V3, used for the recent physical demonstrations, is the
design target. This does not authorize disturbing its current image.
The exact source baseline, candidate BIT and installed identity must be
established separately; a board selection is not proof of source compatibility.

## Confirmed: initial workload inventory

| Namespace | Initial test responsibilities |
| --- | --- |
| Boot/service | Amoeba loading/scheduling, CapabilityTest, SelfTest, WukongCallHome, and the required device/service grants |
| Application | Slot 2 starter and separate Alice/Mallory Threads, with their private state and explicitly granted capabilities |

Only Amoeba executable code starts resident. Required Namespace/Thread
structures, private loader data and device descriptors are present initially;
all other executable LUMPs are delivered as needed. SYSTEM explicitly ensures
its dependencies; USER CALL uses automatic Lazy handoff.

Alice demonstrates legitimate protected-state progress. Mallory deliberately
attempts forbidden access and is rejected. Acceptance must additionally prove
that Alice's retained state and subsequent progress survive the approved
fault/recovery path; an observed Mallory fault alone is insufficient.

General Mint/Cleaner and read-only retirement remain later software test stages,
subject to interface/capacity checks before hardware freeze. The subsequently
approved repeated-attack test brings any required fresh-Thread initialization
subset into initial containment scope; its exact implementation is unresolved.
The cross-Namespace route below is approved. Exact pending-request ownership,
scheduling and software fault recovery remain contracts to settle, not behavior
established by this inventory.

## Confirmed: cross-Namespace Lazy service route

Preserve the existing local LLR destination: the requesting Namespace's
validated Slot 2 SYSTEM Thread. Do not silently redefine LLR as a direct
cross-Namespace transfer to a globally addressed Boot Thread.

Approved software route:

1. USER absence enters its local Slot 2 continuation through normal LLR.
2. Local SYSTEM records the originating Namespace identity, full versioned
   USER GT and requested target before explicitly switching to Boot/service.
3. Boot/service Amoeba uses only its provisioned destination authority to
   validate and install the selected body.
4. An explicit SWITCH returns to the application's Slot 2 continuation;
   ordinary CHANGE selects the now-ready USER and retries its original CALL.

An equal slot number in another Namespace is not the same target or owner.
Request data does not grant write, SWITCH or Thread activation authority.
SWITCH still requires CR15.M and enters the destination's Slot 2; CHANGE
does not change the Namespace.

This is an approved control-flow contract, not an implemented protocol.
Private request/completion storage, grants, shared-code bindings, root identity
validation, watchdog renewal and multiple-waiter scheduling need exact design
and evidence. The application-side entry code must be available before USER
dispatch without preloading a second executable: establish its explicit
loading/bootstrap sequence as part of this contract.

## Fault entry: carry forward the current ISA contract

The Master ISA's Namespace fault recovery section and
`../phase-1/boot-fault-rtl-contract.md` govern machine-owned fault entry:
stash directly into configured Boot.Thread, prime it, attempt the outgoing
Thread save once, finalize save status, then load Boot Namespace/Thread.
The saved faulting context is evidence, not a resumable continuation.
Original Thread and Namespace references must retain their original meaning.

Failed Boot stash, priming or activation takes the specified indefinite LED
loop, not an invented fallback or retry policy. This is distinct from an
ordinary Lazy suspension, whose pending CALL is resumable.

## Confirmed: repeated Mallory attacks

The first containment test automatically repeats controlled attack attempts.
Boot records each rejection. Authorized software initializes a fresh Mallory
attempt; it never skips the failed instruction or resumes the faulted context.
Alice's protected state remains intact, with actual progress checked between
attempts. Reinitializing Alice or reconstructing her value from a diagnostic
counter does not satisfy this requirement.

The exact fresh-Thread initialization contract, grants, generation handling
and pending-request invalidation remain engineering work. Required
Mint/Amoeba initialization may therefore enter the first containment test;
this is not approval for the entire general lifecycle or a hardware build.

## Confirmed: aggregate memory design target

Use 128 KiB for resident Namespace/Thread structures, LUMP allocations,
private state and software records, plus 16 KiB of isolated transfer staging.
This is a 144 KiB aggregate target, not fixed equal Namespace partitions or
authority to share mutable objects. Final allocations require exact selected
sizes; Namespace slot counts and addresses remain unsettled.

The earlier `development-implementation-scope.md` review estimated 108 of
135 BRAM36 tiles for this payload with the current three-read-copy geometry,
and 124 including its proposed overhead/peripheral allowances. These are
planning estimates, not utilization measurements for this candidate.
Reserving room is not implementing or approving SD/Ethernet in this stage.
Retain the 25 MHz functional-test target and require new timing/resource
evidence before declaring fit. Do not round a triplicated memory to 256 KiB:
that would exceed the stated BRAM capacity.

The provisional staging allocation implies a maximum 16 KiB complete received
body unless a separately reviewed streaming design is adopted. Verify selected
LUMP sizes and recovery storage before freezing this limit. Oversized bodies
must fail explicitly, not truncate or silently enlarge storage.

## Proposed: first-candidate acceptance gates — awaiting review

These are required results, not test results or build authorization.

| Gate | Required evidence |
| --- | --- |
| Identity and memory | Exact source/BIT/image identities, selected board evidence, both Namespace roots resident, disjoint allocations and no high-address aliasing. Verify actual contents rather than relying on labels. |
| Native loading | Only Amoeba code initially resident; explicit SYSTEM dependency loading; automatic USER suspend/service/retry across the approved Namespace route; exact body publication and original CALL execution once per request. |
| Waiting and progress | Delayed delivery leaves the requester pending while another eligible USER progresses; all-waiting SYSTEM renews the watchdog through approved transitions. No forced resume or invented request timeout. |
| Repeated attack containment | 100 deliberately rejected Mallory attempts from fresh authorized contexts; at least one completed, read-back-verified Alice update after every rejection before the next attempt, including after the last. No Alice reinitialization or protection bypass. |
| Delivery rejection | Corrupt, wrong-target, truncated, oversized, duplicate and stale deliveries cannot publish invalid code, resume the wrong owner or replay a completed CALL. Exact rejection dispositions remain to be specified. |
| Fault and reset boundaries | Normal fault entry retains original Namespace/Thread attribution; failed Boot entry takes the specified LED loop. Explicit reset invalidates affected pending work without granting stale authority. |
| Physical evidence | New resource, routed timing and DRC reports for the frozen candidate; separately authorized physical runs with raw observations correlated to exact inputs, not only a console PASS. |

The 100-attempt target is a bounded functional test, not an MTBF claim.
Choose initial generations and counter values with enough legal headroom;
no version or value wrap is allowed. If the approved fresh-context mechanism
cannot support the target, return for review rather than reuse invalid
authority, silently lower the count or reset Alice. Test overall time bounds
must be specified before execution and must not become runtime load timeouts.

Local model evidence, vendor build evidence and physical observations must be
reported separately. Mallory's expected fault is a passing negative test only
when the exact forbidden operation is rejected and preservation/progress checks
also pass. No complete Phase 1, Phase 2 or W7 acceptance follows from these gates.

## Next decisions

- Exact source baseline.
- Software fault recovery and exact shared-service handoff ABI/provisioning.
- Exact memory ledger, receiver/device map and observation interface.
- Frozen test images, acceptance criteria and local build gates.

The completed specification must be reviewed before implementation/build
authorization is requested. Physical testing remains separately authorized.
