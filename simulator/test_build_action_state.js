'use strict';

// Focused Task 3446 regression coverage.  This is deliberately DOM-light: it
// verifies the command-state contract without starting the simulator.
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('simulator/app-actions.js', 'utf8');
let editor = { value: 'method Main { RETURN }' };
let language = { value: 'javascript' };
let workspaceEditor = { value: 'workspace source' };
const buttons = {};
function button() {
    return buttons[Math.random()] = {
        disabled: false, dataset: {}, textContent: 'Action',
        setAttribute() {}, getAttribute() { return ''; },
    };
}
const document = {
    readyState: 'complete',
    getElementById(id) {
        if (id === 'asmEditor') return editor;
        if (id === 'langSelector') return language;
        if (id === 'lumpSourceEditor') return workspaceEditor;
        return buttons[id] || (buttons[id] = button());
    },
    addEventListener() {},
    createElement() { return { remove() {}, click() {} }; },
    body: { appendChild() {} },
};
let compileCalls = 0;
let pendingInstalls = 0;
let identityBegins = 0;
let runCalls = 0;
const context = {
    console,
    document,
    Blob: function() {},
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    smartCompile: async options => {
        compileCalls++;
        return { ok: false, error: 'synthetic compiler failure', options };
    },
    appendOutput() {},
    runSimGo() { runCalls++; },
    _setPendingSimLoad() { pendingInstalls++; },
    window: {
        confirm: () => true,
        ExecutionIdentity: { begin() { identityBegins++; } },
        TargetState: { authorize() { return { ok: true }; } },
    },
};
vm.createContext(context);
vm.runInContext(source, context);

const state = context.window.IDEActionState;
state.recordCandidate({
    token: 'candidate-1',
    abstraction: 'Example',
    language: 'cloomc',
    languageIdentity: 'javascript',
    source: editor.value,
    words: [0x1f800000],
    capabilities: [{ name: 'Cap', rights: ['E'], grants: ['E'] }],
    binary: [0xf8000401, 0x1f800000],
});
const first = state.get().candidate;
if (!Object.isFrozen(first) || !Object.isFrozen(first.words) ||
        first.words[0] !== 0x1f800000) {
    throw new Error('candidate snapshot is not immutable');
}
if (!state.eligibility('run').ok) {
    throw new Error('auto-detected CLOOMC candidate was stale against the final editor language');
}
editor.value = 'broken source';
if (!state.eligibility('run').ok ||
        !/keep the current simulator program/.test(state.eligibility('run').reason)) {
    throw new Error('Run did not preserve access to the current simulator program');
}
if (!state.eligibility('save').ok ||
        !/Build and Save/.test(state.eligibility('save').reason)) {
    throw new Error('Save did not offer explicit Build and Save for unbuilt source');
}

