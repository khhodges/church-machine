'use strict';

// Namespace Table is the programmer-facing slot-policy surface.  This test
// verifies it persists only the canonical policy record Builder consumes.

const { test, expect } = require('@playwright/test');

test('Namespace save errors persist until acknowledgement, then allow retry', async ({ page }) => {
    let saves = 0;
    const error = 'Slot 6 validation failed: the Namespace entry does not match its LUMP. Review the complete entry before saving again.';
    await page.route('**/api/boot-image/save-ns', async route => {
        saves++;
        await route.fulfill({
            status: saves === 1 ? 400 : 200,
            contentType: 'application/json',
            body: JSON.stringify(saves === 1 ? { error } : { ok: true }),
        });
    });
    await page.goto('/simulator/');
    await page.addStyleTag({ content: '#faultModalOverlay, #whatsNewModal { display: none !important; }' });
    await page.waitForFunction(() => typeof sim !== 'undefined' && sim && sim.nsCount > 0 && typeof updateNamespace === 'function');
    await page.evaluate(() => {
        // Isolate the feedback interaction from boot-generation/config writes.
        sim._bootImageLoaded = true;
        window._ensureNamespaceBuildConfig = async () => {};
        switchView('namespace');
        _setNsDirty(true);
    });
    const button = page.locator('#nsSaveBtn');
    await button.click();
    await expect(button).toContainText(error);
    await expect(button).toContainText('Click to dismiss');
    await expect(button).toBeEnabled();
    await page.waitForTimeout(4500);
    await page.evaluate(() => {
        _setNsDirty(false);
        updateNamespace();
    });
    await expect(button).toContainText(error);
    await page.evaluate(() => _setNsDirty(true));
    await expect(button).toContainText(error);
    await button.click();
    expect(saves).toBe(1);
    await expect(button).toContainText('Unsaved NS');
    expect(await page.evaluate(() => window._nsTableDirty)).toBe(true);
    await button.click();
    await expect(button).toHaveText('✓ Saved');
    expect(saves).toBe(2);
    expect(await page.evaluate(() => window._nsTableDirty)).toBe(false);
    await expect(button).toContainText('Save for next build', { timeout: 4000 });
    await expect(button).toBeEnabled();

    // Keyboard acknowledgement restores the current clean state too.
    await page.evaluate(() => {
        window._nsTableSaveError = 'A second error';
        updateNamespace();
    });
    await button.focus();
    await button.press('Enter');
    await expect(button).toContainText('Save for next build');
    expect(saves).toBe(2);
    expect(await page.evaluate(() => window._nsTableDirty)).toBe(false);
});

test('Namespace Table saves an independent canonical Preload policy', async ({ page }) => {
    test.setTimeout(40000);
    let posted = null;
    const binaryHash = 'a'.repeat(64);
    const identityHash = 'b'.repeat(64);

    await page.goto('/simulator/');
    // Keep unrelated persisted fault telemetry from covering this policy-only UI.
    await page.addStyleTag({ content: '#faultModalOverlay { display: none !important; }' });
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
            .find(index => index > 10 && sim.readNSEntry(index));
        if (selected === undefined) throw new Error('No Namespace row is available for test');

        sim.lazyManifest = sim.lazyManifest || {};
        sim.lazyManifest[selected] = {
            bootUpload: {},
            label: 'Namespace prefetch fixture',
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

    const policy = page.getByLabel(`Load policy for slot ${slot}`);
    await expect(policy).toBeVisible();
    // Startup's asynchronous catalog refresh may still be in flight above;
    // install the source record immediately before the user-facing change.
    await page.evaluate((currentSlot) => {
        sim.nsLabels[currentSlot] = 'Namespace prefetch fixture';
        LumpRegistry.registerFromServer([{
            abstraction: 'Namespace prefetch fixture',
            dot_name: 'Namespace.Prefetch.1.deadbeef',
            token: 'deadbeef',
            lumpSize: 64,
            binaryHash: 'a'.repeat(64),
            identityHash: 'b'.repeat(64),
        }]);
    }, slot);
    await policy.selectOption('Preload');

    await page.locator('#nsPrefetchSaveBtn').click();
    await expect.poll(() => posted).not.toBeNull();

    expect(posted.step2.lumps).toContainEqual(expect.objectContaining({
        nsSlot: slot,
        loadPolicy: 'Preload',
        abstraction: 'Namespace.Prefetch.1.deadbeef',
        lumpToken: 'deadbeef',
        lumpSize: 64,
        binaryHash,
        identityHash,
    }));
    const row = posted.step2.lumps.find(entry => entry.nsSlot === slot);
    expect(row).not.toHaveProperty('prefetch');
    expect(row).not.toHaveProperty('prefetchRequired');
    expect(row).not.toHaveProperty('prefetchOrder');
    expect(row).not.toHaveProperty('downloadUrl');
});