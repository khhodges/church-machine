# HARDWARE.md — Church Machine Hardware Reference

Single source of truth for every hardware-setup fact about the QMTECH Wukong A7 devkit. When one value changes, update it here — all other docs point here.

For the end-to-end hardware validation runbook (bridge → banner → IDE step trace), see **[docs/RUNBOOK.md](RUNBOOK.md)** or `/docs/runbook` in the IDE.

---

## 1. Board Identity

| Feature | Value |
|:--------|:------|
| **Device** | Xilinx Artix-7 XC7A100T |
| **Board** | QMTECH Wukong A7 |
| **Process** | 28 nm |
| **FPGA family** | Artix-7 (Vivado toolchain) |
| **Clock** | 50 MHz on-board crystal (pin M21, SRCC bank 34) |
| **User LEDs** | **2** × active-LOW (G21, G20) |
| **BRAM** | 4.86 Mb (135 × 36 Kb blocks) |
| **Logic** | ~100 K logic cells |
| **Synthesis toolchain** | Vivado (Xilinx; not compatible with Efinity or yosys/nextpnr for production builds) |

---

## 2. USB Port Map

The Wukong A7 exposes a single USB-UART bridge on the host.

| Device | Purpose | Baud |
|:-------|:--------|:-----|
| `/dev/ttyUSB0` | **Wukong UART** — CM banner, single-step trace packets, CALLHOME | 57,600 |

> **Note:** Unlike the Ti60 devkit (which used an FT4232H with four USB-serial interfaces), the Wukong A7 presents a single serial port. All CM communication — banner detection, trace packets, and the IDE bridge — happens on `/dev/ttyUSB0`.

---

## 3. LED Pin Assignments

The Wukong A7 has **2 user LEDs**, both active-LOW.

| LED | FPGA pin | Active-LOW meaning | Post-boot |
|:----|:---------|:-------------------|:----------|
| LED0 | `G21` | OFF = on; driven LOW to illuminate | CM/MMIO |
| LED1 | `G20` | OFF = on; driven LOW to illuminate | CM/MMIO |

> **Active-LOW:** Write `0` to the LED register to turn the LED on; write `1` (or leave undriven) to turn it off. This is the inverse of the Ti60 F225, which used active-HIGH LEDs.

### Step-by-step LED guide (boot phase)

| Phase | LED0 | LED1 | What it means |
|:------|:-----|:-----|:--------------|
| Power on | ⚫ off | ⚫ off | FPGA configuring from flash |
| CM running — standalone mode | 💫 ~1 Hz blink | ⚫ off | Boot ROM loop; `CM:WUKONG` banner being sent |
| IDE connected and boot entry set | 🟡 solid | 🟡 solid | CM loaded and executing abstraction |
| Fault | LED pattern depends on abstraction | | `fault_latched` set — read trace output for fault code |

---

## 4. Boot ROM

The Wukong A7 uses a **3-instruction boot ROM** that runs on every power-on when an IDE has previously configured the boot entry slot:

```
Word 0  LOAD CR3, CR6[5]   ; load LED capability from boot c-list slot 5
Word 1  LOAD CR4, CR6[6]   ; load UART capability from boot c-list slot 6
Word 2  CALL CR0, CR0      ; call boot entry abstraction via Thread.caps[0]
```

When no boot entry has been configured (standalone power-on), the CM executes `WUKONG_NUC_PROGRAM` — a 73-instruction loop that blinks LED0 and transmits `CM:WUKONG\r\n` over UART every ~1 second. See **[docs/wukong-boot.md](wukong-boot.md)** for the full standalone boot program.

---

## 5. Callhome Bridge

### Basic invocation

```bash
python3 ~/wukong_bridge.py \
  --port=/dev/ttyUSB0 \
  --baud=57600 \
  --ide=https://<your-replit-url>
```

### What you should see

```
Wukong Church Machine Bridge
  Serial : /dev/ttyUSB0 @ 57600 baud
  IDE    : https://...replit.dev

Press Ctrl+C to stop.

[bridge] Waiting for CM:WUKONG banner...
[bridge] Banner received — board is live.
[bridge] Forwarding trace packets to IDE.
```

