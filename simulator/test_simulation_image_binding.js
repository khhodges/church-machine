'use strict';
// Real loader + reset regression using the backend's isolated minimal image.
// No production Namespace, artifacts, approvals, or image files are read/written.
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const generated = spawnSync('python', ['-c', `
import json, runpy, tempfile, struct, hashlib
from pathlib import Path
from server.simulation_preparation import PreparationStore
fixture = runpy.run_path("tests/simulation/test_preparation.py")["saved"].__wrapped__
with tempfile.TemporaryDirectory() as directory:
    root, rows, cfg = fixture(Path(directory))
    # Supply the real loader's resident SELF identity, not the backend-only
    # fixture's deliberately bare structural executable.
    raw = struct.pack(">64I", (31 << 27) | (3 << 10) | 1,
                      *([0] * 62), 0x4a000006)
    rows[-1].update(filename="SelfTest.1.4a000006.lump", token="4a000006",
                    binary_hash=hashlib.sha256(raw).hexdigest())
    (root / rows[-1]["filename"]).write_bytes(raw)
    (root / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    store = PreparationStore()
    prepared = store.prepare(rows, cfg, root, 6)
    ids = {key: prepared[key] for key in ("preparationId", "configurationHash")}
    store.transition(ids, rows, root)
    activated = store.transition(ids, rows, root, activate=True)
    print(json.dumps({"prepared": prepared, "words": activated["words"], "cfg": cfg}))
`], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
assert.strictEqual(generated.status, 0, generated.stderr);
const fixture = JSON.parse(generated.stdout);
global.window = { bootConfig: fixture.cfg };
const Simulator = require('./simulator.js');
const sim = new Simulator();
const image = new Uint32Array(fixture.words).buffer;
assert.strictEqual(sim.loadBootImage(image), true, sim.lastBootImageError);
const configuration = sim.bindSimulationConfiguration(image, fixture.prepared);
assert(Object.isFrozen(configuration));
assert(Object.isFrozen(configuration.preparedRows[0]));
assert.strictEqual(sim.simulationConfiguration, configuration);
const originalHash = configuration.configurationHash;
fixture.prepared.configurationHash = 'mutated-response';
assert.strictEqual(configuration.configurationHash, originalHash);

// Match the shell's synchronous reset-overlay convention.
let cached = image.slice(0);
sim.on('reset', () => {
    if (cached) assert.strictEqual(sim.loadBootImage(cached), true, sim.lastBootImageError);
});
sim.reset();
assert.strictEqual(sim.simulationConfiguration, configuration);
assert.strictEqual(sim.bootComplete, false);
assert.strictEqual(sim._executionEvidenceState().simulationConfiguration.configurationHash, originalHash);
assert.strictEqual(sim.loadBootImage(image.slice(0)), true);
assert.strictEqual(sim.simulationConfiguration, configuration, 'byte-identical copy retains provenance');

// Same ArrayBuffer reference is not sufficient; altering even unused bytes
// makes this a different configuration, although still a valid boot image.
new Uint32Array(cached)[15000] ^= 1;
sim.reset();
assert.strictEqual(sim.simulationConfiguration, null, 'different accepted image retires binding');
assert.strictEqual(sim.loadBootImage(image), true);
assert.strictEqual(sim.simulationConfiguration, null, 'retired binding cannot resurrect later');
sim.bindSimulationConfiguration(image, { ...fixture.prepared, configurationHash: originalHash });
cached = null;
sim.reset();
assert.strictEqual(sim.simulationConfiguration, null, 'factory state without overlay has no provenance');
assert.throws(() => sim.bindSimulationConfiguration(image, fixture.prepared), /exact accepted/);
assert.strictEqual(sim.loadBootImage(image), true);
assert(sim.simulationConfiguration, 'exact private overlay may resume after ordinary reset');
sim.reset('loadHardwareBinary');
assert.strictEqual(sim.loadBootImage(image), true);
assert.strictEqual(sim.simulationConfiguration, null, 'unrelated binary reset retires private binding');
sim.bindSimulationConfiguration(image, fixture.prepared);
assert.strictEqual(sim.loadBootImage(new ArrayBuffer(0)), false);
assert.strictEqual(sim.simulationConfiguration, null);
assert.strictEqual(sim.loadBootImage(image), true);
assert.strictEqual(sim.simulationConfiguration, null, 'failed load also retires private provenance');
// Exercise the production UI activator against the real simulator, including
// a subsequent ordinary shell reset overlay.
const vm = require('vm');
const fs = require('fs');
const uiSim = new Simulator();
const uiWindow = { _nsState: {
    namespaceFingerprint: fixture.prepared.sourceNamespaceFingerprint,
} };
const context = {
    window: uiWindow, sim: uiSim, Uint32Array,
    document: { getElementById: () => null },
    async fetch(url) {
        return { ok: true, json: async () => ({
            ...fixture.prepared, approved: url.endsWith('/approve'),
            activated: url.endsWith('/activate'), words: fixture.words,
        }) };
    },
};
uiSim.on('reset', () => {
    if (uiWindow.bootImage) uiSim.loadBootImage(uiWindow.bootImage);
});
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'app-simulation-preparation.js'), 'utf8'), context);
(async () => {
    const ui = uiWindow.SimulationPreparation;
    assert.strictEqual(await ui.prepare(), true);
    assert.strictEqual(await ui.approve(), true);
    assert.strictEqual(uiSim.simulationConfiguration, null);
    assert.strictEqual(await ui.activate(), true);
    const active = uiSim.simulationConfiguration;
    assert(active && Object.isFrozen(active));
    uiSim.reset();
    assert.strictEqual(uiSim.simulationConfiguration, active);
    assert.match(ui.markup(), new RegExp(active.configurationHash));
    const detailSource = fs.readFileSync(path.join(__dirname, 'app-cr-detail.js'), 'utf8');
    vm.runInContext(detailSource.slice(detailSource.indexOf('function injectCRCode('),
        detailSource.indexOf('\n\nasync function injectCRCodeToFPGA')), context);
    const beforePatch = uiSim.memory.slice();
    const log = { textContent: '', scrollTop: 0, scrollHeight: 0 };
    context.log = log;
    assert.strictEqual(vm.runInContext('injectCRCode(log)', context), null);
    assert.match(log.textContent, /Patch rejected.*configuration is frozen/);
    assert.deepStrictEqual(uiSim.memory, beforePatch, 'Patch cannot change code or descriptors under old hash');
    assert.strictEqual(uiSim.simulationConfiguration, active);
    const stickyStart = detailSource.indexOf('window._reapplyStickyPatches = function()');
    vm.runInContext(detailSource.slice(stickyStart, detailSource.indexOf('\n};', stickyStart) + 3), context);
    context.appendOutput = text => { context.stickyMessage = text; };
    uiWindow._reapplyStickyPatches();
    assert.match(context.stickyMessage, /Sticky patches skipped.*configuration is frozen/);
    assert.deepStrictEqual(uiSim.memory, beforePatch);
    const memorySource = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
    vm.runInContext(memorySource.slice(memorySource.indexOf('function _blockFrozenSimulationEdit('),
        memorySource.indexOf('function _hydrateNsSymbolicState(')), context);
    vm.runInContext(memorySource.slice(memorySource.indexOf('function zeroLumpSlot('),
        memorySource.indexOf('// Zero all unreferenced')), context);
    uiWindow.alert = text => { context.blockedMessage = text; };
    assert.strictEqual(vm.runInContext('zeroLumpSlot(0)', context), false);
    assert.match(context.blockedMessage, /active simulation configuration is frozen/);
    assert.deepStrictEqual(uiSim.memory, beforePatch);
    // Architecture runtime writes are still allowed and remain execution of
    // this configuration; only explicit programmer rewrite controls are blocked.
    uiSim._writeRuntimeWord(15000, 42);
    assert.strictEqual(uiSim.simulationConfiguration, active);
    const runSource = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
    // The private configuration guard must precede the sticky-patch hook.
    const auto = runSource.slice(runSource.indexOf('function _autoLoadDefaultProgram()'));
    assert(auto.indexOf('if (sim && sim.simulationConfiguration) return;') <
        auto.indexOf('_reapplyStickyPatches()'));
    console.log('private simulation exact-image reset and UI integration tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });