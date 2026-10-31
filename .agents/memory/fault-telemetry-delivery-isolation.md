---
name: Fault telemetry delivery isolation
description: Preserve local hardware fault evidence and recovery safety when IDE transport is unavailable or delayed.
---

All IDE-bound bridge telemetry that may occur on the serial receive path must be
queued to bounded asynchronous delivery. A decoded fault is recorded and printed
locally before delivery; its trace and reason-2 snapshot retry independently of
UART parsing.

**Why:** A synchronous HTTP timeout can make a real board fault look like a
missing trace. A delayed completion from an older incident can also accidentally
lend stale server correlation data to a later fault.

**How to apply:** Keep the active incident ID on every retry payload. Before
accepting a trace or snapshot delivery result, verify that it belongs to the
currently armed incident; discard stale results. Automatic recovery remains
blocked unless the active trace and its complete reason-2 snapshot were both
confirmed by the server.

Preserve the complete bounded acceptance-run trace without blocking UART
parsing or making fault evidence wait behind ordinary history. Any finite
buffer overflow or delivery failure must explicitly mark history incomplete.

**Why:** A small ordinary queue and an idle wait per packet silently discarded
most pre-attack events while the priority fault arrived successfully. Correct
fault reporting alone hid the loss and did not satisfy physical acceptance.

**How to apply:** Size buffering and visible retention for the acceptance
burst, wait only when both queues are empty, and test a stalled sender followed
by a full burst drain with fault priority preserved. Do not claim lossless
unlimited recording or infer instruction counts from trace-event counts.