---
name: Attention compilation provenance
description: Compilation dates in safety-oriented review popups
---
Show the exact selected artifact's compilation date and time, including timezone,
without requiring expansion of its issue. Unknown must remain explicit.

**Why:** The user considers the attention popup dangerous without compilation
date/time; a fresh inspection does not establish a fresh binary.

**How to apply:** Keep inspection time separate from compilation time. Never
substitute file modification time, newer same-name revisions, or editable
source timestamps for the selected artifact's compilation provenance.

The user clarified that the reported duplicate Mint rows were in **Open File
Catalog**, not only Needs attention, and approved one expandable Mint entry
containing source and saved revisions, with MintCleaner separate.

**Why:** Same-name binary rows and broad search matches appeared to be four
interchangeable examples. Keep different artifacts explicit within the group;
grouping must never silently choose a revision or change Namespace assignments.
