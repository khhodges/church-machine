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
    'node scripts/check_selftest_lump_stale.js && node scripts/test_check_selftest_lump_stale.js && node scripts/test_build_selftest_lump_cleanup.js'

register_suite "check-capabilities-blocks" \
    'node scripts/check-capabilities-blocks.js'

register_suite "check-no-ti60-ui" \
    'node scripts/check_no_ti60_ui.js'

register_suite "check-security-claims" \
    'python3 scripts/check_security_claims.py && python3 scripts/test_check_security_claims.py'

register_suite "check-api-reference-stale" \
    'node scripts/gen-api-reference.js --check && node scripts/gen-thread-design.js --check && node scripts/gen-architecture-contracts.js --check && python -m pytest tests/test_architecture_contracts.py -q'

register_suite "check-whats-new-feed" \
    'node scripts/test_sync_whats_new.js && node scripts/sync-whats-new.js --check'

register_suite "wukong-relay-deployment-guard" \
    'python -m pytest tests/server/test_primary_publish_config.py -v'

register_suite "lump-consistency" \
    'python -m pytest tests/lump/test_lump_consistency.py -v'

register_suite "lump-v13-freespace-tests" \
    'python -m pytest tests/lump/test_lump_v13_freespace.py -v'

register_suite "wukong-bridge-parser-tests" \
    'python -m pytest tests/hardware/test_wukong_bridge_parser.py -v'

register_suite "wukong-command-delivery-tests" \
    'python -m pytest tests/server/test_wukong_command_delivery.py tests/hardware/test_wukong_bridge_command_ack.py -v'

register_suite "wukong-fault-sentinel" \
    'python -m pytest tests/hardware/test_wukong_snapshot_protocol.py hardware/test_wukong_bridge_resync.py tests/server/test_wukong_snapshot.py tests/server/test_wukong_command_delivery.py tests/server/test_lump_root_override.py hardware/test_boot_rom_no_false_halt.py::test_repeated_reboots_stay_clean -q'

register_suite "sha32-vectors" \
    'python -m pytest scripts/test_sha32_vectors.py -v'


register_suite "check-sha32-collisions" \
    'python3 scripts/check_sha32_collisions.py'

register_suite "assembler-tests" \
    'npm test'

register_suite "fault-recovery-tests" \
    'node simulator/test_fault_recovery.js'

register_suite "bank-custody-recovery-tests" \
    'node simulator/test_bank_lump.js && node simulator/test_bank_passkey.js && python -m pytest tests/server/test_bank_custody_recovery.py -v'

register_suite "lambda-exec-tests" \
    'node simulator/test_lambda_exec.js'

register_suite "lump-binary-tests" \
    'node simulator/test_load_lump_binary.js'

register_suite "wukong-callhome-hw-lump-tests" \
    'node simulator/test_wukong_callhome_hw_lump.js'

register_suite "lump-binary-size-tests" \
    'node simulator/test_lump_binary_size.js'

register_suite "constants-lump-tests" \
    'node simulator/test_constants_lump.js'

register_suite "lump-save-endpoint-tests" \
    'python -m pytest tests/server/test_lump_save_endpoint.py -v'

register_suite "selftest-egt-guard-tests" \
    'python -m pytest tests/server/test_selftest_egt_guard.py -v'

register_suite "lump-meta-patch-validation-tests" \
    'python -m pytest tests/server/test_lump_meta_patch_validation.py -v'

register_suite "lump-save-error-surface-tests" \
    'node simulator/test_lump_save_error_surface.js'

register_suite "lump-roundtrip" \
    'node simulator/test_lump_roundtrip.js'

register_suite "editor-roundtrip-tests" \
    'node simulator/test_editor_roundtrip.js'

register_suite "lump-gt-display-tests" \
    'node tests/lump/test_lump_gt_display.js'

register_suite "lump-builder-dispatch-tests" \
    'node simulator/test_lump_builder_dispatch.js'

register_suite "catalog-compile-tests" \
    'node simulator/test_catalog_compile.js'

register_suite "boot-entry-sync-tests" \
    'node simulator/test_boot_entry_sync.js'

register_suite "install-boot-entry-cr0-tests" \
    'python -m pytest tests/simulator/test_install_boot_entry_cr0.py -v'

register_suite "ns-slot-dynamic-tests" \
    'node simulator/test_ns_slot_dynamic.js'

register_suite "rogue-namespace-slot-tests" \
    'node simulator/test_rogue_namespace_slots.js'

