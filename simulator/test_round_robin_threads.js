'use strict';

// Round-robin scheduler regression: the UI operation must use the generated
// Namespace order, wrap exactly once, preserve private state, and fail before
// mutating the current context when a target descriptor is invalid.
const assert = require('assert');
const vm = require('vm');
global.window = { bootConfig: { step1: {
    totalNamespaceWords: 16384, namespaceLumpWords: 1024,
    threadLumpWords: 512, threadCount: 3,
} } };
const ChurchSimulator = require('./simulator.js');
// Regenerate the exact three-Thread image inputs used by the IDE. This catches
// a later boot-resident catalog embedding pass overwriting Thread#2/#3 without
// depending on the workspace-only, ignored boot-image.bin file.
const fs = require('fs');
const { spawnSync } = require('child_process');
global.window.bootConfig.step1 = {
    totalNamespaceWords: 16384, namespaceLumpWords: 64,
    threadLumpWords: 512, threadCount: 3,
};
const committed = new ChurchSimulator();
const generated = spawnSync('python', ['-c', [
    'import json, sys',
    'from server.boot_image import generate_boot_image',
    'cfg=json.load(open("server/boot-config.json"))',
    'sys.stdout.buffer.write(generate_boot_image(cfg, "server/lumps"))',
].join(';')], { cwd: process.cwd(), encoding: null });
assert.strictEqual(generated.status, 0,
    `committed image inputs must regenerate: ${String(generated.stderr || '')}`);
const image = generated.stdout.buffer.slice(
    generated.stdout.byteOffset,
    generated.stdout.byteOffset + generated.stdout.byteLength);
assert.strictEqual(committed.loadBootImage(image), true,
    `committed image must load: ${committed.lastBootImageError || 'unknown error'}`);
committed.bootComplete = true;
committed._currentThreadSlot = 1;
assert.deepStrictEqual(committed.configuredThreadSlots(), [1, 11, 12],
    'committed image exposes all three Thread contexts');
const committedBases = [1, 11, 12].map(slot => committed.readNSEntry(slot).word0_location);
const entryLayouts = committedBases.map(base => committed._threadLayoutAtBase(base));
assert(entryLayouts.every(layout => layout && layout.valid),
    'committed Thread headers expose valid derived geometry');
assert(entryLayouts.every(layout => layout.lumpSize === 512),
    'scheduler fixture exercises supported non-256-word Threads');
assert(committedBases[0] + entryLayouts[0].lumpSize <= committedBases[1] &&
       committedBases[1] + entryLayouts[1].lumpSize <= committedBases[2],
    'committed Thread bodies are non-overlapping at their derived sizes');
const entryWords = [1, 11, 12].map((slot, i) =>
    committed.memory[committedBases[i] + entryLayouts[i].capsStart] >>> 0);
const initialEntry = committed.readNSEntry(entryWords[0] & 0xFFFF);
committed._writeCR(0, entryWords[0], initialEntry);
committed.dr[1] = 0xA1001001;
committed.memory[committedBases[1] + 1] = 0xB2000000;
committed.memory[committedBases[1] + 2] = 0xB2000001;
committed.memory[committedBases[2] + 1] = 0xC3000000;
const targetCapsBefore = committed.memory.slice(
    committedBases[1] + entryLayouts[1].capsStart,
    committedBases[1] + entryLayouts[1].capsStart + 12);
const cr15Before = {...committed.cr[15]};
committed.halted = true;

