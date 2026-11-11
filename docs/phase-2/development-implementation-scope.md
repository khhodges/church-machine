# Phase 2 development platform — implementation scope

11 November 2026. Readiness review only; no runtime, synthesis or physical
operation authorized. Supplements development-build-proposal.md.

## Baseline and deliverables

The accepted combined-starter milestone and its limits are recorded in
cooperative-retry/physical-evidence-review-20261111.md. Preserve its frozen
BIT/source/image packages. Acceptance does not qualify all Phase 2 behavior.
The scope is a coordinated FPGA/SYSTEM/IDE release, not just a new BIT.

Deliver a separate development profile with no application-specific constants;
versioned host protocol; SYSTEM loading/allocation services; IDE orchestration;
machine-readable test/evidence results; BIT and persistent-build package.
No ISA change, GT-format change, implicit capability grant or hardware version
increment. Do not patch frozen evidence or silently replace the main core.

## Concrete change surfaces and work order

Paths in this table exist; names in parentheses are proposed modules, not
claims about existing functions. Derive a new isolated development profile
from the demonstrated dependency closure; preserve diagnostic fixtures as tests.

| Stream | Existing surfaces | Required change / exit test |
|---|---|---|
| P2-R1 General admission | docs/phase-2/cooperative-retry/starter_top.py, starter_lifecycle.py, starter_transport.py, starter_sha256.py, prepare_combined.py | Replace two-image selector/hash admission with a bounded, authorized runtime transfer descriptor. Parameterize verifier length. Replace fixture boot-guard provisioning through an explicitly authorized runtime configuration path; do not remove boot identity validation. Freeze RTL, then create and accept a new compatible image. |
| P2-R2 Remote maintenance | same lifecycle/transport/top; server/uart_profile_install.py | Separate protected maintenance control from application progress. Authenticate session/command; STOP acknowledges actual write quiescence. Define BEGIN/DATA/VERIFY/START/ABORT/STATUS with session/request identity, ordering, bounds and reconnect reconciliation. No physical-button dependency, unchecked Passcode authentication or blind retry. |
| P2-R3 General LUMP lifecycle | cooperative-retry/combined_protocol.py, combined_receiver.py, combined_inputs.js, prepare_combined_review.py; simulator/examples/cooperative_retry_system_*.cloomc | Replace two fixed records/phases and fixed 256-word receiver with bounded runtime requests/staging. SYSTEM owns requested identity, allocation, validation and publication. Preserve original CALL, approved-default Lazy policy and plus-version separation. Add Resolve and retirement only under settled contracts. Other USER progresses during delay; all-waiting SYSTEM renews watchdog normally. |
| P2-R4 Namespace and memory | starter_top.py; hardware/ordinary_change.py, hardware/change.py; server/namespace_ascending_image.py, server/design_simulation.py | Audit all address widths/slices, RAM ports, boot/root/Thread assumptions. Install Namespace B with child identity/binding validation into disjoint memory. Validate SWITCH/root transitions and restore under existing ISA. Test same slots/versions in different Namespaces, interrupted install and A unaffected. Namespace install is explicit, not automatic Lazy loading. |
| P2-R5 Allocation/storage | docs/phase-2/mint-abstraction.md, gt-construction-port.md, compact-block-inventory.md, sd-storage-abstraction.md and their implementation dependencies | Retain tested Mint baseline; identify precise missing GTMint/diagnostic integration. Implement Block expansion, active-use/GC roots, modified-state custody and safe retirement. Inventory SD controller, pins, bus and driver before RTL freeze; do not assume software can add absent hardware. Run B/S/Q acceptance groups. |
| P2-R6 Communication | docs/phase-1/W7-phase-1-and-2-test-plan.md; docs/phase-2/test-checklist.md | Define two-Namespace messaging on one FPGA, endpoint/grant identity, bounded queues, correlation, duplicate handling and effects under failure. Do not claim multi-board networking from this topology. Review Factory Build Ethernet dependencies explicitly rather than treating UART as a substitute. |
| P2-R7 IDE orchestration | server/development_latest.py, development_image_prepare.py, development_image_view.py, uart_profile_install.py; artifacts/development-image/src | Replace old-profile assumptions only in the new selected profile. One operation owns exact inputs/target, preflight, transfer, activation and result. Add Upgrade LUMP, Install Namespace & Start, Replace Image & Run; integrate authorized build/programmer host and test runner. Never interpret an ACK as execution success. |
| P2-R8 Evidence/observability | cooperative-retry/combined_observer.py, combined_board.py, combined-vendor-checks.tcl, export_combined_board.py, generate_combined_board.py, build_combined_vendor.py | Remove fixed-PC/caller observations from general telemetry. Report actual image/Namespace/Thread/transaction identity, progress and faults; automatically retain raw UART, byte hashes and test oracles. Fix configuration-voltage declarations for the new profile, analyze INIT warnings and retain timing/provenance. |
| P2-R9 Regression/release | W7 workbook; docs/phase-2/test-checklist.md; existing test_starter_*, test_combined_* and host tests | Preserve historical fixture tests; add general-profile tests. Run applicable ISA/authority/boot regressions on the exact candidate. Report 113 workbook rows and 89 Phase 2 groups separately. Closure requires row criteria, not a global pass count. |

