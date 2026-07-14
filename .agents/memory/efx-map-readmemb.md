---
name: EFX_MAP $readmemb path resolution + VDB caching trap
description: MAP resolves $readmemb relative to the SOURCE FILE directory ($SOC_DIR/), NOT --work_dir; must deploy bins to $SOC_DIR/ BEFORE MAP runs, and delete VDB before every build.
---

## Root cause A: MAP VDB caching silently reuses stale firmware

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

## Root cause B: $readmemb resolves from SOURCE FILE directory, NOT --work_dir

**Confirmed 2026-07-14 by flashing 9 builds that all ran old firmware despite
correct new-firmware symbol bins in work_syn/.**

EFX_MAP resolves `$readmemb("symbol0.bin", ram_symbol0)` relative to the
**directory containing sapphire.v** — which is `$SOC_DIR/` (the Efinity project
root) — NOT relative to `--work_dir work_syn`.

Deploying symbol bins only to `work_syn/` therefore has no effect on what MAP
embeds.  The bins in `$SOC_DIR/` (left over from an older build) are silently
used instead.

**Fix (applied to build_ti60_bitstream.sh Step 2):**
Deploy symbol bins to **`$SOC_DIR/` in Step 2** (before MAP), in addition to
the existing work_syn/ copy which is kept for the freshness self-test:
```bash
cp "$HW"/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol*.bin "$SOC_DIR/work_syn/"
cp "$HW"/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol*.bin "$SOC_DIR/"   # ← THE KEY LINE
```
The freshness guard in run_efx_map.sh now checks BOTH locations.

**How to apply:** every time build_ti60_bitstream.sh Step 2 runs (firmware
compiled or symbol bins regenerated), bins must go to $SOC_DIR/ before the MAP
step (Step 3). The Step 3b deploy to $SOC_DIR/ is now redundant for MAP but
still needed for PNR as belt-and-suspenders.

## How $readmemb resolution was confirmed

INIT_0 values in map.v were non-zero (old firmware was already there from a
previous build's $SOC_DIR/ bins). Non-zero INIT_0 guard always passed, masking
the stale-bins bug. Only confirmed after finding KHURCH in firmware.bin but
board still outputting 'C' despite 8+ full rebuilds.

## What does NOT work

| Approach | Result |
|---|---|
| `initial begin` inline on inferred arrays | ❌ EFX_MAP silently ignores |
| `$readmemb` with fresh bins only in work_syn/ | ❌ MAP reads from $SOC_DIR/, ignores work_syn/ |
| `$readmemb` with fresh bins only in work_syn/ but stale VDB deleted | ❌ MAP re-synthesises but still reads $SOC_DIR/ |
| Patching INIT_0 in map.v after synthesis | ❌ PNR reads BRAM from VDB not patched map.v |

## CM DMEM — no caching issue

CM DMEM uses `gen_cm_dmem_direct.py` with explicit EFX_RAM10 + inline INIT_0
parameters written directly into church_ti60_f225.v.  That .v file IS compared
by MAP's mtime check → changing DMEM content changes church_ti60_f225.v mtime
→ MAP re-synthesises correctly.  No VDB deletion needed for CM DMEM changes.

The Sapphire ROM is different because patching sapphire.v is idempotent after
the first patch — only the referenced .bin files change, and MAP ignores them
(reads from $SOC_DIR/ which had stale bins).

## Other confirmed facts

- UART port: ttyUSB2 = Sapphire SoC UART (baud 57600, CLOCKDIV=53)
- Bridge: `python3 hardware/soc_combined/callhome_bridge.py --port=/dev/ttyUSB2 --insecure`
- Device UID: c0ffee0100000001, board_type=3 (Ti60-Full)
- Chromebook synthesis: 4+ GB RAM required; use DigitalOcean 8 GB droplet ($0.08/hr)
