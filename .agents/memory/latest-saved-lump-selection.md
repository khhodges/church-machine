---
name: Explicit LUMP selection versus latest revisions
description: Namespace assignments and explicit artifact choices outrank automatic latest-revision selection.
---

Related: [Catalog grouping and compilation provenance](attention-compilation-provenance.md)
records the approved expandable source/revision grouping and date/time requirements.

The user's 2026-10-19 clarification supersedes earlier automatic-latest defaults:
“the selected Namespace list is the master list NOT some unseen catalog.”
Namespace navigation follows its exact assigned artifact, never a catalog-selected
revision. Explicit history or library browsing likewise stays pinned to the
programmer's choice. SelfTest is not an implicit default.

**Why:** Automatic latest selection and stale repository state showed SelfTest
under a CapabilityTest execution heading. The programmer could not tell which
program was being inspected.

**How to apply:** Use the selected Namespace for association and revision.
Library metadata only locates that exact artifact. Keep live execution evidence
separate if the image differs from the selected assignment. Missing or invalid
selected bytes require an explicit unavailable/error state, not a substitute.

New Add-to-Namespace choices must show only the latest saved LUMP per
abstraction, not multiple revisions. Older revisions remain in History.

**Why:** The user rejected duplicate Mint entries: “only the latest Lump should
count.” This is a new-placement choice rule, not permission to update existing
Namespace assignments.

**How to apply:** Group by declared abstraction; order by saved compilation
date, then revision. Keep an invalid latest artifact visible rather than
silently choosing an older one. Preserve exact existing selections.
Namespace authority is not permission to navigate without a programmer action:
with no running program or explicit Namespace choice, keep the current editor
document. Preserve deliberate library/history browsing when leaving and returning
to its view. A later execution change invalidates an earlier execution-related
focus, but not deliberate library browsing.

**Why:** Treating the boot marker or a view transition as an implicit selection
reintroduces unwanted program changes even when the selected file is exact.

If the programmer explicitly requests the latest revision, compilation date/time
is the primary order and version breaks ties; immutable-history rows are eligible.
A failed selected revision must remain visibly failed rather than falling back.

**Why:** Version numbers alone may be misleading after import or restoration.
**How to apply:** Freshness is advisory until the programmer explicitly adopts it.

For recompilation or prospective compatibility review, inspect the latest source
before recommending replacements based on older installed/boot-selected bytes.

**Why:** The user challenged a fault-handler recommendation based on historical
Boot artifacts when newer source and saved revisions existed.

**How to apply:** Distinguish latest source, latest saved compilation and exact
installed image. Historical-byte findings do not establish current-source
defects. This review rule does not authorize changing Namespace selections.