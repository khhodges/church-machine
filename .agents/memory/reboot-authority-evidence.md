---
name: Reboot authority evidence
description: Distinguish live reset authority, persistent Thread homes, and opcode-labelled diagnostics.
---

Do not infer usable capability authority from LOAD-shadow telemetry alone.
Compare complete live descriptors and M state, check whether the condition
passed, and distinguish reset clearing from subsequent Thread-home restoration.

**Why:** An exact-image runtime-reload investigation found a skipped LOAD.EQ
labelled as LOAD with a previous run's diagnostic shadow. A memory-retaining
reboot is also not equivalent to re-uploading immutable initial Thread homes.

**How to apply:** Keep diagnostic fixes separate from architectural revocation
policy. Replay exact admitted bytes; if another execution model rejects their
format, report that boundary instead of translating the fixture or counting a
fallback/default boot as a successful replay.

Capture a fault's code on its valid cycle, then collect registered instruction
metadata after the clock edge. A fault pulse ending does not prove recovery;
observe the Boot reset transition independently.

**Why:** A recovery probe sampled the code after the pulse and falsely reported
code zero at the otherwise correctly identified intentional fault.
**How to apply:** Keep same-cycle cause evidence separate from latched snapshot
evidence, and verify recovery via Boot transitions rather than deasserted faults.

For the retained-memory RTL recovery investigation, the user states that the
continuation should work. Do not equate a suspended continuation with corruption
merely because it differs from a pristine startup root.

**Why:** The user corrected the fresh-stack interpretation during diagnosis.
**How to apply:** Validate continuation geometry and authority independently of
fresh-start admission. This does not authorize a runtime fix or change the
separate IDE fresh-reset policy.

The user clarified that if this continuation fails, “try again and again,” and
explicitly rejected interpreting the second failure as a Genesis fallback.

**Why:** This clarifies the intended retained-continuation recovery behavior,
superseding the older second-failure fallback interpretation for this path.
**How to apply:** Investigate repeated continuation attempts rather than a
retry-count-triggered Genesis switch. Do not bypass authority checks or treat
this behavioral clarification as approval to change the runtime.

For passive RTL memory probes, distinguish bus visibility from consumed reads:
synchronous BRAM may still expose the preceding address's data on the first
request cycle. Follow the consumer's armed handshake before assigning causality.

**Why:** Raw recovery traces contain both the unsettled and settled values;
equating every request-cycle sample with a consumed read falsely suggests
memory corruption.
**How to apply:** Record request/response timing and validate the settled sample.
Also distinguish initial guarded Boot writes from writes during recovery.
