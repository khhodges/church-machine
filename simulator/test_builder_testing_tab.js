'use strict';
// test_builder_testing_tab.js — Unit tests for the "Testing" Builder tab
// Run: node simulator/test_builder_testing_tab.js
//
// Verifies the switchBuilderViewTab('testing') wiring added to app-run.js:
//
//   TT-1  Testing panel exists in the DOM
//   TT-2  Testing tab button exists in the DOM
//   TT-3  Switching to 'testing' makes the panel visible
//   TT-4  Switching to 'testing' hides all other Builder panels
//   TT-5  Switching away from 'testing' hides the testing panel
//   TT-6  Testing tab button gets 'active' class on switch
//   TT-7  Iframe src is NOT set before the tab is first opened (lazy load)
//   TT-8  Iframe src is set to '/fpga' on first switch to 'testing'
//   TT-9  Iframe src is NOT reset on a second switch to 'testing'
//   TT-10 Switching to another tab and back does not reload the iframe

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { JSDOM } = require('jsdom');

// ── Source extraction ─────────────────────────────────────────────────────────

function extractSwitchFn(srcPath) {
    const src = fs.readFileSync(path.resolve(__dirname, srcPath), 'utf8');
    const startMarker = 'function switchBuilderViewTab(tab)';
    const start = src.indexOf(startMarker);
    if (start === -1) throw new Error(startMarker + ' not found in ' + srcPath);
    // Walk braces to find the end of the function body
    let depth = 0;
    let i = src.indexOf('{', start);
    const bodyStart = i;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    return src.slice(start, i + 1);
}

const SWITCH_SRC = extractSwitchFn('app-run.js');

// ── Fixture ───────────────────────────────────────────────────────────────────

function makeEnv() {
    const dom = new JSDOM(`<!DOCTYPE html><body>
        <button class="builder-view-tab active" id="builderViewTab-ti60-connect"></button>
        <button class="builder-view-tab" id="builderViewTab-buildlog"></button>
        <button class="builder-view-tab" id="builderViewTab-lump-thread"></button>
        <button class="builder-view-tab" id="builderViewTab-lump-ns"></button>
        <button class="builder-view-tab" id="builderViewTab-lump-resident"></button>
        <button class="builder-view-tab" id="builderViewTab-versions"></button>
        <button class="builder-view-tab" id="builderViewTab-testing"></button>
        <div id="builderView"       style="display:none;"></div>
        <div id="buildDetailsPanel" style="display:none;"></div>
        <div id="lumpThreadPanel"   style="display:none;"></div>
        <div id="lumpNSPanel"       style="display:none;"></div>
        <div id="lumpResidentPanel" style="display:none;"></div>
        <div id="ti60ConnectPanel"  style="display:block;"></div>
        <div id="versionsPanel"     style="display:none;"></div>
        <div id="testingPanel"      style="display:none;">
            <iframe id="testingIframe"></iframe>
        </div>
    </body>`, { url: 'http://localhost/' });

    const { window } = dom;
    const ctx = vm.createContext({
        window,
        document: window.document,
        localStorage: { setItem() {} },
        // Stubs for optional side-effect calls
        initLumpEditor: undefined,
        initResidentPanel: undefined,
        Ti60Connect: undefined,
        VersionsView: undefined,
    });
    vm.runInContext(SWITCH_SRC, ctx);
    return ctx;
}

// ── Test runner ───────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
function check(label, cond, detail) {
    if (cond) {
        console.log('PASS ' + label);
        pass++;
    } else {
        console.log('FAIL ' + label + (detail !== undefined ? ' — ' + detail : ''));
        fail++;
    }
}

// ── TT-1  Testing panel exists in the DOM ────────────────────────────────────
console.log('\n--- TT-1: Testing panel exists ---');
{
    const ctx = makeEnv();
    const panel = ctx.document.getElementById('testingPanel');
    check('TT-1', panel !== null);
}

// ── TT-2  Testing tab button exists ─────────────────────────────────────────
console.log('\n--- TT-2: Testing tab button exists ---');
{
    const ctx = makeEnv();
    const btn = ctx.document.getElementById('builderViewTab-testing');
    check('TT-2', btn !== null);
}

