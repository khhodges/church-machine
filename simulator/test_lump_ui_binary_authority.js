'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Frame = require('./lump-content-frame.js');

const app = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
const audit = fs.readFileSync(path.join(__dirname, 'lump-audit.js'), 'utf8');

(async () => {
    const built = await Frame.lumpBuildContentFrame(
        { methods: [{ name: 'ExactMethod', offset: 0 }], capabilities: [] },
        '', { profile: 'api' });
    const words = new Array(64).fill(0);
    const cw = 2;
    const cc = 3;
    words[0] = (((0x1F << 27) >>> 0) | (cw << 10) | cc) >>> 0;
    words.splice(1 + cw, built.frameWords.length, ...built.frameWords);

    // Deliberately contradictory catalog data must have no input channel into
    // immutable content-frame inspection.
    const poisonedCatalog = {
        cw: 999, cc: 77, lump_size: 4096, profile: 'full',
        source: 'mallory', api_definition: { methods: [{ name: 'Mallory' }] },
        capabilities: [{ name: 'MalloryCap' }], pet_names: { CR: { 1: 'Mallory' } },
        binary_hash: 'f'.repeat(64),
    };
    assert(poisonedCatalog.cw !== cw); // fixture is genuinely contradictory
    const exact = await Frame.lumpInspectContentFrame(words);
    assert.equal(exact.headerValid, true);
    assert.deepEqual(exact.header, { cw: 2, cc: 3, lumpSize: 64 });
    assert.equal(exact.profile, 'api');
    assert.equal(exact.apiDefinition.methods[0].name, 'ExactMethod');
    assert.equal(exact.source, null);

    const malformed = words.slice();
    malformed[0] = 0;
    const rejected = await Frame.lumpInspectContentFrame(malformed);
    assert.equal(rejected.headerValid, false);
    assert.equal(rejected.contentFrameValid, false);
    assert(rejected.error);

    assert(!app.includes('parseInt(lump.cw)'));
    assert(!app.includes('parseInt(lump.cc)'));
    assert(!app.includes('parseInt(lump.lump_size)'));
    assert(!app.includes('const _autoManifest'));
    assert(!app.includes('const _manifest = _auditLump'));
    assert(app.includes("lumpAuditFromServer(token, null"));
    assert(app.includes('Shrink unavailable'));
    assert(app.includes('const inspection = await inspect(words);'));
    assert(app.includes('Exact LUMP bytes are malformed; content unavailable.'));
    assert(audit.includes('const results = lumpAudit(words, null, null);'));
    assert(!audit.includes('/detail'));

    console.log('LUMP UI immutable-binary authority tests passed');
})().catch(err => {
    console.error(err);
    process.exit(1);
});