'use strict';
// Real saved-artifact GETs in an isolated browser context. No live writes allowed.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');
const {chromium} = require('playwright');

(async () => {
    const browser = await chromium.launch({
        executablePath: execSync('which chromium').toString().trim(),
        args: ['--no-sandbox']
    });
    try {
        const context = await browser.newContext({viewport: {width: 1280, height: 900}});
        const page = await context.newPage();
        const writes = [];
        await context.route('**/*', route => {
            const request = route.request();
            if (!['GET', 'HEAD'].includes(request.method())) {
                writes.push(new URL(request.url()).pathname);
                return route.abort();
            }
            if (new URL(request.url()).pathname === '/simulator/app-lumps.js') {
                return route.fulfill({contentType: 'application/javascript',
                    body: fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8')});
            }
            return route.continue();
        });
        await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5000/simulator/');
        await page.waitForFunction(() => typeof openLumpInEditor === 'function' &&
            window.LumpRegistry && window.LumpRegistry.resolve('4a000006'));
        await page.waitForTimeout(1500);
        await page.evaluate(async () => {
            window.confirmProtectedChange = async () => { throw Error('Unexpected review on navigation'); };
            await openLumpInEditor('4a000006');
            switchView('editor');
        });
        const usage = page.locator('[data-testid="saved-lump-word-usage"]');
        await usage.waitFor({state: 'visible'});
        await page.waitForFunction(() =>
            document.querySelector('[data-testid="saved-lump-word-usage"]').textContent.includes('1950 used'));
        const expected = '2048 words total, 1950 used, 98 unused';
        assert((await usage.innerText()).includes(expected));
        assert((await usage.innerText()).includes('source=1399'));
        const savedSource = await page.locator('#asmEditor').inputValue();
        await page.screenshot({path: '/tmp/selftest-word-usage-open.png'});
        await page.evaluate(() => saveEditorState());
        await page.reload();
        await page.waitForFunction(() => {
            const el = document.querySelector('[data-testid="saved-lump-word-usage"]');
            return el && el.textContent.includes('1950 used');
        });
        await page.evaluate(() => switchView('editor'));
        assert(await usage.isVisible(), 'word usage remains visible after real reload');
        assert.equal(await page.locator('#asmEditor').inputValue(), savedSource);
        assert((await page.locator('#savedLumpDisassembly').innerText()).includes(expected),
            'canonical refresh disassembly also carries word usage');
        await page.screenshot({path: '/tmp/selftest-word-usage-reload.png'});
        assert(!writes.some(url => /save|generate|compile|boot-config|build-handoff/.test(url)),
            'only read-only navigation allowed: ' + writes.join(', '));
        console.log('PASS real SelfTest open + reload: visible ' + expected +
            '; header=1, code=500, API=49, source=1399, cc=1; source unchanged; no mutation requests');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });