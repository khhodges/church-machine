---
name: Hardware abstraction boundary
description: Approved Artix7/Wukong resource abstraction direction and unused options.
---

The user approved a reusable Artix7 hardware interface with a concrete Wukong
instance bound to its board and machine profile, and requested unused options
including Ethernet.

**Why:** Hardware describes available resources; programmers choose Namespace
membership, Namespace abstractions construct tables, and SecurityRegulator
validates and activates them. Unused features must remain discoverable without
being misrepresented as active resources.

**How to apply:** Separate board support, bitstream implementation, physical
verification and authorized Namespace access. Describe unverified expansion
categories explicitly as unknown, not supported. Resource descriptions grant
no capability and authorize no hardware change.
