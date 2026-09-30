---
name: Boot capacity advisory boundary
description: Capacity reporting is read-only; the proposed boot budget is not installation authority.
---

Treat the proposed 48 KiB boot budget and 16 KiB runtime reserve for the 64 KiB Wukong target as advisory, not an enforced policy or authorization to change residency.

**Why:** The user approved a capacity report after discussing sizing factors, not automatic installation, removal, rebuilding, or a hard budget gate.

**How to apply:** Keep saved-artifact cost, committed-image allocation, and physical-board placement distinct. An invalid layout must not produce a trustworthy free-space total; independently verified saved costs can still be useful. A fixed-size dense image file is not evidence that all its memory is occupied.