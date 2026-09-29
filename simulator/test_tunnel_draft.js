// Read-only first-pass recovery regression: never publishes or installs a LUMP.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file));
const text = file => read(file).toString('utf8');
const schema = JSON.parse(text('simulator/cloomc/Tunnel.json'));
const source = text(schema.source_file);
global.ChurchAssembler = require('./assembler.js');
global.METHOD_REGISTER_CONVENTIONS = {};
global.BOOT_UPLOADS = [];
const Compiler = require('./cloomc_compiler.js');
const compiled = new Compiler().compile(source, []);
assert.deepEqual(compiled.errors, []);
assert.deepEqual(compiled.methods.map(m => m.name),
    ['Register', 'Send', 'Receive', 'Fault', 'Fetch', 'Call']);
assert.deepEqual(compiled.methods.map(m => m.name), schema.methods.map(m => m.name));
assert.equal(compiled.capabilities[0].compiler_owned_self, true);
assert.equal(compiled.capabilities[1].name, 'UART_DEV');
assert.deepEqual(compiled.capabilities[1].rights, ['R', 'W']);
assert(!/^\s*(?:DREAD|IADD|ISUB)\s+DR0\b/m.test(source));
for (const method of compiled.methods.slice(0, 5)) {
    const load = method.code.find(word => ((word >>> 27) & 31) === 0);
    assert.equal(load & 0x7fff, 1, `${method.name}: UART is c-list row 1`);
}
assert.equal(compiled.methods[5].code.length, 2, 'Call is only -1 and RETURN');
assert.equal(crypto.createHash('sha256').update(read(schema.recovered_from)).digest('hex'),
    schema.recovered_binary_sha256);
assert.equal(crypto.createHash('sha256')
    .update(read('server/lumps/Tunnel.1.8770bf03.json')).digest('hex'),
    '650fd0c2de5f9c96eb0dca88c8e8535e4a506532b5d942d1a848898c7babaf10');

// Only deserialize the committed image into an isolated simulator. No boot
// steps, execution, Namespace writes to disk, or binary installation.
global.window = { bootConfig: { step1: {
    totalNamespaceWords: 16384, namespaceLumpWords: 64, threadLumpWords: 512,
} } };
const Simulator = require('./simulator.js');
const sim = new Simulator();
const image = read('server/lumps/boot-image.bin');
assert.equal(sim.loadBootImage(image.buffer.slice(
    image.byteOffset, image.byteOffset + image.byteLength)), true);
const cap = schema.capabilities[1];
const ns = sim.readNSEntry(cap.target);
assert.deepEqual([ns.word0_location, ns.word1_limit, ns.word2_seals,
    ns.word3_cache_token], cap.raw_ns_words.map(Number));
const logical = JSON.parse(text('server/lumps/ns-state.json')).abstractions
    .find(row => row.name === cap.name);
assert.equal(logical.slot, cap.target);
assert.equal(Number(logical.location), ns.word0_location);
assert.equal(logical.seq, cap.sequence);
assert.equal(logical.type, cap.type);
const gt = Number(cap.gt);
assert.equal(sim.createGT(cap.sequence, cap.target, { R: 1, W: 1 }, cap.gt_type), gt);
assert.equal(sim.mLoad(gt, 'R', 0).ok, true);
assert.equal(sim.mLoad(gt, 'W', 0).ok, true);
assert.equal(sim.parseGT(gt).permissions.E, 0);
assert.equal(ns.word1_limit & 0xfffff, schema.uart_registers.RX);

// The recovered source uses the same abstraction proforma as File > New.
const shell = text('simulator/app-shell.js');
const start = shell.indexOf('function _newAbstractionProforma(');
const end = shell.indexOf('\nfunction _setBootPathIdentityDiagnostic(', start);
const context = {};
vm.createContext(context);
vm.runInContext(shell.slice(start, end), context);
const template = context._newAbstractionProforma('Tunnel');
assert(template.includes('Source for Tunnel  (dot.name)'));
assert(template.includes('SELF E'));
assert(source.startsWith('Source for Tunnel  (dot.name)'));
// Existing source-file flow retains both async ownership and replacement guards.
const loader = shell.slice(shell.indexOf('function openSourceFile('),
    shell.indexOf('// ── Save Source File'));
assert(loader.indexOf('confirmSourceReplacement') < loader.indexOf('ed.value = code'));
assert(loader.includes('writeGuard.accepts()'));
assert(loader.includes('saveActiveUserTab()'));
assert(loader.includes('saveEditorState()'));
console.log('Tunnel draft: compiler, six-method ABI, immutable provenance, exact UART binding and guarded template recovery passed');