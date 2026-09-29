'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const run = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const compile = fs.readFileSync(path.join(__dirname, 'app-compile.js'), 'utf8');
const shell = fs.readFileSync(path.join(__dirname, 'app-shell.js'), 'utf8');
const toolbar = fs.readFileSync(path.join(__dirname, 'styles-toolbar.css'), 'utf8');
const lumps = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');

function check(condition, message) {
    if (!condition) throw new Error(`Editor action menu regression: ${message}`);
    console.log(`PASS ${message}`);
}

check(!index.includes('id="executionIdentityEditor"'),
    'the editor no-program-loaded row is removed');
check(/id="langSelector"[\s\S]*?<\/select>\s*<button[^>]*id="btnToolbarCompile"[^>]*onclick="document.getElementById\('btnHamCompile'\).click\(\)"[\s\S]*?<\/button>\s*<button[^>]*id="btnToolbarSaveLump"[^>]*onclick="document.getElementById\('btnHamSaveLump'\).click\(\)"/.test(index),
    'Compile and Save LUMP sit beside language and delegate to the original actions');
check(!index.includes('class="asm-picker-toolbar"'),
    'the separate instruction/C-List toolbar is removed');
check(index.includes('id="btnHamCompile"') &&
      index.includes('id="btnHamInstructions"') &&
      index.includes('id="btnHamCList"') &&
      /editorActionsDropdown[\s\S]*?id="editorViewSwitcherToggle"/.test(index),
    'compile, instructions, C-List, and editor views are in the hamburger menu');
check(!index.includes('id="editorActionsIdentity"') &&
      !index.includes('id="editorActionsIdentityValue"'),
    'the hamburger menu has no duplicate identity context');
check(index.includes('id="editorCodeName" class="editor-identity-name"') &&
      run.includes('window._editorCodeNameValue = name || \'\';') &&
      run.includes('identityName.textContent = chosenName +') &&
      !index.includes('id="editorIdentityName"') &&
      run.includes('document.getElementById(\'editorCodeName\')'),
    'the DOM uses one visible program name and has no duplicate label');
check(run.includes('function _editorActionIdentity(name)') &&
      run.includes('const openMeta = window._editorOpenLumpMeta;') &&
      run.includes('openMeta.issue_n || openMeta.issue') &&
      run.includes('return `${dotName}#${issue}`;') &&
      run.includes('` · Source v${revision}`'),
    'the action identity uses the exact open LUMP dot.name and issue number');
check(!run.includes('badge.textContent = `LUMP identity: ${identity}`') &&
      run.includes('identityName.textContent = chosenName +') &&
      !run.includes('identityName.textContent = identity +'),
    'the compact toolbar shows the program name without a LUMP issue suffix');
check(shell.includes('_refreshEditorActionIdentity('),
    'execution identity changes refresh the action context');
check(!compile.includes('_applySealedLumpState') &&
      !compile.includes('cm-editor-sealed'),
    'compilation does not hide or seal the source editor');
check(!toolbar.includes('.editor-actions-context') &&
      toolbar.includes('.editor-identity-name') &&
      toolbar.includes('max-width: none'),
    'the full identity has dedicated responsive toolbar styling');
check(index.includes('class="editor-toolbar"') &&
      index.includes('id="savedLumpDisassemblyPanel"') &&
      index.includes('class="editor-layout editor-source-console-row"') &&
      index.indexOf('class="editor-toolbar"') <
          index.indexOf('class="editor-layout editor-source-console-row"') &&
      index.indexOf('class="editor-layout editor-source-console-row"') <
          index.indexOf('id="savedLumpDisassemblyPanel"'),
    'the toolbar sits above the two-column source and disassembly workspace');
check(toolbar.includes('.editor-layout.saved-lump-editor-layout') &&
      toolbar.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)') &&
      toolbar.includes('.saved-lump-editor-layout > .console-panel') &&
      toolbar.includes('.saved-lump-editor-layout > .editor-horizontal-divider'),
    'saved-LUMP mode places source left and disassembly above a resizable console');
check(toolbar.includes('grid-template-columns: minmax(0, 1fr) 10px minmax(0, 1fr)') &&
      toolbar.includes('grid-template-rows: minmax(0, 1fr)'),
    'the source/console workspace is a static three-column row');
