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
check(index.includes('id="editorActionsIdentityValue"'),
    'the hamburger menu has a full identity context area');
check(run.includes('function _editorActionIdentity(name)') &&
      run.includes('return `${dotName}#${issue}`;'),
    'the action identity is built as the full dot.pet.name issue identity');
check(run.includes('button.textContent = identity ? `${label} · ${identity}` : label;'),
    'action labels include the full identity');
check(shell.includes('_refreshEditorActionIdentity('),
    'execution identity changes refresh the action context');
check(toolbar.includes('.editor-actions-context') &&
      toolbar.includes('.editor-identity-name'),
    'the full identity has dedicated responsive toolbar styling');
check(index.includes('class="editor-layout editor-source-disassembly-row"') &&
      index.includes('aria-label="Source and disassembly workspace"'),
    'source and disassembly use one explicit full-width workspace row');
check(toolbar.includes('grid-template-columns: minmax(0, 1fr) 6px minmax(0, 1fr)') &&
      toolbar.includes('grid-template-rows: minmax(0, 1fr)'),
    'the source/disassembly workspace is a static three-column row');
check(!lumps.includes('getElementById(\'btnToolbarCompile\')') &&
      lumps.includes('getElementById(\'editorActionsWrap\')'),
    'saved-LUMP discard insertion no longer depends on retired toolbar buttons');

console.log('Editor action menu regression: PASS');