'use strict';
// Isolated browser session: no application backend, storage, or artifacts.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

(async () => {
    const browser = await chromium.launch({headless: true,
        executablePath: chromium.executablePath(), args: ['--no-sandbox']});
    try {
        const page = await browser.newPage();
        await page.setContent('<textarea id="source">private draft</textarea>');
        await page.addScriptTag({path: __dirname + '/change-confirmation.js'});
        const start = () => page.evaluate(() => {
            const editor = document.getElementById('source');
            window.pendingReplacement = window.confirmSourceReplacement(editor, 'reviewed draft',
                'Isolated browser test; editor text only.').then(approved => {
                if (approved) editor.value = 'reviewed draft';
                return approved;
            });
        });
        await start();
        await page.getByRole('button', {name: 'Reject — keep unchanged'}).click();
        assert.equal(await page.evaluate(() => window.pendingReplacement), false);
        assert.equal(await page.locator('#source').inputValue(), 'private draft');
        await start();
        await page.getByRole('button', {name: 'Confirm this change'}).click();
        assert.equal(await page.evaluate(() => window.pendingReplacement), true);
        assert.equal(await page.locator('#source').inputValue(), 'reviewed draft');
        assert.equal(await page.locator('dialog').count(), 0);
        console.log('Browser modal reject/confirm passed; only isolated editor text changed');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });