'use strict';

// Regression coverage for the two-step Save LUMP snapshot boundary.  The
// save dialog must keep the editor/compiler pair selected when it opened even
// if focus or the current registry entry changes before confirmation.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');

function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`missing ${name}`);
    let depth = 0;
    let end = -1;
    for (let i = start; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) {
            end = i + 1;
            break;
        }
    }
    if (end < 0) throw new Error(`unterminated ${name}`);
    return source.slice(start, end);
}

const context = {
    console,
    window: {
        _pendingLumpData: {
            binary: [0x1F000000, 0x12345678],
            caps: [{ name: 'New.CapTest', rights: ['E'], grants: ['E'] }],
            sourceText: 'method Main { RETURN }',
            selectedProfile: 'full',
            registeredAt: 101,
        },
        LumpRegistry: {
            getCurrent: () => 'old-token',
            resolve: () => ({
                sources: {
                    memory: {
                        words: [1, 2, 3],
                        capabilities: [{ name: 'New.CapTest', rights: ['E'], grants: ['E'] }],
                        registeredAt: 101,
                    },
                    server: { language: 'assembly' },
                },
            }),
        },
    },
    document: {
        getElementById: () => ({ value: 'stale live editor text' }),
    },
};

vm.createContext(context);
vm.runInContext(
    extractFunction('_cloneLumpSaveCapabilities') + '\n' +
    extractFunction('_captureLumpSaveSnapshot') +
    '\nthis.capture = _captureLumpSaveSnapshot;',
    context
);

const snapshot = context.capture();

if (snapshot.token !== 'old-token') throw new Error('snapshot lost current token');
if (snapshot.sourceText !== 'method Main { RETURN }') {
    throw new Error('pending source was replaced by the live editor buffer');
}
if (snapshot.words.join(',') !== '1,2,3') throw new Error('compiled words were not captured');
if (snapshot.registeredAt !== 101) throw new Error('registeredAt was not captured');
if (!snapshot.pending || snapshot.pending.binary[1] !== 0x12345678) {
    throw new Error('pending binary was not retained');
}

// Simulate focus/navigation after the dialog opened. The retained object must
// remain independent from registry and editor changes.
context.window.LumpRegistry.getCurrent = () => 'new-token';
context.window.LumpRegistry.resolve = () => ({
    sources: { memory: { words: [9], capabilities: [], registeredAt: 202 } },
});
context.window._pendingLumpData.sourceText = 'mutated later';
if (snapshot.token !== 'old-token' ||
    snapshot.sourceText !== 'method Main { RETURN }' ||
    snapshot.words.join(',') !== '1,2,3') {
    throw new Error('save snapshot changed after focus/navigation state changed');
}

console.log('LUMP save snapshot regression: PASS');