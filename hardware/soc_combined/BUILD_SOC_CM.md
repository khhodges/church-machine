# BUILD_SOC_CM.md — Sapphire SoC + Church Machine Combined Bitstream

## What this builds

A combined Efinix Ti60F225 bitstream that places the Sapphire RISC-V SoC and the
Church Machine RTL side-by-side in a single Efinity project.

On power-on:
- The Sapphire SoC boots its firmware and sends `CHURCH Ti60 SoC+CM v1.0\r\n`
  over **ttyUSB2** (115200 baud, GPIOL_02 → FT4232H interface 2).
- The Church Machine streams NIA traces, fault codes, and call-home packets
  over **ttyUSB3** (115200 baud, GPIOL_P_03 → FT4232H interface 3).
- The Church Machine boots its internal boot sequence automatically.
- LED0 lights when the SoC is out of reset.
- LED1 lights when the CM completes its boot sequence.
- LED2 lights if the CM raises a fault.
- LED3 shows the CM heartbeat (1 Hz blink while halted and healthy).

The SoC firmware controls the CM via an APB3 register bridge.
See **APB3 register map** below.

---

## Prerequisites

| Item | Notes |
|---|---|
| Efinity 2025.2 | Installed at `~/efinity/2025.2` |
| Efinity RISC-V IDE 2025.2 | Toolchain at `~/efinity/efinity-riscv-ide-2025.2/toolchain/bin` |
| Sapphire SoC IP | Ships with Efinity — path given in Step 1 |
| Python 3 + Amaranth | Required to generate CM RTL in Step 2 |
| `pyserial` | `pip install pyserial` — for the test step |

---

## Steps

### Step 1 — Copy the Sapphire SoC IP files

```bash
cp ~/efinity/2025.2/ipm/ip/efx_tsemac/fpga/Ti60F225_devkit/ip/sapphire/sapphire.v \
   hardware/soc_combined/

cp ~/efinity/2025.2/ipm/ip/efx_tsemac/fpga/Ti60F225_devkit/ip/sapphire/sapphire_define.vh \
   hardware/soc_combined/
```

> **If the path does not exist**, search for the file:
> ```bash
> find ~/efinity -name "sapphire.v" 2>/dev/null
> ```

---

### Step 2 — Generate the Church Machine RTL

The CM Verilog is generated from `hardware/ti60_f225.py` (Amaranth HDL):

```bash
python hardware/gen_verilog.py --ti60
```

This writes `build/church_ti60_f225.v` (module name `church_ti60f225`).
Copy it into the project directory:

```bash
cp build/church_ti60_f225.v hardware/soc_combined/
```

> **Why a separate copy step?**  Efinity requires all source files to sit in or
> near the project directory.  The `build/` directory is `.gitignore`d so the
> generated RTL is not committed to the repository.

---

### Step 3 — Verify Sapphire addresses (optional but recommended)

Open `hardware/soc_combined/sapphire_define.vh` and confirm the standard
base addresses used by the SoC firmware:

| Symbol | Expected value | Used by |
|---|---|---|
| `` `ONCHIP_MEM_BASE `` | `32'h00000000` | Linker script ROM origin |
| `` `ONCHIP_MEM_BASE_1 `` | `32'h00080000` | Linker script RAM origin |
| `` `APB_UART0_BASE `` | `32'hF0010000` | `firmware/main.c` UART_BASE |
| `` `APB_APB_SLAVE_0_BASE `` | `32'hF0040000` | `firmware/main.c` CM_APB_BASE |

If any value differs, update `firmware/main.c` and/or `firmware/link.ld`
accordingly.

---

### Step 4 — Build the SoC firmware

```bash
make -C hardware/soc_combined/firmware
cp hardware/soc_combined/firmware/firmware.hex hardware/soc_combined/
```

The firmware:
1. Sends the boot greeting over UART.
2. Polls `CM_APB_BASE + 0x04` (STATUS register) until `boot_complete` is set.
3. Writes `0x00000000` to `CM_APB_BASE + 0x00` (CTRL) — pulls CM push_button
   LOW for 25 000 000 cycles (1 s @ 25 MHz) — to enter free-run mode.
4. Writes `0x00000001` (released) after 1 s to stop pulling.
5. Loops, printing CM NIA (`CM_APB_BASE + 0x08`) every second.

---

### Step 5 — Open the project in Efinity

1. Launch Efinity 2025.2.
2. **File → Open Project** → navigate to `hardware/soc_combined/church_soc_cm.xml`.
3. In **Project Settings** confirm:
   - Top module: `top`
   - Device: `Ti60F225`
4. Confirm five source files are listed:
   - `top.v`
   - `apb3_cm_bridge.v`
   - `church_ti60_f225.v`
   - `sapphire.v`
   - `sapphire_define.vh`

---

### Step 6 — Compile (Synthesis → Place & Route → Bitstream)

Click **Compile** (or run all three flows sequentially).

Efinity will:
1. Read `firmware.hex` and embed it in the SoC on-chip ROM.
2. Synthesise both the Sapphire SoC and the Church Machine in a single pass.
3. Place and route the combined design onto the Ti60F225 fabric.
4. Generate the bitstream.

> **Resource expectation**: The combined design uses significantly more fabric
> resources than either block alone.  The Ti60F225 has ≈ 60K logic elements
> and 256 KB embedded BRAM.  Synthesis will report utilisation figures in the
> `work_syn/` directory after mapping.

---

### Step 7 — Program the board

1. Connect the Ti60F225 devkit via USB.
2. Open the **Programmer** tool in Efinity.
3. Select the `.hex` bitstream from `outflow/`.
4. Click **Program**.

---

### Step 8 — Test

#### 8a — Run the automated smoke-test

After flashing, open a terminal and run the UART smoke-test:

```bash
python3 scripts/test_ti60_uart.py --port=/dev/ttyUSB2 --timeout=15
```

The script opens ttyUSB2 (the Sapphire SoC UART on FT4232H interface 2),
waits up to 15 seconds, and checks five items:

| Check | What it looks for |
|---|---|
| GREETING | `CHURCH Ti60 SoC+CM` in the first output |
| BOOT_COMPLETE | `CM boot_complete: 1` line |
| NIA_LINES | At least one `NIA=0x...` line |
| CALLHOME_JSON | At least one valid `CALLHOME:{...}` JSON line |
| ACK (optional) | IDE device list contains `Ti60F225` (requires `--ide=URL`) |

Exit code 0 = PASS; exit code 1 = FAIL (check per-check lines for diagnosis).

To also verify IDE call-home registration:

```bash
python3 scripts/test_ti60_uart.py --port=/dev/ttyUSB2 --timeout=15 \
    --ide=http://localhost:5000
```

> **No hardware?** Run with `--dry-run` to validate the parser logic against a
> canned transcript without a serial port:
> ```bash
> python3 scripts/test_ti60_uart.py --dry-run
> ```

#### 8b — Start the call-home bridge (background)

To forward call-home packets from the Ti60 to the Church Machine IDE, start
the bridge in a separate terminal (or background it with `&`):

```bash
./hardware/soc_combined/bridge.sh --ide=http://localhost:5000
```

`bridge.sh` auto-detects ttyUSB2, validates that `pyserial` is installed, and
launches `hardware/soc_combined/local_bridge.py`.  Once running, the Ti60
will appear in the IDE Dashboard device list as **Ti60F225**.

To specify the port explicitly:

```bash
./hardware/soc_combined/bridge.sh --port=/dev/ttyUSB3 --ide=http://localhost:5000
```

#### 8c — Verify LED pattern

After ~3 seconds the LEDs should show:

| LED | Expected | Meaning |
|---|---|---|
| LED0 | ON | SoC out of reset |
| LED1 | ON | CM boot complete |
| LED2 | OFF | No CM fault |
| LED3 | Blinking | CM heartbeat |

#### 8d — CM debug UART (ttyUSB3)

The Church Machine's own debug UART is on ttyUSB3 (FT4232H interface 3).
To inspect it manually:

