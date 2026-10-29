# Corrected continuation bitstream build

The user approved making the bitstream after accepting one exact-image RTL
recovery. This does not authorize programming the FPGA or replacing live data.

## Prepared and verified

- Target: Wukong `xc7a100tfgg676-2`, approved 25 MHz internal clock.
- Input clock: 50 MHz; actual internal clock uses the existing MMCM profile.
- Image: the exact admitted 64 KiB image used in the accepted recovery replay.
- Image SHA-256: `e8ba3755a56fa69308de1154e442529b6cadef6a8a98e10b6976a09137fe9102`.
- RTL generation completed successfully with the corrected current sources.
- The package contains generated Verilog, frozen source files, exact image,
  accepted Amaranth replay evidence, board constraints, build script, and verifier.
- Timing and DRC checks are unchanged; two Vivado worker threads.
- This is not generated-Verilog/vendor-simulation evidence or physical acceptance.

Archive:
`generated-artifacts/factory-continuation-bitstream/factory-continuation-build.tar.gz`

Archive SHA-256:
`eb491fd72fed35b68d1440801700ae2c682fed30de89c088e5bcd1ed8999b4f8`

## Vendor build status

Workspace SSH access using the two saved droplet credentials failed. The user
established access from their own terminal, uploaded the archive, and verified
its checksum and package inputs.

The uploaded terminal transcript confirms Vivado 2026.1 started successfully
and launched `synth_1` on 2026-10-29 at 11:07:05 UTC, in:
`/root/continuation-build.uaj0Xd/factory-continuation-build`.
It reports a valid license and no actual build error in the supplied excerpt.
The printed Tcl `error` statements are script definitions, not raised errors.

Synthesis completion, implementation, timing/DRC success, and the bitstream
remain unverified. No `.bit` file or successful build receipt is claimed.
Evidence: `attached_assets/Pasted-root-ubuntu-s-4vcpu-8gb-nyc3-continuation-build-uaj0Xd-_1793272091399.txt`.

## Manual build handoff

Download the archive from the workspace Files pane. In Windows PowerShell,
assuming it is in Downloads:

```powershell
Get-FileHash "$HOME\Downloads\factory-continuation-build.tar.gz" -Algorithm SHA256
scp "$HOME\Downloads\factory-continuation-build.tar.gz" root@165.227.190.84:~/
```

Compare the digest with the value above before transfer. On the build host:

```bash
cd ~
echo 'eb491fd72fed35b68d1440801700ae2c682fed30de89c088e5bcd1ed8999b4f8  factory-continuation-build.tar.gz' | sha256sum -c - &&
trial=$(mktemp -d "$HOME/continuation-build.XXXXXX") &&
tar -xzf factory-continuation-build.tar.gz -C "$trial" &&
cd "$trial/factory-continuation-build" &&
python3 verify.py
```

Confirm no existing Vivado build is running; do not kill or overlap another
build. Then, from that verified directory:

```bash
nohup flock -n "$HOME/wukong-vivado-build.lock" bash -c \
  'set -e; source /opt/Xilinx/2026.1/Vivado/settings64.sh; python3 verify.py; vivado -mode batch -source build.tcl -log vivado.log -journal vivado.jou' \
  > build.log 2>&1 < /dev/null &
printf 'Build directory: %s\n' "$PWD"
tail -f build.log
```

Stopping `tail` does not stop Vivado. Preserve a failed build directory.
Success requires `candidate-EXPERIMENTAL.bit`, nonnegative setup/hold/pulse-width
timing, passing DRC, and `build-receipt.json`. Return the receipt and reports
with the bitstream for verification. Do not program the board.
