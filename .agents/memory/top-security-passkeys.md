---
name: Top-security passkey credentials
description: Security rule for programmer-defined protected objects and their passkeys.
---

## Scope correction: Mint authorization

The older independent-128-bit-proof requirement below does **not** govern the
current Mint PkVerify design. The user's subsequent explicit design is a
Genesis-approved immutable Abstract GT with B=0, installed in the authorized
caller and compared EXACT against Mint's trusted reference.

**Why:** The user defined this as the complete Mint authorization scheme, with
no additional proof data or authentication mechanism.

**How to apply:** Follow [Mint authorization](mint-context-authority-boundary.md)
for Mint. Do not silently reintroduce this older requirement there or assume
the clarification automatically changes unrelated protected-object contracts.

An object-scoped GT identifies a top-security passkey but must not be accepted as
the sole authority. Protected operations require the issued GT **and** its
independent 128-bit cryptographic proof before any protected handler executes.

**Why:** The fixed GT representation leaves too little variable entropy for a
top-security bearer secret; a valid GT can be guessed or enumerated without an
independent proof.

**How to apply:** Issue the GT/proof pair only to the intended recipient, retain
the authoritative proof privately, compare it before object and method
authorization, and never include the proof in audit entries, diagnostics, or
status messages. Revocation must invalidate the whole pair.

All methods should be Passkey-limited, not only Mint CREATE. Thread and
Namespace access must be Passkey-guarded even though their GTs have permissions
NONE and B=0.

**Why:** During Mint's input review, the user explicitly said Thread and
Namespace should be guarded by a Passkey and “indeed all methods should be
Passkey limited.”

**How to apply:** Treat this as the intended authorization contract, not proof
that current methods enforce it. B=0 prevents binding through SAVE; it does
not replace a Passkey check. This statement does not choose a new per-method
key format or authorize machine-level changes.

For Mint Phase 1, use the public review package at
`docs/reviews/mint-phase1/README.md` rather than reconstructing approval from
archived drafts or memory.

**Why:** The user explicitly requires worldwide reviewers to reconstruct all
guided decisions without private context. Later scoped approvals supersede
older software TBDs but do not establish implementation evidence.

**How to apply:** Keep future decisions, rejected alternatives and substantive
qualifications in that public authority trail; mark engineering proposals
separately. Do not use memory as a competing contract or silently treat review
completion as permission to provision secrets or program hardware.