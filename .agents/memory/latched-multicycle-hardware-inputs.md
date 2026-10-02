---
name: Latched multi-cycle hardware inputs
description: Multi-cycle hardware operations must remain bound to all inputs present when their start handshake is accepted.
---

For a multi-cycle hardware instruction or side-band request, capture every
operand, control-flow value, and authorization predicate at the transaction
boundary. Later FSM states must consume only those captured values.

**Why:** decoder fields and one-cycle request-selected values can change long
before a later save, validation, or commit state uses them. Reading the live
input later can corrupt return state, skip work, or create a time-of-check /
time-of-use authorization bypass even though the start-cycle wiring is correct.

**How to apply:** latch all inputs on the accepted start handshake, including
values selected by temporary side-band requests. Add a regression that drops or
changes the live input after launch and verifies the operation still uses the
accepted value.

Ordinary capability conformance fixtures must finish the privileged boot
window before measuring permission/bounds containment.

**Why:** Boot-time M elevation deliberately changes checks; a test that issues
an ordinary LOAD too early can exercise privileged bootstrap behavior instead
and incorrectly diagnose ordinary access containment.

**How to apply:** Establish and verify the intended privilege phase before
capturing instruction pre-state. Keep boot-window tests separate.