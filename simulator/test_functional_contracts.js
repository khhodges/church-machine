'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Compiler = require('./cloomc_compiler');
const builder = require('./lump_builder');
const frame = require('./lump-content-frame');
const codec = require('./lump-api-codec');
const contract = require('./lump-api-contract');
const publicApi = require('./lump-public-api');
const author = require('../scripts/create_mint_contract_draft');
function compile(source) {
    const result = new Compiler().compile(source, []);
    assert.deepEqual(result.errors, []);
    const image = builder.buildLump(result);
    const api = builder.buildApiDefinition(result, image.words);
    return {result, image, api};
}
(async () => {
    const annotated = compile(author.source());
    const original = compile(fs.readFileSync('simulator/drafts/mint_v4_integrated.cloomc','utf8'));
    assert.deepEqual(annotated.image.words, original.image.words, 'annotations never generate instructions or change the ABI');
    assert.deepEqual(annotated.api.contracts, author.contracts);
    for (const tier of [0,1,2]) {
        const words = builder.embedSelfDefinition(annotated.image.words, annotated.api, author.source(), tier);
        const inspected = await frame.lumpInspectContentFrame(words);
        assert.equal(inspected.contentFrameValid, true, inspected.error);
        assert.deepEqual(inspected.canonicalApiDefinition.contracts, author.contracts);
        assert.deepEqual(inspected.apiDefinition.contracts, author.contracts);
        assert.deepEqual(codec.expand(inspected.canonicalApiDefinition, words).contracts, author.contracts);
    }
    const body = fs.readFileSync('simulator/drafts/mint_v4_integrated.cloomc','utf8');
    for (const mutate of [
        c => {delete c.DESTROY;},
        c => {c.Missing = c.CREATE;},
        c => {delete c.CREATE.inputs.allocation;},
        c => {c.CREATE.inputs.typo = c.CREATE.inputs.allocation;},
        c => {delete c.CREATE.failures;},
        c => {c.CREATE.purpose = '';},
        c => {c.CREATE.outputs = 'invented field';},
        c => {c.CREATE.inputs.allocation.allowed = 3;},
    ]) {
        const docs = structuredClone(author.contracts); mutate(docs);
        assert(new Compiler().compile(author.annotations(docs) + body, []).errors.length, 'reject incomplete/unknown contracts');
        assert.throws(() => contract.validate({...annotated.api, contracts:docs},
            {cw:annotated.image.cw, cc:8}));
    }
    for (const prefix of [
        '; @contract CREATE\n; {"purpose":"one","purpose":"two"}\n; @endcontract\n',
        '; @contract CREATE\n; {\n',
        '; @endcontract\n',
        author.annotations() + author.annotations(),
    ]) assert(new Compiler().compile(prefix + body, []).errors.length);
    const html = publicApi.render(annotated.api);
    assert(html.includes('wordCount OR 4'));
    assert(html.includes('Phase 1 ignores'));
    const unsafe = structuredClone(annotated.api);
    unsafe.contracts.CREATE.purpose = '<img src=x onerror=alert(1)>';
    assert(!publicApi.render(unsafe).includes('<img'));
    assert(publicApi.render(original.api).includes('No functional contract'));
    assert.deepEqual(publicApi.project(codec.expand(annotated.api, annotated.image.words)).contracts, author.contracts);
    const legacy = compile('; @contract Run\n; ' + JSON.stringify({
        purpose:'Return a number.', inputs:{}, result:'DR1=7.', effects:'None.',
        failures:'Machine faults remain possible.', authorization:'Requires E capability.', example:'CALL method Run.'
    }) + '\n; @endcontract\nabstraction test.Contract {\ncapabilities { SELF E }\nmethod Run() {\nIADD DR1, DR0, #7\nRETURN\n}\n}');
    assert(codec.encode(legacy.api,{cw:legacy.image.cw,cc:1}).contracts.Run);
    console.log('PASS functional contracts: compile, unchanged code, all output profiles, negative validation, duplicate keys, safe display, legacy compatibility');
})().catch(error => { console.error(error); process.exitCode = 1; });
