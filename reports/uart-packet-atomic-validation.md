# UART packet-atomic correction — validation status

## Implemented correction

The UART arbiter now retains a producer until its last accepted packet byte.
Priority selects the next packet, not the next byte. Banner, boot sentinel,
upload acknowledgement, Halt evidence, snapshots and traces all use the same
acceptance handshake. CPU console writes are buffered while another producer
owns the UART; the UART status register includes queue backpressure.

No physical board commands, uploads, programming or Namespace edits were made
while implementing and testing this correction.

## Focused checks

- Full-top in-flight trace/Halt regression: **PASS**, previously red.
- Full-top Halt evidence and missing-nonce recovery: **PASS**.
- Packet arbitration, priority arrivals, UART busy gaps, producer pauses and
  queued console pulses: **PASS**.
- Bridge command acknowledgements and snapshot-protocol tests: **PASS**.
- Upload framing/watchdog checks: **PASS**, except the existing image-selection
  fixture failure listed below.
- RTLIL/Verilog generation for the isolated candidate: **PASS**.

Across the two related suites and the additional buffered-console check:
**90 passed, four failed**. The four failures were independently reproduced
with the unchanged pre-correction transmitter:

1. Step/Run fixture: final pause remains pending, expected `(1, 1)`, got `(1, 0)`.
2. Reboot fixture: expects historical WukongCallHome entry `0x704`, but current
   factory context enters `0x2E08`.
3. Physical upload projection fixture: requests boot slot 6 while the saved
   Namespace authoritatively selects slot 10.
4. Sentinel fixture: expects the sentinel as the first bytes collected after
   sending Reboot; an earlier draining trace precedes it.

These are not new failures caused by the UART correction. They remain failures,
not waived passes. No fixture Namespace was changed and no assertion weakened.

## Isolated exact-image candidate

Directory: `generated-artifacts/uart-packet-atomic-validation`

Archive SHA-256:
`ed321982b40ece12ecf53c8909ef97359d650368b49ec1106b2f1a36d90d7cbc`

Approved image SHA-256, unchanged:
`e8ba3755a56fa69308de1154e442529b6cadef6a8a98e10b6976a09137fe9102`

The original frozen top matches the pre-correction production top byte-for-byte.
The new package preserves the separately validated initializer overlay, adds
the corrected top and UART arbiter, and records exact source hashes in
`provenance.json`. The prior frozen package is untouched.

The new preparation option is:

```
python3 scripts/prepare_combined_continuation_validation.py OUTPUT --uart-packet-atomic
```

`OUTPUT` must be a new directory. Preparation produces isolated sources,
generated RTL and validation runners, not a bitstream or board operation.

## Outstanding build gates

- Exact-image bounded recovery replay: **PASS**. The isolated `run-model.sh`
  exited 0, printed `COMBINED_MODEL_RECOVERY_PASS`, and completed its final
  input checksum verification.
  - One expected fault, code 8, at cycle 1,890,181 after 1,795 retirements.
  - Run could not bypass the fault.
  - A complete snapshot preceded authorization and reset.
  - Boot completed after authorization.
  - Exactly 100 post-recovery retirements; the third was at `0x2870`.
  - Approved image hash remained unchanged; `physicalBoardTested` is false.
  - After the pass marker, Python printed an ignored coroutine-cleanup
    `RuntimeError: aclose(): asynchronous generator is already running`.
    This happened during capture-coroutine teardown, not a failed replay
    assertion. The warning is retained in the log; this is not a warning-free
    run. The wrapper subsequently finished all checksum checks and exited 0.
- Vendor synthesis/mapped boot validation: **PASS, reported by the operator's
  terminal capture** in
  `attached_assets/Pasted-root-ubuntu-s-4vcpu-8gb-nyc3-dir-ls-td-HOME-uart-valida_1793357372884.txt`.
  The run directory is
  `/root/uart-validation.uAebUc/uart-packet-atomic-validation`.
  - `COMBINED_SYNTH_EXPORT_COMPLETE`
  - `COMBINED_VENDOR_BOOT_PASS: entry=00004610 cycles=211530`
  - `COMBINED_VENDOR_VALIDATION_PASS`
  - Final checksums show the mapped netlist, boot testbench and synthesized
    checkpoint unchanged; the process listing contains no active vendor jobs.
  This is vendor-mapped startup evidence, not a routed timing or physical-board
  pass. The complete remote logs/checkpoint have not been copied into this
  workspace.
- Placement/routing, timing/DRC and replacement BIT generation: **not run**.
- Physical programming and startup/control verification: **not run**.

Vivado is not available in this workspace. Vendor validation ran in the
established build environment. Both the exact-image recovery replay and
vendor-mapped startup have now passed, but placement/routing, timing and physical
acceptance remain outstanding. Preserve the verified synthesis checkpoint for
the build-only stage; no previous candidate's timing or hardware pass transfers
to this change.

## Build-only handoff

The operator approved proceeding with implementation and experimental BIT
generation, not board programming. The separate build tools are packaged at
`generated-artifacts/uart-packet-build-only.zip`, SHA-256
`6793b1dbde9f4366ea4837cbfc945d7fdd758145bd54124edecc68e73ac43b95`.

The runner pins the exact validated input manifest and includes hash-pinned
local model results/log. On the vendor host it verifies the mapped startup,
synthesis and checksum evidence, then copies the validated checkpoint and
evidence into a new build directory. It preserves the original validation
directory, refuses overwrite and acquires the existing shared build lock.
The older combined-candidate gate retains its historical pins; a distinct UART
gate validates the new evidence format.

66 offline tests passed: 25 UART handoff tests and 41 existing combined/route
gate tests. They cover evidence tampering, recovery conditions, wrong package
identity, duplicate/missing pass markers, checkpoint substitution, copied
evidence, no-overwrite preparation, isolated imports, shell syntax, and the
unchanged pre-bitstream timing/DRC/clock checks. These are runner tests, not a
claim that placement/routing or BIT generation has run.

The inherited implementation Tcl opens `input.dcp` directly; it does not
synthesize or generate a Namespace image. It verifies board/clock constraints,
performs placement/routing, requires passing DRC and setup/hold/pulse checks,
then generates the experimental BIT and a hash-bearing receipt. No board or
flash commands are included.
