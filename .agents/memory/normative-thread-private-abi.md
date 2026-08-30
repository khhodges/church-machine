---
name: Normative Thread private ABI
description: Durable ownership and size-derived rules for Church Machine Thread geometry.
---

The shared Thread design is the normative source for every producer and consumer. A Thread has no Freespace: Heap fills from +18 to the stack, stack size comes from cw/sw, and 12 capability homes occupy the LUMP tail.

**Why:** The user rejected the fixed-256 assumption. The n-6 field owns total LUMP size and therefore changes Heap capacity; cc records the 12 persisted capability homes rather than heap size.

**How to apply:** Derive capsStart=lumpSize-12, stackStart=capsStart-sw, and Heap=+18..stackStart-1. Keep protected STO at +17 and never expose it through CR5.