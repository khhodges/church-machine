# Combined starter: build-readiness check

Date: 11 November 2026  
Status: **isolated pushbutton board wrapper and RTLIL export verified locally;
vendor build not yet run**.
No ISA, executable application, qualified runtime-body or working-board changes.

## Verified in this check

- Prepared a fresh isolated candidate with `prepare_combined.py` under
  `generated-artifacts/combined-build-readiness-20261111`.
- The 128-file source/configuration manifest reproduces the UART-qualified
  identity exactly:
  `a6e6223126248bf4ac07edabe891f3cfd123ce0865d5bcc5d06b8fe2c08de8d7`.
- Both application hashes still match the approved combined inputs.
- Ran the newly merged seeded UART/copy-interleaving checks against this
  prepared candidate: **7 passed, 10 deselected, 5.69 seconds**.
- The long three-flow UART qualification was not rerun: the reproduced runtime
  identity matches its recorded qualification. This does not certify a future
  board wrapper or physical configuration.

## Initial build integration gaps

1. **Physical maintenance control:** StarterTop exposes and synchronizes
   `maintenance_enable`, but does not assign a board pin. Its active/inactive
   electrical state and operator control must be established. Do not tie it
   permanently high or make it UART-writable to bypass this gate.
2. **Clock wrapper:** StarterTop expects a clock matching its configured
   25 MHz timing. The retained Wukong constraints describe a 50 MHz input.
   The older exporter uses an MMCM-equipped Wukong top; it cannot simply be
   substituted with StarterTop without a correctly constrained clock wrapper.
   UART timing and the one-second watchdog depend on this.
3. **Combined export path:** The existing export_build.py and retained generator
   build older diagnostic tops/variants, not the combined StarterTop with its
   approved LUMP/caller records and UART observer. A dedicated frozen combined
   board export and manifest are needed. Do not reuse old build receipts as
   evidence for this candidate.
4. **Vendor/target gate:** Vivado was not found on the local command PATH.
   Remote build-host availability was not tested. Confirm the authorized build
   environment and experimental board separately; no board was selected or
   contacted by this check.

The maintenance control must remain deliberately asserted throughout image
replacement, validation and START, then be released for LUMP delivery. At
57,600 baud, the 64 KiB payload alone takes at least 11.38 seconds. A momentary
button therefore requires a sustained hold; it is not a one-press toggle.
The physical control must not also reset the transport while held.

## Pushbutton integration — local result

The user selected the onboard pushbutton. Project board records identify
Wukong V3 Key1 as active-low M6. The isolated `CombinedStarterBoard` maps this
input only to maintenance, not reset or the production Thread scheduler.
The qualified runtime remains byte-for-byte unchanged; its existing synchronizer
handles the input. This is a held level, with no toggle or automatic reassertion.
Allow the button to settle before sending BEGIN; a contact interruption during
upload fails closed rather than being masked by a maintenance latch.

The board wrapper reuses the retained `WukongClock25` MMCM/BUFGCE circuit:
50 MHz input, 25 MHz execution, clock output enabled by MMCM lock. The dedicated
XDC binds M21 clock, M6 maintenance, F3 UART RX and E3 UART TX, with M6 pulled up
to its inactive state. Vendor timing and physical electrical behaviour remain
unverified for this combined wrapper.

Reproduce a fresh isolated package and local RTLIL export:

```sh
python3 docs/phase-2/cooperative-retry/export_combined_board.py \
  --output generated-artifacts/combined-board-NEW
python3 generated-artifacts/combined-board-NEW/generate.py
ROOT="$PWD"
cd generated-artifacts/combined-board-NEW/source
PYTHONPATH="$PWD:$PYTHONPATH" python3 -m pytest \
  "$ROOT/docs/phase-2/cooperative-retry/test_combined_board.py" -q
```

Recorded output: `generated-artifacts/combined-board-button-20261111`.
Two focused tests passed in 3.57 seconds: active-low control, unauthorized BEGIN,
held transport state, early-release failure, no automatic retry, explicit fresh
epoch, runtime-source preservation and pin/clock metadata.
Full board RTLIL elaboration succeeded with the expected MMCM and four ports.
The simulation bypasses vendor clock primitives; it is not a behavioral MMCM
test, timing check or physical pushbutton demonstration.

- Board source identity:
  `6f67e3268ac6a98cd03aa26b5a51fce68e11e2cb8c52fce14970129b36a1999a`.
- RTLIL identity:
  `ea40cbf028507175c3aca40a7af729c9504c99766f3ed3738a916fa654ee833a`.
- Runtime source identity remains
  `a6e6223126248bf4ac07edabe891f3cfd123ce0865d5bcc5d06b8fe2c08de8d7`.

## Remaining steps

The package is a source/RTLIL export, not a vendor-build script or BIT.
Prepare the vendor conversion/build and fail-closed clock/constraint checks
against this exact wrapper, then obtain vendor-build authorization and confirm
build-host access. Confirm experimental-board identity before any physical work.
Disposition the outstanding transaction
boundary and execution-stop delivery checks before final candidate freeze.
Those checks are not claimed complete here.

Vendor synthesis/timing and physical demonstrations remain outstanding and
separate from this local readiness work. Preserve the working system and use
one final BIT identity for all three physical demonstrations.

References:
- [Combined exact-image review](combined-runtime-review.md)
- [UART qualification record](combined-uart-observation.md)
- [Starter runtime contract](starter-runtime-contract.md)
