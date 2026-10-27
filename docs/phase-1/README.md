# Phase 1 — hardware specification

## Read these first

1. **[Master ISA](01-isa/instruction-set.md)** — hardware rules and encodings.
2. **[Hardware acceptance](04-release/isa-to-fpga-alignment-plan.md)** — how to prove them.
3. **[RTL source snapshot](02-rtl/README.md)** — reference copy of the current implementation and focused tests; not a qualified bitstream.

## Software review scope

- **[Next Factory Build — approval specification](factory-build-verified-install-approval.md)** —
  current scope, approval gates and work sequence: start with IDE UART and
  finish Phase 1 with Ethernet and standalone FPGA singletons. Includes both
  the Mallory Thread demonstration and CapabilityTest/SelfTest/CallHome loop,
  verified installation, fault/reboot evidence and MTBF accounting.
  Phase 1 also requires completed Mint and operational new-Thread
  initialization through Mint/Amoeba from application-transaction templates
  for clean recovery; template and recovery contracts remain approval items.
  Journal, measurement and Ethernet mechanisms remain approval items;
  UART-only success is not standalone completion.
  - [Current work sequence](factory-build-verified-install-approval.md#work-sequence-through-phase-1-completion)
  - [Boot.Thread fault-entry FPGA proposal](boot-thread-fault-entry-proposal.md) —
    current saved-Thread-context decision and superseded separate-dump draft;
    revised register and service-recovery contract remains under review, not implemented RTL.
    Includes the proposed [minimal service-restoration sequence](boot-thread-fault-entry-proposal.md#proposed-minimal-service-restoration-sequence):
    prime Boot first, attempt the old Thread save, enter Boot without a second
    save, then restore clean service.
  - [Standalone acceptance gates](factory-build-verified-install-approval.md#mandatory-phase-1-ethernet-and-standalone-completion-gates)
  - [Starting baseline](nfb1-starting-baseline.md) and
    [Mallory fault reconciliation](nfb1-mallory-fault-reconciliation.md) —
    historical investigation evidence, not completed Factory Build acceptance.

- **[Two Namespace layouts and full-image reload](namespace-layouts-and-full-image-reload.md)** —
  one minimal baseline and one full development/test layout; complete stopped
  memory replacement, simulator-first evidence, no incremental loader required.

- **[Mint/Cleaner GT queues proposal](mint-cleaner-gt-queues-proposal.md)** —
  pre-provisioned size classes, an independent Cleaner Thread, and versioned
  memory reuse through Dijkstra GT queues; finalized Phase 1 design document,
  with implementation mechanisms and evidence still pending.
- **[Authority-handoff rule](cm-authority-handoff-rule.md)** — required surrender
  before or with observable effect; fail-closed loss, not implicit recovery.
- **[Mint/Cleaner review disposition](cleaner-queue-review-note.md)** — four
  review findings, incorporated changes and remaining proof obligations.

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
