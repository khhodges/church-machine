---
name: Executed-artifact freshness warning
description: User-facing rule for distinguishing a valid committed boot image from the latest successful compilations.
---

A valid, provenance-approved boot image may intentionally contain older LUMPs. The IDE must prominently and persistently identify every committed Namespace artifact that differs from the latest successful compilation for that abstraction.

**Why:** Restoring an older approved resident image made the IDE boot, but the user was blindsided because “boot works” was reported without an equally prominent warning that newer successfully compiled code was not executing.

**How to apply:** Treat boot validity and execution freshness as separate statuses. Show selected and latest versions before simulation, keep the warning visible while they differ, and never describe a successful boot as proof that current source is running. An “Update” control must attempt the guarded server operation and report success or an exact fail-closed reason; navigation alone is not an update.

The executed side of a freshness comparison, including descriptor sequence and identity-affecting fields, must come from the loaded image's verified bindings, not the saved Namespace selection.

**Why:** A Namespace selection can already name the latest WukongCallHome while the committed image still contains an older artifact. Comparing selection to catalog then misses the execution mismatch the user explicitly expects to see before Run.

**How to apply:** Distinguish selected, installed-image, and latest identities. Unknown image identity must remain unknown; explicit pins preserve selection authority but do not remove the obligation to disclose older executed bytes.

An empty admissible candidate set is unknown freshness, not proof that the image is current. Exercise the real admission comparator in freshness regressions: stub comparators cannot expose descriptor-dependent filtering.