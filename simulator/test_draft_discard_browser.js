'use strict';
// Disposable browser context; read-only server artifacts; every write is blocked.
// DRAFT_DISCARD_BASELINE_FILE can serve pre-fix app-lumps.js to reproduce the loop.
const assert = require('assert');
const fs = require('fs');
const {execSync} = require('child_process');
const {chromium} = require('playwright');
(async () => {
    const browser = await chromium.launch({
        executablePath: execSync('which chromium', {encoding: 'utf8'}).trim(),
        args: ['--no-sandbox'],
    });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        const mutations = [];
        await context.route('**/*', route => {
            const req = route.request(), pathname = new URL(req.url()).pathname;
            if (!['GET', 'HEAD'].includes(req.method())) {
                if (/compile|save|lump|namespace|boot-config/.test(pathname)) mutations.push(pathname);
                return route.abort();
            }
            if (pathname.endsWith('/app-lumps.js') && process.env.DRAFT_DISCARD_BASELINE_FILE) {
                return route.fulfill({contentType: 'application/javascript',
                    body: fs.readFileSync(process.env.DRAFT_DISCARD_BASELINE_FILE, 'utf8')});
            }
            return route.continue();
        });
        await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5000/simulator/');
        await page.waitForFunction(() => typeof openLumpInEditor === 'function' &&
            window.LumpRegistry && window.LumpRegistry.resolve('4a000006'));
        await page.waitForTimeout(1500);
        const token = '4a000006', draft = '; disposable reviewed recovery\n';
        const saved = await page.evaluate(async token => {
            await openLumpInEditor(token);
            return {source: document.getElementById('asmEditor').value,
                words: await (await fetch('/api/lump/' + token + '/words')).text()};
        }, token);
        async function seed() {
            await page.evaluate(async ({token, draft, saved}) => {
                document.getElementById('asmEditor').value = saved;
                window._editorOpenLumpToken = null;
                window._editorNavigationBuffers = {};
                localStorage.setItem(_draftLsKey(token), draft);
                localStorage.setItem(_draftLsKey('disposable-unrelated'), 'keep unrelated');
                await openLumpInEditor(token);
            }, {token, draft, saved: saved.source});
            await page.locator('#_lumpDraftBannerDiscard').waitFor({state: 'visible'});
        }
        const confirm = page.getByRole('button', {name: 'Confirm this change', exact: true});
        if (!process.env.DRAFT_DISCARD_SKIP_CANCEL) {
            await seed();
            await page.locator('#_lumpDraftBannerDiscard').click();
            await page.getByRole('button', {name: 'Reject — keep unchanged', exact: true}).click();
            assert.equal(await page.evaluate(token => localStorage.getItem(_draftLsKey(token)), token), draft);
            assert.equal(await page.locator('#asmEditor').inputValue(), saved.source);
        }

        await seed();
        // Reproduces the silent post-confirmation return: the reviewed text is
        // no longer canonical, but still exists in another recovery store.
        await page.evaluate(({token, draft}) => {
            localStorage.setItem(_draftLsKey(token), '; newer browser copy\n');
            _lumpEditorDraftText[_lumpTokenIdentity(token)] = draft;
            sessionStorage.setItem('cm_editor_navigation:lump:' + _lumpTokenIdentity(token),
                JSON.stringify({source: draft}));
        }, {token, draft});
        await page.locator('#_lumpDraftBannerDiscard').click();
        await confirm.click();
        await page.waitForFunction(() => !document.getElementById('_lumpDraftBanner'));
        assert.equal(await page.evaluate(token => localStorage.getItem(_draftLsKey(token)), token),
            '; newer browser copy\n');
        assert.equal(await page.evaluate(token => _lumpEditorDraftText[_lumpTokenIdentity(token)], token), undefined);

        await seed();
        await page.locator('#_lumpDraftBannerDiscard').click();
        await confirm.click();
        await page.waitForFunction(() => !document.getElementById('_lumpDraftBanner'));
        await page.evaluate(token => openLumpInEditor(token), token);
        assert.equal(await page.locator('#_lumpDraftBanner').count(), 0);
        await page.reload();
        await page.waitForFunction(() => typeof openLumpInEditor === 'function' && window._editorStateHydrated);
        await page.evaluate(token => openLumpInEditor(token), token);
        assert.equal(await page.locator('#_lumpDraftBanner').count(), 0);
        assert.equal(await page.locator('#asmEditor').inputValue(), saved.source);

        await seed();
        await page.locator('#_lumpDraftBannerDiscard').click();
        await page.evaluate(() => {
            const ed = document.getElementById('asmEditor');
            ed.value = '; newly typed during review\n';
            ed.dispatchEvent(new Event('input', {bubbles: true}));
        });
        await confirm.click();
        await page.waitForFunction(() => document.querySelector('#_lumpDraftBanner .lump-draft-copy')
            .textContent.includes('editor changed'));
        assert.equal(await page.locator('#asmEditor').inputValue(), '; newly typed during review\n');
        assert.equal(await page.evaluate(token => localStorage.getItem(_draftLsKey(token)), token),
            '; newly typed during review\n');
        assert.equal(await page.evaluate(() => localStorage.getItem(_draftLsKey('disposable-unrelated'))), 'keep unrelated');

        // A pending approval must not delete the original draft after navigating
        // to another saved LUMP while the confirmation is open.
        await seed();
        const otherToken = await page.evaluate(token =>
            LumpRegistry.list().find(item => item.token !== token)?.token, token);
        assert(otherToken, 'a second saved LUMP is required for the navigation check');
        await page.locator('#_lumpDraftBannerDiscard').click();
        await page.evaluate(other => openLumpInEditor(other), otherToken);
        await confirm.click();
        assert.equal(await page.evaluate(() => window._editorOpenLumpToken), otherToken);
        assert.equal(await page.evaluate(token => localStorage.getItem(_draftLsKey(token)), token), draft);

        // Storage deletion failures must remain visible and actionable, without
        // silently claiming that the reviewed draft was discarded.
        await seed();
        await page.evaluate(token => {
            const original = Storage.prototype.removeItem;
            window.__draftDiscardOriginalRemoveItem = original;
            const key = _draftLsKey(token);
            Storage.prototype.removeItem = function (name) {
                if (this === localStorage && name === key) throw new Error('simulated removal denied');
                return original.call(this, name);
            };
        }, token);
        await page.locator('#_lumpDraftBannerDiscard').click();
        await confirm.click();
        await page.waitForFunction(() => document.querySelector('#_lumpDraftBanner .lump-draft-copy')
            .textContent.includes('Draft discard could not finish'));
        const storageFeedback = await page.locator('#_lumpDraftBanner .lump-draft-copy').textContent();
        assert(storageFeedback.includes('Check browser storage access, then retry'));
        assert.equal(await page.evaluate(token => localStorage.getItem(_draftLsKey(token)), token), draft);
        await page.evaluate(() => {
            Storage.prototype.removeItem = window.__draftDiscardOriginalRemoveItem;
            delete window.__draftDiscardOriginalRemoveItem;
        });
        assert.equal(await page.evaluate(async token =>
            (await fetch('/api/lump/' + token + '/words')).text(), token), saved.words);
        assert.deepEqual(mutations, []);
        await page.screenshot({path: '/tmp/draft-discard-browser.png'});
        console.log('PASS browser discard: stale review, reopen/reload, concurrent edits, pending-navigation guard, actionable storage failure, unchanged artifact and unrelated draft');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });