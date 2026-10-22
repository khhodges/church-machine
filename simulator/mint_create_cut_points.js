'use strict';
// Diagnostic runner, deliberately non-green until the review is satisfied.
// Native instructions execute unchanged. No live data, remapping, recovery,
// persistence simulation, or hardware access. Imported fixtures also self-check.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const A = require('./assembler');
const f = require('./test_mint_create_publication');
const body = f.source.match(/^method CREATE \{([\s\S]*?)^\}/m)[1];
// Instrument labels only; prove emitted instructions are byte-for-byte equal.
let index = 0;
const sites = [];
let block = '';
const tagged = body.split('\n').map(line => {
    const label = line.match(/^(\w+):/);
    if (label) block = label[1];
    if (!/^\s+[A-Z]+\s/.test(line)) return line;
    const name = `cut_probe_${index++}`;
    sites.push({name, block, text: line.trim()});
    return `${name}:\n${line}`;
}).join('\n');
const image = new A().assemble(tagged);
assert.deepEqual(image.errors, []);
assert.deepEqual(image.words, f.compiled.methods[0].code.slice(0, image.words.length),
    'probe labels must not translate or change native instructions');
assert.equal(f.compiled.methods[0].code.length, image.words.length + 1);
assert.equal(f.compiled.methods[0].code.at(-1), 0x1f000000,
    'only compiler appended RETURN may follow source body');
for (const s of sites) s.pc = image.labels[s.name] + 4; // four method dispatch words
const find = (blockName, text) => {
    const s = sites.find(s => s.block === blockName && s.text === text);
    assert(s, `${blockName}: ${text}`);
    return s;
};
const results = [];
const restartReason = 'BLOCKED: no authorized post-issuance restart/setup path; fresh trial initialization is not retained history.';
function capture(x) {
    const s = x.sim, ns = s.NS_TABLE_BASE + f.SLOT * 4;
    const words = Array.from(s.memory.slice(ns, ns + 4));
    return {
        history: s.memory[f.STATE + f.HISTORY + f.SLOT],
        poolCursor: s.memory[f.STATE + 1], queueCursor: s.memory[f.STATE + 3],
        block: Array.from(s.memory.slice(f.POOL + 8, f.POOL + 16)),
        namespace: words, sealValid: words[2] === (s._integrity32(words[0], words[1]) >>> 0),
        scratch: s.memory[f.STATE + 127], cr1: s.cr[1].word0 >>> 0,
        completion: s.dr[1], returned: s.cr[14].word1 === x.caller.base,
    };
}
function reach(x, site, occurrence = 1, after = true) {
    let fault = null, seen = 0;
    x.sim.fault = (type, message) => { fault = {type, message}; x.sim.halted = true; };
    for (let n = 0; n < 4000 && !x.sim.halted; n++) {
        const hit = x.sim.cr[14].word1 === x.mint.base && x.sim.pc === site.pc;
        if (hit && ++seen === occurrence) {
            if (after) x.sim.step();
            return {reached: !fault, fault};
        }
        x.sim.step();
    }
    return {reached: false, fault};
}
function cut(id, blockName, text, occurrence = 1, after = true) {
    const x = f.setup();
    const site = find(blockName, text);
    const stop = reach(x, site, occurrence, after);
    const state = capture(x);
    const checks = stop.reached ? {
        reserved: state.history === 1024,
        notNeverUsed: (state.history & 512) === 0,
        notReturned: !state.returned,
        noPrematureCompletion: state.completion === 0,
        poolCursor: state.poolCursor === (id === 'A1' ? 8 : 16),
        queueCursor: state.queueCursor === (['A1', 'A2'].includes(id) ? 7 : 8),
    } : {};
    if (id.startsWith('B1') || id === 'B2') {
        checks.exactZeroPrefix = state.block.every((word, i) =>
            word === (i < occurrence ? 0 : 0xdeadbeef));
    }
    const failed = Object.entries(checks).filter(([, pass]) => !pass).map(([key]) => key);
    // The cut is a stop after a retired instruction. Do not resume it or
    // falsely implement power persistence by copying RAM into a fresh boot.
    results.push({id, cut: `${after ? 'after' : 'before'} ${site.block}: ${site.text}`,
        occurrence, status: failed.length ? 'FAIL' : 'BLOCKED', reached: stop.reached, fault: stop.fault,
        checks, state, reason: failed.length ? `Pre-restart invariant failed: ${failed.join(', ')}` : stop.reached ? restartReason :
            'Native legacy replay cannot reach this cut; ascending publication and descending LOAD consult different entries.'});
    return {x, state, stop};
}
cut('A1', 'create_data_zero_begin', 'DWRITE DR2, CR7, #0, DR13');
cut('A2', 'create_data_zero_begin', 'DWRITE DR14, CR7, #1');
cut('A3', 'create_data_zero_begin', 'DWRITE DR15, CR7, #3');
for (let i = 1; i < 8; i++) cut(`B1.${i}`, 'create_data_zero_loop', 'DWRITE DR0, CR8, #0, DR13', i);
cut('B2', 'create_data_zero_loop', 'DWRITE DR0, CR8, #0, DR13', 8);
cut('C1', 'create_data_slot_write', 'DWRITE DR8, CR10, #0, DR13');
cut('C2.W1', 'create_data_slot_write', 'DWRITE DR9, CR10, #1, DR13');
for (const [id, instruction] of [
    ['C2.W2', 'DWRITE DR10, CR10, #2, DR13'],
    ['C3', 'DWRITE DR11, CR10, #3, DR13'],
]) {
    const observation = cut(id, 'create_data_slot_write', instruction);
    assert(observation.stop.reached, `${id} cut must execute`);
    results.push({id: `${id}.seal-only-publication`, status: observation.state.sealValid ? 'FAIL' : 'PASS',
        reason: 'Seal-only rejection oracle: descriptor integrity already passes before read-back. This does not prove a consumer accessed it.'});
}
cut('C4', 'create_data_slot_write', 'BRANCHNE TODO_CREATE_SLOT_CONFIRM_WORD3');
cut('D1', 'create_issue_scratch', 'DWRITE DR11, CR7, #0, DR3');
cut('D2', 'create_issue_scratch', 'LOAD CR1, CR9, #0');
cut('D3', 'create_return', 'IADD DR2, DR0, #0', 1, false);
// N1: mutate and restore the destination between reservation and publication.
{
    const x = f.setup();
    assert(reach(x, find('create_data_zero_begin', 'DWRITE DR15, CR7, #3')).reached);
    const at = x.sim.NS_TABLE_BASE + f.SLOT * 4;
    const old = x.sim.memory.slice(at, at + 4);
    x.sim.memory.fill(0xa5a5a5a5, at, at + 4); x.sim.memory.set(old, at);
    const stop = reach(x, find('create_data_slot_write', 'DWRITE DR8, CR10, #0, DR13'));
    assert(stop.reached);
    const state = capture(x);
    results.push({id: 'N1', status: 'BLOCKED', state,
        sequenceBound: (state.history & 511) === (x.sim.dr[9] >>> 21 & 511),
        reason: 'Restored ABA is not detected; sequence binding remains. No authorized interference/restart contract proves the full invariant.'});
}
{
    const x = f.setup({seq: 510, fresh: 0});
    const fault = f.run(x), state = capture(x);
    const pass = !!fault && state.history === 511 && state.poolCursor === 8 &&
        state.queueCursor === 7 && !state.returned && state.cr1 === 0;
    results.push({id: 'N2', status: pass ? 'PASS' : 'FAIL', fault, state,
        reason: 'Native retirement, without restart: 510 becomes 511 and faults before allocation.'});
}
// N3 injects control flow before any publication with DR1 still incomplete.
{
    const x = f.setup();
    assert(reach(x, find('create_data_zero_begin', 'DWRITE DR15, CR7, #3')).reached);
    x.sim.pc = image.labels.create_result + 4;
    const fault = f.run(x), state = capture(x);
    results.push({id: 'N3.incomplete', status: fault && !state.returned && state.cr1 === 0 ? 'PASS' : 'FAIL',
        state, fault, reason: 'Skipped publication with DR1=0 must fault without returning.'});
}
results.push({id: 'N3.stale-or-forged-completion', status: 'BLOCKED',
    reason: 'Arbitrary control-flow diversion with forged mutually consistent state and full-path FPGA replay remain unproven; individual result guards are not a publication receipt.'});
// Isolated result guards execute the exact issuer fragment from the existing
// fixture. Its committed legacy-table entry is setup, NOT a replay of C1-C4.
{
    const issueBody = f.source.slice(f.source.indexOf('create_data_account_and_issue:'),
        f.source.indexOf('create_data_slot_lambda:'));
    const resultOffset = new A().assemble(`LOAD CR7, CR6, #1\n${issueBody}`).labels.create_result + 1;
    const variants = [
        ['completion', s => { s.dr[1] = 0; }],
        ['NULL', s => { s.cr[1] = {word0: 0, word1: 0, word2: 0, word3: 0, m: 0}; }],
        ['permission', s => { s.cr[1].word0 &= ~0x20000000; }],
        ['EXACT', s => { s.cr[11].word0 ^= 1; }],
        ['type-and-B', s => { s.dr[11] ^= 0x80000000; }],
        ['slot', s => { s.dr[7] += 1; }],
        ['sequence', s => { s.dr[9] ^= 1 << 21; }],
    ];
    for (const [name, mutate] of variants) {
        const x = f.setup({issueOnly: true});
        assert(reach(x, {pc: resultOffset}, 1, false).reached);
        assert.equal(x.sim.memory[f.STATE + 127], 0, 'scratch is wiped before validation');
        mutate(x.sim);
        const fault = f.run(x), state = capture(x);
        results.push({id: `N3.guard.${name}`, status: fault && !state.returned ? 'PASS' : 'FAIL',
            fault, state, reason: 'Isolated native guard rejection only; committed entry was pre-provisioned, not published by this run.'});
    }
}
const report = {
    scope: 'Unchanged native component execution; cut snapshots, not a power-loss or authorized restart implementation.',
    sourceSha256: crypto.createHash('sha256').update(f.source).digest('hex'),
    results,
    counts: Object.fromEntries(['PASS', 'FAIL', 'BLOCKED'].map(k => [k, results.filter(r => r.status === k).length])),
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = results.some(r => r.status === 'FAIL') ? 1 :
    results.some(r => r.status === 'BLOCKED') ? 2 : 0;
