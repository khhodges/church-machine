# Sparse initializer synthesis validation — blocked, not release evidence

Historical first-pass report. See
[the follow-up](sparse-initializer-synthesis-followup-2026-10-07.md) for subsequent
functional-model and full-system replay evidence. This failure record and its
original bundle are retained unchanged apart from this pointer.

## Scope and safety

Only temporary elaboration, synthesis, and software simulation were performed.
No routing, FPGA image generation, programming, board reset, UART command, or
physical-board connection was performed. Immutable Namespace snapshot files
were hash-verified before use and checked again afterwards.

The comparison input is approved Namespace revision
`3a53c8ebe99bcccb3eb1c4371c8c897851853d60cd7d64d66c0343f69b502166`,
not today's live catalog. Its retained RTLIL SHA-256 is
`9708ddb4e2d106f8a1f4f508c1854765376954fab824b47e8f98642004f70f2a`.
The snapshot's selected LUMPs, Namespace selector, and admission records were
copied into a private catalog. No approval or artifact bytes were rewritten.

## Established evidence

- The existing initializer unit suite passed: 16 tests.
- The evidence-runner checks passed: 5 tests.
- The retained ROM supplied exactly 2,693 initialization pairs.
- Fresh `hardware/sparse_memory_init.py` was converted to RTLIL with those
  exact pairs, then passed through Yosys 0.51 generic synthesis (`synth`).
- Icarus 12.0 replay checked **every ordered write**, with enable pauses and an
  uninitialized RAM sink. First write: word **1 = 0x0000003f**. Final write:
  word **3967 = 0x02000001**. Sink Namespace limit: **63**.
- Completion was checked with eight additional cycles to detect extra writes.
- XC7-specific synthesis completed and mapped the ROM into **four RAMB36E1**
  primitives. Synthesis reported no check errors.

## Blockers and limitations

1. **Mapped BRAM functional simulation is not established.** The installed
   Yosys `xilinx/cells_sim.v` RAMB36E1 declaration has parameters and timing
   checks but no behavioral assignments, initial blocks, or always blocks.
   Its simulation output is therefore unknown; the test fails at the first
   write. This is a missing functional model, **not proof of an initializer
   logic failure**. A real compatible functional primitive library is needed.
   Vivado is not installed in this local environment.
2. **Full-system boot evidence is not established.** Fresh full hardware
   elaboration (`sim_mode=False`, no DMEM preload) failed before its
   180-second deadline, exiting on **SIGSEGV (-11)** after the 120-second
   diagnostic stack capture began in Amaranth's AST code. Earlier attempts
   were manually stopped to add diagnostics; those are not successful runs
   either. The crash's root cause has not been established, including whether
   traceback dumping contributed. Process-group cleanup and failure logs are
   retained. No full-system netlist was produced.
3. Consequently, the full top's fresh pair-equivalence guard was not reached.
   The isolated initializer uses the retained ROM's exact pairs, but integration
   with the full top remains unverified.
4. **No claim is made that boot retires past 0x2E08, or that live CR15 contains
   limit 63.** The full-system bench requires fault-free retirement at 0x2E08
   followed by 0x2E0C, boot completion, every initialization write, and the
   actual CR15 limit of 63. That bench has not run.

Generic gate synthesis is useful additional evidence, but it does not reproduce
the original vendor BRAM inference transformation. It cannot replace mapped
functional simulation or justify an FPGA release.

## Retained evidence and reproduction

`reports/sparse-initializer-evidence-2026-10-07.tar.gz` retains the final report,
source/catalog hashes and copies, exact pairs, generated initializer RTLIL,
generic and XC7 netlists, testbenches, and success/failure logs. Earlier failed
attempts are retained separately inside the bundle. Executables are excluded.

Run in a fresh output location:

```sh
python3 scripts/verify_sparse_initializer_synthesis.py \
  server/build-snapshots/revisions/namespace/3a53c8ebe99bcccb3eb1c4371c8c897851853d60cd7d64d66c0343f69b502166 \
  --output /tmp/new-sparse-initializer-evidence
```

The runner exits nonzero on a failed stage, timeout, missing pass marker, or
changed snapshot. Independent stages retain their own results. It never calls
the FPGA build/publish/program pipeline.

**Next step:** run the retained initializer inputs with a functional XC7 BRAM
library on the synthesis host, and resolve or independently bound the full-top
elaboration bottleneck. Then repeat full-system synthesis/replay against the
same approved inputs. Routing and programming still require separate approval.
The assigned validation remains incomplete.
