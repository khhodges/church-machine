# Initializer investigation — reset-faithful synthesized replay

## Result

**Requested functional validation passed. No FPGA release or physical-board
validation is claimed.** The consolidated architecture proposal was not applied.
No hardware implementation file, live catalog or retained revision was changed.
Only the verification harness was corrected to remove the reset-domain
substitution identified in the previous investigation.

The actual initializer extracted from the freshly elaborated production
`sim_mode=False` top was mapped with Yosys 0.51 `synth_xilinx -family xc7`.
It has no reset input and uses four RAMB36E1 primitives. Its mapped module
replaces that exact module boundary in the same optimized full-system model.
There is no reset-bearing standalone substitute or hand-written port wrapper.
The rest of the full system is optimized word-level synthesized RTL, not a
fully XC7-mapped chip. This distinction remains important.

## Frozen inputs

Approved Namespace revision:
`3a53c8ebe99bcccb3eb1c4371c8c897851853d60cd7d64d66c0343f69b502166`.

The complete 2,693-pair initialization sequence is extracted from that
revision's retained RTLIL ROM. Fresh production elaboration must match every
pair, in order, before replay proceeds. Only the three selected, hash-pinned
LUMPs and saved Namespace/approval data are copied into the isolated catalog.
No current live catalog selection substitutes for these files.

| Input/output | SHA-256 |
|---|---|
| Initializer source | `4397c052322e51df9682117afde40595297f9550048848402e96cab357bf60a1` |
| Production top source | `2137c7c48e69371597c1fcd8d41cb32aa6806082b167a8ad17d421e9db11fad8` |
| Expected pairs.hex | `b7cebaeb97a509b014991f4a71f85a3650f839c91b673413d11e78350364d33c` |
| Fresh full.il | `71f3fe373176d7d142a48331c0bfd610d2d2287164ab27ac7c0c01f4b561f249` |
| Mapped production initializer | `5abcac3c9cda07ad887979924b67ad927c490e794f7ab5ae932f0fb09289e65a` |
| Mixed full-system netlist | `ab195cf5be006a9ba2ebfdfd2974e9ab9b6818f365c919afa88cf6a1c756fa1b` |

The machine-readable report retains all source, catalog, model, netlist and
testbench hashes. Snapshot and staged source/catalog before/after hashes match.

## Measured results

All four fresh stages passed:

| Stage | Evidence |
|---|---|
| Generic synthesized standalone initializer | 2,693 exact writes, pauses, uninitialized sink, sticky completion |
| XC7-mapped standalone initializer | Same complete write sequence and completion checks |
| Optimized full production RTL | Exact writes, live Namespace limit63, boot past 0x2E08 |
| Reset-faithful mapped initializer in full model | Exact writes, live Namespace limit63, boot past 0x2E08 |

Every stage recorded:

```
WRITE 0    1    0000003f
WRITE 2692 3967 02000001
```

Both full-system runs recorded:

| Cycle | Retired byte address |
|---:|---|
| 100927 | 0x00000000 |
| 309342 | 0x00000004 |
| 621882 | 0x00000008 |
| 934377 | 0x00002E04 |
| 1142767 | 0x00002E08 |
| 1351135 | 0x00002E0C |

Final marker:
`PASS_BOOT_PAST_2E08 cycle=1351135 ns_limit=63 cr15_limit=63`.

The test checks the actual live CR15 word2, not only a shadow RAM value.
Writes are sampled at their accepting clock edge. No internal state, UART
backpressure, RAM contents or instruction stream was forced or accelerated.
The sink shadow begins uninitialized. Full-system completion requires all
writes, boot completion and no asserted boot/retirement fault.

## Limits, warnings and failure retention

No tool deadline or timeout was accepted as success. Each tool invocation
has a bounded process-group lifetime and retained output; simulation also
has a five-million-cycle fatal timeout and requires an explicit pass marker.
This fresh run has no reported functional blockers.

Mapping produced sixteen RAMB36E1 output-port resizing warnings. Compilation
also reports vendor model timing-expression warnings. These logs remain in
the evidence; the actual mapped primitive replay passed all expected words.
The vendor functional model bytes were copied from the earlier retained
evidence archive and are individually hashed in this run.

The earlier failed/qualified evidence archives are unchanged. Their incomplete
runs remain failures or qualified results, not retroactively converted to passes.

Remaining release boundaries:
- No whole-chip vendor mapping/equivalence or timing-closure result.
- No placement, routing, bitstream generation, programming or board command.
- No claim that an uncorrelated uploaded board trace ran these same bytes.
- No claim of conformance to the newly proposed architecture.

## Reproduction and retained files

```
python3 scripts/verify_sparse_initializer_synthesis.py \
  server/build-snapshots/revisions/namespace/3a53c8ebe99bcccb3eb1c4371c8c897851853d60cd7d64d66c0343f69b502166 \
  --unisim-dir /path/to/retained/unisim \
  --output /tmp/new-reset-faithful-evidence
```

Use a fresh output directory. Exact recorded inputs, models, commands,
testbenches, synthesis logs, netlists and replay logs are retained under
`generated-artifacts/initializer-reset-faithful/run/` and in the downloadable
evidence archive. Compiled simulator executables are intentionally omitted;
their compilation commands and input bytes are preserved.

Verification also passed the sixteen initializer model tests and six
evidence-runner tests, including a regression check requiring extraction of
the same production fragment rather than a standalone reset-bearing wrapper.
These tests supplement, not replace, the synthesized replay above.
