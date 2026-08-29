---
name: Halted Thread activation order
description: Rules for turning a selected saved Thread image into the simulator's live stopped execution context.
---

A manual stopped-Thread switch must install the incoming Thread's CR12 context before restoring its live CR0–CR11 and DR0–DR15 banks. Restore is a privileged projection from saved homes, not a series of ordinary capability writes through the outgoing CR12. After CR0 is restored, CHANGE must use the same validated LUMP-header microcode as CALL to install CR6 and CR14 together.

**Why:** Ordinary register writes consult the currently active CR12 home. Restoring before CR12 changes can therefore write incoming capability values into the outgoing Thread image. Independently synthesizing CR14 leaves CR6 stale and can diverge from canonical header geometry. HALT and host call-frame state are not serialized Thread fields; carrying them across makes the selected context unable to Step, Walk, or Run.

**How to apply:** Save the real outgoing live bank first, install the target Thread GT/base in CR12, project saved homes without rewriting the image, then feed restored CR0 and its validated header through the shared CALL/CHANGE installer. It must derive CR6's L-only c-list tail and CR14's RX code view with matching metadata and M state. Clear non-serialized execution state and HALT, and defer invalid entry/header faults until execution is attempted.