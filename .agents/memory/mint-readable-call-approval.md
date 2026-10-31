---
name: Readable Mint call approval
description: Design-only approval boundary for word-count CREATE calls.
---

The user approved the syntax and explicit encoding design in
`docs/phase-1/mint-create-readable-call-proposal.md` on 2026-10-31,
explicitly selecting “Approve design only.”

**Why:** Functional contracts were deliberately delivered before simpler
calling syntax. Design approval must not become implicit authorization to
change the compiler, approved ABI, saved v4, live bindings or hardware.

**How to apply:** Use the approved proposal as the design baseline, obtain
separate implementation authorization, and keep descriptive contract prose
non-executable. Do not reopen settled syntax merely because implementation
has not yet been authorized.
