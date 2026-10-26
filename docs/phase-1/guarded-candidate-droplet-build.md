# Experimental New Layout build on the droplet

The user authorized preparing a separate build while the exact generated-design
Mallory replay continues. This is an experimental synthesis path, not a bypass
of the legacy release gate. The old build directory and legacy Tcl are unchanged.
No programming commands, SPI flash images, or timing overrides are included.

## Frozen package

- Workspace archive: `generated-artifacts/new-layout-guarded-build.tar.gz`
- SHA-256: `e9f266ba891f9c6b2006b7aae91cd49ba42bb12048167d8dfc94215e7b485845`
- Exact RTL: `2b8733b8e2d3737275b499a9ae1bf25cbff4d28e4e7fd79c62e42959ac262c1b`
- Exact 64 KiB image: `2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451`
- Standalone verifier binds the retained config, image, RTL, compile receipt,
  successful boot-handoff transcript, constraints, and build script.
- Package hashes protect transfer consistency, not cryptographic publisher
  authentication. Check the archive digest against this separately supplied value.
- Thirteen local integrity/mock-vendor gate tests passed. They do not substitute
  for Vivado synthesis, routing, or physical evidence.

Download the archive from the workspace Files pane to the Windows Downloads
directory. In a **new Windows PowerShell window**:

```powershell
Get-FileHash "$HOME\Downloads\new-layout-guarded-build.tar.gz" -Algorithm SHA256
scp "$HOME\Downloads\new-layout-guarded-build.tar.gz" root@165.227.190.84:~/
```

The address is the project-documented droplet; use its current address if changed.

In the **droplet terminal**, validate before extracting, then use a new directory:

```bash
cd ~
echo 'e9f266ba891f9c6b2006b7aae91cd49ba42bb12048167d8dfc94215e7b485845  new-layout-guarded-build.tar.gz' | sha256sum -c - &&
trial=$(mktemp -d "$HOME/new-layout-trial.XXXXXX") &&
tar -xzf "$HOME/new-layout-guarded-build.tar.gz" -C "$trial" &&
cd "$trial/new-layout-guarded-build" &&
python3 verify.py
```

Proceed only after verification succeeds, from that same directory:

```bash
nohup bash -c 'set -e; source /opt/Xilinx/2026.1/Vivado/settings64.sh; python3 verify.py; vivado -mode batch -source build.tcl -log vivado.log -journal vivado.jou' > build.log 2>&1 < /dev/null &
printf 'Build folder: %s\n' "$PWD"
tail -f build.log
```

Ctrl+C stops only `tail`, not the background build. Do not launch another build
in this directory. On failure preserve the entire directory and `build.log`.
Never use the August `~/wukong_build` inputs or any timing-override flags.

## Bounded conclusions

Success must produce `build-receipt.json`, not just a `.bit` file. The receipt
binds input/output hashes, Vivado version and nonnegative setup/hold/pulse timing.
Missing timing or any failure leaves no approved receipt. Retain utilization,
DRC and timing reports. The exact six board ports and NSTD/UCIO Error severity
are checked after synthesis and routing. Two Vivado workers are used.

This package does not claim full timing constraint coverage beyond the inherited
board XDC; the verbose unconstrained timing report remains part of review.
The original profile's authorization field records its earlier configuration-only
scope; the separate package manifest records the later experimental build request.
The full program/Mallory outcome, fault-code conformance, complete UART reload,
fresh board identification, physical acceptance and release approval remain
pending. A successful build authorizes neither JTAG programming nor SPI changes.

## Post-synthesis DRC policy correction

The user-supplied droplet log records successful synthesis after about 41
minutes, followed by a stop before implementation: NSTD-1's severity was not
`Error`. A subsequent read-only report identified both NSTD-1 and UCIO-1 as
enabled with stage-default `Critical Warning`. This is not evidence that pins
were unconstrained. The corrected source explicitly promotes both to `Error`
and rejects disabled checks or failed promotion.

