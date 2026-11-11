# Frozen combined-starter vendor package

This is the isolated **combined_starter**, not the older diagnostic top.
The source manifest pins the qualified runtime and both approved application
images, including the approved received-LUMP records in its frozen inputs.
The board wrapper is **not qualified by runtime UART tests**.

## Permitted now: local preparation only

From the repository:

```sh
python3 docs/phase-2/cooperative-retry/export_combined_board.py \
  --output generated-artifacts/combined-vendor-NEW
python3 generated-artifacts/combined-vendor-NEW/generate.py
```

Use a fresh directory. Generation needs Python, Amaranth, and native Yosys on
PATH. It exports RTLIL and converts processes to Verilog with the recorded
Yosys script; it does not invoke vendor tools. The export receipt captures
tool versions and hashes of RTLIL, Verilog, and conversion instructions.
All packaging inputs, including build scripts and constraints, are hashed.
Never edit the frozen package to repair a build: fix the repository inputs and
export a new package. A changed runtime identity requires requalification.

## Separate authorization required before vendor tools

Do not run Vivado yet. After an explicit human authorization for this exact
package and toolchain, create an authorization JSON outside the frozen inputs:

```json
{
  "schema": "church.combined-vendor-authorization/v1",
  "boardSourceSha256": "<exact board source manifest hash>",
  "verilogSha256": "<exact export receipt Verilog hash>",
  "allowVendorBuild": true,
  "allowProgramming": false,
  "approvalReference": "<actual authorization decision reference>",
  "vivadoVersion": "<exact first line of authorized vivado -version>"
}
```

Only after approval:

```sh
python3 build_vendor.py --authorization /absolute/path/approval.json
```

The authorization file records consent; it is not an authentication system.
Do not fabricate approval or run build.tcl directly to bypass this boundary.
The build is local-only, fixed-part, single-threaded, with explicit synthesis,
placement and routing settings. Repeat builds require fresh exports with the
same source identity and recorded tool versions. Byte-for-byte BIT reproducibility
is not promised (vendor headers/toolchain may vary); each BIT gets its own hash.

## Fail-closed board checks and receipts

- Exactly four ports: M21 50 MHz clock, M6 active-low held maintenance with
  pullup, F3 UART RX, E3 UART TX; all LVCMOS33, correct directions.
- MMCM: 20 ns input, divide 1, multiply 20, output divide 40.
- Clock IBUF → MMCM; MMCM feedback → BUFG → feedback input;
  MMCM output → BUFGCE; LOCKED → CE. The derived execution clock is 40 ns
  (25 MHz) and every retained register must use it.
- Check both synthesized and routed connectivity. No NSTD-1/UCIO-1 downgrade.
  Recognize Vivado's BUFGCTRL expansion only with the legacy BUFGCE identity,
  synchronous arm-0 enable and verified constants disabling the other arm.
  Explicitly enable NSTD-1/UCIO-1 and set both to Error at each stage; do not
  rely on Vivado's post-synthesis Critical Warning defaults.
- Asynchronous external maintenance/RX inputs and UART TX output are explicit
  timing exceptions, not synchronous interfaces. No internal endpoint may
  remain unconstrained. Missing/unrecognized timing evidence is a failure.
- Require nonnegative worst setup and hold slack, a passing timing summary,
  and no Error or Critical Warning DRC violations.
- Save clock, clock-interaction, I/O, utilization, timing, check-timing, and
  DRC reports plus synthesis/routed checkpoints and logs.
- Only after all gates pass may the script write a BIT and success receipt.
  The receipt binds report hashes, source/runtime/Verilog identities, tool
  versions, authorization and BIT hash. Failed builds retain logs but have no
  success receipt. Never reuse a previous vendor output directory.

No vendor results are supplied by local tests. The scripts themselves still
need an authorized Vivado run; unexpected report/property formats fail closed
for review rather than weakening checks. Vendor success is not physical proof
of clock startup, button behavior, UART timing, or the three application flows.
Board identification, access, transfer, programming and physical demonstrations
remain separately authorized. Nothing here changes the working system.
