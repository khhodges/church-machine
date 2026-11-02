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

The user identified the board's memory-extension slot as an **SD slot**, not
an external RAM socket.

**Why:** This was clarified during the transaction-Thread memory review.

**How to apply:** Treat it as user-reported storage hardware when discussing
backing-store architecture. Do not count SD capacity as resident RAM or infer
that an SD controller or Thread backing-store service exists in the bitstream.
