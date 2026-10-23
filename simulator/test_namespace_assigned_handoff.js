'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(__dirname + '/namespace-design-v1.js', 'utf8');
const start = code.indexOf('    function assigned(slot)');
const end = code.indexOf('\n    function ', start + 1);
const body = code.slice(start, end);
for (const inspected of [true, false]) {
    let present = inspected;
    const calls = [];
    const promise = Promise.resolve('exact assigned artifact');
    const scope = {
        document: {getElementById(id) {
            assert.equal(id, 'namespaceDesignDialog');
            return present ? {remove() {present = false; calls.push('close');}} : null;
        }},
        source(slot, explicit) {
            assert.equal(present, false, 'inspection must not cover consent/editor');
            assert.equal(slot, 6);
            assert.equal(explicit, true);
            calls.push('open');
            return promise;
        }
    };
    vm.createContext(scope);
    vm.runInContext(body, scope);
    assert.equal(scope.assigned(6), promise);
    assert.deepEqual(calls, inspected ? ['close', 'open'] : ['open']);
}
console.log('PASS assigned-LUMP handoff closes inspection before editor/consent and preserves navigation result');
