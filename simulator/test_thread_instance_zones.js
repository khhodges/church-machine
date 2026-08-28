'use strict';

// Regression coverage for Thread detail rendering from the selected Namespace
// body.  The two generated Threads deliberately receive different saved values;
// the view must never substitute the active simulator DR/STO state or Thread.1.

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

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

const dom = new JSDOM('<!doctype html><body><div id="namespaceTable"></div></body>');
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
};
sandbox.window.sim = sim;
sandbox.window.bootConfig = global.window.bootConfig;
sandbox.window.addEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/app-memory.js', 'utf8'), sandbox);

const thread2 = sim.getThreadInstanceLayout(11);
const thread3 = sim.getThreadInstanceLayout(12);
assert(thread2.valid && thread3.valid, 'generated Thread bodies must decode as resident Threads');
assert.strictEqual(thread2.base, sim.readNSEntry(11).word0_location);
assert.strictEqual(thread3.base, sim.readNSEntry(12).word0_location);
assert.strictEqual(thread2.heapWords, 12, 'Thread header cc defines its heap size');
assert.strictEqual(thread2.stackWords, 32, 'Thread header cw defines its stack size');
assert.strictEqual(thread2.capsStart, 244, 'capabilities remain at the Thread body tail');

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
sandbox.selectedCR = 12;
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

console.log('thread instance zone tests passed');