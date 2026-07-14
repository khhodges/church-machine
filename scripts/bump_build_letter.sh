#!/usr/bin/env bash
# scripts/bump_build_letter.sh
#
# Advance FW_BUILD_LETTER in hardware/soc_combined/firmware/build_seq.h
# one step through the alphabet: A→B→…→Z→A.
# Called automatically by build_ti60_bitstream.sh before firmware compile.
#
# Usage (from repo root):
#   bash scripts/bump_build_letter.sh
set -euo pipefail

HEADER="hardware/soc_combined/firmware/build_seq.h"

if [ ! -f "$HEADER" ]; then
    echo "[FAIL] build_seq.h not found at $HEADER" >&2
    exit 1
fi

current=$(grep -oP "(?<=#define FW_BUILD_LETTER ')." "$HEADER")
if [ -z "$current" ]; then
    echo "[FAIL] Could not parse FW_BUILD_LETTER from $HEADER" >&2
    exit 1
fi

next=$(python3 -c "
c = '$current'
n = chr(ord(c) + 1) if c != 'Z' else 'A'
print(n)
")

sed -i "s/#define FW_BUILD_LETTER '$current'/#define FW_BUILD_LETTER '$next'/" "$HEADER"

# Also update the human-readable comment line
sed -i "s/Current letter is '$current' — next build will bump to .*/Current letter is '$next' — next build will bump to '$(python3 -c "c='$next'; print(chr(ord(c)+1) if c!='Z' else 'A')")'.\
 */" "$HEADER"

echo "[OK]  FW_BUILD_LETTER: '$current' → '$next'  (build_seq.h updated)"
