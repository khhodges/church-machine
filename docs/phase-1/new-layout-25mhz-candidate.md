# New Layout — isolated 25 MHz preparation

**2026-10-26 final trial update:** the full 64 KiB runtime reload was
acknowledged and the expected Mallory denied-access endpoint was observed.
The [physical reload result](installed-image-reload-result.md) records exact
identities and limitations, including absent installed-memory readback,
startup-halt timeout and one initial LOAD-shadow difference. The preparation
and intermediate pending/blocked states below remain historical evidence.

The user approved 25 MHz first, with GT memory parity/ECC deferred to a
separate change. This does not approve FPGA programming or waive functional
failures.

## Implemented inputs

- Separate explicit profile: `new-layout-guarded-relative-nia-25mhz-v1`.
- Original 50 MHz profile and board oscillator constraint remain unchanged.
- MMCM: 50 MHz input, multiply 20, divide 40 output (1 GHz VCO, 25 MHz output).
- Dedicated feedback buffer and lock-enabled global output buffer; no fabric
  clock divider or new software reset.
- UART remains 57600 baud, with 434 system cycles per bit. Existing
  frequency-derived heartbeat/watchdog/nonce counters use 25 MHz; production
  button debounce scales to 25000 cycles.
- Runtime image remains 65536 bytes, SHA-256
  `2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451`.
- No saved Namespace, LUMP revision, parity scheme or hardware command changed.

## Evidence and limits

Four focused checks pass: exact profile/image routing, rejecting a software-only
frequency change on the direct physical clock, dedicated primitive/lock wiring,
and UART transmit bit widths plus receive loopback for four byte patterns.
The three existing guarded-production-profile checks also pass. Constructor
rejection tests emit Amaranth unused-elaboratable warnings.

Full-top RTL generation succeeded in the separate ignored directory
`generated-artifacts/new-layout-25mhz-candidate/rtl`. This is not proof of clock lock,
full program execution, routed timing, or hardware operation. Source changes
after generation require fresh generation and provenance before packaging.

Vivado/XSim is not installed in the workspace. The available Yosys primitive
declarations do not substitute for behavioral UNISIM simulation. A small
vendor-clock probe is exported by:

```
python3 scripts/prepare_wukong_clock_probe.py generated-artifacts/new-layout-clock25-validation
```

It exports the actual Amaranth clock block, not a replacement divider model.
Its vendor testbench requires lock before user-clock edges, checks 200
consecutive 40 ns periods, and times out after 100 us. The manifest identifies
the source and hashes every simulation input. Run `bash run.sh` after sourcing
Vivado settings in a fresh extraction on the droplet. No synthesis or FPGA
connection is performed. A pass only certifies this bounded startup probe;
loss-of-lock behavior and physical clock routing are not established.

### Vendor clock probe passed — 2026-10-25

The uploaded droplet transcript
`attached_assets/Pasted-new-layout-clock25-validation-tar-gz-OK-Clock-test-fold_1792969218308.txt`
(SHA-256 `88209082d7cd85794bff2ecb9d9329ce5359c34fb9b620d026ff1c4bb3f702ab`)
reports successful archive/input checksum checks and XSim 2026.1 simulation
against UNISIM MMCM, IBUF, BUFG and BUFGCE models. It prints
`CLOCK25_PASS: 200 stable cycles at 25 MHz after lock` and finishes at
9630 ns simulated time. The archive SHA-256 is
`41d2d50a18afbef7839fbb184419b8cd1b59476bc28aa91cc4b156bf3bf4829a`.

The log warns about LIBRARY_PATH and an unused CLKFBOUTB output; elaboration
and the bounded simulation nevertheless complete successfully. This is
clock-module startup evidence only, not full-design timing or board acceptance.

## Still pending

1. Full-program replay and full UART reload (bounded boot replay passed below).
2. Run the prepared experimental full synthesis package.
3. New routed DRC/setup/hold/pulse-width results.
4. Outstanding functional conformance findings and physical reload trial.

The package verifier admits the explicit 25 MHz profile only with its separate
vendor-replay evidence; old Icarus receipts cannot substitute for it. Do not
edit an old archive or use old replay receipts to bypass that gate.

### Full-top boot replay staged

The build Tcl now branches on the verified profile clock. Its 25 MHz checks
require a 20 ns input clock, one MMCM with the intended multiply/divide
parameters, 40 ns output and 1 ns feedback clocks, and a BUFGCE driven by that
MMCM's output and LOCKED signal. Unexpected clocks or connectivity fail closed.
These are prepared vendor checks, not observed routed results. Ten mock
clock-check cases and all 24 existing package/vendor-gate cases pass.

`scripts/prepare_wukong_25mhz_replay.py` exports the retained complete top,
with current source fingerprint, profile and RTL hashes checked before staging.
The new observer drives only board pins, uses actual UNISIM clock primitives,
checks the internal 40 ns clock and known fault/NIA/UART state, and requires
boot handoff at 0x3504. Seven observer fixture cases pass; these test the
observer, not the real design.

The exported archive is
`generated-artifacts/new-layout-boot25-validation.tar.gz`, 2201367 bytes,
SHA-256 `ec21d0a6e31b0684e835ba8aaceeb52f0ce0dae2fe4c13c030e61edfeec5e58c`.
Its text download is inside `generated-artifacts/new-layout-boot25-validation/`
as `DOWNLOAD-boot25-base64.txt`. Internal hashes and shell syntax were checked.
Run its `run.sh` on the Vivado droplet in a fresh extraction after sourcing
settings64.sh. Compilation/elaboration/simulation are bounded; only a
`BOOT25_PASS` marker plus a successful runner exit counts as boot evidence.
The first vendor run compiled/elaborated, but the observer stopped at time zero
with `User clock without lock`. It did not execute boot and is not a pass.

