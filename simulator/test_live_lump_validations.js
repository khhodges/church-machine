// test_live_lump_validations.js — Gate Log live LUMP validation regression tests
//
// Covers the simulator-owned validation model and the matching Gate Log cards:
// valid CR15/CR12/CR14 contexts, malformed/stale metadata, unavailable
// contexts, and a live CR14 program switch.
//
// Run: node simulator/test_live_lump_validations.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const assert = require('node:assert/strict');
const namespaceView = require('./namespace-runtime-view');

global.window = { bootConfig: {} };
const ChurchSimulator = require('./simulator.js');

let passed = 0;
let failed = 0;
function check(label, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`PASS ${label}`);
    } else {
        failed++;
        console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    }
}

function bootSim() {
    const sim = new ChurchSimulator();
    // Explicit historical descending-table fixture. The current fallback boot
    // uses Header V2 at zero, not the v1.2 descriptor this test originally
    // assumed. Never repair a live image to satisfy a display check.
    sim.writeNSEntry(0, sim.NS_TABLE_BASE, sim.NS_TABLE_RESERVE - 1, 0, 0, 1, 0, 0, 0);
    let guard = 0;
    while (!sim.bootComplete && !sim.halted && guard++ < 100) sim._bootStep();
    check('boot establishes a live execution context', sim.bootComplete && !sim.halted);
    return sim;
}

function checkState(card, expected, label) {
    check(label, card && card.state === expected,
        card ? `expected ${expected}, got ${card.state}: ${card.reason}` : 'missing card');
}

// ── Model states ─────────────────────────────────────────────────────────────

const cold = new ChurchSimulator();
const coldCards = cold.getLiveLumpValidations();
checkState(coldCards.namespace, 'unavailable', 'cold Namespace is explicitly unavailable');
checkState(coldCards.thread, 'unavailable', 'cold Thread is explicitly unavailable');
checkState(coldCards.abstraction, 'unavailable', 'cold Abstraction is explicitly unavailable');

// Preserve the separate, pre-existing Header V2 fallback diagnostic. This
// task adapts the explicitly admitted ascending runtime, not historical boot.
const fallback = new ChurchSimulator();
for (let i = 0; i < 3; i++) assert(fallback._bootStep());
checkState(fallback.getLiveLumpValidations().namespace, 'fault',
    'historical Header V2 fallback warning is not suppressed by ascending support');

const sim = bootSim();
let cards = sim.getLiveLumpValidations();
for (const key of ['namespace', 'thread', 'abstraction']) {
    checkState(cards[key], 'pass', `booted ${key} validates`);
    check(`${key} exposes version and integrity checks`,
        cards[key].checks.some(c => c.id === 'version' && c.pass) &&
        cards[key].checks.some(c => c.id === 'integrity' && c.pass));
}
check('Namespace uses its canonical table header check',
    cards.namespace.checks.some(c => c.id === 'header' && c.label === 'NS HEADER' && c.pass));
check('Thread follows its live boot location',
    cards.thread.entry && cards.thread.entry.location === sim.cr[12].word1 && cards.thread.state === 'pass');
check('default Thread declares storage for its fixed capability zone',
    cards.thread.header && cards.thread.header.lumpSize >= 256);

const threadLocation = cards.thread.entry.location;
const originalThreadHeader = sim.memory[threadLocation];
const threadEntryBase = sim._nsSlotBase(cards.thread.slot);
const savedThreadEntry = sim.memory.slice(threadEntryBase, threadEntryBase + 4);
const savedZeroWord = sim.memory[0];
sim.memory[threadEntryBase] = 0;
sim.memory[threadEntryBase + 2] = sim._integrity32(0, sim.memory[threadEntryBase + 1]);
sim.memory[0] = originalThreadHeader;
checkState(sim.getLiveLumpValidations().thread, 'pass', 'synthetic Thread at zero remains inspectable');
sim.memory.set(savedThreadEntry, threadEntryBase);
sim.memory[0] = savedZeroWord;
sim.memory[threadLocation] = sim.packLumpHeader(0, 32, 12, 2);
cards = sim.getLiveLumpValidations();
checkState(cards.thread, 'fault', 'undersized Thread image is a layout FAULT');
check('undersized Thread reports the declared storage shortfall',
    cards.thread.checks.some(c => c.id === 'layout' && c.pass === false &&
        c.detail.includes('Thread zones need')));
