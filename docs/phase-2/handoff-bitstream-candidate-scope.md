# Handoff bitstream candidate — bounded scope review

Date: 2026-11-09  
Status: scope proposal only. No backport, RTL run, vendor build or board
operation was performed during this review.

## Recommendation

Use the preserved Amoeba retry build as the starting point and selectively
backport the protected unavailable-CALL transition. Do not regenerate from
the whole current hardware tree.

The eventual deliverable is a quarantined experimental `.bit`, exact source/
image manifest, build receipt, timing results and instructions for the one
approved experiment. It is not a full ISA/Lazy Load release. Persistent `.mcs`
programming and changes to either working board are outside this proposal.

There are two unresolved physical-test conditions: an exact handoff stop and
explicit treatment of the baseline's missing execution watchdog. Therefore
the scope is not yet an approved build-ready patch set.

## 1. Frozen starting point

- BIT: `a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e`.
- Source/package: `generated-artifacts/amoeba-retry-vendor-build/`.
- Manifest: `5ab35bf4d2060ca4fad7b36d4a1cd5f8f4498f960a8d717f56580e0c54a1604b`.
- Preserve the board/clock/constraints/vendor flow from that package unless an
  explicit dependency requires a reviewed change.
- Preserve existing runtime fault-hold behavior. Do not import newer automatic
  fault-entry/recovery machinery merely because it shares edited files.

The old embedded workload does not constitute the new test fixture. A new,
separately hashed private image must contain the guarded SYSTEM/USER/absent-target
setup. It must pass the actual candidate top/ROM admission path; supplying two
reset words in a core-only test is not sufficient top-level qualification.

## 2. Selective RTL change map

| File in frozen snapshot | Required change | Boundary |
|---|---|---|
| `hardware/call.py` | Accept private mLoad result; latch callee descriptors privately; leave caller CR6/CR14 intact on absent body | Preserve ordinary resident CALL semantics and frame construction |
| `hardware/change.py` | Add pinned SYSTEM GT configuration and internal `llr_entry`/`llr_target` ports | Do not add fault-entry ports or observation aliases solely to copy today's file |
| `hardware/ordinary_change.py` | Validate active USER identity; reject SYSTEM absence recursion; admit pinned SYSTEM; capture metadata; save USER; restore SYSTEM; inject DR1–DR6; commit NIA/flags last | Reuse ordinary save/restore and validators; exclude unrelated fault-pair activation |
| `hardware/core.py` | Route CALL absence into protected CHANGE; pass private mLoad result; suppress legacy Lazy IRQ and CALL retirement during handoff; pin SYSTEM generation from the profile | Exclude execution-monitor MMIO, new fault recovery, LED changes and unrelated external-switch changes |

Current `mload.py` and `integrity32.py` match the frozen copies; a rewrite of
those modules is not indicated. Existing shared mLoad validation-only output
can be wired to CALL. No new opcode, GT format or hardware version increment
is proposed.

Preserve the existing decoded-CHANGE in-flight bookkeeping as an independent
conditional chain while adding LLR bookkeeping. The current diff interleaves
their reset/completion branches; copying that hunk mechanically is unsafe.
Regression checks must include ordinary CHANGE completion, not only LLR.
This review does not claim a freshly reproduced defect or authorize changing
the main development core.

The exact transitive dependency closure must be verified on the isolated
backport. Four core files are the identified functional change surface, not
a guarantee that an installable candidate changes exactly four files.

## 3. Physical observation is an additional dependency

In the frozen `hardware/wukong_top.py`, breakpoint matching, normal Step stop
and stop-snapshot scheduling depend on `core.retire_valid`. The protected
unavailable CALL intentionally produces no retirement. Consequently a normal
Step can continue into SYSTEM instead of stopping at its entry.

Do not claim that existing Step or a breakpoint on SYSTEM's entry reproduces
the core-test boundary. Do not fake CALL retirement or execute a deliberate
fault/extra SYSTEM instruction and describe its resulting snapshot as the
pre-instruction state.

Proposed candidate-only solution for review:

- Expose a truthful pulse for successful **completed internal LLR**, after
  state save/restore and event injection, not absence detection.
- In an explicitly diagnostic candidate configuration, use it to stop further
  instruction acceptance and schedule the existing stopped-state snapshot.
- Keep CALL unretired and no SYSTEM instruction accepted before the stop.
- Preserve existing snapshot framing where feasible; do not relabel the stop
  as a retired CALL or report an existing breakpoint unless that actually fired.
- Replay this at the actual top/fetch boundary, including UART backpressure,
  before claiming the added stop is effective.

This is a proposed instrumentation change, not an implemented safety guarantee
or a new ISA behavior. If existing safe controls can establish the same boundary
without it, prefer that verified mechanism. No host polling race is acceptable.

## 4. Watchdog decision — no hidden compliance claim

The frozen baseline lacks integrated execution-watchdog enforcement. The
current watchdog unit does not by itself solve core write containment,
capability-mediated control or completion renewal.

Two distinct scopes must not be conflated:

1. **Diagnostic handoff candidate:** retain the baseline watchdog limitation,
   add only the bounded observation mechanism, and make no execution-watchdog
   or Phase 2 acceptance claim. This requires explicit approval of that
   limitation before building a physical-test candidate. A successful stop
   is not a watchdog; a defective/hung transition may never reach it.
2. **Watchdog-compliant candidate:** integrate the approved watchdog access,
   renewal and expiry/write-containment design first. This is additional
   implementation scope, not a small wire-up hidden in the handoff patch.

For minimal incremental risk/cost, recommend first creating and locally
validating the isolated backport and stop mechanism. No physical operation
is needed to learn whether that patch remains bounded. Do not add a request
timeout, exempt SYSTEM or claim Debug mode supplies a missing watchdog.
Preserve the working boards until the physical-test scope is explicitly chosen.

## 5. Validation and stop gates

Before a vendor build is proposed:

1. Freeze the isolated patch, selected profile, test image and dependencies.
2. Rerun the six handoff cases against **that backport**, not the main checkout.
3. Check ordinary resident CALL/RETURN and CHANGE, including in-flight reset/
   completion behavior; compare failures with the frozen baseline rather than
   broadening into legacy cleanup.
4. Verify actual top/ROM boot and handoff-stop/snapshot ordering. No supplied
   SYSTEM instruction, false retirement or post-handoff USER resume.
5. Reconcile watchdog scope explicitly and review exact changes.

Stop if the backport requires broad execution-model replacement, unrelated
recovery machinery or unbounded debugging. Report the first failed gate rather
than silently importing the current tree.

Only after approval of those results should the retained vendor build flow
produce an experimental BIT. Require exact provenance and passing timing;
then review before separate temporary board-programming authorization.

## 6. Deliberately excluded

No simulator alignment; new scheduler framework; SYSTEM request service;
DELIVER/install/resume; retirement or storage work; whole-ISA certification;
live Namespace editing; automatic source/LUMP adoption; flash programming.

The final hardware Lazy-CALL milestone still requires other-USER progress,
stale retained-GT controls, real validated delivery and applicable watchdog
behavior. A diagnostic handoff candidate cannot close those requirements.

References:
- [Verified handoff-only RTL results](handoff-only-rtl-results.md)
- [Handoff test specification](handoff-only-test-spec.md)
- [Baseline assessment](hardware-first-baseline-review.md)
- [Watchdog unit/integration boundary](watchdog-local-unit-status.md)
