# UART receive-and-retry: physical terminal result

Date: 2026-11-10 UTC (2026-11-09 operator local time).

**PASS for the bounded UART receive-and-retry terminal checks.**
This is not general DELIVER, sender authentication, or production qualification.

## Evidence and identity

The operator approved and performed temporary JTAG programming. The supplied
Vivado output reports startup HIGH. The operator's download output confirms
the BIT and fixed-frame checksums matched the supplied expected values.
Association with this run rests on those operator records and the build receipt,
not FPGA readback. No persistent-flash operation was authorized or reported.

| Artifact | SHA-256 |
| --- | --- |
| Build package | `b6edad1cca275f12b9d2e4cd35d09442788e76b3050a8d57a05423a3729e1eae` |
| Manifest | `17ffc39b0e1954fabb55e0e0c3dcc70be0464b7e81945e4124b63a5e9397c824` |
| BIT, receipt-recorded and operator hash-checked | `9abf7430f0766854c0bd222ff5ef07ef539c484b4df7b4a329ed8045bab12284` |
| Fixed UART frame | `e5c4b31714c214060cf7f66d2cdf5273b1adc961b75bf4ffeef905baa88a3cca` |
| Uploaded capture | `0679a24b7418c8ab99e6375501717766022e1ca48a1f72df5ffd6fb8fa4c9d68` |

The uploaded build receipt matches the locally verified package manifest,
source map, image, frame, and diagnostic flags. Reported setup/hold/pulse
slacks are +4.379/+0.011/+7.000 ns, with zero failing endpoints. The supplied
build log contains the final PASS marker and zero pre-bitstream DRC errors.
Report and checkpoint hashes are receipt evidence, not independently rehashed
uploaded report/checkpoint files.

## Capture result

File: `attached_assets/uart-capture-20261109-210642_1794276479335.bin`.

- Total: 674 bytes.
- Snapshot begins at offset 382 and occupies the final 292 bytes.
- Header: `ac01011c`.
- CRC-16 checked over the complete snapshot excluding its final two CRC bytes,
  using initial value 0xFFFF: valid.
- Reason: 3.
- NIA: `0x400C`.
- Live CR12: `0x02070004`.
- DR12: 13.
- No bytes follow the terminal snapshot in this capture.

An earlier uploaded capture was empty. The operator's screenshot showed that
the serial write failed because the port was closed. That session is not pass
evidence. The successful capture followed instructions to reopen the UART,
send the verified frame once, and collect for 15 seconds without reprogramming.

## Interpretation and limits

The valid terminal snapshot matches the exact UART diagnostic's expected
result. Together with the local full-top RTL evidence and operator programming
record, it supports the bounded external-receive, SYSTEM copy/publication,
USER resume, and successful CALL/RETURN sequence.

The snapshot alone does not prove every intermediate write or identify the
installed BIT. Physical malformed-input, post-claim one-shot immutability,
baud-margin, and analog-noise tests are not established by this successful
frame. The diagnostic still disables normal debug commands and has no
execution watchdog or receive timeout. Build receipt flags remain unchanged.

See [build package](uart-retry-build-package.md) and
[local preparation](uart-retry-diagnostic-preparation.md).
