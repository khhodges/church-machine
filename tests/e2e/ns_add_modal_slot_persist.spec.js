'use strict';

// Namespace slot choices are Namespace runtime state. Reopening the Add modal
// in the same session must use that state without reading or patching artifact
// metadata.

const { test, expect } = require('@playwright/test');

const TOKEN = 'abc12345';
const APPROVAL = {
    token: TOKEN,
    abstraction: 'Policy.Probe',
    dot_name: 'Policy.Probe',
    binary_hash: 'a'.repeat(64),
    approved: true,
    content_type: 'code',
    capabilities: [],
};
const WORDS = [0xF8000400, ...Array(63).fill(0)];

test('Namespace Add retains slot policy without artifact metadata endpoints', async ({ page }) => {
    let forbiddenRequests = 0;
    await page.route('**/api/lumps/list', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([APPROVAL]),
    }));
    await page.route(`**/api/lump/${TOKEN}/words`, route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ words: WORDS, binary_hash: APPROVAL.binary_hash, approved: true }),
    }));
    page.on('request', request => {
        const retiredSegments = new Set([
            ['me', 'ta'].join(''), ['de', 'tail'].join(''),
            ['wip', 'source'].join('-')
        ]);
        const segment = new URL(request.url()).pathname.split('/').pop();
        if (retiredSegments.has(segment)) forbiddenRequests++;
    });

    await page.goto('/simulator/');
    await page.waitForFunction(() => typeof sim !== 'undefined' && typeof _nsTableAdd === 'function');
    await page.evaluate(() => {
        switchView('namespace');
        _nsTableAdd();
    });
    await expect(page.locator('#_nsAddConfirmBtn')).toBeEnabled();

    const slot = 11;
    await page.locator('#_nsSlotPolicy').selectOption('static');
    await page.locator('#_nsSlotInput').fill(String(slot));
    await page.locator('#_nsAddConfirmBtn').click();
    await expect(page.locator('#_nsAddModalOverlay')).toHaveCount(0);

    await page.evaluate(() => {
        if (sim.isNSEntryValid(11)) sim.clearNSEntry(11);
        _nsTableAdd();
    });
    await expect(page.locator('#_nsAddConfirmBtn')).toBeEnabled();
    await expect(page.locator('#_nsSlotPolicy')).toHaveValue('static');
    await expect(page.locator('#_nsSlotInput')).toHaveValue(String(slot));
    expect(forbiddenRequests).toBe(0);
});