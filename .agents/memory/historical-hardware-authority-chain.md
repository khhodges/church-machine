---
name: Historical hardware authority chain
description: Rules for deciding when a saved build context may be trusted as belonging to an FPGA artifact.
---

A historical hardware context is authoritative only when the server issued the build identity, froze the context at approval, verified the exact source revision on the builder, and matched the produced artifact digest during upload. Version-only matching is descriptive, never authoritative.

**Why:** Hardware versions can repeat, external uploads may not come from a recorded build, mutable builder worktrees can diverge from their Git HEAD, and a successful tool exit can leave a stale artifact path. Any one of those gaps can attach the wrong Namespace or other test context to a bitstream.

**How to apply:** Preserve failed-build context for diagnostics, but expose it as unusable for hardware recall. Treat missing, replayed, or multiply-matched provenance as explicitly unavailable or ambiguous; never fall back to live project state.