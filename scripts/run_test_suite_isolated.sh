#!/usr/bin/env bash
# Run one test-suite command against private copies of mutable IDE state.
set -uo pipefail

if [ "$#" -ne 3 ]; then
    echo "usage: $0 SANDBOX_DIR SUITE_NAME COMMAND" >&2
    exit 2
fi

SANDBOX_DIR="$1"
SUITE_NAME="$2"
COMMAND="$3"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
LUMPS_DIR="$SANDBOX_DIR/lumps"
BOOT_CONFIG="$SANDBOX_DIR/boot-config.json"

rm -rf "$SANDBOX_DIR"
mkdir -p "$LUMPS_DIR"
if [ -d "$ROOT/server/lumps" ]; then
    cp -a "$ROOT/server/lumps/." "$LUMPS_DIR/"
fi
if [ -f "$ROOT/server/boot-config.json" ]; then
    cp -a "$ROOT/server/boot-config.json" "$BOOT_CONFIG"
else
    printf '{}\n' > "$BOOT_CONFIG"
fi

echo "  [state-isolation] $SUITE_NAME uses private LUMP and boot-config copies"
(
    cd "$ROOT"
    export CHURCH_TEST_LUMPS_DIR="$LUMPS_DIR"
    export CHURCH_TEST_BOOT_CONFIG_PATH="$BOOT_CONFIG"
    eval "$COMMAND"
)
