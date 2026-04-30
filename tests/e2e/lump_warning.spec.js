'use strict';

// lump_warning.spec.js — Playwright E2E tests for LUMP navigation from the
// Abstractions view.
//
// Test 1 — "no LUMP" warning path:
//   double-click on an abstraction row with an empty lumps list
//     → _goToLumpByAbstractionName()
//     → _showFpgaToast() renders the toast in the real DOM
//     → toast auto-dismisses after ~2 s
//
// Test 2 — happy path:
//   double-click on an abstraction row when a matching LUMP exists
//     → _goToLumpByAbstractionName() sets _pendingLumpAbstractionName and
//       calls switchView('lumps')
//     → renderLumps() picks up the pending name, selects the correct token,
//       and pre-selects the matching option in #lumpPickerSelect (dropdown)
//
// The /api/lumps/list route is intercepted in both suites to make tests
// deterministic regardless of which LUMPs happen to be compiled locally.

const { test, expect } = require('@playwright/test');

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — no-LUMP warning toast
// ─────────────────────────────────────────────────────────────────────────────

test.describe('no-LUMP warning toast', () => {

    test.beforeEach(async ({ page }) => {
        // Intercept the lumps list API so the warm/cold cache both resolve to
        // "no lumps exist", guaranteeing the warning path is taken for any
        // abstraction the test double-clicks.
        await page.route('**/api/lumps/list', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([]),
            });
        });

        await page.goto('/simulator/');
        // Wait for the page JS to finish loading.
        await page.waitForLoadState('networkidle');
    });

    test('shows "No compiled LUMP found" toast after double-clicking an abstraction with no LUMP', async ({ page }) => {
        // Open the hamburger menu so the nav items become visible.
        const hamBtn = page.locator('#hamBtn');
        await hamBtn.waitFor({ state: 'visible' });
        await hamBtn.click();

        // Navigate to the Abstractions view via the hamburger menu button.
        const absBtn = page.locator('#hamItem-abstractions');
        await absBtn.waitFor({ state: 'visible' });
        await absBtn.click();

        // Wait for at least one abstraction row to render.
        const firstRow = page.locator('.abs-item').first();
        await firstRow.waitFor({ state: 'visible' });

        // Double-click fires the ondblclick handler which calls
        // _goToLumpByAbstractionName(). The route intercept above ensures the
        // lumps list is empty, so the warning toast should appear.
        await firstRow.dblclick();

        // ── Assert 1: toast is visible with the expected text ─────────────────
        const toast = page.locator('#fpgaToastEl');
        await expect(toast).toBeVisible();

        const body = toast.locator('.fpga-toast-body');
        await expect(body).toContainText('No compiled LUMP found');

        // ── Assert 2: toast carries the warning CSS class ─────────────────────
        await expect(toast).toHaveClass(/fpga-toast-warn/);

        // ── Assert 3: toast auto-dismisses within 3 s ────────────────────────
        // _showFpgaToast schedules a fade at 2000 ms and element removal
        // 400 ms later, so the element should be gone well within 3 s.
        await expect(toast).not.toBeVisible({ timeout: 3000 });
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — happy path: double-click navigates to the correct LUMP row
// ─────────────────────────────────────────────────────────────────────────────

// The abstraction name used throughout this suite. 'LED' is always present
// in AbstractionRegistry._registerAll() (index 12, layer 2), making it a
// reliable anchor that doesn't depend on user-compiled code.
const STUB_ABSTRACTION = 'LED';
const STUB_TOKEN       = 'DEADBEEF';

const STUB_LUMP = {
    token:       STUB_TOKEN,
    abstraction: STUB_ABSTRACTION,
    lump_size:   256,
    methods:     ['On', 'Off'],
    language:    'church',
    profile:     'default',
    mtbf:        { status: 'green' },
};

test.describe('happy-path LUMP navigation', () => {

    test.beforeEach(async ({ page }) => {
        // Intercept the lumps list API to return exactly one LUMP whose
        // .abstraction matches the 'LED' entry in the static registry.
        // Both _goToLumpByAbstractionName (cold-cache fetch) and renderLumps
        // (second fetch after switchView) will receive this stub.
        await page.route('**/api/lumps/list', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([STUB_LUMP]),
            });
        });

        await page.goto('/simulator/');
        await page.waitForLoadState('networkidle');
    });

    test('double-clicking an abstraction with a compiled LUMP switches to the LUMP repository and selects the correct option in the dropdown', async ({ page }) => {
        // ── Step 1: open the hamburger menu, then switch to Abstractions ──────
        const hamBtn = page.locator('#hamBtn');
        await hamBtn.waitFor({ state: 'visible' });
        await hamBtn.click();

        const absBtn = page.locator('#hamItem-abstractions');
        await absBtn.waitFor({ state: 'visible' });
        await absBtn.click();

        // ── Step 2: find the LED abstraction row ─────────────────────────────
        // The row contains a <span class="abs-item-name"> with the exact text
        // 'LED'. Use a regex anchor so the locator does not also match the
        // sibling 'LED flash' entry (Playwright hasText uses substring match
        // by default; /^LED$/ forces an exact-text match).
        const ledRow = page.locator('.abs-item', {
            has: page.locator('.abs-item-name', { hasText: /^LED$/ }),
        });
        // Guard: exactly one row should match so dblclick() is unambiguous.
        await expect(ledRow).toHaveCount(1);
        await ledRow.waitFor({ state: 'visible' });

        // ── Step 3: double-click to trigger navigation ────────────────────────
        // _goToLumpByAbstractionName('LED') finds the stub LUMP in the
        // intercepted response, sets _pendingLumpAbstractionName, and calls
        // switchView('lumps').
        await ledRow.dblclick();

        // ── Assert 1: LUMP repository view is now visible ─────────────────────
        // switchView('lumps') adds the `active` class to #lumps, which the
        // stylesheet displays as `display: block`.
        const lumpsView = page.locator('#lumps');
        await expect(lumpsView).toBeVisible();

        // ── Assert 2: the dropdown picker shows the correct LUMP selected ────
        // renderLumps() resolves _pendingLumpAbstractionName → token, then
        // sets the matching <option> as selected in #lumpPickerSelect.
        const lumpPicker = page.locator('#lumpPickerSelect');
        await expect(lumpPicker).toBeVisible();
        await expect(lumpPicker).toHaveValue(STUB_TOKEN);
    });

});
