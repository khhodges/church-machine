'use strict';

// lump_picker_persistence.spec.js — Playwright E2E tests for Task #1384
//
// Protects the LUMP picker persistence behaviour introduced in Task #1382.
// Without these tests the following could silently regress:
//   (a) picker retains its selected option after the user picks a lump
//   (b) the "Viewing:" label appears and contains the correct lump name
//   (c) changing the sort order does not reset the picker to "— pick a lump —"
//
// All suites intercept /api/lumps/list so they are deterministic regardless of
// which LUMPs are compiled locally.  The detail endpoint is also stubbed to
// avoid noise in the browser console.
//
// Suite 1 — picker selection persistence:
//   Pick a lump → picker still shows that token (not the placeholder).
//
// Suite 2 — Viewing label:
//   Pick a lump → #lumpViewingLabel is visible and contains "Viewing: <name>".
//
// Suite 3 — sort-order change preserves selection:
//   Pick a lump, cycle through every sort order → picker retains the same token
//   after each re-render.

const { test, expect } = require('@playwright/test');

// ─────────────────────────────────────────────────────────────────────────────
// Shared stub data
// ─────────────────────────────────────────────────────────────────────────────

const STUB_TOKEN_A = 'AABBCCDD';
const STUB_TOKEN_B = 'DEADBEEF';

const STUB_LUMPS = [
    {
        token:        STUB_TOKEN_A,
        abstraction:  'LED',
        lump_size:    256,
        methods:      ['On', 'Off'],
        language:     'church',
        profile:      'default',
        ns_slot:      12,
        compiled_at:  1000,
        mtbf:         { status: 'green', consecutive_clean: 5 },
    },
    {
        token:        STUB_TOKEN_B,
        abstraction:  'Scheduler',
        lump_size:    128,
        methods:      ['Pause', 'IRQ'],
        language:     'church',
        profile:      'default',
        ns_slot:      8,
        compiled_at:  2000,
        mtbf:         { status: 'amber', consecutive_clean: 2 },
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// Shared helper — install API intercepts and navigate to the LUMP view
// ─────────────────────────────────────────────────────────────────────────────

async function setupLumpsView(page) {
    // Intercept the list endpoint used by renderLumps().
    await page.route('**/api/lumps/list', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(STUB_LUMPS),
        });
    });

    // Stub the detail endpoint to avoid browser-console noise (the Viewing
    // label is populated synchronously from _lumpsCache, so this stub does
    // not need real content).
    await page.route('**/api/lumps/detail/**', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ token: STUB_TOKEN_A, abstraction: 'LED' }),
        });
    });

    await page.goto('/simulator/');
    await page.waitForLoadState('networkidle');

    // Ensure app-shell.js has executed and switchView is in scope before
    // calling it.  Uses the same defensive pattern as lump_history_tab.spec.js
    // to avoid the silent no-op from the `if (typeof...)` guard.
    await page.waitForFunction(() => typeof switchView === 'function');

    // Switch to the LUMP Repository view via JS — avoids dependence on the
    // hamburger menu structure.
    await page.evaluate(() => switchView('lumps'));

    // Guard: the view and picker must be visible before we interact.
    await expect(page.locator('#lumps')).toBeVisible();
    const picker = page.locator('#lumpPickerSelect');
    await picker.waitFor({ state: 'visible' });
    return picker;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — picker retains its selection after the user picks a lump
// ─────────────────────────────────────────────────────────────────────────────

test.describe('LUMP picker — selection persists after pick', () => {

    test('picker keeps the chosen token and does not reset to the placeholder', async ({ page }) => {
        test.setTimeout(40000);
        const picker = await setupLumpsView(page);

        // Initially the picker should show the "— pick a lump —" placeholder.
        await expect(picker).toHaveValue('');

        // Select a lump; this fires the onchange handler (lumpPickerChanged).
        await picker.selectOption({ value: STUB_TOKEN_A });

        // The picker must still display the chosen token — not the placeholder.
        await expect(picker).toHaveValue(STUB_TOKEN_A);

        // The selected option's visible label must include the abstraction name
        // (verifies the full label text, not just the value attribute).
        await expect(picker.locator('option:checked')).toContainText('LED');
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Viewing label is visible and shows the picked lump name
// ─────────────────────────────────────────────────────────────────────────────

test.describe('LUMP picker — Viewing label', () => {

    test('Viewing label appears and contains the abstraction name after picking a lump', async ({ page }) => {
        test.setTimeout(40000);
        const picker = await setupLumpsView(page);

        // Pick the "LED" stub lump.
        await picker.selectOption({ value: STUB_TOKEN_A });

        // The #lumpViewingLabel element must become visible.
        const label = page.locator('#lumpViewingLabel');
        await expect(label).toBeVisible();

        // It must start with "Viewing:" …
        await expect(label).toContainText('Viewing:');

        // … and include the abstraction name.
        await expect(label).toContainText('LED');
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — changing sort order does not reset the picker selection
// ─────────────────────────────────────────────────────────────────────────────

test.describe('LUMP picker — selection survives sort-order change', () => {

    test('picker keeps the same token after cycling through all sort orders', async ({ page }) => {
        test.setTimeout(40000);
        const picker  = await setupLumpsView(page);
        const sortSel = page.locator('#lumpSortSelect');

        // Pre-condition: pick a lump.
        await picker.selectOption({ value: STUB_TOKEN_A });
        await expect(picker).toHaveValue(STUB_TOKEN_A);

        // Cycle through every sort option; after each re-render the picker
        // must still show the same token (_lumpSortChanged preserves
        // _selectedLumpToken via the `chosen` attribute in the rebuilt HTML).
        for (const sortVal of ['recent', 'compiled', 'mtbf', 'name']) {
            await sortSel.selectOption({ value: sortVal });

            // _lumpSortChanged rewrites picker.innerHTML synchronously on the
            // change event, so Playwright's built-in assertion retry is enough
            // — no fixed sleep needed.
            await expect(picker).toHaveValue(STUB_TOKEN_A,
                { message: `Picker lost selection after sort changed to '${sortVal}'` });
        }
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — last-selected lump is restored after a page reload
// ─────────────────────────────────────────────────────────────────────────────

test.describe('LUMP picker — selection restored after page reload', () => {

    test('picker pre-selects the last-viewed lump and shows the Viewing label after reload', async ({ page }) => {
        test.setTimeout(60000);

        // ── First load: pick a lump so localStorage gets written ──────────────
        const picker = await setupLumpsView(page);

        // Verify the placeholder is shown initially (clean state).
        await expect(picker).toHaveValue('');

        // Pick STUB_TOKEN_A — this persists it to localStorage via lumpPickerChanged.
        await picker.selectOption({ value: STUB_TOKEN_A });
        await expect(picker).toHaveValue(STUB_TOKEN_A);

        // Confirm the Viewing label appeared on the first load.
        const label = page.locator('#lumpViewingLabel');
        await expect(label).toBeVisible();
        await expect(label).toContainText('Viewing:');
        await expect(label).toContainText('LED');

        // Verify localStorage was written (sanity check before reload).
        const storedToken = await page.evaluate(() => localStorage.getItem('lastSelectedLumpToken'));
        expect(storedToken).toBe(STUB_TOKEN_A);

        // ── Reload: API stubs must be re-installed before navigation ──────────
        // Re-install intercepts (they are cleared by reload/navigation).
        await page.route('**/api/lumps/list', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(STUB_LUMPS),
            });
        });
        await page.route('**/api/lumps/detail/**', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ token: STUB_TOKEN_A, abstraction: 'LED' }),
            });
        });

        await page.reload();
        await page.waitForLoadState('networkidle');

        // Switch to the LUMP Repository view after reload.
        await page.evaluate(() => {
            if (typeof window.switchView === 'function') window.switchView('lumps');
        });

        await expect(page.locator('#lumps')).toBeVisible();
        const pickerAfter = page.locator('#lumpPickerSelect');
        await pickerAfter.waitFor({ state: 'visible' });

        // ── Post-reload assertions ─────────────────────────────────────────────
        // The picker must show the previously-selected token, not the placeholder.
        await expect(pickerAfter).toHaveValue(STUB_TOKEN_A,
            { message: 'Picker should restore the last-viewed lump after reload' });

        // The selected option must include the abstraction name.
        await expect(pickerAfter.locator('option:checked')).toContainText('LED');

        // The Viewing label must be visible and contain the correct name.
        const labelAfter = page.locator('#lumpViewingLabel');
        await expect(labelAfter).toBeVisible();
        await expect(labelAfter).toContainText('Viewing:');
        await expect(labelAfter).toContainText('LED');
    });

});
