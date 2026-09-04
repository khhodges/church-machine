#!/usr/bin/env node
'use strict';

const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('simulator/index.html', 'utf8');
const tools = fs.readFileSync('simulator/app-tools.js', 'utf8');
const run = fs.readFileSync('simulator/app-run.js', 'utf8');
const css = fs.readFileSync('simulator/styles-toolbar.css', 'utf8');

assert.match(html, /<button[^>]+role="tab"[^>]+aria-controls="dashPanel-thread"[^>]+id="dashTab-thread"/,
    'Thread is exposed as a dashboard tab');
assert.match(html, /id="dashPanel-thread"[\s\S]*id="threadIdentityStrip"/,
    'the existing live Thread strip is owned by the full-width Thread panel');
assert.strictEqual((html.match(/id="threadIdentityStrip"/g) || []).length, 1,
    'Thread rendering state is not duplicated');
assert.match(html, /role="tablist"[\s\S]*handleDashTabKeydown\(event\)/,
    'dashboard tabs expose keyboard tab-list behavior');
for (const id of ['cr', 'dr', 'gatelog', 'state', 'memstats', 'thread']) {
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
assert.match(css, /\.thread-identity-strip\s*\{[\s\S]*display:\s*grid;[\s\S]*repeat\(auto-fit,[\s\S]*1fr/,
    'configured Thread cards divide the full panel width evenly');
assert.match(css, /@media \(max-width: 900px\)[\s\S]*grid-template-columns:\s*repeat\(auto-fit/,
    'Thread cards retain a responsive narrow-screen layout');
assert.match(css, /\.dash-tab\s*\{[\s\S]*min-height:\s*1\.8rem;[\s\S]*padding:\s*0\.25rem 0\.6rem/,
    'dashboard controls use compact consistent dimensions');
assert.match(css, /\.dash-tab:focus-visible/,
    'keyboard focus remains clearly visible');
assert.match(run, /function updateThreadIdentityStrip\(\)[\s\S]*replaceChildren\(\)[\s\S]*row\.active/,
    'live Thread updates and active highlighting still render through the original strip');

console.log('PASS: full-width Thread dashboard tab contracts');
