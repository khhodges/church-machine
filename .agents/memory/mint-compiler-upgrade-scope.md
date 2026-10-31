---
name: Mint compiler upgrade scope
description: Focused baseline rather than broad legacy-suite repair before ABI work
---
Use focused current-ISA/Mint compiler checks for the ABI upgrade. Keep unrelated
Lambda, EventRouter, and historical-fixture failures visible, but do not require
their cleanup before proceeding.

**Why:** The user approved this narrower scope after reviewing which failing
items matter. A passing baseline is not acceptance of the new ABI.

**How to apply:** Preserve mandatory PassKey semantics and distinguish compiler
checks from service and physical acceptance. The existing BIT stays fixed;
RTL runs, builds, board changes, and historical LUMP replacement require
separate approval. Continue step-by-step review of unresolved ABI choices.

The user approved the conventions in
`docs/phase-1/compact-mint-abi-proposal.md` on 2026-10-31: once-per-abstraction
PassKey declaration, metadata codes 0–5, software status codes 0–5, and NULL CR1
on normal error or successful no-capability-result returns.

**Why:** This was explicit approval of conventions, not the future serialized
layout, compiler implementation, conversion behavior, or hardware work.

**How to apply:** Do not reopen settled convention choices. Obtain review of
the exact layout and signatures next; distinguish approved design from current
executable behavior.
