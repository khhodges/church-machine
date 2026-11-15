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
from loading. Do not introduce an implicit SR fetch. The separately approved
missing-binding return rule below now settles that outcome.

MakeInformM's register signature is approved: DR1=n selects the caller's
CR[n] containing the original Outform; success converts that register in place
to Inform, with DR1 then carrying common API status.

**Why:** After separating the register question from Lazy Load, the user
explicitly agreed to the register signature.

**How to apply:** Do not reopen the register selection. Verify feasibility
against unchanged ISA/RTL; signature approval alone does not settle allowed
registers or all conversion failure effects.

MakeInformM also leaves the selected Outform GT unchanged on a returned
software rejection, with nonzero DR1 status. Success replaces it with the
Inform and returns DR1=0; HardFault carries no rollback guarantee.

**Why:** The user explicitly approved matching MakeOutformM's rejection rule.

**How to apply:** Keep this guarantee distinct from selecting which conditions
are returnable failures versus HardFault and from the original request's Lazy
Load responsibility.

If MakeInformM finds no valid local binding, return the exact same Outform GT
in caller CR[n], with nonzero DR1 under the common status convention. The
numeric code remains unassigned; missing binding alone does not cause HardFault.

**Why:** When asked about the missing-binding outcome, the user specified
“Return the same Outform GT”.

**How to apply:** Preserve the GT exactly; do not clear it to NULL, reconstruct
it, or initiate Lazy Load. IncrementVersion's NULL-on-failure rule does not
extend to this method. Other architectural HardFaults remain separate.

An object may be unfinished when MakeInformM is requested.

**Why:** The user supplied this example to explain retaining the same Outform
when conversion cannot yet produce an Inform.

**How to apply:** Preserve the reference without claiming readiness. Do not
infer that SR must finish the object, wait, or initiate Lazy Load.

If MakeInformM receives an already-valid Inform in caller CR[n], return that
established Inform unchanged with DR1=0.

**Why:** Asked about an already-valid Inform input, the user answered “Return
the established inform”.

**How to apply:** Treat the already-achieved form as success, not a wrong-form
rejection. Do not extend this to stale or otherwise invalid GTs, reconstruct
the GT, or silently refresh its version.

If MakeOutformM receives an already-valid Outform, return that exact Outform
unchanged with DR1=0.

**Why:** Asked about an already-valid Outform input, the user approved
“Success + Outform GT”.

**How to apply:** Treat the already-achieved form as success. Preserve validity
checks; do not silently refresh stale references or infer that the indexed
caller-register mechanism has been verified.

MakeInformM and MakeOutformM return NULL unchanged with a nonzero DR1 fault
code when the selected input GT is NULL; the numeric code remains unassigned.

**Why:** Asked how both conversion methods should handle NULL, the user chose
“Return NULL and fault code”.

**How to apply:** Do not HardFault solely for NULL conversion input, report
success, construct a reference, or initiate Lazy Load. Other architectural
HardFaults remain separate.

MakeInformM and MakeOutformM preserve permissions, type, B, F and other GT
attributes; only the representation fields required for the form conversion
may change. If preservation is impossible, return failure with the source
GT unchanged.

**Why:** Asked whether conversions preserve permissions exactly, the user
extended the requirement to “including typer, b f etc”.

**How to apply:** Treat attribute preservation as settled, not a future B/F
policy question. Verify exact representation mapping against unchanged ISA/RTL;
do not silently add/remove authority, refresh stale identities, or claim the
implementation mechanism has already been proven.

MakeOutformM converts only the selected GT, leaving the local object, Namespace
binding and other GT holders unchanged. It does not release local storage.

**Why:** The user approved leaving the object and binding intact when asked
whether conversion should also release storage.

**How to apply:** Keep reclamation a separate lifecycle operation; do not
couple conversion to eviction, unbinding or changes to other references.

For SR methods targeting caller CR[n], permitted indices are 0–4 and 7–10.
CR5, CR6 and CR11–CR15 are excluded.

**Why:** The user specified “n<5 or (>6 and <11)” when asked about permitted
caller registers.

**How to apply:** Use `0 <= n < 5 || 6 < n < 11`; do not reopen the permitted
range. Caller-context access and result preservation still need implementation
verification. The user clarified that updating the Namespace version and
making the code meet its contract are the task, not further approval questions.

Conversion attribute preservation is measured at SR entry, after CALL's
architectural B clearing. Do not recover the pre-CALL B value.

**Why:** The user explicitly agreed after the CALL behavior was explained,
also approving omission of redundant ResetB.

**How to apply:** Preserve the B value received by SR (normally zero after
CALL). Do not treat pre-CALL B preservation as an implementation blocker or
change ISA/RTL to restore it.

Do not assume M-authorized DATA readback can install every GT representation.
The existing Outform LOAD path rejects or resolves/promotes an Outform, rather
than simply returning it unchanged.

**Why:** Native SR implementation reached this concrete conflict with the
approved no-Lazy-Load conversion contract. Successful Inform construction is
not evidence that Outform materialization works.

**How to apply:** Verify the current native type path before implementing
conversion. Do not substitute host GT manufacture, silent promotion, or RTL
changes for the approved unchanged-ISA native implementation.
