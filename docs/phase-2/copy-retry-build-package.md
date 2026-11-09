# Copy-and-retry build-only package

Prepared 2026-11-09. No vendor build or physical test performed.

- Archive: `generated-artifacts/copy-retry-build-only.zip`
- Size: 3,457,698 bytes.
- Archive SHA-256:
  `b99f7134ca410f796fb0eef321a550e145729be9e01b57a4f4584749e6ebc2a2`
- Manifest SHA-256:
  `0eae684c105b6f26a4cd645c44631360325e69dab303ed37b6c64e9d4fdf5a9f`
- Image SHA-256:
  `99a67ec2ca9ab7638d3a2ca0e6b74fc74c3800a8409fb484f601727fc81b3f02`

Local RTLIL and Verilog export succeeded for XC7A100T FGG676-2, 50 MHz
input, 25 MHz internal clock, UART 57600 baud, boot guard 23971.
The existing terminal RETURN diagnostic stop remains enabled; watchdog absent.
The source snapshot differs from the prior package only in its private
exact-image admission digest. Previous package and production RTL are unchanged.

Included evidence: six passing full-top RTL tests, their source, preparation
record, local image/test hashes, and a complete package file-hash manifest.
The verifier passed and independently rejected modified image and Verilog
files. Shell syntax, ZIP CRC, and every archived manifest file hash passed.

The retained vendor runner preserves the shared build lock, Vivado 2026.1
requirement, 120/240-minute phase limits, board and clock constraints, DRC
error gates, precise setup/hold checks, and design-wide timing checks.
Completion marker: `COPY_RETRY_DIAGNOSTIC_BITSTREAM_BUILD_PASS`.

The user operates the droplet manually, extracting into a fresh directory.
No device programming, reset, upload, or persistent-flash operation is included.
Build success must be reviewed before separate physical-test approval.

See [local preparation](copy-retry-diagnostic-preparation.md) for exact fixture
behavior and limits: this is fixed memory-to-memory copying, not external
fetching, authenticated admission, or full DELIVER.
