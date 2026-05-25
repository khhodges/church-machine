---
name: EFX_MAP $readmemb and system_ramA on Ti60
description: Definitive confirmed findings — how to embed Sapphire SoC firmware into a Ti60F225 bitstream using Efinity 2025.2. Covers $readmemb, optimize-zero-init-rom, the inline-initial-block approach, efx_pgm syntax, and uart_putc pitfalls.
---

## Confirmed working flow (May 2026, Efinity 2025.2, Ti60F225)

```
make -C hardware/soc_combined/firmware
python3 scripts/patch_sapphire_init.py sapphire.v symbol{0..3}.bin
bash work_syn/run_efx_map.sh
bash work_pnr/run_efx_pnr.sh
~/efinity/2025.2/bin/efx_pgm --project-xml church_soc_cm.xml   ← generates the hex
sudo ~/oss-cad-suite/bin/openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc_cm.hex
```

## $readmemb is completely ignored by EFX_MAP on Titanium

EFX_MAP treats `$readmemb` as simulation-only regardless of where .bin files
are placed. This is a fundamental limitation of Titanium EFX_MAP, not a path
issue. Copying symbol files to `work_syn/` does NOT help.

**Why:** Titanium uses EFX_RAM10 (READ_WIDTH=1) primitives. EFX_MAP ignores
$readmemb entirely when mapping to EFX_RAM10.

## optimize-zero-init-rom=1 eliminates system_ramA

With $readmemb ignored, system_ramA appears zero-initialised. With
`optimize-zero-init-rom=1` (the default), EFX_MAP eliminates the entire BRAM.
Result: 0 EFX_RAM10 instances in map.v; CPU fetches 0x00000000 and hangs.

**Fix:** Set `optimize-zero-init-rom` to `"0"` in `church_soc_cm.xml`.

## Inline initial block: the correct solution

Replace $readmemb with explicit `mem[i] = 8'hXX;` assignments in sapphire.v
(via `scripts/patch_sapphire_init.py`) AND set `optimize-zero-init-rom=0`:

- system_ramA appears as **64 EFX_RAM10 instances** in map.v ✓
- **EFX_MAP DOES propagate initial block values to INIT_ parameters** ✓
- All four byte-lane instances (ram_symbol0–3 __D$g1) show non-zero INIT_0 ✓
- Firmware IS in the bitstream after synthesis + efx_pgm ✓

**Previous note saying "INIT_ values stay zero" was WRONG.** It was based on
an earlier test run before the correct synthesis parameters were in place.
No `patch_mapv_init.py` step is needed.

## patch_sapphire_init.py must handle both virgin and re-patch cases

After the first run, sapphire.v no longer has `$readmemb` — it has inline
assignments. The script must match EITHER pattern. Updated script (as of May
2026) handles both: tries `$readmemb` regex first, then tries the inline
`ram_symbolN[i] = 8'hXX;` pattern (any leading whitespace).

**Run from repo root with full paths.** Running from `hardware/soc_combined/`
with relative paths like `hardware/soc_combined/sapphire.v` causes file-not-found.

## efx_pgm: the correct bitstream generation command

**P&R does NOT generate the hex.** efx_pgm is a separate step.

```bash
cd hardware/soc_combined
~/efinity/2025.2/bin/efx_pgm --project-xml church_soc_cm.xml
```

- Flag is `--project-xml`, NOT `--project` (that gives "unrecognised option")
- There is no `work_pgm/run_efx_pgm.sh` in this project
- efx_pgm reads church_soc_cm.xml which contains all device/family settings
- Generates `outflow/church_soc_cm.hex` AND `outflow/church_soc_cm.bit`
- Timestamps on .hex/.bit: must be newer than the P&R run to confirm freshness

## EFX_RAM10 instance naming (READ_WIDTH=1)

64 instances total for system_ramA = 32 bit planes × 2 read ports.
- `ram_symbolN__D$g1` → handles one specific bit of byte lane N, port 1
- `ram_symbolN__D$2`  → same bit, port 2 (dual-port, same INIT_ values)
- Bit addressed by each instance is visible in the verific .RDATA comment:
  `system_ramA_logic_io_bus_rsp_payload_fragment_data [31]` = bit 31, etc.
- INIT_0[k] = bit-plane value at word address k, for k = 0..255
- Non-zero INIT_0 confirmed for all four lanes (symbol0–3)

## uart_putc: unconditional write + delay

The Sapphire UART STATUS bit layout (TX-available in bits[23:16] vs bit 0)
varies between Sapphire IP configurations. Polling the wrong bit causes an
infinite spin and silent UART TX.

**Fix:** Skip STATUS polling entirely. Write UART_DATA unconditionally and
wait 3000 NOPs (~120 µs @ 25 MHz) between characters. This is ~38% margin
over the 115200-baud character time (86.8 µs). The UART FIFO never overflows.

## Other confirmed facts

- UART base: 0xF8010000 (from BSP soc.h). DATA=+0x00, STATUS=+0x04, CLOCKDIV=+0x08
- CLOCKDIV=26 → 25 MHz / (8×27) = 115,741 baud ≈ 115200 ✓
- ttyUSB2 = Sapphire SoC UART (GPIOL_02), ttyUSB3 = CM debug UART (GPIOL_P_03)
- ttyUSB3 emits 2 null bytes (0x00 0x00) on port-open — this is an FTDI glitch, not CM output
- ttyUSB2 produces 0 bytes at any baud when uart_putc spins (confirmed)
- flash command: `sudo ~/oss-cad-suite/bin/openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc_cm.hex`
