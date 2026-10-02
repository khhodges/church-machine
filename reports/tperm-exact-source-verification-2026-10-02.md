# TPERM EXACT source verification

Authority: `docs/instruction-set.md`, EXACT preset 14: compare all 32 bits of
CRd.word0 and CRs.word0; equality sets Z=1, mismatch sets Z=0, never BIND on
mismatch. Scope is the settled non-NULL comparison, not D3 reconciliation.

## Changes

- `simulator/simulator.js`: replace mismatch fault with comparison flags and
  match/mismatch output; advance normally. Existing N=!Z, C=V=0 convention stays.
- `hardware/tperm.py`: both comparison outcomes enter COMPLETE, with equality
  latched into the Z result. Neither outcome writes a capability.
- Inspected `hardware/decoder.py`: existing low immediate nibble selects 14;
  CR source/destination decoding already reaches the intended registers.
- Inspected `hardware/core.py`: predication gates start, COMPLETE forwards
  N=!Z/C=V=0 and retires normally. Full/IoT core tests verify these connections;
  neither integration file needed changes.
- Unrelated permission, domain, reserved-preset and authority gates are unchanged.

## Reproducible checks

```
node simulator/test_tperm_exact.js
python -m pytest hardware/test_tperm_exact.py hardware/test_tperm.py hardware/test_perm_check.py -q
```

Results: simulator checks pass; 12 Python tests pass.
The existing hardware-sim aggregate now invokes both new regressions and
actually collects the ordinary TPERM pytest functions.

Independent expected vectors include equal words with different cached
location/limit metadata, equal high-bit-set words, and one unequal vector for
each of the 32 word0 bits. Type remains non-NULL throughout. A GT B-bit
difference is compared as data; this does not test the B-modifier preset.

Simulator tests use actual fetch/decode/step, in-memory fixtures, complete
CR/DR/memory snapshots, PC advance, flag values, output, and EQ/NE/NV
predication. Hardware unit checks route two separate CR read addresses,
require bounded completion, reject faults and CR write strobes, and alternate
comparisons without reset. Full and IoT ChurchCore tests start after the
privileged boot window and check decoder-to-retirement equality/inequality,
EQ/NE/NV false predicates, NIA advance, complete CR/DR preservation and no
data-memory read/write requests.

## Explicitly blocked, not silently decided

`reports/isa-instruction-contract-matrix.md` D3 remains open:
mode/preset field collisions, health-check offsets, attenuation sentinel,
B-modifier variants and NULL/special-preset precedence. Tests use the existing
low-immediate preset-14 path only. No assembler claim or whole-TPERM
compatibility claim follows. Existing special-preset branch ordering remains.

## Evidence boundaries

| Layer | Status |
|---|---|
| JavaScript source execution | Passed for the scoped vectors |
| Amaranth unit and Full/IoT core simulation | Passed for the scoped vectors |
| Generated RTL simulation | Not performed; not certified |
| Physical FPGA / released bitstream | Not tested or updated |

No saved LUMPs, Namespace files, boot images or bitstreams were changed.
No synthesis, flashing or deployment was performed.

## Approved validation-blocker repair

Completion validation initially could not collect three server/hardware suites:
the trace-symbol fallback still contained pre-compact LOAD encodings in its
first two words. With user approval, those two diagnostic fallback words in
`hardware/wukong_trace_symbols.py` were synchronized to the existing canonical
`WUKONG_NUC_PROGRAM`. The fail-closed equality assertion remains in place.
A regression in `tests/hardware/test_wukong_trace_symbols.py` checks literal
compact operands, complete fallback equality, and the exposed trace words.
This updates diagnostic source data only, not any boot image or bitstream.