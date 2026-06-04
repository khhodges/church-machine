---
name: EFX_MAP $readmemb and system_ramA on Ti60
description: Definitive confirmed findings — how to embed Sapphire SoC firmware into a Ti60F225 bitstream using Efinity 2026.1. Covers $readmemb, optimize-zero-init-rom, the inline-initial-block approach, efx_pgm syntax, and uart_putc pitfalls.
---

## CRITICAL: Must use Efinity 2026.1, NOT 2025.2

The project XML has `sw_version="2026.1.132"`. Efinity 2025.2's efx_map silently
skips BRAM initial-block extraction — NO "extracting RAM for identifier 'ram_symbol0'"
log line appears, and the BRAM ends up with zero content. CPU never executes.

Efinity 2026.1 correctly extracts the initial block values:
```
INFO: /...sapphire.v(4868): extracting RAM for identifier 'ram_symbol0' [VERI-2571]
```

**Always source 2026.1:**
```bash
source ~/efinity/2026.1/bin/setup.sh
# NOT: source ~/efinity/2025.2/bin/setup.sh
```

Both 2025.2 and 2026.1 are installed on Penguin at ~/efinity/. Only 2026.1 works
for BRAM init. The ldd warning about libstdc++ is harmless — ignore it.

## Confirmed working flow (June 2026, Efinity 2026.1, Ti60F225)

```bash
# From ~/church_project/SoC/
cd firmware && touch main.c && make && cd ..
python3 scripts/patch_sapphire_init.py sapphire.v \
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol{0..3}.bin
source ~/efinity/2025.2/bin/setup.sh
efx_map --prj church_soc_cm.xml            # ~10 min; output: top.vdb
cp top.vdb work_pnr/church_soc_cm.vdb
/home/sipantichijk/efinity/2025.2/bin/efx_pnr --prj church_soc_cm.xml   # ~10 min
/home/sipantichijk/efinity/2025.2/bin/efx_pgm --prj church_soc_cm.xml   # generates hex
sudo /usr/bin/openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc_cm.hex
```

Key path facts:
- `work_syn/run_efx_map.sh` and `work_pnr/run_efx_pnr.sh` do NOT exist — use commands above
- `~/oss-cad-suite` does NOT exist — use `/usr/bin/openFPGALoader`
- efx_pgm flag is `--prj` (not `--project-xml`) when running from project directory
- efx_map outputs `top.vdb` to CWD (not `work_syn/`); must `cp top.vdb work_pnr/` before PnR
- `source ~/efinity/2025.2/bin/setup.sh` sets EFINITY_HOME (required for efx_pnr/efx_pgm)

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

## patch_sapphire_init.py: absolute-path $readmemb bug (fixed June 2026)

The $readmemb pattern originally matched only the bare filename
(`EfxSapphireSoc...bin`) but sapphire.v on Penguin has an **absolute path**
(`/home/sipantichijk/.../EfxSapphireSoc...bin`). Regex failed → fell through
to Case 2 (inline) → updated *other* initial blocks (not system_ramA) while
reporting "0 block(s), NNN assignments". Firmware was never embedded.

**Fix (applied June 2026):** Case 1 regex now uses `[^"]*` prefix:
```python
r'\$readmemb\("[^"]*' + re.escape(fname) + r'",'
```
Check for success: output should say "Replaced $readmemb symbol0 → NNN assignments"
(not "Updated inline … was already-patched"). Verify with `grep -c readmemb sapphire.v`
→ must be 0 after patch.

**Run from ~/church_project/SoC/ with symbol bin files in the same dir.**

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

## uart_putc: TWO requirements — both must be satisfied

### 1. No STATUS polling
STATUS TX-ready bit position varies between Efinix IP configs (bit 0 vs
bits[23:16]). Polling wrong bit = infinite spin = silent UART. Skip STATUS.

### 2. Bit 8 of UART_DATA is SpinalHDL write-valid flag — MUST be set
Writing just `UART_DATA = c` (bits[7:0] only) is silently ignored — no TX,
no error, identical symptom to the STATUS-poll hang (`b''` for 8+ seconds).
**Always write `UART_DATA = (1u << 8) | (uint32_t)(unsigned char)c;`**

**Correct uart_putc (confirmed working pattern):**
```c
static void uart_putc(char c) {
    UART_DATA = (1u << 8) | (uint32_t)(unsigned char)c;
    for (volatile uint32_t i = 0; i < 3000u; i++) __asm__("nop");
}
```
3000 NOPs ≈ 120 µs @ 25 MHz = 1.38× margin over 86.8 µs char time.

## Other confirmed facts

- UART base: 0xF8010000 (from BSP soc.h). DATA=+0x00, STATUS=+0x04, CLOCKDIV=+0x08
- CLOCKDIV=26 → 25 MHz / (8×27) = 115,741 baud ≈ 115200 ✓
- UART port: Ti60F225 devkit uses FT4232H (4-channel USB bridge), NOT FT2232H.
  ttyUSB2 = Sapphire SoC UART (GPIOL_02, 3.3V LVCMOS, confirmed in peri.xml).
  ttyUSB3 = CM debug UART (GPIOL_P_03). ttyUSB0/1 = JTAG channels A/B.
  Port numbers may shift if other USB devices are connected before the board.
  `ls -lt /dev/ttyUSB*` after flash — the SoC UART is the 3rd-lowest ttyUSB.
- flash command: `sudo /usr/bin/openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc_cm.hex`
  (`~/oss-cad-suite/bin/openFPGALoader` does NOT exist on Penguin)