This replay deliberately stops before the application executes and holds UART
RX idle. It cannot establish the Mallory outcome, UART reload, or timing
closure, and contains no synthesis or programming commands.

### Startup observer correction

XSim treats the initial clock X-to-zero transition as a falling edge before
MMCM lock. The corrected observer ignores only falling-edge settling at time
zero. Every rising edge must still have lock, and all later falling edges
retain lock and period checks. Nine fixture cases pass, including delayed
lock with time-zero settling, unlocked edges and loss of lock. These are
observer tests only.

The new archive is
`generated-artifacts/new-layout-boot25-startup-validation.tar.gz`,
2201615 bytes, SHA-256
`a9eb90de393d44f4063540ffc52d03a5699ed61b07a5b61108ee9ba9606e3bf4`.
Download text:
`generated-artifacts/new-layout-boot25-startup-validation/DOWNLOAD-boot25-startup-base64.txt`.
The complete generated RTL is byte-for-byte unchanged from the first boot
package (SHA-256
`940f0501003af94b4326a0ee11f49d6ddbd72d2a178700d68d30a07389859202`).
Only the testbench and its package evidence changed. Run in a fresh directory;
retain the original failed run.

### Corrected vendor boot replay passed — 2026-10-25

The user supplied
`attached_assets/Pasted-new-layout-boot25-startup-validation-tar-gz-OK-boot-tb-_1792972105288.txt`,
SHA-256 `6c1be506d010fafd03c265dab82f1cb1e385d4e7d0dd1d757364dbadb4ea1b46`.
The transcript identifies the corrected archive, reports successful input
checksum checks before and after replay, and shows Vivado 2026.1 compiling
the complete generated top with UNISIM clock primitives.

XSim reports `BOOT25_PASS: entry=00003504 cycle=207812` at 8314090 ns,
followed by the runner's final boot-replay success message. Simulation elapsed
time is about two minutes. The observer's startup lock, 40 ns cycle, known
fault/NIA/UART state and entry-address checks remained enabled.

This is exact-candidate boot evidence, not full-program, UART byte-transfer,
routed-timing, or installed-board evidence. No physical commands were sent.
The original time-zero failed run remains retained and is not relabeled a pass.

### Experimental synthesis package prepared

`scripts/prepare_guarded_25mhz_build.py` binds the exact tested replay archive
and supplied transcript to the current source fingerprint and retained RTL.
The standalone verifier checks the profile, generated header, image, observer,
runner, source fingerprint, successful boot marker and before/after input
checks. Vendor evidence is explicitly user-supplied; no XSim executable digest
was collected, and none is invented.

The 25 MHz verifier/admission, legacy package/build gates and clock-check mock
suite passes 46 tests. The final archive was restored into a fresh temporary
directory and independently passed its verifier; its base64 download decodes
to the exact archive. These are offline package checks, not routed results.

- Archive: `generated-artifacts/new-layout-build25.tar.gz`
- Length: 2217061 bytes
- SHA-256: `2bb048289f543ff772e2194cd11cff4e2d724faa77b3b26c1ff0751e545a6f2a`
- Text download: `generated-artifacts/new-layout-build25/DOWNLOAD-build25-base64.txt`
- Convenience copy in the user's existing open folder:
  `generated-artifacts/new-layout-boot25-validation/DOWNLOAD-build25-base64.txt`
- Text length: 2956084 bytes
- User-facing unique filename after duplicate-name confusion:
  `generated-artifacts/new-layout-boot25-validation/DOWNLOAD-SYNTHESIS-25MHZ-2bb04828.txt`
  (identical verified contents; use this filename for subsequent restore commands).

The experimental build retains all DRC and finite/nonnegative timing gates
and the generated-clock checks. The input oscillator constraint remains
20 ns; the user clock must be 40 ns. Build only in a fresh extraction with
`vivado -mode batch -source build.tcl` after sourcing settings64.sh.
There are no hardware connection, programming, or flashing commands.

The package lists full-program/Mallory replay, fault-code conformance, three
historical conformance failures, full UART reload, physical identification/
acceptance, GT integrity, external I/O timing coverage, and release approval
as unresolved. Synthesis or a written bitstream does not close those gates.

### First 25 MHz synthesis completed; clock guard stopped implementation

The supplied transcript
`attached_assets/Pasted-root-ubuntu-s-4vcpu-8gb-nyc3-cd-root-new-layout-build25_1793014914963.txt`
reports synthesis complete on 2026-10-26, after about 65 minutes, with 39
warnings, no critical warnings and no errors. The synthesis checkpoint exists.
The parent build exits 1 at the feedback clock guard: expected 1 ns, observed
20 ns. The preceding 50 MHz input, MMCM-parameter and 25 MHz output checks
returned successfully. Remaining clock checks, implementation and routed
timing have not run.

The guard assumed a reported feedback-clock period equal to the VCO period.
Do not treat this as a failed 25 MHz routed timing result, waive the guard, or
change the RTL blindly. Inspect the saved checkpoint's clock properties and
connectivity before preparing a narrowly corrected guarded continuation.
No bitstream was written or programmed.

The first clock inspection
(`attached_assets/build25-clock-inspection_1793015371072.txt`) opened the
standalone synthesis checkpoint and reported no defined clocks. It therefore
does not provide the constrained project's clock-period evidence. It does
confirm the intended MMCM parameters and Vivado's BUFGCE-to-BUFGCTRL lowering:
I0 takes the divided clock, CE0 takes LOCKED, and the legacy primitive pin map
is present. The existing guard's source-only BUFGCE query also needs correction
after constrained-clock inspection. No guard has been waived.

### Constrained clock report and guarded continuation

`attached_assets/build25-project-clocks_1793015629018.txt` opens the original
project and completed synthesis run with the original XDC. It confirms:

