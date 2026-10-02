# Initial shared conformance runner — results

## Status

**Initial subset implemented and verified. Full conformance-runner coverage
is not complete. No instruction implementation was corrected.**

Authority: `docs/instruction-set.md`.
Contract matrix: `reports/isa-instruction-contract-matrix.md`.
Runner and documentation: `tests/isa_conformance/`.
Detailed machine-readable evidence: `.local/isa-conformance/results.json`.

## Executed checks

| Check | Result |
|---|---|
| Runner/oracle self-tests, including real simulator LOAD and overflow containment | 4 passed |
| Scoped conformance assertions across assembler, simulator and Amaranth | 1,168 passing rows |
| MCMP equality failures | 4 failing rows: two cases in each of Full and IoT |
| Full-core LOAD/SAVE hardware vectors | 384 explicitly untested rows; decoder observations retained, not mistaken for execution |
| Generated RTL execution / physical hardware | 2 explicitly untested rows |
| Unresolved contract groups in this subset | 4 blocked rows |

Counts describe assertion rows, **not instructions certified**. They must not
be turned into a percentage of ISA compatibility.

## Reproduced MCMP failures

The same literal MCMP word selects DR2 and DR1. The independent oracle checks
equality/Z and the absence of a stored result; it does not select unresolved
carry/overflow policies.

| DR2 | DR1 | Expected Z | Simulator Z | Amaranth Z (Full and IoT) |
|---:|---:|---:|---:|---:|
| 7 | 7 | 1 | 1 | 0 |
| 1 | 0 | 0 | 0 | 1 |

The runner exits **1** for these real discrepancies. They are not suppressed
as expected failures or changed into passing reference results.

## Boundaries

The JavaScript side uses actual fetch/decode/step with disposable Namespace
objects. Fault recovery is contained to preserve the original failed
instruction's evidence. The Amaranth MCMP side uses full-core issue through
retirement/fault in both profiles, including verified register setup, bounded
completion, retirement identity and normalized word-address PC.

For LOAD/SAVE, only the simulator currently runs complete instruction fixtures.
The hardware side records decoder outputs but does not equate them to executed
indices. Equivalent full-core capability fixtures remain necessary.

SAVE assembler assertions cover compact operand bits, not the disputed register
roles. Conditions cover the independent 256-entry truth table, not all
predicated instruction side effects. Memory access observations distinguish
instruction fetch from operand validation; simulator validation calls are not
a complete raw bus trace.

Generated RTL execution is not implemented in this initial runner. Neither
Icarus nor Verilator is available in the checked environment. No physical-board
or bitstream evidence is inferred.

## Reproduction

```sh
python3 -m pytest tests/isa_conformance/test_oracle.py -q
python3 tests/isa_conformance/run.py --output /tmp/isa-conformance.json
```

Exit 0 means no mismatches in tested assertions, not complete coverage.
Exit 1 reports mismatches; `--require-complete` also rejects untested/blocked
rows. Exit 2 reports runner/setup failures.

## Remaining work

1. Add equivalent full-core LOAD/SAVE capability fixtures through completion or
   fault, including memory-access and register-side-effect evidence.
2. Implement generated RTL execution with the same vectors and independent
   expected outcomes; retain exact generated-source provenance.
3. Extend predicated execution and accepted-operand stability coverage.
4. Resolve the matrix's open ISA contracts before defining their oracle rules.

No saved LUMP, Namespace, boot image, bitstream, production instruction
implementation, deployment or physical device was modified.