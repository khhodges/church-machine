---
name: Inform MMIO simulation
description: Architectural rule for simulating canonical Inform-device capabilities whose addresses are outside normal simulator RAM.
---

Canonical Inform-device capabilities still pass normal namespace, type, permission, and bounds checks, but successful DREAD/DWRITE accesses route through the matching device model rather than the RAM array.

**Why:** Canonical LED, UART, button, timer, and M-bit locations occupy the architectural MMIO range outside simulator RAM. Treating a valid access as a RAM write causes a false out-of-bounds runtime exception.

**How to apply:** Keep RAM bounds strict. Add or change device behavior at the MMIO routing boundary, preserving any architectural register-home synchronization and legacy aliases intentionally supported by the simulator.