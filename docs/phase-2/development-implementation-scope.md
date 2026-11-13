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

The R1/R2/R7 whole-image control contract is specified in
[button-free-control-contract.md](button-free-control-contract.md).
Its authenticated descriptor binds protocol/profile/layout, operation,
session/request, target, payload length/digest, allocation/Namespace and entry.
G1/G2 still gate LUMP service operations; they do not authorize raw writes
through the whole-image control path.

CRC detects framing corruption; digest checks received content. Neither
authenticates the sender. Do not accept a sender-selected destination merely
because the payload hash is correct. All executable publication remains last.

Image replacement: no old-image rollback promise with a single target buffer;
failed transfer stays stopped. Namespace installation: incomplete B stays
inactive and cannot corrupt A. LUMP upgrade: preserve old allocation and
continuations; failed candidate stays unpublished. Reconnect queries status;
it must not replay a destructive command based on a missing acknowledgement.

## Hardware and memory budget — reviewed allocation, not build approval

**Disposition (11 November 2026): conditional capacity, NOT verified fit.**
The existing top cannot address two envelopes. Retaining its measured three-copy
RAM architecture gives a calculable 108-BRAM36 application/staging allocation,
but resident payload selection, peripheral integration and timing remain gates.
The pin inventory also exposes a UART/Ethernet conflict requiring exact-board
schematic confirmation. No next full-profile BIT should be frozen on the basis
of spare BRAM alone. This is a closed desktop inventory with explicit unresolved
dependencies, not a claim those dependencies have been implemented or approved.

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

### Evidence ledger and physical replication

Offline inputs inspected (never regenerated or modified):

- Frozen bundle `generated-artifacts/church-machine-demonstration-20261111/`,
  `vendor/utilization.rpt`, routed Vivado 2026.1 report:
  SHA-256 `17a58a711522036c04908aacdcf0d53e38b22dd818efa7da11d912d8f244c7f1`.
  BIT/source/RTL identities and qualification limits are retained in
  [the physical evidence review](cooperative-retry/physical-evidence-review-20261111.md).
- Corresponding local frozen package
  `generated-artifacts/combined-vendor-mmcm-corrected-20261111/`:
  `source/hardware/starter_top.py`, `rtl/combined_starter.v` and
  `vendor/build.log` (SHA-256
  `3d21c4a6319226c34f0d9653689a86775737a11dd79a4c5186faeccdb3dc3616`).
  These ignored evidence directories are local copies, not portable Markdown
  dependencies; retain the frozen package with any approval handoff.
- Maintained source surfaces: `cooperative-retry/starter_top.py`,
  `starter_lifecycle.py`, `starter_sha256.py`, `combined_receiver.py`,
  `combined_board.py`, `combined-vendor-checks.tcl`; repository
  `hardware/ordinary_change.py`, `boot_thread_validation.py`,
  `ascending_namespace.py`, `boot_rom.py`, `rgmii_mac.py`.
  Current source is design evidence, not a substitute for the frozen source.

The RAM has **three synchronous read ports and one shared write port**:
data/Namespace/C-list multiplex onto `rd`; instructions use `fetch`; image SHA
and LUMP inspection multiplex onto `inspect`. Writes are selected between
lifecycle loader, staging receiver and CPU, not independent write ports.
The frozen build log names `memory_reg_1_*`, `memory_reg_2_*`,
`memory_reg_3_*`, each with indices 0–15: three 16-tile replicas with writes
broadcast. The routed report confirms 48 RAMB36E1 and zero RAMB18.
The preliminary/final synthesis table's `u_outform` 2K×8 RAMB18 is subsequently
removed by constant propagation; do not add it to routed use or assume it will
stay absent in a general profile.

At this 32-bit geometry, one tile supplies 1,024 payload words (4 KiB);
parity capacity is not extra application data. Thus 64 KiB × three copies
costs 48 tiles, not 16 and not `ceil(bytes/4608)`.

| Proposed physical allocation | Logical bytes | Port policy | BRAM36 budget |
|---|---:|---|---:|
| A envelope | 65,536 | Three read replicas, one broadcast write | 48 |
| B envelope | 65,536 | Same; select disjoint bank before local address slicing | 48 |
| Shared staging | 16,384 | Conservative same three-copy geometry | 12 |
| SD sector buffers | 1,024 | Two 512-byte buffers; reserve one tile each, no packing credit | 2 |
| Ethernet frame buffers | 8,192 | Proposed two RX/two TX 2-KiB buffers, serialized per buffer | 4 |
| Control/queue/diagnostic storage | up to 16,384 | Single-copy bounded storage; admission/CPU access arbitrated | 4 |
| ROM, restored Outform window and integration allowance | separately implemented | Conservative reservation, not measured new-profile use | 6 |
| **Planning total** | **144 KiB application/staging, other storage separate** | No extra concurrent DMA port assumed | **124 / 135** |
| Unallocated margin | — | Not available for automatic growth | **11** |

The last four rows are **proposed caps**, not hardware requirements already
settled or measured utilization. They reserve 16 tiles beyond the 108-tile
payload. Queue descriptors and software metadata inside an envelope must also
appear in its resident ledger; do not count a second independent budget for the
same bytes. A controller needing more buffers/ports must return to this budget.
A monolithic power-of-two rounding to 256 KiB with all three replicas costs
192 tiles and is infeasible. Use explicit banks or prove depth mapping.

The frozen ROM/SHA/control implementation consumes logic/registers rather than
additional routed BRAM; there are three SHA instances (image and two fixed LUMP
sizes). Replacing these with a bounded general verifier changes logic and
latency, not merely RAM depth. Baseline logic is 25,909 LUT / 19,511 FF;
remaining 37,491 LUT / 107,289 FF is only a ceiling, not an estimate of new
controllers. Retain the 25 MHz execution target; no new fmax promise.
Frozen setup/hold slack +5.008/+0.090 ns does not cover widened address muxes,
replicated write fanout, extra arbitration or peripheral clock crossings.
New exact reports, unconstrained-path/CDC checks and initialization verification
are required after separately approved synthesis.
The same report records 0/240 DSPs and 4/300 bonded IOBs. Unused IOB totals
do not establish routed connector availability or compatible bank voltage;
the schematic/pin gate below controls those decisions.

### Address and resident allocation obligations

Proposed **physical byte ranges**, not new Namespace authority:
A `[0x00000,0x10000)`, B `[0x10000,0x20000)`,
staging `[0x20000,0x24000)`. They require 18-bit byte / 16-bit word addresses
for the combined 36,864-word aperture. A/B local offsets remain 14-bit words;
staging offsets need 12 bits and a full-length count needs 13 bits (4,096).
A 65,536-byte image length needs 17 bits; the combined length needs 18 bits.
Reject high bits, overflow, misalignment and cross-region operations **before**
slicing; never let B alias A. MMIO remains separately decoded, not truncated
into this RAM aperture.

| Surface | Existing constraint | Required local acceptance before freeze |
|---|---|---|
| Top RAM/data/fetch/Namespace/C-list/inspection/writes | 16,384 words, `[2:16]`, 14-bit observer address; fixed staging at `0xa000` | Decode checked full address and bank for every path; last word/one-past tests in A/B/staging, read/write and fetch |
| Lifecycle and image SHA | Lifecycle caps image_words at 16,384; SHA length fixed at elaboration, address derived from words | Target base + bounded length; hash exactly selected bytes including padding rules; reject wrap and preserve A during B admission |
| Receiver/observer/transport | 8-bit staging addresses, 9-bit counts, two fixed size records; fixed-PC diagnostics | 4,096-word bound and full-length count; parameterized identity/length/digest; backpressure and transaction ownership, not counter truncation |
| Root/Thread validators | `ordinary_change.py` and `boot_thread_validation.py` contain 16,384-word bounds; `ascending_namespace.py` defaults to this capacity | Parameterize physical capacity without weakening per-object bounds; audit unit conversions and root-relative descriptor resolution, boot homes, SWITCH and restore |
| Image tools | `server/namespace_ascending_image.py`, `server/design_simulation.py`, combined fixture builders | Reject overlap and out-of-envelope allocations; bind B's exact child identities; relocate localized GTs/descriptors and entry state consistently |

