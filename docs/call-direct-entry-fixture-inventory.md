# Mandatory CALL dispatch: compatibility fixture inventory

New programs must encode a positive dispatch selector. Source method ordinals
remain zero-based: `CALL CR1, #0` encodes selector **1**, not direct entry.
Omitting the method is an error. A named method needs destination API evidence.
Three-operand legacy CALL forms are not canonical target/method syntax.

Historical bytes remain inspectable. This change does not rewrite LUMPs,
replace caller revisions, select different Namespace entries, or weaken the
simulator's `INVALID_OP` response to selector zero.

## Current positive coverage

- `tests/simulator/sim_call_dispatch_required.js`: assembler rejection,
  compiler helper rejection, positive numeric selectors, historical disassembly,
  exact executable-byte replay using `lump_builder`, and runtime fault checks.
- `tests/server/test_named_call_save_attestation.py`: trusted named-method
  compilation, independent save-plan reproduction, approval/publication,
  exact saved executable-byte reload in private RAM, negative source and
  tampering cases, unchanged Namespace and stored-file checks.
- `tests/server/test_call_method_lookup_isolated.py` and
  `tests/server/test_explicit_callable_methods.py`: trusted API and explicit
  callable-interface coverage.

## Legacy execution fixtures needing separate migration

These files contain `_execCall` invocations with `imm: 0`. Each case must be
classified by purpose: keep deliberate invalid-selector cases; convert
successful-entry and downstream-fault fixtures to a valid nonzero selector
and canonical offset table so they reach the intended check.

- `simulator/test_return_cr14_trace.js`
- `simulator/test_thread_base_zero.js`
- `simulator/test_task3529_control_flow_diagnostics.js`
- `simulator/test_paused_execution_boot_gate.js`
- `simulator/test_ns_table_ops.js`
- `simulator/test_return_protected_validation.js`
- `simulator/test_fault_call_route.js`
- `simulator/test_return_keep_mask.js`
- `tests/simulator/sim_return_cr6_l_perm.js`
- `tests/simulator/sim_rtl_audit_boundaries.js`

The incoming mandatory-dispatch work migrated `simulator/lump_assembler.js`
and the shared CR6 fixture to numeric offset tables. The combined dispatch
test retains its producer checks alongside the new compiler rejection and
`lump_builder` exact-byte checks. The earlier BRANCH-table dependency is
therefore no longer a current blocker for that producer.

## Inspection and stale source expectations

- `simulator/test_boot_gt_words.js` and
  `tests/simulator/sim_boot_three_instruction.js` include `CALL CR0` boot
  display expectations. Distinguish ROM inspection from compiling new code.
- `simulator/test_current_isa_guidance.js`,
  `simulator/test_boot_execution_freshness_warning.js`, and
  `simulator/test_boot_rom_inspection.js` contain historical display/source
  samples. Display support is not permission to compile direct-entry CALLs.
- `simulator/test_call_api_diagnostics.js` expects bare assembly without
  explicit method declarations to compile. It currently fails its first
  positive assertion under the explicit-callable-method contract.
- `simulator/assembler_test.js` mixes historical conventions and current
  compilation. A direct run also ends in its compiler sandbox with
  `ChurchAssembler is not a constructor`; this is not evidence that the
  mandatory-dispatch checks should be relaxed.

Inventory searches (results need semantic classification, not bulk replacement):

```sh
rg -n '_execCall\(\{[^\n]*imm: 0' simulator/*test*.js tests/simulator/*.js
rg -n 'CALL CR[0-9]+|0x17000000' simulator/*test*.js tests/simulator/*.js
```

No compatibility fixture authorizes translating immutable artifacts.

## Resolved completion-check blockers

The incoming mandatory-dispatch work corrected the maintained Wukong and
CapabilityTest source and producer fixtures. The remaining rebuild failures
were a CALL operand-count regression: tokenizer parts split `CR6[PetName]`,
so a valid indexed target plus numeric method looked like three operands.
The assembler now recognizes that canonical form without admitting obsolete
three-operand CALL syntax. All bootstrap Python tests reach their original
archival/publication/collision assertions and pass in temporary directories.

The incoming dispatch changes also restored the Mint fixture boot path; its
configured check passed at the last completion validation. No saved artifacts
or live Namespace bindings were changed to restore those tests.

## Retired raw-instruction admission

Raw-ISA methods are subject to the same compiler rules as mnemonic source.
New opcode-8/9 bodies and selector-zero CALLs fail before signing or save
reproduction. Historical inspection remains supported. Hardware already
rejects retired opcodes at decode; the ELOADCALL unit now also rejects direct
start requests before any memory access, frame push, register write, or NIA
change. `tests/hardware/test_retired_eloadcall.py` covers both boundaries.
