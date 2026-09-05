#!/usr/bin/env node
'use strict';

const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('simulator/index.html', 'utf8');
const tools = fs.readFileSync('simulator/app-tools.js', 'utf8');
const run = fs.readFileSync('simulator/app-run.js', 'utf8');
const css = fs.readFileSync('simulator/styles-toolbar.css', 'utf8');
const lumpCss = fs.readFileSync('simulator/styles-lumps.css', 'utf8');

assert.match(html, /class="flags-led-row"[\s\S]*id="flagsDisplay"[\s\S]*id="threadIdentityStrip"[\s\S]*<\/div>\s*<div class="dash-tabs"/,
    'configured Threads stay visible as a right-side stack above the dashboard content');
assert.doesNotMatch(html, /id="dashTab-thread"|id="dashPanel-thread"/,
    'configured Thread cards do not consume a full-width dashboard tab');
assert.strictEqual((html.match(/id="threadIdentityStrip"/g) || []).length, 1,
    'Thread rendering state is not duplicated');
assert.match(html, /role="tablist"[\s\S]*handleDashTabKeydown\(event\)/,
    'dashboard tabs expose keyboard tab-list behavior');
for (const id of ['cr', 'dr', 'gatelog', 'state', 'memstats']) {
    assert.match(html, new RegExp(
        `id="dashPanel-${id}"[^>]+role="tabpanel"[^>]+aria-labelledby="dashTab-${id}"`),
    `${id} panel is associated with its controlling tab`);
}
assert.match(tools, /aria-selected[\s\S]*tabIndex[\s\S]*handleDashTabKeydown/,
    'tab selection keeps accessibility state and roving focus synchronized');
assert.match(tools, /if \(tab\) \{[\s\S]*aria-selected/,
    'an internal CR Detail panel does not remove every dashboard tab from keyboard focus');
assert.match(tools, /ArrowLeft[\s\S]*ArrowRight[\s\S]*Home[\s\S]*End/,
    'arrow, Home, and End keys navigate dashboard tabs');
assert.match(css, /\.thread-identity-strip\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*margin-left:\s*auto;/,
    'configured Thread cards form a compact vertical stack in the right-side status space');
assert.match(css, /\.thread-identity-card\s*\{[\s\S]*grid-template-areas:\s*"marker name values";/,
    'each Thread card stays on one compact row so code remains visible');
assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.flags-led-row\s*\{[\s\S]*flex-wrap:\s*wrap;[\s\S]*\.thread-identity-strip\s*\{[\s\S]*flex:\s*1 1 100%;/,
    'the Thread stack moves below status only when a narrow viewport cannot hold the right column');
assert.match(css, /\.dash-tabs\s*\{[\s\S]*--dash-tab-min-width:\s*3\.6rem;[\s\S]*--dash-tab-min-height:\s*1\.8rem;[\s\S]*--dash-tab-padding:\s*0\.25rem 0\.6rem;[\s\S]*--dash-tab-font-size:\s*0\.75rem;/,
    'dashboard controls define desktop dimensions on their container');
assert.match(css, /\.dash-tab\s*\{[\s\S]*min-width:\s*var\(--dash-tab-min-width\);[\s\S]*min-height:\s*var\(--dash-tab-min-height\);[\s\S]*padding:\s*var\(--dash-tab-padding\);[\s\S]*font-size:\s*var\(--dash-tab-font-size\);/,
    'dashboard controls consume one authoritative sizing rule');
assert.match(lumpCss, /@media \(max-width:\s*768px\)[\s\S]*\.dash-tabs\s*\{[\s\S]*--dash-tab-min-width:\s*3\.4rem;[\s\S]*--dash-tab-min-height:\s*1\.7rem;[\s\S]*--dash-tab-padding:\s*0\.25rem 0\.55rem;[\s\S]*--dash-tab-font-size:\s*0\.72rem;[\s\S]*flex-wrap:\s*wrap;[\s\S]*gap:\s*0\.25rem;/,
    'narrow screens override only compact dimensions and responsive layout');
assert.doesNotMatch(lumpCss, /\.dash-tab\s*\{[\s\S]*?(?:min-width|min-height|padding|font-size):/,
    'narrow-screen stylesheet does not redeclare dashboard tab sizing properties');
assert.match(css, /\.dash-tab:focus-visible/,
    'keyboard focus remains clearly visible');
assert.match(run, /function updateThreadIdentityStrip\(\)[\s\S]*replaceChildren\(\)[\s\S]*row\.active/,
    'live Thread updates and active highlighting still render through the original strip');

console.log('PASS: persistent right-side Thread stack contracts');
