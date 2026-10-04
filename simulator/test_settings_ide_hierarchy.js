'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const CapabilityTokens = require('./capability_tokens.js');
const source = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const dom = new JSDOM(html);
const document = dom.window.document;
const context = vm.createContext({ document, CapabilityTokens, fetch: null });
vm.runInContext(source.slice(source.indexOf('let _settingsHierarchyRequest ='), source.indexOf('function openSettings()')), context);
const status = () => document.getElementById('settingsIdeHierarchyStatus').textContent;
const node = () => document.getElementById('settingsIdeHierarchyNode').textContent;
async function show(config, code = 200) {
    context.fetch = async (url, options) => {
        assert.equal(url, '/api/ide-hierarchy');
        assert.equal(options.cache, 'no-store');
        assert.equal(options.method, undefined); // GET only; never write ownership
        return { ok: code === 200, status: code, json: async () => config };
    };
    await context.refreshSettingsIdeHierarchy();
}
(async () => {
    document.getElementById('settingPetname').value = 'browser.claim';
    await show({ node: 'Org.Assigned_IDE', aliases: { 'Thread.1': 'Org.Assigned_IDE.Thread1' } });
    assert.equal(node(), 'Org.Assigned_IDE');
    assert.match(status(), /Configured by the server/);
    assert.equal(document.getElementById('settingPetname').value, 'browser.claim');
    await show(null);
    assert.match(status(), /Not configured.*server\/ide-hierarchy.json/);
    assert.equal(node(), 'Not available');
    for (const config of [{}, [], 'browser.claim', { node: '<img src=x>' },
        { node: 'valid.node', aliases: [] }, { node: 'valid.node', aliases: { bad: '?' } },
        { node: 'valid.node', definitions: { 'foreign.leaf': ['BAD'] } },
        { node: 'valid.node', definitions: { 'foreign.leaf': 'R' } }]) {
        await show(config);
        assert.match(status(), /Malformed configuration/);
        assert.equal(node(), 'Not available');
    }
    await show(null, 422);
    assert.match(status(), /Malformed or unreadable.*server\/ide-hierarchy.json/);
    await show(null, 503);
    assert.match(status(), /Check the server connection and retry/);
    context.fetch = async () => { throw new Error('offline'); };
    await context.refreshSettingsIdeHierarchy();
    assert.match(status(), /No settings were changed/);
    context.fetch = async () => ({ ok: true, json: async () => { throw new Error('bad json'); } });
    await context.refreshSettingsIdeHierarchy();
    assert.match(status(), /response is malformed/);
    let resolve;
    context.fetch = () => new Promise(r => { resolve = r; });
    const old = context.refreshSettingsIdeHierarchy();
    await show({ node: 'new.assignment' });
    resolve({ ok: true, json: async () => ({ node: 'old.assignment' }) });
    await old;
    assert.equal(node(), 'new.assignment');
    const section = document.getElementById('settingsIdeHierarchySection');
    assert.equal(section.querySelectorAll('input,select,textarea').length, 0);
    assert.match(section.querySelector('a').href, /\/docs\/CM_LUMP_SPECIFICATION.md/);
    assert.match(source.slice(source.indexOf('function openSettings()'), source.indexOf('function closeSettings()')), /refreshSettingsIdeHierarchy\(\)/);
    console.log('Settings IDE hierarchy tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });