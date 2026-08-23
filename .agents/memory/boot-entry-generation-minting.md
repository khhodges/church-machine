---
name: Namespace reissue generation
description: Every capability minted for a reused Namespace slot must use the slot’s issued sequence.
---

Every GT created for a Namespace entry must take its sequence from that entry's
live Word 1. When a cleared slot is reused, the retained next sequence must be
used consistently for the new Namespace authority, compiler-owned SELF,
Thread/boot capabilities, code capabilities, dynamic data aliases, and lazy
name-resolution capabilities.

**Why:** Reissuing an entry increments its descriptor generation without
changing its slot. Hardcoding sequence zero can either create an immediately
stale credential or revalidate an old revoked credential.

**How to apply:** Select the issued sequence once before committing a reused
slot, then propagate that same value through its W1 and every GT minted for it.
After commit, read W1[29:21] as the authority; never treat a slot number as
sufficient identity.