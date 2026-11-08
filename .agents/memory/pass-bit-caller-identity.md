---
name: Pass Bit and caller identity
description: Passcode scope clarification and Namespace-qualified caller E-GT requirement
---

The user's objection to general Passcode machinery is proliferation of slots
and C-lists, not private program use of passcodes in exceptional circumstances.

**Why:** The user explicitly clarified that programs can still do this privately;
do not turn the proposed simplification into a prohibition or claim passcodes
are inherently unworkable.

**How to apply:** Keep application-level passcodes available while discussing
simpler internal authorization, subject to the current deferral below.

Recorded caller E-GT identity must include the Namespace ID.

**Why:** The user explicitly requires Namespace-qualified identity, not a bare
local E-GT.

**How to apply:** Describe the identity record as Namespace ID plus full caller
E-GT. Do not infer a change to the 32-bit GT format, an assigned storage layout,
or an approved originator-propagation mechanism.

Genesis subsequently directed: “For Phase 2 ... Lets leave Passcodes unchecked
as already designed.” Defer the general Pass Bit and specialized-regulator
indirect-CALL authorization redesign.

**Why:** The user considers the general mechanism too risky to rush and wants
to avoid blocking Phase 2 on it.

**How to apply:** Do not reopen these decisions or make them Phase 2 delivery
gates. Do not claim unchecked Passcodes authenticate callers. Keep ordinary
capability checks and the dedicated GTMint GT.M decisions separate. Do not
silently remove existing checks from historical runnable code or misreport
current implementation behavior based on this design decision.
