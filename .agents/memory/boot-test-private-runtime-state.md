---
name: Boot test private runtime state
description: Isolated boot tests must redirect every persistence input coupled to LUMP generation, not only the LUMP directory.
---

When boot tests use a temporary LUMP library, redirect the saved boot configuration and any other persistence paths read during image regeneration to the same private test session.

**Why:** Boot-image generation consumes both the LUMP catalog and saved boot configuration. Isolating only one lets a test avoid LUMP drift while still overwrite or restore a user's active IDE configuration.

**How to apply:** Before exercising a boot save, upload, or regeneration path, copy the needed runtime state into the test area and patch both server settings and already-imported test path constants. Restore those settings after the session.

Subprocess isolation must also disable external startup services, not just redirect files.

**Why:** A disposable Flask server otherwise inherits the normal scheduler and hardware listener, so a browser test with private LUMPs can still contact external integrations or contend with the live board bridge.

**How to apply:** Use explicit isolated-process mode and private configuration, approval, database, and snapshot storage. Reject production paths and existing-server reuse before allowing browser writes.

IDE hierarchy is part of private test state, including read-only authoring
checks. Never grant isolated processes a fallback to the operator's ownership
configuration when a test override is missing.

**Why:** Namespace acceptance originally isolated artifacts and database but
left node changes able to rewrite project ownership and local aliases.

**How to apply:** Copy hierarchy configuration for test sessions, require an
explicit private destination, and hash-guard the real file through failures.
Missing ownership can be represented by JSON null in the private fixture;
missing private storage is an isolation error, not permission to read live state.
When tightening an isolation requirement, check shell launchers as well as
Python fixtures: otherwise unrelated compile journeys can fail merely because
their launcher still supplies the older set of private inputs.

Bootstrap regression fixtures must not assume that the current user Namespace
still contains historical draft names at fixed slots. Prefer explicitly
constructed fixture assignments; when filtering copied drafts, preserve unrelated
occupants and guard fixture-writing helpers against the live library path.

**Why:** Changes to ordinary saved drafts prevented unrelated bootstrap tests
from collecting. Restoring those drafts in live state would conceal a fixture
dependency rather than fix the tested behavior.

**How to apply:** Keep save-only publication tests separate from explicit
Namespace-adoption tests. Do not restore retired save-and-install behavior merely
to satisfy legacy test expectations.

Historical fixtures must distinguish architecture-generated Threads from
artifact-selected Inform residents explicitly.

**Why:** A legacy generated Thread labeled Inform+Resident triggers the exact
artifact-locator gate, even though its bytes are supposed to be constructed from
geometry. Inventing a filename or relaxing the gate hides that classification
error.

**How to apply:** Declare generated Thread types and geometry in isolated
fixtures and assert the resulting body header. Keep real selected artifacts
bound to their exact saved files and hashes.

Bootstrap-only fixtures must select exact existing bootstrap-approved bytes
independently of the live IDE revision. Never manufacture bootstrap approval
fields for the currently selected compiler artifact.

**Why:** A legitimate compiler publication may carry intrinsic SELF rather than
a frozen bootstrap SELF GT. Copying live bytes and overwriting their token or
approval creates an internally inconsistent fixture, not a bootstrap test.

**How to apply:** Resolve the fixture's destination GT to a unique approved
bootstrap artifact in its private library, verify its exact digest and approval,
and leave live selections and immutable history untouched.

Rollback fixtures should retain real review confirmation and Namespace
allocation checks, even when candidate resolution or image generation is
stubbed. Supply self-contained catalog bytes, placement, and geometry.

**Why:** Missing staging inputs or allocation geometry can reject a request
before the injected failure, making a generic rejection assertion misleading.
Removing the review hook also conceals a separate required authorization step.

**How to apply:** Assert the initial unconfirmed request changes no shared
state, replay its actual confirmation, and require the intended failure message
and byte-for-byte restoration. For lock-sensitive rollback, observe restoration
while the transaction lock is held, not only the generator's lock state.

Copied live Namespace fixtures may already have normalized descriptors.

**Why:** A legitimate saved-image preparation removed the layout differences
that an idempotent-save test had assumed were always present.

**How to apply:** Construct historical geometry explicitly when testing
normalization; ordinary unchanged-save tests should assert identity, exact
bytes, and raw-table binding without requiring an initial relocation.

A suite runner's private copy is not a deterministic fixture specification.
Per-test geometry must also override or clear inherited test-config routing,
and exercise the parent-config path separately from the explicit override.

**Why:** A runner-level copied configuration can silently satisfy missing
per-test geometry and make results depend on the programmer's current design.
An image fixture also needs the existing profile's mandatory objects; reducing
it must not be compensated by weakening profile validation.

**How to apply:** Construct the complete small private Namespace and exact
synthetic approvals together. Use an incomplete parent as a sentinel when
testing the explicit override. Compare full selected bodies and placements;
compact-only success does not establish that noncompact placement is preserved.

Browser acceptance of saved Namespace controls must explicitly choose that
profile, rather than assuming the default Namespace view is the installed-state
editor.

**Why:** The ascending design editor has similar rows and policy controls but a
different persistence boundary. A test can click plausible controls while
exercising the wrong document and incorrectly infer a save failure.

**How to apply:** Select the intended profile through its visible selector and
assert both the active profile and the endpoint receiving the mutation. Use a
synthetic credential scoped to the isolated process for protected controls;
never expose the workspace credential or disable authorization for acceptance.

Web-server isolation must include indirect factory-reference imports, even
when a test never requests hardware operations.

**Why:** The trace-symbol startup import can read the factory Namespace through
a separate input route from the HTTP server's test routing. A private HTTP
library alone therefore did not make Namespace endpoint tests independent of
the programmer's library.

**How to apply:** Route both inputs to the synthetic approved library before
importing the server. Guard file reads as well as writes against live and
inherited runner paths; retain real approval and image validation.

Control-flow image fixtures must select their own exact executable bodies and
placements, not regenerate against the programmer's current Namespace. Keep
conflicting saved selections as separate rejection tests with no-write guards.

**Why:** Growing a synthetic Thread can make an otherwise unrelated saved
resident overlap it, stopping the regression before any control-flow evidence.
Factory placeholders also do not necessarily contain resumable continuations.

**How to apply:** Construct authenticated disposable inputs for each tested
geometry, boot before saving a live context, and prove retired CALL/CHANGE/RETURN
with protected-frame and caller-continuation assertions. Use a non-handler
callee so a native service dispatch cannot masquerade as a real CALL frame.
