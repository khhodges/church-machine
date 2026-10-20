'use strict';
// Offline compilation for regression tests. Never writes a catalog or a LUMP.
const fs = require('node:fs');
const path = require('node:path');
global.ChurchAssembler = require('./assembler');
const Compiler = require('./cloomc_compiler');
const Builder = require('./lump_builder');

function compileActorPrograms() {
    const binaries = {};
    for (const actor of ['Alice', 'Mallory']) {
        const source = fs.readFileSync(path.join(__dirname, 'examples',
            actor.toLowerCase() + '.cloomc'), 'utf8');
        const result = new Compiler().compileAssembly(source, []);
        if (result.errors.length) throw Error(JSON.stringify(result.errors));
        const built = Builder.buildLump(result);
        if (!built.words || built.errors?.length) throw Error('Actor LUMP build failed');
        binaries['ide.' + actor] = built.words;
    }
    return binaries;
}
module.exports = {compileActorPrograms};