The original archive above is unchanged. For that exact downloaded package,
`scripts/resume_guarded_drc_build.py` prepares a separate `resume.tcl`.
It checks the original manifest and script hashes, verifies every original
input, retains the original manifest, and pins the saved synthesis checkpoint.
The resume checks project target, input paths, checkpoint identity, synthesis
freshness and that implementation has not started. It does not relaunch synthesis
or waive board I/O/timing checks. Twenty local package/mock-vendor checks pass;
the corrected resume has not yet run in Vivado.

Transfer copy: `generated-artifacts/new-layout-guarded-build/RESUME-build-fix.py.txt`
(3,954 bytes), SHA-256
`b7944c532f0bd317893cade3c946e50f1eb9312163c2e9d4522461a434ce726e`.
This is Python source stored as text for the working file-download route.
Verify that checksum before running it from the extracted package directory.
After the updater succeeds, run `python3 verify.py`; then use `resume.tcl`
instead of `build.tcl`, with a separate resume log.

## Routed timing failure — physical testing blocked

The user supplied the resumed Vivado terminal result dated 2026-10-25:
implementation and routed DRC completed, but the strict timing gate rejected
`WNS=-8.384425` ns. The script exited before `write_bitstream` and receipt
generation. Thus no successful experimental build or programming approval
follows from the earlier routing completion. This is user-provided terminal
evidence; the complete timing report is still needed to diagnose the path.

Preserve the routed project and reports. Retrieve the package-root `timing.txt`
to identify startpoint, endpoint, logic/routing contribution and clock constraints.
Do not rerun synthesis blindly, relax timing gates, lower the clock, or flash
hardware on the strength of the passing functional replay.

### Retained timing-path analysis

The uploaded routed report is retained at
`reload-evidence/new-layout-amoeba-runtime/production-vivado-routed-timing.txt`,
SHA-256 `886ad5c1f70adb4587426949581146bb41ce30dc06e9c03387b0f789fccdc2d4`.
It reports 4,881 setup-failing endpoints (TNS -16,198.552 ns), hold slack
+0.070 ns with no hold failures, and pulse-width slack +9.500 ns with no failures.
There are no unconstrained internal endpoints; LED and UART outputs lack output
delays, while reset/UART inputs are explicitly false-pathed. This does not
establish complete board-level I/O timing coverage.

The worst setup path starts at `dmem_reg_3_4/CLKBWRCLK` and ends at
`core.nia_reg_reg[15]_replica_1/R`, with 43 LUT levels and 27.828 ns data-path
delay: 6.640 ns logic, 21.188 ns routing. Its mapped cone traverses instruction
decode/DR selection, bitfield acceptance-related logic, another DR selection,
compact LOAD index logic and fault/NIA control. Mapped cell names identify the
logic cone, not a dynamically executed sequence of those instructions.

Source inspection finds DR port selection qualified by accepted-start signals,
including BFEXT/BFINS starts that depend on register-derived bounds checks.
The proposed first candidate separates read-address selection from acceptance,
preserving busy-unit priority and every permission/bounds/write/execute gate.
It is not yet implemented or proven timing-clean. It must retain the original
image and 50 MHz target, receive its own behavioral/structural checks, and be
routed again. The current long replay remains evidence for the original
executable only. No board operation is authorized by this analysis.

### Approved first timing candidate

The user approved preparing this separate correction. DR read ports 1 and 2
now use decoded arithmetic/bitfield/compare selections instead of accepted-start
signals. DREAD/DWRITE busy ownership, the compact-index branch and CHANGE's
busy override remain in their existing priority positions. No start, permission,
bounds, write-enable, retirement or fault policy was changed.

Sixty-nine focused model/structural tests passed: new valid/invalid BFEXT/BFINS
operand cases, register/flag preservation on bounds faults, an AST guard against
accepted-start dependencies in these read muxes, existing independent arithmetic/
indexed-load/conditional/permission tests, and structural core conversion.
These are not physical timing evidence.

