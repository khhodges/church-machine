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

The agent is authorized to decide numeric error codes for any and all APIs,
without asking for approval of each assignment.

**Why:** The user explicitly delegated this: “You are authorized to decide the
error codes on any and all APIs”.

**How to apply:** Choose and document codes consistently, preserving agreed
values (including IncrementVersion maximum-version status 1) and checking
existing contracts before changes. Numeric assignments are not review blockers.
This delegation does not authorize changing approved behavior, converting
architectural HardFaults to returns, or silently migrating saved artifacts.
