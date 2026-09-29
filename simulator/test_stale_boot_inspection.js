'use strict';

// A rejected executable image cannot suppress inspection of the selected
// immutable SelfTest artifact or promote a newer artifact into its place.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const runSource = fs.readFileSync('simulator/app-run.js', 'utf8');
const memorySource = fs.readFileSync('simulator/app-memory.js', 'utf8');
const shellSource = fs.readFileSync('simulator/app-shell.js', 'utf8');

function extract(name, source) {
    const start = source.indexOf('function ' + name + '(');
    assert(start >= 0, name + ' exists');
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0)
            return source.slice(start, i + 1);
    }
    throw new Error('Unclosed function: ' + name);
}

(async function() {
    const selected = {
        token: '4a00000a', filename: 'SelfTest.selected.lump',
        binary_hash: 'selected-hash', ns_slot: 10,
    };
    const opened = [];
    const status = { textContent: '' };
    const consolePanel = { textContent: '' };
    const context = {
        window: {
            _editorStateHydrated: true, _startupDefaultView: 'editor',
            LumpRegistry: {
                isServerListFetched: () => true,
                getServerList: () => [selected, {
                    token: '4a00000b', ns_slot: 10,
                    compiled_at: 999, boot_resident: true,
                }],
            },
        },
        currentView: 'editor', activeUserTabId: null, bootEntrySlot: 10,
        sim: { lastBootImageError: null },
        document: {
            getElementById(id) {
                if (id === 'disassemblyPresentationStatus') return status;
                if (id === 'editorConsole') return consolePanel;
                return null;
            },
        },
        fetch(url) {
            return Promise.resolve({
                ok: !url.startsWith('/api/boot-image/binary'), status: 409,
                json: () => Promise.resolve(url.startsWith('/api/boot-image/binary')
                    ? { error: 'Boot image inputs changed after preparation' }
                    : url === '/api/boot-config'
                        ? { lumpCatalog: [{ token: '4a00000b', nsSlot: 10 }] }
                        : { abstractions: [{
                            slot: 10, boot: true, token: selected.token,
                            filename: selected.filename, binary_hash: selected.binary_hash,
                        }] }),
            });
        },
        openLumpInEditor(token, options) {
            opened.push([token, options]);
            context.window._editorOpenedBootInspectionToken = token;
            context._showBootArtifactInspectionStatus();
            return Promise.resolve(true);
        },
        console: { warn() {} }, Promise,
    };
    vm.createContext(context);
    vm.runInContext([
        extract('_currentEditorOwner', runSource),
        extract('_configuredBootLumpToken', runSource),
        extract('_openConfiguredBootLumpInDefaultEditor', runSource),
        extract('_showBootArtifactInspectionStatus', memorySource),
        extract('_reportBootImageRejection', memorySource),
        extract('_probeBootImage', memorySource),
    ].join('\n'), context);
    assert.equal(await context._probeBootImage(), null);
    assert.equal(await context._openConfiguredBootLumpInDefaultEditor(), true);
    assert.equal(opened[0][0], selected.token);
    assert.equal(opened[0][1].bootInspection, true);
    assert.match(status.textContent, /Read-only saved boot-entry artifact/);
    assert.match(status.textContent, /Boot image stale\/rejected/);
    assert.match(consolePanel.textContent, /\[BOOTIMG\]/);
    assert.equal(context.window.bootImageAvailable, undefined);
    // A later boot rejection must update an already-open inspection surface.
    context._reportBootImageRejection('Namespace inputs are stale');
    assert.match(status.textContent, /Namespace inputs are stale/);
    // A mismatched catalog identity must not be silently substituted.
    context.window.LumpRegistry.getServerList = () => [{
        ...selected, binary_hash: 'another-revision',
    }];
    context.window._configuredBootLumpOpenPromise = null;
    assert.equal(await context._openConfiguredBootLumpInDefaultEditor(), false);
    assert.equal(opened.length, 1);
    // Unrelated Tunnel/Ethernet edits make preparation stale, but an explicit
    // simulator read still returns the unchanged committed image. The saved
    // My Programs SelfTest selection remains the exact inspection target.
    const bytes = new ArrayBuffer(16);
    const requests = [];
    context.fetch = url => {
        requests.push(url);
        return Promise.resolve({
            ok: true,
            headers: { get: key => key === 'X-Simulator-Image-Stale' ? 'true' : null },
            arrayBuffer: () => Promise.resolve(bytes),
        });
    };
    assert.strictEqual(await context._probeBootImage(), bytes);
    assert.equal(context.window._simulatorBootImageStale, true);
    assert.deepEqual(requests, ['/api/boot-image/binary?simulator=1']);
    assert.match(memorySource, /async function _refreshCommittedBootImageCache\(\)[\s\S]*?fetch\('\/api\/boot-image\/binary\?simulator=1'/);
    assert.match(shellSource, /_probeBootImage\(\)\.then\(buf => \{[\s\S]*?_accepted = sim\.loadBootImage\(buf\) === true/);
    assert.doesNotMatch(shellSource.slice(
        shellSource.indexOf('_probeBootImage().then(buf => {'),
        shellSource.indexOf('sim.on(\'programLoaded\'', shellSource.indexOf('_probeBootImage().then(buf => {'))),
    /prepareSavedArtifactForRun|savePreparedBootEntry|boot-image\/generate/);
    context.window.bootImage = bytes;
    context.window.bootImageAvailable = true;
    context.window.BootEntryUI = { get: () => ({ status: 'stale-image' }) };
    vm.runInContext(extract('_bootHasCommittedImage', runSource), context);
    assert.equal(context._bootHasCommittedImage(), true);
    context.sim = { bootComplete: true, programName: 'My Programs SelfTest',
        _bootImageLoaded: false };
    context._ensureCommittedImageForBoot = () => { throw new Error('unexpected preparation gate'); };
    vm.runInContext(extract('_requireCommittedImageForExecution', runSource), context);
    assert.equal(context._requireCommittedImageForExecution('Run'), true);
    assert.equal(context._requireCommittedImageForExecution('Walk'), true);
    assert.equal(context._requireCommittedImageForExecution('Step'), true);
    context.sim = { bootComplete: false, _bootImageLoaded: false };
    context._ensureCommittedImageForBoot = () => false;
    assert.equal(context._requireCommittedImageForExecution('Step'), false,
        'missing loaded bytes still prevent executing an unbooted machine');
    console.log('PASS stale boot inputs leave selected SelfTest inspectable without loading image');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});