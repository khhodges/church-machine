'use strict';
// ResizeObserver callbacks must not mutate observed layout in their delivery
// frame. The browser reports that feedback as a non-Error window error.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const misc = fs.readFileSync(path.join(__dirname, 'app-misc.js'), 'utf8');
const shell = fs.readFileSync(path.join(__dirname, 'app-shell.js'), 'utf8');
const diagnostics = fs.readFileSync(path.join(__dirname, 'browser_diagnostics.js'), 'utf8');

assert.match(misc,
    /new ResizeObserver\(function\(\) \{[\s\S]*requestAnimationFrame\(function\(\) \{[\s\S]*setTimeout\(function\(\) \{[\s\S]*updateOverflow\(\)/,
    'tab overflow writes must be deferred beyond ResizeObserver delivery');
assert.match(misc,
    /_viewTopResizeObserver = new ResizeObserver[\s\S]*requestAnimationFrame\(function\(\) \{ setTimeout\(adjustViewTop, 0\); \}\)/,
    'toolbar writes must be deferred beyond ResizeObserver delivery');
assert.match(shell,
    /new ResizeObserver\(function\(\) \{[\s\S]*requestAnimationFrame\(function\(\) \{[\s\S]*setTimeout\(function\(\) \{ syncLineScroll\(\)/,
    'editor overlay writes must be deferred beyond ResizeObserver delivery');
assert.match(diagnostics,
    /kind = \/\^ResizeObserver loop\/[\s\S]*report\(kind, event\.error, event\)/,
    'ResizeObserver telemetry must remain narrowly classified and reported');

console.log('PASS ResizeObserver feedback deferral regression');