---
name: Namespace public names
description: Use exact dropdown names for Namespace profiles in the IDE and reports.
---
The Namespace dropdown names are the public naming authority. Use their exact
wording in profile banners, inspection views, and user-facing reports; do not
substitute internal keys or aliases such as NewLayout or Legacy Namespace.

**Why:** The user rejected an audit whose headings did not match the dropdown,
then explicitly requested standardization on the dropdown names.

**How to apply:** Keep storage keys and saved selections unchanged. Reuse the
shared public labels and test them against the dropdown options.

Namespace labels and version links open the exact assigned LUMP, never a
separately associated source file or a newer library revision. Non-LUMP labels
open their object definitions. Missing assignments and missing embedded source
must be explicit. Standalone .cloomc files remain accessible through File Open.

**Why:** The user rejected competing source-file and saved-LUMP label meanings,
and explicitly approved independent files only through File Open.

**How to apply:** Ignore historical authoring associations for label navigation
without deleting those files or rewriting saved assignments. Preserve drafts
and keep navigation separate from compilation, simulation, and hardware.

Switching between assigned LUMPs is document navigation, not a source
replacement comparison. Preserve the outgoing draft under its owner.
**Why:** Showing SelfTest versus Alice's absent source as a deletion diff
misrepresented a label click. Empty-editor checks do not cover this case.

Every LUMP preview must identify the exact LUMP and show its declared named
C-list; a revision number and raw hex alone are not an adequate LUMP display.
**Why:** The user explicitly reiterated, “A LUMP is a LUMP always show it correctly.”
**How to apply:** Decode names from the selected artifact, distinguish naming
Namespace from runtime placement, and distinguish symbolic rows from localized
tokens. Historical previews must not borrow current-state identities.

Give the C-list highest prominence and the API equal importance to source.
**Why:** The user explicitly stated the API is equally important and the C-list
even more so.
**How to apply:** Show decoded named capabilities first, with an always-visible
saved API before source and raw binary. Do not hide the API behind disclosure.
