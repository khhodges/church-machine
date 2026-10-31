'use strict';
const assert = require('node:assert/strict');
const {build} = require('../scripts/build_mint_stub_lump');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');
const Compiler = require('./cloomc_compiler');
const {buildLump} = require('./lump_builder');
const image = build();
const frame = 1 + image.cw;
assert.equal(image.words[frame] >>> 16, 0xAB03);
const apiLength = image.words[frame] & 65535;
const rawApi = image.bytes.subarray((frame + 1) * 4, (frame + 1) * 4 + apiLength).toString('utf8');
assert.equal(rawApi, JSON.stringify(image.abi));
const sourceLengthWord = frame + 1 + Math.ceil(apiLength / 4);
const sourceLength = image.words[sourceLengthWord];
assert.equal(image.bytes.subarray((sourceLengthWord + 1) * 4,
    (sourceLengthWord + 1) * 4 + sourceLength).toString('utf8'), image.source);
assert.equal(image.words[0] & 255, 1, 'SELF only; no protected imports');
for (let selector = 0; selector < 4; selector++) {
    // Real CALL/RETURN on the exact compiled code words. Fixture installation
    // localizes SELF in disposable simulator RAM; it is not live admission.
    const f = fixture();
    const target = f.install(30, image.words.slice(1, 1 + image.cw));
    const callerResult = new Compiler().compile(`abstraction test.StubCaller {
capabilities { SELF E, ide.Mint E }
method Run {
CALL CR6[ide.Mint], #${selector}
HALT
}
}`, []);
    assert.deepEqual(callerResult.errors, []);
    const callerImage = buildLump(callerResult);
    const caller = f.install(31, callerImage.words.slice(1, 1 + callerImage.cw), [target.gt]);
    f.activate(caller);
    f.sim.cr[1] = {...f.sim.cr[6]};
    f.sim.dr[1] = 99;
    for (let i = 0; i < 40 && !f.sim.halted; i++) f.sim.step();
    assert.equal(f.sim.halted, true, 'returns to caller HALT');
    assert.equal(f.sim.dr[1], 5, 'UNSUPPORTED, never success');
    assert.equal(f.sim.cr[1].word0, 0, 'no returned PassKey or capability');
    const code = image.compiled.methods[selector].code;
    assert.deepEqual(code.map(w => w >>> 27), [0,21,3], 'clear, status, return only');
}
assert.deepEqual(build().bytes, image.bytes, 'deterministic build');
const {buildApiDefinition} = require('./lump_builder');
assert.throws(() => buildApiDefinition(image.compiled, image.words), /ordinary save\/admission/);
for (const [label, source] of [
    ['missing PassKey declaration', image.source.replace('passkey required;', '')],
    ['duplicate declaration', image.source.replace('passkey required;', 'passkey required;\npasskey required;')],
    ['invalid type', image.source.replace('permissions: U32', 'permissions: Unknown')],
    ['duplicate parameter', image.source.replace('permissions: U32', 'allocation: U32')],
    ['extra capability', image.source.replace('permissions: U32', 'permissions: Inform[R]').replace('allocation: U32', 'allocation: Inform[R]')],
    ['invalid rights', image.source.replaceAll('Inform[RW]', 'Inform[EL]')],
    ['missing result type', image.source.replace(' -> Void', '')],
    ['legacy expression body', image.source.replace('RETURNAL #0', 'return 5')],
    ['unsupported imports', image.source.replace('SELF E', 'SELF E, ide.Other E')],
]) {
    const rejected = new Compiler().compile(source, []);
    assert.ok(rejected.errors.length > 0, label);
    assert.equal(rejected.methods.length, 0, label);
    assert.equal(rejected.compactAbi, undefined, label);
}
const ls = new Compiler().compile(image.source.replaceAll('Inform[RW]', 'Inform[LS]'), []);
assert.deepEqual(ls.errors, []);
assert.deepEqual(ls.compactAbi.methods.CREATE[2], [2,'LS']);
assert.deepEqual(image.abi, require('./mint/mint-stub.abi.json'), 'independent ABI golden fixture');
console.log('PASS Mint stub: embedded ABI/source, four dispatches, real CALL/RETURN, status=5, NULL CR1');
