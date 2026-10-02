# Supplemental assembler and capability-transfer checks

Two complementary entry modes are preserved. `--output FILE.json` runs the
supplemental incoming checks described below; `--output DIRECTORY` runs the
new actual-execution and generated-RTL runner described in the second section.
Their vector sets and result schemas differ and must not be combined as if
they certified the same assertions.

Run from the repository root, preserving the environment's Python module path:

```sh
python3 -m pytest tests/isa_conformance/test_oracle.py -q
python3 tests/isa_conformance/run.py --output /tmp/isa-conformance.json
```

Exit status:
- `0`: no failing assertions in the tested subset. **Not full conformance.**
- `1`: actual mismatches, or incomplete coverage with `--require-complete`.
- `2`: runner/setup error. Never treated as a passing or blocked ISA check.

The report contains exact vectors, independent expectations, per-layer
observations, source hashes, scoped verdicts and explicit coverage gaps.
No golden files are updated and known bugs are not marked expected-success.

## Implemented coverage

- 192 compact LOAD/SAVE vectors: every DR selector, positive/negative offsets,
  1023 magnitude, DR0, arithmetic overflow/underflow and object bounds.
- Actual assembler words (SAVE checks only operand15 because its register roles
  remain disputed), plus actual simulator fetch/decode/step in isolated memory.
- Full and IoT Amaranth **full-core MCMP** issue-to-retire/fault with bounded
  completion, independently checked setup, before/after registers, normalized PC,
  Z and memory-write observations.
- All 256 condition/flag combinations against an independent oracle in the JS
  condition evaluator and each Amaranth decoder profile.
- Adversarial oracle tests reject wrong flags, register mutations, memory writes,
  missing retirement and incorrect indexing.

## Important limits

This is an initial runner, not completion of the instruction matrix.

- Amaranth LOAD/SAVE records the decoder wire **only** and labels full execution
  **untested**. A decoder wire is not an architectural effective index; the runner
  deliberately does not label its raw mismatch a full-core execution failure.
  Equivalent full-core capability/Namespace fixtures are still required.
- JS fixture fault recovery is contained so the original instruction's effects
  remain visible. It does not test fault dispatch/reboot. Read observations are
  capability-access/validation calls, not a complete raw memory-bus trace.
- SAVE runtime observations use the existing register roles. They prove compact
  arithmetic and containment in that setup, not resolution of master decision D1.
- MCMP only asserts the settled equality/Z function, no DR result, one-word
  advancement and no memory writes. N/C/V edge policy remains blocked.
- Condition truth-table passes do not prove predicated instruction side effects.
- No generated RTL execution adapter or physical-board execution is included.
  The initial environment lacks Icarus/Verilator. Adding such a tool alone does
  not close this gap; a generated-design adapter and matched vectors are needed.
- The runner is intentionally not part of the green default regression suite:
  confirmed implementation defects make it exit 1. Use `--require-complete`
  for an eventual release gate; it also rejects blocked/untested coverage.

All fixture data is in memory. The only file written by the runner is the
explicit report path; use `/tmp` or a dedicated report destination.
No production instruction code, saved LUMP, Namespace, boot image, bitstream,
published app or physical device is modified.

# Initial instruction conformance runner

Authority: `docs/instruction-set.md`. Scope and open questions originate from
`reports/isa-instruction-contract-matrix.md` and
`reports/isa-compatibility-audit-2026-10-02.md`. No files under `.local/isa-audit`
are runtime dependencies.

```sh
python tests/isa_conformance/run.py --output /tmp/isa-conformance
python -m pytest tests/isa_conformance/test_contracts.py -q
```

The runner exits **1 on any failing observation**, including adapter errors.
Known mismatches are not expected passes. `--observe` changes only exit policy,
not result statuses, for generating a report while implementations remain broken.
`--only load-index` (or another ID prefix) selects a focused subset.

Dependencies: project Python/Amaranth, Node, and, for independent generated RTL,
Yosys with CXXRTL headers, `yosys-config`, and g++. Missing RTL tools produce
**untested**, not a pass. Available tools that fail produce **failing**.
All generated files and binaries are test outputs under the requested output
directory. No synthesis command, vendor tool, board, web server, saved artifact,
Namespace file, boot image, bitstream or production implementation is modified.


## What executes

* 256 condition/flag combinations: literal SHL probe, source zero, destination
  sentinel 99. The independent truth table determines whether destination is
  zero or unchanged; false predicates also preserve flags. Shift-produced flag
  values remain blocked.
* Nine MCMP operand cases: equality, inequality, aliases, DR0, signed extremes.
  All DRs must be preserved; Z must reflect equality of **DRd and DRs**. Exact
  subtraction C/V, N overflow interpretation, and unused fields are not certified.
* Twenty compact LOAD/SAVE cases: literal, plus/minus DR, zero, maximum magnitude,
  wide DR, effective row zero, overflow and underflow. These intentionally use
  NULL authorities to isolate index computation and rejected-operation effects
  from SAVE's unresolved operand-role conflict and capability lookup policies.
  They **do not test successful capability transfers**, last valid c-list row,
  lazy resolution, seals, or permission-boundary matrices.

JS uses the actual constructor and `step()` fetch/decode/execute. Wrappers only
observe index resolution, instruction memory accesses, and fault boundaries;
they call the original methods. Fault state is captured before host recovery.
Only accesses within the instruction body are counted as data accesses; fetch
and host diagnostic scans are excluded. Memory helper bulk operations would
need additional instrumentation before extending this runner beyond its subset.

Both Full and IoT Amaranth cores execute from issue through retire/fault, bounded
to 80 cycles. The fixture boots, executes three setup retirements to leave the
boot-only instruction window, and deposits DR/CR/M/flags through a **test-only
register-bank seed mux**, disabled before instruction issue. No production
execution logic is replaced. A zero-filled external data-memory responder
acknowledges reads; this prevents missing memory responses masking faults.
Data bus reads/writes, all DRs, CR descriptors and M bits, flags, PC,
fault and retire signals are observed, including a post-terminal idle cycle.

The generated layer lowers a fresh copy of the same fixture and actual core
to RTLIL, generates CXXRTL, compiles it and independently executes the complete
cycle stimulus stream. It does **not** reuse Amaranth output as expected values:
its observations go through the same independent master oracle. This is a
generated RTL simulation, not a vendor netlist, physical release, or independent
Verilog simulator certification. Source fingerprints and Yosys version are saved.


## Units and limits

PC is relative words in JS; the hardware byte PC is divided by four. Raw byte
addresses and word-normalized bus addresses are both retained. The equivalent
code fixture is at word 1024, with code at 1025: JS CR14 holds the LUMP base;
hardware CR14 holds byte 4100 and code limit 3. Descriptor representations are
preserved within each layer, not blindly compared numerically across layers.
All other CRs and M bits start zero, DRs/flags come from the vector, Thread is
absent, and there are no asynchronous events. JS has an in-memory sealed code
Namespace entry solely for real instruction fetch; hardware instruction memory
is supplied through its normal instruction port. Data authorities remain NULL.

`results.json` contains vectors, initial/final snapshots, violations, accesses,
fault codes, per-layer statuses, and fingerprints. `summary.md` summarizes them.
`stimuli-*.json` and `rtl-*/` retain replay inputs and generated sources.
Blocked dimensions are separate entries on every execution layer. Assembler
source-to-word checks and physical hardware are explicitly untested.

Passing one vector never means instruction-wide or full ISA conformance.
