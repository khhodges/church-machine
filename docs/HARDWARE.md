# HARDWARE.md — Church Machine Hardware Reference

Maintained setup reference for the current QMTECH Wukong A7 development target.
It describes repository source and tested workflows; it is not evidence that
every generated bitstream has been physically validated. Release provenance and
physical-board results must name the exact build or test record.

## Target Status

| Target | Repository status |
|:--|:--|
| **QMTECH Wukong A7 / XC7A100T** | Current development and release target |
| **Tang Nano 20K** | Legacy/experimental IoT profile; not the current release path |
| **Ti60 F225** | Retired historical target; documents are under `docs/archive/` |
| **pico-ice and other legacy boards** | Unsupported historical experiments |

The Wukong UART bridge shipped here is plaintext. It defaults to
`http://localhost:5000`. Its current URL handling accepts HTTP without a flag and
disables certificate verification for HTTPS; `--insecure` also forces
certificate verification off. The flag does not encrypt or authenticate the
board's serial traffic. See [`cm-msg-protocol.md`](cm-msg-protocol.md) for the
explicit FW=2 versus planned FW=3 boundary.

For the end-to-end startup sequence and bridge connection procedure, see **[docs/StartupCM.md](StartupCM.md)**.

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
| **Synthesis toolchain** | Vivado (Xilinx; maintained Wukong build path) |

---

## 2. USB Port Map

The Wukong A7 exposes a single USB-UART bridge on the host.

| Device | Purpose | Baud |
|:-------|:--------|:-----|
| `/dev/ttyUSB0` | **Wukong UART** — boot sentinel, trace packets, CM text output | 57,600 |

> **Note:** The Wukong A7 presents a single serial port. All CM communication — boot sentinel detection, trace packets, and IDE bridge traffic — happens on `/dev/ttyUSB0`.

---

## 3. LED Pin Assignments

The Wukong A7 has **2 user LEDs**, both active-LOW.

| LED | FPGA pin | Active-LOW meaning | Post-boot |
|:----|:---------|:-------------------|:----------|
| LED0 | `G21` | OFF = on; driven LOW to illuminate | CM/MMIO controlled |
| LED1 | `G20` | OFF = on; driven LOW to illuminate | CM/MMIO controlled |

> **Active-LOW:** Write `0` to the LED register to turn the LED on; write `1` (or leave undriven) to turn it off.

### LED states (boot phase)

| Phase | LED0 | LED1 | What it means |
|:------|:-----|:-----|:--------------|
| FPGA loading | ⚫ off | ⚫ off | Bitstream loading from flash |
| Init sequencer running | 🟢 solid ON | 💫 1 Hz blink | DMEM being written (~50 cycles); clock alive |
| Boot ROM executing (3 instructions) | 🟢 solid ON | 💫 1 Hz blink | LOAD→CHANGE→CALL executing |
| Abstraction running | CM-controlled (MMIO) | Fault LED if fault | Boot entry abstraction active |
| Standalone fault (NULL boot entry) | halted | halted | `NULL_CAP` on `CALL CR0`; power-cycle and configure |

---

## 4. Boot ROM

The Wukong A7 uses a **3-instruction boot ROM** (`_WUKONG_ROM` in `hardware/wukong_top.py`):

```
Word 0  LOAD   CR15, CR15[0]    ; load NS root capability from DMEM NS slot 0
Word 1  CHANGE CR12, CR15, #1   ; RESTORE_CALL: switch to Boot.Thread (NS slot 1)
Word 2  CALL   CR0              ; enter boot entry via Thread.caps[0]
```

Source: `hardware/boot_rom.py` → `BOOT_PROGRAM`

**Standalone power-on behavior (factory image):**
`Thread.caps[0]` is at DMEM word 1140 (`threadBase=896 + THREAD_CAPS_OFFSET=244`)
and contains the SelfTest E-GT `0x4A000006`. `CALL CR0` at ROM[2] enters the
factory SelfTest at NIA `0x604`. To configure another static boot entry, replace
that E-GT in the boot image/build configuration, rebuild, and reflash.

