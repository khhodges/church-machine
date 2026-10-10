---
name: ns-state.json snapshot can be stale vs boot-image.bin
description: ns-state.json abstraction fields (location/limit) may lag the committed binary; use the ns-state endpoint's `committed` raw block for authoritative words
---
The rule: never derive "committed" NS entry hex or design-vs-committed fault checks from ns-state.json's decoded fields — they can be stale relative to boot-image.bin (observed: snapshot Boot.NS loc 0x3C00 while the binary held 0x7F00/32K geometry).

**Why:** a completion review rejected a drill-down that fabricated word hex from snapshot fields and used Boot.NS `limit` as a table-shape heuristic; both produced wrong values / false faults.

**How to apply:** Prefer the endpoint's committed raw-word block for comparisons.
Consult the current shared bit contract and decoder rather than historical
field names such as `limit17`; old UI-era packing descriptions are not reliable
evidence for the present ABI. Keep word-indexed image locations distinct from
byte-addressed target profiles when displaying or interpreting those words.
