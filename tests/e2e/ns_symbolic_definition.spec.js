'use strict';
const { test, expect } = require('@playwright/test');

test('NEW remains available after a selected LUMP returns 404 and opens a fresh assembler editor', async ({ page }) => {
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
    await expect(page.locator('#_nsAddModalOverlay')).toHaveCount(0);
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('#asmEditor')).toHaveValue(/abstraction New\.Abstraction \{/);
    await expect(page.locator('#asmEditor')).toHaveValue(/capabilities \{/);
    await expect(page.locator('[data-testid="ns-symbolic-badge"]')).toHaveCount(0);
    expect(wordsRequests).toBe(1);
});

test('clicking a Namespace label without saved source opens its named assembler editor', async ({ page }) => {
    await page.goto('/simulator/');
    await page.waitForFunction(() => typeof sim !== 'undefined' && sim &&
        typeof sim.defineSymbolicAbstraction === 'function' && typeof _nsLabelOpen === 'function');
    const slot = await page.evaluate(() => {
        const created = sim.defineSymbolicAbstraction('Future.Service');
        updateNamespace();
        return created.slot;
    });
    await page.evaluate(() => switchView('namespace'));
    await page.locator(`#ns-row-${slot} .ns-label`).click();
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('#asmEditor')).toHaveValue(/abstraction Future\.Service \{/);
    await expect(page.locator('#_nsLumpModalOverlay')).toHaveCount(0);
});
