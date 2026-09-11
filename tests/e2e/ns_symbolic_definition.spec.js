'use strict';
const { test, expect } = require('@playwright/test');

test('NEW remains available after a selected LUMP returns 404 and defines a code-free abstraction', async ({ page }) => {
    let wordsRequests = 0;
    await page.route('**/api/lumps/list', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([{ token: '00000000', abstraction: 'Boot.NS' }])
    }));
    await page.route('**/api/lump/00000000/words', route => route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unknown lump 0x00000000' })
    }));
    page.on('request', request => {
        if (/\/api\/lump\/[^/]+\/words$/.test(new URL(request.url()).pathname)) wordsRequests++;
    });
    await page.goto('/simulator/');
    await page.waitForFunction(() => typeof sim !== 'undefined' && sim &&
        typeof sim.defineSymbolicAbstraction === 'function' && typeof _nsTableAdd === 'function');
    await page.evaluate(() => { switchView('namespace'); _nsTableAdd(); });
    await expect(page.locator('#_nsAddMeta')).toContainText('HTTP 404');
    await expect(page.getByRole('button', { name: 'NEW', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'NEW', exact: true })).toBeEnabled();
    expect(wordsRequests).toBe(1);
    await page.getByRole('button', { name: 'NEW', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Back to LUMPs' })).toBeVisible();
    await expect(page.locator('#_nsSymbolicName')).toBeVisible();
    expect(wordsRequests).toBe(1);
    await page.locator('#_nsSymbolicName').fill('Future.Service');
    await expect(page.locator('#_nsSymbolicPreview')).toContainText('Inform E GT');
    await page.locator('#_nsSymbolicConfirm').click();
    await expect(page.locator('#_nsAddModalOverlay')).toHaveCount(0);
    await expect(page.locator('[data-testid="ns-symbolic-badge"]')).toContainText('code missing');
    expect(wordsRequests).toBe(1);
    await page.reload();
    await page.waitForFunction(() => typeof sim !== 'undefined');
    await page.evaluate(() => switchView('namespace'));
    await expect(page.locator('[data-testid="ns-symbolic-badge"]')).toContainText('code missing');
    expect(wordsRequests).toBe(1);
});
