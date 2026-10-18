'use strict';
// Offline trusted initializer. Never imported by an IDE loader or given a
// running core. All derivatives are formed before the sealed runtime exists.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const Simulator = require('../../simulator/simulator');
const Thread = require('../../simulator/thread_design');
const {embedSelfDefinition} = require('../../simulator/lump_builder');
const {programs, digest} = require('../../simulator/mint/protected-programs');
const Assembler = require('../../simulator/assembler');
const {fixture} = require('./protected_fixture');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const words = bytes => Array.from({length: bytes.length / 4}, (_, i) => bytes.readUInt32BE(i * 4));
const bytes = words => { const b = Buffer.alloc(words.length * 4);
    words.forEach((w, i) => b.writeUInt32BE(w >>> 0, i * 4)); return b; };
function apiOf(w) {
    const pos = 1 + ((w[0] >>> 10) & 8191), frame = w[pos], size = frame & 65535;
    assert.equal(frame >>> 24, 0xab);
    return JSON.parse(bytes(w.slice(pos + 1, pos + 1 + Math.ceil(size / 4))).subarray(0, size));
}
function service(s, name, program, caps) {
    let n = 64;
    while (n < 1 + program.words.length + caps.length) n *= 2;
    const raw = Array(n).fill(0);
    raw[0] = s.packLumpHeader(Math.log2(n) - 6, program.words.length, caps.length, 0);
    raw.splice(1, program.words.length, ...program.words);
    raw.splice(n - caps.length, caps.length, ...caps);
    // Complete, explicit simulator-profile API, not an ordinary compiler seal.
    const names = {4: 'ide.BTN_DEV', 5: 'ide.TIMER_DEV', 9: 'ide.Mint',
        12: 'ide.Thread3', 14: 'ide.Nstab', 15: 'ide.PkVerify',
        16: 'ide.Alice', 17: 'ide.Mallory', 18: 'ide.ResultList',
        19: 'ide.ResultWord', 20: 'ide.Registry', 21: 'ide.ProofSnapshot',
        22: 'ide.FrozenRequest', 23: 'ide.RequesterContext', 24: 'ide.Proof',
        25: 'ide.Request', 26: 'ide.Payload'};
    const imports = {}, seen = new Map();
    caps.slice(1).forEach((gt, i) => {
        const parsed = s.parseGT(gt), target = parsed.type === 3 ? 'ide.Credential' : names[parsed.index];
        assert(target);
        const rights = [...'RWXLSE'].filter(r => parsed.permissions[r]).join('');
        imports[rights] ||= {};
        imports[rights][i + 1] = seen.get(target) || target;
        if (!seen.has(target)) seen.set(target, i + 1);
    });
    const methods = Object.fromEntries((name === 'ide.Mint'
        ? ['Create', 'Replace', 'Destroy', 'Forge', 'Revoke'] :
        name === 'ide.Alice' ? ['Stash', 'Reveal'] :
        name === 'ide.Mallory' ? ['Steal'] : ['Run'])
        .map((method, selector) => [method, {selector}]));
    const api = {name, methods, imports};
    require('../../simulator/lump-api-contract').validate(api,
        {cw: program.words.length, cc: caps.length});
    return {runtime: embedSelfDefinition(raw, api, '', 0),
        editing: embedSelfDefinition(raw, api, program.source, 2), source: program.source};
}
const aliceExercise = `
exercise:
IADD DR1, DR0, #42
LOAD CR0, CR6, #0
CALL CR0, #0
LOAD CR0, CR6, #0
CALL CR0, #1
IADD DR2, DR0, #42
MCMP DR1, DR2
BRANCHNE failed
LOAD CR3, CR6, #2
DREAD DR2, CR3, #0
LOAD CR4, CR6, #3
IADD DR2, DR0, #73
DWRITE DR2, CR4, #3
DREAD DR3, CR4, #3
MCMP DR2, DR3
BRANCHNE failed
LOAD CR2, CR6, #4
CHANGE CR2
HALT
thread3:
LOAD CR0, CR6, #0
CALL CR0, #1
IADD DR2, DR0, #42
MCMP DR1, DR2
BRANCHNE failed
HALT
attack:
LOAD CR0, CR6, #5
CALL CR0, #0
failed:
LOAD CR0, CR6, #31
`;
function actor(name, suffix = '') {
    const source = fs.readFileSync(path.join(__dirname, `../../simulator/examples/${name}.cloomc`), 'utf8') +
        '\n' + suffix;
    const assembler = new Assembler(), result = assembler.assemble(source);
    assert.deepEqual(assembler.errors, []);
    return {source, words: Array.from(result.words), labels: {...assembler.labels}};
}

