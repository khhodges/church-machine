'use strict';

// versions_tab.spec.js — Builder ▸ Versions tab (IDE / GitHub / FPGA cards)
//
// Covers:
//   - Deep link ?view=builder&tab=versions opens the panel
//   - All three cards render with a status badge (no silent blanks)
//   - IDE card shows the running server version
//   - FPGA card shows "Board not connected" when the bridge is offline
//   - Manual refresh button works

const { test, expect } = require('@playwright/test');

async function openVersionsTab(page) {
    await page.addInitScript(() => {
        try {
            localStorage.setItem('church_visited', '1');
            localStorage.setItem('whatsnew_seen_version', '9999');
        } catch (e) {}
    });
    await page.goto('/simulator/?view=builder&tab=versions');
    // The URL router applies the view after init(); force it deterministically.
    await page.waitForFunction(() => typeof window.switchView === 'function'
        && typeof window.switchBuilderViewTab === 'function', null, { timeout: 30000 });
    await page.evaluate(() => {
        window.switchView('builder');
        window.switchBuilderViewTab('versions');
    });
    await expect(page.locator('#versionsPanel')).toBeVisible();
}

test.describe('Builder ▸ Versions tab', () => {
    test('deep link renders panel with three cards and badges', async ({ page }) => {
        await openVersionsTab(page);
        await expect(page.locator('#versionsCardIde')).toBeVisible();
        await expect(page.locator('#versionsCardGithub')).toBeVisible();
        await expect(page.locator('#versionsCardFpga')).toBeVisible();
        // Every card must resolve to a badge (never stuck on "Loading…").
        await expect(page.locator('#versionsIdeBody .versions-badge')).toHaveCount(1, { timeout: 15000 });
        await expect(page.locator('#versionsGithubBody .versions-badge')).toHaveCount(1, { timeout: 15000 });
        await expect(page.locator('#versionsFpgaBody .versions-badge')).toHaveCount(1, { timeout: 15000 });
    });

    test('IDE card shows the running server version', async ({ page }) => {
        await openVersionsTab(page);
        const status = await page.evaluate(() =>
            fetch('/hardware/wukong/status').then(r => r.json()));
        await expect(page.locator('#versionsIdeBody code'))
            .toHaveText(status.ide_version, { timeout: 15000 });
    });

    test('FPGA card shows board-not-connected when bridge is offline', async ({ page }) => {
        await openVersionsTab(page);
        const status = await page.evaluate(() =>
            fetch('/hardware/wukong/status').then(r => r.json()));
        const badge = page.locator('#versionsFpgaBody .versions-badge');
        await expect(badge).toHaveCount(1, { timeout: 15000 });
        if (!status.bridge_connected) {
            await expect(badge).toHaveText(/Board not connected/);
        }
    });

    test('manual refresh updates last-checked stamp', async ({ page }) => {
        await openVersionsTab(page);
        await expect(page.locator('#versionsLastChecked')).not.toHaveText('', { timeout: 15000 });
        const before = await page.locator('#versionsLastChecked').textContent();
        await page.waitForTimeout(1100);
        await page.click('#versionsRefreshBtn');
        await expect(page.locator('#versionsLastChecked')).not.toHaveText(before, { timeout: 15000 });
    });

    test('graceful GitHub failure shows explicit unavailable state', async ({ page }) => {
        await page.route('**/api/github/activity', route => route.abort());
        await openVersionsTab(page);
        await expect(page.locator('#versionsGithubBody .versions-badge-unknown'))
            .toHaveCount(1, { timeout: 15000 });
    });
});
