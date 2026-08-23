'use strict';

const { test, expect } = require('@playwright/test');

async function waitForReference(page, url = '/simulator/#reference') {
    await page.goto(url);
    await page.waitForFunction(() =>
        typeof window.switchView === 'function' &&
        typeof window.switchRefTab === 'function'
    );
    await expect(page.locator('#reference')).toBeVisible({ timeout: 10000 });
}

test.describe('Reference tabs', () => {
    test('opens Hardware Architecture by default with M-bit rules collapsed', async ({ page }) => {
        await waitForReference(page);

        await expect(page.locator('#refTab-hardware')).toHaveClass(/active/);
        await expect(page.locator('#refPanel-hardware')).toBeVisible();
        await expect(page.locator('#refPanel-abstractions')).toBeHidden();

        const rules = page.locator('.mbit-rules-box');
        await expect(rules).not.toHaveAttribute('open', '');
        await expect(rules.locator('.mbit-rules-title')).toBeVisible();
        await expect(rules.locator('.mbit-rules-body')).toBeHidden();
        await expect(page.locator('#instrListChurch')).toBeVisible();
    });

    test('expands the complete M-bit rules explanation from the keyboard', async ({ page }) => {
        await waitForReference(page);

        const rules = page.locator('.mbit-rules-box');
        const summary = rules.locator('.mbit-rules-title');
        await summary.focus();
        await page.keyboard.press('Enter');

        await expect(rules).toHaveAttribute('open', '');
        await expect(rules.locator('.mbit-rules-body')).toBeVisible();
        await expect(rules.locator('.mbit-rules-body')).toContainText('The M-bit is a 1-bit flag');
        await expect(rules.locator('.mbit-legend')).toContainText('save/restore');
    });

    test('supports the explicit Abstractions & Methods tab URL override', async ({ page }) => {
        await waitForReference(page, '/simulator/#reference?tab=abstractions');

        await expect(page.locator('#refTab-abstractions')).toHaveClass(/active/);
        await expect(page.locator('#refPanel-abstractions')).toBeVisible();
        await expect(page.locator('#refPanel-hardware')).toBeHidden();
    });

    test('keeps explicit tab switching functional', async ({ page }) => {
        await waitForReference(page);

        await page.locator('#refTab-abstractions').click();
        await expect(page.locator('#refTab-abstractions')).toHaveClass(/active/);
        await expect(page.locator('#refPanel-abstractions')).toBeVisible();

        await page.locator('#refTab-hardware').click();
        await expect(page.locator('#refTab-hardware')).toHaveClass(/active/);
        await expect(page.locator('#refPanel-hardware')).toBeVisible();
    });
});