```bash
python3 -c "
import serial
s = serial.Serial('/dev/ttyUSB3', 115200, timeout=5)
s.setRTS(False)
s.setDTR(False)
print(s.read(400).decode(errors='replace'))
"
```

Expected output: NIA trace lines and any fault codes emitted by the Church
Machine during boot and free-run.  A silent ttyUSB3 after boot is normal
(heartbeat only visible on LED3).

#### Troubleshooting — FT4232H port layout

The Ti60F225 devkit FT4232H exposes four USB-UART interfaces:

| Device | FT4232H interface | Purpose |
|---|---|---|
| ttyUSB0 | Interface 0 | JTAG |
| ttyUSB1 | Interface 1 | SPI / debug |
| ttyUSB2 | Interface 2 | **Sapphire SoC UART** (bridge + smoke-test) |
| ttyUSB3 | Interface 3 | Church Machine debug UART |

If other USB-serial devices are present the numbers may be offset.  Use
`ls /dev/ttyUSB*` to confirm, then pass `--port=/dev/ttyUSBN` explicitly to
both `test_ti60_uart.py` and `bridge.sh`.

---

## APB3 register map

The SoC accesses the CM bridge at base address `APB_APB_SLAVE_0_BASE`
(default `0xF0040000`).

| Offset | Name   | Access | Bits | Description |
|---|---|---|---|---|
| 0x00 | CTRL   | R/W | [0] | `cm_pb` — push-button drive. **1** = released (default). **0** = pressed (active-low). Hold 0 for ≥ 1 s to enter free-run; brief pulse for single-step. |
| 0x04 | STATUS | RO  | [0] | `boot_complete` — CM boot sequence finished. |
| 0x04 | STATUS | RO  | [1] | `fault_valid` — CM raised a fault this cycle. |
| 0x04 | STATUS | RO  | [2] | `fault_latched` — sticky; any past fault since reset. |
| 0x08 | NIA    | RO  | [31:0] | CM next-instruction address. |
| 0x0C | FAULT  | RO  | [4:0] | CM fault code (valid when `fault_valid` or `fault_latched`). |

**Example C access:**

```c
#define CM_APB_BASE  0xF0040000UL
#define CM_CTRL      (*(volatile uint32_t *)(CM_APB_BASE + 0x00))
#define CM_STATUS    (*(volatile uint32_t *)(CM_APB_BASE + 0x04))
#define CM_NIA       (*(volatile uint32_t *)(CM_APB_BASE + 0x08))
#define CM_FAULT     (*(volatile uint32_t *)(CM_APB_BASE + 0x0C))

/* Wait for CM boot */
while (!(CM_STATUS & 0x1));

/* Enter CM free-run: assert push-button for 1 s @ 25 MHz */
CM_CTRL = 0x0;
for (volatile uint32_t i = 0; i < 25000000; i++) __asm__("nop");
CM_CTRL = 0x1;
```

---

## What each file does

| File | Purpose |
|---|---|
| `top.v` | Top-level — instantiates Sapphire SoC, `church_ti60f225`, and APB3 bridge |
| `apb3_cm_bridge.v` | APB3 slave register bank — SoC ↔ CM control and status |
| `church_ti60_f225.v` | **(generated — not in repo)** Church Machine RTL for Ti60F225 |
| `church_soc_cm.xml` | Efinity project file |
| `church_soc_cm.peri.xml` | Pin assignments — clock, SoC UART (ttyUSB2), CM UART (ttyUSB3), push button, 4 LEDs |
| `sapphire.v` | **(copy from Efinity IP — not in repo)** Sapphire SoC RTL |
| `sapphire_define.vh` | **(copy from Efinity IP — not in repo)** Sapphire SoC defines |
| `firmware/` | SoC bare-metal C firmware (adapts `soc_minimal` firmware) |
| `firmware.hex` | **(generated by make — not in repo)** ROM init file for synthesis |

---

## Resource Utilisation Check (CI guard)

A lightweight CI script enforces that the combined SoC+CM bitstream never
silently exceeds Ti60F225 capacity.

