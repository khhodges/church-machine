# Phase 2 — consolidated acceptance checklist

**Status: required tests, not execution results.** No test in this checklist is
claimed run or passed. Listing a case does not authorize RTL edits, boot-image
replacement, upload, reset or flashing. Physical operations require separate
authorization. Updated to include the approved internal-LLR watchdog renewal.

The approved register correction uses DR1–DR4 for metadata, DR5 for target
slot and DR6 for the outgoing USER GT. DR0 stays hardwired to zero.
F.23 must use distinct nonzero metadata words, target slot and a full versioned
USER GT, verify exact DR1–DR6 placement and unchanged DR0, and verify USER's
original DR1–DR6 were saved before injection. T1 transmits only DR1–DR5
(20 bytes); DR6 remains internal. This adds assertions, not new case IDs.

## Authority and scope

- [Unified lifecycle](../lazy-lifecycle-unified.md) owns F.1–F.38 and the current
  FPGA/software interface. The summaries here do not replace its full assertions.
- [Block inventories](compact-block-inventory.md), [SD storage](sd-storage-abstraction.md)
  and the [W7 networking campaign](../phase-1/W7-phase-1-and-2-test-plan.md)
  own their later objective contracts.
- [Master ISA](../phase-1/01-isa/instruction-set.md) remains the Phase 1 baseline;
  Phase 2 extensions require exact-build evidence, not retroactive baseline claims.
- U.0–U.8 and X.1–X.3 are coverage references, not additional independent test
  counts. F.1–F.38 retain their existing identifiers. Additional A/T/B/S/Q/D
  identifiers below organize tests of documented requirements, not new features.
- This inventories the currently documented Phase 2 scope, not unrelated uses
  of “Phase 2” for earlier compiler migrations, protocol rollout stages or GC phases.

## Execution order and gates

1. **First milestone:** exact hardware absent-body USER CALL → SYSTEM request →
   delayed validated delivery → original CALL executes once. Demonstrate another
   USER progressing while the requester waits, then repeat with all USERs held
   and SYSTEM self-CHANGE renewing the watchdog. No forced waiting-USER resume.
2. Qualify the full entry/exit, authority, watchdog, software association,
   transport and reset matrix below. Do not claim full acceptance from one demo.
3. Later: retirement/custody, compact Blocks, transaction backing, SD storage
   and two-Namespaces-on-one-FPGA networking. They do not gate the first proof.

**All cases require implementation and evidence.** “Agreed” below means the
expected architectural result is specified, not that the case can already run.
Gates apply to the affected portion; settled negative assertions can be checked
before an entire integration contract is complete.

| Gate | Contract still needed before closing affected tests |
|---|---|
| G1 | Transport capacity, full-buffer/backpressure behavior, framing and byte/word ordering. No silent unread-input loss. |
| G2 | Session-setup exchange, durable issuer and verified end-to-end reset boundary. u64 session/u32 request widths and no-reuse lifetimes are already settled. |
| G3 | SYSTEM record layout, private completion/registration provisioning and software scheduling details. No hardware blocked bit or premature CHANGE to waiting USER. |
| G4 | Authorized reset sequencing, SecurityRegulator increment ABI/new-GT provisioning, stale-owner/delivery-fault disposition and exact diagnostics where not yet assigned. |
| G5 | Retirement admission, active-use/GC roots, modified-state custody, zeroing/reuse, saved-object serialization and exhaustion outcomes. |
| G6 | Plus-marked test-name grammar; non-CALL lazy-resolve entry/continuation details. No new opcode or ambient authority is implied. |
| G7 | Compact layout qualification, explicit application Data/C-list handoff and B2 expansion procedure preserving B1 state. |
| G8 | SD name binding, ABI, transfer limits, completion/errors and higher-level durable storage/recovery format. |
| G9 | Networking protocol, grants, quotas, commit/idempotency/failure contracts and topology approval. |

For the first proof, close the necessary G1–G3 portions and safe installation/
fault handling for the exact fixture. Do not silently substitute a mocked
delivery, disable the watchdog or bypass admission because a contract is open.

## Lifecycle scenarios — all 38 existing F cases

“Later” indicates follow-on lifecycle scope, not removal from Phase 2.

