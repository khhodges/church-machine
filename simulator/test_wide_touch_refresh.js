'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const css = fs.readFileSync(__dirname + '/styles-base.css', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
assert.match(css, /@media\s*\(min-width:\s*1024px\)\s*\{\s*html,\s*body\s*\{\s*overscroll-behavior-y:\s*none;/);
assert.doesNotMatch(css, /touch-action:\s*none/, 'normal touch scrolling must remain enabled');
assert.match(html, /styles-base\.css\?v=20261015-wide-touch-no-refresh/);
console.log('Wide-screen pull-to-refresh CSS policy: PASS');
