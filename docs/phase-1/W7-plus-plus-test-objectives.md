# Phase 1 test objective — W7++

**Status:** User-designated test objective; not a passed security assessment.

The [supplied test workbook](CTMM_W7_Threat_Test_Plan.xlsx) is preserved
unchanged as the W7++ objective input. It contains three sheets: Threat Map,
Summary, and Method. At receipt, all 15 objectives are marked **Not run**,
with no recorded W7 baseline or CTMM execution results.

The workbook's “Ratified,” “Proven,” and closure-category labels are supplied
claims or intended evidence levels, not verified findings from this review.
They do not supersede the [Master ISA](01-isa/instruction-set.md) or establish
hardware readiness.

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

## Evidence and pass criteria

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
