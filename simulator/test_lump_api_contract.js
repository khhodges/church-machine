'use strict';
const assert = require('assert');
const fs = require('fs');
const {parse, serialize, validate} = require('./lump-api-contract');
const original = fs.readFileSync(__dirname + '/../tests/fixtures/wch-compact-api.json','utf8').trim();
const header = {cw:75,cc:3};
const wch = parse(original, header);
const before = JSON.stringify(wch);
assert.equal(serialize(wch, header).length, 130);
assert.equal(8 + 75 * 4 + 3 * 4 + Math.ceil(130 / 4) * 4, 452);
assert.deepStrictEqual(parse(serialize(wch, header), header), wch);
assert.equal(JSON.stringify(wch), before, 'validation must not mutate declarations');
const bad = (change, pattern) => {
    const copy = JSON.parse(before);
    change(copy);
    assert.throws(() => validate(copy, header), pattern);
};
bad(a => a.capabilities = [], /unknown field/);
bad(a => a.language = 'assembly', /unknown field/);
bad(a => a.methods.Run.branchOffset = 2, /unknown field/);
bad(a => a.methods.Run.grants = ['E'], /unknown field/);
bad(a => a.methods = [], /legacy array/);
bad(a => a.methods.Run.selector = 75, /outside/);
bad(a => a.methods.Run.selector = -1, /outside/);
bad(a => a.methods.Alias = {selector:0}, /duplicate method/);
bad(a => a.imports.RW[0] = 'SELF', /row zero/);
bad(a => a.imports.RW[3] = 'kjhh1.OTHER', /outside/);
bad(a => delete a.imports.RW[1], /every non-SELF/);
bad(a => a.imports.RW[1] = 'LED0', /qualified/);
bad(a => a.imports.RW[1] = 0x82000006, /invalid target/);
bad(a => a.imports.RW[2] = a.imports.RW[1], /duplicate target/);
bad(a => a.imports.E = {1:'kjhh1.OTHER'}, /duplicate import/);
bad(a => {a.imports.WR = a.imports.RW; delete a.imports.RW;}, /permissions/);
bad(a => {a.imports.RE = a.imports.RW; delete a.imports.RW;}, /permissions/);
bad(a => {a.imports.RW[1] = 2; a.imports.RW[2] = 1;}, /cyclic/);
bad(a => a.methods.Run.inputs = {x:'CR1'}, /explicit type/);
bad(a => a.methods.Run.inputs = {x:'DR1',y:'DR1'}, /duplicate parameter/);
assert.throws(() => parse(original.replace('"name":','"name":"other","name":'), header), /duplicate JSON key/);
assert.throws(() => parse(original.replace('"name":','"na\\u006de":"other","name":'), header), /duplicate JSON key/);
const shared = JSON.parse(before);
shared.imports = {R:{1:'kjhh1.LED0'},W:{2:1}};
assert.equal(validate(shared, header), shared, 'one target definition, independent rights requirements');
const locked = JSON.parse(before);
locked.imports = {E:{1:{
    name:'foreign.Service#1', T:'12345678', binary_hash:'a'.repeat(64),
    identity_hash:'b'.repeat(64), type:'Inform'
},2:1}};
locked.methods.Run.inputs = {value:'DR1',service:{register:'CR1',type:'Inform',rights:'E'}};
assert.equal(validate(locked, header), locked);
delete locked.imports.E[1].binary_hash;
assert.throws(() => validate(locked, header), /missing binary_hash/);
assert.throws(() => parse('{"name":"X","methods":{},"imports":{"E":{"1":{"name":"X"}}}}', {cw:1,cc:2}), /missing/);
assert.throws(() => validate(wch, {cw:75,cc:256}), /extent/);
assert.deepStrictEqual(parse('{"name":"NoMethods","methods":{}}', {cw:1,cc:1}), {name:'NoMethods',methods:{}});
bad(a => a.methods = new Date(), /name-keyed object/);
const reversed = {imports:wch.imports, methods:wch.methods, name:wch.name};
assert.equal(serialize(reversed, header), serialize(wch, header), 'canonical key order');
assert.throws(() => parse(' '.repeat(65536), header), /length/);
assert.throws(() => parse('{"name":"Broken",', header), SyntaxError);
assert.throws(() => parse('['.repeat(34) + '0' + ']'.repeat(34), header), /nesting/);
(async () => {
    const frame = await require('./lump-content-frame').lumpBuildContentFrame(
        JSON.parse(serialize(wch, header)), '', {profile:'api'});
    assert.equal(frame.frameWords[0] >>> 0, 0xab000082);
    assert.equal(frame.frameWords.length, 34, 'one JSON header plus 33 aligned JSON words');
    assert.equal((1 + header.cw + frame.frameWords.length + header.cc) * 4, 452);
    console.log('PASS canonical API contract: WCH 130 bytes, existing framing, geometry, duplicates, rights, references, locked identities, no GTs');
})().catch(error => {console.error(error); process.exitCode = 1;});
