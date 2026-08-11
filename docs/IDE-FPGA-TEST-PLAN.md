# Church Machine IDE — FPGA Function Test Plan

## 1. Purpose

This plan proves the existing FPGA-facing functions in the Church Machine IDE.
It covers the supported **QMTECH Wukong A7 / XC7A100T** workflow, the
server-side FPGA status page, and the legacy WebSerial/build controls that
remain visible in the Builder.

The plan deliberately separates:

- **Automated software evidence** — unit, mock, server, and browser tests.
- **Hardware-in-the-loop evidence** — a real Wukong, JTAG programmer, UART, and
  bridge.

A passing mock test proves the IDE behavior for the modeled response. It does
not prove that a physical FPGA received or executed the command.

## 2. Test levels

| Level | Name | Meaning |
|---|---|---|
| L0 | Static | JavaScript syntax, route/config checks, and source-level guards |
| L1 | Isolated UI | DOM behavior with mocked browser APIs |
| L2 | Browser E2E | Playwright against a running IDE and mocked HTTP fixtures |
| L3 | Server/protocol | Flask endpoints, queues, status, bridge parser, and ACKs |
| L4 | Hardware-in-loop | Real Wukong bitstream, JTAG programming, UART bridge, and IDE |

The release gate for a claim of **fully tested** is L0–L4 for every supported
Wukong function. L0–L3 alone is **software-tested**, not hardware-tested.

## 3. Preconditions

### Software

1. Start the IDE workflow.
2. Use Chrome or Edge for any WebSerial test.
3. Use the published IDE URL directly for browser hardware access; a Replit
   preview iframe cannot use WebSerial.
4. Install bridge dependencies in a project-local virtual environment. Debian-based
   systems may reject a system-wide `pip install` with
   `externally-managed-environment` (PEP 668):

   ```bash
   cd ~/church-machine
   python3 -m venv .venv
   .venv/bin/python -m pip install --upgrade pip
   .venv/bin/python -m pip install pyserial requests
   .venv/bin/python -c "import serial, requests; print('Dependencies OK')"
   ```

   If `python3 -m venv` is unavailable, install the Debian support package and
   retry:

   ```bash
   sudo apt update
   sudo apt install python3-venv
   ```

   Do not use `--break-system-packages` for this test setup. Either activate the
   environment with `source .venv/bin/activate` and use `python`, or invoke the
   `.venv/bin/python` path explicitly for all bridge commands.

### Hardware

1. QMTECH Wukong A7 / XC7A100T.
2. A known-good Wukong Church Machine `.bit` file.
3. JTAG programmer and cable.
4. USB-UART connection visible as `/dev/ttyUSB0` (verify with `ls /dev/ttyUSB*`).
5. UART at **57600 8N1**.
6. No second application, such as `screen` or `minicom`, has the UART open.
7. Start the bridge before power-cycling the board:

   ```bash
   .venv/bin/python hardware/wukong_bridge.py \
     --port=/dev/ttyUSB0 \
     --ide=https://lab.cloomc.org
   ```

8. Record the board build version and TraceUnit version shown by the boot
   sentinel. A stale sentinel (`0xBB`) is a reflash failure, not a pass.

### Test evidence

For every L4 case, record:

- date/time and IDE URL;
- bitstream/build version and TU version;
- serial device and bridge command;
- expected result;
- observed result;
- screenshot or console capture;
- pass/fail and tester initials.

## 4. Automated baseline

Run these focused suites before manual testing:

