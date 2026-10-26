---
name: Thread home restoration authority
description: Zeroed caches do not make unresolved permission-bearing tokens safe.
---
Guarded reset restoration must not turn an unadmitted Outform into resident
authority by giving it a zero base/limit cache. Fail OUTFORM_UNAUTH until an
authenticated ingress exists. NULL discards authority; Abstract operands remain
opaque and require normal instruction type gates.

**Why:** A permission-bearing unresolved token with a zero cache can still
authorize address zero if a later memory operation checks rights without
rejecting that token type. Zeroing cached addresses is not equivalent to
discarding authority.

**How to apply:** When restoring Thread homes or materializing capabilities,
validate Inform descriptors against their original stored words before address
conversion. Do not add network fallback or implicit promotion to make unresolved
homes pass. Revisit the Outform restriction only alongside authenticated binding
and the relevant memory-access type gates.
