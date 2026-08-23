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

// ── Relay-mode executable harness ────────────────────────────────────────────
//
// In relay mode the IDE mirrors events from a remote server (lab.cloomc.org).
// Events arrive via the same /hardware/wukong/events endpoint, each stamped
// with relayed=true by the server-side relay worker.  The _wukongDrainEvents()
// loop passes them to _wukongAppendTrace identically to direct-board events.
//
// Tests T11–T14 execute production code paths in a Node vm sandbox with mocked
// DOM, fetch, and clock so we verify the actual state mutations rather than
// re-checking the badge formula in isolation.
//
// ── Sandbox setup ─────────────────────────────────────────────────────────────
const vm = require('vm');
const APP_RUN_PATH = path.join(__dirname, 'app-run.js');
const APP_PY_PATH  = path.join(__dirname, '..', 'server', 'app.py');
const appRunSrc    = fs.readFileSync(APP_RUN_PATH, 'utf8');
const appPySrc     = fs.readFileSync(APP_PY_PATH, 'utf8');

// Generic brace-balanced extractor: finds the first occurrence of `sig` in
// `src` then returns the text from `sig` through the matching closing brace.
function extractFn(src, sig) {
    const i0 = src.indexOf(sig);
    if (i0 === -1) throw new Error('Cannot find: ' + sig);
    let depth = 0, start = -1, end = -1;
    for (let i = i0; i < src.length; i++) {
        if (src[i] === '{') { if (depth === 0) start = i; depth++; }
        else if (src[i] === '}') { if (--depth === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error('Unbalanced braces for: ' + sig);
    return src.slice(i0, end + 1);
}

// Extract a simple scalar `let name = value;` line (handles aligned whitespace).
function extractSimpleLet(src, name) {
    const re = new RegExp('let\\s+' + name + '\\s*=\\s*[^;\\n]+;');
    const m  = src.match(re);
    if (!m) throw new Error('Cannot find let: ' + name);
    return m[0];
}

// Extract a `const name = {...};` or `const name = new Set([...]);` up to the
// first semicolon at brace-depth 0.  Uses regex for the prefix so aligned
// whitespace (e.g. `const _WUKONG_STALE_MS  = 10000;`) is handled correctly.
function extractConstDecl(src, name) {
    const re = new RegExp('const\\s+' + name + '\\s*=\\s*');
    const m  = re.exec(src);
    if (!m) throw new Error('Cannot find const: ' + name);
    const i0       = m.index;
    const valStart = m.index + m[0].length;
    let depth = 0;
    for (let i = valStart; i < src.length; i++) {
        const c = src[i];
        if (c === '{' || c === '[' || c === '(') depth++;
        else if (c === '}' || c === ']' || c === ')') depth--;
        else if (c === ';' && depth === 0) return src.slice(i0, i + 1);
    }
    throw new Error('Cannot parse const: ' + name);
}

// Build a minimal capturing DOM element.
function makeEl() {
    const el = {
        className: '', textContent: '', childElementCount: 0,
        scrollTop: 0, scrollHeight: 0, firstElementChild: null, children: [],
        appendChild(n) {
            this.children.push(n);
            this.childElementCount = this.children.length;
            this.firstElementChild = this.children[0];
            return n;
        },
        removeChild(n) {
            const i = this.children.indexOf(n);
            if (i !== -1) this.children.splice(i, 1);
            this.childElementCount = this.children.length;
            this.firstElementChild = this.children[0] || null;
        },
        cloneNode() {
            const c = makeEl(); c.className = this.className; return c;
        },
        addEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
    };
    return el;
}

// Create a vm context that:
//   • provides all DOM / helper stubs _wukongAppendTrace needs
//   • runs the minimal production declarations (state vars + functions)
//   • exposes var-accessor pairs so the test can read/write let-scope state
function buildTraceCtx() {
    const calls = { updateFlagsDisplay: 0 };
    const hwLog = makeEl();
    const con   = makeEl();

    const ctx = vm.createContext({
        // DOM
        document: {
            getElementById(id) {
                if (id === 'wukong-hw-log-body') return hwLog;
                if (id === 'editorConsole')      return con;
                return null;
            },
            createElement() { return makeEl(); },
            createTextNode(t) { return { text: t, cloneNode() { return this; } }; },
            querySelector() { return null; },
        },
        window: {},
        setTimeout() {},
        // fetch stub — _showLastFaultPanel path calls fetch(); don't await it
        fetch() { return Promise.resolve({ catch() {} }); },
        sim: null,
        // _wukongAppendTrace helper stubs
        _wukongSetHwCursor()          {},
        _wukongSetPipelineHwNIA()     {},
        _wukongSyncFaultDisasmPanel() {},
        _wukongBuildHwFaultObj(d)     { return { faultCode: d.fault_code || 0 }; },
        showFaultModal()              {},
        updateFlagsDisplay()          { calls.updateFlagsDisplay++; },
        _showLastFaultPanel()         {},
        _lastFaultSnapshotDismissed:  false,
        _wukongHideFaultPanel()       {},
        _wukongShowFaultPanel()       {},
        _wukongUpdateCallDepthBadge() {},
        _wukongTraceLocationText()    { return ''; },
        _openCallReturnDrilldown()    {},
        _decodeGtLabel()              { return ''; },
        _wukongUpdateToolbarBtn()     {},
        _wukongFormatEvent()          { return ''; },
        updateCRDisplay()             {},
        _wukongUpdateBtn()            {},
        // poll helper stubs (used by the stale guard block)
        _wukongDrainEvents()          { return Promise.resolve(false); },
    });

    // Build and run the minimal production code in the context.
    // Order matters: state vars → constants → helpers → the main function.
    const prod = [
        extractSimpleLet(appRunSrc, '_wukongLastTraceTs'),
        extractConstDecl(appRunSrc, '_WUKONG_STALE_MS'),
        extractSimpleLet(appRunSrc, '_wukongCallDepth'),
        extractSimpleLet(appRunSrc, '_wukongPrevFaultValid'),
        extractSimpleLet(appRunSrc, '_wukongHwFaulted'),
        extractFn(appRunSrc, 'function _wukongIsConnected('),
        extractConstDecl(appRunSrc, '_WUKONG_FAULT_NAMES'),
        extractConstDecl(appRunSrc, '_WUKONG_EV_TRACE_NAMES'),
        extractConstDecl(appRunSrc, '_WUKONG_EV_HAS_GT_PAYLOAD'),
        'const _WUKONG_HW_LOG_MAX = 300;',
        extractFn(appRunSrc, 'function _wukongFlagsStr('),
        extractFn(appRunSrc, 'function _wukongHex('),
        extractFn(appRunSrc, 'function _wukongAppendTrace('),
        // var accessors so the test can read/write let-scoped state from Node
        'var _getHwFaulted       = function() { return _wukongHwFaulted; };',
        'var _setHwFaulted       = function(v) { _wukongHwFaulted = v; };',
        'var _getPrevFaultValid  = function() { return _wukongPrevFaultValid; };',
        'var _setPrevFaultValid  = function(v) { _wukongPrevFaultValid = v; };',
        'var _getLastTraceTs     = function() { return _wukongLastTraceTs; };',
        'var _setLastTraceTs     = function(v) { _wukongLastTraceTs = v; };',
        'var _callIsConnected    = function() { return _wukongIsConnected(); };',
    ].join('\n');

    vm.runInContext(prod, ctx);
    return { ctx, calls };
}

const { ctx: traceCtx, calls: traceCalls } = buildTraceCtx();

// ── T11: Relay event with fault_valid=false → _wukongHwFaulted stays false ────
// Scenario: relay delivers a trace event ({relayed:true, fault_valid:false}).
// The badge formula drives off _wukongHwFaulted; the relayed field must be
// transparent (no early-return or bypass in _wukongAppendTrace).
{
    const nowSec = Date.now() / 1000;
    // Seed a fresh timestamp so _wukongIsConnected() would return true after drain.
    traceCtx._setLastTraceTs(nowSec);
    // Start with prev=false so false→false doesn't trigger a transition.
    traceCtx._setPrevFaultValid(false);
    traceCtx._setHwFaulted(false);

    // Inject a relayed, clean (non-fault) RESULT event.
    const cleanRelayedEvent = {
        relayed:     true,
        fault_valid: false,
        ev_type:     0x00,  // RESULT — simplest event type; no CALL/RETURN depth logic
        nia:         0x00000140,
        ts:          nowSec,
        seq:         1,
        flags:       0,
    };
    traceCtx._wukongAppendTrace(cleanRelayedEvent);

    assert('T11a: relay clean event — _wukongHwFaulted stays false',
        traceCtx._getHwFaulted() === false,
        '_wukongHwFaulted=' + traceCtx._getHwFaulted());

    assert('T11b: relay clean event — _wukongPrevFaultValid updated to false',
        traceCtx._getPrevFaultValid() === false,
        '_wukongPrevFaultValid=' + traceCtx._getPrevFaultValid());
}

// ── T12: Relay event with fault_valid=true → _wukongHwFaulted set true ────────
// First a false→true transition (new fault from relay), then a true→false clear.
{
    const nowSec = Date.now() / 1000;
    traceCtx._setLastTraceTs(nowSec);
    // prev is currently false (left by T11) — so fault_valid=true fires the transition.
    const faultRelayedEvent = {
        relayed:     true,
        fault_valid: true,
        fault_code:  0x01,  // PERM_R
        ev_type:     0x00,
        nia:         0x00000140,
        ts:          nowSec,
        seq:         2,
        flags:       0,
    };
    traceCtx._wukongAppendTrace(faultRelayedEvent);

    assert('T12a: relay fault event — _wukongHwFaulted set true (badge visible)',
        traceCtx._getHwFaulted() === true,
        '_wukongHwFaulted=' + traceCtx._getHwFaulted());

    assert('T12b: relay fault event — updateFlagsDisplay called',
        traceCalls.updateFlagsDisplay >= 1,
        'updateFlagsDisplay calls=' + traceCalls.updateFlagsDisplay);

    // Fault-clear path: relay delivers a clean event after the fault.
    const clearRelayedEvent = {
        relayed:     true,
        fault_valid: false,
        ev_type:     0x00,
        nia:         0x00000140,
        ts:          nowSec,
        seq:         3,
        flags:       0,
    };
    traceCtx._wukongAppendTrace(clearRelayedEvent);

    assert('T12c: relay fault-clear event — _wukongHwFaulted cleared to false',
        traceCtx._getHwFaulted() === false,
        '_wukongHwFaulted=' + traceCtx._getHwFaulted());
}

// ── T13: Relay goes offline → stale-halt guard clears _wukongHwFaulted ────────
// The guard lives inside the 500 ms setInterval(_wukongPoll) body.  We extract
// that block verbatim from app-run.js, execute it in the same vm context with
// a stale timestamp, and assert the production guard clears the fault flag.
{
    // Phase 1 — simulate: relay was live, board was faulted.
    const recentSec = Date.now() / 1000;
    traceCtx._setLastTraceTs(recentSec);
    traceCtx._setHwFaulted(true);
    traceCtx._setPrevFaultValid(true);

    assert('T13a: pre-stale — _wukongIsConnected()=true',
        traceCtx._callIsConnected() === true);

    assert('T13b: pre-stale — _wukongHwFaulted is true (relay fault visible)',
        traceCtx._getHwFaulted() === true);

    // Phase 2 — relay goes offline: timestamp ages beyond _WUKONG_STALE_MS.
    traceCtx._setLastTraceTs(1);   // epoch — definitely stale (> 10 s ago)

    assert('T13c: post-stale — _wukongIsConnected()=false',
        traceCtx._callIsConnected() === false);

    // Phase 3 — run the production stale-halt guard extracted from setInterval body.
    // We extract the `if (_pollWasConnected && !_wukongIsConnected())` block from
    // the _wukongPoll body and execute it with _pollWasConnected forced to true.
    const pollBodySig  = 'setInterval(async function _wukongPoll()';
    const pollBlockSig = 'if (_pollWasConnected && !_wukongIsConnected())';
    const pollBodyFull = extractFn(appRunSrc, pollBodySig);
    const guardStart   = pollBodyFull.indexOf(pollBlockSig);
    if (guardStart === -1) throw new Error('Cannot find guard block in poll body');
    // Extract from the `if` through its matching closing brace.
    const guardCode = extractFn(pollBodyFull.slice(guardStart), pollBlockSig);

    const updateFlagsBefore = traceCalls.updateFlagsDisplay;
    // Execute with _pollWasConnected=true: the guard fires because
    // _wukongIsConnected() returns false (timestamp is stale).
    vm.runInContext('var _pollWasConnected = true;\n' + guardCode, traceCtx);

    assert('T13d: stale guard executed — _wukongHwFaulted cleared to false',
        traceCtx._getHwFaulted() === false,
        '_wukongHwFaulted=' + traceCtx._getHwFaulted());

    assert('T13e: stale guard executed — _wukongPrevFaultValid cleared',
        traceCtx._getPrevFaultValid() === false,
        '_wukongPrevFaultValid=' + traceCtx._getPrevFaultValid());

    assert('T13f: stale guard executed — updateFlagsDisplay was called',
        traceCalls.updateFlagsDisplay > updateFlagsBefore,
        'calls before=' + updateFlagsBefore + ' after=' + traceCalls.updateFlagsDisplay);
}

// ── T14: Structural source checks ─────────────────────────────────────────────
// Now that the executable harness has verified production behaviour, structural
// checks confirm the guard and relay-stamp are wired into the right branches.
{
    // T14a — the stale-halt clear is INSIDE the disconnect guard conditional,
    // not loose in the module.  Extract the _wukongPoll setInterval body,
    // find the guard block, and verify the clear is within that block.
    const pollBodyFull = extractFn(appRunSrc, 'setInterval(async function _wukongPoll()');
    const guardBlockFn = extractFn(
        pollBodyFull.slice(pollBodyFull.indexOf('if (_pollWasConnected && !_wukongIsConnected())')),
        'if (_pollWasConnected && !_wukongIsConnected())'
    );
    assert('T14a-i: _wukongHwFaulted=false is inside the disconnect guard block',
        guardBlockFn.includes('_wukongHwFaulted      = false;'),
        'clear not found in guard block');

    assert('T14a-ii: updateFlagsDisplay() call is inside the disconnect guard block',
        guardBlockFn.includes('updateFlagsDisplay'),
        'updateFlagsDisplay not in guard block');

    // T14b — server/app.py relay worker stamps every injected event with
    // relayed=True so consumers can distinguish relay from direct events.
    assert('T14b: server/app.py relay worker stamps ev_copy[relayed]=True',
        appPySrc.includes("ev_copy['relayed']    = True"),
        'relay stamp not found in app.py');

    // T14c — _wukongAppendTrace has no data.relayed gate before the fault
    // transition block.  If such a guard existed, relay faults would be silently
    // skipped and _wukongHwFaulted would never be set for relay events.
    const traceFnBody  = extractFn(appRunSrc, 'function _wukongAppendTrace(');
    const faultBlockPos = traceFnBody.indexOf('if (data.fault_valid && !_wukongPrevFaultValid)');
    assert('T14c: fault transition block exists in _wukongAppendTrace',
        faultBlockPos !== -1,
        'fault transition not found');

    const beforeFaultBlock = traceFnBody.slice(0, faultBlockPos);
    // A data.relayed early-return would appear as `if (data.relayed) return;`
    // or `if (ev.relayed) return;` before the fault block.
    const relayedBypass = /if\s*\(\s*(data|ev)\.relayed\s*\)\s*return/.test(beforeFaultBlock);
    assert('T14d: _wukongAppendTrace has no data.relayed bypass before fault transition',
        !relayedBypass,
        'relayed bypass found before fault block');
}
// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
console.log((passed + failed) + ' tests: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
