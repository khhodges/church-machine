// simulator/test_wukong_console_warning.js
//
// Regression guard for the stale-bitstream (N_INIT mismatch) warning path:
//   1. hardware/wukong_bridge.py POSTs the "Board bitstream may be stale —
//      N_INIT mismatch" warning to /hardware/wukong/console on mismatch.
//   2. The IDE's _wukongAppendTrace renders {console: text} events as visible
//      text lines in the editor console + HW log (instead of misreading them
//      as trace packets), with warning styling for the N_INIT message.
//   3. Plain console lines (UART banner text) render without warning styling.
//
// Strategy: extract _wukongAppendTrace verbatim from app-run.js and run it
// against a capturing DOM stub (same pattern as test_wukong_hw_fault.js).
//
// Run: node simulator/test_wukong_console_warning.js

'use strict';

const fs   = require('fs');
const path = require('path');

let failures = 0;
function check(name, cond, detail) {
    if (cond) {
        console.log('  PASS  ' + name);
    } else {
        failures++;
        console.log('  FAIL  ' + name + (detail ? '  — ' + detail : ''));
    }
}

// ── 1. Bridge source: mismatch POSTs a console warning ───────────────────────
const BRIDGE_PATH = path.join(__dirname, '..', 'hardware', 'wukong_bridge.py');
const bridgeSrc   = fs.readFileSync(BRIDGE_PATH, 'utf8');

// Locate the N_INIT mismatch branch and assert it POSTs to the console
// endpoint with the stale-bitstream warning text.
const mismatchIdx = bridgeSrc.indexOf('BOOT WARNING: N_INIT mismatch');
check('bridge has N_INIT mismatch branch', mismatchIdx !== -1);
const afterMismatch = bridgeSrc.slice(mismatchIdx, mismatchIdx + 2500);
check('mismatch branch POSTs to /hardware/wukong/console',
      afterMismatch.includes('/hardware/wukong/console'));
check('mismatch console POST carries the stale-bitstream warning text',
      afterMismatch.includes('Board bitstream may be stale') &&
      afterMismatch.includes('N_INIT mismatch'));

// ── 2. IDE: _wukongAppendTrace renders console events ────────────────────────
const APP_RUN_PATH = path.join(__dirname, 'app-run.js');
const appRunSrc    = fs.readFileSync(APP_RUN_PATH, 'utf8');

function extractFunction(src, name) {
    const sig = 'function ' + name + '(';
    const sigIdx = src.indexOf(sig);
    if (sigIdx === -1) throw new Error('Cannot find function: ' + name);
    let i = src.indexOf('{', sigIdx);
    let depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(sigIdx, i + 1);
        }
    }
    throw new Error('Unbalanced braces extracting ' + name);
}

// Capturing DOM element stub.
function makeEl(tag) {
    return {
        tag: tag || 'div',
        className: '',
        children: [],
        text: '',
        childElementCount: 0,
        scrollTop: 0,
        scrollHeight: 0,
        firstElementChild: null,
        appendChild: function(node) {
            this.children.push(node);
            this.childElementCount = this.children.length;
            this.firstElementChild = this.children[0];
            return node;
        },
        removeChild: function(node) {
            const idx = this.children.indexOf(node);
            if (idx !== -1) this.children.splice(idx, 1);
            this.childElementCount = this.children.length;
            this.firstElementChild = this.children[0] || null;
        },
        cloneNode: function() {
            const c = makeEl(this.tag);
            c.className = this.className;
            c.text = this.text;
            c.children = this.children.slice();
            return c;
        },
    };
}

const editorConsole = makeEl('div');
const hwLogBody     = makeEl('div');

global.document = {
    getElementById: function(id) {
        if (id === 'editorConsole')      return editorConsole;
        if (id === 'wukong-hw-log-body') return hwLogBody;
        return null;
    },
    createElement: function(tag) { return makeEl(tag); },
    createTextNode: function(t) { return { text: t, cloneNode: function() { return this; } }; },
};
global.window = {};
global.sim = null;   // console path must return before any sim usage

// Stubs for trace-path helpers (must NOT be reached by console events).
let tracePathTouched = false;
global._wukongSetHwCursor          = function() { tracePathTouched = true; };
global._wukongSyncFaultDisasmPanel = function() { tracePathTouched = true; };
global._wukongPrevFaultValid = false;
global._wukongHwFaulted      = false;
global._wukongCallDepth      = 0;

const appendSrc = extractFunction(appRunSrc, '_wukongAppendTrace');
// eslint-disable-next-line no-eval
eval('global._wukongAppendTrace = ' + appendSrc);

function lineText(node) {
    // A line element's text lives in its appended text nodes.
    return (node.children || []).map(c => c.text || '').join('') + (node.text || '');
}

// Feed the exact warning event the bridge produces on N_INIT mismatch.
const WARN_TEXT = '\u26A0 Board bitstream may be stale — N_INIT mismatch ' +
                  '(board sent 0x41, expected 0x42). Reflash the bitstream.';
_wukongAppendTrace({ console: WARN_TEXT, ts: 1234.5, seq: 7 });

check('warning appended to editorConsole', editorConsole.children.length === 1);
check('warning appended to HW log panel', hwLogBody.children.length === 1);
if (editorConsole.children.length === 1) {
    const node = editorConsole.children[0];
    check('warning text visible in console',
          lineText(node).includes('Board bitstream may be stale') &&
          lineText(node).includes('N_INIT mismatch'),
          'got: ' + JSON.stringify(lineText(node)));
    check('warning line has warning styling',
          /wukong-console-warn/.test(node.className),
          'className=' + node.className);
}
check('console event did not enter the trace-rendering path', !tracePathTouched);

// Plain console line (UART banner) renders without warning styling.
_wukongAppendTrace({ console: 'Wukong CM boot banner', ts: 1235.0, seq: 8 });
check('plain console line appended', editorConsole.children.length === 2);
if (editorConsole.children.length === 2) {
    const node = editorConsole.children[1];
    check('plain line has no warning styling',
          !/wukong-console-warn/.test(node.className),
          'className=' + node.className);
    check('plain line text visible',
          lineText(node).includes('Wukong CM boot banner'));
}

console.log(failures === 0
    ? '\nAll wukong-console-warning tests passed.'
    : '\n' + failures + ' test(s) FAILED.');
process.exit(failures === 0 ? 0 : 1);
