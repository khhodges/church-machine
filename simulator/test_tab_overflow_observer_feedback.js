'use strict';

// Synthetic editor sidebar: class writes during overflow rendering must not
// cause the MutationObserver to schedule another render indefinitely.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, 'app-misc.js'), 'utf8');
const start = source.indexOf('function initTabOverflow(container) {');
const end = source.indexOf('function initAllTabOverflows()', start);
assert(start !== -1 && end > start);

const dom = new JSDOM('<div class="sidebar-tabs"><button class="sidebar-tab active">Console</button><button class="sidebar-tab">Syntax</button></div>');
const { window } = dom;
const container = window.document.querySelector('.sidebar-tabs');
let measurements = 0;
window.HTMLElement.prototype.getBoundingClientRect = function() {
    measurements++;
    return { width: this === container ? 70 : 50, top: 0, bottom: 20, right: 70 };
};
let resize;
class FakeResizeObserver {
    constructor(callback) { resize = callback; }
    observe(target) { assert.equal(target, container); }
}
const initTabOverflow = vm.runInNewContext(source.slice(start, end) + '\ninitTabOverflow', {
    document: window.document,
    window,
    MutationObserver: window.MutationObserver,
    ResizeObserver: FakeResizeObserver,
    requestAnimationFrame: callback => setTimeout(callback, 0),
    setTimeout,
    queueMicrotask
});

async function check() {
    initTabOverflow(container);
    await new Promise(resolve => setTimeout(resolve, 90));
    assert(container.querySelector('.tab-overflow-btn').classList.contains('visible'));
    const stable = measurements;
    await new Promise(resolve => setTimeout(resolve, 90));
    assert.equal(measurements, stable, 'self-generated class mutations must not schedule repeated overflow renders');

    container.querySelector('.sidebar-tab').style.display = 'none';
    await new Promise(resolve => setTimeout(resolve, 90));
    assert(measurements > stable, 'external tab changes must still recalculate overflow');
    const afterMutation = measurements;
    resize();
    await new Promise(resolve => setTimeout(resolve, 90));
    assert(measurements > afterMutation, 'real container resizes must still recalculate overflow');
    const afterResize = measurements;
    await new Promise(resolve => setTimeout(resolve, 90));
    assert.equal(measurements, afterResize, 'resize-triggered render must not feed back through mutations');
    window.close();
    console.log('PASS tab overflow observer feedback');
}
check().catch(error => { window.close(); console.error(error); process.exitCode = 1; });