'use strict';

// tier1_catch_recovery.spec.js — Playwright E2E test
//
// With three-tier fault recovery removed, sim.fault() always halts the
// machine.  This test verifies the halt-always behavior:
//
//   1. sim.fault('PERM_R', ...) is called via the live sim in the browser.
//   2. The simulator IS halted after the fault (sim.halted === true).
//   3. The Fault Popup (auto-opened by the 'fault' event) is visible and
//      shows the fault code.
//   4. The fault log entry has no recovery tier (tier is null/undefined),
//      catchInvoked is falsy, and irqInvoked is falsy.

const { test, expect } = require('@playwright/test');

// ─── Constants ────────────────────────────────────────────────────────────────

const FAULT_TYPE = 'PERM_R';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Close the fault modal overlay and wait for it to disappear.
 */
async function closeFaultModal(page) {
    const overlay = page.locator('#faultModalOverlay');
    const closeBtn = overlay.locator('.fault-modal-close');
    await closeBtn.waitFor({ state: 'visible' });
    await closeBtn.click();
    await overlay.waitFor({ state: 'hidden' });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe('Fault halt-always behavior (three-tier recovery removed)', () => {

    test('sim.fault() halts the machine; Fault Popup opens; no recovery tier', async ({ page }) => {
        test.setTimeout(60000);

        // Suppress What's New modal so it doesn't block the fault popup
        await page.addInitScript(() => {
            localStorage.setItem('church_whatsnew_dismissed_perm', '1');
        });

        // Load the simulator
        await page.goto('/simulator/');
        await page.waitForLoadState('networkidle');

        // Fire the real fault() path and collect machine state
        const outcome = await page.evaluate(({ faultType }) => {
            // Fire the real sim.fault() — 'fault' event auto-opens the modal
            sim.fault(faultType, 'E2E halt-always test');

            // Grab the fault log entry
            const entry = sim.faultLog[sim.faultLog.length - 1] || null;

            return {
                halted:       sim.halted,
                tier:         entry ? entry.tier          : undefined,
                catchInvoked: entry ? entry.catchInvoked  : undefined,
                irqInvoked:   entry ? entry.irqInvoked    : undefined,
                faultType:    entry ? entry.type          : undefined,
            };
        }, { faultType: FAULT_TYPE });

        // Machine must be halted
        expect(outcome.halted, 'sim must be halted after fault()').toBe(true);

        // No recovery tier — three-tier recovery is gone
        expect(outcome.tier        == null, 'fault entry tier must be null/undefined').toBe(true);
        expect(!!outcome.catchInvoked,      'catchInvoked must be false/falsy').toBe(false);
        expect(!!outcome.irqInvoked,        'irqInvoked must be false/falsy').toBe(false);

        // Fault Popup must be visible and show the fault type
        const overlay = page.locator('#faultModalOverlay');
        await overlay.waitFor({ state: 'visible' });

        // The fault type must appear somewhere in the popup
        await expect(overlay).toContainText(FAULT_TYPE);

        await closeFaultModal(page);
    });

});
