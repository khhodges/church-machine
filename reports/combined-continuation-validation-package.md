# Isolated combined validation package

This package combines the previously validated address-issue initializer with
the frozen continuation-corrected sources and unchanged admitted 64 KiB image.
It contains no routing, bitstream-generation, programming, or live-data commands.

## Gates

- The only logic delta from the prior frozen source archive is the initializer
  overlay. Existing initializer outputs also receive diagnostic keep attributes,
  explicitly recorded in provenance; there are no added board ports.
- All inherited frozen files, supplemental imports/shared contracts, import-only
  factory context, generated RTL, and scripts are hashed.
- Vendor runner: synthesize the complete design, export a functional netlist,
  then verify all 2,460 initializer address/data pairs and successful boot at
  25 MHz. Missing mapped observations and X/Z values fail closed.
- Model runner: exact-image simulated UART fault/recovery, requiring the expected
  Mallory fault, complete snapshot, reset, and 100 post-recovery retirements.
  This is explicitly not a vendor-synthesized continuation test.

## Local verification

- Eight observer/packaging regression tests passed, including wrong first and
  last words, unknown data, wrong startup entry, faulted startup and missing
  observation signals.
- Shell runner syntax and Python compilation passed.
- Combined full-top Amaranth boot reached 0x4610 at cycle 10,691 with accelerated
  simulated UART. The image's Thread root entry GT names NS21; its method-1
  table independently derives this same address.
- An initial observer draft mistakenly used CapabilityTest's entry 0x2810.
  The local model caught it; the delivered observer uses the actual startup
  entry 0x4610. Recovery's first resumed program address remains 0x2870.
- Vendor synthesis/replay, the full combined bounded-recovery run, timing,
  physical testing, and any new bitstream are not claimed.

## Handoff

Archive: generated-artifacts/combined-continuation-validation.zip.
Extract to a fresh directory on the Vivado host. Source Vivado settings64.sh,
then run `bash run-vendor.sh`. The separate `bash run-model.sh` requires the
Python dependencies pinned in requirements-model.txt.

Both runners verify the complete input checksum list before and after running.
Preserve their logs. One runner's pass does not stand in for the other.
No release or board-programming approval is granted by this package.

## Droplet follow-up evidence

The user supplied COMBINED_VENDOR_VALIDATION_PASS and exit code 0 after
moving the observer counter declaration before its first use. The original
synthesis outputs were reused and checksums verified; no new BIT was generated.

The model then failed before simulation: first missing Amaranth, then missing
the project module server.lump_approvals. The latter exposed repository import
leakage in local packaging checks. The separately hashed combined-model-support.zip
provides the real server package initializer, approval helper, deferred IDX1
validator, and a model-only runner. It adds no files inside the frozen snapshot.
Its clean subprocess import check passed without repository paths or inherited
secrets; original package checksums remained valid. Nine observer tests passed.
Full model recovery remains pending; import success is not recovery evidence.
