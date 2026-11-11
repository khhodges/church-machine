# Phase 2 development-platform build proposal

Status: proposed for review, not implementation, vendor-build or programming
authorization. Prepared 11 November 2026.

## Goal

One application-independent FPGA configuration supporting the full documented
Phase 2 campaign, rather than another fixed demonstration. Ordinary compatible
LUMP upgrades, application replacement and installation of a second Namespace
must not require synthesis or physical button presses.

This is a coordinated FPGA, SYSTEM-service, IDE and host-protocol release.
A BIT alone cannot satisfy Phase 2. Target one vendor build after integrated
local readiness; do not guarantee that hardware acceptance will require no fixes.
Preserve the demonstrated BIT, frozen packages and first board.
No ISA, 32-bit GT format or hardware-generated version changes.

## Mandatory IDE automation

The user requires all operations to be automated by the IDE. Standalone scripts,
manual terminal commands, opening Vivado, copying hashes, uploading capture
folders and timed board-button presses do not constitute delivery.

The IDE owns the complete sequence: select exact inputs and target, compile,
bind, check compatibility/resources, prepare, authorize, transfer, verify,
activate, observe, collect raw evidence and report the actual result. Scripts
may be internal implementation tools, never required operator handoffs.

Provide one deliberate action per operation: Upgrade LUMP, Install Namespace
& Start, Replace Image & Run, Run Phase 2 Acceptance, Build FPGA, and Install
Persistent Build. Existing role permissions and explicit approval of disruptive
or destructive effects remain; do not add repeated confirmations for the
already-approved substeps. FPGA build, programming and flash operations use
the authorized tool host/board bridge, with visible progress and verified
artifacts. GitHub archival includes automated upload and download/hash checking;
an unavailable integration is a reported blocker, not claimed completion.

Acceptance results and raw evidence must be captured automatically against
the exact BIT, image, LUMP, Namespace, Thread, target and session identities.
Display pass/fail/blocked, not synthetic success. Reconnection reconciles
operation status without blindly replaying destructive commands.

Physical cabling, inserting media and an actual power cycle cannot be promised
as software-only operations without suitable attached hardware. If automated
power-cycle acceptance is required, provision a controllable power interface;
otherwise explicitly report that test blocked/manual, never infer it from reset.
Normal application operations must require no physical board-button press.

## Scope and acceptance

The existing `test-checklist.md` is the acceptance baseline: 89 scenario groups
(F38, A8, T8, B12, S7, Q4, N9, D3), with parameterized subcases. Preserve their
IDs and assertions. The following requirements supplement, not replace them.