- input `sys_clk_pin`: 20 ns;
- auto-derived `phase1_clock.divided`: 40 ns, from MMCM CLKOUT0;
- auto-derived `phase1_clock.feedback_raw`: 20 ns, multiply-by-one from the
  same input master, sourced at CLKFBOUT.

The corrected clock guard uses that reported feedback timing model and
accepts the observed BUFGCE lowering only with the proper BUFGCTRL preselection,
synchronous enable, clock/LOCKED connections and tied-off alternate arm.
It does not change any RTL or clock constraint.

`scripts/prepare_guarded_clock_resume.py` prepares continuation only for the
hash-pinned original 25 MHz package and its diagnosed failed build. It preserves
all original files, saves the old manifest, hashes the existing synthesis DCP,
and adds separate guard, preflight and continuation scripts. The saved project
must still have matching target, source paths and synthesis directory, fresh
completed synthesis, and implementation at 0%. The preflight launches no run.
The continuation skips synthesis but retains all original DRC/timing gates.
The checkpoint hash protects consistency from preparation onward, not an
independent attestation of the remote checkpoint's origin.

47 continuation/clock/legacy-build tests passed. These are local contract/mock
tests, not proof that Vivado preflight or routed timing has passed.

- Small correction archive:
  `generated-artifacts/new-layout-clock-guard-fix.tar.gz`
- Length: 3770 bytes
- SHA-256: `5de8da321902958dea6aa2bb078267fc38c1e1a69d369475d6e1f9dd2b18da88`
- Unique text download:
  `generated-artifacts/new-layout-boot25-validation/DOWNLOAD-CLOCK-GUARD-5de8da32.txt`
- Text length: 5028 bytes

Next: transfer this correction, verify its checksum, prepare the continuation
against `/root/new-layout-build25-trial.tAZMgw/new-layout-build25`, and run
`clock-resume-preflight.tcl` before starting `clock-resume.tcl`. Do not rerun
the original build script or mutate its sources to skip checks.

The user-supplied transcript
`attached_assets/Pasted-root-ubuntu-s-4vcpu-8gb-nyc3-set-e-set-o-pipefail-cd-ro_1793017545852.txt`
records `CLOCK_RESUME_PREFLIGHT_PASS` in Vivado 2026.1 on 2026-10-26,
with remote log `clock-preflight.TCf4Kc.log`. Preparation had recorded checkpoint
SHA-256 `0a8fdb781358e7ca808193d3e4326fdb478a4ed763f33e63f1166b53f26b420b`.
Preflight accepted that checkpoint, fresh completed synthesis, implementation
at 0%, the original board constraints and corrected clock-tree checks.
This is remote preflight evidence, not routed timing closure, bitstream
generation, programming or physical runtime-image reload evidence.

### Remote implementation and bitstream generation

`attached_assets/Pasted-INFO-Common-17-349-Got-license-for-feature-Vivado-Imple_1793020311040.txt`
records successful continuation in Vivado 2026.1, ending 2026-10-26 at
12:44:18 (remote log time). Routing reports estimated WNS +7.209 ns, TNS 0,
WHS +0.078 ns and THS 0. The subsequent routed clock/board checks and
finite/nonnegative WNS/WHS/TPWS gate passed. Bitstream generation reports zero
DRC errors and `Bitgen Completed Successfully`, followed by writing
`routed.dcp`, successful `verify.py --record`, and the experimental-build
completion marker.

This transcript establishes reported experimental build success, not FPGA
programming or logic acceptance. The exact final timing values, bitstream hash
and length still require collection of `build-receipt.json`; collect `timing.txt`
and `drc.txt` as well to inspect timing coverage and remaining warnings.
The log includes a switching-activity warning affecting power-estimate accuracy
and a floorplanning warning; do not describe the entire run as warning-free.
Physical image reload, installed-byte evidence and the intended Mallory result
remain pending.

### Receipt and report reconciliation

The two uploaded copies of each report are byte-identical. The checked copies
are `attached_assets/build-receipt_1793020591051.json`,
`attached_assets/timing_1793020591053.txt` and
`attached_assets/drc_1793020591052.txt`.

All 17 receipt input hashes match the retained original inputs plus the
separately prepared continuation. Reconstructing the extended manifest with
the reported synthesis checkpoint hash reproduces receipt manifest SHA-256
`62c2f5d3ada6b681f80cc6eba28666d9cbd5a0079b89c26cc758afe31469580e`.
The uploaded timing and DRC reports match their receipt output hashes.
This is consistency validation of user-supplied evidence, not independent
remote attestation.

Final receipt values supersede the router estimates: WNS 7.21538 ns,
WHS 0.078169 ns, TPWS 0.0 ns. The detailed timing report shows zero setup,
hold or pulse-width failing endpoints, no unclocked registers and no
unconstrained internal endpoints. All specified timing constraints are met.

Remaining report qualifications:
- `rst_n` and `uart_rx_pin` have false paths and no input delays.
- `led0`, `led1` and `uart_tx_pin` have no output delay constraints.
- DRC has one RTSTAT-10 warning covering 28 loadless nets including debug
  signals and `boot_complete`; zero DRC errors.
- Timing report methodology lists 49 SYNTH-6 RAM timing warnings and explicitly
  cautions that its methodology results may not be current.

The receipt reports bitstream SHA-256
`582d84355c7b487d7d438397acc509b365af21006998627b5de131e32b735800`.
Bitstream bytes and length have not yet been independently collected or checked.
Release verification and physical-board testing remain false; timing closure
does not establish program correctness, UART reload, external I/O behavior or
GT memory integrity.

### Experimental MCS conversion

The user reports a Windows download of the bitstream matching the receipt hash,
with length 3,826,002 bytes. The subsequent conversion transcript
`attached_assets/Pasted-root-ubuntu-s-4vcpu-8gb-nyc3-set-e-set-o-pipefail-cd-ro_1793020959784.txt`
checks that same source bitstream hash and records successful Vivado 2026.1
`write_cfgmem` conversion: MCS, SPIx4, 8 MiB capacity, load address zero,
payload address range 0x00000000–0x003A607B. It reports zero conversion warnings
or errors and MCS SHA-256
`41d708df53ea6d1ec6bb3d42f1efd537b4afe577cbdfd5d02d9f3470419ff90e`.
Remote output is `new-layout-25mhz-experimental.mcs` beside the bitstream.
The MCS is a separately generated experimental output, not an output covered by
the earlier build receipt. No MCS bytes have been independently inspected here;
conversion success is not flash programming or persistent-boot acceptance.

### Temporary JTAG programming observed

`attached_assets/Pasted-start-gui-open-hw-manager-open-hw-manager-Time-s-cpu-00_1793023545904.txt`
records Vivado Hardware Manager selecting target
`localhost:3121/xilinx_tcf/Xilinx/20250619ac5c01`, device `xc7a100t_0`,
clearing probe files and setting PROGRAM.FILE to the user's downloaded
`new-layout-25mhz-experimental.bit`. `program_hw_devices` completes in eight
seconds and reports `End of startup status: HIGH`, without a programming error.
No SPI configuration-memory programming command appears in this transcript.

This establishes tool-reported temporary FPGA configuration/startup success
with the selected file path. The downloaded file hash was checked earlier;
this is not independent FPGA configuration readback or Church program execution
evidence. The no-supported-debug-cores message is not a programming failure.
UART capture remains to be collected. Mallory outcome and a subsequent full
runtime-image reload through the loader remain unverified.

The received UART capture
`attached_assets/wukong-25mhz-20261026T140127000074Z_1793023662530.bin`
contains exactly 12 bytes:
`57 55 4b 4f 4e 47 0d 0a bc 28 02 14`.
These decode as `WUKONG\r\n` followed by a V2 boot sentinel:
initialization-count low byte 0x28, trace protocol 2, advertised build 20.
No instruction trace or architectural snapshot is present. Build 20 is reused
and does not uniquely identify the installed bitstream. The capture proves
receipt of the startup banner/sentinel, not ActorManager entry, Mallory denial,
or successful runtime-image upload. Next diagnostic is a single explicit `q`
snapshot request with the bridge stopped, without run/reset/recovery commands.

### First physical explicit snapshot

`attached_assets/wukong-snapshot-20261026T141127206227Z_1793023935531.bin`
is exactly 292 bytes. The existing bridge decoder accepts its framing and
CRC16 (0x4831): version 1, sequence 1, reason 3 (explicit request).
Live NIA, STO and active Thread base are zero, all 16 CR triples and all
16 DR words are zero, and M is false. The four exposed flags are NZCV;
they are not halt or fault status. This frame therefore does not prove a
fault-free or halted core.

Backing-store samples decode to stored CR12 GT 0xf900820c, packed PC zero,
and stored M word 0xdeadaacf. With no established active Thread base, those
samples must not be interpreted as valid Thread authority or as a successful
Thread restore.

This is successful UART request/response and snapshot-integrity evidence,
but it does not show the expected ActorManager entry at 0x3504 or Mallory's
expected denied access. Do not label the hardware application test passed,
infer a valid Mallory fault, or attempt automatic reset/reload/reprogramming.
The physical state differs from the retained RTL/UNISIM boot-replay handoff;
the cause remains unresolved.

### Implemented-netlist boot diagnostic prepared

The user exported a functional simulation netlist from the hash-checked
`routed.dcp`, reporting SHA-256
`fe8d2afb7a7036a7e84975d57b42ed81104c65bc475744cc69047cf1d63f36f7`
for `implemented-boot.DRbwiW/implemented.v` in the original build directory.
`attached_assets/Pasted-root-ubuntu-s-4vcpu-8gb-nyc3-cat-root-new-layout-build2_1793024621843.txt`
reports surviving `boot_triggered`, `boot_complete` and `fault_valid` nets.
The initializer and boot-start names are absent; the original RTL observer
cannot be reused verbatim. The net report does not establish a complete,
directly referenceable instruction-address vector.

`tests/hardware/wukong_implemented_boot_tb.v` observes only those three signals
without forcing internal state. It drives the original 50 MHz input and idle
UART/button inputs, allows 20 ms simulated startup, and distinguishes a boot
completion observation from fault, unknown fault state, and timeout. A completion
marker explicitly does not certify the entry address or program result.
Five synthetic observer tests passed; no implemented-netlist replay result has
yet been received.

The prepared launcher in
`generated-artifacts/new-layout-implemented-replay/start.sh` pins the exported
netlist and observer hashes, compiles with vendor UNISIM/glbl, bounds each
simulation-tool invocation, preserves logs and exit status under a fresh replay
directory, and prevents duplicate launches. This is functional netlist
simulation, not SDF timing simulation or physical execution proof. No board
command, FPGA rebuild or programming operation is included.

The user transcript
`attached_assets/Pasted-root-ubuntu-s-4vcpu-8gb-nyc3-set-e-cd-root-new-layout-b_1793025898407.txt`
records successful input hash checks, compilation and elaboration in
`implemented-boot.DRbwiW/replay.2UrTWf`. XSim observed the boot trigger at
1,364,591 ns and stopped at 1,365,391 ns with
`Fault or unknown fault state after boot trigger`, before a completion marker.
This establishes a functional implemented-netlist boot-replay failure, not
its cause or equivalence to the physical-board failure. The observer combines
asserted and unknown fault values; the log alone cannot distinguish them.
Next diagnostic should inspect the already compiled simulation immediately
before that observer check and report raw fault/address/control values.

`attached_assets/Pasted-timeout-15m-xsim-implemented-boot-probe-tclbatch-script_1793026400740.txt`
records a successful read of the compiled simulation at 1,365,390.999 ns:
boot_triggered=1, boot_complete=0, fault_valid=1, dbg_fault_valid=1,
dbg_fault=0x00000200, dbg_nia=0, fault_latched=0, step_halted=0, step_mode=0.
The packed debug fault's bits 10:6 decode to BOUNDS (8); bit 5 is zero because
the retire-fault flag is gated by execution phase. dbg_nia observes retire NIA,
not an independent live-PC read. This is an asserted pre-boot BOUNDS condition,
not an X value and not Mallory's expected denial.
The rejecting unit/check is not yet identified. The next diagnostic reads
Namespace/Thread admission signals across the final three cycles using the
existing compiled simulation; no protection bypass or RTL correction is
authorized by this fault classification alone.

`attached_assets/Pasted-root-ubuntu-s-4vcpu-8gb-nyc3-set-e-set-o-pipefail-cd-ro_1793027118765.txt`
contains all three admission samples and the diagnostic completion marker.
The fault is clear in the first two samples and asserted in the last.
Many captured boot-unit fields are zero, but the sampled objects are optimized
aliases, not a complete memory dump or a proven source-level FSM decode.
The selector omitted some root-cause signals because escaped XSim names include
a leading backslash and trailing whitespace. The diagnostic now normalizes its
comparison key while retaining original object handles, includes unit fault/error
signals, and tests escaped scalar/bit-select selection. No rejecting validation
check or RTL correction has yet been established.

The normalized diagnostic completed in
`attached_assets/Pasted-root-ubuntu-s-4vcpu-8gb-nyc3-set-e-set-o-pipefail-cd-ro_1793028380644.txt`.
The synthesized net `core.namespace_error2993_out` reads 0, 1, 0 across the
three samples; fault_valid reads 0, 0, 1 and dbg_fault reads 0, 0, 0x200.
boot_namespace_admitted remains zero. This is a correlated precursor, not yet
proof of a particular source-level check: the synthesized net's drivers must
be traced in the exact implemented.v export. Further blind signal-name probes
are deferred in favor of obtaining that retained netlist for local analysis.
Physical full-image reload and successful program execution remain unverified.

The uploaded `0_new-layout-implemented-analysis-20261026-112900_1793028601194.zip`
contains a 16,476,220-byte implemented.v, verified against SHA256
`fe8d2afb7a7036a7e84975d57b42ed81104c65bc475744cc69047cf1d63f36f7`.
The precursor's actual driver is LUT5 `core.namespace_error[3]_i_4`, INIT
0x01000000. Its sole true row is input index 24: activation and Thread faults
low, metadata-reader state bits [2:0] = 011. The retained pre-synthesis RTL
defines reader.fault as state == 3. Thus the precursor identifies the
Namespace metadata reader's fault state, not Thread activation or user code.
The exact failing metadata/self-descriptor condition remains pending.

All 256 stored bits of metadata words 0–7 have been mapped to the actual
implemented FDRE Q nets. `scripts/prepare_implemented_metadata_probe.py`
generates a hash-pinned read-only probe, requires complete mappings and
rejects missing/X/Z values rather than substituting zero. Its local tests
check reordered/escaped mappings, incomplete/duplicate mappings, word
assembly, and unknown-bit rejection; these are diagnostic tests, not an
additional successful hardware or implemented-model run.

Expected words 0–7 of the retained candidate are:
`F8810100 00000000 00000011 00000000 00000000 005C00FF 5EB25EE4 00000000`.
The next bounded simulation inspection compares the stored reader words
against these exact inputs. No new RTL or FPGA programming is justified yet.

### First-word failure localized

`attached_assets/Pasted-root-ubuntu-s-4vcpu-8gb-nyc3-set-e-set-o-pipefail-cd-ro_1793029531996.txt`
completed the mapped-word inspection. All three samples contain:
`00000000 00000000 00000011 00000000 00000000 005C00FF 5EB25EE4 00000000`.
Only word 0 differs from the retained candidate (expected F8810100).
The reader advances CHECK (2) → FAULT (3) → IDLE (0); its error becomes 1,
the metadata/header rejection. These are implemented-model register readings,
not physical-board memory readback.

Static checks of the same hash-pinned netlist, retained in
`scripts/check_implemented_initializer_first_fetch.py`, confirm:

- The initialization ROM really contains first pair `(address 0, F8810100)`.
- Its mapped RAMB36E1s have a registered output and zero startup output.
- The array read enable is `active AND ready AND NOT last`, while the output
  register enable is `active AND NOT ready`.
- `ready` starts low. Thus the first fetch clocks the output register before
  any array read. The first subsequent array read uses the incremented
  address (its least-significant address bit is already 1), not entry zero.

This identifies a synthesized initializer first-fetch defect consistent with
the vendor-model header capture. The saved image/header and the rejection
check must not be changed to compensate. A separate initializer correction
needs a focused synthesized first-write regression before another full build.
No initializer RTL, installed board state, or saved Namespace has been changed
in this diagnostic step; the physical reload trial remains incomplete.

### Separate address-issue candidate prepared

The user approved preparing an isolated initializer correction. The candidate
is not wired into Wukong and does not replace the existing initializer.
It separates address issue, clocked data fetch, and accepted memory write.
For a multi-entry ROM its unconsumed startup address is the last valid entry,
so the first issue clocks a real transition to address zero before any write
is permitted. No expected header is injected into memory or the testbench DUT.

Local validation:
- 16 existing initializer tests, 10 candidate cases (empty/single/multiple/
  1,832 entries, including disabled and paused phases), and four comparison
  oracle cases passed.
- Both production-emitted source RTL versions wrote all 1,832 exact retained
  pairs under Icarus. This is expected even for the faulty baseline and does
  not establish post-synthesis correctness.
- Shell syntax checks passed for the vendor runners.

The isolated reset-less Vivado/UNISIM package is
`generated-artifacts/initializer-first-fetch-trial-20261026.zip`, 76,172 bytes,
SHA256 `55486f6768504552ec9c4bb84a755a03222ec35e2ab39b9ffc7ee8e04c0d1500`.
It includes frozen RTLIL/Verilog, the exact pair oracle, source files and
input checksums. It synthesizes only the initializer, not the full system.
It contains no routing, bitstream generation, programming, bridge or UART step.

The baseline test must reproduce precisely the first zero write and otherwise
match the pair stream; the candidate must match every pair including the first.
Each result needs its explicit simulation marker. Baseline non-reproduction
makes the comparison inconclusive, not an automatic correction PASS. Both
cases run independently with bounded tool deadlines and retained logs.

Vendor synthesis/replay, full-design reintegration, timing, physical boot and
the original installed-image reload trial remain pending.

### Isolated vendor comparison reported PASS — 2026-10-26

The user supplied the droplet console transcript in
`attached_assets/Pasted--System-restart-required-root-ubuntu-s-4vcpu-8gb-nyc3-s_1793032050575.txt`.
The archive hash and all packaged input checksums passed. The runner reported
both `baseline: expected result confirmed` and
`candidate: expected result confirmed`, followed by
`FOCUSED_SYNTHESIS_COMPARISON_PASS` and `COMPARISON_EXIT_CODE=0`.
Input checksums also passed after the comparison.

For this exact package, those markers require synthesis and vendor simulation
of both initializers: the baseline reproduces the first zero write, while the
candidate matches all 1,832 pairs, including address zero's `F8810100`.
This is evidence for the isolated correction, not just source RTL simulation.
The received evidence is the runner console; detailed synthesis/simulation
logs remain on the droplet in the verified test folder.

Full-design integration and synthesized boot replay are the next gates.
Full-design timing, a new bitstream, physical boot and the original runtime
image reload remain unverified. No board command or production initializer
replacement was performed in this step.

### Separate full-design boot package prepared — 2026-10-26

With user approval, a separate source snapshot was exported through the normal
Wukong RTLIL/Verilog generator. The only changed hardware/shared source is
`hardware/sparse_memory_init.py` inside that snapshot: it combines the unchanged
base definition with the tested candidate and selects the candidate class.
The production module is untouched. Original source hashes still match the
pre-export values, and the original Wukong fingerprint matches the retained
25 MHz build (`75498f7196e683e01055bba0ee5c973c731946b5d2a9d983360ceaa038055c58`).
The exact 65,536-byte image remains unchanged.

Import-time factory validation needs a separate read-only snapshot of its
Namespace/admission records and selected SelfTest/CapabilityTest binaries.
Those are retained as import context, not substituted for the explicit runtime
image. No Namespace assignment or admission check was changed.

Package: `generated-artifacts/initializer-full-boot-test-20261026.zip`
- Bytes: 3,378,247
- SHA256: `0bcb202d329dd176e8d605bf327c3d8dd5d85fab7b78acc8f2fe778ac62e0053`
- Local checks: eight observer/overlay tests passed, shell syntax passed,
  ZIP contents match retained files, all checksums passed, and the source
  delta is initializer-only.
- The observer also successfully maps all 32 actual NIA register Q outputs in
  the prior implemented netlist. This is an observer compatibility check,
  not a successful execution of the new design.

The droplet runner performs synthesis followed by UNISIM boot simulation.
It rejects missing register/control mappings, unknown or faulting boot state,
wrong clock period and a boot entry other than `00003504`. It binds observer
and netlist hashes and requires explicit PASS output. Source-RTL success is
not substituted for this synthesized replay.

This package has no routing, bitstream generation or board-access commands.
It stops at boot entry; full program/Mallory outcome, timing, physical boot
and runtime-image reload remain separate pending gates. Full-design vendor
synthesis/replay has not yet been run.

### Full-design synthesized boot reported PASS — 2026-10-26

The user supplied the final console output from the verified package in
`/root/initializer-full-boot.vISgnj/initializer-full-boot-test-20261026`.
It reports all final input checksums passing, plus `mapped.v`,
`mapped-boot-tb.v`, and `synthesized.dcp` passing their captured hashes.
The final markers are `FULL_DESIGN_BOOT_COMPARISON_PASS` and
`FULL_BOOT_EXIT_CODE=0`.

The verified runner emits that PASS only after the full-design synthesized
UNISIM replay emits `FULL_SYNTH_BOOT_PASS: entry=00003504`. Its observer
requires the mapped live NIA to equal ActorManager's entry, known non-faulting
boot state, and a 40 ns user clock. This is positive full-design synthesized
boot evidence for the separate initializer correction.

The user's subsequent read-only verification reports
`FULL_SYNTH_BOOT_PASS: entry=00003504 cycles=209644`, with all three recorded
file hashes passing:

| File | SHA256 |
| --- | --- |
| `mapped.v` | `288f6ccdb6cc0db596af7adb4ce2631049be5e3c3b8d09b3e2cc7a9e2eb57792` |
| `mapped-boot-tb.v` | `2e2cfbabda4eb0efd29f45a0f9899dc7c3d9bf2101dcced8445bedcc012deb70` |
| `synthesized.dcp` | `16a3795f07b5008f012c1b035c5221df07f30df47682f50b1c275f0f3d7da629` |

Any implementation continuation must verify these exact retained inputs.
This permits reuse of the tested synthesized checkpoint, not reuse of the
prior initializer's routed checkpoint or its timing results.

The test stops at boot entry. Routed timing, a corrected bitstream,
full-program/Mallory execution, physical boot and the original no-flash
runtime-image reload remain pending. No hardware operation occurred here.

### Guarded implementation continuation prepared — 2026-10-26

The user approved preparing placement/routing and timing-checked bitstream
generation from the tested initializer-corrected checkpoint. Bundle:
`generated-artifacts/initializer-route-20261026.zip`, 7,721 bytes,
SHA256 `c3d27aa0df605ea9d58b380238d6c52c0c72d185a318a299825deffd3f8c1cc6`.

