'use strict';
const assert = require('assert');
const path = require('path');
const {spawnSync} = require('child_process');
const Compiler = require('./cloomc_compiler.js');
const compiler = new Compiler();
for (const source of [
    'method Run {\n RETURN\n}',
    'public method Run() {\n return(1);\n}',
    'return(1);',
    '// abstraction NotADeclaration {\nmethod Run {\n RETURN\n}',
]) {
    for (const compile of [
        value => compiler.compile(value, []),
        value => compiler.compileJS(value),
    ]) {
        const result = compile(source);
        assert(result.errors.some(error => /abstraction declaration/i.test(error.message)));
        assert.equal(result.abstractionName, '');
        assert.equal(result.methods.length, 0);
    }
    const response = spawnSync(process.execPath,
        [path.join(__dirname, '../server/compile_worker.js')], {
            input: JSON.stringify({source, language: 'javascript'}),
            encoding: 'utf8',
        });
    assert.equal(response.status, 0, response.stderr);
    const result = JSON.parse(response.stdout);
    assert.equal(result.ok, false);
    assert.match(result.error, /abstraction declaration/i);
    assert.equal(result.words, undefined);
    assert.equal(result.lump_binary, undefined);
}
for (const name of ['RunAbstraction', 'MyAbstraction', 'DeclaredName']) {
    const source = `abstraction ${name} {\nmethod Run {\n RETURN\n}\n}`;
    const result = compiler.compile(source, []);
    assert.deepEqual(result.errors, []);
    assert.equal(result.abstractionName, name);
}
console.log('PASS: unnamed CLOOMC source rejected; explicit names preserved');
function worker(source, language, extra = {}) {
    const response = spawnSync(process.execPath,
        [path.join(__dirname, '../server/compile_worker.js')], {
            input: JSON.stringify({source, language, ...extra}), encoding: 'utf8',
        });
    assert.equal(response.status, 0, response.stderr);
    return JSON.parse(response.stdout);
}
const frontends = [
    {language: 'assembly', body: 'RETURN', named: '; @abstraction Assembly\nRETURN'},
    {language: 'assembly', body: '; Ordinary comment\nStart:\nRETURN',
        named: '; Abstraction: Assembly\nRETURN'},
    {language: 'symbolic', body: 'let id x = x',
        named: 'abstraction Symbolic {\nlet id x = x\n}'},
    {language: 'english', body: 'Add a method called Run\nReturn 0',
        named: 'Create an abstraction called English\nAdd a method called Run\nReturn 0'},
    {language: 'assembly', extra: {isa_profile: 'IDX1'}, body: 'RETURN',
        named: '; @abstraction LocalIDX1\nRETURN'},
];
for (const {language, body, named, extra} of frontends) {
    const rejected = worker(body, language, extra);
    assert.equal(rejected.ok, false, `${language} accepted unnamed source`);
    assert.match(rejected.error, /abstraction declaration/i);
    assert.equal(rejected.words, undefined);
    const accepted = worker(named, language, extra);
    assert.equal(accepted.ok, true, `${language}: ${accepted.error}`);
    assert(accepted.abstractionName);
}
global.ChurchAssembler = require('./assembler.js');
for (const source of ['RETURN', '; Meaningful comment\nStart:\nRETURN']) {
    assert.match(compiler.compileAssembly(source).errors[0].message, /abstraction declaration/);
}
const idx1 = require('./idx1-ide.js');
assert.match(idx1.compile(new global.ChurchAssembler(), 'RETURN').errors[0].message,
    /abstraction declaration/);
assert(compiler.compileSymbolic('let id x = x').errors.length);
assert(compiler.compileEnglish('Add a method called Run\nReturn 0').errors
    .some(error => /abstraction declaration/.test(error.message)));
console.log('PASS: remaining frontends require explicit names in browser and worker paths');