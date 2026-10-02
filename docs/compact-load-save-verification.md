# Compact LOAD/SAVE simulator cutover

The ordinary assembler, public compiler, and simulator use the single-word
layout in `instruction-set.md`: sign at bit 14, magnitude at bits 13:4,
DR selector at bits 3:0. Immediate-only operands select DR0.
No LOAD/SAVE compatibility switch, extension, or extra ADD is introduced.
The existing experimental IDX1 subsystem for other indexed operations remains
separate; ordinary LOAD/SAVE source no longer selects it.

## Verification

Run `bash scripts/test-compact-load-save.sh`.

This passes literal-word and disassembly tests, all 16 index registers,
positive/negative/zero offsets, 1023 boundaries, unsigned arithmetic overflow
and underflow, rejected syntax, runtime SELF protection, conditional skipping,
permission failures, and public compile-worker output through real simulator
fetch/decode/step. Fixtures use disposable in-memory Namespace state.
The public compiler's method-table prefix is separate from the one-word
LOAD/SAVE instruction.

The focused runner also passes method assembly, LOAD through L-permission CR6,
CALL/RETURN CR6 permission tests, RETURN fetch, candidate C-list validation,
LUMP-save boundaries, and static commentary. Separate execution-isolation,
execution-evidence, saved-LUMP disassembly, truthful-commentary, and LUMP
roundtrip suites pass.

C-list mutation regressions run the actual IDE reference analysis, zeroing,
and Apply POLA functions against disposable memory. They verify that immediate
row references and SELF survive, runtime-indexed programs cannot be zeroed or
compacted, and safe immediate-only compaction rewrites magnitude bits without
changing opcode, predicate, or register fields. Referenced NULL rows remain
NULL rather than being remapped to a live capability.
Editor-backed compaction regressions additionally reassemble numeric and
`DR0 + magnitude` expressions (decimal, hex, and binary) and check their words
against the compacted memory image, retaining predicates and comments.

## Remaining broad-suite failures

- `npm test`: the monolithic assembler test reports 217 failed assertions
  (207 distinct assertion labels) and stops at its SC5 access to an absent
  method. Comparing the original assembler/compiler at HEAD showed every
  remaining distinct failure already existed; many expect retired fused
  ELOADCALL/XLOADLAMBDA behavior. Later npm commands consequently do not run.
- `node simulator/test_rci_threading.js`: static compact row checks pass;
  RCI4 fails because its compiler fixture has no abstraction declaration,
  then dereferences missing `lineNums`.
- `node simulator/test_lazy_resolve_pending.js`: T007b/T007c still expect
  retired ELOADCALL to resolve/load a target. The old LOAD row-11 fixture
  has been updated, restoring T008.
- `node simulator/test_editor_restore_containment.js`: expects `server source`
  but receives the owned `draft`.
- `node simulator/test_null_clist_rows.js`: stale source-pattern assertion
  expects the old portable/materialized capability dispatch expression.

These failures are reported, not hidden by changing their semantic assertions.

## Release boundaries

No saved user artifact, Namespace, or boot-image file is rewritten.
Old LOAD/SAVE binaries are not compatible with the new operand layout and
require explicit recompilation/adoption. Bundled historical binary fixtures
and hardware binaries are not proof of support for the new encoding.

No FPGA RTL implementation, synthesis, flashing, or hardware execution was
performed. Hardware remains mismatched. The compile-through-step check uses
disposable simulator state, not the user's current committed boot image or
physical board.