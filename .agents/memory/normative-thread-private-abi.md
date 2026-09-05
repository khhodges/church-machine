---
name: Normative Thread private ABI
description: Durable ownership and size-derived rules for Church Machine Thread geometry.
---

Thread suspension identity belongs only to the canonical two-word CHURCH return frame on the private stack. Never add a separate executable-identity word to the Thread body; Heap begins immediately after protected context.

**Why:** The user rejected the invented executable-identity field. CR0 is mutable state and can intentionally name a different abstraction from the code being resumed.

**How to apply:** Use the shared Thread layout for geometry. Seed, suspend, and resume through the established CHURCH frame and RETURN-equivalent Enter-GT/NIA validation while preserving the existing private CR/DR homes.