'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('simulator/app-actions.js', 'utf8');
const saveFunction = source.slice(source.indexOf('    async function save(options)'),
    source.indexOf('    async function exportCandidate(options)'));
async function check(fail) {
    const buttons = {};
    for (const id of ['btnHamSaveLump', 'btnToolbarSaveLump', 'btnSaveNS']) {
        buttons[id] = { textContent: 'Save LUMP', dataset: {}, disabled: false,
            setAttribute(key, value) { this[key] = value; } };
    }
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const context = {
        activeOperation: null, console: { error() {} },
        document: { getElementById: id => buttons[id] || { style: { display: 'block' } } },
        window: {}, eligibility: () => ({ ok: true }),
        buildThen: async () => {
            for (const b of Object.values(buttons)) {
                assert.equal(b['aria-busy'], 'true');
                assert.equal(b.disabled, true);
                assert.equal(b.textContent, 'Building for save…');
            }
            return { token: 'test' };
        },
        showFormatLump: async () => {
            await pending;
            if (fail) throw new Error('review failed');
            return { ok: true };
        },
        reportSaveFailure: result => result,
        refresh: () => Object.values(buttons).forEach(b => { b.disabled = false; }),
    };
    vm.createContext(context);
    vm.runInContext(saveFunction, context);
    const run = context.save();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(buttons.btnToolbarSaveLump.textContent, 'Preparing review…');
    finish();
    const result = await run;
    assert.equal(result.ok, !fail);
    for (const b of Object.values(buttons)) {
        assert.equal(b.textContent, 'Save LUMP');
        assert.equal(b['aria-busy'], 'false');
        assert.equal(b.disabled, false);
    }
    assert.equal(context.activeOperation, null);
}
(async () => {
    await check(false);
    await check(true);
    console.log('Save working indicator: success and failure cleanup passed');
})().catch(error => { console.error(error); process.exitCode = 1; });