The 1,000-slot interpretation remains **unapproved per Namespace**: table offsets
`[0,16000)` leave 49,536 bytes each, not 1,000 allocatable objects. Metadata/root,
SYSTEM and device slots consume that count; retained/retired versions consume
slots without necessarily retaining full bodies. If 1,000 means user slots,
reservations enlarge the table and this calculation must change.

The frozen fixture is not a resident manifest for this layout. Its SYSTEM Thread
at byte `0x1000` and USER Thread at `0x3000` would overlap the proposed 16,000-byte
table. The combined builder also copies a 256-word Thread to `0x8000`, reserves
a 256-word SYSTEM executable at `0x8400`, and uses 1 KiB staging at `0xa000`.
These are evidence of relocation work, not regions to preserve blindly.
Three 256-word Threads plus that SYSTEM executable already cost 4,096 bytes,
leaving 45,440 bytes after a 1,000-slot table, before other executable bodies,
USER data, service dependencies and alignment. A fourth such Thread reduces
that to 44,416. This example is a lower-bound illustration, not the full workload.

Before approval, produce a per-envelope ledger of exact selected LUMPs:
SYSTEM/startup/FreeHandler/Mint/Resolve/SecurityRegulator/SD/network dependencies,
each Thread's complete allocation (header, registers, homes, private stack and
C-list included), application data, allocation/GC roots and modified-state
metadata, alignment holes, retained old revisions and peak unpublished candidate.
Count shared code once only where explicit cross-root authority permits it;
otherwise budget separate copies. Old and new upgrade bodies coexist until
retirement; a 16 KiB staging buffer does not reserve 16 KiB destination space.
Require `table + all resident allocations + peak candidate + holes <= 65536`
for **each** root and separate slot exhaustion checks. Exact generalized
resident binaries are not yet selected, so workload fit is blocked, not passed.

### Peripheral and pin/controller dependency plan

**Schematic review update (11 November 2026):** the retained V3 manufacturer
schematic resolves the legacy-map conflict: UART remains E3/F3, Ethernet is
separately wired **GMII**, and J9 is an onboard microSD socket. See
[the V3 pin/controller and equipment review](wukong-v3-sd-ethernet-plan.md)
for the collision-free proposed map and bank supplies. On 13 November the owner
confirmed V3, microSD slot, a SanDisk 32 GB Ultra SDHC card, router connection
and manual power control. The proposal selects SPI SDHC and a full-duplex
10/100/1000 GMII/MII controller architecture; physical card fit, link speed and
power-interruption behavior remain acceptance checks, not measured results.
Its explicit CDC/controller allowances revise the conservative
planning total from 124 to **128/135 BRAM36**, leaving seven tiles; the earlier
tables below/above remain the original inventory, not updated fit evidence.
The legacy RGMII entries below describe the issue discovered, not V3 wiring
assignments. No runtime or build change is authorized.

