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

## Next decisions

- Target FPGA/board and source baseline.
- Exact service/application inventory and cross-Namespace handoff contract.
- Memory capacity, receiver/device map and observation interface.
- Frozen test images, acceptance criteria and local build gates.

The completed specification must be reviewed before implementation/build
authorization is requested. Physical testing remains separately authorized.
