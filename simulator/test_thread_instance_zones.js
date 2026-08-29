'use strict';

// Regression coverage for Thread detail rendering from the selected Namespace
// body.  The two generated Threads deliberately receive different saved values;
// the view must never substitute the active simulator DR/STO state or Thread.1.

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const AbstractionRegistry = require('./abstractions.js');
const SystemAbstractions = require('./system_abstractions.js');

global.window = {
    bootConfig: {
        step1: {
            totalNamespaceWords: 16384,
            namespaceLumpWords: 1024,
            threadLumpWords: 256,
            threadCount: 3,
        },
    },
};
const ChurchSimulator = require('./simulator.js');
const sim = new ChurchSimulator();

const dom = new JSDOM('<!doctype html><body><div id="namespaceTable"></div><div id="crRegs"></div></body>');
const sandbox = {
    console,
    document: dom.window.document,
    window: dom.window,
    sim,
    setTimeout,
    clearTimeout,
    fetch: () => Promise.reject(new Error('not used in this test')),
    requestAnimationFrame: cb => cb(),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    abstractionRegistry: { abstractions: [] },
    currentView: 'namespace',
    correctCRDetailTab: tab => tab,
    _lumpManifests: {},
    _petNameDRMap: {},
};
sandbox.window.sim = sim;
sandbox.window.bootConfig = global.window.bootConfig;
sandbox.window.addEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/app-memory.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/app-cr-display.js', 'utf8'), sandbox);

// CR rows derive validation from the live Namespace every time they render.
// Cover matching, stale, missing, malformed, revoked, Abstract, and NULL rows.
const validationSlot = 11;
const validationEntry = sim.readNSEntry(validationSlot);
const validationSeq = sim.parseNSWord1(validationEntry.word1_limit).gtSeq;
const crWordsFor = word0 => ({
    word0: word0 >>> 0,
    word1: validationEntry.word0_location >>> 0,
    word2: validationEntry.word1_limit >>> 0,
    word3: validationEntry.word3_cache_token >>> 0,
    m: 0,
});
sim.cr[0] = crWordsFor(sim.createGT(validationSeq, validationSlot, { R: 1 }, 1));
sim.cr[1] = crWordsFor(sim.createGT((validationSeq + 1) & 0x1FF, validationSlot, { E: 1 }, 1));
const missingSlot = Math.min(sim.MAX_NS_ENTRIES - 1, sim.nsCount + 5);
sim.cr[2] = crWordsFor(sim.createGT(1, missingSlot, { W: 1 }, 1));
const malformedChurchGT = (
    (3 << 28) | (1 << 27) | (1 << 25) |
    ((validationSeq & 0x1FF) << 16) | validationSlot
) >>> 0;
sim.cr[3] = crWordsFor(malformedChurchGT);
const revokedSlot = 12;
const revokedEntry = sim.readNSEntry(revokedSlot);
const revokedSeq = sim.parseNSWord1(revokedEntry.word1_limit).gtSeq;
sim.memory[sim._nsSlotBase(revokedSlot) + 2] ^= 1;
sim.cr[4] = crWordsFor(sim.createGT(revokedSeq, revokedSlot, { R: 1 }, 1));
sim.cr[5] = crWordsFor(sim.createAbstractGT(0, { R: 1 }, 7, 0x1234));
sim.cr[6] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };

assert.strictEqual(sim.getFormattedCR(0).validationStatus, 'valid',
    'matching GT and live Namespace versions validate');
assert.strictEqual(sim.getFormattedCR(1).validationStatus, 'stale',
    'mismatched GT and live Namespace versions are stale');
assert.strictEqual(sim.getFormattedCR(2).validationStatus, 'missing',
    'a GT outside the live Namespace is missing');
assert.strictEqual(sim.getFormattedCR(3).validationStatus, 'malformed',
    'an invalid multi-Church-permission GT is malformed');
assert.strictEqual(sim.getFormattedCR(4).validationStatus, 'revoked',
    'a matching GT whose live Namespace seal is invalid is revoked');
assert.strictEqual(sim.getFormattedCR(5).validationStatus, 'unavailable',
    'an Abstract GT has no Namespace version to validate');
assert.strictEqual(sim.getFormattedCR(5).nsSlot, null,
    'an Abstract GT payload is never exposed as a Namespace slot');
assert.strictEqual(sim.getFormattedCR(5).perms, '-R-----',
    'an Abstract GT uses its dedicated R/W permission layout');
assert.strictEqual(sim.getFormattedCR(5).gtSeq, 7,
    'an Abstract GT uses its dedicated seven-bit version field');
