'use strict';

// Isolated synthetic annotation tests: no user program, image, or workload.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const detail = fs.readFileSync(path.join(__dirname, 'app-cr-detail.js'), 'utf8');
const lumps = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
const run = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const sim = { dr: Array(16).fill(0), cr: [], memory: new Uint32Array(64), ledBits: 0 };
const ctx = vm.createContext({
    sim, _lumpManifests: {}, _petNameDRMap: {}, _resolveClistPetName: () => null,
    _regName: () => null,
});
vm.runInContext(detail.slice(detail.indexOf('function _decompileWord('),
    detail.indexOf('function _escDecomp(')) +
    detail.slice(detail.indexOf('function _escDecomp('),
        detail.indexOf('\n}', detail.indexOf('function _escDecomp(')) + 2) +
    detail.slice(detail.indexOf('function _crTag('), detail.indexOf('/**', detail.indexOf('function _crTag('))),
    ctx);
const word = (op, dst, src, imm, cond = 14) =>
    (((op << 27) | (cond << 23) | (dst << 19) | (src << 15) | imm) >>> 0);
const describe = (w, pets = {}) => ctx._decompileWord(w, 20, 0, 0, pets, null).desc
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Replaying a listing after ISUB/IADD/DWRITE/SWITCH must never reinterpret
// historical operands using the current state (or a hardware snapshot).
const sequence = [
    word(22, 1, 1, 0x4000 | 4096),
    word(21, 1, 1, 0x4000 | 4096),
    word(17, 1, 2, 0x4000),
    word(5, 1, 2, 0),
];
const initial = sequence.map(describe);
sim.dr[1] = 4096;
sim.dr[2] = 8192;
sim.ledBits = 1;
assert.deepStrictEqual(sequence.map(describe), initial);
assert(initial[1].includes('DR1 + #4096'));
assert(!initial.join(' ').includes('8192'));
assert(!initial.join(' ').includes('=4096'));
assert(!initial.join(' ').includes('LED'));

for (const w of [
    word(21, 2, 2, 3), word(22, 0, 0, 0x7FFF), // DR0 and unsigned 14-bit immediate
    word(18, 3, 2, (31 << 5) | 1), word(19, 3, 2, 0),
    word(20, 1, 2, 0), word(24, 3, 2, 31), word(25, 3, 2, 32 | 31),
    word(16, 1, 2, 0x20 | 3), word(23, 0, 0, 0x7FFF),
    word(2, 3, 0, 0), word(3, 0, 0, 0),
    word(21, 1, 1, 0x4001, 0), // conditional: no claim that it ran
]) {
    assert.strictEqual(describe(w), describe(w));
}
assert(describe(word(22, 0, 0, 0x7FFF)).includes('#16383'));
assert(describe(word(23, 0, 0, 0x7FFF)).includes('-1'));
assert(describe(word(16, 1, 2, 0x20 | 3)).includes('2 + DR3'));
assert(describe(word(19, 3, 2, 0)).includes('faults if executed'));
assert(describe(word(25, 3, 2, 32 | 31)).includes('arithmetic'));
assert(describe(word(21, 1, 1, 0x4001, 0)).includes('[if equal to zero]'));
assert(!detail.slice(detail.indexOf('function _decompileWord('), detail.indexOf('function _fmtVal(')).includes('sim.dr'));

// Evaluate the exact LUMP listing's local comment function without a browser.
const autoStart = lumps.indexOf('    const _autoComment = ');
const autoEnd = lumps.indexOf('    // ── Method docstring renderer', autoStart);
assert(autoStart !== -1 && autoEnd > autoStart);
const listing = vm.createContext({cc: 3, clistSlotName: {1: 'Known'}, crAlias: {}});
vm.runInContext(lumps.slice(autoStart, autoEnd).replace('const _autoComment = ', 'globalThis._autoComment = '), listing);
const comment = w => listing._autoComment(w, (w >>> 27) & 31,
    (w >>> 19) & 15, (w >>> 15) & 15, w & 0x7FFF, (w >>> 23) & 15, {});
assert(comment(word(1, 1, 2, 3)).includes('store CR1'));
assert(comment(word(16, 1, 2, 0x4001)).includes('+1]'));
assert(comment(word(17, 1, 2, 0x20 | 3)).includes('2 + DR3'));
assert(comment(word(8, 1, 6, (2 << 5) | 1)).includes('method #1'));
assert(comment(word(2, 1, 6, (2 << 5) | 1)).includes('method #1'));
assert(comment(word(21, 1, 1, 0x4000 | 4096)).includes('DR1 + #4096'));
assert(!comment(word(5, 1, 2, 1)).includes('reload)'));
assert(!run.slice(run.indexOf('function showFaultModal('),
    run.indexOf('function showFaultModal(') + 36000).includes('sim.cr[6].word1'));
console.log('PASS symbolic instruction comments are independent of live state and decode indexed operands');