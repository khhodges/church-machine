'use strict';

// testing_health_panel.spec.js — FPGA health-panel state across Builder tabs
//
// The Testing page is hosted in a lazily-loaded iframe.  Switching Builder
// tabs must hide that iframe, not recreate or reload it, so a user's manual
// health-panel choice remains intact.

const { test, expect } = require('@playwright/test');

async function chooseHealthState(health, expanded) {
    const click = () => health.evaluate(button => button.click());
    const current = await health.getAttribute('aria-expanded');
    if (current !== String(expanded)) {
        await click();
    } else if (!expanded) {
        // The first status poll may auto-collapse the panel before the test
        // clicks it. Toggle once to establish manual control, then choose the
        // requested collapsed state.
        await click();
        await click();
    }
    await expect(health).toHaveAttribute('aria-expanded', String(expanded));
    await expect(health).toHaveText(expanded ? 'Collapse' : 'Expand');
}

async function openTestingTab(page) {
    // This test targets panel state, not live board telemetry. Prevent the
    // disconnected-board polling loop from auto-collapsing the panel while a
    // manual choice is being made.
    await page.route('**/hardware/wukong/status', route => route.abort());
    await page.route('**/hardware/wukong/events**', route => route.abort());
    await page.addInitScript(() => {
        try {
            localStorage.setItem('church_visited', '1');
            localStorage.setItem('whatsnew_seen_version', '9999');
            // Keep this suite independent of a preference left by another
            // browser session; the test explicitly exercises both choices.
            localStorage.removeItem('fpga_health_collapsed');
        } catch (e) {}
    });

    await page.goto('/simulator/?view=builder&tab=testing');
    await page.waitForFunction(() =>
        typeof window.switchView === 'function' &&
        typeof window.switchBuilderViewTab === 'function', null, { timeout: 30000 });
    await page.evaluate(() => {
        window.switchView('builder');
        window.switchBuilderViewTab('testing');
    });
    await expect(page.locator('#testingPanel')).toBeVisible();

    const iframe = page.locator('#testingIframe');
    await expect(iframe).toHaveAttribute('src', /\/fpga/);
    const health = iframe.contentFrame().locator('#healthToggle');
    await expect(health).toBeVisible({ timeout: 15000 });
    return { iframe, health };
}

test.describe('Builder ▸ Testing FPGA health panel', () => {
    test('keeps physical Wukong controls on Testing and off the simulator toolbar',
        async ({ page }) => {
            const { iframe } = await openTestingTab(page);
            const testing = iframe.contentFrame();

            await expect(testing.locator('#btnStep')).toHaveText('Step HW ▶');
            await expect(testing.locator('#btnRun')).toHaveText('▶ HW');
            await expect(testing.locator('#btnStop')).toHaveText('⏹ HW');
            await expect(testing.locator('#btnUpload')).toHaveText('⚡ Load');
            await expect(testing.locator('#toolbarCallDepth')).toBeVisible();

            await expect(page.locator('#toolHWRunBtn')).toHaveCount(0);
            await expect(page.locator('#toolHWStopBtn')).toHaveCount(0);
            await expect(page.locator('#toolHWLoadBtn')).toHaveCount(0);
            await expect(page.locator('#wukongCallDepthBadge')).toHaveCount(0);

            const simulatorStep = page.locator('#toolStepBtn');
            await expect(simulatorStep).not.toHaveText(/HW/);
            await expect(page.locator('#toolbarWukongBtn'))
                .toHaveAttribute('onclick', /switchBuilderViewTab\('testing'\)/);
        });

    test('preserves collapsed and expanded choices after Builder tab navigation',
        async ({ page }) => {
            const { iframe, health } = await openTestingTab(page);

            // Attach after the initial navigation. Any later load would mean
            // the tab switch recreated the health page.
            await iframe.evaluate(el => {
                window.__testingIframeLoadsAfterReady = 0;
                el.addEventListener('load', () => {
                    window.__testingIframeLoadsAfterReady++;
                });
            });

            // Choice 1: manually collapse, leave Testing, and return.
            await chooseHealthState(health, false);
            await page.evaluate(() => window.switchBuilderViewTab('versions'));
            await expect(page.locator('#testingPanel')).toBeHidden();
            await page.evaluate(() => window.switchBuilderViewTab('testing'));
            await expect(page.locator('#testingPanel')).toBeVisible();
            await expect(health).toHaveAttribute('aria-expanded', 'false');
            await expect(health).toHaveText('Expand');

            // Choice 2: manually expand, leave Testing, and return again.
            await chooseHealthState(health, true);
            await page.evaluate(() => window.switchBuilderViewTab('buildlog'));
            await expect(page.locator('#testingPanel')).toBeHidden();
            await page.evaluate(() => window.switchBuilderViewTab('testing'));
            await expect(page.locator('#testingPanel')).toBeVisible();
            await expect(health).toHaveAttribute('aria-expanded', 'true');
            await expect(health).toHaveText('Collapse');

            expect(await page.evaluate(() => window.__testingIframeLoadsAfterReady))
                .toBe(0);
        });
});