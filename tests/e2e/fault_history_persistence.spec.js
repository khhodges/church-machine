'use strict';

// fault_history_persistence.spec.js — Playwright E2E test verifying that the
// fault history stored in localStorage survives a page reload.
//
// Approach:
//   Rather than injecting data into localStorage directly (which would be
//   re-applied on every navigation by addInitScript and would bypass the real
//   save path), the test injects a fault into the live sim.faultLog object
//   via page.evaluate() after the simulator has initialised, then calls
//   _saveFaultLog() so the real serialisation logic writes the entry to
//   localStorage.  The test then verifies the Gate Log and fault modal
//   before a reload.  After page.reload() the localStorage key is not
//   re-seeded by any script injection — it contains exactly what
//   _saveFaultLog() wrote — so the post-reload assertions exercise the full
//   _restoreFaultLog() → updateGateLog() → showFaultModal() chain.

const { test, expect } = require('@playwright/test');

// ─── Stub values ──────────────────────────────────────────────────────────────
const FAULT_TYPE   = 'CAP_EXPIRED';
const FAULT_PC     = 0x00AB;        // 171 decimal → rendered as "0x00AB"
const FAULT_PC_HEX = '0x00AB';
const LUMP_LABEL   = 'TestLump';    // surfaced as the "Location" field in the modal

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Open the hamburger menu and navigate to the Gate Log dashboard tab.
 * Waits until the panel carries the `active` class before returning.
 */
async function openGateLogTab(page) {
    const hamBtn = page.locator('#hamBtn');
    await hamBtn.waitFor({ state: 'visible' });
    await hamBtn.click();

    const gateLogBtn = page.locator('#hamItem-dashboard-gatelog');
    await gateLogBtn.waitFor({ state: 'visible' });
    await gateLogBtn.click();

    const panel = page.locator('#dashPanel-gatelog');
    await expect(panel).toHaveClass(/\bactive\b/);
}

/**
 * Click the Details button in the Gate Log fault banner and wait for the
 * fault modal overlay to appear.
 */
async function openFaultModal(page) {
    const detailsBtn = page.locator('#gateLogContent .fault-gate-banner-open');
    await detailsBtn.waitFor({ state: 'visible' });
    await detailsBtn.click();
    await page.locator('#faultModalOverlay').waitFor({ state: 'visible' });
}

/**
 * Close the fault modal and wait for it to be removed from the DOM.
 */
async function closeFaultModal(page) {
    await page.locator('#faultModalOverlay .fault-modal-close').click();
    await page.locator('#faultModalOverlay').waitFor({ state: 'hidden' });
}

/**
 * Inject a synthetic fault entry into the live sim.faultLog, then call
 * _saveFaultLog() so the real serialisation logic persists it to localStorage.
 * updateGateLog() + faultAlertOn() are called to render the banner immediately.
 *
 * Returns the serialised localStorage value so tests can confirm it was written.
 */
async function injectFaultAndSave(page, { type, pc, step, lumpLabel }) {
    return page.evaluate(({ type, pc, step, lumpLabel }) => {
        const fault = {
            type,
            message:      `${type}: capability has expired`,
            pc,
            physicalPC:   pc,
            step,
            faultStep:    step,
            // _nsSnapshot is stored in the slim record (it is in _FAULT_LOG_FIELDS)
            // so showFaultModal can display the lump label without _nsOwnerOf().
            _nsSnapshot:  { label: lumpLabel, offset: 3, nsIdx: null },
            // Provide a minimal instrHistory so _saveFaultLog captures _faultRawWord.
            instrHistory: [{ step, physicalPC: pc, raw: 0 }],
            crSnapshot:   [],
            drSnapshot:   [],
            flagsSnapshot: {},
        };

        sim.faultLog.push(fault);

        // Persist via the real save path (exercises field selection, JSON.stringify).
        if (typeof _saveFaultLog === 'function') _saveFaultLog();

        // Re-render so the banner is immediately visible without further interaction.
        if (typeof updateGateLog  === 'function') updateGateLog();
        if (typeof faultAlertOn   === 'function') faultAlertOn();

        // Return the raw localStorage value so the test can verify it was written.
        return localStorage.getItem('cm_fault_log');
    }, { type, pc, step, lumpLabel });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe('fault history persistence across page reload', () => {

    test('Gate Log shows fault type, PC, and lump name before and after a page reload', async ({ page }) => {

        // ── Load the simulator ───────────────────────────────────────────────
        await page.goto('/simulator/');
        await page.waitForLoadState('networkidle');

        // ── Inject the fault via the live JS runtime and save to localStorage ─
        const savedJson = await injectFaultAndSave(page, {
            type:       FAULT_TYPE,
            pc:         FAULT_PC,
            step:       42,
            lumpLabel:  LUMP_LABEL,
        });

        // Guard: _saveFaultLog() must have written the key before we reload.
        expect(savedJson).not.toBeNull();
        const saved = JSON.parse(savedJson);
        expect(saved).toHaveLength(1);
        expect(saved[0].type).toBe(FAULT_TYPE);

        // ── Pre-reload: Gate Log assertions ──────────────────────────────────
        await openGateLogTab(page);

        const typeBadge = page.locator('#gateLogContent .fault-type-badge');
        await expect(typeBadge).toBeVisible();
        await expect(typeBadge).toHaveText(FAULT_TYPE);

        const pcCode = page.locator('#gateLogContent .fault-gate-banner-pc code');
        await expect(pcCode).toBeVisible();
        await expect(pcCode).toHaveText(FAULT_PC_HEX);

        // ── Pre-reload: modal assertions ─────────────────────────────────────
        await openFaultModal(page);

        const modalTypeBadge = page.locator(
            '#faultModalOverlay .fault-modal-header .fault-type-badge'
        );
        await expect(modalTypeBadge).toBeVisible();
        await expect(modalTypeBadge).toHaveText(FAULT_TYPE);

        // The "PC" detail row inside the modal trace section shows pcHex.
        const pcRow = page.locator('#faultModalOverlay .fault-detail-row', {
            has: page.locator('.fault-detail-label', { hasText: 'PC' }),
        });
        await expect(pcRow.locator('.fault-detail-value code')).toHaveText(FAULT_PC_HEX);

        // The "Location" detail row contains nsStr = "<label> +<offset>",
        // i.e. "TestLump +3".
        const locationRow = page.locator('#faultModalOverlay .fault-detail-row', {
            has: page.locator('.fault-detail-label', { hasText: 'Location' }),
        });
        await expect(locationRow.locator('.fault-detail-value')).toContainText(LUMP_LABEL);

        await closeFaultModal(page);

        // ── Reload — no script injection; localStorage is not re-seeded ──────
        // The only data in cm_fault_log is what _saveFaultLog() wrote above.
        await page.reload();
        await page.waitForLoadState('networkidle');

        // ── Post-reload: Gate Log assertions (exercises _restoreFaultLog) ────
        await openGateLogTab(page);

        const typeBadgeAfter = page.locator('#gateLogContent .fault-type-badge');
        await expect(typeBadgeAfter).toBeVisible();
        await expect(typeBadgeAfter).toHaveText(FAULT_TYPE);

        const pcCodeAfter = page.locator('#gateLogContent .fault-gate-banner-pc code');
        await expect(pcCodeAfter).toBeVisible();
        await expect(pcCodeAfter).toHaveText(FAULT_PC_HEX);

        // ── Post-reload: modal assertions ────────────────────────────────────
        await openFaultModal(page);

        const modalTypeBadgeAfter = page.locator(
            '#faultModalOverlay .fault-modal-header .fault-type-badge'
        );
        await expect(modalTypeBadgeAfter).toBeVisible();
        await expect(modalTypeBadgeAfter).toHaveText(FAULT_TYPE);

        const pcRowAfter = page.locator('#faultModalOverlay .fault-detail-row', {
            has: page.locator('.fault-detail-label', { hasText: 'PC' }),
        });
        await expect(pcRowAfter.locator('.fault-detail-value code')).toHaveText(FAULT_PC_HEX);

        const locationRowAfter = page.locator('#faultModalOverlay .fault-detail-row', {
            has: page.locator('.fault-detail-label', { hasText: 'Location' }),
        });
        await expect(locationRowAfter.locator('.fault-detail-value')).toContainText(LUMP_LABEL);

        await closeFaultModal(page);
    });

});
