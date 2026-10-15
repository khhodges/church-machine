# Phase 1 instruction behavior: generated-Verilog comparison

## Result — 2026-10-15

**42/42 comparisons passed in one complete run against unchanged source and
catalog inputs.** Each includes the independent Amaranth assertions and the
generated-Verilog replay. The final run used
`--report generated-artifacts/phase1-instruction-rtl-verified.json --jobs 4`.

- Both independent Amaranth suites: **75 passed**.
- Replay-harness regressions: **6 passed**, including deliberately corrupted
  expectations for whole-signal and bit-field inputs, combinational-only
  designs, matrix enumeration and idempotent release-cache installation.
- [Exact machine-readable evidence](phase-1-generated-verilog-evidence.json):
  SHA-256 `35afbab036221ca184e5cbb6b8463a3b2311bd859b3360e8d8cc055881a3a49c`.

An earlier comparison completed 41 cases but the predicate fixture hit a
recorder limitation on bit-field input writes before Verilog generation.
That was not an RTL discrepancy. After adding and testing slice-input support,
the complete 42-case comparison was rerun; the linked evidence is that final
run, not a combination of partial results. No instruction implementation was
changed by this work.

The broader project completion checks did not all finish: completion supervision
expired while `python3 scripts/check_method_dispatch_release.py --verify-bundle`
and the release replay following
`python3 -m pytest scripts/test_method_dispatch_release.py -q`
were running. The latter's 27 pytest cases passed, but neither enclosing release
matrix produced final evidence. These unfinished checks are not claimed as
passes and do not qualify a release; they are separate from the complete
42-case report linked above.

## Method and reproducibility

```sh
python3 scripts/replay_phase1_instruction_rtl.py \
  --report generated-artifacts/phase1-instruction-rtl.json --jobs 4
python3 -m pytest scripts/test_phase1_instruction_replay.py -q
python3 -m pytest hardware/test_phase1_independent_execution.py \
  hardware/test_phase1_rtl_operands.py -q
```

The runner enumerates the existing pytest parameter records; it does not copy
instruction encodings or recompute expected answers with a decoder/compiler.
Each case first executes its original independent assertions under Amaranth.
The recorder then reuses that exact elaborated fragment and checks every
recorded observation against generated Verilog with four-state `!==` comparisons.
Inputs, clock edges, architectural state, fault identity and side-effect probes
are replayed in order. A model assertion, conversion error, compiler error,
simulation mismatch or missing pass marker fails the case.

The release generator's five traversal caches were extracted, unchanged, into
`hardware.gen_rtlil.install_elaboration_caches`. Both the release generator
and this runner call that function. Each fixture uses a fresh process, avoiding
cross-fixture lifetime assumptions in process-scoped identity caches.
The recorded fragment is emitted as RTLIL and passed through the actual
`hardware.gen_rtlil._rtlil_to_verilog` pipeline, including its generic Yosys
`techmap` and arithmetic-cell fixes. There is no alternate converter fallback.
The shared recorder now also supports combinational-only decoder fixtures.

Icarus compiles each emitted design with `-g2012 -s tb`; `vvp` executes the
comparison. Compilation is bounded at 600 seconds, replay at 60 seconds, and
the release converter retains its 120-second deadline. These are per-tool
bounds, not a whole-suite deadline.

## Coverage

| Existing fixture group | Cases | Evidence |
|---|---:|---|
| DREAD/DWRITE | 16 | Positive/negative signed-magnitude offsets, DR0, inclusive limit, underflow/overflow, no invalid access, accepted index surviving poisoned live operands |
| BRANCH and CALL pre-admission | 10 | Positive/subtractive/DR0 branch targets, negative/over-32-bit targets, active code-fence exclusion, checked CALL row/method underflow and row overflow, retired indexed layout rejection |
| BFEXT/BFINS | 7 | Runtime add/subtract positions, insertion preserving other bits, zero width, field overflow, negative and position-32 rejection with unchanged state |
| CALL unit | 2 | Row 6 address capture despite changed live selectors; row 0x10006 rejected rather than truncated; stops at NULL callee rejection |
| Decoder predicate truth table | 1 | All 15 defined conditions × 16 NZCV states × valid low/high; NV remains outside the oracle |
| Core predicate skips | 4 | False-condition IADD, NULL SAVE, CHANGE CR13 and invalid-range BRANCH preserve architectural state |
| Indexed CALL recognition | 1 | Independent literal word selects the approved indexed form |
| Executed CHANGE CR13 | 1 | INVALID_OP before writes, architectural changes or successful retirement |
| **Total** | **42** | Independent model assertions plus generated-Verilog observation comparison |

The additional code-fence vector is `0xBF03FFFF` after DR2 setup
`0xAF104000`, using the existing branch fault assertion harness.
Its target does not overflow 32 bits; the active fence must reject it.
No other oracle or instruction fixture was replaced.

## Provenance and interpretation

Toolchain used for the recorded comparison:

- Python 3.12.11; Amaranth 0.5.9.
- Yosys 0.51, commit `c4b5190229616f7ebf8197f43990b4429de3e420`,
  built with g++ 14.2.1 `-fPIC -O3`.
- Icarus Verilog compiler and runtime 12.0 stable.

Executable SHA-256 values (local Nix toolchain):

| Tool | SHA-256 |
|---|---|
| yosys | `5c3a036505a025dd6267556eeee97486983b348cd892b5b8cb55cb4166894ef9` |
| iverilog | `22ab14305c340c1de6209b674fb2c234d78ae14dbc97a7b4566180c22a57ee05` |
| vvp | `e1281ab8aeb921e9795ae7ee0ff4be4a4a0d19942efbaebf2488785b7ad126bd` |

The machine-readable result records every selected test and parameter set,
SHA-256 hashes of the hardware sources, shared architecture contracts, server
Python dependencies, replay/converter sources and authoritative ISA document.
It also records an aggregate digest of the effective catalog's JSON/LUMP/BIN
files, before/after source and catalog equality, tool versions, and per-case
hashes of emitted RTLIL, Verilog and the testbench.
Generated RTL, compiled executables and logs are temporary; failures retain
diagnostic files and name their location. Only the compact evidence report is
retained in this documentation.

**Profile:** default `ChurchCore(iot_profile=False)` for core cases;
standalone ChurchDRead, ChurchDWrite, ChurchCall and ChurchDecoder for their
unit cases. Core fixtures use synthetic instruction/memory responses and the
existing isolated boot handshake, not a saved image execution. They leave the
boot microcode window using three real retirements before ordinary checks.

**Evidence level:** behavioral replay of generated generic Verilog from the
recorded core/unit elaborations. Yosys generic `techmap` is not vendor mapping.
This is not a full Wukong-top elaboration, technology-mapped device simulation,
timing/resource measurement, bitstream qualification or physical-board result.
No saved image was rewritten; no vendor build, upload or flash was run.

Full CALL dispatch/frame/continuation conformance, every operand/predicate
cross-product, positive CHANGE/SWITCH handoff and IoT profile qualification
remain outside this selected fixture comparison. The ongoing instruction-oracle
work remains separate; passing these cases cannot close those coverage gaps.
