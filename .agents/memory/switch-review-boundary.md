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
promise an automatic return to the original Namespace.

SWITCHM always uses the SYSTEM Thread in slot 2, including the outgoing
execution context and the destination Namespace's entry Thread.

**Why:** The user reiterated that this was already agreed; describing an
arbitrary calling Thread incorrectly reopened the execution-context choice.

**How to apply:** Frame continuation questions in terms of the two Namespaces'
SYSTEM Threads. Do not infer a new RTL admission check from this software
execution convention.

After another SWITCHM restores the original SYSTEM Thread's matching saved
context, resume after SWITCH and RETURN from SecurityRegulator to the original
caller.

**Why:** The user approved this continuation because the save and load halves
of CHANGE match. The suspended call belongs to that saved SYSTEM context.

**How to apply:** Verify the matching saved continuation rather than inventing
a fresh call or return path. RETURN completes the call in the restored Namespace;
it does not switch Namespaces or guarantee a later restoration.

Transactional state is saved automatically by the ISA. SWITCHM must rely on
that preservation, not impose a separate caller-save contract for that state.

**Why:** The user corrected the attempted caller-versus-method preservation
choice: “Everything transactional is saved automatically by the ISA.”

**How to apply:** Do not reopen architectural transactional preservation as an
ABI choice. Verify implementation scratch use separately without weakening or
duplicating the ISA's context mechanisms.
