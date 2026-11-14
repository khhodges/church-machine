---
name: SWITCH review boundary
description: Retain existing SWITCH ISA and RTL semantics during SecurityRegulator implementation.
---

Keep the existing SWITCH ISA and RTL implementation unchanged during the
SecurityRegulator method review.

**Why:** After reviewing the ISA, RTL and historical build evidence, the user
withdrew the proposed direct preloaded Namespace operand and instruction-selected
incoming Thread slot. Those statements are not requirements.

**How to apply:** Build the software interface around the existing C-list lookup
and fixed slot-2 entry contract. Do not revive the withdrawn proposals as drift
fixes or infer approval for an ISA, RTL or hardware change.
