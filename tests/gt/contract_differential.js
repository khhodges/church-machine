// Batched, side-effect-free adapter: exercise the real simulator methods without
// booting a machine or consulting saved LUMPs. Expected values come from Python's
// independent JSON-contract oracle, not another simulator helper.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Simulator = require('../../simulator/simulator.js');
const sim = Object.create(Simulator.prototype);
const vectors = JSON.parse(fs.readFileSync(0, 'utf8'));
for (const v of vectors) {
    const context = JSON.stringify(v);
    try {
        if (v.parsed) {
            assert.deepEqual(sim.parseGT(v.word), v.parsed);
            assert.equal(Simulator.isNullGT(v.word), v.parsed.type === 0);
        }
        if (v.abstractParsed) {
            assert.deepEqual(sim.parseAbstractGT(v.word), v.abstractParsed);
        }
        if (v.method) {
            if (v.error) {
                assert.throws(() => sim[v.method](...v.args), new RegExp(v.error));
            } else {
                const word = sim[v.method](...v.args);
                assert.equal(word, v.expected);
                assert(word >= 0 && word <= 0xffffffff, 'encoder must return uint32');
            }
        }
    } catch (error) {
        error.message = `${context}\n${error.message}`;
        throw error;
    }
}
console.log(JSON.stringify({checked: vectors.length}));
