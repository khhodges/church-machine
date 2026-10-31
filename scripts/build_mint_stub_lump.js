'use strict';
// Isolated artifact builder, not a publication/admission path.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Compiler = require('../simulator/cloomc_compiler');
const {buildLump, embedSelfDefinition} = require('../simulator/lump_builder');
const root = path.resolve(__dirname, '..');
function build() {
    const source = fs.readFileSync(path.join(root, 'simulator/cloomc/mint_stub.cloomc'), 'utf8');
    const abi = JSON.parse(fs.readFileSync(path.join(root, 'simulator/mint/mint-stub.abi.json'), 'utf8'));
    // Exact scaffold contract: not a general-purpose replacement ABI validator.
    assert.deepEqual(abi, {name:'ide.Mint',passkey:1,methods:{
        CREATE:[0,[['allocation',1],['permissions',1]],[2,'RW']],
        DESTROY:[1,[['target',2,'RW']],0],
        MakeInform:[3,[['target',3,'RW']],[2,'RW']],
        MakeOutform:[2,[['target',2,'RW']],[3,'RW']],
    }});
    const compiled = new Compiler().compile(source, []);
    assert.deepEqual(compiled.errors, []);
    assert.deepEqual(compiled.methods.map(m => m.name), ['CREATE','DESTROY','MakeOutform','MakeInform']);
    const packed = buildLump(compiled, {allocationWords:64});
    const words = embedSelfDefinition(packed.words, abi, source, 2);
    const bytes = Buffer.alloc(words.length * 4);
    words.forEach((w,i) => bytes.writeUInt32BE(w >>> 0, i * 4));
    for (const [name,[selector]] of Object.entries(abi.methods)) {
        const entry = words[selector + 1];
        assert.ok(entry > 4 && entry <= packed.cw);
        assert.deepEqual(words.slice(entry, entry + compiled.methods[selector].code.length),
            compiled.methods[selector].code.map(w => w >>> 0), name);
    }
    return {source, abi, compiled, words, bytes, cw:packed.cw};
}
if (require.main === module) {
    const result = build();
    const out = path.join(root, 'generated-artifacts/mint-stub');
    fs.mkdirSync(out, {recursive:true});
    fs.writeFileSync(path.join(out, 'ide.Mint.stub.lump'), result.bytes);
    fs.writeFileSync(path.join(out, 'ide.Mint.stub.abi.json'), JSON.stringify(result.abi));
    fs.writeFileSync(path.join(out, 'mint_stub.cloomc'), result.source);
    fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify({
        purpose:'UNINSTALLED unsupported-operation scaffold; not operational Mint',
        bytes:result.bytes.length, codeWords:result.cw,
        sha256:crypto.createHash('sha256').update(result.bytes).digest('hex'),
        methods:['CREATE','DESTROY','MakeOutform','MakeInform'],
        status:5, installed:false, passkeyVerified:false,
    }, null, 2) + '\n');
    console.log(`Built ${result.bytes.length}-byte isolated LUMP in ${out}`);
}
module.exports = {build};
