const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {buildApiDefinition, embedSelfDefinition} = require('./lump_builder');

const methods = ['Read', 'Clear', 'Test_And_Set'].map(name => ({name, params: []}));
const caps = [{name: 'SELF', rights: ['E']}, {name: 'bit', rights: ['R', 'W']}];
const words = new Array(64).fill(0);
words[0] = ((31 << 27) | (3 << 10) | 2) >>> 0;
const api = buildApiDefinition({
    abstractionName: 'ide.Flag', language: 'javascript', methods, capabilities: caps,
}, words);
assert.equal(api.returnConvention.register, 'DR1');
for (const method of api.methods) assert.equal(method.returns.register, 'DR1');

// Verify the metadata actually embedded in candidate bytes, not just the object.
const embedded = embedSelfDefinition(words, api, '', 0);
const start = 4;
const length = embedded[start] & 65535;
const bytes = Buffer.alloc(Math.ceil(length / 4) * 4);
for (let i = 0; i < bytes.length / 4; i++) bytes.writeUInt32BE(embedded[start + 1 + i] >>> 0, i * 4);
const decoded = JSON.parse(bytes.subarray(0, length).toString('utf8'));
assert.equal(decoded.returnConvention.register, 'DR1');
assert(decoded.methods.every(m => m.returns.register === 'DR1'));

const source = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
const begin = source.indexOf('function _formatLumpApiDefinition(');
const end = source.indexOf('\nfunction ', begin + 1);
const context = {_lumpManifests: {10: {_methods: methods}}, bootEntrySlot: 10};
vm.createContext(context);
vm.runInContext(source.slice(begin, end < 0 ? undefined : end), context);
const preview = context._formatLumpApiDefinition('ide.Flag', caps);
assert.equal(preview.returnConvention.register, 'DR1');
assert(preview.methods.every(m => m.returns.register === 'DR1'));
console.log('Return metadata uses DR1 in candidate bytes and preview.');
