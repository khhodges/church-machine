# UART developer upload — offline implementation and validation

Date: 2026-10-30.

## Scope and result

Implemented a native-image path for the tested Amoeba retry BIT. No FPGA build,
board command, runtime-memory replacement, fault release, installation approval
record, or flash write was performed. The legacy projection remains separate.

Required BIT SHA-256:
`a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e`.

The Builder's approved Namespace controls now have:

- **Check UART Image**: inspect the selected retained revision offline, without
  requiring or contacting a physical target.
- **Install UART Image**: repeat validation, identify the target, obtain explicit
  runtime-replacement consent and submit only if installation/stop evidence passes.

No browser-provided image, filename, or installation attestation is accepted.
Both operations retain the existing approved-hardware revision gate. A
design-only profile approval or simulation approval is insufficient. The
previous isolated retry fixture was not silently published as an approved
Namespace revision by this work.

## Format and transport

Native bytes must be exactly 64 KiB, pass the existing ascending Namespace
validator, and contain the version-zero self/entry-Thread required by this BIT.
Preparation does not relocate, recompile, reseal, normalize, or substitute
selected artifacts. Runtime checks remain authoritative for execution.

The tested BIT also reads word 255 during upload as a legacy M6 scheduling
control. That scheduler assumes Thread 1, whereas native startup uses Thread 2.
This path requires word 255 to be zero, preserving the tested candidate's
behavior. Programs retain their own explicit CHANGE scheduling. This is not
qualification of M6 Thread cycling for the native profile.

The bridge receives the unchanged little-endian image and converts each word to
big-endian UART order. It sends `u`, a four-byte big-endian byte count, and the
payload. On ACK, the explicitly requested installation sends `f` to reboot.
It never sends recovery authorization `g`. Reboot can begin execution; the UI
warns that runtime data and Thread progress are discarded.

The board's ACK is transfer completion, **not** a cryptographic memory readback,
startup success, or software/hardware equivalence result.

## Installation evidence

The server reads trusted operator evidence from
`build/uart-profile-installation.json`. No API creates this record.
Its schema is `church.uart-profile-installation/v1`, with:

- `profile`: `amoeba-retry-25mhz-uart-v1`
- `bitstream_sha256`: the exact BIT above
- `operator_verified_installation`: true
- `device_uid` and `bridge_session`: the selected active target
- `expires_at`: a finite Unix timestamp within the next five minutes

This is operator installation provenance, not live UART hash attestation.
Do not populate it from a build-number sentinel or browser claims.
The code also requires an empty queue, no existing upload, and a board-confirmed
STOP from that same target within ten seconds. A fault hold is not a STOP
acknowledgement. Fault recovery remains a separately authorized operation.
Reconnects require new target-specific evidence.

## Offline results

- 58 Python tests passed across the new profile path and retained guarded loader.
- 75 existing command-delivery and bridge-target-routing tests passed.
- Both Node UI suites passed: new UART prepare/install and existing image install.
- Real bridge encoding was exercised against fake serial/network endpoints:
  every word matched; only the upload frame and requested reboot were written.
- The exact retry image passed native preparation unchanged:
  SHA-256 `5603d8e105e47ca0f6524e4553989387c088de19ac0e6b3f6fd9897e170cf16d`.
  Entry slot 21; Thread locations 2→256, 11→3072, 12→3328 (word addresses).
- The frozen production upload FSM accepted the full image **twice**. Both
  transfers wrote all 16,384 words at exactly the expected addresses, with exact
  data, no early ACK, and no extra writes while ACK acceptance was delayed.

Reproduce:

```sh
python3 -m pytest tests/server/test_uart_profile_install.py tests/server/test_guarded_runtime_reload.py -q
python3 -m pytest tests/server/test_wukong_command_delivery.py tests/hardware/test_wukong_bridge_target_routing.py -q
node simulator/test_uart_profile_install.js
node simulator/test_namespace_image_install.js
python3 scripts/check_uart_profile_frozen.py \
  --source generated-artifacts/amoeba-retry-bitstream/source-snapshot \
  --image generated-artifacts/amoeba-retry-bitstream/candidate-le.bin
```

The frozen replay pins upload-source SHA-256
`e53518f1c77869d1a880d567626d04fc27e7b847f0e9d7ff4590d366d30a1779`.
It drives decoded UART bytes through the actual frozen state helper. It does
not simulate serial-pin timing, the entire FPGA, or CPU startup after upload.
The existing startup/retry evidence remains separate.

## Remaining handoff acceptance

Before a physical test, select or explicitly approve a retained native hardware
Namespace revision and verify the actual Windows bridge and installed BIT.
Then, with separate physical-operation approval, test load/run, a newly approved
program revision, reload/run, and explicit fault recovery through the IDE.
Only afterward generate/approve the MCS provisioning and cold-boot handoff test.
No new synthesis requirement was established by this offline work.

H19 register-state differences remain unresolved; this work does not close H19,
H20, full security qualification, or the UART-only developer handoff.
