# Amaranth MCMP and compact LOAD/SAVE corrections

## Changes

- MCMP compares DRdst minus DRsrc and writes flags only. N/Z/C/V follow
  the documented ISUB-style subtraction convention (C means no borrow;
  V means signed overflow), as detailed in `docs/isa_reference.md` and
  consistent with the master instruction's compare function.
- LOAD/SAVE compute the approved DR plus/minus 10-bit magnitude at issue.
  A 33-bit calculation detects arithmetic underflow/overflow before either
  unit starts. These faults preserve the failing NIA.
- Three built-in demonstration ROM source LOADs now encode literal indices
  as DR0 plus magnitude; the zero-index bootstrap LOAD is unchanged.
- LOAD, SAVE and their mLoad/mSave index paths retain all 32 index bits,
  including the accepted/later-used index latches. High runtime indices
  cannot truncate to a small authorized row.
- Other indexed instructions retain their existing encoding. SAVE register
  roles, stored artifacts and the master ISA were not changed.

## Verification

- **132 focused hardware tests passed**, covering built-in ROM operand words, new full-core index tests,
  MCMP signed/equality/borrow/overflow cases, false-predicate containment,
  SAVE M authority, immutable SELF, shifts, indexed CALL, and RETURN masks/stacks.
- Shared conformance runner: **1,172 passing rows, no failing rows** in its
  implemented subset; **386 untested and 4 blocked rows remain**. These counts
  are assertions, not a percentage of ISA compliance.
- Simulator compact LOAD/SAVE suite passed, including assembler words,
  public compile-through-step, all DR selectors, permissions and containment.

Full-core LOAD tests observe the selected memory address, then intentionally
return a NULL capability and require a bounded fault without CR/DR mutation.
They cover addition, subtraction, immediate-only and register-only forms,
maximum magnitude, arithmetic overflow/underflow, a 65536 index that must not
truncate, and both Full/IoT profiles. They explicitly end the privileged boot
window before checking ordinary bounds.

SAVE full-core tests cover arithmetic rejection without accesses; existing
SAVE unit tests cover successful writes and authority. New SAVE unit checks
reject 65537 and 0xffffffff without writes or M consumption. A complete
successful-transfer differential fixture at full-core level is still needed.

The independent shared runner's full LOAD/SAVE hardware rows remain untested:
these additional focused regressions are not silently substituted for that
missing matched simulator/hardware fixture.

## Reproduction

```sh
python3 -m pytest tests/hardware/test_compact_index_core.py \
  tests/hardware/test_save_m_authority.py \
  tests/hardware/test_msave_immutable_self.py hardware/test_shift_ops.py \
  tests/hardware/test_indexed_call_cr6.py tests/hardware/test_return_mask.py \
  tests/hardware/test_return_stack_contract.py -q
python3 tests/isa_conformance/run.py --output /tmp/isa-fixed.json
node simulator/test_compact_load_save.js
```

## Release boundary

No generated RTL simulation, synthesis, bitstream build, flashing or physical
board test was performed. No saved LUMP, Namespace or boot image was changed.
Previously generated hardware is unchanged and does not acquire these fixes
until a separately authorized, verified release.

The earlier audit's other findings and unresolved contracts remain open.
In particular, these changes do not reconcile wider descriptor limits,
bitfield encoding, TPERM, or context-transfer behavior.