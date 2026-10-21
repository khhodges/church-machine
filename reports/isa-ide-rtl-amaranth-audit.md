# ISA / IDE / RTL / Amaranth audit

## Verdict and baseline

**Not ready to claim complete ISA-to-FPGA alignment.** Fresh generated RTL agrees
with Amaranth and the simulator on the executed conformance subset, but there
are confirmed inspection errors, divergent Abstract execution paths, incomplete
PassKey enforcement evidence, stale build provenance, and failing operand tests.

Audited on 2026-10-21 at workspace commit
`b18f3ec9` (including the bound-preview merge `91b196a0`).
The pending SELF-contract work was **not merged into this baseline**.
This report does not prejudge that work or certify its eventual result.

No implementation, saved LUMP, Namespace assignment, boot image or hardware was
changed. Test-generated RTL and compiler outputs were confined to `/tmp`.
The audit did not inspect a physical board or published deployment.

## Findings, prioritized

### 1. High — existing FPGA build cannot establish current-source conformance

`python3 scripts/wukong_build_provenance.py --verify` failed with:

```
hardware_sources_sha256, input_files_sha256, sentinel, boot_layout,
boot_inputs_sha256, stale:build/church_wukong_xc7a100t.il,
stale:build/church_wukong_xc7a100t.v,
artifact:church_wukong_xc7a100t.il,
artifact:church_wukong_xc7a100t.v, source_commit
```

In contrast, `--verify-release` passed. These are different claims:
the archived bitstream/MCS bundle can be internally consistent without
implementing today's sources. Its provenance record dates to September 8.
Do not use the release-bundle pass as proof that recent ISA/IDE changes are
present in the FPGA.

**Closure:** require current source/input provenance, exact generated RTL,
vendor-build evidence and then physical acceptance for the same candidate.
Fresh CXXRTL tests below do not certify the existing vendor bitstream.

### 2. High — Abstract capability execution is not uniform across layers

Static path comparison:

* `hardware/mload.py:250–257`: an Abstract GT fetched from a c-list faults
  `INVALID_OP`; the source explicitly identifies this as an unimplemented
  Abstract-manager path.
* `hardware/call.py:537–543`: a direct Abstract CALL enters the M-window
  Namespace-fetch path solely on the GT type, without subtype dispatch there.
* `hardware/call.py:833–905`: that path reads four Namespace words and completes
  through `M_FETCH_DONE`, exposing M-window metadata.
* `simulator/simulator.js:10265–10301`: Abstract CALL dispatch interprets the
  subtype/device class, implements LED methods, and faults unsupported methods.

Thus c-list LOAD, direct hardware CALL and simulator CALL do not offer the
same Abstract behavior. An Abstract-shaped SELF marker must not be treated as
a usable owner GT because a particular path accepts its type.

**Classification:** confirmed source-level path divergence; this audit did not
run an end-to-end Abstract-call RTL vector or demonstrate an exploit. Which
Abstract operations belong in the approved Phase 1 release must be settled
against the current ISA, not inferred from legacy simulator convenience code.

**Closure:** use identical raw Abstract words in direct CALL and indexed
LOAD/CALL vectors; assert subtype disposition, faults, M/DR changes, Namespace
reads, writes and retirement in simulator, Amaranth and generated RTL.

### 3. High — approved PassKey SAVE policy lacks a complete hardware contract

`docs/phase-1/01-isa/instruction-set.md:763–781` requires SAVE detection of
Abstract PassKeys and Genesis-controlled onward sharing, while explicitly
leaving the proposed PassKey bit format unapproved.

`hardware/msave.py:100–194` checks immutable row zero, destination authority,
bounds, source B/M, generation and seal; it has no PassKey-specific detection
or Genesis-sharing decision. The generic source-GT Namespace interpretation
is not evidence of the required PassKey policy.

**Classification:** architectural/implementation gap, not proof that a working
PassKey can currently be forged or shared. The missing approved discriminator
means this cannot safely be fixed by inventing a prefix or reusing ordinary
GT generation bits.

**Closure:** approve the representation and authority interface first; then
test authorized and unauthorized SAVE, including M-elevated paths, before
claiming the PassKey requirement implemented.

### 4. Medium — IDE still conceals and mislabels actual GT encodings

`simulator/app-lumps.js:4489–4515`:

* FEED5E1F and FEEDDA7A return a special “not a live GT” explanation without
  showing their actual architectural fields.
* Abstract R/W are labeled as bits 26/25 and generation as 24:16.
* `shared/architecture_contracts.json:62–72` specifies R=24, W=23 and
  generation=22:16 for Abstract GTs.

For FEED5E1F the actual Abstract decode is subtype 31, R=0, W=1,
generation=109, data=0x5E1F. Decoding does not establish validity or SELF identity.

**Closure:** show raw architectural decoding for every word, separately label
the declared SELF role and any mismatch, and test ordinary versus Abstract
layouts. Do not change historical bytes to make the presentation agree.

### 5. Medium — SELF producer/validator disagreement remains in this baseline

The previous SELF audit remains applicable to the unmerged baseline:
compact symbolic paths accept zero/marker while expanded historical paths
require the marker (`server/symbolic_binding.py:62–69`).

Fresh execution of `node simulator/test_symbolic_call_binding.js` failed at
line 187: the test expects zero SELF rejection, but the guard accepts it.
This confirms a test/contract disagreement, not by itself unauthorized GT
admission. The same test's injected destination-local dependency check precedes
that failing assertion.

Hardware does not have a portable-file relocation mechanism: it consumes the
destination executable words. The required boundary is therefore explicit:
portable declarations → exact destination binding → owner E-only Inform SELF
with matching slot/generation → hardware image. A compiler marker cannot serve
as evidence that this entire chain is correct.

**Closure:** reassess after the pending SELF change merges, using one artifact
through compile/save/reload/bind/preview/simulator preparation/boot construction,
including stale-generation and used-versus-unused unresolved references.

### 6. Medium — CALL operand suite is red; failures do not yet identify a CPU bug

The broader Phase 1 run reported five failures in
`tests/hardware/test_phase1_operands.py::test_h03_runtime_direct_call_checked_method`:

```
[0-0-False]
[0-2047-False]
[2048-2047-True]
[2147483647-1-False]
[2147483648-2047-True]
```

All fail at line 79 because `dmem_wr_en` is asserted during the test's
unconditional no-write expectation. A follow-up, in-memory instrumentation
of the fixture reproduced the method-zero and `2147483647+1` cases:
both first write **0x8024**, the selected Namespace entry's Word 1,
at NIA **0x30**, before a retirement fault. Both first read all four words
at 0x8020–0x802C.

That address is consistent with the explicit Namespace G-bit-clear write in
`hardware/mload.py:333–345`, rather than a demonstrated method-body or
protected-frame write. The remaining three cases were not instrumented.
Whether that pre-method-validation metadata write is permitted must be
checked against the approved fault-side-effect contract; the red assertion
alone does not establish a CALL arithmetic defect.

**Closure:** record bus address/data, owning FSM, instruction identity and
first-fault boundary for these exact five vectors. Classify the writes against
the ISA before modifying hardware or relaxing the assertion. Keep overflow,
method-table bounds and pre-fault side-effect checks.

### 7. Medium — conformance authority and coverage need reconciliation

Both `docs/instruction-set.md` and
`docs/phase-1/01-isa/instruction-set.md` declare themselves the master.
The fresh runner pins the former (`tests/isa_conformance/contracts.py:7`).
Its blocked labels still refer to older unresolved decisions, while the Phase 1
document contains subsequent approved contracts. These labels must not be
treated as a fresh determination that those architectural questions remain open.

The runner's green result excludes successful LOAD/SAVE capability transfers,
full CALL/RETURN/CHANGE/SWITCH journeys, the binding-to-boot chain, PassKeys,
assembler source-to-word coverage in this mode and physical hardware.

**Closure:** explicitly establish document precedence, update the matrix
without silently promoting historical text, and add approved behaviors as
independent vectors. A shared implementation passing its own narrower oracle
is not full architectural acceptance.

## Verification performed

### Fresh generated RTL comparison — completed

Command:

```
python3 tests/isa_conformance/run.py --output /tmp/isa-rtl-audit
```

| Layer | Passing vectors | Failing vectors | Blocked coverage records |
|---|---:|---:|---:|
| JavaScript simulator | 351 | 0 | 5 |
| Full Amaranth core | 351 | 0 | 5 |
| IoT Amaranth core | 351 | 0 | 5 |
| Fresh Full generated RTL / CXXRTL | 351 | 0 | 5 |
| Fresh IoT generated RTL / CXXRTL | 351 | 0 | 5 |

These are 1,755 passing layer/vector observations, not 1,755 distinct
architectural cases. The same runner records 351 untested assembler and
351 untested physical-hardware observations.
Detailed vectors, source hashes and results are in `/tmp/isa-rtl-audit/`.

### Binding and preview — completed

* `node simulator/test_bound_lump_preview.js`: passed transition, reopen,
  partial/unresolved, stale, blocked, integrity and read-only checks.
* `python3 -m pytest tests/server/test_namespace_binding_report.py
  tests/server/test_symbolic_binding.py -q`: **19 passed**.
* `node simulator/test_symbolic_call_binding.js`: failed as described above.

The bound-preview merge is a real improvement: the focused test verifies
inspection of bound bytes rather than merely the original artifact.
This does not establish activation or RTL consumption of those bytes.

### Broader hardware suite — interrupted, not a complete result

Started the operand, execution, control, authority, independent-execution,
retired-opcode and Namespace-header suites together. After more than eight
minutes, the run had reported the five failures above and progressed beyond
28%. It was deliberately interrupted to capture the failures.
Remaining tests are **not evaluated by this run**; no total pass claim is made.
Full captured output: `/tmp/isa-phase1-tests.log`.
The surrounding shell returned zero because its final command was `tail`;
that exit code does not represent pytest success.

## Recommended correction order

1. Finish and audit the pending SELF contract without changing immutable history.
2. Correct GT inspection and reconcile the authoritative ISA/test matrix.
3. Resolve the five CALL bus-write failures with precise traces.
4. Close Abstract/PassKey scope and implementation gaps using approved contracts.
5. Validate exact bound artifacts through boot-image consumption, then rebuild
   with matching provenance and perform separately authorized physical acceptance.

This is an audit, not an implementation or release approval.
