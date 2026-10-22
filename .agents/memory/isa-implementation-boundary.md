---
name: ISA versus implementation boundary
description: Keep implementation mechanisms out of normative ISA wording.
---

The ISA alone defines required behavior for hardware, FPGA and simulator.
Implement the simulator in whichever straightforward way faithfully reproduces
the ISA, hiding internal byte/word representation conversions.

**Why:** On 2026-10-22 the user explicitly reaffirmed this after RTL was
incorrectly presented as a prerequisite to completing Mint software.

**How to apply:** Validate Mint CLOOMC against the approved ISA model. Correct
simulator mismatches rather than impose implementation-specific conversions on
Mint or require RTL/FPGA work for software completion. Preserve ISA-defined
address units and observable behavior; only internal representations are free.
RTL is an implementation to check against the ISA, not an alternate authority.

The user requires: "the existing ISA must not change in any way" for IDE
auditing and simplification.

**Why:** Fixture cleanup and IDE simplification must not become an architectural
redesign or change instruction behavior to accommodate obsolete examples.

**How to apply:** Preserve encodings, semantics, permissions, faults and
architectural state contracts. Report implementation contradictions separately;
do not resolve them by changing the ISA. Audit approval does not authorize
implementation changes.

The user explicitly states that cached bases and other implementation-specific
details are not part of the ISA.

**Why:** The ISA defines architectural behavior and authority, not how a
particular machine realizes them.

**How to apply:** Specify observable state, encodings, capability checks,
effects and faults without requiring caches, latches, wiring or state machines.
The user further requires removing all added "new good ideas" and implementation
details from the red-text ISA review itself, not merely retaining them under
non-ISA labels. Do not add scheduler designs, diagnostic capture systems or
unrequested mechanisms to fill unresolved architectural choices. Mark the
choice unresolved instead. This scope rule does not authorize
changing the master ISA, implementations or physical hardware.

The user proposes including the three LUMP header forms as Church instructions
in the ISA, together with the Namespace Table's top/bottom address rules.
Treat this as architectural review scope, not authorization to change execution.

**Why:** Church's interpretation of object headers and permitted address ranges
defines architectural behavior, even though headers are not Turing-executed code.

**How to apply:** Distinguish Church-interpreted header semantics from Turing
instruction execution. Explain slot-index bounds separately from table address
bounds; do not infer a fixed table capacity or approve new encodings implicitly.

The user requires the new build to follow the approved ISA in depth and detail
without exceptions, with simulator conformance and its binary-memory definition
first; other implementations follow later.

**Why:** The ISA and defined binary representation must govern the simulator,
not implementation shortcuts or historical behavior.

**How to apply:** Distinguish approval of architectural direction from a
complete executable contract. Resolve exact encoding/layout gaps before
claiming exception-free conformance; simulator evidence is not FPGA evidence.

The user approved preparing a consolidated architecture/binary proposal with
an explicit decision table and acceptance tests before implementation changes.
Complete the existing initializer investigation separately against its approved
inputs, not against a candidate architecture.

**Why:** Mixing the redesign with the initializer fix would destroy the causal
comparison needed to explain the retained synthesis failure.

**How to apply:** Proposal preparation is authorized, not implicit approval of
its remaining encodings. Keep the architectural candidate and retained-input
hardware experiment separate; physical operations need separate authorization.
