# BUILD_SOC_CM.md — Sapphire SoC + Church Machine Combined Bitstream

## What this builds

A combined Efinix Ti60F225 bitstream that places the Sapphire RISC-V SoC and the
Church Machine RTL side-by-side in a single Efinity project.

On power-on:
- The Sapphire SoC boots its firmware and sends `CHURCH Ti60 SoC+CM v1.1\r\n`
  over **ttyUSB2** (115200 baud, GPIOL_02 → FT4232H interface 2).
- The Church Machine streams NIA traces, fault codes, and call-home packets.
- LED0 lights when the SoC is out of reset.
- LED1 lights when the CM completes its boot sequence.
- LED2 lights if the CM raises a fault.
- LED3 shows the CM heartbeat (1 Hz blink while halted and healthy).

The SoC firmware controls the CM via an APB3 register bridge.
See **APB3 register map** below.

---

## ⚠️  Critical: how firmware gets into the bitstream on Ti60

**EFX_MAP on Efinix Titanium completely ignores `$readmemb`.**
It is treated as simulation-only regardless of where the `.bin` files are placed.
Copying symbol files to `work_syn/` does NOT help.

The correct flow:

1. Build firmware → four byte-lane `.bin` symbol files.
2. **Run `scripts/patch_sapphire_init.py`** — replaces `$readmemb` (or existing
   inline assignments if already patched) with explicit `initial` block assignments.
3. Set `optimize-zero-init-rom = 0` in `church_soc_cm.xml`.
4. Synthesise → EFX_MAP creates 64 EFX_RAM10 instances for system_ramA **with
   `INIT_` parameters already populated** from the inline assignments.
5. Place & route.
6. **Run `efx_pgm --project-xml church_soc_cm.xml`** — generates the SPI flash hex.
7. Flash with `openFPGALoader`.

**There is no separate `patch_mapv_init.py` step.** The inline initial block
approach means EFX_MAP propagates firmware bytes to the EFX_RAM10 `INIT_` params
during synthesis.  Confirm with:
```bash
grep "INIT_0" outflow/church_soc_cm.map.v | grep "ram_symbol" | head -4
# All four lanes must show non-zero hex values
```

**`patch_sapphire_init.py` must be re-run every time the firmware changes**
before re-synthesising.  The script handles both the virgin case (`$readmemb`
present) and the already-patched case (inline assignments already there).

---

## Prerequisites

| Item | Notes |
|---|---|
| Efinity 2025.2 | Installed at `~/efinity/2025.2` |
| Efinity RISC-V IDE 2025.2 | Toolchain at `~/efinity/efinity-riscv-ide-2025.2/toolchain/bin` |
| Sapphire SoC IP | Ships with Efinity — see Step 1 |
| Python 3 + Amaranth | Required to generate CM RTL in Step 2 |
| `pyserial` | `pip install pyserial` — for the smoke test |
| `openFPGALoader` | `~/oss-cad-suite/bin/openFPGALoader` — for flashing |

---

## Steps

### Step 1 — Copy the Sapphire SoC IP files

```bash
cp ~/efinity/2025.2/ipm/ip/efx_tsemac/fpga/Ti60F225_devkit/ip/sapphire/sapphire.v \
   hardware/soc_combined/

cp ~/efinity/2025.2/ipm/ip/efx_tsemac/fpga/Ti60F225_devkit/ip/sapphire/sapphire_define.vh \
   hardware/soc_combined/
```

> If the path does not exist: `find ~/efinity -name "sapphire.v" 2>/dev/null`

---

### Step 2 — Generate the Church Machine RTL

```bash
python hardware/gen_verilog.py --ti60
cp build/church_ti60_f225.v hardware/soc_combined/
```

---

### Step 3 — Build the SoC firmware

```bash
make -C hardware/soc_combined/firmware
```

Produces `firmware/firmware.bin` and four byte-lane symbol files in
`hardware/soc_combined/`:
```
EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol{0,1,2,3}.bin
```

---

### Step 4 — Patch sapphire.v (MUST re-run on every firmware change)

```bash
cd ~/church-machine   # repo root
python3 scripts/patch_sapphire_init.py \
  hardware/soc_combined/sapphire.v \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin
```

