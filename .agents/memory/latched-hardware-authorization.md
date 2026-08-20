---
name: Latched hardware authorization
description: Security predicates for multi-cycle hardware operations must remain bound to their accepted operands.
---

For a multi-cycle hardware instruction, capture every authorization predicate at
the same transaction boundary as the instruction operands, then evaluate only
the captured values in later states.

**Why:** decoder register selectors may advance to the next instruction while a
sub-unit is still running. Reading a live selector in a later state creates a
time-of-check/time-of-use bypass or unexpectedly applies an authorization rule
to a different instruction.

**How to apply:** when introducing a security gate that depends on decoded
registers, latch it at instruction acceptance in the wrapper and, where a
sub-unit has its own start handshake, latch it again with that sub-unit's
operands. Add a regression that changes the live input after launch and
verifies the original authorization decision remains effective.