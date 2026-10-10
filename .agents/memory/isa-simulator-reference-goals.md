---
name: ISA and simulator reference goals
description: User-defined foundations for the FPGA conformance effort.
---

The user established three goals:
1. A fully defined ISA.
2. A simulator matching that ISA, with any exceptions listed.
3. A simulator memory map in binary detail as expected for the FPGA.

**Why:** Divergent Thread setup and CALL behavior across software simulation
and hardware-model replay showed that successful boot did not establish a
shared architectural contract.

**How to apply:** Use these as the reference-building scope before claiming
FPGA conformance. Resolve ISA ambiguities explicitly, identify the simulator
implementation, and distinguish proposed exceptions from approved ones.
The binary reference must permit exact comparisons, not only named regions
or GT-only traces. This goal agreement is not authorization to program,
reset, or command the physical board.

Register state at Thread activation is established by CHANGE, not left to
chance or supplied by an independent ad hoc register-initialization scheme.

**Why:** The user explicitly clarified: "The register states are always set by
the CHANGE instruction not left to chance."

**How to apply:** Define the complete post-CHANGE architectural register state
from the incoming Thread context and ISA rules. Reference dumps verify that
result; they are not permission to patch registers after CHANGE or rely on
power-up values, stale context, or leftover scratch authority. Document each
register's required restoration, derivation, clearing, or preservation rule
explicitly rather than inventing unspecified initial values.

Boot M authority is limited to the initial LOAD of CR15 using hardwired
bootstrap values and the IDE-preconfigured Namespace slot 0, which must pass
the required mLoad validation. It is not a blanket boot-window exemption.
Other ordinary capability LOADs must pass the full applicable mLoad integrity
checks. CR5 Heap construction and CALL's CR6/CR14 construction follow their
specific ISA rules, not generic exemptions for those register numbers.

**Why:** The user explicitly narrowed M-boot to Namespace establishment and
required full mLoad integrity for subsequent LOADs.

**How to apply:** Distinguish bootstrap authority, CHANGE's separately specified
microcode access, and validated derivation of Heap/C-list/Code capabilities.
Do not exempt ordinary LOADs targeting CR5/CR6/CR14 or treat special construction
as permission to skip validation of the originating Thread or abstraction.
Audit the current RTL against this rule rather than claiming it already obeys.
