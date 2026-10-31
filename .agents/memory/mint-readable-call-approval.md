---
name: Readable Mint call approval
description: Design-only approval boundary for word-count CREATE calls.
---

The user approved the syntax and explicit encoding design in
`docs/phase-1/mint-create-readable-call-proposal.md` on 2026-10-31,
explicitly selecting “Approve design only.” On 2026-10-31 the user subsequently
selected “Authorize implementation” for the bounded compiler adapter and tests.

**Why:** Functional contracts were deliberately delivered before simpler
calling syntax. Design approval must not become implicit authorization to
change the compiler, approved ABI, saved v4, live bindings or hardware.

**How to apply:** Use the approved proposal as the implementation baseline and
keep descriptive contract prose non-executable. Compiler implementation is now
authorized; publication, saved-artifact upgrades, live bindings, RTL and hardware
changes are not authorized by that approval. Dynamic arguments and additional
rights still require a separate design decision.
