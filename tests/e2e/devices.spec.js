'use strict';

// devices.spec.js — Playwright E2E tests for the Reliability tab
// inside the Devices (Hardware) view.
//
// Suite 1 — tab switching:
//   Clicking the Reliability tab shows #devPaneReliability and hides the
//   other device panes (#devPaneDevices, #devPaneLaunch).
//
// Suite 2 — board filter dropdown population:
//   The #relBoardFilter select is populated with one option per distinct
//   machine_uid present in the /api/device/mtbf response.
//
// Suite 3 — sort toolbar buttons:
//   Clicking the Desc sort button re-orders rows so the highest-MTBF row
//   appears first; clicking Asc restores the lowest-MTBF-first order.
//
// Suite 4 — MTBF colour classes:
//   Green (>=24 h), amber (1-24 h), and red (<1 h) classes are applied to
//   the correct table cells based on each row's mtbf_hours value.
//
// Suite 5 — refresh button:
//   Clicking the refresh button issues a second GET to /api/device/mtbf and
//   re-renders the table with the updated data.
//
// All suites intercept /api/device/mtbf so results are deterministic.

const { test, expect } = require('@playwright/test');

// ─────────────────────────────────────────────────────────────────────────────
// Shared stub data
// ─────────────────────────────────────────────────────────────────────────────

const STUB_ROW_GREEN = {
    machine_uid:       'uid-alpha',
    board_name:        'Alpha Board',
    ns_slot:           5,
    abstraction_label: 'Scheduler',
    mnemonic:          'CALL',
    fault_count:       10,
    first_fault_ts:    1700000000.0,
    last_fault_ts:     1700950000.0,
    mtbf_hours:        26.39,   // >= 24 h → mtbf-green
};

const STUB_ROW_AMBER = {
    machine_uid:       'uid-beta',
    board_name:        'Beta Board',
    ns_slot:           12,
    abstraction_label: 'LED',
    mnemonic:          'LOAD',
    fault_count:       5,
    first_fault_ts:    1700000000.0,
    last_fault_ts:     1700018000.0,
    mtbf_hours:        5.0,     // >= 1 h, < 24 h → mtbf-amber
};

const STUB_ROW_RED = {
    machine_uid:       'uid-alpha',
    board_name:        'Alpha Board',
    ns_slot:           20,
    abstraction_label: 'Boot.Abstr',
    mnemonic:          'MLOAD',
    fault_count:       8,
    first_fault_ts:    1700000000.0,
    last_fault_ts:     1700001400.0,
    mtbf_hours:        0.2,     // < 1 h → mtbf-red
};

