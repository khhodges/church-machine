---
name: Fault trace delivery blocking
description: Describes how Wukong bridge transport failure can hide an already-generated hardware fault.
---

The bridge handles fault trace packets differently from ordinary trace packets.
It sends the fault packet through an indefinitely retrying, server-acknowledged
path before printing the decoded event or proceeding to the local fault
handling/reporting code.

**Why:** If the IDE HTTPS endpoint times out, the bridge remains in the retry
loop. The FPGA can already be halted and have emitted a fault packet, while
the terminal and IDE show only the last successfully processed trace and a
missing-trace snapshot.

**How to apply:** Treat a missing IDE fault record alongside bridge `trace POST`
or status POST failures as a telemetry-delivery incident, not evidence that the
FPGA emitted no fault. Preserve a local fault decode before blocking on
acknowledgment, while keeping recovery fail-closed until the server correlation
is accepted.