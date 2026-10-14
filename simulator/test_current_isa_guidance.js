'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'app-absdetail.js'), 'utf8');
const start = source.indexOf('function _currentMethodDispatchDescription(');
const end = source.indexOf('// Historical convention records.', start);
assert(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
const describe = context._currentMethodDispatchDescription;
assert.match(describe('ELOADCALL Navana.Find'), /CALL CRn.*held E-GT.*CALL CR6\[PetName\].*caller C-List/);
assert.match(describe('hidden ELOADCALL (NS slot 8)'), /Hardware IRQ.*not executable/);
assert.match(describe('XLOADLAMBDA CR1'), /LAMBDA CRn.*X-GT.*recompile/);
assert.equal(describe('CALL CR3'), 'CALL CR3');
assert(!/\bELOADCALL\b|\bXLOADLAMBDA\b/.test(describe('ELOADCALL Mint.Encode')));
assert(source.includes('_currentMethodDispatchDescription(regConv.dispatch)'));
const master = fs.readFileSync(path.join(__dirname, '../docs/instruction-set.md'), 'utf8');
assert(master.includes('## Retired opcodes and direct/indirect reference forms'));
assert(master.includes('# Historical baseline — not current instruction guidance'));
assert(master.includes('operand `0x0007` instead'));
// Review provenance must not silently authorize encodings or reset contracts.
assert(master.includes('## October 2026 amendment reconciliation'));
assert(master.includes('not established supersessions'));
assert(master.includes('## CHANGE: one-GT Thread activation'));
assert(master.includes('Neither CR12.M nor CR13.M is required'));
assert(master.includes('### Earlier IRQ hardware exception — unresolved against later review direction'));
assert(master.includes('full NULL-clearing on every ordinary CHANGE requires confirmation') ||
    master.includes('Full NULL-clearing on every ordinary CHANGE requires confirmation'));
for (const word of ['0x27660000', '0x27060000', '0x27678001', '0x27000001',
    '0x276E8000', '0x276E8001', '0x27000002']) {
    assert(master.includes(`| \`${word}\` |`), `Missing explicit binary disposition: ${word}`);
}
assert(master.includes('all five consumer\nconformance checks and exact-image/board acceptance are **NOT RUN**'));
assert(master.includes('already agreed indexed-CALL feature was rejected or deferred'));
assert(master.includes('GT-layout completeness is a separate track'));
for (const file of ['isa_reference.md', 'isa_encoding.md']) {
    const doc = fs.readFileSync(path.join(__dirname, '../docs', file), 'utf8');
    assert.match(doc.split('\n')[0], /historical baseline/);
    assert(doc.includes('instruction-set.md#retired-opcodes-and-directindirect-reference-forms'));
}
console.log('PASS current ISA guidance: direct/indirect dispatch, retired decode guidance and historical reference boundaries');
