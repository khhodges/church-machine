'use strict';

// builder_design_pages.spec.js — Playwright E2E tests for the Thread Lump and
// Namespace Lump design pages in the Builder view (Task: surface hidden tabs).
//
// Suite 1 — tabs visible: the "Thread Lump" and "Namespace Lump" tabs are
//   visible in the Builder tab strip (no display:none).
// Suite 2 — pages render: clicking each tab shows the design hero (Wukong
//   Artix-7 branding), the design reference sections, and the interactive
//   lump editor grid.
// Suite 3 — other tabs still work: switching to Log and Connect after a
//   design page keeps the Builder tab strip functional.

const { test, expect } = require('@playwright/test');

async function openBuilder(page) {
    await page.goto('/simulator/');
    await page.waitForLoadState('domcontentloaded');

    // #hamItem-builder is hidden by default (debug-only view); un-hide for E2E.
    await page.evaluate(() => {
        const btn = document.getElementById('hamItem-builder');
        if (btn) btn.style.display = '';
    });

    const hamBtn = page.locator('#hamBtn');
    await hamBtn.waitFor({ state: 'visible' });
    await hamBtn.click();

    const builderBtn = page.locator('#hamItem-builder');
    await builderBtn.waitFor({ state: 'visible' });
    await builderBtn.click();
}

test.describe('Builder design pages — Thread Lump & Namespace Lump', () => {

    test('tabs are visible in the Builder tab strip', async ({ page }) => {
        await openBuilder(page);
        const threadTab = page.locator('#builderViewTab-lump-thread');
        const nsTab     = page.locator('#builderViewTab-lump-ns');
        await expect(threadTab).toBeVisible();
        await expect(nsTab).toBeVisible();
        await expect(threadTab).toHaveText(/Thread Lump/);
        await expect(nsTab).toHaveText(/Namespace Lump/);
    });

    test('Thread Lump design page renders hero + design reference + editor', async ({ page }) => {
        await openBuilder(page);
        await page.locator('#builderViewTab-lump-thread').click();

        const panel = page.locator('#lumpThreadPanel');
        await expect(panel).toBeVisible();

        // Wukong-branded hero
        await expect(panel.locator('.le-design-hero-title')).toHaveText(/Thread Lump/);
        await expect(panel.locator('.le-design-hero-board')).toHaveText(/Wukong/i);
        // No Ti60/Efinix branding in the page copy
        const heroText = await panel.locator('.le-design-hero').innerText();
        expect(heroText).not.toMatch(/Ti60|Efinix/i);

        // Design reference sections (from the Thread tutorial content)
        await expect(panel.locator('.le-design-step').first()).toBeVisible({ timeout: 8000 });
        expect(await panel.locator('.le-design-step').count()).toBeGreaterThan(3);

        // Interactive editor still present
        await expect(panel.locator('.le-panel')).toBeVisible();
        await expect(panel.locator('#le-t-lump-sel')).toBeVisible();
    });

    test('Namespace Lump design page renders hero + design reference + editor', async ({ page }) => {
        await openBuilder(page);
        await page.locator('#builderViewTab-lump-ns').click();

        const panel = page.locator('#lumpNSPanel');
        await expect(panel).toBeVisible();

        await expect(panel.locator('.le-design-hero-title')).toHaveText(/Namespace Lump/);
        await expect(panel.locator('.le-design-hero-board')).toHaveText(/Wukong/i);
        const heroText = await panel.locator('.le-design-hero').innerText();
        expect(heroText).not.toMatch(/Ti60|Efinix/i);

        await expect(panel.locator('.le-design-step').first()).toBeVisible({ timeout: 8000 });
        expect(await panel.locator('.le-design-step').count()).toBeGreaterThan(3);

        await expect(panel.locator('.le-panel')).toBeVisible();
        await expect(panel.locator('#le-ns-size-sel')).toBeVisible();
    });

    test('other Builder tabs still work after visiting a design page', async ({ page }) => {
        await openBuilder(page);

        // Visit Thread Lump design page…
        await page.locator('#builderViewTab-lump-thread').click();
        await expect(page.locator('#lumpThreadPanel')).toBeVisible();

        // …then switch to Log
        await page.locator('#builderViewTab-buildlog').click();
        await expect(page.locator('#lumpThreadPanel')).toBeHidden();
        await expect(page.locator('#builderViewTab-buildlog')).toHaveClass(/active/);

        // …then Connect
        await page.locator('#builderViewTab-ti60-connect').click();
        await expect(page.locator('#ti60ConnectPanel')).toBeVisible();
        await expect(page.locator('#builderViewTab-ti60-connect')).toHaveClass(/active/);

        // …and back to Namespace Lump
        await page.locator('#builderViewTab-lump-ns').click();
        await expect(page.locator('#lumpNSPanel')).toBeVisible();
        await expect(page.locator('#ti60ConnectPanel')).toBeHidden();
    });
});
