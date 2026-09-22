---
name: Boot-entry UI authority
description: Default Code View follows the committed Namespace boot marker and opens its exact LUMP disassembly even when the prepared image is stale.
---

The committed Namespace `boot: true` marker is the authority for which LUMP carries the Lightning Bolt. A localStorage slot and a stale prepared image are evidence only and must not retarget Code View. Opening the default LUMP always enters saved-LUMP mode with its exact disassembly visible; generic restored editor text and boot-image preparation failures must not suppress inspection.

**Why:** The default opener was coupled to successful boot completion, so a stale-image 409 left Code View on generic Console Output. Large classic scripts also initialize out of order: early calls can hit temporal-dead-zone globals or run before the saved-LUMP opener exists. One-shot load handlers and short timing guesses failed.

**How to apply:** Read the boot marker from Namespace state, join its slot to `boot-config.lumpCatalog`, then resolve that token in the artifact list. Trigger from both readiness sides and contain early synchronous initialization errors. Replace generic snapshots and show immutable disassembly while preserving explicitly owned user work.

Explicit editor navigation permanently outranks the startup default for the current page session, including while the selected artifact is still loading.

**Why:** A delayed startup catalog response can otherwise replace a Namespace selection; a retry can repeat that override even after the first race is guarded.

**How to apply:** Claim explicit navigation before awaiting data and recheck ownership after startup awaits. Treat startup selection as a fallback, not a recurring editor authority.