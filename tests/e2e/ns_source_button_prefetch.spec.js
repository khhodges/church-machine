'use strict';

// ns_source_button_prefetch.spec.js
//
// Regression test for Task #1437: Source buttons in the NS view must appear
// on the very first load of the Namespace view — without requiring a prior
// visit to the Repository view — because updateNamespace() lazily pre-fetches
// /api/lumps/list when _lumpsCache is empty.
//
// Suite 1 — Source button appears on first NS load (no Repository visit):
//   Intercept /api/lumps/list to return a stub lump assigned to NS slot 6.
//   Navigate straight to the Namespace view and confirm the Source button
//   renders in the row for slot 6.
//   (Slot 4 is hardware-tier — no Source button; slot 6 = Boot.Abstr/SelfTest
//   is boot-tier and always present in the NS table regardless of whether a
//   full boot image has loaded.  Slots 7–10 are lazy-loaded and their NS rows
//   only appear after the boot image binary is applied.)
//
// Suite 2 — No Source button when /api/lumps/list fails:
//   Intercept /api/lumps/list to return a 500 error.
//   Navigate to the Namespace view; confirm no Source button renders (graceful
//   fallback) and no JS error is thrown.
//
// Suite 3 — Pre-fetch is only attempted once (warm-attempted guard):
//   Intercept /api/lumps/list to return an empty array (zero lumps).
//   Render Namespace twice; confirm exactly one request is made (not one per
//   render).

const { test, expect } = require('@playwright/test');

const STUB_LUMP = {
    token:       'ab1e86af',
    abstraction: 'WordString',
    ns_slot:     6,
    lump_size:   64,
    lump_version: 1,
};

async function openNamespaceView(page) {
    await page.goto('/simulator/');
    await page.waitForLoadState('networkidle');

    const hamBtn = page.locator('#hamBtn');
    await hamBtn.waitFor({ state: 'visible' });
    await hamBtn.click();

    const nsBtn = page.locator('#hamItem-namespace');
    await nsBtn.waitFor({ state: 'visible' });
    await nsBtn.click();

    const nsTable = page.locator('#namespaceTable');
    await nsTable.waitFor({ state: 'visible' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Source button appears on first NS load
// ─────────────────────────────────────────────────────────────────────────────

test.describe('NS Source button — first load without Repository visit', () => {

    test('Source button appears in slot 6 row after cache warms', async ({ page }) => {
        test.setTimeout(40000);

        await page.route('**/api/lumps/list', async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify([STUB_LUMP]),
            });
        });

        await openNamespaceView(page);

        // The pre-fetch completes asynchronously; updateNamespace() re-renders
        // once the cache is warm.  Wait up to 8 s for the Source button in slot 6.
        // Slot 6 = Boot.Abstr / SelfTest — always rendered after cold boot.
        // (Slots 7–10 are lazy-loaded and only appear once the boot image binary
        // has been applied, making them unreliable as e2e anchor points.)
        const sourceBtn = page.locator('#ns-row-6 button', { hasText: 'Source' });
        await expect(sourceBtn).toBeVisible({ timeout: 8000 });
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Graceful fallback when pre-fetch fails
// ─────────────────────────────────────────────────────────────────────────────

test.describe('NS Source button — graceful fallback on fetch failure', () => {

    test('no Source button and no JS error when /api/lumps/list returns 500', async ({ page }) => {
        test.setTimeout(40000);

        const jsErrors = [];
        page.on('pageerror', err => jsErrors.push(err.message));

        await page.route('**/api/lumps/list', async route => {
            await route.fulfill({ status: 500, body: 'Internal Server Error' });
        });

        await openNamespaceView(page);

        // Give the (failed) async fetch a moment to settle.
        await page.waitForTimeout(500);

        // No Source button should be visible anywhere in the NS table.
        const sourceBtns = page.locator('#namespaceTable button', { hasText: 'Source' });
        await expect(sourceBtns).toHaveCount(0);

        // No JS error should have been thrown.
        expect(jsErrors).toHaveLength(0);
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Pre-fetch attempted only once when list is empty
// ─────────────────────────────────────────────────────────────────────────────

test.describe('NS Source button — warm-attempted guard prevents repeated fetches', () => {

    test('only one /api/lumps/list request is made even across multiple renders', async ({ page }) => {
        test.setTimeout(40000);

        let fetchCount = 0;

        await page.route('**/api/lumps/list', async route => {
            fetchCount++;
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify([]),
            });
        });

        await openNamespaceView(page);

        // Give the initial fetch time to settle.
        await page.waitForTimeout(500);

        // Force a second render by evaluating updateNamespace() in the page.
        await page.evaluate(() => {
            if (typeof updateNamespace === 'function') updateNamespace();
        });
        await page.waitForTimeout(300);

        // Exactly one fetch should have been made despite two renders.
        expect(fetchCount).toBe(1);
    });

});
