'use strict';
const assert = require('node:assert/strict');
const {inputs, bytes} = require('./combined_inputs');
for (const sizes of [[64, 256], [256, 64]]) {
    const result = inputs(...sizes);
    assert.equal(result.reservedBytes, 1792);
    assert.equal(result.records[0].sizeWords, sizes[0]);
    assert.equal(result.records[2].sizeWords, sizes[1]);
    let end = 0;
    for (const r of result.records) {
        assert(r.baseByte >= end);
        end = r.baseByte + r.sizeWords * 4;
        assert(end <= result.staging.baseByte);
        assert.equal(r.descriptor[0] * 4, r.baseByte);
        assert.equal(bytes(r.words).length, r.sizeWords * 4);
        assert.notEqual(r.portableSha256LE, r.localizedSha256LE);
        assert.equal(r.words.at(-1), r.dependencyGT ?? r.gt);
    }
    assert.deepEqual(result, inputs(...sizes), 'inputs must be reproducible');
    assert.equal(result.imageAllowlistChanged, false);
    assert.equal(result.runtimeCallerSelectionImplemented, false);
}
console.log('Combined input provenance and disjoint geometry passed (both size orders)');
