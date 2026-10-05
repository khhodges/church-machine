#!/usr/bin/env node
'use strict';
// Offline execution evidence only: no candidate admission or publication.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {spawnSync} = require('child_process');
const root = path.resolve(__dirname, '..');
const directory = path.resolve(process.argv[2] || '');
const review = JSON.parse(fs.readFileSync(path.join(directory, 'review.json')));
const raw = fs.readFileSync(path.join(directory, review.filename));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
assert.strictEqual(digest(raw), review.binary_hash);
const config = JSON.parse(fs.readFileSync(path.join(root, 'server/boot-config.json')));
assert.strictEqual(config.bootEntrySlot, 10, 'review requires the prepared CapabilityTest entry');
const state = JSON.parse(fs.readFileSync(path.join(root, 'server/lumps/ns-state.json')));
const selected = ['SelfTest', 'CapabilityTest', 'WukongCallHome'].map(name => {
    const row = state.abstractions.find(row => row.name === name);
    assert(row && row.filename, `missing selected ${name}`);
    const filename = path.join(root, 'server/lumps', row.filename);
    const hash = digest(fs.readFileSync(filename));
    assert.strictEqual(hash, row.binary_hash, `${name} selection hash`);
    return {name, filename, hash};
});
const protectedFiles = [...selected.map(row => row.filename),
    ...['boot-config.json', 'lumps/boot-image.bin', 'lumps/approvals.json', 'lumps/manifest.json',
        'lumps/ns-state.json'].map(name => path.join(root, 'server', name))];
const before = protectedFiles.map(filename => digest(fs.readFileSync(filename)));
const regenerate = process.argv.includes('--regenerate');
const generated = regenerate ? spawnSync('python3', ['-c', `
import contextlib, json, pathlib, shutil, sys, tempfile
from server.boot_image import generate_boot_image
with tempfile.TemporaryDirectory(prefix="selftest-loop-") as directory:
    catalog = pathlib.Path(directory) / "lumps"
    shutil.copytree("server/lumps", catalog)
    cfg = json.load(open("server/boot-config.json"))
    with contextlib.redirect_stdout(sys.stderr):
        image = generate_boot_image(cfg, str(catalog))
    sys.stdout.buffer.write(image)
`], {cwd: root, encoding: null, timeout: 60000, maxBuffer: 8 * 1024 * 1024})
    : {status: 0, stdout: fs.readFileSync(path.join(root, 'server/lumps/boot-image.bin'))};
assert.strictEqual(generated.status, 0, String(generated.stderr));
global.window = {bootConfig: config};
const ChurchSimulator = require('../simulator/simulator.js');
const sim = new ChurchSimulator();
const image = generated.stdout.buffer.slice(generated.stdout.byteOffset,
    generated.stdout.byteOffset + generated.stdout.byteLength);
assert(sim.loadBootImage(image), sim.lastBootImageError);
for (let i = 0; !sim.bootComplete && !sim.halted && i < 32; i++) sim._bootStep();
assert(sim.bootComplete && !sim.halted, 'canonical boot completes');
assert.strictEqual(sim._currentThreadSlot, 1);
assert.strictEqual(sim.cr[14].word0 & 65535, 10);
// The image may localize capabilities, but its executable payload must be
// the exact selected payload, not a stale resident revision.
for (const [slot, name] of [[6, 'SelfTest'], [7, 'WukongCallHome'], [10, 'CapabilityTest']]) {
    const saved = fs.readFileSync(selected.find(row => row.name === name).filename);
    const at = sim.readNSEntry(slot).word0_location;
    const cw = (saved.readUInt32BE(0) >>> 10) & 8191;
    assert.strictEqual((sim.memory[at] >>> 10) & 8191, cw, `${name} image code length`);
    for (let i = 1; i <= cw; i++)
        assert.strictEqual(sim.memory[at + i] >>> 0, saved.readUInt32BE(i * 4),
            `${name} image differs from selected instruction word ${i}`);
}
const entry = sim.readNSEntry(6);
const base = entry.word0_location;
const header = sim.memory[base] >>> 0;
assert.strictEqual(raw.length / 4, 2 ** (((header >>> 23) & 15) + 6),
    'candidate must fit the selected SelfTest allocation without relocation');
