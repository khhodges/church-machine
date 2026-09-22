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

const toolbarStart = source.indexOf('id="nsSaveBtn"');
const toolbarEnd = source.indexOf("html += '<button", toolbarStart);
const toolbar = source.slice(toolbarStart, toolbarEnd);
check('Namespace toolbar has Save for next build button',
    toolbarStart !== -1 && toolbar.includes('Save for next build'));
check('Namespace save button acknowledges errors before allowing retry',
    toolbar.includes('_nsTableSaveClick(this)'));
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
check('Namespace save carries the authoritative Namespace fingerprint',
    source.includes('namespaceFingerprint,') &&
    source.includes("fetch('/api/boot-image/ns-state'"));

const saveStart = source.indexOf('window._nsTableSave = async function(btn)');
const saveEnd = source.indexOf('// ── NS Table Load', saveStart);
const save = source.slice(saveStart, saveEnd);
const saveRaw = save.indexOf("fetch('/api/boot-image/save-ns'");
const clearDirty = save.indexOf('_setNsDirty(false)');
check('single save submits Namespace bytes without a competing boot-config plan',
    saveRaw !== -1 &&
    save.includes('boot_config: null') &&
    save.includes('namespaceFingerprint,'));
check('single save does not issue a separate post-commit config write',
    save.lastIndexOf('await window._ensureNamespaceBuildConfig()') < saveRaw &&
    save.includes('window._setActiveBootConfig('));
check('single save clears the dirty indicator after transaction acknowledgement',
    clearDirty > saveRaw);

check('Namespace save regenerates and validates a missing boot image before snapshotting',
    save.indexOf("fetch('/api/boot-image/generate'") !== -1 &&
    save.indexOf("sim.loadBootImage(_generated)") !== -1 &&
    save.indexOf("fetch('/api/boot-image/generate'") < saveRaw);
check('Namespace save preserves a validated live image after cache invalidation',
    save.includes('sim._bootImageLoaded === true') &&
    save.includes('sim._bootImageLoaded !== true'));
check('Namespace save preserves resident artifact locators for unchanged rows',
    save.includes('_savedBySlot') &&
    save.includes('_nsApplyArtifactBindingForSave(') &&
    source.includes("'token', 'filename', 'issue_n'") &&
    source.includes('Number(binding.seq) === Number(rich.seq)'));
check('Namespace save prefers exact staged selection over catalog lookup',
    save.includes('_nsExplicitArtifactBindings') &&
    !save.includes('_lumpsCache'));

const editorSource = fs.readFileSync(path.join(__dirname, 'app-lump-editor.js'), 'utf8');
const step1Start = editorSource.indexOf('function _postStep1(');
const step1End = editorSource.indexOf('function _rlLoad()', step1Start);
const step1Save = editorSource.slice(step1Start, step1End);
check('Step 1 save does not write a boot target through boot-config',
    !step1Save.includes('bootEntrySlot: (function') &&
    !step1Save.includes("localStorage.getItem('bootEntrySlot')"));

const loadStart = editorSource.indexOf('function _rlLoad()');
const loadEnd = editorSource.indexOf('function _rlInitStep2(', loadStart);
const residentLoad = editorSource.slice(loadStart, loadEnd);
check('Resident LUMP load reads the authoritative Namespace boot entry',
    residentLoad.includes("fetch('/api/boot-image/ns-state'") &&
    residentLoad.includes('namespaceFingerprint'));

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