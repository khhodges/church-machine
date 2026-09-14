'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const moduleSource = fs.readFileSync(path.join(__dirname, 'app-editor-view-switcher.js'), 'utf8');

function check(condition, message) {
    if (!condition) throw new Error(`Editor view switcher regression: ${message}`);
    console.log(`PASS ${message}`);
}

const selectorMatch = index.match(/<select id="langSelector"[\s\S]*?<\/select>/);
assert(selectorMatch, 'the existing language selector is present');
const optionMatches = [...selectorMatch[0].matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)];
const expectedOptions = [
    ['cloomc', 'CLOOMC++'],
    ['english', 'English'],
    ['symbolic', 'Symbolic Math (Ada)'],
    ['assembly', 'Assembly'],
    ['javascript', 'JS (CLOOMC++)'],
    ['haskell', 'Haskell (CLOOMC++)'],
    ['lambda', 'Lambda Calculus'],
    ['abstraction', 'Abstraction'],
    ['personal', 'My Programs']
];
assert.deepStrictEqual(optionMatches.map(match => [match[1], match[2]]), expectedOptions);

const dom = new JSDOM(`<!doctype html><body>
    ${selectorMatch[0]}
    <button id="editorViewSwitcherToggle"><span id="editorViewSwitcherCount">0</span> views</button>
    <div id="editorViewSwitcherPanel" hidden>
        <button class="editor-view-switcher-close">×</button>
        <span id="editorViewSwitcherPanelCount">0</span>
        <div id="editorViewSwitcherEntries"></div>
        <a id="editorViewSwitcherSourceLink" href="#abstractions">Browse all source examples</a>
    </div>
</body>`, { runScripts: 'outside-only' });
const { window } = dom;
const calls = { langChange: [], switchView: [], switchAbsSubtab: [] };
window.onLangChange = () => calls.langChange.push(window.document.getElementById('langSelector').value);
window.switchView = view => calls.switchView.push(view);
window.switchAbsSubtab = tab => calls.switchAbsSubtab.push(tab);
window.eval(moduleSource);
window.EditorViewSwitcher.init();

const toggle = window.document.getElementById('editorViewSwitcherToggle');
const panel = window.document.getElementById('editorViewSwitcherPanel');
const entries = window.document.querySelectorAll('.editor-view-switcher-entry');
check(toggle.textContent.includes('9 views'), 'the visible count comes from the selector options');
check(window.document.getElementById('editorViewSwitcherPanelCount').textContent === '9',
    'the panel count comes from the selector options');
check(entries.length === 9, 'all nine selector options render as direct entries');
check([...entries].map(entry => entry.querySelector('.editor-view-switcher-entry-name').textContent).join('|') ===
    expectedOptions.map(option => option[1]).join('|'),
    'entry names are derived from selector option labels');
check(window.document.querySelector('.editor-view-switcher-group h3').textContent === 'Source languages',
    'the panel distinguishes source-language views');
check([...window.document.querySelectorAll('.editor-view-switcher-group h3')].at(-1).textContent === 'Workspace views',
    'the panel distinguishes workspace views');

toggle.click();
check(panel.hidden === false && toggle.getAttribute('aria-expanded') === 'true',
    'activating the link opens the panel and updates ARIA state');
entries[3].click();
check(window.document.getElementById('langSelector').value === 'assembly' &&
      calls.langChange.at(-1) === 'assembly',
    'selecting a language updates the selector and calls onLangChange');
check(panel.hidden === true && toggle.getAttribute('aria-expanded') === 'false',
    'selecting a view closes the panel');

window.EditorViewSwitcher.select('abstraction');
check(calls.langChange.at(-1) === 'abstraction',
    'Abstraction follows the existing language-change route');
window.EditorViewSwitcher.select('personal');
check(calls.langChange.at(-1) === 'personal',
    'My Programs follows the existing personal-program route');

toggle.click();
const sourceLink = window.document.getElementById('editorViewSwitcherSourceLink');
sourceLink.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
check(calls.switchView.at(-1) === 'abstractions' && calls.switchAbsSubtab.at(-1) === 'sources',
    'source examples link opens the Abstractions Source Library subtab');
check(panel.hidden === true && toggle.getAttribute('aria-expanded') === 'false',
    'source examples navigation closes the panel');

toggle.click();
window.document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check(panel.hidden === true, 'outside click closes the panel');
toggle.click();
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check(panel.hidden === true && toggle.getAttribute('aria-expanded') === 'false',
    'Escape closes the panel and clears expanded state');

const newOption = window.document.createElement('option');
newOption.value = 'future';
newOption.textContent = 'Future View';
window.document.getElementById('langSelector').appendChild(newOption);
window.EditorViewSwitcher.render();
check(toggle.textContent.includes('10 views') &&
      window.document.getElementById('editorViewSwitcherPanelCount').textContent === '10',
    'adding a selector option updates both visible counts');
window.EditorViewSwitcher.open();
check(window.document.querySelectorAll('.editor-view-switcher-entry').length === 10,
    'new selector options appear without a second authoritative list');

console.log('Editor view switcher regression passed.');