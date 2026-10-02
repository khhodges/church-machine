#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/church-clear-tunnel-e2e.XXXXXX")"
trap 'rm -rf "$RUN_DIR"' EXIT

# The browser server gets its own complete writable tree. The spec replaces
# only its disposable namespace/image/config contents with the minimal fixture.
mkdir -p "$RUN_DIR/lumps" "$RUN_DIR/build-snapshots"
cp -a "$ROOT/server/lumps/." "$RUN_DIR/lumps/"
cp -a "$ROOT/server/boot-config.json" "$RUN_DIR/boot-config.json"
if [[ -d "$ROOT/server/build-snapshots" ]]; then
    cp -a "$ROOT/server/build-snapshots/." "$RUN_DIR/build-snapshots/"
fi
cp -a "$ROOT/server/church_machine.db" "$RUN_DIR/church_machine.db"

cd "$ROOT"
CHURCH_TEST_LUMPS_DIR="$RUN_DIR/lumps" \
CHURCH_TEST_BOOT_CONFIG_PATH="$RUN_DIR/boot-config.json" \
CHURCH_TEST_BUILD_SNAPSHOTS_DIR="$RUN_DIR/build-snapshots" \
CHURCH_TEST_DB_PATH="$RUN_DIR/church_machine.db" \
CHURCH_TEST_ISOLATED_MODE=1 \
E2E_PORT=5050 \
    npx playwright test tests/e2e/namespace_clear_tunnel.spec.js