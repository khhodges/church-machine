# Tang Nano 20K — Church Machine Hardware Reference

## Board specifications

| Feature | Value |
|:--------|:------|
| **Device** | Gowin GW2AR-LV18QN88C8/I7 (GW2A-18C family) |
| **Board** | Sipeed Tang Nano 20K |
| **Logic** | ~20,736 LUTs |
| **BSRAM** | 41,472 bits block SRAM (GowinBSRAM) |
| **Clock** | 27 MHz crystal oscillator (pin 4) |
| **LEDs** | 5 usable pins, active-LOW (led3 pin absent — PSRAM CE) |
| **Button** | 1 × KEY0 / S1, active-LOW (external pull-up) |
| **UART bridge** | BL616 USB bridge (115200 baud, USB-C connector) |
| **Flash** | 32 Mbit SPI flash (bitstream storage) |
| **Synthesis toolchain** | oss-cad-suite (yosys + nextpnr-himbaechel + gowin_pack) |

**Note on LEDs:** The GW2AR-LV18QN88C8/I7 uses pin 14 as an internal PSRAM chip-enable;
it is absent from the nextpnr-himbaechel GPIO pinmap. The LED device therefore maps
5 channels to physical pins `led0`, `led1`, `led2`, `led4`, `led5` — skipping led3.

---

## Toolchain installation

### 1. oss-cad-suite (recommended — includes all required tools)

Download the latest release for your platform from:
<https://github.com/YosysHQ/oss-cad-suite-build/releases>

Extract and activate:
```bash
tar xf oss-cad-suite-<date>-<platform>.tgz
source oss-cad-suite/environment
```

Add the activation line to your shell profile for permanent use.

This bundle provides:
- `yosys` — RTL synthesis
- `nextpnr-himbaechel` — Place and route for Gowin devices
- `gowin_pack` — Gowin bitstream packer (from the apicula project)
- `openFPGALoader` — USB flashing

### 2. Build from source (alternative)

```bash
# yosys
sudo apt install yosys

# nextpnr-himbaechel + gowin_pack
# Follow: https://github.com/YosysHQ/nextpnr
# Follow: https://github.com/YosysHQ/apicula
```

### 3. Serial console tools

```bash
# Ubuntu / Debian
sudo apt install picocom minicom

# Arch Linux
sudo pacman -S picocom
```

Add your user to the `dialout` group:
```bash
sudo usermod -aG dialout $USER
# log out and back in for this to take effect
```

---

## RTL generation

Generate the Amaranth HDL design as RTLIL from the project root:

```bash
cd /path/to/church-machine

python3 -c "
from hardware.tang_nano_20k import ChurchTangNano20K
from amaranth.back import rtlil
m = ChurchTangNano20K(sim_mode=False)
ports = [m.uart_tx, m.uart_rx, m.push_button] + m.led
with open('build/church_tang_nano_20k.rtlil', 'w') as f:
    f.write(rtlil.convert(m, ports=ports))
print('RTL generated: build/church_tang_nano_20k.rtlil')
"
```

Or using the project helper:
```bash
python3 -m hardware.gen_rtlil > build/church_tang_nano_20k.rtlil
```

Quick module-load check:
```bash
python3 -c "from hardware.tang_nano_20k import ChurchTangNano20K; print('OK')"
```

---

## Build and flash

### Complete one-liner

```bash
python3 -m hardware.gen_rtlil > build/church_tang_nano_20k.rtlil && \
  yosys -p "read_rtlil build/church_tang_nano_20k.rtlil; synth_gowin -json build/church_tang_nano_20k.json" && \
  nextpnr-himbaechel \
    --device GW2AR-LV18QN88C8/I7 \
    --json build/church_tang_nano_20k.json \
    --write build/church_tang_nano_20k_pnr.json \
    -o family=GW2A-18C \
    -o cst=hardware/tang_nano_20k.cst \
    --freq 27 && \
  gowin_pack -d GW2A-18C -o build/church_tang_nano_20k.fs build/church_tang_nano_20k_pnr.json && \
  openFPGALoader -b tangnano20k build/church_tang_nano_20k.fs
```

Or using the project Makefile:
```bash
cd hardware && make pnr pack prog
```

### Step by step

#### Step 1 — Synthesis

```bash
yosys -p "read_rtlil church_tang_nano_20k.rtlil; synth_gowin -json church_tang_nano_20k.json"
```

Expected output: `church_tang_nano_20k.json` (~500 KB, no errors)

#### Step 2 — Place and route

```bash
nextpnr-himbaechel \
  --device GW2AR-LV18QN88C8/I7 \
  --json church_tang_nano_20k.json \
  --write church_tang_nano_20k_pnr.json \
  -o family=GW2A-18C \
  -o cst=tang_nano_20k.cst \
  --freq 27
```

Expected output: `church_tang_nano_20k_pnr.json` + timing report.
Timing target: **27 MHz** (37 ns period). If closure fails, lower to 13 MHz.

#### Step 3 — Pack bitstream

```bash
gowin_pack -d GW2A-18C -o church_tang_nano_20k.fs church_tang_nano_20k_pnr.json
```

Expected output: `church_tang_nano_20k.fs` (~1–2 MB binary bitstream)

#### Step 4 — Flash

```bash
openFPGALoader -b tangnano20k church_tang_nano_20k.fs
```

Troubleshooting:
- `lsusb | grep -i gowin` — confirm GW2AR device is enumerated
- If `openFPGALoader` not found: `source /path/to/oss-cad-suite/environment`
- Verbose mode: `openFPGALoader -b tangnano20k --verbose church_tang_nano_20k.fs`

### Makefile targets

| Target | Command | Output |
|:-------|:--------|:-------|
| Place & Route | `make pnr` | `church_tang_nano_20k_pnr.json` |
| Pack bitstream | `make pack` | `church_tang_nano_20k.fs` |
| Flash | `make prog` | Programmed to FPGA |
| Clean | `make clean` | Removes generated files |

> **Note**: RTL and synthesis steps are run separately (Amaranth `gen_rtlil` → Yosys).
> The Makefile covers only PnR onward. Run `python3 -m hardware.gen_rtlil` and Yosys
> before `make pnr`.

---

## UART serial console

Connect USB-C. The BL616 bridge enumerates as `/dev/ttyUSB0` (Linux) or `COM<N>` (Windows).

```bash
picocom -b 115200 /dev/ttyUSB0
# or
minicom -D /dev/ttyUSB0 -b 115200
```

Protocol: 8N1, 115200 baud, no flow control.

On boot, the firmware prints:
```
CHURCH TN20K v1.0
<NIA as hex>HALT
```

On each button press (single-step):
```
S:<NIA as hex>HALT
```

On fault:
```
S:<NIA as hex>F:<fault code as hex>HALT
```

---

## Boot sequence

1. GowinBSRAM initialisation FSM writes the namespace table and c-list entries
   (this runs before `boot_gate` is asserted; takes ~256 + 64 write cycles)
2. 16-cycle boot delay after `init_done`
3. Boot ROM executes: initialises CR6 (c-list), CR14 ([CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html)/code), CR8, CR15
4. 3-second startup delay (hardware) → UART banner sent
5. Machine enters HALTED state; press KEY0 / S1 to single-step

---

## Memory map

```
Address range       Contents
0x0000–0x01FF       Boot ROM (512 words, instruction memory)
0x0200–0x07FF       General data memory (BSRAM)
0xFD00–0xFDFF       Namespace table (256 entries × 3 words)
0xFE00–0xFEFF       C-list entries
0x40000000+         MMIO (IO devices — see below)
```

---

## Pin assignments

Defined in `hardware/tang_nano_20k.cst`:

| Signal | Pin | Description |
|:-------|:----|:------------|
| `clk` | 4 | 27 MHz crystal oscillator |
| `uart_tx` | 17 | UART transmit to BL616 |
| `uart_rx` | 18 | UART receive from BL616 |
| `led0` | 10 | LED 0 (active-LOW) |
| `led1` | 11 | LED 1 (active-LOW) |
| `led2` | 13 | LED 2 (active-LOW) |
| `led4` | 9 | LED 4 (active-LOW; maps to MMIO offset 3) |
| `led5` | 8 | LED 5 (active-LOW; maps to MMIO offset 4) |
| `push_button` | 88 | KEY0 / S1 (active-LOW, pull-up) |

*`led3` (pin 14) is omitted — pin 14 is the PSRAM CE on GW2AR and is not available
as a user GPIO in the nextpnr-himbaechel pinmap.*

---

## MMIO register map

All IO devices are mapped at `0x40000000` (address bit 30 set, bit 31 clear).
The MMIO register selector is `addr[5:2]` (4-bit word index).

| Sel | Address | Name | Dir | Boot NS slot | CRC seal |
|:----|:--------|:-----|:----|:-------------|:---------|
| 0 | `0x40000000` | `LED[0]` | R/W | 7 | `0x366A` |
| 1 | `0x40000004` | `LED[1]` | R/W | 7 | — |
| 2 | `0x40000008` | `LED[2]` | R/W | 7 | — |
| 3 | `0x4000000C` | `LED[3]` | R/W | 7 | — |
| 4 | `0x40000010` | `LED[4]` | R/W | 7 | — |
| 5 | `0x40000014` | `UART_TX` | W | 8 | `0x43A4` |
| 6 | `0x40000018` | `UART_STATUS` | R | 8 | — |
| 7 | `0x4000001C` | `UART_RX` | R | 8 | — |
| 8–9 | — | *(reserved)* | — | — | — |
| 10 | `0x40000028` | `BTN` | R | 9 | `0x0F00` |
| 11 | `0x4000002C` | `TIMER.TICKS_LO` | R | 10 | `0xEBC6` |
| 12 | `0x40000030` | `TIMER.TICKS_HI` | R | 10 | — |
| 13 | `0x40000034` | `TIMER.TOD_EPOCH` | R/W | 10 | — |
| 14 | `0x40000038` | `TIMER.ALARM_CMP` | R/W | 10 | — |
| 15 | `0x4000003C` | `TIMER.ALARM_CTL` | R/W | 10 | — |

---

## IO devices

### LED (Boot NS Slot 7)

**Identity:**

| Property | Value |
|:---------|:------|
| MMIO base | `0x40000000` |
| Words | 5 (offsets 0–4, one per LED channel) |
| GT type | `GT_TYPE_INFORM` |
| Permissions | `R W` |
| `b_flag` | 1 |
| GT word 0 | `0x86800007` |
| CRC seal | `0x366A` |

**Register map:**

| Offset | Address | Name | Bits | Tang Nano 20K pin | Active |
|:-------|:--------|:-----|:-----|:-----------------|:-------|
| 0 | `0x40000000` | `LED[0]` | `[2:0]={B,G,R}` | `led0` (pin 10) | LOW |
| 1 | `0x40000004` | `LED[1]` | `[2:0]={B,G,R}` | `led1` (pin 11) | LOW |
| 2 | `0x40000008` | `LED[2]` | `[2:0]={B,G,R}` | `led2` (pin 13) | LOW |
| 3 | `0x4000000C` | `LED[3]` | `[2:0]={B,G,R}` | `led4` (pin 9)* | LOW |
| 4 | `0x40000010` | `LED[4]` | `[2:0]={B,G,R}` | `led5` (pin 8) | LOW |

\* MMIO offset 3 drives physical pin `led4` (board pin 9). Physical `led3` (board
pin 14) is used internally as PSRAM CE and is not available as a user GPIO.

Only bit 0 (R) drives a physical pin. The signal is inverted before the pin
(active-LOW): writing `1` to bit 0 lights the LED; writing `0` turns it off.
Bits `[31:3]` ignored on write, read as zero.

**Usage:**
```
DWRITE DR_src, [CR_led + N]   ; N = 0..4, DR_src[0]=1 = LED on
DREAD  DR_dst, [CR_led + N]   ; read back register value
```

**Pre-boot LED meanings (hardware status display):**

