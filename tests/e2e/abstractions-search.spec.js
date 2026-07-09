'use strict';

// abstractions-search.spec.js — Playwright E2E tests for Task #1369
//
// Covers the search filter on the Abstractions & Methods tab of the Reference
// panel.  The filter is implemented by filterAbstractions() in app-compile.js
// and is triggered by the #absSearchInput <input type="search"> element.
//
// Suite 1 — name search:
//   Typing "Navana" shows only Navana-matching cards; unrelated cards are hidden.
//
// Suite 2 — slot-number search:
//   Typing "8" makes the Scheduler card (NS[8]) visible.
//
// Suite 3 — clear restores all cards:
//   After filtering, clearing the input shows every card and every layer header.
//
// All three suites use the live application (no mocking) because the
// abstraction catalogue is a static JS file (api-data.js) that is always
// present without any server-side API call.

const { test, expect } = require('@playwright/test');

// ─────────────────────────────────────────────────────────────────────────────
// Helper — navigate to the Reference panel, abstractions tab
// ─────────────────────────────────────────────────────────────────────────────

async function openAbstractionsPanel(page) {
    // S-IDE v1 hides the "Learn" hamburger group (which contains the
    // Reference item) behind ?learn=1 — see .ham-group.ham-learn-section
    // in simulator/index.html. Without it, #hamItem-reference stays
    // display:none and this helper times out waiting for it to be visible.
    await page.goto('/simulator/?learn=1');
    await page.waitForLoadState('networkidle');

    // Open hamburger menu.
    const hamBtn = page.locator('#hamBtn');
    await hamBtn.waitFor({ state: 'visible' });
    await hamBtn.click();

    // Click the Reference item.
    const refBtn = page.locator('#hamItem-reference');
    await refBtn.waitFor({ state: 'visible' });
    await refBtn.click();

    // Explicitly activate the Abstractions & Methods tab (deterministic regardless
    // of which tab was last active).
    const absTab = page.locator('#refTab-abstractions');
    await absTab.waitFor({ state: 'visible' });
    await absTab.click();

    // Wait for at least one abstraction card to be present (catalogue loaded).
    const absList = page.locator('#instrListAbstractions');
    await absList.waitFor({ state: 'visible' });
    await expect(absList.locator('.api-ref-abs-card').first()).toBeVisible({ timeout: 10000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — typing a name filters matching cards
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Abstractions search — name filter', () => {

    test('typing "Navana" shows only matching cards and hides others', async ({ page }) => {
        test.setTimeout(40000);
        await openAbstractionsPanel(page);

        const searchInput = page.locator('#absSearchInput');
        const absList     = page.locator('#instrListAbstractions');

        // Total card count before filtering (must be > 1 for the test to be meaningful).
        const totalBefore = await absList.locator('.api-ref-abs-card').count();
        expect(totalBefore).toBeGreaterThan(1);

        // Type the search query.
        await searchInput.fill('Navana');
        await searchInput.dispatchEvent('input');

        // The Navana card must be visible.
        const navanaCard = absList.locator('.api-ref-abs-card', {
            has: page.locator('.api-ref-abs-name', { hasText: 'Navana' }),
        }).first();
        await expect(navanaCard).toBeVisible();

        // Unrelated cards (e.g. Scheduler, which is NS[8]) must be hidden.
        const schedulerCard = absList.locator('.api-ref-abs-card', {
            has: page.locator('.api-ref-abs-name', { hasText: 'Scheduler' }),
        }).first();
        await expect(schedulerCard).toBeHidden();

        // The number of visible cards must be less than the total.
        const visibleCount = await absList.locator('.api-ref-abs-card:visible').count();
        expect(visibleCount).toBeLessThan(totalBefore);
        expect(visibleCount).toBeGreaterThan(0);

        // Every visible card must contain "navana" in its name, description,
        // or slot text — confirming the filter is not just hiding some cards
        // but is correctly showing only genuinely matching ones.
        const allMatchNavana = await page.evaluate(() => {
            const list = document.getElementById('instrListAbstractions');
            if (!list) return false;
            const visible = [...list.querySelectorAll('.api-ref-abs-card')]
                .filter(c => c.style.display !== 'none');
            return visible.every(card => {
                const text = (card.textContent || '').toLowerCase();
                return text.includes('navana');
            });
        });
        expect(allMatchNavana, 'every visible card must contain "navana"').toBe(true);

        // Layer headers for layers with no visible cards must be hidden —
        // verify by checking that fewer headers are visible than the total.
        const totalHeaders      = await absList.locator('.api-ref-layer-header').count();
        const visibleHeaderCount = await absList.locator('.api-ref-layer-header:visible').count();
        expect(visibleHeaderCount).toBeLessThan(totalHeaders);
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — slot-number search
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Abstractions search — slot number filter', () => {

    test('typing "8" makes the Scheduler card (NS[8]) visible', async ({ page }) => {
        test.setTimeout(40000);
        await openAbstractionsPanel(page);

        const searchInput = page.locator('#absSearchInput');
        const absList     = page.locator('#instrListAbstractions');

        await searchInput.fill('8');
        await searchInput.dispatchEvent('input');

        // The Scheduler card lives at NS[8] — its slot span contains "NS[8]".
        const schedulerCard = absList.locator('.api-ref-abs-card', {
            has: page.locator('.api-ref-abs-slot', { hasText: 'NS[8]' }),
        }).first();
        await expect(schedulerCard).toBeVisible();

        // The card must also display the name "Scheduler".
        await expect(schedulerCard.locator('.api-ref-abs-name')).toContainText('Scheduler');
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — clearing the input restores all cards and layer headers
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Abstractions search — clear restores all cards', () => {

    test('clearing the search input makes all cards and headers visible again', async ({ page }) => {
        test.setTimeout(40000);
        await openAbstractionsPanel(page);

        const searchInput = page.locator('#absSearchInput');
        const absList     = page.locator('#instrListAbstractions');

        // Record baseline counts.
        const totalCards   = await absList.locator('.api-ref-abs-card').count();
        const totalHeaders = await absList.locator('.api-ref-layer-header').count();
        expect(totalCards).toBeGreaterThan(1);

        // Apply a filter that hides most cards.
        await searchInput.fill('Navana');
        await searchInput.dispatchEvent('input');

        // Confirm something was actually hidden before we clear.
        const visibleAfterFilter = await absList.locator('.api-ref-abs-card:visible').count();
        expect(visibleAfterFilter).toBeLessThan(totalCards);

        // Clear the input by using the built-in clear action then firing the event.
        await searchInput.fill('');
        await searchInput.dispatchEvent('input');

        // All cards must now be visible again.
        const visibleAfterClear = await absList.locator('.api-ref-abs-card:visible').count();
        expect(visibleAfterClear).toBe(totalCards);

        // All layer headers must be visible again.
        const visibleHeaders = await absList.locator('.api-ref-layer-header:visible').count();
        expect(visibleHeaders).toBe(totalHeaders);
    });

});
