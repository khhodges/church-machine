'use strict';

// cr_detail_tab_correction.spec.js — Playwright E2E test verifying that
// updateCRDetail() snaps the visible tab panel to the correct default tab
// for the CR type being displayed.
//
// The pure correctCRDetailTab() logic is already covered by unit tests
// (tests/unit/tab-correction.test.js). This spec catches wiring bugs —
// e.g. the <script> tag missing from index.html, or updateCRDetail() not
// calling correctCRDetailTab() — by exercising the full browser code path.
//
// Approach:
//   After the simulator has initialised we switch to the dashboard view so
//   the CR-detail area is visible, inject synthetic CRs into sim.cr[] via
//   page.evaluate(), then call openCRDetail(crIdx) — the same function the
//   CR register grid uses.  openCRDetail resets crDetailTab to 'code',
//   activates #dashPanel-crdetail, and calls updateCRDetail(), which invokes
//   correctCRDetailTab() internally.  We assert the rendered crd-panel matches
//   the expected corrected tab.
//
// Why switchView('dashboard') is required:
//   The simulator defaults to the 'docs' view on a fresh load (no localStorage),
//   which leaves #dashboard as display:none.  openCRDetail() activates
//   #dashPanel-crdetail within the dashboard but does not switch the top-level
//   view, so we must do that first to make the ancestors visible.
//
// Bit-layout for word0 (GT format):
//   bits [31:25] = permBits  (B E S L X W R, MSB→LSB)
//   X is permBits bit 2 → bit 27 of word0 → 0x08000000
//   R is permBits bit 0 → bit 25 of word0 → 0x02000000
//   A non-zero index in bits [15:0] ensures the CR is not treated as null.

const { test, expect } = require('@playwright/test');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Switch to the dashboard view, inject a synthetic CR into sim.cr[], then
 * call openCRDetail(crIdx) — the entry-point used by the CR register grid.
 * openCRDetail resets crDetailTab to 'code', activates #dashPanel-crdetail,
 * and calls updateCRDetail(), which runs correctCRDetailTab() internally.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} crIdx  - CR slot index (0–15)
 * @param {number} word0  - encoded GT word0 (permission bits at [31:25])
 */
async function injectCRAndOpen(page, crIdx, word0) {
    await page.evaluate(({ crIdx, word0 }) => {
        switchView('dashboard');
        sim.cr[crIdx] = { word0, word1: 0, word2: 0, word3: 0, m: 0 };
        openCRDetail(crIdx);
    }, { crIdx, word0 });
}

/**
 * Switch to the dashboard view, inject a synthetic CR into sim.cr[], re-render
 * the CR table via updateCRDisplay(), then click the rendered table row.
 * This exercises the full click-handler wiring path rather than calling
 * openCRDetail() directly.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} crIdx  - CR slot index (0–15)
 * @param {number} word0  - encoded GT word0 (permission bits at [31:25])
 */
