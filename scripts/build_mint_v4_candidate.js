'use strict';
// Source-level ABI adaptation, never instruction-word translation.
const fs = require('node:fs');
const crypto = require('node:crypto');
const {method} = require('./create_mint_v4_draft');
const Compiler = require('../simulator/cloomc_compiler');
const builder = require('../simulator/lump_builder');
function replace(text, from, to) {
    if (!text.includes(from)) throw Error('Mint source changed at: ' + from);
    return text.replace(from, to);
}
function build() {
    const original = fs.readFileSync('simulator/cloomc/mint.cloomc','utf8');
    const scaffold = fs.readFileSync('tests/fixtures/mint_stub.cloomc','utf8');
    let create = method(original,'CREATE','DESTROY');
    let destroy = method(original,'DESTROY','MakeOutform');
    create = replace(create, 'method CREATE {', 'method CREATE(allocation: U32, permissions: U32) -> Inform[RW] {');
    create = replace(create, '    LOAD CR1, NULL\ncreate_data_inputs_after_clear:', '    ; CR1 holds the PassKey until PkVerify returns.\ncreate_data_inputs_after_clear:');
    create = replace(create, '    TPERM CR2, NULL\n    BRANCHEQ TODO_CREATE_INPUT_CREDENTIAL_NULL', '    ; No precheck: proof is checked by PkVerify using native EXACT.');
    create = replace(create, '    TPERM CR4, NULL\n    BRANCHNE TODO_CREATE_INPUT_DATA_SOURCE_NOT_NULL', '    ; Unused inputs are ignored.');
    const oldVerify = '    LOAD CR1, CR6, #4\n    CALL CR1, #0\n    MCMP DR1, #1';
    const newVerify = '    LOAD CR4, CR6, #4\n    CALL CR4, #0\n    MCMP DR1, #0';
    create = replace(create, oldVerify, newVerify);
    create = replace(create, '    RETURNAL #2', '    IADD DR1, DR0, #0\n    RETURNAL #2');
    destroy = replace(destroy, 'method DESTROY {', 'method DESTROY(target: Inform[RW]) -> Void {');
    destroy = replace(destroy, '    LOAD CR1, NULL\ndestroy_inputs_after_clear:', '    ; CR1 proof and CR2 target remain intact until verification.\ndestroy_inputs_after_clear:');
    destroy = replace(destroy, '    TPERM CR2, NULL\n    BRANCHEQ TODO_DESTROY_INPUT_CREDENTIAL_NULL', '    ; Native EXACT in PkVerify enforces proof authority.');
    destroy = replace(destroy, oldVerify, newVerify);
    destroy = replace(destroy, `    TPERM CR7, NULL
    BRANCHEQ TODO_DESTROY_INPUT_TARGET_NULL
    TPERM CR4, NULL
    BRANCHNE TODO_DESTROY_INPUT_CR4_NOT_NULL
    TPERM CR8, NULL
    BRANCHNE TODO_DESTROY_INPUT_CR8_NOT_NULL`, `    ; Derive the slot by exact comparison against live Namespace identities.
    ; Scan only the authorized Namespace view; exhaustion faults on its bounds.
    ; Scratch is the same private word used by the existing target validator.
    LOAD CR8, CR6, #1
    DREAD DR3, CR8, #0, DR0
    BFEXT DR3, DR3, #23, #4
    IADD DR4, DR0, #64
destroy_scan_size:
    MCMP DR3, #0
    BRANCHEQ destroy_scan_start
    SHL DR4, DR4, #1
    ISUB DR3, DR3, #1
    BRANCH destroy_scan_size
destroy_scan_start:
    ISUB DR4, DR4, #1
    LOAD CR10, CR6, #5
    LOAD CR9, CR6, #2
    IADD DR7, DR0, #2
destroy_scan:
    SHL DR13, DR7, #2
    DREAD DR11, CR10, #3, DR13
    ; Empty descriptors are not candidates; no GT has been loaded yet.
    MCMP DR11, #0
    BRANCHEQ destroy_scan_next
    ; Only stored DATA RW issuance identities are candidates for this method.
    BFEXT DR3, DR11, #25, #7
    MCMP DR3, #89
    BRANCHNE destroy_scan_next
    BFINS DR11, DR0, #31, #1
    DWRITE DR11, CR8, #0, DR4
    LOAD CR11, CR9, #0
    DWRITE DR0, CR8, #0, DR4
    TPERM CR2, EXACT, CR11
    BRANCHEQ destroy_scan_found
destroy_scan_next:
    IADD DR7, DR7, #1
    BRANCH destroy_scan
destroy_scan_found:
    IADD DR2, DR7, #0`);
    destroy = replace(destroy, '    TPERM CR7, EXACT, CR11', '    TPERM CR2, EXACT, CR11');
    destroy = replace(destroy, '    RETURNAL #0', '    IADD DR1, DR0, #0\n    RETURNAL #0');
    // Strip stale ABI prose inherited from the old source; native bodies and
    // hard-fault reasons remain. New public conventions are stated once.
    const stripComments = text => text.split('\n').filter(line => !line.trim().startsWith(';')).join('\n');
    const phase2Source = `; Mint v4 candidate — uninstalled, not hardware-qualified.
; CR1 PassKey; CREATE DR2 allocation/DR3 permissions; DESTROY CR2 target.
; DR1=0 success; CR1 result or NULL. Conversion stubs return DR1=5.
; Paired Cleaner-managed lifecycle, inherited from the newer Mint implementation.
; Execution acceptance is pending: compile/save tests are not runtime qualification.
; Requires the companion v4 PkVerify candidate, never the older verifier.
abstraction ide.Mint {
passkey required;
capabilities { SELF E, ide.MintState RW, ide.MintScratch L, ide.MintPool RW, ide.MintV4Verifier E, ide.MintNamespace RW, ide.MintCleaner E, ide.MintApproval LS }
${stripComments(create)}
${stripComments(destroy)}
${method(scaffold,'MakeOutform','MakeInform')}
${method(scaffold,'MakeInform')}
}
`;
    let source = phase2Source;
    for (const operation of ['CREATE', 'DESTROY']) {
        source = replace(source,
            `    LOAD CR3, CR6, #7\n${newVerify}\n    BRANCHNE TODO_${operation}_PKVERIFY_NOT_APPROVED`,
            '    ; Phase 1: PassKey input is ignored until the Phase 2 bitstream.\n    LOAD CR1, NULL');
    }
    source = source.replace(
        '; Requires the companion v4 PkVerify candidate, never the older verifier.',
        '; PHASE 1: PassKey ABI retained; verification deferred to the Phase 2 bitstream.\n; No proof/reference loads or verifier calls. Imported verifier/reference rows are unused.');
    source = source.replace(
        '; Execution acceptance is pending: compile/save tests are not runtime qualification.',
        '; Isolated software validation only; no live installation or physical qualification.');
    const verifier = `; Internal Mint verifier: CR1 proof, CR3 trusted reference supplied by Mint.
; Native EXACT enforces authority. DR1=0 match, DR1=1 mismatch.
; CR2 is preserved for Mint DESTROY; no proof is returned as a result.
abstraction ide.MintV4Verifier {
capabilities { SELF E }
method Verify {
    IADD DR1, DR0, #1
    TPERM CR1, EXACT, CR3
    BRANCHNE verify_return
    IADD DR1, DR0, #0
verify_return:
    LOAD CR1, NULL
    RETURNAL #4
}
}
`;
    const compiled = new Compiler().compile(source, []);
    if (compiled.errors.length) throw Error(JSON.stringify(compiled.errors));
    const packed = builder.buildLump(compiled);
    const api = builder.buildApiDefinition(compiled, packed.words);
    const words = builder.embedSelfDefinition(packed.words, api, source, 2);
    return {source, phase2Source, verifier, compiled, api, words};
}
if (require.main === module) {
    const candidate = build();
    const dest = 'simulator/drafts/mint_v4_integrated.cloomc';
    const old = fs.readFileSync(dest);
    const recorded = JSON.parse(fs.readFileSync('simulator/drafts/mint_v4_provenance.json'));
    if (crypto.createHash('sha256').update(old).digest('hex') !== recorded.draftSourceSha256)
        throw Error('Draft has changed since generation; refusing to replace edits.');
    const verifierPath = 'simulator/drafts/pkverify_v4.cloomc';
    if (fs.existsSync(verifierPath) &&
            crypto.createHash('sha256').update(fs.readFileSync(verifierPath)).digest('hex') !== recorded.verifierSourceSha256)
        throw Error('Verifier draft has changed; refusing to replace edits.');
    const phase2Path = 'simulator/drafts/mint_v4_phase2.cloomc';
    if (!fs.existsSync(phase2Path))
        fs.writeFileSync(phase2Path, candidate.phase2Source, {flag:'wx'});
    fs.writeFileSync(dest, candidate.source);
    fs.writeFileSync(verifierPath, candidate.verifier);
    recorded.previousDraftSourceSha256 = recorded.draftSourceSha256;
    recorded.draftSourceSha256 = crypto.createHash('sha256').update(candidate.source).digest('hex');
    recorded.status = 'Phase 1 candidate: PassKey ABI retained; verification deferred to Phase 2 bitstream';
    recorded.verifierSourceSha256 = crypto.createHash('sha256').update(candidate.verifier).digest('hex');
    fs.writeFileSync('simulator/drafts/mint_v4_provenance.json', JSON.stringify(recorded, null, 2) + '\n');
    console.log('Generated uninstalled ABI candidate and companion verifier; no live LUMPs changed.');
}
module.exports = {build};
