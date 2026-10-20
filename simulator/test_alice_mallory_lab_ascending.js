'use strict';
// Lab dispatch for the isolated ascending-layout fixture (no auto run).
const assert = require('node:assert/strict');
const fs = require('fs');
const lab = require('./alice_mallory_lab');
const fixture = require('./test_alice_mallory_thread_setup');
assert.equal(lab.scenarios['ascending-actors'].label, 'Ascending layout: Alice / Mallory in separate Threads');
const html = fs.readFileSync(__dirname + '/alice-mallory-lab.html', 'utf8');
assert(html.includes('value="ascending-actors"'));
assert(html.indexOf('alice_mallory_ascending_lab.js') < html.indexOf('alice_mallory_lab.js'));
const binaries = require('./compile_actor_programs').compileActorPrograms();
const s = lab.createScenario('ascending-actors', binaries);
assert.equal(s.scenario, 'ascending-actors');
assert.deepEqual(s.threadSlots, [2, 11, 12]);
assert.equal(s.attempts, 0, 'no auto run on load');
assert.equal(s.sim._currentThreadSlot, 2);
let out = lab.outcome(s);
while (!s.passed && s.attempts < s.limit) out = lab.step(s);
assert(s.passed, out);
assert.match(out, /^PASS/);
assert.equal(lab.step(s), out, 'stopped scenario does not execute further');
console.log('ascending lab dispatch: ok');

// Execute the actual page's script order without Node's require fallback.
// A page-load screenshot alone cannot detect dependencies needed only on Load.
const vm = require('node:vm');
const context = vm.createContext({console, URLSearchParams, TextEncoder, TextDecoder});
vm.runInContext('window = globalThis; bootConfig={step1:{totalNamespaceWords:16384,namespaceLumpWords:64,threadLumpWords:512,threadCount:3}};', context);
for (const match of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    if (match[1] === 'alice_mallory_lab_ui.js') continue;
    vm.runInContext(fs.readFileSync(__dirname + '/' + match[1], 'utf8'), context,
        {filename:match[1]});
    if (match[1] === 'simulator.js') vm.runInContext('window.ChurchSimulator=ChurchSimulator;', context);
}
context.binaryInput = binaries;
vm.runInContext(`
    const state = AliceMalloryLab.createScenario('ascending-actors', binaryInput);
    while (!state.passed) AliceMalloryLab.step(state);
    if (!state.passed) throw Error('Browser script graph failed');
`, context);
console.log('ascending browser script graph: ok');
