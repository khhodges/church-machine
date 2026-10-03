'use strict';

// A runtime-authorized, disposable context, NOT a rewrite of a saved LUMP.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
global.window = {};
const Assembler = require('./assembler');
const Simulator = require('./simulator');

const bytes = fs.readFileSync(path.join(__dirname,
    '../server/lumps/CapabilityTest.1.ff2e3f35.lump'));
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),
    'f8e564ed11de5da24c4265cfe9649ef415dbc919d84ee6bf521e9b770f39c32f',
    'diagnosis must stay bound to the exact inspected revision');
const cw = (bytes.readUInt32BE(0) >>> 10) & 0x1fff;
let cursor = (cw + 1) * 4;
const frame = bytes.readUInt32BE(cursor);
assert.equal(frame >>> 24, 0xab);
cursor += 4 + Math.ceil((frame & 0xffff) / 4) * 4;
const length = bytes.readUInt32BE(cursor);
cursor += 4;
const stored = bytes.subarray(cursor, cursor + length);
const source = ((frame >>> 16) & 4 ? zlib.inflateRawSync(stored) : stored).toString();
assert.match(source, /SAVE CR6, CR4, #4\s+LOAD CR11, CR6, #4\s+TPERM CR11, EXACT, CR4/);
// PC 0 is the method dispatch word. These are the five actual saved LOADs.
const prefix = Array.from({ length: 5 }, (_, i) => bytes.readUInt32BE((i + 2) * 4));
assert.deepEqual(prefix, [0x07030010, 0x070b0020, 0x07130030, 0x071b0040, 0x07230050]);
assert.equal(bytes.readUInt32BE(7 * 4), 0x0f320040, 'saved SAVE at PC 6');
function assemble(text) {
    const result = new Assembler().assemble(text);
    assert.deepEqual(result.errors, [], text);
    return result.words;
}
const correction = 'SAVE CR4, CR6, #12\nLOAD CR11, CR6, #12\nTPERM CR11, EXACT, CR4';

function fixture({ bind = false, save = false, tail = correction } = {}) {
    const sim = new Simulator();
    sim.bootComplete = false;
    // Test-only namespace construction: never call publication/boot-image APIs.
    for (let slot = 20; slot <= 26; slot++) {
        sim.writeNSEntry(slot, 0x200 + (slot - 20) * 0x100, 63,
            0, 0, 1, 0, slot === 20 ? 13 : 0, 0);
        sim.markLive(slot);
    }
    sim.bootComplete = true;
    sim.mElevation = false;
    sim.stepCount = 3;
    const cr = (word0, word1, word2 = 0) => ({ word0, word1, word2, word3: 0, m: 0 });
    const tokens = [
        sim.createGT(0, 21, { E: 1 }, 1),
        sim.createGT(0, 22, { R: 1, W: 1 }, 1),
        sim.createGT(0, 23, { R: 1, W: 1 }, 1),
        sim.createGT(0, 24, { R: 1 }, 1),
        sim.createGT(0, 25, { R: 1, W: 1, B: +bind }, 1),
    ].map(x => x >>> 0);
    sim.cr[6] = cr(sim.createGT(0, 20, save ? { S: 1 } : { L: 1 }, 1),
        0x200, 13 << 17);
    sim.cr[14] = cr(sim.createGT(0, 26, { R: 1, X: 1 }, 1), 0x800);
    sim.cr[12] = cr(0, 0);
    sim.memory[0x200] = sim.createGT(0, 20, { E: 1 }, 1);
    tokens.forEach((token, i) => { sim.memory[0x201 + i] = token; });
    // A distinct canary proves SAVE actually writes, rather than comparing a
    // pre-existing TIMER_DEV row with itself.
    sim.memory[0x20c] = tokens[0];
    const words = [0x00000002, ...prefix, ...assemble(tail)];
    sim.memory[0x800] = ((31 << 27) | (words.length << 10)) >>> 0;
    words.forEach((word, i) => { sim.memory[0x801 + i] = word; });
    sim.pc = 1;
    const faults = [];
    // Capture pre-recovery evidence, not the state after automatic fault reset.
    sim.fault = (type, message) => {
        faults.push({ type, message, pc: sim.pc });
        sim.halted = true;
    };
    for (let i = 0; i < 5; i++) {
        assert.ok(sim.step());
        assert.deepEqual(faults, []);
        assert.equal(sim.cr[i].word0 >>> 0, tokens[i]);
    }
    assert.equal(sim.pc, 6);
    assert.equal(sim.mElevation, false);
    return { sim, faults, tokens };
}

for (const [name, options, expected] of [
    ['retained operand order', { tail: 'SAVE CR6, CR4, #4' }, 'BIND'],
    ['operand swap alone', { tail: 'SAVE CR4, CR6, #4' }, 'BIND'],
    ['S does not grant export', { save: true }, 'BIND'],
    ['B does not grant destination S', { bind: true }, 'PERMISSION'],
]) {
    const { sim, faults } = fixture(options);
    const before = sim.memory.slice();
    const registers = JSON.stringify(sim.cr);
    assert.equal(sim.step(), null, name);
    assert.equal(faults.length, 1, name);
    assert.equal(faults[0].type, expected, name);
    assert.equal(faults[0].pc, 6, name);
    if (name === 'retained operand order') assert.match(faults[0].message, /CR6.*B=0/);
    assert.deepEqual(sim.memory, before, `${name}: no memory write`);
    assert.equal(JSON.stringify(sim.cr), registers, `${name}: no register write`);
}

const { sim, faults, tokens } = fixture({ bind: true, save: true });
const before = sim.memory.slice();
assert.ok(sim.step(), 'authorized SAVE retires');
assert.equal(sim.memory[0x20c] >>> 0, tokens[4]);
const expected = before.slice();
expected[0x20c] = tokens[4];
assert.deepEqual(sim.memory, expected, 'only the scratch row changes');
assert.ok(sim.step(), 'reload retires');
assert.equal(sim.cr[11].word0 >>> 0, tokens[4]);
assert.ok(sim.step(), 'EXACT retires');
assert.equal(sim.flags.Z, true);
assert.equal(sim.pc, 9);
assert.deepEqual(faults, []);
assert.equal(sim.mElevation, false);
assert.ok(sim.cr.every(register => register.m === 0), 'no M bypass');
assert.equal(sim.memory[0x204] >>> 0, tokens[3], 'BTN_DEV remains untouched');
assert.equal(sim.memory[0x205] >>> 0, tokens[4], 'TIMER_DEV remains untouched');

// The assembler rejects row zero, so inject its raw SAVE encoding to test the
// runtime gate as well. Even both grants must not override immutable SELF.
const selfCase = fixture({ bind: true, save: true });
selfCase.sim.memory[0x807] = 0x0f230000; // SAVE CR4, CR6, #0
const selfBefore = selfCase.sim.memory.slice();
assert.equal(selfCase.sim.step(), null);
assert.equal(selfCase.faults[0].type, 'IMMUTABLE_SELF_CAP');
assert.deepEqual(selfCase.sim.memory, selfBefore);
console.log('PASS CapabilityTest retained SAVE fault and authorized scratch round-trip');