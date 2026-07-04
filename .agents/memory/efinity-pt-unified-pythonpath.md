---
name: Efinity PT Unified device package PYTHONPATH gap
description: efx_run_pt_unified.py imports `device.service` from pt/bin, not scripts/; skipping setup.sh drops it from PYTHONPATH and causes a silent, exit-0 no-op
---

Efinity's `scripts/efx_run.py` runs Interface Designer (PT Unified) via
`import efx_run_pt_unified`. That module does `from device.service import
DeviceService`, but the `device` package physically lives under
`$EFINITY_HOME/pt/bin/device/`, not next to `efx_run_pt_unified.py` in
`scripts/`. Efinity's real `bin/setup.sh` would normally arrange for this to
be importable, but any headless build script that skips sourcing
`setup.sh` (a common, correct choice — it calls `exit` in non-interactive
shells) loses that path silently.

**Symptom is deceptive:** this is NOT a crash. `efx_run.py` wraps the import
in a bare `except ImportError`, writes a one-line warning to its *log file
only* (not stdout/stderr), and returns success (exit 0) having done
nothing. The result looks identical to "nothing went wrong" until a later
step fails because the expected output file (`.interface.csv`) was never
written. Confirmed by reproducing the import directly:
`cd $EFINITY_HOME/scripts && $EFINITY_HOME/bin/python3 -c "import
efx_run_pt_unified"` → `ModuleNotFoundError: No module named 'device'`.

**Fix:** export `PYTHONPATH="$EFINITY_HOME/pt/bin:${PYTHONPATH:-}"` before
invoking any `efx_run` flow that touches PT Unified/Interface Designer. Not
a broken install — the package is present, just off the default import
path once `setup.sh` is bypassed.

**Why:** headless build scripts that avoid `setup.sh` for legitimate
reasons (avoiding its `exit` call) must manually recreate every env var it
would otherwise set, one at a time, as each is discovered missing — this is
one of them. There will likely be others; when a new Efinity Python module
fails to import cleanly in a headless invocation, check whether `setup.sh`
would have put its containing directory on `PYTHONPATH` before assuming a
deeper install problem.

**How to apply:** any script that headlessly drives `efx_run` (or any
Efinity Python entry point) for a flow involving PT Unified / Interface
Designer / device management should export this PYTHONPATH addition
alongside `EFINITY_USER_DIR_INI` and `EFXPT_HOME`.
