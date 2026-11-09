# Bounded resume/retry diagnostic preparation

## Authority and scope

The user selected preparation of a resume/retry diagnostic after the physical
handoff capture passed. This authorizes isolated preparation and local tests,
not a remote vendor build, live Namespace changes, or board programming.
The user operates the droplet and boards manually.

Keep the successful handoff package immutable. The next candidate must be a
separate source/image package. No full lazy-loader, DELIVER implementation,
watchdog integration, or production RTL migration is included.

## Existing evidence and its limit

The frozen guarded-core test already executes SYSTEM CHANGE back to USER,
checks restoration of the original USER registers and flags, and resumes at
the original CALL address, 0x4008.

Its successful CALL retry is conditional on a Python testbench inserting the
missing target header, method entry, body and c-list into modeled memory.
That is not an executable hardware loading mechanism and cannot be copied
unchanged into a physical acceptance claim.

The existing full-top tests stop at the first handoff. They do not test the
SYSTEM continuation, retry, callee execution or RETURN.

## Next isolated candidate design

Use two distinct controls:

1. **Still-absent control:** SYSTEM executes its ordinary CHANGE back to USER
   without making the target available. The original CALL is retried and
   hands off again, without retiring or executing the target. Stop at the
   second completed handoff and emit the normal CRC-protected snapshot.
   This demonstrates resume and reattempt independently of simulated arrival.
2. **Successful retry diagnostic:** use an explicitly documented synthetic
   fixture with a prepositioned target body initially marked unavailable.
   SYSTEM may mark it available only through an ordinary instruction using
   an explicitly granted fixture write capability. Then CHANGE back to USER,
   execute the original CALL once, execute the callee, RETURN, and stop at the
   caller continuation before unrelated execution.

The second control is synthetic availability publication, NOT fetching,
verification, installation, or DELIVER. Do not secretly patch BRAM, force NIA,
rewrite capabilities, or use a host/testbench mutation in its full-top run.
If the existing ISA cannot support the fixture write with explicit authority,
report the first incompatibility rather than adding a new instruction.

## Required local evidence before another build proposal

- Boot the exact candidate bytes through the existing top/ROM/BRAM path.
- Verify one retirement per ordinary CHANGE.
- Verify no retirement for each unavailable CALL attempt.
- On USER restoration, check all declared preserved DRs, flags, capability
  homes, original CALL address and Thread identity.
- For successful retry, count exactly one retired CALL at 0x4008, verify the
  callee's observable result and RETURN to 0x400C.
- Stop before the caller continuation executes; no further instruction
  acceptance or memory writes after the terminal stop.
- Decode the emitted snapshot payload as well as verifying its CRC.
  Compare flags semantically: internal Z-only packing is 0x2, wire NZCV is 0x4.
- Exercise UART backpressure, and use a bounded testbench observation limit.
  That limit is not an integrated hardware watchdog.
- Retain the existing expected-fault controls.
- Freeze exact image/source hashes and publish the candidate's own expected
  snapshots. Do not reuse the first build's receipt or image admission.

## Build decision

The currently programmed BIT deliberately blocks the first SYSTEM continuation.
Run/Step does not release that diagnostic latch. A physical resume/retry
demonstration therefore requires a separate BIT with a different diagnostic
stop boundary, even if the underlying CALL/CHANGE RTL needs no correction.

No new candidate implementation, local full-top acceptance, vendor build,
or physical resume/retry result is claimed by this preparation document.

## First local observation

The new full-top still-absent control does not yet pass. With the diagnostic
stop disabled, its first `llr_complete` observation sees NIA 0x2014 instead
of the asserted handoff boundary 0x2010. This is an observation mismatch,
not yet a diagnosed RTL defect: pipeline timing versus continuation execution
must be distinguished before changing RTL or relaxing the check.

No RTL was changed and no vendor build should be started from this result.
The earlier stop-enabled physical result is unaffected.

Reproduction (run from the isolated source directory to prevent the main
project hardware package shadowing the candidate):

```sh
cd generated-artifacts/handoff-candidate/source
PYTHONPATH="$PWD:/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages" \
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest \
  /home/runner/workspace/docs/phase-2/test_resume_retry_preparation.py \
  -q -p no:cacheprovider --confcutdir=/home/runner/workspace/docs/phase-2
```