Expected output:
```
symbol0: 131072 entries, NNN non-zero, [0]=0xXX
  -> replaced $readmemb          ← first run
  OR
  -> updated N inline block(s)   ← subsequent runs
...
sapphire.v OK (+N chars, M total)
```

If you see `ERROR: no pattern found for ram_symbol0`, the sapphire.v is a
different version of the Efinix IP — grep for `ram_symbol` to inspect it.

---

### Step 5 — Ensure optimize-zero-init-rom is off

```bash
grep "optimize-zero-init-rom" hardware/soc_combined/church_soc_cm.xml
# Must show value="0"
```

If it shows `value="1"`:
```bash
sed -i 's/optimize-zero-init-rom" value="1"/optimize-zero-init-rom" value="0"/' \
  hardware/soc_combined/church_soc_cm.xml
```

---

### Step 6 — Synthesise

```bash
bash hardware/soc_combined/work_syn/run_efx_map.sh 2>&1 | tail -5
```

Verify all 4 BRAM lanes have non-zero INIT_0 (firmware confirmed embedded):
```bash
for sym in 0 1 2 3; do
  LINENUM=$(grep -n "EFX_RAM10" hardware/soc_combined/outflow/church_soc_cm.map.v \
    | grep "ram_symbol${sym}__D\\\$g1" | head -1 | cut -d: -f1)
  echo "symbol${sym}: $(sed -n "${LINENUM},$((LINENUM+3))p" \
    hardware/soc_combined/outflow/church_soc_cm.map.v | grep INIT_0)"
done
# All four must show non-zero hex strings
```

---

### Step 7 — Place & Route

```bash
bash hardware/soc_combined/work_pnr/run_efx_pnr.sh 2>&1 | tail -5
```

---

### Step 8 — Generate the SPI flash hex (efx_pgm)

```bash
cd hardware/soc_combined
~/efinity/2025.2/bin/efx_pgm --project-xml church_soc_cm.xml 2>&1 | tail -5
ls -lh outflow/church_soc_cm.hex outflow/church_soc_cm.bit
# Timestamps must be NEWER than the P&R run above
```

> **Note:** The flag is `--project-xml`, NOT `--project`.
> There is no `work_pgm/run_efx_pgm.sh` in this project — call efx_pgm directly.
> P&R does **not** generate the hex; efx_pgm does.

---

### Step 9 — Flash and test

```bash
cd ~/church-machine
sudo ~/oss-cad-suite/bin/openFPGALoader \
  -b titanium_ti60_f225_jtag \
  -f hardware/soc_combined/outflow/church_soc_cm.hex

sleep 5 && python3 scripts/test_ti60_uart.py \
  --port=/dev/ttyUSB2 --timeout=30 --verbose
```

---

## Rebuild-from-firmware-change checklist

When only the firmware changes (no RTL changes), you can skip Steps 1–2:

```bash
cd ~/church-machine
make -C hardware/soc_combined/firmware                    # Step 3
python3 scripts/patch_sapphire_init.py \                  # Step 4 — MUST NOT SKIP
  hardware/soc_combined/sapphire.v \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin
bash hardware/soc_combined/work_syn/run_efx_map.sh        # Step 6  (~10-15 min)
bash hardware/soc_combined/work_pnr/run_efx_pnr.sh        # Step 7  (~5-10 min)
cd hardware/soc_combined && \
  ~/efinity/2025.2/bin/efx_pgm --project-xml church_soc_cm.xml  # Step 8  (~2 min)
cd ~/church-machine && \
  sudo ~/oss-cad-suite/bin/openFPGALoader \
    -b titanium_ti60_f225_jtag \
    -f hardware/soc_combined/outflow/church_soc_cm.hex     # Step 9a
python3 scripts/test_ti60_uart.py \
  --port=/dev/ttyUSB2 --timeout=30 --verbose               # Step 9b
```

---

## FT4232H port layout

| Device | FT4232H interface | Purpose |
|---|---|---|
| ttyUSB0 | Interface 0 | FPGA JTAG |
| ttyUSB1 | Interface 1 | CPU debug JTAG (tied off in hardware) |
| ttyUSB2 | Interface 2 | **Sapphire SoC UART** (smoke-test target) |
| ttyUSB3 | Interface 3 | Church Machine debug UART |

