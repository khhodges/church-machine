# Combined starter: build-readiness check

Date: 11 November 2026  
Status: **frozen combined vendor package and local Verilog conversion verified;
vendor build not authorized or run**.
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

## Frozen vendor package — local preparation result

The exporter now includes RTLIL-to-Verilog conversion, a local-only,
authorization-gated Vivado driver, fixed-part vendor Tcl, and fail-closed
clock/pin/timing/DRC checks. See [package instructions](combined-vendor-build.md).
The old diagnostic top is not used. Functional/CDC attributes survive conversion;
absolute source locations are omitted so fresh export directories reproduce RTL.

Local frozen output: `generated-artifacts/combined-vendor-final-4019`
(generated output is intentionally excluded from Git; use the committed exporter
and instructions to reproduce it).

- Board source identity:
  `8efe2afefc707c20f5307eb280c02341823084d5c11a2df16f0da89fb2f4e1d0`
- RTLIL identity:
  `5e6fe852c9769f9142942e0598f101d8b98c6581ca44efc238a4ce69e8943778`
- Verilog identity:
  `64d21092a115b428e29b169e73ca613267d490caf0f37830cce3e2ce8ddc9850`
- Qualified runtime identity remains:
  `a6e6223126248bf4ac07edabe891f3cfd123ce0865d5bcc5d06b8fe2c08de8d7`
- Local toolchain: Python 3.12.11, Amaranth 0.5.9, Yosys 0.51
  (`c4b5190229616f7ebf8197f43990b4429de3e420`).

Validation:

```sh
python3 -m pytest docs/phase-2/cooperative-retry/test_combined_vendor_package.py -q
# 60 passed: fresh-package reproducibility, frozen input/RTL tamper rejection,
# profile and authorization rejection, modeled Tcl clock/pin/timing/DRC gates,
# BUFGCTRL expansion and explicit enforcement of Vivado DRC policy.

cd generated-artifacts/combined-vendor-final-4019/source
python3 -m pytest \
  /home/runner/workspace/docs/phase-2/cooperative-retry/test_combined_board.py -q
# 2 passed: held maintenance behavior and unchanged runtime/pin/clock profile.
```

The Tcl tests exercise real gate procedures against modeled query results, not
Vivado or physical clock behavior. They do not certify vendor command/property
compatibility. No vendor timing/DRC success receipts or BIT exist yet. The build
will create those only after authorization and successful routed checks, binding
their hashes to the exact package, converted RTL, toolchain and BIT. Missing or
unrecognized evidence is a failure, never an inferred pass.

The final package incorporates the retained Artix-7 clock-check evidence:
Vivado may expand BUFGCE into BUFGCTRL. Both forms are checked; the expanded
form must retain synchronous arm-0 enable, the BUFGCE legacy identity and
the required inactive-input constants. The build explicitly enables NSTD-1
and UCIO-1 and sets their severity to Error rather than assuming the
post-synthesis default is Error.

## Remaining authorization and qualification steps

Obtain explicit exact-package vendor-build authorization and establish the
authorized toolchain/build environment separately. No remote host was contacted.
Confirm experimental-board identity before any physical work.
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
