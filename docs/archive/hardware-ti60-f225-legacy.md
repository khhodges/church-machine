# Ti60 F225 — Church Machine Hardware Reference (ARCHIVED)

> **ARCHIVED / NON-AUTHORITATIVE — board no longer in active use.**
> The active development board is now the **QMTECH Wukong A7 (XC7A100T)**.
> This document is retained for historical reference only. All current
> hardware facts are in **[docs/HARDWARE.md](../HARDWARE.md)**.

---

*Original content from `docs/HARDWARE.md` as of the Ti60 F225 era.*

---

## Board Identity (Ti60 F225)

| Feature | Value |
|:--------|:------|
| **Device** | Efinix Titanium EFT90A |
| **Board** | Sipeed Ti60 F225 Development Kit |
| **Process** | 90 nm |
| **FPGA family** | Titanium (Efinity toolchain required; not compatible with yosys/nextpnr) |
| **Clock** | 50 MHz on-board crystal (pin B8) |
| **User LEDs** | **3** × active-HIGH (GPIOR_P_07, GPIOR_P_08, GPIOR_P_09) |
| **Button** | 1 × active-LOW USER_PB (external pull-up on board) |
| **USB bridge** | FTDI FT4232H (4-interface USB-UART/JTAG combo) |
| **BRAM** | ~220 KB (176 EFX_RAM10 blocks) |
| **Logic** | ~60 K logic elements |
| **Synthesis toolchain** | Efinity 2026.1 (headless CLI: `efx_map`, `efx_pnr`, `efx_pgm`) |

---

## USB Port Map (Ti60 F225)

The FT4232H enumerates four serial interfaces on the host. On Linux they appear as `/dev/ttyUSB0`–`/dev/ttyUSB3`.

| Device | FT4232H interface | Purpose | Baud |
|:-------|:-----------------|:--------|:-----|
| `/dev/ttyUSB0` | Interface 0 | FPGA JTAG (openFPGALoader) | — |
| `/dev/ttyUSB1` | Interface 1 | CPU debug JTAG (tied off in hardware) | — |
| `/dev/ttyUSB2` | Interface 2 | **Sapphire SoC UART** — CALLHOME + smoke-test target | 57,600 |
| `/dev/ttyUSB3` | Interface 3 | Church Machine debug UART — NIA trace + fault codes | 115,200 |

> **ChromeOS / Crostini note:** On ChromeOS, `/dev/ttyUSB3` is also used as the **Crostini serial console**. Do not connect the Church Machine IDE to `/dev/ttyUSB3` on a Chromebook — use `/dev/ttyUSB2` (Sapphire SoC UART) for all CALLHOME and bridge traffic.

---

## LED Pin Assignments (Ti60 F225)

The Ti60 F225 devkit has **exactly 3 user LEDs** (not 4). Each LED is active-HIGH.

| LED | GPIO pin | Pre-boot meaning | Post-boot |
|:----|:---------|:-----------------|:----------|
| LED0 | `GPIOR_P_07` | ON when Sapphire SoC is out of reset | CPU/MMIO |
| LED1 | `GPIOR_P_08` | ON within ~1 ms when CM boot ROM completes (sticky) | CPU/MMIO |
| LED2 | `GPIOR_P_09` | ON ~3 s after power-on when CM banner is sent; **also ON on fault** | CPU/MMIO |

### Pre-boot signal definitions (from `hardware/ti60_f225.py`)

```python
led_boot         = ~boot_complete               # LED0 ON while CM has never completed CALL
led_run          = boot_complete & ~fault & ~halted   # ON when running post-boot
led_halted_blink = halted & ~fault & heartbeat_blink  # 1 Hz blink when paused & healthy
led_fault        = fault_latched                # sticky — stays ON until power-cycle
```

### Step-by-step LED guide (Ti60 F225)

| Step | LED0 | LED1 | LED2 | What it means |
|:-----|:-----|:-----|:-----|:--------------|
| Power on | 🟡 solid | ⚫ off | ⚫ off | Sapphire RISC-V starting up |
| Sapphire running, CM halted & healthy | 🟡 solid | 💫 1 Hz blink | ⚫ off | CM core live, waiting for boot image over UART |
| CALLHOME sent (~0.5 s after power-on) | 🟡 solid | 💫 1 Hz blink | 🟡 solid | `banner_ever_sent` latched — stays ON from here |
| IDE sends PATCH_LUMP frames | 🟡 solid | 💫 1 Hz blink | 🟡 solid | CM still halted, DMEM being written |
| FREE_RUN (0xBE 0xAA) sent | 🟡 solid | ⚫ brief off | 🟡 solid | CM executing 3 boot ROM instructions |
| Boot complete (`boot_complete=1`) | CPU | CPU | CPU | MMIO writes from your abstraction drive LEDs |

**Fault indicator:** If the CM faults at any stage, LED1 goes dark (`led_halted_blink` gated by `~fault_latched`) and LED2 stays ON permanently from `fault_latched`.

---

## APB3 Register Map (Ti60 F225 / Sapphire SoC)

The Sapphire SoC accesses the CM bridge at `0xF8100000` (`IO_APB_SLAVE_0_INPUT`, `CM_APB_BASE` in `firmware/main.c`). Source: `hardware/soc_combined/apb3_cm_bridge.v`.

