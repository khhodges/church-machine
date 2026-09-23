'use strict';

// Isolated browser storage; no live API mutations are allowed. Run against an
// already-running preview: node simulator/test_namespace_navigation_browser.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'chromium' });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        const writes = [];
        await context.route('**/*', async route => {
            const request = route.request();
            if (!['GET', 'HEAD'].includes(request.method())) {
                writes.push(new URL(request.url()).pathname);
                return route.abort();
            }
            if (new URL(request.url()).pathname === '/simulator/app-lumps.js') {
                return route.fulfill({ contentType: 'application/javascript',
                    body: fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8') });
            }
            return route.continue();
        });
        await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5000/simulator/');
        await page.waitForFunction(() => typeof openLumpInEditor === 'function' &&
            window.LumpRegistry && window.LumpRegistry.resolve('4a00000a'));
        await page.waitForTimeout(1500);
        const result = await page.evaluate(async () => {
            let confirmations = 0;
            window.confirmProtectedChange = async () => { confirmations++; return false; };
            await openLumpInEditor('4a00000a');
            const editor = document.getElementById('asmEditor');
            const original = editor.value;
            if (!original.includes('CapabilityTest')) throw new Error('Saved source did not open: ' +
                JSON.stringify({ length: original.length, owner: window._editorOpenLumpToken,
                    notices: Array.from(document.querySelectorAll('[id*="Toast"], [id*="Banner"]'))
                        .map(el => el.textContent) }));
            const draft = original + '\n; isolated navigation draft\n';
            editor.value = draft;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            await openLumpInEditor('4a000007');
            const second = editor.value;
            if (!second.includes('WukongCallHome')) throw new Error('Second source did not open');
            await openLumpInEditor('4a00000a');
            const resumed = editor.value === draft;
            const setItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function () { throw new Error('isolated quota test'); };
            await openLumpInEditor('4a000007');
            Storage.prototype.setItem = setItem;
            const failureKeptText = editor.value === draft;
            const nativeFetch = window.fetch;
            let release;
            let started;
            const startedPromise = new Promise(resolve => { started = resolve; });
            window.fetch = async function(input, options) {
                if (String(input).includes('/api/lump/4a000007/words')) {
                    await new Promise(resolve => { release = resolve; started(); });
                }
                return nativeFetch(input, options);
            };
            const pending = openLumpInEditor('4a000007');
            await startedPromise;
            editor.value += '; typed while navigation was pending\n';
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            const typed = editor.value;
            release();
            await pending;
            window.fetch = nativeFetch;
            const raceKeptText = editor.value === typed;
            _draftLsDel('4a00000a');
            const discardClearedSnapshot = !window._editorNavigationBuffers['lump:4a00000a'];
            return { confirmations, resumed, failureKeptText, raceKeptText, discardClearedSnapshot,
                owner: window._editorOpenLumpToken,
                failureVisible: document.body.textContent.includes('Navigation cancelled') };
        });
        assert.equal(result.confirmations, 0);
        assert.equal(result.resumed, true);
        assert.equal(result.failureKeptText, true);
        assert.equal(result.raceKeptText, true);
        assert.equal(result.discardClearedSnapshot, true);
        assert.equal(result.owner, '4a00000a');
        assert.equal(result.failureVisible, true);
        assert(!writes.some(url => /save|generate|compile|boot-config/.test(url)),
            'navigation must not attempt compile, save or generation: ' + writes);
        await page.screenshot({ path: '/tmp/namespace-navigation-preserved.png' });
        console.log('PASS real saved navigation roundtrip, no consent/writes, storage failure preserves source', result);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });