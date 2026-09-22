---
name: Editor source authority
description: Rules for preserving user-owned editor bytes while offering newer authoritative source explicitly.
---

The persisted editor document is the user-owned source buffer. Restore its bytes and typed owner exactly. Server, built-in, and immutable-artifact source is advisory until the user explicitly accepts an exact before/after replacement. Never let startup, navigation, background reconciliation, syntax repair, or a stale asynchronous result silently replace the current buffer. Preserve replaced drafts under their owner, and keep editable source authority separate from immutable LUMP binary authority.

**Why:** Freshness or artifact authority does not imply overwrite intent. Startup and asynchronous work can race with typing, navigation, and unsaved-draft recovery; preferring another source can destroy the only copy of user text. Exact restoration, explicit acceptance, and owner-scoped recovery preserve user agency while still exposing authoritative content.

Successful builds and saves should prioritize source beside exact binary disassembly, with build diagnostics available separately. Candidate bytes must never be labeled as the saved artifact.

**Why:** The user wants to inspect generated instructions, not have successful audit messages replace that view. Source preservation and binary inspection are independent requirements.