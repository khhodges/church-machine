'use strict';

// ns_led_flash_source_button.spec.js
//
// Regression test confirming that the NS table Source button for LED Flash
// (ns_slot 7, token '00000300') renders correctly after the slot migration
// from 3 → 7.  A silent regression here would mean the button disappears or
// calls _openLumpSource with the wrong token.
//
// Because slot 7 is null/programmable at cold boot (no NS entry → no rendered
// row), each test injects a minimal NS entry at slot 7 via sim.writeNSEntry()
// before opening the Namespace view, matching what a real boot image would do
// when LED Flash is loaded into that slot.
//
// ─── Suites ───────────────────────────────────────────────────────────────
//
// Suite 1 — LED Flash Source button in slot 7
//
//   1a. Source button is present in #ns-row-7 and its onclick references
//       token '00000300' (the canonical LED Flash token).
//
//   1b. _openLumpSource is called with '00000300' when the button is clicked
//       (verified by intercepting the function in the page context).
//
// Suite 2 — Hardware slots 0–5 never show a Source button
//
//   2a. All six hardware-tier rows (slots 0–5) have an empty .ns-entry-actions
//       cell — no button of any kind, confirming the HW-tier guard in
//       renderNamespaceTable() still fires after the slot 7 migration.

const { test, expect } = require('@playwright/test');

// Minimal LED Flash lump stub — mirrors server/lumps/LED_flash_v1.json
const LED_FLASH_STUB = {
    token:        '00000300',
    abstraction:  'LED Flash',
    ns_slot:      7,
    lump_size:    64,
    lump_version: 1,
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Navigate to the simulator with the lumps API stubbed, inject a valid NS
 * entry at slot 7 (simulating what a boot image does when LED Flash is
 * loaded), and open the Namespace view.  Returns with the NS table visible
 * and the /api/lumps/list warm-up re-render settled.
 *
 * Why inject via sim.writeNSEntry():
 *   At cold boot, _getHardwareBootCatalog()[7] is null (programmable slot),
 *   so _initNamespaceTable() leaves slot 7 as all-zeros and renderNamespaceTable()
 *   skips it (readNSEntry(7) returns null → continue).  The Source button can
 *   only be tested once a real NS entry occupies slot 7, as would happen when
 *   a boot image containing LED Flash is applied via loadBootImage().
 */
async function openNsViewWithLedFlashAtSlot7(page) {
    // Stub the lumps API so _findSrcLump(7, 'LED Flash') resolves to token '00000300'.
    await page.route('**/api/lumps/list', async route => {
        await route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify([LED_FLASH_STUB]),
        });
    });

    // Suppress What's New modal to avoid blocking UI interactions.
    await page.addInitScript(() => {
        localStorage.setItem('church_whatsnew_dismissed_perm', '1');
    });

    await page.goto('/simulator/');
    await page.waitForLoadState('networkidle');

    // Inject a minimal Inform-type NS entry at slot 7.
    // writeNSEntry(idx, location, limit17, bFlag, gBit, gtType, version, clistCount, abstract_gt)
    //   gtType=1 (Inform = concrete lump in memory), location=0x0400 (dummy physical addr),
    //   limit17=17 (64-word lump), version=1, gBit=0, bFlag=0.
    // Also set nsLabels[7]='LED Flash' so _findSrcLump label-fallback also matches.
    const injected = await page.evaluate(() => {
        if (typeof sim === 'undefined') return { ok: false, reason: 'sim undefined' };
        try {
            sim.writeNSEntry(7, 0x0400, 17, 0, 0, 1, 1, 0, 0);
            if (!sim.nsLabels) sim.nsLabels = {};
            sim.nsLabels[7] = 'LED Flash';
            return { ok: true, nsCount: sim.nsCount };
        } catch (e) {
            return { ok: false, reason: e.message };
        }
    });

    if (!injected.ok) {
        throw new Error(`Failed to inject NS entry at slot 7: ${injected.reason}`);
    }

    // Open the Namespace view via the hamburger menu.
    const hamBtn = page.locator('#hamBtn');
    await hamBtn.waitFor({ state: 'visible' });
    await hamBtn.click();

    const nsBtn = page.locator('#hamItem-namespace');
    await nsBtn.waitFor({ state: 'visible' });
    await nsBtn.click();

    await page.locator('#namespaceTable').waitFor({ state: 'visible' });

    // Allow the async /api/lumps/list pre-fetch + re-render to settle.
    await page.waitForTimeout(800);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — LED Flash Source button in slot 7
// ─────────────────────────────────────────────────────────────────────────────

test.describe('NS table — LED Flash Source button in slot 7 (token 00000300)', () => {

    // 1a — Source button present in #ns-row-7 with correct token in onclick.
    test('Source button appears in NS row 7 and references token 00000300', async ({ page }) => {
        test.setTimeout(60000);

        await openNsViewWithLedFlashAtSlot7(page);

        // The Source button must exist inside the slot 7 row.
        const sourceBtn = page.locator('#ns-row-7 .ns-entry-actions button', { hasText: 'Source' });
        await expect(
            sourceBtn,
            'A "Source" button must be visible in the NS row for slot 7 (LED Flash)'
        ).toBeVisible({ timeout: 8000 });

        // The button's onclick must carry the correct token — '00000300'.
        const onclick = await sourceBtn.getAttribute('onclick');
        expect(
            onclick,
            `Source button onclick must reference token '00000300' (LED Flash canonical token); got: ${onclick}`
        ).toContain("_openLumpSource('00000300')");
    });

    // 1b — Clicking the Source button invokes _openLumpSource('00000300').
    test('clicking the Source button calls _openLumpSource with token 00000300', async ({ page }) => {
        test.setTimeout(60000);

        await openNsViewWithLedFlashAtSlot7(page);

        // Intercept _openLumpSource in the page so we can observe the call.
        await page.evaluate(() => {
            window._openLumpSourceCalls = [];
            const _orig = window._openLumpSource;
            window._openLumpSource = function(token) {
                window._openLumpSourceCalls.push(token);
                // Forward to the real implementation if available (errors suppressed
                // to prevent view-switch side-effects from failing the test).
                if (typeof _orig === 'function') {
                    try { _orig(token); } catch (_) {}
                }
            };
        });

        const sourceBtn = page.locator('#ns-row-7 .ns-entry-actions button', { hasText: 'Source' });
        await expect(sourceBtn).toBeVisible({ timeout: 8000 });
        await sourceBtn.click();

        // Give any async dispatch a moment to settle.
        await page.waitForTimeout(200);

        const calls = await page.evaluate(() => window._openLumpSourceCalls || []);
        expect(
            calls,
            '_openLumpSource must have been called exactly once after clicking the Source button'
        ).toHaveLength(1);
        expect(
            calls[0],
            `_openLumpSource must be called with '00000300' (LED Flash token); got '${calls[0]}'`
        ).toBe('00000300');
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Hardware slots 0–5 never show a Source button
// ─────────────────────────────────────────────────────────────────────────────

test.describe('NS table — hardware-tier slots 0–5 have no Source button', () => {

    // 2a — .ns-entry-actions cells for rows 0–5 contain no button element.
    //
    // renderNamespaceTable() uses NS_TIER_HW_MAX = 5:
    //   if (i <= NS_TIER_HW_MAX) { html += '<td class="ns-entry-actions"></td>'; }
    // This guard must remain intact regardless of the slot 7 LED Flash migration.
    test('slots 0–5 each have an empty .ns-entry-actions cell (no Source button)', async ({ page }) => {
        test.setTimeout(60000);

        await openNsViewWithLedFlashAtSlot7(page);

        // Collect any Source buttons within NS rows 0–5.
        const hwSlotSourceBtns = [];
        for (let slot = 0; slot <= 5; slot++) {
            const count = await page.locator(`#ns-row-${slot} .ns-entry-actions button`).count();
            if (count > 0) hwSlotSourceBtns.push(slot);
        }

        expect(
            hwSlotSourceBtns,
            `Hardware-tier rows for slot(s) ${hwSlotSourceBtns.join(', ')} must not contain any button in .ns-entry-actions`
        ).toHaveLength(0);
    });

});