The bridge is working if the prompt **does not** return immediately and you see the banner line within ~2 s of power-on.

> **`--insecure` flag:** When pointing at a local HTTP development server, pass `--insecure` to suppress TLS certificate errors:
> ```bash
> python3 ~/wukong_bridge.py --port=/dev/ttyUSB0 --baud=57600 \
>   --ide=http://localhost:5000 --insecure
> ```

For ChromeOS-specific setup (Crostini port forwarding), see `docs/bridge-setup-chromeos.md`.

---

## 6. Single-Step Trace Packets

The Wukong trace unit emits **12-byte per-event packets** over `/dev/ttyUSB0` after the CM banner. Each packet is framed with `0xAA` and contains:

| Offset | Bytes | Field |
|:-------|:------|:------|
| 0 | 1 | Frame marker `0xAA` |
| 1 | 1 | Event type |
| 2 | 4 | NIA (next instruction address) |
| 3 | 4 | Instruction word |
| 4 | 2 | NZCV flags (4-bit condition flags from `retire_flags`) |

The IDE's **Step** button sends a single-step command to the bridge, which asserts the hardware step signal, waits for the next packet, and updates the register display.

**Known gaps in trace coverage:**
- `ELOADCALL` events are not yet traced
- `RETURN-CR14` does not emit a packet in the current TraceUnit implementation

---

## 7. Known Traps

| Trap | Detail |
|:-----|:-------|
| **LEDs are active-LOW** | Writing `1` to an LED register turns it OFF. Write `0` to illuminate. This is opposite to the Ti60 F225 (active-HIGH). |
| **Single `/dev/ttyUSB0` for everything** | Banner, trace packets, and IDE bridge traffic all share one serial port. Do not open it with `screen` or `minicom` while `wukong_bridge.py` is running. |
| **`--insecure` required for local IDE** | `wukong_bridge.py` uses HTTPS by default. Pass `--insecure` when pointing at an HTTP local server. |
| **`step_mode` must be `0` in standalone builds** | The CM halts immediately after boot when `step_mode` initialises to `1`. Standalone (no-IDE) FPGA builds must use `step_mode = 0`. |
| **Vivado `write_bitstream` DRC NSTD-1/UCIO-1** | Do not use `launch_runs -to_step write_bitstream` (it spawns a fresh session and drops XDC severity overrides). Use `open_run` then `write_bitstream` directly. |
| **`BUFG` must not be instantiated explicitly** | Vivado's `opt_design` silently drops an explicit `Instance("BUFG")` in Amaranth-generated HDL. Use a direct combinational assign so Vivado auto-infers `IBUF→BUFG`. |

---

## 8. Vivado Build Steps

Short-form checklist for building a new bitstream. See `hardware/wukong_top.py` for the HDL entry point.

```
[ ] Step 1  Generate Church Machine RTL: python hardware/gen_rtlil.py --wukong
[ ] Step 2  Open Vivado and set top-level to wukong_top
[ ] Step 3  Apply pin constraints from hardware/wukong_a7.xdc
[ ] Step 4  Run Synthesis (synth_design)
[ ] Step 5  Run Implementation (opt_design → place_design → route_design)
[ ] Step 6  Generate bitstream: open_run impl_1; write_bitstream wukong_top.bit
[ ] Step 7  Program board:
            openFPGALoader -b arty_a7_100t wukong_top.bit
            # or via Vivado Hardware Manager
```

**Two steps that cannot be skipped:**
1. **XDC pin constraints (Step 3)** — without them, LEDs and UART are routed to random pins and the board is silent.
2. **`open_run` before `write_bitstream` (Steps 6–7)** — using `launch_runs -to_step write_bitstream` drops DRC overrides; always use `open_run` + `write_bitstream` directly.

---

*For archived Ti60 F225 content, see [`docs/archive/hardware-ti60-f225-legacy.md`](archive/hardware-ti60-f225-legacy.md).*
