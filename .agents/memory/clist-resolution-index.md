---
name: C-list resolution pitfalls
description: Pointers to slot migration, assembler index confusion, and IRQ lazy-load gating lessons.
---

- [Namespace-slot migration](ns-slot-gt-bypass-trap.md) — audit fallback paths when slot identities move.
- [Assembler register versus C-list index](assembler-nsloaded-slot-confusion.md) — distinguish CR numbers from C-list row indices.
- [IRQ lazy-load gating](irq-lump-lazy-gate-guard.md) — pre-seeded slots must not bypass manifest-based admission.
