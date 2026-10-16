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

The user's motivating telephony example is a complete call record starting with caller name and telephone number, then routing selection, endpoint, and conditions as processing proceeds.

**Why:** This illustrates shared record state spanning methods, rather than independent storage per method or a new GT for every field.

**How to apply:** Use this example when discussing heap tuple records; keep record lifetime and access authority explicit without assuming a specific allocation scheme or one Thread per call has been approved.

For the initial telephony demonstration, the user approved callable heap-record
operations plus IDE-side JSON import/export/partial update, with refinement later.

**Why:** Demonstrating the runtime record must not first require a full JSON
parser on the Church Machine. This is a software demonstration convention,
not authorization to change the ISA or create a production-wide heap standard.

**How to apply:** Keep JSON conversion at the IDE boundary for this phase,
preserve omitted fields on updates, validate before writes, and keep live heap
mutations separate from saved LUMPs and hardware programming.

The user prefers `Thread` over `Heap` for the named reference analogous to
`Self` (their example is `Thread.Rollback`). The abstraction is intended as the
“Amoeba” for every Thread, encompassing heap operations and potentially broader
Thread services. The revised CR0 bootstrap call is explicitly TBD.

**Why:** The user wants a common Thread abstraction rather than independent
application-specific storage machinery, and suggested rollback using
IDE-reserved space as an example of its broader scope.

**How to apply:** Distinguish callable method authority from Thread heap data
authority. Define binding and method contracts before implementation; do not
infer approval to change CR0, bootstrap, persistence, or the ISA from this
discussion.

`Thread.Rollback` and IDE-reserved snapshot space remain proposals, not an
approved implementation or a defined snapshot/resume contract.

The user clarified that the Thread already has a data structure capable of
saving machine continuation state without using `CHANGE`.

**Why:** Capturing continuation state is distinct from switching execution to
another Thread; it must not be described as requiring a new IDE-only snapshot
format or a Thread switch.

**How to apply:** Base proposed Thread checkpoint/rollback services on the
existing continuation structure. Reserved space may retain a saved version;
the exact capture/resume method contract remains to be defined. Do not infer
that a single `SAVE` instruction captures all state without checking its ISA
contract.