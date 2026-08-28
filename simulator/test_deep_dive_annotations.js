// test_deep_dive_annotations.js — Unit tests for Deep Dive LUMP annotation
// renderers added in task #3035.
//
// Tests:
//   DE-1  _ddExtractMethodNames — api_definition.methods as string array
//   DE-2  _ddExtractMethodNames — api_definition.methods as object array
//   DE-3  _ddExtractMethodNames — api_definition present but no methods key
//   DE-4  _ddExtractMethodNames — no api_definition, sidecar methods fallback
//   DE-5  _ddExtractMethodNames — no api_definition, empty sidecar methods
//   DE-6  _ddRenderMethods — renders label + pill buttons for each method
//   DE-7  _ddRenderMethods — pills are <button> elements (keyboard accessible)
//   DE-8  _ddRenderMethods — clicking a pill calls _deepDiveOpenAbstraction
//   DE-9  _ddRenderMethods — zero methods → subdued label (no pills)
//   DE-10 _ddRenderMethods — null (legacy) → "no API definition" label
//   DE-11 _ddRenderMethodsFailed — shows unavailable message
//   DE-12 _ddRenderSource — tier 2 → green badge text + class
//   DE-13 _ddRenderSource — tier 1 → amber badge text + class
//   DE-14 _ddRenderSource — tier 0 → grey badge text + class
//   DE-15 _ddRenderSource — missing tier → grey badge (default)
//   DE-16 _ddRenderSource — badge is a <button> (keyboard accessible)
//   DE-17 _ddRenderSource — clicking badge calls _deepDiveOpenAbstraction
//   DE-18 _ddRenderSourceFailed — clicking badge still calls _deepDiveOpenAbstraction
//   DE-19 _deepDiveOpenAbstraction — calls switchView then showAbstractionDetail
//   DE-20 _deepDiveOpenAbstraction — looks up slot via abstractionRegistry when nsSlot=null
//   DE-21 _buildLumpDeepDiveGraph — empty C-List returns null
//   DE-22 _buildLumpDeepDiveGraph — cyclic dependencies render an amber dashed edge
//   DE-23 _deepDiveLumpForToken — unknown token returns null
//
// Run with:  node simulator/test_deep_dive_annotations.js

'use strict';

const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// ── Extract the annotation helpers from app-lumps.js ─────────────────────────

