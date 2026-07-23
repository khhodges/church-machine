---
name: A7 v1.2 stored nsCount anti-inflation pattern
description: Why/how loadBootImage nsCount scanner was inflated to MAX_NS_ENTRIES and the stored-word fix
---

# A7 v1.2 Stored nsCount Anti-Inflation Pattern

## The Rule
When the c-list occupies the tail of the NS TABLE region (A7 v1.2 layout), the forward
scanner in `loadBootImage()` sees those c-list words as non-null NS entries and returns
`MAX_NS_ENTRIES` (= 256) instead of the true entry count (e.g. 7).

Fix: write the clean nsCount at `NS_TABLE_BASE - 3` in both the Python generator and JS
`_initNamespaceTable()`. `loadBootImage()` reads this word instead of rescanning; the
forward scan is kept only as a belt-and-suspenders fallback.

**Why:** In A7 v1.2 the c-list (7 words for the default catalog) lives at
`NS_TABLE_BASE + NS_TABLE_RESERVE - 7 … NS_TABLE_BASE + NS_TABLE_RESERVE - 1`. That
overlaps with NS entries 253–255, making them appear non-null. Stored count avoids this.

**How to apply:**
- `server/boot_image.py`: scan `mem[ns_table_base .. ns_table_base + MAX_NS_ENTRIES*4]`
  **before** writing the c-list → that gives the clean count; add `empty_count`; write
  result to `mem[ns_table_base - 3]`.
- `simulator/simulator.js` `_initNamespaceTable()`: after the step3 block (which sets
  `this.nsCount = endIdx`), write `this.memory[this.NS_TABLE_BASE - 3] = this.nsCount >>> 0`.
- `simulator/simulator.js` `loadBootImage()`: read `src[tagIdx - 2]` (= NS_TABLE_BASE-3),
  use it if valid (`> 0 && <= maxEntries`); then still apply the `bootConfig` step3
  `baseNamed+empty` extension so step3_reservation configs reach their full nsCount.
- Pool-end tests: the pool ends at `ns_table_base - 3` (not -2), because A7 v1.2 has
  three pre-table control words: nsCount@-3, boot_entry_slot@-2, format_tag@-1.

## Pre-table control word layout (A7 v1.2)
```
NS_TABLE_BASE - 3 : stored nsCount (scan-before-clist + emptyCount)
NS_TABLE_BASE - 2 : boot_entry_slot
NS_TABLE_BASE - 1 : BOOT_IMAGE_FORMAT_TAG (0xB0072128)
NS_TABLE_BASE + 0 : NS slot 0 word0  (self-ref loc = NS_TABLE_BASE)
…
```
