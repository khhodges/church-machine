// Isolated, nonpublishing recovery checks. No execution or installation.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p));
const schema = JSON.parse(read('simulator/cloomc/Ethernet.json'));
const source = read(schema.source_file).toString();
const saved = read(schema.recovered_from);
assert.equal(crypto.createHash('sha256').update(saved).digest('hex'), schema.recovered_binary_sha256);
assert.deepEqual(schema.methods.map(m => [m.name, m.index]),
    [['Send', 0], ['Receive', 1], ['Connect', 2], ['Status', 3]]);
// Exact big-endian saved instruction bodies (not the obsolete source's claims).
assert.deepEqual(Array.from({length: 13}, (_, i) => saved.readUInt32BE(4 + i * 4)),
    [0x073b0000, 0x8f138002, 0x1f000000, 0x073b0000, 0x870b8003,
        0x1f000000, 0x073b0000, 0x8f0b8004, 0x8f138005, 0x1f000000,
        0x073b0000, 0x870b8001, 0x1f000000]);
assert.equal(saved.readUInt32BE(saved.length - 4), 0x07800400);
global.ChurchAssembler = require('./assembler.js');
global.METHOD_REGISTER_CONVENTIONS = {};
global.BOOT_UPLOADS = [];
const Compiler = require('./cloomc_compiler.js');
const result = new Compiler().compile(source, []);
assert.deepEqual(result.errors, []);
assert.deepEqual(result.methods.map(m => m.name), schema.methods.map(m => m.name));
assert.equal(result.capabilities[0].compiler_owned_self, true);
assert.equal(result.capabilities[1].name, 'EthernetDevice');
assert.deepEqual(result.capabilities[1].rights, ['R', 'W']);
for (const i of [0, 1, 3]) assert.equal(result.methods[i].code[0] & 0x7fff, 1);
assert.equal(result.methods[2].code.length, 2);
assert(!/^\s*(?:DREAD|IADD|ISUB)\s+DR0\b/m.test(source));
assert.equal(schema.capabilities[1].gt, null);
global.window = {bootConfig: {step1: {
    totalNamespaceWords: 16384, namespaceLumpWords: 64, threadLumpWords: 512,
}}};
const Simulator = require('./simulator.js');
const sim = new Simulator();
const image = read('server/lumps/boot-image.bin');
assert(sim.loadBootImage(image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength)));
const logical = JSON.parse(read('server/lumps/ns-state.json')).abstractions;
assert(!logical.some(r => /ethernetdevice|eth_dev/i.test(r.name)));
// Inventory every raw device entry, not just the logical sidecar.
const devices = [];
for (let i = 0; i < 4096; i++) {
    const ns = sim.readNSEntry(i);
    if (ns && ns.word0_location >= 0x40000000) devices.push([i, ns.word0_location]);
}
assert.deepEqual(devices, [[2, 0x40000014], [3, 0x40000000],
    [4, 0x40000028], [5, 0x4000002c], [13, 0xffffff1c]]);
const eth = sim.readNSEntry(9);
assert.deepEqual([eth.word0_location, eth.word1_limit, eth.word2_seals, eth.word3_cache_token],
    [0x550, 0x3f, 0xdea8f6ef, 0]);
assert.equal(sim.parseGT(0x07800400).permissions.R, 0);
assert.equal(sim.parseGT(0x07800400).permissions.W, 0);
const shell = read('simulator/app-shell.js').toString();
const context = {};
vm.createContext(context);
vm.runInContext(shell.slice(shell.indexOf('function _newAbstractionProforma('),
    shell.indexOf('\nfunction _setBootPathIdentityDiagnostic(')), context);
assert(source.startsWith(context._newAbstractionProforma('Ethernet').split('\n')[0]));
const loader = shell.slice(shell.indexOf('function openSourceFile('),
    shell.indexOf('// ── Save Source File'));
assert(loader.indexOf('confirmSourceReplacement') < loader.indexOf('ed.value = code'));
assert(loader.includes('writeGuard.accepts()'));
assert(loader.includes('saveActiveUserTab()'));
assert(loader.includes('saveEditorState()'));
console.log('Ethernet draft: four-method recovery, compiler, SELF/RW ABI, raw Namespace unbound proof and guarded opening passed');