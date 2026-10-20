---
name: SelfTest caller-return flow
description: User-confirmed CapabilityTest loop uses CALL/RETURN, not a SelfTest Next capability.
---

SelfTest must not have a Next capability. The user explicitly confirmed that
CapabilityTest calls SelfTest and WukongCallHome, each returning to CapabilityTest,
and loops. CapabilityTest performs CHANGE to Thread.2 on each iteration:
Boot.Thread to Thread.2 initially, then Thread.2 to itself.

## Phase 1 loop test scope

CHANGE must be tested in Phase 1; SWITCH execution testing is deferred to
Phase 2. Keep SWITCH out of the CapabilityTest/SelfTest/WukongCallHome loop.
Its ISA definition is not removed by this test-scope decision.

**Why:** The user explicitly clarified that SWITCH cannot be tested until
Phase 2, whereas CHANGE must be tested now.

**How to apply:** Verify the initial Boot.Thread → Thread.2 handoff and repeated
Thread.2 self-handoffs, with CR15 unchanged and CR13 untouched. Do not make
SWITCH execution acceptance a prerequisite for this Phase 1 milestone.

Both Thread.2 and Thread.3 must use CapabilityTest as their prepared entry.

**Why:** The user explicitly confirmed this applies to both secondary Threads,
not only the Thread.2 path exercised by the current loop.

**How to apply:** Preserve this release requirement in preparation and validation.
Generic support for independent Thread targets does not authorize selecting
SelfTest for Thread.3. Do not silently rewrite already saved immutable images.

**Why:** The old Next/LightningBolt continuation rule describes an obsolete flow.
It must not justify reintroducing Next into a replacement SelfTest or treating
the selected SELF-only C-list as defective.

**How to apply:** Cross-check exact selected artifacts rather than older example
sources, comments, or builders. Preserve the caller-return loop and immutable
saved artifacts. Passing an isolated candidate replay does not validate the
candidate's capability declarations against this intended application flow.

Build Approval may show LightningBolt in the same per-slot selector, but it is
a synthetic boot-role choice, separate from load policy. The
programmer's per-slot rule is stored separately and is authoritative, including
for architecture rows; step2 remains only the body-loading projection for
programmable LUMP rows.

**Why:** The approval table needs one discoverable control without turning the
boot role into a conflicting fifth load policy or letting IDE defaults override
the programmer's saved rule.

**How to apply:** Keep the active boot row visibly marked as
`LightningBolt (boot entry · <load policy>)`; changing its load policy must not
silently move the boot entry.