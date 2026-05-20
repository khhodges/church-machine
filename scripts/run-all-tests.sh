#!/usr/bin/env bash
# run-all-tests.sh — runs every CI test suite, independent suites in parallel.
# Prints every suite's output followed by a full pass/fail summary.
# Exits non-zero if any suite fails.
#
# Usage: run-all-tests.sh [--progress]
#   --progress   Print a live "[X/N done — waiting on: …]" status line to
#                stderr every 5 s while suites are running.  Off by default
#                so CI pipelines that capture stdout are not disrupted.

set -uo pipefail

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
SHOW_PROGRESS=0
for arg in "$@"; do
    case "$arg" in
        --progress) SHOW_PROGRESS=1 ;;
    esac
done

cd "$(dirname "$0")/.."

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PRE-FLIGHT: checking run-all-tests.sh is in sync"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
node scripts/check-run-all-tests-sync.js || {
    echo ""
    echo "STOPPING: run-all-tests.sh is out of sync with .replit workflows."
    echo "Fix the sync issues reported above, then re-run."
    exit 1
}

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

# ---------------------------------------------------------------------------
# Suite registry — preserves declaration order for output display
# ---------------------------------------------------------------------------
SUITE_NAMES=()

# ---------------------------------------------------------------------------
# launch_suite <name> <cmd>
#   Starts <cmd> in the background. stdout+stderr go to $WORK_DIR/<name>.out
#   The PID is written to $WORK_DIR/<name>.pid so we can wait on it later.
# ---------------------------------------------------------------------------
launch_suite() {
    local name="$1"
    local cmd="$2"
    local out="$WORK_DIR/${name}.out"
    local pid_file="$WORK_DIR/${name}.pid"

    SUITE_NAMES+=("$name")

    {
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "  SUITE: $name"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        eval "$cmd"
    } > "$out" 2>&1 &

    echo $! > "$pid_file"
}

# ---------------------------------------------------------------------------
# Launch all suites — everything here runs concurrently
# ---------------------------------------------------------------------------

launch_suite "check-stale-cr7" \
    'bash scripts/check_stale_cr7.sh'

launch_suite "check-selftest-lump-stale" \
    'node scripts/check_selftest_lump_stale.js && node scripts/test_check_selftest_lump_stale.js'

launch_suite "check-capabilities-blocks" \
    'node scripts/check-capabilities-blocks.js'

launch_suite "check-api-reference-stale" \
    'node scripts/gen-api-reference.js --check'

launch_suite "lump-consistency" \
    'python -m pytest tests/lump/test_lump_consistency.py -v'

launch_suite "assembler-tests" \
    'npm test'

launch_suite "fault-recovery-tests" \
    'node simulator/test_fault_recovery.js'

launch_suite "lump-binary-tests" \
    'node simulator/test_load_lump_binary.js'

launch_suite "lump-roundtrip" \
    'node simulator/test_lump_roundtrip.js'

launch_suite "catalog-compile-tests" \
    'node simulator/test_catalog_compile.js'

launch_suite "boot-entry-sync-tests" \
    'node simulator/test_boot_entry_sync.js'

launch_suite "warning-panel-tests" \
    'node simulator/test_asm_warning_panel.js'

launch_suite "rci-threading-tests" \
    'node simulator/test_rci_threading.js'

launch_suite "pending-gt-tests" \
    'node simulator/test_lazy_resolve_pending.js'

launch_suite "selftest-lump-runs" \
    'python -m pytest tests/simulator/test_selftest_lump_runs.py -v'

launch_suite "boot-image-matches-sim" \
    'python3 -m pytest tests/boot/test_boot_image_matches_simulator.py -v'

launch_suite "boot-image-loads-and-boots" \
    'python -m pytest tests/boot/test_boot_image_loads_and_boots.py -v'

launch_suite "boot-image-upload-endpoint" \
    'python -m pytest tests/boot/test_boot_image_upload_endpoint.py -v'

