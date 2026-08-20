---
name: SELF row click safety
description: Interaction rule for the compiler-owned SELF row in the C-List.
---

The C-List's row 0 SELF entry is display-only. It must not fall through to
ordinary row-click operand insertion or any editor mutation.

**Why:** Treating SELF like a user capability allowed a click on its label to
write into the source editor, including when the editor selection was in a
large recovered source buffer.

**How to apply:** Guard the SELF row before generic row actions. Keep editing,
deletion, and pet-name actions limited to user capability rows.