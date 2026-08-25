---
name: SELF row click safety
description: Interaction rule for the compiler-owned SELF row in the C-List.
---

The C-List's row 0 SELF entry is the pet name for the abstraction named by the
current editor window. It is display-only in the C-List UI and must not fall
through to ordinary row-click operand insertion or any editor mutation.

**Why:** Treating SELF like a user capability allowed a click on its label to
write into the source editor, including when the editor selection was in a
large recovered source buffer.

**How to apply:** Resolve SELF against the active editor abstraction when
compiling or displaying its C-List identity, but guard the row before generic
row actions. Keep editing, deletion, and pet-name actions limited to user
capability rows.