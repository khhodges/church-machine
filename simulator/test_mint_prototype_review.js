'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {buildPrototypeReview} = require('../scripts/build_mint_prototype_review');
const {images, report} = buildPrototypeReview();
assert.deepEqual(images.map(i => i.result.abstractionName), ['ide.Mint','ide.PkVerify','ide.MintCleaner']);
for (const image of images) {
    const frame = image.cw + 1;
    assert.equal(image.words[frame] >>> 16, 0xAB03);
    const length = image.words[frame] & 65535;
    const embeddedApi = JSON.parse(image.bytes.subarray((frame + 1) * 4,
        (frame + 1) * 4 + length));
    assert.deepEqual(embeddedApi, image.api);
    const sourceWord = frame + 1 + Math.ceil(length / 4);
    assert.equal(image.bytes.subarray((sourceWord + 1) * 4,
        (sourceWord + 1) * 4 + image.words[sourceWord]).toString('utf8'), image.source);
    assert.equal(fs.readFileSync(image.sourcePath, 'utf8'), image.source);
}
assert.match(images[0].source, /create_v1_allocate:/);
assert.match(images[0].source, /CALL CR1, #0/);
assert.match(images[1].source, /TPERM CR2, EXACT, CR3/);
assert.equal(report.newAbi, false);
assert.equal(report.installed, false);
console.log('PASS real Mint prototype package: exact source, embedded APIs, PkVerify and Cleaner dependencies; no publication');
