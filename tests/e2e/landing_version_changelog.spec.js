'use strict';

// Landing hero regression coverage: the displayed version comes from the
// boot/version endpoint and the hero affordance opens the existing modal.
const { test, expect } = require('@playwright/test');

async function openLanding(page) {
    await page.addInitScript(() => {
        localStorage.setItem('church_visited', '1');
        localStorage.setItem('church_whatsnew_dismissed_perm', '1');
    });
    await page.goto('/simulator/');
    await page.waitForFunction(() => typeof window.showWhatsNew === 'function', null, {
        timeout: 15000
    });
}

test.describe('Landing page version and What\'s New', () => {
    test('renders the authoritative IDE version and opens What\'s New', async ({ page }) => {
        await openLanding(page);
        const boot = await page.evaluate(() => fetch('/api/boot-id').then(r => r.json()));

        await expect(page.locator('#landing-version')).toHaveText('v' + boot.version, {
            timeout: 15000
        });
        const updates = page.locator('.home-whats-new-btn');
        await expect(updates).toHaveAttribute('aria-label', "Open What's New updates");
        await updates.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#whatsNewModal')).toBeVisible();
        await expect(page.locator('#whatsNewBody')).toContainText('Salvation');
    });

    test('keeps the Help menu What\'s New entry available', async ({ page }) => {
        await openLanding(page);
        await page.locator('#helpMenuWrap > button').click();
        await expect(page.locator('.help-dropdown-item', { hasText: "What's New" })).toBeVisible();
    });
});