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