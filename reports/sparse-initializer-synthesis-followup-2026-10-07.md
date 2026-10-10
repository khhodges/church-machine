# Initializer synthesis follow-up — functional validation passed

## Subsequent evidence limits

The uploaded board trace inspected on 2026-10-09 still reports BOUNDS at
0x2E08 in two captured boot sequences. It contains no image hash or full CR15
words, so it cannot yet be correlated to these simulation inputs.

Concurrent engineering findings also identify reset-domain fidelity as a
required control: the isolated mapped initializer has a reset port tied low,
whereas production startup uses a reset-less domain. The mixed replay replaces
that production boundary with the separately mapped initializer. Its passing
logs remain valid for that netlist, but do not establish equivalent mapping of
the original reset-less full top. A reset-faithful mapped replay remains needed
before treating this as conclusive evidence that the production fix survives
synthesis. The earlier claim below of no remaining functional-validation
blockers is superseded by this qualification. No hardware release is approved.

This continues the earlier blocked validation; its failure bundle remains
unchanged. The evidence here is software simulation, not a hardware release.

## Fixed validation blockers

The bare Amaranth elaborator omitted the release generator's established AST
memoization. Reusing `hardware/gen_rtlil.py`'s conversion setup completed full
hardware elaboration in **3.1 seconds**, without changing the hardware source.
The production `sim_mode=False` design's 2,693 initialization pairs matched the
approved retained ROM **exactly**, in order, including first and final entries.

The installed Yosys RAMB36E1 model is timing-only. Functional replay instead uses
the public Apache-2.0 XilinxUnisimLibrary at commit
`1c8e05fd1e9a79ceb8b996a0996674122eed086f`, including `glbl` and an explicit
1 ns / 1 ps testbench timescale. Model bytes and hashes are retained.
The configured remote build credential could not authenticate; no remote build
was launched. Local tools provided the required functional evidence instead.

## Evidence boundaries

1. **Generic synthesized initializer:** all 2,693 writes pass, including pauses,
   an uninitialized RAM sink, and eight post-completion cycles.
2. **XC7-mapped initializer:** Yosys `synth_xilinx -family xc7` maps the ROM to
   four RAMB36E1 primitives. Functional Xilinx-model replay passes the same
   complete write sequence. First: **word 1 ← 63**. Last:
   **word 3967 ← 0x02000001**. Sink Namespace limit: **63**.
3. **Full-system optimized RTL replay:** the fresh hardware top passes through
   `proc; flatten; opt; memory -nomap; opt; check`. It retires:

   | Cycle | Retired NIA |
   |---:|---:|
   | 100927 | 0x00000000 |
   | 309342 | 0x00000004 |
   | 621882 | 0x00000008 |
   | 934377 | 0x00002E04 |
   | 1142767 | 0x00002E08 |
   | 1351135 | 0x00002E0C |

   The pass requires boot completion, no fault, every expected write, and the
   **actual live CR15 word 2 = 63**, not just a mirrored testbench value.
4. **Mixed mapped full-system replay:** the exact full-system initializer module
   is replaced at its existing clock/enable/done/write/data boundary by the XC7
   mapped initializer. The remaining full-system logic uses the same optimized
   RTL synthesis flow. **It passes at cycle 1,351,135 with the same retirement
   sequence above and live CR15 limit 63**, using the identical boot assertions.
   No internal core state, RAM contents, UART
   backpressure, or instruction stream is forced or accelerated.

This is **not** whole-system Vivado synthesis, timing simulation, placement,
routing, a new FPGA image, or evidence from the physical board.

## Timeouts and reproducibility

The original 250,000-cycle full-system limit expired after the first retirement.
It was too short for real 50 MHz / 57,600-baud trace backpressure. Increasing
the bound to 5,000,000 cycles preserved all assertions. A 600-second tool
deadline remains; neither timeout nor a missing pass marker counts as success.
The failed short run and all earlier failure logs remain available.

All 21 focused tests passed (16 initializer model tests and 5 evidence-runner
tests). There are no remaining blockers to the functional validation requested
here. Vendor-specific full-chip implementation and physical-board behavior
remain outside this evidence and authorization.

The same approved Namespace revision was used throughout:
`3a53c8ebe99bcccb3eb1c4371c8c897851853d60cd7d64d66c0343f69b502166`.
No live catalog regeneration or substitution occurred. The immutable snapshot,
staged source, and staged catalog are rehashed after validation.

The follow-up evidence bundle is
`reports/sparse-initializer-followup-evidence-2026-10-07.tar.gz`. Its aggregate
report names each successful log and hashes all retained source, catalog,
models, testbenches, and netlists. Runs were staged diagnostic passes over the
same netlist inputs, not a claimed monolithic vendor build.

To reproduce with the pinned Xilinx library checked out locally:

```sh
python3 scripts/verify_sparse_initializer_synthesis.py \
  server/build-snapshots/revisions/namespace/3a53c8ebe99bcccb3eb1c4371c8c897851853d60cd7d64d66c0343f69b502166 \
  --unisim-dir /path/to/XilinxUnisimLibrary/verilog/src \
  --output /tmp/new-sparse-synthesis-evidence
```

No routing, image generation/programming, reset, or physical board commands
were performed. Those actions still need separate authorization.