register_suite "ns-slot-policy-restore-tests" \
    'node simulator/test_ns_slot_policy_restore.js'

register_suite "ns-slot-modal-persist-tests" \
    'node simulator/test_ns_slot_modal_persist.js'

register_suite "thread-instance-zone-tests" \
    'node simulator/test_thread_instance_zones.js'

register_suite "warning-panel-tests" \
    'node simulator/test_asm_warning_panel.js'

register_suite "live-lump-validation-tests" \
    'node simulator/test_live_lump_validations.js'

register_suite "docs-search-figures-tests" \
    'node simulator/test_docs_search_figures.js'

register_suite "bare-space-ns-fallback-tests" \
    'node simulator/test_bare_space_ns_fallback.js'

register_suite "openin-links-tests" \
    'node simulator/test_openin_links.js'

register_suite "open-lump-freshness-tests" \
    'node simulator/test_open_lump_freshness.js'

register_suite "artifact-link-tests" \
    'node simulator/test_artifact_link.js'

register_suite "lump-warning-tests" \
    'node simulator/lump_warning_test.js && node simulator/test_lump_audit_jump.js'

register_suite "disasm-panel-tests" \
    'node simulator/disasm_panel_test.js'

register_suite "lump-dir-disasm-tooltip-tests" \
    'node simulator/test_lump_dir_disasm_tooltip.js'

register_suite "hex-tab-fill-path-tests" \
    'node simulator/test_hex_tab_fill_path.js'

register_suite "wukong-toolbar-btn-tests" \
    'node simulator/test_wukong_toolbar_btn.js'

register_suite "hw-trace-live-movable-tests" \
    'node simulator/test_hw_trace_live_movable.js'

register_suite "execution-identity-tests" \
    'node simulator/test_execution_identity.js'

register_suite "step-settings-popover-tests" \
    'node simulator/test_step_settings_popover.js'

register_suite "cmd-click-boot-push-tests" \
    'node simulator/test_cmd_click_boot_push.js'

register_suite "rci-threading-tests" \
    'node simulator/test_rci_threading.js'

register_suite "pending-gt-tests" \
    'node simulator/test_lazy_resolve_pending.js'

register_suite "selftest-lump-runs" \
    'python -m pytest tests/simulator/test_selftest_lump_runs.py tests/simulator/test_run_lump_boots_slot3.py -v && node tests/simulator/sim_selftest_reboot_midrun.js && node tests/simulator/sim_editor_bfext_migration.js && node tests/simulator/sim_clist_pola_cleanup.js'

register_suite "call-cr6-l-perm-tests" \
    'node tests/simulator/sim_call_cr6_l_perm.js'

register_suite "return-cr6-l-perm-tests" \
    'node tests/simulator/sim_return_cr6_l_perm.js'

register_suite "load-through-l-perm-cr6-tests" \
    'node tests/simulator/sim_load_through_l_perm_cr6.js'

register_suite "return-cr14-trace-tests" \
    'node simulator/test_return_cr14_trace.js'

register_suite "wukong-cr-update-tests" \
    'node simulator/test_wukong_cr_update.js'

register_suite "wukong-hw-fault-tests" \
    'node simulator/test_wukong_hw_fault.js'

register_suite "wukong-reconnect-halt-badge-tests" \
    'node simulator/test_wukong_reconnect_halt_badge.js'

register_suite "wukong-turing-filter-badge-tests" \
    'node simulator/test_wukong_turing_filter_badge.js'

register_suite "wukong-console-warning-tests" \
    'node simulator/test_wukong_console_warning.js'

register_suite "wukong-health-strip-church-only-tests" \
    'node simulator/test_wukong_health_strip_church_only.js'

register_suite "wukong-trace-cr-server-tests" \
    'python3 -m pytest tests/server/test_wukong_trace_cr_update.py -v'

register_suite "return-fetch-lump-tests" \
    'node tests/simulator/sim_return_fetch_lump.js'

register_suite "boot-gt-words-tests" \
    'node simulator/test_boot_gt_words.js'

register_suite "trace-packet-execution-tests" \
    'node simulator/test_trace_packet_execution.js'

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

register_suite "boot-entry-hw-image-tests" \
    'python -m pytest tests/boot/test_boot_entry_hardware_image.py -v'

register_suite "version-telemetry-tests" \
    'python3 -m pytest tests/server/test_version_telemetry.py -v'

register_suite "compile-api-tests" \
    'python3 -m pytest tests/server/test_compile_api.py -v'

register_suite "docs-artifact-link-tests" \
    'python -m pytest tests/server/test_docs_artifact_links.py -v'

