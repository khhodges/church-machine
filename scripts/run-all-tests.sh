#!/usr/bin/env bash
# run-all-tests.sh — runs every CI test suite, independent suites in parallel.
# Prints every suite's output followed by a full pass/fail summary.
# Exits non-zero if any suite fails.
#
# Usage:
#   ./scripts/run-all-tests.sh                                    # run all suites
#   ./scripts/run-all-tests.sh assembler-tests lump-roundtrip     # run named suites only
#   ./scripts/run-all-tests.sh --progress                         # run all suites with live status
#   ./scripts/run-all-tests.sh --group boot                       # run all boot-image-* suites
#   ./scripts/run-all-tests.sh --group lump                       # run lump-consistency, lump-binary-tests, lump-roundtrip
#   ./scripts/run-all-tests.sh --group simulator                  # run simulator suites
#   ./scripts/run-all-tests.sh --group lump --group boot          # run suites from multiple groups, no duplicates
#   ./scripts/run-all-tests.sh --group lump assembler-tests       # group + extra suite(s), no duplicates
#   ./scripts/run-all-tests.sh assembler-tests --group lump       # same — order of flags doesn't matter
#
# Flags:
#   --progress              Print a live "[X/N done — waiting on: …]" status
#                           line to stderr while suites are running.  Off by
#                           default so CI pipelines that capture stdout are not
#                           disrupted.
#   --progress-interval=N   Seconds between progress lines (default 5).
#                           Only meaningful when --progress is also set.
#   --max-parallel=N        Cap how many suites run concurrently (default 8).
#                           Use 0 to launch all suites simultaneously (the old
#                           behaviour).  Capping prevents OOM-kills of the live
#                           dev server when running on resource-constrained
#                           containers.
#   --group <name>          Run all suites in the named group.  Groups are
#                           defined in the "Group registry" section below.
#                           Unknown group names print an error listing valid
#                           groups and exit non-zero.
#                           May be combined with explicit suite names in the
#                           same invocation; duplicate suite names are silently
#                           deduplicated, preserving declaration order.

set -uo pipefail

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
SHOW_PROGRESS=0
PROGRESS_INTERVAL=5
MAX_PARALLEL=8
_GROUP_ARGS=()
EXPLICIT_SUITES=()

