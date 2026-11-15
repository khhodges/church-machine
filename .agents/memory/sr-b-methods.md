---
name: SecurityRegulator B methods
description: SetB remains required; ResetB was withdrawn because CALL already clears passed B.
---

Use SetB only in the CALL-based SR API. DR1=n selects CR0–CR4 or CR7–CR10;
SetB sets B=1 in place. No DR2 value argument. DR1 then returns standard API
status. Do not change other GT fields or other copies. Omit ResetB.

**Why:** The user initially selected separate setters, then agreed ResetB is
redundant because CALL clears B on passed registers before SR executes.
SetB remains useful because RETURN preserves a deliberately returned B=1.

**How to apply:** Do not export ResetB or change CALL semantics. Verify SetB
against unchanged ISA/RTL. Numeric error codes are delegated to the agent.

SetB leaves the selected GT unchanged on returned software rejection
and return a nonzero fault code in DR1. HardFault retains the ISA fault path,
without a rollback guarantee.

**Why:** The approved unchanged-GT rejection rule remains applicable to SetB.

**How to apply:** Measure unchanged state at SR entry, after CALL effects;
keep returned rejection distinct from architectural HardFault.
