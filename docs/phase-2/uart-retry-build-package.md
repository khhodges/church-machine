# UART receive-and-retry build-only export

Prepared 2026-11-09 from the isolated candidate in
[local preparation](uart-retry-diagnostic-preparation.md).
No remote builder, Vivado build, hardware programming, reset, serial transfer,
or persistent flash operation was performed.

## Exact export identity

Archive: `generated-artifacts/uart-retry-build-only.zip` (3,487,874 bytes).
Extracted directory: `generated-artifacts/uart-retry-build-only`.
This line-error-aware export supersedes the earlier archive
`f8e6eb98a8190973c989544b1edc330118f0b288995fb70a9be7bd7fee117fe2`.
That earlier export does not contain the tested UART error latch; do not use
it as evidence of fail-closed line-error handling.

| Input | SHA-256 |
| --- | --- |
| Archive | `b24949d5444a2e0771737019a8427be06da97dd33c8882267b15aaa0c9940a27` |
| `manifest.json` | `5271cc9540ce8da30e29fe68e338851b03a3cc4da8ce2f47ab5b8278a35753b7` |
| Source file map | `2d2dc1f772dcc7ae4f4136ebb37796d7e2bb7620392a47731f9ddac0beafde1c` |
| `candidate-le.bin` | `930c435ece1ffc91975cd6697d5b08ac445580903bd0e5568237e99e3af59aa7` |
| `fixed-frame.bin` | `e5c4b31714c214060cf7f66d2cdf5273b1adc961b75bf4ffeef905baa88a3cca` |
| Exported Verilog | `95fbbbf52fcb29df719a7fab297e63f26e40ebc153403ac082353eb772ae152d` |
| Exported RTLIL | `7d75575f56a768bc9a8420ad6b62b662ea477837be704da65d8d8aa66bf85547` |
| Private `hardware/wukong_top.py` | `aa9dd5a5d1e37047370b6dc6097e8f1dc7ee8381201de4f8b8f58b4d071c6b40` |
| Private `hardware/uart_retry_receiver.py` | `51bc50aaab7eccae763198be88b84e1baf8faa6a128750a2ab784fa697e12b8a` |
| Private `hardware/guarded_build_profile.py` | `5400be6b87e5e81d4d98195adb7ad249f9e18533ac15305f93d9b2f80b15f85e` |

The source map digest is SHA-256 of `manifest.sourceFiles` serialized as
sorted-key JSON with separators `(",", ":")`, UTF-8. The manifest individually
hashes every packaged input, including sources, evidence, constraints, runner,
generation script and exported RTL. It also records the tested source map
before the private admission-digest change.

## Preparation and verification

The exporter verified every retained local evidence hash and the frozen
copy/retry parent manifest. It reconstructed the top-level source from that
parent plus the retained UART patch and checked the complete candidate source
file map, including the receiver helper. It required the new **46 passing
UART cases and two prior passing receiver-disabled cases** before export.
The extended UART suite was run against the updated isolated candidate;
the receiver-disabled regression evidence is retained from the earlier run.
The source, patch, tests, preparation document, and result/log hashes are bound
in `evidence/uart-line-errors-hashes.json`.
The retained full log contains the two documented coroutine cleanup warnings.

Only the **new export's private image-admission digest** was changed to accept
the exact UART fixture. The candidate, earlier packages, and production RTL
were not modified. RTLIL/Verilog generation then succeeded with UART receive
enabled and the terminal RETURN diagnostic stop enabled.

Eight offline export checks passed:

- extracted-package verification outside the project;
- complete file hashes and source map digest;
- rejection of altered image, frame, Verilog, receiver and route script;
- source imports with only packaged project modules and installed dependencies,
  exact-image admission, and rejection of a modified image;
- rejection of missing/ambiguous/negative timing and failing endpoint counts;
- shell syntax, override rejection, and runner/gate wiring checks.
- current receiver/top error wiring and 46-case line-error evidence binding.
- registered Library download hash and size match the locally verified archive.

Run these checks with:

```sh
python3 scripts/test_uart_retry_build_export.py -v
```

The preparer is `scripts/prepare_uart_retry_build_export.py`. It refuses to
overwrite an existing export or archive. It needs the retained parent and local
candidate evidence; it is not a production-source rebuild tool.

## Manual build handoff

The user performs the build only after separate approval. Transfer the archive
and compare its SHA-256 above through a trusted channel. Extract into a **new**
directory; never overlay a previous build. From the extracted package directory,
after sourcing Vivado **2026.1** `settings64.sh`:

```sh
python3 verify.py
bash run.sh
```

Use the included exported RTL, not a regenerated design. The runner takes the
shared `$HOME/wukong-vivado-build.lock`, rejects arguments, verifies inputs before
and after phases, and applies 120-minute synthesis and 240-minute implementation
limits. Do not remove the lock or weaken checks after failure.

Profile: **XC7A100T FGG676-2**, 50 MHz board input, 25 MHz MMCM-derived internal
clock, **57600 baud**, boot guard **23971**. The runner retains exact board-pin
and clock-tree checks, enabled Error-severity NSTD/UCIO checks, routed DRC Error
rejection, unrounded setup/hold slack gates, and design-wide setup/hold/pulse
endpoint checks before writing the bitstream. These gates are prepared, not a
claim that this new design has passed vendor timing or DRC.

Successful completion prints:

```text
UART_RETRY_DIAGNOSTIC_BITSTREAM_BUILD_PASS
```

Retain `build-receipt.json`, both build logs, `synthesis.sha256`, the checkpoints,
`candidate-EXPERIMENTAL.bit`, and timing, precise-slack, DRC, route-status and
utilization reports. The receipt binds output hashes to the input manifest,
image, fixed frame, source digest and Vivado version. Review these before any
separate physical-test approval. No device-control instructions are included.

## Diagnostic boundary

**All debug commands are disabled**, including Run, Halt, Step, Reboot, Upload
and recovery. This is not a normal bridge-pairing profile.

The only accepted frame is the supplied 30-byte fixture: `URX1`, big-endian
length `0x0014`, the five documented payload words, then `END!`. This is exact
diagnostic allowlisting, **not general DELIVER or cryptographic authentication**.
Partial frames wait indefinitely. Invalid or excess input and reported UART
framing errors before claim fail closed, including claim-cycle collisions.
Idle time or later exact frames cannot clear rejection. After claim the buffer
is immutable and later bytes/errors are ignored; there is no second frame or rearm.

There is no execution watchdog or receive timeout. Expected terminal evidence
remains reason 3, NIA `0x400C`, CR12 `0x02070004`, DR12 13.
Do not send the frame to the currently installed BIT. No physical transfer,
analog UART noise qualification, baud/phase tolerance, timing closure, or board
acceptance is established by this export. Selected digital serial-pin framing
errors, break, false starts and sampled data noise passed the isolated tests;
that does not authenticate external delivery.
