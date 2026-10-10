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
