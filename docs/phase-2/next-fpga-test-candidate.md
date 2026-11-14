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

Mint/Cleaner and read-only retirement remain later software test stages on this
candidate, subject to interface/capacity checks before hardware freeze. They
are not silently added as dependencies of the initial loading demonstration.
Cross-Namespace service entry, pending-request ownership, scheduling and fault
return remain contracts to settle, not behavior established by this inventory.

## Proposed: cross-Namespace Lazy service route — awaiting review

Preserve the existing local LLR destination: the requesting Namespace's
validated Slot 2 SYSTEM Thread. Do not silently redefine LLR as a direct
cross-Namespace transfer to a globally addressed Boot Thread.

Proposed software route:

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

This is a proposed control-flow contract, not an implemented protocol.
Private request/completion storage, grants, shared-code bindings, root identity
validation, watchdog renewal and multiple-waiter scheduling need exact design
and evidence. The application-side entry code must be available before USER
dispatch without preloading a second executable: establish its explicit
loading/bootstrap sequence as part of this contract.

## Next decisions

- Exact source baseline.
- Exact service/application inventory and cross-Namespace handoff contract.
- Memory capacity, receiver/device map and observation interface.
- Frozen test images, acceptance criteria and local build gates.

The completed specification must be reviewed before implementation/build
authorization is requested. Physical testing remains separately authorized.
