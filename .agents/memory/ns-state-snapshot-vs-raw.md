---
name: ns-state.json snapshot can be stale vs boot-image.bin
description: ns-state.json abstraction fields (location/limit) may lag the committed binary; use the ns-state endpoint's `committed` raw block for authoritative words
---
The rule: never derive "committed" NS entry hex or design-vs-committed fault checks from ns-state.json's decoded fields — they can be stale relative to boot-image.bin (observed: snapshot Boot.NS loc 0x3C00 while the binary held 0x7F00/32K geometry).

**Why:** a completion review rejected a drill-down that fabricated word hex from snapshot fields and used Boot.NS `limit` as a table-shape heuristic; both produced wrong values / false faults.

**How to apply:** `/api/boot-image/ns-state` now attaches a `committed` block (parse_ns_table_raw in server/boot_image.py: totalWords, maxEntries, header n/cw/cc, raw w0–w3 per occupied slot). UI decoding must follow parseNSWord1 (b@31,g@29,gtType@[27:26],clistCount@[25:17],limit17) and the v2.0 GT layout (perm@[30:28],dom@27,type@[26:25],seq@[24:16],slot@[15:0]).