// Simulator scheduler admission must reject exactly the malformed Thread
// geometries rejected by hardware CHANGE preflight, before saving live state.
const targetHeaderOriginal = committed.memory[committedBases[1]] >>> 0;
const malformedThreadHeaders = [
    { name: 'zero stack', word: committed.packLumpHeader(3, 0, 64, 2) },
    { name: 'zero heap', word: committed.packLumpHeader(3, 32, 0, 2) },
    { name: 'overlapping heap and stack', word: committed.packLumpHeader(3, 220, 20, 2) },
    { name: 'unsupported allocation size', word: committed.packLumpHeader(8, 32, 64, 2) },
];
for (const malformed of malformedThreadHeaders) {
    committed.memory[committedBases[1]] = malformed.word;
    const drBeforeReject = [...committed.dr];
    const rejected = committed.advanceConfiguredThread();
    assert.strictEqual(rejected.ok, false,
        `${malformed.name} Thread is rejected by scheduler admission`);
    assert.deepStrictEqual(committed.dr, drBeforeReject,
        `${malformed.name} rejection occurs before outgoing context save`);
    assert.strictEqual(committed._currentThreadSlot, 1,
        `${malformed.name} rejection does not activate the target`);
}
committed.memory[committedBases[1]] = targetHeaderOriginal;

assert.strictEqual(committed.advanceConfiguredThread().slot, 11);
assert.strictEqual(committed.halted, false,
    'manual CHANGE clears the outgoing HALT latch so execution controls can run');
assert.strictEqual(committed.cr[12].word1, committedBases[1],
    'manual CHANGE installs the selected Thread base into live CR12');
assert.strictEqual(committed.parseGT(committed.cr[12].word0).index, 11,
    'manual CHANGE installs the selected Thread identity into live CR12');
assert.strictEqual(committed.dr[0], 0xB2000000,
    'manual CHANGE restores saved DR0 into the live register bank');
assert.strictEqual(committed.dr[1], 0xB2000001,
    'manual CHANGE restores saved DR1 instead of retaining the outgoing value');
assert.strictEqual(committed.cr[0].word0, entryWords[1],
    'manual CHANGE restores saved CR0 into the live capability bank');
assert.strictEqual(committed.pc, 0,
    'dormant Thread uses direct selector PC 0 with the canonical code base');
assert.strictEqual(committed.cr[14].word0 & 0xFFFF,
    committed.cr[0].word0 & 0xFFFF, 'CR14 target is derived from restored CR0');
const firstEntry = committed.readNSEntry(committed.cr[0].word0 & 0xFFFF);
const firstHeader = committed.parseLumpHeader(
    committed.memory[firstEntry.word0_location] >>> 0);
const cr14Perms = committed.parseGT(committed.cr[14].word0).permissions;
const cr6Perms = committed.parseGT(committed.cr[6].word0).permissions;
assert.strictEqual(committed.cr[14].word1, firstEntry.word0_location,
    'CHANGE reloads CR14 with the canonical raw LUMP base');
assert.deepStrictEqual(
    {R: cr14Perms.R, W: cr14Perms.W, X: cr14Perms.X, L: cr14Perms.L},
    {R: 1, W: 0, X: 1, L: 0},
    'CHANGE header microcode reloads CR14 with RX permissions');
assert.strictEqual(committed.cr[14].m, 1,
    'CHANGE header microcode installs CR14 with the same M state as CALL');
assert.strictEqual(committed.cr[6].word1,
    firstEntry.word0_location + firstHeader.lumpSize - firstHeader.cc,
    'CHANGE header microcode reloads CR6 at the LUMP c-list tail');
assert.deepStrictEqual(
    {R: cr6Perms.R, W: cr6Perms.W, X: cr6Perms.X, L: cr6Perms.L},
    {R: 0, W: 0, X: 0, L: 1},
    'CHANGE header microcode reloads CR6 with L-only permissions');
assert.strictEqual(committed.cr[6].m, 1,
    'CHANGE header microcode installs CR6 with the same M state as CALL');
assert.strictEqual(committed.cr[6].word2, committed.cr[14].word2,
    'CR6 and CR14 share the validated Namespace limit metadata');
assert.strictEqual(committed.cr[6].word3, committed.cr[14].word3,
    'CR6 and CR14 share the validated Namespace seal metadata');
assert.deepStrictEqual(committed.cr[15], cr15Before,
    'manual Thread CHANGE does not replace the live Namespace root in CR15');
assert.deepStrictEqual(
    committed.memory.slice(
        committedBases[1] + entryLayouts[1].capsStart,
        committedBases[1] + entryLayouts[1].capsStart + 12),
    targetCapsBefore,
    'privileged restore reads the incoming capability homes without rewriting them');