register_suite "wukong-status-readonly-tests" \
    'python3 -m pytest tests/server/test_wukong_status_readonly.py -v'

register_suite "wukong-turing-filter-server-tests" \
    'python3 -m pytest tests/server/test_wukong_turing_filter.py -v'

register_suite "pipeline-health-status-tests" \
    'python3 -m pytest tests/server/test_pipeline_health_status_fields.py -v'

register_suite "bitstream-version-labeling-tests" \
    'python3 -m pytest tests/server/test_bitstream_version_labeling.py -v'

register_suite "pipeline-health-stages-tests" \
    'node simulator/test_pipeline_health_stages.js'

register_suite "deep-dive-annotations-tests" \
    'node simulator/test_deep_dive_annotations.js'

register_suite "versions-view-tests" \
    'python3 -m pytest tests/server/test_versions_view_fields.py -v'

register_suite "hardware-sim" \
    'python -m hardware.test_mwin_seal && python -m hardware.test_outform_mode2 && python -m hardware.test_shift_ops && python -m hardware.test_irq_dispatch && python -m hardware.test_tperm'

register_suite "boot-rom-no-false-halt" \
    'python -m pytest hardware/test_boot_rom_no_false_halt.py tests/hardware/test_boot_rom_no_false_halt.py -v'

register_suite "wukong-boot-rom-guard" \
    'python -m pytest tests/hardware/test_wukong_boot_rom_guard.py -v'

register_suite "e2e-tests" \
    'CHROMIUM=$(which chromium) && mkdir -p .cache/ms-playwright/chromium-1217/chrome-linux64 && ln -sf "$CHROMIUM" .cache/ms-playwright/chromium-1217/chrome-linux64/chrome && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npx --yes playwright test'

register_suite "sync-guard-tests" \
    'node scripts/test_sync_guard.js'

register_suite "port-collision-test" \
    'node scripts/test_port_collision.js'

register_suite "playwright-port-wiring" \
    'node scripts/test_playwright_port_wiring.js'

register_suite "pet-name-memory-tests" \
    'node simulator/test_pet_name_memory.js'

register_suite "wukong-protocol-tests" \
    'python -m pytest scripts/test_wukong_protocol.py -v'

register_suite "sentinel-warning-tests" \
    'python -m pytest scripts/test_sentinel_warning.py -v'

register_suite "check-wukong-hw-init" \
    'python3 scripts/check_wukong_hw_init.py'

register_suite "update-lump-tests" \
    'node scripts/test_update_lump.js'

register_suite "callhome-parser-tests" \
    'python -m pytest scripts/test_callhome_parser.py -v'

register_suite "check-slot-index-leak" \
    'node scripts/check-slot-index-leak.js'

register_suite "check-ns-slot-annotations" \
    'node scripts/check-ns-slot-annotations.js'

register_suite "check-ns-word3-contract" \
    'python3 scripts/check_ns_word3_contract.py'

register_suite "test-check-ns-word3-contract" \
    'python3 -m pytest tests/lump/test_check_ns_word3_contract.py -q'

register_suite "check-ila-probe-names" \
    'python3 scripts/check_ila_probe_names.py'

register_suite "test-check-ila-probe-names" \
    'python3 scripts/test_check_ila_probe_names.py'

register_suite "check-lumps-guard" \
    'python3 scripts/check_lumps_dir_clean.py --selftest'

register_suite "check-sitemap-figure-count" \
    'node scripts/check-sitemap-figure-count.js'

register_suite "check-verilog-rtlil-stale" \
    'python3 scripts/check_verilog_rtlil_stale.py'

register_suite "check-build-lump-sidecar-source" \
    'node scripts/test_build_lump_sidecar_source.js'

register_suite "check-wukong-callhome-divergence" \
    'node scripts/check_wukong_callhome_divergence.js'

register_suite "check-build-lump-clist" \
    'node scripts/check-build-lump-clist.js'

register_suite "build-selftest-lump-syntax" \
    'node scripts/test_build_selftest_lump_syntax.js'

register_suite "check-book-chapters" \
    'python3 scripts/check_book_chapters.py'

register_suite "check-ide-intro-base-path" \
    'node scripts/test_ide_intro_base_path.js'

# ---------------------------------------------------------------------------
# Group registry — map a short group name to a list of suite names
# ---------------------------------------------------------------------------
# Keys are group names; values are space-separated suite name lists.

declare -A ALL_GROUPS

