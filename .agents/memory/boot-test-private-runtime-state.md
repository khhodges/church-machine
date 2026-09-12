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
