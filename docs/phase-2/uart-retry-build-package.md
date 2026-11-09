# UART receive-and-retry build-only export

Prepared 2026-11-09 from the isolated candidate in
[local preparation](uart-retry-diagnostic-preparation.md).
No remote builder, Vivado build, hardware programming, reset, serial transfer,
or persistent flash operation was performed.

## Exact export identity

Archive: `generated-artifacts/uart-retry-build-only.zip` (3,486,705 bytes).
Extracted directory: `generated-artifacts/uart-retry-build-only`.

| Input | SHA-256 |
| --- | --- |
| Archive | `f8e6eb98a8190973c989544b1edc330118f0b288995fb70a9be7bd7fee117fe2` |
| `manifest.json` | `9282796db360f96a5f54911d7c80654d280771e4645e88d321aa3d375ea08512` |
| Source file map | `b7a3aaa81329bbe6d7d83401a0ff42cf7680032d8d912a5c703ba5504a3205a1` |
| `candidate-le.bin` | `930c435ece1ffc91975cd6697d5b08ac445580903bd0e5568237e99e3af59aa7` |
| `fixed-frame.bin` | `e5c4b31714c214060cf7f66d2cdf5273b1adc961b75bf4ffeef905baa88a3cca` |
| Exported Verilog | `68ed24c5b38d451dd8060a8dab57b09c10866d1e52e6860272d1607232414fe3` |
| Exported RTLIL | `d168825b430b051491531953b5be56b4aec4dc266a61bb7f506770debc12fb55` |
| Private `hardware/wukong_top.py` | `495eb41b5e1b30070ba83d263fbe181d891403a85fbde9bd00cb8d94e181af67` |
| Private `hardware/uart_retry_receiver.py` | `ac8eef22d0a0e671ec14645c46e65ce7199b22f5cdef5c6f11bbb1701c9246de` |
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
file map, including the receiver helper. It required the retained **22 passing
UART cases and two passing receiver-disabled cases** before export.
Those behavioral tests were not rerun; their matching evidence is included.
The retained full log contains the two documented coroutine cleanup warnings.

Only the **new export's private image-admission digest** was changed to accept
the exact UART fixture. The candidate, earlier packages, and production RTL
were not modified. RTLIL/Verilog generation then succeeded with UART receive
enabled and the terminal RETURN diagnostic stop enabled.

Six offline export checks passed:

- extracted-package verification outside the project;
- complete file hashes and source map digest;
- rejection of altered image, frame, Verilog, receiver and route script;
- source imports with only packaged project modules and installed dependencies,
  exact-image admission, and rejection of a modified image;
- rejection of missing/ambiguous/negative timing and failing endpoint counts;
- shell syntax, override rejection, and runner/gate wiring checks.

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
Partial frames wait indefinitely. Invalid or excess input before claim fails
closed, including claim-cycle collisions. After claim the buffer is immutable
and later bytes are ignored; there is no second frame or rearm.

There is no execution watchdog or receive timeout. Expected terminal evidence
remains reason 3, NIA `0x400C`, CR12 `0x02070004`, DR12 13.
Do not send the frame to the currently installed BIT. No physical transfer,
UART noise/framing-error qualification, timing closure, or board acceptance is
established by this export.
