'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Compiler = require('./cloomc_compiler');
const source = fs.readFileSync(__dirname + '/cloomc/queue_transfer_primitives.cloomc', 'utf8');
function compile(text) {
    return new Compiler().compileJS(text, []);
}
const named = compile(source);
assert.deepEqual(named.errors, []);
// Independent lexical lowering for equivalence only; never executes a service.
function rawRegisters(text) {
    const aliases = {};
    return text.split('\n').map(line => {
        if (/^\s*method\b/.test(line)) {
            for (const key of Object.keys(aliases)) delete aliases[key];
        }
        const declaration = line.match(/^\s*\.pet\s+(\w+)\s+((?:CR|DR)\d+)\s*$/);
        if (declaration) { aliases[declaration[1]] = declaration[2]; return ''; }
        const [code, ...comment] = line.split(';');
        return code.replace(/\b[A-Za-z_]\w*\b/g, word => aliases[word] || word) +
            (comment.length ? ';' + comment.join(';') : '');
    }).join('\n');
}
const raw = compile(rawRegisters(source));
assert.deepEqual(raw.errors, []);
assert.deepEqual(named.methods.map(m => m.code), raw.methods.map(m => m.code));
assert(named.manifest.some(m => m.mapping.some(x => /WorkingBlock/.test(x.desc))),
    'debug mappings keep source-level names');
const wrapper = body => `abstraction ide.AliasProbe {
passkey required;
capabilities { SELF E }
method Probe() -> Void {
${body}
RETURNAL #0
}
}`;
for (const body of [
    '.pet Count DR16', '.pet Block CR12', '.pet Count DR4\n.pet Count DR5',
    '.pet DR1 DR4', '.pet NULL CR2', '.pet LOAD DR2',
    '.pet Count DR4\nDWRITE Count, Count, #0, DR0',
]) assert(compile(wrapper(body)).errors.length, body);
assert(compile(wrapper('.pet Count DR4').replace(/\n}$/, `
method Other() -> Void {
IADD Count, DR0, #1
RETURNAL #0
}
}`)).errors.length, 'aliases do not leak between methods');
const untyped = compile('abstraction ide.Untyped {\nmethod Run {\n.pet Count DR4\nIADD Count, DR0, #1\nRETURNAL #0\n}\n}');
assert.deepEqual(untyped.errors, []);
assert.deepEqual(compile(wrapper('.pet x10 DR4\nIADD DR2, DR0, #0x10')).methods.map(m => m.code),
    compile(wrapper('IADD DR2, DR0, #0x10')).methods.map(m => m.code),
    'a name inside a hexadecimal immediate is not an operand alias');
const specialName = compile(wrapper('.pet __proto__ DR4\nIADD __proto__, DR0, #1'));
assert.deepEqual(specialName.errors, []);
console.log('PASS method-local CR/DR aliases, raw-word equivalence, source names and rejection guards');
module.exports = {source, named};
