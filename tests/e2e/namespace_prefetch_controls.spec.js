'use strict';

// Namespace Table is the programmer-facing surface for raw boot prefetch.
// This test uses a live IDE page and a synthetic eligible lazy slot, then
// verifies the controls persist the same Step 2 record Builder consumes.

const { test, expect } = require('@playwright/test');

test('Namespace Table saves ordered raw-LUMP prefetch configuration', async ({ page }) => {
    test.setTimeout(40000);
    let posted = null;

    await page.goto('/simulator/');
    await page.waitForFunction(() => typeof sim !== 'undefined' && typeof updateNamespace === 'function');

    await page.route('**/api/boot-config', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        posted = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, config: posted }),
        });
    });

    const slot = await page.evaluate(() => {
        const selected = Array.from({ length: sim.nsCount }, (_, index) => index)
            .find(index => sim.readNSEntry(index));
        if (selected === undefined) throw new Error('No Namespace row is available for test');

        sim.lazyManifest = sim.lazyManifest || {};
        sim.lazyManifest[selected] = {
            bootUpload: {},
            priority: 'warm',
            label: 'Namespace prefetch fixture',
            downloadUrl: '/api/lump/DEADBEEF',
        };
        window.bootConfig = {
            targetBoard: 'wukong-xc7a100t',
            step1: {
                totalNamespaceWords: 16384,
                namespaceLumpWords: 64,
                threadLumpWords: 64,
            },
            step2: { lumps: [] },
            step3: { emptySlotCount: 0 },
        };
        switchView('namespace');
        return selected;
    });

    const prefetch = page.locator(`input[data-ns-prefetch-slot="${slot}"][data-ns-prefetch-field="enabled"]`);
    await expect(prefetch).toBeVisible();
    await prefetch.check();

    const required = page.locator(`input[data-ns-prefetch-slot="${slot}"][data-ns-prefetch-field="required"]`);
    const order = page.locator(`input[data-ns-prefetch-slot="${slot}"][data-ns-prefetch-field="order"]`);
    await expect(required).toBeChecked();
    await expect(order).toHaveValue(String(slot));
    await order.fill('2');
    await order.blur();

    await page.locator('#nsPrefetchSaveBtn').click();
    await expect.poll(() => posted).not.toBeNull();

    expect(posted.step2.lumps).toContainEqual(expect.objectContaining({
        nsSlot: slot,
        resident: false,
        prefetch: true,
        prefetchRequired: true,
        prefetchOrder: 2,
        downloadUrl: '/api/lump/DEADBEEF',
    }));
});