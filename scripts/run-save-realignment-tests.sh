#!/usr/bin/env bash
# Never import the web server before every mutable path is private.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/lumps" "$root/snapshots"
printf '[]' > "$root/lumps/manifest.json"
printf '{"abstractions":[]}' > "$root/lumps/ns-state.json"
printf '{}' > "$root/boot-config.json"
printf 'null' > "$root/ide-hierarchy.json"
export CHURCH_TEST_ISOLATED_MODE=1
export CHURCH_TEST_LUMPS_DIR="$root/lumps"
export CHURCH_TEST_BOOT_CONFIG_PATH="$root/boot-config.json"
export CHURCH_TEST_BUILD_SNAPSHOTS_DIR="$root/snapshots"
export CHURCH_TEST_DB_PATH="$root/test.db"
export CHURCH_TEST_IDE_HIERARCHY_PATH="$root/ide-hierarchy.json"
python3 -m pytest tests/server/test_save_realignment_handoff.py "$@"
