---
name: CapabilityTest Namespace slot
description: The fixed Namespace/device contract for the resident CapabilityTest and UART rows
---

CapabilityTest is the resident executable at NS[10]; UART_DEV is the address-based device row at NS[2] with location 0x40000014 and inclusive limit 0x00002. Do not move either row to satisfy historical tests.

**Why:** The physical decoder and immutable executable bindings use different semantics; relocating CapabilityTest or UART creates a false boot/device plan.

**How to apply:** Validate persisted Namespace rows and generated images against this placement before changing boot planning or fixture assumptions.