| ID | Test and required result | Scope / gate |
|---|---|---|
| F.1 | Resident CALL executes intended method in USER with no SYSTEM entry/request. | Agreed |
| F.2 | Valid absent-body CALL saves USER and activates slot-2 SYSTEM/CR12; no USER Wait or substituted GT. | Agreed |
| F.3 | DR6 is outgoing USER's unchanged full GT; preserve original USER DR6; distinguish owners of equal targets. | G3 association |
| F.4 | Immediate response cannot interrupt request registration or re-enter SYSTEM. | G1/G3 integration |
| F.5 | Delayed/unavailable target stays pending without request timeout, duplicate or premature resume; other USER/SYSTEM work obeys watchdog. | G1/G3 |
| F.6 | Delivery is consumed by active SYSTEM through receive/status; no Thread switch, register injection or Z entry signal on arrival. | G1 capacity |
| F.7 | Corrupt, wrong-target or mismatched delivery cannot complete or resume USER. | G1/G4 exact disposition |
| F.8 | Duplicate, stale and old-session replies cannot reinstall, resignal, wake replacement USER or complete another request. | G1/G2/G4 |
| F.9 | Multiple USER requests dispatch FIFO without waiting for prior delivery; out-of-order replies affect their own owners only. | G1/G3 |
| F.10 | Multiple USERs awaiting one LUMP retain independent associations; one signal is not broadcast. Do not assume cross-USER coalescing. | G3 |
| F.11 | FreeN/Release CALL/RETURN stays in SYSTEM using its own grants; no USER authority substitution. | Agreed boundary; allocation integration |
| F.12 | Retirement retains slot/identity, respects active use/modified state, signals only after safe release and defers without blocking SYSTEM. | Later, G5 |
| F.13 | No CALL frame/context/advance before suspension; original GT, operands and CALL location restored; method runs once without replaying earlier instructions. | Agreed |
| F.14 | One shared u32 request counter starts at 1, excludes zero, never reuses, faults beyond max; session/reset/disconnect semantics stay distinct. | G2/G4 diagnostics |
| F.15 | Handlers serialize to completion; no nested handler, preemptive delivery or another Thread interleaving handler work. | Agreed |
| F.16 | Cooperative cyclic USER selection skips waiting USERs; completion is eligibility, not immediate activation; all held leaves SYSTEM active. | G3 cursor implementation |
| F.17 | Repeated LLR entry restores SYSTEM service-loop continuation, not startup; CR12 correct, CR13 untouched, no reset-marker replay. | Agreed |
| F.18 | Retire SelfTest/WCH only after diagnostics/return and safe-use checks; preserve required transport/fault dependencies and results. | Later, G5 |
| F.19 | Only operator power cycle reruns deferred diagnostics; software reset/fault retains mandatory validation without implicitly reloading diagnostics. | Later, cold-start distinction/G5 |
| F.20 | Reserve one record per configured USER; no in-flight overwrite; completed record reused on next LLR with fresh ID, without CALL-execution ACK. | G3 |
| F.21 | Shared completion serves U.5/U.8 only after respective readiness/retirement preconditions, consumes once and signals correct owner. | G3/G5 |
| F.22 | Retain local state until durable custody ACK; validate returned saved context/identity before restoration; reject stale authority. | Later, G5 |
| F.23 | Capture Namespace words/target/USER GT before switch; save USER, restore SYSTEM, inject DR1–DR6/Z=1; preserve N/C/V and USER flags. Wire target is only DR1–DR5, 20 bytes; saved Z=0 prevents replay. | Agreed API; G1 wire |
| F.24 | Explicit retirement only; next eligible allocation skips reserved/retained slots, respects 1,000 total slots and never silently expands or evicts. | Later, G5 exhaustion |
| F.25 | Exclude old setup bytes/work across FPGA, bridge and IDE before new session; failure to prove boundary cannot report setup success. Disconnect alone preserves session. | G2 |
| F.26 | Reset one USER queued and then in-flight; increment only its version through software, invalidate its old association, preserve other USER/session/counter state. Valid returned object admission remains separate. | G4 |
| F.27 | Last valid Thread version succeeds; increment beyond maximum HardFaults without wrap, new runnable context or automatic slot replacement. | G4 |
| F.28 | SYSTEM unavailable dependency HardFaults with ABSENT_OUTFORM 0x11, no loading trap/request/recursive entry; invalid authority keeps applicable reason. | Agreed |
| F.29 | SYSTEM exits through ordinary CHANGE using selected USER's full permissionless GT; restore original CALL/context; stale GT/context HardFaults. | Agreed |
| F.30 | Reuse normal protected USER save with original registers/flags/operands, no duplicate context bank or callee frame; failed save cannot enter SYSTEM partially. | Agreed |
| F.31 | Queued/in-flight LLR never retriggers during other work; USER stays unscheduled, not polling the saved CALL. | G3 enforcement |
| F.32 | Valid unavailable USER CALL directly admits internal SYSTEM entry with no extra enable/opcode; invalid state/SYSTEM LLR HardFault; reset marker remains reset-only. | Agreed |
| F.33 | Delivery during USER or SYSTEM execution preserves current context/flags; bounded unread input retained; active SYSTEM processes after previous handler. | G1 full-buffer |
| F.34 | Pending/ready state belongs to SYSTEM; no FPGA blocked bit. Otherwise valid CHANGE is not rejected solely for outstanding software LLR state. | Agreed boundary; G3 |
| F.35 | USER voluntarily yields through ordinary CHANGE to authorized SYSTEM GT; resumes after CHANGE; SYSTEM restores saved Z=0 without DR injection. | Agreed |
| F.36 | Existing watchdog applies to active USER/SYSTEM; indefinite LLR wait is not indefinite unrenewed execution. No new exemption, request timeout or preemption. | Agreed |
| F.37 | SYSTEM self-CHANGE CR12 renews strictly before deadline and continues after CHANGE without startup/new LLR/waiting-USER activation; failed/skipped transfers do not renew. | Agreed |
| F.38 | Internal LLR renews only after USER save, SYSTEM restore and injection all succeed; detection/partial/failure never renews or pauses; expiry wins at equality. | Agreed |

