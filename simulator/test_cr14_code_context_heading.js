'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(__dirname + '/app-memory.js', 'utf8');
const helper = source.slice(source.indexOf('function _cr14CodeContextHeading('),
    source.indexOf('function updateCRDetail()'));
const context = {};
vm.runInNewContext(helper, context);
const machine = {
    cr: Array.from({length: 16}, () => ({word0: 0})),
    nsLabels: {7: 'WukongCallHome', 11: 'Thread.2', 0: 'Boot.NS'},
    parseGT: word => ({type: word ? 2 : 0, index: word & 65535}),
};
machine.cr[14].word0 = 0x4a000007;
machine.cr[12].word0 = 0x4000000b;
machine.cr[15].word0 = 0x40000000;
assert.strictEqual(context._cr14CodeContextHeading(machine),
    'Code — Pet name / Abstraction: WukongCallHome · Thread: Thread.2 · Namespace: Boot.NS');
machine.nsLabels[6] = 'SelfTest';
machine.cr[14].word0 = 0x4a000006;
assert.match(context._cr14CodeContextHeading(machine), /Abstraction: SelfTest/);
delete machine.nsLabels[6];
assert.match(context._cr14CodeContextHeading(machine), /unnamed \(slot 6\)/);
machine.cr[12].word0 = 0;
assert.match(context._cr14CodeContextHeading(machine), /Thread: unavailable/);
assert.match(source, /activeLabelEl\.textContent = _headingText/);
assert.match(source, /_escapeCRDisplayName\(_cr14CodeContextHeading\(sim\)\)/);
console.log('CR14 code context heading tests passed');
