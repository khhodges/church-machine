#!/usr/bin/env bash
# run-all-tests.sh — runs every CI test suite, independent suites in parallel.
# Prints every suite's output followed by a full pass/fail summary.
# Exits non-zero if any suite fails.
#
# Usage:
#   ./scripts/run-all-tests.sh                          # run all suites
#   ./scripts/run-all-tests.sh assembler-tests lump-roundtrip  # run named suites only
#   ./scripts/run-all-tests.sh --progress               # run all suites with live status
#
# Flags:
#   --progress              Print a live "[X/N done — waiting on: …]" status
#                           line to stderr while suites are running.  Off by
#                           default so CI pipelines that capture stdout are not
#                           disrupted.
#   --progress-interval=N   Seconds between progress lines (default 5).
#                           Only meaningful when --progress is also set.

set -uo pipefail

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
SHOW_PROGRESS=0
PROGRESS_INTERVAL=5
for arg in "$@"; do
    case "$arg" in
        --progress) SHOW_PROGRESS=1 ;;
        --progress-interval=*) PROGRESS_INTERVAL="${arg#--progress-interval=}" ;;
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
# Suite registry — two parallel arrays: names and commands
# ---------------------------------------------------------------------------
ALL_SUITE_NAMES=()
ALL_SUITE_CMDS=()

# register_suite <name> <cmd>
#   Records a suite for later filtering and launching.
register_suite() {
    ALL_SUITE_NAMES+=("$1")
    ALL_SUITE_CMDS+=("$2")
}

# ---------------------------------------------------------------------------
# Register all suites
# ---------------------------------------------------------------------------

register_suite "check-stale-cr7" \
    'bash scripts/check_stale_cr7.sh'

register_suite "check-selftest-lump-stale" \
    'node scripts/check_selftest_lump_stale.js && node scripts/test_check_selftest_lump_stale.js'

register_suite "check-capabilities-blocks" \
    'node scripts/check-capabilities-blocks.js'

register_suite "check-api-reference-stale" \
    'node scripts/gen-api-reference.js --check'

register_suite "lump-consistency" \
    'python -m pytest tests/lump/test_lump_consistency.py -v'

register_suite "assembler-tests" \
    'npm test'

register_suite "fault-recovery-tests" \
    'node simulator/test_fault_recovery.js'

register_suite "lump-binary-tests" \
    'node simulator/test_load_lump_binary.js'

register_suite "lump-roundtrip" \
    'node simulator/test_lump_roundtrip.js'

register_suite "catalog-compile-tests" \
    'node simulator/test_catalog_compile.js'

register_suite "boot-entry-sync-tests" \
    'node simulator/test_boot_entry_sync.js'

register_suite "warning-panel-tests" \
    'node simulator/test_asm_warning_panel.js'

register_suite "rci-threading-tests" \
    'node simulator/test_rci_threading.js'

register_suite "pending-gt-tests" \
    'node simulator/test_lazy_resolve_pending.js'

register_suite "selftest-lump-runs" \
    'python -m pytest tests/simulator/test_selftest_lump_runs.py -v'

register_suite "boot-image-matches-sim" \
    'python3 -m pytest tests/boot/test_boot_image_matches_simulator.py -v'

register_suite "boot-image-loads-and-boots" \
    'python -m pytest tests/boot/test_boot_image_loads_and_boots.py -v'

register_suite "boot-image-upload-endpoint" \
    'python -m pytest tests/boot/test_boot_image_upload_endpoint.py -v'

register_suite "boot-image-serve-endpoints" \
    'python -m pytest tests/boot/test_boot_image_serve_endpoints.py -v'

register_suite "boot-layout-regression" \
    'python -m pytest tests/boot/test_boot_layout_no_null_slot2.py -v'

register_suite "version-telemetry-tests" \
    'python3 -m pytest tests/server/test_version_telemetry.py -v'

register_suite "hardware-sim" \
    'python -m ctmm_cap_amaranth.testbench && python -m hardware.test_mwin_seal && python -m hardware.test_outform_mode2 && python -m hardware.test_shift_ops'

register_suite "e2e-tests" \
    'CHROMIUM=$(which chromium) && mkdir -p .cache/ms-playwright/chromium-1217/chrome-linux64 && ln -sf "$CHROMIUM" .cache/ms-playwright/chromium-1217/chrome-linux64/chrome && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npx --yes playwright test'

# ---------------------------------------------------------------------------
# Filter suites based on command-line arguments
# ---------------------------------------------------------------------------
SUITE_NAMES=()
SUITE_CMDS=()

if [ "$#" -eq 0 ]; then
    # No arguments — run everything
    SUITE_NAMES=("${ALL_SUITE_NAMES[@]}")
    SUITE_CMDS=("${ALL_SUITE_CMDS[@]}")
else
    # Validate every requested name before launching anything
    INVALID=()
    for requested in "$@"; do
        found=0
        for registered in "${ALL_SUITE_NAMES[@]}"; do
            if [ "$requested" = "$registered" ]; then
                found=1
                break
            fi
        done
        if [ "$found" -eq 0 ]; then
            INVALID+=("$requested")
        fi
    done

    if [ "${#INVALID[@]}" -gt 0 ]; then
        echo "ERROR: unrecognised suite name(s):" >&2
        for bad in "${INVALID[@]}"; do
            echo "  $bad" >&2
        done
        echo "" >&2
        echo "Valid suite names:" >&2
        for registered in "${ALL_SUITE_NAMES[@]}"; do
            echo "  $registered" >&2
        done
        exit 1
    fi

    # Build the filtered lists preserving declaration order
    for i in "${!ALL_SUITE_NAMES[@]}"; do
        name="${ALL_SUITE_NAMES[$i]}"
        for requested in "$@"; do
            if [ "$requested" = "$name" ]; then
                SUITE_NAMES+=("$name")
                SUITE_CMDS+=("${ALL_SUITE_CMDS[$i]}")
                break
            fi
        done
    done
fi

# ---------------------------------------------------------------------------
# Launch selected suites — everything here runs concurrently
# ---------------------------------------------------------------------------
launch_suite() {
    local name="$1"
    local cmd="$2"
    local out="$WORK_DIR/${name}.out"
    local pid_file="$WORK_DIR/${name}.pid"

    {
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "  SUITE: $name"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        eval "$cmd"
    } > "$out" 2>&1 &

    echo $! > "$pid_file"
}

for i in "${!SUITE_NAMES[@]}"; do
    launch_suite "${SUITE_NAMES[$i]}" "${SUITE_CMDS[$i]}"
done

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
            sleep "$PROGRESS_INTERVAL"
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
