# Phase 1.1 decisions

This file records review decisions, not implementation completion.
The [Master ISA](../01-isa/instruction-set.md) remains authoritative until
an explicitly approved change is incorporated.

**Incorporated:** The SWITCH and recovery decisions below are now in the
Master ISA and matching hardware acceptance criteria, with explicit user
authorization for documents only. No implementation or hardware work is approved
by this incorporation.

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

SWITCH wording is reconciled with its fixed destinations, source authority,
CR13 preservation and canonical encoding. Implementation alignment remains
separate work.

## Recovery reconciliation

### SWITCH responsibility — approved

Fault responsibility is directional. Before SWITCH's Namespace-load midpoint,
the initial Namespace is at fault. From the midpoint onward, the target
Namespace is at fault. No faulting-CR lookup is needed to choose between them.
This decision is incorporated into the Master; implementation remains separate.

### Namespace reboot and double error — approved

A fault reboots only the responsible Namespace. If that reboot itself faults
before completing, restart first Genesis. “Double error” means a fault during
recovery, not two unrelated faults. This replaces the older Boot Thread →
purgatory rule in the Master.

### Reboot completion — approved

Recovery uses the trusted boot sequence for the responsible Namespace,
without saving the faulted Thread as a resumable continuation. It requires
no M-bit grant from the faulted program. Fault evidence is retained.
This recovery rule is distinct from ordinary CHANGE/SWITCH outgoing saves.

Reboot completes when the final boot `CALL CR0` succeeds. A fault before that
success, including a fault in the CALL itself, triggers first Genesis.
A fault afterward starts a new Namespace-local recovery. Reaching or issuing
the CALL alone does not complete reboot.

### First Genesis — approved

First Genesis is the original power-on boot context, fixed by the machine's
boot configuration—not the most recently active Namespace. Double-error
recovery restarts that context.

Genesis remains the default for unfinished or unspecified behavior.
Document incorporation is complete; implementation and conformance remain separate.
