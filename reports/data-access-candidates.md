# ISA-correct data-access candidates — review only

The user approved compiler/simulator correction and preparation of candidates,
not publication or replacement of the saved Namespace.

## Candidate differences

Six sources were compiled through the running authenticated-compiler endpoint.
Instruction counts, method offsets and non-data-access words are unchanged.
Only retired immediate-only DREAD/DWRITE operand encodings differ:

| LUMP | Changed instruction words |
|---|---:|
| ide.Alice | 2 |
| ide.AliceDriver | 3 |
| ide.WukongCallHome | 16 |
| ide.MalloryDriver | 0 |
| ide.CapabilityTest | 0 |
| ide.AmoebaStartup | 0 |

For example, WukongCallHome's `DREAD DR8, CR2, #408` changes from
`0x87414198` to `0x87411980`. The latter selects DR0 plus magnitude 408.
These are newly compiled outputs, not patched saved artifacts.

Candidate compiler responses and the per-instruction diff are in
`generated-artifacts/data-access-candidates/`. Reproduce with
`python3 scripts/prepare_data_access_candidates.py`; this command has no
publish, save, bind, approve or activate mode.

The saved Namespace fingerprint was unchanged before and after compilation:
`49f48c9e2f55906f84d0921acb6fa5643f6e008c475610d5707ed2ec7cc4d5d3`.

## Compiler and simulator behavior

Ordinary assembly, disassembly, compiler-generated memory access, IDE routing,
and ordinary words executed inside the indexed execution profile use the
single-word sign/magnitude/DR-index layout. No legacy bit-14 immediate fallback
was added. The simulator rejects offset underflow/overflow before memory or
MMIO effects and avoids address wraparound.

Old saved words retain their bytes but are not compatible with the corrected
data-access decoder. The previous 8K simulator run is historical evidence;
it is not evidence for the corrected decoder or these unpublished candidates.

## Verification and limits

- `node simulator/test_compact_data_access.js`: passed exact encodings,
  disassembly roundtrips, invalid operands, actual simulator reads/writes,
  and underflow/overflow containment.
- `python3 -m pytest hardware/test_phase1_rtl_operands.py -q`: 39 passed.
- Six ordinary server compilation requests succeeded.
- `git diff --check`: passed.
- The existing `test_compact_load_save.js` reaches an unrelated worker fixture
  failure: its old `CompactIndex` source lacks the currently required canonical
  dot-name and explicit methods. It is not counted as a passing suite.

## Subsequent isolated validation

The user approved disposable validation, not adoption into the live layout.
`scripts/validate_data_access_candidates.py` copied the catalog/configuration,
recompiled matching source and instruction bytes, and used the ordinary
save-plan, approval-intent, confirmation, save, bind, prepare, approve and activate
endpoints through a Flask test client. It did not connect to a live HTTP server.

The admitted 64 KiB image has SHA-256
`e8ba3755a56fa69308de1154e442529b6cadef6a8a98e10b6976a09137fe9102`.

`node simulator/check_factory_build.js generated-artifacts/data-access-validation`
passed 5,777 steps, four intentional Mallory BOUNDS fault/recovery cycles,
Alice commits 42/43/44/45, exact expected UART text, and preservation of
Boot.Thread and the other Thread's saved state.

Live catalog/configuration hashes before and after were identical. All admitted
bytes, admission evidence, execution evidence and isolation hashes are under
`generated-artifacts/data-access-validation/`. No live saved LUMP, Namespace
selection or physical FPGA was changed.

The preparation shell exceeded its 120-second wrapper deadline, but its captured
log records completion through admission and the final unchanged-live-files
assertion. The separately executed simulator checker exited successfully.

The first full-top RTL replay exhausted its 1,400,000-cycle budget after 1,322
retirements with no fault (`rtl.json`). This exceeds the historical failing
444-retirement run but is not full acceptance. The simulator reaches its first
intentional Mallory fault at step index 1792; a longer RTL budget is needed to
compare that boundary.

The extended replay (`rtl-extended.json`, budget 3,000,000 cycles) reached
the **expected intentional Mallory fault** at cycle 1,880,095 after 1,794
retirements:

- Fault code 8 (BOUNDS), stage 7.
- Instruction `0x070B0020`: `LOAD CR1, CR6, #2`.
- CR12 identifies Thread.3, NS[12].
- CR14 and CR6 identify ide.Mallory, NS[17].
- CR6 has C-list limit 1; index 2 is deliberately outside that limit.
- Fetch address `0x3A08` equals the admitted NS[17] base plus word 2
  (source-relative PC 1).
- SHA-256 matches the exact admitted image used by the simulator.

