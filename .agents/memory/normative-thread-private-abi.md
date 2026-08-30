---
name: Normative Thread private ABI
description: Durable ownership and supported-size rules for Church Machine Thread geometry.
---

The shared Thread design is the normative source for every producer and consumer. The only supported Thread body is the defined 256-word layout; larger bodies are rejected and have no architectural tail region.

**Why:** The CM definition provides no size, format, ownership, or access policy after +255. Treating those words as an extension—or as more heap, stack, freespace, or capability homes—invents architecture.

**How to apply:** Derive geometry from the shared contract or assert conformance. Accept only the supported 256-word Thread size, and never infer or label a region after +255.