# Phase 1 independent instruction fixtures

Authority: `docs/phase-1/01-isa/instruction-set.md`, especially **Core execution
reference**, **Oracle closure**, and the later approved encoding corrections.
Release matrix: `docs/phase-1/04-release/isa-to-fpga-alignment-plan.md`, H01–H09.

Run from the repository root:

```sh
python -m pytest tests/hardware/test_phase1_*.py -q --tb=short \
  --junitxml=/tmp/phase1-rtl-results.xml > /tmp/phase1-rtl-results.log 2>&1
```

The exit status is intentionally nonzero while approved-contract mismatches
exist. These are ordinary failing assertions, **not** xfails or accepted
baselines. Skipped oracle-closure cases are **BLOCKED**, never passes.
No vendor tools, generated bitstreams, release artifacts, live Namespace
files, server, browser, board, upload, or flash are involved.

## Fixture boundaries and reproducibility

Checker inputs are literal words or explicit bit packing in these test files.
No assembler, decoder output, production GT builder, production integrity
function, saved catalog or boot-image generator constructs expectations.
`ChurchDecoder` is a device under test, never the oracle.

`phase1_support.py` uses the existing fault-aware boot handshake, then retires
three real IADD DR0 instructions before any ordinary test. It installs a
synthetic executable descriptor through the documented simulation ingress.
That ingress does not update the separate fetch fence: each DR setup explicitly
places NIA at byte 12 through the documented free-run input, without resetting
the core or reopening the privileged window. Long sweeps therefore do not
accidentally test the reset ROM's short fetch bound.
Nonzero CR/DR sentinels expose unwanted clearing; DR0 and reserved CR13 remain
zero, and CR0/CR8 are deliberately NULL operands. Tests snapshot full CR
descriptors, all DRs and NZCV, not only the selected result register.

Core cases have a 96-cycle instruction bound (160 for the runtime CALL
operand boundary). Unit cases bound completion independently. Fault recovery
is deferred; the first fault retirement checks exact instruction and NIA.
A fault retirement is a reporting event, not successful execution. Unit
tests stop on the first fault and do not model host recovery. Core assertion
traces contain cycle, NIA, retirement, fault-valid and fault code. Synthetic
memory, descriptors, flags, raw instruction words, register setup, expected
results and prohibited effects are specified alongside each case.

This is **Amaranth RTL simulation evidence only**. It is not H19 emitted-RTL,
mapped-netlist or physical FPGA evidence. Unit responders isolate a boundary:
in particular the CALL descriptor responder does not count as proof of mLoad.
The real Namespace gate and mSave are tested separately.

## Coverage map

| Plan ID | Focused executable evidence |
|---|---|
| H01 | MCMP/IADD/ISUB across all DR destinations, source/destination and triple aliases, DR0, zero, signed extrema, carry/borrow; unsigned immediates 0/1/8191/8192/16383; SHL/LSR/ASR amounts 0/1/31 and all DR destinations. Shift flags explicitly excluded pending closure. |
| H02 | Independent 16-NZCV × 15-defined-condition truth table; committed-state false-condition probes for invalid LOAD/SAVE, CHANGE/SWITCH CR13, NULL/EXACT, reserved NULL modifier, DATA and bitfield operands. |
| H03 | Direct-immediate and new indexed CALL packed words; runtime-direct method extremes, input latching; checked LOAD/CALL/SWITCH row access; DREAD/DWRITE ±1023; BRANCH ±262143 and 32-bit overflow inputs. |
| H04 | BFEXT/BFINS widths 0/1/31, position 0/31, crossing the word, subtraction underflow, 32-bit carry, index/source/destination aliases, preserved insertion bits, result NZCV, DR0. |
| H05 | Method zero, first/last public, private zero and out-of-range table/entry at the pre-frame boundary; committed RETURN keep mask 0/all/every bit, all CR descriptors and DR retention. Protected-frame and LAMBDA scenarios are blocked below. |
| H06 | Every W0/W1 integrity-covered bit separately, F/G separately, nine version bits equal/stale, NULL/Outform/Inform and domain/permission access gates, DATA bounds, denied/authorized M-bit device writes, exact SAVE memory writes and no writes on permission/bounds/seal/generation failure. |
| H07 | Literal/nonzero/B-bearing NULL; equal/unequal non-NULL EXACT; one/both NULL; raw modifier 31; core flag/descriptor preservation and first-fault location; false-condition probes. |
| H08 | Permission-bearing Thread operand must report 0x1E; independently malformed header type/count/allocation must report 0x1D before any publication. Valid/suspended/root/restored-context cases are blocked below. |
| H09 | CR13 rejection, CR15.M absent despite source M, both row signs, checked row access with no target execution on invalid selection. Successful save/load and fixed-slot-2 activation are blocked below. |

The table describes the tested boundaries, **not exhaustive H01–H09
qualification**. A passing unit boundary cannot certify downstream
instruction commit. For example, a nonwrapping invalid CALL test proves
containment but does not by itself establish the precise fault precedence.

## Explicit oracle blockers

`test_oracle_closure_blocked` and `test_frame_dependent_scenarios_blocked`
enumerate these as pytest skips with the controlling section in the reason:

* NV and malformed reserved-field disposition.
* Shift NZCV and unused-bit semantics.
* Ordinary TPERM packing and unspecified fault/flag precedence.
* Exact protected Thread frame/indicator packing, CALL/RETURN M-bit effects,
  and LAMBDA continuation representation.
* Unspecified multi-fault precedence and numeric codes not assigned by the ISA.

