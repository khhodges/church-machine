# End-to-End Hardware Integration Runbook

**Purpose:** Step-by-step guide for validating the complete bridge → boot sentinel → IDE step-trace loop on a physical Wukong A7 board. Each leg has a known status so you start exactly where you left off.

**Status legend:** ✅ Verified on hardware · ⚠️ Believed working, not recently re-tested · ❌ Known gap — implementation present but untested end-to-end

---

## Quick reference

| Leg | Summary | Status |
|:----|:--------|:-------|
| [Leg 1](#leg-1--build-and-program-bitstream) | Build and program bitstream to board | ✅ |
| [Leg 2](#leg-2--boot-sentinel-over-ttyusb0) | Boot sentinel over ttyUSB0 | ✅ |
| [Leg 3](#leg-3--ide-bridge-running) | IDE bridge running | ✅ |
| [Leg 4](#leg-4--single-step-trace-in-ide) | Single-step trace in IDE | ✅ |

See [Known Traps](#known-traps) for common failure causes discovered during hardware sessions.

---

## Leg 1 — Build and program bitstream

**Status: ✅ Verified**

### Prerequisites

- Vivado installed (WebPACK edition — free, covers Artix-7; tested with 2022.x+)
- Wukong A7 board connected via USB; `/dev/ttyUSB0` visible on host
- Vivado Hardware Manager **or** `xc3sprog` available for programming

### Build commands

```bash
# Step 1 — Generate RTL from Amaranth HDL:
#   Output goes to build/ by default; copy to hardware/ so the TCL can find it.
python3 -m hardware.gen_rtlil --wukong
cp build/church_wukong_xc7a100t.v hardware/

# Step 2 — Run Vivado batch build (from the repo root):
#   The TCL script expects church_wukong_xc7a100t.v and wukong_xc7a100t.xdc
#   both in hardware/ — it discovers them relative to the Tcl script location.
cd hardware
vivado -mode batch -source wukong_xc7a100t.tcl
# Output: church_wukong_xc7a100t.bit  (in hardware/ directory)
```

### Program the board

```bash
# Option A — Vivado Hardware Manager (GUI):
#   open_hw_manager → connect → Program Device → select church_wukong_xc7a100t.bit

# Option B — xc3sprog (Chromebook Linux with Platform Cable USB II):
cd hardware
xc3sprog -c xpc -p 0 church_wukong_xc7a100t.bit
```

### Expected output

```
...
[Vivado] Bitstream programmed successfully.
```

The board does **not** power-cycle after programming — the new design loads immediately into FPGA SRAM. Power-cycle manually if you want a clean boot from flash.

### Failure modes

| Symptom | Diagnosis |
|:--------|:----------|
| `church_wukong_xc7a100t.v not found` | Run gen_rtlil first and copy output to hardware/ |
| `wukong_xc7a100t.xdc not found` | Run vivado from the `hardware/` directory |
| Programming completes but board is silent | Wrong bitstream — verify XDC constraints applied (`hardware/wukong_xc7a100t.xdc`) |
| Vivado `NSTD-1` / `UCIO-1` DRC errors | Use the provided TCL script (uses `open_run` + `write_bitstream` directly) |

---

## Leg 2 — Boot sentinel over ttyUSB0

**Status: ✅ Verified**

After power-on (or board reset), the Wukong firmware emits a **boot sentinel** over UART before
the CM starts executing. Current bitstreams emit a 3-byte sentinel:

```
0xBC  N_INIT_byte  TU_VERSION
```

- `0xBC` — current sentinel magic (stale bitstreams emit `0xBB`)
- `N_INIT_byte` — low byte of the count of non-zero DMEM words written by the init sequencer
- `TU_VERSION` — TraceUnit FSM version (`0x02` = current; stale = CALL traces will be wrong)

### Prerequisites

- Leg 1 complete (board programmed)
- `pyserial` installed: `pip install pyserial`

### Command

```bash
python3 -c "
import serial, time
s = serial.Serial('/dev/ttyUSB0', 57600, timeout=5)
data = s.read(3)
print('Sentinel bytes:', ' '.join(f'0x{b:02X}' for b in data))
s.close()
"
```

Power-cycle the board (or press reset) after opening the port.

### Expected output

```
Sentinel bytes: 0xBC 0xXX 0x02
```

(where `0xXX` is the N_INIT byte — depends on DMEM content)

**Note on standalone behavior (factory bitstream):** In the factory image
`Thread.caps[0]` (`0x4A000006`) is at DMEM word 1140
(`threadBase=896 + THREAD_CAPS_OFFSET`). After the sentinel, the CM executes all
3 boot ROM instructions, reaches `CALL CR0` at word 2, and enters SelfTest at
NIA `0x604`. To choose another entry, replace the E-GT in the boot
image/build configuration and reflash — see `docs/StartupCM.md` Phase A.

### Failure modes

| Symptom | Diagnosis |
|:--------|:----------|
| No output at all on ttyUSB0 | Wrong bitstream or wrong port — verify `ls /dev/ttyUSB*`; check Vivado programming succeeded |
| Garbled output | Wrong baud rate — must be **57600** |
| `Permission denied: /dev/ttyUSB0` | Add user to `dialout` group: `sudo usermod -aG dialout $USER` then log out/in |
| Port opens but instantly closes | Another app holds the port; kill any `screen`, `minicom`, or existing bridge first |
| First byte is `0xBB` (not `0xBC`) | Stale bitstream — TraceUnit FSM predates 3-packet CALL; rebuild and reflash |

---

## Leg 3 — IDE bridge running

**Status: ✅ Verified**

### Prerequisites

- Leg 2 complete (board emitting boot sentinel on `/dev/ttyUSB0`)
- `hardware/wukong_bridge.py` from the repo
- Python 3 + `pyserial` + `requests` installed on the host machine

### Command

```bash
python3 hardware/wukong_bridge.py \
  --port=/dev/ttyUSB0 \
  --ide=https://<your-replit-url>
```

For a local dev server (HTTP):

```bash
python3 hardware/wukong_bridge.py \
  --port=/dev/ttyUSB0 \
  --ide=http://localhost:5000 \
  --insecure
```

### Expected output

```
Wukong bridge: /dev/ttyUSB0 @ 57600 baud → https://...replit.dev
Boot sentinel: expecting N_INIT=<N> (0xXX) from board
BOOT: board ready — N_INIT=<N> (0xXX) matches source  ✓  TU_VERSION=0x02
```

After the boot sentinel line, trace packets will appear as the CM executes (if the bridge is started before power-on). Power-cycle the board to see the sentinel if it was missed.

The bridge is working if it **does not** return immediately. A prompt that returns instantly means a startup error — paste the full output for diagnosis.

### Failure modes

| Symptom | Diagnosis |
|:--------|:----------|
| `TLS handshake error` or `SSL error` | Add `--insecure` flag when using a local HTTP server |
| `Connection refused` to IDE | IDE server is not running; check Flask workflow status |
| `Serial port not found` | Wrong port — run `ls /dev/ttyUSB*` and confirm board is plugged in |
| Bridge returns immediately | Import error or missing dependency — run `pip install pyserial requests` |
| `N_INIT mismatch` warning in bridge output | Bitstream was built with different DMEM content than current source; rebuild/reflash |
| Bridge sees `0xBB` sentinel | Stale bitstream — rebuild and reflash for correct 3-packet CALL traces |

---

## Leg 4 — Single-step trace in IDE

**Status: ✅ Verified**

### Prerequisites

- Leg 3 complete (bridge running and connected to IDE)
- IDE open in browser with the Wukong board visible in the Devices tab
- Board power-cycled after bridge started (so bridge captures the boot sentinel)

### Procedure

1. Open the IDE and navigate to the **Devices** tab — the board should appear as **Live**.
2. Click **Step** (or press the step key) — the IDE sends `"s"` through the bridge as byte `b's'`.
3. The CM executes one instruction and the bridge receives a 12-byte trace packet (0xAA magic).
4. The IDE updates the register display (NIA, event type, GT payload, NZCV flags).

### Expected behaviour (boot ROM, BOOT_PROGRAM)

```
Step 1 → NIA=0x00000000  LOAD   CR15, CR15[0]    (LOAD.shadow + LOAD.new packets)
Step 2 → NIA=0x00000004  CHANGE CR12, CR15, #1   (CHANGE.push + CHANGE.CR12 + CHANGE.CR5)
Step 3 → NIA=0x00000008  CALL   CR0              (enters factory SelfTest at NIA=0x604)
```

Each step takes < 100 ms round-trip (bridge latency + UART byte time at 57,600 baud).

### Failure modes

| Symptom | Diagnosis |
|:--------|:----------|
| Devices tab shows board as **Offline** | Bridge not running or lost connection — restart `wukong_bridge.py` |
| Step button does nothing | Bridge connected but step command not forwarded — check bridge version |
| NIA does not advance | step_mode not enabled in hardware — rebuild bitstream with correct step_mode setting |
| CALL shows wrong CR6/CR14 state after ELOADCALL | Stale TraceUnit (0xBB sentinel) — old firmware emits single RESULT instead of 3-packet CALL; rebuild |

---

## Known Traps

Discoveries made during real hardware sessions that are easy to miss:

| Trap | Detail |
|:-----|:-------|
| **LEDs are active-LOW** | The Wukong A7 LEDs (G21, G20) are active-LOW — write `0` to illuminate, `1` to extinguish. The previous platform used active-HIGH; this is the opposite polarity. |
| **Single port for everything** | `/dev/ttyUSB0` carries the boot sentinel, per-event trace packets, and CM text output. Do not open it with `screen` or `minicom` while `wukong_bridge.py` is running. |
| **57,600 baud — not 115,200** | The Wukong UART runs at 57,600 baud. Opening at 115,200 produces garbled output. |
| **`--insecure` required for local IDE** | `wukong_bridge.py` uses HTTPS by default. Pass `--insecure` when pointing at an HTTP development server. |
| **`step_mode` init must be 0 in standalone builds** | The CM halts immediately after boot when `step_mode` initialises to `1`. Standalone FPGA builds need `step_mode = 0`. |
| **`write_bitstream` DRC trap** | Using `launch_runs -to_step write_bitstream` spawns a fresh Vivado session and drops XDC severity overrides (DRC NSTD-1/UCIO-1 errors). The provided TCL script (`hardware/wukong_xc7a100t.tcl`) handles this correctly. |
| **gen_rtlil output must be copied to hardware/** | `python3 -m hardware.gen_rtlil --wukong` writes to `build/church_wukong_xc7a100t.v`; the TCL script expects it in `hardware/`. Run `cp build/church_wukong_xc7a100t.v hardware/` before running Vivado. |
| **Factory image enters SelfTest** | `Thread.caps[0]` (DMEM word 1140 in the relocated Thread lump) contains the SelfTest E-GT `0x4A000006`; ROM word 2 enters SelfTest at NIA `0x604`. |

---

## Related documents

- **`docs/HARDWARE.md`** — Authoritative board identity, USB port map, LED assignments, boot ROM description, Vivado build steps
- **`docs/StartupCM.md`** — Complete Wukong A7 startup sequence: synthesis → boot sentinel → bridge connection → trace
- **`docs/wukong-boot.md`** — WukongCallHome LUMP: 73-instruction LED/UART loop that can run as a standalone boot abstraction
- **`docs/bridge-setup-chromeos.md`** — ChromeOS / Crostini-specific bridge setup
- **`hardware/wukong_bridge.py`** — Bridge script (step/run/halt/breakpoint commands and trace decoding)
- **`hardware/wukong_xc7a100t.tcl`** — Vivado batch build script
