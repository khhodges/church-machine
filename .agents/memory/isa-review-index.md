---
name: ISA review decisions
description: User decisions on scope, compatibility, encoding validation and fault/scheduling direction.
---

- [ISA boundary](isa-implementation-boundary.md): observable architecture, not implementation mechanisms.
- [Namespace capacity](namespace-capacity-review.md): configurable slot count; 64 slots is not an ISA restriction.
- [Hardwired recovery and security](hardwired-recovery-security-authority.md): reserved CR13, hardwired recovery/CR15, first CHANGE prerequisite and SecurityRegulator M authority.
- [Compatibility](fpga-liftoff-compatibility.md): none required before first FPGA release; case-by-case afterward.
- [Encoding checks](encoding-before-condition.md): invalid encodings fault before condition evaluation.
- [Scheduling and recovery](irq-transition-design-direction.md): cooperative/watchdog direction and save-first fault recovery.
- [Bitfield widths](bitfield-width-decision.md): widths 1–31; zero is invalid, not a width-32 alias.
- [Indexed operand intent](register-indexed-load-intent.md): runtime DR value plus immediate applies uniformly to indexed instructions.
- [CHANGE access](change-programmer-access.md): CHANGE is not protected; do not block CR13–CR15 while exempting CR12.
