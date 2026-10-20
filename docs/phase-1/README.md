# Phase 1 — hardware specification

## Read these first

1. **[Master ISA](01-isa/instruction-set.md)** — hardware rules and encodings.
2. **[Hardware acceptance](04-release/isa-to-fpga-alignment-plan.md)** — how to prove them.
3. **[RTL source snapshot](02-rtl/README.md)** — reference copy of the current implementation and focused tests; not a qualified bitstream.

## Software review scope

**ISA refinement work:** [Phase 1.1 review](phase-1.1/README.md) keeps new
findings and decisions separate from the authoritative Master ISA. Phase 2
is a compatibility consideration, not an added Phase 1 acceptance dependency.

- **[Amobea V1 — Thread abstraction](Amobea-V1.md)** — Phase 1 tuple storage
  and IDE support; continuation capture without `CHANGE`, with rollback and
  CR0 bootstrap binding still TBD.
- **[Call-record demonstration](thread-heap-call-record.md)** — local reference
  copy of the initial tuple format and IDE demonstration.
- **[Amobea Transaction objectives](Amobea-V1.md#64-transaction-abstraction--phase-1-demonstration-objective)** —
  five human tasks sharing Thread tuples, with capability-authorized Dijkstra
  messaging for isolation; proposed demonstration contract, not passed tests.
- **[W7-oriented CM explainer](CM-W7-explainer.md)** — revised review of
  continuation and capability concerns, with explicit evidence limits.

These review documents define software scope, not completed implementation,
hardware qualification, or authorization to change bootstrap.

## W7++ test objective

- **[W7++ scope and evidence requirements](W7-plus-plus-test-objectives.md)**
  — Phase 1 objective, with current-contract reconciliation and scope gates.
- **[CTMM W7 completeness workbook](CTMM_W7_Threat_Test_Plan.xlsx)** — original
  Threat Map, Summary and Method sheets preserved; added Completeness, Progress
  and Tracking guide sheets cover IDE gaps, missing functions, seal storage,
  simulator/ISA compatibility, named abstractions and release qualification.
  Statuses are evidence-scoped; no new runtime or hardware pass is claimed.
- **[Wukong one-second throughput tests](W7-plus-plus-test-objectives.md#wukong-one-second-instruction-throughput-tests)** —
  six planned workload/trace examples; estimates, measurement procedure and
  exact-build evidence requirements, not measured performance.

## Authority

| Question | Answer comes from |
|---|---|
| Which objects occupy which slots? | **Namespace Table** — not a manifest |
| What must the hardware do? | **Master ISA** |
| Does this implementation conform? | **Tests and exact-bitstream evidence** |

Implementation behavior does not override the ISA. Software delivery does not
block the Phase 1 bitstream; hardware verification is still required.

## Current work

**Authorized:** hardware RTL implementation and simulation.
**Not authorized:** vendor builds, uploads, flashing, saved-artifact migration
or application changes.

Implementation is incomplete. A documented decision is not a passed test.
Older authorization statements describe their original decision only.

For testing, start with the acceptance plan's H01–H20 cases. Its explicit
blockers and the ISA's “Oracle closure” list must be closed before a complete
FPGA pass can be claimed. Software acceptance is listed separately as S01–S07.

This folder is self-contained. Keep local files and links current; do not add
a manifest, symlinks or historical documents.
Run `python3 scripts/check_phase_1_documents.py` to check local links.