assert.strictEqual(raw.readUInt32BE(0) & 255, 1);
assert.strictEqual(header & 255, 1);
// Only test-memory bytes change. Destination-local SELF must still be exact.
assert.strictEqual(raw.readUInt32BE(raw.length - 4),
    sim.memory[base + raw.length / 4 - 1] >>> 0);
for (let i = 0; i < raw.length / 4; i++) sim.memory[base + i] = raw.readUInt32BE(i * 4);
const report = {candidate: review.filename, binary_hash: review.binary_hash,
    image_mode: regenerate ? 'regenerated' : 'saved-prepared',
    image_sha256: digest(generated.stdout),
    admission_tested: false, selected, changes: [], calls: [], returns: [],
    faults: [], trace_tail: []};
const fault = sim.fault.bind(sim);
sim.fault = (type, message, meta) => {
    report.faults.push({type, message});
    return fault(type, message, meta);
};
const pending = [];
let completed = 0;
try {
    for (let step = 0; step < 20000 && completed < 5; step++) {
        assert(!sim.halted, 'unexpected halt');
        const pre = {thread: sim._currentThreadSlot, slot: sim.cr[14].word0 & 65535,
            pc: sim.pc, sto: sim.sto, dr1: sim.dr[1] >>> 0};
        const result = sim.step();
        const post = {thread: sim._currentThreadSlot, slot: sim.cr[14].word0 & 65535,
            pc: sim.pc, sto: sim.sto};
        const row = {step, ...pre,
            instruction: result?.instr ? sim.opName(result.instr.opcode) : null, post};
        report.trace_tail.push(row);
        if (report.trace_tail.length > 15) report.trace_tail.shift();
        assert.strictEqual(report.faults.length, 0, JSON.stringify(report.faults));
        assert(result && result.instr, 'instruction must retire');
        if (result.skipped) continue;
        if (row.instruction === 'CHANGE') {
            report.changes.push(row);
            assert.strictEqual(pre.slot, 10);
            assert.strictEqual(pre.thread, report.changes.length === 1 ? 1 : 11);
            assert.strictEqual(post.thread, 11);
        }
        if (row.instruction === 'CALL' && pre.slot === 10) {
            assert.strictEqual(post.slot, completed === report.returns.filter(r => r.slot === 6).length ? 6 : 7);
            pending.push({slot: post.slot, thread: pre.thread, sto: pre.sto, pc: pre.pc + 1});
            report.calls.push(row);
        }
        if (row.instruction === 'RETURN' && [6, 7].includes(pre.slot)) {
            const caller = pending.pop();
            assert(caller, 'return must have a matching CALL');
            assert.strictEqual(pre.slot, caller.slot);
            assert.strictEqual(post.slot, 10);
            assert.strictEqual(post.thread, caller.thread);
            assert.strictEqual(post.pc, caller.pc, 'RETURN resumes the instruction after CALL');
            assert.strictEqual(post.sto, caller.sto, 'CALL frame is fully unwound');
            if (pre.slot === 6) assert.strictEqual(pre.dr1, 0, 'SelfTest must succeed');
            else completed++;
            report.returns.push(row);
        }
    }
    assert.strictEqual(completed, 5, 'five complete SelfTest/WukongCallHome cycles required');
    assert.strictEqual(report.changes.length, 6, 'initial Thread entry plus one self-CHANGE per cycle');
    const steady = report.changes.slice(1).map(row => row.post.sto);
    assert(steady.every(sto => sto === steady[0]), 'same-thread CHANGE must not grow the stack');
    assert.strictEqual(pending.length, 0);
    report.status = 'passed';
} catch (error) {
    report.status = 'failed';
    report.error = error.message;
    process.exitCode = 1;
} finally {
    assert.deepStrictEqual(protectedFiles.map(filename => digest(fs.readFileSync(filename))), before,
        'saved artifacts and release configuration must remain unchanged');
    console.log(JSON.stringify(report, null, 2));
}
