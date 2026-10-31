'use strict';
// Assemble source for review only. Never compile, publish, bind or install it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const baseIdentity = {
    token:'1cc875e0', filename:'ide.Mint.1.3229a560.lump',
    binary_hash:'cbae60a878fed9c540942ebdc32c3446be7fee04ed985a0f1528fa068e8039a5'
};
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function method(source, name, next) {
    const start = source.indexOf(`method ${name}`);
    const end = next ? source.indexOf(`method ${next}`, start) : source.lastIndexOf('}');
    assert(start >= 0 && end > start, `Missing method ${name}`);
    return source.slice(start, end).trim();
}
function buildDraft(saved, newer, scaffold) {
    assert.equal(saved.filename, baseIdentity.filename);
    assert.equal(saved.binary_hash, baseIdentity.binary_hash);
    assert(saved.editing_source && saved.editing_source_provenance === 'exact-revision full-source sibling');
    const create = method(saved.editing_source, 'CREATE', 'DESTROY');
    const destroy = method(newer, 'DESTROY', 'MakeOutform');
    const outform = method(scaffold, 'MakeOutform', 'MakeInform');
    const inform = method(scaffold, 'MakeInform');
    const source = `; MINT v4 INTEGRATED REVIEW DRAFT — NOT A SAVED REVISION.
; Identity remains ide.Mint. No installation or hardware approval is implied.
; TARGET ABI: CR1 PassKey, CR2 target, DR2/DR3 scalars, DR1=0 success.
; IMPORTANT: retained CREATE/DESTROY bodies below are NOT YET PORTED.
; Their old registers/status and allocator contracts are annotated below.
; Typed imports are intentionally rejected by the current compiler.
; Do not remove that rejection or use legacy signatures to run this draft.
; Source provenance and outstanding integration work: docs/phase-1/mint-v4-draft.md

abstraction ide.Mint {
passkey required;
capabilities { SELF E, ide.MintState RW, ide.MintScratch L, ide.MintPool RW, ide.PkVerify E, ide.MintNamespace RW, ide.MintCleaner E, ide.MintApproval SL }

; FROM EXACT SAVED v3: CREATE body, unchanged.
; PORT REQUIRED: preserve CR1 proof before result clearing; use trusted
; PkVerify reference; remove unused-input checks; return DR1=0 on completion.
; ALLOCATOR REQUIRED: reconcile v3 pool allocation with the Cleaner ownership
; expected by the retained newer DESTROY. No lifecycle acceptance is claimed.
${create.replace('method CREATE {', 'method CREATE(allocation: U32, permissions: U32) -> Inform[RW] {')}

; FROM NEWER EDITABLE SOURCE: DESTROY implementation, unchanged.
; PORT REQUIRED: accept target CR2, derive slot from verified target identity,
; preserve proof through verification, and translate completion to DR1=0.
; Current body still uses CR2 proof, CR7 target and caller-provided DR2 slot.
${destroy.replace('method DESTROY {', 'method DESTROY(target: Inform[RW]) -> Void {')}

; PROPOSED CONVERSION STUBS: status 5 and NULL CR1; no authorization or
; conversion is performed. These do not replace CREATE or DESTROY.
${outform}

${inform}
}
`;
    return {source, provenance:{
        base:baseIdentity,
        baseSourceSha256:hash(saved.editing_source),
        newerSourceSha256:hash(newer),
        stubSourceSha256:hash(scaffold),
        draftSourceSha256:hash(source),
        status:'source-review-only; ABI/body and allocator integration incomplete',
        savedRevision:false, installed:false
    }};
}
async function main() {
    const output = path.join(root, 'simulator/drafts/mint_v4_integrated.cloomc');
    if (fs.existsSync(output)) throw Error('Draft already exists; refusing to overwrite edits.');
    const base = process.env.REPLIT_DEV_DOMAIN;
    if (!base) throw Error('Development domain required for exact saved-source retrieval.');
    const response = await fetch(`https://${base}/api/lump/${baseIdentity.token}/words?exact_filename=${baseIdentity.filename}&binary_hash=${baseIdentity.binary_hash}`);
    if (!response.ok) throw Error(`Exact v3 retrieval failed: HTTP ${response.status}`);
    const saved = await response.json();
    const result = buildDraft(saved,
        fs.readFileSync(path.join(root, 'simulator/cloomc/mint.cloomc'), 'utf8'),
        fs.readFileSync(path.join(root, 'tests/fixtures/mint_stub.cloomc'), 'utf8'));
    fs.mkdirSync(path.dirname(output), {recursive:true});
    fs.writeFileSync(output, result.source, {flag:'wx'});
    fs.writeFileSync(path.join(root, 'simulator/drafts/mint_v4_provenance.json'),
        JSON.stringify(result.provenance, null, 2) + '\n', {flag:'wx'});
    console.log('Created separate Mint v4 review draft. No artifact publication or installation.');
}
if (require.main === module) main().catch(error => {console.error(error.message); process.exitCode=1;});
module.exports = {buildDraft, method};
