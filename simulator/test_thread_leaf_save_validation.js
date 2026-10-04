'use strict';
// Execute the browser's actual pre-save and final-plan gates against private
// server fixtures. No installed Namespace targets or browser-only exceptions.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const Tokens = require('./capability_tokens.js');
const Frame = require('./lump-content-frame.js');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const sim = {
    parseLumpHeader(word) {
        return {valid: true, cc: word & 255, lumpSize: 2 ** (((word >>> 23) & 15) + 6)};
    },
    abstractionRegistry: {abstractions: {}},
};
const source = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
const context = vm.createContext({
    CapabilityTokens: Tokens, sim, _caps: input.capabilities,
    _svBinary: input.words.slice(), _lumpsCache: [],
    lumpDecodeContentFrameApi: Frame.lumpDecodeContentFrameApi,
});
const preStart = source.indexOf('        var _preSaveHdr =');
const preEnd = source.indexOf('        if (!_preSaveValidation.ok)', preStart);
assert(preStart > 0 && preEnd > preStart);
const finalStart = source.indexOf('function _validateFinalLumpSaveBinary(');
vm.runInContext(source.slice(finalStart, source.indexOf('\nasync function confirmSaveToNamespace', finalStart)), context);
function check(words) {
    context._svBinary = words;
    vm.runInContext(source.slice(preStart, preEnd), context);
    assert(context._preSaveValidation.ok, context._preSaveValidation.errors.join('; '));
    assert(context._validateFinalLumpSaveBinary(words, input.capabilities, {}));
}
check(input.words); // compiler zero rows or authoritative final plan
if (!input.finalPlan) {
    const formatted = input.words.slice();
    const header = sim.parseLumpHeader(formatted[0]);
    const materialized = Tokens.materialize(input.capabilities, formatted,
        header.lumpSize - header.cc, {sim, ideHierarchy: input.config});
    assert(materialized.ok, materialized.errors.join('; '));
    check(formatted); // Format's pending rows → Proceed/Save
    const badCaps = input.capabilities.map(c => ({...c}));
    badCaps[1].canonical_leaf = 'global.attacker.Thread1';
    assert(!Tokens.validateClist(formatted, header.lumpSize - header.cc,
        Tokens.resolveCapabilities(badCaps, {sim}), {
            sim, allowCompilerSelfPlaceholder: true,
            embeddedApi: Frame.lumpDecodeContentFrameApi(formatted),
        }).ok, 'a canonical identity mismatch must not be admitted');
}
assert.deepStrictEqual(sim.abstractionRegistry.abstractions, {});