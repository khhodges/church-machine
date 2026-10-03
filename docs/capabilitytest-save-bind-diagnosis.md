# CapabilityTest: retained SAVE BIND diagnosis

## Review decision and scope

The programmer selected **an authorized SAVE round-trip**, rather than removing
SAVE in favor of repeated LOAD equality. This report retains that intent.
It does not authorize publishing a new CapabilityTest, granting live authority,
changing boot configuration, or flashing hardware.

The correction below is verified in a disposable, explicitly authorized
simulator context. It is **not a drop-in patch for the existing revision 39
authority context**. A live installation still needs separately reviewed
provisioning of the source export grant and writable scratch destination.

## Evidence

Inspected immutable artifact: `server/lumps/CapabilityTest.1.ff2e3f35.lump`,
revision 39, SHA-256
`f8e564ed11de5da24c4265cfe9649ef415dbc919d84ee6bf521e9b770f39c32f`.

Its compressed embedded source, not the older
`simulator/examples/capability_test.cloomc`, contains:

```asm
LOAD CR0, SelfTest
LOAD CR1, LED_DEV
LOAD CR2, UART_DEV
LOAD CR3, BTN_DEV
LOAD CR4, TIMER_DEV
SAVE CR6, CR4, #4
LOAD CR11, CR6, #4
TPERM CR11, EXACT, CR4
```

The saved words at PCs 1–5 are `07030010 070b0020 07130030 071b0040
07230050`: CR6-indexed LOADs from rows 1–5. PC 0 is the method dispatch
word. The following saved SAVE is `0f320040`, at PC 6.

Three distinct source issues must not be conflated:

1. **Operand direction.** `SAVE valueCR, cListCR, #row` exports the first
   register's token. The retained SAVE exports CR6 through CR4. The source
   B check runs first, correctly producing `SAVE: CR6: GT has B=0`.
   This message is not evidence that CR6 failed a destination S check.
2. **Independent authority gates.** Swapping operands to
   `SAVE CR4, CR6, #4` still fails: TIMER_DEV RW has B=0. Granting source B
   alone also cannot authorize writing through an L-only destination; SAVE
   independently requires S. These gates remain unchanged.
3. **Wrong row.** SELF occupies row 0; BTN_DEV is row 4 and TIMER_DEV row 5.
   The retained layout comments predate that layout. Saving into row 4 would
   overwrite BTN_DEV; saving TIMER_DEV back into its existing row 5 makes a
   weak write test because equality could pass even without the write.

## Proposed authorized correction

Use a dedicated, writable **runtime test c-list**, not CapabilityTest's saved
declared c-list. The trusted test-context provider must explicitly supply:

- CR6: a valid S-only Church token for that test c-list, with matching sequence,
  seal, base and count. Do not combine L and S into a malformed Church token.
- Runtime row 5: an explicitly granted TIMER_DEV RW+B token, so the fifth LOAD
  supplies the exportable token to CR4. This is a runtime grant, not a B-set
  saved declaration. Declared capability admission requires B=0.
- A scratch row distinct from SELF and all retained declared capabilities.
  The regression uses row 12 in a 13-row disposable list. Row 12 is a local
  test-fixture choice, **not a reserved Namespace slot or a production layout**.
- An initially different token in that scratch row, to prove a write occurred.

After the five LOADs, the corrected test fragment is:

```asm
; Preconditions: authorized runtime test context described above.
SAVE CR4, CR6, #12
LOAD CR11, CR6, #12
TPERM CR11, EXACT, CR4
```

This checks equality of the complete exported RW+B token. It does not silently
remove B to compare with an unexportable RW token. TPERM EXACT is an equality
test, not a grant of export or destination authority.

The current simulator's ordinary CR6 LOAD path materializes rows without an
L requirement; this is why the S-root context can execute both the initial
LOADs and reload. The regression verifies **current simulator execution**, not
FPGA conformance or permission to alter that behavior. A hardware-bound
implementation must independently establish its valid load/save context.

No M elevation, register M grant, permission-check override, compiler change,
or ISA-enforcement change is part of this correction. In particular, merely
adding `B` to a saved capability declaration or toggling a live token from the
host is not an approved implementation.

## Execution regression

Run:

```sh
node simulator/test_capabilitytest_save_roundtrip.js
# or the registered script-only suite:
bash scripts/run-all-tests.sh capabilitytest-save-roundtrip-tests
```

The test reads revision 39 without writing it, extracts its retained source,
and executes its five actual LOAD words through `ChurchSimulator.step()`.
Namespace entries and runtime grants are synthetic and exist only in that
test's memory; this is not a replay of the entire committed boot image.
The context starts post-boot with global elevation off and all register M bits
clear. Fault reporting stops the test core before recovery can obscure the
original PC and failure.

Coverage:

- Original operand order: BIND at PC 6, naming CR6.
- Swapped operands alone: BIND.
- Destination S without source B: BIND.
- Source B without destination S: PERMISSION.
- Both explicit grants: SAVE changes only the scratch row, LOAD retrieves the
  exact token, and TPERM EXACT sets Z=1.
- Even with both grants, a raw SAVE to row 0 faults IMMUTABLE_SELF_CAP.
- Rejected writes leave memory and operand registers unchanged; successful
  execution leaves BTN_DEV, TIMER_DEV and SELF unchanged.

The aggregate runner registers this as
`capabilitytest-save-roundtrip-tests`; the workflow sync configuration lists
it as script-only.

## Preservation and next action

No saved source, LUMP bytes, archive, manifest, namespace state, boot image,
running simulator session, or hardware state was edited. Revision 39 therefore
still contains the failing SAVE until the programmer explicitly adopts a
new reviewed revision.

Before adoption, design the trusted runtime provider and scratch-list lifetime
and layout, then review those grants and the resulting source diff. Never
substitute the regression's test-only grants into a live image automatically.