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

New build options must not hide or prohibit the existing IDE design, ADD, Save,
and inspection views. Unfinished LUMPs may be added as non-executable design
placements independently of build-format acceptance.

**Why:** The user explicitly rejected replacing the working Namespace editor
with a fixed new-layout display when it prevented adding unfinished ide.Mint.
Safety gates belong at image preparation, installation and execution, not at
ordinary design editing.

**How to apply:** Reuse the existing design workspace across build options.
Keep historical layout snapshots secondary and clearly separate from editable
state; never present their fixed membership or full-source sizes as a live build.
