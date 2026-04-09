# Patching the Tang Nano 20K FPGA — Complete Guide

This guide takes you from unboxing a Tang Nano 20K to running your own
Church Machine code on real silicon. Most users only need Part A (Getting
Started) and Part B (Writing and Patching Code). Building the bitstream
from source is covered in Part C for advanced users.

---

## Part A: Getting Started

### What you need

- A **Tang Nano 20K** board (Sipeed, ~$20)
- A USB-C cable to connect it to your computer
- A computer running **Linux** or **ChromeOS** (with Linux container)

### Step 1 — Install the FPGA tools

You need **openFPGALoader** to flash the bitstream to the board, and
**Python 3 + pyserial** to send code patches over UART.

Install the OSS CAD Suite (includes openFPGALoader and all FPGA tools):

```bash
# Download from: https://github.com/YosysHQ/oss-cad-suite-build/releases
# Choose the linux-x64 build, extract it, then activate:
source ~/oss-cad-suite/environment
```

Install pyserial (for the patch tool):

```bash
pip3 install pyserial
```

### Step 2 — Download the latest bitstream

Download the pre-built bitstream and patch tool from the Replit project.
In the IDE file tree, find and download these files:

```
Files to download:
  build/church_tang_nano_20k_iot.fs     (bitstream — flash this to the board)
  tools/patch_fpga.py                   (CLI patcher — sends code over UART)
```

If no pre-built `.fs` file exists in `build/` yet, you will need to build
it from source — skip to **Part C: Building the Bitstream from Source**,
then come back here.

Put the files in a working directory on your local machine:

```
~/church-fpga/
├── church_tang_nano_20k_iot.fs
└── patch_fpga.py
```

### Step 3 — Plug in the Tang Nano 20K

Connect the board via USB-C. Check that it was detected:

```bash
ls /dev/ttyUSB*
```

You should see two ports. The FT2232 chip on the board creates:

| Port | Channel | Purpose |
|------|---------|---------|
| `/dev/ttyUSB0` | A (JTAG) | Used by openFPGALoader to flash the bitstream |
| `/dev/ttyUSB1` | B (UART) | Used by patch_fpga.py to send code at 115200 baud |

If you get `Permission denied` on the serial ports:

```bash
sudo usermod -aG dialout $USER
# Log out and back in for this to take effect

# Or for a quick fix:
sudo chmod 666 /dev/ttyUSB*
```

### Step 4 — Flash the bitstream

Upload the bitstream to the FPGA:

```bash
cd ~/church-fpga
openFPGALoader -b tangnano20k church_tang_nano_20k_iot.fs
```

Wait for:

```
Load SRAM: [==================================================] 100.00%
Done
DONE
```

### Step 5 — Check the LEDs

After flashing, the board should show:

| LED | Pin | Meaning | What you should see |
|-----|-----|---------|---------------------|
| led0 | 15 | Boot/Run | Solid ON — boot sequence completed |
| led1 | 16 | Halt | Blinking — core halted, waiting for code |
| led2 | 19 | Fault | OFF — no capability fault (good) |
| led3 | 20 | Heartbeat | Blinking ~1 Hz — clock is alive |

**One solid + two blinking = success.** The Church Machine core booted
and is waiting for you to send it code.

---

## Part B: Writing and Patching Code

This is the everyday workflow: write code in the IDE, export a patch file,
and flash it to the FPGA with one terminal command. No bridge server, no
certificates, no browser connection needed.

```
IDE (browser) ──Export──► .patch file ──patch_fpga.py──► Tang Nano 20K
```

### Step 6 — Write your code in the IDE

1. Open the Church Machine IDE in your browser
2. Click **CRs** in the toolbar to open the capability registers panel
3. Click on a **CR** — for example, **CR14** (the instruction fetch register)
4. Click **Edit** to open the code editor for that CR's code lump
5. Write or modify your Church Machine assembly

### Step 7 — Compile and test in the simulator

