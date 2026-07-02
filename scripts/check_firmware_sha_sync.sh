#!/usr/bin/env bash
# scripts/check_firmware_sha_sync.sh
#
# Post-sync guard: verifies that the Efinity project's firmware directory
# ($SOC_DIR/firmware) is byte-identical to the repo's canonical firmware
# directory ($HW/firmware), using sha256 content hashes rather than mtimes.
#
# This is the guard that closes the T2 root cause for good: even if a future
# change reorders steps, skips the rsync, or a stray file is dropped into
# $SOC_DIR/firmware by hand, this check catches the divergence BEFORE
# synthesis burns 4+ minutes embedding the wrong firmware bytes.
#
# Usage:
#   bash scripts/check_firmware_sha_sync.sh <repo-firmware-dir> <soc-firmware-dir>
#
# Arguments:
#   repo-firmware-dir  — canonical firmware source dir (e.g. hardware/soc_combined/firmware)
#   soc-firmware-dir   — Efinity project's firmware dir (e.g. $SOC_DIR/firmware)
#
# Exit codes:
#   0   — every file present in repo-firmware-dir exists in soc-firmware-dir
#         with an identical sha256 hash, and soc-firmware-dir has no extras
#   1   — content mismatch, missing file, or extra (stray) file found
#   2   — usage error or missing arguments/directories

set -uo pipefail

REPO_FW="${1:-}"
SOC_FW="${2:-}"

if [ -z "$REPO_FW" ] || [ -z "$SOC_FW" ]; then
    echo "Usage: $0 <repo-firmware-dir> <soc-firmware-dir>" >&2
    exit 2
fi

if [ ! -d "$REPO_FW" ]; then
    echo "ERROR: repo firmware directory not found: $REPO_FW" >&2
    exit 2
fi

if [ ! -d "$SOC_FW" ]; then
    echo "ERROR: SoC firmware directory not found: $SOC_FW" >&2
    exit 2
fi

sha_of() {
    # Portable sha256: prefer sha256sum, fall back to shasum -a 256
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

MISMATCHES=()
MISSING=()
EXTRA=()

while IFS= read -r -d '' repo_file; do
    rel="${repo_file#"$REPO_FW"/}"
    soc_file="$SOC_FW/$rel"
    if [ ! -f "$soc_file" ]; then
        MISSING+=("$rel")
        continue
    fi
    repo_hash="$(sha_of "$repo_file")"
    soc_hash="$(sha_of "$soc_file")"
    if [ "$repo_hash" != "$soc_hash" ]; then
        MISMATCHES+=("$rel")
    fi
done < <(find "$REPO_FW" -maxdepth 1 -type f -print0 2>/dev/null)

while IFS= read -r -d '' soc_file; do
    rel="${soc_file#"$SOC_FW"/}"
    if [ ! -f "$REPO_FW/$rel" ]; then
        EXTRA+=("$rel")
    fi
done < <(find "$SOC_FW" -maxdepth 1 -type f -print0 2>/dev/null)

if [ "${#MISMATCHES[@]}" -gt 0 ] || [ "${#MISSING[@]}" -gt 0 ] || [ "${#EXTRA[@]}" -gt 0 ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  GUARD FAIL: firmware sha256 sync mismatch"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "  $SOC_FW is not byte-identical to $REPO_FW"
    echo ""
    if [ "${#MISMATCHES[@]}" -gt 0 ]; then
        echo "  Content differs (stale copy in SoC dir):"
        for f in "${MISMATCHES[@]}"; do
            echo "    $f"
        done
    fi
    if [ "${#MISSING[@]}" -gt 0 ]; then
        echo "  Missing from SoC dir:"
        for f in "${MISSING[@]}"; do
            echo "    $f"
        done
    fi
    if [ "${#EXTRA[@]}" -gt 0 ]; then
        echo "  Stray file in SoC dir (not in repo):"
        for f in "${EXTRA[@]}"; do
            echo "    $f"
        done
    fi
    echo ""
    echo "  If you synthesise now, EFX_MAP will embed whatever firmware bytes"
    echo "  are actually in $SOC_FW — which do NOT match the repo you just built."
    echo ""
    echo "  Run: rsync -a --delete '$REPO_FW/' '$SOC_FW/'"
    echo ""
    exit 1
fi

echo "  [sha-sync-guard] $SOC_FW is byte-identical to $REPO_FW"
exit 0
