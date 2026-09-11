'use strict';

const fs = require('fs');
const path = require('path');

const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const run = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const shell = fs.readFileSync(path.join(__dirname, 'app-shell.js'), 'utf8');
const toolbar = fs.readFileSync(path.join(__dirname, 'styles-toolbar.css'), 'utf8');
const lumps = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');

function check(condition, message) {
    if (!condition) throw new Error(`Editor action menu regression: ${message}`);
    console.log(`PASS ${message}`);
}

check(!index.includes('id="executionIdentityEditor"'),
    'the editor no-program-loaded row is removed');
check(!index.includes('id="btnToolbarCompile"') &&
      !index.includes('id="btnToolbarSaveLumpPerm"'),
    'compile and Save Lump are no longer duplicated in the toolbar');
check(!index.includes('class="asm-picker-toolbar"'),
    'the separate instruction/C-List toolbar is removed');
check(index.includes('id="btnHamCompile"') &&
      index.includes('id="btnHamInstructions"') &&
      index.includes('id="btnHamCList"'),
    'compile, instructions, and C-List actions are in the hamburger menu');
check(!index.includes('id="editorActionsIdentity"') &&
      !index.includes('id="editorActionsIdentityValue"'),
    'the hamburger menu has no duplicate identity context');
check(!index.includes('id="editorCodeName"') &&
      run.includes('window._editorCodeNameValue = name || \'\';') &&
      run.includes('_editorActionIdentity(name || window._editorCodeNameValue || \'\')') &&
      index.includes('id="editorIdentityName"'),
    'the toolbar has no duplicate short label and keeps only the canonical full identity visible');
check(run.includes('function _editorActionIdentity(name)') &&
      run.includes('return `${dotName}#${issue}`;'),
    'the action identity is built as the full dot.pet.name issue identity');
check(!run.includes('button.textContent = identity ? `${label} · ${identity}` : label;') &&
      run.includes('identityName.textContent = identity;'),
    'only the toolbar displays the full identity');
check(shell.includes('_refreshEditorActionIdentity('),
    'execution identity changes refresh the action context');
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
      toolbar.includes('.saved-lump-editor-layout > .console-panel'),
    'saved-LUMP mode places source left and disassembly right while hiding the console');
check(toolbar.includes('grid-template-columns: minmax(0, 1fr) 6px minmax(0, 1fr)') &&
      toolbar.includes('grid-template-rows: minmax(0, 1fr)'),
    'the source/console workspace is a static three-column row');
check(!lumps.includes('getElementById(\'btnToolbarCompile\')') &&
      lumps.includes('getElementById(\'btnHamSaveLump\')') &&
      lumps.includes('getElementById(\'editorActionsDropdown\')') &&
      lumps.includes('lump-source-restored-indicator'),
    'saved-LUMP discard and recovery state use the action menu and compact indicator');

console.log('Editor action menu regression: PASS');