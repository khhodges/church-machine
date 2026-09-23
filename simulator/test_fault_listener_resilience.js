'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./app-shell.js'), 'utf8');
const start = source.indexOf("    sim.on('fault', (f) => {");
const end = source.indexOf("    sim.on('halt',", start);
assert.ok(start >= 0 && end > start);
for (const failing of ['appendOutput', 'faultAlertOn', '_saveFaultLog', 'none', 'modal-once']) {
    let listener, modalCalls = 0;
    const timers = [];
    const context = {
        sim: {on: (_name, callback) => { listener = callback; }},
        console: {error() {}},
        _lastFault: null,
        setTimeout: callback => timers.push(callback),
        showFaultModal() {
            modalCalls++;
            if (failing === 'modal-once' && modalCalls === 1) throw new Error('renderer unavailable');
        },
    };
    for (const name of ['appendOutput', 'faultAlertOn', '_saveFaultLog'])
        context[name] = () => { if (name === failing) throw new Error(`${name} unavailable`); };
    vm.runInNewContext(source.slice(start, end), context);
    const fault = {type: 'STACK_CORRUPT', message: 'synthetic RETURN failure'};
    listener(fault);
    timers.forEach(callback => callback());
    assert.equal(context._lastFault, fault);
    assert.equal(modalCalls, failing === 'modal-once' ? 2 : 1, failing);
}
console.log('PASS fault popup survives notification/storage failure and renderer retry');