ALL_GROUPS["boot"]="boot-image-matches-sim boot-image-loads-and-boots boot-image-upload-endpoint boot-image-serve-endpoints boot-layout-regression boot-entry-hw-image-tests"

ALL_GROUPS["lump"]="lump-consistency lump-v13-freespace-tests lump-binary-tests wukong-callhome-hw-lump-tests lump-roundtrip editor-roundtrip-tests lump-gt-display-tests update-lump-tests lump-meta-patch-validation-tests"

ALL_GROUPS["simulator"]="fault-recovery-tests lambda-exec-tests assembler-tests catalog-compile-tests rci-threading-tests pending-gt-tests warning-panel-tests bare-space-ns-fallback-tests disasm-panel-tests lump-dir-disasm-tooltip-tests hw-trace-live-movable-tests execution-identity-tests boot-entry-sync-tests install-boot-entry-cr0-tests ns-slot-dynamic-tests rogue-namespace-slot-tests ns-slot-policy-restore-tests ns-slot-modal-persist-tests selftest-lump-runs pet-name-memory-tests lump-builder-dispatch-tests openin-links-tests open-lump-freshness-tests lump-warning-tests call-cr6-l-perm-tests return-cr6-l-perm-tests load-through-l-perm-cr6-tests return-cr14-trace-tests wukong-cr-update-tests wukong-hw-fault-tests wukong-trace-cr-server-tests return-fetch-lump-tests constants-lump-tests"

ALL_GROUPS["checks"]="check-stale-cr7 check-selftest-lump-stale check-capabilities-blocks check-no-ti60-ui check-security-claims check-api-reference-stale check-whats-new-feed wukong-relay-deployment-guard wukong-fault-sentinel callhome-parser-tests check-slot-index-leak check-ila-probe-names test-check-ila-probe-names check-lumps-guard check-ns-word3-contract test-check-ns-word3-contract check-sitemap-figure-count check-verilog-rtlil-stale check-build-lump-sidecar-source check-wukong-callhome-divergence check-build-lump-clist build-selftest-lump-syntax check-book-chapters check-ide-intro-base-path"

ALL_GROUPS["hardware"]="hardware-sim boot-rom-no-false-halt wukong-boot-rom-guard wukong-fault-sentinel"

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
# Lumps-guard snapshot — record server/lumps/ state before any suite runs.
# Verified after all suites complete; fails the run if any file was mutated
# and not restored (prevents canonical SelfTest lump corruption).
# ---------------------------------------------------------------------------
_LUMPS_SNAP="$WORK_DIR/lumps_snap.json"
if ! python3 scripts/check_lumps_dir_clean.py --snapshot "$_LUMPS_SNAP"; then
    echo ""
    echo "STOPPING: lumps-guard could not snapshot server/lumps/ (see error above)."
    echo "Fix the I/O issue, then re-run."
    exit 1
fi

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
    local isolated_lumps=""
    case " ${ALL_GROUPS[hardware]} " in
        *" ${name} "*)
            isolated_lumps="$WORK_DIR/${name}-lumps"
            mkdir -p "$isolated_lumps"
            if [ -d "server/lumps" ]; then
                cp -a server/lumps/. "$isolated_lumps/"
            fi
            ;;
    esac

    # Record wall-clock start time so the progress loop can show elapsed seconds
    date +%s > "$WORK_DIR/${name}.start"


    {
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "  SUITE: $name"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        if [ -n "$isolated_lumps" ]; then
            echo "  [lumps-isolation] using $isolated_lumps"
            CHURCH_TEST_LUMPS_DIR="$isolated_lumps" eval "$cmd"
        else
            eval "$cmd"
        fi
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
# Lumps-guard verify — compare server/lumps/ against the pre-run snapshot.
# Runs after every suite has finished so per-module restore fixtures have had
# a chance to run their teardown.
# ---------------------------------------------------------------------------
if [ -f "$_LUMPS_SNAP" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  POST-RUN: verifying server/lumps/ integrity"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if python3 scripts/check_lumps_dir_clean.py --verify "$_LUMPS_SNAP"; then
        echo "  ✔  lumps-guard PASSED"
        _LUMPS_GUARD_FAILED=0
    else
        echo "  ✘  lumps-guard FAILED"
        _LUMPS_GUARD_FAILED=1
    fi
else
    _LUMPS_GUARD_FAILED=0
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

if [ "$_LUMPS_GUARD_FAILED" -eq 1 ]; then
    FAIL=$((FAIL + 1))
    FAILED_SUITES+=("lumps-guard")
fi

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
