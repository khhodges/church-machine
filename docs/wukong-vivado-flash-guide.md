# QMTECH Wukong A7 — Vivado Hardware Manager Flash Guide

This is the canonical programming guide for the QMTECH Wukong V3
(`XC7A100T-2FGG676C`). It covers AMD/Xilinx Vivado Hardware Manager on
Windows, including both the temporary JTAG path and the persistent SPI flash
path.

## Before you start

Install Vivado 2020.x or later (the WebPACK edition is sufficient for
programming), then connect:

- the Wukong board to a stable 3.3 V supply;
- a supported Xilinx JTAG adapter (Digilent JTAG-HS2, Platform Cable USB II,
  or equivalent) to the board's JTAG header; and
- the board's USB-UART cable if you want to check the boot sentinel.

Close Vivado instances, other JTAG tools, and serial terminals that may already
own the adapter. Build or download these files into one folder:

| File | Use |
|---|---|
| `church_wukong_xc7a100t.bit` | Volatile FPGA configuration |
| `church_wukong_xc7a100t.mcs` | Persistent SPI configuration-memory image |
| `church_wukong_xc7a100t.ltx` | Optional ILA probes; only produced with `--insert-ila` |

The FPGA is `xc7a100tfgg676-2`. The board's configuration memory is a **Micron
N25Q064**, 64 Mbit (8 MB), 3.3 V SPI flash. In Vivado the exact configuration
memory selector is:

```text
n25q64-3.3v-spi-x1_x2_x4
```

Do not select a W25Q256, W25Q256JV, or another 256-Mbit part. A part mismatch
can make programming fail or leave a board that does not boot from flash.

## A. Temporary test: program the `.bit` over JTAG

Use this path first when testing a new build. It configures the FPGA's volatile
configuration memory (CRAM) only; pressing reset or removing power loses it.

1. Start Vivado and choose **Open Hardware Manager** (or open
   **Hardware Manager** from the Flow Navigator).
2. Click **Open target** → **Auto Connect**. If auto-connect does not find it,
   choose **Open New Target**, select **Local server**, and connect to the
   adapter.
3. In the Hardware window, confirm that the detected device is
   `xc7a100t` (the full part is `xc7a100tfgg676-2`). If a different FPGA is
   shown, stop and fix power, JTAG wiring, or the selected target.
4. Right-click the FPGA → **Program Device**.
5. For **Bitstream file**, browse to
   `church_wukong_xc7a100t.bit`. For an ILA-enabled build only, set **Probes
   file** to the matching `church_wukong_xc7a100t.ltx`. Leave Probes file
   blank for a normal build.
6. Click **Program** and wait for the Hardware Manager status to report
   completion. The image runs immediately after JTAG programming.

Equivalent Hardware Manager Tcl:

```tcl
open_hw_manager
connect_hw_server -allow_non_jtag
open_hw_target
set device [lindex [get_hw_devices] 0]
refresh_hw_device -update_hw_probes false $device
set_property PROGRAM.FILE {church_wukong_xc7a100t.bit} $device
# ILA build only:
# set_property PROBES.FILE {church_wukong_xc7a100t.ltx} $device
program_hw_devices $device
```

Use `.bit` for a quick volatile test or to verify the JTAG/cable path before
writing flash. It is not a persistent installation.

## B. Persistent boot: program the `.mcs` into SPI flash

Use this path when the image must load after reset and power cycles without a
JTAG cable. Only proceed after the `.mcs` was generated from the intended
`church_wukong_xc7a100t.bit`.

1. Open the target as in steps A1–A3 and confirm `xc7a100t`.
2. Right-click the FPGA and choose **Add Configuration Memory Device**.
3. In the part list select exactly
   `n25q64-3.3v-spi-x1_x2_x4` (Micron N25Q064, 64 Mbit). Do not select a
   similarly named W25Q256 part.
4. In the configuration-memory programming dialog, set **Configuration file**
   or **Program file** to `church_wukong_xc7a100t.mcs`.
5. Enable **Erase**, **Program**, and **Verify**. Leave blank-check disabled
   unless you specifically need it; it is not required for this image.
6. Click **Program Configuration Memory** and wait for both programming and
   verification to complete successfully.
7. Click **Boot from Configuration Memory** (or use **Boot HW Device** in the
   Hardware Manager Tcl console), then press the board's RESET button. Finally
   disconnect JTAG and power-cycle once to prove the flash boot path.

Equivalent Tcl, run after opening the target:

```tcl
set device [lindex [get_hw_devices] 0]
refresh_hw_device -update_hw_probes false $device
set parts [get_cfgmem_parts {n25q64-3.3v-spi-x1_x2_x4}]
if {[llength $parts] != 1} {
    error "Vivado does not expose n25q64-3.3v-spi-x1_x2_x4; run get_cfgmem_parts *n25q64* and use a Vivado version with the verified N25Q064 part."
}
create_hw_cfgmem -hw_device $device [lindex $parts 0]
set cfgmem [get_property PROGRAM.HW_CFGMEM $device]
set_property PROGRAM.FILES        [list {church_wukong_xc7a100t.mcs}] $cfgmem
set_property PROGRAM.BLANK_CHECK 0 $cfgmem
set_property PROGRAM.ERASE       1 $cfgmem
set_property PROGRAM.CFG_PROGRAM 1 $cfgmem
set_property PROGRAM.VERIFY      1 $cfgmem
program_hw_cfgmem $cfgmem
boot_hw_device $device
```

The `.mcs` survives FPGA reset and power loss because it is stored in the
board's SPI configuration flash. Verification must succeed before treating it
as persistent.

## Post-program checks

After `.bit` programming, the image should run until reset or power is
removed. After `.mcs` programming, perform both a RESET-button test and a
full power-cycle test with JTAG disconnected.

Expected Wukong behavior:

- LEDs are active-low: D1/LED0 is G21 and D2/LED1 is G20; driving a pin LOW
  illuminates it.
- During boot, D1 is solid on and D2 heartbeat-blinks. In a healthy running
  image D1 blinks at about 1 Hz and D2 is off. D2 on after boot indicates the
  fault latch.
- The UART is on E3 (TX) and F3 (RX), 57600 baud, 8 data bits, no parity, one
  stop bit (8N1). On Linux it is commonly `/dev/ttyUSB0`; on Windows use the
  COM port shown by Device Manager.
- A current image emits `0xBC N_INIT 0x02 BUILD_VERSION`; `0x02` is the
  current TraceUnit version. The current source build version is `16`, so the
  reference sentinel is `0xBC <N_INIT> 0x02 0x10` (N_INIT may change when the
  embedded image changes). A `0xBB <N_INIT>` sentinel means the bitstream is
  stale and should be rebuilt and reprogrammed.

Start the bridge after the serial check:

```powershell
py -m pip install pyserial requests
py .\wukong_bridge.py --port=COM3 --ide=https://<your-replit-url>
```

On Linux, use `python3 hardware/wukong_bridge.py --port=/dev/ttyUSB0
--ide=https://<your-replit-url>`. Do not open the same serial port in
PuTTY/minicom while the bridge is running.

## Troubleshooting

| Symptom | Next action |
|---|---|
| No hardware target or no JTAG devices | Confirm board power, adapter orientation, drivers, and the 14-pin header; close other JTAG tools; reopen the hardware target. |
| Detected FPGA is not XC7A100T | Stop programming. Check the board/cable and target; this guide is for `xc7a100tfgg676-2`, not the part Vivado happened to enumerate. |
| N25Q064 is missing from the part list | Run `get_cfgmem_parts *n25q64*` in the Tcl console. Record the spelling, then use a Vivado installation with the verified selector or update the helper deliberately; never substitute W25Q256. |
| “Part selected … but … detected” | Remove the cfgmem object, select `n25q64-3.3v-spi-x1_x2_x4`, and recreate it. The physical chip is N25Q064. |
| Bitstream or MCS file not found | Browse to the extracted/generated file and check its exact name. Run Vivado from the folder containing the files, or use absolute paths in Tcl. |
| Program or verify fails | Check stable power and JTAG seating, erase the configuration memory, retry once, and compare the selected part and MCS size. Do not reset during verify. |
| Board works only while JTAG is connected | The `.bit` was loaded into volatile CRAM, or flash programming/verification did not complete. Program the N25Q064 `.mcs`, boot from configuration memory, then test with JTAG removed. |
| No `0xBC` sentinel or UART output | Check E3 TX/F3 RX, 3.3 V ground, 57600 8N1, and the selected COM port; power-cycle after starting the terminal. |
| D2 stays lit or D1 does not blink | D2 is the active-low fault LED. Check the sentinel and bridge trace for a fault, then rebuild/reflash if the image is stale. |

For the build and board electrical details, see
[HARDWARE.md](HARDWARE.md). For the full boot/bridge procedure, see
[StartupCM.md](StartupCM.md).