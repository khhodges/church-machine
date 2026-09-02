---
name: Bridge-causal retirement gates
description: How to prove that a hardware retirement occurred after a UART command write despite asynchronous HTTP delivery.
---

Safety gates that require “command written, then progress observed” must use a
monotonic counter assigned where UART packets are decoded. Capture that counter
immediately after the command write and accept only a later packet from the
same bridge session.

**Why:** Command acknowledgements and trace packets travel through asynchronous
HTTP delivery. Server arrival sequence or timestamps can reorder delayed
pre-command packets and falsely satisfy the gate, or miss a valid retirement.

**How to apply:** Include the bridge counter in trace payloads and command ACKs.
Bind comparisons to the bridge session, and fail closed when an old bridge does
not provide the counter.