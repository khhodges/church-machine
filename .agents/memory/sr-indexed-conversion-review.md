---
name: SecurityRegulator indexed conversion review
description: Caller-register selection for conversion methods, status policy and Lazy Load boundary.
---

The proposed MakeOutformM alternative uses DR1=n to select the caller's CR[n]
for in-place conversion, not the regulator's own CR[n].

The [common API return policy](api-return-status.md) applies independently of
whether this indexed conversion alternative is adopted; numeric codes remain
unspecified. Its scope is every API, not just SecurityRegulator.

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

A returned software rejection leaves the selected caller GT unchanged and
returns a nonzero fault code in DR1. Success replaces it with the Outform and
returns DR1=0. HardFault has no rollback guarantee under this decision.

**Why:** The user explicitly approved leaving the GT unchanged on rejection.

**How to apply:** Verify rejection paths do not modify the selected GT; keep
that guarantee separate from architectural HardFault handling and from the
still-unverified caller-register access mechanism.

Lazy Load belongs to the original request, not SR's MakeInformM conversion.

**Why:** The user clarified ownership when the conversion-interface question
appeared to imply that SR would initiate Lazy Load.

**How to apply:** Keep register selection and mechanical conversion separate
from loading. Do not introduce an implicit SR fetch or infer an agreed
missing-binding status/HardFault outcome from this ownership clarification.

MakeInformM's register signature is approved: DR1=n selects the caller's
CR[n] containing the original Outform; success converts that register in place
to Inform, with DR1 then carrying common API status.

**Why:** After separating the register question from Lazy Load, the user
explicitly agreed to the register signature.

**How to apply:** Do not reopen the register selection. Verify feasibility
against unchanged ISA/RTL; signature approval does not settle missing-binding
behavior, allowed registers or all conversion failure effects.

MakeInformM also leaves the selected Outform GT unchanged on a returned
software rejection, with nonzero DR1 status. Success replaces it with the
Inform and returns DR1=0; HardFault carries no rollback guarantee.

**Why:** The user explicitly approved matching MakeOutformM's rejection rule.

**How to apply:** Keep this guarantee distinct from selecting which conditions
are returnable failures versus HardFault and from the original request's Lazy
Load responsibility.
