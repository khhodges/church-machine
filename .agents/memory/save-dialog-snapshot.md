---
name: Save dialog snapshot
description: The two-step LUMP save contract for preserving the exact editor/compiler artifact.
---

When a multi-step LUMP save opens its format or Namespace dialog, freeze the editor source, compiled words, capabilities, identity metadata, language, and pending binary together. Confirmation and retry must consume that immutable snapshot rather than live focus or registry selection.

**Why:** Editor navigation, focus changes, refreshes, or a later compile can change live state while the dialog remains open; rebuilding from that state can save a different artifact or silently lose source.

**How to apply:** Capture before asynchronous catalog/UI work begins, retain it through failed-save retries, clear it only on cancellation or successful close, and require source-bearing snapshots to use binaries with an embedded source frame.