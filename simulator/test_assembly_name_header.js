'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const context = {
    ChurchAssembler: class {
        assemble() { return { words: [0], labels: { Start: 0 }, capabilities: [], errors: [] }; }
    },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('simulator/cloomc_compiler.js', 'utf8') +
    '\nthis.compiler = new CLOOMCCompiler();', context);
for (const name of ['CapabilityTest', 'Other.Program#3']) {
    const result = context.compiler.compileAssembly(
        `; ========\n; Abstraction:  ${name}\n; Description: prose is not an identity\nStart:\nLOAD CR0, CR6[1]`, []);
    assert.equal(result.abstractionName, name);
}
assert.equal(context.compiler.compileAssembly('; Example NS[10]\nLOAD CR0, CR6[1]', []).abstractionName, 'Example');
console.log('PASS explicit assembly name header and legacy NS header');