| Signal | Pre-boot meaning |
|:-------|:----------------|
| led0 | ON while booting, OFF when boot complete |
| led1 | ON when running; blinks at 1 Hz when halted |
| led2 | ON when fault detected |
| led4 | ON when halted (maps to MMIO offset 3) |
| led5 | ON during single-step; OFF post-boot (maps to MMIO offset 4) |

Post-boot: software controls offsets 0–4 via DWRITE.

---

### UART (Boot NS Slot 8)

**Identity:**

| Property | Value |
|:---------|:------|
| MMIO base | `0x40000014` |
| Words | 3 (offsets 0–2) |
| GT type | `GT_TYPE_INFORM` |
| Permissions | `R W` |
| `b_flag` | 1 |
| GT word 0 | `0x86800008` |
| CRC seal | `0x43A4` |
| Physical bridge | BL616 USB, 115200 baud, USB-C |

**Register map:**

| Offset | Address | Name | Dir | Meaning |
|:-------|:--------|:-----|:----|:--------|
| 0 | `0x40000014` | `TX` | W | Byte to transmit (`[7:0]`); send when idle |
| 1 | `0x40000018` | `STATUS` | R | `[0]` = TX ready (`1`=idle, `0`=busy); `[31:1]`=0 |
| 2 | `0x4000001C` | `RX` | R | Received byte (`[7:0]`); `0x00` = empty |

**Usage:**
```
; Poll until ready, then send byte 'A'
uart_wait:
  DREAD  DR1, [CR_uart + 1]
  ANDI   DR1, DR1, #1
  BEQ    uart_wait
  MOVI   DR1, #0x41           ; 'A'
  DWRITE DR1, [CR_uart + 0]

; Receive byte
  DREAD  DR1, [CR_uart + 2]
```

The MMIO TX path shares the physical UART with the debug FSM. The debug FSM takes
priority; MMIO TX sends when the debug FSM is not busy.

**Attenuation:**

| Attenuated GT | Perms | Use case |
|:--------------|:------|:---------|
| TX-only | `W` | Send-only thread (no status poll or RX) |
| RX+STATUS | `R` | Receive-only thread |
| Full | `R W` | Full UART access |

---

### BTN (Boot NS Slot 9)

**Identity:**

| Property | Value |
|:---------|:------|
| MMIO base | `0x40000028` |
| Words | 1 (offset 0 only) |
| GT type | `GT_TYPE_INFORM` |
| Permissions | `R` |
| `b_flag` | 1 |
| GT word 0 | `0x82800009` |
| CRC seal | `0x0F00` |
| Physical button | KEY0 / S1 (active-LOW, pin 88, external pull-up) |

**Register map:**

| Offset | Address | Name | Dir | Meaning |
|:-------|:--------|:-----|:----|:--------|
| 0 | `0x40000028` | `BTN` | R | `[0]` = pressed (`1`=pressed); `[31:1]`=0 |

The hardware inverts the active-LOW signal so bit 0 is `1` when the button is held.
The debouncer is a 3-stage synchroniser; the register reflects the debounced level.

**Edge-detect pattern:**
```
btn_poll:
  DREAD DR1, [CR_btn + 0]
  ; compare DR1[0] with saved DR2[0]
  ; rising edge  = DR1[0]==1 and DR2[0]==0  (press)
  ; falling edge = DR1[0]==0 and DR2[0]==1  (release)
```

DWRITE against this GT faults with `PERMISSION`.

---

### TIMER (Boot NS Slot 10)

**Identity:**

| Property | Value |
|:---------|:------|
| MMIO base | `0x4000002C` |
| Words | 5 (offsets 0–4) |
| GT type | `GT_TYPE_INFORM` |
| Permissions | `R W` |
| `b_flag` | 1 |
| GT word 0 | `0x8680000A` |
| CRC seal | `0xEBC6` |
| Clock rate | 27 MHz (~37 ns tick) |
| 32-bit TICKS_LO wrap | ~158.9 s |

**Register map:**

