---
name: Ascending-v1 candidate boundary
description: Keep new-format Namespace review and approval separate from Header V2 publication and activation.
---

Ascending-v1 image review may create only a separate, exact-hash-bound
profile-approval record. That record is not a historical LUMP approval and
never authorizes installation, simulator activation, or hardware programming.
Every future installer must require its own explicit authorization and retain
the profile-specific byte validator; historical Header V2 publishers must
reject ascending-v1 images.

**Why:** Structurally valid private candidates are not evidence of hardware
certification or permission to replace the currently published image.

**How to apply:** Keep candidate generation, profile review, installation,
activation, and hardware programming as distinct gates. Bind review to exact
candidate bytes and fail closed when routing those bytes through legacy paths.
