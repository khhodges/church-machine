---
name: Common API return status
description: User-selected DR1 status convention for every API RETURN, with HardFault excepted.
---

Every API method uses DR1=0 for successful RETURN and a nonzero DR1 fault code
for a returned failure. HardFault remains the ISA fault path, not a normal
status return.

**Why:** The user explicitly expanded the SecurityRegulator return policy to
every API RETURN.

**How to apply:** Keep functional results separate from status. Consume DR1
inputs before writing status. Existing scalar-payload uses of DR1 need explicit
API/caller reconciliation; no alternate payload register is implicitly approved.
This is a software convention, not automatic RETURN behavior or an ISA/RTL
change. Do not claim saved LUMPs already comply or silently rewrite them.