## Additional boundary and regression checks

These expand coverage of existing agreements; they do not introduce new behavior.

| ID | Test and required result | Gate |
|---|---|---|
| A1 | Same slot in different Namespaces and same slot at different versions are not interchangeable identities; slot-2 role detection follows validated active CR12, not a fixed raw token or CR13. | Agreed |
| A2 | Invalid/NULL, wrong-type, wrong-version and permission-bearing Thread GTs, malformed saved stack/C-list/NIA fail normal transition checks; no repair or partial activation. | Agreed |
| A3 | Invalid CALL authority known before body availability HardFaults without LLR; after loading, normal body-dependent method/bounds/integrity checks still run. | Agreed |
| A4 | CALL/RETURN into FreeHandler/transport keeps SYSTEM identity; their unavailable dependency still gives 0x11. CR13 stays unchanged across all paths. | Agreed |
| A5 | Test 0.25/0.5/1/2-second watchdog selections, initial one second, before/equal/after deadline, failed/skipped transfers, stalls, Debug/Trace entry/exit/reset retention and unchanged fault precedence. | Agreed, baseline regression |
| A6 | Approved revision fetched by default; explicit plus-marked newer test uses a new slot; Namespace-type LUMP excluded; retained slots not treated as free. | G6 grammar; G5 exhaustion |
| A7 | Local lazy resolution completes without unnecessary IDE request or extra authority; non-CALL use preserves its own operation, not an invented CALL. | G6 non-CALL entry |
| A8 | SYSTEM starts once with resident required dependencies, validates before USER release and initializes saved Z=0; startup failure blocks release, runtime does not rerun diagnostics. | G3 fixture; cold-start distinction |

## Transport, correlation and software reset support

These are integration tests needed around the FPGA contract, not transport
algorithms implemented in microcode.

