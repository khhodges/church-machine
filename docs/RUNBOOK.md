# End-to-End Hardware Integration Runbook

**Purpose:** Step-by-step guide for validating the complete bridge → banner → IDE step-trace loop on a physical Wukong A7 board. Each leg has a known status so you start exactly where you left off.

**Status legend:** ✅ Verified on hardware · ⚠️ Believed working, not recently re-tested · ❌ Known gap — implementation present but untested end-to-end

---

## Quick reference

| Leg | Summary | Status |
|:----|:--------|:-------|
| [Leg 1](#leg-1--program-bitstream) | Program bitstream to board | ✅ |
| [Leg 2](#leg-2--wukong-banner-over-ttyusb0) | Wukong banner over ttyUSB0 | ✅ |
| [Leg 3](#leg-3--ide-bridge-running) | IDE bridge running | ✅ |
| [Leg 4](#leg-4--single-step-trace-in-ide) | Single-step trace in IDE | ✅ |
| [Leg 5](#leg-5--boot-entry-lump-push) | Boot entry lump push | ⚠️ |
| [Leg 6](#leg-6--abstraction-runs-after-boot) | Abstraction runs after boot | ❌ |

See [Known Traps](#known-traps) for common failure causes discovered during hardware sessions.

---

## Leg 1 — Program bitstream

**Status: ✅ Verified**

### Prerequisites

- Vivado installed (any version supporting XC7A100T; tested with Vivado 2022.x+)
- Wukong A7 board connected via USB; `/dev/ttyUSB0` visible on host
- `openFPGALoader` present (for CLI programming) **or** Vivado Hardware Manager available

### Command

```bash
# Option A — Vivado TCL (preferred from a terminal):
cd ~/church-machine
vivado -mode batch -source hardware/scripts/program_wukong.tcl

# Option B — openFPGALoader CLI:
openFPGALoader -b arty_a7_100t wukong_top.bit

# Option C — Vivado Hardware Manager (GUI):
# Open Hardware Manager → Auto-Connect → Program Device → select wukong_top.bit
```

### Expected output

```
...
[Vivado] Bitstream programmed successfully.
```

The board does **not** power-cycle after programming — the new design loads immediately into FPGA SRAM. Power-cycle manually (or hit the reset button) if you want a clean boot from flash.

### Failure modes

| Symptom | Diagnosis |
|:--------|:----------|
| `openFPGALoader: no device found` | Check USB cable and run `lsusb | grep -i xilinx`; try `sudo` |
| Programming completes but board is silent | Wrong bitstream built — verify XDC constraints applied (`hardware/wukong_a7.xdc`) |
| Vivado `NSTD-1` / `UCIO-1` DRC errors | Do not use `launch_runs -to_step write_bitstream`; use `open_run impl_1; write_bitstream wukong_top.bit` directly |

---

## Leg 2 — Wukong banner over ttyUSB0

**Status: ✅ Verified**

### Prerequisites

- Leg 1 complete (board programmed)
- `pyserial` installed: `pip install pyserial`

### Command

```bash
# Quick check with screen (Ctrl+A K to quit):
screen /dev/ttyUSB0 57600

# Or with python:
python3 -c "
import serial, time
s = serial.Serial('/dev/ttyUSB0', 57600, timeout=5)
print(s.readline())
"
```

Power-cycle the board (or press reset) after opening the port.

### Expected output

```
CM:WUKONG
```

The banner arrives within ~1 second of power-on and repeats every ~1 second in standalone mode (LED0 blinks at ~1 Hz). Once the IDE sends a boot entry, the loop stops and the CM executes the loaded abstraction.

### Failure modes

| Symptom | Diagnosis |
|:--------|:----------|
| No output at all on ttyUSB0 | Wrong bitstream or wrong port — verify `ls /dev/ttyUSB*`; check Vivado programming succeeded |
| Garbled output (random bytes) | Wrong baud rate — must be **57600** |
| `Permission denied: /dev/ttyUSB0` | Add user to `dialout` group: `sudo usermod -aG dialout $USER` then log out/in |
| Port opens but instantly closes | Another app holds the port; kill `wukong_bridge.py`, `screen`, or `minicom` first |

---

## Leg 3 — IDE bridge running

**Status: ✅ Verified**

### Prerequisites

- Leg 2 complete (board emitting `CM:WUKONG` on `/dev/ttyUSB0`)
- Bridge script at `~/wukong_bridge.py` (download from the IDE at `/dl/wukong-bridge`)
- Python 3 + `pyserial` + `requests` installed on the host machine

### Command

```bash
python3 ~/wukong_bridge.py \
  --port=/dev/ttyUSB0 \
  --baud=57600 \
  --ide=https://<your-replit-url>
```

For a local dev server (HTTP):

```bash
python3 ~/wukong_bridge.py \
  --port=/dev/ttyUSB0 \
  --baud=57600 \
  --ide=http://localhost:5000 \
  --insecure
```

### Expected output

```
Wukong Church Machine Bridge
  Serial : /dev/ttyUSB0 @ 57600 baud
  IDE    : https://...replit.dev

Press Ctrl+C to stop.

[bridge] Waiting for CM:WUKONG banner...
[bridge] Banner received — board is live.
[bridge] Forwarding trace packets to IDE.
```

The bridge is working if it **does not** return immediately. A prompt that returns instantly means a startup error — paste the full output for diagnosis.

### Failure modes

| Symptom | Diagnosis |
|:--------|:----------|
| `TLS handshake error` or `SSL error` | Add `--insecure` flag when using a local HTTP server |
| `Connection refused` to IDE | IDE server is not running; check Flask workflow status |
| `Serial port not found` | Wrong port — run `ls /dev/ttyUSB*` and confirm board is plugged in |
| Bridge returns immediately | Import error or missing dependency — run `pip install pyserial requests` |
| `[bridge] Waiting for CM:WUKONG banner...` never resolves | Board is not sending banner; go back to Leg 2 |

---

## Leg 4 — Single-step trace in IDE

**Status: ✅ Verified**

### Prerequisites

- Leg 3 complete (bridge running and connected to IDE)
- IDE open in browser with the Wukong board visible in the Devices tab

### Procedure

1. Open the IDE and navigate to the **Devices** tab — the board should appear with status **Live**.
2. Click **Step** (or press the step key) — the IDE sends a single-step command through the bridge.
3. The CM executes one instruction and the bridge receives a 12-byte trace packet.
4. The IDE updates the register display (NIA, instruction word, NZCV flags).

### Expected behaviour

```
Step 1 → NIA=0x0000  LOAD CR3, CR6[5]    flags=0000
Step 2 → NIA=0x0001  LOAD CR4, CR6[6]    flags=0000
Step 3 → NIA=0x0002  CALL CR0, CR0       flags=0000
```

Each step takes < 100 ms round-trip (bridge latency + UART byte time at 57,600 baud).

### Failure modes

| Symptom | Diagnosis |
|:--------|:----------|
| Devices tab shows board as **Offline** | Bridge not running or lost connection — restart `wukong_bridge.py` |
| Step button does nothing | Bridge connected but step command not forwarded — check bridge version |
| NIA does not advance | Step mode not enabled in hardware — rebuild bitstream with `step_mode = 0` for standalone, or verify bridge is sending the step pulse |
| `ELOADCALL` trace missing | Known gap — ELOADCALL events are not yet traced by the TraceUnit |

---

## Leg 5 — Boot entry lump push

**Status: ⚠️ Believed working, not recently tested end-to-end**

The server-side boot-entry API exists. The bridge is expected to receive the boot entry configuration from the IDE and load it into the CM DMEM boot slot. End-to-end validation on real hardware is pending.

### Prerequisites

- Leg 4 complete (step trace verified)
- A boot entry LUMP selected in the IDE (Builder → select LUMP → Deploy to board)

### Command

```bash
# Verify the pending boot-entry endpoint:
curl -s https://<your-ide-url>/api/device/<uid>/pending-lump | python3 -m json.tool
```

### Expected bridge output (when lump is pushed)

```
[bridge] Boot entry received — installing LUMP (token=c0ffee01, words=73)
[bridge] LUMP installed; sending FREE_RUN.
```

### Failure modes

| Symptom | Diagnosis |
|:--------|:----------|
| `"pending": false` always | No LUMP queued — use Builder → Deploy to push one to this device |
| Bridge shows lump received but CM does not advance | FREE_RUN signal not sent — check bridge firmware |

---

## Leg 6 — Abstraction runs after boot

**Status: ❌ Known gap — end-to-end reboot-and-run not yet validated on Wukong A7**

After a successful lump push (Leg 5), the bridge sends a FREE_RUN signal to release the CM. The CM executes the 3-instruction boot ROM, which calls into the loaded abstraction. This leg has not been validated on real hardware.

### Expected sequence

1. Bridge sends FREE_RUN signal
2. CM executes boot ROM words 0–2: `LOAD` → `LOAD` → `CALL`
3. CM enters the boot entry abstraction's first method
4. LED pattern changes to match the abstraction's MMIO writes

### Failure modes

| Symptom | Diagnosis |
|:--------|:----------|
| CM does not advance after FREE_RUN | `step_mode` still active — verify hardware build has `step_mode = 0` in non-step path |
| CM faults immediately on CALL | `Thread.caps[0]` not set — bridge did not write the boot slot |
| LEDs do not respond | DWRITE to wrong offset — Wukong LEDs are active-LOW; `0` = on |

---

## Known Traps

Discoveries made during real hardware sessions that are easy to miss:

| Trap | Detail |
|:-----|:-------|
| **LEDs are active-LOW** | The Wukong A7 LEDs (G21, G20) are active-LOW — write `0` to illuminate, `1` to extinguish. The Ti60 F225 was active-HIGH; this is the opposite polarity. |
| **Single port for everything** | `/dev/ttyUSB0` carries the `CM:WUKONG` banner, per-event trace packets, and bridge traffic. Do not open it with `screen` or `minicom` while `wukong_bridge.py` is running. |
| **57,600 baud — not 115,200** | The Wukong UART runs at 57,600 baud (`CLOCKDIV=53`, 50 MHz clock with appropriate divider). Opening at 115,200 produces garbled output. |
| **`--insecure` required for local IDE** | `wukong_bridge.py` uses HTTPS by default. Pass `--insecure` when pointing at an HTTP development server. |
| **`step_mode` init must be 0 in standalone builds** | The CM halts immediately after boot when `step_mode` initialises to `1`. Standalone FPGA builds need `step_mode = 0`. |
| **`write_bitstream` DRC trap** | Using `launch_runs -to_step write_bitstream` spawns a fresh Vivado session and drops XDC severity overrides (DRC NSTD-1/UCIO-1 errors). Use `open_run impl_1; write_bitstream` directly. |

---

## Related documents

- **`docs/HARDWARE.md`** — Authoritative board identity, USB port map, LED assignments, boot ROM description, Vivado build steps
- **`docs/wukong-boot.md`** — Wukong standalone boot program (`WUKONG_NUC_PROGRAM`): 73-instruction loop, register allocation, CLOOMC source
- **`docs/bridge-setup-chromeos.md`** — ChromeOS / Crostini-specific bridge setup
- **`server/app.py`** routes: `/api/device/call-home`, `/api/device/<uid>/pending-lump`
