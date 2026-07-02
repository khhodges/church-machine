#!/usr/bin/env bash
# scripts/check_fw_banner_matches_defines.sh
#
# Source-level guard: verifies the firmware boot banner can never disagree
# with the FW_MAJOR/FW_MINOR #define values.
#
# main.c's boot banner is meant to be DERIVED from FW_MAJOR/FW_MINOR at
# runtime (single uart_putc digit each, no hardcoded "vX.Y" literal) — that
# is exactly what makes drift structurally impossible. This guard fails if
# it ever finds a hardcoded "CHURCH Ti60 SoC+CM vX.Y" literal string whose
# version does not match the current #define values (i.e. someone reverted
# to a literal and forgot to keep it in sync) — the precise root cause of
# the v2.3-vs-v2.4 stale-banner incident.
#
# A literal banner whose version DOES match the defines still passes (it's
# not wrong, just fragile) — this guard only blocks provable drift.
#
# Usage:
#   bash scripts/check_fw_banner_matches_defines.sh <main.c>
#
# Exit codes:
#   0   — no hardcoded literal banner found (derived — cannot drift), OR
#         a literal banner was found and it matches FW_MAJOR.FW_MINOR
#   1   — a hardcoded literal banner was found and its version does NOT
#         match FW_MAJOR.FW_MINOR
#   2   — usage error, missing file, or FW_MAJOR/FW_MINOR not found

set -uo pipefail

MAIN_C="${1:-}"

if [ -z "$MAIN_C" ]; then
    echo "Usage: $0 <main.c>" >&2
    exit 2
fi

if [ ! -f "$MAIN_C" ]; then
    echo "ERROR: file not found: $MAIN_C" >&2
    exit 2
fi

FW_MAJOR="$(grep -oE '#define[[:space:]]+FW_MAJOR[[:space:]]+[0-9]+' "$MAIN_C" | grep -oE '[0-9]+$' || echo "")"
FW_MINOR="$(grep -oE '#define[[:space:]]+FW_MINOR[[:space:]]+[0-9]+' "$MAIN_C" | grep -oE '[0-9]+$' || echo "")"

if [ -z "$FW_MAJOR" ] || [ -z "$FW_MINOR" ]; then
    echo "ERROR: could not parse FW_MAJOR/FW_MINOR #define lines from $MAIN_C" >&2
    exit 2
fi

# Look for a hardcoded literal banner, e.g.:
#   uart_puts("CHURCH Ti60 SoC+CM v2.4\r\n");
LITERAL_LINE="$(grep -oE 'SoC\+CM v[0-9]+\.[0-9]+' "$MAIN_C" | head -1 || echo "")"

if [ -z "$LITERAL_LINE" ]; then
    echo "  [banner-guard] no hardcoded literal banner found — banner is derived from FW_MAJOR.FW_MINOR (cannot drift)"
    exit 0
fi

LITERAL_VERSION="${LITERAL_LINE#SoC+CM v}"
LITERAL_MAJOR="${LITERAL_VERSION%%.*}"
LITERAL_MINOR="${LITERAL_VERSION##*.}"
EXPECTED_VERSION="${FW_MAJOR}.${FW_MINOR}"

if [ "$LITERAL_MAJOR" != "$FW_MAJOR" ] || [ "$LITERAL_MINOR" != "$FW_MINOR" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  GUARD FAIL: boot banner disagrees with FW_MAJOR/FW_MINOR"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "  Hardcoded banner literal reports: v${LITERAL_VERSION}"
    echo "  #define FW_MAJOR/FW_MINOR reports: v${EXPECTED_VERSION}"
    echo ""
    echo "  The board will boot and print a version string that does not match"
    echo "  what the CALLHOME JSON (fw_major/fw_minor) reports — this is the"
    echo "  exact stale-banner bug that caused the v2.3-vs-v2.4 incident."
    echo ""
    echo "  Fix: update the literal banner string in $MAIN_C to v${EXPECTED_VERSION},"
    echo "  or (preferred) derive it from FW_MAJOR/FW_MINOR with uart_putc so it"
    echo "  can never drift again."
    echo ""
    exit 1
fi

echo "  [banner-guard] hardcoded literal banner v${LITERAL_VERSION} matches FW_MAJOR.FW_MINOR"
exit 0