| ID | Test and required result | Gate |
|---|---|---|
| T1 | Exact five-word payload, original Namespace mapping and target slot; DR6 excluded. Serialize u64 session plus u32 request separately; round-trip agreed byte order. | G1 |
| T2 | Split/coalesced/truncated/oversized frames and delayed bytes do not corrupt following messages or create partial accepted deliveries. | G1 framing/errors |
| T3 | Fill receive capacity during USER and SYSTEM work; bounded retention and explicit full-buffer handling, no silent overwrite; no delivery IRQ/register injection. | G1 capacity/backpressure |
| T4 | First session is nonzero; durable increasing u64 allocation survives restart without reuse; exhaustion or lost/rolled-back trusted state cannot silently issue IDs. | G2 |
| T5 | LLRs can queue before setup but cannot dispatch unestablished; delayed setup replies after reset cannot establish an old session; ordinary reconnect retains session. | G2 |
| T6 | Request 1 through boundary values and 0xFFFFFFFF; next allocation HardFaults without wrap; match session+number+target, never number alone. | G1/G2/G4 diagnostic |
| T7 | Exercise SecurityRegulator version increment through authorized software, old-GT rejection, legitimate new-GT provisioning and overflow. No implicit authority from B or hardware version mutation. | G4 |
| T8 | Wrong session/target/integrity, duplicate and reset-stale replies cannot cause partial installation, second completion or wrong-owner wakeup; valid returned body is not discarded solely for USER reset. | G4 exact disposition |

## Later compact Block inventory tests

Source: [compact Block inventory acceptance](compact-block-inventory.md).
All are later objectives; G7 must be closed for affected cases.

| ID | Test and required result |
|---|---|
| B1 | Qualify proposed 16-entry/64-word FreeClist geometry including header, protected SELF, 15 usable entries, bounds and ordinary LS/SAVE checks; retain baseline if unqualified. |
| B2 | Place B1/B2 differently; follow named GTs without Block-base/adjacency assumptions; share exact FreeHandler/startup executables. |
| B3 | Three Data64 allocations come from B1; next comes from B2. |
| B4 | B1 C-list exhaustion selects B2, not unapproved provisioning. |
| B5 | Two allocated Threads receive distinct supplied application E-GTs in saved CR1; allocation alone does not activate. |
| B6 | Release affects only the owning Block's allocation state. |
| B7 | Foreign/unissued release is rejected without state mutation. |
| B8 | Both Blocks exhausted for a kind gives explicit empty result, no fallback pool. |
| B9 | Register B2 after B1 issuance/quarantine without reseeding B1, losing contents or silently upgrading shared executables; reset-all is not preservation evidence. |
| B10 | No directory, Inventory, State or ThreadSetup grants leak to caller. |
| B11 | Application receives only explicitly transferred required Data/C-list authority; known names are not grants. |
| B12 | Application returns through shared startup to Boot/SYSTEM via ordinary CHANGE with saved Z=0; no implicit Thread release/reuse. |

Also exercise explicit directory count bounds (no NULL-sentinel scan), Inventory/
State separation, ThreadSetup's matching slot/generation and private S grant,
actual footprint/alignment, zeroed issued Data and available→issued→quarantined
lifecycle as B1/B2/B5/B6/B9/B10 subcases. Ten-Block scaling, smaller Threads,
concurrent allocation and automatic recycling are not approved first experiments.

## Later SD storage tests

Source: [SD abstraction verification](sd-storage-abstraction.md). G8 applies;
raw SD reads never authorize overwriting protected Thread context.

| ID | Test and required result |
|---|---|
| S1 | Establish exact board/controller/card support and named binding; Info reports presence, capacity, block size, write protection/status accurately. |
| S2 | ReadBlocks/WriteBlocks round-trip known patterns through authorized Data buffers, including first/last blocks and agreed transfer limits. |
| S3 | Reject out-of-card/buffer bounds and insufficient/wrong buffer authority without unintended I/O or memory writes. |
| S4 | Missing/removed/unavailable card, write protection and controller failures report explicitly; never simulated success. |
| S5 | Sync waits for outstanding writes and reports failure under its stated guarantee; completion is not assumed power-loss recovery. |
| S6 | Multiple ide.SD# bindings sharing code remain device/state isolated; measure actual latency/throughput without claiming extra resident RAM. |
| S7 | Higher-level saved-state service detects corrupt/incomplete/stale storage before restore; enforce current authority and interrupted-update contract, with no raw-device Thread activation. |

