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

Retain the session on ordinary trace evidence as well as fault evidence;
do not silently assume a missing session matches the current board.

**Why:** Prioritizing fault delivery can make the server's newest ordinary
trace describe execution before an already captured fault. A complete fault
snapshot and a later-arriving non-fault trace are not contradictory evidence
of recovery. Packet counters need their session boundary to remain meaningful.

**How to apply:** Separate snapshot authority from arrival-order UI state,
preserve packet/session identity in stored records, and report missing tags
as an evidence limitation rather than inventing them in offline analysis.

Do not reconstruct a definite call depth from an incomplete packet prefix.
Report it as unknown until missing predecessors arrive; keep arrival-order
history cursors separate from the session-scoped execution clock.

**Why:** Priority delivery can omit earlier CALL/RETURN records temporarily.
Ignoring their state effects prevents a false recovery, but counting only the
remaining records would still fabricate a call depth.