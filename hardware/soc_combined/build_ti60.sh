#!/usr/bin/env bash
# ===========================================================================
# build_ti60.sh — One-command Ti60 F225 bitstream build  (Efinity 2026.1)
# ===========================================================================
#
# Run from ANY directory:
#   bash ~/church-machine/hardware/soc_combined/build_ti60.sh [OPTIONS]
#
# Options:
#   --skip-firmware   Skip RISC-V compile (reuse existing symbol .bin files)
#   --skip-synth      Skip synthesis    (reuse existing top.vdb)
#   --skip-pnr        Skip PnR          (reuse existing work_pnr/*.lbf)
#   --skip-flash      Build but do NOT flash
#   --flash-only      Flash outflow/church_soc_cm.hex, no rebuild
#
# Prerequisites on the build machine (DigitalOcean droplet):
#   Efinity 2026.1 at ~/efinity/2026.1
#   RISC-V GCC  at ~/efinity/efinity-riscv-ide-2025.2/toolchain/bin  (or system)
#   openFPGALoader (only required if Ti60 is USB-connected to this machine)
#
# Board-side verification after flash:
#   stty -F /dev/ttyUSB2 57600 raw -echo && cat /dev/ttyUSB2
# ===========================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOC_DIR="$SCRIPT_DIR"
FIRMWARE_DIR="$SOC_DIR/firmware"
PROJECT="$SOC_DIR/church_soc_cm.xml"
CIRCUIT="church_soc_cm"
FAMILY="Titanium"
DEVICE="Ti60F225"
OPCOND="C3"

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
SKIP_FIRMWARE=0; SKIP_SYNTH=0; SKIP_PNR=0; SKIP_FLASH=0; FLASH_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --skip-firmware) SKIP_FIRMWARE=1 ;;
    --skip-synth)    SKIP_SYNTH=1 ;;
    --skip-pnr)      SKIP_PNR=1 ;;
    --skip-flash)    SKIP_FLASH=1 ;;
    --flash-only)    FLASH_ONLY=1; SKIP_FIRMWARE=1; SKIP_SYNTH=1; SKIP_PNR=1 ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Environment — do NOT source setup.sh (it calls exit in non-interactive shells)
# ---------------------------------------------------------------------------
export EFINITY_HOME="${EFINITY_HOME:-$HOME/efinity/2026.1}"
export EFINITY_USER_DIR_INI="${EFINITY_USER_DIR_INI:-$HOME/.efinity}"
export EFXPT_HOME="${EFXPT_HOME:-$EFINITY_HOME}"
export PATH="$EFINITY_HOME/bin:${PATH:-}"
export LD_LIBRARY_PATH="$EFINITY_HOME/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
mkdir -p "$EFINITY_USER_DIR_INI"

EFX_MAP="$EFINITY_HOME/bin/efx_map"
EFX_PNR="$EFINITY_HOME/bin/efx_pnr"
EFX_RUN="$EFINITY_HOME/bin/efx_run"   # compiled binary — NOT efx_run.py (which needs PyQt6)

die()     { echo ""; echo "FATAL: $*" >&2; exit 1; }
warn()    { echo "  WARNING: $*"; }
section() {
  echo ""
  echo "==========================================================================="
  echo "  $*"
  echo "==========================================================================="
}

# ---------------------------------------------------------------------------
# Locate RISC-V GCC (try several common install locations)
# ---------------------------------------------------------------------------
find_riscv_gcc() {
  for d in \
    "$HOME/efinity/efinity-riscv-ide-2025.2/toolchain/bin" \
    "$HOME/efinity/riscv/bin" \
    "/opt/riscv/bin" \
    "/usr/lib/riscv64-linux-gnu/bin" \
    "/usr/bin" \
    "/usr/local/bin"; do
    for cc in riscv-none-embed-gcc riscv32-unknown-elf-gcc riscv64-unknown-elf-gcc; do
      [ -x "$d/$cc" ] && echo "$d/$cc" && return 0
    done
  done
  return 1
}

# All tool commands run from SOC_DIR so relative paths in project XML resolve correctly
cd "$SOC_DIR"

if [ "$FLASH_ONLY" -eq 0 ]; then

# ===========================================================================
# STEP 1 — Compile RISC-V firmware
# ===========================================================================
section "STEP 1/7: Compile Sapphire SoC firmware"
SYM0="$SOC_DIR/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin"

if [ "$SKIP_FIRMWARE" -eq 1 ]; then
  echo "  [skipped via --skip-firmware]"
  [ -f "$SYM0" ] || die "No symbol .bin files in $SOC_DIR/ — run without --skip-firmware"
else
  RISCV_GCC="$(find_riscv_gcc || true)"
  if [ -z "$RISCV_GCC" ]; then
    die "RISC-V GCC not found.
  Install efinity-riscv-ide-2025.2 or one of:
    apt-get install -y gcc-riscv64-linux-gnu
  Then retry.  Or use --skip-firmware if symbol .bin files already exist."
  fi
  TOOLCHAIN_DIR="$(dirname "$RISCV_GCC")"
  echo "  Toolchain : $TOOLCHAIN_DIR"
  echo "  Building  : $FIRMWARE_DIR"
  cd "$FIRMWARE_DIR"
  make TOOLCHAIN="$TOOLCHAIN_DIR" clean all
  cd "$SOC_DIR"
  # Makefile DESTDIR=.. writes symbol files one level up, i.e. hardware/soc_combined/
  [ -f "$SYM0" ] || die "Firmware built but symbol .bin files not found at $SOC_DIR/"
  echo "  OK — 4 symbol .bin files written to $SOC_DIR/"
fi

# ===========================================================================
# STEP 2 — Patch sapphire.v: replace $readmemb with inline BRAM assignments
# ===========================================================================
section "STEP 2/7: Patch sapphire.v (embed firmware into BRAM)"

SAPPHIRE_V="$SOC_DIR/sapphire.v"
[ -f "$SAPPHIRE_V" ] || die "sapphire.v not found at $SAPPHIRE_V (copy from Efinix IP)"

PATCH_SCRIPT="$(dirname "$SOC_DIR")/soc_minimal/scripts/patch_sapphire_init.py"
[ -f "$PATCH_SCRIPT" ] || die "patch_sapphire_init.py not found at $PATCH_SCRIPT"

# Restore from .bak before patching so the script is idempotent on re-runs
if [ -f "$SAPPHIRE_V.bak" ]; then
  cp "$SAPPHIRE_V.bak" "$SAPPHIRE_V"
  echo "  Restored sapphire.v from backup (clean base)"
fi

if grep -q 'readmemb' "$SAPPHIRE_V"; then
  # symbol .bin files go in SOC_DIR (written by firmware Makefile DESTDIR=..)
  python3 "$PATCH_SCRIPT" "$SAPPHIRE_V" "$SOC_DIR"
  grep -q 'readmemb' "$SAPPHIRE_V" && die "readmemb still present after patch — check script output"
  echo "  DONE — sapphire.v patched; 0 readmemb calls remain"
else
  echo "  sapphire.v already patched (no readmemb found)"
fi

# ===========================================================================
# STEP 3 — Strip banned synthesis params (Efinity re-injects these on GUI saves)
# ===========================================================================
section "STEP 3/7: Strip banned synthesis params from project XML"

for param in infer_clk_enable infer_set_reset calc_mcw split_input_buf \
             no_fanout_override get_names_method logic_opting pack_lut_into_ram \
             cpe_ins_register use_cpe_for_const_0 use_cpe_for_const_1 fanout_limit; do
  sed -i "/<efx:param name=\"${param}\"/d" "$PROJECT"
done
echo "  OK — banned params stripped from $(basename "$PROJECT")"

# ===========================================================================
# STEP 4 — Regenerate cm_dmem_bram.v with explicit EFX_RAM10 INIT values
# ===========================================================================
section "STEP 4/7: Generate cm_dmem_bram.v (explicit EFX_RAM10 BRAM init)"

# gen_cm_dmem_direct.py replaces the inferred dmem[] array in church_ti60_f225.v
# with explicit EFX_RAM10 instances whose INIT params survive EFX_MAP synthesis.
# ($readmemb / initial begin are silently dropped by EFX_MAP 2026.1 for inferred BRAM)
GEN_SCRIPT="$SOC_DIR/gen_cm_dmem_direct.py"
[ -f "$GEN_SCRIPT" ] || die "gen_cm_dmem_direct.py not found at $GEN_SCRIPT"

echo "  Running: python3 gen_cm_dmem_direct.py $SOC_DIR"
python3 "$GEN_SCRIPT" "$SOC_DIR"
[ -f "$SOC_DIR/cm_dmem_bram.v" ] || die "gen_cm_dmem_direct.py ran but cm_dmem_bram.v not found"
echo "  OK — cm_dmem_bram.v generated with inline EFX_RAM10 INIT values"

# ===========================================================================
# STEP 5 — Synthesis (efx_map)  ~45 min
# ===========================================================================
section "STEP 5/7: Synthesis (efx_map) — ~45 min"
mkdir -p "$SOC_DIR/work_syn" "$SOC_DIR/outflow"

if [ "$SKIP_SYNTH" -eq 1 ]; then
  echo "  [skipped via --skip-synth]"
  [ -f "$SOC_DIR/top.vdb" ] || die "top.vdb missing — remove --skip-synth to re-synthesise"
