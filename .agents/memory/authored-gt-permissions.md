---
name: Authored GT permissions are immutable
description: Distinguishes exact author-owned GT permissions from broader registry grant envelopes.
---

An existing Golden Token’s permission field is author-owned and must remain exactly unchanged when another program consumes it. A consumer may not broaden or attenuate those permissions. Permissionless Thread GTs are intentionally exact-empty and remain valid for SWITCH/CHANGE.

**Why:** Registry `grants` can describe a broader maximum envelope than a specific authored token. For example, an `RW` device grant can legitimately contain an authored `W`-only GT, so treating grants as the exact token rights rejects valid programs and loses the author’s decision.

**How to apply:** Carry or recover the exact authored rights independently of maximum grants. Enforce equality in the picker, compiler/admission path, runtime token validation, and server save boundary. Only a genuinely new symbolic GT author chooses its initial permissions.