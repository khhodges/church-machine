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