**WukongCallHome fallback:** The `WUKONG_NUC_PROGRAM` 73-instruction loop (LED blink + UART text) lives in DMEM as the WukongCallHome LUMP (NS slot 7), not in the boot ROM. See `hardware/boot_rom.py` and `docs/wukong-boot.md` for details.

---

## 5. Bridge

The bridge (`hardware/wukong_bridge.py`) connects over USB-Serial and provides
trace observation, step/run/halt control, and framed boot-image upload supported
by the current Wukong RTL. The factory DMEM image is baked into the bitstream;
an uploaded board-native image can replace runtime DMEM contents through the
documented `u` command path.

**Security status:** this shipped Wukong transport is plaintext and unauthenticated
on the UART wire (FW=2 class behavior). Keep the serial connection physically
trusted. FW=3 authenticated encryption is a proposal, not a feature of this
bridge.

### Basic invocation

```bash
python3 hardware/wukong_bridge.py \
  --port=/dev/ttyUSB0 \
  --ide=https://<your-replit-url>
```

### What you should see

```
Wukong bridge: /dev/ttyUSB0 @ 57600 baud → https://...replit.dev
Boot sentinel: expecting N_INIT=<N> (0xXX) from board
BOOT: board ready — N_INIT=<N> (0xXX) matches source  ✓  TU_VERSION=0x02
```

If the board sent the boot sentinel before the bridge started, power-cycle the board.

> **Transport warning:** HTTP works without `--insecure`. The current bridge also
> disables HTTPS certificate verification automatically. The flag explicitly
> forces certificate verification off but does not make UART or HTTP secure:
> ```bash
> python3 hardware/wukong_bridge.py --port=/dev/ttyUSB0 \
>   --ide=http://localhost:5000
> ```

For ChromeOS-specific setup (Crostini port forwarding), see `docs/bridge-setup-chromeos.md`.
For Windows 11 setup, see `docs/bridge-setup-windows.md`.

---

## 6. Single-Step Trace Packets

The Wukong trace unit emits **12-byte per-event packets** over `/dev/ttyUSB0`. Each packet is framed with `0xAA` and contains:

| Offset | Bytes | Field |
|:-------|:------|:------|
| 0 | 1 | Frame marker `0xAA` |
| 1–4 | 4 | NIA — retiring instruction address (uint32 big-endian) |
| 5 | 1 | Event type (`TRACE_EV_*` constant) |
| 6–9 | 4 | GT word0 payload (uint32 big-endian); 0 for push/pop events |
| 10 | 1 | Flags: bits[3:0] = NZCV; bits[7:4] = 0 |
| 11 | 1 | Fault: bits[4:0]=fault_code; bit[6]=fault_valid; bit[7]=bp_hit |

Multi-event instructions emit multiple consecutive packets with the same NIA:
- `LOAD` → 2 packets (LOAD.shadow, LOAD.new)
- `CHANGE` → 3 packets (CHANGE.push, CHANGE.CR12, CHANGE.CR5)
- `CALL` → 3 packets (CALL.CR6, CALL.CR14, CALL.push) — requires `TU_VERSION ≥ 0x02`
- `RETURN` → 3 packets (RETURN.pop, RETURN.CR6, RETURN.CR14)
- others → 1 packet (RESULT)

The **boot sentinel** is a separate sequence emitted once at power-on, before trace packets begin:
- `0xBC N_INIT TU_VERSION BUILD_VERSION` — current bitstream
- `0xBB N_INIT` — stale bitstream (old TraceUnit; `ELOADCALL`/`XLOADLAMBDA` emit wrong packet count)

---

## 7. Known Traps

| Trap | Detail |
|:-----|:-------|
| **LEDs are active-LOW** | Writing `1` to an LED register turns it OFF. Write `0` to illuminate. |
| **Single `/dev/ttyUSB0` for everything** | Boot sentinel, trace packets, and CM text output all share one serial port. Do not open it with `screen` or `minicom` while `wukong_bridge.py` is running. |
| **Bridge transport is not certificate-verified** | The default IDE URL is HTTP localhost. HTTPS URLs are currently requested with certificate verification disabled; `--insecure` also disables verification. UART remains plaintext either way. |
| **`step_mode` must be `0` in standalone builds** | The CM halts immediately after boot when `step_mode` initialises to `1`. Standalone (no-IDE) FPGA builds must use `step_mode = 0`. |
| **Vivado `write_bitstream` DRC NSTD-1/UCIO-1** | Do not use `launch_runs -to_step write_bitstream` (it spawns a fresh session and drops XDC severity overrides). The provided TCL script uses `open_run` + `write_bitstream` correctly. |
| **`BUFG` must not be instantiated explicitly** | Vivado's `opt_design` silently drops an explicit `Instance("BUFG")` in Amaranth-generated HDL. Use a direct combinational assign so Vivado auto-infers `IBUF→BUFG`. |
| **Stale bitstream (0xBB sentinel)** | Old TraceUnit FSM: `ELOADCALL` and `XLOADLAMBDA` emit a single RESULT packet instead of the 3-packet CALL sequence. CR6/CR14 state in the IDE will be wrong after any such instruction. Rebuild and reflash. |

---

## 8. Vivado Build Steps

For the complete Windows/AMD Vivado Hardware Manager programming workflow,
including the distinction between temporary `.bit` programming and persistent
N25Q064 `.mcs` flash programming, see the
[Vivado Artix-7 Flash Guide](wukong-vivado-flash-guide.md). Use that guide as
the source of truth for the GUI sequence and configuration-memory part.

Short-form checklist for building a new bitstream. See `hardware/wukong_top.py` for the HDL entry point.

**Option A — Download build ZIP from the IDE (recommended for end users):**
```bash
# 1. From the IDE: Builder → Connect → Download Wukong Build ZIP  (/dl/wukong-zip)
#    The ZIP contains church_wukong_xc7a100t.v, wukong_xc7a100t.xdc, wukong_xc7a100t.tcl
#    all pre-assembled in the same directory.
unzip church_wukong_build.zip && cd church_wukong_build
vivado -mode batch -source wukong_xc7a100t.tcl
# Output: church_wukong_xc7a100t.bit
```

**Option B — Build from source (for developers with full repo access):**
```
[ ] Step 1  Generate Church Machine RTL:
            python3 -m hardware.gen_rtlil --wukong
            # Output: build/church_wukong_xc7a100t.v

[ ] Step 2  Copy Verilog to hardware/ (the TCL script expects it in its own directory):
            cp build/church_wukong_xc7a100t.v hardware/

[ ] Step 3  Run Vivado batch build from the hardware/ directory:
            cd hardware
            vivado -mode batch -source wukong_xc7a100t.tcl
            # Constraints: wukong_xc7a100t.xdc (in same directory — applied automatically)
            # Output: church_wukong_xc7a100t.bit  (in hardware/)

[ ] Step 4  Program board (choose one):
             # Option A — Vivado Hardware Manager (GUI):
             #   See wukong-vivado-flash-guide.md for temporary .bit or persistent
             #   N25Q064 .mcs programming.
            # Option B — xc3sprog (Chromebook Linux with Platform Cable USB II):
            #   xc3sprog -c xpc -p 0 church_wukong_xc7a100t.bit
```

**Critical notes:**
1. **Run vivado from the directory containing both `.v` and `.xdc`** — the TCL script resolves inputs relative to the working directory, not to the script's location.
2. **Use the TCL script for bitstream generation** — `launch_runs -to_step write_bitstream` spawns a fresh Vivado session that drops XDC DRC severity overrides. The TCL script uses `open_run` + `write_bitstream` correctly.

---

*Archived platform documents are historical snapshots and are not current build
instructions, even where their preserved body uses words such as “authoritative”
or “validated.” See [`docs/archive/`](archive/).*
