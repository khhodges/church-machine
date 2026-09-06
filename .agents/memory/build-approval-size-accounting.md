---
name: Build Approval size accounting
description: Rules for displaying LUMP component sizes and remote build diagnostics
---

Build Approval size reporting must be informational and binary-derived: use the
header-declared code/c-list/allocation geometry and the existing 0xAB frame
parser for embedded API metadata. Legacy binaries without a frame should
explicitly say API metadata is unavailable, while reserved freespace remains
distinct from measured content.

**Why:** Manifest estimates can drift from the committed binary, and lazy
runtime LUMPs must not become a new approval blocker.

**How to apply:** Keep approval gating based on existing checks; add size fields
to the NS-map payload and include lazy entries only as informational data. Header
facts and size budgets for one row must use the same resolved binary path and
intrinsic parser; token lookup is only a fallback for rows without an inspected
artifact.