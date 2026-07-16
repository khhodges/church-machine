#!/bin/bash
# run_efx_map.sh — Efinix synthesis for SoC+CM combined project
#
# Usage (from any directory):
#   bash ~/church-machine/hardware/soc_combined/run_efx_map.sh [PROJECT_XML]
#
# PROJECT_XML defaults to church_soc_cm.xml in the same directory as this script.
#
# Uses efx_run.py --flow map (NOT efx_map --project-xml directly).
# efx_run.py produces the .vdb file required by efx_pnr; bare efx_map does not.
#
# Efinity re-injects banned params into the XML on every GUI save; this script
# strips them automatically before invoking efx_run.py.
#
# Known banned params (cause EFX-0002 in 2026.1):
#   infer_clk_enable, infer_set_reset, calc_mcw, split_input_buf,
#   no_fanout_override, get_names_method, logic_opting, pack_lut_into_ram,
#   cpe_ins_register, use_cpe_for_const_0, use_cpe_for_const_1,
#   fanout_limit (renamed to --fanout-limit with hyphens)

set -euo pipefail

# ── Direct-invocation guard ───────────────────────────────────────────────
# scripts/build_ti60_bitstream.sh (the One Button Build Script — OBBS) is the
# ONLY supported entry point for a synthesis run. It builds firmware from the
# repo copy (hardware/soc_combined/firmware), patches sapphire.v, deploys both
# into $SOC_PROJECT_DIR, and only then exports _OBBS_RUN=1 and calls this
# script. This script itself no longer builds or patches firmware — it used
# to (Step 0a used to run `make -C $SOC_DIR/firmware clean all` and re-patch
# sapphire.v from THAT copy), which silently overwrote the correctly-patched
# repo firmware with whatever stale/untracked sources happened to live in
# $SOC_DIR/firmware. That was the root cause of a real incident where a
# flashed board reported an old firmware banner despite the repo already
# containing the fix. Calling this script directly (bypassing the OBBS) skips
# the firmware build/patch/deploy steps entirely, so a hard fail here — not a
# warning — is required to stop a synthesis run from silently baking in
# whatever firmware happens to already be sitting in $SOC_DIR.
#
# Legitimate manual debugging (e.g. re-running MAP after tweaking Verilog
# only, with firmware already deployed and known-fresh) can bypass the guard
# with ALLOW_DIRECT=1.
if [ -z "${_OBBS_RUN:-}" ] && [ -z "${ALLOW_DIRECT:-}" ]; then
    echo ""
    echo "=================================================================="
    echo "[FAIL] run_efx_map.sh must be invoked via scripts/build_ti60_bitstream.sh"
    echo "[FAIL] (the One Button Build Script), not directly."
    echo "[FAIL]"
    echo "[FAIL] Direct invocation skips the firmware build/patch/deploy steps"
    echo "[FAIL] that build_ti60_bitstream.sh performs against the repo firmware"
    echo "[FAIL] copy (hardware/soc_combined/firmware) — the only source of truth."
    echo "[FAIL] Running MAP without them synthesises whatever firmware bytes"
    echo "[FAIL] happen to already be in \$SOC_PROJECT_DIR, which can be stale."
    echo "[FAIL]"
    echo "[FAIL] Run instead:"
    echo "[FAIL]   bash scripts/build_ti60_bitstream.sh"
    echo "[FAIL]"
    echo "[FAIL] If you are intentionally re-running MAP for hardware-only"
    echo "[FAIL] debugging and firmware is already deployed + verified fresh,"
    echo "[FAIL] set ALLOW_DIRECT=1 to bypass this guard."
    echo "=================================================================="
    echo ""
    exit 1
fi

EFINITY="${EFINITY_HOME:-$HOME/efinity/2026.1}"
EFX_RUN_PY="$EFINITY/scripts/efx_run.py"

# Do NOT source setup.sh — it calls `exit` in non-interactive shells and
# silently kills this script before it prints anything.  Add paths directly.
export PATH="$EFINITY/bin:${PATH:-}"
export EFINITY_HOME="$EFINITY"
if [ -d "$EFINITY/lib" ]; then
    export LD_LIBRARY_PATH="$EFINITY/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
# Headless servers throw `An exception occurred: 'EFINITY_USER_DIR_INI'`
# (a Python KeyError from efx_run.py) if this is unset — same quirk
# run_efx_pnr.sh and run_efx_pgm.sh already work around. EFXPT_HOME
# (Efinity platform tools home) MUST be $EFINITY/pt, not the plain Efinity
# root — matches Efinity's own bin/setup.sh. See run_efx_pnr.sh for the
# full explanation (device-lookup CSV path depends on this being correct).
export EFINITY_USER_DIR_INI="${EFINITY_USER_DIR_INI:-$HOME/.efinity}"
export EFXPT_HOME="${EFXPT_HOME:-$EFINITY/pt}"
mkdir -p "$EFINITY_USER_DIR_INI"

# Default project: church_soc_cm.xml in the same directory as this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${1:-$SCRIPT_DIR/church_soc_cm.xml}"
SOC_DIR="$(dirname "$PROJECT")"
CIRCUIT="$(basename "$PROJECT" .xml)"

echo "==> Stripping banned XML params from $PROJECT ..."
sed -i '/<efx:param name="infer_clk_enable"/d'    "$PROJECT"
sed -i '/<efx:param name="infer_set_reset"/d'     "$PROJECT"
sed -i '/<efx:param name="calc_mcw"/d'            "$PROJECT"
sed -i '/<efx:param name="split_input_buf"/d'     "$PROJECT"
sed -i '/<efx:param name="no_fanout_override"/d'  "$PROJECT"
sed -i '/<efx:param name="get_names_method"/d'    "$PROJECT"
sed -i '/<efx:param name="logic_opting"/d'        "$PROJECT"
sed -i '/<efx:param name="pack_lut_into_ram"/d'   "$PROJECT"
sed -i '/<efx:param name="cpe_ins_register"/d'    "$PROJECT"
sed -i '/<efx:param name="use_cpe_for_const_0"/d' "$PROJECT"
sed -i '/<efx:param name="use_cpe_for_const_1"/d' "$PROJECT"
sed -i '/<efx:param name="fanout_limit"/d'        "$PROJECT"
echo "    Done."
echo ""

echo "==> Synthesising $PROJECT via efx_run.py --flow map ..."
echo "    efx_run.py: $EFX_RUN_PY"
echo "    Project:    $PROJECT"
echo "    Working in: $SOC_DIR"
echo ""

mkdir -p "$SOC_DIR/work_syn"
cd "$SOC_DIR"

# ----------------------------------------------------------------
# Step 0a: Firmware freshness self-test (NOT a rebuild)
#
# Firmware is built, patched into sapphire.v, and deployed into $SOC_DIR
# by scripts/build_ti60_bitstream.sh (Steps 1-2) BEFORE this script is ever
# invoked — that is the only place firmware is compiled from. This script
# used to ALSO rebuild firmware here, from $SOC_DIR/firmware (a separate,
# never-synced copy on droplets), and re-ran patch_sapphire_init.py against
# it — silently overwriting the correctly-patched sapphire.v that Step 2
# had just deployed, with symbol bins baked from stale/untracked firmware
# bytes. That produced a flashed board whose boot banner did not match the
# repo's main.c, and cost real debugging time to trace. The fix is to never
# rebuild firmware here — only verify what was already deployed is fresh.
#
# WHY THE CHECK STILL RUNS HERE (not skipped entirely):
#   efx_pnr uses --vdb_file top.vdb written by efx_map. The VDB embeds BRAM
#   INIT_ values at synthesis time; patching map.v afterward has no effect
#   on the bitstream. If sapphire.v is stale by the time MAP runs, the only
#   recovery is re-running the whole OBBS — so we fail fast here, before
#   spending ~45 minutes on synthesis, rather than discovering it only when
#   the board boots the wrong firmware.
# ----------------------------------------------------------------
echo "==> Step 0a: Verifying deployed sapphire.v is fresh (self-test, no rebuild) ..."
if [ ! -f "$SOC_DIR/sapphire.v" ]; then
    echo "[FAIL] $SOC_DIR/sapphire.v not found. It must be deployed by" >&2
    echo "[FAIL] scripts/build_ti60_bitstream.sh before run_efx_map.sh runs." >&2
    exit 1