Separate generation completed successfully in 37.2 seconds under
`generated-artifacts/new-layout-timing-read-selection/rtl`. Evidence is retained at
`reload-evidence/new-layout-timing-read-selection/generation.json` and `.txt`.
It uses the same exact runtime image and 50 MHz clock. The baseline archive,
droplet project and baseline executable replay have not been replaced.
New source fingerprint:
`fee3b23767af431ee042e3cc5740c7d552703a9a9faded9ccfbb0484896a4708`.
New Verilog SHA-256:
`658c272111a75b5b56c1d43bd2cff7e3b327b0b471037784e8ce72d534c5983d`.
Independent Icarus compilation passed in 481.45 seconds within its 900-second
bound; evidence is `compile.json` / `compile.txt` in the same evidence folder.
The new executable SHA-256 is
`b20b767011486b50fb0c7e13d9d6499e1742c71713cd9b3b64597c67915f72af`.
Its own read-only boot replay is now running, bounded to 600,000 clocks /
5,400 seconds, with unchanged production UART timing and idle UART RX.
Pending evidence is `boot.json` / `boot.txt`; boot completion must be correlated
with the expected ActorManager entry NIA `0x3504`, not inferred from process exit.
The separate package/mock-vendor tests also pass (21 cases), including an
explicit stale-source rejection check for the original package builder.
Generated-design execution, a new routed timing result and hardware acceptance
remain pending for the correction.

The corrected-design boot replay completed in 1,873.53 seconds. It observed
boot handoff at cycle 411792, with final NIA `0x3504` and zero unknown mask.
The terminal observation was boot handoff, not a fault; this stops before
executing ActorManager and does not prove the full Mallory program.

The separate verified package is
`generated-artifacts/new-layout-timing-build.tar.gz`: 2,220,413 bytes,
SHA-256 `09d0231666cf66eaeb58674b90d1d2a8db4fbd2d1102d59f9b5e1f64b5695582`.
Its manifest selects `timing-read-selection` explicitly and binds its own
compile, boot, and transcript evidence. Package checks cover this selection
and rejection of unknown candidates, in addition to the existing guards.
For the previously successful Windows transfer method, its base64 transport is
`generated-artifacts/new-layout-timing-build/DOWNLOAD-timing-package-base64.txt`.
Decode and verify the archive before transfer. Extract into a new trial
directory, never the original droplet build directory. Fresh synthesis,
implementation and routed timing are required; do not reuse the original
synthesis checkpoint or resume script for this corrected RTL.

### Corrected candidate: second routed timing failure

The user supplied the corrected build's terminal result from
`/root/new-layout-timing-trial.1hSpVy/new-layout-timing-build` on 2026-10-25.
Vivado completed routed DRC and reached the timing gate, which rejected
WNS `-2.444938` ns. This improves on the original `-8.384425` ns by
5.939487 ns, but remains a failed 50 MHz implementation. The script exited
before bitstream creation. Neither timing closure nor physical testing passes.

Retrieve this trial's own `timing.txt` before choosing another RTL correction;
the current worst path need not be the original DR-selection path. Hold,
pulse-width, failing-endpoint totals and remaining path details are not
established by this terminal excerpt. Preserve both trials and all timing
gates; do not blindly rebuild, lower the clock, or reuse the original report.

The corrected report is retained at
`reload-evidence/new-layout-timing-read-selection/production-vivado-routed-timing.txt`,
SHA-256 `ca86056d87acc9a196b182237f46d29e3c1b6aa2acc7543bf8bfecc93ded929d`.
It establishes 652 failing setup endpoints, TNS -746.317 ns, hold slack
+0.088 ns with zero failures, and pulse-width slack +9.500 ns with zero
failures. Three output-delay warnings remain for LEDs and UART TX.

Its single detailed setup path runs from `dmem_reg_3_6/CLKBWRCLK` to
`tq_data1_reg[10]/R`, with 30 LUT levels and 21.921 ns data delay
(5.275 ns logic, 16.646 ns routing). The mapped cone crosses instruction and
capability-register selection, DWRITE effective-address logic and trace queue
control. The trace endpoint does not prove a trace-only defect: fault/retirement
logic is shared with execution. Do not remove trace or relax security checks.
Next diagnosis should extract multiple worst endpoints from the existing routed
checkpoint before selecting another RTL change; no rebuild or programming is
needed to obtain that evidence.

The first multi-path diagnostic attempt stopped with `No open design` after
`read_checkpoint`. In a fresh batch session use `open_checkpoint` for standalone
routed-checkpoint analysis. The failed attempt did not produce timing evidence.
The corrected diagnostic uses separate `timing-top20-open.tcl`,
`timing-top20-open.txt` and `timing-details-open.*` files, preserving the first
attempt and the routed checkpoint. It does not rerun implementation.

The corrected diagnostic completed successfully. Its report is retained as
`reload-evidence/new-layout-timing-read-selection/production-vivado-top20.txt`
(SHA-256 `c7c1d75d8f6378a8327f1a34c313de114b27dcf46e05477ae7e2d39a1055911d`).
`timing-path-summary.json` groups all 652 negative-slack endpoint records:
308 trace-queue endpoints, 325 core endpoints, 19 other control endpoints.
Sources are instruction memory (544), the SWITCH Namespace gate's latched GT
(75), and an ordinary CHANGE FSM state bit (33). Only the worst 20 have full
path details; endpoint classification does not prove that all 652 share one cone.

The proposed next correction captures the DWRITE capability and source data at
acceptance, with the core's source-data read selection made ready at that edge.
Later DWRITE permission/address checks must consume the captured operands,
preserving the existing gate order, full-width arithmetic, Namespace-only M-bit
authorization and fault-before-write behavior. This separates the shared live
capability-selection path from DWRITE validation rather than disabling trace
or weakening fault handling. It is not implemented or routed at this point.
Required regressions include live input changes after acceptance, ordinary and
private M-bit paths, NULL/type/W failures, overflow/underflow, and valid writes.
Other negative-slack source groups remain separate timing concerns.

### Approved DWRITE capture candidate

The user approved the separate DWRITE correction. Its RTL now captures the
complete selected capability and data word at acceptance. Private Namespace
initialization selects its private capability/word at that same edge; the
already-latched Namespace authorization remains mandatory. Core DR port 2
preselects DWRITE's source before busy asserts. PERM_CHECK uses captured inputs,
with its existing fault ordering and 33-/36-bit arithmetic unchanged. No FSM
cycle was added and no clock, image, Namespace assignment or hardware command
was changed.

Fifteen new tests pass, covering post-acceptance live-input replacement in both
directions (valid authority removed, invalid authority repaired), payload and
index changes, NULL/type/W failures, underflow/carry/address overflow, ordinary
and private M-bit authorization, and core-level source-data wiring.
The broader seven-file run recorded **310 passes and 3 failures**. The three
failures reproduce with the pre-correction DWRITE:

- `test_full_width_access[65536-0-1-True-4096-read]`
- `test_full_width_access[65536-0-1-True-4096-write]`
- `test_h06_save_committed_memory_and_forbidden_writes[None-0]`

These remain unresolved findings, not waived or passing conformance checks.
Full transcripts and the bounded baseline comparison are retained under
`reload-evidence/new-layout-timing-dwrite-capture/`.
Generation and independent compilation passed in 35.49 and 480.06 seconds
respectively in `generated-artifacts/new-layout-timing-dwrite-capture/`.
Their records confirm unchanged source and image inputs. The exact new
executable's boot replay completed in 1,873.77 seconds with idle UART RX.
It observed handoff at cycle 411792 and known NIA `0x3504`, with no fault
terminal observation. This stops before ActorManager's program executes.
Full-program replay remains pending. The subsequent routed timing failure is
recorded below. Earlier packages and replay evidence stay immutable.

The DWRITE candidate package passed all 24 package/mock-vendor tests and its
standalone verifier. Archive `generated-artifacts/new-layout-dwrite-build.tar.gz`
is 2,222,878 bytes, SHA-256
`fcca50f3f969d35a3b9054dc4c95a42c7284c6be1f2999911ffa50b14b68f69c`.
Its base64 transport file is
`generated-artifacts/new-layout-dwrite-build/DOWNLOAD-dwrite-package-base64.txt`.
The package binds its own RTL, compiler and boot records and includes the
three unresolved regression failures as explicit pending gates and retained
transcripts. Use a new droplet directory and fresh synthesis; do not resume
either previous implementation or claim release/programming approval.

Separately, the original pre-timing-correction executable's full program replay
completed in 17,277 seconds. Its address/opcode observations match the prior
model and it faults at Mallory's expected attempt, NIA `0x2e08`, cycle 3953996,
code 8 (BOUNDS). This is baseline program evidence, not proof for either timing
correction, and does not resolve the source comment's NO_CAPABILITY discrepancy.

### DWRITE candidate routed result — 2026-10-25

The uploaded routed report
`attached_assets/0_new-layout-dwrite-timing_1792966067525.txt`
(Vivado 2026.1, report time 22:02:30) records WNS -3.411 ns,
TNS -2788.063 ns and 2508 failing setup endpoints at 50 MHz.
Hold slack is +0.048 ns with no failing hold endpoints; pulse-width slack is
+9.500 ns with no failures. The build log reports the more precise WNS
-3.411124 ns and stops at the timing gate before bitstream writing.
The preceding routed DRC error gate passed. This is not programming approval.

The reported worst setup path begins at `core.u_save.sub_index_reg[21]`
and ends at `tq_data1_reg[10]/R`. It traverses SAVE fault/control logic,
shared start/read-selection logic, capability read data, DREAD-related logic,
and inferred fault/trace-queue control. Its data delay is 22.980 ns across
35 LUT levels; routing contributes 18.823 ns (81.910%).
This differs from the previous candidate's worst instruction-memory-origin
path, but a single worst-path report cannot establish that all DWRITE paths
are fixed or identify the full failing population. Detailed top-path and
endpoint evidence is required before selecting another correction.

The report still lists missing output delays on led0, led1 and uart_tx_pin.
No unconstrained internal endpoints or combinational loops are reported.
The physical runtime-image reload remains unperformed.

The detailed report uploaded as
`attached_assets/timing-dwrite-top20_1792966455841.txt` contains all 2508
unique failing endpoints (requested maximum 5000, one path per endpoint).
Its source-pin groups are:

| Source | Failing endpoints | Worst slack (ns) |
| --- | ---: | ---: |
| SAVE sub_index[21] | 1661 | -3.411 |
| dmem_reg_3_15 | 486 | -1.948 |
| CHANGE ordinary entry_header[0] | 244 | -0.402 |
| CHANGE ordinary entry_header[23] | 63 | -2.367 |
| CHANGE state[2] | 53 | -2.249 |
| CHANGE ordinary row[6] | 1 | -0.394 |

All twenty detailed worst paths originate at SAVE sub_index[21] and terminate
in trace-queue registers. The full endpoint summary nevertheless includes
956 register-file endpoints, 529 CALL endpoints, 269 CHANGE endpoints and
180 SWITCH endpoints. The issue is not confined to trace recording.
The shared start/busy and capability-read-selection chain is the next
investigation target; these reports do not yet prove a particular correction
or authorize changing instruction/fault semantics. Do not repeat the same
build or disable tracing as a substitute for shortening that chain.
