---

Rejecting a source-replacement comparison should open Code Edit with the
existing editor text and ignore the proposed After copy, not leave the user
on the originating inspection page.

**Why:** The user explicitly requested that Reject continue into code editing
without adopting the proposed replacement.

**How to apply:** Keep rejection false for callers, preserve source and owner,
and do not let a stale review redirect a newer document.
name: Editor source authority
description: Rules for preserving user-owned editor bytes while offering newer authoritative source explicitly.
---

Ordinary editor reopening must prioritize the editable buffer. Source freshness and
recovery notices stay compact; full before/after comparisons are opt-in and
bounded, with decisions accessible without scrolling through source.

Draft-deletion review must compare the preserved browser draft against saved
source, not merely compare current editor text with a replacement buffer.

**Why:** The user needs to identify important changes in the longer recovery
copy before deciding to delete it. A short replacement preview does not answer
that question.

**How to apply:** Clearly identify the saved and draft sides, highlight complete
source differences, and never interpret opening the comparison as deletion consent.
When diagnosing a reported short draft, establish the exact dialog and named
section first. A deletion review can contain both the copy being deleted and
the full saved replacement; the presence of full code alone does not establish
that the recovery copy contains it. Never fill a short draft with saved text
to make a comparison appear complete.

An opening-time recovery snapshot is not evidence of the browser's current
preserved draft. Reviews must read the current stored copy at the user's action,
then bind approval to those exact bytes.

**Why:** Repeated reports of a 1,024-character preview exposed that a banner can
retain an older prefix even after a fuller copy is stored. Labeling the prefix
does not establish that the user's current recovery data is incomplete.

**How to apply:** Recheck the reviewed copy before restoring or deleting it;
if it changed, preserve both editor and storage and require a fresh review.

Passing a synthetic stale-draft reproduction does not establish the cause of a
user's actual short copy. When it persists, gather explicitly shared read-only
evidence of their selected LUMP's recovery stores instead of claiming another
fix from screenshots or choosing the longest copy as authoritative.

**Why:** The programmer's screenshot showed a full comparison consuming the
editor area and hiding the decision controls, making code opening unusable.

**How to apply:** Keep both draft preservation and explicit replacement consent.
Do not solve a notice-layout defect by automatically discarding a draft.

The persisted editor document is the user-owned source buffer. Restore its bytes and typed owner exactly. Server, built-in, and immutable-artifact source is advisory until the user explicitly accepts an exact before/after replacement of that document. Never let startup, navigation, background reconciliation, syntax repair, or a stale asynchronous result silently overwrite an owned draft. Preserve drafts under their owner when changing documents, and keep editable source authority separate from immutable LUMP binary authority.

**Why:** Freshness or artifact authority does not imply overwrite intent. Startup and asynchronous work can race with typing, navigation, and unsaved-draft recovery; preferring another source can destroy the only copy of user text. Exact restoration, explicit acceptance, and owner-scoped recovery preserve user agency while still exposing authoritative content.

**Execution-focused navigation clarification — 2026-10-19:** The user requires
the editor to match the simulator: after executing CapabilityTest, the user
assumes CapabilityTest is in focus. An unrelated Self-Test buffer must not be
presented as its "before" source when opening the executed program.

**Why:** The user called that cross-program replacement presentation
"incompatable" with the execution context. Draft preservation must not make
the IDE present a different program as the one being investigated.

**How to apply:** Distinguish document navigation from overwriting a document.
Execution/fault-focused opening selects the exact executed artifact, preserving
other drafts under their own owners rather than asking to rewrite one program
into another. Keep unsaved edits distinct from executed source; if matching
source is unavailable, expose exact binary inspection with that limitation,
not a substituted latest revision. This does not authorize discarding drafts,
changing running bytes, or installing artifacts.

Label-free private execution must be matched to editor source through the
admitted Namespace fingerprint and exact artifact binding, never a slot number
alone or a fabricated runtime name. Ordinary Programs / Editor navigation must
not silently become the executed-code inspector.

**Why:** The user approved correcting navigation after a legitimate label-free
runtime appeared as “Unnamed” and sent Programs / Editor to a different tool.

Successful builds and saves should prioritize source beside exact binary disassembly, with build diagnostics available separately. Candidate bytes must never be labeled as the saved artifact.

**Why:** The user wants to inspect generated instructions, not have successful audit messages replace that view. Source preservation and binary inspection are independent requirements.

Compilation must provide immediate feedback in a console modal while the user
waits, not only write diagnostics after completion.

**Why:** The user reported that compilation takes many seconds without feedback
and explicitly requested progress in a console modal.

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