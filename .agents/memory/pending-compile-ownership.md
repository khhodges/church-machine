---
name: Pending compile ownership
description: Preventing delayed Load-into-Simulator actions from racing with mutable catalog or registry selection.
---

A delayed simulator load must own an immutable snapshot of the exact compiled identity, words, capability rows, named slots, and method-table metadata that initiated it.

**Why:** Catalog selection and registry entries can change while a compile or UI transition is pending. Looking up “the current” entry later can silently load a different program or inject a mismatched C-list.

**How to apply:** Capture at compile success, clone nested mutable records before freezing, consume the snapshot once, and clear it on every terminal path.