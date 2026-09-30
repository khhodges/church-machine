'use strict';

// Namespace Table is the programmer-facing slot-policy surface.  This test
// verifies it persists only the canonical policy record Builder consumes.

const { test, expect } = require('@playwright/test');

test('Namespace save errors persist until acknowledgement, then allow retry', async ({ page }) => {
    let saves = 0;
    const error = 'Slot 6 validation failed: the Namespace entry does not match its LUMP. Review the complete entry before saving again.';
    await page.route('**/api/namespace/save-table', async route => {
        saves++;
        const payload = route.request().postDataJSON();
        expect(Object.keys(payload).sort()).toEqual(['namespaceFingerprint', 'ns_state']);
        await route.fulfill({
            status: saves === 1 ? 400 : 200,
            contentType: 'application/json',
            body: JSON.stringify(saves === 1 ? { error } : { ok: true,
                abstractions: payload.ns_state.abstractions,
                savedAbstractions: payload.ns_state.abstractions,
                namespaceFingerprint: 'e2e-retry-saved', imageRebuilt: false,
                imageStatus: 'not-rebuilt' }),
        });
    });
    await page.goto('/simulator/');
    await page.addStyleTag({ content: '#faultModalOverlay, #whatsNewModal { display: none !important; }' });
    await page.waitForFunction(() => typeof sim !== 'undefined' && sim && sim.nsCount > 0 &&
        typeof updateNamespace === 'function' && Array.isArray(window._nsState?.savedAbstractions));
    await page.evaluate(() => {
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
    await expect(button).toHaveText('✓ Table saved — image unchanged');
    expect(saves).toBe(2);
    expect(await page.evaluate(() => window._nsTableDirty)).toBe(false);
    await expect(button).toBeEnabled();

    // Keyboard acknowledgement restores the current clean state too.
    await page.evaluate(() => {
        window._nsTableSaveError = 'A second error';
        updateNamespace();
    });
    await button.focus();
    await button.press('Enter');
    await expect(button).toContainText('Save Namespace Table');
    expect(saves).toBe(2);
    expect(await page.evaluate(() => window._nsTableDirty)).toBe(false);
});

test('Namespace Table saves an independent canonical Preload policy', async ({ page }) => {
    test.setTimeout(40000);
    let posted = null;

    await page.goto('/simulator/');
    // Keep unrelated persisted fault telemetry from covering this policy-only UI.
    await page.addStyleTag({ content: '#faultModalOverlay { display: none !important; }' });
    await page.waitForFunction(() => typeof sim !== 'undefined' &&
        typeof updateNamespace === 'function' && Array.isArray(window._nsState?.savedAbstractions));

    await page.route('**/api/namespace/save-table', async route => {
        posted = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true,
                abstractions: posted.ns_state.abstractions,
                savedAbstractions: posted.ns_state.abstractions,
                namespaceFingerprint: 'e2e-policy-saved', imageRebuilt: false,
                imageStatus: 'not-rebuilt' }),
        });
    });

    const baseline = await page.evaluate(() => {
        const row = window._nsState.savedAbstractions.find(row => row.slot >= 14 &&
            !row.symbolic && sim.readNSEntry(row.slot) &&
            !_nsSlotHasResidentThreadBody(row.slot));
        if (!row) throw new Error('No editable executable Namespace row is available for test');
        switchView('namespace');
        return JSON.parse(JSON.stringify(row));
    });
    const slot = baseline.slot;

    const policy = page.getByLabel(`Load policy for slot ${slot}`);
    await expect(policy).toBeVisible();
    await policy.selectOption('Preload');

    await page.locator('#nsSaveBtn').click();
    await expect.poll(() => posted).not.toBeNull();

    expect(Object.keys(posted).sort()).toEqual(['namespaceFingerprint', 'ns_state']);
    const row = posted.ns_state.abstractions.find(entry => entry.slot === slot);
    const expected = {...baseline, load_policy: 'Preload', resident: false};
    if ('loadPolicy' in expected) expected.loadPolicy = 'Preload';
    expect(row).toEqual(expected);
    await expect(page.locator('#nsSaveLayoutNote')).toContainText('Built image, bitstream, and active simulation unchanged');
});