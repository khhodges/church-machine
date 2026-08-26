'use strict';

// Regression coverage for the one-policy boot Preload flow. The browser loader
// is evaluated with a tiny fake simulator, keeping transport independent of UI.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const ChurchSimulator = require('./simulator.js');

function extractFunction(name) {
    const start = source.indexOf(`async function ${name}(`);
    if (start < 0) throw new Error(`Could not find ${name}`);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error(`Could not extract ${name}`);
}

const fnSource = extractFunction('_startBootLumpPrefetch');
let passed = 0;
let failed = 0;

function check(label, actual) {
    if (actual) {
        passed++;
        console.log(`PASS ${label}`);
    } else {
        failed++;
        console.error(`FAIL ${label}`);
    }
}

async function runScenario(entries, outcomes) {
    const calls = [];
    let active = 0;
    let maxActive = 0;
    const sim = {
        lazyManifest: entries,
        _bootPrefetchStarted: false,
        _bootPrefetchFailed: false,
        _bootPrefetchPromise: null,
        awaitingLump: null,
        prepareLumpPrefetch(slot) {
            const entry = this.lazyManifest[slot];
            this.awaitingLump = { nsIndex: slot, token: `token-${slot}` };
            return this.awaitingLump;
        },
    };
    const context = {
        sim,
        document: { getElementById: () => null },
        console,
        Object,
        Number,
        Promise,
        triggerLazyLoad: async (absent, mode) => {
            active++;
            maxActive = Math.max(maxActive, active);
            calls.push({ slot: absent.nsIndex, url: absent.fetchUrl, mode });
            await Promise.resolve();
            active--;
            const next = outcomes.shift();
            const entry = sim.lazyManifest[absent.nsIndex];
            if (next) entry.loaded = true;
            return next ? { ok: true } : { ok: false, error: 'fixture failure' };
        },
    };
    vm.createContext(context);
    vm.runInContext(`${fnSource}; globalThis.runPrefetch = _startBootLumpPrefetch;`, context);
    await context.runPrefetch();
    return { sim, calls, maxActive };
}

(async () => {
    const ordered = await runScenario({
        20: { loadPolicy: 'Preload', label: 'Twenty', downloadUrl: '/api/lump/twenty', loaded: false },
        12: { loadPolicy: 'Preload', label: 'Twelve', downloadUrl: '/api/lump/twelve', loaded: false },
        13: { loadPolicy: 'Lazy', label: 'Lazy', loaded: false },
        14: { loadPolicy: 'Resident', label: 'Resident', loaded: false },
        15: { loadPolicy: 'Empty', label: 'Empty', loaded: false },
    }, [true, true]);
    check('orders Preload slots deterministically by slot', ordered.calls.map(c => c.slot).join(',') === '12,20');
    check('issues raw URLs from each config row', ordered.calls.map(c => c.url).join(',') === '/api/lump/twelve,/api/lump/twenty');
    check('does not fetch Lazy, Resident, or Empty slots', ordered.calls.length === 2);
    check('uses the boot-prefetch install mode', ordered.calls.every(c => c.mode === 'boot-prefetch'));
    check('fetches one LUMP at a time', ordered.maxActive === 1);
    check('clears the boot promise after completion', ordered.sim._bootPrefetchPromise === null);

    const preloadFailure = await runScenario({
        4: { loadPolicy: 'Preload', label: 'First preload', loaded: false },
        5: { loadPolicy: 'Preload', label: 'Second preload', loaded: false },
    }, [false, false, true]);
    check('retries a failed Preload once then continues', preloadFailure.calls.map(c => c.slot).join(',') === '4,4,5');
    check('does not expose a required/optional boot stop', preloadFailure.sim._bootPrefetchFailed === false);
    check('leaves a failed Preload independently demand-loadable', preloadFailure.sim.lazyManifest[4].loaded === false);

    const legacy = await runScenario({
        7: { prefetch: true, label: 'Legacy preload', loaded: false },
        8: { loadPolicy: 'Lazy', label: 'Legacy lazy', loaded: false },
    }, [true]);
    check('accepts legacy prefetch manifests at the compatibility boundary', legacy.calls.map(c => c.slot).join(',') === '7');

const policySim = new ChurchSimulator();
policySim.lazyManifest = { 12: { loadPolicy: 'Preload', loaded: false } };
let intercepted = 0;
policySim._absentLumpIntercept = () => {
    intercepted++;
    return { absent: true, token: 'test' };
};
check('real simulator preloader recognizes canonical Preload policy',
    !!policySim.prepareLumpPrefetch(12) && intercepted === 1);

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(err => {
    console.error(err.stack || err);
    process.exitCode = 1;
});