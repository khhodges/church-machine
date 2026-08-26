'use strict';

// resident_lumps_tab.spec.js — Playwright E2E tests for the Resident Lumps tab
// inside the Builder view.
//
// Suite 1 — table loads:
//   Builder → Resident Lumps tab → the 3-LUMP Boot starter kit rows are always
//   present, and catalog lumps returned by /api/boot-config appear in the table.
//
// Suite 2 — resident checkbox interaction:
//   Checking the "resident" checkbox for a catalog lump enables the physAddr
//   input; unchecking it disables the input again.
//
// Suite 3 — Save fires a POST to /api/boot-config:
//   Clicking "Save boot config" (after marking a lump resident with a valid
//   physAddr) fires a POST to /api/boot-config whose JSON body contains the
//   expected step2.lumps entry.
//
// All three suites intercept /api/boot-config so results are deterministic.

const { test, expect } = require('@playwright/test');

// ─────────────────────────────────────────────────────────────────────────────
// Shared stub data
// ─────────────────────────────────────────────────────────────────────────────

const STUB_LUMP = {
    nsSlot:      12,
    abstraction: 'LED',
    lumpSize:    64,
    token:       'DEADBEEF',
    binaryHash:  'aabbccdd',
};

const STUB_BOOT_CONFIG_RESPONSE = {
    lumpCatalog: [STUB_LUMP],
    limits: {
        maxNsEntries:     256,
        baseNamedNsCount: 47,
    },
    config: {
        targetBoard: 'wukong-xc7a100t',
        step1: {
            totalNamespaceWords: 16384,
            namespaceLumpWords:  64,
            threadLumpWords:     64,
        },
        step2: { lumps: [] },
        step3: { emptySlotCount: 0 },
    },
    defaults: {},
    ok: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared navigation helper — opens Builder and switches to Resident Lumps tab
// ─────────────────────────────────────────────────────────────────────────────

async function openResidentLumpsTab(page) {
    await page.goto('/simulator/');
    // These tests exercise boot-policy configuration, not runtime fault UI.
    // The simulator can raise a persisted, unrelated startup fault while the
    // policy panel initializes; keep that overlay out of this focused surface.
    await page.addStyleTag({ content: '#faultModalOverlay { display: none !important; }' });
    await page.waitForFunction(() =>
        typeof window.switchView === 'function' &&
        typeof window.switchBuilderViewTab === 'function');
    // Builder is intentionally not in the ordinary navigation menu. Invoke its
    // supported synchronous view API rather than testing menu visibility.
    await page.evaluate(() => {
        window.switchView('builder');
        window.switchBuilderViewTab('lump-resident');
    });

    // Wait for the panel to render its table.
    const panel = page.locator('#lumpResidentPanel');
    await panel.waitFor({ state: 'visible' });
    await expect(panel.locator('table.le-rl-table')).toBeVisible({ timeout: 8000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — table loads NS entries from /api/boot-config
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Resident Lumps tab — table loads', () => {

    test.beforeEach(async ({ page }) => {
        await page.route('**/api/boot-config', async route => {
            if (route.request().method() === 'GET') {
                await route.fulfill({
                    status:      200,
                    contentType: 'application/json',
                    body:        JSON.stringify(STUB_BOOT_CONFIG_RESPONSE),
                });
            } else {
                await route.continue();
            }
        });
    });

    test('shows the three Boot starter-kit rows', async ({ page }) => {
        test.setTimeout(40000);
        await openResidentLumpsTab(page);

        const panel = page.locator('#lumpResidentPanel');

        // All three foundational lumps must be present.
        await expect(panel.locator('text=Boot.NS')).toBeVisible();
        await expect(panel.locator('text=Boot.Thread')).toBeVisible();
        // Boot entry row now shows a <select> dropdown (or placeholder when catalog
        // is loading). The stub catalog has an entry so the select must be visible.
        const bootEntryRow = panel.locator('tr.le-rl-boot-row').nth(2);
        await expect(bootEntryRow).toBeVisible();
        await expect(bootEntryRow.locator('select.le-rl-boot-select')).toBeVisible();
    });

    test('shows catalog lumps returned by /api/boot-config', async ({ page }) => {
        test.setTimeout(40000);
        await openResidentLumpsTab(page);

        const panel = page.locator('#lumpResidentPanel');

        // The stub catalog contains one lump named 'LED' (check in table cells,
        // not the boot-entry dropdown which may also contain 'LED' as an option).
        await expect(panel.locator('tr.le-rl-row:not(.le-rl-boot-row) td:has-text("LED")')).toBeVisible();

        // Its NS slot (12) and size (64) should also be visible in the table.
        const rows = panel.locator('tr.le-rl-row:not(.le-rl-boot-row)');
        await expect(rows).toHaveCount(1);

        const ledRow = rows.first();
        await expect(ledRow).toContainText('12');
        await expect(ledRow).toContainText('64');
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — policy selection controls the physAddr input
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Resident Lumps tab — load policy selection', () => {

    test.beforeEach(async ({ page }) => {
        await page.route('**/api/boot-config', async route => {
            if (route.request().method() === 'GET') {
                await route.fulfill({
                    status:      200,
                    contentType: 'application/json',
                    body:        JSON.stringify(STUB_BOOT_CONFIG_RESPONSE),
                });
            } else {
                await route.continue();
            }
        });
    });

    test('choosing Resident enables the physAddr input for that lump', async ({ page }) => {
        test.setTimeout(40000);
        await openResidentLumpsTab(page);

        const panel   = page.locator('#lumpResidentPanel');
        const policy  = panel.locator('select[data-rl-slot="12"][data-rl-field="loadPolicy"]');
        const addrIn  = panel.locator('input[type="number"][data-rl-slot="12"][data-rl-field="physAddr"]');

        // Initially Lazy — address input must be disabled.
        await expect(policy).toHaveValue('Lazy');
        await expect(addrIn).toBeDisabled();

        await policy.selectOption('Resident');

        // Resident requires a placement.
        await expect(addrIn).toBeEnabled();
        await expect(policy).toHaveValue('Resident');
    });

    test('leaving Resident disables the physAddr input again', async ({ page }) => {
        test.setTimeout(40000);

        // Start with the lump already resident so we can change policy.
        const residentConfig = JSON.parse(JSON.stringify(STUB_BOOT_CONFIG_RESPONSE));
        residentConfig.config.step2.lumps = [
            { nsSlot: 12, loadPolicy: 'Resident', physAddr: 700, lumpSize: 64 }
        ];

        await page.route('**/api/boot-config', async route => {
            if (route.request().method() === 'GET') {
                await route.fulfill({
                    status:      200,
                    contentType: 'application/json',
                    body:        JSON.stringify(residentConfig),
                });
            } else {
                await route.continue();
            }
        });

        await openResidentLumpsTab(page);

        const panel  = page.locator('#lumpResidentPanel');
        const policy = panel.locator('select[data-rl-slot="12"][data-rl-field="loadPolicy"]');
        const addrIn = panel.locator('input[type="number"][data-rl-slot="12"][data-rl-field="physAddr"]');

        // Currently resident — input must be enabled.
        await expect(policy).toHaveValue('Resident');
        await expect(addrIn).toBeEnabled();

        await policy.selectOption('Preload');

        // Non-resident policies need no programmer-provided placement.
        await expect(addrIn).toBeDisabled();
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Save fires a POST to /api/boot-config
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Resident Lumps tab — Save fires POST to /api/boot-config', () => {

    test('clicking Save sends a POST with the correct step2.lumps payload', async ({ page }) => {
        test.setTimeout(40000);

        // Intercept GET and POST separately; capture the POST body for assertion.
        let capturedPostBody = null;

        await page.route('**/api/boot-config', async route => {
            if (route.request().method() === 'GET') {
                await route.fulfill({
                    status:      200,
                    contentType: 'application/json',
                    body:        JSON.stringify(STUB_BOOT_CONFIG_RESPONSE),
                });
            } else if (route.request().method() === 'POST') {
                capturedPostBody = JSON.parse(route.request().postData() || '{}');
                await route.fulfill({
                    status:      200,
                    contentType: 'application/json',
                    body:        JSON.stringify({
                        ok:     true,
                        config: capturedPostBody,
                    }),
                });
            } else {
                await route.continue();
            }
        });

        await openResidentLumpsTab(page);

        const panel  = page.locator('#lumpResidentPanel');
        const policy = panel.locator('select[data-rl-slot="12"][data-rl-field="loadPolicy"]');
        const addrIn = panel.locator('input[type="number"][data-rl-slot="12"][data-rl-field="physAddr"]');

        // Mark LED as resident and supply a physAddr well above the foundational
        // region (Boot.NS 64 + Boot.Thread 64 + Boot.Abstr 64 = 192).
        await policy.selectOption('Resident');
        await addrIn.fill('700');

        // physAddr input fires an `input` event which triggers _rlOnChange and
        // re-renders the panel.  Give the DOM one tick to stabilise.
        await page.waitForTimeout(100);

        // Click Save.
        const saveBtn = panel.locator('button.le-save-btn');
        await expect(saveBtn).toBeEnabled();
        await saveBtn.click();

        // Wait for the success status message to appear, confirming the POST
        // completed and the panel re-rendered.
        await expect(panel.locator('text=Saved')).toBeVisible({ timeout: 8000 });

        // Assert the POST body structure.
        expect(capturedPostBody).not.toBeNull();
        expect(capturedPostBody).toHaveProperty('step2');
        expect(capturedPostBody.step2).toHaveProperty('lumps');

        const lumps = capturedPostBody.step2.lumps;
        const ledEntry = lumps.find(l => l.nsSlot === 12);
        expect(ledEntry).toBeDefined();
        expect(ledEntry.loadPolicy).toBe('Resident');
        expect(ledEntry.physAddr).toBe(700);
        expect(ledEntry).not.toHaveProperty('resident');

        // step1 and targetBoard must also be present in the payload.
        expect(capturedPostBody).toHaveProperty('step1');
        expect(capturedPostBody).toHaveProperty('targetBoard');
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — independent Preload configuration
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Resident Lumps tab — independent Preload policy', () => {

    test('saves Preload without retired ordering, URL, or required controls', async ({ page }) => {
        test.setTimeout(40000);
        let capturedPostBody = null;

        await page.route('**/api/boot-config', async route => {
            if (route.request().method() === 'GET') {
                await route.fulfill({
                    status:      200,
                    contentType: 'application/json',
                    body:        JSON.stringify(STUB_BOOT_CONFIG_RESPONSE),
                });
            } else if (route.request().method() === 'POST') {
                capturedPostBody = JSON.parse(route.request().postData() || '{}');
                await route.fulfill({
                    status:      200,
                    contentType: 'application/json',
                    body:        JSON.stringify({ ok: true, config: capturedPostBody }),
                });
            } else {
                await route.continue();
            }
        });

        await openResidentLumpsTab(page);
        const panel = page.locator('#lumpResidentPanel');
        const policy = panel.locator('select[data-rl-slot="12"][data-rl-field="loadPolicy"]');
        await expect(policy).toHaveValue('Lazy');
        await policy.selectOption('Preload');
        await expect(panel.locator('[data-rl-field="prefetchRequired"]')).toHaveCount(0);
        await expect(panel.locator('[data-rl-field="prefetchOrder"]')).toHaveCount(0);

        await panel.locator('button.le-save-btn', { hasText: 'Save boot config' }).click();
        await expect.poll(() => capturedPostBody).not.toBeNull();

        const row = capturedPostBody.step2.lumps.find(entry => entry.nsSlot === 12);
        expect(row).toMatchObject({
            nsSlot:          12,
            loadPolicy:      'Preload',
            lumpSize:        64,
            binaryHash:      'aabbccdd',
        });
        expect(row).not.toHaveProperty('resident');
        expect(row).not.toHaveProperty('prefetch');
        expect(row).not.toHaveProperty('prefetchRequired');
        expect(row).not.toHaveProperty('prefetchOrder');
        expect(row).not.toHaveProperty('downloadUrl');
    });

});
