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
