'use strict';

// Regression coverage for ordered raw-LUMP boot prefetch. The browser loader
// function is evaluated with a tiny fake simulator so this test exercises the
// real sorting, retry, and required/optional policy without network or DOM
// dependencies.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');

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
        20: { prefetch: true, prefetchOrder: 2, label: 'Twenty', downloadUrl: '/api/lump/twenty', loaded: false },
        12: { prefetch: true, prefetchOrder: 1, label: 'Twelve', downloadUrl: '/api/lump/twelve', loaded: false },
    }, [true, true]);
    check('orders slots by configured prefetchOrder', ordered.calls.map(c => c.slot).join(',') === '12,20');
    check('issues raw URLs from each config row', ordered.calls.map(c => c.url).join(',') === '/api/lump/twelve,/api/lump/twenty');
    check('uses the boot-prefetch install mode', ordered.calls.every(c => c.mode === 'boot-prefetch'));
    check('fetches one LUMP at a time', ordered.maxActive === 1);
    check('clears the boot promise after completion', ordered.sim._bootPrefetchPromise === null);

    const optional = await runScenario({
        4: { prefetch: true, prefetchOrder: 1, prefetchRequired: false, label: 'Optional', loaded: false },
        5: { prefetch: true, prefetchOrder: 2, label: 'Required after optional', loaded: false },
    }, [false, false, true]);
    check('retries an optional failure once then continues', optional.calls.map(c => c.slot).join(',') === '4,4,5');
    check('does not stop boot for an optional failure', optional.sim._bootPrefetchFailed === false);
    check('leaves an optional failed entry demand-loadable', optional.sim.lazyManifest[4].loaded === false);

    const required = await runScenario({
        7: { prefetch: true, prefetchOrder: 1, label: 'Required', loaded: false },
        8: { prefetch: true, prefetchOrder: 2, label: 'Never reached', loaded: false },
    }, [false, false]);
    check('stops after the bounded retry for a required failure', required.calls.map(c => c.slot).join(',') === '7,7');
    check('marks a required prefetch failure as boot-blocking', required.sim._bootPrefetchFailed === true);
    check('does not fetch later entries after required failure', required.sim.lazyManifest[8].loaded === false);

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(err => {
    console.error(err.stack || err);
    process.exitCode = 1;
});