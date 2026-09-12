#!/usr/bin/env bash
#
# Run the Task 3430 browser test against disposable server fixtures.
# The Flask process receives isolated copies of every writable server artifact,
# and explicit isolated mode disables external startup integrations. Save Lump
# can therefore exercise the real repository endpoints without writing
# production LUMPs, boot configuration, build snapshots, or SQLite state.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/church-task3430-e2e.XXXXXX")"
trap 'rm -rf "$RUN_DIR"' EXIT

mkdir -p "$RUN_DIR/lumps"
cp -a "$ROOT/server/lumps/." "$RUN_DIR/lumps/"
cp -a "$ROOT/server/boot-config.json" "$RUN_DIR/boot-config.json"
mkdir -p "$RUN_DIR/build-snapshots"
if [[ -d "$ROOT/server/build-snapshots" ]]; then
    cp -a "$ROOT/server/build-snapshots/." "$RUN_DIR/build-snapshots/"
fi
cp -a "$ROOT/server/church_machine.db" "$RUN_DIR/church_machine.db"

E2E_PORT="${E2E_PORT:-$(python3 -c \
    "import socket; s=socket.socket(); s.bind(('',0)); p=s.getsockname()[1]; s.close(); print(p)")}"
if [[ "$E2E_PORT" == "5000" ]]; then
    echo "Refusing Task 3430 E2E on production/dev port 5000; choose an alternate E2E_PORT." >&2
    exit 1
fi

cd "$ROOT"
CHURCH_TEST_LUMPS_DIR="$RUN_DIR/lumps" \
CHURCH_TEST_BOOT_CONFIG_PATH="$RUN_DIR/boot-config.json" \
CHURCH_TEST_BUILD_SNAPSHOTS_DIR="$RUN_DIR/build-snapshots" \
CHURCH_TEST_DB_PATH="$RUN_DIR/church_machine.db" \
CHURCH_TEST_ISOLATED_MODE=1 \
E2E_PORT="$E2E_PORT" \
    npx playwright test tests/e2e/task3430_lump_save_roundtrip.spec.js