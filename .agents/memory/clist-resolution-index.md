---
name: C-list resolution pitfalls
description: Pointers to slot migration, assembler index confusion, and IRQ lazy-load gating lessons.
---

- [Namespace-slot migration](ns-slot-gt-bypass-trap.md) — audit fallback paths when slot identities move.
- [Assembler register versus C-list index](assembler-nsloaded-slot-confusion.md) — distinguish CR numbers from C-list row indices.
- [IRQ lazy-load gating](irq-lump-lazy-gate-guard.md) — pre-seeded slots must not bypass manifest-based admission.
- [Declared C-list B-flag](declared-clist-b-flag-rule.md) — declared rows use B=0.
- [Compiler C-list normalization](compiler-clist-normalization.md) — preserve authored positions and compiler-owned SELF.
- [C-list row zero](clist-row-zero-advisory-self.md) — historical bytes remain inspectable without rewriting.
- [C-list picker authority](clist-picker-programmer-authority.md) — not-yet-created pet names are valid declarations.
- [SELF click safety](self-row-click-safety.md) — compiler-owned SELF is display-only.
