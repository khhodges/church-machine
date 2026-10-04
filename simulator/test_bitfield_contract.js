const assert = require('assert');
const Assembler = require('./assembler.js');
for (const op of ['BFEXT', 'BFINS']) {
    const a = new Assembler();
    for (const [pos, width] of [[7,9], [31,1], [1,31]]) {
        const source = `${op} DR2, DR1, #${pos}, #${width}`;
        const r = a.assemble(source);
        assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
        assert.equal(r.words[0] & 0x7fff, (pos << 5) | width);
        const text = a.disassemble(r.words[0]);
        const roundtrip = new Assembler().assemble(text);
        assert.equal(roundtrip.errors.length, 0, text);
        assert.deepEqual(roundtrip.words, r.words);
    }
    for (const [pos, width] of [[0,0], [0,32], [0,33], [32,1], [33,1], [31,2]]) {
        assert(a.assemble(`${op} DR2, DR1, #${pos}, #${width}`).errors.length,
            `${op} accepted invalid ${pos},${width}`);
    }
}
console.log('Bitfield assembly bounds and disassembly roundtrip passed');