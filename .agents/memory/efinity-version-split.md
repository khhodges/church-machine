---
name: Efinity version split for SoC build — CORRECTED
description: Use 2026.1 for ALL three tools (efx_map, efx_pnr, efx_pgm). MUST source setup.sh first or efx_map segfaults.
---

# Efinity Version — Ti60 SoC+CM Build

## The Rule: 2026.1 for ALL THREE tools

| Step | Command | Version |
|---|---|---|
| Synthesis | `efx_map --prj church_soc_cm.xml` | **2026.1** |
| Place & Route | `efx_pnr --prj church_soc_cm.xml ...` | **2026.1** |
| Bitstream | `efx_pgm --project-xml church_soc_cm.xml` | **2026.1** |
| Flash | `sudo /usr/bin/openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc_cm.hex` | n/a |

**Why 2026.1 for efx_map:**
2025.2 efx_map silently zero-initialises BRAM — firmware is never embedded. The SoC boots
with blank firmware and never executes. efx-map-readmemb.md has the full detail.

**CRITICAL: source setup.sh FIRST or efx_map segfaults immediately (SIGSEGV on nil)**
```bash
source ~/efinity/2026.1/bin/setup.sh
export EFINITY_HOME=~/efinity/2026.1
```
Without this, both 2025.2 and 2026.1 efx_map crash before reading any files.

## Full Build Sequence (from ~/church_project/SoC/)

```bash
cd ~/church_project/SoC
make -C firmware

python3 scripts/patch_sapphire_init.py sapphire.v \
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin \
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin \
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin \
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin
# Verify: grep -c readmemb sapphire.v  → must be 0

source ~/efinity/2026.1/bin/setup.sh
export EFINITY_HOME=~/efinity/2026.1

efx_map --prj church_soc_cm.xml          # ~10 min; look for "extracting RAM for identifier 'ram_symbol0'"
cp top.vdb work_pnr/church_soc_cm.vdb    # required before PnR

efx_pnr --prj church_soc_cm.xml \
  --circuit church_soc_cm --family Titanium --device Ti60F225 \
  --operating_conditions C3 --pack --place --route \
  --vdb_file top.vdb --work_dir work_pnr --output_dir outflow

efx_pgm --project-xml church_soc_cm.xml  # flag is --project-xml not --prj

sudo /usr/bin/openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc_cm.hex
```

## Key path facts
- `source setup.sh` puts all 2026.1 binaries in PATH — no need for full paths after that
- `efx_map` outputs `top.vdb` to CWD; must `cp top.vdb work_pnr/church_soc_cm.vdb` before PnR
- openFPGALoader is at `/usr/bin/openFPGALoader` (not oss-cad-suite)
- `optimize-zero-init-rom` must be `"0"` in church_soc_cm.xml (already set)