Preparation verifies the original package's pinned checksum-list hash and all
inputs, the three exact synthesized-file hashes above, and the recorded
209,644-cycle boot PASS. It copies the checkpoint into a new continuation
directory and starts no vendor or hardware process. The old project is not
modified or reopened as the design authority.

The non-project continuation verifies part, board pins, enabled hard DRC
checks, and the existing exact 25 MHz clock-tree checks before and after
implementation. It rejects routed DRC errors, missing/negative unrounded
setup/hold slack, negative timing-summary values, failing setup/hold/pulse
endpoint counts, or missing timed endpoints. Original and continuation
inputs are rechecked before writing an experimental bitstream. A receipt
records the bitstream, checkpoint, reports, and input identity. No constraint
relaxation, override, synthesis rerun, programming or flash step is included.
External UART electrical timing is not certified by these internal checks.

Local verification: 19 timing-parser and Tcl gate-order tests passed,
including clock/DRC/setup/pulse failure cases that never reach bitstream
writing. Shell syntax and bundle checksums passed. These are local regression
checks, not vendor implementation or timing evidence. Droplet execution,
physical testing and the original runtime reload remain pending.

### Corrected routed bitstream reported PASS — 2026-10-26

User-supplied transcript:
`attached_assets/Pasted-root-ubuntu-s-4vcpu-8gb-nyc3-set-e-cd-HOME-echo-c3d27aa_1793043967091.txt`.
The continuation in
`/root/initializer-full-boot.vISgnj/initializer-route-7aqs12zy`
completed routing, clock/board checks, and the timing/DRC gates.
The final timing-summary values (not the router's earlier estimate) are:
WNS +5.646 ns, WHS +0.059 ns, WPWS +7.000 ns; all failing
setup/hold/pulse endpoint counts and total negative slacks are zero.
The unrounded setup/hold checks also completed successfully.

The bitstream-generation DRC reported zero errors and bitgen completed.
The log ends with `EXPERIMENTAL_BITSTREAM_READY`,
`GUARDED_IMPLEMENTATION_PASS` and `IMPLEMENTATION_EXIT_CODE=0`.
The bitstream and routed checkpoint are retained on the droplet. Obtain their
exact receipt hashes before transfer or programming; this transcript does not
contain those output identities.

This establishes a successful experimental implementation build, not physical
boot, Mallory denial, installed-byte readback, or runtime-image reload.
No device was programmed by the continuation.

### Corrected bitstream identity received — 2026-10-26

The user supplied the build receipt and a subsequent size/hash calculation.
The receipt names the previously tested synthesized checkpoint
`16a3795f07b5008f012c1b035c5221df07f30df47682f50b1c275f0f3d7da629`.
The separately printed bitstream digest matches the receipt:

| Output | SHA256 |
| --- | --- |
| `candidate-EXPERIMENTAL.bit` (3,826,002 bytes) | `c1d71a721a1380532c59be4da188def94ae8a000d6ea9b702f095d83b67c83b7` |
| `routed.dcp` | `2df50522cffa8f0e9f93cbf03740508d585b057d6c81aff4e44b719bac74ef8a` |
| `timing.txt` | `b6f04ac231f4c9f7bbaca9ef65ff09b9904d54153d80972e9e8843e992366894` |
| `drc.txt` | `28c1bf0c0f33462e4239ce3b048debe4ab7002f13df47e45affed3918cb6e2da` |
| `precise-slack.txt` | `32a372ed67dfc731ef5d0dcbcc61ad2384d5f5c113e38a81413d3c6d7397a58b` |
| `continuation.json` | `60aa6083d5fce0a03b8644da909dc2a6502d352e877f5235b37c4d64e000ffbc` |

These identities are user-reported droplet evidence, not FPGA readback.
The receipt explicitly retains `physicalTested: false`,
`fullProgramTested: false`, and `releaseApproved: false`. Download verification
and a separately controlled physical trial remain pending.

### First corrected-trial uploads inspected — 2026-10-26

Uploaded `.bit` file
`attached_assets/wukong-initializer-fixed-25mhz-c1d71a72_1793044857990.bit`
is exactly 3,826,002 bytes and hashes to the corrected receipt's
`c1d71a721a1380532c59be4da188def94ae8a000d6ea9b702f095d83b67c83b7`.
This verifies the uploaded file, not installed configuration readback.

UART capture
`attached_assets/wukong-initializer-fixed-20261026T195135324865Z_1793044857990.bin`
contains exactly 12 bytes:
`57 55 4b 4f 4e 47 0d 0a bc 28 02 14`.
Its SHA256 is
`45fedc9dd256c6d6a59bd37f30d75ec99b5ab1af90ff0460acbe5192ff85e494`.
These decode to `WUKONG\r\n` and the four-byte sentinel: initialization-count
low byte 0x28, trace protocol 2, build identifier 20. The count is consistent
with 1,832 pairs, but the reused build identifier and these identical banner
bytes cannot distinguish this candidate from the earlier image. There is no
architectural snapshot or program-execution evidence in this capture.

The supplied programming excerpt reports startup HIGH but omits PROGRAM.FILE;
the earlier full transcript names the older bitstream. Exact current programming
association remains to be clarified before interpreting a new diagnostic as
evidence for the corrected implementation. Physical boot, Mallory outcome and
runtime reload remain unverified.

The subsequent user-supplied `get_property PROGRAM.FILE` result is
`C:/Users/ken/Downloads/new-layout-25mhz-experimental.bit`, the older file.
Thus the recent capture is not attributable to the corrected bitstream.
The uploaded corrected file remains verified, but its physical programming
and boot are still unproven. Set the corrected selection explicitly and
capture a fresh programming event before assessing the initializer fix.

### Corrected-program physical execution and denied-access endpoint — 2026-10-26

After explicitly selecting the corrected bitstream, the user reported
programming and supplied the fresh 772-byte capture
`attached_assets/wukong-corrected-program-20261026T200751646720Z_1793045631780.bin`.
SHA256: `2373193def2384f725d269a8fb76139fe308ac26586993e05e404995cfddf586`.
The bounded observation is retained in
`reload-evidence/new-layout-amoeba-runtime/physical-corrected-program-observation.json`.

The existing bridge decoder parses exactly a 12-byte banner/sentinel,
39 aligned 12-byte trace packets, and one 292-byte snapshot. The snapshot's
CRC16 validates (`0x32de`), sequence is 1 and reason is 2 (fault).
The compact trace packets themselves have no CRC.

The trace reaches ActorManager at `0x3504`, Alice's path and RETURN at
`0x2c14`, then Mallory at `0x2e08`. The last two trace packets report
BOUNDS (`0x08`) at that address. The snapshot agrees: NIA `0x2e08`,
Thread base `0x2800`, CR12 GT `0x0200000c` (Thread.3), M clear.
The frozen image has Mallory's `LOAD CR1, CR6, #2` at that address.
All six capability registers selected by the retained full-model endpoint
also match exactly: CR2, CR6, CR12, CR13, CR14, CR15.

This is physical program-execution evidence reaching the authored denied
access endpoint, supporting the initializer correction beyond synthesized
boot simulation. It is not an arbitrary startup fault or only a UART banner.
The known BOUNDS versus comment-expected NO_CAPABILITY distinction remains
explicit, not an exact fault-code conformance pass.

Exact installed bytes are still not read back, and the new programming event
is user-reported rather than accompanied by its complete filename/startup log.
Most importantly, this capture follows FPGA programming, NOT the requested
no-flash runtime-image reload. That transport/installation/restart trial
remains pending. No reset, recovery, upload or further board command was sent
while decoding this evidence.

### Workspace bridge connection timeout correction — 2026-10-26

The operator stopped the bridge after its workspace session registered
`device_uid=20250619ac5c01`, but command polling timed out at 0.1 seconds
and status reporting hit 0.5-second connection/read limits. Read-only status
showed no pending command, no upload and no recorded serial reads/writes.
The UID is an operator-supplied label from the prior JTAG session, not UART
attestation. No image transfer was attempted.

The corrected bridge uses separate HTTPS connect/read limits of 3/2 seconds
for command polling and status/console/boot/halt telemetry. Command GET runs
off the UART thread, with exactly one outstanding response. Only the UART
thread handles that response and writes commands; another GET is not submitted
until a later loop after response handling. A timed-out GET is reported, not
replayed as a cached UART command. The existing server's consumed-command and
acknowledgement checks remain unchanged. Shutdown cancels unstarted polling
work; an already-running HTTP request may finish within its network limits,
but its worker has no UART access.

UART upload framing, payload ownership, board ACK deadlines, target checks,
automatic recovery policy and the frozen image bytes are unchanged. This
is not a successful reconnect or physical reload result.

Focused pytest checks returned **66 passed, 1 failed** across network,
registration, command acknowledgement, routing, dispatch, resynchronization
and upload-FSM tests. The failure,
`test_projected_multithread_contexts_fit_physical_dmem_model`, requests legacy
boot entry NS[6] while the current authoritative saved Namespace selects
NS[10]. It fails at image generation before exercising upload behavior.
Neither the user's saved Namespace nor that unrelated test was changed to
force a pass. Python compilation passed.

Replacement bridge SHA256:
`856576576b12c6be77f29e5bd3b033e608ee3a52938b824edfa323b74df1c07c`
(134903 bytes). Host version remains v19; use the hash, not that reused
version number, to distinguish this replacement.

### Snapshot request rejected at target validation — 2026-10-26

The corrected bridge registered and polled successfully in session
`9bc8f0b355574cdc89e82f51ea428a71`, with no queued commands or upload.
The operator explicitly submitted snapshot request `q`, command ID 1.
The server recorded consumption, but the bridge reported
`command_target_mismatch` before the UART write. No snapshot, serial write
acknowledgement or image transfer was recorded.

The cause was a command-envelope contract mismatch: admission retained the
session under `bridge_session`, while the bridge independently requires
`target_session_id`. The server now emits both fields from the same validated
target, for ordinary commands and the guarded upload. The bridge's strict
identity check is unchanged; no alias fallback or security bypass was added.

Tests exercise actual server dequeue responses through the bridge matcher
for snapshot, halt, step, reboot and breakpoint commands, plus the guarded
upload envelope, with wrong-session/wrong-board rejection retained.
Command-delivery, guarded-reload and bridge-target suites: **95 passed**.
Request 1 is not automatically replayed. A fresh operator request is needed
after the corrected server restarts; physical snapshot and reload remain
pending.

### Fresh snapshot transport acknowledgement, without board response — 2026-10-26

After the envelope correction and server restart, the operator explicitly
submitted a new `q` request (ID 1 in the new server process). In bridge session
`9bc8f0b355574cdc89e82f51ea428a71`, it was queued at Unix time
1793047937.9072793, consumed at 1793047938.5420456 and acknowledged as
`write_ok=true` at 1793047939.5167332. The queue was empty and no upload
was in flight. No fresh board snapshot or UART read was recorded.

This establishes host serial-write acknowledgement only, not a board-state
response. The RTL deliberately ignores `q` and nonce-bearing `h` while
`recovery_hold` is active, consistent with the previously captured Mallory
fault stop. Current hold state is not independently read back. A stale fault
capture cannot satisfy the guarded loader's fresh confirmed-halt requirement.
Do not repeat the snapshot automatically or bypass that requirement.
An explicit existing Reboot is the proposed next recovery step, subject to
operator confirmation; no reboot or image reload has been queued.