| Interface | Evidence / available implementation | Dependency to close before RTL freeze |
|---|---|---|
| Clock, maintenance, UART | Frozen wrapper exports only `clk M21`, `maintenance_n M6`, RX F3, TX E3, all LVCMOS33; 50 MHz input → 25 MHz execution | Preserve demonstrated mapping unless explicitly revised; maintenance trust handled separately. Update strict four-port vendor check when approved ports change |
| Ethernet PHY | `hardware/rgmii_mac.py` describes RTL8211E and a Wukong **v1.1** map, not verified V3 wiring. Has MDIO/reset, fixed-frame 100BASE-T TX and RX logic (header's “RX future” statement is stale); absent from frozen wrapper | Verify exact V3 schematic, PHY model/straps, bank voltage and fitted connector. Review dynamic TX/RX, CRC/error handling, bounded queues, MMIO/driver and endpoint authority; existing call-home MAC is not a general messaging service |
| Ethernet candidate pins | TXC F4, TXCTL G1, TXD E3/E1/F3/F1; RXC D4, RXCTL C4, RXD D3/D1/E4/E2; MDC K1, MDIO L1, RESET H1 (15 signals) | **E3/F3 collide with frozen UART.** Confirm board routing before choosing alternative UART pins/connector or a reviewed mux. Never drive both or assume legacy pin comments apply. No assignments approved here |
| Ethernet clocks/reset | Legacy MAC assumes 25 MHz Ethernet TX; RX is PHY-clocked, MDIO is bidirectional | Board-correct I/O timing/delays, RX clock handling/CDC, reset sequencing, link-speed negotiation and FIFO overflow behavior. A 25 MHz CPU does not prove RGMII timing or gigabit support |
| SD | Named `ide.SD#` contract exists; no SD controller/top-level SD pin integration found in inspected hardware Python/XDC sources | Obtain exact slot/module schematic, card voltage/pull-ups, detect/write-protect wiring and pin-bank inventory. Select SPI (CLK/MOSI/MISO/CS, plus optional detect) or native SD (CLK/CMD/DAT[3:0], plus detect); do not invent package pins |
| SD controller/software | ReadBlocks/WriteBlocks/Sync/Info require real device behavior | Approve controller/IP, initialization clocks then transfer clock, timeout/removal/error and write-busy completion, sector buffers, MMIO grant, bounded transfer arbitration and driver. No DMA bypass of authority; raw reads cannot restore protected context |
| Persistent FPGA/startup | Existing BIT evidence does not prove MCS/power-cycle or application SD boot | Keep flash/programmer and application boot source distinct; confirm power-control equipment for automated power-cycle claims |

The proposed bus policy uses one serialized RAM write owner, bounded per-buffer
reads and explicit completion; no extra Ethernet/SD DMA read port is included in
124 tiles. Both device services must progress without starving SYSTEM/watchdog
renewals. Controller storage beyond the caps, additional ports, unavailable pins
or incompatible I/O banks reopen allocation. SD is backing storage, not RAM.
Two-Namespaces-on-one-FPGA messaging does not by itself require external Ethernet,
but does not waive the separately retained Factory Build Ethernet scope.

### Minimal alternatives requiring approval

1. **Keep both 64 KiB envelopes and 16 KiB staging:** split staging into a
   single-copy 4-tile RAM with one write/one arbitrated read, instead of three
   copies. Payload becomes 100 tiles; with the same 16-tile reserve total is
   116. Prove SHA/receiver/CPU exclusion and timing; this is a port-design change,
   not a claimed measured saving.
2. If resident/slot budgets fail, request an exact workload/capacity decision.
   Fewer slots or smaller envelopes are scope reductions and are **not selected**.
   Reusing code across roots requires explicit grants; paging is not a free fix.
3. If BRAM/timing still fails with reviewed arbitration, evaluate a separately
   approved external-memory controller or larger FPGA/board, including pins,
   clocks, latency, buffering and authority containment. No assumption that the
   current board provides usable external RAM.
4. If the UART/Ethernet conflict is confirmed, request a schematic-backed
   maintenance-UART relocation or suitable board/adapter. Omitting Ethernet or
   substituting UART is not an approved full-scope alternative.

### Exact affected acceptance criteria

This table refines R4/R5/R6 family routing only. It changes no workbook statuses,
original criteria or Phase 2 IDs. W7 rows are in
[`CTMM_W7_Threat_Test_Plan.xlsx`](../phase-1/CTMM_W7_Threat_Test_Plan.xlsx),
sheet **Completeness**; Phase 2 IDs refer to the
[test checklist](test-checklist.md). These are required future observations,
not results from the resource calculation.

| Dependency / stream | Exact workbook criterion affected | Exact Phase 2 cases and required evidence |
|---|---|---|
| Envelope and buffer quotas, R4/R5/R6 | W7-06: enforceable resource/latency bounds and neighbor isolation, not assumed GC/eviction | T3 bounded receive/full-buffer; B4 C-list exhaustion, B8 both pools exhausted; Q3 measured resident/storage bounds; N06 queue exhaustion/backpressure/progress. Fill A/B/staging independently; no wrap, spill or starving neighbor |
| Root relocation/address decode, R4 | BASE-02: validate exact Namespace-selected bytes, identity, permissions, allocation and binding | A1 same slot/version across roots remains distinct; A2 malformed saved stack/C-list/NIA has no partial activation; F.29 full-GT USER restore; F.30 protected context save; N01 wrong Namespace has no foreign effect. Include B high addresses and boundary negatives |
| Resident footprint and expansion, R4/R5 | W7-06 resource bounds; FUNC-03 allocation/bounds, permission revocation, malformed text and release/reuse with separate Threads | A8 resident startup dependencies before USER release; B1 actual header/SELF/usable C-list geometry; B2 nonadjacent placement; B5 distinct Thread entries; B9 expansion preserves old contents. Allocation arithmetic covers only the capacity dependency, not the other FUNC-03 assertions |
| SD/controller authority, R5 | CM-D: authorized/unauthorized MMIO, bounds and malformed writes; no device effects on rejection | S1 exact board/card/controller Info; S2 first/last-block round-trip and transfer limit; S3 bounds/authority rejection; S4 removal/write protection/controller errors; S6 isolated bindings and measured latency |
| SD durability and peak old/new bodies, R5 | W7-07: authority-preserving eviction/reload of relevant types, lifecycle/reset durability | S5 stated Sync guarantee; S7 interrupted/corrupt/stale restore rejection; Q2 actual context restore; Q3 resource bounds; Q4 no authority resurrection. File-write success is insufficient |
| RAM writer arbitration and publication, R4/R5/R6 | W7-10: whole-update exclusion/interruption under allowed concurrency | T8 wrong/stale/duplicate reply cannot partially install or wake wrong owner; N07 approved commit/exclusion; B9 preservation. Exercise overlapping receiver/CPU/device requests, no implicit multiwriter claim |
| Ethernet and two-root message path, R6 | FUNC-04: approved capability-authorized send/receive ownership/lifetime/fault semantics; W7-15: two-Namespace remote invocation remains Phase 2 | N01 destination binding; N02 replay/duplicate/correlation; N04 link/reset failure; N05 deputy/attenuation; N06 quota/progress; N08 outward-channel attribution. Local positive path cannot close external Ethernet |
| Peripheral control and exact candidate, R2/R8/R9 | W7-03 debug boundary; W7-04 ports/load ambient authority; CM-H exact identities; REL-01 timing/DRC/provenance | N09 admin/debug/install has same grant discipline; D3 exact source/RTL/BIT/image/board and evidence. Include final pin map/controller versions and routed per-memory utilization, not the historical report |

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

**D1 Remote control trust — decided, 11 November 2026.** The owner accepted
per-board key custody by the IDE server and protected board maintenance logic.
The browser/bridge relays no authority of its own. Use the normative
[control/security contract](button-free-control-contract.md): HMAC-SHA-256,
protected provisioning, cross-reset freshness, exact-image authorization,
write-quiescent STOP and status-first reconnect. Server compromise is a control
authority compromise; physical reprogramming/key extraction is outside this
development threat model. Passcodes remain unchecked and the ISA is unchanged.
This resolves the trust decision, not hardware qualification: protected key
storage, durable boot-counter feasibility and verifier resource/timing evidence
are mandatory gates. No suitable freshness source means remote control disabled,
not a button bypass or server-only authentication. No credentials, provisioning,
runtime changes, board commands, synthesis or flash are authorized by this decision.

**D2 Memory envelope.** Recommend the two 64 KiB envelopes and 16 KiB staging
target above, with 1,000 slots per Namespace still requiring explicit approval.
The reviewed three-copy allocation is 108 payload tiles, or 124 including
proposed peripheral/control reservations; this is not verified fit. Approve
the slot interpretation and exact resident workload, settle the pin/controller
dependencies, then qualify the exact candidate. Reject oversize candidates
explicitly. Any external-memory fallback requires review.

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
is R1/R2/R7's end-to-end replacement vertical slice under the decided trust
contract, after separate implementation authorization and freshness/storage
feasibility review. In parallel close R4/R5/R6 hardware-interface and budget dependencies
BEFORE freezing the next BIT. Then integrate upgrades, second Namespace and full
services on that same general profile; do not synthesize an early slice that
omits required interfaces and call it the full Phase 2 build.

Deliver the exact dependency diff, executable contracts, local test results,
resource budget and remaining blocked cases for vendor-build approval.
Volatile programming, flash installation and release publication remain separate
authorized operations. Target one new vendor build; do not guarantee no corrective
build will be needed after qualification.
