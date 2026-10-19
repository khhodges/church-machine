# Namespace Gate Log diagnosis

## Finding

The admitted ascending runtime inherited a **historical descending-table
diagnostic**. Its Namespace warning is reproducible without a machine fault:
a synthetic ascending image completes the real three-step LOAD/CHANGE/CALL
boot and two NOP instructions; Thread and Abstraction checks pass, while the
old Namespace diagnostic rejects its table base.

This is evidence of a display-model mismatch, not evidence that execution
bypassed the ascending validator. It does not certify all saved designs.
No saved artifact or hardware was changed to obtain this result.

## Trace to the source

- `simulator/design-simulation.js` creates the explicitly admitted instance
  using `ChurchSimulator.fromAscendingNamespaceImage`, starts boot, and gives
  the existing displays that instance.
- Its Boot/Code presentation uses the existing `app-run.js` helpers and
  `pipeline.js` visualizer. Neither computes the live Namespace validation card.
- `simulator/app-tools.js`: `updateGateLog()` obtains
  `sim.getLiveLumpValidations()`; `_renderLiveLumpValidations()` renders its
  states, reasons and check badges separately from the audit/fault log.
- `simulator/simulator.js`: `_validateLiveLumpContext()` previously assumed
  the table began at `NS_TABLE_BASE` with inverted descriptors.
- `simulator/namespace-runtime-core.js` deliberately exposes `NS_TABLE_BASE`
  as the active allocation's **end** for legacy instruction-engine interfaces.
  Actual ascending lookups use CR15 and `namespace-runtime-view.js`.

For the private 256-slot test image at base 0, the active table is words
0–1023 and its allocation ends at 8192. The old diagnostic demanded base
8192 and described descriptors at 8192–9215. The active metadata and descriptor
correctly identify base 0. Applying the old diagnostic geometry to the same
unchanged runtime reproduces the false warning.

## Bounded correction

Only the read-only diagnostic receives a profile-specific geometry hook.
The ascending implementation uses the same `namespaceGeometry()` reader as
the runtime, including its metadata, allocation and exact table-limit checks.
Version, integrity, residency, canonical-base and descriptor extent checks
remain in place. The historical descending diagnostic is unchanged.

Malformed active geometry is reported as a diagnostic fault rather than
escaping the card builder and making the Gate Log omit every card.
Only the known geometry error is converted; unexpected implementation errors
still propagate. Diagnostic reads do not raise or clear architectural faults.
No admission, execution, instruction, SWITCH, or hardware gate is changed.

## Verification

`node simulator/test_live_lump_validations.js` covers:

- Real ascending factory, boot and two Code steps, for 64 and 256 slots at
  bases 0 and 8192; all three live cards pass.
- Reproduction of the original warning using the historical geometry hook.
- Wrong/out-of-memory table bases, short/long/misaligned extents, sequence and
  integrity failures, FAR descriptors, and a Thread masquerading as Namespace.
- Malformed metadata/header/allocation, reserved metadata, and invalid CR15
  limit/FAR state. Runtime geometry and descriptor reads still reject them.
- Production renderer output for valid and invalid ascending descriptors.
- Byte-for-byte memory and execution/register/audit/fault-state invariance
  across the diagnostic reads.
- Historical valid/invalid descending descriptor fixtures.

Related checks: `test_namespace_runtime_view.js`,
`test_namespace_runtime_core.js`, `test_selected_design_boot.js`, and
`test_design_simulation.js` in `simulator/`.

These are isolated in-memory tests, not a fresh replay or modification of the
user's saved program, and not physical-board evidence.

## Separate pre-existing historical issue

Running the original live-validation test and simulator from the unchanged
Git baseline produced four failed expectations. Current default fallback
boot uses Header V2 at word 0 and Thread storage at word 16, while those tests
assumed a v1.2 table descriptor at the high-memory table base and a Thread
at word 0. The default fallback's Namespace warning remains visible and is
explicitly checked. The old-format positive tests now construct an explicitly
synthetic descending-table descriptor; they do not alter the production
fallback image. Address-zero Thread inspection is still covered separately.

Diagnosis and any correction of the Header V2 fallback warning are separate
work requiring confirmation of that format's display/runtime contract.
