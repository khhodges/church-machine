---
name: Normative Thread private ABI
description: Durable ownership and larger-allocation rules for Church Machine Thread geometry.
---

The shared Thread design is the normative source for every producer and consumer. Larger allocations extend the body without moving any core private-ABI zone.

**Why:** Tail-derived geometry silently relocates stack and capability homes in larger Thread allocations, breaking context-switch compatibility even when a viewer appears correct.

**How to apply:** Derive geometry from the shared contract or assert conformance. Never infer Thread-private locations from the allocation tail.