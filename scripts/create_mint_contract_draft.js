'use strict';
// Explicit author-written documentation, not inference from executable code.
const fs = require('node:fs');
const contracts = {
    CREATE: {
        purpose: 'Create zero-initialized read/write DATA storage and return the capability needed to use it.',
        inputs: {
            allocation: {
                meaning: 'Requested storage size with the DATA allocation tag.',
                unit: '32-bit words (one word is four bytes).',
                allowed: 'A power-of-two word count of at least 8, subject to the configured pool, descriptor limits, and available Namespace slots. A valid size does not guarantee capacity.',
                encoding: 'Low-level encoding is wordCount OR 4. For 8 words, supply 12. Bits 0–2 must encode 4; the remaining bits hold the word count.'
            },
            permissions: {
                meaning: 'Access rights requested for the returned data capability.',
                unit: 'Permission mask.',
                allowed: 'Only 3 (read and write) is supported in Phase 1.',
                encoding: 'Supply integer 3. Other masks are not supported.'
            }
        },
        result: 'On normal success DR1 is 0 and CR1 holds an Inform RW capability for the requested zero-initialized storage. Use that capability for reads/writes; release it with DESTROY.',
        effects: 'Reserves storage and a Namespace slot, records ownership, and clears storage before returning it. Capacity is shared with other allocations.',
        failures: 'Invalid inputs, exhausted capacity, invalid allocator state, or machine authority failures raise faults; they are not ordinary successful returns. Do not assume a fault rolled back partial allocator state.',
        authorization: 'A callable Mint capability and valid service bindings are required. The ABI includes a PassKey in CR1, but Phase 1 ignores it until the Phase 2 bitstream. NULL CR1 is usable for Phase 1; no PassKey authentication is claimed.',
        example: 'To request 8 words (32 bytes), pass allocation=12 and permissions=3. On DR1=0 retain the returned CR1 capability. This example explains the existing encoding; the compiler does not insert packing code.'
    },
    DESTROY: {
        purpose: 'Release an allocation previously created by this Mint, invalidating its current Namespace identity and making storage eligible for reuse.',
        inputs: {
            target: {
                meaning: 'The current Inform RW capability for the allocation to release.',
                unit: 'Capability, not an integer slot or address.',
                allowed: 'A current live DATA RW allocation owned by this Mint. Stale, unrelated, or already released targets are not valid requests.',
                encoding: 'Pass the target in CR2. No caller-supplied Namespace slot is required; Mint derives it from the target identity.'
            }
        },
        result: 'On normal success DR1 is 0 and CR1 is NULL. No capability result is returned.',
        effects: 'Invalidates the Namespace binding, advances retained slot history, and releases the owned storage. Copies of old GT words are not erased, but must no longer authorize access. Storage is cleared before reuse, not synchronously on release.',
        failures: 'Invalid/stale targets, ownership mismatches, inconsistent state, or machine authority failures fault. Do not assume a fault rolled back partial state.',
        authorization: 'Requires a callable Mint capability and the target allocation capability. The CR1 PassKey input is ignored in Phase 1; verification is deferred to the Phase 2 bitstream.',
        example: 'Retain the capability returned by CREATE, pass it as target in CR2, and invoke DESTROY. On DR1=0 discard your copy; do not use it to access subsequently reused storage.'
    },
    MakeOutform: {
        purpose: 'Reserved interface for conversion to Outform. Not implemented in Phase 1.',
        inputs: {target: {meaning:'Object proposed for conversion.', unit:'Capability.', allowed:'The interface declares Inform RW; the Phase 1 stub ignores the input.', encoding:'CR2.'}},
        result: 'Always returns DR1=5 (UNSUPPORTED_OPERATION) and NULL CR1. No Outform is created.',
        effects: 'No conversion or allocation is performed.',
        failures: 'Status 5 is a normal unsupported return, not successful conversion. Machine faults may still occur before the method is entered.',
        authorization: 'Requires authority to call Mint. The ABI PassKey input in CR1 is ignored; no authentication is performed by this Phase 1 stub.',
        example: 'Invoke only if prepared to handle DR1=5; ignore any result when status is nonzero.'
    },
    MakeInform: {
        purpose: 'Reserved interface for conversion to Inform. Not implemented in Phase 1.',
        inputs: {target: {meaning:'Object proposed for conversion.', unit:'Capability.', allowed:'The interface declares Outform RW; the Phase 1 stub ignores the input.', encoding:'CR2.'}},
        result: 'Always returns DR1=5 (UNSUPPORTED_OPERATION) and NULL CR1. No Inform is created.',
        effects: 'No conversion or allocation is performed.',
        failures: 'Status 5 is a normal unsupported return, not successful conversion. Machine faults may still occur before the method is entered.',
        authorization: 'Requires authority to call Mint. The ABI PassKey input in CR1 is ignored; no authentication is performed by this Phase 1 stub.',
        example: 'Handle DR1=5 as unavailable functionality, not as a completed conversion.'
    }
};
function annotations(value = contracts) {
    return Object.entries(value).map(([method, contract]) =>
        `; @contract ${method}\n` +
        JSON.stringify(contract, null, 2).split('\n').map(line => '; ' + line).join('\n') +
        '\n; @endcontract\n').join('\n');
}
function source() {
    const original = fs.readFileSync('simulator/drafts/mint_v4_integrated.cloomc', 'utf8');
    if (!original.includes('; PHASE 1: PassKey ABI retained;'))
        throw Error('Expected the reviewed Phase 1 Mint candidate; refusing to document another implementation.');
    return annotations() + '\n' + original;
}
if (require.main === module) {
    fs.writeFileSync('simulator/drafts/mint_v4_functional_contracts.cloomc', source(), {flag:'wx'});
    console.log('Created separate functional-contract draft; no existing draft or LUMP changed.');
}
module.exports = {contracts, annotations, source};
