---
name: C-List source-row indexing
description: The editor C-List view must account for the compiler-owned SELF row when mapping displayed rows to source declarations.
---

The compiler-owned `SELF` capability is a synthetic CR0 and is not part of the
source `capabilities { ... }` declarations. User declarations therefore display
starting at CR1, and deletion must use an explicit source declaration index
instead of treating the displayed CR number as a source-array index.

**Why:** Treating the first source declaration as CR0 hides it behind `SELF`;
deleting later rows then removes the wrong declaration and corrupts the editor.

**How to apply:** Keep synthetic CR0 rendering separate from parsed source
entries. Give each user row both its display slot and source index, and protect
CR0 from all source-editing operations.