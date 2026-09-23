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
check('Namespace save explains layout normalization separately from artifact selection',
    toolbar.includes('aria-describedby="nsSaveLayoutNote"') &&
    toolbar.includes('locations and limits are recalculated') &&
    toolbar.includes('does not select a different artifact revision or boot target'));
check('Namespace toolbar does not expose a separate policy-save button',
    !toolbar.includes('nsPrefetchSaveBtn') && !source.includes('id="nsPrefetchSaveBtn"'));

const helperStart = source.indexOf('window._ensureNamespaceBuildConfig = async function(stageOnly = false)');
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
// Execute the preparation block with real integrity code. Nonzero G/F and
// high limit bits must not be dropped by the legacy version-seal wrapper.
const vm = require('vm');
const ChurchSimulator = require('./simulator.js');
const sealBlock = save.slice(
    save.indexOf('        {\n            const nsBase'),
    save.indexOf('        // ── Build ns_state'));
const sealWords = new Uint32Array([0x100, 0xC0623456, 0, 0]);
const sealSim = {
    NS_TABLE_BASE: 0, NS_ENTRY_WORDS: 4, MAX_NS_ENTRIES: 1,
    _integrity32: ChurchSimulator.prototype._integrity32,
};
vm.runInNewContext(sealBlock, {
    sim: sealSim, words: sealWords, bootWordCount: sealWords.length,
});
const expectedSeal = sealSim._integrity32(sealWords[0], sealWords[1]) >>> 0;
check('Namespace preparation seals the exact full descriptor authority word',
    sealWords[2] === expectedSeal && sealWords[1] === 0xC0623456);
vm.runInNewContext(sealBlock, {
    sim: sealSim, words: sealWords, bootWordCount: sealWords.length,
});
check('unchanged Namespace preparation preserves the descriptor seal',
    sealWords[2] === expectedSeal);
const saveRaw = save.indexOf("fetch('/api/boot-image/save-ns'");
const clearDirty = save.indexOf('_setNsDirty(false)');
check('single save includes staged configuration in the same Namespace transaction',
    saveRaw !== -1 &&
    save.includes('boot_config: stagedBuildConfig') &&
    save.includes('namespaceFingerprint,'));
check('single save does not issue a separate post-commit config write',
    save.indexOf('await window._ensureNamespaceBuildConfig(true)') < saveRaw &&
    save.includes('window._setActiveBootConfig('));
check('single save clears the dirty indicator after transaction acknowledgement',
    clearDirty > saveRaw);

check('Namespace save requests missing-image generation in its single transaction',
    !save.includes("fetch('/api/boot-image/generate'") &&
    save.includes('generate: generateForSave') &&
    helper.includes('if (stageOnly) return cfg;'));
check('Namespace save preserves a validated live image after cache invalidation',
    save.includes('sim._bootImageLoaded === true') &&
    save.includes('const generateForSave = !hasLiveBootImage'));
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