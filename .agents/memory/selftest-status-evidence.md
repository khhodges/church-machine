---
name: SelfTest status evidence
description: Distinguish a real test pass from discarded DR0 failure writes.
---

A SelfTest return is not proof of success when its failure path writes DR0. DR0 is hardwired zero; return status belongs in DR1. Arithmetic annotations must distinguish a computed result from a discarded zero-register write.

**Why:** Legacy SelfTest source used DR0 for failure numbers, masking failures under zero-register enforcement. A previously observed zero result cannot prove that the same permission test previously passed.

**How to apply:** Diagnose the branch outcome and CR/flag state independently from return status. Preserve the evidence preceding the failure IADD, because that instruction changes flags. Do not attribute a new TPERM failure to ABI enforcement alone; it explains missing status, not the failed condition.