The frozen package places exported modules under hardware/, but their maintained
starter/receiver/observer sources are currently in docs/phase-2/cooperative-retry/.
Update source/export ownership together; do not edit generated RTL as source.
Current starter top explicitly excludes legacy debug parser/auto recovery. Do not
silently import those production behaviors while adding remote control.

## Admission and failure contract

Two trust decisions must remain distinct:
1. which controller may stop/replace/install; and
2. which exact image or LUMP that controller/request is authorized to admit.

Proposed transfer metadata: protocol/profile/layout version, operation,
session/request, target identity, payload length and digest, destination
allocation/Namespace, and approved entry configuration. Fields and encoding
are not frozen until authorization and G1/G2 contracts are settled.

CRC detects framing corruption; digest checks received content. Neither
authenticates the sender. Do not accept a sender-selected destination merely
because the payload hash is correct. All executable publication remains last.

Image replacement: no old-image rollback promise with a single target buffer;
failed transfer stays stopped. Namespace installation: incomplete B stays
inactive and cannot corrupt A. LUMP upgrade: preserve old allocation and
continuations; failed candidate stays unpublished. Reconnect queries status;
it must not replay a destructive command based on a missing acknowledgement.

## Hardware and memory budget — provisional design, not a fit claim

Measured demonstrated build: xc7a100tfgg676-2, 25 MHz execution, 57,600 baud UART;
25,909/63,400 LUTs, 19,511/126,800 registers, 48/135 BRAM36 tiles.
Its top uses 14-bit word addressing and a 16,384-word application RAM.
Receiver address width is eight bits, with nine-bit word counts and fixed
256-word staging. CPU/fetch/verifier/loader slices must be widened together
if addressable application memory grows. No wrap/truncation is permissible.

Proposed resource target for review:

| Region | Logical budget |
|---|---:|
| Namespace A allocation envelope | 64 KiB |
| Namespace B allocation envelope | 64 KiB |
| Shared bounded LUMP staging, one serialized transfer | 16 KiB |
| Control, queues, diagnostics, ROM and implementation overhead | separately inventoried; not hidden in application free space |

Each Namespace's table, resident SYSTEM/Threads, abstractions and spare space
must fit its envelope. With 1,000 four-word table slots, the table costs 16,000
bytes; a 64 KiB envelope leaves 49,536 bytes BEFORE Threads/code/stacks.
Proposed interpretation: 1,000 total slots per Namespace, including reservations;
this requires approval rather than claiming it was already settled for two roots.
LUMPs larger than staging are explicitly rejected initially unless a separately
validated chunked-staging design is adopted; never silently increase the limit.

