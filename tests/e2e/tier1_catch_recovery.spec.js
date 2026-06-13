'use strict';

// tier1_catch_recovery.spec.js — Playwright E2E test for Task #1080
//
// Verifies that the live IDE correctly exercises the Tier 1 (.catch) fault-
// recovery path end-to-end:
//
//   1. A .catch handler is registered on NS slot 10 (DijkstraFlag) via the
//      live abstractionRegistry.bindMethod() API.
//   2. sim.fault('PERM_R', ...) is called so the real three-tier recovery
//      logic runs in the browser.
//   3. The simulator is NOT halted after recovery (machine can keep stepping).
//   4. The Fault Popup (auto-opened by the 'fault' event) shows
//      "Tier 1 (.catch recovered)" and the correct abstraction label.
//   5. After a page reload, the Gate Log still shows the fault entry and the
//      Fault Popup still surfaces the Tier 1 recovery label (because the
//      tier/recovery fields are now included in _FAULT_LOG_FIELDS).
//
// Approach:
//   All simulator state mutations happen inside page.evaluate() against the
//   live global objects (sim, abstractionRegistry, etc.) — the same approach
//   used by fault_history_persistence.spec.js.  No mocking of the fault or
//   recovery logic is performed; the real sim.fault() path runs.
//
//   When sim.fault() is called in the browser the 'fault' event listener in
//   app-shell.js automatically calls showFaultModal(f), so the modal is
//   already open when page.evaluate() returns.  The test asserts on the
//   auto-opened modal first, then closes it, then exercises the Gate Log
//   banner → modal open path as a second assertion pass.

const { test, expect } = require('@playwright/test');

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_NS_SLOT   = 10;           // DijkstraFlag — always registered at boot
const TEST_ABS_LABEL = 'TestCatch';  // synthetic nsLabels entry used by the test
const FAULT_TYPE     = 'PERM_R';     // fault code that triggers the .catch path

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

/**
 * Navigate to the Gate Log dashboard tab and wait until the panel is active.
 * Assumes no modal overlay is blocking the hamburger button.
 */
async function openGateLogTab(page) {
    const hamBtn = page.locator('#hamBtn');
    await hamBtn.waitFor({ state: 'visible' });
    await hamBtn.click();

    // Gate Log was removed from the hamburger; navigate to Dashboard first
    // then click the Gate Log tab inside the dashboard panel.
    const dashBtn = page.locator('#hamItem-dashboard');
    await dashBtn.waitFor({ state: 'visible' });
    await dashBtn.click();

    const gateLogTabBtn = page.locator('#dashTab-gatelog');
    await gateLogTabBtn.waitFor({ state: 'visible' });
    await gateLogTabBtn.click();

    const panel = page.locator('#dashPanel-gatelog');
    await expect(panel).toHaveClass(/\bactive\b/);
}

/**
 * Click the Details button in the Gate Log fault banner and wait for the
 * fault modal overlay to become visible.
 */
async function openFaultModalFromGateLog(page) {
    const detailsBtn = page.locator('#gateLogContent .fault-gate-banner-open');
    await detailsBtn.waitFor({ state: 'visible' });
    await detailsBtn.click();
    await page.locator('#faultModalOverlay').waitFor({ state: 'visible' });
}

/**
 * Register a .catch handler on NS slot TEST_NS_SLOT, trigger a PERM_R fault
 * via the live sim.fault() path, then persist the fault log entry.
 *
 * NOTE: sim.fault() fires the 'fault' event which automatically calls
 * showFaultModal(f) — the fault modal is already open when this resolves.
 *
 * Returns the outcome object for JS-level assertions.
 */
async function triggerTier1Fault(page) {
    return page.evaluate(({ nsSlot, absLabel, faultType }) => {
        // ── 1. Label the NS slot so the fault record carries a human-readable name
        sim.nsLabels = sim.nsLabels || {};
        sim.nsLabels[nsSlot] = absLabel;

        // ── 2. Register a .catch handler that signals recovery (handled: true)
        let catchWasCalled = false;
        abstractionRegistry.bindMethod(nsSlot, '.catch', function(_s, _args) {
            catchWasCalled = true;
            return { handled: true };
        });

        // ── 3. Point CR14 at the test NS slot so the simulator resolves
        //       faultingAbstractionSlot correctly.  Save and restore afterwards
        //       so we do not corrupt the running boot image.
        const prevCR14 = sim.cr ? sim.cr[14] : null;
        if (!sim.cr) sim.cr = new Array(16).fill(null);
        sim.cr[14] = { word0: nsSlot, word1: 0, word2: 0, word3: 0 };

        // ── 4. Capture PC before fault so we can verify it advances by 1.
        const pcBefore = sim.pc;

        // ── 5. Fire the real fault() path — Tier 1 should intercept it.
        //       The 'fault' event listener in app-shell.js calls _saveFaultLog(),
        //       faultAlertOn(), and showFaultModal() automatically.
        sim.fault(faultType, 'E2E Tier 1 .catch recovery test');

        // ── 6. Restore CR14 (don't leave the boot image in a broken state)
        sim.cr[14] = prevCR14;

        // ── 7. Grab the fault entry for JS-level assertions
        const entry = sim.faultLog[sim.faultLog.length - 1] || null;

        // ── 8. Re-render Gate Log so the banner is visible immediately.
        //       (_saveFaultLog was already called by the 'fault' event handler.)
        if (typeof updateGateLog === 'function') updateGateLog();

        return {
            halted:                   sim.halted,
            catchWasCalled,
            pcBefore,
            pcAfter:                  sim.pc,
            tier:                     entry ? entry.tier : undefined,
            catchInvoked:             entry ? entry.catchInvoked : undefined,
            faultingAbstractionSlot:  entry ? entry.faultingAbstractionSlot : undefined,
            faultingAbstractionLabel: entry ? entry.faultingAbstractionLabel : undefined,
        };
    }, { nsSlot: TEST_NS_SLOT, absLabel: TEST_ABS_LABEL, faultType: FAULT_TYPE });
}

