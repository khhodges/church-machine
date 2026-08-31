// test_step_settings_popover.js — Tests for the Step Settings popover (toolBreakBtn)
//
// Verifies that the red-dot ● button (#toolBreakBtn) correctly opens/closes
// #stepSettingsPopover and that the breakpoint controls (#breakAddrInput,
// #breakList, #breakAtEntryChk, and universal opcode checkboxes) remain present
// and accessible inside the panel.
//
// If this test starts failing it means the toolbar was reorganised and the
// Step Settings panel has become unreachable.
//
// Contracted behaviours:
//   SSP-1  #toolBreakBtn is present in index.html
//   SSP-2  #stepSettingsPopover is present in index.html
//   SSP-3  #breakAddrInput is a descendant of #stepSettingsPopover
//   SSP-4  #breakList is a descendant of #stepSettingsPopover
//   SSP-5  #breakAtEntryChk is a descendant of #stepSettingsPopover
//   SSP-6  toggleStepSettingsPopover() shows the popover (display !== 'none')
//   SSP-7  toggleStepSettingsPopover() called again hides it (display === 'none')
//   SSP-8  aria-expanded on #toolBreakBtn mirrors open/closed state
//   SSP-9  openBreakPopoverAt(addr) opens the popover and pre-fills #breakAddrInput
//   SSP-10 renderBreakList() writes an empty-state message when no breakpoints are set
//   SSP-11 renderBreakList() renders one entry per breakpoint when breakpoints exist
//   SSP-12 universal opcode checkboxes are present and wired into the same panel
//
// Run with:  node simulator/test_step_settings_popover.js
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { JSDOM } = require('jsdom');

// ── Source extraction ──────────────────────────────────────────────────────────
// Pull the contiguous block from `function renderBreakList(` through
// `function addBreakpoint(` (exclusive) out of app-run.js so the tests always
// exercise the real production code.

function extractStepSettingsCode(srcPath) {
    const src = fs.readFileSync(path.resolve(__dirname, srcPath), 'utf8');

    const startMarker = 'function renderBreakList(';
    const endMarker   = 'function addBreakpoint(';

    const start = src.indexOf(startMarker);
    if (start === -1) throw new Error(startMarker + ' not found in ' + srcPath);
    const end = src.indexOf(endMarker, start);
    if (end === -1) throw new Error(endMarker + ' not found after start marker in ' + srcPath);

    return src.slice(start, end);
}

// Verify that the required functions are present in the extracted block.
const STEP_SRC = extractStepSettingsCode('app-run.js');

if (!/function toggleStepSettingsPopover\b/.test(STEP_SRC)) {
    console.error('FATAL: toggleStepSettingsPopover not found in extracted block');
    process.exit(1);
}
if (!/function openBreakPopoverAt\b/.test(STEP_SRC)) {
    console.error('FATAL: openBreakPopoverAt not found in extracted block');
    process.exit(1);
}

// ── HTML fixture ───────────────────────────────────────────────────────────────
// Matches the structure in simulator/index.html lines 388-406.

const FIXTURE_HTML = `<!DOCTYPE html><body>
<div class="step-settings-wrap" id="stepSettingsWrap">
  <button class="btn btn-break sim-icon-btn"
          id="toolBreakBtn"
          onclick="toggleStepSettingsPopover()"
          aria-haspopup="dialog"
          aria-expanded="false"
          data-tooltip="Breakpoint">&#x25CF;</button>
  <div class="step-settings-popover" id="stepSettingsPopover" style="display:none;">
    <div class="step-settings-title">Step Settings
      <button class="step-settings-close" onclick="toggleStepSettingsPopover()" title="Close">&times;</button>
    </div>
    <div class="step-settings-section">
      <div class="step-settings-label">Stepping</div>
      <label class="break-at-entry-label step-settings-entry" id="breakAtEntryLabel">
        <input type="checkbox" id="breakAtEntryChk"> Break at entry
      </label>
       <label><input type="checkbox" id="breakOnAllChurchChk"></label>
    </div>
    <div class="step-settings-section">
      <div class="step-settings-label">Breakpoints</div>
      <div id="breakList" class="break-list"></div>
      <div class="break-add-row">
        <input id="breakAddrInput" class="break-addr-input" type="text"
               placeholder="0x0100" maxlength="8" />
        <button class="btn btn-sm btn-primary">Add</button>
      </div>
      <button class="btn btn-sm break-clear-btn">Clear All</button>
    </div>
  </div>
</div>
</body>`;

// ── HTML structural checks (SSP-1 through SSP-5) ──────────────────────────────
// These validate index.html directly without running any JS.

