---
name: Owner-controlled Outform suspension
description: Intended Amoeba Self.Save lifecycle for portable Thread and Namespace state.
---
Use one simple, standardized set of networked capability mechanisms for
Abstractions, Threads and Namespaces. Establish common semantics in dependency
order rather than inventing separate networking mechanisms for each case.

**Why:** The user explicitly set uniform network transparency as the architectural
rule. Coverage is a goal to verify, not a claim that current code achieves it.
The user confirmed the ordering: networked identity/authority, local Namespace
representation, common Outform/Inform transitions, then object-specific behavior.

**How to apply:** Keep object-specific state/layout handling distinct from the
common capability identity, authority and Outform/Inform lifecycle. Resolve
apparent exceptions against the common contract before adding special cases.

Keep the unfinished Phase 1 release/UART handoff ahead of networking
implementation. Maintain an explicit current next action and acceptance boundary
when discussing new architecture.

**Why:** The user explicitly required that architectural agreement not displace
present priorities or obscure what must be finished next.

**How to apply:** Consult `docs/network-capability-lifecycle-contract.md` for the
contract and priority record; refresh evidence rather than treating a merge as
physical acceptance. Record current work status there, not in memory.

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
