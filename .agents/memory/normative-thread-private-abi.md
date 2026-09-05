---
name: Normative Thread private ABI
description: Durable ownership and size-derived rules for Church Machine Thread geometry.
---

The shared Thread design is the normative source for every producer and consumer. A Thread has no Freespace: word +17 stores protected context, +18 stores executable identity, Heap fills from +19 to the stack, stack size comes from cw/sw, and 12 capability homes occupy the LUMP tail.

**Why:** The user rejected the fixed-256 assumption, and CapabilityTest proves CR0 is mutable state rather than a reliable resume-code alias. The n-6 field owns total LUMP size; cc still records the 12 persisted CR0–CR11 homes.

**How to apply:** Derive capsStart=lumpSize-12, stackStart=capsStart-sw, and Heap=+19..stackStart-1. Keep protected context at +17 outside CR5. Seed, validate, save, and restore the executable GT independently at +18.