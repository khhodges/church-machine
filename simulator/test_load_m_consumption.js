'use strict';
// Exact assembled LOADs through the existing instruction executor.
const assert = require('node:assert/strict');
const Simulator = require('./simulator');
const Assembler = require('./assembler');
function fixture({source = 7, m = 1, rights = 'R', index = 1, condition = '',
    nullSource = false, nullPayload = false, stale = false} = {}) {
    const s = new Simulator();
    const gt = (slot, permissions, seq = 0) => s.createGT(seq, slot,
        Object.fromEntries([...permissions].map(p => [p, 1])), 1) >>> 0;
    const code = new Assembler().assemble(`LOAD${condition} CR1, CR${source}, #${index}`);
    assert.deepEqual(code.errors, []);
    s.withNamespaceWrite('disposable M consumption test', () => {
        s.writeNSEntry(20, 2048, 63, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(21, 4096, 63, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(22, 4352, 7, 0, 0, 1, 0, 0, 0);
    });
    s.memory[2048] = 0xF8000400;
    s.memory[2049] = code.words[0];
    s.memory[4096] = 0xF8000002;
    const payload = nullPayload ? 0 : gt(22, 'RW', stale ? 1 : 0);
    s.memory[4159] = payload;
    s.bootComplete = true;
    s.mElevation = false;
    s.petNameMemory.clear();
    s.programCapabilities = null;
    s._writeCR(14, gt(20, 'RX'), s.readNSEntry(20));
    s._writeCR(source, gt(21, rights), s.readNSEntry(21));
    if (source === 6) {
        s.cr[6].word1 = 4158;
        s.cr[6].word2 = 2 << 17;
    }
    if (nullSource) s.cr[source].word0 = 0;
    s.cr[source].m = m;
    s.cr[8].m = 1;
    s.pc = 0;
    let fault;
    const original = s.fault.bind(s);
    s.fault = (type, message, ...rest) => {
        fault = {type, message, sourceM: s.cr[source].m};
        return original(type, message, ...rest);
    };
    return {s, payload, run() {s.step(); return fault;}};
}
for (const nullPayload of [false, true]) {
    const f = fixture({nullPayload});
    assert.equal(f.run(), undefined);
    assert.equal(f.s.cr[7].m, 0);
    assert.equal(f.s.cr[1].m, 0);
    assert.equal(f.s.cr[1].word0 >>> 0, f.payload);
    assert.equal(f.s.cr[8].m, 1, 'unrelated M is untouched on success');
}
for (const [options, expected] of [
    [{nullSource: true}, 'NULL_CAP'], [{index: 2}, 'BOUNDS'], [{stale: true}, 'VERSION'],
]) {
    const f = fixture(options), fault = f.run();
    assert(fault, JSON.stringify(options));
    assert.equal(fault.type, expected);
    assert.equal(fault.sourceM, 0, 'M consumed before fault processing');
}
const reused = fixture();
assert.equal(reused.run(), undefined);
reused.s.pc = 0;
assert(reused.run(), 'a second LOAD cannot reuse consumed M with an R-only source');
const explicitL = fixture({m: 0, rights: 'L'});
assert.equal(explicitL.run(), undefined, 'ordinary L-authorized LOAD remains valid');
const directNull = fixture();
directNull.s.memory[2049] = new Assembler().assemble('LOAD CR1, NULL').words[0];
assert.equal(directNull.run(), undefined);
assert.equal(directNull.s.cr[7].m, 1, 'direct NULL discard consumes no source M');
const noM = fixture({m: 0});
assert(noM.run(), 'R alone must not grant capability LOAD');
const context = fixture({source: 6, rights: 'E'});
assert.equal(context.run(), undefined);
assert.equal(context.s.cr[6].m, 1, 'CR6 execution-context exception persists');
const skipped = fixture({condition: 'EQ'});
skipped.s.flags.Z = 0;
assert.equal(skipped.run(), undefined);
assert.equal(skipped.s.cr[7].m, 1, 'condition-skipped LOAD is not a use');
console.log('PASS native LOAD: one-use M, success/failure, NULL, stale generation, CR6 and predication');
