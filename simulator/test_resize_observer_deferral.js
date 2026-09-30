'use strict';
// ResizeObserver callbacks must not mutate observed layout in their delivery
// frame. The browser reports that feedback as a non-Error window error.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const misc = fs.readFileSync(path.join(__dirname, 'app-misc.js'), 'utf8');
const shell = fs.readFileSync(path.join(__dirname, 'app-shell.js'), 'utf8');
const diagnostics = fs.readFileSync(path.join(__dirname, 'browser_diagnostics.js'), 'utf8');

assert.match(misc.slice(misc.indexOf('var overflowResizePending'), misc.indexOf('var mutObserver', misc.indexOf('var overflowResizePending'))),
    /new ResizeObserver\(function\(entries\) \{[\s\S]*requestAnimationFrame\(function\(\) \{[\s\S]*setTimeout\(function\(\) \{[\s\S]*updateOverflow\(\)/,
    'tab overflow writes must be deferred beyond ResizeObserver delivery');
assert.match(diagnostics,
    /kind = \/\^ResizeObserver loop\/[\s\S]*report\(kind, event\.error, event\)/,
    'ResizeObserver telemetry must remain narrowly classified and reported');

function exercise(source, start, end, setup, observed, name, invoke = '') {
    const code = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
    assert(code.length && code.includes('new ResizeObserver'), name + ' observer source missing');
    let observer, writes = 0, frames = [], tasks = [];
    class ResizeObserver {
        constructor(callback) { observer = callback; }
        observe(element) { assert.equal(element, observed); }
    }
    const write = () => { writes++; };
    const context = {
        ResizeObserver,
        requestAnimationFrame: callback => { frames.push(callback); },
        setTimeout: callback => { tasks.push(callback); },
        ...setup(write)
    };
    vm.runInNewContext(code + '\n' + invoke, context);
    const deliver = (width, height) => observer([{ contentRect: { width, height } }]);
    const flush = (before) => {
        assert.equal(writes, before, name + ' wrote inside observer delivery');
        for (const frame of frames.splice(0)) frame();
        assert.equal(writes, before, name + ' wrote inside the animation frame');
        for (const task of tasks.splice(0)) task();
    };
    deliver(600, 300);
    deliver(600, 300);
    deliver(620, 300);
    assert.equal(frames.length, 1, name + ' must coalesce a resize burst');
    flush(0);
    assert.equal(writes, 1);
    deliver(620, 300);
    assert.equal(frames.length, 0, name + ' must ignore unchanged geometry');
    deliver(620, 301);
    assert.equal(frames.length, 1, name + ' must respond to a real resize');
    flush(1);
    assert.equal(writes, 2);
}

const editor = {};
exercise(shell, "if (typeof ResizeObserver !== 'undefined') {",
    "asmEd.addEventListener('keydown'", write => ({
        asmEd: editor, syncLineScroll: write,
        _debouncedErrorRecalc: () => {}
    }), editor, 'editor');

const toolbar = {};
exercise(misc, 'function observeToolbarHeight() {',
    "window.addEventListener('resize', syncVisualViewportTop)", write => ({
        document: { querySelector: () => toolbar },
        adjustViewTop: write
    }), toolbar, 'toolbar', 'observeToolbarHeight();');

console.log('PASS ResizeObserver feedback deferral regression');