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

Prefer in-page Namespace choice menus over native select popups in the embedded
IDE, including Namespace Designer, not just the A/B planner.

**Why:** The user repeatedly reported that the menu itself would not open even
after option-refresh and missing-catalog fixes. Passing DOM tests do not establish
native popup behavior in their embedded browser.

**How to apply:** Preserve draft guards, show rejected transitions inline, and
keep open menus and focused choices stable across background renders. Do not
claim the underlying browser cause is established.

The user wants A/B alternatives as left-side tabs with individual LUMPs in one
Memory Glass and bidirectional selection between membership rows and glass.

**Why:** The design workspace must make Namespace-to-LUMP relationships visible.

**How to apply:** The user explicitly rejected both equal-height schematic bands
and overlapping A/B comparison lanes. Both Namespaces must coexist in one
physical memory map with strictly disjoint allocations and proportional sizes.
They run concurrently, executing sequentially on one FPGA without replacing
memory when switching. Propose relocated ranges without modifying saved inputs;
unknown sizes block placement, and proposed addresses are not a generated or
rebound executable image. Matching artifact references do not grant cross-root
authority or imply permission to share mutable copies.

The Boot Namespace must hold MMIO and NS-GTs and run the abstractions as FPGA
services. Other Namespaces provide their starter Thread at Slot 2. Amoeba is
shared by all Threads and organizes round-robin execution; Threads use CR5 for
private data. The user explicitly confirmed that other Namespaces may contain
additional Threads beyond their Slot 2 starter.

**Why:** The user specified the Boot/service and application-Namespace roles;
duplicating complete standalone boot environments for A and B is not that model.

**How to apply:** Treat these as next-bitstream architecture requirements, not
evidence of an implemented scheduler, authorized hardware change, or permission
to overwrite historical saved Namespace layouts.