sim.memory[threadLocation] = originalThreadHeader;

const originalCR15 = { ...sim.cr[15] };
const threadSeq = sim.parseNSWord1(sim.readNSEntry(1).word1_limit).gtSeq;
sim.cr[15] = { ...sim.cr[15], word0: sim.createGT(threadSeq, 1, { R: 1 }, 1) };
check('CR15 never mistakes an aligned Thread LUMP for the Namespace table',
    sim.getLiveLumpValidations().namespace.state !== 'pass');
sim.cr[15] = originalCR15;

const undersizedNamespaceSlot = Math.max(sim.nsCount, 8);
const completeBeforeNamespaceWrite = sim.bootComplete;
sim.bootComplete = false;
sim.writeNSEntry(undersizedNamespaceSlot, sim.NS_TABLE_BASE, 255, 0, 0, 1, 0, 0, 0);
sim.bootComplete = completeBeforeNamespaceWrite;
const undersizedNamespaceSeq = sim.parseNSWord1(
    sim.readNSEntry(undersizedNamespaceSlot).word1_limit
).gtSeq;
sim.cr[15] = {
    ...sim.cr[15],
    word0: sim.createGT(undersizedNamespaceSeq, undersizedNamespaceSlot, { R: 1 }, 1),
};
checkState(sim.getLiveLumpValidations().namespace, 'fault',
    'undersized CR15 table at canonical base is a FAULT');
sim.cr[15] = originalCR15;

const abstractionSlot = cards.abstraction.slot;
const abstractionEntry = sim.readNSEntry(abstractionSlot);
const abstractionLocation = abstractionEntry.word0_location;
const originalHeader = sim.memory[abstractionLocation];
sim.memory[abstractionLocation] = 0;
checkState(sim.getLiveLumpValidations().abstraction, 'fault', 'bad executable header is a FAULT');
sim.memory[abstractionLocation] = originalHeader;

sim.memory[abstractionLocation] = sim.packLumpHeader(0, 0, 0, 0);
cards = sim.getLiveLumpValidations();
checkState(cards.abstraction, 'unavailable', 'valid lazy executable header is NOT AVAILABLE');
check('lazy executable does not report failed code layout',
    cards.abstraction.checks.some(c => c.id === 'layout' && c.pass === null));
sim.memory[abstractionLocation] = originalHeader;

const entryBase = sim._nsSlotBase(abstractionSlot);
const originalIntegrity = sim.memory[entryBase + 2];
sim.memory[entryBase + 2] = (originalIntegrity ^ 0x1) >>> 0;
cards = sim.getLiveLumpValidations();
checkState(cards.abstraction, 'fault', 'stale Namespace integrity is a FAULT');
check('stale integrity check identifies the failed relationship',
    cards.abstraction.checks.some(c => c.id === 'integrity' && c.pass === false));
sim.memory[entryBase + 2] = originalIntegrity;

const originalAuthority = sim.memory[entryBase + 1];
sim.memory[entryBase + 1] = (originalAuthority | 0x80000000) >>> 0;
sim.memory[entryBase + 2] = sim._integrity32(sim.memory[entryBase], sim.memory[entryBase + 1]);
cards = sim.getLiveLumpValidations();
checkState(cards.abstraction, 'unavailable', 'FAR executable context is NOT AVAILABLE');
check('FAR executable never inspects a stale local header', cards.abstraction.header === null);
sim.memory[entryBase + 1] = originalAuthority;
sim.memory[entryBase + 2] = originalIntegrity;

