---
name: Authenticated compact API admission
description: Safely reconcile compact embedded API imports with authenticated source-level C-list row metadata during candidate admission.
---

**Rule:** Candidate admission must expand compact imports from the exact embedded API bytes and header. Compact imports carry canonical targets and rights, while the matching signed compiler row table carries source PetNames; join by exact relocation row and equal rights, and reject any mismatch. Never complete the C-list from browser declarations or the live catalog.

**Why:** Treating compact API data as if it had an expanded `capabilities` array rejects valid pending rows. Filling missing identity from mutable browser/catalog state would instead allow undeclared authority.

**How to apply:** When admitting a compact compile artifact, require a complete expansion and a signed row table covering the header C-list count. Preserve the embedded target identity while using signed row names for source-level pending-row matching.