| Offset | Name | Access | Description |
|:-------|:-----|:-------|:------------|
| `0x00` | CTRL | R/W | `[0]` = cm_pb: 1 = released (default), 0 = pressed (active-low). Hold 0 for ≥ 1 s to enter free-run. |
| `0x04` | STATUS | RO | `[0]` boot_complete · `[1]` fault_valid · `[2]` fault_latched |
| `0x08` | NIA | RO | CM next-instruction address (live program counter) |
| `0x0C` | FAULT | RO | `[4:0]` fault code |
| `0x10` | UID_LO | R/W | Lower 32 bits of 64-bit device UID |
| `0x14` | UID_HI | R/W | Upper 32 bits of 64-bit device UID |
| `0x18` | FAULT_GT | RO | GT word0 of faulting capability (latched on fault) |
| `0x1C` | FAULT_INSTR | RO | Instruction word at fault NIA |
| `0x20` | FAULT_CR14 | RO | Active abstraction slot at fault |
| `0x24` | FAULT_STAGE | RO | Pipeline stage: 0=Fetch 1=Decode 2=Perm 3=Lambda 4=TPERM 5=Call 6=Return 7=DataRW |

### Firmware address reference (Ti60 F225)

| Symbol | Value | Used by |
|:-------|:------|:--------|
| `UART_BASE` / `UART_DATA` | `0xF8010000` | `firmware/main.c`; write = TX, read = RX |
| `UART_STATUS` | `0xF8010004` | bits[23:16] = TX avail |
| `UART_CLOCKDIV` | `0xF8010008` | 25 MHz / (8 × (div+1)) = baud rate |
| APB slave 0 (CM bridge) | `0xF8100000` | `CM_APB_BASE` in `firmware/main.c` |
| Boot ROM base | `0xF9000000` | CPU reset vector, `link.ld` |

**Baud rate:** firmware writes `CLOCKDIV = 53` → 25,000,000 / (8 × 54) = 57,870 ≈ 57,600 baud.

---

## Firmware Build Steps (Ti60 F225)

```
[ ] Step 1  Copy Sapphire SoC IP files into hardware/soc_combined/
[ ] Step 2  Generate Church Machine RTL: python hardware/gen_verilog.py --ti60
[ ] Step 3  Build firmware: make -C hardware/soc_combined/firmware
[ ] Step 4  *** MANDATORY: python3 scripts/patch_sapphire_init.py sapphire.v symbol{0..3}.bin
            Must re-run on EVERY firmware change before re-synthesising.
[ ] Step 5  Verify: grep optimize-zero-init-rom church_soc_cm.xml  →  must show value="0"
[ ] Step 5b Copy symbol files: bash hardware/soc_combined/scripts/prep_syn.sh
[ ] Step 6  Synthesise: bash hardware/soc_combined/run_efx_map.sh
            *** CHECK: all 4 BRAM lanes must show non-zero INIT_0 in outflow/church_soc_cm.map.v
[ ] Step 7  Place & Route: bash hardware/soc_combined/run_efx_pnr.sh
[ ] Step 8  Generate hex: bash hardware/soc_combined/run_efx_pgm.sh
[ ] Step 9  Flash: sudo openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc_cm.hex
```

---

## Callhome Bridge (Ti60 F225)

```bash
python3 ~/callhome_bridge.py \
  --port=/dev/ttyUSB2 \
  --baud=57600 \
  --ide=https://<your-replit-url>
```

Expected greeting: `CHURCH Ti60 SoC+CM v2.0`

---

## Wukong Ethernet Protocol

The QMTECH Wukong XC7A100T communicates with the IDE server over Ethernet
using UDP (no TCP, no TLS). This section defines the wire format for the two
frame types.

**Port:** 5900 (both directions).

**Byte order:** big-endian (network byte order).

### Frame A — Wukong Callhome Broadcast (board → IDE server)

```
Offset  Bytes  Field
------  -----  -----
0       4      Magic = 0xCE110001
4       4      Sender token = 0x00003300
8       4      CM version word (u32)
12      6      Board MAC address
18      2      Pad = 0x0000
20      4      Link-up uptime (u32, seconds)
24      2      Request count N (u16)
26      N×4    Requested lump tokens (each u32)
```

### Frame B — Lump-Serve Response (IDE server → board)

```
Offset  Bytes  Field
------  -----  -----
0       4      Magic = 0xCE110002
4       4      Lump token (u32)
8       4      Word count W (u32)
12      W×4    LUMP data words
```

---

## Ti60 F225 Call-Home Protocol

The Ti60 F225 used a UART-based call-home protocol via the Sapphire SoC.
See `server/app.py` (`/api/device/register` and `/api/device/callhome`) for the
server-side handler.

---

## Known Traps (Ti60 F225)

| Trap | Detail |
|:-----|:-------|
| **ttyUSB3 = Crostini console on ChromeOS** | On a Chromebook, `/dev/ttyUSB3` is claimed by the Crostini serial console. Always use `/dev/ttyUSB2` for bridge traffic. |
| **INIT_0 all-zero = `patch_sapphire_init.py` was skipped** | Re-run Step 4 then re-synthesise. Symptom: UART silent or NIA=0x00000000 looping. |
| **`--insecure` required for local IDE** | Pass `--insecure` when pointing at an HTTP development server. |
| **`jtagCtrl_reset` must be tied to `1'b1`** | VexRiscv treats `jtagCtrl_reset = 0` as "JTAG TAP in reset" → `io_systemReset` stuck HIGH → UART silent. |
| **Ti60 F225 has exactly 3 user LEDs** | GPIOR_P_07/08/09; offsets 3 and 4 are register-only with no physical pin. |
| **Sapphire UART CLOCKDIV resets to 0x00** | Firmware must write `CLOCKDIV = 53` before the first `uart_puts`. |

---

*Archived — Ti60 F225 board no longer in active use. Active board: QMTECH Wukong A7.*
