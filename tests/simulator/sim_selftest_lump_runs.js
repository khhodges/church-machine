// Read-only simulator evidence for the selected immutable SelfTest. Repository
// source equality is deliberately not a prerequisite. This is not FPGA evidence.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { inspectSelectedSelfTest } = require('../../scripts/selftest_selected_artifact');
const ROOT = path.resolve(__dirname, '../..');
const index = process.argv.indexOf('--lumps-dir');
const input = index < 0 ? path.join(ROOT, 'server/lumps') : path.resolve(process.argv[index + 1]);
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'selftest-runtime-'));
const report = {
    target: 'ChurchSimulator (not physical-board or generated-RTL evidence)',
    phase: 'setup', executionReached: false, bootComplete: false, loaded: false,
    steps: 0, dr0: null, dr1: null, faultType: null, faultMessage: null,
    faultLog: [], terminatedBy: null, pass: false, failMessage: null,
};
try {
    // Copy only the selected inputs, not the live directory. Hash/approval checks
    // detect a torn snapshot; neither copying nor execution repairs any input.
    for (const name of ['manifest.json', 'ns-state.json', 'approvals.json'])
        fs.copyFileSync(path.join(input, name), path.join(isolated, name));
    const manifest = JSON.parse(fs.readFileSync(path.join(isolated, 'manifest.json')));
    const rows = manifest.filter(e => e.abstraction === 'SelfTest' && !e.archived);
    if (rows.length !== 1 || path.basename(rows[0].filename) !== rows[0].filename)
        throw new Error('missing or ambiguous selected SelfTest');
    fs.copyFileSync(path.join(input, rows[0].filename), path.join(isolated, rows[0].filename));
    const selected = inspectSelectedSelfTest(isolated);
    report.selectedFilename = selected.entry.filename;
    report.selectedHash = selected.hash;
    report.methodEntry = `0x${selected.words[1].toString(16).padStart(8, '0')}`;
    global.window = { bootConfig: { step1: {
        totalNamespaceWords: 16384, namespaceLumpWords: 64, threadLumpWords: 256,
    } } };
    const ChurchSimulator = require('../../simulator/simulator');
    const Registry = require('../../simulator/abstractions');
    const System = require('../../simulator/system_abstractions');
    const sim = new ChurchSimulator();
    const registry = new Registry();
    sim.initAbstractions(registry, new System(registry), null);
    for (let i = 0; i < 32 && !sim.bootComplete && !sim.halted; i++)
        if (!sim._bootStep()) break;
    report.bootComplete = sim.bootComplete;
    if (!sim.bootComplete) throw new Error('simulator boot did not complete');
    // Reproduce the selected destination generation in this private Namespace.
    // Loading into the default generation would otherwise mint a different GT.
    sim.bootComplete = false;
    sim.writeNSEntry(selected.binding.slot, 0x0400, selected.cw,
        0, 0, 1, selected.binding.seq, selected.cc);
    sim.bootComplete = true;
    report.loaded = sim.loadLumpBinary(selected.words, selected.binding.slot, { activateExecution: true });
    if (!report.loaded) throw new Error(`selected SelfTest load failed: ${sim.output}`);

    // A small isolated caller uses numbered CALL method 1, then we stop at its
    // return address. Never patch the selected bytes or synthesize a Next row.
    const callerSlot = 60;
    const callerBase = sim.NS_TABLE_BASE - 64;
    const callee = sim.readNSEntry(selected.binding.slot);
    if (selected.words.some((word, i) => (sim.memory[callee.word0_location + i] >>> 0) !== word))
        throw new Error('installation changed selected SelfTest bytes');
    if (selected.binding.slot === callerSlot || callee.word0_location + selected.words.length > callerBase)
        throw new Error('fixture caller overlaps selected SelfTest');
    const callerGT = sim.createGT(0, callerSlot, { E: 1 }, 1);
    sim.memory[callerBase] = ((31 << 27) | (2 << 10) | 1) >>> 0;
    sim.memory[callerBase + 1] = sim.encodeInstruction(2, 14, 0, 0, 1);
    sim.memory[callerBase + 2] = sim.encodeInstruction(3, 14, 0, 0, 0);
    sim.memory[callerBase + 63] = callerGT;
    sim.bootComplete = false; // privileged fixture construction, never runtime registration
    sim.writeNSEntry(callerSlot, callerBase, 2, 0, 0, 1, 0, 1);
    sim.bootComplete = true;
    sim._installLumpHeaderContext(sim.parseGT(callerGT), callerSlot,
        sim.readNSEntry(callerSlot), sim.parseLumpHeader(sim.memory[callerBase]));
    sim.cr[0] = { word0: selected.selfGT, word1: callee.word0_location,
        word2: callee.word1_limit, word3: callee.word2_seals, m: 0 };
    sim.pc = 0;
    sim.halted = false;
    const originalFault = sim.fault.bind(sim);
    sim.fault = (type, message, meta) => {
        if (report.faultType === null) {
            report.faultType = type;
            report.faultMessage = message;
            report.dr0 = sim.dr[0] >>> 0;
            report.dr1 = sim.dr[1] >>> 0;
        }
        report.faultLog.push({ type, message });
        originalFault(type, message, meta);
    };
    report.phase = 'dispatch';
    report.executionReached = true;
    let returned = false;
    while (report.steps < 100000 && !sim.halted && sim.bootComplete) {
        const step = sim.step();
        report.steps++;
        if (report.faultType !== null) break;
        if (report.steps === 1) {
            if (step?.instr?.opcode !== 2 ||
                sim.parseGT(sim.cr[14].word0).index !== selected.binding.slot)
                throw new Error('numbered CALL did not enter selected SelfTest');
            report.phase = 'execution';
        } else if (sim.cr[14].word1 === callerBase && sim.pc === 1) {
            returned = step?.instr?.opcode === 3;
            break;
        }
        if (!step) break;
    }
    if (report.dr0 === null) {
        report.dr0 = sim.dr[0] >>> 0;
        report.dr1 = sim.dr[1] >>> 0;
    }
    report.terminatedBy = report.faultType !== null ? 'UNEXPECTED_FAULT' :
        returned ? 'RETURN' : report.steps >= 100000 ? 'MAX_STEPS' : 'HALT';
    report.pass = returned && !report.faultType && report.dr0 === 0 && report.dr1 === 0;
    if (!report.pass)
        report.failMessage = `${report.phase}: ${report.terminatedBy}; ${report.faultMessage || ''} DR1=${report.dr1}, DR0=${report.dr0}`;
} catch (error) {
    report.terminatedBy = report.executionReached ? 'HARNESS_ERROR' : 'SETUP_FAILED';
    report.failMessage = `${report.phase}: ${error.message}` +
        (report.executionReached ? '' : '; execution not attempted');
} finally {
    fs.rmSync(isolated, { recursive: true, force: true });
}
process.stdout.write(JSON.stringify(report) + '\n');
process.exit(report.pass ? 0 : 1);
