#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('simulator/app-run.js', 'utf8');
const css = fs.readFileSync('simulator/styles-editor.css', 'utf8');

function functionSource(name) {
    const marker = `function ${name}(`;
    const start = source.indexOf(marker);
    assert.notStrictEqual(start, -1, `${name} must exist`);
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Could not extract ${name}`);
}

const classes = new Set();
const context = vm.createContext({
    _simRunActive: false,
    walkRunning: false,
    bootAnimating: false,
    document: {
        documentElement: {
            classList: {
                toggle(name, enabled) {
                    if (enabled) classes.add(name);
                    else classes.delete(name);
                },
            },
        },
    },
});
vm.runInContext(functionSource('_syncPullToRefreshGuard'), context);

vm.runInContext('_simRunActive = true; _syncPullToRefreshGuard();', context);
assert(classes.has('sim-executing'), 'Run disables pull-to-refresh');

vm.runInContext('_simRunActive = false; walkRunning = true; _syncPullToRefreshGuard();', context);
assert(classes.has('sim-executing'), 'Walk keeps pull-to-refresh disabled between ticks');

vm.runInContext('walkRunning = false; bootAnimating = true; _syncPullToRefreshGuard();', context);
assert(classes.has('sim-executing'), 'animated Boot disables pull-to-refresh');

vm.runInContext('bootAnimating = false; _syncPullToRefreshGuard();', context);
assert(!classes.has('sim-executing'), 'stopping execution restores pull-to-refresh');

assert(
    /html\.sim-executing[\s\S]*overscroll-behavior-y:\s*none/.test(css),
    'sim-executing CSS must suppress vertical browser overscroll'
);

console.log('pull-to-refresh guard tests passed');