Independent assertions checked all those identities, bounds and addresses
against the admitted binary. The old WukongCallHome data-access failure did not
recur. This establishes RTL execution through the first intended fault boundary,
not four-cycle RTL fault recovery: the probe deliberately stops at its first
fault. No synthesis, timing closure, bitstream build or physical acceptance is
claimed.

## Isolated RTL recovery: failed before Boot completion

The recovery probe used the same admitted image and real simulated UART pins.
It did not inject a fault, patch registers, skip instructions, reload memory, or
access a physical board.

Verified from `rtl-recovery.json` and the independently CRC-checked
`recovery-snapshot.bin`:

1. The first fault is the expected Mallory BOUNDS, in Thread.3 / NS[12],
   executing ide.Mallory / NS[17].
2. A complete reason-2 snapshot with CRC16 integrity was captured and correlated
   to that Thread and artifact.
3. A UART Run command could not retire an instruction while the fault was held.
4. Only after the snapshot was captured did the test send UART `g`, representing
   the bridge's recovery authorization. This tests RTL protocol handling, not
   the real bridge/server's promotion implementation.
5. Boot state transitioned COMPLETE → FAULT_RST → LOAD_NS.
6. Recovery then raised `STACK_CORRUPT` (`0x12`), with fetch address `0x4` and
   fault instruction `0x27000001`. CR12 and CR14 were zero at this second fault.
   Boot did not complete and no post-reset instruction retired.

**Verdict:** Snapshot capture, hold, authorization and reset entry worked.
Successful RTL fault recovery is **not** established. The exact source of the
reported stack corruption requires investigation; no runtime repair was made.
The simulator's four successful recovery cycles do not prove RTL equivalence.

The first attempt was interrupted by a workspace restart. The next attempt
exposed a probe sampling error: the fault code was read after its valid pulse.
The corrected run captured the code on its valid cycle and observed Boot state
independently. Its final JSON and independent evidence checks establish the
result above. Amaranth also emitted an asynchronous-generator cleanup warning
after producing the final result; this is not the reported architectural fault.
Cycle values in the probe's main-loop events and continuous Boot observer use
different counters because UART send/wait operations consume cycles; do not
subtract those fields across the two streams.

## Recovery investigation: intended continuation and retry behavior

The user clarified that a retained continuation should work and, if it fails,
the intended behavior is to try again repeatedly—not switch to Genesis merely
because a second failure occurred. This is a behavioral requirement, not
authorization to apply a runtime fix or alter the live Namespace.

Read-only RTL inspection identifies two distinct concerns:

- `BootThreadValidation` requires the protected indicator to equal the
  pristine root value `(caps - 3) | 0x1000`. Ordinary CHANGE writes a suspension
  frame and changes that indicator. A difference from the pristine value does
  not by itself prove that a continuation is invalid.
- The top-level reason-2 snapshot/recovery path is triggered by a faulting
  retirement. In guarded `LOAD_NS`, `execution_phase` is false, so a validation
  fault has neither `retire_valid` nor `retire_fault_valid`. The registered
  Namespace error persists until reset, while automatic core fault reset also
  requires `boot_complete`. Thus this early failure is not wired into the
  ordinary automatic snapshot/authorization retry path. An explicit manual
  reboot is a separate path.

The second point is a code-path finding; the existing probe stops at the
second fault and does not constitute a long-duration repeated-retry test.
Neither concern justifies weakening capability validation or accepting an
arbitrary saved frame.

### Exact cause confirmed

The completed diagnostic replay uses the same admitted SHA-256 and reproduces
the same two faults. Its recorded writes and settled Boot reads establish:

- Boot.Thread occupies word base 256. Its protected indicator is at byte
  `0x444` (word 17 within the Thread).
- The initial image has indicator `0x10F1` (stack pointer 241), and passes the
  isolated, unchanged `BootThreadValidation` module.
- Execution writes the indicator several times. The final pre-fault value is
  `0x10ED` (stack pointer 237), written at observer cycle 580079.
- After authorized reset, Namespace admission succeeds. Boot reads that same
  `0x10ED` at observer cycle 1908307. No Thread validation or activation completes.
- The fresh-root equality check requires `0x10F1` and rejects `0x10ED` with
  `STACK_CORRUPT`. Replaying the unchanged validator with the recorded Thread
  writes reproduces this rejection independently of the full-top reset path.

The retained stack pointer is within its bounds (212–243); the suspension frame
at word offset 239 points back to 239, exactly two words above the saved pointer.
Its saved E-GT is `0x4A00000A`. These satisfy the corresponding CHANGE structural
checks. **Full continuation restoration and all capability checks have not been
validated.** The immediate failure is a pristine-root requirement, not evidence
that these structural continuation checks failed.