const originalCR14 = { ...sim.cr[14] };
sim.cr[14].word0 = 0;
checkState(sim.getLiveLumpValidations().abstraction, 'unavailable', 'NULL CR14 is NOT AVAILABLE');
sim.cr[14] = originalCR14;

// A valid alternate executable verifies that the card follows CR14, not the
// selected registry LUMP or the stale boot-entry slot.
const alternateSlot = Math.max(sim.nsCount, 8);
const alternateLocation = 512;
const completeBeforeWrite = sim.bootComplete;
sim.bootComplete = false;
sim.writeNSEntry(alternateSlot, alternateLocation, 63, 0, 0, 1, 0, 0, 0);
sim.bootComplete = completeBeforeWrite;
sim.nsLabels[alternateSlot] = 'Live.Switch.Target';
sim.memory[alternateLocation] = sim.packLumpHeader(0, 2, 0, 0);
const alternateSeq = sim.parseNSWord1(sim.readNSEntry(alternateSlot).word1_limit).gtSeq;
sim.cr[14] = {
    ...sim.cr[14],
    word0: sim.createGT(alternateSeq, alternateSlot, { R: 1, X: 1 }, 1),
    word1: alternateLocation + 1,
};
cards = sim.getLiveLumpValidations();
checkState(cards.abstraction, 'pass', 'program switch validates new executing Abstraction');
check('Abstraction follows live CR14 slot after program switch',
    cards.abstraction.slot === alternateSlot && cards.abstraction.name === 'Live.Switch.Target');
sim.cr[14] = originalCR14;

// ── Admitted ascending runtime diagnostics (private synthetic bytes only) ──
// Exercise the real factory and LOAD/CHANGE/CALL boot, not a mocked geometry.
function ascendingSim(base = 0, count = 256) {
    const memory = new Uint32Array(16384);
    memory[base] = ((31 << 27) | (count << 10) | (1 << 8)) >>> 0;
    memory[base + 1] = base;
    memory[base + 2] = 2;
    const machine = ChurchSimulator.fromAscendingNamespaceImage(memory,
        {word0: 0x02000001, word1: base, word2: count * 4 - 1, word3: 0, m: 1});
    const thread = base + count * 4, code = thread + 256;
    for (const [slot, location, limit] of [[1, base, count * 4 - 1], [2, thread, 255], [3, code, 63]]) {
        machine.memory.set([location, limit, machine._integrity32(location, limit), 0], base + slot * 4);
    }
    machine.memory[thread] = machine.packLumpHeader(2, 32, 12, 2);
    machine.memory[code] = machine.packLumpHeader(0, 2, 1, 0);
    const nop = ((15 << 23) | 1) >>> 0;
    machine.memory.set([nop, nop], code + 1);
    machine.memory[code + 63] = 0x4a000003;
    const layout = machine._threadLayoutAtBase(thread);
    machine.memory[thread + layout.capsStart] = 0x4a000003;
    machine._formatThreadRootSentinel(thread, layout, 0x4a000003, {image: true});
    machine.beginBoot();
    for (let i = 0; i < 3; i++) assert.equal(machine._bootStep(), true);
    assert(machine.step());
    assert(machine.step());
    assert.equal(machine.faultLog.length, 0);
    assert.equal(machine.stepCount, 2);
    return machine;
}

function readOnlyCards(machine) {
    const memory = machine.memory.slice();
    const state = JSON.stringify({cr: machine.cr, dr: machine.dr, pc: machine.pc,
        steps: machine.stepCount, halted: machine.halted, output: machine.output,
        faults: machine.faultLog, audit: machine.auditLog});
    const result = machine.getLiveLumpValidations();
    assert.deepEqual(machine.memory, memory, 'diagnostics never rewrite admitted bytes');
    assert.equal(JSON.stringify({cr: machine.cr, dr: machine.dr, pc: machine.pc,
        steps: machine.stepCount, halted: machine.halted, output: machine.output,
        faults: machine.faultLog, audit: machine.auditLog}), state,
    'diagnostics never mutate registers, execution, audit or machine faults');
    return result;
}

