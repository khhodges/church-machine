'use strict';

/*
 * Task #3446 step 4: inspection is observational, but a patch must retain the
 * Thread / CR / Namespace-generation identity it was shown against.
 */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const displaySource = fs.readFileSync(__dirname + '/app-cr-display.js', 'utf8');
const detailSource = fs.readFileSync(__dirname + '/app-cr-detail.js', 'utf8');
const runSource = fs.readFileSync(__dirname + '/app-run.js', 'utf8');

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0, `${name} is present`);
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`unable to extract ${name}`);
}

function extractAssignedFunction(source, prefix) {
    const start = source.indexOf(prefix);
    assert(start >= 0, `${prefix} is present`);
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`unable to extract ${prefix}`);
}

let namespaceGeneration = 7;
let activeThreadSlot = 1;
const cr = {
    gtIndex: 8,
    gtSeq: 7,
    word0_gt: '00000001',
    word1_location: 0,
    word2_limit_raw: 0,
    limit17: 0,
    isNull: false,
};
const simulator = {
    _liveThreadOwned: true,
    running: false,
    walkActive: false,
    threadStatusRows() {
        return [
            { slot: activeThreadSlot, name: `Thread.${activeThreadSlot}`, active: true },
            { slot: activeThreadSlot === 1 ? 11 : 1,
                name: activeThreadSlot === 1 ? 'Thread.2' : 'Thread.1', active: false },
        ];
    },
    getFormattedCR() { return { ...cr }; },
    readNSEntry(slot) {
        return slot === 8 ? { word1_limit: namespaceGeneration } : null;
    },
    parseNSWord1(word) { return { gtSeq: word }; },
};
const sandbox = {
    sim: simulator,
    console,
    window: {},
    document: { getElementById() { return null; } },
};
vm.createContext(sandbox);
vm.runInContext(displaySource, sandbox);

vm.runInContext('selectedCR = 4;', sandbox);
const binding = vm.runInContext('getDisplayedCRMutationBinding()', sandbox);
assert.deepStrictEqual(JSON.parse(JSON.stringify(binding)), {
    crIdx: 4, nsIdx: 8, namespaceGeneration: 7,
    threadSlot: 1, threadName: 'Thread.1', mode: 'live',
}, 'CR observation captures the live Thread, CR, Namespace slot, and generation');

namespaceGeneration = 8;
let validation = vm.runInContext(
    `validateDisplayedCRMutationBinding(${JSON.stringify(binding)}, true)`, sandbox);
assert.strictEqual(validation.ok, false, 'generation change rejects the captured patch target');
assert.match(validation.reason, /stale.*Refresh target/i,
    'generation rejection gives an explicit refresh action');

const refreshResult = vm.runInContext(
    `refreshDisplayedCRMutationBinding(${JSON.stringify(binding)})`, sandbox);
assert.strictEqual(refreshResult.ok, true, 'explicit refresh rebinds only the displayed target');
validation = vm.runInContext(
    `validateDisplayedCRMutationBinding(${JSON.stringify(refreshResult.binding)}, true)`, sandbox);
assert.strictEqual(validation.ok, true, 'refreshed Namespace generation is patchable while paused');

activeThreadSlot = 11;
validation = vm.runInContext(
    `validateDisplayedCRMutationBinding(${JSON.stringify(refreshResult.binding)}, true)`, sandbox);
assert.strictEqual(validation.ok, false, 'Thread ownership change rejects a formerly live target');
assert.match(validation.reason, /snapshot/i,
    'Thread ownership rejection identifies the former target as a snapshot');

activeThreadSlot = 1;
simulator.running = true;
validation = vm.runInContext(
    `validateDisplayedCRMutationBinding(${JSON.stringify(refreshResult.binding)}, true)`, sandbox);
assert.strictEqual(validation.ok, false, 'running simulator rejects patch mutation');
assert.match(validation.reason, /pause execution/i,
    'running mutation rejection explains the pause gate');
