/**
 * Regression tests for the Testing page FPGA health panel collapse behavior.
 *
 * Run: node simulator/test_fpga_health_collapse.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'server', 'fpga_status.html'), 'utf8');
const start = source.indexOf("  var DOT_COLOR = {");
const end = source.indexOf("  // Also explain an empty live-event log", start);
if (start < 0 || end < 0) throw new Error('health collapse source boundaries not found');

const healthSource = source.slice(start, end) +
    '\nwindow.__health = { initHealthCollapse: initHealthCollapse, renderHealthStrip: renderHealthStrip };';

function makeHarness(initialStorage) {
    const dom = new JSDOM(`<!doctype html><body>
      <button id="healthToggle" aria-expanded="true">Collapse</button>
      <div id="healthStages"></div>
      <div id="statusGrid"></div>
    </body>`, { url: 'http://localhost/' });
    const stored = initialStorage === undefined ? null : initialStorage;
    const localStorage = {
        value: stored,
        getItem() { return this.value; },
        setItem(_key, value) { this.value = value; },
    };
    const ctx = vm.createContext({
        window: dom.window,
        document: dom.window.document,
        localStorage,
        classifyPipelineStages(snapshot) { return snapshot.stages; },
    });
    vm.runInContext(healthSource, ctx);
    ctx.window.__health.initHealthCollapse();
    return { window: dom.window, toggle: dom.window.document.getElementById('healthToggle'),
        stages: dom.window.document.getElementById('healthStages'),
        statusGrid: dom.window.document.getElementById('statusGrid'),
        render: ctx.window.__health.renderHealthStrip };
}

function snapshot(state) {
    return { stages: [
        { name: 'Bridge', state, detail: state },
    ] };
}

let pass = 0;
let fail = 0;
function test(name, fn) {
    try {
        fn();
        console.log('PASS ' + name);
        pass++;
    } catch (error) {
        console.log('FAIL ' + name + ' — ' + error.message);
        fail++;
    }
}
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

test('manual collapse stays collapsed after green health update', () => {
    const h = makeHarness();
    h.render(snapshot('red'));
    h.toggle.click();
    assert(h.toggle.getAttribute('aria-expanded') === 'false', 'manual click did not collapse');
    h.render(snapshot('green'));
    assert(h.stages.hidden && h.statusGrid.hidden, 'green update reopened the panel');
    assert(h.toggle.textContent === 'Expand', 'toggle label changed after green update');
});

test('manual expand stays expanded through later automatic transitions', () => {
    const h = makeHarness('1');
    h.render(snapshot('green'));
    assert(h.stages.hidden, 'stored collapsed preference was not applied');
    h.toggle.click();
    assert(!h.stages.hidden && h.toggle.getAttribute('aria-expanded') === 'true',
        'manual click did not expand');
    h.render(snapshot('red'));
    h.render(snapshot('green'));
    assert(!h.stages.hidden && !h.statusGrid.hidden, 'automatic transition collapsed the panel');
    assert(h.toggle.textContent === 'Collapse', 'toggle label changed after transitions');
});

test('automatic collapse and reopen still work before manual interaction', () => {
    const h = makeHarness();
    h.render(snapshot('red'));
    h.render(snapshot('green'));
    assert(h.stages.hidden, 'green transition did not auto-collapse');
    h.render(snapshot('red'));
    assert(!h.stages.hidden, 'non-green transition did not auto-reopen');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);