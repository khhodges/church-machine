---
name: Board-state acknowledgement correlation
description: Rules for treating FPGA-emitted state frames as evidence for a specific host request.
---

Board state confirmation must echo a host-issued request nonce and be accepted
only for the outstanding request in the same bridge session. A host serial
write proves delivery intent, not the resulting board state.

**Why:** A delayed state frame can otherwise be attributed to a newer command,
and a partial multi-byte command can strand the parser or mutate state without
producing confirmable evidence.

**How to apply:** Commit the board state only after the complete nonce-bearing
command is received, bound partial-command waits, invalidate pending evidence
on reconnect or later mutations, and keep UIs in requested/timeout/unavailable
states until matching board evidence arrives.

Preserve the consumer's explicit target-session field in every command
envelope, even when the server also keeps an internal session field.

**Why:** Server-side admission can succeed while the bridge correctly rejects
the consumed command if its serialized envelope omits the strict session
field. Queue/consume records alone then look healthier than actual delivery.

**How to apply:** Test real dequeued server payloads against the bridge's
target matcher, including guarded uploads, rather than testing each side only
with independently invented fixtures. Keep wrong-session rejection strict.