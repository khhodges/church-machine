---
name: EFX_MAP $readmemb path resolution
description: Where Efinity EFX_MAP and EFX_PNR look for $readmemb binary files; confirmed working approach for Sapphire SoC BRAM init.
---

## Confirmed working approach (as of Jul 2026 debugging)

EFX_MAP does **NOT** inline `$readmemb` data into INIT_0 values in map.v.
It keeps the bare `$readmemb("filename.bin", array)` directive intact in the
synthesised Verilog. EFX_PNR then resolves those bare filenames at P&R time
from its own working directory.

**Consequence:** the `.bin` symbol files must be present in **all three**
directories that PNR searches:
1. `$SOC_DIR/work_syn/`  — EFX_MAP reads them during elaboration
2. `$SOC_DIR/work_pnr/`  — EFX_PNR's primary working dir
3. `$SOC_DIR/`           — project root fallback
4. `$SOC_DIR/outflow/`   — secondary fallback some versions use

`build_ti60_bitstream.sh` Step 3b now copies to all four locations before PNR.

**Root-cause history:** symbol files were only deployed to `work_syn/`.
MAP ran successfully ("map: PASS"), the $readmemb appeared in map.v, but
PNR resolved the bare filename from `work_pnr/` (empty) → silently used
stale/old firmware in the ROM BRAM → board always output 'C' from old
firmware despite many source changes; KHURCH/ALLHOME/Z-probe all invisible.

## What does NOT work

| Approach | Result |
|---|---|
| `initial begin` inline on inferred arrays | ❌ EFX_MAP silently ignores |
| `$readmemb` files only in `work_syn/` | ❌ MAP reads them; PNR can't find them → old ROM |
| Patching INIT_0 values in map.v after synthesis | ❌ PNR reads BRAM init from $readmemb in map.v, not patched INIT_0 |

## Sapphire SoC ROM symbol files

- `scripts/patch_sapphire_init.py` patches sapphire.v with $readmemb calls
- Firmware `Makefile` writes four lane .bin files to `hardware/soc_combined/`
  (symbol0..3, 131072-word × 8-bit binary strings, little-endian byte lanes)
- `build_ti60_bitstream.sh` deploys them to work_syn/, work_pnr/, SOC_DIR/,
  and outflow/ after firmware compile (Steps 2 and 3b)
- BRAM INIT_0 guard in map.v shows dataCache INIT_0=0 (correct) and
  `$readmemb(...)` for ROM (no INIT_0 — this is normal for $readmemb path)

## CM DMEM — different mechanism

CM DMEM now uses `gen_cm_dmem_direct.py` with explicit EFX_RAM10 + inline
INIT_0 parameters. No $readmemb, no work_syn/ bin files needed. This IS
inlined by MAP into INIT_0 and stored in the VDB correctly. The $readmemb
issue only affects the Sapphire ROM.

## Other confirmed facts

- UART port: ttyUSB2 = Sapphire SoC UART (baud 57600, CLOCKDIV=53)
- Bridge: `python3 hardware/soc_combined/callhome_bridge.py --port=/dev/ttyUSB2 --insecure`
- Device UID: c0ffee0100000001, board_type=3 (Ti60-Full)
- UART CLOCKDIV=53 must be written before first uart_puts
- openFPGALoader flash ID `097f0000` failure: use Efinity Programmer GUI "JTAG to SPI Active Flash" mode
- Chromebook synthesis: 4+ GB RAM required; use DigitalOcean 8 GB droplet ($0.08/hr)
