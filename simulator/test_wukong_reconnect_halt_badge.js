// simulator/test_wukong_reconnect_halt_badge.js
//
// Regression guard: the IDE halt badge (flag-status-halted on the machine-status
// chip) must be cleared when a fresh snapshot arrives after a board reconnect and
// the snapshot indicates the board is NOT halted (step_halted=false in RTL terms),
// and must remain visible when the board IS halted (step_halted=true / hw fault).
//
// Background
// ----------
// The bridge sends 'r' (run) immediately followed by 'q' (snapshot request) on
// every sentinel detection.  This guarantees the IDE receives a fresh register
// dump after a reconnect.  Without a corresponding fix on the IDE side, a stale
// sim.halted=true (left over from a previous software simulation session) would
// continue to add the flag-status-halted CSS class to the status chip even when
// the hardware board is live and running — because the old formula was:
//
//   const statusHalted = _hwFaulted || sim.halted;   // ← WRONG when hw is live
//
// The fixed formula (app-memory.js updateFlagsDisplay):
//
//   const statusHalted = _hwFaulted || (!_hwConnected && sim.halted);
//
// Key rule: sim.halted is a software-simulator concept. When hardware is live
// (_hwConnected=true), only _hwFaulted drives the halted chip. sim.halted is
// only consulted when no board is connected.
//
// Run: node simulator/test_wukong_reconnect_halt_badge.js

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Load production source for source-level regression checks ────────────────
const APP_MEMORY_PATH = path.join(__dirname, 'app-memory.js');
const appMemorySrc    = fs.readFileSync(APP_MEMORY_PATH, 'utf8');

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log('PASS ' + label);
        passed++;
    } else {
        console.log('FAIL ' + label + (detail != null ? ' — ' + detail : ''));
        failed++;
    }
}

// ── Production formula (mirrored from app-memory.js updateFlagsDisplay) ──────
//
// The test inlines the decision so it is independent of DOM wiring, but a
// source-level check below confirms the production file has the same formula.
//
function computeStatusHalted(hwConnected, hwFaulted, simHalted) {
    return hwFaulted || (!hwConnected && simHalted);
}

function computeStatusLabel(hwConnected, hwFaulted, simHalted, simBootComplete) {
    if (hwConnected) {
        return hwFaulted ? 'HW FAULTED' : 'HW RUNNING';
    }
    return simHalted ? 'HALTED' : (simBootComplete ? 'READY' : 'RESET');
}

// ── T1: Reconnect + step_halted=false → badge hidden ─────────────────────────
// Scenario: simulator was previously halted (sim.halted=true).  Board reconnects;
// bridge sends 'r' (run) then 'q' (snapshot).  Snapshot has no fault
// (step_halted=false in RTL ≡ _hwFaulted=false in IDE).  Badge must be hidden.
{
    const hwConnected = true;
    const hwFaulted   = false;   // board running — step_halted=0 after 'r' command
    const simHalted   = true;    // stale state from a previous software sim run

    const halted = computeStatusHalted(hwConnected, hwFaulted, simHalted);
    const label  = computeStatusLabel(hwConnected, hwFaulted, simHalted, true);

    assert('T1a: reconnect+step_halted=false — statusHalted is false (badge hidden)',
        halted === false,
        'statusHalted=' + halted);

    assert('T1b: reconnect+step_halted=false — label is HW RUNNING (not HALTED)',
        label === 'HW RUNNING',
        'label=' + label);
}

// ── T2: Reconnect + step_halted=true (fault active) → badge visible ───────────
// Scenario: board reconnects but a fault trace event arrives
// (fault_valid=true → _hwFaulted=true).  Badge must be visible.
{
    const hwConnected = true;
    const hwFaulted   = true;    // fault active — step_halted=1 in RTL
    const simHalted   = false;

    const halted = computeStatusHalted(hwConnected, hwFaulted, simHalted);
    const label  = computeStatusLabel(hwConnected, hwFaulted, simHalted, true);

    assert('T2a: reconnect+step_halted=true — statusHalted is true (badge visible)',
        halted === true,
        'statusHalted=' + halted);

    assert('T2b: reconnect+step_halted=true — label is HW FAULTED',
        label === 'HW FAULTED',
        'label=' + label);
}

