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

## Explicit SYSTEM loading, automatic USER loading

The user clarified: “Any LUMP called by SYSTEM must be loaded by Amoeba, but
USERs can use the hidden automatic solution.”

**Why:** SYSTEM must not depend on the USER-to-SYSTEM Lazy CALL handoff to
service its own missing dependency. This is a runtime-wide rule, not just a
startup dependency list or a requirement to preload every C-list entry.

**How to apply:** SYSTEM explicitly ensures a target is resident through Amoeba
before calling it; an already resident target needs no repeated transfer.
USER code uses normal CALL and the automatic suspend/service/retry path.
Both paths retain runtime authority and integrity checks. This settles the
behavioral split, not method numbering, register ABI, implementation completion,
or authorization for hardware operations.

## Native-loader review scope

The user authorized writing CLOOMC Amoeba, compiling and saving a separate
review LUMP, and including missing **local runtime delivery support**.
This does not authorize replacing the saved boot design, vendor builds,
device transfer or flashing.

**Why:** A CLOOMC-only wrapper could not load through the general-image
runtime; the user explicitly chose to include local runtime support rather
than save another incomplete wrapper.

**How to apply:** Keep native instruction execution responsible for copying
and publishing received bodies. Distinguish bounded one-USER/fixed-allocation
evidence from general scheduling, retirement/GC and exact Boot2 acceptance.
Saving the portable review artifact is not provisioning its private grants
or proof that installed hardware implements its interface.
