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

The user clarified that the outgoing Thread can only be restored after another
SWITCHM. Do not describe resumption as independent of a subsequent SWITCHM or
promise an automatic return to the original Namespace. This prerequisite alone
does not approve executing RETURN once the method is restored.

SWITCHM always uses the SYSTEM Thread in slot 2, including the outgoing
execution context and the destination Namespace's entry Thread.

**Why:** The user reiterated that this was already agreed; describing an
arbitrary calling Thread incorrectly reopened the execution-context choice.

**How to apply:** Frame continuation questions in terms of the two Namespaces'
SYSTEM Threads. Do not infer a new RTL admission check from this software
execution convention.
