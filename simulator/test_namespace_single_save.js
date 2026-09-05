#!/usr/bin/env node
// Regression guard: Namespace changes must have one visible save action that
// commits both the live table and the next-build configuration.

'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
let failures = 0;

function check(name, condition) {
    if (condition) console.log(`PASS ${name}`);
    else {
        console.error(`FAIL ${name}`);
        failures++;
    }
}

const toolbarStart = source.indexOf("html += `<button id=\"nsSaveBtn\"");
const toolbarEnd = source.indexOf("html += '<button", toolbarStart);
const toolbar = source.slice(toolbarStart, toolbarEnd);
check('Namespace toolbar has Save for next build button',
    toolbar.includes('Save for next build'));
check('Namespace toolbar does not expose a separate policy-save button',
    !toolbar.includes('nsPrefetchSaveBtn') && !source.includes('id="nsPrefetchSaveBtn"'));

const helperStart = source.indexOf('window._ensureNamespaceBuildConfig = async function()');
const helperEnd = source.indexOf('window._nsPrefetchSave = async function()', helperStart);
const helper = source.slice(helperStart, helperEnd);
check('fresh projects load defaults before saving Namespace build settings',
    helper.includes("fetch('/api/boot-config')") &&
    helper.includes('serverData.config || serverData.defaults'));
check('Namespace build settings are persisted through the boot-config endpoint',
    helper.includes("method: 'POST'") && helper.includes("fetch('/api/boot-config'"));
check('Namespace save carries the selected Lightning Bolt boot entry',
    helper.includes('bootEntrySlot: cfg.bootEntrySlot') &&
    helper.includes("localStorage.getItem('bootEntrySlot')"));

const saveStart = source.indexOf('window._nsTableSave = async function(btn)');
const saveEnd = source.indexOf('// ── NS Table Load', saveStart);
const save = source.slice(saveStart, saveEnd);
const saveRaw = save.indexOf("fetch('/api/boot-image/save-ns'");
const saveConfig = save.lastIndexOf('await window._ensureNamespaceBuildConfig()');
const clearDirty = save.indexOf('_setNsDirty(false)');
check('single save writes the Namespace table before next-build settings',
    saveRaw !== -1 && saveConfig > saveRaw);
check('single save clears the dirty indicator only after both writes',
    clearDirty > saveConfig);

check('Namespace save regenerates and validates a missing boot image before snapshotting',
    save.indexOf("fetch('/api/boot-image/generate'") !== -1 &&
    save.indexOf("sim.loadBootImage(_generated)") !== -1 &&
    save.indexOf("fetch('/api/boot-image/generate'") < saveRaw);
check('Namespace save preserves a validated live image after cache invalidation',
    save.includes('sim._bootImageLoaded === true') &&
    save.includes('sim._bootImageLoaded !== true'));
check('Namespace save preserves resident artifact locators for unchanged rows',
    save.includes('_savedBySlot') &&
    save.includes("'token', 'filename', 'issue_n'") &&
    save.includes("_saved.name === _lbl"));

const editorSource = fs.readFileSync(path.join(__dirname, 'app-lump-editor.js'), 'utf8');
const step1Start = editorSource.indexOf('function _postStep1(');
const step1End = editorSource.indexOf('function _rlLoad()', step1Start);
const step1Save = editorSource.slice(step1Start, step1End);
check('Step 1 save also carries the selected Lightning Bolt boot entry',
    step1Save.includes('bootEntrySlot:') &&
    step1Save.includes("localStorage.getItem('bootEntrySlot')"));
check('Step 1 save falls back to the server boot entry before slot 6',
    step1Save.includes('savedBootEntry') &&
    step1Save.includes('savedBootEntry : 6'));

const loadStart = editorSource.indexOf('function _rlLoad()');
const loadEnd = editorSource.indexOf('function _rlInitStep2(', loadStart);
const residentLoad = editorSource.slice(loadStart, loadEnd);
check('Resident LUMP load prefers the persisted server boot entry',
    residentLoad.includes('The server is authoritative') &&
    residentLoad.indexOf('if (Number.isInteger(savedBootSlot)') <
        residentLoad.indexOf('else if (Number.isInteger(localBootSlot)'));

const addStart = source.indexOf('const _doInstall = async function(words)');
const addEnd = source.indexOf('const _onError = function(err)', addStart);
const addInstall = source.slice(addStart, addEnd);
check('adding a Namespace row automatically invokes the unified save',
    addInstall.includes('await window._nsTableSave(saveBtn)'));

const policyStart = source.indexOf('window._nsPrefetchChange = function');
const policyEnd = source.indexOf('window._ensureNamespaceBuildConfig', policyStart);
const policyChange = source.slice(policyStart, policyEnd);
check('load-policy edits mark the same save button as dirty',
    policyChange.includes('_setNsDirty(true)'));

if (failures) {
    console.error(`\n${failures} Namespace save workflow check(s) failed.`);
    process.exit(1);
}

console.log('\nNamespace single-save workflow checks passed.');