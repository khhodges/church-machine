---
name: top.res.csv wrong sync file
description: efx_pnr sync file is outflow/<circuit>.interface.csv, not top.res.csv; top.res.csv is the MAP resource report
---

## Rule

Pass `outflow/<circuit>.interface.csv` as `--sync_file` to `efx_pnr`, **not** `top.res.csv`.

`top.res.csv` is the MAP resource-utilisation report (starts with `sep=\t / Module Resource Usage
Distribution Estimates`). Passing it to `efx_pnr` crashes with:

```
ERROR: Unhandled exception: unknown escape sequence
```

because `efx_pnr`'s CSV parser (in `libdevicedb.so`) treats `\` as a C escape prefix and
fails on `\t`.

**Why:** Interface Designer (`efx_run --flow interface`) writes to
`outflow/<circuit>.interface.csv`, NOT to `top.res.csv`. The old comment in `run_efx_pnr.sh`
("efx_run writes top.res.csv named after Verilog top module") was wrong — confirmed on
Efinity 2026.1 by inspecting the `outflow/` directory after Interface Designer ran.

**How to apply:** `run_efx_pnr.sh` now sets:
```bash
SYNC_FILE="$SOC_DIR/outflow/${CIRCUIT}.interface.csv"
```
The file is named after the **circuit** (project XML stem), not the Verilog top module.
Interface Designer must have run at least once for this file to exist.