| Area | Required delivery and acceptance |
|---|---|
| General image loading | No application hash, caller PC, payload size or application-specific boot guard compiled into the BIT. Versioned, bounded transfer and approved runtime admission description. Integrity checked against authorized expected bytes. Execution disabled until complete validation. Freeze RTL, then create and run a previously unknown compatible image. |
| Remote maintenance | IDE-controlled stop, acknowledged write quiescence, transfer, verification, initialization and start without board-button timing. Authorized control path independent of application progress, session/request correlation and stale-command rejection. Physical recovery remains available. Specify authentication/provisioning before implementing; neither CRC nor unchecked Passcodes supplies it. |
| IDE operations | One deliberate action each for Upgrade LUMP, Install Namespace & Start, and Replace Image & Run. Exact target/content identity, visible progress and errors, explicit destructive replacement meaning, status reconciliation after lost acknowledgements, no blind retry. Reuse existing preparation/authorization paths rather than add competing controls. |
| Lazy Load and Resolve | Unified SYSTEM-to-IDE REQUEST/DELIVER; approved revisions by default, plus-marked later-version tests use distinct slots. Complete LUMP validation/publication, protected original-CALL retry, other eligible USER progress, all-waiting SYSTEM progress. Include non-CALL Resolve after its contract is settled. |
| Scheduling and watchdog | Existing Boot.Thread/slot 2 is SYSTEM, active identity in CR12, CR13 unchanged. Correct DR1–DR6 LLR ABI with DR0 zero. SYSTEM owns pending state and cooperative USER round robin. No waiting-USER timeout/resume shortcut, hardware blocked bit, SYSTEM watchdog exemption or unrestricted kick. Retain SecurityRegulator custody and approved transition renewal/expiry semantics. |
| Upgrade and retirement | Different-size revisions coexist; preserve old callers and continuations. Publish and adopt only after validation. Lazy retirement retains the slot; GC reclaims memory only with proved active-use/root and modified-state custody rules. Authorized software changes versions; no hardware repair or wrap. Explicit destruction and slot reuse are separate operations. |
| Second Namespace | Explicitly install a complete Namespace package containing Thread and abstraction LUMPs into separate bounded memory. Validate child/composite identities and destination-local bindings; never treat imported GT bits as local authority. No partial activation; scoped device/service grants; tested root switching and Thread restoration. Namespace-type automatic Lazy loading remains excluded. Include the Phase 2 Namespace-creation/Mint contract, not just copying a byte container. |
| Capacity | Retain the agreed initial 1,000-slot target and reserve the second Namespace's share of FPGA memory. Close actual RAM/table/Thread/staging/GC budgets before synthesis; establish whether the slot target applies per Namespace in the two-Namespace configuration. Two full 64 KiB images cannot occupy a single 64 KiB region. SD capacity is not resident RAM. |
| Mint and compact Blocks | Carry the existing tested CREATE/DESTROY baseline forward without claiming unproved new GTMint behavior. Reconcile the approved Mint-private port and diagnostic capability requirements with implementation. Cover compact inventories, independently placed Blocks, issuance, exhaustion, release, containment and expansion preserving earlier state (B1–B12). |
| Storage and transactions | Include actual SD controller/pin/resource requirements now if needed for S1–S7; no silent deferral of hardware dependencies. Capability-controlled block I/O, bounded buffers, explicit errors and Sync guarantees. Stored Thread state, integrity, stale-state rejection and interrupted-update contracts; transaction isolation and real resume, not template reinitialization (Q1–Q4). |
| Networking | Begin with two Namespaces on one FPGA. Specify grants, destination identity, quotas, replay/correlation, commit and failure semantics; execute N01–N09 with valid controls. Same-FPGA results do not establish multi-board isolation or exactly-once external effects. |
| Diagnostics and persistence | Truthful build/protocol/image identity, Namespace/Thread-aware progress/fault/trace, protected diagnostic access and retained raw captures. Address voltage declarations and all INIT concerns without rewriting historical receipts. Produce BIT, source/RTL manifests, reports and hashes. MCS only after flash geometry/offset/recovery review; separately authorize flash and power-cycle acceptance. Define application startup persistence separately from FPGA configuration persistence. |

## Failure contracts

- Rejected candidate LUMPs remain unpublished; existing revisions retain their
  allocations and valid references. Concurrent execution requires its own proof.
- Failed single-buffer whole-image replacement remains stopped: no promised
  rollback after overwriting old RAM.
- Failed second-Namespace installation must not corrupt the existing Namespace;
  cleanup cannot reclaim another object's memory or fabricate capabilities.
- Disconnect/reconnect does not imply replay permission or automatic resume.
- No hardware execution from partial transfers or unvalidated Thread contexts.

## Required decisions before vendor synthesis

Close the existing G1–G9 contracts: transport/backpressure; session setup;
SYSTEM state/provisioning; reset/version ABI; retirement/custody; plus-name and
Resolve details; Block expansion; SD/storage; networking.

Additionally settle remote maintenance authentication and provisioning, memory
partition and staging budget, Namespace creation/activation and shared-service
policy, boot/start persistence, and implementation support for all required
hardware devices. Preserve the approved decision that general Passcodes remain
unchecked in Phase 2; do not quietly use them as authentication.

Inventory every fixture assumption in the exact demonstrated source and map
each requirement to FPGA, software or both. Do not replace the entire core with
the latest tree without a reviewed dependency/conformance comparison.

## Release sequence

1. Approve this scope and resolve concrete open contracts.
2. Implement and run exact-candidate local integration checks, including
   unchanged-RTL/new-application acceptance, concurrent lazy loading, two roots,
   remote stop under fault, malformed/stale transfers and interrupted installs.
   No separate simulator-parity programme is a prerequisite.
3. Freeze the source and protocol; close resource, clock, constraints and
   hardware-interface requirements. Review evidence before vendor-build approval.
4. Build once as the target, check timing/DRC and exact provenance, then obtain
   separate authorization for volatile programming on the second board.
5. Execute the full Phase 2 physical acceptance matrix, recording pass/fail/
   blocked per case. The five saved IDE designs must each have a specific
   supported/migration/blocked result; do not silently rename missing LUMPs or
   convert the historical Original design.
6. After acceptance, prepare MCS and separately test flash/power-cycle startup.
   Complete the GitHub source/assets archive without altering frozen history.

“Phase 2 complete” requires evidence for the whole approved matrix, including
later retirement, storage and networking objectives. An earlier usable
stop–load–run milestone may be delivered, but must not be labeled full completion.
