# Local core integration — incomplete, paused for review

Scope remains isolated code and local tests. No vendor synthesis, board
access, installed-image change, saved LUMP modification or live Namespace
replacement was performed.

## Work implemented, not fully qualified

- Explicit 128 KiB capacity options in the core's initial Namespace/Thread
  admission, ordinary CHANGE, trusted Boot binding, fault entry and direct
  stash geometry. Historical 64 KiB defaults remain.
- Opt-in request-local physical memory rejection and BOUNDS reporting, with
  only a rejection-status bit retained while the existing issuer state is
  frozen. No intermediate copy of the instruction/GT/event payload is added.
- Candidate core bridge and CSI3/core composition, with real banked memory,
  reset-ROM provenance, explicit write grants and trusted foundational-word
  validation after hashing actual received RAM.
- New disposable high-bank Boot/Thread fixtures and tests. Historical fixtures
  and saved images were not changed.

These are implementation changes, not evidence that the composed candidate
works. The stage must not be used for a vendor build or physical test.

## Observed execution and blocker

The real maintained core reached the expected application INVALID_OP at
`0x4008` after guarded boot and a normal USER CHANGE through the new memory
fabric. The first recovery attempts did not complete Boot entry.

Investigation corrected a remaining direct-stash 64 KiB guard, checked
acceptance assertions at clock edges instead of delta transitions, and gave
the new disposable image the proper 128 KiB capacity header.
An artificial extra pending-write cycle was removed: this synchronous fabric
commits a granted write at its clock edge, so the following verification cycle
must not be treated as an outstanding write.

The latest integrated test stalls in the simulator's signal-settling loop.
A wall-clock diagnostic ended with timeout status 124; the captured stack
was in Amaranth `pysim.step_design`. This suggests unresolved combinational
feedback, but the exact path is not yet established. No further speculative
integration changes were made after that diagnosis.

No successful high-bank Boot continuation, invalid-access atomicity, complete
CSI3-to-core run or 100-attack acceptance is claimed. Later cases in the new
four-case test were not completed because the run stopped at its first case.

## Checks completed independently

The focused existing Boot binding and core fault-entry regressions reported:
**21 passed, 7 deselected in 31.88 seconds**.
These preserve evidence for their existing/default paths, not acceptance of
the new wrapper. The deselected full-wrapper cases were not rerun.

The independent trusted-foundational-word admission check reported:
**1 passed, 15 deselected in 72.01 seconds**. It used real 128 KiB RAM hashing,
accepted a compatible image, then rejected an altered foundational word even
though the supplied hash correctly described the altered image. A matching
transfer hash therefore cannot substitute for the configured Boot bindings.

The preceding stage's 70 passes remain historical evidence; they are not
automatically a pass for all subsequent changes. This turn established 22
passing focused checks, not a passing integrated-core stage.

## Integration limits and next review

The current bridge is RAM/fault-fixture only. Unknown MMIO and unexpected
port collisions are explicit assertions and exported conditions; there are
no fake peripheral successes. This is not a release-safe general device
decoder or a vendor-ready top. Watchdog/service integration also remains
separate and is not supplied by instantiating the maintained core alone.

The next focused action is to identify the settling cycle between memory
ownership/grants and the fault-entry engine, then review the minimal correction.
Do not restore progress by tying grants or memory safety high, bypassing
checks, skipping instructions, adding recovery retries or changing identities.
The new path remains opt-in while this blocker is unresolved.
