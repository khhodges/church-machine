// DOM regression coverage for the movable, simulator-follow HW Trace window.
//
// Run: node simulator/test_hw_trace_live_movable.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const appRun = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const appShell = fs.readFileSync(path.join(__dirname, 'app-shell.js'), 'utf8');
const startMarker = '// Simulator-follow is deliberately separate from the hardware cursor';
const endMarker = '\n\n// ── Pipeline health strip';
const start = appRun.indexOf(startMarker);
const end = appRun.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('Unable to extract HW Trace live-window source');
const LIVE_WINDOW_SRC = appRun.slice(start, end);
const appendStart = appRun.indexOf('function _wukongAppendTrace(data) {');
const appendEnd = appRun.indexOf('\n\n// ── Board-command helpers', appendStart);
if (appendStart < 0 || appendEnd < 0) throw new Error('Unable to extract HW Trace append source');
const HARDWARE_APPEND_SRC = appRun.slice(appendStart, appendEnd);

let passed = 0;
let failed = 0;
function check(name, condition) {
    if (condition) {
        passed++;
        console.log('  PASS ' + name);
    } else {
        failed++;
        console.error('  FAIL ' + name);
    }
}

function makeEnv(savedLayout) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'https://example.test/simulator/',
        runScripts: 'outside-only',
    });
    Object.defineProperty(dom.window, 'innerWidth', { value: 900, writable: true, configurable: true });
    Object.defineProperty(dom.window, 'innerHeight', { value: 700, writable: true, configurable: true });
    if (savedLayout) dom.window.localStorage.setItem('wukongHwTraceLayout', savedLayout);

    const raf = [];
    const cancelled = new Set();
    const sandbox = {
        window: dom.window,
        document: dom.window.document,
        localStorage: dom.window.localStorage,
        setTimeout,
        clearTimeout,
        requestAnimationFrame(fn) {
            const id = raf.length + 1;
            raf.push({ id, fn });
            return id;
        },
        cancelAnimationFrame(id) { cancelled.add(id); },
        _WUKONG_HW_LOG_MAX: 300,
        sim: {
            stepCount: 0,
            physicalPC: 0,
            opName(opcode) { return ['LOAD', 'SAVE', 'CALL'][opcode] || 'OP' + opcode; },
            condName() { return ''; },
        },
        assembler: {
            disassemble(raw) { return 'WORD 0x' + (raw >>> 0).toString(16).toUpperCase(); },
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(LIVE_WINDOW_SRC, sandbox, { filename: 'app-run.live-window.js' });
    vm.runInContext(HARDWARE_APPEND_SRC, sandbox, { filename: 'app-run.hardware-append.js' });
    sandbox._raf = raf;
    sandbox._cancelled = cancelled;
    sandbox.flushFrames = function() {
        const pending = raf.splice(0);
        pending.forEach(function(frame) {
            if (!cancelled.has(frame.id)) frame.fn();
        });
    };
    return sandbox;
}

function mouse(win, target, type, x, y) {
    target.dispatchEvent(new win.MouseEvent(type, {
        bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y,
    }));
}

// The injected controls are explicit, accessible, and present before any board
// connection arrives.
(function() {
    const env = makeEnv();
    const doc = env.document;
    check('LT-1a drag handle is present', !!doc.getElementById('wukong-hw-log-drag-handle'));
    check('LT-1b resize grip is present', !!doc.getElementById('wukong-hw-log-resize-grip'));
    check('LT-1c follow control is opt-in and labelled',
        doc.getElementById('wukong-hw-follow-toggle').checked === false &&
        /Follow simulator/.test(doc.body.textContent));
    check('LT-1d accessible controls expose move/resize labels',
        /Move HW Trace/.test(doc.getElementById('wukong-hw-log-drag-handle').getAttribute('aria-label')) &&
        /Resize HW Trace/.test(doc.getElementById('wukong-hw-log-resize-grip').getAttribute('aria-label')));
    check('LT-1e identity strip is present without changing trace controls',
        !!doc.getElementById('executionIdentityHwTrace') &&
        /Execution identity: unverified/.test(
            doc.getElementById('executionIdentityHwTrace').getAttribute('aria-label') || ''));
    const panel = doc.getElementById('wukong-hw-log');
    check('LT-1f fresh layout opens centrally with room to grow',
        parseFloat(panel.style.left) > 8 && parseFloat(panel.style.top) > 8 &&
        parseFloat(panel.style.left) + parseFloat(panel.style.width) < env.window.innerWidth - 8 &&
        parseFloat(panel.style.top) + parseFloat(panel.style.height) < env.window.innerHeight - 8);
    const header = doc.getElementById('wukong-hw-log-hdr');
    const collapse = doc.getElementById('wukong-hw-log-collapse');
    header.click();
    check('LT-1g title-bar click still collapses without a drag',
        doc.getElementById('wukong-hw-log-body').style.display === 'none');
    collapse.click();
    check('LT-1h collapse button expands without starting a drag',
        doc.getElementById('wukong-hw-log-body').style.display !== 'none');
})();

// Dragging, resizing, and reload restoration retain a bounded usable layout.
(function() {
    const env = makeEnv();
    const doc = env.document;
    const panel = doc.getElementById('wukong-hw-log');
    const drag = doc.getElementById('wukong-hw-log-drag-handle');
    const header = doc.getElementById('wukong-hw-log-hdr');
    const grip = doc.getElementById('wukong-hw-log-resize-grip');
    const initialWidth = parseFloat(panel.style.width);
    mouse(env.window, grip, 'mousedown', 0, 0);
    mouse(env.window, doc, 'mousemove', 80, 45);
    mouse(env.window, doc, 'mouseup', 80, 45);
    check('LT-2a untouched panel grows from its initial position',
        parseFloat(panel.style.width) > initialWidth);

    mouse(env.window, header, 'mousedown', 20, 20);
    mouse(env.window, doc, 'mousemove', 160, 90);
    mouse(env.window, doc, 'mouseup', 160, 90);
    check('LT-2b title bar drag moves panel within viewport',
        parseFloat(panel.style.left) >= 8 && parseFloat(panel.style.top) >= 8);
    check('LT-2b1 title text remains an accessible move handle', !!drag);
    const saved = env.window.localStorage.getItem('wukongHwTraceLayout');
    check('LT-2c resized and moved layout is persisted', !!saved && /"width"/.test(saved));

    const restored = makeEnv(saved);
    const restoredPanel = restored.document.getElementById('wukong-hw-log');
    check('LT-2d persisted layout restores defensively',
        parseFloat(restoredPanel.style.left) === parseFloat(panel.style.left) &&
        parseFloat(restoredPanel.style.width) === parseFloat(panel.style.width));

    restored.window.innerWidth = 320;
    restored.window.innerHeight = 230;
    restored.window.dispatchEvent(new restored.window.Event('resize'));
    check('LT-2e narrow viewport clamps dimensions and position',
        parseFloat(restoredPanel.style.left) >= 8 &&
        parseFloat(restoredPanel.style.top) >= 8 &&
        parseFloat(restoredPanel.style.width) <= 304 &&
        parseFloat(restoredPanel.style.height) <= 214);
    check('LT-2f viewport clamp does not overwrite saved desktop geometry',
        restored.window.localStorage.getItem('wukongHwTraceLayout') === saved);
    restored.window.innerWidth = 900;
    restored.window.innerHeight = 700;
    restored.window.dispatchEvent(new restored.window.Event('resize'));
    check('LT-2g wider viewport restores the preferred saved geometry',
        parseFloat(restoredPanel.style.left) === parseFloat(panel.style.left) &&
        parseFloat(restoredPanel.style.width) === parseFloat(panel.style.width));
})();

// Follow mode must not render when disabled, batch rapid steps, retain the
// latest instruction, bound its own history, and coexist with a HW row.
(function() {
    const env = makeEnv();
    const doc = env.document;
    const body = doc.getElementById('wukong-hw-log-body');
    const toggle = doc.getElementById('wukong-hw-follow-toggle');
    const latest = doc.getElementById('wukong-hw-follow-current');
    const step = function(n) {
        env.sim.stepCount = n;
        env.window._wukongRecordSimulatorStep({
            physicalPC: n,
            instr: { opcode: 2, cond: 14, raw: 0x12000000 + n },
            desc: 'CALL',
        });
    };

    step(1);
    check('LT-3a disabled follow ignores simulator steps',
        body.querySelectorAll('.wukong-sim-trace').length === 0 &&
        /waiting/.test(latest.textContent));

    toggle.checked = true;
    toggle.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    for (let i = 0; i < 260; i++) step(i);
    check('LT-3b rapid steps schedule one batched render', env._raf.length === 1);
    check('LT-3c latest simulator instruction is immediate',
        /NIA 0x00000103/.test(latest.textContent));
    env.flushFrames();
    check('LT-3d bounded simulator history is rendered',
        body.querySelectorAll('.wukong-sim-trace').length === 200);
    check('LT-3e simulator rows carry an explicit source label',
        /^SIM:/.test(body.querySelector('.wukong-sim-trace').textContent));

    const hw = doc.createElement('div');
    hw.className = 'wukong-trace-line wukong-hardware-trace';
    hw.dataset.source = 'hardware';
    hw.textContent = 'hardware trace retained';
    body.appendChild(hw);
    step(300);
    env.flushFrames();
    check('LT-3f simulator and hardware rows coexist distinctly',
        !!body.querySelector('.wukong-hardware-trace[data-source="hardware"]') &&
        !!body.querySelector('.wukong-sim-trace'));

    step(301); // queued, then locally clear before its animation frame flushes
    doc.getElementById('wukong-hw-log-clear').click();
    env.flushFrames();
    check('LT-3g clear cancels queued local simulator rendering',
        body.querySelectorAll('.wukong-sim-trace').length === 0);
    check('LT-3h follow status says hardware remains separate',
        /hardware rows remain separate/.test(doc.getElementById('wukong-hw-follow-status').textContent));
})();

check('LT-4 simulator step listener is registered separately from trace recording',
    /sim\.on\('step', _traceRecordStep\)/.test(appShell) &&
    /_wukongRecordSimulatorStep/.test(appShell));

// The hardware label must originate in the real append path, not only in CSS
// generated content or a test fixture that looks like a hardware row.
(function() {
    const env = makeEnv();
    env._wukongAppendTrace({ console: 'bridge connected' });
    const row = env.document.querySelector('.wukong-hardware-trace');
    const source = row && row.querySelector('.wukong-trace-source-label');
    check('LT-5 actual hardware append includes accessible source text',
        !!source && /Hardware trace/.test(source.textContent) &&
        row.dataset.source === 'hardware');
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);