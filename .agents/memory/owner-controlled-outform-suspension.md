---
name: Owner-controlled Outform suspension
description: Intended Amoeba Self.Save lifecycle for portable Thread and Namespace state.
---
The user's intended model is program-controlled Amoeba Self.Save, which saves
the Thread including machine register state and transitions it to Outform.
Later its owners (potentially a networked abstraction) may reactivate it,
including on another FPGA. Namespaces should follow a similar lifecycle.

The user defines a Namespace as "a local representation of a C-List of Networked
GTs." Do not equate saving that list with recursively saving every referenced
object or copying a physical RAM region to another FPGA.

**Why:** Networked capability identity is distinct from its local resident
representation. The user's clarification corrects the framing of Namespace
save as a necessarily inclusive object-graph snapshot.

**Why:** The user clarified this is explicit save and owner reactivation, not
automatic cache eviction or restoration from the original initialization design.

**How to apply:** Review loading and activation against this lifecycle. Preserve
the distinction between authored initial state and saved execution state.
Do not treat this direction as evidence of current implementation or permission
to program hardware. Exact save continuation, networked-list serialization,
cross-machine capability handling, and activation multiplicity remain design
details to resolve, not policies already chosen by the user.
