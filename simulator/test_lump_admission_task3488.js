'use strict';
const assert = require('assert');
const admission = require('./lump_admission');

const checks = Object.fromEntries(admission.GATES.map(g => [g, true]));
let r = admission.admitUpload({bytes: [1]}, checks, {mintEgt: 0x1234});
assert.strictEqual(r.admitted, true);
assert.strictEqual(r.executable, true);
assert.strictEqual(r.egt, 0x1234);

r = admission.admitUpload({bytes: [1]}, checks);
assert.strictEqual(r.inert, true);
assert.strictEqual(r.admitted, false);

r = admission.admitUpload({bytes: [1]}, Object.assign({}, checks, {
    integrity: {ok: null, message: 'seal unavailable'}
}), {mintEgt: 1});
assert.strictEqual(r.inert, true);
assert.strictEqual(r.reports.integrity.status, 'unavailable');

const trusted = admission.trustedCompilerOutput({ok: true, words: [1]});
assert.strictEqual(trusted.authoritative, true);
assert.strictEqual(trusted.approvalRequired, false);

assert.strictEqual(admission.chooseArtifact({}, [{revision: 'r1'}]).ok, false);
const selected = admission.chooseArtifact({
    revision: 'r1', slot: 4, replace: false, resident: false, boot: false
}, [{revision: 'r1', words: [1]}]);
assert.strictEqual(selected.ok, true);
assert.strictEqual(admission.freshnessWarning('r1', 'r2').executionVeto, false);
console.log('PASS Task 3488 LUMP admission tests');