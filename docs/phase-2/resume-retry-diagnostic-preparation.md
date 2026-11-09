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

The following sections record local candidate acceptance only. No vendor build
or physical resume/retry result is claimed.

## Successful retry and terminal snapshot: locally passed

An isolated copy at `generated-artifacts/resume-retry-candidate` preserves the
original handoff source/package. Its only top-level RTL change is an opt-in
stop after the synthetic callee's RETURN at 0x500C. The change is retained in
`resume-retry-top.patch`; CALL/CHANGE/RETURN implementations are unchanged.

The fixture gives SYSTEM CR3 a W-only Inform capability for slot 6 and
preloads DR7 with the published header. Ordinary DWRITE at 0x2010 writes
0xF8001001 to 0x5000; CHANGE at 0x2014 resumes USER. No testbench inserts bytes
or modifies runtime memory. The body was prepositioned, not loaded.

Both successful-retry tests decode a CRC-valid snapshot with reason 3,
NIA 0x400C, USER CR12 GT 0x02070004, and DR12 result 13. They verify one
handoff, exactly one target-header write, exact retirement sequence including
boot, no caller-continuation retirement, and no fetch or writes during the
100-cycle post-snapshot observation.

Combined validation: **18 passed in 142.49 seconds**, covering the 12 guarded
core cases, two original handoff-top cases, two still-absent controls and two
successful-retry cases. Six pytest warnings concern JUnit property formatting,
not execution failures.

Evidence: `generated-artifacts/resume-retry-results.xml`.
Image: `generated-artifacts/resume-retry-fixture.bin` (65536 bytes), SHA-256:
`fe6e7cc5fe8d1ae99d840e77b762176a18b5d1d5888159576edb19d9abd19dc9`.
Local hashes: `generated-artifacts/resume-retry-local-hashes.json`.

This candidate still needs production-top export, exact-image admission,
package/provenance checks and separate vendor-build authorization. No BIT
exists for this new candidate. Watchdog containment remains absent.

## Local still-absent control: passed

Both full-top cases passed at simulated UART rates 125000 and 62500 baud
with a 1 MHz simulation clock (2 passed in 19.49 seconds). These rates exercise
different UART drain delays; they do not qualify physical timing.

The initially reported NIA mismatch was an incorrect test expectation and
an incorrect description of which handoff had failed. Cycle-level observation
established that the mismatch occurred on the SECOND handoff:

- SYSTEM CHANGE at 0x200C saves continuation 0x2010.
- First unavailable CALL enters SYSTEM at 0x2010.
- SYSTEM CHANGE at 0x2010 resumes USER and saves continuation 0x2014.
- Retrying the still-absent CALL enters SYSTEM at 0x2014.

The revised test checks those exact addresses separately, one retirement per
ordinary CHANGE, restoration of all 16 USER DRs plus flags and CR12 GT before
retry, the seven handoff arguments, and no unavailable-CALL or target-body
retirement. It neither modifies memory during execution nor changes RTL.

This is a local full-top resume/reattempt control, not successful target-body
execution. The test ends at the second completed handoff; a terminal diagnostic
stop and physical snapshot for this second boundary are not implemented here.
No new vendor package or build is ready. The earlier stop-enabled physical
result is unaffected.

Reproduction (run from the isolated source directory to prevent the main
project hardware package shadowing the candidate):

```sh
cd generated-artifacts/handoff-candidate/source
PYTHONPATH="$PWD:/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages" \
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest \
  /home/runner/workspace/docs/phase-2/test_resume_retry_preparation.py \
  -q -p no:cacheprovider --confcutdir=/home/runner/workspace/docs/phase-2
```
