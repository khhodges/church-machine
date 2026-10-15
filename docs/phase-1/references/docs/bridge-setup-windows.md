# Church Machine Bridge — Windows 11 Setup

The Wukong bridge runs natively on Windows 11. It is a Python program that
connects to the board's USB-UART adapter and forwards trace packets and IDE
commands over HTTPS. Windows exposes the adapter as a `COM` port instead of a
Linux `/dev/ttyUSB*` device.

## 1. Install Python and the bridge dependencies

Install Python 3.10 or newer from <https://www.python.org/downloads/windows/>.
During installation, enable **Add python.exe to PATH**.

Open PowerShell and install the two runtime packages:

```powershell
py -m pip install --upgrade pyserial requests
```

Download the current bridge file from the IDE:

```text
https://lab.cloomc.org/dl/wukong-bridge
```

Save it as `wukong_bridge.py`. The bridge is a standalone file; the rest of
the Church Machine repository is not required to observe and control the
board.

## 2. Find the Wukong COM port

Connect the board by USB, then open **Device Manager → Ports (COM & LPT)**.
Look for the USB-UART adapter and note its port, for example `COM3`.

If the adapter does not appear:

- disconnect and reconnect the USB cable;
- install the driver named by Device Manager, if Windows reports one missing;
- make sure another serial terminal is not holding the port open.

The bridge also supports automatic enumeration, so `--port=auto` is normally
enough when only one serial adapter is connected.

## 3. Start the bridge

From the directory containing `wukong_bridge.py`:

```powershell
py .\wukong_bridge.py --port=COM3 --ide=https://lab.cloomc.org
```

Replace `COM3` with the port shown by Device Manager. To let the bridge
choose the first visible serial adapter:

```powershell
py .\wukong_bridge.py --port=auto --ide=https://lab.cloomc.org
```

For a local HTTP development server, add `--insecure`:

```powershell
py .\wukong_bridge.py --port=COM3 --ide=http://localhost:5000 --insecure
```

The expected startup output is similar to:

```text
Wukong bridge: COM3 @ 57600 baud → https://lab.cloomc.org
Boot sentinel: expecting N_INIT=... from board
```

Open the FPGA page at
<https://lab.cloomc.org/fpga>. The Bridge indicator should become connected
and the live trace should begin updating.

## Troubleshooting

- **`Could not open port 'COM3'`:** use the actual COM number from Device
  Manager and close PuTTY, Tera Term, Arduino Serial Monitor, or any other
  program using that port.
- **No boot sentinel:** the sentinel is emitted during board startup. Restart
  the bridge and power-cycle the board, or use the FPGA page's Reboot command
  after the bridge is connected.
- **Bridge connects but the page stays disconnected:** verify the IDE URL,
  Windows network access, and that the URL is reachable from PowerShell.
- **`py` is not recognized:** reinstall Python with PATH enabled, or use
  `python` instead of `py` in the commands above.