assert.strictEqual(sim.getFormattedCR(6).validationStatus, 'null',
    'a NULL CR remains a safe neutral state');

sandbox._petNameCRMap = {};
sandbox.updateCRDisplay();
const crHtml = dom.window.document.getElementById('crRegs').innerHTML;
assert(crHtml.includes(`NS[${validationSlot}]`) &&
       crHtml.includes(sim.nsLabels[validationSlot]),
    'rendered CR target includes NS[n] and its live label');
assert(crHtml.includes('[-R-----]'),
    'rendered CR row includes its decoded permission set');
assert.strictEqual(dom.window.document.querySelectorAll('.cr-version-valid').length, 1,
    'only the matching row renders a validation success');
assert(dom.window.document.querySelector('.cr-version-valid').textContent.includes('\u2713'),
    'the matching row renders a visible check mark');
assert(dom.window.document.querySelector('.cr-version-stale'),
    'the stale row renders a non-success state');
assert(dom.window.document.querySelector('.cr-version-missing'),
    'the missing row renders a non-success state');
assert(dom.window.document.querySelector('.cr-version-malformed'),
    'the malformed row renders a non-success state');
assert(dom.window.document.querySelector('.cr-version-revoked'),
    'the revoked row renders a non-success state');
assert(dom.window.document.querySelector('.cr-version-unavailable'),
    'the Abstract row renders a non-success state');
assert(crHtml.includes('Abstract GT'),
    'the Abstract row renders no fabricated Namespace target');
assert(dom.window.document.querySelector('.cr-version-unavailable').textContent.includes('v7 / NS \u2014') &&
       crHtml.includes('[-R-----]'),
    'the Abstract row renders its own permissions and unavailable version check');
assert(dom.window.document.querySelector('.cr-version-neutral'),
    'the NULL row renders a safe neutral version cell');

// Re-rendering derives status from the current live Namespace, not cached data.
sim.memory[sim._nsSlotBase(validationSlot) + 1] =
    (validationEntry.word1_limit ^ (1 << 21)) >>> 0;
sandbox.updateCRDisplay();
assert.strictEqual(sim.getFormattedCR(0).validationStatus, 'stale',
    'a live Namespace sequence mutation makes the same CR stale');
assert.strictEqual(dom.window.document.querySelectorAll('.cr-version-valid').length, 0,
    'a refresh removes the validation check after the live version changes');

const thread2 = sim.getThreadInstanceLayout(11);
const thread3 = sim.getThreadInstanceLayout(12);
assert(thread2.valid && thread3.valid, 'generated Thread bodies must decode as resident Threads');
assert.strictEqual(thread2.base, sim.readNSEntry(11).word0_location);
assert.strictEqual(thread3.base, sim.readNSEntry(12).word0_location);
assert.strictEqual(thread2.heapWords, 12, 'Thread header cc defines its heap size');
assert.strictEqual(thread2.stackWords, 32, 'Thread header cw defines its stack size');
assert.strictEqual(thread2.capsStart, 244, 'capabilities remain at the Thread body tail');

// Runtime register/capability writes update the live Thread image, but the
// persistence snapshot must retain the pre-execution words and header.
const runtimeSim = new ChurchSimulator();
const runtimeThread = runtimeSim.getThreadInstanceLayout(11);
const runtimeHeaderBefore = runtimeSim.memory[runtimeThread.base] >>> 0;
const runtimeDr1Addr = runtimeThread.base + runtimeThread.drStart + 1;
const runtimeDrBefore = runtimeSim.memory[runtimeDr1Addr] >>> 0;
const runtimeCapAddr = runtimeThread.base + runtimeThread.capsStart;
const runtimeCapBefore = runtimeSim.memory[runtimeCapAddr] >>> 0;
const runtimeStackAddr = runtimeThread.base + runtimeThread.stackEnd;
const runtimeStackBefore = runtimeSim.memory[runtimeStackAddr] >>> 0;
const runtimeThreadEntry = runtimeSim.readNSEntry(11);
runtimeSim.cr[12].word0 = runtimeSim.createGT(0, 11, {R:1, W:1}, 2);
runtimeSim.cr[12].word1 = runtimeThread.base;
runtimeSim.cr[12].word2 = runtimeThreadEntry.word1_limit >>> 0;
runtimeSim._currentThreadSlot = 11;
runtimeSim._writeDR(1, 0xD1A0D1A0);
runtimeSim._writeCR(0, 0x4A000006, runtimeSim.readNSEntry(6));
runtimeSim._writeRuntimeWord(runtimeStackAddr, 0xC011F24D);
const persistentAfterRuntime = runtimeSim.snapshotPersistentMemory(runtimeSim.memory.length);
assert.strictEqual(runtimeSim.memory[runtimeDr1Addr], 0xD1A0D1A0,
    'runtime DR writes remain visible in the active Thread image');
