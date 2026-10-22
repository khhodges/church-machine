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
