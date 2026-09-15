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

const opened = [];
const context = {
    window: {
        BootEntryUI: {
            get() {
                return {
                    status: 'prepared',
                    slot: 10,
                    binding: { targetLabel: 'CapabilityTest' },
                };
            },
        },
    },
    _goToLumpByAbstractionName(name) { opened.push(name); },
    setTimeout() { throw new Error('selection should not retry when registry is ready'); },
};
vm.createContext(context);
vm.runInContext(extractFunction(shell, '_openLightningBoltDefaultLump'), context);

assert.equal(context._openLightningBoltDefaultLump(), true);
assert.deepEqual(opened, ['CapabilityTest']);
assert(shell.includes("if (!startView) startView = 'lumps';"),
    'a true default launch opens the LUMP Repository');
assert(shell.includes("if (startView === 'lumps' && !hashParams.lump)"),
    'the startup LUMP Repository opens the live lightning-bolt binding');
assert(!shell.includes("getAbstractionByName('LightningBolt')"),
    'the default is resolved from the live boot-entry slot, not a literal name');

const abstractions = fs.readFileSync('simulator/app-abstractions.js', 'utf8');
const renderAbstractions = extractFunction(abstractions, 'renderAbstractions');
assert(abstractions.includes("bootState.binding.targetLabel"),
    'the catalog resolves the lightning-bolt abstraction from the prepared binding');
assert(abstractions.includes("abs.name === bootTargetName"),
    'the catalog does not compare a Namespace slot with an abstraction index');
assert(!renderAbstractions.includes('setBootEntrySlot('),
    'catalog rows never send abstraction indexes as Namespace slot commands');
assert(!renderAbstractions.includes('abs-next-entry-btn'),
    'inactive catalog rows do not render misleading boot-entry controls');

console.log('PASS default launch opens the live lightning-bolt LUMP');