const indexHtml = fs.readFileSync(
    path.resolve(__dirname, 'index.html'), 'utf8');

const indexDom = new JSDOM(indexHtml);
const idoc     = indexDom.window.document;

// ── Environment factory ────────────────────────────────────────────────────────

function makeEnv() {
    const dom = new JSDOM(FIXTURE_HTML, { runScripts: 'outside-only' });
    const window   = dom.window;
    const document = window.document;

    // jsdom has no focus() on inputs — stub it.
    window.HTMLElement.prototype.focus  = function() {};
    window.HTMLElement.prototype.select = function() {};

    const sandbox = {
        window:   window,
        document: document,
        console:  console,
        // simBreakpoints is a Set used by renderBreakList and addBreakpoint.
        simBreakpoints: new Set(),
        simUniversalBreakpoints: new Set(),
        _universalBreakpointNames: new Map([
            [0, 'LOAD'], [1, 'SAVE'], [2, 'CALL'], [3, 'RETURN'],
            [4, 'CHANGE'], [5, 'SWITCH'], [8, 'ELOADCALL'], [9, 'XLOADCALL'],
        ]),
        _universalBreakpointControls: new Map([
            [0, 'breakOnLoadChk'], [1, 'breakOnSaveChk'],
            [2, 'breakOnCallChk'], [3, 'breakOnReturnChk'],
            [4, 'breakOnChangeChk'], [5, 'breakOnSwitchChk'],
            [6, 'breakOnTpermChk'], [7, 'breakOnLambdaChk'],
            [8, 'breakOnEloadcallChk'], [9, 'breakOnXloadLambdaChk'],
        ]),
        updateBreakpointBtn: function() {},
        updateDashboard: function() {},
        sim: { clearBreakpointResume: function() {} },
    };
    vm.createContext(sandbox);
    vm.runInContext(STEP_SRC, sandbox, { filename: 'app-run.step-settings.js' });
    return sandbox;
}

// ── Tiny test harness ──────────────────────────────────────────────────────────

let passed = 0, failed = 0;
function check(id, desc, cond) {
    if (cond) { passed++; console.log('  PASS ' + id + '  ' + desc); }
    else      { failed++; console.error('  FAIL ' + id + '  ' + desc); }
}

// ── SSP-1  #toolBreakBtn present in index.html ────────────────────────────────
check('SSP-1', '#toolBreakBtn is present in index.html',
    !!idoc.getElementById('toolBreakBtn'));

// ── SSP-2  #stepSettingsPopover present in index.html ─────────────────────────
check('SSP-2', '#stepSettingsPopover is present in index.html',
    !!idoc.getElementById('stepSettingsPopover'));

// ── SSP-3  #breakAddrInput is inside #stepSettingsPopover ─────────────────────
(function() {
    const pop = idoc.getElementById('stepSettingsPopover');
    const inp = idoc.getElementById('breakAddrInput');
    check('SSP-3', '#breakAddrInput is a descendant of #stepSettingsPopover',
        !!pop && !!inp && pop.contains(inp));
})();

// ── SSP-12  Universal Church breakpoint controls stay in the modal ────────────
(function() {
    const pop = idoc.getElementById('stepSettingsPopover');
    const ids = [
        'breakOnAllChurchChk',
        'breakOnLoadChk', 'breakOnSaveChk', 'breakOnCallChk',
        'breakOnReturnChk', 'breakOnChangeChk', 'breakOnSwitchChk',
        'breakOnTpermChk', 'breakOnLambdaChk',
        'breakOnEloadcallChk', 'breakOnXloadLambdaChk',
    ];
    check('SSP-12', 'all universal Church breakpoint checkboxes are in Step Settings',
        !!pop && ids.every(id => {
            const checkbox = idoc.getElementById(id);
            return !!checkbox && pop.contains(checkbox);
        }));
})();

// ── SSP-13  Master control updates every universal breakpoint ────────────────
(function() {
    const env = makeEnv();
    vm.runInContext('setAllUniversalBreakpoints(true);', env);
    check('SSP-13a', 'master control enables every universal opcode',
        env.simUniversalBreakpoints.size === env._universalBreakpointNames.size);
    check('SSP-13b', 'master control reports checked when all are enabled',
        env.document.getElementById('breakOnAllChurchChk').checked === true);
    vm.runInContext('setAllUniversalBreakpoints(false);', env);
    check('SSP-13c', 'master control clears every universal opcode',
        env.simUniversalBreakpoints.size === 0 &&
        env.document.getElementById('breakOnAllChurchChk').checked === false);
})();