144 KiB is logical payload capacity, NOT total synthesized BRAM use. BRAM port
replication, SHA access, ROM and buffering can multiply physical cost. 87 unused
BRAM tiles in the old report do not prove the new profile fits. Derive an exact
port/replica allocation and clock/resource estimate before vendor approval.
If it does not fit, bring back the capacity tradeoff; do not shrink the promised
two-Namespace workload or switch to external memory without review.

The current board wrapper exposes only clock, maintenance and UART pins.
SD/Ethernet requirements therefore need explicit controller, pin, clock, reset
and bus integration review. SD capacity cannot substitute for resident RAM.
No physical peripheral availability or pin allocation is assumed by this scope.

## Test/evidence gates

1. Requirement mapping: retain each original workbook ID, status and closure
   criterion; identify implementation stream, relevant Phase 2 groups and open
   contracts. Candidate links are not evidence of full coverage.
2. Unknown-after-freeze image: fixed candidate RTL accepts a newly created
   compatible image, rejects bad digest/length/entry and needs no physical press.
3. General LUMP: unknown-after-freeze identities and sizes, bounds/exhaustion,
   wrong/stale/duplicate/out-of-order traffic, protected CALL retry and progress.
4. Namespace B: install while A is preserved; no partial activation; run with
   separate root/Thread identities; test foreign access and deliberate sharing.
5. Control: stuck/faulted application cannot block authorized maintenance;
   unauthorized/stale control cannot stop or overwrite; reconnect never duplicates
   effects. Verify in-flight write completion before claiming STOP.
6. Lifetime: execution references, retained slots, GC roots, zeroing/reuse,
   modified-state persistence and version exhaustion. Existing ISA governs faults.
7. Full qualification: all F/A/T/B/S/Q/N/D cases, applicable Phase 1 regressions,
   exact candidate build reports and physical evidence; no blanket closure.
8. Persistence: IDE prepares/programs/verifies MCS through authorized bridge.
   Specify boot application source independently from FPGA flash. Power-cycle
   acceptance requires controllable power hardware or remains explicitly blocked.

No separate simulator-alignment programme is required. Cheap exact-candidate RTL
checks precede synthesis, but physical acceptance remains authoritative.
Test tooling must automate stimulus, collection and evidence indexing through
the IDE; manual capture-folder copying is not the delivered workflow.

## Decisions required before implementation freeze

**D1 Remote control trust.** Recommend authenticated IDE/bridge sessions with
board-verifiable anti-replay control and protected provisioning, not unauthenticated
UART or unchecked Passcodes. Decide key/provisioning custody, recovery/revocation
and hardware verifier feasibility before selecting the mechanism. Existing
server authorization alone does not authenticate commands to the board.

**D2 Memory envelope.** Recommend the two 64 KiB envelopes and 16 KiB staging
target above, with 1,000 slots per Namespace, subject to verified fit. Reject
oversize candidates explicitly. Any external-memory fallback requires review.

**D3 Lifetime/services.** Settle G1–G9 where still open, especially non-CALL
Resolve, retirement active-use and modified-state custody, Thread reset/version
ABI, SD persistence and networking commit/failure semantics. Use existing
approved rules; do not invent policy from successful fixtures.

**D4 Persistent startup and equipment.** Recommend flash the accepted FPGA
configuration first, then authenticated IDE application loading after reset.
Standalone application boot from SD/flash is a separate specified capability,
not implied by generating MCS. Confirm available SD/network/power-control
equipment before advertising automated acceptance.

## Exit and sequencing

This review authorizes no execution changes. The next local implementation unit
is R1/R2/R7's end-to-end replacement vertical slice after its trust contract is
approved. In parallel close R4/R5/R6 hardware-interface and budget dependencies
BEFORE freezing the next BIT. Then integrate upgrades, second Namespace and full
services on that same general profile; do not synthesize an early slice that
omits required interfaces and call it the full Phase 2 build.

Deliver the exact dependency diff, executable contracts, local test results,
resource budget and remaining blocked cases for vendor-build approval.
Volatile programming, flash installation and release publication remain separate
authorized operations. Target one new vendor build; do not guarantee no corrective
build will be needed after qualification.