Click **Patch** to assemble your code into binary machine words and write
them into the simulator memory. This is the compilation step — it
produces the binary code that will be sent to the FPGA. You can then
step through instructions, inspect registers, and check for capability
faults before committing to real hardware.

If the assembler reports errors, fix them and click **Patch** again.

### Step 8 — Export the patch file

Click **Export Patch** in the CR detail card. This takes the compiled
binary from Step 7, packages it into a `.patch` file with UART framing
and CRC checksums, and downloads it. Specifically it:

1. Packages the compiled code into PATCH_LUMP UART frames (with tags,
   addresses, and CRC-16/CCITT checksums)
2. Appends the RUN sentinel so the FPGA starts executing after upload
3. Shows a **patch preview** in the log for cross-checking
4. Downloads a `.patch` file (e.g. `CR14_patch.patch`)

The preview looks like:

```
Block 0: Code lump  addr=0x0141  words=7
NS table update included: no

--- Patch Preview (cross-check with patch_fpga.py output) ---
  Block 0: addr=0x0141  words=7  CRC=0xD6F7  frame=36 bytes
  RUN sentinel: [0xBE 0xAA] included in file
  File size: 40 bytes

Downloaded: CR14_patch.patch
```

### Step 9 — Flash the patch to the FPGA

Copy the `.patch` file to your local machine (or use it directly if you
downloaded it there), then run:

```bash
cd ~/church-fpga
python3 patch_fpga.py /dev/ttyUSB1 CR14_patch.patch
```

Output:

```
Church Machine FPGA Patcher
  File   : CR14_patch.patch
  Blocks : 1
  RUN    : yes

  Block 0: addr=0x0141  words=7  CRC=0xD6F7  frame=36 bytes

  Serial : /dev/ttyUSB1 @ 115200 baud

  Block 0: TX 36 bytes  addr=0x0141  words=7  CRC=0xD6F7
           RX echo OK: addr=0x0141  count=7

  Sending RUN sentinel (0xBE 0xAA)...
  RUN sent — core executing from PC=0.

SUCCESS — all blocks patched and verified.
```

**Cross-check**: the CRC and address values in the IDE preview and the
script output must match exactly. If they don't, the file may have been
corrupted during transfer.

### Step 10 — Check the LEDs

After the RUN command:

- **led0** stays solid (boot complete)
- **led1** stops blinking (core running, not halted)
- **led2** OFF = no fault, ON = capability fault triggered

**That's it!** To change your code, repeat Steps 6–10: edit, compile in
the simulator, export, flash. Each cycle takes under a minute.

---

## Part C: Building the Bitstream from Source

If you need to modify the hardware design (add peripherals, change the
memory map, adjust the boot ROM), you'll need to build the bitstream from
Amaranth HDL source. This is a one-time setup — once you have a `.fs` file,
use Part B for code changes.

### Requirements

Everything from Part A, plus:

- **Yosys** — synthesis (included in OSS CAD Suite)
- **nextpnr-himbaechel** — place and route for Gowin FPGAs (included in OSS CAD Suite)
- **~20 GB of RAM** — nextpnr needs this for the GW2AR-18C device

### Step 11 — Generate Verilog (in the Replit IDE)

Amaranth HDL is converted to synthesizable Verilog:

```bash
python3 -m hardware.gen_verilog --iot build
```

Output:

- `build/church_core_iot.v`
- `build/church_tang_nano_20k_iot.v`

### Step 12 — Synthesize with Yosys (in the Replit IDE)

Yosys converts the Verilog into a Gowin-specific netlist:

```bash
yosys -p "read_verilog build/church_tang_nano_20k_iot.v; \
          synth_gowin -top top \
          -json build/church_tang_nano_20k_iot.json"
```

Output: `build/church_tang_nano_20k_iot.json` (~16 MB netlist)

Check for: `Found and reported 0 problems.` at the end.

### Step 13 — Download files to your local machine

Download from the Replit project:

