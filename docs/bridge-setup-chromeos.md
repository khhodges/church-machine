# Church Machine Bridge — ChromeOS Setup Guide

This guide connects your Ti60 F225 FPGA board to the Church Machine IDE when you are on a Chromebook (ChromeOS / Crostini Linux).

---

## What you need

- Chromebook with Linux (Crostini) enabled
- Ti60 F225 board plugged in via USB
- Python 3 already installed in Linux

---

## Step 0 — Flash the Ti60 (first time only)

If your Ti60 does not yet have the Church Machine firmware on it, flash it now using **openFPGALoader** from OSS CAD Suite. You do not need the proprietary Efinix Efinity Programmer on a Chromebook.

> **Already flashed?** Skip straight to [Step 1](#step-1--open-a-linux-terminal). The bridge steps are identical regardless of how the board was flashed.

### Install OSS CAD Suite (one time)

Download the latest OSS CAD Suite release for Linux (amd64) from
[github.com/YosysHQ/oss-cad-suite-build/releases](https://github.com/YosysHQ/oss-cad-suite-build/releases),
then extract and activate it:

```bash
# Extract (adjust filename to match the version you downloaded)
tar -xf oss-cad-suite-linux-x64-*.tgz -C ~

# Activate — add this line to ~/.bashrc to make it permanent
source ~/oss-cad-suite/environment
```

### Download the bitstream

Open the Church Machine IDE, go to **Builder → Ti60 F225**, click **⬇ Download Bitstream**, and save `church_ti60_f225.bit` to your Linux home folder.

### Check the JTAG port

```bash
ls /dev/ttyUSB*
```

You should see at least `/dev/ttyUSB0` (JTAG). If nothing appears, unplug and replug the USB cable.

### Flash

```bash
# Install (one time)
source ~/oss-cad-suite/environment

# Check JTAG port
ls /dev/ttyUSB*

# Flash
openFPGALoader -b titanium_ti60_f225 church_ti60_f225.bit
```

Wait for `Programming done` — this takes about 30 seconds. The board will reboot automatically with the Church Machine firmware.

### Troubleshooting (flash step)

| Problem | Fix |
|---|---|
| `openFPGALoader: command not found` | Run `source ~/oss-cad-suite/environment` first |
| `No device detected` | Check USB cable is data-capable; try `openFPGALoader --detect`; reseat the cable |
| `Permission denied: '/dev/ttyUSB0'` | Run `sudo usermod -aG dialout $USER` then log out and back in (or `sudo chmod 666 /dev/ttyUSB*` for a quick fix) |
| `Wrong device / ID mismatch` | Re-download the bitstream; do not use a `.bit` file built for Tang Nano or Wukong |
| Device appears then disappears | 12 V power not connected — the Ti60 needs both USB and the external power brick |

---

## Step 1 — Open a Linux terminal

Open the **Terminal** app (the penguin icon, or search "Terminal").

---

## Step 2 — Install pyserial (first time only)

```bash
pip3 install pyserial
```

---

## Step 3 — Enable port forwarding (first time only)

The bridge runs on port **8766**. ChromeOS must forward it into Linux.

1. Open **ChromeOS Settings**
2. Go to **Advanced → Developers → Linux → Port forwarding**
3. Click **Add** and enter port `8766`, protocol `TCP`
4. Click **Done**

---

## Step 4 — Check your USB port

```bash
ls /dev/ttyUSB*
```

You should see `/dev/ttyUSB0`, `/dev/ttyUSB1`, or `/dev/ttyUSB2`.  
Use whichever one appears. The Ti60 is usually `/dev/ttyUSB2` on a Chromebook.

---

## Step 5 — Download the bridge script

```bash
curl -sL "https://31592a69-0a64-402e-9237-89b7ce66a127-00-1hr1bt2ealopt.kirk.replit.dev/local_bridge.py" -o local_bridge.py
```

This saves `local_bridge.py` to your home folder.

---

## Step 6 — Start the bridge

Replace `/dev/ttyUSB2` with your port from Step 4 if different.

```bash
python3 local_bridge.py /dev/ttyUSB2 115200 8766 --http --ide=https://31592a69-0a64-402e-9237-89b7ce66a127-00-1hr1bt2ealopt.kirk.replit.dev
```

**Leave this terminal open.** The bridge must keep running while you use the IDE.

### What you should see

```
Church Machine FPGA Bridge (HTTP)
  Serial : /dev/ttyUSB2 @ 115200 baud
  HTTP   : http://0.0.0.0:8766
  ChromeOS bridge URL: http://localhost:8766
  IDE Server: https://...replit.dev

Press Ctrl+C to stop.

💡 NIA stream: bridge will forward all UART output to the IDE stream panel.

  [bridge] Pre-fetched device UID from IDE: c0ffee0100000001
  [bridge] Drain thread started — forwarding UART to IDE server.
```

The bridge is working if the prompt **does not** return. If it returns immediately, paste the output here.

---

## Step 7 — Connect in the IDE

1. Open the Church Machine IDE in Chrome
2. Go to the **Connect** tab
3. Click **🌉 Via Bridge**
4. The board should connect automatically

---

## Step 8 — See live output (NIA stream)

The 📡 **Live UART Stream** panel appears below the connect log when connected.

To see boot output (NIA addresses, greeting message):

1. Keep the bridge running (Step 6)
2. **Unplug and replug** the board's USB cable
3. The stream panel fills with the boot sequence

> The board only sends output during boot. If you plug in the board before starting the bridge, that output is already gone. Always start the bridge **before** power-cycling the board.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `No such file or directory: '/dev/ttyUSB2'` | Run `ls /dev/ttyUSB*` and use the port that appears |
| `Permission denied: '/dev/ttyUSB2'` | Run `sudo usermod -aG dialout $USER` then log out and back in |
| Bridge exits immediately | Paste the full output here |
| Stream panel shows nothing | Power-cycle the board (unplug/replug USB) after the bridge is running |
| IDE shows "Bridge not reachable" | Check port forwarding is set to 8766 TCP (Step 3) |

---

## Stopping the bridge

Press **Ctrl+C** in the Linux terminal.
