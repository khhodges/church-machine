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
    await page.waitForLoadState('networkidle');

    // Open the hamburger menu.
    const hamBtn = page.locator('#hamBtn');
    await hamBtn.waitFor({ state: 'visible' });
    await hamBtn.click();

    // Navigate to Builder.
    const builderBtn = page.locator('#hamItem-builder');
    await builderBtn.waitFor({ state: 'visible' });
    await builderBtn.click();

    // Click the "Resident Lumps" tab inside the Builder view.
    const residentTab = page.locator('#builderViewTab-lump-resident');
    await residentTab.waitFor({ state: 'visible' });
    await residentTab.click();

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
        // Boot.Abstr row is dynamic: label comes from catalog (by nsSlot) or falls
        // back to "Slot N". The stub catalog has no slot-3 entry so we get "Slot 3".
        // The row is identified by its unique note text regardless of label.
        await expect(panel.locator('text=Boot entry')).toBeVisible();
    });

    test('shows catalog lumps returned by /api/boot-config', async ({ page }) => {
        test.setTimeout(40000);
        await openResidentLumpsTab(page);

        const panel = page.locator('#lumpResidentPanel');

        // The stub catalog contains one lump named 'LED'.
        await expect(panel.locator('text=LED')).toBeVisible();

        // Its NS slot (12) and size (64) should also be visible in the table.
        const rows = panel.locator('tr.le-rl-row:not(.le-rl-boot-row)');
        await expect(rows).toHaveCount(1);

        const ledRow = rows.first();
        await expect(ledRow).toContainText('12');
        await expect(ledRow).toContainText('64');
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — resident checkbox toggles the physAddr input
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Resident Lumps tab — resident checkbox interaction', () => {

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

    test('checking resident enables the physAddr input for that lump', async ({ page }) => {
        test.setTimeout(40000);
        await openResidentLumpsTab(page);

        const panel   = page.locator('#lumpResidentPanel');
        const check   = panel.locator('input[type="checkbox"][data-rl-slot="12"][data-rl-field="resident"]');
        const addrIn  = panel.locator('input[type="number"][data-rl-slot="12"][data-rl-field="physAddr"]');

        // Initially lazy — address input must be disabled.
        await expect(check).not.toBeChecked();
        await expect(addrIn).toBeDisabled();

        // Check the resident box.
        await check.check();

        // After checking, the address input must become enabled.
        await expect(addrIn).toBeEnabled();
        await expect(check).toBeChecked();
    });

    test('unchecking resident disables the physAddr input again', async ({ page }) => {
        test.setTimeout(40000);

        // Start with the lump already resident so we can uncheck it.
        const residentConfig = JSON.parse(JSON.stringify(STUB_BOOT_CONFIG_RESPONSE));
        residentConfig.config.step2.lumps = [
            { nsSlot: 12, resident: true, physAddr: 500, lumpSize: 64 }
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
        const check  = panel.locator('input[type="checkbox"][data-rl-slot="12"][data-rl-field="resident"]');
        const addrIn = panel.locator('input[type="number"][data-rl-slot="12"][data-rl-field="physAddr"]');

        // Currently resident — input must be enabled.
        await expect(check).toBeChecked();
        await expect(addrIn).toBeEnabled();

        // Uncheck.
        await check.uncheck();

        // Address input must be disabled again.
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
        const check  = panel.locator('input[type="checkbox"][data-rl-slot="12"][data-rl-field="resident"]');
        const addrIn = panel.locator('input[type="number"][data-rl-slot="12"][data-rl-field="physAddr"]');

        // Mark LED as resident and supply a physAddr well above the foundational
        // region (Boot.NS 64 + Boot.Thread 64 + Boot.Abstr 64 = 192).
        await check.check();
        await addrIn.fill('500');

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
        expect(ledEntry.resident).toBe(true);
        expect(ledEntry.physAddr).toBe(500);

        // step1 and targetBoard must also be present in the payload.
        expect(capturedPostBody).toHaveProperty('step1');
        expect(capturedPostBody).toHaveProperty('targetBoard');
    });

});
