'use strict';
// Synthetic control/RETURN fixtures only. Never load a saved image or workload.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Simulator = require('./simulator.js');
const ThreadDesign = require('./thread_design.js');
const layout = ThreadDesign.layout(256, 32);
assert.ok(layout.valid);
const rootAddress = layout.stackEnd;
const rootSTO = rootAddress - 2;
const source = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}
function fixture() {
    const s = new Simulator();
    s.bootComplete = false;
    s.withNamespaceWrite('synthetic paused RETURN', () => {
        s.writeNSEntry(1, 0, 255, 0, 0, 1, 0, 0, 0);
    });
    s.memory.fill(0, 0, 256);
    s.memory[0] = s.packLumpHeader(2, 32, 12, 2);
    s.cr[12] = {word0: s.createGT(0, 1, {R: 1, W: 1}, 1), word1: 0,
        word2: s.readNSEntry(1).word1_limit, word3: 0, m: 0};
    for (let slot = 2; slot <= 4; slot++) {
        const base = slot * 256;
        const words = new Uint32Array(64);
        words[0] = s.packLumpHeader(0, 8, 1, 0);
        words.fill(0x1f000000, 1, 9); // RETURN AL
        words[63] = Simulator.SELF_CAPABILITY_PLACEHOLDER;
        const hdr = s.parseLumpHeader(words[0]);
        assert.ok(s.mintStep7Freespace(words, hdr).ok);
        const minted = s._mintOrdinaryLumpIdentity(words, slot, base,
            {compilerOwnedSelf: true});
        assert.ok(minted.ok, minted.message);
        s.memory.set(minted.words, base);
        s.withNamespaceWrite('synthetic paused executable', () =>
            s.writeNSEntry(slot, base, hdr.cw, 0, 0, 1,
                minted.entry.seq, hdr.cc, minted.entry.cacheToken));
        assert.ok(s.mLoad(minted.selfGT, 'E', 1).ok);
        if (slot === 2) {
            // Install the validated E-only CR6 companion, with M enabling LOAD.
            s._installLumpHeaderContext(s.parseGT(minted.selfGT), slot,
                s.readNSEntry(slot), hdr, minted.selfGT);
        }
    }
    s.memory[layout.protectedStoOffset] = s._packProtectedIndicator(rootSTO, 1, {});
    s.memory[rootAddress - 1] = s.cr[6].word0;
    s.memory[rootAddress] = s._packFrameWordRaw(0x7fff, 1, rootAddress);
    s.sto = rootSTO;
    s.pc = 1;
    s.bootComplete = true;
    s._bootImageLoaded = true;
    return s;
}
function call(s, slot) {
    const entry = s.readNSEntry(slot);
    s.cr[0] = {word0: s.memory[slot * 256 + 63], word1: slot * 256,
        word2: entry.word1_limit, word3: entry.word2_seals, m: 0};
    assert.ok(s._execCall({crDst: 0, imm: 0}), s.output);
    s.pc = 1;
}
function harness(s, status = 'stale-image', available = true) {
    const events = [];
    const c = {
        sim: s, console, pipelineViz: null, _simRunActive: false,
        _bootImageRefreshInFlight: null, walkRunning: true,
        document: {getElementById: () => null},
        window: {
            TargetState: {authorize: () => ({ok: true})},
            bootImage: available ? {} : null, bootImageAvailable: available,
            BootEntryUI: {get: () => ({status})},
            _refreshCommittedBootImageCache: async () => { events.push('refresh'); },
        },
        _maybeApplyBootImage: () => {
            events.push('overlay');
            s.memory[layout.protectedStoOffset] = s._packProtectedIndicator(rootSTO, 1, {});
            status = 'prepared';
        },
        resetSim: () => { events.push('reset'); s.reset(); },
        _blockBootForMissingCommittedImage: op => { events.push('blocked:' + op); return false; },
        _applyPendingSimLoad() {}, _breakpointBeforeNextInstruction: () => null,
        _handleExecutionSuspension: () => false,
        updateDashboard() {}, switchView() {}, openCRDetail() {},
        hideRunPopover() {}, finishWalk() {}, setTimeout() {}, _flushPendingPipelineBuffer() {},
        runSim: () => { events.push('run'); },
    };
    vm.createContext(c);
    vm.runInContext(['_bootHasCommittedImage', '_ensureCommittedImageForBoot',
        '_requireCommittedImageForExecution', 'stepSim', 'runSimGo', 'walkNext']
        .map(extract).join('\n'), c);
    return {c, events};
}
async function main() {
    for (const mode of ['stepSim', 'walkNext']) {
        for (const state of ['stale-image', 'pending', 'error', 'missing']) {
            const s = fixture();
            call(s, 3);
            call(s, 4);
            const generation = s._controlFlowDiagnosticResetGeneration;
            const breaks = new Set([s._nextPhysicalAddr()]);
            assert.equal(s.checkBreakpointBeforeExecute(breaks), s._nextPhysicalAddr());
            const {c, events} = harness(s, state, state !== 'missing');
            c._breakpointBeforeNextInstruction = () => s.checkBreakpointBeforeExecute(breaks);
            c[mode]();
            await Promise.resolve(); await Promise.resolve();
            assert.deepEqual(events, [], `${mode}/${state}: paused execution must not refresh/reset`);
            assert.equal(s.pc, 2);
            assert.equal(s.cr[14].word1, 768);
            assert.equal(s.bootComplete, true);
            assert.equal(s._controlFlowDiagnosticResetGeneration, generation);
            s.pc = 1;
            c[mode]();
            assert.equal(s.cr[14].word1, 512);
            assert.equal(s.pc, 2);
            assert.equal(s.memory[layout.protectedStoOffset] & 0x1fff, 0x1000 | rootSTO);
        }
    }
    for (const pc of [0, 0x7fff]) {
        const s = fixture();
        call(s, 3);
        s.callStack = []; // Diagnostic shadow is not frame authority.
        s.memory[rootSTO] = s._packFrameWordRaw(pc, 1, rootSTO);
        const before = {cr: structuredClone(s.cr),
            indicator: s.memory[layout.protectedStoOffset], sto: s.sto};
        const {c, events} = harness(s);
        c.stepSim();
        assert.deepEqual(events, []);
        if (pc === 0) {
            assert.equal(s.pc, 0);
            assert.equal(s.cr[14].word1, 512);
            assert.equal(s.cr[6].word1, 575);
        } else {
            assert.equal(s.halted, true);
            assert.equal(s.faultLog.at(-1).type, 'STACK_UNDERFLOW');
            assert.deepEqual(s.cr, before.cr);
            assert.equal(s.memory[layout.protectedStoOffset], before.indicator);
            assert.equal(s.sto, before.sto);
        }
    }
    {
        const {c, events} = harness(fixture());
        c.runSimGo();
        assert.deepEqual(events, ['run'], 'Run resumes without image preparation');
    }
    {
        const s = fixture(); s._bootImageLoaded = false;
        const {c, events} = harness(s, 'pending', false);
        assert.equal(c._requireCommittedImageForExecution('Step'), true,
            'live boot completion, not cache/load flags, authorizes resume');
        assert.deepEqual(events, []);
        s.bootComplete = false;
        c.window.bootImage = {};
        c.window.bootImageAvailable = true;
        c.window.BootEntryUI.get = () => ({status: 'prepared'});
        assert.equal(c._requireCommittedImageForExecution('Step'), false,
            'an unbooted machine still needs the image loaded');
        s._bootImageLoaded = true;
        assert.equal(c._requireCommittedImageForExecution('Step'), true);
    }
    {
        const s = fixture(); s.bootComplete = false;
        s.step = () => { throw new Error('missing-image boot executed'); };
        const {c, events} = harness(s, 'pending', false);
        c.stepSim(); c.runSimGo();
        assert.deepEqual(events, ['blocked:Step', 'blocked:Run']);
    }
    {
        const s = fixture();
        const {c, events} = harness(s);
        // Explicit reset/boot preparation still refreshes and invokes reset.
        assert.equal(c._ensureCommittedImageForBoot('explicit reset'), false);
        await Promise.resolve(); await Promise.resolve();
        assert.deepEqual(events, ['refresh', 'overlay', 'reset']);
        assert.equal(s.bootComplete, false);
    }
    console.log('PASS paused Step/Run/Walk image gate; nested, PC0, root RETURN; boot/reset controls');
}
main().catch(error => { console.error(error); process.exitCode = 1; });