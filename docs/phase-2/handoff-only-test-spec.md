# First protected Lazy-CALL handoff — test specification

Date: 2026-11-09  
Status: proposed test specification; no tests, implementation, vendor build or
physical operations authorized by this document.

Subsequent user approval authorized the six local RTL cases. They were
implemented and run; see [bounded results](handoff-only-rtl-results.md).
Vendor build and physical operations remain outside approval.

## 1. Question and execution level

Can the current development **RTL**, starting from an admitted guarded boot
fixture, save a USER at its unavailable CALL and restore the saved SYSTEM
continuation with the required event data?

The proposed execution is **Amaranth RTL simulation**, not the browser simulator
and not an FPGA. It qualifies this transition only, not full ISA conformance,
delivery, watchdog integration or an installable bitstream.

Use the existing guarded-core fixture in
`hardware/test_phase2_guarded_llr.py`, derived from
`hardware/test_phase2_llr.py`. Do not invent a second hardware model.
The existing positive test proceeds into memory-patched retry; a handoff-only
test must stop before that portion. Running the existing full test unchanged
must not be described as a handoff-only run.

## 2. Exact proposed starting fixture

Reuse the existing guarded fixture values below. These are disposable test
allocations, not proposed assignments in a live Namespace.

| Item | Value |
|---|---|
| Guard | `(46 << 9) | 419` |
| Namespace descriptor version | 46 |
| Slot 2 SYSTEM Thread | GT `0x03A30002`, version 419, body byte address `0x1000` |
| Slot 3 SYSTEM executable | E-GT `0x4A490003`, version 73, body `0x2000` |
| Slot 4 USER Thread | GT `0x02070004`, version 7, body `0x3000` |
| Slot 5 USER executable | body `0x4000` |
| Slot 6 absent target | valid Inform capability and authenticated descriptor, body/header `0x5000`, header `0xF8000001`, `cw=0` |
| USER CALL | byte address `0x4008`, literal word `0x17100001`, CALL through CR2, method 1 |
| Saved SYSTEM continuation | byte address `0x2010`, established by actual SYSTEM CHANGE at `0x200C` |

Guarded descriptor W0 values are word-addressed; the table above describes
body byte addresses. Preserve the fixture's explicit conversion, limits,
integrity words, root frame and C-lists. No debug register injection or forced
execution address is permitted.

The four Namespace metadata words in this fixture are
`[0xF8810100, 0, 5, 0]`. Compare all four exactly, including zeros.
This fixture does **not** replace the later F.23 distinct-nonzero-metadata
qualification; that remains separate coverage.

Before an approved run, record hashes of the exact source dependencies and
initial fixture words, plus tool versions. Do not infer exact source identity
from a branch name or the board's reused build number.

## 3. Sequence and stop point

1. Instantiate `ChurchCore(expected_boot_guard=GUARD)` and private fixture memory.
2. Exercise boot admission and the reset-ROM marker through the existing harness.
   Supply the existing reset words `0x27000001` and `0x17000001` at their
   addressed boundaries. This is core-level reset stimulation, not a complete
   Wukong top/ROM/UART test.
3. Execute SYSTEM's actual flag-setting instruction at `0x2008`, then its
   ordinary CHANGE to USER at `0x200C`.
4. Capture USER registers, flags, target capability, frame state and original
   CALL location. Capture SYSTEM's saved flags and continuation.
5. Issue the exact CALL word from `0x4008`. After instruction acceptance,
   invalidate/poison the fetch bus as the existing test does.
6. Observe completed transfer to SYSTEM at `0x2010`; check the assertions below.
   Stop **before executing the instruction at that continuation**.

No target-body insertion, delivery, USER restoration or retry occurs in this
test. Retain `defer_fault_reset` solely as the existing observation control so
the first fault is inspected before recovery; do not claim fault-recovery
qualification from this setup.

## 4. Passing assertions

- USER's saved continuation names the original unexecuted CALL.
- USER's original DRs, flags and protected capability/frame state are preserved
  according to the Thread save contract; retained target authority is unchanged.
- The absent target remains absent. No callee code or CALL return frame is
  published as though the CALL had succeeded.
- CALL does not retire. Assert using accepted instruction identity, committed
  addresses and retirement events, not `retire_instr` alone: that field has a
  documented inactive-fetch-bus limitation under this stimulus.
- Active CR12 is SYSTEM GT `0x03A30002`; CR13 is unchanged.
- DR0 is zero.
- DR1–DR4 equal the four original Namespace metadata words.
- DR5 equals 6; DR6 equals the full unchanged USER GT `0x02070004`.
- Z is set; SYSTEM's restored N/C/V are unchanged.
- SYSTEM's NIA is `0x2010`, not startup and not USER's next instruction.
- USER save precedes SYSTEM restoration/event publication; no SYSTEM
  instruction executes before handoff completion.
- The boot-only marker remains consumed; handoff does not reopen boot authority.

Existing fixture assertions cover much of this. The later implementation must
explicitly add any missing capability/frame and ordering observations rather
than claiming existing tests already prove every bullet.

## 5. Five existing negative controls to reuse

Run each on a fresh private fixture, with only its named perturbation.

| Control | Expected result in the current fixture |
|---|---|
| Stale SYSTEM descriptor version | Fault `0x1D`; no completed handoff |
| Corrupted saved SYSTEM frame | Fault `0x1D`; no completed handoff |
| Stale USER ownership version | Fault `0x1D`; no completed handoff |
| Corrupt absent-target integrity | Fault `0x0A`; no completed handoff |
| Unavailable CALL originating in SYSTEM | ABSENT_OUTFORM `0x11`; no recursive SYSTEM entry |

Retain existing assertions that these preflight failures do not publish
register/memory changes from the attempted transition. This is specific to
these preflight cases, not a promise to roll back arbitrary machine faults.
Check expected codes against the approved contract before changing a test
expectation to match observed RTL.

Wrong/stale retained target GT **at later resume** is not tested here because
there is no resume. It remains mandatory for the end-to-end test.

## 6. Bounded observation and evidence

Reuse the existing maximum of 3,000 simulated clock ticks per admission or
issued-instruction wait. This is an observer bound, not a machine watchdog,
USER wait timeout, or board-time guarantee. On exhaustion, stop and report the
last accepted instruction, state and outstanding memory operation.

Use the fixture's existing memory responder and record writes. Preserve the
separate existing stalled-memory/input-latching tests as prior supporting
evidence; do not claim this six-case set reruns them.

Report each of the six cases separately with source/fixture hashes, command,
tool versions, outcome, observed registers/flags, saved USER frame and write/
retirement evidence. A failure stops further expansion; never patch memory
or expectations to make a failing case pass.

## 7. Hardware dependency boundary

Inspection compared current files with the frozen Amoeba retry source snapshot
associated with BIT `a4acb0ef…`. Required functional areas are:

| Area | Relevant files | Required role |
|---|---|---|
| CALL admission | `hardware/call.py` | Private callee validation; absence before architectural callee publication |
| Core routing | `hardware/core.py` | Route absence into protected CHANGE; preserve non-retirement and commit ordering |
| CHANGE interface | `hardware/change.py` | Carry internal LLR entry and target signals |
| Protected transition | `hardware/ordinary_change.py` | Owner/SYSTEM admission, metadata capture, save/restore, event injection and final commit |
| Existing validation | `hardware/mload.py`, `hardware/integrity32.py` | Retain authority/integrity validation; both currently match their frozen counterparts byte-for-byte |

**This is a functional dependency list, not a build-ready patch set.**
Current core and ordinary CHANGE diffs also contain fault-entry changes;
`hw_types.py` differs as well. Copying whole files would silently import
additional behavior. A minimal backport's dependency closure has not been
established and is not authorized here.

The proposed local check tests the current development RTL as a whole, with
exact inputs recorded. It cannot certify a future selective backport; that
candidate would require its own replay. No new vendor build is justified by
passing this local test alone.

## 8. Watchdog and physical-operation gate

The execution-watchdog unit is not integrated into the current core. This
handoff-only RTL check therefore cannot prove deadline renewal, expiry/write
containment or full Phase 2 compliance. Do not add a timer, disable a protection
or invent an exemption as part of this test.

Before proposing physical execution, explicitly resolve the candidate's
watchdog integration/safety scope, exact top/ROM/profile, source dependency
closure and observation method. Build, installation verification and board
commands are separate approvals. Preserve the known two-board baseline.

Other-USER progress during delivery wait, all-USER wait, SYSTEM self-CHANGE,
actual delivery/install and retained-GT retry controls belong to end-to-end
acceptance. They are not waived by a handoff-only pass.

## 9. Next review decision

Approve only adding the bounded handoff endpoint/assertions to the existing RTL
test facilities and running this six-case local set, or revise this specification.
No browser simulator, saved LUMP changes, SYSTEM service implementation, vendor
build, reset, upload or flash is included.

References:
- [Baseline and minimum-change assessment](hardware-first-baseline-review.md)
- [Recorded local LLR evidence](local-llr-entry-results.md)
- [Watchdog unit limits](watchdog-local-unit-status.md)
- [Required acceptance checklist](test-checklist.md)