/**
 * Assert the expected Tier 1 recovery fields in the currently open fault modal.
 */
async function assertFaultModalTier1(page) {
    const overlay = page.locator('#faultModalOverlay');
    await overlay.waitFor({ state: 'visible' });

    // "Recovery" row must show "Tier 1 (.catch recovered)"
    const recoveryRow = overlay.locator('.fault-detail-row', {
        has: page.locator('.fault-detail-label', { hasText: 'Recovery' }),
    });
    await expect(recoveryRow).toBeVisible();
    await expect(recoveryRow.locator('.fault-detail-value')).toContainText('Tier 1');
    await expect(recoveryRow.locator('.fault-detail-value')).toContainText('.catch recovered');

    // ".catch" row must reference NS[10] and the test label
    const catchRow = overlay.locator('.fault-detail-row', {
        has: page.locator('.fault-detail-label', { hasText: '.catch' }),
    });
    await expect(catchRow).toBeVisible();
    await expect(catchRow.locator('.fault-detail-value code')).toContainText(`NS[${TEST_NS_SLOT}]`);
    await expect(catchRow.locator('.fault-detail-value code')).toContainText(TEST_ABS_LABEL);

    // IRQ row must NOT appear — Tier 1 recovered before escalating to Tier 2
    const irqRow = overlay.locator('.fault-detail-row', {
        has: page.locator('.fault-detail-label', { hasText: 'IRQ' }),
    });
    await expect(irqRow).not.toBeVisible();
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe('Tier 1 (.catch) fault recovery — live IDE', () => {

    test('Fault Popup shows Tier 1 recovery; machine not halted; state survives reload', async ({ page }) => {
        test.setTimeout(60000); // extra headroom for reload + Gate Log navigation

        // ── Suppress What's New modal and any other auto-opening popups ─────
        // Runs before page scripts execute, so showWhatsNew() sees the flag
        // and returns immediately without making the modal visible.
        await page.addInitScript(() => {
            localStorage.setItem('church_whatsnew_dismissed_perm', '1');
        });

        // ── Load the simulator ──────────────────────────────────────────────
        await page.goto('/simulator/');
        await page.waitForLoadState('networkidle');

        // ── Trigger the real Tier 1 fault path ──────────────────────────────
        // This calls sim.fault() which fires the 'fault' event, which in turn
        // calls showFaultModal(f) — the modal is open when evaluate() returns.
        const outcome = await triggerTier1Fault(page);

        // ── JS-level assertions: machine state after recovery ────────────────
        expect(outcome.halted,                   'sim must not be halted after Tier 1 .catch').toBe(false);
        expect(outcome.catchWasCalled,            '.catch handler must have been invoked').toBe(true);
        expect(outcome.tier,                      'fault entry tier must be 1').toBe(1);
        expect(outcome.catchInvoked,              'fault entry catchInvoked must be true').toBe(true);
        expect(outcome.faultingAbstractionSlot,   'faultingAbstractionSlot must equal TEST_NS_SLOT').toBe(TEST_NS_SLOT);
        expect(outcome.faultingAbstractionLabel,  'faultingAbstractionLabel must match test label').toBe(TEST_ABS_LABEL);
        // PC advances by exactly 1 after Tier 1 recovery — machine can continue stepping
        expect(outcome.pcAfter,                  'PC must advance by 1 past the faulting instruction').toBe(outcome.pcBefore + 1);

        // ── First pass: assert the auto-opened Fault Popup ───────────────────
        await assertFaultModalTier1(page);
        await closeFaultModal(page);

        // ── Navigate to Gate Log — modal is now closed ───────────────────────
        await openGateLogTab(page);

        // Gate Log banner must show the fault type badge
        const typeBadge = page.locator('#gateLogContent .fault-type-badge');
        await expect(typeBadge).toBeVisible();
        await expect(typeBadge).toHaveText(FAULT_TYPE);

        // Gate Log banner must show the Tier 1 recovery pill
        const recoveryPill = page.locator('#gateLogContent .fault-recovery-pill');
        await expect(recoveryPill).toBeVisible();
        await expect(recoveryPill).toHaveText('Tier 1');

        // ── Second pass: open modal from Gate Log banner and re-assert ───────
        await openFaultModalFromGateLog(page);
        await assertFaultModalTier1(page);
        await closeFaultModal(page);

        // ── Reload — localStorage is not re-seeded by script injection ───────
        // Recovery fields (tier, catchInvoked, faultingAbstractionSlot, …) are
        // now included in _FAULT_LOG_FIELDS and were written by _saveFaultLog()
        // so the full recovery state survives the reload.
        await page.reload();
        await page.waitForLoadState('networkidle');

        // ── Post-reload: Gate Log still shows the fault ──────────────────────
        await openGateLogTab(page);

        const typeBadgeAfter = page.locator('#gateLogContent .fault-type-badge');
        await expect(typeBadgeAfter).toBeVisible();
        await expect(typeBadgeAfter).toHaveText(FAULT_TYPE);

        // Post-reload: banner recovery pill must still show Tier 1
        const recoveryPillAfter = page.locator('#gateLogContent .fault-recovery-pill');
        await expect(recoveryPillAfter).toBeVisible();
        await expect(recoveryPillAfter).toHaveText('Tier 1');

        // ── Post-reload: Fault Popup still shows Tier 1 recovery ─────────────
        await openFaultModalFromGateLog(page);
        await assertFaultModalTier1(page);
        await closeFaultModal(page);
    });

});