Simply removing the equality check would not be an adequate repair: the Boot
validator and activation path also assume a pristine root entry and startup
homes. A proposed correction must validate and restore the retained continuation
as a continuation, preserve authority checks, and handle early Boot failures in
the retry protocol. Repeatedly rebooting the unchanged RTL against these same
retained words will hit the same equality rejection.

Evidence: `rtl-recovery-diagnostic.json` and `boot-recovery-cause.json` under
`generated-artifacts/data-access-validation/`. The independent checker is
`scripts/check_boot_recovery_diagnostic.py`. Its bus interpretation accounts for
synchronous BRAM latency: first-cycle data can belong to the preceding address;
the validator's armed handshake consumes the settled response. Initial
GUARDED_CALL root writes are also included, not mistaken for recovery writes.

No runtime RTL, live catalog, Namespace assignment, application process, or FPGA
was changed during this investigation. Recovery acceptance remains open.

## Approved isolated RTL correction (verification in progress)

Following separate implementation approval, the RTL now distinguishes a pristine
root sentinel from a suspension frame. Suspensions retain geometry and E-GT type
checks; activation validates saved homes without requiring CR0 to equal a fresh
startup entry. A guarded resume uses the existing RETURN and cLoad machinery for
saved-E-GT version/seal checks, return-PC bounds, protected pop, flags, executable
identity, C-list, and fetch-fence restoration. The original fresh-root CALL path
remains separate.

Early LOAD_NS faults now generate one fault-retirement event per reset attempt.
That event enters the existing top-level reason-2 snapshot/authorization path;
it does not bypass snapshot draining, authorize itself, skip instructions, or
change version numbers. Reset rearms the event for another attempt.

Completed focused checks:

- Nine synthetic current-layout structural-admission cases.
- Three consecutive malformed-context attempts in one core test: each emits
  one fault event, remains faulted, and rearms only on explicit reboot.
- Six integrated core cases covering fresh root, suspension, stale saved home,
  stale saved E-GT, invalid executable seal, and out-of-range return PC.
- Twenty-one existing top-level snapshot/recovery protocol checks.
- A separate reconstructed-retained-Thread component probe completes Boot at
  cycle 217, restores CapabilityTest / NS[10], and resumes at byte `0x2870`.
  This component probe is not a replacement for exact-image full-top acceptance.

The old guarded Boot test files fail with their historical fixture. The
unmodified baseline also fails the exact activation case before this correction;
those fixtures are not counted as passing evidence and were not rewritten.

The exact admitted-image full-top replay is running separately through actual
simulated UART authorization, with no memory reload, register injection, or
instruction skip. It must complete Boot and retire 100 post-reset events to
report `continuation-resumed`. That bounded result would not, by itself, prove
four complete fault/recovery cycles or physical-board acceptance.

The diagnostic checker defaults to corrected structural-admission verification
and writes `boot-continuation-validation.json`. Its `--expect-rejection` mode is
for the pre-correction RTL baseline and retains the historical failure assertion.
Live catalog/configuration and the FPGA remain untouched.

### Exact-image corrected replay: bounded recovery PASS

The full-top replay has completed with outcome `continuation-resumed`, using
the unchanged admitted image SHA-256
`e8ba3755a56fa69308de1154e442529b6cadef6a8a98e10b6976a09137fe9102`.
Independent assertions checked:

1. The expected Mallory BOUNDS fault remains at cycle 1,880,095, executing
   `0x070B0020` in Thread NS[12] / artifact NS[17].
2. The reason-2 snapshot is CRC-valid and exactly matches the decoded saved
   frame. Run cannot bypass the fault hold.
3. After simulated bridge authorization, Boot transitions
   COMPLETE → FAULT_RST → LOAD_NS → GUARDED_RESUME → COMPLETE.
4. The first resumed program retirement is at byte `0x2870`, in Boot.Thread
   NS[2], executing CapabilityTest NS[10]—the saved continuation, not a fresh
   entry substituted by the probe.
5. There are 100 post-reset retirement events: two Boot/return control events
   followed by 98 program retirements. No additional fault occurred in this
   measured window.

Evidence is in `rtl-recovery-corrected.json` and
`rtl-continuation-correction.log`. The simulator again printed an asynchronous
generator cleanup warning after writing its final result; independent result
and snapshot checks passed. Observer timestamps and main-loop counters remain
separate time domains for reporting.

This closes the isolated first-recovery reproduction. Four complete RTL
fault/recovery cycles, broader release acceptance, synthesis/timing, and physical
board acceptance are **not** claimed. The broader RTL alignment task remains
open. No live publication, application restart, Namespace/LUMP replacement, or
FPGA programming was performed.
