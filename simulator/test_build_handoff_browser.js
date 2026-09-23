'use strict';
// Isolated browser preview: every request is fulfilled in memory, never live.
const {chromium} = require('playwright');
const fs = require('fs');
const {execSync} = require('child_process');
const assert = require('assert');

(async () => {
    const browser = await chromium.launch({
        executablePath: execSync('which chromium').toString().trim(),
        args: ['--no-sandbox']
    });
    try {
        const page = await browser.newPage({viewport: {width: 1100, height: 400}});
        const artifact = {token: '4a000007', filename: 'Test.1.saved.lump',
            dot_name: 'Test', issue_n: 1, lump_version: 16,
            binary_hash: 'a'.repeat(64), _identityProvenance: 'verified'};
        let state = {released: false, revision: 0, updated_at: null};
        let posts = 0;
        await page.route('**/*', route => {
            if (route.request().url().includes('/api/build-handoff')) {
                if (route.request().method() === 'POST') {
                    posts++;
                    state = {released: route.request().postDataJSON().released,
                        revision: state.revision + 1, updated_at: '2026-09-23T12:00:00Z'};
                }
                return route.fulfill({contentType: 'application/json', body: JSON.stringify({
                    identity: {...artifact, compiled_at: '2026-09-22T12:00:00Z', eligible: true},
                    handoff: state, csrf: 'isolated-test-only', committed: true
                })});
            }
            return route.fulfill({contentType: 'text/html',
                body: '<body style="background:#171a2c;color:#ccc;font:14px Arial"><div id="savedLumpIdentityPanel" class="saved-lump-identity-panel"></div></body>'});
        });
        await page.goto('http://isolated.invalid/');
        await page.addStyleTag({content: fs.readFileSync('simulator/styles-toolbar.css', 'utf8')});
        await page.addScriptTag({content: fs.readFileSync('simulator/build-handoff.js', 'utf8')});
        const source = fs.readFileSync('simulator/app-lumps.js', 'utf8');
        function extract(name) {
            const start = source.indexOf('function ' + name + '(');
            let depth = 0;
            for (let i = source.indexOf('{', start); i < source.length; i++) {
                if (source[i] === '{') depth++;
                if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
            }
            throw Error('Missing function ' + name);
        }
        await page.addScriptTag({content: ['_verifiedSavedLumpIdentity', '_sameSavedLumpWord',
            '_renderSavedLumpIdentityPanel'].map(extract).join('\n')});
        const render = () => page.evaluate(row => {
            window._savedLumpEditorMode = true;
            _renderSavedLumpIdentityPanel(row, row.token);
        }, artifact);
        await render();
        const box = page.locator('[data-testid="released-to-builder"]');
        await page.waitForFunction(() => !document.querySelector('input').disabled);
        assert((await page.locator('#savedLumpIdentityPanel').textContent()).includes('v16'));
        await box.click();
        await page.waitForFunction(() => document.querySelector('[role=status]').textContent.startsWith('Released'));
        assert(await box.isChecked());
        await page.screenshot({path: '/tmp/build-handoff-preview.png'});
        await render();
        await page.waitForFunction(() => document.querySelector('input').checked);
        await box.click();
        await page.waitForFunction(() => document.querySelector('[role=status]').textContent.startsWith('Not released'));
        assert.equal(await box.isChecked(), false);
        assert.equal(posts, 2);
        console.log('PASS isolated Chromium production panel, date/version, release/reload/revoke; all requests mocked');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });