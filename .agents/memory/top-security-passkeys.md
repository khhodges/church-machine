---
name: Top-security passkey credentials
description: Security rule for programmer-defined protected objects and their passkeys.
---

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