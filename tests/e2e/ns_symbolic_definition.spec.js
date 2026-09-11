'use strict';
const { test, expect } = require('@playwright/test');

test('defines and persists a code-free Namespace abstraction without fetching words', async ({ page }) => {
    let wordsRequests = 0;
    await page.route('**/api/lumps/list', route => route.fulfill({
        status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'offline' })
    }));
    page.on('request', request => {
        if (/\/api\/lump\/[^/]+\/words$/.test(new URL(request.url()).pathname)) wordsRequests++;
    });
    await page.goto('/simulator/');
    await page.waitForFunction(() => typeof sim !== 'undefined' && sim &&
        typeof sim.defineSymbolicAbstraction === 'function' && typeof _nsTableAdd === 'function');
    await page.evaluate(() => { switchView('namespace'); _nsTableAdd(); });
    await page.getByRole('button', { name: 'Define new abstraction' }).click();
    await page.locator('#_nsSymbolicName').fill('Future.Service');
    await expect(page.locator('#_nsSymbolicPreview')).toContainText('Inform E GT');
    await page.locator('#_nsSymbolicConfirm').click();
    await expect(page.locator('#_nsAddModalOverlay')).toHaveCount(0);
    await expect(page.locator('[data-testid="ns-symbolic-badge"]')).toContainText('code missing');
    expect(wordsRequests).toBe(0);
    await page.reload();
    await page.waitForFunction(() => typeof sim !== 'undefined');
    await page.evaluate(() => switchView('namespace'));
    await expect(page.locator('[data-testid="ns-symbolic-badge"]')).toContainText('code missing');
    expect(wordsRequests).toBe(0);
});