---
name: C-List source-row indexing
description: The editor C-List view must account for the compiler-owned SELF row when mapping displayed rows to source declarations.
---

New-abstraction templates visibly include `SELF E` in the source
`capabilities { ... }` block, but the compiler consumes that line as the
compiler-owned synthetic CR0 instead of retaining it as a user declaration.
User declarations therefore display starting at CR1, and deletion must use an
explicit user-declaration index instead of treating the displayed CR number as
a source-array index.

**Why:** Treating the first source declaration as CR0 hides it behind `SELF`;
deleting later rows then removes the wrong declaration and corrupts the editor.

**How to apply:** Render synthetic CR0 separately and filter the visible
`SELF E` marker out of user-row indexing and out of the compiler's ROM/C-List
map before encoding named loads. Give each user row both its display slot and
source index, and preserve CR0 through Delete, Add, and POLA rewrites.