async function injectCRAndClick(page, crIdx, word0) {
    await page.evaluate(({ crIdx, word0 }) => {
        switchView('dashboard');
        switchDashTab('cr');              // show the CR grid before clicking
        sim.cr[crIdx] = { word0, word1: 0, word2: 0, word3: 0, m: 0 };
        updateCRDisplay();               // re-render so the row carries onclick
    }, { crIdx, word0 });

    // Click the table row for the injected CR.  The row has class 'cr-clickable'
    // and its onclick attribute calls openCRDetail(crIdx).
    // Use the cr-idx cell text to locate the exact row unambiguously.
    const crRow = page.locator('tr.cr-clickable', {
        has: page.locator('td.cr-idx', { hasText: new RegExp(`^${crIdx}$`) }),
    });
    await crRow.waitFor({ state: 'visible' });
    await crRow.click();
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe('CR detail tab correction in the live UI', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/simulator/');
        await page.waitForLoadState('networkidle');
    });

    // ── Test 1: code CR keeps the "code" tab ──────────────────────────────────
    //
    // word0 = 0x08000001: X=1 (bit 27) + index=1.
    // showCode=true → correctCRDetailTab('code', true, false, false) = 'code'.
    // Expected: #crdPanel-code is visible; the correction makes no change.

    test('shows Code panel for a code CR (hasX=true)', async ({ page }) => {
        await injectCRAndOpen(page, 0, 0x08000001);

        const codePanel = page.locator('#crdPanel-code');
        await codePanel.waitFor({ state: 'attached' });
        await expect(codePanel).toBeVisible();
    });

    // ── Test 2: data CR corrects tab from "code" to "register" ───────────────
    //
    // word0 = 0x02000001: R=1 (bit 25) + index=1; no X, no L.
    // showCode=false, showCList=false, showData=true.
    // correctCRDetailTab('code', false, false, true) → 'register'.
    // Expected: #crdPanel-register is visible; #crdPanel-code absent.

    test('corrects tab from "code" to "register" for a data CR (hasR=true, no X)', async ({ page }) => {
        await injectCRAndOpen(page, 1, 0x02000001);

        const registerPanel = page.locator('#crdPanel-register');
        await registerPanel.waitFor({ state: 'attached' });
        await expect(registerPanel).toBeVisible();

        // #crdPanel-code is not rendered at all for a non-code CR.
        const codePanel = page.locator('#crdPanel-code');
        await expect(codePanel).not.toBeVisible();
    });

    // ── Test 3: Rule 2 — code-only CR snaps 'register' back to 'code' ────────
    //
    // word0 = 0x08000001: X=1 (bit 27) + index=1; no R → showData=false.
    // After openCRDetail resets crDetailTab to 'code' we manually set it to
    // 'register' (simulating a stale tab value) and call updateCRDetail() again.
    // correctCRDetailTab('register', true, false, false) must return 'code'.
    // Expected: #crdPanel-code is visible; #crdPanel-register absent.

    test('Rule 2: snaps "register" back to "code" for a code-only CR (hasX=true, no R)', async ({ page }) => {
        // Step 1: open a code CR so the panel DOM is initialised.
        await injectCRAndOpen(page, 2, 0x08000001);   // CR2: X-only

        // Step 2: override crDetailTab to the invalid value and re-run the
        // correction by calling updateCRDetail() directly.
        await page.evaluate(() => {
            crDetailTab = 'register';
            updateCRDetail();
        });

        const codePanel = page.locator('#crdPanel-code');
        await codePanel.waitFor({ state: 'attached' });
        await expect(codePanel).toBeVisible();

        const registerPanel = page.locator('#crdPanel-register');
        await expect(registerPanel).not.toBeVisible();
    });

    // ── Test 4: Rule 3 — CR without C-List snaps 'clist' to 'register' ───────
    //
    // word0 = 0x02000001: R=1 (bit 25) + index=1; no X, no L → showCList=false.
    // After openCRDetail resets crDetailTab to 'code' (then corrects to
    // 'register'), we manually set crDetailTab to 'clist' and call
    // updateCRDetail() again.
    // correctCRDetailTab('clist', false, false, true) must return 'register'.
    // Expected: #crdPanel-register is visible; #crdPanel-clist absent.

    test('Rule 3: snaps "clist" to "register" for an R-only CR (no C-List, no code)', async ({ page }) => {
        // Step 1: open an R-only CR so the panel DOM is initialised.
        await injectCRAndOpen(page, 4, 0x02000001);   // CR4: R-only

        // Step 2: override crDetailTab to 'clist' (the CR has no C-List) and
        // re-run the correction.
        await page.evaluate(() => {
            crDetailTab = 'clist';
            updateCRDetail();
        });

        const registerPanel = page.locator('#crdPanel-register');
        await registerPanel.waitFor({ state: 'attached' });
        await expect(registerPanel).toBeVisible();

        const clistPanel = page.locator('#crdPanel-clist');
        await expect(clistPanel).not.toBeVisible();
    });

    // ── Test 5: tab correction fires via a real DOM row click ─────────────────
    //
    // This test exercises the full click-handler wiring path: clicking a rendered
    // CR table row fires the inline onclick="openCRDetail(n)" handler, which in
    // turn calls updateCRDetail() → correctCRDetailTab().  It catches bugs where
    // the wiring between the CR grid and the detail panel is broken, independent
    // of whether the pure function itself is correct.
    //
    // A data CR (R-only, no X) is injected so the tab correction must fire
    // ('code' → 'register'), making the test sensitive to wiring regressions.

    test('tab correction fires via a real CR row click (click-handler wiring)', async ({ page }) => {
        await injectCRAndClick(page, 3, 0x02000001);   // CR3: R-only, no X

        // After the click, openCRDetail(3) has run, crDetailTab was corrected
        // from 'code' to 'register', and #dashPanel-crdetail is now active.
        const registerPanel = page.locator('#crdPanel-register');
        await registerPanel.waitFor({ state: 'attached' });
        await expect(registerPanel).toBeVisible();
    });

});
