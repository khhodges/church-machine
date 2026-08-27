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

const saveStart = source.indexOf('window._nsTableSave = async function(btn)');
const saveEnd = source.indexOf('// ── NS Table Load', saveStart);
const save = source.slice(saveStart, saveEnd);
const saveRaw = save.indexOf("fetch('/api/boot-image/save-ns'");
const saveConfig = save.indexOf('await window._ensureNamespaceBuildConfig()');
const clearDirty = save.indexOf('_setNsDirty(false)');
check('single save writes the Namespace table before next-build settings',
    saveRaw !== -1 && saveConfig > saveRaw);
check('single save clears the dirty indicator only after both writes',
    clearDirty > saveConfig);

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