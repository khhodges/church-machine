---
name: Dynamic state uses ISA protection only
description: Separates static POLA tooling from runtime changes governed solely by ISA capability checks
---

POLA persistence does not apply to dynamic changes. Dynamic reads and writes are governed only by the ISA rules for the capability covering each word: type, permissions, and bounds. Do not add a separate persisted POLA state, automatically save dynamic mutations, or rewrite an existing header because protected content changed.

**Why:** Dynamic state is machine execution state, not a new static policy artifact. Treating it as POLA-persisted state adds authority and lifecycle semantics outside the ISA and incorrectly couples content mutation to header or repository mutation.

**How to apply:** Let DREAD, DWRITE, LOAD, SAVE, and related instructions enforce their normal type, permission, and range checks on every affected word. Keep dynamic mutations in active memory unless a separate ISA-authorized operation explicitly defines otherwise.