'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.ChurchAssembler = require('./assembler');
const Compiler = require('./cloomc_compiler');
const Builder = require('./lump_builder');
for (const actor of ['Alice', 'Mallory']) {
    const source = fs.readFileSync(__dirname + '/examples/' + actor.toLowerCase() + '.cloomc', 'utf8');
    const compiled = new Compiler().compileAssembly(source, []);
    assert.deepEqual(compiled.errors, []);
    const built = Builder.buildLump(compiled);
    const api = Builder.buildApiDefinition(compiled, {cw:built.cw, cc:built.cc});
    assert.deepEqual(api.methods.map(m => m.name),
        actor === 'Alice' ? ['Stash', 'Reveal'] : ['Steal']);
    assert.deepEqual(compiled.capabilities.map(c => c.name), ['SELF', 'ide.' + actor]);
    assert.deepEqual(compiled.capabilities[1].rights, ['R', 'W']);
    assert.equal(built.cc, 2);
    if (actor === 'Alice') {
        assert.equal(built.words[1], 3);
        assert.equal(built.words[2], 6);
        assert.equal(built.words[3], 0x070b0010, 'current literal LOAD encoding');
        assert.equal(built.words[4], 0x8f08c009, 'Stash writes DR1 through CR1 at word 9');
        assert.equal(built.words[7], 0x8708c009, 'Reveal reads the same word');
        assert.equal(built.words[8] >>> 27, 3, 'RETURN precedes private storage');
        assert.equal(built.words[9], 0xf0000000, 'storage remains at declared offset');
        assert(!compiled.methods.some(m => m.code.some(word => (word >>> 27) === 21)),
            'Alice must not replace the caller value with a literal');
    } else {
        assert.equal(built.words[2], 0x070b0020, 'Mallory requests absent row 2');
    }
}
console.log('PASS current actor source, explicit methods, private row and storage layout');