fi
bash "$SCRIPT_DIR/../../scripts/check_sapphire_patch_fresh.sh" \
    "$SOC_DIR/sapphire.v" || {
    echo "[FAIL] sapphire.v in $SOC_DIR is not patched (bare-filename \$readmemb block missing)." >&2
    echo "[FAIL] This should never happen when invoked via build_ti60_bitstream.sh —" >&2
    echo "[FAIL] re-run it from the repo root rather than patching manually." >&2
    exit 1
}
if [ -f "$SOC_DIR/firmware/main.c" ]; then
    bash "$SCRIPT_DIR/../../scripts/check_fw_banner_matches_defines.sh" \
        "$SOC_DIR/firmware/main.c" || {
        echo "[FAIL] Boot banner in $SOC_DIR/firmware/main.c disagrees with its own" >&2
        echo "[FAIL] FW_MAJOR/FW_MINOR #defines — this is the stale-banner bug class." >&2
        exit 1
    }
else
    echo "    (no $SOC_DIR/firmware/main.c to check — skipping banner guard)"
fi
# sapphire.v references the symbol bins by bare filename. EDA tools resolve
# $readmemb bare filenames relative to the DIRECTORY CONTAINING THE SOURCE
# FILE — i.e. $SOC_DIR/ (where sapphire.v lives), NOT relative to --work_dir.
#
# When invoked via build_ti60_bitstream.sh (OBBS): bins are present in
# $SOC_DIR/ (freshly deployed by OBBS Step 2 and verified by
# check_sapphire_symbol_bins_fresh.sh) so MAP elaboration succeeds.
# Efinity 2026.1 MAP writes all-FF INIT placeholder into the VDB regardless
# of bin content — PNR resolves the actual $readmemb bytes at P&R time.
# Both $SOC_DIR/ and work_syn/ bins are fresh — check both.
#
# When invoked standalone (not via OBBS): check both $SOC_DIR/ and work_syn/.
if [ -f "$SCRIPT_DIR/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin" ]; then
    bash "$SCRIPT_DIR/../../scripts/check_sapphire_symbol_bins_fresh.sh" \
        "$SCRIPT_DIR" "$SOC_DIR/work_syn" || {
        echo "[FAIL] Sapphire symbol bins in $SOC_DIR/work_syn are stale or missing." >&2
        echo "[FAIL] This should never happen when invoked via build_ti60_bitstream.sh —" >&2
        echo "[FAIL] re-run it from the repo root rather than patching manually." >&2
        exit 1
    }
    if [ "${_OBBS_RUN:-0}" = "1" ]; then
        echo "    (OBBS: bins intentionally absent from $SOC_DIR/ during MAP — PNR resolves from Step 3b bins)"
    else
        bash "$SCRIPT_DIR/../../scripts/check_sapphire_symbol_bins_fresh.sh" \
            "$SCRIPT_DIR" "$SOC_DIR" || {
            echo "[FAIL] Sapphire symbol bins in $SOC_DIR (project root — where MAP reads them) are stale." >&2
            echo "[FAIL] This should never happen when invoked via build_ti60_bitstream.sh —" >&2
            echo "[FAIL] re-run it from the repo root rather than patching manually." >&2
            exit 1
        }
    fi
else
    echo "    (no symbol bins found in $SCRIPT_DIR — skipping bins freshness check)"
fi
echo "--- sapphire.v initial block (verification) ---"
grep -A 6 'initial begin' "$SOC_DIR/sapphire.v" | grep -E 'readmemb|ram_symbol\[' | head -6
echo "---"
echo "    ✓ sapphire.v verified fresh (built/patched/deployed by build_ti60_bitstream.sh)."
echo ""

# ----------------------------------------------------------------
# Step 0b: CM DMEM BRAM freshness self-test (NOT a patch/rebuild)
#
# patch_cm_bram.py's $readmemb byte-lane technique is OBSOLETE: EFX_MAP
# 2026.1 stores $readmemb INIT data only in a defparam that efx_pnr never
# reads (see build_ti60_bitstream.sh Step 2.5 comments) — the BRAM still
# synthesises all-zero. gen_cm_dmem_direct.py (explicit EFX_RAM10 instances
# with inline INIT_N params) is the only confirmed-working technique, and
# scripts/build_ti60_bitstream.sh's Step 2.5 already runs it and deploys
# cm_dmem_bram.v + the patched church_ti60_f225.v into $SOC_DIR BEFORE this
# script is ever invoked.
#
# Calling patch_cm_bram.py here unconditionally (as this step used to)
# double-patches an already-cm_dmem_bram file: its "already patched" sentinel
# is a bare `'readmemb' in src` substring check, which false-positives on the
# comment gen_cm_dmem_direct.py leaves behind ("...bypasses $readmemb->VDB
# bug..."), then fails with "cannot parse depth" because the old dmem_b0
# declarations it looks for no longer exist. This is the same two-build-
# locations bug class as the firmware banner incident — one canonical patch
# path only. This step now just verifies Step 2.5 already deployed
# cm_dmem_bram, mirroring Step 0a's self-test-not-rebuild philosophy.
# ----------------------------------------------------------------
echo "==> Step 0b: Verifying CM DMEM BRAM patch is fresh (self-test, no rebuild) ..."
bash "$SCRIPT_DIR/../../scripts/check_cm_dmem_bram_fresh.sh" \
    "$SOC_DIR/church_ti60_f225.v" "$SOC_DIR" || {
    echo "[FAIL] CM DMEM BRAM guard failed — see output above." >&2
    exit 1
}
echo "    ✓ CM DMEM BRAM already patched via cm_dmem_bram (gen_cm_dmem_direct.py)."
echo ""
echo "==> All pre-synthesis patches complete. Starting MAP synthesis now (~45 min) ..."
echo "    This step synthesises all Verilog into FPGA cells and bakes firmware into BRAM."
echo "    The terminal will be quiet for most of this time — that is normal."
echo ""

