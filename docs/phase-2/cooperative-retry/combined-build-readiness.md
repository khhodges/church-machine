# Combined starter: build-readiness check

Date: 11 November 2026  
Status: **local candidate reproduced; not yet ready for vendor build**.
No ISA, executable application, hardware runtime or working-board changes.

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

## Build integration gaps

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

## Next steps

Confirm the physical maintenance control, then prepare an isolated board
wrapper/export with explicit clock, pin and safe startup behaviour. Validate
that integration before vendor tools. Disposition the outstanding transaction
boundary and execution-stop delivery checks before final candidate freeze.
Those checks are not claimed complete here.

Vendor synthesis/timing and physical demonstrations remain outstanding and
separate from this local readiness work. Preserve the working system and use
one final BIT identity for all three physical demonstrations.

References:
- [Combined exact-image review](combined-runtime-review.md)
- [UART qualification record](combined-uart-observation.md)
- [Starter runtime contract](starter-runtime-contract.md)
