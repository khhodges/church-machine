---
name: Next bitstream design scope
description: Approved separate planning view and three-view Switch loop.
---
The user approved a second Image Development view to design the next bitstream with two resident Namespaces and a common memory zone for individual LUMPs, preserving the existing view and working configuration.

**Why:** The next platform layout needs a separate design workspace, not modification of the demonstrated image.

**How to apply:** Use the Switch loop Namespace Designer → Image Development → Next Bitstream Design → Namespace Designer. Sizes and slot counts remain undecided. This approval covers the design workspace, not synthesis, flashing, board changes or automatic cross-Namespace access.

Unsaved planning state must survive replacement of the embedded frame during
Switch navigation, not only React visibility changes.

**Why:** A full browser selection test showed that returning through the IDE can
reload the frame and discard component-local drafts despite keeping both React
views mounted.

**How to apply:** Retain the draft in the owning IDE tab's memory without making it
a saved Namespace or hardware input. A full IDE page reload still clears it.

Dropdown acceptance must include choosing an item and checking the resulting
label, not merely observing that options exist or a popup opens.

**Why:** Repeated user reports contradicted popup-only audits. Automated desktop
success alone does not establish success in the user's nested preview or touch
environment; distinguish tested behavior from an inferred root cause.

**How to apply:** Check both A/B independently, focus-loss ordering, and the
user's viewport. Do not describe an untested browser-specific cause as proven.

The user wants A/B alternatives as left-side tabs with individual LUMPs in one
Memory Glass and bidirectional selection between membership rows and glass.

**Why:** The design workspace must make Namespace-to-LUMP relationships visible.

**How to apply:** Until a common placement is defined, label the combined view
schematic; independent saved Namespace addresses do not establish a shared
physical layout. Matching artifact references do not grant cross-root authority.
