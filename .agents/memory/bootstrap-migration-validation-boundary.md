---
name: Bootstrap migration validation boundary
description: Why atomic bootstrap catalog publication cannot depend on checks tied to the currently published catalog or committed hardware output.
---

An atomic bootstrap catalog migration must validate the staged descriptors, binaries, approvals, generated boot image, and startup graph before swapping the directory. It must not gate that swap on hardware tests that read the currently published catalog or committed RTL.

**Why:** Before publication, catalog-derived hardware constants can only describe either the old published catalog or the staged replacement, while some hardware tests still read fixed repository paths. Combining those authorities makes a valid staged replacement fail by construction. Committed RTL freshness is also a hardware release concern, not catalog transaction integrity.

**How to apply:** Keep the migration's pre-swap checks self-contained under the staging directory. Run RTL regeneration and hardware release guards separately after catalog publication.