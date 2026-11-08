---
name: Notebook export memory
description: Bound retained state when refreshing large document exports repeatedly.
---
Keep export-generation strings local to a short async function rather than
retaining a new top-level notebook variable for every revision.

**Why:** Repeated specification/HTML exports accumulated retained notebook state
until the 32 MiB limit reset the notebook. File writes completed before that
reset; a failed notebook capture did not mean the exports were unwritten.

**How to apply:** Use local scope and log only verification summaries. After a
capture-limit failure, verify the written files before rerunning writes; do not
rely on earlier notebook variables or pending jobs surviving the reset.
