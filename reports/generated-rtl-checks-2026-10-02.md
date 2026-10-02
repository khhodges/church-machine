# Corrected instruction checks in generated RTL

## Result

**33 generated SystemVerilog replays passed:** 28 full-core runs across Full
and IoT profiles, plus five standalone TPERM EXACT comparisons.

**The same 33 checks also passed using the actual Wukong release converter**
on temporary RTLIL inputs. Five unit checks and three core checks completed
before the first command hit its five-minute execution limit; the remaining
25 core checks completed in a background continuation with exit code 0.

The test harness runs the existing Amaranth benches with their independent
assertions, records every input write, clock step, and observed value, then
replays that sequence in Icarus against freshly emitted RTL. Four-state case
inequality rejects unknown values rather than silently treating them as zero.
The RTL is generated from the same elaborated design, not a replacement model.

| Scope | Evidence |
| --- | --- |
| Compact LOAD/SAVE | 20 core runs: indexed LOAD address calculation, positive/negative offsets, DR0 indexing, overflow/underflow containment, no 16-bit truncation, preserved registers and failing NIA |
| MCMP | Two core runs, each covering six equality/unsigned/signed-overflow operand pairs; flags, retirement and unchanged DRs checked |
| False predicate | Underflowing LOAD skipped in each MCMP bench; no memory access or fault |
| EXACT core | Six runs: equality, inequality and false predicate in both profiles; flags, retirement, CR/DR preservation and no operand memory access |
| EXACT unit | Five runs: equal words and slot, generation, permission and B-bit differences; no capability rewrite or fault |

The compact fixtures deliberately stop valid-index LOADs at a NULL selected
capability; these are not successful capability-installation tests. SAVE is
covered for overflow/underflow containment, not successful store completion.
MCMP's skipped-predicate companion case is LOAD, not MCMP.

## Plain-Verilog emission issue

The default Amaranth Verilog emission failed the replay during Namespace
initialization, before the tested instructions. At event 47 the model's
boot-state value was 5, but Icarus observed 4.

The emitted file contained constant-only `always @*` assignments to
`cr14_gt[31]` and `thrd_gt[31]`. Icarus warned that the sensitivity lists were
empty and the blocks would never execute. Their uninitialized bits remain
unknown. Emitting SystemVerilog (`write_verilog -sv`) supplies `always_comb`
semantics, including time-zero execution, and all selected replays passed.

This is a separate simulation/emission finding. It does **not** demonstrate
that an existing FPGA bitstream has a boot defect, nor certify the release
pipeline. No production emitter was changed to conceal the failure.

## Release-converter verification

The replay harness now supports `--release-converter`, which calls
`hardware.gen_rtlil._rtlil_to_verilog` directly. This uses the release
pipeline's full `proc`, flattening, optimization, and `techmap` passes, then
plain-Verilog emission and its existing cell-fixup functions. Converter
failure is fatal: there is no fallback to SystemVerilog. Repeated identical
RTLIL inputs may reuse converted text within the process, keyed by SHA-256.

All selected replays passed without changing the release converter or dialect.
The default converter's boot simulation failure did not reproduce through
these release conversion stages. No release-emitter correction is justified
by that earlier failure alone.

This checks instrumented Full/IoT cores and the EXACT unit, not the complete
Wukong board top, checked-in release artifacts, or a physical FPGA.

## Reproduction

```sh
# All 33 checks, generated SystemVerilog:
python3 scripts/check_corrected_generated_rtl.py

# Just the five independent EXACT word comparisons:
python3 scripts/check_corrected_generated_rtl.py --exact-unit-only

# Default plain-Verilog mode (expected full-core boot failure):
python3 scripts/check_corrected_generated_rtl.py --plain-verilog

# All 33 checks through the actual release converter (allow more than five minutes):
python3 scripts/check_corrected_generated_rtl.py --release-converter
```

Environment: Amaranth 0.5.9, system Yosys 0.51, Icarus Verilog 12.0.
Icarus was added as a development dependency. Successful temporary RTL and
executables are removed; a failed replay retains RTL and its testbench in
a reported `/tmp/church-rtl-failure-*` directory.

## Boundaries

- No FPGA synthesis, placement, routing, bitstream rebuild, flashing, or publish.
- No saved LUMP, Namespace, boot-image, or checked-in release RTL changes.
- No changes to unresolved TPERM mode or NULL-precedence rules.
- No claim of whole-ISA conformance or physical-board equivalence.
- The two previously reported stale SelfTest trace expectations remain outside
  this verification-only change.

Remaining coverage includes successful LOAD/SAVE completion and complete-board
verification. These results do not constitute hardware release approval.