---

## Firmware addresses

| Symbol | Value | Used by |
|---|---|---|
| `UART_BASE` | `0xF8010000` | `firmware/main.c` |
| `UART_DATA` | `0xF8010000` | write = TX, read = RX |
| `UART_STATUS` | `0xF8010004` | bits[23:16] = TX avail (Sapphire UART) |
| `UART_CLOCKDIV` | `0xF8010008` | 50 MHz / (8 × (div+1)) = baud rate |
| APB slave 0 (CM bridge) | `0xF8100000` | `firmware/main.c` `CM_APB_BASE` |
| Boot ROM base | `0xF9000000` | CPU reset vector, `link.ld` |

UART baud rate: reset `CLOCKDIV = 53` → 50 000 000 / (8 × 54) = 115 740 baud (≈115200).
Firmware leaves `CLOCKDIV` at its reset value — no override needed.

**uart_putc design:** Uses unconditional write + 3000-NOP inter-character delay
(~240 µs @ 50 MHz) rather than polling STATUS. This avoids infinite spins if
the STATUS register bit layout differs between Sapphire IP versions.

---

## APB3 register map

The SoC accesses the CM bridge at `0xF8100000` (`IO_APB_SLAVE_0_INPUT` per generated `soc.h`).

| Offset | Name   | Access | Description |
|---|---|---|---|
| 0x00 | CTRL   | R/W | `[0]` = cm_pb: 1=released (default), 0=pressed (active-low). Hold 0 for ≥ 1 s to enter free-run. |
| 0x04 | STATUS | RO  | `[0]` boot_complete · `[1]` fault_valid · `[2]` fault_latched |
| 0x08 | NIA    | RO  | CM next-instruction address |
| 0x0C | FAULT  | RO  | `[4:0]` fault code |
| 0x10 | UID_LO | R/W | Lower 32 bits of 64-bit device UID |
| 0x14 | UID_HI | R/W | Upper 32 bits of 64-bit device UID |

---

## Troubleshooting

### UART silent — 0 bytes on ttyUSB2

Check in order:

1. **Was the hex regenerated after the latest synthesis?**
   ```bash
   ls -lh hardware/soc_combined/outflow/church_soc_cm.hex
   # Timestamp must be AFTER the most recent P&R run
   # If stale: cd hardware/soc_combined && ~/efinity/2025.2/bin/efx_pgm --project-xml church_soc_cm.xml
   ```

2. **Did patch_sapphire_init.py run before synthesis?**
   ```bash
   grep -c "ram_symbol0\[" hardware/soc_combined/sapphire.v
   # Must be >> 2 (hundreds of assignments)
   ```

3. **Is optimize-zero-init-rom = 0?**
   ```bash
   grep "optimize-zero-init-rom" hardware/soc_combined/church_soc_cm.xml
   ```

4. **Do all 4 BRAM lanes have non-zero INIT_0?**
   ```bash
   for sym in 0 1 2 3; do
     LINENUM=$(grep -n "EFX_RAM10" hardware/soc_combined/outflow/church_soc_cm.map.v \
       | grep "ram_symbol${sym}__D\\\$g1" | head -1 | cut -d: -f1)
     echo "sym${sym}: $(sed -n "${LINENUM},$((LINENUM+3))p" \
       hardware/soc_combined/outflow/church_soc_cm.map.v | grep INIT_0)"
   done
   # All four must be non-zero
   ```

5. **Is ttyUSB2 vs ttyUSB3 correct?**  SoC UART → ttyUSB2.  CM UART → ttyUSB3.
   Both ports should show 0x00 glitch bytes on open; ttyUSB2 should have actual
   ASCII text once the SoC firmware boots.

### `efx_pgm` fails with "unrecognised option"

Use `--project-xml`, not `--project`:
```bash
~/efinity/2025.2/bin/efx_pgm --project-xml church_soc_cm.xml
```

### patch_sapphire_init.py prints `ERROR: no pattern found`

The sapphire.v does not contain either `$readmemb` or the expected inline
assignments for `ram_symbol0`. This means the file is a different version of the
Efinix Sapphire IP. Inspect it:
```bash
grep -n "ram_symbol\|readmemb" hardware/soc_combined/sapphire.v | head -20
```

