# Phase 1 test objective — W7++

**Status:** User-designated test objective; not a passed security assessment.

The [supplied test workbook](CTMM_W7_Threat_Test_Plan.xlsx) retains its original
Threat Map, Summary and Method sheets unchanged as the W7++ objective input.
Added Completeness, Progress and Tracking guide sheets track broader Phase 1
delivery, IDE gaps, missing functions, seal storage, simulator/ISA compatibility
and exact-build evidence. The new Progress sheet is separate from the original
15-threat Summary; its completion rate is unweighted row closure, not a security
proof percentage. At receipt, all 15 original objectives are marked **Not run**,
with no recorded W7 baseline or CTMM execution results.

The workbook's “Ratified,” “Proven,” and closure-category labels are supplied
claims or intended evidence levels, not verified findings from this review.
They do not supersede the [Master ISA](01-isa/instruction-set.md) or establish
hardware readiness.

## Revised Phase 1 and Phase 2 qualification plan

Use the [revised test plan](W7-phase-1-and-2-test-plan.md) for the
complete-mediation route inventory, co-equal grant audit, fixed claim
classifications, check-to-use cases, installed-byte evidence and phase exit gates.
It incorporates the owner's 29 October methodology review without changing
historical test results or approving unresolved mechanisms.

## Objectives to reconcile and test

| Workbook ID | Objective | Required qualification |
|---|---|---|
| 1 | Revocation of copied GTs | Identify the authorized revocation operation; test stale copies, generation reuse/wrap, and the stated cost bound. |
| 2 | Forged references and invalid accesses | Separate malformed/unauthorized references from legitimately held GT copies; define type, permission, identity and range oracles. |
| 3 | Production debug-authority exclusion | Verify the actual production root and all relevant authority sources; static C-list closure alone needs justified assumptions about dynamic grants and loading. |
| 4 | No unintended authority at object creation | Reconcile the proposed creation mechanism with implemented contracts; enumerate granted and derived authority. |
| 5 | Sealing and Namespace boundaries | Check the alleged type conflict against current specifications before selecting an oracle or asserting a defect. |
| 6 | Resource exhaustion isolation | Define enforceable resource and latency bounds; do not assume tracing GC or eviction is available in Phase 1. |
| 7 | Persistence preserves authority | Separate authorized resident artifact round trips from eviction/reload scenarios outside the current resident profile. |
| 8 | Bounded interruption/termination | Evaluate existing watchdog/fault behavior; a hard fault is not automatically a bounded return to the caller. Specify the promised outcome. |
| 9 | Continuation reuse | Distinguish ordinary return-frame consumption from retained checkpoint restoration; apply the Amobea one-shot, copy and reset-lifetime requirements. |
| 10 | Shared-state concurrency | Define permitted concurrency, synchronization and memory semantics before requiring all races to serialize or fault. |
| 11 | Accountability | Define which identity is attributed, what evidence records it, and what call-chain transformations are permitted. |
| 12 | Input leakage | Bound claims to explicitly analyzed channels and reachable authority; retain covert/timing-channel limitations. |
| 13 | Undecidability limits | Record as a limitation, not a test that can prove arbitrary programs safe. |
| 14 | Manufacturing/administrator trust | Record trusted components and provenance assumptions; testing does not eliminate the trust boundary. |
| 15 | Distribution/remote invocation | Preserve the workbook's explicit out-of-scope disposition. |

## Phase 1 boundary

- Phase 1 uses the all-resident Namespace profile. Workbook references to
  eviction do not authorize Lazy placement or a new memory-management design.
- Two-namespace networking scenarios remain Phase 2 work. Classify any
  cross-Namespace workbook tests against their actual dependencies rather than
  silently expanding Phase 1 hardware scope.
- The proposed running bit and checkpoint rollback remain gated by their
  outstanding contracts and implementation evidence in
  [Amobea V1](Amobea-V1.md).
- Tuple-storage tests remain a distinct, independently useful Phase 1 activity.
- This objective does not authorize builds, flashing, saved-artifact migration,
  or changes to the ISA.

## Additional CM-specific objectives

