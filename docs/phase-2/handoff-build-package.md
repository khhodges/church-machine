# Diagnostic handoff build-only package

Prepared 2026-11-09. No Vivado invocation or board operation.

## Download and identity

Archive: `generated-artifacts/handoff-build-only.zip` (3,470,352 bytes).

SHA-256:
`adfbe22bf0fa1ae6beed00eb6a37b551be1e3bea9406a8c83554ea6435cebf05`.

Manifest SHA-256:
`fb5081f84efe4372cc52c00a116ab149a007f8b8b4c0db7f786a39c0a9e2358a`.

The archive contains source, exported RTL, exact 64 KiB test image, local
evidence, constraints, verification scripts and a build-only runner.
It does **not** contain a newly built `.bit` or `.mcs`.

## Selected build

- XC7A100T FGG676-2; retained board pins and 50 MHz input / 25 MHz internal clock.
- Vivado 2026.1; UART 57,600 baud.
- Guard 23971; diagnostic handoff stop explicitly enabled.
- Image SHA-256:
  `8e6a94f80037c3380201cd4b894b845f1d9af7631fd423f4bb35f9020c6cd55e`.
- Exported Verilog SHA-256:
  `7411656b932c2abf91552249a5a5ad3ff455ec81b5c70092fac38ded44f5d85d`.
- Execution watchdog remains unintegrated; no full ISA/Lazy Load claim.

The sole Python source difference from the locally tested snapshot is an
explicit exact-image admission branch in the package's private
`guarded_build_profile.py`. It admits only the diagnostic digest under the
selected guard. Main application profiles and production source are unchanged.
Production top export uses `runtime_image_words`, not simulation overrides.

## Checks completed

- RTLIL/Verilog export succeeded locally using the retained generator and caches.
  Yosys format conversion is not Vivado synthesis or timing acceptance.
- Exact fixture admitted; modified, truncated and wrong-guard images rejected.
- Build verifier accepted the complete package and rejected separately modified
  image and Verilog files in disposable copies.
- Shell runner syntax checked.
- Archive CRC and every archived manifest file digest verified.
- Existing 12 core and two top-level RTL results included, with their original
  scope and limitations; these were not needlessly rerun.

## Build-only handoff

The included runner targets the existing Linux build environment:
Vivado 2026.1, Python 3, bash, flock, timeout and sha256sum.

After separately authorizing a vendor build, extract into a fresh directory,
source Vivado's `settings64.sh`, then:

```sh
python3 verify.py
bash run.sh
```

Windows archive identity can be checked without running a build:

```powershell
Get-FileHash .\handoff-build-only.zip -Algorithm SHA256
```

Native Windows execution of the bash runner has not been qualified. Do not
interpret the above hash command as a Windows build procedure.

The runner preserves checkpoint hash checks, a build lock, exact board pin
and clock checks, enforced DRC errors, nonnegative precise setup/hold slack
and design-wide setup/hold/pulse-width timing gates. Inputs are reverified
between phases. The receipt binds the resulting BIT and reports to the manifest.

The output remains `candidate-EXPERIMENTAL.bit`, quarantined for review.
No hardware-server, JTAG, upload, reset or flash commands are included in the
runner. Neither package preparation nor a successful build authorizes programming.
Persistent flash packaging is not part of this step.
