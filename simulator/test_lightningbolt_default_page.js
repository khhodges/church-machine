'use strict';

// Task #3472: the default Code/LUMP route must use the persisted Namespace
// marker, never a prepared image binding or a browser selection.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const shell = fs.readFileSync('simulator/app-shell.js', 'utf8');
function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0, `${name} exists`);
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Could not extract ${name}`);
}

const opened = [];
const plan = {
    revision: 12,
    plan: { slot: 2, seq: 9, token: '0123abcd', filename: 'CapabilityTest.1.0123abcd.lump' },
    abstractions: [{ name: 'CapabilityTest', slot: 2, seq: 9, token: '0123abcd',
        filename: 'CapabilityTest.1.0123abcd.lump', boot: true }],
};
const context = {
    window: { NamespacePlan: {
        get: () => plan,
        identityMatches: (a, b) => a.slot === b.slot && a.seq === b.seq &&
            a.token === b.token && a.filename === b.filename,
    } },
    _goToLumpByAbstractionName: name => opened.push(name),
    setTimeout: () => { throw new Error('selection should not retry when Namespace is ready'); },
};
vm.createContext(context);
vm.runInContext(extractFunction(shell, '_openLightningBoltDefaultLump'), context);
assert.equal(context._openLightningBoltDefaultLump(), true);
assert.deepEqual(opened, ['CapabilityTest']);
assert(shell.includes("if (!startView) startView = 'lumps';"),
    'a true default launch opens the LUMP Repository');
assert(!extractFunction(shell, '_openLightningBoltDefaultLump').includes('BootEntryUI'),
    'default routing does not defer to an image binding');

const runner = fs.readFileSync('simulator/app-run.js', 'utf8');
const tokenResolver = extractFunction(runner, '_configuredBootLumpToken');
const runContext = { window: context.window };
vm.createContext(runContext);
vm.runInContext(tokenResolver + '\ntoken = _configuredBootLumpToken();', runContext);
assert.equal(runContext.token, '0123abcd');
assert(!tokenResolver.includes('sim.bootEntrySlot'));
assert(!runner.includes("fetch('/api/boot-config', { cache: 'no-store' })"),
    'default Code routing does not read boot-config catalog authority');

console.log('PASS default launch and Code routing use Namespace plan');