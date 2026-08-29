'use strict';

// Round-robin scheduler regression: the UI operation must use the generated
// Namespace order, wrap exactly once, preserve private state, and fail before
// mutating the current context when a target descriptor is invalid.
const assert = require('assert');
const vm = require('vm');
global.window = { bootConfig: { step1: {
    totalNamespaceWords: 16384, namespaceLumpWords: 1024,
    threadLumpWords: 256, threadCount: 3,
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
assert(committedBases[0] + 512 <= committedBases[1] &&
       committedBases[1] + 512 <= committedBases[2],
    'committed Thread bodies are non-overlapping');
const entryWords = [1, 11, 12].map((slot, i) =>
    committed.memory[committedBases[i] + 244] >>> 0);
const initialEntry = committed.readNSEntry(entryWords[0] & 0xFFFF);
committed._writeCR(0, entryWords[0], initialEntry);
committed.dr[1] = 0xA1001001;
committed.memory[committedBases[1] + 1] = 0xB2000000;
committed.memory[committedBases[1] + 2] = 0xB2000001;
committed.memory[committedBases[2] + 1] = 0xC3000000;
committed.halted = true;
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
assert.strictEqual(committed.pc, 1, 'dormant Thread entry starts at code word 1');
assert.strictEqual(committed.cr[14].word0 & 0xFFFF,
    committed.cr[0].word0 & 0xFFFF, 'CR14 target is derived from restored CR0');
const firstEntry = committed.readNSEntry(committed.cr[0].word0 & 0xFFFF);
assert.strictEqual(committed._fetchInstruction().addr,
    firstEntry.word0_location + 1,
    'first fetch after dormant CHANGE executes code LUMP word 1');
const selectedStep = committed.step();
assert(selectedStep,
    'Step executes after selecting a Thread that was switched from HALT');
assert.strictEqual(selectedStep.physicalPC, firstEntry.word0_location + 1,
    'Step executes the selected Thread entry rather than the outgoing context');
committed.dr[1] = 0xA2001002;
assert.strictEqual(committed.advanceConfiguredThread().slot, 12);
assert.strictEqual(committed.cr[12].word1, committedBases[2],
    'the next CHANGE moves live CR12 to Thread#3');
assert.strictEqual(committed.dr[0], 0xC3000000,
    'the next CHANGE restores Thread#3 live data registers');
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
const preBootThread1EntryGT = preBoot.memory[preBootThread1Base + 244] >>> 0;
assert.strictEqual(preBoot.cr[0].word0, 0,
    'pre-boot live CR0 starts reset and does not represent Thread.1');
assert.strictEqual(preBoot.advanceConfiguredThread().slot, 11,
    'saved Thread images can be selected before the boot ceremony runs');
assert.strictEqual(preBoot.memory[preBootThread1Base + 244], preBootThread1EntryGT,
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
deferred.memory[deferredTargetBase + 244] = 0;
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
const uiBootEntryGT = uiSim.memory[uiBootBase + 244] >>> 0;
uiSim._writeCR(0, uiBootEntryGT, uiSim.readNSEntry(uiBootEntryGT & 0xFFFF));
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
const finishRunSource = functionSource(appRunSource, 'finishRun');
assert(finishRunSource.includes('updateThreadControl();'),
    'run cleanup refreshes the independently-owned Thread toolbar state');
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
assert.strictEqual(dashboardUpdates, 3,
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