assert.strictEqual(committed._fetchInstruction().addr,
    firstEntry.word0_location + 1,
    'first fetch after dormant CHANGE executes code LUMP word 1');
const selectedStep = committed.step();
assert(selectedStep,
    'Step executes after selecting a Thread that was switched from HALT');
assert.strictEqual(selectedStep.physicalPC, firstEntry.word0_location + 1,
    'Step executes the selected Thread entry rather than the outgoing context');
committed.dr[1] = 0xA2001002;
committed.pc = 0x2A;
committed.physicalPC = 0x12345678;
committed.flags = {N: true, Z: false, C: true, V: false};
committed.sto = 0xA5;
committed.callStack = [{returnPC: 0x19, savedSTO: 0xA7, marker: 'Thread#2'}];
committed.cr[7].m = 1;
const suspendedThread2 = {
    cr: JSON.parse(JSON.stringify(committed.cr)),
    dr: [...committed.dr],
    pc: committed.pc,
    physicalPC: committed.physicalPC,
    flags: {...committed.flags},
    sto: committed.sto,
    callStack: JSON.parse(JSON.stringify(committed.callStack)),
};
assert.strictEqual(committed.advanceConfiguredThread().slot, 12);
assert.strictEqual(committed.cr[12].word1, committedBases[2],
    'the next CHANGE moves live CR12 to Thread#3');
assert.strictEqual(committed.dr[0], 0xC3000000,
    'the next CHANGE restores Thread#3 live data registers');
const dormantThread2Row = committed.threadStatusRows().find(row => row.slot === 11);
assert.strictEqual(dormantThread2Row.nia, 0x2A,
    'the dormant Thread card reads NIA from the CHANGE-saved runtime context');
assert.strictEqual(committed.advanceConfiguredThread().slot, 1);
assert.strictEqual(committed.cr[0].word0, entryWords[0],
    'committed image restores Thread.1 CR0 entry authority after wraparound');
assert.strictEqual(committed.dr[1], 0xA1001001,
    'committed image restores Thread.1 DR state after wraparound');
assert.strictEqual(committed.cr[12].word1, committedBases[0],
    'wraparound restores Thread.1 as the live CR12 context');

// Run uses the same step engine as the Walk control.  A one-instruction run
// after manual CHANGE must therefore retire from the selected Thread too.
committed.halted = true;
assert.strictEqual(committed.advanceConfiguredThread().slot, 11);
assert.deepStrictEqual(JSON.parse(JSON.stringify(committed.cr)), suspendedThread2.cr,
    'CHANGE restores the suspended Thread full CR bank, including CR14 and M bits');
assert.deepStrictEqual(committed.dr, suspendedThread2.dr,
    'CHANGE restores the suspended Thread full DR bank');
assert.strictEqual(committed.pc, suspendedThread2.pc,
    'CHANGE resumes the suspended Thread at its exact saved NIA');
assert.strictEqual(committed.physicalPC, suspendedThread2.physicalPC,
    'CHANGE restores the suspended Thread physical cursor');
assert.deepStrictEqual(committed.flags, suspendedThread2.flags,
    'CHANGE restores the suspended Thread condition flags');
assert.strictEqual(committed.sto, suspendedThread2.sto,
    'CHANGE restores the suspended Thread protected STO');
assert.deepStrictEqual(committed.callStack, suspendedThread2.callStack,
    'CHANGE restores the suspended Thread call-frame state');
const selectedRun = committed.run(1);
assert.strictEqual(selectedRun.steps, 1,
    'Run retires an instruction after selecting a Thread from HALT');
assert.strictEqual(committed.cr[12].word1, committedBases[1],
    'Run keeps the selected Thread installed as the live context');

// Switching saved images is a memory-image operation, not a boot-phase
// operation. It must work while the loaded image is stopped before boot.
const preBoot = new ChurchSimulator();
assert.strictEqual(preBoot.loadBootImage(image), true,
    `pre-boot fixture image must load: ${preBoot.lastBootImageError || 'unknown error'}`);