### Thresholds

| Resource | Ti60F225 total | Failure threshold |
|---|---|---|
| Logic Elements (LE) | 59 904 | > 90 % (≥ 53 914 LE used) |
| Block RAM (BRAM) | 256 KB | > 90 % (≥ 231 KB used) |

If either metric exceeds 90 % the script exits non-zero, blocking the CI step.

### Report location

Efinity writes synthesis resource data to the `work_syn/` subdirectory of the
project after a successful **Synthesis** run.  The script scans all `.rpt`,
`.log`, and `.txt` files in that directory automatically:

```
hardware/soc_combined/work_syn/
    church_soc_cm.map.rpt        ← primary resource report
    church_soc_cm.timing.rpt     ← timing report (not used by the check)
    ...
```

### Running the check manually

```bash
python scripts/check_ti60_utilisation.py
```

The script defaults to `--report-dir hardware/soc_combined/work_syn`.
Use `--missing-ok` to suppress exit code 2 when no synthesis has been run yet
(useful for CI runs that skip hardware synthesis):

```bash
python scripts/check_ti60_utilisation.py --missing-ok
```

Additional options:

| Flag | Default | Description |
|---|---|---|
| `--report-dir PATH` | `hardware/soc_combined/work_syn` | Directory containing Efinity `.rpt` files |
| `--report-file PATH` | — | Parse a single named file instead of scanning the directory |
| `--le-threshold N` | `90` | Fail if LE utilisation exceeds N % |
| `--bram-threshold N` | `90` | Fail if BRAM utilisation exceeds N % |
| `--le-total N` | `59904` | Override total LE count (Ti60F225 default) |
| `--bram-total-kb N` | `256` | Override total BRAM in KB (Ti60F225 default) |
| `--missing-ok` | off | Exit 0 with a warning instead of exit 2 when no reports found |

### CI wiring (Replit validation)

The check is registered as the `ti60-utilisation` validation step.  It uses
`--missing-ok` so the step is a no-op in pull-request runs that skip hardware
synthesis:

```bash
python scripts/check_ti60_utilisation.py --missing-ok
```

To run it (and all other validation steps) via the Replit validation UI, trigger
the `ti60-utilisation` step.

### Makefile target

A convenience `make` target is available from `hardware/soc_combined/`:

```bash
make check-util        # exits non-zero if thresholds exceeded
make check-util-ci     # same but --missing-ok (safe for CI)
```

---

## Scope / Out of scope

**In scope for this integration milestone:**
- Single shared 25 MHz clock for both SoC and CM.
- APB3 bridge exposing kick register and CM status.
- Push-button emulation for free-run trigger.
- LED status indicators for both SoC and CM health.

**Out of scope (future milestones):**
- FreeRTOS on the SoC.
- SPI flash boot for SoC firmware.
- JTAG debugging of either core.
- DMA path from SoC to CM data BRAM (PATCH_LUMP over APB3).
- PLL upclocking to 50 MHz (Phase B clock plan).

---

## Troubleshooting

**`church_ti60_f225.v` not found during synthesis**
→ Re-run Step 2.  Ensure the file is in `hardware/soc_combined/`.

**`sapphire.v` not found during synthesis**
→ Re-run Step 1.

**`firmware.hex` not found during synthesis**
→ Re-run Step 4.

**LED1 never lights (CM boot_complete stays 0)**
→ Check that `church_ti60_f225.v` was generated without errors.  Confirm the
CM's `dbg_boot_complete` port name matches the instantiation in `top.v`.

**LED2 lights immediately (CM fault at startup)**
→ This may indicate a boot ROM or namespace consistency issue.  Re-generate
the Verilog and confirm the boot ROM constants in `hardware/boot_rom.py` are
up to date.

**P&R fails with "resource overuse"**
→ The Ti60F225 has ample fabric, but using both the SoC and CM together is
resource-intensive.  Try reducing `fanout_limit` in `church_soc_cm.xml` or
enable `logic_opting`.  Contact the team if the utilisation report exceeds 90%.
