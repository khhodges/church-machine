'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ChurchSimulator = require('./simulator');
const source = fs.readFileSync(__dirname + '/app-memory.js', 'utf8');
const helper = source.slice(source.indexOf('function _cr14CodeContextHeading('),
    source.indexOf('function updateCRDetail()'));
const context = {window:{NamespaceProfileNames:require('./namespace-profile-names')}};
vm.runInNewContext(helper, context);
const machine = new ChurchSimulator();
const base = 512;
machine.memory.fill(0, base, base + 256);
// Exercise the real binary method-name decoder, not a stub returning "Run".
const api = Buffer.from(JSON.stringify({name:'CapabilityTest',
    methods:[{name:'Run',index:0},{name:'Other',index:1}]}));
machine.memory[base] = ((31 << 27) | (2 << 23) | (5 << 10)) >>> 0;
machine.memory[base+1] = 3;
machine.memory[base+2] = 5;
machine.memory[base+6] = (0xab030000 | api.length) >>> 0;
for(let i=0;i<api.length;i++)
    machine.memory[base+7+(i>>2)] |= api[i] << (24-8*(i%4));
machine.readNSEntry = slot => slot===10 ? {word0_location:base} : null;
machine.nsLabels = {10:'WrongEditorAbstraction',12:'WrongThread',1:'WrongNamespace'};
machine.simulationConfiguration = {designProfile:'ascending',preparedRows:[
    {slot:10,seq:0,location:base,name:'CapabilityTest'},
    {slot:12,seq:0,location:1024,name:'Thread.3'},
    {slot:1,seq:0,location:0,name:'Boot.NS'},
]};
machine.cr[14] = {word0:0x0a00000a,word1:base};
machine.cr[12] = {word0:0x0200000c,word1:1024};
machine.cr[15] = {word0:0x02000001,word1:0};
machine.pc=2;
assert.strictEqual(context._cr14CodeContextHeading(machine),
    'Code: Run · Abstraction: CapabilityTest · Thread: T.3 · Namespace: New layout — ascending table / four-word header (Boot.NS)');
machine.pc=4;
assert.match(context._cr14CodeContextHeading(machine), /^Code: Other/);
machine.cr[12].word0=0;
assert.match(context._cr14CodeContextHeading(machine), /Thread: unavailable/);
machine.cr[14].word1=999;
assert.match(context._cr14CodeContextHeading(machine), /^Code: unavailable · Abstraction: unnamed/);
machine.cr[14].word1=base;
machine.cr[14].word0=0x0a01000a;
assert.match(context._cr14CodeContextHeading(machine), /Abstraction: unnamed/);
machine.simulationConfiguration.preparedRows=[];
assert.doesNotMatch(context._cr14CodeContextHeading(machine), /WrongEditor|WrongThread|WrongNamespace|NewLayout/);
assert.match(source, /activeLabelEl\.textContent = _headingText/);
assert.match(source, /_escapeCRDisplayName\(_cr14CodeContextHeading\(sim\)\)/);
console.log('CR14 heading: real embedded methods, frozen names, changed PC, missing/null/stale bindings passed');
