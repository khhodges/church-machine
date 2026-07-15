---
name: EFX_MAP $readmemb path resolution + VDB caching trap
description: MAP resolves $readmemb relative to $SOC_DIR/ (not work_syn/); 2026.1 MAP does NOT inline $readmemb data into INIT_0 in map.v — PNR resolves symbol bins at P&R time.
---

## Root cause D: PNR run against stale VDB when OBBS crashes mid-flight

**Confirmed 2026-07-15:** The OBBS deletes the VDB before MAP, then MAP writes a
fresh VDB.  But if the OBBS crashes (syntax error, port error, etc.) BETWEEN the
symbol-bin copy (Step 2) and MAP (Step 3), the next OBBS run may:

1. Bump the build letter and regenerate symbol bins (Step 1+2) ✓
2. Crash **before** the VDB deletion (Step 3) — leaving the OLD VDB intact
3. A subsequent manual PNR run uses the OLD VDB → board shows the OLD build letter

**Symptom:** build_seq.h shows letter `X`, board shows letter `X-N` (many
letters behind) because multiple OBBS runs bumped the letter but MAP only
ran once (writing a VDB with the letter from that single successful run).

**VDB timestamp guard (must run before every PNR):**
```bash
ls -lt $SOC_DIR/outflow/church_soc_cm.vdb \
       $SOC_DIR/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin
```
The VDB **must be newer** than the symbol bins.  If the VDB is older, MAP used
a cached database and the bitstream will have stale firmware.

**Fix:** delete ALL VDB files before MAP, then verify timestamp ordering
after MAP completes and before PNR starts.

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

## Root cause C: Efinity 2026.1 MAP does NOT inline $readmemb data into INIT_0

**Confirmed 2026-07-15: post-synthesis map.v INIT_0 for all 4 symbol lanes =
FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF (64 F's),
even though firmware.bin byte 0 = 0x17 (AUIPC) and symbol bins were correct.**

Efinity 2026.1 MAP keeps the `$readmemb` call as a **bare reference** in
map.v — it does NOT evaluate the call and inline the data into the EFX_RAM10
INIT_0 parameters.  The INIT_0 hex value in map.v is a placeholder (all-FF).

**PNR** resolves the `$readmemb` filenames at P&R time, reading from:
- `work_pnr/` (primary)
- `$SOC_DIR/` (project root, fallback)
- `outflow/` (fallback)

The OBBS Step 3b explicitly copies symbol bins to all three locations so PNR
always finds them.

**Consequence for the post-synthesis BRAM guard:**  
The `check_bram_init_zero.sh` content spot-check (RC=3) will ALWAYS report a
mismatch in the 2026.1 $readmemb flow because INIT_0 is all-FF in map.v.
RC=3 is now treated as a **warning** (not a failure) in build_ti60_bitstream.sh.
RC=1 (all INIT_0 lanes are all-zero, indicating genuinely missing firmware) is
still a hard failure.

**What not to do:** do NOT try to read the bitstream or PNR output to verify
INIT_0 — just let PNR run and flash; the board boot output is the ground truth.

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
| Post-synthesis INIT_0 content check in map.v (Efinity 2026.1) | ❌ Always all-FF placeholder; use RC=1 only |

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
