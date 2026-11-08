# Local RTL LLR entry evidence

Date: 2026-11-08. Scope: the approved local USER-to-SYSTEM handoff only.
No app restart, live image change, vendor build, board contact, reset, upload
or flash was performed. This is not Phase 2 hardware acceptance.

## Implemented boundary

- CALL resolves both callee capabilities privately through validate-only mLoad.
  The caller's CR6/CR14 remain intact until header/method admission. Detecting
  missing code before the stack push was not sufficient under the old early
  capability-publication behavior.
- The existing valid Inform/header `cw=0` detection starts ordinary protected
  Thread entry instead of the legacy IRQ route. It does not retire the CALL.
  Invalid authority and unauthenticated Outforms keep their existing rejection
  rules; this work does not authorize an Outform ingress bypass or new absence
  encoding.
- The transition validates the active USER identity, admits the fixed slot-2
  SYSTEM identity, captures Namespace metadata, completes destination preflight,
  saves USER at the original CALL, and restores SYSTEM's saved continuation.
- The profile fixes SYSTEM's GT: version zero in the unguarded profile; the
  already-pinned Boot Thread version in the guarded profile. Runtime lookup
  cannot adopt a replacement version from a mutable Namespace descriptor.
- After restoring SYSTEM, inject DR1–DR4 metadata, DR5 target slot and DR6 the
  complete unchanged USER GT. DR0 remains zero. Set Z without altering restored
  N/C/V. Preserve original USER data registers/flags in protected storage.
- The saved CALL does not count as a retired instruction. Normal CHANGE back
  to USER restores the CALL location; a subsequently resident target executes
  through the ordinary CALL path.
- SYSTEM-originated unavailable CALL is rejected with ABSENT_OUTFORM (0x11),
  not recursive SYSTEM entry. Invalid owner/destination context faults before
  publication. No new waiting/blocked bit, scheduler or transport protocol.

## Focused checks

`hardware/test_phase2_llr.py`: **18 passed** on the final outgoing-allocation
guard revision.

Ten real-core cases exercise successful entry/resume/retry and rejection of
bad SYSTEM frame, bad SYSTEM seal, exhausted outgoing stack and SYSTEM absence,
each with USER version zero and seven. They use actual CALL, shared mLoad and
ordinary CHANGE; missing-body fixture bytes are changed only in local simulation
to exercise the later resident CALL. This is not a DELIVER implementation.

Eight transition-unit cases cover byte-addressed and guarded word-addressed
profiles, pinned nonzero SYSTEM and USER identities, successful transfer, stale
owner, stale destination and missing active owner. Memory acknowledgements
stall; accepted target/NIA/flags are poisoned after issue. Assertions check
preservation, exact injection order, no publication on failure and no NIA
handoff before injection finishes.

Full guarded-core runtime LLR entry, transport delivery, all fault timing and
exact-build physical behavior are not claimed by the unit-level guarded tests.
Current guarded startup regressions are separate from runtime LLR qualification.

## Regression evidence

Logs and machine-readable results are retained in
`generated-artifacts/phase2-llr/`. Broad regression: **324 passed, 12 failed,
6 skipped** in 184.38 seconds. The 18 focused cases were rerun successfully
after the final LLR-only outgoing-allocation guard was added.
Direct CALL test responders now supply private resolved
descriptors rather than simulating architectural mLoad publication.

The 12 failures are two CALL-cleanup cases, five historical method-dispatch
cases and five historical stack-push cases. An isolated comparison loaded the
pre-change CALL/CHANGE/core sources and original tests from Git, without
modifying the working tree: **the same 12 cases failed**, with 60 passes.
They remain unresolved baseline failures, not new LLR regressions. Details
are in `tests.log`, `results.xml` and `prior-call-baseline.log`.

Guarded-core RTLIL conversion also passed with pinned Namespace version 46
and Boot Thread version 419. This checks elaboration/control structure only,
not vendor synthesis, clock timing or runtime guarded-core LLR behavior.

An additional historical Mint context-feasibility run reported 100 passes,
6 skips, 12 fixture errors from the unchanged JS context probe, and one timeout
in its standalone Lambda continuation slice. Those JS/Lambda failures were
not repaired or treated as LLR acceptance. The source changes here do not
alter that probe or the standalone Lambda unit.

## Remaining boundary

The execution watchdog is still outstanding. No timer, exemption, deadline
renewal or expiry behavior was supplied by this change. Transport/SYSTEM
software, broader lifecycle qualification and exact-build FPGA acceptance
remain separate work requiring their own approval.
