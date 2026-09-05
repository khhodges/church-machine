#!/usr/bin/env node
'use strict';

const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('simulator/index.html', 'utf8');
const tools = fs.readFileSync('simulator/app-tools.js', 'utf8');
const memory = fs.readFileSync('simulator/app-memory.js', 'utf8');
const run = fs.readFileSync('simulator/app-run.js', 'utf8');
const misc = fs.readFileSync('simulator/app-misc.js', 'utf8');
const css = fs.readFileSync('simulator/styles-toolbar.css', 'utf8');
const lumpCss = fs.readFileSync('simulator/styles-lumps.css', 'utf8');

assert.match(html, /class="flags-led-row"[\s\S]*id="flagsDisplay"[\s\S]*id="threadIdentityStrip"/,
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
assert.match(tools, /ArrowLeft[\s\S]*ArrowRight[\s\S]*ArrowUp[\s\S]*ArrowDown[\s\S]*Home[\s\S]*End/,
    'arrow, Home, and End keys navigate dashboard tabs');
assert.match(css, /\.thread-identity-strip\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*margin-left:\s*auto;/,
    'configured Thread cards form a compact vertical stack in the right-side status space');
assert.match(css, /\.thread-identity-card\s*\{[\s\S]*grid-template-areas:\s*"marker name values";/,
    'each Thread card stays on one compact row so code remains visible');
assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.flags-led-row\s*\{[\s\S]*flex-wrap:\s*wrap;[\s\S]*\.thread-identity-strip\s*\{[\s\S]*flex:\s*1 1 100%;/,
    'the Thread stack moves below status only when a narrow viewport cannot hold the right column');
assert.match(html, /id="dashMenuDropdown"/,
    'dashboard tabs are organized into a dropdown hamburger menu');
assert.match(tools, /function _setDashMenuOpen\(open\)[\s\S]*dashboard-menu-open[\s\S]*function toggleDashMenu/,
    'opening the menu releases the status-row overflow mask');
assert.match(css, /\.flags-led-row\.dashboard-menu-open\s*\{[\s\S]*overflow:\s*visible;/,
    'the open activity menu can overlay dashboard content without being clipped');
assert.match(css, /\.crd-menu-dropdown\.dashboard-menu-dropdown\s*\{[\s\S]*right:\s*auto;[\s\S]*left:\s*0;/,
    'the dashboard menu is left-anchored despite later generic dropdown rules');
assert.match(html, /Inspect Machine[\s\S]*Context Registers[\s\S]*Data Registers[\s\S]*Gate Log[\s\S]*Machine State[\s\S]*Memory Status/,
    'machine inspection activities are grouped together in the dashboard menu');
assert.match(html, /dashboard-heading-row[\s\S]*id="crdMenuActiveLabel"[\s\S]*dashboard-machine-row[\s\S]*id="hwLedBar"[\s\S]*id="threadIdentityStrip"/,
    'the abstraction heading sits above Wukong A7 and aligns with the Thread stack');
assert.match(memory, /Inspect Abstraction[\s\S]*data-tab="code"[\s\S]*data-tab="clist"[\s\S]*data-tab="api"[\s\S]*data-tab="lump"/,
    'abstraction inspection views are grouped in the shared menu');
assert.match(memory, /Modify Abstraction|Deploy &amp; Share/,
    'abstraction activity group labels are present');
for (const item of ['Edit Source', 'Patch Memory', 'Compress Lump', 'Save Lump']) {
    assert.match(memory, new RegExp(item), `${item} is available through the shared menu`);
}
assert.doesNotMatch(memory, /switchDashTab\('cr'\);\s*switchCRDetailTab/,
    'choosing an abstraction view does not leave the abstraction detail panel');
assert.match(css, /\.dash-tab:focus-visible/,
    'keyboard focus remains clearly visible');
assert.match(run, /function updateThreadIdentityStrip\(\)[\s\S]*replaceChildren\(\)[\s\S]*row\.active/,
    'live Thread updates and active highlighting still render through the original strip');
assert.match(misc, /function observeToolbarHeight\(\)[\s\S]*new ResizeObserver[\s\S]*requestAnimationFrame\(adjustViewTop\)[\s\S]*observe\(toolbar\)/,
    'dashboard content follows late toolbar height changes so Thread.1 cannot be covered');

console.log('PASS: persistent right-side Thread stack contracts');
