'use strict';

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
const dom = new JSDOM('<!doctype html><body><div id="zone-data-popup"></div></body>');
const sandbox = {
    console,
    document: dom.window.document,
    window: dom.window,
    sim,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: callback => callback(),
    fetch: () => Promise.reject(new Error('not used in this test')),
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    abstractionRegistry: { abstractions: [] },
    currentView: 'namespace',
    correctCRDetailTab: tab => tab,
    formatThreadDisplayName: name => name,
    switchDashTab: () => {},
    _lumpManifests: {},
    _petNameDRMap: {},
    _petNameCRMap: {},
};
sandbox.window.sim = sim;
sandbox.window.bootConfig = global.window.bootConfig;
sandbox.window.addEventListener = () => {};
vm.createContext(sandbox);

const servedScripts = [...fs.readFileSync(__dirname + '/index.html', 'utf8')
    .matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)]
    .map(match => match[1].split('?')[0])
    .filter(src => [
        'thread-frame-decoder.js',
        'app-cr-display.js',
        'app-memory.js',
    ].includes(src));
assert.deepStrictEqual(servedScripts, [
    'thread-frame-decoder.js',
    'app-cr-display.js',
    'app-memory.js',
], 'served IDE loads the shared decoder before both Thread stack surfaces');
for (const src of servedScripts) {
    vm.runInContext(fs.readFileSync(__dirname + '/' + src, 'utf8'), sandbox, {
        filename: src,
    });
}

const layout = sim.getThreadInstanceLayout(12);
assert(layout.valid, 'fixture Thread has a valid resident layout');
const base = layout.base;
const rootOffset = layout.stackEnd;
const rootCursor = rootOffset - 2;
const ordinaryOffset = rootOffset - 2;
const ordinaryCursor = ordinaryOffset - 2;
const validEGT = sim.memory[base + layout.capsStart] >>> 0;
const parsedValidEGT = sim.parseGT(validEGT);
const originalStack = sim.memory.slice(
    base + layout.stackStart,
    base + layout.stackEnd + 1
);
const frameWord = (nia, sz, prevSTO) =>
    (((nia & 0x7FFF) << 13) | ((sz & 1) << 12) | (prevSTO & 0xFFF)) >>> 0;

function setStack(words, protectedCursor) {
    for (let offset = layout.stackStart; offset <= layout.stackEnd; offset++) {
        sim.memory[base + offset] = 0;
    }
    for (const [offset, word] of words) sim.memory[base + offset] = word >>> 0;
    sim.memory[base + layout.protectedStoOffset] =
        ((1 << 12) | protectedCursor) >>> 0;
}

function renderBoth() {
    const memoryHtml = sandbox.renderThreadMemoryLayout(12, true);
    sandbox.showZonePopup({
        currentTarget: {
            getBoundingClientRect: () => ({ left: 20, right: 40, top: 20, bottom: 40 }),
        },
    }, 2, 12);
    return {
        memoryHtml,
        crHtml: dom.window.document.getElementById('zone-data-popup').innerHTML,
    };
}

function assertBothContain(surfaces, text, message) {
    assert(surfaces.memoryHtml.includes(text), `Thread memory ${message}`);
    assert(surfaces.crHtml.includes(text), `CR stack ${message}`);
}

setStack([
    [rootOffset - 1, validEGT],
    [rootOffset, frameWord(0x7FFF, 1, rootOffset)],
], rootCursor);
let surfaces = renderBoth();
assertBothContain(surfaces, 'root', 'classifies a valid root frame');
assertBothContain(surfaces, '[root]', 'labels the root frame');

setStack([
    [ordinaryOffset - 1, validEGT],
    [ordinaryOffset, frameWord(0x42, 1, rootCursor)],
    [rootOffset - 1, validEGT],
    [rootOffset, frameWord(0x7FFF, 1, rootOffset)],
], ordinaryCursor);
surfaces = renderBoth();
assertBothContain(surfaces, 'ordinary', 'classifies a valid ordinary-to-root chain');
assertBothContain(surfaces, '[root]', 'retains the terminal root classification');

const cases = [
    {
        label: 'missing E-GT',
        code: 'MISSING_EGT',
        words: [
            [rootOffset - 1, sim.createGT(1, sim.MAX_NS_ENTRIES - 1, { E: 1 }, 1)],
            [rootOffset, frameWord(0x7FFF, 1, rootOffset)],
        ],
        cursor: rootCursor,
    },
    {
        label: 'stale E-GT',
        code: 'STALE_EGT',
        words: [
            [rootOffset - 1, sim.createGT(
                (parsedValidEGT.gt_seq + 1) & 0x1FF,
                parsedValidEGT.index,
                { E: 1 },
                1
            )],
            [rootOffset, frameWord(0x7FFF, 1, rootOffset)],
        ],
        cursor: rootCursor,
    },
    {
        label: 'malformed frame',
        code: 'ZERO_COMPANION',
        words: [[rootOffset, frameWord(0x7FFF, 1, rootOffset)]],
        cursor: rootCursor,
    },
    {
        label: 'duplicate root',
        code: 'DUPLICATE_ROOT',
        words: [
            [ordinaryOffset, frameWord(0x7FFF, 1, ordinaryOffset)],
            [rootOffset - 1, validEGT],
            [rootOffset, frameWord(0x7FFF, 1, rootOffset)],
        ],
        cursor: rootCursor,
    },
    {
        label: 'looping frame',
        code: 'LOOP',
        words: [
            [ordinaryOffset - 1, validEGT],
            [ordinaryOffset, frameWord(0x42, 1, ordinaryCursor)],
        ],
        cursor: ordinaryCursor,
    },
    {
        label: 'out-of-range protected STO',
        code: 'OOB',
        words: [
            [rootOffset - 1, validEGT],
            [rootOffset, frameWord(0x7FFF, 1, rootOffset)],
        ],
        cursor: layout.stackEnd,
    },
];

for (const testCase of cases) {
    setStack(testCase.words, testCase.cursor);
    surfaces = renderBoth();
    assertBothContain(surfaces, testCase.code,
        `shows an actionable ${testCase.label} error`);
    for (const [, word] of testCase.words) {
        if (!word) continue;
        const rawHex = '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0');
        assertBothContain(surfaces, rawHex,
            `keeps raw ${rawHex} visible for ${testCase.label}`);
    }
}

sim.memory.set(originalStack, base + layout.stackStart);
console.log('Thread served stack integration tests passed');