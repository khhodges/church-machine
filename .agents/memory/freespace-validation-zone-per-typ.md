---
name: Freespace validation zone differs per lump typ
description: Any Mint-style freespace scan must use per-typ zone bounds, not the generic cw/cc formula
---

Rule: a freespace validator (Mint step 7, audit RFS, or any future scan) must compute the zone per lump type:
- typ=lump (00) / data (01) / Outform (11): words `cw+1 .. lumpSize-cc-1`; only typ=lump may carry a 0xAB content frame — all others require all-zero.
- Thread (typ=10, cw>0): collision zone only — `17+heapWords(cc) .. lumpSize-12-stackWords(cw)-1`; DRs, heap, stack, and caps zone hold live non-zero state.
- Namespace (typ=10, cw=0): body IS the NS Table — skip the scan entirely.

**Why:** a generic `cw+1..lumpSize-cc` scan rejected every valid Thread lump (live heap/stack read as "dirty freespace") — caught by code review, not tests, because no Thread fixture went through the load path.

**How to apply:** when adding any lump-body zero/format check, branch on typ first and mirror lump-audit.js RFS bounds; add a Thread-with-live-state fixture to the tests.