```bash
node simulator/test_wukong_toolbar_btn.js
node simulator/test_cmd_click_boot_push.js
node simulator/test_wukong_hw_fault.js
node simulator/test_wukong_console_warning.js
node simulator/test_pipeline_health_stages.js
node simulator/test_builder_testing_tab.js

python3 -m pytest \
  tests/hardware/test_wukong_halt_uart.py \
  tests/server/test_wukong_command_delivery.py \
  tests/server/test_wukong_status_readonly.py \
  tests/server/test_wukong_trace_call_depth.py \
  tests/server/test_wukong_trace_cr_update.py \
  tests/server/test_pipeline_health_status_fields.py \
  tests/hardware/test_wukong_bridge_command_ack.py \
  tests/hardware/test_wukong_bridge_parser.py \
  tests/hardware/test_wukong_trace_symbols.py -q
```

Current baseline observed during creation of this plan:

| Suite | Result |
|---|---:|
| Wukong toolbar | 29 passed |
| Cmd/Ctrl-click hardware boot push | 21 passed |
| Hardware fault handling | 59 passed |
| Pipeline health | 24 passed |
| Builder Testing tab | 11 passed |
| Focused server/hardware pytest group | 106 passed |
| Console warning tests | Passed |
| Full-top UART Run/Pause/Step/Reboot regression | 3 passed |

These results are a baseline, not a substitute for the L4 run.

The full-top regression drives the production `ChurchWukongXC7A100T` UART
receiver. It verifies that `s` pauses a free-running board at an instruction
boundary, advances exactly one instruction while paused, and pauses the board
again after `r` resumes it. It also verifies that legacy `h` remains accepted,
and that `f` re-enters the boot sequence at `0x00000000`, `0x00000004`,
`0x00000008`, then starts `WukongCallHome` at `0x00000704` rather than reusing
a prior loop NIA.

### 4.1 Setup failure captured from an external checkout

If the baseline is run from a machine or checkout that is not fully provisioned,
do not classify the resulting `MODULE_NOT_FOUND` or missing-`pytest` output as an
IDE or FPGA failure. One observed run produced:

- `Cannot find module 'jsdom'` for the toolbar and Builder Testing tests.
- `Cannot find module '.../simulator/test_cmd_click_boot_push.js'`.
- `Cannot find module '.../simulator/test_wukong_console_warning.js'`.
- `/usr/bin/python3: No module named pytest`.
- The Wukong fault suite still passed: **59 passed, 0 failed**.
- The pipeline-health suite still passed: **24 passed, 0 failed**.

The repository declares `jsdom` in `package.json`, and the missing simulator
files are present in the complete checkout. From the repository root, repair
the environment before rerunning the baseline:

```bash
pwd
test -f package.json
test -f simulator/test_cmd_click_boot_push.js
test -f simulator/test_wukong_console_warning.js
npm install

python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt pytest
```

On Debian-based systems, `python3 -m venv` may require:

```bash
sudo apt update
sudo apt install python3-venv
```

Run the Python baseline with `.venv/bin/python -m pytest`, or activate the
environment first with `source .venv/bin/activate`. Confirm that all listed
test files exist before recording the baseline as complete. A partial run must
be recorded as **BLOCKED — setup failure**, while individual suites that
actually completed may retain their observed pass counts.

## 5. Wukong IDE function matrix

### 5.1 Connection and status

| ID | Function | Automated evidence | L4 procedure | Pass criteria |
|---|---|---|---|---|
| W-01 | Wukong toolbar disconnected state | L1: toolbar suite | Stop bridge or unplug board | Button is dim; tooltip says not connected; no false live NIA |
| W-02 | Wukong toolbar connected state | L1: toolbar suite | Start bridge and power-cycle board | Button turns green and eventually shows live NIA |
| W-03 | Connect Wukong guidance | L1: toolbar suite | Click while disconnected | Popover explains bridge setup and shows useful health state |
| W-04 | HW Trace panel reveal | L1: toolbar suite | Click green Wukong button | Trace panel appears, scrolls into view, and remains usable |
| W-05 | Trace panel collapse/expand/clear | L1 partial; no complete L4 evidence | Receive events; collapse, expand, clear | State changes work and clear removes only displayed log entries |
| W-06 | Pipeline health strip | L1/L3: health suites | Observe bridge, trace, boot, and IDE-event stages | Four stages accurately become green/amber/red as conditions change |
| W-07 | Version/health view | L3: versions/status tests | Open Builder → Versions and refresh | IDE, FPGA, bitstream, and production information load without stale labels |
| W-08 | Production event mirror | L3 relay tests; browser coverage partial | Enable mirror from disconnected popover | Mirror banner appears, events arrive, source and health are accurate, disable removes it |

### 5.2 Execution controls

| ID | Function | Automated evidence | L4 procedure | Pass criteria |
|---|---|---|---|---|
| W-10 | Step HW | Full-top UART regression; bridge delivery tests | With board paused, click Step HW once | Exactly one `s` reaches UART; one new trace event appears; NIA advances; board remains paused |
| W-11 | HW Run/Pause toggle | Full-top UART regression; command delivery and boot-push tests | Click HW Run, then click HW Pause | `r` resumes free-run; the same control changes to Pause; `s` pauses at the next instruction boundary and the control returns to Run |
| W-12 | Legacy Halt compatibility | Full-top UART regression; legacy bridge tests | Use an older bridge that sends `h` | `h` is accepted as a compatibility command; no separate Halt button is required |
| W-13 | Run/Pause failure recovery | L1/mock coverage | Stop bridge during a Run/Pause command delivery | Error is visible and the toggle reverts to the truthful local state |
| W-14 | Hardware breakpoint set | Command encoding/ACK tests; UI coverage partial | Open disassembly, click gutter at a valid NIA | `b` plus big-endian NIA is written; gutter marks breakpoint |
| W-15 | Hardware breakpoint hit | Protocol coverage partial; no complete L4 test | Run program through breakpoint | Board halts at requested NIA; trace/fault UI identifies breakpoint hit |
| W-16 | Hardware breakpoint clear | Command encoding/ACK tests; UI coverage partial | Click armed breakpoint gutter again | `0xFFFFFFFF` clear command is written; marker disappears |
| W-17 | Load to Hardware | L1/mock: 21-case boot-push suite; server upload tests | Cmd/Ctrl-click a boot entry or click Load | Correct entry slot is generated, uploaded, acknowledged, and followed by confirmed `r` |
| W-18 | Upload failure handling | L1/mock and L3 upload tests | Disconnect bridge during upload | Timeout/error is displayed; no false success badge; controls recover |
| W-19 | Hardware NIA cursor | Trace/fault software tests; browser coverage partial | Step or run a board with disassembly open | Current NIA row is highlighted and follows trace events |
| W-20 | Call-depth badge | L3 call-depth and trace tests | Execute CALL/RETURN program | Badge increments on call push and returns to the prior depth on pop |

### 5.3 Fault and diagnostic functions

| ID | Function | Automated evidence | L4 procedure | Pass criteria |
|---|---|---|---|---|
| W-30 | Hardware fault detection | 59 passing fault tests | Run a controlled fault program | Fault is shown once with correct type and NIA |
| W-31 | Fault details/disassembly | Software fault tests; physical display partial | Open fault details after a fault | Faulting address, mnemonic/context, capability snapshot, and source/disassembly are coherent |
| W-32 | Fault clear/recovery | Fault suite covers transitions | Clear or recover, then trigger a second fault | Panel hides once; a later distinct fault opens a new panel |
| W-33 | Stale bitstream warning | Console warning and sentinel tests | Attach to stale bitstream | IDE shows warning and does not classify stale data as current |
| W-34 | Boot sentinel/re-arm | Server/status coverage; no complete L4 test | Click Reboot on `/fpga` | `f` is delivered; board emits sentinel; version/build status updates |
| W-35 | Bridge disconnect detection | Toolbar/status software coverage | Stop bridge or unplug USB | IDE changes to disconnected, hides hardware controls, and explains the failure |

## 6. Builder and flash functions

These controls are present in the Builder even though the current supported
Wukong IDE path uses a pre-built bitstream plus the UART bridge.

| ID | Function/button | Current status | Required proof |
|---|---|---|---|
| B-01 | Target board selector | Software coverage incomplete | Select Wukong, reload Builder, verify Wukong remains selected and all labels/routes use Wukong |
| B-02 | Build | Backend path exists; browser E2E incomplete | Click Actions → Build; verify request, log, success/error state, and generated files |
| B-03 | Download FPGA Package | Server/package paths covered; browser download incomplete | Build first, download ZIP, inspect required Wukong `.v`, `.xdc`, `.tcl`, bridge, and BUILD files |
| B-04 | Download `.bin` | No dedicated UI test identified | Compare downloaded header/word count with current simulator namespace and c-list |
| B-05 | Download `.bit` | Serve endpoint covered; download/programming manual | Download file, verify non-zero size, then program through JTAG and record configuration success |
| B-06 | Flash via Startup Wizard | Startup Wizard E2E exists; physical flash not automated | Complete every wizard step, then program the board and verify sentinel/LED behavior |
| B-07 | Watch for next build | No dedicated coverage identified | Start watch, create/serve next build, verify notification and correct next build letter |
| B-08 | Deploy to FPGA / WebSerial | Legacy path; not the primary Wukong bridge path | In direct Chrome/Edge tab, connect, upload, verify readback, and verify clean disconnect |
| B-09 | Test UART | No dedicated coverage identified | Click Test UART, choose Wukong UART, verify probe response and readable diagnostics |
| B-10 | Builder Testing tab | 11 passing UI tests | Open tab and verify `/fpga` iframe, navigation persistence, controls, and status |

For Wukong, B-08 and B-09 must be labeled as **legacy/WebSerial** unless the
hardware build explicitly supports their protocol. A passing WebSerial test
must not be used as evidence that the Wukong UART bridge path works.

## 7. FPGA status page matrix

Open the page from the IDE’s Builder → Testing tab or directly at the deployed
FPGA status URL.

| ID | Control | Required verification |
|---|---|---|
| S-01 | Step | From paused state, one `s` command, one serial write, delivery status, one trace response, and a paused final state |
| S-02 | Run/Pause toggle | `r` starts free-run; the same control sends `s` to pause at the next instruction boundary; labels and delivery status stay truthful |
| S-03 | Legacy `h` compatibility | Optional protocol check only; `h` is accepted for older bridges and is not a separate UI control |
| S-04 | Set BP | Valid hex NIA accepted and sent in correct byte order |
| S-05 | Set BP invalid input | Invalid/empty/out-of-range value rejected without queueing |
| S-06 | Upload boot image | Current image is queued, bridge ACK appears, upload state clears |
| S-07 | Reboot | `f` command is delivered and boot sentinel status refreshes |
| S-08 | Single-command lock | Start a command watch, click another control, verify the first watch cannot be falsely superseded |
| S-09 | Delivery failure | Simulate/induce serial write failure; show failure rather than success |
| S-10 | Clear log | Only the rendered event log is cleared; server counters and status remain valid |
| S-11 | Status polling | Repeated status refreshes do not consume commands, uploads, events, or boot information |

Server-side evidence already exists for most of S-01–S-11. The L4 pass still
requires observing the real board response for S-01, S-02, S-06, and S-07.
The bridge ACK is only transport evidence; it does not by itself prove that the
FPGA received or applied the command.

## 8. End-to-end execution order

Run the tests in this order to avoid confusing a stale bitstream with a UI
failure:

1. Run the automated baseline in §4.
2. Program the known-good bitstream over JTAG.
3. Start the bridge.
4. Power-cycle the board and record the sentinel/version.
5. Pass W-01–W08 (connection/status).
6. Pass W-10–W20 (execution controls).
7. Pass W-30–W35 (fault/diagnostics).
8. Pass S-01–S-11 on the `/fpga` page.
9. Pass B-01–B-10, marking legacy WebSerial controls separately.
10. Repeat W-10, W-11, W-12, W-14, W-17, and W-34 after stopping and
    restarting the bridge.
11. Save the evidence bundle and complete the results table.

## 9. Results table

Copy this table for each hardware run. Do not mark a case `PASS` without
attaching the required evidence.

| Test ID | Result (`PASS`/`FAIL`/`BLOCKED`/`N/A`) | Evidence reference | Notes |
|---|---|---|---|
| W-01–W-08 |  |  |  |
| W-10–W-20 |  |  |  |
| W-30–W-35 |  |  |  |
| B-01–B-10 |  |  |  |
| S-01–S-11 |  |  |  |

### 9.1 Recorded hardware run — 2026-08-11

This run used the published IDE at `https://haskell-main-1.replit.app`, a
restarted Chromebook bridge, the Wukong onboard USB-UART, build **8**, and
TraceUnit version **2**. The bridge was live: trace packets were continuously
posted and command polling was active.

| Test | Result | Evidence | Interpretation |
|---|---|---|---|
| S-07 Reboot | **PASS** | Command `f`, ID **15**, was consumed and written successfully at `2026-08-11 14:47:23 UTC`. The boot sentinel record refreshed from the previous timestamp to `2026-08-11 14:47:23 UTC`, still reporting build 8 / TU 2. | The physical FPGA responded to the force-sentinel command. |
| Legacy Halt `h` | **FAIL (legacy path; superseded by toggle model)** | Command `h`, ID **16**, was consumed and written successfully at `2026-08-11 14:47:30 UTC`. Trace sequence advanced from **4547** before the test to **4552** two seconds later and **4568** six seconds later. | The bridge/server path worked, but that older physical bitstream did not stop. The current user-facing control uses `s` for a clean Run → Pause transition. |

The corresponding source/full-top RTL checks pass locally: the production UART
`s` frame pauses and steps as specified, the legacy `h` frame still latches
`(step_mode, step_halted) = (1, 1)`, and the production UART `f` frame produces
the post-reboot NIA sequence
`0x00000000 → 0x00000004 → 0x00000008 → 0x00000704`. This does not replace
the physical run because the checked-in build-8 metadata identifies source
commit `42696d06`; a current-source bitstream must be programmed before using
the local regression as board evidence.

The run therefore proves:

- trace receive from the FPGA to the bridge/server;
- command queueing, bridge polling, serial writes, and delivery acknowledgments;
- physical Reboot/force-sentinel behavior.

It does **not** prove physical Run/Pause/Step control, breakpoints, or the
complete L4 execution-controls group. Do not promote those cases to `PASS`
based on the command ACK alone.

## 10. Failure classification

- **IDE defect:** request, state, rendering, or error handling is wrong with a
  valid mocked/server response.
- **Server/protocol defect:** endpoint, queue, ACK, status, or byte encoding is
  wrong independent of the physical board.
- **Bridge defect:** the bridge does not poll, parse, write, ACK, or reconnect
  correctly.
- **Bitstream defect:** sentinel/version/trace behavior is wrong after a
  confirmed successful JTAG program.
- **Setup failure:** wrong serial port, missing dependency, stale bitstream,
  missing bridge, permissions, cable, or board power problem.

Record the classification before changing code. This prevents a setup failure
from being “fixed” as an IDE change.

## 11. Completion criteria

The FPGA IDE function set is proven only when:

1. The automated baseline passes.
2. Every applicable W-, B-, and S-series case has a result.
3. Every current Wukong control has at least one L4 pass.
4. Legacy WebSerial controls are either L4-passed or explicitly marked
   unsupported/N/A for Wukong.
5. At least one restart/reconnect cycle passes.
6. No case is marked `PASS` solely because a mock test passed.
