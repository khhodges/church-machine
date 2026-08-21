'use strict';

// Narrow-viewport regression coverage for the execution counter controls.
//
// This intentionally measures the toolbar immediately after DOMContentLoaded
// rather than booting the simulator or navigating to a particular view.  The
// counter markup and its help dialog are independent of simulator execution
// state, so keeping the test at that level makes it reliable in CI.

const { test, expect } = require('@playwright/test');

const VIEWPORTS = [
    { name: 'mobile', width: 360, height: 800 },
    { name: 'desktop', width: 900, height: 800 },
];

for (const viewport of VIEWPORTS) {
    test(`execution counter stays usable at ${viewport.name} width`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto('/simulator/', { waitUntil: 'domcontentloaded' });
        // The home view intentionally hides execution controls.  Selecting
        // the dashboard exposes the real toolbar group without booting the
        // simulator or depending on any persisted simulator state.
        await page.evaluate(() => window.switchView('dashboard'));

        const strip = page.locator('.execution-counter-strip');
        const help = page.locator('.exec-counter-help-btn');
        await expect(strip).toBeVisible();
        await expect(help).toBeVisible();

        const geometry = await page.evaluate(() => {
            const stripEl = document.querySelector('.execution-counter-strip');
            const helpEl = document.querySelector('.exec-counter-help-btn');
            const stripRect = stripEl.getBoundingClientRect();
            const helpRect = helpEl.getBoundingClientRect();
            return {
                viewportWidth: window.innerWidth,
                stripLeft: stripRect.left,
                stripRight: stripRect.right,
                helpWidth: helpRect.width,
                helpHeight: helpRect.height,
            };
        });

        expect(geometry.stripLeft).toBeGreaterThanOrEqual(0);
        expect(geometry.stripRight).toBeLessThanOrEqual(geometry.viewportWidth);
        expect(geometry.helpWidth).toBeGreaterThanOrEqual(24);
        expect(geometry.helpHeight).toBeGreaterThanOrEqual(24);

        // Exercise the actual interaction, not just CSS dimensions.
        await help.click();
        await expect(page.locator('[role="dialog"][aria-label="Execution counter explanations"]'))
            .toBeVisible();
    });
}