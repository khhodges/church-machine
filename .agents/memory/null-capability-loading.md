---
name: NULL capability loading
description: User clarification of LOAD NULL semantics during Mint entry cleanup review.
---

Loading a NULL capability must work to close a GT and prevent its use.

**Why:** On 2026-10-21 the user explicitly corrected the claim that loading NULL
should fault: “Loading a NULL should work it is vital to close a GT and prevent
its use.” Do not treat existing simulator rejection as normative authority or
remove Mint cleanup merely to avoid correcting that rejection.

**How to apply:** Distinguish an authorized read whose value is NULL from
attempting to use NULL as access authority. The former must discard destination
authority; access checks on the source and architectural destination restrictions
still apply. This does not approve a new immediate encoding, alter the GT format,
or imply global revocation of other copies. Verify simulator and hardware
conformance separately; this clarification alone is not evidence either works.

Do not assume a dedicated NULL C-list row per abstraction is an acceptable
solution for explicit capability clearing.

**Why:** The user rejected that per-abstraction cost and proposed ISA acceptance
of all-zero NULL directly instead.

**How to apply:** Distinguish the existing NULL GT representation from direct-NULL
instruction encoding. Ordinary row zero must retain its meaning.

The user subsequently approved repurposing LOAD's redundant negative-zero
operand for direct NULL in the next build.

**Why:** It avoids a per-abstraction NULL row and keeps the FPGA implementation
small, without a new opcode or GT type.

**How to apply:** Follow the selected encoding in the master ISA; do not reopen
it as an undecided proposal. This authorizes preparing the next build, not
flashing the board or claiming physical acceptance. The ordinary indexed
NULL-value path is a distinct conformance concern, not proof from direct-form tests.