- `build/church_tang_nano_20k_iot.json` (synthesized netlist)
- `hardware/tang_nano_20k.cst` (pin constraints)

```
~/church-fpga/
├── build/
│   └── church_tang_nano_20k_iot.json
└── hardware/
    └── tang_nano_20k.cst
```

### Step 14 — Place and Route (local machine)

This maps the netlist onto the physical FPGA. Takes 3–5 minutes with
~20 GB of RAM:

```bash
cd ~/church-fpga

nextpnr-himbaechel \
    --device GW2AR-LV18QN88C8/I7 \
    --json build/church_tang_nano_20k_iot.json \
    --write build/church_tang_nano_20k_iot_pnr.json \
    -o family=GW2A-18C \
    -o cst=hardware/tang_nano_20k.cst \
    --freq 27
```

Wait for: `Info: Program finished normally.`

### Step 15 — Pack and flash

```bash
gowin_pack -d GW2A-18C \
    -o church_tang_nano_20k_iot.fs \
    build/church_tang_nano_20k_iot_pnr.json

openFPGALoader -b tangnano20k church_tang_nano_20k_iot.fs
```

Check the LEDs (same as Step 5), then use Part B to write and patch code.

You can also use the Makefile in the `hardware/` directory for the PnR
and packing steps. The Makefile expects the synthesized `.json` file to
be in the same directory, so copy it there first:

```bash
# Copy the netlist into hardware/ (Makefile expects it there)
cp build/church_tang_nano_20k_iot.json hardware/

# From the hardware/ directory:
cd hardware
make tang-iot      # place-and-route + pack (requires .json already present)
make prog-iot      # flash to the board
```

Note: the Makefile does not run Verilog generation or Yosys synthesis —
those must be done manually first (Steps 11–12).

---

## Part D: Browser Bridge (Alternative Patching Method)

If you prefer to patch directly from the IDE without downloading files,
you can run a bridge script on your local machine that relays UART traffic
between the browser and the FPGA.

**Note**: The Export + CLI method in Part B is simpler and more reliable.
The bridge requires HTTPS certificates and has known issues on some
ChromeOS configurations.

```
IDE (browser) ──HTTPS──► Bridge (your terminal) ──USB/UART──► Tang Nano 20K
```

### Step 16 — Start the bridge

In a terminal on your local machine (keep it running):

```bash
cd ~/church-fpga
python3 local_bridge.py /dev/ttyUSB1 115200
```

You should see:

```
Church Machine FPGA Bridge (HTTPS)
  Serial : /dev/ttyUSB1 @ 115200 baud
  HTTPS  : https://0.0.0.0:8766
  ChromeOS bridge URL: https://penguin.linux.test:8766
```

Download `server/local_bridge.py` from the Replit project if you don't
have it already.

### Step 17 — Accept the self-signed certificate

The bridge generates an HTTPS certificate on each startup. Chrome needs
to trust it once per session:

1. Open a new Chrome tab
2. Go to: `https://penguin.linux.test:8766/status`
   (on native Linux, use `https://localhost:8766/status`)
