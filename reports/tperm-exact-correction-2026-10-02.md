# TPERM EXACT comparison correction

## Implemented

Both the simulator and Amaranth now complete a non-NULL EXACT comparison
without faulting on inequality:

- Same 32-bit GT: Z=1.
- Different 32-bit GT: Z=0.
- No capability rewrite, DR result, or operand memory access.
- General documented TPERM flags: N=!Z, C=0, V=0. The simulator's newly
  reachable mismatch path follows the existing hardware convention and the
  flag table in `docs/isa_reference.md`.

Instruction descriptions in the IDE now describe comparison, not a BIND
assertion. Other permission faults remain intact.

## Verified

- 16 hardware checks passed: ordinary TPERM regressions, exact-word unit
  comparisons, and full-core Full/IoT equality, inequality and false predicates.
- Real simulator fetch/decode/step checks passed for equality and changes to
  slot, generation, permission and B bits, including false predicates and
  preserved CRs/DRs/memory.
- Instruction commentary trace audit passed.
- SelfTest TPERM branch-polarity regression passed.
- IDE restarted successfully and its simulator page rendered.

Commands:

```sh
python3 -m pytest hardware/test_tperm.py tests/hardware/test_tperm_exact_core.py -q
node simulator/test_tperm_exact_comparison.js
node tests/simulator/instruction_commentary_trace_audit.js
node simulator/test_selftest_tperm_branch_polarity.js
```

## Additional integration repair

Restart exposed a stale source-backed trace fallback after the earlier compact
LOAD encoding correction. Its two LOAD words and LOAD/SAVE disassembly now
match the new encoding. This fixes the startup assertion without weakening it
or modifying saved binaries.

The trace-symbol suite had 8 passing and 2 failing checks. The remaining checks
assume old instruction locations in the current SelfTest artifact, expecting
ISUB/IADD where the selected artifact contains different words. Saved SelfTest
bytes were not rewritten to satisfy those expectations.

## Still outside this correction

No new rule was chosen for NULL/special-preset precedence, B-variant semantics,
health-check encoding, or attenuation mode conflicts. Existing dispatch
precedence remains unchanged; the new tests deliberately use non-NULL inputs.
No generated-RTL simulation, synthesis, bitstream update, flashing, publishing,
or saved-artifact conversion was performed. This is not certification of the
whole TPERM instruction family or physical hardware.