check(!lumps.includes('getElementById(\'btnToolbarCompile\')') &&
      lumps.includes('getElementById(\'btnHamSaveLump\')') &&
      lumps.includes('getElementById(\'editorActionsDropdown\')') &&
      lumps.includes('lump-source-restored-indicator'),
    'saved-LUMP discard and recovery state use the action menu and compact indicator');
check(/getElementById\('editorActionsWrap'\)[\s\S]*?insertBefore\([\s\S]*?_srcBanner[\s\S]*?_editorActionsWrap\.nextSibling/.test(lumps),
    'saved-LUMP recovery indicator is placed to the right of the hamburger');
check(lumps.includes("_savedArtifactFailed ? 'alert' : 'status'") &&
      lumps.includes('Saved artifact failed approval or integrity checks') &&
      lumps.includes("'<span aria-hidden=\"true\">&#10007;</span>'") &&
      fs.readFileSync(__dirname + '/styles-lumps.css', 'utf8')
          .includes('.lump-source-restored-indicator.is-failed'),
    'failed saved-artifact integrity remains visible as a red X');

const misc = fs.readFileSync(path.join(__dirname, 'app-misc.js'), 'utf8');
const actions = fs.readFileSync(path.join(__dirname, 'app-actions.js'), 'utf8');
check(shell.includes('initEditorHorizontalDivider();') &&
      toolbar.includes('.editor-layout.disassembly-diagnostics-layout > .editor-horizontal-divider') &&
      toolbar.includes('grid-row: 3;') &&
      lumps.includes("if (typeof switchCodeTab === 'function') switchCodeTab('console');") &&
      actions.includes("applyButton('btnToolbarCompile', 'compile')") &&
      actions.includes("applyButton('btnToolbarSaveLump', 'save')"),
    'saved and failed builds show the split and new buttons share action eligibility');

function target() {
    const listeners = new Map();
    return {
        listeners,
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(fn);
        },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
        fire(type, event) { for (const fn of listeners.get(type) || []) fn(event); }
    };
}
const doc = target();
doc.body = { style: { cursor: 'auto', userSelect: 'text' } };
const win = target();
const stored = new Map([['editorDisassemblyConsoleSplit', '65']]);
win.localStorage = {
    getItem(key) { return stored.get(key) ?? null; },
    setItem(key, value) { stored.set(key, value); }
};
win.getComputedStyle = () => ({ rowGap: '8px' });
const properties = {};
const layout = {
    style: { setProperty(key, value) { properties[key] = value; } },
    getBoundingClientRect() { return { top: 100, height: 500 }; },
    classList: { contains(name) { return name === 'saved-lump-editor-layout'; } }
};
const divider = target();
divider.parentElement = layout;
divider.getBoundingClientRect = () => ({ height: 10 });
divider.classList = { add() {}, remove() {} };
divider.setAttribute = (name, value) => { divider[name] = value; };
doc.getElementById = id => id === 'editorHorizontalDivider' ? divider : null;
const start = misc.indexOf('function initEditorHorizontalDivider()');
const end = misc.indexOf('function initReplDivider()', start);
check(start !== -1 && end > start, 'horizontal divider initializer exists');
vm.runInNewContext(misc.slice(start, end) + '\ninitEditorHorizontalDivider();',
    { document: doc, window: win });
check(properties['--editor-diagnostics-top'] === '65fr',
    'a persisted split restores without touching source or Namespace data');
divider.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
check(Number(stored.get('editorDisassemblyConsoleSplit')) > 65,
    'keyboard adjustment persists the split');
divider.fire('pointerdown', {
    pointerId: 7, pointerType: 'mouse', button: 0, preventDefault() {}
});
doc.fire('pointermove', { pointerId: 7, clientY: 11000 });
check(Number(divider['aria-valuenow']) < 100,
    'pointer drag clamps console to a nonzero minimum height');
doc.fire('pointercancel', { pointerId: 7 });
check(doc.body.style.cursor === 'auto' && doc.body.style.userSelect === 'text' &&
      doc.listeners.get('pointermove').size === 0,
    'pointer cancellation removes drag listeners and restores body styles');

console.log('Editor action menu regression: PASS');