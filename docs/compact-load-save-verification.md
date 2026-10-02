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

## Broad-suite regression verification

- The assembler suite now reaches its summary rather than crashing at SC5.
  Positive fixtures use explicit indexed CALL or LOAD/LAMBDA, retaining row,
  selector, permission, and source-diagnostic checks. High-level constructs
  that still generate retired instructions are tested for explicit rejection.
- `npm test` passes the full chain: the monolithic assembler suite has 2,096
  passing assertions and capability-index coverage has 42 passing cases.
  Inline examples match their canonical compiled words; retired picker entries
  are removed; dynamically generated method snippets preserve CALL rows/selectors.
  Unsupported high-level call generation fails explicitly instead of producing
  partial executable methods. Missing abstraction fixtures declare their owner.
- The saved-LUMP guard exercises the current volatile installation boundary:
  inspected-byte hash, awaited metadata, and C-list validation before boot/load.
  Negative cases and deliberate await/validation bypasses demonstrate sensitivity.
  Raw SELF without compiler provenance stays rejected; raw malformed bytes remain
  inspectable without fabricated labels. Root-frame runtime diagnostics replace
  the obsolete blanket boot-entry RETURN warning.
- `node simulator/test_rci_threading.js` passes with an explicit abstraction
  declaration and adjusted source-line assertions (55 assertions).
- `node simulator/test_lazy_resolve_pending.js` passes (71 assertions).
  The supported sequence explicitly LOADs to resolve the declared E capability
  before indexed CALL checks for the absent body. Indexed CALL itself does not
  resolve an empty C-list row.
- `node simulator/test_editor_restore_containment.js`: expects `server source`
  but receives the owned `draft`.
- `node simulator/test_null_clist_rows.js`: stale source-pattern assertion
  expects the old portable/materialized capability dispatch expression.

The last two observations are outside the npm chain and were not changed.

### Source regressions versus live catalog audits

`npm test` runs the declaration guard with explicit `--source-only`, then runs
`scripts/test_build_lump_embedded_content.js` against private temporary output
directories. That suite retains malformed/current-mismatch rejection tests.
CapabilityTest's expected embedded text accounts for the builder's existing
programmer-facing SELF/public-name projection; the remaining text must match
exactly.

`npm run check:capabilities` and the configured `check-capabilities-blocks`
workflow retain the original fail-closed live-catalog audits, including
`audit_clist.py`. The live embedded-content check still fails on
`CapabilityTest.1.3f7e1c54.lump`: its source frame is compressed, which the guard
currently decodes as plain UTF-8, and its inflated source is a different saved
revision from the canonical example. No historical artifact was rewritten or
reclassified to clear this failure. Regression success is not release approval.

## Release boundaries

No saved user artifact, Namespace, or boot-image file is rewritten.
Old LOAD/SAVE binaries are not compatible with the new operand layout and
require explicit recompilation/adoption. Bundled historical binary fixtures
and hardware binaries are not proof of support for the new encoding.

No FPGA RTL implementation, synthesis, flashing, or hardware execution was
performed. Hardware remains mismatched. The compile-through-step check uses
disposable simulator state, not the user's current committed boot image or
physical board.