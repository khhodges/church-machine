'use strict';

// Browser-level coverage for the saved-LUMP Load into Sim authorization
// boundary.  The loader must not boot or install a binary until the
// hash-bound deployment response is both HTTP-successful and semantically
// accepted.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const TOKEN = '4a00000a';
const NAME = 'CapabilityTest';
const FIXTURE = path.resolve(
    __dirname, '..', '..', 'server', 'lumps',
    'CapabilityTest.2.225da6fc.lump'
);
const bytes = fs.readFileSync(FIXTURE);
const WORDS = Array.from({ length: bytes.length / 4 }, (_, index) =>
    bytes.readUInt32BE(index * 4)
);
const BINARY_HASH = crypto.createHash('sha256').update(bytes).digest('hex');
const APPROVAL = {
    binary_hash: BINARY_HASH,
    dot_name: NAME,
    issue_n: 2,
    token: TOKEN,
    abstraction: NAME,
    grants: ['E'],
    capability_type: 'inform',
};
const LUMP = {
    token: TOKEN,
    abstraction: NAME,
    dot_name: NAME,
    filename: 'CapabilityTest.2.225da6fc.lump',
    lump_type: 'code',
    content_type: 'code',
    language: 'assembly',
    lump_version: 2,
    ns_slot: 10,
    ns_slot_policy: 'static',
    boot_resident: false,
};

async function configureSavedLump(page, deployResponse) {
    await page.route('**/api/lumps/list', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([LUMP]),
        });
    });
    await page.route(`**/api/lump/${TOKEN}/words`, async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                token: TOKEN,
                binary_hash: BINARY_HASH,
                words: WORDS,
            }),
        });
    });
    await page.route(`**/api/lumps/${TOKEN}/detail`, async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                approval: APPROVAL,
                binary_hash: BINARY_HASH,
                approved: true,
            }),
        });
    });
    await page.route('**/api/lumps/approval-intent', async route => {
        const request = route.request();
        const payload = JSON.parse(request.postData() || '{}');
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                intent: 'browser-test-deploy-intent',
                digest: payload.digest,
                action: payload.action,
            }),
        });
    });
    await page.route('**/api/lumps/deploy-authorize', async route => {
        await route.fulfill(deployResponse);
    });
}

async function openLoadIntoSimButton(page) {
    await page.waitForFunction(token =>
        Array.isArray(window._lumpsCache) &&
        window._lumpsCache.some(lump => lump.token === token),
        TOKEN
    );
    await page.evaluate(token => {
        switchView('lumps');
        showLumpDetail(token);
    }, TOKEN);
    // The workspace toolbar and detail header intentionally share the legacy
    // id; click the detail-header control that owns the saved-LUMP action.
    const button = page.locator('.lump-hs-btn-run');
    await expect(button).toBeVisible();
    return button;
}

async function loadBrowserSimulator(page) {
    await page.addInitScript(() => {
        localStorage.setItem('church_whatsnew_dismissed_perm', '1');
        localStorage.setItem('churchMachine_autoBootOnOpen', '0');
    });
    await page.goto('/simulator/');
    await page.waitForFunction(() =>
        typeof sim !== 'undefined' &&
        sim &&
        typeof showLumpDetail === 'function' &&
        window.LumpContentFrame &&
        typeof window.LumpContentFrame.lumpInspectContentFrame === 'function'
    );

    // The authorization cases intentionally do not depend on the separately
    // generated boot-image asset.  Give the real loader a live Namespace
    // lookup for the fixture's existing destination slot; denied responses
    // must leave this state unchanged.
    await page.evaluate(token => {
        sim.bootComplete = true;
        sim.nsCount = Math.max(Number(sim.nsCount) || 0, 11);
        sim.lumpTokenAtSlot = slot => slot === 10 ? token : null;
    }, TOKEN);
}

async function simulatorState(page) {
    return page.evaluate(async () => {
        const memory = Array.from(sim.memory || [], value => value >>> 0);
        const memoryBytes = new Uint8Array(memory.length * 4);
        memory.forEach((word, index) => {
            memoryBytes[index * 4] = word >>> 24;
            memoryBytes[index * 4 + 1] = word >>> 16;
            memoryBytes[index * 4 + 2] = word >>> 8;
            memoryBytes[index * 4 + 3] = word;
        });
        const digest = await crypto.subtle.digest('SHA-256', memoryBytes);
        return {
            bootComplete: sim.bootComplete,
            halted: sim.halted,
            pc: sim.pc,
            stepCount: sim.stepCount,
            memoryHash: Array.from(new Uint8Array(digest))
                .map(byte => byte.toString(16).padStart(2, '0')).join(''),
        };
    });
}

test.describe('saved-LUMP Load into Sim authorization', () => {
    test('HTTP authorization rejection leaves the simulator unchanged', async ({ page }) => {
        await configureSavedLump(page, {
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'deployment denied' }),
        });
        await loadBrowserSimulator(page);
        const before = await simulatorState(page);
        const button = await openLoadIntoSimButton(page);

        const dialogs = [];
        page.on('dialog', async dialog => {
            dialogs.push({ type: dialog.type(), message: dialog.message() });
            await dialog.accept();
        });
        await button.click();
        await expect(button).toHaveText('Load into Sim ▶');
        expect(dialogs.map(dialog => dialog.type)).toEqual(['confirm', 'alert']);
        expect(dialogs[1].message).toContain('Authorize LUMP deployment failed');

        expect(await simulatorState(page)).toEqual(before);
    });

    test('successful HTTP response with an explicit denial body leaves the simulator unchanged', async ({ page }) => {
        await configureSavedLump(page, {
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: false, error: 'approval was denied' }),
        });
        await loadBrowserSimulator(page);
        const before = await simulatorState(page);
        const button = await openLoadIntoSimButton(page);

        const dialogs = [];
        page.on('dialog', async dialog => {
            dialogs.push({ type: dialog.type(), message: dialog.message() });
            await dialog.accept();
        });
        await button.click();
        await expect(button).toHaveText('Load into Sim ▶');
        expect(dialogs.map(dialog => dialog.type)).toEqual(['confirm', 'alert']);
        expect(dialogs[1].message).toContain('Authorize LUMP deployment failed');

        expect(await simulatorState(page)).toEqual(before);
    });

    test('accepted authorization reaches the normal simulator load path', async ({ page }) => {
        await configureSavedLump(page, {
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                authorization: 'ephemeral-simulator-deploy',
            }),
        });
        await loadBrowserSimulator(page);
        await page.evaluate(() => {
            window.__savedLumpLoadCalls = 0;
            sim.loadLumpBinary = function(...args) {
                window.__savedLumpLoadCalls++;
                return true;
            };
        });
        const button = await openLoadIntoSimButton(page);

        await page.once('dialog', dialog => dialog.accept());
        await button.click();
        await expect(button).toHaveText('Loaded ✓');
        expect(await page.evaluate(() => window.__savedLumpLoadCalls)).toBe(1);
        await expect(page.locator('#editorConsole')).toContainText('Loaded LUMP');
    });
});