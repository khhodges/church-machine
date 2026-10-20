# Phase 1.1 decisions

This file records review decisions, not implementation completion.
The [Master ISA](../01-isa/instruction-set.md) remains authoritative until
an explicitly approved change is incorporated.

## Approved review organization

- Keep this work in `docs/phase-1/phase-1.1/`.
- Maintain one substantive review copy here, with a forwarding note at its
  former location.
- Keep the initial structure small: scope, ISA review and decisions.

## Approved scope

- Phase 1 establishes the desired ISA and verifies conformance.
- Keep Phase 2 in mind for compatibility only.
- Defer the two-Namespaces-on-one-FPGA integration demonstration to Phase 2.
- Do not require the new Namespace-construction/Regulator service framework
  to close Phase 1 hardware acceptance.
- Document live-code comparisons separately from authoritative ISA rules and
  exact-artifact physical evidence.

## Instruction decisions

No new instruction semantics or encodings were approved by the folder move.
Existing approved rules are identified in the [review](isa-review.md).

Proposed first topic: reconcile SWITCH wording with its fixed destinations,
source authority, CR13 preservation and canonical encoding. Implementation
alignment is separate work; the review does not authorize it.

## Recovery reconciliation

### SWITCH responsibility — approved

Fault responsibility is directional. Before SWITCH's Namespace-load midpoint,
the initial Namespace is at fault. From the midpoint onward, the target
Namespace is at fault. No faulting-CR lookup is needed to choose between them.
This decision updates the review draft; it does not itself change the Master
or implementation.

The recent Namespace-local reboot, double-error Genesis fallback and Genesis
default directions are recorded as discussion inputs in the review. Their
precise incorporation into Phase 1 fault wording remains to be worked through.
Creating this folder does not silently replace the current ISA fault contract.