### Boot loop — NIA=0x00000000 repeating in the IDE stream panel

**Symptom** — The 📡 Live UART Stream panel shows this pattern repeating:
```
← CHURCH Ti60 SoC+CM v1.1
NIA → 0x00000000
── REBOOT ──
← CHURCH Ti60 SoC+CM v1.1
NIA → 0x00000000
── REBOOT ──
```

**What it means** — The Church Machine starts, attempts its very first instruction at
address `0x00000000` (the start of the boot LUMP), faults immediately, and the firmware
reboots. The boot LUMP baked into the BRAM during synthesis is corrupted, stale, or
was compiled from an incompatible firmware version.

**Reading the fault data** — The IDE Connect tab CALLHOME line shows the fault detail:
```
CALLHOME valid: board=Ti60F225 fw=1.0 nia=0x00000000
```
The `nia=` field is the **fault NIA** from the previous boot stored in the CALLHOME
packet (`fault_nia` bytes 19–22). The IDE fault popup (visible in the simulator) maps
fault codes to mnemonics:

| HW Code | Mnemonic | Meaning at boot |
|---|---|---|
| `0x07` | `NULL_CAP` | Boot LUMP capability slot is zeroed — BRAM not patched |
| `0x08` | `BOUNDS` | Boot LUMP size field is wrong — firmware/LUMP mismatch |
| `0x09` | `VERSION` | Golden Token version field invalid — stale BRAM init |
| `0x0A` | `SEAL` | CRC seal on boot capability is broken — BRAM corrupted |
| `0x0B` | `INVALID_OP` | Opcode at address 0 is not a valid CM instruction |
| `0x0D` | `DOMAIN_PURITY` | Code/capability mixed in boot LUMP — layout error |

**Capturing full fault detail** — in the IDE Connect log, the CALLHOME line includes
`fault_code` (byte 18 of the packet). You can also read it directly via the APB3 bridge
while the board is halted:

```
APB offset 0x04 (STATUS) bit[1] = fault_valid
APB offset 0x0C (FAULT)  bits[4:0] = fault code  ← matches HW Code table above
APB offset 0x08 (NIA)              = faulting instruction address
```

**Fix** — the BRAM init is wrong. Re-run Steps 3–9 (firmware-only rebuild):

```bash
cd ~/church-machine
make -C hardware/soc_combined/firmware                    # Step 3
python3 scripts/patch_sapphire_init.py \                  # Step 4 — MUST NOT SKIP
  hardware/soc_combined/sapphire.v \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin
bash hardware/soc_combined/work_syn/run_efx_map.sh        # Step 6
bash hardware/soc_combined/work_pnr/run_efx_pnr.sh        # Step 7
cd hardware/soc_combined && \
  ~/efinity/2025.2/bin/efx_pgm --project-xml church_soc_cm.xml  # Step 8
cd ~/church-machine && \
  sudo ~/oss-cad-suite/bin/openFPGALoader \
    -b titanium_ti60_f225_jtag \
    -f hardware/soc_combined/outflow/church_soc_cm.hex     # Step 9
```

After a successful flash the stream panel should show:
```
← CHURCH Ti60 SoC+CM v1.1
NIA → 0x00000002
NIA → 0x00000005
...
```
(incrementing NIA addresses, no REBOOT)

Save the working hex as a good build:
```bash
cp hardware/soc_combined/outflow/church_soc_cm.hex \
   hardware/soc_combined/good-builds/church_soc_cm-$(date +%Y-%m-%d).hex
git add hardware/soc_combined/good-builds/
git commit -m "good-build: Ti60 $(date +%Y-%m-%d) — boot loop fixed"
```

---

### LED0 never lights after flash

The SoC is stuck in reset. Check that `io_asyncReset` in `top.v` is tied to
`1'b0` (not floating) and that the 50 MHz clock is reaching `CLKMUX_T ROUTE0`.

---

## Resource utilisation

The Ti60F225 has ~60 K logic elements and ~220 KB BRAM (176 EFX_RAM10 blocks).
The combined SoC+CM design uses ~180 EFX_RAM10 blocks. Check after synthesis:

```bash
python scripts/check_ti60_utilisation.py --missing-ok
```
