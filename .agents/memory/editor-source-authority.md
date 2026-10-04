---
name: Editor source authority
description: Rules for preserving user-owned editor bytes while offering newer authoritative source explicitly.
---

The persisted editor document is the user-owned source buffer. Restore its bytes and typed owner exactly. Server, built-in, and immutable-artifact source is advisory until the user explicitly accepts an exact before/after replacement. Never let startup, navigation, background reconciliation, syntax repair, or a stale asynchronous result silently replace the current buffer. Preserve replaced drafts under their owner, and keep editable source authority separate from immutable LUMP binary authority.

**Why:** Freshness or artifact authority does not imply overwrite intent. Startup and asynchronous work can race with typing, navigation, and unsaved-draft recovery; preferring another source can destroy the only copy of user text. Exact restoration, explicit acceptance, and owner-scoped recovery preserve user agency while still exposing authoritative content.

Successful builds and saves should prioritize source beside exact binary disassembly, with build diagnostics available separately. Candidate bytes must never be labeled as the saved artifact.

**Why:** The user wants to inspect generated instructions, not have successful audit messages replace that view. Source preservation and binary inspection are independent requirements.

Main-view navigation must retain document ownership as well as visible text,
including a personal draft's separate saved-binary inspection. Only an explicit
document change should replace that ownership.

**Why:** History can open a personal draft rather than a saved-LUMP owner.
Clearing its owner on entry to Editor invalidates an in-flight exact-binary
response even when the source remains visibly correct. Preserving only a
saved-LUMP display mode is therefore insufficient.

**How to apply:** Navigation regressions must check personal and saved-LUMP
owners, pending binary completion, and away/back and same-view navigation—not
just the presence of a tab or unchanged source text.

Disassembly and Console Output belong in one shared tabbed output area beside
the source, not separate vertically stacked panels.

**Why:** The user repeated the request to combine them after showing a screenshot
where the stacked console left only a few visible lines of disassembly.

**How to apply:** Preserve access to diagnostics and the other output tabs, but
give the selected output view the available panel height.

Discard approval targets the reviewed document and exact recovery bytes, not
whatever text happens to occupy the editor or canonical draft key afterward.
Preserve differing copies; matching recovery state in other stores is still
eligible for deletion even if the canonical key has changed.

**Why:** A stale recovery banner plus a canonical-key mismatch can otherwise
produce endless successful-looking confirmations that delete nothing.

**How to apply:** Invalidate stale UI closures on navigation, report changed
editor/storage state, and check every recovery store rather than relying on a
best-effort single-key delete. See also
[editor persistence coverage](editor-state-migration-coverage-gap.md).