// ── TT-3  Switching to 'testing' makes the panel visible ─────────────────────
console.log('\n--- TT-3: panel visible after switch ---');
{
    const ctx = makeEnv();
    ctx.switchBuilderViewTab('testing');
    const panel = ctx.document.getElementById('testingPanel');
    check('TT-3', panel.style.display !== 'none', 'display=' + panel.style.display);
}

// ── TT-4  Switching to 'testing' hides all other panels ──────────────────────
console.log('\n--- TT-4: other panels hidden after switch to testing ---');
{
    const ctx = makeEnv();
    // Make ti60Connect visible first (the default)
    ctx.document.getElementById('ti60ConnectPanel').style.display = '';
    ctx.switchBuilderViewTab('testing');
    const others = ['builderView','buildDetailsPanel','lumpThreadPanel',
                    'lumpNSPanel','lumpResidentPanel','ti60ConnectPanel','versionsPanel'];
    let allHidden = true;
    for (const id of others) {
        const el = ctx.document.getElementById(id);
        if (el && el.style.display !== 'none') { allHidden = false; break; }
    }
    check('TT-4', allHidden);
}

// ── TT-5  Switching away from 'testing' hides the testing panel ──────────────
console.log('\n--- TT-5: testing panel hidden after switching away ---');
{
    const ctx = makeEnv();
    ctx.switchBuilderViewTab('testing');
    ctx.switchBuilderViewTab('buildlog');
    const panel = ctx.document.getElementById('testingPanel');
    check('TT-5', panel.style.display === 'none', 'display=' + panel.style.display);
}

// ── TT-6  Testing tab button gets 'active' class ─────────────────────────────
console.log('\n--- TT-6: testing tab button becomes active ---');
{
    const ctx = makeEnv();
    ctx.switchBuilderViewTab('testing');
    const btn = ctx.document.getElementById('builderViewTab-testing');
    check('TT-6', btn.classList.contains('active'), 'classes=' + btn.className);
}

// ── TT-7  Iframe src NOT set before tab opened ───────────────────────────────
console.log('\n--- TT-7: iframe src not set before first open ---');
{
    const ctx = makeEnv();
    const iframe = ctx.document.getElementById('testingIframe');
    check('TT-7', !iframe.dataset.loaded, 'data-loaded=' + iframe.dataset.loaded);
}

// ── TT-8  Iframe src set to '/fpga' on first switch ─────────────────────────
console.log('\n--- TT-8: iframe src set to /fpga on first open ---');
{
    const ctx = makeEnv();
    ctx.switchBuilderViewTab('testing');
    const iframe = ctx.document.getElementById('testingIframe');
    check('TT-8a', iframe.src.endsWith('/fpga'), 'src=' + iframe.src);
    check('TT-8b', iframe.dataset.loaded === '1', 'data-loaded=' + iframe.dataset.loaded);
}

// ── TT-9  Iframe src NOT reset on second switch to 'testing' ─────────────────
console.log('\n--- TT-9: iframe src not reset on second open ---');
{
    const ctx = makeEnv();
    ctx.switchBuilderViewTab('testing');
    const iframe = ctx.document.getElementById('testingIframe');
    // Simulate user navigation inside the iframe (src would differ from '/fpga')
    iframe.src = '/fpga#after-nav';
    ctx.switchBuilderViewTab('buildlog');
    ctx.switchBuilderViewTab('testing');
    check('TT-9', iframe.src.endsWith('/fpga#after-nav'), 'src=' + iframe.src);
}

// ── TT-10 Switching back after another tab does not reload the iframe ─────────
console.log('\n--- TT-10: round-trip through another tab preserves loaded flag ---');
{
    const ctx = makeEnv();
    ctx.switchBuilderViewTab('testing');
    ctx.switchBuilderViewTab('versions');
    ctx.switchBuilderViewTab('testing');
    const iframe = ctx.document.getElementById('testingIframe');
    // data-loaded should still be '1' (not reset)
    check('TT-10', iframe.dataset.loaded === '1', 'data-loaded=' + iframe.dataset.loaded);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