These supplement, rather than alter or renumber, the supplied workbook.
All are **Not run in this review**. An existing focused demonstration is not
a pass for the complete objective. See the
[CM comparison](CM-W7-explainer.md#7-what-cm-adds-to-the-comparison) for rationale.

| ID | Distinction to demonstrate | Acceptance objective |
|---|---|---|
| CM-A | Defined shared tuples per Thread | Multiple authorized methods read/update one defined record across calls and returns; other records are unchanged; another Thread gains no implicit access; stale allocation references are rejected. |
| CM-B | Protected continuation versus heap data | Authorized heap operations cannot modify protected frames or ownership metadata; a defined self-capture preserves execution ownership and records the specified continuation without CHANGE. Callable capture remains gated on its contract. |
| CM-C | Retained checkpoints and rollback | Verify one-shot restore, copied checkpoint identity, reset invalidation/retention, and fail-closed interruption. Restore only the declared data scope and never historical ownership/consumption metadata. Gated on checkpoint implementation. |
| CM-D | Capability-controlled MMIO | Test authorized device access, absent/insufficient authority, invalid bounds and malformed register writes. Rejected operations produce no unauthorized device effect; heap rollback does not replay MMIO. Separate emulator evidence from physical-device evidence. |
| CM-E | Thread execution ownership | Test distinct-target exclusion, continuous self-target ownership, pause/step preservation, and all indicator writers. Verify saved NIA cannot supply ownership. Gated on running-bit approval and implementation. |
| CM-F | Hardware watchdog containment | With exemption explicitly disabled, test documented elapsed-time expiry during loops/deep calls and accepted-write completion before protected capture. Test exemption authority separately; do not substitute a caller-return oracle for the specified hard fault. |
| CM-G | IDE/runtime tuple agreement | Round-trip JSON through the same tuple layout used by callable methods; preserve omitted fields; reject stale confirmations and invalid edits without partial writes or protected-state changes. |
| CM-H | Exact artifact/build attribution | Attach the actual LUMP/configuration and implementation identities to results; hardware claims identify the tested bitstream and board. Mark differences from simulator-only coverage. |

These objectives establish positive CM properties. They do not require inventing
a failing W7 baseline or asserting that W7/S48 cannot implement similar
facilities. A claim of superiority requires a separately justified comparison.

## Wukong one-second instruction-throughput tests

**Status: planned / NOT RUN.** These performance examples supplement the
security objectives; they do not change the supplied workbook or constitute
minimum-performance acceptance thresholds.

“Unrestrained” means continuous execution without IDE stepping, UART trace
backpressure or external I/O waits. Capability, permission, bounds, fault and
watchdog enforcement remain intact. All benchmark code/data must use the
approved all-resident configuration.

### Estimates to test

At the source-default **50 MHz** clock:

```text
instructions per second = 50,000,000 / average cycles per retired instruction
```

| ID | Workload example | Planning assumption | Estimated instructions in one second |
|---|---|---|---|
| PERF-1 | Register arithmetic and branches, e.g. IADD/ISUB plus loop control | Approximately 2 cycles/instruction | 25 million |
| PERF-2 | Authorized local DREAD/DWRITE loops, with readback verification | Approximately 4–5 cycles/instruction | 10–12.5 million |
| PERF-3 | Fixed, declared mix of arithmetic, memory and capability/control instructions | Assumed average 10 cycles/instruction | 5 million |
| PERF-4 | Capability/control-heavy workload, including legal CALL/RETURN and CHANGE/SWITCH paths | Illustrative average 25–50 cycles/instruction, not a timing claim for each opcode | 1–2 million |
| PERF-5 | Trace-limited execution with one 12-byte packet per retired instruction | 57,600 baud, 8N1, 120 serial bits/instruction | Approximately 480 maximum |
| PERF-6 | Trace-limited execution with three 12-byte packets per retired instruction | 57,600 baud, 8N1, 360 serial bits/instruction | Approximately 160 maximum |

The **5 million/second** figure is a provisional mixed-workload planning
estimate, not a measured Phase 1 result. PERF-1/2 are source-based timing
estimates; PERF-3/4 are explicit cycle-budget assumptions. Branch overhead,
capability validation, context size and instruction mix must be measured,
not hidden in a claimed universal rate. PERF-5/6 are approximate serial
capacity ceilings before arbitration gaps, snapshots and other UART traffic.

Source basis in the main repository (outside this self-contained collection):
`hardware/wukong_top.py` supplies the default clock/baud, instruction-fetch
settling and trace-stall wiring; `hardware/core.py` supplies busy/retirement
logic; `hardware/dread.py` and `hardware/dwrite.py` supply memory-operation
states. These references describe inspected source, not the installed
bitstream. Confirm their configuration against the exact tested build.

### Measurement procedure and acceptance evidence

1. **Identify the target.** Record board, exact bitstream/build identity,
   actual clock, implementation revision, LUMP hashes, Namespace layout,
   watchdog configuration, trace mode and UART baud. Freeze the instruction
   mix and loop body before measurement. Separate simulator, component RTL,
   integrated RTL and physical-board results.
2. **Establish correct execution first.** Verify final arithmetic/checksum
   results, memory readbacks and expected control-flow/context outcomes.
   PERF-4 uses only approved, legal paths; unresolved semantics or absent
   provisioning mean **BLOCKED**, not an invented shortcut. Report individual
   control-operation costs as well as the aggregate workload rate.
3. **Count committed work on the board.** Use a validated, non-stalling
   cycle/retirement counter or equivalent approved instrumentation; exclude
   fault events, bootstrap and setup from successful-retirement counts.
   At confirmed 50 MHz, a measured interval is 50,000,000 cycles with explicit
   start/end boundaries. Include loop/control instructions and disclose
   condition-skipped instructions separately. Browser time, bridge arrival
   timestamps and simulator execution speed are not board throughput evidence.
4. **Keep trace modes separate.** PERF-1–4 require demonstrated absence of
   trace-induced stalls, not just Run mode or a hidden/filtered IDE trace.
   The inspected top-level stalls while sending trace packets. If no approved
   untraced profile or counter exists, mark unrestrained measurement **BLOCKED**.
   Do not silently disable trace, change the bitstream or weaken protection.
   PERF-5/6 require verified actual event counts per instruction; include
   loop overhead and report the weighted packet rate if it differs.
5. **Repeat and report.** After warm-up, collect at least five one-second
   windows; report successful retirements, elapsed cycles, average CPI,
   minimum/median/maximum rate, stalls and fault/watchdog status. If watchdog
   policy prevents a full window, report the shorter interval and any
   extrapolation explicitly; it is not a completed one-second measurement.
6. **Apply the right oracle.** A valid result requires correct architectural
   outcomes, reproducible counts and exact-build attribution. Differences
   from the estimates require explanation, not automatic pass/fail against
   an unapproved performance target. Faults or incomplete windows must not
   be presented as successful full-window samples. Preserve raw evidence
   without introducing per-instruction UART backpressure into untraced runs.

This addition authorizes test-plan documentation only: no counter/trace RTL
changes, vendor builds, flashing, live Namespace changes or hardware execution
are performed or authorized by these examples.

## Evidence and pass criteria

The [Amobea Transaction objectives](Amobea-V1.md#64-transaction-abstraction--phase-1-demonstration-objective)
provide five human-task demonstrations (TX-1–TX-5) for shared tuples,
capability boundaries, Dijkstra messaging, IDE diagnostics, and the separately
gated checkpoint/rollback contract. All are not run as defined; they supplement,
not replace, the workbook and CM-A–CM-H objectives.

For each executable objective, record:

1. The current contract and invariant, implementation revision, and test inputs.
2. The precise oracle: fault and instruction, permitted state change, graph
   property, or measured latency bound, as appropriate.
3. Coverage and exclusions, including adversarial variations and reset/failure
   boundaries.
4. Actual results and reproducible evidence. Hardware claims require the
   corresponding hardware/build identity; simulator results are not FPGA proof.

The workbook's universal “baseline succeeds AND CTMM faults” criterion is not
sufficient for every row: graph checks, resource bounds and stated limitations
need different dispositions. Keep **not run**, **blocked**, **passed for the
defined coverage**, **failed**, and **out of scope** distinct.

A CM acceptance result does not require an unverified claim that W7 is
vulnerable. A comparative W7 claim additionally requires a primary-source
check and a reproducible baseline under stated conditions. The workbook cites
Rees's MIT AI Memo 1564; its section mappings have not been independently
verified here.

See the [qualified W7-oriented explainer](CM-W7-explainer.md) for the distinction
between checkpoint reuse, execution ownership, authority, and external effects.
