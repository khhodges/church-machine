---
name: Bank validation gates
description: The ordered Bank.Create validation boundary and its deliberate provenance limitation.
---

Bank.Create must validate a submitted LUMP in this order: structural framing and
zero padding, E-abstraction/type semantics, then recomputed requested-identity
seals. The SELF row for Bank is an exact Church E Inform identity capability;
method capabilities must not combine Turing X with Church E.

**Why:** Mechanical tampering and name/token substitution must fail before any
private custody is allocated. The project deliberately does not claim
genesis-rooted provenance without a defined certificate format, issuer key, and
verifier.

**How to apply:** Keep the complete binary, embedded API/source frame, and
metadata assertions in the validation calculation. Treat matching seals as
self-consistency and human-vouched provenance only; add certificate validation
as an additional Gate 3 check only when a trusted root and format are specified.