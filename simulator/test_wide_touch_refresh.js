'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const css = fs.readFileSync(__dirname + '/wide-screen-scroll.css', 'utf8');
assert.match(css, /@media\s*\(min-width:\s*768px\),\s*\(orientation:\s*landscape\)\s*\{\s*html,\s*body\s*\{\s*overscroll-behavior-y:\s*none;/);
assert.doesNotMatch(css, /touch-action:\s*none/, 'normal touch scrolling must remain enabled');
for (const page of ['index.html', 'starter.html', 'alice-mallory-lab.html', 'amobea/index.html']) {
    const html = fs.readFileSync(__dirname + '/' + page, 'utf8');
    assert.ok(html.includes('/simulator/wide-screen-scroll.css?v=20261021'), page);
}
console.log('Wide-screen pull-to-refresh CSS policy: PASS');

// Exercise the actual application gesture, not just the browser CSS policy.
const vm = require('node:vm');
const misc = fs.readFileSync(__dirname + '/app-misc.js', 'utf8');
const start = misc.indexOf('(function initPullToRefresh() {');
assert.ok(start >= 0);
const gesture = misc.slice(start, misc.indexOf('})();', start) + 5);
function fixture(width, landscape = false, running = false) {
    const state = {width, landscape, running, reloads: 0, indicators: 0};
    const handlers = {}, timers = [];
    const nodes = {};
    const classes = new Set();
    const indicator = {
        style: {},
        classList: {add: v => classes.add(v), remove: v => classes.delete(v),
            contains: v => classes.has(v)},
        querySelector: selector => nodes[selector] || (nodes[selector] = {style: {}})
    };
    vm.runInNewContext(gesture, {
        window: {matchMedia: query => {
            assert.equal(query, '(min-width: 768px), (orientation: landscape)');
            return {get matches() { return state.width >= 768 || state.landscape; }};
        }},
        document: {
            documentElement: {classList: {contains: () => state.running}},
            addEventListener: (name, handler, options) => {
                assert.equal(options.passive, true, 'Scrolling remains passive');
                handlers[name] = handler;
            },
            querySelector: selector => selector === '.view.active'
                ? {scrollTop: 0} : {offsetHeight: 60},
            createElement: () => { state.indicators++; return indicator; },
            body: {appendChild() {}}
        },
        location: {reload: () => state.reloads++},
        setTimeout: fn => timers.push(fn)
    });
    state.fire = (name, y = 0, fingers = 1) =>
        handlers[name]({touches: Array.from({length: fingers}, () => ({clientY: y}))});
    state.flush = () => { while (timers.length) timers.shift()(); };
    state.pull = () => {
        state.fire('touchstart', 70);
        state.fire('touchmove', 220);
        state.fire('touchend');
    };
    return state;
}
for (const [width, landscape] of [[768, false], [900, false], [1280, false], [700, true]]) {
    const s = fixture(width, landscape);
    s.pull(); s.flush();
    assert.equal(s.reloads, 0, `${width}px landscape=${landscape}`);
    assert.equal(s.indicators, 0, 'Wide screens never offer refresh');
}
for (const stage of ['move', 'release', 'queued']) {
    const s = fixture(390);
    s.fire('touchstart', 70);
    if (stage === 'move') s.width = 1024;
    s.fire('touchmove', 220);
    if (stage === 'release') s.landscape = true;
    s.fire('touchend');
    if (stage === 'queued') s.width = 1024;
    s.flush();
    assert.equal(s.reloads, 0, `Resize at ${stage} must prevent refresh`);
}
const narrow = fixture(390);
narrow.pull(); narrow.flush();
assert.equal(narrow.reloads, 1, 'Idle portrait-phone behavior is preserved');
const running = fixture(390, false, true);
running.pull(); running.flush();
assert.equal(running.reloads, 0, 'Executing simulation must not be refreshed');
const cancelled = fixture(390);
cancelled.fire('touchstart', 70);
cancelled.fire('touchmove', 220);
cancelled.fire('touchcancel');
cancelled.fire('touchend');
cancelled.flush();
assert.equal(cancelled.reloads, 0);
console.log('Application pull-to-refresh gesture guards: PASS');
