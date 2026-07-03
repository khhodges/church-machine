#!/bin/bash
# run_efx_pnr.sh — Interface Designer + Place & Route for SoC+CM combined project
#
# Usage (from any directory):
#   bash ~/church-machine/hardware/soc_combined/run_efx_pnr.sh [PROJECT_XML]
#
# PROJECT_XML defaults to ~/church_project/SoC_minimal/church_soc.xml.
# EFX_PNR uses Efinity 2026.1 (2025.2 segfaults on efx_pnr).
#
# IMPORTANT NOTES:
#   - Interface Designer MUST run before efx_pnr to generate the LPF from
#     peri.xml; without it, IO pins (clk, uart_tx, LEDs) are placed randomly.
#   - efx_pnr requires explicit --family/--device flags; it does NOT auto-read
#     them from the project XML.  Omitting them causes an immediate SIGSEGV crash.
#   - Do NOT pass --use_vdb_file unless a VDB already exists from a prior run.
#   - --operating_conditions must match the XML timing_model ("C3" for Ti60F225).
#   - VDB is written by run_efx_map.sh (efx_run.py --flow map) as
#     outflow/<circuit>.vdb, NOT a project-root top.vdb. An earlier version of
#     this script assumed efx_run.py couldn't run headless (PyQt6 missing) and
#     expected a bare-efx_map-style top.vdb in the project root instead — that
#     assumption is disproven (efx_run.py --flow map runs fine headless once
#     EFINITY_USER_DIR_INI/EFXPT_HOME are exported; see run_efx_map.sh) and the
#     stale top.vdb it left behind silently pointed PnR at an old, unrelated
#     synthesis run. We now pass outflow/<circuit>.vdb — the file MAP actually
#     just wrote — directly to efx_pnr.

set -euo pipefail

EFINITY="${EFINITY_HOME:-$HOME/efinity/2026.1}"
EFX_PNR="$EFINITY/bin/efx_pnr"
EFX_RUN="$EFINITY/bin/efx_run"

# efx_pnr checks EFINITY_HOME at startup — must be exported
export EFINITY_HOME="$EFINITY"

# Do NOT source setup.sh — it calls `exit` in non-interactive shells and
# silently kills this script before it prints anything.  Add paths directly.
export PATH="$EFINITY/bin:${PATH:-}"
if [ -d "$EFINITY/lib" ]; then
    export LD_LIBRARY_PATH="$EFINITY/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# Default project: church_soc_cm.xml in the same directory as this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${1:-$SCRIPT_DIR/church_soc_cm.xml}"
SOC_DIR="$(dirname "$PROJECT")"
# Derive circuit name from the project XML filename (strip directory + .xml)
CIRCUIT="$(basename "$PROJECT" .xml)"
FAMILY="Titanium"
DEVICE="Ti60F225"
OPCOND="C3"

mkdir -p "$SOC_DIR/work_pnr" "$SOC_DIR/outflow"
# Headless servers throw KeyError for these vars if unset.
# EFINITY_USER_DIR_INI — user settings dir
# EFXPT_HOME           — Efinity platform tools home (defaults to EFINITY_HOME)
export EFINITY_USER_DIR_INI="${EFINITY_USER_DIR_INI:-$HOME/.efinity}"
export EFXPT_HOME="${EFXPT_HOME:-$EFINITY}"
mkdir -p "$EFINITY_USER_DIR_INI"
cd "$SOC_DIR"

# ----------------------------------------------------------------
# Step -1: Efinity headless patches (self-healing, one-time per install)
# PT Unified's Interface Designer crashes deep inside check_design() on a
# headless run (no PLL/OSC registries populated) unless the installed
# Efinity Python sources are patched. Idempotent — safe to run every time.
# ----------------------------------------------------------------
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
echo "==> Step -1: Applying Efinity headless patches (idempotent) ..."
if ! python3 "$REPO_ROOT/scripts/apply_efinity_headless_patches.py" --apply --root "$EFINITY"; then
    echo "ERROR: Efinity headless patches could not be applied — Interface Designer" >&2
    echo "       will likely crash before producing the interface CSV. See messages" >&2
    echo "       above; this usually means the installed Efinity version's source" >&2
    echo "       has drifted from the anchors in apply_efinity_headless_patches.py." >&2
    exit 1
