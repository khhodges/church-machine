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
check('Thread retains valid address zero as a real LUMP location',
    cards.thread.entry && cards.thread.entry.location === 0 && cards.thread.state === 'pass');
check('default Thread declares storage for its fixed capability zone',
    cards.thread.header && cards.thread.header.lumpSize >= 256);

const threadLocation = cards.thread.entry.location;
const originalThreadHeader = sim.memory[threadLocation];
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
}

check('existing capability audit rendering remains after the validation section',
    appTools.includes('for (const a of log)') &&
    appTools.indexOf('html += _renderLiveLumpValidations(liveValidations);') <
        appTools.indexOf('for (const a of log)'));
check('fault and recovery rendering remains before the validation section',
    appTools.indexOf('// ── Fault banner') < appTools.indexOf('html += _renderLiveLumpValidations(liveValidations);') &&
    appTools.indexOf('// ── Fault Recovery Timeline') < appTools.indexOf('html += _renderLiveLumpValidations(liveValidations);'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);