context.window.IDEActions.compile().then(result => {
    if (result.ok !== false || compileCalls !== 1) {
        throw new Error('failed compile did not return one structured outcome');
    }
    const afterFailure = state.get().candidate;
    if (afterFailure !== first || afterFailure.source !== 'method Main { RETURN }') {
        throw new Error('failed compile replaced the last successful candidate');
    }
    // Save with a stale source compiles once, and failure prevents the formatter
    // from opening: no hidden recursive compile and no duplicate dialog.
    return context.window.IDEActions.save();
}).then(result => {
    if (result.ok !== false || compileCalls !== 2) {
        throw new Error('Build and Save did not stop after its frozen build failed');
    }
    // An explicit source can be built from another workspace even when the
    // main editor is empty; eligibility must validate that supplied snapshot.
    editor.value = '';
    return context.window.IDEActions.compile({ source: 'external workspace source' });
}).then(result => {
    if (result.ok !== false || compileCalls !== 3) {
        throw new Error('compile(options.source) was incorrectly gated by asmEditor');
    }
    editor.value = 'method Main { RETURN }';
    context.sim = { running: true };
    const guarded = context.window.IDEActions.installCandidate();
    if (guarded.ok || pendingInstalls !== 0 || identityBegins !== 0) {
        throw new Error('active execution allowed a pending install mutation');
    }
    context.sim.running = false;
    const install = context.window.IDEActions.installCandidate();
    if (!install.ok || pendingInstalls !== 1 || identityBegins !== 1) {
        throw new Error('idle explicit install did not create exactly one pending snapshot');
    }
    state.recordCandidate({
        token: 'candidate-2', abstraction: 'Later',
        source: editor.value, words: [0], capabilities: [],
    });
    state.recordInstalled({
        token: 'candidate-1', abstraction: 'Example',
        source: 'method Main { RETURN }', words: [0x1f800000], capabilities: [],
    });
    if (state.get().installed.token !== 'candidate-1') {
        throw new Error('installed state was taken from the newest candidate');
    }
    state.recordCandidate({
        token: 'workspace-candidate', abstraction: 'Workspace',
        source: workspaceEditor.value, sourceSurface: 'lumpSourceEditor',
        language: 'cloomc', languageIdentity: 'javascript',
        words: [0x1f800000], capabilities: [],
    });
    if (!state.eligibility('run', undefined, 'lumpSourceEditor').ok ||
            !state.eligibility('export', undefined, 'lumpSourceEditor').ok) {
        throw new Error('workspace-owned candidate was not usable on its own source surface');
    }
    workspaceEditor.value = 'workspace source changed after build';
    const staleWorkspaceRun = context.window.IDEActions.run({
        sourceSurface: 'lumpSourceEditor',
    });
    if (staleWorkspaceRun.ok || runCalls !== 0 ||
            !/workspace source/.test(staleWorkspaceRun.error)) {
        throw new Error('stale workspace Run fell back to the installed program');
    }
    workspaceEditor.value = 'workspace source';
    // Restore a main-editor candidate to test every install guard without
    // accidentally treating the workspace buffer as the Programs draft.
    state.recordCandidate({
        token: 'candidate-2', abstraction: 'Later',
        source: editor.value, words: [0], capabilities: [],
    });
    context.window.TargetState = null;
    const targetMissing = context.window.IDEActions.installCandidate();
    if (targetMissing.ok || pendingInstalls !== 1 || identityBegins !== 1 ||
            !/authorization is unavailable/.test(targetMissing.error)) {
        throw new Error('missing target authorization did not fail closed before mutation');
    }
    let targetChecks = 0;
    context.window.TargetState = {
        authorize() { targetChecks++; return { ok: false, error: 'target denied' }; },
    };
    const targetDenied = context.window.IDEActions.installCandidate();
    if (targetDenied.ok || pendingInstalls !== 1 || identityBegins !== 1 || targetChecks !== 1) {
        throw new Error('target authorization was not enforced before install mutation');
    }
    context.window.TargetState.authorize = () => ({ ok: true });
    context.walkRunning = true;
    const walkDenied = context.window.IDEActions.installCandidate();
    if (walkDenied.ok || pendingInstalls !== 1 || identityBegins !== 1) {
        throw new Error('walk-active install changed pending or identity state');
    }
    context.walkRunning = false;
    context.bootAnimating = true;
    const bootDenied = context.window.IDEActions.installCandidate();
    if (bootDenied.ok || pendingInstalls !== 1 || identityBegins !== 1) {
        throw new Error('boot-active install changed pending or identity state');
    }
    context.bootAnimating = false;
    context.buildLumpFromAssembly = () => ({ ok: false, error: 'canonical export rejected' });
    return context.window.IDEActions.export();
}).then(exportResult => {
    if (exportResult.ok || !/canonical export rejected/.test(exportResult.error)) {
        throw new Error('export reported success after canonical exporter failure');
    }
    context.buildLumpFromAssembly = () => ({ ok: true, token: 'final-byte-token' });
    return context.window.IDEActions.export();
}).then(exportSuccess => {
    if (!exportSuccess.ok || exportSuccess.token !== 'final-byte-token' ||
            exportSuccess.candidateToken !== 'candidate-2') {
        throw new Error('export action did not report the canonical final-byte token');
    }
    // Simulate smartCompile's production auto-detect transition from the
    // Assembly selector to JavaScript/CLOOMC, then immediately install/Run.
    // The candidate must be current against the *final* selector identity.
    editor.value = 'abstraction Auto { method Main() { return(1) } }';
    language.value = 'assembly';
    context.smartCompile = async options => {
        language.value = 'javascript';
        state.recordCandidate({
            token: 'auto-detected', abstraction: 'Auto',
            language: 'cloomc', languageIdentity: language.value,
            source: options.source, words: [0x1f800000], capabilities: [],
        });
        return { ok: true, token: 'auto-detected' };
    };
    return context.window.IDEActions.compile();
}).then(autoBuild => {
    if (!autoBuild.ok || !state.eligibility('run').ok) {
        throw new Error('auto-detected candidate was not immediately Run-eligible');
    }
    const autoInstall = context.window.IDEActions.installCandidate();
    if (!autoInstall.ok || pendingInstalls !== 2) {
        throw new Error('immediate Run/install after auto-detected compile was blocked');
    }
    let releaseCompile;
    context.smartCompile = () => new Promise(resolve => { releaseCompile = resolve; });
    const firstCompile = context.window.IDEActions.compile({ source: 'serialized source' });
    return context.window.IDEActions.compile({ source: 'other source' }).then(blocked => {
        if (blocked.ok !== false || !/already in progress/.test(blocked.error)) {
            throw new Error('concurrent action was not rejected');
        }
        releaseCompile({ ok: false, error: 'synthetic completion' });
        return firstCompile;
    });
}).then(result => {
    if (result.ok !== false) {
        throw new Error('serialized compile completion was not returned');
    }
    console.log('Task 3446 build action state regression: PASS');
}).catch(error => {
    console.error(error);
    process.exit(1);
});