3. Chrome shows a security warning — this is expected (it's your own machine)
4. Click **Advanced**, then **Proceed**
5. You should see: `{"ok": true, "open": true, "port": "/dev/ttyUSB1", "baud": 115200}`

### Step 18 — Connect the IDE

1. Hard refresh the IDE: **Ctrl + Shift + R**
2. Click the **Bridge** button in the IDE toolbar
3. Accept the default URL and press **OK**
4. Console shows: `FPGA Bridge: Connected`

Once connected, use **Patch FPGA** (instead of Export Patch) to send code
directly from the IDE to the FPGA in one click.

---

## Troubleshooting

### openFPGALoader says "No device detected"

- Is the USB cable a data cable (not charge-only)?
- Try a different USB port
- On ChromeOS, make sure the USB device is shared with the Linux container
  (Settings > Developers > Linux > USB devices)

### No serial ports in /dev/ttyUSB*

- The FT2232 driver may not be loaded. Try: `sudo modprobe ftdi_sio`
- On ChromeOS, share the device: Settings > Developers > Linux > USB

### "Permission denied" on serial port

```bash
# Permanent fix (requires logout/login):
sudo usermod -aG dialout $USER

# Quick fix:
sudo chmod 666 /dev/ttyUSB1
```

### "No echo received (0 bytes)" from patch_fpga.py

- Is the FPGA powered on with the correct bitstream flashed?
- Are you using the right port? UART is Channel B (usually `ttyUSB1`)
- The serial port may change after reflashing. Check `ls /dev/ttyUSB*`
- Try power-cycling the board (unplug and replug USB)

### "Editor is empty" in the IDE

- Select a CR first, then click **Edit** to load the code
- Or click **Export Patch** directly — it auto-loads existing code from
  the simulator memory if the editor is empty

### LEDs don't change after patching

- Check for "Echo OK" in the patch output — if missing, the code didn't
  reach the FPGA
- Check for "RUN sent" — without this, the core stays halted
- If led2 lights up, your code triggered a capability fault

### Bridge shows "Failed to fetch"

- Did you accept the certificate? (Step 17)
- Is the bridge script still running?
- Try restarting the bridge and accepting the certificate again

### Bridge shows "Serial port not open"

- The port may have changed after reflashing. Check `ls /dev/ttyUSB*`
- Restart the bridge with the correct port

---

## Quick Reference

### First-time setup

| Step | Where | What to do |
|------|-------|------------|
| 1 | Local | Install OSS CAD Suite + pyserial |
| 2 | IDE/Replit | Download `church_tang_nano_20k_iot.fs` and `patch_fpga.py` |
| 3 | Local | Plug in Tang Nano 20K, check `ls /dev/ttyUSB*` |
| 4 | Local | `openFPGALoader -b tangnano20k church_tang_nano_20k_iot.fs` |
| 5 | Local | Check LEDs: 1 solid + 2 blinking = OK |

### Everyday code patching

| Step | Where | What to do |
|------|-------|------------|
| 6 | IDE | Select CR, click Edit, write code |
| 7 | IDE | Click Patch — compiles code and tests in simulator |
| 8 | IDE | Click Export Patch — packages compiled binary into `.patch` file |
| 9 | Local | `python3 patch_fpga.py /dev/ttyUSB1 CR14_patch.patch` |
| 10 | Local | Check LEDs + cross-check CRC values |

### Building from source (advanced, one-time)

| Step | Where | Command |
|------|-------|---------|
| 11 | Replit | `python3 -m hardware.gen_verilog --iot build` |
| 12 | Replit | `yosys -p "read_verilog build/church_tang_nano_20k_iot.v; synth_gowin -top top -json build/church_tang_nano_20k_iot.json"` |
| 13 | Local | Download `.json` and `.cst` from Replit |
| 14 | Local | `nextpnr-himbaechel --device GW2AR-LV18QN88C8/I7 --json build/church_tang_nano_20k_iot.json --write build/church_tang_nano_20k_iot_pnr.json -o family=GW2A-18C -o cst=hardware/tang_nano_20k.cst --freq 27` |
| 15 | Local | `gowin_pack` + `openFPGALoader` (see Part C) |

### Tang Nano 20K pin reference

| Signal | Pin | Direction | Notes |
|--------|-----|-----------|-------|
| clk | 4 | Input | 27 MHz crystal |
| uart_tx | 69 | Output | FT2232 Channel B RXD |
| uart_rx | 70 | Input | FT2232 Channel B TXD |
| led0 | 15 | Output | Boot/Run (active-low) |
| led1 | 16 | Output | Halt (active-low) |
| led2 | 19 | Output | Fault (active-low) |
| led3 | 20 | Output | Heartbeat (active-low) |
| push_button | 88 | Input | Active-low, directly accessible |
