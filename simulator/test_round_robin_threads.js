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
assert.strictEqual(committed.advanceConfiguredThread().slot, 11);
assert.strictEqual(committed.pc, 1, 'dormant Thread entry starts at code word 1');
assert.strictEqual(committed.cr[14].word0 & 0xFFFF,
    committed.cr[0].word0 & 0xFFFF, 'CR14 target is derived from restored CR0');
const firstEntry = committed.readNSEntry(committed.cr[0].word0 & 0xFFFF);
assert.strictEqual(committed._fetchInstruction().addr,
    firstEntry.word0_location + 1,
    'first fetch after dormant CHANGE executes code LUMP word 1');
committed.dr[1] = 0xA2001002;
assert.strictEqual(committed.advanceConfiguredThread().slot, 12);
assert.strictEqual(committed.advanceConfiguredThread().slot, 1);
assert.strictEqual(committed.cr[0].word0, entryWords[0],
    'committed image restores Thread.1 CR0 entry authority after wraparound');
assert.strictEqual(committed.dr[1], 0xA1001001,
    'committed image restores Thread.1 DR state after wraparound');

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
};
vm.createContext(uiContext);
vm.runInContext([
    functionSource(appRunSource, 'updateThreadControl'),
    functionSource(appRunSource, 'nextConfiguredThread'),
].join('\n'), uiContext);
uiContext.updateThreadControl();
assert.strictEqual(button.disabled, false,
    'Next Thread button is enabled with three configured Threads');
uiContext.nextConfiguredThread();
assert.strictEqual(uiSim.activeThreadStatus().slot, 11,
    'browser-shaped Next Thread click switches to Thread#2 without window.sim');
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