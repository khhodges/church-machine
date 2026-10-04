'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const banner = {textContent: '', style: {}};
const configuration = {imageHash: 'exact-image'};
let report = {status: 'stale', basis: 'verified-image', imageHash: 'exact-image',
    warnings: [{abstraction: 'WukongCallHome', selected: {filename: 'old.lump'},
        latest: {filename: 'new.lump'}}]};
let consent = false, prompts = 0, delay;
const ctx = {sim: {simulationConfiguration: configuration},
    document: {getElementById: id => id === 'simulationImageFreshnessWarning' ? banner : null},
    window: {_nsState: {abstractions: [{filename: 'new.lump'}]},
        confirm: text => { prompts++; assert.match(text, /existing image/); return consent; }},
    fetch: async (url, options) => {
        assert.match(url, /imageHash=exact-image/);
        assert.equal(options.cache, 'no-store');
        if (delay) await delay;
        return {ok: true, json: async () => report};
    }};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/app-simulation-preparation.js', 'utf8'), ctx);
(async () => {
    const check = ctx.window.SimulationPreparation.checkExecutionFreshness;
    const before = JSON.stringify([ctx.sim, ctx.window._nsState]);
    assert.equal(await check(), false, 'cancel prevents execution');
    assert.match(banner.textContent, /WukongCallHome: loaded image old.lump.*latest saved new.lump/);
    assert.equal(banner.style.display, 'flex');
    consent = true;
    assert.equal(await check(), true);
    const accepted = prompts;
    assert.equal(await check(), true);
    assert.equal(prompts, accepted, 'same warning remains visible without repeated prompts');
    assert.equal(JSON.stringify([ctx.sim, ctx.window._nsState]), before);
    report = {status: 'unknown', reason: 'image replaced on server'};
    consent = false;
    assert.equal(await check(), false);
    assert.match(banner.textContent, /UNVERIFIED/);
    report = {status: 'current', basis: 'verified-image', imageHash: 'exact-image', warnings: []};
    assert.equal(await check(), true);
    assert.equal(banner.style.display, 'none');
    let release;
    delay = new Promise(resolve => { release = resolve; });
    const pending = check();
    assert.equal(await check(), false, 'parallel Run cannot bypass pending check');
    ctx.sim.simulationConfiguration = {imageHash: 'other-image'};
    release();
    assert.equal(await pending, false, 'activation while checking cancels old request');
    const run = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
    for (const name of ['runSimGo', 'stepSim', 'walkToggle']) {
        const start = run.indexOf('async function ' + name + '(');
        assert(start >= 0);
        assert.match(run.slice(start, start + 2400), /await window.SimulationPreparation.checkExecutionFreshness/);
    }
    console.log('PASS loaded-image warning, consent, persistence, unknown identity, race and execution gates');
})().catch(error => { console.error(error); process.exitCode = 1; });