'use strict';
// Focused unit coverage for the explicit programming-target authority.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'target-state.js'), 'utf8');
let passed = 0;
function check(ok, message) {
    if (!ok) throw new Error(message);
    passed++;
    console.log('✓ ' + message);
}
function load(storage, now) {
    const document = {
        addEventListener: function() {}, getElementById: function() { return null; }
    };
    const sandbox = {
        window: null, document, Date: { now: () => now.value },
        localStorage: {
            getItem: k => storage[k] || null,
            setItem: (k, v) => { storage[k] = v; }
        }
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox.TargetState;
}

const storage = {};
const now = { value: 1000 };
let target = load(storage, now);
check(target.resolve().mode === target.MODES.SIMULATOR, 'defaults to Simulator RAM');
check(!target.authorize('runtime', { id: 'boot-a' }).ok, 'Simulator mode never authorizes hardware command');

target.observeDevice({ uid: 'other-board', connected: true });
check(target.resolve().mode === target.MODES.SIMULATOR, 'connecting a board does not auto-select it');
target.select({ mode: target.MODES.RUNTIME, deviceUid: 'selected-board' });
check(!target.authorize('runtime', { id: 'boot-a' }).ok, 'mismatched live UID fails closed');
target.observeDevice({ uid: 'selected-board', sessionId: 'session-live', connected: true });
let runtime = target.authorize('runtime', { id: 'boot-a' });
check(runtime.ok && runtime.request.target_device_uid === 'selected-board' &&
    runtime.request.artifact_identity === 'boot-a', 'runtime request carries exact target UID and artifact identity');
let destination = target.authorizeDestination('runtime');
check(destination.ok && destination.request.target_device_uid === 'selected-board' &&
    destination.request.target_session_id === 'session-live' &&
    !Object.prototype.hasOwnProperty.call(destination.request, 'artifact_identity'),
    'destination preflight carries exact target without inventing upload identity');

now.value += 30001;
check(!target.authorize('runtime', { id: 'boot-a' }).ok, 'stale live connection fails closed');
target.observeDevice({ uid: 'selected-board', connected: false });
check(!target.authorize('runtime', { id: 'boot-a' }).ok, 'disconnected selected board fails closed');

// Reload preserves the programmer's request, but never treats an old live
// observation as a live board.
target = load(storage, now);
check(target.resolve().mode === target.MODES.RUNTIME &&
    target.resolve().deviceUid === 'selected-board' && !target.resolve().ok,
    'reload preserves requested physical target but resolves it unresolved');

target.select({ mode: target.MODES.BITSTREAM, deviceUid: 'selected-board', buildId: 'build-42' });
target.observeDevice({ uid: 'selected-board', sessionId: 'session-bitstream', connected: true, runningBuildId: 'build-41' });
check(!target.authorize('bitstream', { id: 'build-41' }).ok, 'bitstream build mismatch fails closed');
check(target.authorize('bitstream', { id: 'build-42' }).ok, 'selected exact bitstream build authorizes');
target.select({ mode: target.MODES.SIMULATOR });
check(target.authorize('simulator', { id: 'simulator-state' }).ok, 'Simulator mode authorizes simulator mutation');

target.select({ mode: target.MODES.RUNTIME, deviceUid: 'selected-board' });
target.observeDevice({ uid: 'selected-board', sessionId: 'session-a', connected: true });
target.observeRuntimeUpload({ deviceUid: 'selected-board', sessionId: 'session-a',
    artifactId: 'runtime-a', acknowledged: false, ok: true });
check(target.resolve().runtimeArtifactId === null,
    'queued runtime upload never establishes runtime identity');
target.observeRuntimeUpload({ deviceUid: 'selected-board', sessionId: 'session-a',
    artifactId: 'runtime-a', acknowledged: true, ok: true });
check(target.resolve().runtimeArtifactId === 'runtime-a',
    'only correlated successful upload ACK establishes runtime identity');
target.observeDevice({ uid: 'selected-board', sessionId: 'session-b', connected: true });
check(target.resolve().runtimeArtifactId === null,
    'session replacement clears runtime upload identity');
target.observeRuntimeUpload({ deviceUid: 'selected-board', sessionId: 'session-b',
    artifactId: 'runtime-b', acknowledged: true, ok: true });
target.observeDevice({ connected: false });
check(target.resolve().runtimeArtifactId === null && target.resolve().liveBuildId === null,
    'disconnect clears runtime and reported build identities');

console.log('target-state: ' + passed + ' assertions passed');