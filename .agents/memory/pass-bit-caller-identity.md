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
simpler internal authorization. Genesis has explicitly approved incorporating
these decisions into the Mint abstraction; exact Pass Bit mechanics remain
unspecified. Do not reopen the approved direction or invent missing interfaces.

Recorded caller E-GT identity must include the Namespace ID.

**Why:** The user explicitly requires Namespace-qualified identity, not a bare
local E-GT.

**How to apply:** Describe the identity record as Namespace ID plus full caller
E-GT. Do not infer a change to the 32-bit GT format, an assigned storage layout,
or an approved originator-propagation mechanism.
