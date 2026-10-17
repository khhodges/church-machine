#!/usr/bin/env node
'use strict';
// Offline evidence, NOT admission, activation, or a replacement builder.
// Only the frozen Phase 1 pin selects bytes; no manifest/sidecar/source lookup.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const PIN = 'docs/reviews/phase1-baseline/selftest-api-identity-evidence.json';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hex = word => (word >>> 0).toString(16).padStart(8, '0');

function inventory() {
    const result = {};
    function walk(relative) {
        const full = path.join(ROOT, relative);
        if (!fs.existsSync(full)) return;
        if (fs.lstatSync(full).isDirectory()) {
            for (const name of fs.readdirSync(full).sort()) walk(`${relative}/${name}`);
        } else if (fs.lstatSync(full).isFile()) result[relative] = sha(fs.readFileSync(full));
    }
    walk('server/lumps');
    walk('server/boot-config.json');
    return result;
}

function inspect(bytes, evidence) {
    assert.equal(sha(bytes), evidence.selectedRow.selection.binaryHash, 'frozen hash differs; no fallback');
    assert.equal(bytes.length, evidence.binary.bytes);
    const words = Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readUInt32BE(i * 4));
    assert.equal(hex(words[0]), evidence.binary.headerHex);
    const cw = (words[0] >>> 10) & 8191;
    assert.equal(cw, evidence.binary.cw);
    assert.equal(words.at(-1), 0x4a000006, 'selected SELF must remain slot 6, sequence 0');
    const apiBytes = bytes.subarray((cw + 2) * 4, (cw + 2) * 4 + (words[cw + 1] & 65535));
    assert.equal(sha(apiBytes), evidence.binary.apiSha256);
    // Derive all status exits from exact instructions, not source labels or
    // historical PCs. Each failure is conditional BRANCH / status IADD / RETURN.
    const exits = [];
    for (let w = 2; w < cw; w++) {
        if ((words[w] >>> 15) !== (0xaf084000 >>> 15) ||
            !(words[w] & 0x4000) || words[w + 1] !== 0x1f000000) continue;
        const status = words[w] & 0x3fff;
        const branch = words[w - 1];
        if (!status) continue;
        assert.equal(branch >>> 27, 23);
        assert.ok(((branch >>> 23) & 15) < 14);
        const offset = (branch & 0x4000) ? (branch & 0x7fff) - 0x8000 : branch & 0x7fff;
        assert.equal(offset, 3, 'passing branch must skip status write and RETURN');
        exits.push({ status, branchWord: w - 1, branchHex: hex(branch),
            condition: (branch >>> 23) & 15, passTargetWord: w + 2,
            statusWord: w, statusHex: hex(words[w]), returnWord: w + 1 });
    }
    assert.deepEqual([...new Set(exits.map(e => e.status))], Array.from({ length: 81 }, (_, i) => i + 1));
    assert.equal(words[cw - 1], 0xaf084000);
    assert.equal(words[cw], 0x1f000000);
    return { words, cw, api: JSON.parse(apiBytes), exits };
}

function runCase(selected, method, forcedBranchWord = null) {
    const forcedStatus = selected.exits.find(e => e.branchWord === forcedBranchWord)?.status ?? null;
    global.window = { bootConfig: { step1: {
        totalNamespaceWords: 16384, namespaceLumpWords: 64, threadLumpWords: 256,
    } } };
    const Simulator = require('../simulator/simulator');
    const Registry = require('../simulator/abstractions');
    const System = require('../simulator/system_abstractions');
    const sim = new Simulator();
    const registry = new Registry();
    sim.initAbstractions(registry, new System(registry), null);
    for (let i = 0; i < 32 && !sim.bootComplete && !sim.halted; i++) sim._bootStep();
    assert.ok(sim.bootComplete && !sim.halted, 'synthetic Thread setup must complete');
    sim.bootComplete = false;
    sim.writeNSEntry(6, 0x0400, selected.cw, 0, 0, 1, 0, 1);
    sim.bootComplete = true;
    assert.ok(sim.loadLumpBinary(selected.words, 6), sim.output);
    const callee = sim.readNSEntry(6);
    const base = callee.word0_location;
    const callerBase = sim.NS_TABLE_BASE - 64;
    assert.ok(base + selected.words.length <= callerBase);
    const callerGT = sim.createGT(0, 60, { E: 1 }, 1);
    sim.memory[callerBase] = ((31 << 27) | (2 << 10) | 1) >>> 0;
    sim.memory[callerBase + 1] = sim.encodeInstruction(2, 14, 0, 0, method);
    sim.memory[callerBase + 2] = sim.encodeInstruction(3, 14, 0, 0, 0);
    sim.memory[callerBase + 63] = callerGT;
    sim.bootComplete = false;
    sim.writeNSEntry(60, callerBase, 2, 0, 0, 1, 0, 1);
    sim.bootComplete = true;
    sim._installLumpHeaderContext(sim.parseGT(callerGT), 60, sim.readNSEntry(60),
        sim.parseLumpHeader(sim.memory[callerBase]));
    sim.cr[0] = { word0: selected.words.at(-1), word1: base,
        word2: callee.word1_limit, word3: callee.word2_seals, m: 0 };
    sim.pc = 0;
    sim.halted = false;
    // CALL reads the protected Thread word, not the boot helper's JS mirror.
    const startSTO = sim._readProtectedSto(sim._activeThreadBase());
    const report = { method, forcedStatus, forcedBranchWord, callerSlot: 60, calleeSlot: 6,
        callerCallHex: hex(sim.memory[callerBase + 1]), protectedCallerSTO: startSTO, dispatch: null,
        branches: [], statusWrites: [], fault: null, returned: false, tail: [] };
    let active = null;
    const write = sim._writeDR.bind(sim);
    sim._writeDR = (register, value) => {
        const before = sim.dr[register] >>> 0;
        write(register, value); // never suppress or redirect a failure write
        if (active) active.writes.push({ register, attempted: value >>> 0, before,
            stored: sim.dr[register] >>> 0, discarded: register === 0 && (value >>> 0) !== 0 });
    };
    const fault = sim.fault.bind(sim);
    sim.fault = (type, message, meta) => {
        if (!report.fault) report.fault = { type, message, preRecovery: snapshot() };
        return fault(type, message, meta);
    };
    function snapshot() {
        return { slot: sim.cr[14].word0 & 65535, pc: sim.pc,
            word: sim.pc + 1, flags: { ...sim.flags }, dr0: sim.dr[0] >>> 0,
            dr1: sim.dr[1] >>> 0, cr0: hex(sim.cr[0].word0),
            cr1: hex(sim.cr[1].word0), sto: sim.sto };
    }
    for (let step = 0; step < 10000; step++) {
        if (sim.halted || !sim.bootComplete) break;
        const pre = snapshot();
        const marker = pre.slot === 6 && selected.exits.find(e => e.branchWord === pre.word);
        if (marker && marker.branchWord === forcedBranchWord) {
            // Perturb only flags immediately before this guard. All earlier
            // instructions run normally; selected bytes and execution PC never change.
            const original = { ...sim.flags };
            for (let mask = 0; mask < 16; mask++) {
                sim.flags = { N: !!(mask & 8), Z: !!(mask & 4),
                    C: !!(mask & 2), V: !!(mask & 1) };
                if (!sim.checkCondition(marker.condition)) break;
            }
            assert.equal(sim.checkCondition(marker.condition), false);
            report.injection = { branchWord: pre.word, originalFlags: original,
                forcedFlags: { ...sim.flags } };
        }
        const word = sim.memory[sim.cr[14].word1 + 1 + sim.pc] >>> 0;
        active = { step, pre, raw: hex(word), flagsAtExecute: { ...sim.flags }, writes: [] };
        const result = sim.step();
        active.post = snapshot();
        active.skipped = !!result?.skipped;
        report.tail.push(active);
        if (report.tail.length > 4) report.tail.shift();
        if (step === 0) report.dispatch = active;
        if (marker) report.branches.push({ status: marker.status, word: pre.word,
            raw: hex(word), flags: active.flagsAtExecute, taken: !active.skipped,
            nextWord: active.post.word });
        if (pre.slot === 6 && (selected.exits.some(e => e.statusWord === pre.word) ||
                pre.word === selected.cw - 1)) report.statusWrites.push(active);
        report.steps = step + 1;
        if (report.fault) break; // zero status at a fault is never completion
        if (step > 0 && active.post.slot === 60 && active.post.pc === 1) {
            report.returned = result?.instr?.opcode === 3;
            break;
        }
        if (!result) break;
    }
    report.final = snapshot();
    report.frameRestored = report.returned && sim.sto === startSTO;
    report.termination = report.fault ? 'FAULT' : report.returned ? 'RETURN' : 'INCOMPLETE';
    assert.deepEqual(Array.from(sim.memory.slice(base, base + selected.words.length)), selected.words,
        'fixture must preserve every selected byte, including API and SELF');
    return report;
}

function probe() {
    const before = inventory();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phase1-selftest-'));
    try {
        const evidence = JSON.parse(fs.readFileSync(path.join(ROOT, PIN)));
        const row = evidence.selectedRow;
        assert.equal(row.slot, 6);
        assert.equal(row.boot, false);
        assert.equal(row.sequence, 0);
        assert.equal(row.policy, 'Resident');
        assert.equal(row.selection.filename, path.basename(row.selection.filename));
        const copy = path.join(directory, row.selection.filename);
        fs.copyFileSync(path.join(ROOT, 'server/lumps', row.selection.filename), copy);
        const bytes = fs.readFileSync(copy);
        const selected = inspect(bytes, evidence);
        const natural = runCase(selected, 1);
        const invalidMethod = runCase(selected, 2);
        const failures = selected.exits.map(e => runCase(selected, 1, e.branchWord));
        // Failure here means changed observations / a broken fixture, not permission
        // to substitute a newer artifact or weaken the selected artifact's checks.
        assert.equal(natural.termination, 'RETURN');
        assert.equal(natural.final.dr1, 0);
        assert.ok(natural.frameRestored);
        assert.equal(natural.dispatch.post.word, 2);
        assert.equal(natural.branches.length, selected.exits.length);
        assert.ok(natural.branches.every(b => b.taken));
        assert.equal(invalidMethod.fault?.type, 'INVALID_OP');
        assert.equal(invalidMethod.steps, 1);
        for (const run of failures) {
            assert.equal(run.termination, 'RETURN');
            assert.ok(run.frameRestored && run.injection);
            assert.equal(run.final.dr0, 0);
            assert.equal(run.final.dr1, run.forcedStatus);
            assert.equal(run.statusWrites.length, 1);
            assert.equal(run.branches.at(-1).taken, false);
            assert.ok(run.branches.slice(0, -1).every(b => b.taken));
            assert.deepEqual(run.statusWrites[0].writes.filter(w => w.register === 1)
                .map(w => [w.register, w.attempted, w.stored]),
                [[1, run.forcedStatus, run.forcedStatus]]);
        }
        // Retain the complete natural branch trace and every distinct forced
        // failure's guard/write/return evidence without duplicating earlier passes.
        const failureEvidence = failures.map(run => {
            const write = run.statusWrites[0], ret = run.tail.at(-1);
            return { status: run.forcedStatus, branchWord: run.forcedBranchWord,
                steps: run.steps, injection: run.injection, guard: run.branches.at(-1),
                failureWrite: { word: write.pre.word, raw: write.raw,
                    flagsBefore: write.pre.flags, dr1Before: write.pre.dr1,
                    writes: write.writes, dr0After: write.post.dr0, dr1After: write.post.dr1 },
                return: { word: ret.pre.word, raw: ret.raw, dr0Before: ret.pre.dr0,
                    dr1Before: ret.pre.dr1, callerSlot: ret.post.slot, callerPC: ret.post.pc,
                    dr0After: ret.post.dr0, dr1After: ret.post.dr1, stoAfter: ret.post.sto },
                termination: run.termination, frameRestored: run.frameRestored };
        });
        const fingerprints = Object.fromEntries([PIN, path.relative(ROOT, __filename),
            ...Object.keys(require.cache).filter(p => p.startsWith(path.join(ROOT, 'simulator/')))
                .map(p => path.relative(ROOT, p))].sort().map(p => [p, sha(fs.readFileSync(path.join(ROOT, p)))]));
        return { schema: 'phase1-selftest-call-evidence/v1', selectedRow: row,
            binarySha256: sha(bytes), target: 'ChurchSimulator only',
            scope: 'Synthetic in-memory Thread and caller, not the approved Phase 1 startup image',
            identity: { api: selected.api, nameMatches: selected.api.name === row.name,
                declaredMethods: selected.api.methods.length },
            entryWords: selected.words.slice(0, 4).map(hex), statusExits: selected.exits,
            natural, invalidMethod, failures: failureEvidence,
            conclusion: { method1Compatible: true, naturalDiagnosticPass: true,
                failureStatusControlsPassed: failures.length, executionQualified: false,
                rtlQualified: false, boardQualified: false, admissionTested: false,
                liveActivation: false, approvedSelfTestSlot: 6, approvedBootSlot: 10 },
            fingerprints, protectedFileCount: Object.keys(before).length,
            protectedInventorySha256: sha(JSON.stringify(before)), protectedFilesUnchanged: true };
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
        assert.deepEqual(inventory(), before, 'saved files changed during probe');
    }
}

if (require.main === module) {
    try { console.log(JSON.stringify(probe(), null, 2)); }
    catch (error) { console.error(error.stack); process.exitCode = 1; }
}
module.exports = { inspect, runCase, probe };
