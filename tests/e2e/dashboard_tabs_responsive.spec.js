'use strict';

const { test, expect } = require('@playwright/test');

const VIEWPORTS = [
    { name: 'desktop', width: 1280, height: 800, shouldWrap: false },
    { name: 'narrow', width: 360, height: 800, shouldWrap: true },
];

for (const viewport of VIEWPORTS) {
    test(`dashboard tabs stay visible and usable at ${viewport.name} width`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto('/simulator/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.switchView === 'function');
        await page.evaluate(() => window.switchView('dashboard'));

        const tablist = page.getByRole('tablist', { name: 'Dashboard panels' });
        const tabs = tablist.getByRole('tab');
        await expect(tablist).toBeVisible();
        await expect(tabs).toHaveCount(6);

        for (const tab of await tabs.all()) {
            await expect(tab).toBeVisible();
        }

        const geometry = await tablist.evaluate((list) => {
            const epsilon = 0.5;
            const listRect = list.getBoundingClientRect();
            const tabRects = Array.from(list.querySelectorAll('[role="tab"]'), (tab) => {
                const rect = tab.getBoundingClientRect();
                return {
                    id: tab.id,
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                };
            });
            const overlaps = [];

            for (let first = 0; first < tabRects.length; first += 1) {
                for (let second = first + 1; second < tabRects.length; second += 1) {
                    const a = tabRects[first];
                    const b = tabRects[second];
                    const overlapsHorizontally =
                        a.left < b.right - epsilon && b.left < a.right - epsilon;
                    const overlapsVertically =
                        a.top < b.bottom - epsilon && b.top < a.bottom - epsilon;
                    if (overlapsHorizontally && overlapsVertically) {
                        overlaps.push(`${a.id}/${b.id}`);
                    }
                }
            }

            return {
                listLeft: listRect.left,
                listRight: listRect.right,
                viewportWidth: window.innerWidth,
                rows: new Set(tabRects.map((rect) => Math.round(rect.top))).size,
                clippedTabs: tabRects
                    .filter((rect) =>
                        rect.left < listRect.left - epsilon ||
                        rect.right > listRect.right + epsilon ||
                        rect.left < -epsilon ||
                        rect.right > window.innerWidth + epsilon
                    )
                    .map((rect) => rect.id),
                overlaps,
            };
        });

        expect(geometry.listLeft).toBeGreaterThanOrEqual(0);
        expect(geometry.listRight).toBeLessThanOrEqual(geometry.viewportWidth);
        expect(geometry.clippedTabs).toEqual([]);
        expect(geometry.overlaps).toEqual([]);
        expect(geometry.rows).toBe(viewport.shouldWrap ? 2 : 1);

        for (const tab of await tabs.all()) {
            const panelId = await tab.getAttribute('aria-controls');
            await tab.focus();
            await page.keyboard.press('Enter');
            await expect(tab).toHaveAttribute('aria-selected', 'true');
            await expect(page.locator(`#${panelId}`)).toBeVisible();
        }
    });
}