// ── T3: No hardware, simulator halted → badge visible (preserve existing UX) ──
{
    const hwConnected = false;
    const hwFaulted   = false;
    const simHalted   = true;

    const halted = computeStatusHalted(hwConnected, hwFaulted, simHalted);
    const label  = computeStatusLabel(hwConnected, hwFaulted, simHalted, true);

    assert('T3a: hw disconnected + sim halted — badge visible',
        halted === true,
        'statusHalted=' + halted);

    assert('T3b: hw disconnected + sim halted — label is HALTED',
        label === 'HALTED',
        'label=' + label);
}

// ── T4: No hardware, simulator running → badge hidden ────────────────────────
{
    const hwConnected = false;
    const hwFaulted   = false;
    const simHalted   = false;

    const halted = computeStatusHalted(hwConnected, hwFaulted, simHalted);
    const label  = computeStatusLabel(hwConnected, hwFaulted, simHalted, true);

    assert('T4a: hw disconnected + sim running — badge hidden',
        halted === false,
        'statusHalted=' + halted);

    assert('T4b: hw disconnected + sim running — label is READY',
        label === 'READY',
        'label=' + label);
}

// ── T5: Hardware fault active, sim also halted → fault dominates ──────────────
// Both signals set: only _hwFaulted matters when hw is live.
{
    const hwConnected = true;
    const hwFaulted   = true;
    const simHalted   = true;

    const halted = computeStatusHalted(hwConnected, hwFaulted, simHalted);

    assert('T5: hw fault + sim halted — badge visible (fault dominates)',
        halted === true,
        'statusHalted=' + halted);
}

// ── T6: Full reconnect state machine ─────────────────────────────────────────
// Walk through the complete lifecycle: board starts halted, disconnects, then
// reconnects with a clean (non-fault) snapshot.
{
    // Phase 1 — Board was left halted from prior session; user restarts the IDE.
    // Hardware disconnected, simulator reflects last known halted state.
    let hwConnected = false;
    let hwFaulted   = false;
    let simHalted   = true;

    assert('T6a: pre-reconnect — badge visible (stale halted state)',
        computeStatusHalted(hwConnected, hwFaulted, simHalted) === true);

    // Phase 2 — Bridge detects sentinel; sends 'r' (run) then 'q' (snapshot).
    // _wukongHwFaulted is cleared on disconnect; stays false after 'r'.
    // Events arrive; _wukongIsConnected() → true.
    hwConnected = true;
    hwFaulted   = false;   // cleared on disconnect, not re-set by 'r' snapshot

    assert('T6b: post-reconnect snapshot step_halted=false — badge hidden',
        computeStatusHalted(hwConnected, hwFaulted, simHalted) === false);

    assert('T6c: post-reconnect — label is HW RUNNING (not HALTED)',
        computeStatusLabel(hwConnected, hwFaulted, simHalted, true) === 'HW RUNNING');

    // Phase 3 — A hardware fault occurs while running.
    hwFaulted = true;

    assert('T6d: fault arrives while connected — badge visible',
        computeStatusHalted(hwConnected, hwFaulted, simHalted) === true);

    // Phase 4 — Fault is cleared (board rebooted via 'f' command).
    hwFaulted = false;

    assert('T6e: fault cleared — badge hidden again',
        computeStatusHalted(hwConnected, hwFaulted, simHalted) === false);
}

// ── T7: sim.halted=false at reconnect — badge always hidden ──────────────────
// Confirms the formula also works when sim was not halted (the common clean path).
{
    const hwConnected = true;
    const hwFaulted   = false;
    const simHalted   = false;

    assert('T7: clean reconnect (sim not halted) — badge hidden',
        computeStatusHalted(hwConnected, hwFaulted, simHalted) === false);
}