// ── SSP-4  #breakList is inside #stepSettingsPopover ──────────────────────────
(function() {
    const pop  = idoc.getElementById('stepSettingsPopover');
    const list = idoc.getElementById('breakList');
    check('SSP-4', '#breakList is a descendant of #stepSettingsPopover',
        !!pop && !!list && pop.contains(list));
})();

// ── SSP-5  #breakAtEntryChk is inside #stepSettingsPopover ───────────────────
(function() {
    const pop = idoc.getElementById('stepSettingsPopover');
    const chk = idoc.getElementById('breakAtEntryChk');
    check('SSP-5', '#breakAtEntryChk is a descendant of #stepSettingsPopover',
        !!pop && !!chk && pop.contains(chk));
})();

// ── SSP-6  toggleStepSettingsPopover() opens the popover ─────────────────────
(function() {
    const env = makeEnv();
    vm.runInContext('toggleStepSettingsPopover();', env);
    const pop = env.document.getElementById('stepSettingsPopover');
    check('SSP-6', 'toggleStepSettingsPopover() → popover becomes visible',
        !!pop && pop.style.display !== 'none');
})();

// ── SSP-7  Second call closes the popover ────────────────────────────────────
(function() {
    const env = makeEnv();
    vm.runInContext('toggleStepSettingsPopover();', env);
    vm.runInContext('toggleStepSettingsPopover();', env);
    const pop = env.document.getElementById('stepSettingsPopover');
    check('SSP-7', 'second toggleStepSettingsPopover() → popover hidden again',
        !!pop && pop.style.display === 'none');
})();

// ── SSP-8  aria-expanded mirrors open/closed state ───────────────────────────
(function() {
    const env = makeEnv();
    const btn = env.document.getElementById('toolBreakBtn');
    check('SSP-8a', 'aria-expanded starts as "false"',
        btn && btn.getAttribute('aria-expanded') === 'false');
    vm.runInContext('toggleStepSettingsPopover();', env);
    check('SSP-8b', 'aria-expanded is "true" when popover is open',
        btn && btn.getAttribute('aria-expanded') === 'true');
    vm.runInContext('toggleStepSettingsPopover();', env);
    check('SSP-8c', 'aria-expanded is "false" when popover is closed again',
        btn && btn.getAttribute('aria-expanded') === 'false');
})();

// ── SSP-9  openBreakPopoverAt(addr) opens popover and pre-fills input ─────────
(function() {
    const env = makeEnv();
    vm.runInContext('openBreakPopoverAt(0x01A0);', env);
    const pop = env.document.getElementById('stepSettingsPopover');
    const inp = env.document.getElementById('breakAddrInput');
    const btn = env.document.getElementById('toolBreakBtn');
    check('SSP-9a', 'openBreakPopoverAt → popover is visible',
        !!pop && pop.style.display !== 'none');
    check('SSP-9b', 'openBreakPopoverAt → #breakAddrInput pre-filled with "0x01A0"',
        !!inp && inp.value.toUpperCase() === '0X01A0');
    check('SSP-9c', 'openBreakPopoverAt → aria-expanded set to "true"',
        !!btn && btn.getAttribute('aria-expanded') === 'true');
})();

// ── SSP-10  renderBreakList() with no breakpoints ─────────────────────────────
(function() {
    const env = makeEnv();
    vm.runInContext('renderBreakList();', env);
    const list = env.document.getElementById('breakList');
    check('SSP-10', 'renderBreakList() with empty Set → empty-state message shown',
        !!list && /no breakpoints/i.test(list.textContent));
})();

// ── SSP-11  renderBreakList() renders one entry per breakpoint ────────────────
(function() {
    const env = makeEnv();
    env.simBreakpoints.add(0x0100);
    env.simBreakpoints.add(0x0200);
    vm.runInContext('renderBreakList();', env);
    const list  = env.document.getElementById('breakList');
    const items = list ? list.querySelectorAll('.break-item') : [];
    check('SSP-11a', 'renderBreakList() with 2 breakpoints → 2 .break-item elements',
        items.length === 2);
    const labels = [...items].map(function(el) {
        return el.querySelector('.break-addr-label')
                ? el.querySelector('.break-addr-label').textContent.toUpperCase()
                : '';
    });
    check('SSP-11b', 'first entry is 0x0100',
        labels.some(function(l) { return /0X0100/.test(l); }));
    check('SSP-11c', 'second entry is 0x0200',
        labels.some(function(l) { return /0X0200/.test(l); }));
})();

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
