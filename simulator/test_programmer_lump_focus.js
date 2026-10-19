'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/app-abstractions.js', 'utf8');
function extract(name) {
    const start = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(source);
    assert.ok(start, name);
    const endings = /^}/gm;
    endings.lastIndex = start.index;
    let end;
    while ((end = endings.exec(source))) {
        const text = source.slice(start.index, end.index + 1);
        try { new vm.Script(text); return text; } catch (_) {}
    }
    throw Error('Missing end: ' + name);
}
const hash = 'a'.repeat(64);
const self = {token: '11111111', abstraction: 'SelfTest', binary_hash: 'b'.repeat(64)};
const cap = {token: '22222222', abstraction: 'CapabilityTest', binary_hash: hash,
    filename: 'CapabilityTest.1.22222222.lump'};
const newer = {...cap, token: '33333333', binary_hash: 'c'.repeat(64)};
function harness() {
    let current = self.token;
    const nodes = {};
    const opened = [], shown = [];
    const node = () => ({style: {}, textContent: '', innerHTML: '', value: '',
        append(...items) { this.children = items; }, addEventListener() {},
        showModal() { this.open = true; }});
    const s = {
        window: {}, _lumpsCache: [self, cap, newer], _liveLumpLastToken: null,
        _escHtml: value => String(value), _updateLumpViewingLabel: () => {},
        _getLiveLumpState: () => ({nsIdx: 10, absName: 'CapabilityTest', baseLoc: 20, cw: 1}),
        document: {getElementById: id => nodes[id] ||= node(),
            createElement: node, body: {appendChild: n => shown.push(n)}},
        sim: {memory: new Uint32Array(64), getSlotIdentity: () => s.identity,
            lumpTokenAtSlot: () => 'deadbeef'},
        identity: {binaryHash: hash, cacheToken: parseInt(cap.token, 16)},
        showLumpDetail: (...args) => shown.push(args),
        openLumpInEditor: async (...args) => opened.push(args),
        switchView: () => {}, appendOutput: message => { throw Error(message); },
    };
    s.sim.memory[21] = 0x12345678;
    s.window.NamespaceDesignV1 = {state: {active: true, document: {rows: [
        {slot: 10, name: 'CapabilityTest', selection: {
            token: cap.token, filename: cap.filename, binaryHash: cap.binary_hash}},
    ]}}};
    s.window.LumpRegistry = {
        getCurrent: () => current, setCurrent: token => { current = token; },
        isServerListFetched: () => true, warmServerList: async () => {},
    };
    s.window._captureEditorWriteGuard = () => ({accepts: () => true});
    vm.createContext(s);
    for (const name of ['_namespaceExecutionKey', '_namespaceLumpTarget', '_namespaceLumpSelection',
        '_executedLumpSelection', '_executedCodeText',
        '_showUnresolvedExecutedLump', '_syncLumpRepositoryToLive', '_openExecutedLumpInEditor',
        '_openProgrammerEditor'])
        vm.runInContext(extract(name), s);
    return {s, nodes, opened, shown};
}
(async () => {
    const admitted = harness();
    const design = admitted.s.window.NamespaceDesignV1.state;
    design.profile='ascending';design.fingerprint='9'.repeat(64);
    const row=design.document.rows.find(r=>r.slot===10);
    admitted.s.sim.simulationConfiguration={
        designProfile:design.profile,sourceNamespaceFingerprint:design.fingerprint,
        artifactBindings:[{slot:10,token:row.selection.token,
            filename:row.selection.filename,binaryHash:row.selection.binaryHash}],
    };
    admitted.s._getLiveLumpState=()=>({nsIdx:10,absName:'Unnamed',baseLoc:80,cw:2});
    await admitted.s._openProgrammerEditor();
    assert.equal(admitted.opened.length,1,'unlabeled admitted execution opens the exact selected source');
    assert.equal(admitted.opened[0][0],row.selection.token);
    assert.equal(admitted.opened[0][1].confirmReplacement,true,'draft replacement remains guarded');
    const accepts=admitted.opened[0][1].accepts;
    design.fingerprint='8'.repeat(64);
    assert.equal(accepts(),false,'selection drift cancels a pending editor open');
    assert.equal(admitted.s._namespaceLumpTarget(admitted.s._getLiveLumpState()),null,
        'a different Namespace must never inherit the executing slot mapping');
    let inspectorCalls=0,view=null;
    const errors=[];
    admitted.s.appendOutput=(text,type)=>errors.push({text,type});
    admitted.s._openExecutedLumpInEditor=()=>{inspectorCalls++;};
    admitted.s.switchView=v=>{view=v;};
    await admitted.s._openProgrammerEditor();
    assert.equal(inspectorCalls,0,'ordinary Editor navigation never substitutes the inspector');
    assert.equal(view,'editor');
    assert(errors.some(e=>e.type==='error' && e.text.includes('draft is unchanged')));
    const menu=fs.readFileSync(__dirname+'/index.html','utf8');
    const library=menu.match(/<button[^>]*id="hamItem-source-library"[^>]*>/)[0];
    assert(library.includes("switchView('abstractions');switchAbsSubtab('sources')"));
    assert(!library.includes('/start'),'Source Library is not the creation wizard');
    const {s, nodes, opened, shown} = harness();
    const state = s._getLiveLumpState();
    assert.equal(s._executedLumpSelection(s._lumpsCache, state), cap,
        'Installed hash resolves localized bytes, not stale SelfTest or newest CapabilityTest');
    s._syncLumpRepositoryToLive(state);
    assert.equal(s.window.LumpRegistry.getCurrent(), cap.token);
    assert.equal(shown[0][0], cap.token);
    await s._openExecutedLumpInEditor();
    assert.equal(opened[0][0], cap.token);
    assert.equal(opened[0][1].exactSavedArtifact, cap);
    assert.equal(opened[0][1].executionFocus, true);

    s.window._lumpRepositoryFollowsExecution = false;
    s.window.LumpRegistry.setCurrent(self.token);
    s._syncLumpRepositoryToLive(state);
    assert.equal(s.window.LumpRegistry.getCurrent(), self.token,
        'Explicit programmer browsing is not overwritten by live polling');

    s.window._lumpRepositoryFollowsExecution = true;
    s.identity = null;
    s.window.NamespaceDesignV1.state.document.rows = [];
    s._syncLumpRepositoryToLive(state);
    assert.equal(s.window.LumpRegistry.getCurrent(), null);
    assert.match(nodes.lumpsDetailTitle.textContent, /CapabilityTest/);
    assert.match(nodes.lumpsDetailContent.innerHTML, /12345678/);
    assert.doesNotMatch(nodes.lumpsDetailContent.innerHTML, /SelfTest/);
    await s._openExecutedLumpInEditor();
    assert.equal(opened.length, 1, 'Unknown artifact never opens another saved source');
    assert.match(shown.at(-1).children[0].textContent, /CapabilityTest/);
    assert.match(shown.at(-1).children[2].textContent, /12345678/);

    s.sim.lumpTokenAtSlot = () => '0x22222222';
    assert.equal(s._executedLumpSelection(s._lumpsCache, state), null,
        'An exact catalog token cannot override absence from the selected Namespace');
    s.window.NamespaceDesignV1.state.document.rows = [{
        slot: 10, name: 'CapabilityTest', selection: {
            token: cap.token, filename: cap.filename, binaryHash: cap.binary_hash}}];
    assert.equal(s._executedLumpSelection(s._lumpsCache, state), cap);
    s.identity = {binaryHash: 'd'.repeat(64)};
    assert.equal(s._executedLumpSelection(s._lumpsCache, state), null,
        'A conflicting registered hash must not fall back to a token match');
    s.window.NamespaceDesignV1.state.document.rows[0].selection.filename = 'other.lump';
    assert.equal(s._namespaceLumpSelection(s._lumpsCache, state), null,
        'Filename must match the selected Namespace; matching token/hash alone is not selection authority');
    s.window.NamespaceDesignV1.state.document.rows.push({
        slot: 7, name: 'Chosen.Service', selection: {
            token: newer.token, filename: newer.filename, binaryHash: newer.binary_hash}});
    s.window.NamespaceDesignV1.state.focusedSlot = 7;
    s.window.NamespaceDesignV1.state.focusedExecutionKey = s._namespaceExecutionKey(state);
    assert.equal(s._namespaceLumpSelection(s._lumpsCache, state), newer,
        'The explicitly focused Namespace row outranks automatic live-program focus');
    s._lumpsCache = [];
    await s._openProgrammerEditor();
    assert.equal(opened.at(-1)[0], newer.token);
    assert.equal(opened.at(-1)[1].exactSavedArtifact.abstraction, 'Chosen.Service',
        'Editor opening follows the Namespace directly, even with no catalog entry');

    const transition = harness();
    const ts = transition.s;
    const selfState = {nsIdx: 6, absName: 'SelfTest', baseLoc: 40, cw: 1};
    ts.window.NamespaceDesignV1.state.document.rows.push({
        slot: 6, name: 'SelfTest', selection: {
            token: self.token, filename: 'SelfTest.lump', binaryHash: self.binary_hash}});
    ts.window.NamespaceDesignV1.state.focusedSlot = 6;
    ts.window.NamespaceDesignV1.state.focusedExecutionKey = ts._namespaceExecutionKey(selfState);
    assert.equal(ts._namespaceLumpTarget(selfState).abstraction, 'SelfTest');
    // The real changed execution identity is consumed by both entry points.
    ts._syncLumpRepositoryToLive(ts._getLiveLumpState());
    assert.equal(ts.window.LumpRegistry.getCurrent(), cap.token,
        'Execution-following repository moves from prior SelfTest focus to CapabilityTest');
    await ts._openProgrammerEditor();
    assert.equal(transition.opened.at(-1)[0], cap.token,
        'Code tile follows the new execution through the selected Namespace');
    assert.equal(ts.window.NamespaceDesignV1.state.focusedSlot, undefined);
    ts.window._lumpRepositoryFollowsExecution = false;
    ts.window.LumpRegistry.setCurrent(self.token);
    ts._syncLumpRepositoryToLive(ts._getLiveLumpState());
    assert.equal(ts.window.LumpRegistry.getCurrent(), self.token,
        'Explicit library browsing remains deliberate even after execution changes');

    const archived = {...cap, archived: true, read_only: true};
    assert.match(source, /fetch\('\/api\/lumps\/list\?include_archived=1'\)/,
        'Repository lookup includes pinned historical artifacts');
    assert.equal(ts._namespaceLumpSelection([newer, archived], ts._getLiveLumpState()), archived,
        'Pinned archived Namespace revision remains inspectable; newer save cannot replace it');
    assert.equal(ts._namespaceLumpSelection([newer], ts._getLiveLumpState()), null,
        'Missing pinned bytes never promote a newer version');
    const idle = harness();
    idle.s._getLiveLumpState = () => null;
    idle.s.window.NamespaceDesignV1.state.document.rows[0].boot = true;
    assert.equal(idle.s._namespaceLumpTarget(null), null,
        'A boot marker is not an explicit editor selection');
    await idle.s._openProgrammerEditor();
    assert.equal(idle.opened.length, 0,
        'Code tile retains the programmer document with no live execution or explicit selection');
    const shell = fs.readFileSync(__dirname + '/app-shell.js', 'utf8');
    assert.ok(!shell.includes('renderLumps({followExecution: true})'),
        'Returning to the repository does not reset deliberate library/history browsing');

    const delayed = harness();
    let release;
    delayed.s.window.LumpRegistry.isServerListFetched = () => false;
    delayed.s.window.LumpRegistry.warmServerList = () => new Promise(resolve => { release = resolve; });
    const pending = delayed.s._openExecutedLumpInEditor();
    delayed.s.window._captureEditorWriteGuard = () => ({accepts: () => false});
    delayed.s.identity = {binaryHash: 'e'.repeat(64)};
    release();
    await pending;
    assert.equal(delayed.opened.length, 0, 'Execution changed during catalog fetch: no stale open');

    const editor = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
    assert.match(editor, /options\.confirmReplacement &&\s+_sameLumpToken\(window\._editorOpenLumpToken, token\)/);
    assert.ok(editor.indexOf('_preserveEditorNavigationBuffer();') <
        editor.indexOf('options.confirmReplacement &&'),
    'Cross-document navigation preserves the outgoing owned draft before changing source');
    assert.match(editor, /_navigationBuffer = !\(options && options\.executionFocus\)/,
        'Execution inspection does not substitute an edited navigation buffer');
    assert.match(source, /if \(window\._lumpRepositoryRequestId !== requestId\) return;/,
        'Late repository fetch cannot replace a newer explicit selection');
    console.log('PASS programmer LUMP focus: exact execution, explicit selection, unavailable identity, frozen navigation');
})().catch(error => {console.error(error); process.exitCode = 1;});