const SRC_PATH = path.join(__dirname, 'app-lumps.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

const exportMatch = src.match(
    /\/\* ---- DD_ANNOTATIONS_UNIT_TEST_EXPORT_START[\s\S]*?DD_ANNOTATIONS_UNIT_TEST_EXPORT_END ---- \*\//
);
const graphExportMatch = src.match(
    /\/\* ---- DD_GRAPH_UNIT_TEST_EXPORT_START[\s\S]*?DD_GRAPH_UNIT_TEST_EXPORT_END ---- \*\//
);
if (!exportMatch || !graphExportMatch) {
    console.error('FATAL: DD_ANNOTATIONS_UNIT_TEST_EXPORT markers not found in app-lumps.js');
    process.exit(1);
}

// ── Minimal test harness ──────────────────────────────────────────────────────

let passed = 0, failed = 0;
function assert(cond, label) {
    if (cond) { console.log(`  \u2713 ${label}`); passed++; }
    else       { console.error(`  \u2717 ${label}`); failed++; }
}
function section(title) { console.log(`\n--- ${title} ---`); }

// ── Build a test JSDOM + load the helpers in it ───────────────────────────────

function makeEnv(overrides) {
    // overrides: { switchView, showAbstractionDetail, _closeLumpDeepDive, abstractionRegistry, _lumpsCache }
    const dom = new JSDOM('<!DOCTYPE html><body></body>', {
        runScripts: 'dangerously',
    });
    const { window } = dom;

    // Stubs for external functions the helpers call
    window._closeLumpDeepDive      = overrides._closeLumpDeepDive      || (() => {});
    window.switchView              = overrides.switchView              || (() => {});
    window.showAbstractionDetail   = overrides.showAbstractionDetail   || (() => {});
    window.abstractionRegistry     = overrides.abstractionRegistry     || undefined;
    window._lumpsCache             = overrides._lumpsCache             || [];

    // Evaluate the exported block in this window context
    const scriptEl = window.document.createElement('script');
    scriptEl.textContent = graphExportMatch[0];
    window.document.head.appendChild(scriptEl);
    const annotationScriptEl = window.document.createElement('script');
    annotationScriptEl.textContent = exportMatch[0];
    window.document.head.appendChild(annotationScriptEl);

    return window;
}

// ── Helper: build a mock modal with the expected annotation divs ──────────────

function makeMockModal(window) {
    const doc = window.document;
    const modal = doc.createElement('div');
    modal.id = 'lumpDeepDiveModal';

    const methodsDiv = doc.createElement('div');
    methodsDiv.id = 'lumpDeepDiveMethods';
    modal.appendChild(methodsDiv);

    const sourceDiv = doc.createElement('div');
    sourceDiv.id = 'lumpDeepDiveSource';
    modal.appendChild(sourceDiv);

    doc.body.appendChild(modal);
    return modal;
}

// ── DE-1 through DE-5: _ddExtractMethodNames (pure, no DOM) ──────────────────

section('DE-1: api_definition.methods as string[]');
{
    const win = makeEnv({});
    const detail = { api_definition: { methods: ['Connect', 'Send', 'Receive'] } };
    const result = win._ddExtractMethodNames(detail);
    assert(Array.isArray(result), 'returns array');
    assert(result.length === 3, 'length = 3');
    assert(result[0] === 'Connect', 'result[0] = Connect');
    assert(result[2] === 'Receive', 'result[2] = Receive');
}

section('DE-2: api_definition.methods as object[]');
{
    const win = makeEnv({});
    const detail = { api_definition: { methods: [{ name: 'Init' }, { name: 'Run' }] } };
    const result = win._ddExtractMethodNames(detail);
    assert(Array.isArray(result), 'returns array');
    assert(result[0] === 'Init', 'result[0] = Init');
    assert(result[1] === 'Run',  'result[1] = Run');
}

section('DE-3: api_definition present but no methods key');
{
    const win = makeEnv({});
    const detail = { api_definition: { description: 'some api' } };
    const result = win._ddExtractMethodNames(detail);
    assert(Array.isArray(result), 'returns array (not null)');
    assert(result.length === 0, 'length = 0 (definition present, no methods)');
}

section('DE-4: no api_definition, sidecar .methods fallback');
{
    const win = makeEnv({});
    const detail = { methods: [{ name: 'Alpha' }, { name: 'Beta' }] };
    const result = win._ddExtractMethodNames(detail);
    assert(Array.isArray(result), 'returns array from sidecar fallback');
    assert(result[0] === 'Alpha', 'result[0] = Alpha');
    assert(result[1] === 'Beta',  'result[1] = Beta');
}

section('DE-5: no api_definition, empty sidecar methods → null (legacy)');
{
    const win = makeEnv({});
    const result = win._ddExtractMethodNames({});
    assert(result === null, 'returns null for legacy binary with no api_definition');
}

// ── DE-6 through DE-11: _ddRenderMethods (DOM) ───────────────────────────────

section('DE-6: renders label + pill buttons for each method');
{
    const win = makeEnv({});
    const modal = makeMockModal(win);
    const detail = { api_definition: { methods: ['Connect', 'Send'] } };
    win._ddRenderMethods(modal, detail, 3, 'English.Contact');
    const methodsEl = modal.querySelector('#lumpDeepDiveMethods');
    const label = methodsEl.querySelector('.lump-dd-methods-label');
    const pills = methodsEl.querySelectorAll('.lump-dd-method-pill');
    assert(label !== null, 'Methods: label present');
    assert(pills.length === 2, '2 pills rendered');
    assert(pills[0].textContent === 'Connect', 'pill[0] text = Connect');
    assert(pills[1].textContent === 'Send',    'pill[1] text = Send');
}

section('DE-7: pills are <button> elements (keyboard accessible)');
{
    const win = makeEnv({});
    const modal = makeMockModal(win);
    win._ddRenderMethods(modal, { api_definition: { methods: ['Run'] } }, 5, 'SelfTest');
    const pill = modal.querySelector('.lump-dd-method-pill');
    assert(pill !== null, 'pill element exists');
    assert(pill.tagName === 'BUTTON', 'pill is a BUTTON element');
    assert(pill.type === 'button', 'pill type=button (no accidental form submit)');
}

section('DE-8: clicking a pill calls _deepDiveOpenAbstraction with correct args');
{
    let capturedSlot = undefined, capturedName = undefined;
    const win = makeEnv({
        _closeLumpDeepDive: () => {},
        switchView: () => {},
        showAbstractionDetail: (s) => { capturedSlot = s; }
    });
    // Override _deepDiveOpenAbstraction after loading to capture calls
    let ddoaCalled = false, ddoaSlot = undefined, ddoaName = undefined;
    win._deepDiveOpenAbstraction = (slot, name) => {
        ddoaCalled = true; ddoaSlot = slot; ddoaName = name;
    };
    const modal = makeMockModal(win);
    win._ddRenderMethods(modal, { api_definition: { methods: ['Connect'] } }, 7, 'WukongCallHome');
    const pill = modal.querySelector('.lump-dd-method-pill');
    pill.click();
    assert(ddoaCalled, 'clicking pill fires _deepDiveOpenAbstraction');
    assert(ddoaSlot === 7, 'navSlot passed through = 7');
    assert(ddoaName === 'WukongCallHome', 'navName passed through = WukongCallHome');
}

section('DE-9: zero methods → subdued label (no pills)');
{
    const win = makeEnv({});
    const modal = makeMockModal(win);
    win._ddRenderMethods(modal, { api_definition: {} }, null, '');
    const methodsEl = modal.querySelector('#lumpDeepDiveMethods');
    const pills = methodsEl.querySelectorAll('.lump-dd-method-pill');
    const noMethods = methodsEl.querySelector('.lump-dd-no-methods');
    assert(pills.length === 0, 'no pills when methods=[]');
    assert(noMethods !== null, '.lump-dd-no-methods span present');
    assert(noMethods.textContent.includes('No methods declared'), 'correct "no methods" text');
}

section('DE-10: null (legacy binary) → "no API definition" label');
{
    const win = makeEnv({});
    const modal = makeMockModal(win);
    win._ddRenderMethods(modal, {}, null, '');
    const methodsEl = modal.querySelector('#lumpDeepDiveMethods');
    const noMethods = methodsEl.querySelector('.lump-dd-no-methods');
    assert(noMethods !== null, '.lump-dd-no-methods present for legacy');
    assert(noMethods.textContent.includes('No API definition'), '"No API definition" text shown');
}

section('DE-11: _ddRenderMethodsFailed shows unavailable message');
{
    const win = makeEnv({});
    const modal = makeMockModal(win);
    win._ddRenderMethodsFailed(modal);
    const noMethods = modal.querySelector('#lumpDeepDiveMethods .lump-dd-no-methods');
    assert(noMethods !== null, '.lump-dd-no-methods present after failed fetch');
    assert(noMethods.textContent.includes('unavailable'), '"unavailable" in text');
}

// ── DE-12 through DE-18: _ddRenderSource (DOM) ───────────────────────────────

section('DE-12: tier 2 → green badge text + class');
{
    const win = makeEnv({});
    const modal = makeMockModal(win);
    win._ddRenderSource(modal, { sourceStorageTier: 2 }, 3, 'English.Contact');
    const btn = modal.querySelector('#lumpDeepDiveSource .lump-dd-source-badge');
    assert(btn !== null, 'badge button present');
    assert(btn.classList.contains('lump-dd-source-badge--tier2'), 'tier2 class applied');
    assert(btn.textContent.includes('Full source included'), '"Full source" in text');
}

section('DE-13: tier 1 → amber badge text + class');
{
    const win = makeEnv({});
    const modal = makeMockModal(win);
    win._ddRenderSource(modal, { sourceStorageTier: 1 }, 3, 'English.Contact');
    const btn = modal.querySelector('#lumpDeepDiveSource .lump-dd-source-badge');
    assert(btn !== null, 'badge button present');
    assert(btn.classList.contains('lump-dd-source-badge--tier1'), 'tier1 class applied');
    assert(btn.textContent.includes('Uncommented source included'), '"Uncommented source" in text');
}

section('DE-14: tier 0 → grey badge text + class');
{
    const win = makeEnv({});
    const modal = makeMockModal(win);
    win._ddRenderSource(modal, { sourceStorageTier: 0 }, 3, 'English.Contact');
    const btn = modal.querySelector('#lumpDeepDiveSource .lump-dd-source-badge');
    assert(btn !== null, 'badge button present');
    assert(btn.classList.contains('lump-dd-source-badge--tier0'), 'tier0 class applied');
    assert(btn.textContent.includes('No source embedded'), '"No source embedded" in text');
}

section('DE-15: missing sourceStorageTier → grey badge (default)');
{
    const win = makeEnv({});
    const modal = makeMockModal(win);
    win._ddRenderSource(modal, {}, null, '');
    const btn = modal.querySelector('#lumpDeepDiveSource .lump-dd-source-badge');
    assert(btn !== null, 'badge button present even with no tier');
    assert(btn.classList.contains('lump-dd-source-badge--tier0'), 'defaults to tier0 class');
}

section('DE-16: badge is a <button> (keyboard accessible)');
{
    const win = makeEnv({});
    const modal = makeMockModal(win);
    win._ddRenderSource(modal, { sourceStorageTier: 2 }, 5, 'SelfTest');
    const btn = modal.querySelector('#lumpDeepDiveSource button');
    assert(btn !== null, 'button element present');
    assert(btn.tagName === 'BUTTON', 'is a BUTTON element');
    assert(btn.type === 'button', 'type=button');
}

section('DE-17: clicking badge calls _deepDiveOpenAbstraction with correct args');
{
    let ddoaCalled = false, ddoaSlot = undefined, ddoaName = undefined;
    const win = makeEnv({});
    win._deepDiveOpenAbstraction = (slot, name) => {
        ddoaCalled = true; ddoaSlot = slot; ddoaName = name;
    };
    const modal = makeMockModal(win);
    win._ddRenderSource(modal, { sourceStorageTier: 2 }, 6, 'SelfTest');
    const btn = modal.querySelector('#lumpDeepDiveSource button');
    btn.click();
    assert(ddoaCalled, 'click fires _deepDiveOpenAbstraction');
    assert(ddoaSlot === 6, 'navSlot = 6');
    assert(ddoaName === 'SelfTest', 'navName = SelfTest');
}

section('DE-18: _ddRenderSourceFailed — clicking badge still navigates');
{
    let ddoaSlot = undefined, ddoaName = undefined;
    const win = makeEnv({});
    win._deepDiveOpenAbstraction = (slot, name) => { ddoaSlot = slot; ddoaName = name; };
    const modal = makeMockModal(win);
    win._ddRenderSourceFailed(modal, 4, 'English.LED');
    const btn = modal.querySelector('#lumpDeepDiveSource button');
    assert(btn !== null, 'button rendered on failure path');
    assert(btn.classList.contains('lump-dd-source-badge--tier0'), 'uses tier0 class on failure');
    btn.click();
    assert(ddoaSlot === 4, 'navSlot passed = 4');
    assert(ddoaName === 'English.LED', 'navName passed = English.LED');
}

// ── DE-19 through DE-20: _deepDiveOpenAbstraction behaviour ──────────────────

section('DE-19: _deepDiveOpenAbstraction — calls switchView then showAbstractionDetail');
{
    const calls = [];
    const win = makeEnv({
        _closeLumpDeepDive:    () => calls.push('close'),
        switchView:            (v) => calls.push('switchView:' + v),
        showAbstractionDetail: (s) => calls.push('showAbs:' + s),
    });
    win._deepDiveOpenAbstraction(5, 'SomeAbstraction');
    assert(calls.includes('close'), '_closeLumpDeepDive called');
    assert(calls.includes('switchView:abstractions'), 'switchView(abstractions) called');
    assert(calls.includes('showAbs:5'), 'showAbstractionDetail(5) called');
}

section('DE-20: _deepDiveOpenAbstraction — registry lookup when nsSlot=null');
{
    const showCalls = [];
    const win = makeEnv({
        _closeLumpDeepDive:    () => {},
        switchView:            () => {},
        showAbstractionDetail: (s) => showCalls.push(s),
        abstractionRegistry: {
            abstractions: {
                '9': { index: 9, name: 'English.Contact' }
            }
        }
    });
    win._deepDiveOpenAbstraction(null, 'English.Contact');
    assert(showCalls.length === 1, 'showAbstractionDetail called exactly once');
    assert(showCalls[0] === 9, 'looked up slot 9 from registry by name');
}

// ── DE-21 through DE-23: LUMP Deep Dive graph edge cases ─────────────────────

section('DE-21: _buildLumpDeepDiveGraph — empty C-List returns null');
{
    const win = makeEnv({});
    const result = win._buildLumpDeepDiveGraph({
        token: 'empty',
        dot_name: 'Empty.CList',
        clist_entries: []
    });
    assert(result === null, 'empty C-List returns null for the no-data branch');
}

section('DE-22: _buildLumpDeepDiveGraph — cycle renders without infinite recursion');
{
    const first = {
        token: 'cycle-a',
        dot_name: 'Cycle.A',
        clist_entries: [{ target_token: 'cycle-b', perms: 'R' }]
    };
    const second = {
        token: 'cycle-b',
        dot_name: 'Cycle.B',
        clist_entries: [{ target_token: 'cycle-a', perms: 'R' }]
    };
    const win = makeEnv({ _lumpsCache: [first, second] });
    const result = win._buildLumpDeepDiveGraph(first);
    assert(result !== null, 'cyclic graph returns an SVG result');
    assert(result.nodes.length === 2, 'cycle produces exactly two lump nodes');
    assert(result.edges.length === 2, 'cycle produces both dependency edges');
    assert(result.svg.includes('stroke="#f59e0b"'), 'cycle edge uses the amber stroke');
    assert(result.svg.includes('stroke-dasharray="5 3"'), 'cycle edge uses dashed styling');
}

section('DE-23: _deepDiveLumpForToken — unknown token returns null');
{
    const win = makeEnv({
        _lumpsCache: [{ token: 'known', dot_name: 'Known.Lump' }]
    });
    const result = win._deepDiveLumpForToken('missing');
    assert(result === null, 'unknown token returns null');
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
