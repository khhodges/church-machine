'use strict';
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
global.ChurchAssembler = require('./assembler.js');
const Compiler = require('./cloomc_compiler.js');

// Active editor C-list, not a capabilities block in this source.
const slots = {SELF: 0, 'ide.SelfTest': 1, 'ide.WukongCallHome': 2};
const lines = Array(109).fill('; original editor line');
lines[0] = '; Abstraction: ide.Caller';
lines[105] = 'Start:';
lines[106] = 'CALL ide.SelfTest';
lines[107] = 'CALL ide.WukongCallHome';
lines[108] = 'BRANCH Start';
const source = lines.join('\n');
const expected = [[107, 'ide.SelfTest'], [108, 'ide.WukongCallHome']];
function check(result) {
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings.filter(w => w.code === 'CALL_API_UNAVAILABLE')
        .map(w => [w.line, w.petname]), expected);
    const code = result.methods[0].code;
    assert.equal(code[0] >>> 27, 2);
    assert.equal(code[0] & 31, 1);
    assert.equal(code[1] >>> 27, 2);
    assert.equal(code[1] & 31, 2);
}
check(new Compiler().compile(source, [], {clistSlots: slots}));
check(new Compiler().compileAssembly(source, [], {clistSlots: slots}));
const worker = spawnSync(process.execPath, ['server/compile_worker.js'], {
    input: JSON.stringify({source, language: 'assembly', clist_slots: slots}),
    encoding: 'utf8', timeout: 30000
});
assert.equal(worker.status, 0, worker.stderr);
const response = JSON.parse(worker.stdout);
assert.equal(response.ok, true, response.error);
assert.deepEqual(response.warnings.map(w => [w.line, w.petname]), expected);
const expectedCode = new Compiler().compileAssembly(source, [], {clistSlots: slots}).methods[0].code;
assert(response.words.some((word, i) => word === expectedCode[0] &&
    response.words[i + 1] === expectedCode[1]), 'packed worker image retains both indexed CALLs');

const api = {embedded: true, token: 'exact', selectedToken: 'exact',
    api: {methods: [{name: 'Run', index: 0}]}};
const authorities = {'ide.SelfTest': api, 'ide.WukongCallHome': api};
assert.deepEqual(new Compiler().compileAssembly(source, [], {
    clistSlots: slots, callApiAuthorities: authorities
}).warnings, []);
const missing = new Compiler()._callApiDiagnostics(source, {});
assert.deepEqual(missing.warnings.map(w => [w.line, w.petname]), expected);

const declared = '; Abstraction: Caller\ncapabilities {\n SELF E,\n ; comment before full name\n ide.SelfTest E,\n ide.WukongCallHome E\n}\nCALL ide.SelfTest\nCALL ide.WukongCallHome\n';
const declaredResult = new Compiler().compileAssembly(declared, []);
assert.deepEqual(declaredResult.errors, []);
assert.deepEqual(declaredResult.warnings.map(w => w.petname), Object.keys(authorities));
const methodResult = new Compiler().compileAssembly(
    '; Abstraction: Caller\nCALL ide.SelfTest.Run\nCALL ide.SelfTest, Run', [], {
        clistSlots: slots, callApiAuthorities: authorities
    });
assert.deepEqual(methodResult.errors, []);
assert.deepEqual(methodResult.warnings, []);
assert.equal(methodResult.methods[0].code[0], methodResult.methods[0].code[1]);

// Metadata removal must retain blank lines and original source coordinates.
const withDirective = lines.slice();
withDirective[1] = '@target IoT';
withDirective[2] = '';
check(new Compiler().compile(withDirective.join('\n'), [], {clistSlots: slots}));

const wrapped = lines.slice();
wrapped[0] = 'abstraction ide.Caller {';
wrapped[1] = 'capabilities { SELF E, ide.SelfTest E, ide.WukongCallHome E }';
wrapped[2] = 'method Start() {';
wrapped.push('}', '}');
check(new Compiler().compile(wrapped.join('\n'), []));

const stale = new Compiler().compileAssembly(source, [], {
    clistSlots: slots,
    callApiAuthorities: {'ide.SelfTest': {...api, selectedToken: 'different'}}
});
assert.deepEqual(stale.warnings.map(w => [w.line, w.petname]), expected);
const absent = new Compiler().compileAssembly(
    '; Abstraction: ide.Caller\nCALL ide.SelfTest, Missing', [], {
        clistSlots: slots, callApiAuthorities: authorities
    });
assert(absent.errors.some(e => e.code === 'CALL_API_METHOD_INVALID' &&
    e.petname === 'ide.SelfTest'));
console.log('Dotted CALL identities, exact APIs, editor lines and worker path passed');
