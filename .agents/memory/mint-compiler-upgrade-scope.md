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