preBoot.bootComplete = false;
preBoot._currentThreadSlot = 1;
const preBootThread1Base = preBoot.readNSEntry(1).word0_location;
const preBootThread1Layout = preBoot._threadLayoutAtBase(preBootThread1Base);
const preBootThread1EntryGT = preBoot.memory[
    preBootThread1Base + preBootThread1Layout.capsStart] >>> 0;
assert.strictEqual(preBoot.cr[0].word0, 0,
    'pre-boot live CR0 starts reset and does not represent Thread.1');
assert.strictEqual(preBoot.advanceConfiguredThread().slot, 11,
    'saved Thread images can be selected before the boot ceremony runs');
assert.strictEqual(preBoot.memory[
    preBootThread1Base + preBootThread1Layout.capsStart], preBootThread1EntryGT,
    'pre-boot browsing does not overwrite Thread.1 saved CR0 with reset live state');
assert.strictEqual(preBoot.advanceConfiguredThread().slot, 12,
    'pre-boot browsing continues to Thread#3');
assert.strictEqual(preBoot.advanceConfiguredThread().slot, 1,
    'pre-boot browsing cycles back to Thread.1');
assert.strictEqual(preBoot.cr[0].word0, preBootThread1EntryGT,
    'cycling back restores Thread.1 original saved CR0');
assert.strictEqual(preBoot.faultLog.length, 0,
    'cycling among stopped saved images never raises a machine fault');

const deferred = new ChurchSimulator();
assert.strictEqual(deferred.loadBootImage(image), true,
    `deferred-entry fixture image must load: ${deferred.lastBootImageError || 'unknown error'}`);
deferred.bootComplete = true;
deferred._currentThreadSlot = 1;
const deferredTargetBase = deferred.readNSEntry(11).word0_location;
const deferredTargetLayout = deferred._threadLayoutAtBase(deferredTargetBase);
deferred.memory[deferredTargetBase + deferredTargetLayout.capsStart] = 0;
const selectedInvalid = deferred.advanceConfiguredThread();
assert.strictEqual(selectedInvalid.ok, true,
    'manual selection accepts a saved Thread whose executable CR0 is empty');
assert.strictEqual(selectedInvalid.result.entryReady, false,
    'manual selection reports that entry validation was deferred');
assert.strictEqual(deferred.faultLog.length, 0,
    'manual selection alone does not raise an architectural fault');
assert.strictEqual(deferred.halted, false,
    'an invalid selected entry still releases HALT so execution can report its fault');
deferred.step();
assert(deferred.faultLog.length > 0,
    'the first attempted instruction raises the deferred entry fault');

const malformed = new ChurchSimulator();
assert.strictEqual(malformed.loadBootImage(image), true,
    `malformed-header fixture image must load: ${malformed.lastBootImageError || 'unknown error'}`);
malformed.bootComplete = true;
malformed._currentThreadSlot = 1;
const malformedTargetBase = malformed.readNSEntry(11).word0_location;
const malformedTargetLayout = malformed._threadLayoutAtBase(malformedTargetBase);
const malformedEntryGT = malformed.memory[
    malformedTargetBase + malformedTargetLayout.capsStart] >>> 0;
const malformedCodeEntry = malformed.readNSEntry(
    malformed.parseGT(malformedEntryGT).index);
malformed.memory[malformedCodeEntry.word0_location] = 0;
malformed.halted = true;
const malformedSelection = malformed.advanceConfiguredThread();
assert.strictEqual(malformedSelection.ok, true,
    'manual selection accepts a non-null entry whose LUMP header is malformed');
assert.strictEqual(malformedSelection.result.entryReady, false,
    'malformed entry-header validation remains deferred until execution');
assert.strictEqual(malformed.faultLog.length, 0,
    'malformed LUMP selection alone raises no architectural fault');
assert.strictEqual(malformed.cr[6].word0, 0,
    'deferred malformed header does not expose a stale CR6 c-list view');
assert.strictEqual(malformed.cr[14].word0, 0,
    'deferred malformed header does not expose a stale CR14 code view');
malformed.step();
assert(malformed.faultLog.length > 0,
    'the first attempted instruction reports the malformed selected LUMP');

// The browser declares `let sim` in app-shell.js. Top-level `let` bindings are
// not mirrored onto window, so the toolbar handler must use the lexical `sim`
// binding rather than silently returning when window.sim is absent.
function functionSource(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0, `${name} must exist in app-run.js`);
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Could not extract ${name}`);
}

const appRunSource = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
const uiSim = new ChurchSimulator();
assert.strictEqual(uiSim.loadBootImage(image), true,
    `UI fixture image must load: ${uiSim.lastBootImageError || 'unknown error'}`);
uiSim.bootComplete = true;
uiSim._currentThreadSlot = 1;
const uiBootBase = uiSim.readNSEntry(1).word0_location;
const uiBootLayout = uiSim._threadLayoutAtBase(uiBootBase);
const uiBootEntryGT = uiSim.memory[uiBootBase + uiBootLayout.capsStart] >>> 0;
uiSim._writeCR(0, uiBootEntryGT, uiSim.readNSEntry(uiBootEntryGT & 0xFFFF));
uiSim.pc = 0x2A;
const initialThreadRows = uiSim.threadStatusRows();
assert.strictEqual(initialThreadRows.length, 3,
    'Thread status strip shows only the three configured Thread images');
assert.strictEqual(initialThreadRows[0].active, true,
    'Thread status strip highlights the selected Thread');
assert.strictEqual(initialThreadRows[0].nia, 0x2A,
    'active Thread status uses the live logical NIA');
assert.strictEqual(initialThreadRows[1].nia, null,
    'never-selected dormant Threads do not invent a persisted NIA');
assert(initialThreadRows.every(row => row.gtPetName && row.gtPetName !== 'Invalid GT'),
    'each configured Thread status resolves a GT pet name');
assert.strictEqual(uiSim.threadStatusRows(99).length, 3,
    'Thread status output remains capped by the configured Thread count');
assert.strictEqual(uiSim.threadStatusRows(2).length, 2,
    'Thread status output honours a smaller requested display limit');
const button = {
    disabled: false,
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
};
const status = { textContent: '' };
const consoleEl = { textContent: '', scrollTop: 0, scrollHeight: 0 };
let dashboardUpdates = 0;
let openedCR = null;
const uiContext = {
    window: {}, // deliberately has no window.sim
    sim: uiSim,
    document: {
        getElementById(id) {
            return {
                nextThreadBtn: button,
                activeThreadStatus: status,
                editorConsole: consoleEl,
            }[id] || null;
        },
    },
    updateDashboard() { dashboardUpdates++; },
    openCRDetail(crIndex) { openedCR = crIndex; },
};
vm.createContext(uiContext);
vm.runInContext([
    functionSource(appRunSource, 'updateThreadControl'),
    functionSource(appRunSource, 'nextConfiguredThread'),
].join('\n'), uiContext);
uiContext.updateThreadControl();
assert.strictEqual(button.disabled, false,
    'Next Thread button is enabled with three configured Threads');
uiSim.bootComplete = false;
uiContext.updateThreadControl();
assert.strictEqual(button.disabled, false,
    'Next Thread button remains enabled for saved images before boot');
uiSim.bootComplete = true;
uiSim.running = true;
uiContext.updateThreadControl();
assert.strictEqual(button.disabled, true,
    'Next Thread button is disabled while the simulator is actively running');
uiSim.running = false;
uiContext.updateThreadControl();
assert.strictEqual(button.disabled, false,
    'Next Thread button is re-enabled after the simulator pauses');

// Walk executes one instruction and then waits for its next timer tick. During
// that interval sim.running is false, so invoke the real Walk lifecycle with
// only the next-step callback stubbed.
uiContext.pipelineViz = null;
uiContext.switchView = () => {};
vm.runInContext([
    'let walkRunning = false;',
    'let walkTimer = null;',
    'let walkBootTimer = null;',
    functionSource(appRunSource, 'updateWalkBtn'),
    'function walkNext() {}',
    functionSource(appRunSource, 'finishWalk'),
    functionSource(appRunSource, 'walkToggle'),
].join('\n'), uiContext);
vm.runInContext('walkToggle();', uiContext);
assert.strictEqual(uiSim.walkActive, true,
    'Walk start holds the simulator Thread-switch lock');
assert.strictEqual(uiSim.running, false,
    'the Walk between-ticks fixture is not covered by sim.running');
assert.strictEqual(button.disabled, true,
    'Next Thread stays disabled between Walk ticks');

const walkContextBefore = {
    slot: uiSim.activeThreadStatus().slot,
    cr: JSON.parse(JSON.stringify(uiSim.cr)),
    dr: [...uiSim.dr],
    pc: uiSim.pc,
    physicalPC: uiSim.physicalPC,
    halted: uiSim.halted,
    running: uiSim.running,
    stepCount: uiSim.stepCount,
};
const directWalkSwitch = uiSim.advanceConfiguredThread();
assert.strictEqual(directWalkSwitch.ok, false,
    'direct Thread switches are rejected between Walk ticks');
assert.match(directWalkSwitch.reason, /Walk/,
    'the rejected direct switch explains that Walk must stop first');
assert.deepStrictEqual({
    slot: uiSim.activeThreadStatus().slot,
    cr: JSON.parse(JSON.stringify(uiSim.cr)),
    dr: [...uiSim.dr],
    pc: uiSim.pc,
    physicalPC: uiSim.physicalPC,
    halted: uiSim.halted,
    running: uiSim.running,
    stepCount: uiSim.stepCount,
}, walkContextBefore,
    'a rejected between-ticks switch does not mutate the live Thread context');

vm.runInContext('walkToggle();', uiContext);
assert.strictEqual(uiSim.walkActive, false,
    'Walk stop releases the simulator Thread-switch lock');
assert.strictEqual(button.disabled, false,
    'Next Thread is re-enabled after Walk releases its lock');

const finishRunSource = functionSource(appRunSource, 'finishRun');
assert(finishRunSource.includes('updateThreadControl();'),
    'run cleanup refreshes the independently-owned Thread toolbar state');
const dashboardUpdatesBeforeThreadClicks = dashboardUpdates;
uiContext.nextConfiguredThread();
assert.strictEqual(uiSim.activeThreadStatus().slot, 11,
    'browser-shaped Next Thread click switches to Thread#2 without window.sim');
assert.strictEqual(openedCR, 12,
    'Next Thread opens the selected Thread CR12 memory-map view');
assert.strictEqual(status.textContent, 'Thread#2 · 2/3',
    'toolbar status follows the newly active Thread LUMP');
uiContext.nextConfiguredThread();
assert.strictEqual(uiSim.activeThreadStatus().slot, 12,
    'second browser-shaped click switches to Thread#3');
assert.strictEqual(status.textContent, 'Thread#3 · 3/3',
    'toolbar status follows Thread#3');
uiContext.nextConfiguredThread();
assert.strictEqual(uiSim.activeThreadStatus().slot, 1,
    'third browser-shaped click restores the saved boot Thread');
assert.strictEqual(status.textContent, 'Thread.1 · 1/3',
    'toolbar status wraps to the boot Thread');
assert.strictEqual(dashboardUpdates - dashboardUpdatesBeforeThreadClicks, 3,
    'each Next Thread click refreshes the dashboard');

const nonElevated = new ChurchSimulator();
nonElevated.bootComplete = true;
nonElevated.mElevation = false;
nonElevated.cr[0] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
const rejectedChange = nonElevated._execChange({
    crDst: 12, crSrc: 0, imm: 1, scheduler: false, mnemonic: 'CHANGE',
});
assert.strictEqual(rejectedChange, null,
    'non-elevated CHANGE CR12 returns an architecture fault instead of throwing');
assert(nonElevated.faultLog.length > 0 &&
       nonElevated.faultLog[nonElevated.faultLog.length - 1].type === 'NULL_CAP',
    'non-elevated CHANGE CR12 records an architecture fault');
console.log('PASS round-robin Thread scheduler');