fi
echo ""

# ----------------------------------------------------------------
# Step 0: Interface Designer
# Reads peri.xml → writes IO placement into the project database.
# On headless servers efx_run raises 'EFINITY_USER_DIR_INI' KeyError
# but still writes top.res.csv before exiting.  We capture that exit
# code and warn rather than abort so PnR can proceed with the CSV.
# ----------------------------------------------------------------
echo "==> Step 0/2: Interface Designer (IO placement from peri.xml) ..."
"$EFX_RUN" "$CIRCUIT" \
    --prj \
    --flow   interface \
    --family "$FAMILY" \
    -d       "$DEVICE" \
    2>&1 | tee "$SOC_DIR/outflow/interface.log" || \
    echo "    WARNING: Interface Designer exited non-zero (EFINITY_USER_DIR_INI quirk) — continuing."
# Interface Designer writes outflow/<circuit>.interface.csv — NOT top.res.csv.
# top.res.csv is the MAP resource-utilisation report and causes efx_pnr to crash
# with "unknown escape sequence" when passed as --sync_file.
SYNC_FILE="$SOC_DIR/outflow/${CIRCUIT}.interface.csv"
if [ ! -f "$SYNC_FILE" ]; then
    echo "ERROR: Interface Designer did not produce $SYNC_FILE — cannot proceed." >&2
    LOG_FILE="$SOC_DIR/outflow/interface.log"
    if [ -f "$LOG_FILE" ]; then
        DIGEST="$(grep -iE 'error|fail|exception|traceback' "$LOG_FILE" | tail -20 || true)"
        echo "" >&2
        if [ -n "$DIGEST" ]; then
            echo "---- interface.log error digest (grep -iE 'error|fail|exception|traceback') ----" >&2
            echo "$DIGEST" >&2
        else
            echo "---- interface.log tail (no error/fail/exception lines found) ----" >&2
            tail -20 "$LOG_FILE" >&2
        fi
        echo "---- end digest (full log: $LOG_FILE) ----" >&2
    fi
    exit 1
fi
echo "    Sync file: $SYNC_FILE"
echo ""

# ----------------------------------------------------------------
# Step 1/2: Place & Route
# ----------------------------------------------------------------
echo "==> Step 1/2: Place & Route  ($PROJECT) ..."
echo "    EFX_PNR: $EFX_PNR"
echo "    Family:  $FAMILY / $DEVICE / $OPCOND"
echo ""

# --sync_file carries the IO placement constraints generated by Interface Designer.
# efx_run writes outflow/<circuit>.interface.csv (confirmed on 2026.1).
# --vdb_file points at outflow/<circuit>.vdb — the file run_efx_map.sh's
# efx_run.py --flow map actually writes (see header notes above). A
# project-root top.vdb is a leftover from an earlier, disproven assumption
# and must never be used here — it silently goes stale.
VDB_FILE="outflow/${CIRCUIT}.vdb"
if [ ! -f "$VDB_FILE" ]; then
    echo "[FAIL] Expected VDB not found: $SOC_DIR/$VDB_FILE" >&2
    echo "[FAIL] Run run_efx_map.sh (MAP synthesis) first — it must complete" >&2
    echo "[FAIL] successfully before Place & Route can run." >&2
    exit 1
fi
echo "    VDB file: $SOC_DIR/$VDB_FILE (mtime: $(date -r "$VDB_FILE" 2>/dev/null || echo unknown))"
"$EFX_PNR" \
    --prj            "$PROJECT" \
    --circuit        "$CIRCUIT" \
    --family         "$FAMILY" \
    --device         "$DEVICE" \
    --operating_conditions "$OPCOND" \
    --pack --place --route \
    --vdb_file       "$VDB_FILE" \
    --sync_file      "$SYNC_FILE" \
    --work_dir       "work_pnr" \
    --output_dir     "outflow" \
    2>&1 | tee "$SOC_DIR/work_pnr/pnr.log"

echo ""
echo "==> Place & Route complete. Output in $SOC_DIR/work_pnr/ and $SOC_DIR/outflow/"
echo "    Bitstream: $SOC_DIR/outflow/${CIRCUIT}.bit  (run run_efx_pgm.sh next)"