function qualifiedFixture(directory, scenario = 'mint') {
    assert(['mint', 'workload', 'actors', 'alice-denied', 'mallory-denied'].includes(scenario));
    const reportRaw = fs.readFileSync(path.join(directory, 'report.json'));
    const report = JSON.parse(reportRaw);
    assert.equal(report.status, 'bounded-replay');
    assert.equal(report.sourceMode, 'explicit-runtime-corrections');
    assert.equal(report.protectedFilesUnchanged, true);
    const targetRaw = fs.readFileSync(path.join(__dirname, '../fixtures/phase1_namespace_target.json'));
    assert.equal(sha(targetRaw), report.profileSha256);
    const target = JSON.parse(targetRaw);
    const s = new Simulator(), p = fixture(), original = p.memory;
    const gt = (slot, rights = {}) => s.createGT(slot === 8 ? 1 : 0, slot, rights, 1) >>> 0;
    const code = programs(), bodies = new Map(), artifacts = [], bindings = [], artifactFiles = {};
    function retain(slot, runtime, editing, source) {
        artifactFiles[`slot-${slot}.api.lump`] = bytes(runtime);
        artifactFiles[`slot-${slot}.source.lump`] = bytes(editing);
        artifactFiles[`slot-${slot}.cloomc`] = Buffer.from(source);
    }
    for (const slot of [6, 7, 10]) {
        const e = report.entries.find(e => e.slot === slot);
        assert.deepEqual(e.selection, target.rows.find(r => r.slot === slot).selection);
        const selected = fs.readFileSync(path.join(__dirname, '../../server/lumps', e.selection.filename));
        assert.equal(sha(selected), e.selection.binaryHash);
        const candidate = fs.readFileSync(path.join(directory, path.basename(e.candidateFilename)));
        const linked = fs.readFileSync(path.join(directory, `slot-${slot}.localized.lump`));
        assert.equal(sha(candidate), e.candidateSha256);
        assert.equal(sha(linked), e.localizedSha256);
        assert.equal(e.binding.status, 'bound');
        const source = fs.readFileSync(path.join(directory, `slot-${slot}.candidate.source`), 'utf8');
        assert.equal(sha(source), e.candidateSourceSha256);
        const full = words(linked), api = apiOf(full);
        const runtime = embedSelfDefinition(full, api, '', 0);
        const cw = (full[0] >>> 10) & 8191, cc = full[0] & 255;
        assert.deepEqual(runtime.slice(1, cw + 1), full.slice(1, cw + 1));
        assert.deepEqual(runtime.slice(-cc), full.slice(-cc));
        bodies.set(slot, runtime);
        retain(slot, runtime, full, source);
        artifacts.push({slot, name: e.canonicalName, selectedSha256: e.selection.binaryHash,
            candidateSha256: e.candidateSha256, localizedSha256: e.localizedSha256,
            sourceSha256: e.candidateSourceSha256, runtimeSha256: digest(runtime),
            runtimeWords: runtime.length, editingWords: full.length,
            editingSha256: digest(full), authority: 'qualified-candidate-linker'});
        bindings.push({slot, rows: e.binding.rows, calls: e.binding.calls || []});
    }
    for (const [name, slot, program] of [['mint', 9, code.mint], ['verifier', 15, code.verifier]]) {
        const r = p.roles[name], cc = original[r.base] & 255;
        const caps = Array.from(original.slice(r.base + r.words - cc, r.base + r.words));
        const artifact = service(s, slot === 9 ? 'ide.Mint' : 'ide.PkVerify', program, caps);
        bodies.set(slot, artifact.runtime);
        retain(slot, artifact.runtime, artifact.editing, artifact.source);
        artifacts.push({slot, sourceSha256: sha(artifact.source),
            runtimeSha256: digest(artifact.runtime), runtimeWords: artifact.runtime.length,
            editingSha256: digest(artifact.editing), editingWords: artifact.editing.length,
            authority: 'explicit-protected-profile-compiler'});
        bindings.push({slot, rows: caps.map((gt, index) => ({index, gt})), links: program.labels});
    }
    // Keep the actual Stash/Reveal and missing-capability Steal implementations.
    // Alice's extra, unexported startup exercise is explicit private test source.
    const alice = actor('alice', aliceExercise), mallory = actor('mallory');
    for (const [slot, name, program, caps] of [
        [16, 'ide.Alice', alice, [gt(16, {E: 1}), gt(16, {R: 1, W: 1}), gt(4, {R: 1}),
            gt(5, {R: 1, W: 1}), gt(12), gt(9, {E: 1})]],
        [17, 'ide.Mallory', mallory, [gt(17, {E: 1}), gt(17, {R: 1, W: 1})]],
    ]) {
        const a = service(s, name, program, caps);
        bodies.set(slot, a.runtime);
        retain(slot, a.runtime, a.editing, a.source);
        artifacts.push({slot, name, sourceSha256: sha(a.source),
            runtimeSha256: digest(a.runtime), runtimeWords: a.runtime.length,
            editingSha256: digest(a.editing), editingWords: a.editing.length,
            authority: 'explicit-isolated-actor-source'});
        bindings.push({slot, rows: caps.map((gt, index) => ({index, gt})), links: program.labels});
    }
    p.memory = new Uint32Array(original.length);
    p.memory[0] = original[0];
    p.memory[2] = 26; // 17 original + 10 private, minus self.
    let cursor = 1024;
    const descriptor = (slot, base, length, token = gt(slot)) => {
        const w1 = s.packNSWord1(length - 1, slot === 8 ? 1 : 0, 0, 0);
        p.memory.set([base, w1, s._integrity32(base, w1), token], slot * 4);
    };
    const install = (slot, body, token) => {
        const base = cursor;
        p.memory.set(body, base);
        descriptor(slot, base, body.length, token);
        cursor += body.length;
        return base;
    };
    const bootSlot = scenario === 'mint' ? 9 : scenario === 'workload' ? 10 :
        scenario === 'mallory-denied' ? 17 : 16;
    const bootPC = scenario === 'mint' ? code.mint.labels.caller :
        scenario === 'alice-denied' ? alice.labels.attack :
            scenario === 'actors' ? alice.labels.exercise : 0;
    p.threads = [];
    for (const row of target.rows) {
        const slot = row.slot;
        if (slot === 1 || slot === 14) {
            descriptor(slot, 0, 1024, slot === 14 ? p.views.nstab : gt(1));
        } else if (row.kind === 'mmio') descriptor(slot, row.address, row.limit + 1);
        else if (row.kind === 'thread') {
            const body = new Uint32Array(row.words), layout = Thread.layout(row.words, 32);
            body[0] = s.packLumpHeader(Math.log2(row.words) - 6, 32, 12, 2);
            const entry = slot === 12 && scenario === 'actors' ? 16 : slot === 2 ? bootSlot : 10;
            const pc = slot === 12 && scenario === 'actors' ? alice.labels.thread3 : slot === 2 ? bootPC : 0;
            body[layout.capsStart] = gt(entry, {E: 1});
            body[layout.stackEnd - 1] = gt(entry, {E: 1});
            body[layout.stackEnd] = s._packFrameWordRaw(0x7fff, 1, layout.stackEnd);
            body[layout.stackEnd - 3] = gt(entry, {E: 1});
            body[layout.stackEnd - 2] = s._packFrameWordRaw(pc, 1, layout.stackEnd - 2);
            body[17] = s._packProtectedIndicator(layout.stackEnd - 4, 1, {}, 0);
            const base = install(slot, body);
            p.threads.push({slot, base, words: row.words});
        } else {
            const body = bodies.get(slot), base = install(slot, body, gt(slot, {E: 1}));
            if (slot === 9 || slot === 15) {
                const r = p.roles[slot === 9 ? 'mint' : 'verifier'];
                Object.assign(r, {base, words: body.length, hash: digest(body),
                    descriptor: Array.from(p.memory.slice(slot * 4, slot * 4 + 4))});
            }
        }
    }
    const keys = {20: 'registryBase', 21: 'proofSnapshot', 22: 'frozenRequest',
        23: 'requesterContext', 27: 'payloadSnapshot'};
    for (const slot of p.privateSlots) {
        if (slot === 19) continue; // Result alias has no additional backing.
        const base = original[slot * 4], size = s.parseNSWord1(original[slot * 4 + 1]).limit + 1;
        const newBase = install(slot, original.slice(base, base + size));
        if (keys[slot]) p[keys[slot]] = newBase;
        if (slot === 18) p.resultCell = newBase + size - 1;
    }
    descriptor(19, p.resultCell, 1);
    p.allocationStart = Math.max(8192, Math.ceil(cursor / 64) * 64);
    p.evidence = {enabled: true};
    // Alice's reviewed WORD 0 is data, not a writable instruction or c-list.
    p.publicData = [{slot: 16, offset: 9, words: 1}];
    assert(p.allocationStart + 8 <= p.allocationEnd, 'Complete API profile exceeds half-memory');
    const editingDelta = artifacts.reduce((n, a) => n + a.editingWords - a.runtimeWords, 0);
    const evidence = {schema: 'protected-qualified-namespace/v1', scenario,
        profileSha256: report.profileSha256, linkerReportSha256: sha(reportRaw),
        initialImageSha256: digest(Array.from(p.memory)), artifacts, bindings,
        entries: target.rows.map(r => ({slot: r.slot, name: r.name,
            descriptor: Array.from(p.memory.slice(r.slot * 4, r.slot * 4 + 4))})),
        privateDescriptors: 10, initialDescriptors: 27,
        footprint: {tableWords: 1024, runtimeStaticWords: cursor,
            sourceBearingStaticWords: cursor + editingDelta, halfMemoryWords: 16384,
            namespaceWords: p.memory.length, allocationStart: p.allocationStart,
            allocationEnd: p.allocationEnd, runtimeFits: cursor + 8 <= 16384,
            sourceBearingFits: cursor + editingDelta + 8 <= 16384,
            aliasExtraWords: 0, privateBackingWords: 4260},
        owner: 0, recipient: 'ide.Mint', replaceTargets: [], destroyTargets: [],
        installed: false, hardwareTouched: false};
    return {plan: p, evidence, artifactFiles};
}
function pin(evidence) {
    return {profileSha256: evidence.profileSha256,
        artifactsSha256: sha(JSON.stringify(evidence.artifacts)),
        bindingsSha256: sha(JSON.stringify(evidence.bindings)),
        footprint: evidence.footprint};
}
function verifyPins(evidence) {
    const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'qualified-pins.json')));
    assert.deepEqual(pin(evidence), expected.common, 'Exact artifact/link/footprint pins changed');
    assert.equal(evidence.initialImageSha256, expected.images[evidence.scenario],
        'Exact initialized Namespace bytes changed');
}
module.exports = {qualifiedFixture, apiOf, bytes, sha, pin, verifyPins};
