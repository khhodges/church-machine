---
name: UART raw-transfer ownership
description: Protect raw binary UART transfers from bridge control traffic.
---

When a board UART state machine is consuming an unescaped binary payload, the
bridge must treat the link as exclusively owned by that transfer until the
payload has drained. Defer run, snapshot, breakpoint, and queued command bytes
instead of assuming the payload parser can distinguish them.

**Why:** A single ASCII control byte is syntactically valid binary data. It can
silently shift a LUMP payload, causing an integrity failure only after the
whole transfer, and can make bounded retry loops fail repeatedly.

**How to apply:** Have the sender derive an exclusive interval from the framed
response length and baud rate (or use an explicit completion frame), and extend
it for every retry/next transfer. Gate deferred automatic commands as well as
ordinary command polling.

HTTPS latency must not become a pause in UART reception. When giving internet
requests realistic bounded timeouts, keep command polling off the receive
thread and permit only one outstanding dequeue response; never prefetch a
second command while the first response or its transfer is being handled.

**Why:** Subsecond HTTPS deadlines are unreliable across the public proxy,
but simply extending a synchronous poll can overflow serial receive buffers.
Unbounded or ahead-of-execution dequeueing also destroys command ownership.

**How to apply:** Keep serial execution on its owning thread. Background HTTP
work may return a response but must not write UART, replay timed-out commands,
or enqueue a second consuming GET until the prior response is consumed.