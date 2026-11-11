---
name: Guarded GT use review boundary
description: The TRY discussion authorizes a proposal, not instruction or release changes.
---

The user requested an ISA change proposal for review after discussing hostile
API GTs and ARM-style conditions. Treat guarded use as proposed, not approved.
The DREAD-only initial scope and separate-opcode recommendation are engineering
recommendations, not user decisions.

**Why:** Asking for an acceptable proposal does not authorize implementation,
new encodings, or changes to the experimental starter release.

**How to apply:** Obtain explicit semantic and encoding decisions before
changing executable behaviour. Preserve existing hard-fault rules outside any
explicitly approved guarded rejection set. Do not equate a successful individual
access with a lasting SAFE-GT certificate.
