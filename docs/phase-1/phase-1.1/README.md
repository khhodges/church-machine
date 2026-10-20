# Phase 1.1 — ISA refinement review

Phase 1.1 refines Phase 1; it is not the start of Phase 2.

## Read here

1. [ISA review](isa-review.md) — discrepancies and evidence from the first pass.
2. [Decisions](decisions.md) — approved scope and decisions made during review.

Current review: [proposed SWITCH replacement wording](isa-review.md#proposed-switch-replacement-wording).
This is a draft, not an amendment to the Master.

## Authority and scope

The existing [Master ISA](../01-isa/instruction-set.md) remains authoritative.
Findings and proposals here do not amend it. Incorporate changes only after
explicit approval, keeping the [acceptance plan](../04-release/isa-to-fpga-alignment-plan.md)
consistent with the approved contract.

Review Phase 1 semantics, encodings, register authority, continuations, geometry
and fault behavior. Consider Phase 2 compatibility without making the
two-Namespace demonstration or new service framework a Phase 1 prerequisite.

The first proposed review topic is SWITCH. Its existing approved contract is
distinct from stale wording and implementation behavior.

## Evidence boundaries

The review uses the Phase 1 documents as authority but may compare live
repository code in `simulator/` and `hardware/`. Such paths are identified
explicitly; they are not claims about the local RTL snapshot or running FPGA.
Source line numbers identify review-time observations and may move.

Separate approved ISA rules, review findings, new decisions, implementation
changes and measured test results. A reproduced simulator discrepancy is not
a complete conformance run. No vendor build, installation or hardware
programming is authorized by creating this folder.

Only one substantive copy of the review is maintained here. Its former
repository location contains a forwarding note.
