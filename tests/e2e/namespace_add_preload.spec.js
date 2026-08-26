'use strict';

// The Add LUMP modal is an independent Namespace-policy entry point.  It must
// bind its selected Preload to catalog metadata before the shared policy saver
// posts the Wukong boot configuration.

const { test, expect } = require('@playwright/test');

const TOKEN = 'cafebabe';
const BINARY_HASH = 'a'.repeat(64);
const IDENTITY_HASH = 'b'.repeat(64);
const SIDEcar = {
    token: TOKEN,
    abstraction: 'Bridge.Preload',
    dot_name: 'Bridge.Preload.1.cafebabe',
    cache_token: TOKEN,
    issue_n: 1,
    binary_hash: BINARY_HASH,
    identity_hash: IDENTITY_HASH,
    content_type: 'outform',
    typ: 2,
    capabilities: [],
};
// Valid 64-word type-2 LUMP: magic=0x1f, n_minus_6=0, cw=1, typ=2, cc=0.
const WORDS = [0xF8000600, ...Array(63).fill(0)];

test('Add LUMP binds a forward Wukong Preload before saving policies', async ({ page }) => {
    test.setTimeout(40000);
    let posted = null;

    await page.route('**/api/lumps/list', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([SIDEcar]),
    }));
    await page.route(`**/api/lumps/${TOKEN}/detail`, route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(SIDEcar),
    }));
    await page.route(`**/api/lump/${TOKEN}/words`, route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(WORDS),
    }));
    await page.route(`**/api/lump/${TOKEN}/meta`, route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
    }));
    await page.route('**/api/boot-config', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        posted = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, config: posted }),
        });
    });

    await page.goto('/simulator/');
    await page.addStyleTag({ content: '#faultModalOverlay { display: none !important; }' });
    await page.waitForFunction(() => typeof sim !== 'undefined' && typeof switchView === 'function');

    const slot = await page.evaluate(() => {
        window.bootConfig = {
            targetBoard: 'wukong-xc7a100t',
            step1: {
                totalNamespaceWords: 65536,
                namespaceLumpWords: 64,
                threadLumpWords: 256,
                nsSlotsMax: 256,
            },
            step2: { lumps: [] },
            step3: { emptySlotCount: 0 },
        };
        switchView('namespace');
        const available = Array.from({ length: sim.MAX_NS_ENTRIES }, (_, index) => index)
            .find(index => index >= 11 && !sim.isNSEntryValid(index));
        if (available === undefined) throw new Error('No forward Wukong Namespace slot available');
        _nsTableAdd();
        return available;
    });

    await expect(page.locator('#_nsAddSelect')).toBeVisible();
    await expect(page.locator('#_nsAddConfirmBtn')).toBeEnabled();
    await page.locator('#_nsLoadPolicy').selectOption('Preload');
    await page.locator('#_nsSlotPolicy').selectOption('static');
    await page.locator('#_nsSlotInput').fill(String(slot));
    await page.locator('#_nsAddConfirmBtn').click();
    await expect(page.locator('#_nsAddModalOverlay')).toHaveCount(0);

    await page.locator('#nsPrefetchSaveBtn').click();
    await expect.poll(() => posted).not.toBeNull();

    const row = posted.step2.lumps.find(entry => entry.nsSlot === slot);
    expect(row).toMatchObject({
        nsSlot: slot,
        abstraction: SIDEcar.dot_name,
        lumpToken: TOKEN,
        loadPolicy: 'Preload',
        lumpSize: 64,
        binaryHash: BINARY_HASH,
        identityHash: IDENTITY_HASH,
    });
    for (const retired of ['prefetch', 'prefetchRequired', 'prefetchOrder', 'downloadUrl']) {
        expect(row).not.toHaveProperty(retired);
    }
});