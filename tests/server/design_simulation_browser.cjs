'use strict';

// Invoked by test_design_simulation_browser.py, never against the live server.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium, expect } = require('@playwright/test');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));

(async () => {
    assert.match(input.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const browser = await chromium.launch({
        executablePath: execFileSync('which', ['chromium'], {encoding:'utf8'}).trim(),
        headless:true, args:['--no-sandbox'],
    });
    const context = await browser.newContext({ viewport:{width:1440, height:1000} });
    const page = await context.newPage();
    const errors = [], legacyFetches = [], writes = [];
    let held = null;
    let delayNext = false;
    const admission = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== input.url ||
            /\/api\/.*(hardware|wukong|fpga|serial|usb|flash)/i.test(url.pathname)) return route.abort();
        // Browser telemetry is unrelated to execution and must not create
        // diagnostic records while exercising the isolated fixture.
        if (url.pathname === '/api/browser-diagnostics') return route.fulfill({
            status:200, contentType:'application/json', body:'{"ok":true}',
        });
        // Count even blocked attempts: absence of fetched bytes alone is not enough.
        if (/\/api\/boot-image\/(binary|download)|\/boot-image\.bin$/.test(url.pathname)) {
            legacyFetches.push(url.pathname);
            return route.abort();
        }
        if (!['GET','HEAD','OPTIONS'].includes(req.method())) {
            writes.push(url.pathname);
            assert.match(url.pathname, /^\/api\/simulation\/design\/(ascending|phase1)\/(prepare|approve|activate)$/);
        }
        if (/\/api\/simulation\/design\/.*\/prepare$/.test(url.pathname) && delayNext) {
            delayNext = false;
            // Real backend response, held at the browser boundary; no invented
            // signatures, image bytes, approval receipts, or simulator methods.
            const response = await route.fetch();
            held = { route, response };
            return;
        }
        return route.continue();
    });
    page.on('response', async response => {
        if (/\/api\/simulation\/design\/.*\/activate$/.test(response.url()) && response.ok())
            admission.push(await response.json());
    });
    await context.addInitScript(() => {
        localStorage.setItem('church_welcome_dismissed_perm','1');
        localStorage.setItem('church_whatsnew_dismissed_perm','1');
        localStorage.setItem('churchMachine_mathGuideDismissed_perm','1');
        localStorage.setItem('churchMachine_autoBootOnOpen','0');
        sessionStorage.setItem('church_welcome_dismissed_session','1');
        for (const lang of ['cloomc','javascript','haskell','english','symbolic','lambda','assembly'])
            localStorage.setItem(`church_intro_dismissed_${lang}`,'true');
    });
    const panel = page.locator('#designSimulationPanel');
    const step = page.locator('#toolStepBtn'), run = page.locator('#btnRunSim');
    const walk = page.locator('#toolWalkBtn'), stop = page.locator('#btnStopSim');
    const reset = page.locator('button[onclick="resetSim()"]');
    const snapshot = () => page.evaluate(async () => ({
        pc:sim.pc, steps:sim.stepCount,
        memory:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', sim.memory.buffer))),
    }));
    const state = async () => {
        const text = await panel.innerText();
        const match = text.match(/Instructions: (\d+) · NIA: (\d+) · DR1: (\d+)/);
        return match ? {steps:+match[1], pc:+match[2], dr1:+match[3]} : null;
    };
    const select = async profile => {
        await page.locator('#namespaceDesignProfile').selectOption(profile);
        await page.waitForFunction(profile => profile === 'legacy' ? !NamespaceDesignV1.state.active :
            NamespaceDesignV1.state.profile === profile && !NamespaceDesignV1.state.loading &&
            !!NamespaceDesignV1.state.document, profile);
    };
    const assertIdentity = async profile => {
        // textContent includes the collapsed exact-identity details.
        await expect(panel).toContainText(input.hashes[profile]);
        const latest = admission.at(-1);
        assert.equal(latest.imageHash, input.hashes[profile]);
        assert.equal(latest.designProfile, profile);
        const bytes = Buffer.alloc(latest.words.length * 4);
        latest.words.forEach((word,i) => bytes.writeUInt32LE(word,i*4));
        assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),
            input.hashes[profile]);
        assert.equal(latest.hardwareCertified, false);
    };
    try {
        await page.goto(input.url + '/simulator/?namespaceProfile=ascending#namespace');
        await page.waitForFunction(() => window.NamespaceDesignV1?.state.document &&
            !NamespaceDesignV1.state.loading && typeof sim !== 'undefined' && sim &&
            typeof stepSim === 'function');
        const legacy = await snapshot();
        await step.click();
        await expect.poll(async () => (await state())?.steps).toBe(1);
        await assertIdentity('ascending');
        const first = await state();
        await step.click();
        await expect.poll(async () => (await state())?.steps).toBe(2);
        assert.notEqual((await state()).pc, first.pc);

        const prepared = admission.length;
        await reset.click();
        await expect.poll(async () => (await state())?.steps).toBe(0);
        assert.equal((await state()).dr1, 0);
        await run.click();
        await expect(panel).toContainText('Private simulation stopped.');
        assert.equal((await state()).dr1, 80);
        assert((await state()).steps >= 81);
        await expect(run).toBeVisible();
        assert.equal(admission.length, prepared, 'Run/Reset reuse the admitted bytes');

        await reset.click();
        await walk.click();
        await expect(stop).toBeVisible();
        await expect.poll(async () => (await state())?.steps).toBeGreaterThan(2);
        await stop.click();
        const stopped = await state();
        await page.waitForTimeout(650); // exceeds a Walk tick
        assert.deepEqual(await state(), stopped);
        await walk.click();
        await expect.poll(async () => (await state())?.steps).toBeGreaterThan(stopped.steps);
        await walk.click(); // toggle off
        const toggled = await state();
        await page.waitForTimeout(650);
        assert.deepEqual(await state(), toggled);

        // View mismatch uses a stale displayed receipt, not a replaced runtime.
        await page.evaluate(() => {
            switchView('editor');
            window._editorSavedBinaryReceipt = {token:'stale',filename:'stale.lump',binary_hash:'stale'};
        });
        const beforeView = await state();
        await step.click();
        await expect(panel).toContainText('viewed saved LUMP is not the selected Namespace');
        assert.deepEqual(await state(), beforeView);
        assert.equal(admission.length, prepared);
        await page.evaluate(() => switchView('namespace'));
        await select('phase1');
        await run.click();
        await expect(panel).toContainText('Private simulation stopped.');
        assert.equal((await state()).dr1,80);
        await assertIdentity('phase1');
        await reset.click();
        await walk.click();
        await expect(stop).toBeVisible();
        await select('ascending'); // stops the old profile's timer
        const switched = await state();
        await page.waitForTimeout(650);
        assert.deepEqual(await state(), switched);

        // Stop a real preparation before releasing its real HTTP response.
        delayNext = true;
        const beforeStop = writes.length;
        await run.click();
        await expect.poll(() => !!held).toBe(true);
        await expect(stop).toBeVisible();
        await stop.click();
        await expect(run).toBeVisible();
        await expect(stop).toBeHidden();
        assert.equal(await state(), null);
        await held.route.fulfill({response:held.response}); held = null;
        await page.waitForTimeout(150);
        await expect(panel).toContainText('Execution was stopped while preparation was pending');
        assert.equal(await state(), null);
        assert.equal(writes.length, beforeStop + 1, 'canceled request cannot approve/activate');

        // Profile drift during preparation must reject before approval/activation.
        await select('phase1');
        delayNext = true;
        const callsBefore = writes.length;
        await step.click();
        await expect.poll(() => !!held).toBe(true);
        await select('ascending');
        await expect(run).toBeVisible();
        await expect(stop).toBeHidden();
        await held.route.fulfill({response:held.response}); held = null;
        await page.waitForTimeout(150);
        await expect(panel).toContainText('Execution was stopped while preparation was pending');
        assert.equal(await state(), null);
        assert.equal(writes.length, callsBefore + 1);

        // Leaving selected-design mode must also release its toolbar ownership.
        delayNext = true;
        const beforeLeave = writes.length;
        await step.click();
        await expect.poll(() => !!held).toBe(true);
        await select('legacy');
        await expect(run).toBeVisible();
        await expect(stop).toBeHidden();
        await held.route.fulfill({response:held.response}); held = null;
        await page.waitForTimeout(150);
        assert.equal(writes.length, beforeLeave + 1, 'profile exit cannot approve/activate');
        await select('ascending');
        await step.click(); // cancellation must not poison the next valid attempt
        await expect.poll(async () => (await state())?.steps).toBe(1);
        await assertIdentity('ascending');
        assert.deepEqual(await snapshot(), legacy, 'legacy PC, counters and all memory unchanged');
        assert.deepEqual(legacyFetches, []);
        assert.deepEqual(errors, []);
        console.log('PASS selected-design toolbar: Step/Run/Walk/Reset/Stop, exact hashes, view/profile drift, delayed cancellation, no legacy bytes');
    } finally {
        if (held) await held.route.abort().catch(() => {});
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode=1; });
