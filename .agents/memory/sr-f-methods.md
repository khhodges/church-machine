---
name: SecurityRegulator F methods
description: Separate SetNear and SetFar interfaces and their approval boundary.
---

Use SetNear and SetFar, each taking DR1=n to select the caller's CR[n].
SetNear explicitly selects Near; SetFar explicitly selects Far. Neither
toggles F nor takes a DR2 value argument. DR1 returns common API status.

**Why:** The user selected separate named methods, matching the explicit
SetB/ResetB interface approach.

**How to apply:** Do not reopen names or register selection. Verify F encoding,
permitted targets, caller-register access and mechanism against unchanged
ISA/RTL. Rejection effects and numeric fault codes remain separate decisions;
do not infer approval from the B methods.
