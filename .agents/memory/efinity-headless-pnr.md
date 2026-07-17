---
name: Efinity headless PnR flow (Ti60 on DigitalOcean droplet)
description: Correct sequence and quirks for running efx_run.py/efx_pnr on a headless Linux server without PyQt6 or a GUI. Verified against real synthesis logs.
---

## Rule (UPDATED — the previous version of this note was wrong)
`efx_run.py --flow map` **does** work headless on Efinity 2026.1, given the
right env vars exported (see below) — it is not blocked by a missing PyQt6.
It reliably completes real synthesis (`map : PASS` in the log) and writes
`outflow/<circuit>.vdb`, not a project-root `top.vdb`.

**Do not trust `efx_run.py`'s own exit code.** On this droplet it can raise
`An exception occurred: 'EFINITY_USER_DIR_INI'` from some internal
cleanup/telemetry path *after* synthesis has already fully passed and the
VDB is already written — the identical crash-after-success quirk already
known for `efx_run --flow interface` (Interface Designer). Verify success by
checking for a freshly-written output artifact (`outflow/<circuit>.vdb`,
`outflow/<circuit>.interface.csv`), never by the tool's exit code alone.

**Why this matters beyond one script:** a hardcoded output path in one
script (e.g. `--vdb_file top.vdb` in a PnR script) that doesn't match what
the actual producing step currently writes will silently consume a stale
leftover file from a much older run instead of failing loudly. Any time a
multi-step pipeline passes a fixed filename between steps, verify it against
what the producing step *actually just wrote*, not what an old comment or an
earlier tool version once produced.

## Correct sequence (headless, verified)

1. **Synthesis** — `efx_run.py --flow map --work_dir <dir> --prj <proj>.xml`
   - Writes `outflow/<circuit>.vdb` and `outflow/<circuit>.map.v`
   - May exit non-zero due to the `EFINITY_USER_DIR_INI` quirk above even on
     full success — check for the VDB file (newer than a pre-run marker),
     don't gate on exit code
   - Requires `EFINITY_USER_DIR_INI`/`EFXPT_HOME` exported (see below) or it
     fails immediately with the same KeyError, but with no VDB produced —
     that's the real failure signal to hard-fail on

2. **Interface Designer / sync file** — runs headlessly via `efx_run --flow interface`
   - With `EFINITY_USER_DIR_INI` set, `efx_run` (not efx_run.py) runs Interface Designer even without a GUI
   - It exits non-zero but still writes `outflow/<circuit>.interface.csv` — swallow the exit code
   - Correct sync file: `outflow/<circuit>.interface.csv` (named after circuit, not Verilog top module)

3. **Place & Route** — use `--vdb_file outflow/<circuit>.vdb` (the file MAP just wrote) and `--sync_file outflow/<circuit>.interface.csv`:
   ```
   efx_pnr --prj <proj>.xml --circuit <circuit> \
     --family Titanium --device Ti60F225 --operating_conditions C3 \
     --pack --place --route \
     --vdb_file outflow/<circuit>.vdb \
     --sync_file outflow/<circuit>.interface.csv \
     --work_dir work_pnr --output_dir outflow
   ```
   - EFINITY_HOME must be exported before calling efx_pnr

## Required env vars (set before any step)
```bash
export EFINITY_HOME=$HOME/efinity/2026.1
export EFINITY_USER_DIR_INI=$HOME/.efinity_user  # prevents KeyError in efx_run/efx_run.py
export EFXPT_HOME=$EFINITY_HOME/pt               # must have /pt suffix — bare $EFINITY_HOME silently fails device check
export EFXPGM_HOME=$EFINITY_HOME/pgm             # prevents KeyError in efx_run_pgm.py (PGM step)
export PYTHONPATH="$EFINITY_HOME/pt/bin:${PYTHONPATH:-}"  # lets efx_run_pt_unified import device.service
export PATH=$EFINITY_HOME/bin:$PATH
export LD_LIBRARY_PATH=$EFINITY_HOME/lib:${LD_LIBRARY_PATH:-}
mkdir -p $EFINITY_USER_DIR_INI
```

**This export is per-script, not inherited.** Whenever a new script invokes
any `efx_*`/`efx_run(.py)` binary for the first time, grep sibling scripts
for this export and copy it in — don't assume it's set globally by the
caller. (Exporting it alone does not guarantee a clean exit code, per the
Rule above — it does guarantee the tool does real work instead of crashing
immediately with no output at all.)

## upper_mem / BRAM sizing trap
The gen_cm_dmem_direct.py script previously declared `reg [31:0] upper_mem [2048:16383]` for
addresses above the EFX_RAM10 range. Efinity synthesises this as 458K flip-flops (not BRAM),
causing 468K clock loads and making the design 16× too large for Ti60. The fix is to return
`32'h0` for addresses ≥ 2048 rather than declaring a large reg array. Fixed in HEAD.

## Timing (4-vCPU / 8 GB DigitalOcean droplet, Ti60 SoC+CM design — 66K-line Verilog)
- Synthesis (`efx_run.py --flow map`): ~45 min (10K clock loads after upper_mem fix)
- PnR (`efx_pnr`): expect 30–90 min with 4 threads
- libstdc++ version warning (system v34 > bundled v32) is harmless

## Always run inside tmux
SSH connections drop if Chromebook sleeps. Always: `tmux new-session -d -s build "..."` before starting any multi-hour step.