// ── T8: Source-level regression guard ─────────────────────────────────────────
// Confirm app-memory.js uses the correct formula so a future edit cannot silently
// reintroduce the bug by reverting to the old `_hwFaulted || sim.halted` form.
{
    // The fixed formula must appear verbatim in the production source.
    const fixedFormula = '_hwFaulted || (!_hwConnected && sim.halted)';
    assert('T8a: app-memory.js statusHalted uses hw-scoped formula',
        appMemorySrc.includes(fixedFormula),
        'formula not found: ' + fixedFormula);

    // The old, unconditional formula must NOT appear.
    // We check for the assignment form to avoid matching any comment that
    // might legitimately document the old behaviour.
    const oldFormula = 'const statusHalted = _hwFaulted || sim.halted;';
    assert('T8b: app-memory.js does NOT use the unconditional old formula',
        !appMemorySrc.includes(oldFormula),
        'old formula still present — revert was not applied');
}

// ── T9: 'f' command write_ok=true → badge hidden synchronously ───────────────
// Scenario: board is halted with an active hardware fault.  User clicks the
// ↺ Reboot button in the hardware fault panel (calls _wukongHwFaultReset).
// When the bridge confirms write_ok=true the IDE clears _wukongHwFaulted
// immediately — the badge must hide without waiting for the next poll cycle.
{
    // Phase 1 — active hardware fault; badge visible.
    let hwFaulted   = true;
    const hwConnected = true;
    const simHalted   = false;

    assert('T9a: active hw fault — badge visible before write_ok',
        computeStatusHalted(hwConnected, hwFaulted, simHalted) === true,
        'statusHalted=' + computeStatusHalted(hwConnected, hwFaulted, simHalted));

    assert('T9b: active hw fault — label is HW FAULTED',
        computeStatusLabel(hwConnected, hwFaulted, simHalted, true) === 'HW FAULTED',
        'label=' + computeStatusLabel(hwConnected, hwFaulted, simHalted, true));

    // Phase 2 — write_ok=true received from _wukongWatchDelivery.
    // _wukongHwFaultReset() sets _wukongHwFaulted = false immediately.
    hwFaulted = false;

    assert('T9c: write_ok=true — badge hidden synchronously',
        computeStatusHalted(hwConnected, hwFaulted, simHalted) === false,
        'statusHalted=' + computeStatusHalted(hwConnected, hwFaulted, simHalted));

    assert('T9d: write_ok=true — label is HW RUNNING (board rebooting cleanly)',
        computeStatusLabel(hwConnected, hwFaulted, simHalted, true) === 'HW RUNNING',
        'label=' + computeStatusLabel(hwConnected, hwFaulted, simHalted, true));
}

// ── T10: Source-level guard — _wukongHwFaultReset clears flag on write_ok ────
// Confirm the production source wires the write_ok=true delivery path to an
// immediate _wukongHwFaulted clear so a future edit cannot silently skip it.
{
    const appRunSrc = fs.readFileSync(
        path.join(__dirname, 'app-run.js'), 'utf8');

    // Function must exist.
    const fnIdx = appRunSrc.indexOf('async function _wukongHwFaultReset(');
    assert('T10a: _wukongHwFaultReset function present in app-run.js',
        fnIdx !== -1,
        '_wukongHwFaultReset not found');

    // Extract the function body and verify the flag is cleared inside it.
    const fnBody = fnIdx !== -1
        ? appRunSrc.slice(fnIdx, appRunSrc.indexOf('\n}', fnIdx) + 2)
        : '';

    assert('T10b: _wukongHwFaultReset clears _wukongHwFaulted inside the function',
        fnBody.indexOf('_wukongHwFaulted') !== -1 && fnBody.indexOf('false') !== -1,
        'flag clear not found in _wukongHwFaultReset body');

    assert('T10c: _wukongHwFaultReset sends the "f" command',
        fnBody.indexOf("'f'") !== -1,
        '"f" command not found in _wukongHwFaultReset body');

    // The Reboot button in _wukongShowFaultPanel must call _wukongHwFaultReset.
    assert('T10d: _wukongShowFaultPanel wires a button to _wukongHwFaultReset',
        appRunSrc.indexOf('_wukongHwFaultReset()') !== -1,
        '_wukongHwFaultReset() call site not found');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
console.log((passed + failed) + ' tests: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