for (const base of [0, 8192]) {
    for (const count of [64, 256]) {
        const machine = ascendingSim(base, count);
        const live = readOnlyCards(machine);
        for (const key of ['namespace', 'thread', 'abstraction']) {
            checkState(live[key], 'pass', `ascending ${base}/${count} ${key} passes after Boot and two Code steps`);
        }
        check('ascending Namespace reports its active table, not the legacy upper RAM bound',
            live.namespace.entry.location === base &&
            live.namespace.entry.tableWords === count * 4 &&
            live.namespace.checks.some(c => c.id === 'layout' &&
                c.detail.includes(`ascending descriptors occupy ${base}..${base + count * 4 - 1}`)));
    }
}

const ascending = ascendingSim();
const ascendingGoodCards = readOnlyCards(ascending);
// Reproduce the original false warning with the legacy diagnostic geometry.
ascending._liveNamespaceTableGeometry = ChurchSimulator.prototype._liveNamespaceTableGeometry;
checkState(readOnlyCards(ascending).namespace, 'fault', 'legacy geometry reproduces the false ascending warning');
delete ascending._liveNamespaceTableGeometry;

let ascendingBadCards;
const descriptorCases = [
    ['wrong table base', m => { m.memory[4] = 1024; }, 'header', false],
    ['undersized table', m => { m.memory[5] = 255; }, 'header', false],
    ['oversized table', m => { m.memory[5] = 2047; }, 'header', false],
    ['misaligned table', m => { m.memory[5] = 1022; }, 'header', false],
    ['out-of-memory table', m => { m.memory[4] = m.memory.length; }, 'resident', false],
    ['stale sequence', m => { m.memory[5] |= 1 << 21; }, 'version', false],
    ['bad integrity', m => { m.memory[6] ^= 1; }, 'integrity', false],
    ['FAR table', m => { m.memory[5] |= 0x80000000; }, 'resident', null],
    ['Thread masquerading as Namespace', m => { m.cr[15].word0 = 0x02000002; }, 'type', false],
];
for (const [label, mutate, failedCheck, expectedPass] of descriptorCases) {
    const machine = ascendingSim();
    mutate(machine);
    // Isolate geometry/version failures from integrity failures.
    if (label !== 'bad integrity') machine.memory[6] = machine._integrity32(machine.memory[4], machine.memory[5]);
    const live = readOnlyCards(machine);
    checkState(live.namespace, expectedPass === null ? 'unavailable' : 'fault', `ascending ${label} remains visible`);
    check(`ascending ${label} identifies ${failedCheck}`,
        live.namespace.checks.some(c => c.id === failedCheck && c.pass === expectedPass));
    if (label === 'bad integrity') ascendingBadCards = live;
}
for (const [label, mutate] of [
    ['metadata header', m => { m.memory[0] = 0; }],
    ['metadata base', m => { m.memory[1] = 8192; }],
    ['metadata count', m => { m.memory[2] = 256; }],
    ['reserved metadata', m => { m.memory[3] = 1; }],
    ['active CR15 limit', m => { m.cr[15].word2 = 255; }],
    ['active CR15 FAR', m => { m.cr[15].word2 |= 0x80000000; }],
    ['allocation outside RAM', m => { m.memory[0] |= 2 << 23; }],
]) {
    const machine = ascendingSim();
    mutate(machine);
    assert.throws(() => machine.namespaceGeometry(), namespaceView.NamespaceGeometryError);
    assert.throws(() => machine.readNSEntry(1), namespaceView.NamespaceGeometryError,
        'runtime geometry enforcement remains fail-closed');
    const live = readOnlyCards(machine);
    for (const key of ['namespace', 'thread', 'abstraction']) {
        checkState(live[key], 'fault', `invalid ${label} remains visible in ${key} card`);
    }
}
ascending.namespaceGeometry = () => { throw new Error('unexpected implementation failure'); };
assert.throws(() => ascending.getLiveLumpValidations(), /unexpected implementation failure/,
    'unexpected errors are not converted into geometry diagnostics');

// ── Renderer contract ────────────────────────────────────────────────────────
// Evaluate the production renderer (rather than copying it) in a tiny DOM.
const appTools = fs.readFileSync(path.join(__dirname, 'app-tools.js'), 'utf8');
const rendererStart = appTools.indexOf('function _gateLogEscape(');
const rendererEnd = appTools.indexOf('\nfunction updateGateLog()', rendererStart);
check('Gate Log renderer is present', rendererStart >= 0 && rendererEnd > rendererStart);
if (rendererStart >= 0 && rendererEnd > rendererStart) {
    const dom = new JSDOM('<!doctype html><body><div id="gateLogContent"></div></body>');
    const context = {
        console,
        document: dom.window.document,
        openCRDetail: () => {},
    };
    vm.createContext(context);
    vm.runInContext(appTools.slice(rendererStart, rendererEnd), context, {
        filename: 'app-tools-live-lump-renderer.js',
    });
    const html = context._renderLiveLumpValidations(sim.getLiveLumpValidations());
    context.document.getElementById('gateLogContent').innerHTML = html;
    const section = context.document.querySelector('.lump-validations-section');
    check('Gate Log renders a labelled LUMP Validations section',
        !!section && section.textContent.includes('LUMP Validations'));
    check('Gate Log renders all three live context cards',
        context.document.querySelectorAll('.lump-validation-card').length === 3);
    check('valid cards render PASS instead of guessed state',
        context.document.querySelectorAll('[data-validation-state="pass"]').length === 3);
    check('renderer exposes the canonical header and integrity check labels',
        section.textContent.includes('NS HEADER') && section.textContent.includes('INTEGRITY'));
    for (const [label, live, state] of [
        ['valid ascending', ascendingGoodCards, 'pass'],
        ['invalid ascending', ascendingBadCards, 'fault'],
    ]) {
        context.document.getElementById('gateLogContent').innerHTML = context._renderLiveLumpValidations(live);
        const card = context.document.querySelector('[data-validation-kind="namespace"]');
        check(`Gate Log renders ${label} Namespace as ${state}`, card.dataset.validationState === state);
        if (state === 'fault') check('Gate Log retains the real integrity warning',
            card.textContent.includes('Namespace integrity32 does not match'));
    }
}

check('existing capability audit rendering remains after the validation section',
    appTools.includes('for (const a of log)') &&
    appTools.indexOf('html += _renderLiveLumpValidations(liveValidations);') <
        appTools.indexOf('for (const a of log)'));
check('fault and recovery rendering remains before the validation section',
    appTools.indexOf('// ── Fault banner') < appTools.indexOf('html += _renderLiveLumpValidations(liveValidations);') &&
    appTools.indexOf('// ── Fault Recovery Timeline') < appTools.indexOf('html += _renderLiveLumpValidations(liveValidations);'));

const appAbstractions = fs.readFileSync(path.join(__dirname, 'app-abstractions.js'), 'utf8');
const livePriority = appAbstractions.indexOf('if (_liveSaved) {');
check('Namespace selection replaces stale repository browsing history',
    livePriority >= 0 && !appAbstractions.includes('localStorage.getItem(\'lastSelectedLumpToken\')'));
check('live LUMP changes synchronize the repository detail identity',
    appAbstractions.includes('function _syncLumpRepositoryToLive(state)') &&
    appAbstractions.includes('_syncLumpRepositoryToLive(state);'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);