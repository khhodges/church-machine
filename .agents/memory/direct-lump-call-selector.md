---
name: Direct LUMP call selector
description: Distinguishes direct single-entry LUMP calls from method-table dispatch.
---

A capability that names a complete single-entry LUMP must use call selector 0 when its first word after the header is executable code. Selector 1 is only valid when word 1 is a method-table entry.

**Why:** Treating a descriptive sidecar method at offset 0 as method-table index 1 makes the machine interpret the LUMP's first instruction as a dispatch-table entry. Hardware-ROM LUMPs can expose method-like metadata without containing a method table.

**How to apply:** Before choosing a nonzero selector for a direct capability call, verify the binary actually has a method table. For default-entry ROMs, preserve selector 0 and encode only the C-List row.