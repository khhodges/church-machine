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
const sim = new ChurchSimulator();
sim.bootComplete = true;
sim._currentThreadSlot = 1;

assert.deepStrictEqual(sim.configuredThreadSlots(), [1, 11, 12],
    'configured order is Thread.1, Thread#2, Thread#3');
sim.cr[0] = { word0: 0x11111111, word1: 1, word2: 2, word3: 3 };
sim.dr[1] = 0x11110001;
let switched = sim.advanceConfiguredThread();
assert(switched.ok && switched.slot === 11 && switched.position === 2,
    'first action selects Thread#2');

sim.cr[0] = { word0: 0x22222222, word1: 4, word2: 5, word3: 6 };
sim.dr[1] = 0x22220001;
switched = sim.advanceConfiguredThread();
assert(switched.ok && switched.slot === 12 && switched.position === 3,
    'second action selects Thread#3');
switched = sim.advanceConfiguredThread();
assert(switched.ok && switched.slot === 1 && switched.position === 1,
    'third action wraps to Thread.1');
assert.strictEqual(sim.cr[0].word0, 0x11111111, 'Thread.1 register state is restored');
assert.strictEqual(sim.dr[1], 0x11110001, 'Thread.1 DR state is restored');

const before = sim.activeThreadStatus();
const badBase = sim.readNSEntry(11).word0_location;
sim.memory[badBase] = 0; // invalid descriptor must be rejected before saving Thread.1
switched = sim.advanceConfiguredThread();
assert(!switched.ok, 'invalid target is rejected');
assert.strictEqual(sim.activeThreadStatus().slot, before.slot,
    'validation failure leaves active Thread unchanged');

global.window.bootConfig.step1.threadCount = 1;
const one = new ChurchSimulator();
one.bootComplete = true;
assert(one.advanceConfiguredThread().ok && one.advanceConfiguredThread().unchanged,
    'one-Thread configurations remain Thread.1');

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
if (fs.existsSync('server/lumps/boot-image.bin')) {
    assert(fs.readFileSync('server/lumps/boot-image.bin').equals(generated.stdout),
        'saved IDE image must match deterministic regeneration');
}
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
committed.cr[0] = { word0: 0xA1000001, word1: 1, word2: 2, word3: 3, m: 0 };
committed.dr[1] = 0xA1001001;
assert.strictEqual(committed.advanceConfiguredThread().slot, 11);
committed.cr[0] = { word0: 0xA2000002, word1: 4, word2: 5, word3: 6, m: 0 };
committed.dr[1] = 0xA2001002;
assert.strictEqual(committed.advanceConfiguredThread().slot, 12);
assert.strictEqual(committed.advanceConfiguredThread().slot, 1);
assert.strictEqual(committed.cr[0].word0, 0xA1000001,
    'committed image restores Thread.1 CR state after wraparound');
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
assert.strictEqual(dashboardUpdates, 1,
    'Next Thread click refreshes the dashboard');
console.log('PASS round-robin Thread scheduler');