launch_suite "boot-image-serve-endpoints" \
    'python -m pytest tests/boot/test_boot_image_serve_endpoints.py -v'

launch_suite "boot-layout-regression" \
    'python -m pytest tests/boot/test_boot_layout_no_null_slot2.py -v'

launch_suite "version-telemetry-tests" \
    'python3 -m pytest tests/server/test_version_telemetry.py -v'

launch_suite "hardware-sim" \
    'python -m ctmm_cap_amaranth.testbench && python -m hardware.test_mwin_seal && python -m hardware.test_outform_mode2 && python -m hardware.test_shift_ops'

launch_suite "e2e-tests" \
    'CHROMIUM=$(which chromium) && mkdir -p .cache/ms-playwright/chromium-1217/chrome-linux64 && ln -sf "$CHROMIUM" .cache/ms-playwright/chromium-1217/chrome-linux64/chrome && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npx --yes playwright test'

# ---------------------------------------------------------------------------
# Wait for every suite, collect results, stream output as each one finishes
# ---------------------------------------------------------------------------
declare -A EXIT_CODES

TOTAL=${#SUITE_NAMES[@]}

echo ""
echo "  [parallel] Launched $TOTAL suites — waiting for results…"
echo ""

# ---------------------------------------------------------------------------
# Optional live-progress background loop
# ---------------------------------------------------------------------------
PROGRESS_PID=""
if [ "$SHOW_PROGRESS" -eq 1 ]; then
    (
        while [ ! -f "$WORK_DIR/all_done" ]; do
            sleep 5
            [ -f "$WORK_DIR/all_done" ] && break

            done_count=0
            waiting=()
            for n in "${SUITE_NAMES[@]}"; do
                if [ -f "$WORK_DIR/${n}.done" ]; then
                    done_count=$((done_count + 1))
                else
                    waiting+=("$n")
                fi
            done

            if [ "${#waiting[@]}" -gt 0 ]; then
                waiting_str=$(IFS=", "; echo "${waiting[*]}")
                echo "  [${done_count}/${TOTAL} done — waiting on: ${waiting_str}]" >&2
            fi
        done
    ) &
    PROGRESS_PID=$!
fi

for name in "${SUITE_NAMES[@]}"; do
    pid_file="$WORK_DIR/${name}.pid"
    out="$WORK_DIR/${name}.out"
    pid=$(cat "$pid_file")

    # Block until this specific suite process exits; capture real exit code
    if wait "$pid" 2>/dev/null; then
        EXIT_CODES["$name"]=0
    else
        EXIT_CODES["$name"]=$?
    fi

    # Mark suite as done for the progress loop
    touch "$WORK_DIR/${name}.done"

    # Stream the captured output immediately so slow suites don't stay silent
    cat "$out"

    if [ "${EXIT_CODES[$name]}" -eq 0 ]; then
        echo "  ✔  $name PASSED"
    else
        echo "  ✘  $name FAILED (exit ${EXIT_CODES[$name]})"
    fi
done

# Signal the progress loop to stop and wait for it to exit cleanly
touch "$WORK_DIR/all_done"
if [ -n "$PROGRESS_PID" ]; then
    wait "$PROGRESS_PID" 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Final summary
# ---------------------------------------------------------------------------
PASS=0
FAIL=0
FAILED_SUITES=()

for name in "${SUITE_NAMES[@]}"; do
    if [ "${EXIT_CODES[$name]}" -eq 0 ]; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
        FAILED_SUITES+=("$name")
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FAIL" -eq 0 ]; then
    echo "  ALL SUITES PASSED ($PASS suites)"
else
    echo "  RESULTS: $PASS passed, $FAIL failed"
    echo ""
    echo "  FAILED SUITES:"
    for s in "${FAILED_SUITES[@]}"; do
        echo "    ✘  $s"
    done
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[ "$FAIL" -eq 0 ]
