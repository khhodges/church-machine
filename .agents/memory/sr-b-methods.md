---
name: SecurityRegulator B methods
description: Separate SetB and ResetB interfaces selected instead of a value-argument setter.
---

Use separate SetB and ResetB methods. DR1=n selects the caller's CR[n];
SetB sets B=1 and ResetB sets B=0 in place. No DR2 value argument. DR1 then
returns standard API status. Neither changes other GT fields or other copies.

**Why:** The user selected separate names for clearer calls and simpler use,
instead of a single method with a 0/1 value argument.

**How to apply:** Do not reopen the paired-method choice. Verify caller-register
access and the implementation against unchanged ISA/RTL; allowed registers,
rejection behavior and numeric codes still require resolution. Do not infer
new instructions or permission to catch HardFault.
