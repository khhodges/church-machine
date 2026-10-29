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
