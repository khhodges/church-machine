---
name: EFX_MAP $readmemb path resolution + VDB caching trap
description: Efinity MAP caches a VDB and skips re-synthesis when only .bin files changed; must delete VDB before every build.
---

## Root cause: MAP VDB caching silently reuses stale firmware

EFX_MAP decides whether to re-synthesise by comparing Verilog source mtimes
against the existing VDB.  The Sapphire ROM firmware lives in four .bin files
(symbol0..3) referenced via `$readmemb` in sapphire.v.

`patch_sapphire_init.py` is **idempotent** after the first patch — sapphire.v's
own mtime never changes again once the `$readmemb` block is inserted (by design;
see `check_sapphire_patch_fresh.sh` header).

Result: MAP sees "Verilog unchanged → VDB is fresh" and exits in **seconds**,
baking the OLD firmware bytes into every subsequent bitstream.  Every source
change to main.c is silently invisible on the board.

**Symptom:** MAP says "PASS" almost instantly (should take ~45 min).  Board
outputs the same character regardless of firmware changes.

**Fix (in build_ti60_bitstream.sh Step 3):** delete all candidate VDB files
before running MAP:
```
rm -f "$SOC_DIR/outflow/church_soc_cm.vdb"
rm -f "$SOC_DIR/work_syn/church_soc_cm.vdb"
rm -f "$SOC_DIR/outflow/top.vdb"
rm -f "$SOC_DIR/work_syn/top.vdb"
```
This forces a full re-synthesis (~45 min) on every build and ensures the .bin
files are always re-read.

## How $readmemb is resolved (confirmed)

EFX_MAP does NOT inline `$readmemb` data into INIT_0 in map.v — it keeps the
bare `$readmemb("filename.bin", array)` reference.  The resolved content lives
in the VDB.  EFX_PNR reads BRAM init from the VDB; it does NOT re-resolve the
`$readmemb` at P&R time.

Symbol bins must be in `work_syn/` (MAP's `--work_dir`) when MAP runs.
The build script also copies them to `work_pnr/`, `SOC_DIR/`, and `outflow/`
as a belt-and-suspenders measure (Step 3b), but the critical path is:
fresh bins → `work_syn/` → MAP reads them → VDB → PNR → bitstream.

## What does NOT work

| Approach | Result |
|---|---|
| `initial begin` inline on inferred arrays | ❌ EFX_MAP silently ignores |
| `$readmemb` with fresh bins but stale VDB | ❌ MAP skips re-synthesis, VDB has old firmware |
| Patching INIT_0 in map.v after synthesis | ❌ PNR reads BRAM from VDB not patched map.v |

## CM DMEM — no caching issue

CM DMEM uses `gen_cm_dmem_direct.py` with explicit EFX_RAM10 + inline INIT_0
parameters written directly into church_ti60_f225.v.  That .v file IS compared
by MAP's mtime check → changing DMEM content changes church_ti60_f225.v mtime
→ MAP re-synthesises correctly.  No VDB deletion needed for CM DMEM changes.

The Sapphire ROM is different because patching sapphire.v is idempotent after
the first patch — only the referenced .bin files change, and MAP ignores them.

## Other confirmed facts

- UART port: ttyUSB2 = Sapphire SoC UART (baud 57600, CLOCKDIV=53)
- Bridge: `python3 hardware/soc_combined/callhome_bridge.py --port=/dev/ttyUSB2 --insecure`
- Device UID: c0ffee0100000001, board_type=3 (Ti60-Full)
- Chromebook synthesis: 4+ GB RAM required; use DigitalOcean 8 GB droplet ($0.08/hr)
