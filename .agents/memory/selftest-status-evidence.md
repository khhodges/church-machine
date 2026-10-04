---
name: SelfTest status evidence
description: Distinguish a real test pass from discarded DR0 failure writes.
---

A SelfTest return is not proof of success when its failure path writes DR0. DR0 is hardwired zero; return status belongs in DR1. Arithmetic annotations must distinguish a computed result from a discarded zero-register write.

**Why:** Legacy SelfTest source used DR0 for failure numbers, masking failures under zero-register enforcement. A previously observed zero result cannot prove that the same permission test previously passed.

**How to apply:** Diagnose the branch outcome and CR/flag state independently from return status. Preserve the evidence preceding the failure IADD, because that instruction changes flags. Do not attribute a new TPERM failure to ABI enforcement alone; it explains missing status, not the failed condition.

SelfTest execution verdicts must be bound to the exact selected binary's control-flow locations, not historical hardcoded instruction addresses.

**Why:** Stale addresses have classified a correctly executed BRANCHCC as a failure and waited for a RETURN on a correctly skipped failure path. Both reported arithmetic failures despite a clean hardware-model trace reaching the next tests.

**How to apply:** Validate branch and failure-path words against the selected artifact before interpreting a trace. Derive targets from that artifact and verify their meanings independently; never update expected addresses merely to match observed execution.

Validate an active revision against its own declared identity, not a prospective rebuild's identity. Offline review candidates carry no admission authority.

**Why:** Repacking canonical source can allocate a different size and advance a proposed issue even while the selected artifact remains internally consistent. Comparing its approval to that future issue creates misleading stale-identity failures. Preparing corrected bytes does not authorize live replacement.

**How to apply:** Separate source freshness, internal selected-artifact consistency, and candidate adoption. Candidate preparation must leave Namespace, approvals, selected binaries and boot images unchanged; review allocation and destination-local capability binding before explicit adoption.