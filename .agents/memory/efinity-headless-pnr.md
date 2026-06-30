---
name: Efinity headless PnR flow (Ti60 on DigitalOcean droplet)
description: Correct sequence and quirks for running efx_map + efx_pnr on a headless Linux server without PyQt6 or a GUI.
---

## Rule
Never use `efx_run.py` on a headless server — it requires PyQt6 and fails with `ModuleNotFoundError`. Use `efx_map --project-xml` for synthesis and `efx_pnr` directly for PnR.

**Why:** `efx_run.py` is the Efinity GUI orchestrator; it imports PyQt6 at startup unconditionally. No GUI = no PyQt6 = crash before it does any work.

## Correct sequence (headless)

1. **Synthesis** — `efx_map --project-xml <proj>.xml`
   - Do NOT pass `--work_dir` or `--output_dir` — those flags use hyphens and the underscore form causes efx_map to print help and exit 0
   - The XML already specifies `work_dir` and `write_efx_verilog`; pass `--project-xml` only
   - Writes VDB to `<SOC_DIR>/top.vdb` (named after Verilog `module top`, NOT `outflow/<circuit>.vdb`)
   - Also writes `top.res.csv` — **this is a resource utilization report, NOT an IO sync file**

2. **Interface Designer / sync file** — runs headlessly via `efx_run --flow interface`
   - With `EFINITY_USER_DIR_INI` set, `efx_run` (not efx_run.py) runs Interface Designer even without a GUI
   - It exits non-zero but still writes `outflow/<circuit>.interface.csv` — swallow the exit code
   - `top.res.csv` (in project root, produced by efx_map) is a resource report; DO NOT pass as `--sync_file` — crashes efx_pnr with "unknown escape sequence" on `sep=\t`
   - Correct sync file: `outflow/<circuit>.interface.csv` (named after circuit, not Verilog top module)

3. **Place & Route** — use `--sync_file outflow/<circuit>.interface.csv`:
   ```
   efx_pnr --prj <proj>.xml --circuit <circuit> \
     --family Titanium --device Ti60F225 --operating_conditions C3 \
     --pack --place --route \
     --vdb_file top.vdb \
     --sync_file outflow/<circuit>.interface.csv \
     --work_dir work_pnr --output_dir outflow
   ```
   - `--vdb_file top.vdb` (project root, not outflow/)
   - EFINITY_HOME must be exported before calling efx_pnr

## Required env vars (set before any step)
```bash
export EFINITY_HOME=$HOME/efinity/2026.1
export EFINITY_USER_DIR_INI=$HOME/.efinity   # prevents KeyError in efx_run
export EFXPT_HOME=$EFINITY_HOME              # prevents KeyError in efx_run
export PATH=$EFINITY_HOME/bin:$PATH
export LD_LIBRARY_PATH=$EFINITY_HOME/lib:${LD_LIBRARY_PATH:-}
mkdir -p $EFINITY_USER_DIR_INI
```

## upper_mem / BRAM sizing trap
The gen_cm_dmem_direct.py script previously declared `reg [31:0] upper_mem [2048:16383]` for
addresses above the EFX_RAM10 range. Efinity synthesises this as 458K flip-flops (not BRAM),
causing 468K clock loads and making the design 16× too large for Ti60. The fix is to return
`32'h0` for addresses ≥ 2048 rather than declaring a large reg array. Fixed in HEAD.

## Timing (4-vCPU / 8 GB DigitalOcean droplet, Ti60 SoC+CM design — 66K-line Verilog)
- Synthesis (`efx_map`): ~45 min (10K clock loads after upper_mem fix)
- PnR (`efx_pnr`): expect 30–90 min with 4 threads
- libstdc++ version warning (system v34 > bundled v32) is harmless

## Always run inside tmux
SSH connections drop if Chromebook sleeps. Always: `tmux new-session -d -s build "..."` before starting any multi-hour step.