else
  echo "  efx_map --project-xml $PROJECT"
  echo "  Log: $SOC_DIR/work_syn/synthesis.log"
  echo "  Started: $(date)"
  "$EFX_MAP" --project-xml "$PROJECT" 2>&1 | tee "$SOC_DIR/work_syn/synthesis.log"
  echo "  Finished: $(date)"
  [ -f "$SOC_DIR/top.vdb" ] || die "Synthesis completed but top.vdb not found"

  # Verify BRAM INIT is non-zero (catches empty Sapphire ROM)
  echo "  Checking BRAM INIT values..."
  NONZERO=$(grep -rh "INIT_0" "$SOC_DIR/work_syn"/*.v 2>/dev/null | grep -v '"0\{64\}"' | head -1 || true)
  if [ -n "$NONZERO" ]; then
    echo "  OK — non-zero BRAM INIT confirmed (Sapphire firmware embedded)"
  else
    warn "Could not confirm non-zero BRAM INIT — verify sapphire ROM content"
    warn "grep INIT_0 $SOC_DIR/work_syn/*.v | grep -v '0000000' | head -3"
  fi
fi

# Symlink top.vdb as outflow/<circuit>.vdb so efx_run interface/pgm steps find it
ln -sf "$SOC_DIR/top.vdb" "$SOC_DIR/outflow/${CIRCUIT}.vdb" 2>/dev/null || true
echo "  Symlinked top.vdb → outflow/${CIRCUIT}.vdb"

# ===========================================================================
# STEP 5 — Place & Route (efx_pnr)  ~45 min
# ===========================================================================
section "STEP 6/7: Place & Route (efx_pnr) — ~45 min"
mkdir -p "$SOC_DIR/work_pnr"

if [ "$SKIP_PNR" -eq 1 ]; then
  echo "  [skipped via --skip-pnr]"
else
  # Interface step: efx_run BINARY (not efx_run.py — that needs PyQt6).
  # Reads peri.xml → writes outflow/<circuit>.interface.csv (IO pin mapping).
  # Non-zero exit is tolerated; what matters is the CSV file.
  SYNC_FILE="$SOC_DIR/outflow/${CIRCUIT}.interface.csv"
  echo "  Running interface step (efx_run binary)..."
  "$EFX_RUN" "$CIRCUIT" \
      --prj \
      --flow   interface \
      --family "$FAMILY" \
      -d       "$DEVICE" \
      2>&1 | tee "$SOC_DIR/outflow/interface.log" || true

  if [ -f "$SYNC_FILE" ]; then
    echo "  OK — interface CSV: $SYNC_FILE"
    SYNC_ARGS=(--sync_file "$SYNC_FILE")
  else
    warn "Interface step did not produce ${CIRCUIT}.interface.csv"
    warn "IO cells (clk, UART, LEDs) will be placed on random pins — bitstream will not work on hardware"
    warn "Check: $SOC_DIR/outflow/interface.log"
    SYNC_ARGS=()
  fi

  echo "  Running efx_pnr..."
  echo "  Log: $SOC_DIR/work_pnr/pnr.log"
  echo "  Started: $(date)"
  "$EFX_PNR" \
    --prj                  "$PROJECT" \
    --circuit              "$CIRCUIT" \
    --family               "$FAMILY" \
    --device               "$DEVICE" \
    --operating_conditions "$OPCOND" \
    --pack --place --route \
    --vdb_file             "top.vdb" \
    "${SYNC_ARGS[@]}" \
    --work_dir             "work_pnr" \
    --output_dir           "outflow" \
    --max_threads          4 \
    2>&1 | tee "$SOC_DIR/work_pnr/pnr.log"
  echo "  Finished: $(date)"

  # Confirm successful route
  grep -E "Routing complete|EXIT_0" "$SOC_DIR/work_pnr/pnr.log" | tail -3 || \
    die "PnR did not complete successfully — check $SOC_DIR/work_pnr/pnr.log"
fi

# ===========================================================================
# STEP 6 — Bitstream (efx_run pgm binary)
# ===========================================================================
section "STEP 7/7: Bitstream generation (efx_run pgm)"

echo "  Running: efx_run $CIRCUIT --prj --flow pgm"
"$EFX_RUN" "$CIRCUIT" \
    --prj \
    --flow   pgm \
    --family "$FAMILY" \
    -d       "$DEVICE" \
    2>&1 | tee "$SOC_DIR/outflow/pgm.log"

HEX="$SOC_DIR/outflow/${CIRCUIT}.hex"
[ -f "$HEX" ] || die "efx_pgm finished but $HEX not found — check $SOC_DIR/outflow/pgm.log"
echo "  Bitstream: $HEX  ($(du -h "$HEX" | cut -f1))"

fi  # end FLASH_ONLY skip block

# ===========================================================================
# FLASH
# ===========================================================================
section "FLASH: openFPGALoader → Ti60 F225"

HEX="${HEX:-$SOC_DIR/outflow/${CIRCUIT}.hex}"
[ -f "$HEX" ] || die "No bitstream at $HEX — build first (run without --flash-only)"

if [ "$SKIP_FLASH" -eq 1 ]; then
  echo "  [skipped via --skip-flash]"
  echo ""
  echo "  Flash manually:"
  echo "    openFPGALoader -b titanium_ti60_f225_jtag -f $HEX"
else
  echo "  Flashing: $HEX"
  openFPGALoader -b titanium_ti60_f225_jtag -f "$HEX" \
  || openFPGALoader -b titanium_ti60_f225_jtag --write-flash "$HEX" \
  || {
    echo ""
    echo "  openFPGALoader failed.  If Ti60 is connected to a different machine:"
    echo "    1. Copy $HEX to that machine"
    echo "    2. Use Efinity Programmer: JTAG to SPI Active Flash → select .hex"
    exit 1
  }
fi

# ===========================================================================
section "BUILD COMPLETE"
echo "  Bitstream : $HEX"
echo ""
echo "  Verify boot (press RESET on board first):"
echo "    stty -F /dev/ttyUSB2 57600 raw -echo && cat /dev/ttyUSB2"
echo ""
echo "  Or run the call-home bridge:"
echo "    python3 $SOC_DIR/callhome_bridge.py --port=/dev/ttyUSB2 --insecure"
echo ""
echo "  Expected output within 5 s of reset:"
echo "    CALLHOME:{\"board\":\"Ti60F225\",\"boot_ok\":1,...}"