// Ordered ascending by mtbf_hours (red=0.2, amber=5, green=26.39).
const STUB_MTBF_RESPONSE = {
    ok:   true,
    rows: [STUB_ROW_RED, STUB_ROW_AMBER, STUB_ROW_GREEN],
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared navigation helper — opens Devices view and switches to Reliability
// ─────────────────────────────────────────────────────────────────────────────

async function openReliabilityTab(page) {
    await page.goto('/simulator/');
    await page.waitForLoadState('networkidle');

    // Open the hamburger menu.
    const hamBtn = page.locator('#hamBtn');
    await hamBtn.waitFor({ state: 'visible' });
    await hamBtn.click();

    // Navigate to the Devices view.
    const devicesBtn = page.locator('#hamItem-devices');
    await devicesBtn.waitFor({ state: 'visible' });
    await devicesBtn.click();

    // Click the Reliability tab in the device header.
    const relTab = page.locator('#devTabReliability');
    await relTab.waitFor({ state: 'visible' });
    await relTab.click();

    // Wait for the pane to become visible.
    const pane = page.locator('#devPaneReliability');
    await pane.waitFor({ state: 'visible' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Tab switching: Reliability pane is shown, others hidden
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Reliability tab — tab switching', () => {

    test.beforeEach(async ({ page }) => {
        await page.route('**/api/device/mtbf**', async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_MTBF_RESPONSE),
            });
        });
    });

    test('clicking Reliability shows #devPaneReliability and hides other panes', async ({ page }) => {
        test.setTimeout(40000);
        await openReliabilityTab(page);

        // Reliability pane must be visible.
        await expect(page.locator('#devPaneReliability')).toBeVisible();

        // The other two device panes must be hidden.
        await expect(page.locator('#devPaneDevices')).toBeHidden();
        await expect(page.locator('#devPaneLaunch')).toBeHidden();

        // Reliability tab button carries the active class.
        await expect(page.locator('#devTabReliability')).toHaveClass(/active/);
        await expect(page.locator('#devTabDevices')).not.toHaveClass(/active/);
        await expect(page.locator('#devTabLaunch')).not.toHaveClass(/active/);
    });

    test('switching away from Reliability hides #devPaneReliability', async ({ page }) => {
        test.setTimeout(40000);
        await openReliabilityTab(page);

        // Switch to the FPGA Devices tab.
        await page.locator('#devTabDevices').click();

        // Reliability pane must now be hidden.
        await expect(page.locator('#devPaneReliability')).toBeHidden();
        await expect(page.locator('#devPaneDevices')).toBeVisible();
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Board filter dropdown populated from API response
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Reliability tab — board filter population', () => {

    test.beforeEach(async ({ page }) => {
        await page.route('**/api/device/mtbf**', async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_MTBF_RESPONSE),
            });
        });
    });

    test('filter dropdown has one option per distinct board UID plus "All boards"', async ({ page }) => {
        test.setTimeout(40000);
        await openReliabilityTab(page);

        // Wait for the table to finish rendering (Loading… replaced).
        await expect(page.locator('#relTableWrap .rel-table')).toBeVisible({ timeout: 8000 });

        const sel = page.locator('#relBoardFilter');
        await expect(sel).toBeVisible();

        // Expect 3 options: "All boards" + uid-alpha + uid-beta
        const options = sel.locator('option');
        await expect(options).toHaveCount(3);

        // The first option must be the catch-all.
        await expect(options.nth(0)).toHaveText('All boards');

        // Board names from the two distinct UIDs must appear.
        await expect(options.filter({ hasText: 'Alpha Board' })).toHaveCount(1);
        await expect(options.filter({ hasText: 'Beta Board' })).toHaveCount(1);
    });

    test('selecting a board UID filters the table to that board only', async ({ page }) => {
        test.setTimeout(40000);

        // Route the second fetch (after filter selection) to return only alpha rows.
        let callCount = 0;
        await page.route('**/api/device/mtbf**', async route => {
            callCount++;
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_MTBF_RESPONSE),
            });
        });

        await openReliabilityTab(page);
        await expect(page.locator('#relTableWrap .rel-table')).toBeVisible({ timeout: 8000 });

        // Select uid-alpha in the board filter.
        const sel = page.locator('#relBoardFilter');
        await sel.selectOption({ value: 'uid-alpha' });

        // After filter change, loadReliabilityPanel() fires and the table re-renders.
        await expect(page.locator('#relTableWrap .rel-table')).toBeVisible({ timeout: 8000 });

        // Only Alpha Board rows should appear in the table body.
        const rows = page.locator('#relTableWrap .rel-table tbody tr');
        const count = await rows.count();
        for (let i = 0; i < count; i++) {
            await expect(rows.nth(i).locator('td.rel-td-board')).toHaveText('Alpha Board');
        }
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Sort toolbar buttons
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Reliability tab — sort toolbar', () => {

    test.beforeEach(async ({ page }) => {
        await page.route('**/api/device/mtbf**', async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                // Stub returns rows already in ascending MTBF order (server default).
                body:        JSON.stringify(STUB_MTBF_RESPONSE),
            });
        });
    });

    test('default sort is ascending: least reliable (lowest MTBF) row is first', async ({ page }) => {
        test.setTimeout(40000);
        await openReliabilityTab(page);
        await expect(page.locator('#relTableWrap .rel-table')).toBeVisible({ timeout: 8000 });

        // relSortAsc must carry the active class by default.
        await expect(page.locator('#relSortAsc')).toHaveClass(/active/);
        await expect(page.locator('#relSortDesc')).not.toHaveClass(/active/);

        // First data row corresponds to the red (lowest MTBF) entry.
        const firstRow = page.locator('#relTableWrap .rel-table tbody tr').first();
        await expect(firstRow.locator('td.rel-td-mnemonic')).toHaveText('MLOAD');
    });

    test('clicking Desc sort puts the highest-MTBF row first', async ({ page }) => {
        test.setTimeout(40000);
        await openReliabilityTab(page);
        await expect(page.locator('#relTableWrap .rel-table')).toBeVisible({ timeout: 8000 });

        // Click the descending sort button.
        await page.locator('#relSortDesc').click();

        // relSortDesc must now be active.
        await expect(page.locator('#relSortDesc')).toHaveClass(/active/);
        await expect(page.locator('#relSortAsc')).not.toHaveClass(/active/);

        // First data row must now be the green (highest MTBF) entry.
        const firstRow = page.locator('#relTableWrap .rel-table tbody tr').first();
        await expect(firstRow.locator('td.rel-td-mnemonic')).toHaveText('CALL');
    });

    test('clicking Asc after Desc restores least-reliable-first order', async ({ page }) => {
        test.setTimeout(40000);
        await openReliabilityTab(page);
        await expect(page.locator('#relTableWrap .rel-table')).toBeVisible({ timeout: 8000 });

        // First switch to desc.
        await page.locator('#relSortDesc').click();
        // Then switch back to asc.
        await page.locator('#relSortAsc').click();

        await expect(page.locator('#relSortAsc')).toHaveClass(/active/);

        // First row must be the lowest-MTBF entry again.
        const firstRow = page.locator('#relTableWrap .rel-table tbody tr').first();
        await expect(firstRow.locator('td.rel-td-mnemonic')).toHaveText('MLOAD');
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — MTBF colour classes
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Reliability tab — MTBF colour classes', () => {

    test.beforeEach(async ({ page }) => {
        await page.route('**/api/device/mtbf**', async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_MTBF_RESPONSE),
            });
        });
    });

    test('green class applied to cells with MTBF >= 24 h', async ({ page }) => {
        test.setTimeout(40000);
        await openReliabilityTab(page);
        await expect(page.locator('#relTableWrap .rel-table')).toBeVisible({ timeout: 8000 });

        // Use exact-match regex so 'CALL' doesn't match any other mnemonic.
        const greenRow = page.locator('#relTableWrap .rel-table tbody tr').filter({
            has: page.locator('td.rel-td-mnemonic', { hasText: /^CALL$/ }),
        });
        await expect(greenRow.locator('td.rel-td-mtbf')).toHaveClass(/mtbf-green/);
    });

    test('amber class applied to cells with 1 h <= MTBF < 24 h', async ({ page }) => {
        test.setTimeout(40000);
        await openReliabilityTab(page);
        await expect(page.locator('#relTableWrap .rel-table')).toBeVisible({ timeout: 8000 });

        // Use exact-match regex to avoid 'LOAD' substring matching 'MLOAD'.
        const amberRow = page.locator('#relTableWrap .rel-table tbody tr').filter({
            has: page.locator('td.rel-td-mnemonic', { hasText: /^LOAD$/ }),
        });
        await expect(amberRow.locator('td.rel-td-mtbf')).toHaveClass(/mtbf-amber/);
    });

    test('red class applied to cells with MTBF < 1 h', async ({ page }) => {
        test.setTimeout(40000);
        await openReliabilityTab(page);
        await expect(page.locator('#relTableWrap .rel-table')).toBeVisible({ timeout: 8000 });

        const redRow = page.locator('#relTableWrap .rel-table tbody tr').filter({
            has: page.locator('td.rel-td-mnemonic', { hasText: /^MLOAD$/ }),
        });
        await expect(redRow.locator('td.rel-td-mtbf')).toHaveClass(/mtbf-red/);
    });

    test('no colour class (mtbf-none) applied to a row with null MTBF', async ({ page }) => {
        test.setTimeout(40000);

        const responseWithNull = {
            ok:   true,
            rows: [
                {
                    machine_uid:       'uid-gamma',
                    board_name:        'Gamma Board',
                    ns_slot:           7,
                    abstraction_label: 'Boot.NS',
                    mnemonic:          'RETURN',
                    fault_count:       1,
                    first_fault_ts:    1700000000.0,
                    last_fault_ts:     1700000000.0,
                    mtbf_hours:        null,     // single fault — no MTBF computable
                },
            ],
        };

        await page.route('**/api/device/mtbf**', async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(responseWithNull),
            });
        });

        await openReliabilityTab(page);
        await expect(page.locator('#relTableWrap .rel-table')).toBeVisible({ timeout: 8000 });

        const nullRow = page.locator('#relTableWrap .rel-table tbody tr').first();
        const mtbfCell = nullRow.locator('td.rel-td-mtbf');
        await expect(mtbfCell).toHaveClass(/mtbf-none/);
        // Should display an em-dash placeholder.
        await expect(mtbfCell).toHaveText('—');
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — Refresh button re-fetches /api/device/mtbf
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Reliability tab — refresh button', () => {

    test('clicking refresh triggers a second GET to /api/device/mtbf', async ({ page }) => {
        test.setTimeout(40000);

        let fetchCount = 0;

        // First response: one row.
        const firstResponse = {
            ok:   true,
            rows: [STUB_ROW_RED],
        };

        // Second response (after refresh): two rows.
        const secondResponse = {
            ok:   true,
            rows: [STUB_ROW_RED, STUB_ROW_GREEN],
        };

        await page.route('**/api/device/mtbf**', async route => {
            fetchCount++;
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(fetchCount === 1 ? firstResponse : secondResponse),
            });
        });

        await openReliabilityTab(page);

        // Wait for the initial table load (1 row).
        await expect(page.locator('#relTableWrap .rel-table')).toBeVisible({ timeout: 8000 });
        const initialRows = page.locator('#relTableWrap .rel-table tbody tr');
        await expect(initialRows).toHaveCount(1);

        // Click the refresh button (inside #devTabActionsReliability).
        const refreshBtn = page.locator('#devTabActionsReliability button.gh-refresh-btn');
        await expect(refreshBtn).toBeVisible();
        await refreshBtn.click();

        // After refresh the table must show the second response's two rows.
        await expect(page.locator('#relTableWrap .rel-table tbody tr')).toHaveCount(2, { timeout: 8000 });

        // API must have been called exactly twice.
        expect(fetchCount).toBe(2);
    });

    test('refresh re-fetches with current board filter applied', async ({ page }) => {
        test.setTimeout(40000);

        const capturedUrls = [];

        await page.route('**/api/device/mtbf**', async route => {
            capturedUrls.push(route.request().url());
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_MTBF_RESPONSE),
            });
        });

        await openReliabilityTab(page);
        await expect(page.locator('#relTableWrap .rel-table')).toBeVisible({ timeout: 8000 });

        // Select a specific board UID in the filter.
        await page.locator('#relBoardFilter').selectOption({ value: 'uid-beta' });
        await expect(page.locator('#relTableWrap .rel-table')).toBeVisible({ timeout: 8000 });

        // Click refresh.
        const refreshBtn = page.locator('#devTabActionsReliability button.gh-refresh-btn');
        await refreshBtn.click();

        // The refresh fetch URL must include the selected uid.
        await page.waitForTimeout(500);
        const lastUrl = capturedUrls[capturedUrls.length - 1];
        expect(lastUrl).toContain('uid=uid-beta');
    });

});
