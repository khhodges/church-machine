---
name: Amoeba-only resident Lazy test
description: The required Boot2 test starts with only Amoeba executable code resident.
---
The user requires “everything except Amoeba is lazy load.” Treat Amoeba as the
only initially resident executable LUMP in this test, with Namespace/Thread
structures and required device descriptors still present.

**Why:** Making CapabilityTest, SelfTest and WukongCallHome resident got past
startup faults but avoided the Lazy behavior the user actually wants to test.
That private resident-dependency trial is not acceptance of this test.

**How to apply:** Keep these dependencies and USER applications initially
absent. Amoeba's SYSTEM path must service loading without calling an absent
dependency itself. Distinguish the minimal AmoebaStartup wrapper from a working
resident load service. Do not bypass seals, SYSTEM-origin absence faults, or
pretend an external/preload fixture proves Amoeba delivery. Local tests do not
authorize hardware operations or changes to the saved live design.