assert.strictEqual(runtimeSim.memory[runtimeCapAddr], 0x4A000006,
    'runtime LOAD-style CR writes remain visible in the active Thread image');
assert.strictEqual(persistentAfterRuntime[runtimeDr1Addr], runtimeDrBefore,
    'runtime DR changes are excluded from persistent snapshots');
assert.strictEqual(persistentAfterRuntime[runtimeCapAddr], runtimeCapBefore,
    'runtime capability changes are excluded from persistent snapshots');
assert.strictEqual(runtimeSim.memory[runtimeStackAddr], 0xC011F24D,
    'runtime CALL-frame state remains visible in the live Thread stack');
assert.strictEqual(persistentAfterRuntime[runtimeStackAddr], runtimeStackBefore,
    'runtime CALL-frame state is excluded from persistent snapshots');
assert.strictEqual(persistentAfterRuntime[runtimeThread.base], runtimeHeaderBefore,
    'runtime protected-content changes leave the persisted Thread header unchanged');
assert.strictEqual(runtimeSim.memory[runtimeThread.base], runtimeHeaderBefore,
    'runtime protected-content changes leave the live Thread header unchanged');
runtimeSim.writePersistentWord(runtimeDr1Addr, 0x51544154);
assert.strictEqual(runtimeSim.snapshotPersistentMemory(runtimeSim.memory.length)[runtimeDr1Addr],
    0x51544154,
    'an explicit static edit rebases a previously runtime-mutated word');

// Give the bodies unmistakably separate private contents and make active
// simulator state intentionally disagree with both.
sim.memory[thread2.base + thread2.drStart] = 0x22220001;
sim.memory[thread2.base + thread2.heapStart] = 0x22220017;
sim.memory[thread2.base + thread2.stackEnd] = 0x222200F3;
sim.memory[thread2.base + thread2.capsStart] = 0x4A000006;
sim.memory[thread3.base + thread3.drStart] = 0x33330001;
sim.memory[thread3.base + thread3.heapStart] = 0x33330017;
sim.memory[thread3.base + thread3.stackEnd] = 0x333300F3;
sim.memory[thread3.base + thread3.capsStart] = 0x4A000007;
sim.dr[0] = 0xDEADBEEF;
sim.sto = 999;

const thread2Html = sandbox.renderThreadMemoryLayout(11, true);
const thread3Html = sandbox.renderThreadMemoryLayout(12, true);
assert(thread2Html.includes('0x22220001'), 'Thread#2 shows its saved DR value');
assert(thread2Html.includes('0x22220017'), 'Thread#2 shows its saved heap value');
assert(!thread2Html.includes('0x33330001'), 'Thread#2 never reads Thread#3 memory');
assert(!thread2Html.includes('0xDEADBEEF'), 'Thread detail never substitutes live DR state');
assert(!thread2Html.includes('STO=999'), 'Thread detail never substitutes live stack state');
assert(thread3Html.includes('0x33330001'), 'Thread#3 shows its own saved DR value');
assert(thread3Html.includes('0x33330017'), 'Thread#3 shows its own saved heap value');
assert(!thread3Html.includes('0x22220001'), 'Thread#3 never reads Thread#2 memory');
sim.bootEntrySlot = 6;
const bootSlotSixHtml = sandbox.renderThreadMemoryLayout(11, true);
sim.bootEntrySlot = 7;
assert.strictEqual(sandbox.renderThreadMemoryLayout(11, true), bootSlotSixHtml,
    'changing active boot selection does not alter an inactive Thread detail');

// CR12 is not live before boot, but its detail panel must still project the
// currently selected suspended Thread image.  Thread.1 may validly start at
// physical word zero, so the renderer cannot use base-address truthiness.
const crDetailTitle = dom.window.document.createElement('div');
crDetailTitle.id = 'crDetailTitle';
const crDetailContent = dom.window.document.createElement('div');
crDetailContent.id = 'crDetailContent';
dom.window.document.body.append(crDetailTitle, crDetailContent);
vm.runInContext('selectedCR = 12;', sandbox);
sandbox._petNameCRMap = {};
sim.bootComplete = false;
sim._currentThreadSlot = 12;
sandbox.updateCRDetail();
assert(crDetailContent.innerHTML.includes('Thread#3 — Suspended Memory Image'),
    'pre-boot CR12 identifies the selected suspended Thread');
