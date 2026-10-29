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
