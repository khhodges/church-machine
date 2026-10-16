'use strict';
// Dotted CALL identities under church.symbolic-lump-binding/v1: declared
// dot-names compile to INVALID_OP placeholders with exact references and
// original editor coordinates, independent of destination API evidence.
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
global.ChurchAssembler = require('./assembler.js');
const Compiler = require('./cloomc_compiler.js');

const PLACEHOLDER = 0xF7000000;
// Active editor C-list, not a capabilities block in this source.
const slots = {SELF: 0, 'ide.SelfTest': 1, 'ide.WukongCallHome': 2};
const lines = Array(109).fill('; original editor line');
lines[0] = 'abstraction ide.Caller {';
lines[1] = 'capabilities { SELF E, ide.SelfTest E, ide.WukongCallHome E }';
lines[2] = 'method Run() {';
lines[105] = 'Start:';
lines[106] = 'CALL ide.SelfTest';
lines[107] = 'CALL ide.WukongCallHome';
lines[108] = 'BRANCH Start';
lines.push('}', '}');
const source = lines.join('\n');
const expected = [[107, 'ide.SelfTest', 1], [108, 'ide.WukongCallHome', 2]];

function check(result, label) {
    assert.deepEqual(result.errors, [], label);
    assert.deepEqual(result.warnings.filter(w => w.code === 'CALL_API_UNAVAILABLE'), [], label);
    const method = result.methods[0];
    const calls = method.symbolicCalls || [];
    assert.deepEqual(calls.map(c => [c.source_line, c.full_name, c.row]), expected, label);
    for (const c of calls) assert.equal(method.code[c.addr] >>> 0, PLACEHOLDER, label);
}
check(new Compiler().compile(source, [], {clistSlots: slots}), 'compile');
check(new Compiler().compileAssembly(source, [], {clistSlots: slots}), 'assembly');

// Supplied API evidence neither changes nor shortens the symbolic reference.
const api = {embedded: true, token: 'exact', selectedToken: 'exact',
    api: {methods: [{name: 'Run', index: 0}]}};
const authorities = {'ide.SelfTest': api, 'ide.WukongCallHome': api};
check(new Compiler().compileAssembly(source, [], {clistSlots: slots, callApiAuthorities: authorities}), 'with API');
check(new Compiler().compileAssembly(source, [], {clistSlots: slots,
    callApiAuthorities: {'ide.SelfTest': {...api, selectedToken: 'different'}}}), 'stale API');

// Object.method keeps the complete spelling; no method table is consulted.
const methodResult = new Compiler().compileAssembly(
    'abstraction ide.Caller {\ncapabilities { SELF E, ide.SelfTest E }\nmethod Run() {\nCALL ide.SelfTest.Run\nCALL ide.SelfTest.Missing\n}\n}', [], {clistSlots: slots});
assert.deepEqual(methodResult.errors, []);
assert.deepEqual(methodResult.warnings, []);
assert.deepEqual(methodResult.methods[0].symbolicCalls.map(c => [c.full_name, c.row]),
    [['ide.SelfTest.Run', 1], ['ide.SelfTest.Missing', 1]]);

// Metadata removal must retain blank lines and original source coordinates.
const withDirective = lines.slice();
withDirective[3] = '@target IoT';
withDirective[4] = '';
check(new Compiler().compile(withDirective.join('\n'), [], {clistSlots: slots}), 'directive');

const wrapped = lines.slice();
wrapped[0] = 'abstraction ide.Caller {';
wrapped[1] = 'capabilities { SELF E, ide.SelfTest E, ide.WukongCallHome E }';
wrapped[2] = 'method Start() {';
check(new Compiler().compile(wrapped.join('\n'), []), 'native');

// Server worker path.
const worker = spawnSync(process.execPath, ['server/compile_worker.js'], {
    input: JSON.stringify({source, language: 'assembly', clist_slots: slots}),
    encoding: 'utf8', timeout: 30000, cwd: require('node:path').join(__dirname, '..')
});
assert.equal(worker.status, 0, worker.stderr);
const response = JSON.parse(worker.stdout);
assert.equal(response.ok, true, response.error);
assert.deepEqual(response.warnings, []);
const frame = require('./lump-content-frame.js').lumpDecodeContentFrameApi(response.words);
assert.deepEqual(frame.symbolic_binding.calls.map(c => [c.source_line, c.full_name, c.row]), expected);
for (const c of frame.symbolic_binding.calls) assert.equal(response.words[c.word_offset] >>> 0, PLACEHOLDER);
console.log('Dotted CALL identities, symbolic relocations, editor lines and worker path passed');
