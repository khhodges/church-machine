'use strict';
// Compile the real sources unchanged for review, never install/admit them.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const Compiler = require('../simulator/cloomc_compiler');
const {buildLump, buildApiDefinition, embedSelfDefinition} = require('../simulator/lump_builder');
const root = path.resolve(__dirname, '..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function buildPrototypeReview() {
    const images = ['mint', 'pkverify', 'mint_cleaner'].map(stem => {
        const sourcePath = `simulator/cloomc/${stem}.cloomc`;
        const source = fs.readFileSync(path.join(root, sourcePath), 'utf8');
        const result = new Compiler().compile(source, []);
        assert.deepEqual(result.errors, [], sourcePath);
        const packed = buildLump(result);
        const api = buildApiDefinition(result, packed.words);
        const words = embedSelfDefinition(packed.words, api, source, 2);
        const bytes = Buffer.alloc(words.length * 4);
        words.forEach((word, i) => bytes.writeUInt32BE(word >>> 0, i * 4));
        return {stem, sourcePath, source, result, api, words, bytes, cw:packed.cw};
    });
    const mint = images[0];
    assert.equal(mint.result.capabilities[4].name, images[1].result.abstractionName);
    assert.equal(mint.result.capabilities[6].name, images[2].result.abstractionName);
    return {images, report:{
        purpose:'Real CREATE/PkVerify/Cleaner prototype review, not the new-ABI implementation',
        installed:false, newAbi:false, linked:false,
        credentials:'Existing prototype: caller proof CR2, trusted reference CR3, verification success DR1=1',
        dependencies:'PkVerify and Cleaner sources included; runtime state, approval reference and Namespace bindings are NOT provisioned',
        acceptance:'Compilation/packing only; authorization tests do not establish successful allocation',
        pending:['Port PassKey to CR1 without clearing it before verification',
            'Change normal success to DR1=0 and propagate verification failures',
            'Remove obsolete unused-input NULL checks',
            'Support typed ABI imports and verify actual allocation/zeroization/result issuance',
            'Resolve byte-addressed prototype versus word-addressed simulator evidence without changing the BIT'],
        images:images.map(i => ({
            name:i.result.abstractionName, source:i.sourcePath,
            sourceSha256:digest(Buffer.from(i.source)), binarySha256:digest(i.bytes),
            bytes:i.bytes.length, methods:i.result.methods.map(m => m.name),
            imports:i.result.capabilities.map(c => c.name),
        })),
    }};
}
if (require.main === module) {
    const {images, report} = buildPrototypeReview();
    const out = path.join(root, 'generated-artifacts/mint-prototype-review');
    fs.mkdirSync(out, {recursive:true});
    for (const i of images) {
        fs.writeFileSync(path.join(out, `${i.stem}.prototype.lump`), i.bytes);
        fs.writeFileSync(path.join(out, `${i.stem}.cloomc`), i.source);
        fs.writeFileSync(path.join(out, `${i.stem}.prototype.api.json`), JSON.stringify(i.api, null, 2));
    }
    fs.writeFileSync(path.join(out, 'review.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('Built real Mint, PkVerify and Cleaner review images; unlinked, uninstalled, original ABI.');
}
module.exports = {buildPrototypeReview};
