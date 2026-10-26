---
name: Ascending-v1 candidate boundary
description: Keep new-format Namespace review and approval separate from Header V2 publication and activation.
---

Genesis explicitly confirmed the pictured Phase 1 256-slot design as the target
for implementation and verification on 2026-10-17. The reviewed slot map and
scope are in `docs/reviews/phase1-baseline/approved-target-namespace.md`.

**Why:** Historical saved-Namespace tests had been used to mark IDE-03 Complete,
but they did not exercise the intended Phase 1 design. This was a target mismatch,
not a reason to migrate the approved design back to the old layout.

**How to apply:** Tie acceptance to the pictured Phase 1 profile (metadata 0,
self 1, entry Thread 2, UART 8, selected CapabilityTest boot 10; all Resident).
Keep old-profile evidence historical, and keep internal seals subordinate to
approved UI intent. Design confirmation is not installation or hardware consent.

Ascending-v1 image review may create only a separate, exact-hash-bound
profile-approval record. That record is not a historical LUMP approval and
never authorizes installation, simulator activation, or hardware programming.
Every future installer must require its own explicit authorization and retain
the profile-specific byte validator; historical Header V2 publishers must
reject ascending-v1 images.

The user subsequently approved a separate guarded loader for the exact New
Layout trial. This does not authorize synthesis, flashing, publishing, or
creating installation evidence from a version label.

**Why:** The explicit approval expanded loader scope only; the existing board's
compatible installed binary was still unestablished.

**How to apply:** Keep runtime-memory replacement consent and installed-target
evidence separate from candidate/profile approval. Never fabricate an approval
record to turn an offline model result into hardware admission.

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

Restoring access to the old table is not sufficient: the main editable table
must itself show the new four-word metadata header at slot 0, self at slot 1,
entry Thread at slot 2 and the new member slots. ADD/Save must operate on that
same new-format design, not leave the new layout as a static text reference.

**Why:** The user explicitly corrected an attempted fix that merely unhid the
old editor while leaving the new header and slots in a separate display.

**How to apply:** Persist the new-format draft separately from installed image
authority until installation is explicitly approved. Keep older views available
without allowing them to overwrite or impersonate the selected new-format draft.

Preserve the original working table's renderer, columns, controls, popups and
interactions. A new simplified editable table is not an acceptable substitute,
even if it displays the correct new slots and supports ADD/Save.

**Why:** The user rejected the replacement as "nothing like the prior table
that worked." The request is a data/geometry adaptation, not a redesign.

**How to apply:** Change the original table's data adapter and format-dependent
header/slot interpretation. Verify feature parity against the original view,
including version, type, F/G, limit, sequence, integrity and Source controls.

Keep the Phase 1 design separate from the earlier 64-slot ascending draft and
from installed Namespace state.

**Why:** Adding the approved 256-slot-default layout must not migrate or erase
earlier design work, and view selection is not authorization to install an image.

**How to apply:** Reuse the original table controls with profile-specific draft
storage, capacity and table-only limits; preserve unsaved edits across view changes.