simulator.running = false;

const injectStart = detailSource.indexOf('function injectCRCode(');
const injectEnd = detailSource.indexOf('\n\nasync function injectCRCodeToFPGA', injectStart);
assert(injectStart >= 0 && injectEnd > injectStart, 'patch materializer is extractable');
vm.runInContext('let _simRunActive = false; let walkRunning = false;', sandbox);
vm.runInContext(detailSource.slice(injectStart, injectEnd), sandbox);
vm.runInContext(`_editorCREditBinding = ${JSON.stringify(refreshResult.binding)};`, sandbox);
simulator.running = true;
const log = { textContent: '', scrollTop: 0, scrollHeight: 0 };
assert.strictEqual(vm.runInContext('injectCRCode(log)', Object.assign(sandbox, { log })), null,
    'patch materializer cannot bypass the running-state gate');
assert.match(log.textContent, /pause execution/i,
    'patch materializer reports the running-state gate before compilation or writes');
simulator.running = false;

// Sticky replay is a later mutation request, so it must validate the same
// complete record rather than treating the Namespace generation as enough.
const reapplySource = extractAssignedFunction(
    detailSource, 'window._reapplyStickyPatches = function()');
let persistedClears = 0;
const replayMessages = [];
sandbox._clearPersistedStickyPatch = () => { persistedClears++; };
sandbox.appendOutput = message => { replayMessages.push(message); };
sandbox._stickyPatches = {
    8: {
        words: [0xDEADBEEF], newCW: 1, nsIdx: 8, crIdx: 4,
        threadSlot: 1, namespaceGeneration: 8,
        binding: {
            crIdx: 4, nsIdx: 8, namespaceGeneration: 8,
            threadSlot: 1, threadName: 'Thread.1', mode: 'live',
        },
    },
};
simulator.memory = new Uint32Array([0, 0, 0]);
activeThreadSlot = 11;
vm.runInContext(reapplySource, sandbox);
vm.runInContext('window._reapplyStickyPatches()', sandbox);
assert.strictEqual(sandbox._stickyPatches[8], undefined,
    'sticky replay rejects a patch when its recorded Thread is no longer live');
assert.strictEqual(persistedClears, 1,
    'rejected Thread-target replay clears the persisted mutation request');
assert.strictEqual(simulator.memory[0], 0,
    'rejected Thread-target replay writes no simulator memory');
assert.match(replayMessages.at(-1), /snapshot|Thread/i,
    'replay rejection identifies the Thread-context target mismatch');

activeThreadSlot = 1;
persistedClears = 0;
sandbox._stickyPatches[8] = {
    words: [0xDEADBEEF], newCW: 1, nsIdx: 8, crIdx: 4,
    threadSlot: 1, namespaceGeneration: 8,
    // An old record with only generation/flat fields is intentionally unsafe.
};
vm.runInContext('window._reapplyStickyPatches()', sandbox);
assert.strictEqual(sandbox._stickyPatches[8], undefined,
    'sticky replay rejects a record without its full displayed binding');
assert.strictEqual(persistedClears, 1,
    'incomplete sticky replay is removed rather than silently redirected');

const openInspectionSource = extractFunction(runSource, 'openThreadContextModal');
assert(!openInspectionSource.includes('selectConfiguredThread('),
    'opening another Thread inspection never invokes CHANGE');
const stripSource = extractFunction(runSource, 'updateThreadIdentityStrip');
assert(stripSource.includes('openThreadContextModal(row.slot, card)') &&
       !stripSource.includes('selectThreadContext(row.slot)'),
    'actual running Thread cards open inspection rather than a context switch');
assert(runSource.includes('LIVE — machine register context') &&
       runSource.includes('SNAPSHOT — saved Thread object'),
    'Thread inspection visibly labels live and stored-snapshot observations');
assert(runSource.includes('threadContextObservation'),
    'Thread inspection modal renders an explicit observation source');

console.log('PASS Thread inspection and patch-target binding');