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

    test('NS Table drill-down: valid committed image is clean, words match server, out-of-contract slot faults', async ({ page }) => {
        // Fetch the authoritative committed snapshot first.
        const nsState = await (await page.request.get('/api/boot-image/ns-state')).json();

        await openBuilder(page);
        await page.locator('#builderViewTab-lump-ns').click();
        const panel = page.locator('#lumpNSPanel');
        await expect(panel).toBeVisible();

        // Open the drill-down (fresh localStorage → design seeds from committed geometry).
        await page.evaluate(() => window.lumpEditorToggleNSDrill());
        await expect(panel.locator('.le-nsd-panel')).toBeVisible({ timeout: 8000 });
        await expect(panel.locator('.le-nsd-banner')).toBeVisible({ timeout: 8000 });

        if (nsState.committed) {
            // 1. A valid committed image against the seeded default design is CLEAN.
            await expect(panel.locator('.le-nsd-banner-ok')).toBeVisible({ timeout: 8000 });
            expect(await panel.locator('.le-nsd-fault').count()).toBe(0);

            // 2. Row count equals committed capacity; slot 0 sits at the top byte address.
            const cap = nsState.committed.maxEntries;
            expect(await panel.locator('.le-nsd-row').count()).toBe(cap);
            const slot0Addr = (nsState.committed.totalWords * 4 - 16)
                .toString(16).toUpperCase();
            await expect(panel.locator('.le-nsd-row').first()).toContainText('0x' + slot0Addr);

            // 3. Expanded 4-word view shows the exact raw words from the boot image.
            const raw0 = nsState.committed.entries.find(e => e.slot === 0);
            if (raw0) {
                await panel.locator('.le-nsd-pop').first().click();
                const detail = await panel.locator('.le-nsd-detail').innerText();
                const hex8 = v => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
                expect(detail).toContain(hex8(raw0.w0));
                expect(detail).toContain(hex8(raw0.w1));
                expect(detail).toContain(hex8(raw0.w2));
                expect(detail).toContain(hex8(raw0.w3));
            }
        }

        // 4. An out-of-contract committed slot is flagged as a fault.
        await page.evaluate(() => {
            const orig = window.fetch;
            window.fetch = (u, o) => {
                if (String(u).includes('/api/boot-image/ns-state')) {
                    return Promise.resolve({ json: () => Promise.resolve({ abstractions: [
                        { name: 'Rogue', slot: 2000, location: '0x00100000', type: 'Inform',
                          f: 0, g: 0, limit: '0x0003F', seq: 0, seal: '0x0000' }
                    ] }) });
                }
                return orig(u, o);
            };
            window.lumpEditorNSDrillRefresh();
        });
        await expect(panel.locator('.le-nsd-banner-fault')).toBeVisible({ timeout: 8000 });
        await expect(panel.locator('.le-nsd-fault').first()).toContainText('Rogue');
        await expect(panel.locator('.le-nsd-fault-detail').first())
            .toContainText('beyond the approved capacity');
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
