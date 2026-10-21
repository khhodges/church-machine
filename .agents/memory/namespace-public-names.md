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