## Later transaction/backing-store tests

Source: [transaction Thread model](../phase-1/transaction-thread-model.md);
these supplement F.22, not a new Thread format. G5/G8 apply where backing is used.

| ID | Test and required result |
|---|---|
| Q1 | Multiple transaction Threads share executable code while retaining independent data, contexts and capabilities. |
| Q2 | First initialization uses template; resumption restores actual saved context, never reinitializes a suspended transaction. |
| Q3 | Stored transaction population can exceed resident working set only within Namespace/storage/resource bounds; measure, do not infer from SD capacity. |
| Q4 | Completion, suspension, retirement, destruction, revocation and quarantine remain distinct; stale saved grants cannot become valid through restoration or implicit recycling. |

## Later networking campaign — preserve existing N IDs

Source: [W7 Phase 2 campaign](../phase-1/W7-phase-1-and-2-test-plan.md#7-phase-2-adversarial-campaign).
All cases require G9 and approved test topology. Begin with two Namespaces on one
FPGA; this is not evidence of isolation between separate physical machines.
Run valid controls alongside rejection cases and affected Phase 1 regressions
under network contention. No blanket “all networking passed” claim.

| ID | Required test |
|---|---|
| N01 | Wrong peer/Namespace/object/method and malformed message: authenticated destination/authority binding, no foreign effect. |
| N02 | Duplicate/delayed/reordered/truncated/replayed messages: approved idempotency/correlation, no duplicate privileged effect; no assumed exactly-once transport. |
| N03 | Revoke/destroy/reuse while queued/in-flight: defined authorization point and stale-reference handling. |
| N04 | Reset/restart/reconnect/partition/timeout: no authority resurrection, invented rollback or weakened checks; approved bounded failure. |
| N05 | Delegation/excess rights/cross-Namespace deputy: wrong principal denied, authorized control succeeds under approved attenuation. |
| N06 | Flooding/queue-memory exhaustion/slow peer: fixed quotas/backpressure and stated progress/time bounds. |
| N07 | Persistent state/concurrent requests/interruption: approved commit/exclusion, no partial authority publication or resurrection of consumed/revoked state. |
| N08 | Exfiltration/attribution/evidence loss: enumerate outward channels and authenticated correlation, with explicit covert-channel exclusions. |
| N09 | Remote admin/debug/install/local raw bypass: same route/grant discipline as Phase 1; remote authentication does not excuse bypass. |

## Documentation and release evidence checks

| ID | Required test |
|---|---|
| D1 | Current Markdown/text exports and HTML visible text/embedded download exactly match lifecycle source; old exports visibly marked superseded. |
| D2 | Phase 2 index, adjacent objectives and networking plan link to this inventory and current lifecycle; all F.1–F.38 present with no lost/duplicate IDs or stale current CR13/delivery-entry claims. |
| D3 | Every result records exact source/generated RTL/BIT/boot-image/LUMP identities, board identity, configuration, transport session/fixture and trace evidence; distinguish fixture, RTL simulation and physical proof. No secrets in evidence. |

For each executed case record: ID/subcase, approved oracle, gate closures,
expected/observed result, pass/fail/blocked, evidence paths, timestamp and exact
build/artifact identities. Capture CR12, unchanged CR13, saved CALL/NIA/registers/
flags, software pending/ready transitions, request correlation and watchdog
completion/expiry timing as relevant. Upload ACK or a passing build is not proof
of runtime behavior. Hardware-first acceptance does not require a separate
simulator implementation; exact-byte RTL checks are supporting evidence only.

## Inventory totals and remaining decisions

**89 checklist cases:** 38 F + 8 A + 8 T + 12 B + 7 S + 4 Q + 9 N + 3 D.
These are scenario groups, not a fixed count of parameterized runs. Boundary
values, positive/negative controls and fault timing expand them into subcases.

No new FPGA entry/exit/blocked-bit/watchdog decision is hidden in these gates.
Before a full physical acceptance claim, settle applicable G1–G9 contracts
and implement their approved mechanisms. Retirement, storage, Block expansion
and networking remain later objectives, not prerequisites added to the first
lazy-load proof. This document approves no new mechanism or hardware operation.
