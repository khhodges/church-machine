# Initial instruction conformance results

Measured 2026-10-02 using `tests/isa_conformance/run.py`.
This is **not complete ISA conformance or hardware certification**.

Authority: `docs/instruction-set.md`, SHA-256:
`53666cc9c493efd18e1cf44ddcd53fe65fb700b95c7ad966b1a6558d03d22507`.

## Executed results

| Layer | Passing vectors | Failing vectors | Blocked policy groups | Untested vectors |
|---|---:|---:|---:|---:|
| JavaScript simulator, actual fetch/decode/step | 285 | 0 | 5 | 0 |
| Amaranth Full, issue through retire/fault | 262 | 23 | 5 | 0 |
| Amaranth IoT, issue through retire/fault | 262 | 23 | 5 | 0 |
| Generated RTL Full, independent CXXRTL execution | 262 | 23 | 5 | 0 |
| Generated RTL IoT, independent CXXRTL execution | 262 | 23 | 5 | 0 |
| Assembler source-to-word | 0 | 0 | — | 285 |
| Physical hardware | 0 | 0 | — | 285 |

The 285 vectors comprise 256 condition/flag combinations, nine MCMP operand
cases and twenty compact LOAD/SAVE effective-index cases.

Every execution layer passes the 256 predicate probes. Each hardware layer
fails the same twenty effective-index assertions and three MCMP equality/Z
assertions (`mcmp-2`, `mcmp-6`, `mcmp-8`). These failures remain failures, not
expected-success snapshots adjusted to existing bugs.

All tested rejected LOAD/SAVE operations reach a fault without observed data
reads, memory writes, or CR/DR/M/flag changes. Their hardware **index formation**
still fails. The NULL-authority fixture intentionally does not certify
successful capability transfers, last-row bounds, lazy resolution or seals.

MCMP's checked contract is two-register equality/Z and preservation of all DRs,
CRs, M bits and memory. C/V and other unresolved flag/field semantics are not
inferred from either implementation. The runner does not reproduce every flag
disagreement from the audit, because not every flag expectation is settled.

The five blocked groups are SAVE register roles; MCMP exact C/V and unused
fields; shift-produced flags; malformed/retired-word predicate precedence;
and the remaining D2–D8 field, authority, bounds and fault-order policies.

## Reproduction and evidence

```sh
python tests/isa_conformance/run.py --output /tmp/isa-conformance
# Expected exit 1 while the measured implementation failures remain.

python tests/isa_conformance/run.py --output /tmp/isa-conformance --observe
# Same failing statuses, exit 0 for report collection only.

python -m pytest tests/isa_conformance/test_contracts.py -q
# Measured: 5 passed. These validate the runner/oracle, not ISA compatibility.
```

The report directory contains `results.json` with requested and observed
initial/final state, fault/retirement, forbidden effects, per-layer statuses,
and input-source hashes; `summary.md`; complete cycle stimuli; generated RTLIL,
CXXRTL and test executables. Outputs are intentionally not mixed into release
assets. See `tests/isa_conformance/README.md` for fixture boundaries, normalized
word/byte addresses, tool detection and scope limitations.

Generated engine: Yosys 0.51 CXXRTL, g++ 14.2.1.

| Profile | RTLIL SHA-256 | Generated CXXRTL SHA-256 |
|---|---|---|
| Full | `b5447600a8144270cfa343f1ce170f1e66afc1bc8c42a7e65d656bfff991ea18` | `c4f4233d31a3cfc029a7c88a1ba04b580b76d846ed20a3b60c60807db9901f76` |
| IoT | `eb230b08897153880ee079c046180be2e92b5775b4b3cc259c29578b6568c0ab` | `818be5bd3a380ec6b02d2bdc644330c11a08d072a509df821e0ff48c720610c9` |

Generated RTL is evaluated against the independent oracle, not against
Amaranth's answers. This is not a vendor netlist or board test. No production
instruction implementation, ISA semantics, saved artifact, Namespace file,
boot image or bitstream was changed. No synthesis, flashing or publishing ran.