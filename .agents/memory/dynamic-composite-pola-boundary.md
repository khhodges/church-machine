---
name: Dynamic state uses ISA protection only
description: Separates static POLA tooling from runtime changes governed solely by ISA capability checks
---

POLA persistence does not apply to dynamic changes. Dynamic reads and writes are governed only by the ISA rules for the capability covering each word: type, permissions, and bounds. Do not add a separate persisted POLA state, automatically save dynamic mutations, or rewrite an existing header because protected content changed.

**Why:** Dynamic state is machine execution state, not a new static policy artifact. Treating it as POLA-persisted state adds authority and lifecycle semantics outside the ISA and incorrectly couples content mutation to header or repository mutation.

**How to apply:** Let DREAD, DWRITE, LOAD, SAVE, and related instructions enforce their normal type, permission, and range checks on every affected word. Keep dynamic mutations in active memory unless a separate ISA-authorized operation explicitly defines otherwise.

Data words may reside within a code region and be read through an RX capability covering that region; do not require a separate data object or new data-block syntax merely because declarations lie outside methods.

This RX-based embedded-data case is read-only. Do not present it as the storage solution for mutable shared state such as a stash/reveal value. Mutable state needs authorized writable storage, but not necessarily a newly created data GT: existing authorized heap access may support a tuple store. Check tuple lifetime and shared reachability across method returns before recommending that design.

**Why:** The user explicitly corrected the proposed separation: “the data in a code block could be accessed as part of a RX capability,” then clarified: “It only works for Read Only data.”

**How to apply:** Preserve embedded data in code layout and resolve its addresses consistently with dispatch placement. Reading uses R; writing still requires W over the addressed words. Do not infer write authority from RX or confuse a parser limitation with an architectural prohibition.

**Why (heap alternative):** The user rejected the claim that this example necessarily needs another RW data GT, suggesting the heap as a tuple store instead. This is an architectural option to investigate, not confirmation that the current heap implementation preserves such state across calls.