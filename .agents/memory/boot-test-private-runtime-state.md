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
