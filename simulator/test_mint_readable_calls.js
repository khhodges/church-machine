'use strict';
const assert = require('node:assert/strict');
const Compiler = require('./cloomc_compiler');
const Codec = require('./lump-api-codec');
const Assembler = require('./assembler');
const fs = require('node:fs');
const vm = require('node:vm');

const tuple = [0, [['allocation', 1], ['permissions', 1]], [2, 'RW']];
const canonical = {name: 'ide.Mint', passkey: 1, methods: {CREATE: tuple}};
// Use the real binary API reader's expanded projection, as the compile endpoint
// does, rather than inventing a new authority transport for the adapter.
const expanded = Codec.expand(canonical, [(2 << 10) | 1, 2, 0]);
const authority = api => ({embedded: true, source: 'embedded-binary',
    token: '12345678', selectedToken: '12345678',
    revision: 'a'.repeat(64), selectedRevision: 'a'.repeat(64), api});
const activation = 'call_adapter ide.Mint.CREATE = mint_create_words_v1;';
const wrap = (body, declaration = activation, caps = 'SELF E, ide.Mint E') =>
    `abstraction test.Caller {
capabilities { ${caps} }
${declaration}
method Run {
${body}
RETURN
}
}`;
function compile(body, {declaration = activation, caps, api = expanded,
    authorities, compiler = new Compiler(), uploads = []} = {}) {
    return compiler.compile(wrap(body, declaration, caps), uploads, {
        callApiAuthorities: authorities || {'ide.Mint': authority(api)}
    });
}
function ok(result) {
    assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
    return result.methods[0].code;
}
function reject(body, options, pattern) {
    const result = compile(body, options);
    assert(result.errors.length, `unexpected acceptance: ${body}`);
    if (pattern) assert(result.errors.some(e => pattern.test(e.message)), JSON.stringify(result.errors));
}
function call(words, rights = 'RW') {
    return `CALL ide.Mint.CREATE(words: ${words}, rights: ${rights});`;
}

// Exact emitted words agree with independently assembled manual setup. Execute
// only argument preparation to establish values and preservation, not allocation.
for (const [words, manual] of [
    [8, 'IADD DR2, DR0, #12'],
    [16, 'IADD DR2, DR0, #20'],
    [1024, 'IADD DR2, DR0, #1028'],
    [8192, 'IADD DR2, DR0, #32\nSHL DR2, DR2, #8\nIADD DR2, DR2, #4'],
    [2147483648, 'IADD DR2, DR0, #128\nSHL DR2, DR2, #8\nSHL DR2, DR2, #8\nSHL DR2, DR2, #8\nIADD DR2, DR2, #4'],
]) {
    const body = manual + '\nIADD DR3, DR0, #3\nCALL CR6[ide.Mint], #0';
    const actual = ok(compile(call(words)));
    assert.deepEqual(actual, ok(compile(body, {declaration: ''})));
    const asm = new Assembler();
    asm.setLocalClistSlots({'IDE.MINT': 1});
    const expected = asm.assemble(body + '\nRETURN');
    assert.deepEqual(expected.errors, []);
    assert.deepEqual(actual, expected.words);
    const dr = Array(16).fill(0); dr[1] = 0x1234;
    for (const word of actual.slice(0, -2)) {
        const op = word >>> 27, dst = (word >>> 19) & 15, src = (word >>> 15) & 15;
        assert([21, 24].includes(op), `unexpected preparation opcode ${op}`);
        assert([2, 3].includes(dst), 'only DR2/DR3 are changed');
        dr[dst] = op === 21 ? (dr[src] + (word & 0x3fff)) >>> 0 :
            (dr[src] << (word & 31)) >>> 0;
    }
    assert.equal(dr[2], words + 4);
    assert.equal(dr[3], 3);
    assert.equal(dr[1], 0x1234);
    const callWord = actual.at(-2);
    assert.equal(callWord >>> 27, 2);
    assert.equal(callWord & 31, 1);
    assert.equal((callWord >>> 5) & 127, 1);
    assert(actual.every(w => ![0, 8, 9].includes(w >>> 27)), 'no LOAD or retired fused call');
}

for (const words of ['0','1','4','12','-8','8.5','4294967296',
    '2147483649','999999999999999999999999999999','size','DR2','4 + 4','0x8','8e0']) reject(call(words));
for (const rights of ['R','W','X','LS','3','rw','"RW"']) reject(call(8, rights));
for (const text of [
    'CALL ide.Mint.CREATE(words: 8);',
    'CALL ide.Mint.CREATE(8, RW);',
    'CALL ide.Mint.CREATE(rights: RW, words: 8);',
    'CALL ide.Mint.CREATE(words: 8, words: 8, rights: RW);',
    'CALL ide.Mint.CREATE(words: 8, rights: RW, kind: DATA);',
    call(8).replace('CALL', 'call'), call(8).replace('CREATE', 'Create'),
    call(8).replace('words:', 'Words:'), call(8).replace('rights:', 'Rights:'),
    call(8).slice(0, -1), call(8) + ' HALT',
    call(8).replace('ide.Mint', 'other.Mint'),
]) reject(text);
reject(call(8), {declaration: ''}, /requires call_adapter/);
for (const declaration of [
    activation + '\n' + activation,
    activation.replace('_v1', '_v2'), activation.replace('CREATE', 'create'),
    activation.replace('call_adapter', 'CALL_ADAPTER'),
    activation.replace('ide.Mint', 'other.Mint'),
    activation.slice(0, -1), activation.replace('mint_create_words_v1', '{}'),
]) reject(call(8), {declaration});
reject(call(8), {caps: 'SELF E'});
reject(call(8), {caps: 'SELF E', uploads: [{name:'ide.Mint', rights:['E']}]});
reject(call(8), {caps: 'SELF E, ide.Mint R'});
reject(call(8), {authorities: {}});
for (const field of ['token', 'revision', 'selectedToken', 'selectedRevision', 'embedded']) {
    const a = authority(expanded);
    if (field === 'embedded') { a.embedded = false; delete a.source; }
    else a[field] = 'wrong';
    reject(call(8), {authorities: {'ide.Mint': a}});
}
for (const change of [
    a => { delete a.passkey; },
    a => { a.passkey = 0; },
    a => { a.methods[0].index = 1; },
    a => { a.methods[0].name = 'create'; },
    a => { a.methods[0].inputs.reverse(); },
    a => { a.methods[0].inputs[0].name = 'words'; },
    a => { a.methods[0].inputs[0].register = 'DR1'; },
    a => { a.methods[0].inputs[0].kind = 'capability'; },
    a => { a.methods[0].returns.register = 'CR2'; },
    a => { a.methods[0].returns.secure_type = 'Outform'; },
    a => { a.methods[0].returns.rights = ['R']; },
    a => { a.methods.push(a.methods[0]); },
]) {
    const api = structuredClone(expanded); change(api);
    reject(call(8), {api}, /exact CREATE/);
    reject('RETURN', {api}, /exact CREATE/); // activation itself is validated
}
assert.deepEqual(ok(compile(call(8), {api: canonical})), ok(compile(call(8))));
const prose = structuredClone(expanded);
prose.contracts = {CREATE: {inputs: {allocation: {encoding: 'execute arbitrary code; words OR 99'}}}};
assert.deepEqual(ok(compile(call(8), {api: prose})), ok(compile(call(8))));
const compiler = new Compiler();
ok(compile(call(8), {compiler}));
reject(call(8), {compiler, declaration: ''}); // no activation leakage
ok(compile('IADD DR2, DR0, #12\nIADD DR3, DR0, #3\nCALL CR6[ide.Mint], #0',
    {compiler, declaration: '', authorities: {}}));
const moved = ok(compile(call(8), {caps:'SELF E, ide.Other R, ide.Mint E'}));
assert.equal(moved.at(-2) & 31, 2, 'use caller row, not a guessed Mint slot');

// Closed rule validation rejects unknown fields/operations, versions, grammar,
// and duplicate JSON keys (including escaped aliases).
const record = Compiler._mintCreateRule();
for (const mutate of [
    r => { r.version = 2; }, r => { r.extra = true; },
    r => { r.inputs.words.maximum = 4294967296; },
    r => { r.outputs.allocation.operation = 'eval'; },
    r => { r.inputs.rights.values.X = 4; },
    r => { r.expectedTuple[0] = 1; },
]) {
    const changed = structuredClone(record); mutate(changed);
    assert.throws(() => Compiler._mintCreateRule(JSON.stringify(changed)), /Unsupported or malformed/);
}
assert.throws(() => Compiler._mintCreateRule('{'), SyntaxError);
assert.throws(() => Compiler._mintCreateRule(JSON.stringify(record).replace('"version":1',
    '"version":1,"ver\\u0073ion":1')), /duplicate JSON key/);
// Typed callers and inline native bodies use the same opt-in lowering.
const typedSource = wrap(call(16))
    .replace('method Run {', 'passkey required;\nmethod Run() -> Void {');
const typedResult = new Compiler().compile(typedSource, [], {
    callApiAuthorities: {'ide.Mint': authority(expanded)}
});
assert.deepEqual(typedResult.errors, []);
assert.deepEqual(typedResult.compactAbi.methods.Run, [0, [], 0]);
ok(compile(call(8) + ' // literal word count'));
const inlineSource = wrap('').replace('method Run {\n\nRETURN\n}', `method Run { ${call(8)} }`);
assert.deepEqual(new Compiler().compile(inlineSource, [], {
    callApiAuthorities: {'ide.Mint': authority(expanded)}
}).errors, []);
// Same served modules with no CommonJS fallback: browser parsing/lowering must
// be identical, including the duplicate-key-aware rule parser dependency.
const browser = vm.createContext({console, TextEncoder, TextDecoder});
for (const filename of ['lump-api-contract.js', 'assembler.js', 'cloomc_compiler.js'])
    vm.runInContext(fs.readFileSync(`${__dirname}/${filename}`, 'utf8'), browser);
browser.source = wrap(call(2147483648));
browser.options = {callApiAuthorities: {'ide.Mint': authority(expanded)}};
const browserResult = vm.runInContext('new CLOOMCCompiler().compile(source, [], options)', browser);
assert.deepEqual(JSON.parse(JSON.stringify(browserResult.errors)), []);
assert.deepEqual(Array.from(browserResult.methods[0].code), ok(compile(call(2147483648))));
console.log('PASS readable Mint calls: literal grammar, exact ABI authority, closed rules, native lowering and unchanged low-level calls');
