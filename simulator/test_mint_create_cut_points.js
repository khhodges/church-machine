'use strict';
// Harness regression: an expected non-green diagnostic is not acceptance.
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const result = spawnSync(process.execPath, [`${__dirname}/mint_create_cut_points.js`],
    {encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024});
assert.equal(result.error, undefined);
assert.equal(result.status, 1, result.stderr || result.stdout);
const start = result.stdout.indexOf('{\n  "scope":');
assert(start >= 0, result.stderr || result.stdout);
const report = JSON.parse(result.stdout.slice(start));
const byId = Object.fromEntries(report.results.map(r => [r.id, r]));
assert.equal(Object.keys(byId).length, report.results.length, 'unique fixtures');
for (const id of ['A1','A2','A3','B2','C1','C2.W1','C2.W2','C3','C4','D1']) {
    assert.equal(byId[id].reached, true, id);
    assert.equal(byId[id].status, 'BLOCKED', `${id} must not claim restart acceptance`);
    assert(Object.values(byId[id].checks).every(Boolean), id);
}
for (let i = 1; i < 8; i++) {
    assert.equal(byId[`B1.${i}`].reached, true);
    assert.equal(byId[`B1.${i}`].checks.exactZeroPrefix, true);
}
for (const id of ['D2','D3']) {
    assert.equal(byId[id].reached, false);
    assert.equal(byId[id].status, 'BLOCKED');
}
for (const id of ['C2.W2.seal-only-publication','C3.seal-only-publication']) {
    assert.equal(byId[id].status, 'FAIL', 'seal alone must not prove publication');
}
for (const id of ['N2','N3.incomplete', ...['completion','NULL','permission','EXACT',
    'type-and-B','slot','sequence'].map(k => `N3.guard.${k}`)]) {
    assert.equal(byId[id].status, 'PASS', id);
}
assert.equal(byId['N1'].sequenceBound, true);
assert.equal(byId['N1'].status, 'BLOCKED');
assert.equal(byId['N3.stale-or-forged-completion'].status, 'BLOCKED');
console.log('PASS: cut-point harness faithfully reports failures and blockers, not CREATE acceptance');
