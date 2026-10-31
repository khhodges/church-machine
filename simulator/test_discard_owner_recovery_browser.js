'use strict';
// Disposable browser storage only; no server mutation is permitted.
const assert = require('node:assert/strict');
const {execSync} = require('node:child_process');
const {chromium} = require('playwright');
(async () => {
    const browser = await chromium.launch({
        executablePath: execSync('which chromium', {encoding:'utf8'}).trim(),
        args:['--no-sandbox']
    });
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(15000);
        await page.route('**/*', route => ['GET','HEAD'].includes(route.request().method())
            ? route.continue() : route.abort());
        await page.goto(process.env.PREVIEW_URL);
        await page.waitForFunction(() => typeof openLumpInEditor === 'function' &&
            window.LumpRegistry && window.LumpRegistry.resolve('4a000006'));
        const token = '4a000006';
        await page.evaluate(token => openLumpInEditor(token), token);
        await page.waitForFunction(() => document.getElementById('asmEditor').value.length > 0);
        const saved = await page.locator('#asmEditor').inputValue();
        const draft = saved.slice(0, 1024);
        assert.notEqual(draft, saved);
        await page.evaluate(async ({token, draft}) => {
            localStorage.setItem(_draftLsKey(token), draft);
            window._editorOpenLumpToken = null;
            window._editorNavigationBuffers = {};
            await openLumpInEditor(token);
        }, {token, draft});
        await page.locator('#_lumpDraftBannerDiscard').waitFor({state:'visible'});
        const ownerKey = 'church_editor_owner_draft_v1:' +
            encodeURIComponent(JSON.stringify({type:'lump', id:token}));
        await page.evaluate(({ownerKey, draft}) => {
            localStorage.setItem(ownerKey, JSON.stringify(draft));
        }, {ownerKey, draft});
        await page.locator('#_lumpDraftBannerDiscard').click();
        await page.getByRole('button', {name:'Reject — keep unchanged', exact:true}).click();
        assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), ownerKey), draft);
        await page.locator('#_lumpDraftBannerDiscard').click();
        await page.getByRole('button', {name:'Confirm this change', exact:true}).click();
        await page.waitForFunction(() => !document.getElementById('_lumpDraftBanner'));
        assert.equal(await page.evaluate(key => localStorage.getItem(key), ownerKey), null);
        assert.equal(await page.evaluate(token => localStorage.getItem(_draftLsKey(token)), token), null);
        assert.equal(await page.locator('#asmEditor').inputValue(), saved);
        console.log('PASS live discard: reject preserves recovery; confirm clears exact owner and LUMP copies, preserving saved editor text');
    } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