| Offset | Address | Name | Dir | Meaning |
|:-------|:--------|:-----|:----|:--------|
| 0 | `0x4000002C` | `TICKS_LO` | R | Low 32 bits of 64-bit free-running tick counter |
| 1 | `0x40000030` | `TICKS_HI` | R | High 32 bits of 64-bit tick counter |
| 2 | `0x40000034` | `TOD_EPOCH` | R/W | Unix time in seconds (set by boot or IDE) |
| 3 | `0x40000038` | `ALARM_CMP` | R/W | Alarm compare value (matched against `TICKS_LO`) |
| 4 | `0x4000003C` | `ALARM_CTL` | R/W | `[0]`=armed, `[1]`=fired (write 1 to bit 1 to clear) |

**Current time formula:**
```
current_unix = TOD_EPOCH + (TICKS_LO_now - TICKS_LO_at_boot) / 27_000_000
```

**Elapsed-time pattern:**
```
DREAD DR1, [CR_timer + 0]   ; TICKS_LO start
DREAD DR2, [CR_timer + 1]   ; TICKS_HI start
; ... work ...
DREAD DR3, [CR_timer + 0]   ; TICKS_LO end
DREAD DR4, [CR_timer + 1]   ; TICKS_HI end
; elapsed = DR3 - DR1 (32-bit, handles wrap)
```

**Alarm pattern:**
```
DREAD  DR1, [CR_timer + 0]      ; read current TICKS_LO
ADDI   DR1, DR1, #delay_ticks   ; target = now + delay
DWRITE DR1, [CR_timer + 3]      ; set ALARM_CMP
MOVI   DR2, #0x01
DWRITE DR2, [CR_timer + 4]      ; arm
alarm_poll:
  DREAD  DR2, [CR_timer + 4]
  ANDI   DR2, DR2, #0x02         ; test fired bit
  BEQ    alarm_poll
MOVI   DR3, #0x02
DWRITE DR3, [CR_timer + 4]      ; clear fired flag
```

---

## Additional IO port options

The Tang Nano 20K exposes the following expansion options:

| Interface | Location | Notes |
|:----------|:---------|:------|
| GPIO pins (Bank 3 free pins) | J1 / J2 headers | Free after UART, LEDs, and button are assigned |
| HDMI connector | On-board | HDMI differential pairs available via LVDS banks |
| SPI flash | On-board | Shared with bitstream; requires care with CE timing |
| PSRAM (psram0 / psram1) | On-board | GW2AR contains 64 Mbit PSRAM; pin 14 is PSRAM CE |
| JTAG (BL616 bridge) | USB-C | Used for programming and debug |

To add a new GPIO to the design:
1. Add an `IO_LOC` and `IO_PORT` entry to `hardware/tang_nano_20k.cst`
2. Add the corresponding `Signal` to `ChurchTangNano20K` and connect it in `elaborate()`
3. Re-generate RTL, synthesise, place-and-route, pack, and flash

Available peripheral candidates for future integration:
- Additional UART channels via free Bank 3 pins
- I2C sensor bus via SDA/SCL on expansion header
- SPI peripherals using on-board or external flash
- PSRAM interface (requires dedicated controller; pin 14 CE is reserved)
- HDMI video output via the on-board HDMI connector

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|:--------|:-------------|:----|
| RTL generation fails | Import error in `hardware/` | Run module-load check (see above) |
| Synthesis fails | hw_types.py encoding error | Check Abstract GT definitions |
| PnR timing fails at 27 MHz | Long combinational path | Lower to 13 MHz or pipeline critical paths |
| `openFPGALoader` device not found | USB not enumerated | `lsusb | grep -i gowin`; check cable |
| UART outputs nothing | TX/RX swapped, or wrong baud | Cross-check pins 17/18 in CST file; confirm 115200 |
| LED offset 3 not lighting | Expecting `led3` pin | Offset 3 drives `led4` (pin 9); `led3` pin is absent |
| Button read always 0 | Debounce sync | Hold button; register is level (not pulse) |
| All LEDs on after boot | Active-LOW inversion | Writing 0 = LED on; writing 1 = LED off |
