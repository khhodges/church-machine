'use strict';
const assert = require('node:assert/strict');
const {build} = require('../scripts/build_mint_stub_lump');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');
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
    const caller = f.compile(31, `CALL CR6[1], #${selector}\nHALT`, [target.gt]);
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
console.log('PASS Mint stub: embedded ABI/source, four dispatches, real CALL/RETURN, status=5, NULL CR1');