# efx_run.py --flow map runs synthesis AND writes outflow/<circuit>.vdb
# (required by efx_pnr). --work_dir sets the scratch directory.
#
# KNOWN QUIRK (same class as the Interface Designer quirk already tolerated
# in run_efx_pnr.sh): on this headless server efx_run.py can raise a Python
# KeyError ("An exception occurred: 'EFINITY_USER_DIR_INI'") from some
# internal cleanup/telemetry path AFTER synthesis has already completed
# ("map : PASS" in the log) and the VDB has already been written to disk.
# This is NOT the same failure as a genuinely-unset env var — both vars are
# exported above. We do not trust efx_run.py's own exit code; we check
# whether it actually produced a fresh outflow/<circuit>.vdb instead, the
# same way run_efx_pnr.sh checks for outflow/<circuit>.interface.csv.
VDB_FILE="$SOC_DIR/outflow/${CIRCUIT}.vdb"
VDB_MARKER="$SOC_DIR/work_syn/.vdb_pre_synth_marker"
mkdir -p "$SOC_DIR/outflow"
rm -f "$VDB_MARKER"
touch "$VDB_MARKER"

set +e
python3 "$EFX_RUN_PY" \
    --flow map \
    --work_dir work_syn \
    --prj "$PROJECT" \
    2>&1 | tee "$SOC_DIR/work_syn/synthesis.log"
EFX_RUN_EXIT="${PIPESTATUS[0]}"
set -e

if [ "$EFX_RUN_EXIT" -ne 0 ]; then
    if [ -f "$VDB_FILE" ] && [ "$VDB_FILE" -nt "$VDB_MARKER" ] \
        && grep -q "EFINITY_USER_DIR_INI" "$SOC_DIR/work_syn/synthesis.log"; then
        echo ""
        echo "    NOTE: efx_run.py exited $EFX_RUN_EXIT with the known headless"
        echo "    'EFINITY_USER_DIR_INI' KeyError quirk — but MAP synthesis"
        echo "    already completed and wrote a fresh $VDB_FILE. Continuing."
        echo ""
    else
        echo "" >&2
        echo "[FAIL] efx_run.py --flow map exited $EFX_RUN_EXIT and no fresh VDB was produced." >&2
        echo "[FAIL] Expected: $VDB_FILE (newer than $VDB_MARKER)." >&2
        echo "[FAIL] Last 40 lines of $SOC_DIR/work_syn/synthesis.log:" >&2
        tail -40 "$SOC_DIR/work_syn/synthesis.log" >&2 2>/dev/null || echo "[FAIL] (log not found)" >&2
        rm -f "$VDB_MARKER"
        exit 1
    fi
elif [ ! -f "$VDB_FILE" ]; then
    echo "[FAIL] efx_run.py exited 0 but expected VDB not found: $VDB_FILE" >&2
    rm -f "$VDB_MARKER"
    exit 1
fi
rm -f "$VDB_MARKER"

echo ""
echo "==> Synthesis complete. VDB: $VDB_FILE"
echo "    Next: bash ~/church-machine/hardware/soc_combined/run_efx_pnr.sh $PROJECT"
echo ""
echo "    Verify BRAM init is non-zero:"
echo "    grep -m1 'INIT_0' $SOC_DIR/outflow/${CIRCUIT}.map.v 2>/dev/null | head -c 120"