_args=("$@")
_i=0
while [ $_i -lt ${#_args[@]} ]; do
    _arg="${_args[$_i]}"
    case "$_arg" in
        --progress)
            SHOW_PROGRESS=1
            ;;
        --progress-interval=*)
            PROGRESS_INTERVAL="${_arg#--progress-interval=}"
            ;;
        --max-parallel=*)
            MAX_PARALLEL="${_arg#--max-parallel=}"
            ;;
        --max-parallel)
            _i=$((_i + 1))
            if [ $_i -ge ${#_args[@]} ]; then
                echo "ERROR: --max-parallel requires an argument" >&2
                exit 1
            fi
            MAX_PARALLEL="${_args[$_i]}"
            ;;
        --group)
            _i=$((_i + 1))
            if [ $_i -ge ${#_args[@]} ]; then
                echo "ERROR: --group requires an argument" >&2
                exit 1
            fi
            _GROUP_ARGS+=("${_args[$_i]}")
            ;;
        --group=*)
            _GROUP_ARGS+=("${_arg#--group=}")
            ;;
        *)
            EXPLICIT_SUITES+=("$_arg")
            ;;
    esac
    _i=$((_i + 1))
done
unset _args _i _arg

cd "$(dirname "$0")/.."

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

register_suite "pet-name-mem-tests" \
    'node simulator/test_pet_name_mem.js'

register_suite "selftest-lump-runs" \
    'python -m pytest tests/simulator/test_selftest_lump_runs.py tests/simulator/test_run_lump_boots_slot3.py -v'

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
    'python -m ctmm_cap_amaranth.testbench && python -m hardware.test_mwin_seal && python -m hardware.test_outform_mode2 && python -m hardware.test_shift_ops && python -m hardware.test_irq_dispatch'

register_suite "e2e-tests" \
    'CHROMIUM=$(which chromium) && mkdir -p .cache/ms-playwright/chromium-1217/chrome-linux64 && ln -sf "$CHROMIUM" .cache/ms-playwright/chromium-1217/chrome-linux64/chrome && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npx --yes playwright test'

register_suite "sync-guard-tests" \
    'node scripts/test_sync_guard.js'

register_suite "ti60-utilisation" \
    'python scripts/check_ti60_utilisation.py --missing-ok'

register_suite "ti60-uart-dry-run" \
    'python3 scripts/test_ti60_uart.py --dry-run'

register_suite "pet-name-memory-tests" \
    'node simulator/test_pet_name_memory.js'

# ---------------------------------------------------------------------------
# Group registry — map a short group name to a list of suite names
# ---------------------------------------------------------------------------
# Keys are group names; values are space-separated suite name lists.

declare -A ALL_GROUPS

ALL_GROUPS["boot"]="boot-image-matches-sim boot-image-loads-and-boots boot-image-upload-endpoint boot-image-serve-endpoints boot-layout-regression"

ALL_GROUPS["lump"]="lump-consistency lump-binary-tests lump-roundtrip"

ALL_GROUPS["simulator"]="fault-recovery-tests assembler-tests catalog-compile-tests rci-threading-tests pending-gt-tests pet-name-mem-tests warning-panel-tests boot-entry-sync-tests selftest-lump-runs pet-name-memory-tests"

ALL_GROUPS["checks"]="check-stale-cr7 check-selftest-lump-stale check-capabilities-blocks check-api-reference-stale ti60-utilisation ti60-uart-dry-run"

ALL_GROUPS["hardware"]="hardware-sim"

ALL_GROUPS["e2e"]="e2e-tests"

# ---------------------------------------------------------------------------
# Group membership validation — catch typos before launching anything
# ---------------------------------------------------------------------------
_group_errors=()
for _grp in "${!ALL_GROUPS[@]}"; do
    # shellcheck disable=SC2206
    read -r -a _members <<< "${ALL_GROUPS[$_grp]}"
    for _member in "${_members[@]}"; do
        _found=0
        for _registered in "${ALL_SUITE_NAMES[@]}"; do
            if [ "$_member" = "$_registered" ]; then
                _found=1
                break
            fi
        done
        if [ "$_found" -eq 0 ]; then
            _group_errors+=("group '$_grp' references unknown suite '$_member'")
        fi
    done
done
unset _grp _members _member _registered _found

if [ "${#_group_errors[@]}" -gt 0 ]; then
    echo "ERROR: group registry contains unrecognised suite name(s):" >&2
    for _err in "${_group_errors[@]}"; do
        echo "  $_err" >&2
    done
    echo "" >&2
    echo "Valid suite names:" >&2
    for _registered in "${ALL_SUITE_NAMES[@]}"; do
        echo "  $_registered" >&2
    done
    exit 1
fi
unset _group_errors _err

# ---------------------------------------------------------------------------
# Pre-flight sync check
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# Filter suites based on command-line arguments
# ---------------------------------------------------------------------------
SUITE_NAMES=()
SUITE_CMDS=()

# Resolve --group flags into a list of suite names to request
REQUESTED_SUITES=("${EXPLICIT_SUITES[@]+"${EXPLICIT_SUITES[@]}"}")

for _grp_name in "${_GROUP_ARGS[@]+"${_GROUP_ARGS[@]}"}"; do
    if [ -z "${ALL_GROUPS[$_grp_name]+set}" ]; then
        echo "ERROR: unknown group '$_grp_name'" >&2
        echo "" >&2
        echo "Valid groups:" >&2
        for g in $(echo "${!ALL_GROUPS[@]}" | tr ' ' '\n' | sort); do
            echo "  $g  →  ${ALL_GROUPS[$g]}" >&2
        done
        exit 1
    fi
    # shellcheck disable=SC2206
    read -r -a _group_suites <<< "${ALL_GROUPS[$_grp_name]}"
    REQUESTED_SUITES+=("${_group_suites[@]}")
    unset _group_suites
done
unset _grp_name

if [ "${#REQUESTED_SUITES[@]}" -eq 0 ]; then
    # No filtering — run everything
    SUITE_NAMES=("${ALL_SUITE_NAMES[@]}")
    SUITE_CMDS=("${ALL_SUITE_CMDS[@]}")
else
    # Validate every requested name before launching anything
    INVALID=()
    for requested in "${REQUESTED_SUITES[@]}"; do
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
        for requested in "${REQUESTED_SUITES[@]}"; do
            if [ "$requested" = "$name" ]; then
                SUITE_NAMES+=("$name")
                SUITE_CMDS+=("${ALL_SUITE_CMDS[$i]}")
                break
            fi
        done
    done
fi

# ---------------------------------------------------------------------------
# Server guard — e2e-tests needs a live Flask server.
# playwright.config.js uses reuseExistingServer:true: if the chosen port is
# already responding, Playwright will reuse it and NOT kill it on teardown.
# If the dev server (Church Machine IDE workflow) is down, we start Flask in
# a detached session (setsid) so it survives this script's exit and the
# workflow manager's SIGTERM, keeping the dev preview alive after all-tests.
#
# Port-collision prevention: when E2E_PORT is not already set in the
# environment, pick a free ephemeral port so that a simultaneously running
# e2e-tests workflow (which defaults to port 5000) cannot collide with us.
# ---------------------------------------------------------------------------
_RUN_E2E=0
for _sn in "${SUITE_NAMES[@]}"; do
    [ "$_sn" = "e2e-tests" ] && _RUN_E2E=1 && break
done
if [ "$_RUN_E2E" -eq 1 ]; then
    if [ -z "${E2E_PORT:-}" ]; then
        E2E_PORT=$(python3 -c \
            "import socket; s=socket.socket(); s.bind(('',0)); p=s.getsockname()[1]; s.close(); print(p)")
        export E2E_PORT
    fi
    if ! curl -sf "http://localhost:${E2E_PORT}/" -o /dev/null 2>&1; then
        echo ""
        echo "  [server-guard] Port ${E2E_PORT} not responding — starting Flask server..."
        setsid python3 server/app.py >> /tmp/church_ide_preflight.log 2>&1 &
        _sg_ready=0
        for _sg_i in $(seq 1 30); do
            sleep 1
            if curl -sf "http://localhost:${E2E_PORT}/" -o /dev/null 2>&1; then
                _sg_ready=1
                break
            fi
        done
        if [ "$_sg_ready" -eq 1 ]; then
            echo "  [server-guard] Flask ready on port ${E2E_PORT}."
        else
            echo "  [server-guard] WARNING: Flask did not respond in 30s — e2e tests may fail."
        fi
    fi
fi
unset _RUN_E2E _sg_i _sg_ready _sn

# ---------------------------------------------------------------------------
# Launch selected suites — everything here runs concurrently
# ---------------------------------------------------------------------------
launch_suite() {
    local name="$1"
    local cmd="$2"
    local out="$WORK_DIR/${name}.out"
    local pid_file="$WORK_DIR/${name}.pid"

    # Record wall-clock start time so the progress loop can show elapsed seconds
    date +%s > "$WORK_DIR/${name}.start"


    {
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "  SUITE: $name"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        eval "$cmd"
    } > "$out" 2>&1 &

    echo $! > "$pid_file"
}

# _throttle_launch: block until fewer than MAX_PARALLEL suites are running.
# Uses kill -0 to check whether a launched PID is still alive.
# No-op when MAX_PARALLEL=0 (unlimited).
_throttle_launch() {
    [ "$MAX_PARALLEL" -le 0 ] && return 0
    while true; do
        local _active=0
        for _tn in "${SUITE_NAMES[@]}"; do
            local _tpf="$WORK_DIR/${_tn}.pid"
            [ -f "$_tpf" ] || continue
            local _tp; _tp=$(cat "$_tpf")
            kill -0 "$_tp" 2>/dev/null && _active=$((_active + 1))
        done
        [ "$_active" -lt "$MAX_PARALLEL" ] && return 0
        sleep 0.3
    done
}

for i in "${!SUITE_NAMES[@]}"; do
    _throttle_launch
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
        SPINNER_FRAMES=('|' '/' '-' '\')
        spin_idx=0
        while [ ! -f "$WORK_DIR/all_done" ]; do
            sleep "$PROGRESS_INTERVAL"
            [ -f "$WORK_DIR/all_done" ] && break

            now=$(date +%s)
            done_count=0
            waiting=()
            for n in "${SUITE_NAMES[@]}"; do
                if [ -f "$WORK_DIR/${n}.done" ]; then
                    done_count=$((done_count + 1))
                else
                    # Compute elapsed seconds since suite was launched
                    elapsed=0
                    if [ -f "$WORK_DIR/${n}.start" ]; then
                        started=$(cat "$WORK_DIR/${n}.start")
                        elapsed=$((now - started))
                    fi
                    waiting+=("${n} (${elapsed}s)")
                fi
            done

            if [ "${#waiting[@]}" -gt 0 ]; then
                spin="${SPINNER_FRAMES[$spin_idx]}"
                spin_idx=$(( (spin_idx + 1) % 4 ))
                waiting_str=$(IFS=", "; echo "${waiting[*]}")
                echo "  ${spin} [${done_count}/${TOTAL} done — waiting on: ${waiting_str}]" >&2
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
