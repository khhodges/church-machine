---
name: Abstract GT use decisions
description: Explicitly accepted uses from the user's review of historical Abstract GT roles.
---

## Constants and mathematical values

Abstract GTs may represent immutable constants and mathematical values, such
as pi, TRUE, FALSE and Church numerals.

**Why:** The user explicitly accepted this use during the five-case review.

**How to apply:** This does not require ordinary numbers to become GTs, grant
execution authority through a constant, or adopt historical Lambda services,
methods or encodings. Encoding and access must follow the approved ISA.
Acceptance of a role is not authorization to change implementations.

## Credentials and proofs

Abstract GTs may represent an authority's approval or attestation. For Mint,
Genesis provisions the immutable B=0 proof in the authorized caller's C-list
and the matching reference in Mint; Mint checks EXACT before the protected
function.

**Why:** The user explicitly accepted this use and the Genesis/EXACT design
during the five-case review.

**How to apply:** Do not add separate cryptographic proof data, a credential
service or historical Lambda issuance/revocation methods. Follow the detailed
Mint authorization boundary in mint-context-authority-boundary.md.

## Device and I/O access — rejected as a separate Abstract GT role

Keep the existing MMIO capability mechanism; do not add a separate Abstract GT
device scheme.

**Why:** The user noted that MMIO works without this and explicitly rejected
the proposed use during the five-case review.

**How to apply:** Do not reinstate historical Abstract device categories or
their conflicting encoding as a requirement. This review decision does not
authorize changing live device bindings or programming hardware.

## Special machine-control scheme — rejected

Do not introduce a separate Abstract GT category for direct M elevation or
special SWITCH PassKeys. Keep existing ISA control mechanisms.

**Why:** The user explicitly rejected the separate machine-control scheme
during the five-case review.

**How to apply:** Preserve SecurityRegulator's protected control role and the
ISA-defined SWITCH checks. An Abstract credential authorizing a protected
function is case 2, not a distinct machine-control token scheme.

## Lambda attestation service — deferred

Defer the historical service for issuing, verifying, composing and revoking
Abstract credentials. It is not required for Mint V1.

**Why:** The user explicitly chose deferral during the five-case review.
Genesis provisioning plus EXACT already supplies Mint's agreed authorization.

**How to apply:** Do not implement this service or adopt its historical
issuance/revocation rules as part of Mint V1. Deferral does not reject
credentials or derived proofs as possible future uses and does not grant
Lambda authority to issue them.

## Proposed Abstract subtype field

The user proposed a two-bit field to distinguish the two accepted roles
(constants/mathematical values and credentials/proofs), leaving headroom.

**Why:** Two accepted categories need two values; two bits provide four.

**How to apply:** Treat this as an Abstract subtype design direction, not a
replacement for the outer NULL/Inform/Outform/Abstract GT type field. Preserve
B and its binding meaning. Exact bit positions and subtype value assignments
remain unspecified; no encoding or implementation change is authorized yet.

The user further proposed five structural bits total (two outer GT type bits,
two Abstract subtype bits and B), leaving 27 payload bits in a 32-bit Abstract
GT, with a generic constants catalogue and random credential generation.

**Why:** This is the user's intended minimal design following rejection of the
separate I/O and machine-control Abstract schemes.

**How to apply:** Treat this as the proposed Abstract-specific format, not a
change to Inform/Outform layout. Exact placement remains unspecified.
Use collision-checked secure generation for credential identifiers; random
bits alone are not authority or a large cryptographic secret. Authority comes
from approved provisioning and ISA enforcement, not a claim of unguessability.
