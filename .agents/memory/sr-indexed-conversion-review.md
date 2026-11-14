---
name: SecurityRegulator indexed conversion review
description: Meaning and approval boundary of the DR1-selected MakeOutformM alternative.
---

The proposed MakeOutformM alternative uses DR1=n to select the caller's CR[n]
for in-place conversion, not the regulator's own CR[n].

DR1 is approved as the standard status return for all SecurityRegulator methods:
zero for success, nonzero fault code for a returned failure, except HardFault.
HardFault retains its ISA fault path. This status rule is independent of whether
the indexed conversion alternative is adopted; numeric codes remain unspecified.

**Why:** The user explicitly confirmed caller-context targeting when asked to
distinguish it from the callee's register context.

**How to apply:** Evaluate against existing CALL/RETURN and protected-register
mechanisms before replacing the earlier CR1 convention. The confirmation is
not evidence that arbitrary caller-register access works, nor approval to catch
ISA hard faults as software status or change ISA/RTL. Do not extend this
alternative to other methods without a decision.

**Why (status policy):** The user explicitly requested a standard DR1 return
policy with HardFault excepted.

**How to apply:** Consume DR1 inputs before writing status, retain GT result
destinations, and never reinterpret this software convention as authorization
to catch or downgrade an architectural HardFault.
