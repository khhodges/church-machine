'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const indicator = {textContent: '', style: {}};
const ctx = {
    sim: {simulationConfiguration: {imageHash: 'abcdef0123456789'}},
    document: {getElementById: id => id === 'simulationImageIdentity' ? indicator : null},
    window: {
        confirm: () => { throw Error('Freshness must not prompt'); },
    },
    fetch: () => { throw Error('Execution must not request freshness'); },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/app-simulation-preparation.js', 'utf8'), ctx);
(async () => {
    const check = ctx.window.SimulationPreparation.checkExecutionFreshness;
    const before = JSON.stringify(ctx.sim);
    assert.equal(await check(), true);
    assert.match(indicator.textContent, /abcdef012345/);
    assert.match(indicator.textContent, /latest-version check disabled/);
    assert.match(indicator.title, /abcdef0123456789/);
    assert.equal(JSON.stringify(ctx.sim), before, 'display must not mutate execution');
    assert.equal(await check(), true, 'repeat execution needs no consent');
    ctx.sim.simulationConfiguration = {imageHash: '9876543210abcdef'};
    assert.equal(await check(), true);
    assert.match(indicator.textContent, /9876543210ab/, 'activation updates displayed identity');
    ctx.sim.simulationConfiguration = null;
    assert.equal(await check(), true, 'missing freshness evidence is not an execution gate');
    assert.match(indicator.textContent, /identity unavailable/);
    assert.doesNotMatch(indicator.title, /abcdef/, 'old identity must not linger');
    const source = fs.readFileSync(__dirname + '/app-simulation-preparation.js', 'utf8');
    assert.match(source, /actualHash !== selected.imageHash/, 'approved image integrity check retained');
    const run = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
    assert.match(run, /_requireCommittedImageForExecution\('Step'\)/);
    assert.equal((run.match(/await window.SimulationPreparation.checkExecutionFreshness/g) || []).length, 3,
        'Run, Step and Walk continue to refresh identity');
    console.log('Simulator identity without freshness gates: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