assert(crDetailContent.innerHTML.includes('thread-zone-5') &&
       crDetailContent.innerHTML.includes('thread-zone-4') &&
       crDetailContent.innerHTML.includes('thread-zone-3') &&
       crDetailContent.innerHTML.includes('thread-zone-2') &&
       crDetailContent.innerHTML.includes('thread-zone-1'),
    'pre-boot CR12 exposes all five selected Thread zones');
assert(crDetailContent.innerHTML.includes('0x33330001') &&
       !crDetailContent.innerHTML.includes('0x22220001'),
    'pre-boot CR12 reads the selected Thread#3 body, not Thread#2');
assert(!crDetailContent.textContent.includes('Machine not booted yet'),
    'pre-boot CR12 no longer replaces an available suspended image with a boot hint');

sandbox._nsLabelOpen(12);
let modal = dom.window.document.querySelector('[data-testid="thread-detail-modal"]');
assert(modal, 'clicking a generated Thread Namespace label opens the Thread popup');
assert(modal.textContent.includes('Thread#3'), 'popup identifies the selected generated Thread');
assert(modal.innerHTML.includes('0x33330001'), 'popup renders selected Thread private values');

// A recognizable Thread label with a damaged body remains a Thread view, but
// declares the data unavailable instead of falling back to another layout.
sim.memory[thread2.base] = 0;
sandbox._nsLabelOpen(11);
modal = dom.window.document.querySelector('[data-testid="thread-detail-modal"]');
assert(modal.textContent.includes('THREAD BODY UNAVAILABLE'), 'invalid Thread body gets an explicit unavailable state');

// An ordinary LUMP must continue to use its original generic detail modal.
sandbox._nsLabelOpen(6);
assert.strictEqual(dom.window.document.querySelector('[data-testid="thread-detail-modal"]'), null,
    'ordinary LUMPs do not receive the Thread popup');
assert(dom.window.document.getElementById('_nsLumpModalOverlay').textContent.includes('LUMP HEADER'),
    'ordinary LUMPs retain their generic detail modal');

// A larger allocated Thread body still keeps CR0–CR11 at the hardware's
// architectural +244 home; the allocated size must not make the viewer invent
// a tail at +500.
global.window.bootConfig = {
    step1: {
        totalNamespaceWords: 32768,
        namespaceLumpWords: 1024,
        threadLumpWords: 512,
        threadCount: 2,
    },
};
const wideSim = new ChurchSimulator();
const wideThread = wideSim.getThreadInstanceLayout(11);
assert(wideThread.valid, 'a 512-word generated Thread body decodes');
assert.strictEqual(wideThread.lumpSize, 512, 'selected header retains its full allocated size');
assert.strictEqual(wideThread.capsStart, 244, 'larger Thread bodies retain the actual CR0 home');
assert.notStrictEqual(wideThread.capsStart, wideThread.lumpSize - wideThread.capsWords,
    'viewer does not fabricate a tail capability zone for a larger Thread');
assert.notStrictEqual(wideSim.memory[wideThread.base + wideThread.capsStart], 0,
    'the selected 512-word body exposes its stored CR0');

// Full boot runs Navana.Init, which mints runtime PassKeys.  Those credentials
// live in Navana's virtual map and must not expand or rewrite the fixed twelve
// CR homes in any resident Thread body.
global.window.bootConfig.step1.threadCount = 3;
const bootRegistry = new AbstractionRegistry();
new SystemAbstractions(bootRegistry);
const bootSim = new ChurchSimulator();
bootSim.initAbstractions(bootRegistry, null, null);
const bootThreadHeader = bootSim.memory[bootSim.readNSEntry(1).word0_location] >>> 0;
for (let i = 0; i < 8 && !bootSim.bootComplete && !bootSim.halted; i++) {
    assert.strictEqual(bootSim._bootStep(), true, `boot step ${i} advances`);
}
assert.strictEqual(bootSim.bootComplete, true, 'full boot completes with Navana.Init');
assert.strictEqual(
    bootSim.memory[bootSim.readNSEntry(1).word0_location] >>> 0,
    bootThreadHeader,
    'Navana.Init does not rewrite the fixed Thread.1 header'
);
for (const slot of [1, 11, 12]) {
    const layout = bootSim.getThreadInstanceLayout(slot);
    assert(layout.valid, `${bootSim.nsLabels[slot]} remains a valid Thread after boot`);
    assert.strictEqual(layout.capsStart, 244, `${bootSim.nsLabels[slot]} keeps CR homes at +244`);
    assert.strictEqual(layout.capsWords, 12, `${bootSim.nsLabels[slot]} keeps exactly twelve CR homes`);
}

console.log('thread instance zone tests passed');