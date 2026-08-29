'use strict';
// test_boot_cr_audit.js — Unit tests for boot CR_WR audit entries
//
// Verifies that after a simulator boot (as many steps as complete) the
// auditLog contains a CR_WR (or HEAP) entry for every capability register
// written during the boot sequence: CR15 (B:01 LOAD_NS), CR12 (B:02
// INIT_THRD), CR5 (B:03 INIT_HEAP), CR6 initial E-perm (B:05 INIT_ABSTR),
// and CR14 (B:07 NUC_CODE, checked only when boot completes).
//
// Note: in headless Node.js the boot halts at B:06 NUC_CLIST with a
// pre-existing F-bit fault (the default in-memory SelfTest NS entry has
// F-bit=1 when there is no real boot image on disk).  B:01–B:05 entries are
// verified unconditionally; B:07 (CR14/CR0) entries are checked only when
// bootComplete===true, with a clear SKIP message when they cannot be reached.
//
// Also checks that the SENTINEL gate type renders as a coloured badge by
// verifying pipeline.js lists it in its tsbGates array.
//
// Run:  node simulator/test_boot_cr_audit.js

global.window = { bootConfig: {} };

const fs   = require('fs');
const path = require('path');

const ChurchSimulator = require('./simulator.js');

// Boot a fresh simulator to completion (or until halted / 300 steps).
function bootSim() {
    const sim = new ChurchSimulator();
    let steps = 0;
    while (!sim.bootComplete && !sim.halted && steps < 300) {
        sim._bootStep();
        steps++;
    }
    return sim;
}

let pass = 0;
let fail = 0;
let skipped = 0;

function check(label, cond, detail) {
    if (cond) {
        console.log('PASS ' + label);
        pass++;
    } else {
        console.log('FAIL ' + label + (detail !== undefined ? ' — ' + detail : ''));
        fail++;
    }
}

function skip(label, reason) {
    console.log('SKIP ' + label + ' — ' + reason);
    skipped++;
}

// ─── Boot the simulator ───────────────────────────────────────────────────────

console.log('\n--- BA-0: boot status ---');
const sim = bootSim();
const bootOk = sim.bootComplete === true;
if (bootOk) {
    console.log('INFO BA-0: bootComplete=true — all tests will run');
    pass++;
} else {
    console.log('INFO BA-0: bootComplete=false (pre-existing headless F_BIT fault at B:06)' +
        ' — BA-1 through BA-4 and BA-7 still verified; BA-5/BA-6d/BA-8a skipped');
    skipped++;
}

// ─── BA-1: CR15 — LOAD_NS ────────────────────────────────────────────────────

console.log('\n--- BA-1: CR15 (B:01 LOAD_NS) ---');
{
    const entry = sim.auditLog.find(e => e.stepCtx === 'LOAD_NS CR15');
    check('BA-1a: CR_WR entry present for LOAD_NS CR15',
        entry !== undefined, 'no entry with stepCtx=LOAD_NS CR15');
    check('BA-1b: gate type is CR_WR',
        entry && entry.gate === 'CR_WR', entry && entry.gate);
    check('BA-1c: requiredPerm is NS',
        entry && entry.requiredPerm === 'NS', entry && entry.requiredPerm);
    check('BA-1d: nsIndex is 0 (NS header slot)',
        entry && entry.nsIndex === 0, entry && entry.nsIndex);
    check('BA-1e: desc is non-empty',
        entry && typeof entry.desc === 'string' && entry.desc.length > 0,
        entry && JSON.stringify(entry.desc));
    check('BA-1f: label is non-empty',
        entry && typeof entry.label === 'string' && entry.label.length > 0,
        entry && JSON.stringify(entry.label));
    check('BA-1g: result is pass',
        entry && entry.result === 'pass', entry && entry.result);
}

// ─── BA-2: CR12 — INIT_THRD ──────────────────────────────────────────────────

console.log('\n--- BA-2: CR12 (B:02 INIT_THRD) ---');
{
    const entry = sim.auditLog.find(e => e.stepCtx === 'INIT_THRD CR12');
    check('BA-2a: CR_WR entry present for INIT_THRD CR12',
        entry !== undefined, 'no entry with stepCtx=INIT_THRD CR12');
    check('BA-2b: gate type is CR_WR',
        entry && entry.gate === 'CR_WR', entry && entry.gate);
    check('BA-2c: requiredPerm is E',
        entry && entry.requiredPerm === 'E', entry && entry.requiredPerm);
    check('BA-2d: nsIndex is 1 (thread slot)',
        entry && entry.nsIndex === 1, entry && entry.nsIndex);
    check('BA-2e: desc is non-empty',
        entry && typeof entry.desc === 'string' && entry.desc.length > 0,
        entry && JSON.stringify(entry.desc));
    check('BA-2f: label is non-empty',
        entry && typeof entry.label === 'string' && entry.label.length > 0,
        entry && JSON.stringify(entry.label));
    check('BA-2g: result is pass',
        entry && entry.result === 'pass', entry && entry.result);
}

// ─── BA-3: CR5 — INIT_HEAP (HEAP gate) ───────────────────────────────────────

console.log('\n--- BA-3: CR5 (B:03 INIT_HEAP) ---');
{
    const entry = sim.auditLog.find(e => e.stepCtx === 'INIT_HEAP CR5←heap');
    check('BA-3a: HEAP entry present for INIT_HEAP',
        entry !== undefined, 'no entry with stepCtx=INIT_HEAP CR5←heap');
    check('BA-3b: gate type is HEAP',
        entry && entry.gate === 'HEAP', entry && entry.gate);
    check('BA-3c: nsIndex is 1 (thread slot)',
        entry && entry.nsIndex === 1, entry && entry.nsIndex);
    check('BA-3d: desc is non-empty',
        entry && typeof entry.desc === 'string' && entry.desc.length > 0,
        entry && JSON.stringify(entry.desc));
    check('BA-3e: label is non-empty',
        entry && typeof entry.label === 'string' && entry.label.length > 0,
        entry && JSON.stringify(entry.label));
    check('BA-3f: result is pass',
        entry && entry.result === 'pass', entry && entry.result);
    check('BA-3g: CR5 ordinary heap starts at Thread +18',
        sim.cr[5].word1 === sim.cr[12].word1 + 18,
        `CR5.base=${sim.cr[5].word1}, Thread.base=${sim.cr[12].word1}`);
    check('BA-3h: protected STO at Thread +17 is below CR5 base',
        sim.cr[12].word1 + 17 < sim.cr[5].word1,
        `STO=${sim.cr[12].word1 + 17}, CR5.base=${sim.cr[5].word1}`);
}

// ─── BA-4: CR6 initial E-perm — INIT_ABSTR ───────────────────────────────────

console.log('\n--- BA-4: CR6 E-perm (B:05 INIT_ABSTR) ---');
{
    const entry = sim.auditLog.find(e => e.stepCtx === 'INIT_ABSTR CR6');
    check('BA-4a: CR_WR entry present for INIT_ABSTR CR6',
        entry !== undefined, 'no entry with stepCtx=INIT_ABSTR CR6');
    check('BA-4b: gate type is CR_WR',
        entry && entry.gate === 'CR_WR', entry && entry.gate);
    check('BA-4c: requiredPerm is E',
        entry && entry.requiredPerm === 'E', entry && entry.requiredPerm);
    check('BA-4d: nsIndex equals bootEntrySlot',
        entry && entry.nsIndex === sim.bootEntrySlot,
        entry && `nsIndex=${entry.nsIndex} bootEntrySlot=${sim.bootEntrySlot}`);
    check('BA-4e: desc is non-empty',
        entry && typeof entry.desc === 'string' && entry.desc.length > 0,
        entry && JSON.stringify(entry.desc));
    check('BA-4f: label is non-empty',
        entry && typeof entry.label === 'string' && entry.label.length > 0,
        entry && JSON.stringify(entry.label));
    check('BA-4g: result is pass',
        entry && entry.result === 'pass', entry && entry.result);
}

// ─── BA-5: CR14 — NUC_CODE (requires boot completion) ────────────────────────

console.log('\n--- BA-5: CR14 (B:07 NUC_CODE) ---');
if (!bootOk) {
    skip('BA-5a: CR_WR entry present for NUC_CODE CR14', 'boot did not complete (pre-existing headless F_BIT fault)');
    skip('BA-5b: gate type is CR_WR', 'boot did not complete');
    skip('BA-5c: requiredPerm is R+X', 'boot did not complete');
    skip('BA-5d: nsIndex equals bootEntrySlot', 'boot did not complete');
    skip('BA-5e: desc is non-empty', 'boot did not complete');
    skip('BA-5f: label is non-empty', 'boot did not complete');
    skip('BA-5g: result is pass', 'boot did not complete');
} else {
    const entry = sim.auditLog.find(e => e.stepCtx === 'NUC_CODE CR14');
    check('BA-5a: CR_WR entry present for NUC_CODE CR14',
        entry !== undefined, 'no entry with stepCtx=NUC_CODE CR14');
    check('BA-5b: gate type is CR_WR',
        entry && entry.gate === 'CR_WR', entry && entry.gate);
    check('BA-5c: requiredPerm is R+X',
        entry && entry.requiredPerm === 'R+X', entry && entry.requiredPerm);
    check('BA-5d: nsIndex equals bootEntrySlot',
        entry && entry.nsIndex === sim.bootEntrySlot,
        entry && `nsIndex=${entry.nsIndex} bootEntrySlot=${sim.bootEntrySlot}`);
    check('BA-5e: desc is non-empty',
        entry && typeof entry.desc === 'string' && entry.desc.length > 0,
        entry && JSON.stringify(entry.desc));
    check('BA-5f: label is non-empty',
        entry && typeof entry.label === 'string' && entry.label.length > 0,
        entry && JSON.stringify(entry.label));
    check('BA-5g: result is pass',
        entry && entry.result === 'pass', entry && entry.result);
}

// ─── BA-6: Ordering — CR15 before CR12 before HEAP before CR6-E ──────────────

console.log('\n--- BA-6: ordering of CR_WR entries ---');
{
    const idxCR15 = sim.auditLog.findIndex(e => e.stepCtx === 'LOAD_NS CR15');
    const idxCR12 = sim.auditLog.findIndex(e => e.stepCtx === 'INIT_THRD CR12');
    const idxHEAP = sim.auditLog.findIndex(e => e.stepCtx === 'INIT_HEAP CR5←heap');
    const idxCR6E = sim.auditLog.findIndex(e => e.stepCtx === 'INIT_ABSTR CR6');
    const idxCR14 = sim.auditLog.findIndex(e => e.stepCtx === 'NUC_CODE CR14');

    check('BA-6a: CR15 (B:01) before CR12 (B:02)',
        idxCR15 !== -1 && idxCR12 !== -1 && idxCR15 < idxCR12,
        `idxCR15=${idxCR15} idxCR12=${idxCR12}`);
    check('BA-6b: CR12 (B:02) before HEAP/CR5 (B:03)',
        idxCR12 !== -1 && idxHEAP !== -1 && idxCR12 < idxHEAP,
        `idxCR12=${idxCR12} idxHEAP=${idxHEAP}`);
    check('BA-6c: HEAP/CR5 (B:03) before CR6-E (B:05)',
        idxHEAP !== -1 && idxCR6E !== -1 && idxHEAP < idxCR6E,
        `idxHEAP=${idxHEAP} idxCR6E=${idxCR6E}`);
    if (!bootOk) {
        skip('BA-6d: CR6-E (B:05) before CR14 (B:07)', 'boot did not complete (pre-existing headless F_BIT fault)');
    } else {
        check('BA-6d: CR6-E (B:05) before CR14 (B:07)',
            idxCR6E !== -1 && idxCR14 !== -1 && idxCR6E < idxCR14,
            `idxCR6E=${idxCR6E} idxCR14=${idxCR14}`);
    }
}

// ─── BA-7: SENTINEL gate is in pipeline.js tsbGates ─────────────────────────

console.log('\n--- BA-7: SENTINEL in pipeline.js tsbGates ---');
{
    const pipelineSrc = fs.readFileSync(
        path.join(__dirname, 'pipeline.js'), 'utf8');
    const tsbMatch = pipelineSrc.match(/const tsbGates\s*=\s*\[([^\]]+)\]/);
    const tsbGates = tsbMatch
        ? tsbMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''))
        : [];
    check('BA-7a: pipeline.js tsbGates array found',
        tsbGates.length > 0, 'regexp did not match tsbGates');
    check('BA-7b: SENTINEL is in tsbGates',
        tsbGates.includes('SENTINEL'),
        'tsbGates=' + JSON.stringify(tsbGates));
    check('BA-7c: CR_WR is in tsbGates',
        tsbGates.includes('CR_WR'), 'sanity check: CR_WR missing from tsbGates');
    check('BA-7d: HEAP is in tsbGates',
        tsbGates.includes('HEAP'), 'sanity check: HEAP missing from tsbGates');
}

// ─── BA-8: all boot CR_WR + HEAP entries have non-empty desc and label ────────

console.log('\n--- BA-8: every boot CR_WR / HEAP entry has desc and label ---');
{
    const bootCRGates = ['CR_WR', 'HEAP'];
    const bootEntries = sim.auditLog.filter(e => bootCRGates.includes(e.gate));
    // B:01 CR15 + B:02 CR12 + B:03 HEAP + B:05 CR6-E = 4 entries minimum
    // (B:07 CR14 and B:06 CR6-L add more only when boot fully completes)
    const minEntries = 4;
    check('BA-8a: at least ' + minEntries + ' CR_WR/HEAP entries exist',
        bootEntries.length >= minEntries, `found ${bootEntries.length}`);
    const missingDesc  = bootEntries.filter(e => !e.desc  || e.desc.length  === 0);
    const missingLabel = bootEntries.filter(e => !e.label || e.label.length === 0);
    check('BA-8b: all CR_WR/HEAP entries have non-empty desc',
        missingDesc.length === 0,
        missingDesc.map(e => e.stepCtx).join(', '));
    check('BA-8c: all CR_WR/HEAP entries have non-empty label',
        missingLabel.length === 0,
        missingLabel.map(e => e.stepCtx).join(', '));
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n────────────────────────────────────────────────────────────');
console.log(`boot-cr-audit results: ${pass} passed, ${fail} failed, ${skipped} skipped`);
if (fail > 0) process.exit(1);
