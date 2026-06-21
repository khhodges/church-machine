---
name: Efinity version — standardised on 2026.1 for all stages
description: Both efx_map (synthesis) and efx_pnr/efx_run (P&R + pgm) now use Efinity 2026.1. The 2025.2-for-map split is retired.
---

# Resolved — 2026.1 for everything

`scripts/build_ti60_bitstream.sh` defaults to `~/efinity/2026.1` for both
`EFINITY_MAP` (synthesis) and `EFINITY` (P&R + pgm).

No `EFINITY_MAP_HOME` override is needed. Just run:
```bash
bash scripts/build_ti60_bitstream.sh
```

**Why the split was retired:** The Chromebook's `church_soc_cm.xml` was
upgraded to 2026.1 schema by the Efinity GUI. efx_map 2025.2 then crashed
with "The file format is unexpected" before printing any synthesis output.
Using efx_map 2026.1 parses the 2026.1 schema correctly. There is no longer
any reason to keep 2025.2.

**How to apply:** If synthesis crashes with a bare STACK TRACE and no error
text, check `~/church_project/SoC/work_syn/synthesis.log` for the real error
(the build pipeline pipes through `tail -8` which hides it).

# Still-valid non-version facts
- Build dir on Penguin: `~/church_project/SoC/` (Efinity project lives here)
- `efx_pnr` needs explicit `--family Titanium --device Ti60F225 --operating_conditions C3` or it SIGSEGVs.
- 2026.1 headless needs the 5 one-time PT patches (BUILD_SOC_CM.md) or the Interface Designer refuses to emit the LPF.
- `efx_pgm` flow: `efx_run <proj> --prj --flow interface` (makes LPF from peri.xml) THEN `--flow pgm`.
- After synthesis, verify BRAM is non-zero: grep INIT_0 in outflow/church_soc_cm.map.v — all 4 lanes must be non-zero hex.
