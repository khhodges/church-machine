---
name: Efinix efx_pnr VDB flow (2026.1)
description: How top.vdb and the VDB flag work in the 2026.1 PNR flow; confirmed working invocation
---

# Efinix 2026.1 efx_pnr VDB flow

## How it works
- `efx_map --project-xml <xml>` writes `top.vdb` to the CWD (the SoC project directory), NOT to work_syn/
- `efx_pnr` reads `top.vdb` as input VDB for packing; it does NOT create the VDB during packing
- Without `--vdb_file`, efx_pnr looks for `<work_dir>/<circuit>.vdb` (e.g. `work_pnr/church_soc_cm.vdb`) which doesn't exist
- Passing `--vdb_file top.vdb` (relative to SoC CWD) tells efx_pnr where the synthesis VDB is
- After packing, place+route results go to `--output_dir outflow/`

## Confirmed working invocation (2026.1.132 on Chromebook Penguin / Debian)
```bash
export EFINITY_HOME=~/efinity/2026.1
source $EFINITY_HOME/bin/setup.sh 2>/dev/null || true
cd ~/church_project/SoC

$EFINITY_HOME/bin/efx_pnr \
    --prj    church_soc_cm.xml \
    --circuit church_soc_cm \
    --family  Titanium \
    --device  Ti60F225 \
    --operating_conditions C3 \
    --pack --place --route \
    --vdb_file   top.vdb \
    --work_dir   work_pnr \
    --output_dir outflow \
    2>&1 | tee work_pnr/pnr.log
```

## Key gotchas
- `EFINITY_HOME` must be `export`ed before calling efx_pnr (not just set as local var)
- `--operating_conditions` must be `C3` for Ti60F225 (not C4) — C4 causes SIGSEGV in libdevicedb.so
- `--use_vdb_file on` crashes if VDB doesn't pre-exist; omit this flag entirely
- `--vdb_file` takes the SYNTHESIS OUTPUT VDB path (`top.vdb` in SoC CWD), not a pre-existing PNR VDB
- top.vdb is consumed/moved by PNR; re-synthesis needed if running PNR again from scratch
- Without SDC, timing analysis uses 1ns constraint (shows -5ns slack) — harmless for 25 MHz design
- Bitstream (.lbf) written to work_pnr/; convert to .hex with efx_pgm

**Why:** Efinix 2026.1 changed VDB semantics vs 2025.2; these lessons were learned through >10 crash/fix cycles on a live Chromebook Penguin system.
