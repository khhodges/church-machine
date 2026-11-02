---
name: FreeHandler template extension scope
description: Review C-list and Thread allocation built on the prepared data inventory; Namespace stays an IDE function.
---

Keep Namespace creation and configuration an IDE function for this extension.
Review new C-lists and Threads built on the prepared data-object allocation example;
the user proposes templates for Threads, typically larger objects.

**Why:** The user explicitly paused implementation to review this next step and
said to “assume Namespace is always an IDE function.”

**How to apply:** Present template and allocation contracts for review before
implementation. Do not treat this discussion as approval of a particular size,
GT encoding, runtime minting interface, initialization-owner change, or activation.

The user narrowed Phase 1 FreeHandler inventory to eight objects total: six
working data objects, one C-list with 64 slots, and one 512-word Thread.
Namespace remains an IDE function.

**Why:** The user wants the first example to cover all three object classes
without adding many large objects or a broader allocator.

**How to apply:** Supersede the earlier eight-data-object inventory for the
design review. The distribution of the six data objects, C-list physical
allocation, template bindings and method ABI still need to be settled; do not
silently preserve the old 1024-word pool geometry or implement during the pause.
