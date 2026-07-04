#!/usr/bin/env bash
# scripts/test_build_guard.sh
#
# Dry-run test for the bitstream build guards.
# Tests check_sapphire_patch_fresh.sh (content guard) and
# check_bram_init_zero.sh (INIT_0 guard) using synthetic fixtures.
#
# Runs entirely in a temp directory — no Efinity installation required.
# Exits 0 if all assertions pass, non-zero on the first failure.
#
# Usage (from repo root):
#   bash scripts/test_build_guard.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$REPO_ROOT/scripts"

PASS=0
FAIL=0
FAILED=()

# ── Colour helpers ───────────────────────────────────────────────────────────
_ok()   { printf '\033[0;32m  [PASS]\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
_fail() { printf '\033[0;31m  [FAIL]\033[0m %s\n' "$*" >&2; FAIL=$((FAIL+1)); FAILED+=("$*"); }

# ── assert_exit <expected> <actual> <label> ──────────────────────────────────
assert_exit() {
    local expected="$1"
    local actual="$2"
    local label="$3"
    if [ "$actual" -eq "$expected" ]; then
        _ok "$label (exit $actual)"
    else
        _fail "$label — expected exit $expected, got $actual"
    fi
}

# ── assert_output_contains <pattern> <output> <label> ───────────────────────
assert_output_contains() {
    local pattern="$1"
    local output="$2"
    local label="$3"
    if echo "$output" | grep -qF "$pattern"; then
        _ok "$label (message contains: $pattern)"
    else
        _fail "$label — expected message containing '$pattern'"
        echo "    Actual output:" >&2
        echo "$output" | sed 's/^/    /' >&2
    fi
}

# ── Setup: temp workspace ────────────────────────────────────────────────────
TMPDIR_BASE=$(mktemp -d)
trap 'rm -rf "$TMPDIR_BASE"' EXIT

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Build Guard Dry-Run Tests"
echo "  Temp workspace: $TMPDIR_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ════════════════════════════════════════════════════════════════════════════
# Section A: check_sapphire_patch_fresh.sh (content guard)
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo "  Section A: check_sapphire_patch_fresh.sh (content guard)"
echo "  ─────────────────────────────────────────────────────"

SAPPHIRE_V="$TMPDIR_BASE/sapphire.v"

readmemb_block() {
    local lanes="$1"   # e.g. "0 1 2 3" or "0 1"
    for lane in $lanes; do
        echo "    \$readmemb(\"EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol${lane}.bin\", ram_symbol${lane});"
    done
}

# A1: fully-patched (all 4 bare-filename $readmemb lanes present) → exit 0
{
    echo "module sapphire(...);"
    echo "  initial begin"
    readmemb_block "0 1 2 3"
    echo "  end"
    echo "endmodule"
} > "$SAPPHIRE_V"
OUT=$(bash "$SCRIPTS/check_sapphire_patch_fresh.sh" "$SAPPHIRE_V" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "A1: fully patched — exit 0"
assert_output_contains "up-to-date" "$OUT" "A1: fully patched — reports up-to-date"

# A2: virgin form (full-path $readmemb, not bare filename) → exit 1
{
    echo "module sapphire(...);"
    echo "  initial begin"
    echo "    \$readmemb(\"/some/full/path/symbol0.bin\", ram_symbol0);"
    echo "    \$readmemb(\"/some/full/path/symbol1.bin\", ram_symbol1);"
    echo "    \$readmemb(\"/some/full/path/symbol2.bin\", ram_symbol2);"
    echo "    \$readmemb(\"/some/full/path/symbol3.bin\", ram_symbol3);"
    echo "  end"
    echo "endmodule"
} > "$SAPPHIRE_V"
OUT=$(bash "$SCRIPTS/check_sapphire_patch_fresh.sh" "$SAPPHIRE_V" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "A2: virgin form (full path) — exit 1"
assert_output_contains "Run: python3 scripts/patch_sapphire_init.py" "$OUT" "A2: virgin form — remediation hint"
assert_output_contains "GUARD FAIL" "$OUT" "A2: virgin form — GUARD FAIL header"

# A3: stub form (Efinix 2026.1 IP zero-init stub, no $readmemb at all) → exit 1
{
    echo "module sapphire(...);"
    echo "  initial begin"
    echo "    ram_symbol0[0] = 8'h00;"
    echo "    ram_symbol1[0] = 8'h00;"
    echo "    ram_symbol2[0] = 8'h00;"
    echo "    ram_symbol3[0] = 8'h00;"
    echo "  end"
    echo "endmodule"
} > "$SAPPHIRE_V"
OUT=$(bash "$SCRIPTS/check_sapphire_patch_fresh.sh" "$SAPPHIRE_V" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "A3: stub form (zero-init) — exit 1"
assert_output_contains "ram_symbol0" "$OUT" "A3: stub form — lists missing lane"

# A4: partially patched (only lanes 0-1 bare-filename, 2-3 still full-path) → exit 1
{
    echo "module sapphire(...);"
    echo "  initial begin"
    readmemb_block "0 1"
    echo "    \$readmemb(\"/some/full/path/symbol2.bin\", ram_symbol2);"
    echo "    \$readmemb(\"/some/full/path/symbol3.bin\", ram_symbol3);"
    echo "  end"
    echo "endmodule"
} > "$SAPPHIRE_V"
OUT=$(bash "$SCRIPTS/check_sapphire_patch_fresh.sh" "$SAPPHIRE_V" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "A4: partially patched (lanes 2-3 missing) — exit 1"
assert_output_contains "ram_symbol2" "$OUT" "A4: partially patched — lists lane 2"
assert_output_contains "ram_symbol3" "$OUT" "A4: partially patched — lists lane 3"

# A5: fully patched, but firmware sources touched LATER (mtime newer than
# sapphire.v) → must still exit 0. This is the regression case: an
# mtime-based guard would have failed here even though the content is
# correct — see check_sapphire_patch_fresh.sh header comment.
{
    echo "module sapphire(...);"
    echo "  initial begin"
    readmemb_block "0 1 2 3"
    echo "  end"
    echo "endmodule"
} > "$SAPPHIRE_V"
FW_DIR="$TMPDIR_BASE/firmware"
mkdir -p "$FW_DIR"
sleep 0.05
touch "$FW_DIR/main.c"
OUT=$(bash "$SCRIPTS/check_sapphire_patch_fresh.sh" "$SAPPHIRE_V" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "A5: patched content survives newer firmware mtime — exit 0"

# A6: missing sapphire.v → should exit 2 (usage error)
OUT=$(bash "$SCRIPTS/check_sapphire_patch_fresh.sh" "$TMPDIR_BASE/no_such_file.v" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "A6: missing sapphire.v — exit 2"

# A7: no arguments → should exit 2
OUT=$(bash "$SCRIPTS/check_sapphire_patch_fresh.sh" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "A7: no arguments — exit 2"

# ════════════════════════════════════════════════════════════════════════════
# Section B: check_bram_init_zero.sh (INIT_0 guard)
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo "  Section B: check_bram_init_zero.sh (INIT_0 guard)"
echo "  ─────────────────────────────────────────────────────"

MAP_DIR="$TMPDIR_BASE/outflow"
mkdir -p "$MAP_DIR"

# Helper: build a synthetic map.v with configurable INIT_0 values
# Arguments: <path> <lane0_val> <lane1_val> <lane2_val> <lane3_val>
# Use "0000000000000000000000000000000000000000000000000000000000000000" for zero
# Use "1a2b3c4d" (etc.) for non-zero (any non-zero substring)
make_map_v() {
    local path="$1"
    shift
    local vals=("$@")
    {
        echo "// Synthetic map.v for testing"
        for i in 0 1 2 3; do
            echo "EFX_RAM10 #(.INIT_0(\"${vals[$i]}\")) ram_symbol${i}__D\$g1_inst (.CLK());"
        done
    } > "$path"
}

ZERO64="0000000000000000000000000000000000000000000000000000000000000000"
NONZ64="1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"

# B1: all lanes non-zero → should pass (exit 0)
make_map_v "$MAP_DIR/good.map.v" "$NONZ64" "$NONZ64" "$NONZ64" "$NONZ64"
OUT=$(bash "$SCRIPTS/check_bram_init_zero.sh" "$MAP_DIR/good.map.v" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "B1: all lanes non-zero — exit 0"
assert_output_contains "Firmware confirmed embedded" "$OUT" "B1: non-zero — confirmed embedded message"

# B2: all lanes zero → should fail (exit 1)
make_map_v "$MAP_DIR/bad_all_zero.map.v" "$ZERO64" "$ZERO64" "$ZERO64" "$ZERO64"
OUT=$(bash "$SCRIPTS/check_bram_init_zero.sh" "$MAP_DIR/bad_all_zero.map.v" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "B2: all lanes zero — exit 1"
assert_output_contains "Run: python3 scripts/patch_sapphire_init.py" "$OUT" "B2: all-zero — remediation hint"
assert_output_contains "GUARD FAIL" "$OUT" "B2: all-zero — GUARD FAIL header"

# B3: mixed — lane 0 non-zero, others zero → should pass (at least one non-zero)
make_map_v "$MAP_DIR/mixed.map.v" "$NONZ64" "$ZERO64" "$ZERO64" "$ZERO64"
OUT=$(bash "$SCRIPTS/check_bram_init_zero.sh" "$MAP_DIR/mixed.map.v" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "B3: lane0 non-zero only — exit 0 (partial non-zero is OK)"

# B4: map.v without EFX_RAM10 ram_symbol instances → should exit 2 (inconclusive)
echo "// empty map.v" > "$MAP_DIR/empty.map.v"
OUT=$(bash "$SCRIPTS/check_bram_init_zero.sh" "$MAP_DIR/empty.map.v" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "B4: no EFX_RAM10 instances — exit 2 (inconclusive)"

# B5: missing map.v → should exit 2
OUT=$(bash "$SCRIPTS/check_bram_init_zero.sh" "$TMPDIR_BASE/no_such.map.v" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "B5: missing map.v — exit 2"

# B6: no arguments → should exit 2
OUT=$(bash "$SCRIPTS/check_bram_init_zero.sh" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "B6: no arguments — exit 2"

# B7: all-zero INIT_0 — output must NOT contain remediation hint when lanes are non-zero
make_map_v "$MAP_DIR/nonzero.map.v" "$NONZ64" "$NONZ64" "$NONZ64" "$NONZ64"
OUT=$(bash "$SCRIPTS/check_bram_init_zero.sh" "$MAP_DIR/nonzero.map.v" 2>&1) && RC=$? || RC=$?
if echo "$OUT" | grep -qF "patch_sapphire_init.py"; then
    _fail "B7: non-zero lanes — remediation hint should NOT appear in passing output"
else
    _ok "B7: non-zero lanes — remediation hint absent (correct)"
fi

# Helper: build a synthetic map.v matching Efinity 2026.1's verific netlist comment
# format — INIT_0 as an unquoted sized Verilog literal (e.g. 256'h0000...) embedded
# in a long /* verific EFX_ATTRIBUTE_CELL_NAME=EFX_RAM10, ... */ comment, instead of
# the older quoted-string format. This is the exact shape that broke the guard on
# real hardware builds once map moved to Efinity 2026.1.
# Arguments: <path> <lane0_val> <lane1_val> <lane2_val> <lane3_val> (hex digits, no radix)
make_map_v_verific_literal() {
    local path="$1"
    shift
    local vals=("$@")
    {
        echo "// Synthetic Efinity 2026.1 verific-style map.v for testing"
        for i in 0 1 2 3; do
            echo "            .RDATA({\\u_sapphire/u_EfxSapphireSoc/system_ramA_logic_io_bus_rsp_payload_fragment_data [${i}]})) /* verific EFX_ATTRIBUTE_CELL_NAME=EFX_RAM10, READ_WIDTH=1, WRITE_WIDTH=1, WCLK_POLARITY=1'b1, WCLKE_POLARITY=1'b1, WE_POLARITY=2'b11, WADDREN_POLARITY=1'b1, RADDREN_POLARITY=1'b1, RST_POLARITY=1'b1, RCLK_POLARITY=1'b1, RE_POLARITY=1'b1, OUTPUT_REG=1'b0, WRITE_MODE=\"READ_FIRST\", RESET_RAM=\"ASYNC\", RESET_OUTREG=\"ASYNC\", INIT_0=256'h${vals[$i]} */ ram_symbol${i}__D\$g1_inst (.CLK());"
        done
    } > "$path"
}

ZEROHEX64="0000000000000000000000000000000000000000000000000000000000000000"
NONZHEX64="1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"

# B8: Efinity 2026.1 verific literal format, all lanes non-zero → exit 0
make_map_v_verific_literal "$MAP_DIR/verific_nonzero.map.v" "$NONZHEX64" "$NONZHEX64" "$NONZHEX64" "$NONZHEX64"
OUT=$(bash "$SCRIPTS/check_bram_init_zero.sh" "$MAP_DIR/verific_nonzero.map.v" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "B8: verific literal format, all lanes non-zero — exit 0"
assert_output_contains "non-zero" "$OUT" "B8: verific literal format — parsed as non-zero, not 'could not parse'"

# B9: Efinity 2026.1 verific literal format, all lanes zero → exit 1
make_map_v_verific_literal "$MAP_DIR/verific_zero.map.v" "$ZEROHEX64" "$ZEROHEX64" "$ZEROHEX64" "$ZEROHEX64"
OUT=$(bash "$SCRIPTS/check_bram_init_zero.sh" "$MAP_DIR/verific_zero.map.v" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "B9: verific literal format, all lanes zero — exit 1"
assert_output_contains "GUARD FAIL" "$OUT" "B9: verific literal format — correctly detected as zero, not 'could not parse'"
if echo "$OUT" | grep -qF "could not parse INIT_0 value"; then
    _fail "B9: verific literal format — should be parsed, not reported as unparseable"
else
    _ok "B9: verific literal format — parsed successfully (no 'could not parse' message)"
fi

# ════════════════════════════════════════════════════════════════════════════
# Section C: check_firmware_sha_sync.sh (sha256 sync guard)
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo "  Section C: check_firmware_sha_sync.sh (sha256 sync guard)"
echo "  ─────────────────────────────────────────────────────"

SHA_REPO="$TMPDIR_BASE/sha_repo_fw"
SHA_SOC="$TMPDIR_BASE/sha_soc_fw"
mkdir -p "$SHA_REPO" "$SHA_SOC"

echo "int main() {}" > "$SHA_REPO/main.c"
echo "#define X 1"   > "$SHA_REPO/main.h"

# C1: identical copies → pass (exit 0)
cp "$SHA_REPO/main.c" "$SHA_SOC/main.c"
cp "$SHA_REPO/main.h" "$SHA_SOC/main.h"
OUT=$(bash "$SCRIPTS/check_firmware_sha_sync.sh" "$SHA_REPO" "$SHA_SOC" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "C1: byte-identical dirs — exit 0"
assert_output_contains "byte-identical" "$OUT" "C1: byte-identical — reports match"

# C2: soc copy has stale content → fail (exit 1)
echo "int main() { return 1; }" > "$SHA_SOC/main.c"
OUT=$(bash "$SCRIPTS/check_firmware_sha_sync.sh" "$SHA_REPO" "$SHA_SOC" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "C2: stale content in SoC dir — exit 1"
assert_output_contains "main.c" "$OUT" "C2: stale content — names offending file"
assert_output_contains "GUARD FAIL" "$OUT" "C2: stale content — GUARD FAIL header"

# C3: file missing from soc dir → fail (exit 1)
cp "$SHA_REPO/main.c" "$SHA_SOC/main.c"
rm "$SHA_SOC/main.h"
OUT=$(bash "$SCRIPTS/check_firmware_sha_sync.sh" "$SHA_REPO" "$SHA_SOC" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "C3: missing file in SoC dir — exit 1"
assert_output_contains "main.h" "$OUT" "C3: missing file — names it"

# C4: stray extra file in soc dir → fail (exit 1)
cp "$SHA_REPO/main.h" "$SHA_SOC/main.h"
echo "stray" > "$SHA_SOC/leftover.c"
OUT=$(bash "$SCRIPTS/check_firmware_sha_sync.sh" "$SHA_REPO" "$SHA_SOC" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "C4: stray extra file in SoC dir — exit 1"
assert_output_contains "leftover.c" "$OUT" "C4: stray file — names it"
rm -f "$SHA_SOC/leftover.c"

# C5: missing repo dir → exit 2
OUT=$(bash "$SCRIPTS/check_firmware_sha_sync.sh" "$TMPDIR_BASE/no_such_repo" "$SHA_SOC" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "C5: missing repo dir — exit 2"

# C6: no arguments → exit 2
OUT=$(bash "$SCRIPTS/check_firmware_sha_sync.sh" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "C6: no arguments — exit 2"

# ════════════════════════════════════════════════════════════════════════════
# Section D: check_fw_banner_matches_defines.sh (banner-vs-define guard)
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo "  Section D: check_fw_banner_matches_defines.sh (banner-vs-define guard)"
echo "  ─────────────────────────────────────────────────────"

BANNER_DIR="$TMPDIR_BASE/banner_fw"
mkdir -p "$BANNER_DIR"

make_main_c() {
    # Arguments: <path> <fw_major> <fw_minor> <banner_line-or-empty>
    local path="$1" maj="$2" min="$3" banner="$4"
    {
        echo "#define FW_MAJOR  ${maj}u"
        echo "#define FW_MINOR  ${min}u"
        if [ -n "$banner" ]; then
            echo "    uart_puts(\"CHURCH Ti60 SoC+CM v${banner}\\r\\n\");"
        else
            echo "    uart_putc((char)('0' + (FW_MAJOR % 10u)));"
            echo "    uart_putc((char)('0' + (FW_MINOR % 10u)));"
        fi
    } > "$path"
}

# D1: no literal banner (derived) → pass (exit 0)
make_main_c "$BANNER_DIR/derived_main.c" 2 4 ""
OUT=$(bash "$SCRIPTS/check_fw_banner_matches_defines.sh" "$BANNER_DIR/derived_main.c" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "D1: derived banner (no literal) — exit 0"
assert_output_contains "cannot drift" "$OUT" "D1: derived banner — reports cannot-drift"

# D2: literal banner matches defines → pass (exit 0)
make_main_c "$BANNER_DIR/literal_match_main.c" 2 4 "2.4"
OUT=$(bash "$SCRIPTS/check_fw_banner_matches_defines.sh" "$BANNER_DIR/literal_match_main.c" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "D2: literal banner matches defines — exit 0"

# D3: literal banner is stale relative to defines → fail (exit 1) — the v2.3-vs-v2.4 bug
make_main_c "$BANNER_DIR/literal_stale_main.c" 2 4 "2.3"
OUT=$(bash "$SCRIPTS/check_fw_banner_matches_defines.sh" "$BANNER_DIR/literal_stale_main.c" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "D3: stale literal banner (v2.3 vs FW=2.4) — exit 1"
assert_output_contains "GUARD FAIL" "$OUT" "D3: stale literal banner — GUARD FAIL header"
assert_output_contains "v2.3" "$OUT" "D3: stale literal banner — shows literal version"
assert_output_contains "v2.4" "$OUT" "D3: stale literal banner — shows expected version"

# D4: missing file → exit 2
OUT=$(bash "$SCRIPTS/check_fw_banner_matches_defines.sh" "$BANNER_DIR/no_such_main.c" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "D4: missing file — exit 2"

# D5: no arguments → exit 2
OUT=$(bash "$SCRIPTS/check_fw_banner_matches_defines.sh" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "D5: no arguments — exit 2"

# D6: file with no parseable FW_MAJOR/FW_MINOR → exit 2
echo "// no defines here" > "$BANNER_DIR/no_defines_main.c"
OUT=$(bash "$SCRIPTS/check_fw_banner_matches_defines.sh" "$BANNER_DIR/no_defines_main.c" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "D6: no FW_MAJOR/FW_MINOR defines — exit 2"

# ════════════════════════════════════════════════════════════════════════════
# Section E: check_sapphire_symbol_bins_fresh.sh (work_syn/ bins guard)
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo "  Section E: check_sapphire_symbol_bins_fresh.sh (work_syn/ bins guard)"
echo "  ─────────────────────────────────────────────────────"

BINS_REPO="$TMPDIR_BASE/bins_repo_hw"
BINS_WORK="$TMPDIR_BASE/bins_work_syn"
mkdir -p "$BINS_REPO" "$BINS_WORK"

SYM0="EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin"
SYM1="EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin"
SYM2="EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin"
SYM3="EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin"

echo "00000000" > "$BINS_REPO/$SYM0"
echo "00000001" > "$BINS_REPO/$SYM1"
echo "00000010" > "$BINS_REPO/$SYM2"
echo "00000011" > "$BINS_REPO/$SYM3"

# E1: bins missing entirely from work_syn/ → fail (exit 1)
OUT=$(bash "$SCRIPTS/check_sapphire_symbol_bins_fresh.sh" "$BINS_REPO" "$BINS_WORK" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "E1: bins missing from work_syn/ — exit 1"
assert_output_contains "Missing from" "$OUT" "E1: missing bins — lists them"
assert_output_contains "GUARD FAIL" "$OUT" "E1: missing bins — GUARD FAIL header"

# E2: bins copied fresh (identical) → pass (exit 0) — this is the OBBS deploy step
cp "$BINS_REPO/$SYM0" "$BINS_REPO/$SYM1" "$BINS_REPO/$SYM2" "$BINS_REPO/$SYM3" "$BINS_WORK/"
OUT=$(bash "$SCRIPTS/check_sapphire_symbol_bins_fresh.sh" "$BINS_REPO" "$BINS_WORK" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "E2: freshly-copied bins — exit 0"
assert_output_contains "match" "$OUT" "E2: freshly-copied bins — reports match"

# E3: work_syn/ bin is stale (content differs from a rebuilt repo bin) → fail (exit 1)
# Simulates: firmware was rebuilt (repo bin changed) but work_syn/ still has the old copy.
echo "11111111" > "$BINS_REPO/$SYM0"
OUT=$(bash "$SCRIPTS/check_sapphire_symbol_bins_fresh.sh" "$BINS_REPO" "$BINS_WORK" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "E3: stale bin in work_syn/ (repo rebuilt) — exit 1"
assert_output_contains "$SYM0" "$OUT" "E3: stale bin — names offending file"
assert_output_contains "MAP will silently embed OLD" "$OUT" "E3: stale bin — explains the risk"
echo "00000000" > "$BINS_REPO/$SYM0"   # restore for subsequent assertions
cp "$BINS_REPO/$SYM0" "$BINS_WORK/$SYM0"

# E4: repo hw dir missing a source bin (firmware never built) → exit 2 (usage error)
rm "$BINS_REPO/$SYM3"
OUT=$(bash "$SCRIPTS/check_sapphire_symbol_bins_fresh.sh" "$BINS_REPO" "$BINS_WORK" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "E4: repo hw dir missing source bin — exit 2"
echo "00000011" > "$BINS_REPO/$SYM3"   # restore

# E5: missing repo hw dir entirely → exit 2
OUT=$(bash "$SCRIPTS/check_sapphire_symbol_bins_fresh.sh" "$TMPDIR_BASE/no_such_hw" "$BINS_WORK" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "E5: missing repo hw dir — exit 2"

# E6: no arguments → exit 2
OUT=$(bash "$SCRIPTS/check_sapphire_symbol_bins_fresh.sh" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "E6: no arguments — exit 2"

# ════════════════════════════════════════════════════════════════════════════
# Section F: check_cm_dmem_bram_fresh.sh (cm_dmem_bram-vs-legacy-patch guard)
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo "  Section F: check_cm_dmem_bram_fresh.sh (cm_dmem_bram guard)"
echo "  ─────────────────────────────────────────────────────"

CMDMEM_DIR="$TMPDIR_BASE/cm_dmem_soc"
mkdir -p "$CMDMEM_DIR"
CMDMEM_V="$CMDMEM_DIR/church_ti60_f225.v"

# F1: fresh, unpatched file (original 32-bit dmem[] form) — fail (exit 1)
cat > "$CMDMEM_V" <<'EOF'
module church_ti60f225(clk, mem_addr, mem_rd_data);
  reg [31:0] dmem [16383:0];
  initial begin
    dmem[0] = 32'd1234;
  end
endmodule
EOF
OUT=$(bash "$SCRIPTS/check_cm_dmem_bram_fresh.sh" "$CMDMEM_V" "$CMDMEM_DIR" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "F1: unpatched dmem[] form — exit 1"
assert_output_contains "does not use cm_dmem_bram" "$OUT" "F1: unpatched — explains what's missing"

# F2: legacy $readmemb byte-lane patch applied (patch_cm_bram.py's old output) —
# still fail (exit 1): this is exactly the state that used to crash with
# "cannot parse depth" once gen_cm_dmem_direct.py's comment string tripped the
# old bare 'readmemb' substring sentinel.
cat > "$CMDMEM_V" <<'EOF'
module church_ti60f225(clk, mem_addr, mem_rd_data);
  reg [7:0] dmem_b0 [0:16383];
  reg [7:0] dmem_b1 [0:16383];
  reg [7:0] dmem_b2 [0:16383];
  reg [7:0] dmem_b3 [0:16383];
  initial $readmemb("cm_dmem_b0.bin", dmem_b0);
endmodule
EOF
OUT=$(bash "$SCRIPTS/check_cm_dmem_bram_fresh.sh" "$CMDMEM_V" "$CMDMEM_DIR" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "F2: legacy \$readmemb byte-lane form — exit 1 (not cm_dmem_bram)"

# F3: cm_dmem_bram patch applied but cm_dmem_bram.v not yet deployed — fail (exit 1)
cat > "$CMDMEM_V" <<'EOF'
module church_ti60f225(clk, mem_addr, mem_rd_data);
  // cm_dmem_bram: direct EFX_RAM10 instantiation (bypasses $readmemb->VDB bug)
  wire [31:0] _dmem_rd_data;
  cm_dmem_bram u_dmem (.clk(clk));
  assign mem_rd_data = _dmem_rd_data;
endmodule
EOF
OUT=$(bash "$SCRIPTS/check_cm_dmem_bram_fresh.sh" "$CMDMEM_V" "$CMDMEM_DIR" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "F3: cm_dmem_bram used but cm_dmem_bram.v missing — exit 1"
assert_output_contains "cm_dmem_bram.v missing" "$OUT" "F3: missing module — explains what's missing"

# F4: cm_dmem_bram patch applied and cm_dmem_bram.v deployed — pass (exit 0)
echo "// cm_dmem_bram.v stub" > "$CMDMEM_DIR/cm_dmem_bram.v"
OUT=$(bash "$SCRIPTS/check_cm_dmem_bram_fresh.sh" "$CMDMEM_V" "$CMDMEM_DIR" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "F4: cm_dmem_bram used and deployed — exit 0"
assert_output_contains "already uses cm_dmem_bram" "$OUT" "F4: pass — confirms cm_dmem_bram"

# F5: missing input file — exit 2
OUT=$(bash "$SCRIPTS/check_cm_dmem_bram_fresh.sh" "$CMDMEM_DIR/no_such.v" "$CMDMEM_DIR" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "F5: missing church_ti60_f225.v — exit 2"

# F6: no arguments — exit 2
OUT=$(bash "$SCRIPTS/check_cm_dmem_bram_fresh.sh" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "F6: no arguments — exit 2"

# ════════════════════════════════════════════════════════════════════════════
# Section G: apply_efinity_headless_patches.py (Efinity headless patcher)
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo "  Section G: apply_efinity_headless_patches.py (Efinity headless patcher)"
echo "  ─────────────────────────────────────────────────────"

PATCHER="$SCRIPTS/apply_efinity_headless_patches.py"
EFINITY_FIXTURE="$TMPDIR_BASE/efinity_fixture"

make_virgin_efinity_fixture() {
    local root="$1"
    rm -rf "$root"
    mkdir -p "$root/pt/bin/tx60_device/clock_mux"
    mkdir -p "$root/pt/bin/tx60_device/clock"
    mkdir -p "$root/pt/bin/api_service"
    mkdir -p "$root/scripts"

    cat > "$root/pt/bin/tx60_device/clock_mux/clkmux_rule_adv.py" <<'EOF'
class ClkmuxRuleChecker:
    def check(self, pll_reg):
        for clkmux_inst in pll_reg.get_all_pll():
            pass
EOF

    cat > "$root/pt/bin/tx60_device/clock/clock_rule_adv.py" <<'EOF'
class ClockRuleChecker:
    def check(self, checker):
        for osc in checker.osc_reg.get_all_osc():
            pass
EOF

    cat > "$root/scripts/efx_run_pt_unified.py" <<'EOF'
class Runner:
    def run(self, design_api):
        is_design_pass = design_api.check_design()
        if not is_design_pass:
            print("design check failed")
            return PTFlowRunnerStatusCode.ERROR
        return PTFlowRunnerStatusCode.OK
EOF

    cat > "$root/pt/bin/api_service/design.py" <<'EOF'
class DesignApi:
    def generate(self, outdir, enable_bitstream):
        if self.check_design():
            self.__gen_report(outdir)
            self.__gen_constraint(enable_bitstream, outdir)
        return True
EOF
}

# G1: virgin fixture tree — apply exits 0, sentinels present, files still compile
make_virgin_efinity_fixture "$EFINITY_FIXTURE"
OUT=$(python3 "$PATCHER" --apply --root "$EFINITY_FIXTURE" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "G1: virgin fixture — apply exits 0"
assert_output_contains "P1-clkmux-pll-none" "$OUT" "G1: P1 reported"
assert_output_contains "P4-5-design-generate-headless" "$OUT" "G1: P4-5 reported"
if grep -q "church-headless-patch-v1" "$EFINITY_FIXTURE/pt/bin/api_service/design.py"; then
    _ok "G1: design.py contains sentinel after apply"
else
    _fail "G1: design.py missing sentinel after apply"
fi
for f in \
    "$EFINITY_FIXTURE/pt/bin/tx60_device/clock_mux/clkmux_rule_adv.py" \
    "$EFINITY_FIXTURE/pt/bin/tx60_device/clock/clock_rule_adv.py" \
    "$EFINITY_FIXTURE/scripts/efx_run_pt_unified.py" \
    "$EFINITY_FIXTURE/pt/bin/api_service/design.py"; do
    if python3 -m py_compile "$f" 2>/tmp/pyc_err.log; then
        _ok "G1: $(basename "$f") compiles after patch"
    else
        _fail "G1: $(basename "$f") fails to compile after patch"
        cat /tmp/pyc_err.log >&2
    fi
done

# G2: re-apply on already-patched tree — exit 0, byte-identical (true idempotency)
CHK_BEFORE=$(cd "$EFINITY_FIXTURE" && find . -type f -name '*.py' -exec sha256sum {} + | sort)
OUT=$(python3 "$PATCHER" --apply --root "$EFINITY_FIXTURE" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "G2: re-apply on already-patched tree — exit 0"
assert_output_contains "already applied" "$OUT" "G2: reports already applied"
CHK_AFTER=$(cd "$EFINITY_FIXTURE" && find . -type f -name '*.py' -exec sha256sum {} + | sort)
if [ "$CHK_BEFORE" = "$CHK_AFTER" ]; then
    _ok "G2: re-apply is a true no-op (checksums unchanged)"
else
    _fail "G2: re-apply modified already-patched files"
fi

# G3: simulated Efinity version bump on a REQUIRED patch (anchor no longer
# matches) — exit 1, names the file. Uses P2 (clock_rule_adv.py) since P1 is
# optional/best-effort (see G3b) and would no longer trigger a hard failure.
make_virgin_efinity_fixture "$EFINITY_FIXTURE"
sed -i 's/for osc in checker.osc_reg.get_all_osc():/for osc in checker.osc_reg.iter_all_osc():/' \
    "$EFINITY_FIXTURE/pt/bin/tx60_device/clock/clock_rule_adv.py"
OUT=$(python3 "$PATCHER" --apply --root "$EFINITY_FIXTURE" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "G3: anchor missing on required patch (simulated version drift) — exit 1"
assert_output_contains "anchor text not found" "$OUT" "G3: explains anchor missing"
assert_output_contains "clock_rule_adv.py" "$OUT" "G3: names the drifted file"

# G3b: P1 is optional/best-effort — a missing anchor there (e.g. because this
# Efinity sub-build already null-guards the code natively, as confirmed on a
# real install) must NOT fail the run; it should be reported as SKIP and the
# other required patches still apply normally.
make_virgin_efinity_fixture "$EFINITY_FIXTURE"
sed -i 's/for clkmux_inst in pll_reg.get_all_pll():/for clkmux_inst in pll_reg.iter_all_pll():/' \
    "$EFINITY_FIXTURE/pt/bin/tx60_device/clock_mux/clkmux_rule_adv.py"
OUT=$(python3 "$PATCHER" --apply --root "$EFINITY_FIXTURE" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "G3b: anchor missing on optional P1 — exit 0 (not a failure)"
assert_output_contains "SKIP [P1-clkmux-pll-none]: anchor text not found" "$OUT" "G3b: P1 reported as SKIP, not FAIL"
assert_output_contains "not applicable to this Efinity build" "$OUT" "G3b: explains why P1 is optional"
assert_output_contains "P2-clock-osc-none]: patched and verified" "$OUT" "G3b: other required patches still applied"

# G4: --check on virgin tree — nonzero (not yet patched)
make_virgin_efinity_fixture "$EFINITY_FIXTURE"
OUT=$(python3 "$PATCHER" --check --root "$EFINITY_FIXTURE" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "G4: --check on virgin tree — exit 1"

# G5: --check on fully-patched tree — exit 0
python3 "$PATCHER" --apply --root "$EFINITY_FIXTURE" >/dev/null 2>&1
OUT=$(python3 "$PATCHER" --check --root "$EFINITY_FIXTURE" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "G5: --check on fully-patched tree — exit 0"

# G6: mixed state (P1 already patched by hand, rest virgin) — apply finishes the rest
make_virgin_efinity_fixture "$EFINITY_FIXTURE"
python3 - "$EFINITY_FIXTURE/pt/bin/tx60_device/clock_mux/clkmux_rule_adv.py" <<'PYEOF'
import sys
p = sys.argv[1]
c = open(p).read()
c = c.replace(
    "for clkmux_inst in pll_reg.get_all_pll():",
    "for clkmux_inst in (pll_reg.get_all_pll() if pll_reg is not None else []):  # church-headless-patch-v1",
)
open(p, "w").write(c)
PYEOF
OUT=$(python3 "$PATCHER" --apply --root "$EFINITY_FIXTURE" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "G6: mixed pre-patched state — apply exits 0"
assert_output_contains "P1-clkmux-pll-none]: already applied" "$OUT" "G6: skips already-patched P1"
assert_output_contains "P2-clock-osc-none]: patched and verified" "$OUT" "G6: applies remaining P2"

rm -rf "$EFINITY_FIXTURE"

# ────────────────────────────────────────────────────────────────────────────
# Section H: run_efx_pnr.sh — Interface Designer PYTHONPATH regression guard
# ────────────────────────────────────────────────────────────────────────────
echo ""
echo "  Section H: run_efx_pnr.sh (Interface Designer PYTHONPATH guard)"
echo "  ───────────────────────────────────────────────────────────────"

PNR_SCRIPT="$REPO_ROOT/hardware/soc_combined/run_efx_pnr.sh"

# H1: script exists
if [ -f "$PNR_SCRIPT" ]; then
    _ok "H1: run_efx_pnr.sh exists"
else
    _fail "H1: run_efx_pnr.sh exists — NOT FOUND at $PNR_SCRIPT"
fi

# H2: PYTHONPATH must include $EFINITY/pt/bin before efx_run is first invoked,
# or efx_run_pt_unified.py's `from device.service import DeviceService` fails
# with ModuleNotFoundError, which efx_run.py silently swallows into a
# one-line log warning and skips Interface Designer with exit code 0 (no
# .interface.csv, no visible error). Confirmed root cause on real hardware
# 2026-07; see CHANGELOG.md and docs/HARDWARE.md.
if grep -qE 'PYTHONPATH="\$EFINITY/pt/bin' "$PNR_SCRIPT" 2>/dev/null; then
    _ok "H2: PYTHONPATH export includes \$EFINITY/pt/bin (device package path)"
else
    _fail "H2: PYTHONPATH export includes \$EFINITY/pt/bin — MISSING (Interface Designer will silently no-op)"
fi

# H3: the PYTHONPATH export must appear before Step 0 (Interface Designer
# invocation), not after — order matters since it's an exported env var
# read at process-invocation time.
PYTHONPATH_LINE=$(grep -n 'PYTHONPATH="\$EFINITY/pt/bin' "$PNR_SCRIPT" 2>/dev/null | head -1 | cut -d: -f1)
STEP0_LINE=$(grep -n 'Step 0/2: Interface Designer' "$PNR_SCRIPT" 2>/dev/null | head -1 | cut -d: -f1)
if [ -n "$PYTHONPATH_LINE" ] && [ -n "$STEP0_LINE" ] && [ "$PYTHONPATH_LINE" -lt "$STEP0_LINE" ]; then
    _ok "H3: PYTHONPATH export precedes Step 0 (Interface Designer) invocation"
else
    _fail "H3: PYTHONPATH export precedes Step 0 invocation — order regression (export_line=$PYTHONPATH_LINE, step0_line=$STEP0_LINE)"
fi

# ════════════════════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FAIL" -eq 0 ]; then
    echo "  ALL BUILD GUARD TESTS PASSED ($PASS assertions)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
else
    echo "  RESULTS: $PASS passed, $FAIL failed"
    echo ""
    echo "  FAILED:"
    for f in "${FAILED[@]}"; do
        echo "    ✘  $f"
    done
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi
