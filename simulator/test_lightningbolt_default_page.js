'use strict';

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const shell = fs.readFileSync('simulator/app-shell.js', 'utf8');

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0, `${name} exists`);
    let brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Could not extract ${name}`);
}

const selected = [];
const context = {
    window: {
        BootEntryUI: {
            get() { return { status: 'prepared', slot: 7 }; },
        },
    },
    sim: { bootEntrySlot: 7 },
    abstractionRegistry: {
        getAbstraction(slot) {
            return slot === 7 ? { index: 7, name: 'CurrentBootEntry' } : null;
        },
    },
    showAbstractionDetail(index) { selected.push(index); },
    setTimeout() { throw new Error('selection should not retry when registry is ready'); },
};
vm.createContext(context);
vm.runInContext(extractFunction(shell, '_selectLightningBoltAbstraction'), context);

assert.equal(context._selectLightningBoltAbstraction(), true);
assert.deepEqual(selected, [7]);
assert(shell.includes("if (!startView) startView = 'abstractions';"),
    'a true default launch opens the Abstractions page');
assert(shell.includes("if (startView === 'abstractions' && !hashParams.abs)"),
    'the startup Abstractions page selects the live lightning-bolt entry');
assert(!shell.includes("getAbstractionByName('LightningBolt')"),
    'the default is resolved from the live boot-entry slot, not a literal name');

console.log('PASS default launch opens the live lightning-bolt abstraction');