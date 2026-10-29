---
name: IDE approved views and implementation simplicity
description: Genesis-approved UI details define the product; internal security mechanics must support that model without becoming a competing workflow.
---

The user restated the IDE goal on 2026-10-17: "the UI views are the approved
details, the seals and security issues should be non functional, implementation
details not blocking problems" and "The IDE should aim to simplify and refactor
code at every opportunity".

**Why:** Internal manifests and security bookkeeping had been treated as reasons
to reconcile or change approved Namespace selections. The IDE should implement
the user's approved model, not require the user to administer its internals.

**How to apply:** Treat explicitly approved UI details as the functional
contract. Seals and security are non-functional implementation responsibilities:
derive and maintain them consistently behind the UI, not as a second source of
approval. An internal bookkeeping mismatch is an implementation defect to fix,
not a reason to ask Genesis to alter valid approved choices. This is not an
instruction to disable protection, falsify verification, silently change approved
details, or regard every unapproved draft as approved. Explain genuine functional
invalidity in terms of the user's objects and requested operation.

Prefer removing duplicate state, obsolete branches and redundant validation
paths to adding adapters, fallback authorities or special-case repairs. Simplify
and refactor the affected code during scoped changes while preserving approved
behavior; this standing goal does not authorize unrelated broad rewrites,
saved-artifact changes or hardware actions.

The user reiterated on 2026-10-29: security must be hidden and automatic.
First establish a working end-to-end hardware arrangement; then perform a
substantial simplification review, rather than expanding the operator's checklist.

**Why:** The operator was repeatedly sent between token entry, duplicate Target
selectors, refresh controls, and historical fault displays just to request a reboot.
Mechanically correct security gates are not sufficient if the workflow is unusable.

**How to apply:** Own internal diagnosis and reuse verified configuration. Keep
genuine identity/authentication enforcement, but do not expose it as a sequence
of manual bookkeeping tasks. Do not use the later simplification review to
delay the current functional milestone or claim success before board evidence.

During active hardware build validation, stay on the build/tests and do not
surface separate usability or unrelated follow-up task proposals.

**Why:** On 2026-10-29 the user explicitly called those proposals confusing and
asked to stay focused on the build tests. The broader simplification review is
for after the arrangement works, not a parallel operator workflow.

**How to apply:** Keep diagnosis, corrections and evidence for the current
hardware candidate together. Report the specific build gate and result without
redirecting the user into additional task cards.

Every completed explicit Bind action must visibly present its outcome, even
when the design is unchanged or earlier result windows were closed.

**Why:** The user repeatedly reported missing binding popups. An inline error
below the table does not satisfy the Bind interaction they expect.

**How to apply:** Show fresh per-LUMP reports on success and the actual blocking
reason on failure; never substitute cached successful results. Make an in-flight
Bind visibly busy rather than appearing to ignore the click.

Namespace membership must not silently shrink during binding, fallback removal,
or profile changes. A successful binding report is not evidence that all
programmer-declared members were preserved.

**Why:** The user reported slots 6 and 9 disappearing from Newlayout without
warning. Missing or invalid dependencies must remain visible, not be removed
to make the remaining bindings pass.

**How to apply:** Preserve selected rows and distinguish each profile's saved
membership. Any proposed removal must explicitly identify its slot and name for
confirmation; verify membership as well as binding status.

The user explicitly confirmed on 2026-10-19 that they removed `ide.Mint` from
Newlayout slot 9 after its restoration.

**Why:** Its later absence was incorrectly suspected to be an unexplained
overwrite; the user clarified that it was their own deliberate edit.

**How to apply:** Do not restore Mint to slot 9 or investigate that confirmed
removal as data loss unless the user requests a new change. It is separate from
the simulator display issue.

Internal IDE testing controls, preparation details, and repair shortcuts must
not appear as a separate programmer-facing simulator workflow.

**Why:** The user explicitly rejected the private-simulator panel and internal
“installed image” terminology as confusing.

**How to apply:** Keep internal verification behind the normal controls. Show
actual program output and errors through the existing programmer-facing UI,
not a duplicate diagnostic simulator panel.
