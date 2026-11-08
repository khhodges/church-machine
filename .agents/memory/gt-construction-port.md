---
name: Mint-private GT-construction port
description: Approved Phase 2 direction and the boundary between minting authority and diagnostic access
---

The user agreed to proceed with a dedicated hardware port accepting DATA writes
and capability LOADs, privately held by Mint, to simplify GT result materialization.

**Why:** A small hardware result register could replace the private result
C-list/writable-alias mechanism; DATA-to-capability access is itself manufacturing
authority, not ordinary diagnostic access.

**How to apply:** Preserve ordinary memory's DATA/capability separation and
SecurityRegulator's separate WDT custody. Do not treat this as approval of
general mixed-domain tokens, a port address, pending-result lifetime semantics
or physical operations. Resolve these interface details one at a time.
The recommendation to consume on successful LOAD and invalidate on context
handoff/fault/reset remains a proposal until accepted.
