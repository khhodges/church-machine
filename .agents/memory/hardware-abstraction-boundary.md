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

The user approved a named abstraction for each SD card, using `ide.SD#`
notation, with Info, ReadBlocks, WriteBlocks and Sync as a **Phase 2 objective**.
See `docs/phase-2/sd-storage-abstraction.md` for the agreed responsibilities.

**Why:** The user approved the minimal storage interface and explicitly placed
it in Phase 2, separate from Thread/object lifecycle policy above the driver.

**How to apply:** Keep this out of Phase 1 completion gates. Detailed ABI,
card-to-name binding and suffix interpretation still require review; approval
of the objective does not establish an implemented or qualified storage service.
