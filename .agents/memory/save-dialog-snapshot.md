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

For identity-rebinding saves, the approval/commit request must submit the exact
server-finalized binary returned by the save plan, not the pre-plan browser
buffer.

**Why:** The server may canonicalize compiler-owned SELF or destination-local
capabilities during planning; resubmitting the stale buffer correctly fails
closed as a plan mismatch.

**How to apply:** Freeze the finalized plan artifact alongside its plan ID and
approval intent, and use that immutable binary for the commit and any safe
retry.

Normal Save is an explicit `save_as_latest` intent: freeze the editor's base
revision alongside its compiled snapshot and submit both to the server.  An
older base is allowed to publish that exact candidate as the newest immutable
revision of the selected abstraction; it must not trigger a reload/preserve
dialog.  New Entry remains an explicit Namespace choice.

**Why:** Reload and cancellation used to share a return value, falsely blaming
the user for cancelling.  The corrected rule distinguishes an intentionally
stale editor base from a changed compiler/editor pair, while retaining
authoritative catalog-generation checks for an already approved plan.

**How to apply:** Keep explicit outcomes through every caller, retire the old
save candidate on successful reload.  Bind `save_as_latest` into the
server-issued save plan, one-time approval intent, and atomic commit; never
remove `editor_base`, bypass binary/capability/Namespace/permission checks, or
silently reload mutable editor text.