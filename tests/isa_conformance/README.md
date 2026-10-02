# Initial ISA conformance runner

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