Do not copy current RTL frame packing into a “golden” fixture to remove these
skips. In particular nested/empty/root/corrupt RETURN, valid/suspended Thread
restore, unused-invalid-c-list-then-use, self/helper/other CHANGE ordering and
successful SWITCH slot-2 activation require that independent frame oracle.
Their skips preserve the missing acceptance obligations; they do not claim
that the underlying implementations work.

## Existing tests inspected

The compact-index, full-width data access, TPERM NULL/EXACT, RETURN mask/stack,
method dispatch, indexed CALL, shift, boot CHANGE and scheduler-contract tests
were inspected before adding this suite. They remain unchanged. Some assert
legacy indexed-CALL tags, old DREAD/DWRITE immediate mode, reserved NV behavior,
or implementation-selected shift flags; passing those tests is not a substitute
for the Phase 1 oracle.

## Observed mismatches

The initial runs exposed these approved-contract disagreements:

* The initial signed-immediate finding was withdrawn after syncing with the
  approved unsigned 0–16383 rule. Unsigned treatment is conforming behavior;
  no arithmetic RTL change is warranted by that finding.
* New indexed CALL mode is not recognized by the old decoder.
* DREAD/DWRITE bit 14 still selects old immediate mode rather than subtraction.
* Bitfield runtime index/sign does not implement the approved position formula.
* Malformed Thread admission returns older underlying codes instead of 0x1D;
  permission-bearing operands return an older permission code instead of 0x1E.

The retained assertions also exercise branch routing, CALL runtime methods,
SWITCH and row-zero SAVE against the written authority. Any additional failures
must be read with their exact fixture and trace; do not blanket-label all
failures as one implementation defect. No RTL changes are part of this task.

### Recorded verification, 2026-10-15

Pre-sync disjoint runs covered all **433 collected cases**: **348 passed, 72 failed,
13 explicitly blocked/skipped**. Four arithmetic failures used the superseded
signed-immediate oracle and are withdrawn, not RTL defects. The ten immediate
cases were replaced with unsigned boundary cases and rechecked separately after
sync; see the correction below.
The full command exceeded the shell's five-minute limit, so the completed
verification was split without changing fixtures:

```sh
python -m pytest tests/hardware/test_phase1_execution.py -k 'h01 or h02' -q --tb=short --junitxml=/tmp/phase1-arithmetic.xml
python -m pytest tests/hardware/test_phase1_execution.py -k 'not h01 and not h02' tests/hardware/test_phase1_operands.py -q --tb=short --junitxml=/tmp/phase1-context.xml
python -m pytest tests/hardware/test_phase1_authority.py tests/hardware/test_phase1_control.py -q --tb=short --junitxml=/tmp/phase1-units.xml
```

| Failing fixture family | Failed cases |
|---|---:|
| Runtime bitfield positions and aliasing | 20 |
| Checked indexed BRANCH | 11 |
| Checked C-list operand routing (CALL/SWITCH) | 7 |
| Direct runtime CALL method selection | 3 |
| DREAD/DWRITE subtraction | 6 |
| Thread admission fault-code assignment | 4 |
| SAVE row-zero rejection versus generic written access rule | 1 |
| Indexed CALL mode decode | 16 |

The SAVE discrepancy specifically records unconditional row-zero rejection by
mSave even with its immutable-row input clear. Reconcile the generic SAVE rule
with the resident-SELF rule before interpreting this as permission to change
the implementation. The test does not authorize writing a live SELF row.

Raw final assertion output is in `/tmp/phase1-arithmetic.log`,
`/tmp/phase1-context.log`, and `/tmp/phase1-units.log`, with corresponding JUnit
files above. These temporary files are not release evidence or durable board
records. Re-running the commands regenerates the case-level evidence.

Earlier exploratory runs are not acceptance passes: an initial execution run
reported 41 failures/81 passes/7 skips; a subsequent combined run reported
74 failures/303 passes/15 skips. They included fixture problems subsequently
corrected (fetch fence, fault-retirement interpretation, and device slot).
Two combined attempts were interrupted before completion; neither counts as a
successful trial. Pre-sync counts above come only from the completed, disjoint
runs, not from selecting favorable retries.

### Arithmetic oracle correction after syncing with main

The approved ISA now explicitly specifies unsigned arithmetic immediates.
The corrected fixture tests 0, 1, 8191, 8192 and 16383 for both IADD and ISUB.
The original four signed-immediate failures above must not be included in the
implementation mismatch count. Recheck command:

```sh
python -m pytest tests/hardware/test_phase1_execution.py -k unsigned_immediate -q --tb=short
```

Other assertions were not weakened to accommodate the RTL. The historical
run counts are retained above to make this oracle correction auditable.
The corrected immediate recheck passed **10/10** cases. Combining those
observations with the unchanged cases yields **352 passed, 68 failed and
13 blocked** across 433 cases; this is not a claim of a fresh post-sync full
suite run.

### Completion-validation follow-up

After authorization to investigate the completion blockers, the release-test
process-exit probe was corrected to accept both missing-process responses from
Linux procfs (`FileNotFoundError` and `ProcessLookupError`). The complete
`scripts/test_method_dispatch_release.py` run then passed **28 tests**.
Release source-drift rejection now identifies changed, added and removed input
paths; it does not bypass freshness checks or refresh an approval automatically.

The completion service stopped tracking validation before the two long release
replays reached terminal results. Neither replay is recorded as passed here.
This infrastructure limit is separate from the intentionally failing Phase 1
qualification assertions. Production instruction changes flagged by completion
review were already present on the incoming main branch; this task's changes
relative to that branch contain no production RTL cutover or ROM edits.
