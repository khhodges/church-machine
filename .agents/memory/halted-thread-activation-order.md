---
name: Halted Thread activation order
description: Rules for turning a selected saved Thread image into the simulator's live stopped execution context.
---

A manual stopped-Thread switch must install the incoming Thread's CR12 context before restoring its live CR0–CR11 and DR0–DR15 banks. Restore is a privileged projection from saved homes, not a series of ordinary capability writes through the outgoing CR12.

**Why:** Ordinary register writes consult the currently active CR12 home. Restoring before CR12 changes can therefore write incoming capability values into the outgoing Thread image. HALT and host call-frame state are not serialized Thread fields; carrying them across makes the selected context unable to Step, Walk, or Run.

**How to apply:** Save the real outgoing live bank first, install the target Thread GT/base in CR12, project saved register homes into the live bank without rewriting the image, establish entry CR14/PC, clear transient flags/stack frames and HALT, and defer invalid entry faults until execution is attempted.