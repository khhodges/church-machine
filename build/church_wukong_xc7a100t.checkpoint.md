# Wukong Build Checkpoint

Generated: 2026-08-27T14:13:27Z

## Verified v17 release candidate

| Field | Value |
|---|---|
| Release input commit | `12fd06ef649ce9c8fd243b288f3590188d785db9` |
| Hardware source fingerprint | `68cdfc50231cbb404a90ff1de467f0c5835f6767d526d9dee7dbaa0f75875879` |
| Sentinel | `0xBC`, N_INIT `610`, TU_VERSION `0x02`, build version `17` |
| Vivado | v2026.1, SW Build 6511674 |
| Final setup WNS | +1.924176 ns |
| Bitstream | 3,826,002 bytes; SHA-256 `4818bfea493f1493534b3443a46257c3a984e3c2fbc1a05b72db63bd12e862a2` |
| SPI image | 10,521,876 bytes; SHA-256 `b54fc8246a25bcc7033904226f6e45032053dbafb67c0201a9f80aa3d0fd0a01` |
| Provenance | `release_status: verified`; verified from the clean, commit-pinned checkout |

The generated RTLIL and Verilog were freshness-checked before Vivado. Vivado
completed synthesis, implementation, bitstream generation, and SPI-image
generation with `EXIT_0`.

## Physical board status

The release candidate has **not** been flashed from the build host: its USB
inventory contains no JTAG or USB-UART device. Consequently, no v17 board
sentinel, boot, upload, or post-upload smoke result has been recorded yet.
Do not describe this candidate as flashed until the physical board reports the
expected v17 sentinel and the upload smoke check succeeds.

## Release input boundary

The candidate was built from hardware-only commit `12fd06ef…`; mutable
`server/lumps/` library content was not part of that hardware release input.
The detailed, machine-verifiable record is
`church_wukong_xc7a100t.provenance.json`.