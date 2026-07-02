---
name: EFX_MAP $readmemb path resolution
description: Where Efinity EFX_MAP looks for $readmemb binary files, confirmed working approach for Sapphire SoC BRAM and CM DMEM BRAM.
---

## Confirmed working approach: $readmemb with files in work_syn/

Both the CM DMEM and the Sapphire SoC ROM use the SAME mechanism:

1. Patch the Verilog source to use `$readmemb("bare_filename.bin", array_var);`
2. Write the `.bin` files into `work_syn/` — EFX_MAP resolves bare filenames
   relative to `--work_dir` (work_syn/), NOT the project root.
3. Run `efx_run.py --flow map --work_dir work_syn` — EFX_MAP reads the .bin
   files during elaboration and propagates INIT values into the VDB/bitstream.

**Sapphire SoC ROM** (ram_symbol0..3, 8192×8-bit per lane):
- `scripts/patch_sapphire_init.py` patches sapphire.v with $readmemb calls
  (patches the repo copy only — it does NOT copy any .bin files anywhere)
- The firmware Makefile writes the four lane .bin files directly into
  `hardware/soc_combined/` (repo) on every `make`
- `scripts/build_ti60_bitstream.sh` is the ONLY place that copies those bins
  into `$SOC_DIR/work_syn/` (right after patching sapphire.v), and
  `scripts/check_sapphire_symbol_bins_fresh.sh` guards that the copy is
  byte-identical before MAP runs. `run_efx_map.sh` re-checks this same guard
  in its Step 0a (read-only) before invoking `efx_run.py`.
- Gotcha (real regression caught by architect review, not hypothetical):
  consolidating "single build location" work can easily delete the step that
  populates `work_syn/` without anyone noticing, because sapphire.v itself
  looks correctly patched and every other freshness guard (sha-sync on
  firmware/, banner-vs-defines, sapphire.v mtime) inspects a *different*
  artifact — none of them look inside `work_syn/`. Any future refactor of the
  Ti60 build pipeline MUST keep (or re-add) an explicit bins-into-work_syn/
  deploy step plus the check_sapphire_symbol_bins_fresh.sh guard.

**CM DMEM** — SUPERSEDED: this file originally documented `patch_cm_bram.py`
converting the 32-bit dmem array to four byte-lane $readmemb declarations.
That technique is now confirmed obsolete/unused (see
`obbs-single-patch-location.md`). CM DMEM init now uses
`gen_cm_dmem_direct.py`'s explicit `cm_dmem_bram` EFX_RAM10 instantiation —
no $readmemb, no work_syn/ bin files, run entirely as source-level Verilog
patching before EFX_MAP ever starts.

## What does NOT work (all confirmed failing)

| Approach | Result |
|---|---|
| `initial begin` inline assignments on inferred arrays | ❌ EFX_MAP silently ignores for inferred BRAMs |
| `$readmemb` with files in soc_combined/ (project root) | ❌ Not found — EFX_MAP CWD is work_syn/ |
| patching map.v (outflow/*.map.v) after synthesis | ❌ PNR reads BRAM init from VDB not map.v |

**Why**: EFX_MAP's internal CWD when called via `efx_run.py --work_dir work_syn` is
`work_syn/`, not the project root. Bare filenames in `$readmemb` resolve relative to
that internal CWD.

## Note on patch_cm_bram.py's misleading comment

Lines 113-116 say "relative to project root … Write bin files to project root" but
`bin_dir = project_dir` is NEVER USED. The actual write goes to `work_syn_dir` (via
`write_bin_files(vals, depth, work_syn_dir)`). The comment is wrong; files go to work_syn/.

## Other confirmed facts

- UART port: ttyUSB2 = Sapphire SoC UART (baud 57600, CLOCKDIV=53)
- Bridge: `python3 hardware/soc_combined/callhome_bridge.py --port=/dev/ttyUSB2 --insecure`
- Device UID: c0ffee0100000001, board_type=3 (Ti60-Full)
- UART CLOCKDIV=53 must be written before first uart_puts
- Project XML (church_soc_cm.xml) uses relative paths — run scripts from hardware/soc_combined/
- openFPGALoader flash ID `097f0000` failure: use Efinity Programmer GUI "JTAG to SPI Active Flash" mode
- Chromebook synthesis: 4+ GB RAM required; use DigitalOcean 8 GB droplet ($0.08/hr)
