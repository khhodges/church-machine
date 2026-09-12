---
name: Save dialog snapshot
description: The two-step LUMP save contract for preserving the exact editor/compiler artifact.
---

When a multi-step LUMP save opens its format or Namespace dialog, freeze the compiler-owned source, compiled words, capabilities, identity metadata, language, and pending binary together. Preserve a divergent editor buffer separately; never pair it with old compiled words. Confirmation and retry must consume the immutable snapshot rather than live focus or registry selection.

**Why:** Editor navigation, focus changes, refreshes, or a later compile can change live state while the dialog remains open; rebuilding from that state can save a different artifact or silently lose source.

**How to apply:** Capture before asynchronous catalog/UI work begins and retain it through failed-save retries. Output profile controls embedded source, not source retention: API-only saves must still retain the compiler source and original artifact outside the executable binary.

Retention and activation are separate decisions. Invalid candidates must remain recoverable without becoming executable, and history must not be automatically pruned.

**Why:** The SAVE LUMP requirement is to retain every submitted source/artifact, including problematic compilations. Rejecting execution is not permission to discard evidence or to delete older versions.

**How to apply:** Preserve original bytes before finalization or validation; keep destination-finalized bytes distinct. Treat uncertain network outcomes as unknown until durable commit evidence or a complete rollback proves the result.