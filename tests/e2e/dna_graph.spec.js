'use strict';

// Browser regression coverage for the recursive LUMP DNA graph.  The fixture
// intentionally contains a cycle (A → B → C → A), a repeated edge (A → B
// twice), and references that must remain visible as leaves.

const { test, expect } = require('@playwright/test');

const A = 'AAA00001';
const B = 'BBB00002';
const C = 'CCC00003';

const STUB_LUMPS = [
    {
        token: A, dot_name: 'Graph.Root', abstraction: 'GraphRoot',
        lump_type: 'code', content_type: 'code', language: 'cloomc',
        lump_size: 128, ns_slot: 10,
        clist_entries: [
            { target_token: B, perms: 'R' },
            { target_token: B, perms: 'R' }, // repeated reference
            { null: true, gt_word: '0x00000000' },
            { legacy: true, target_token: B, perms: 'L' },
            { ns_index: 999, perms: 'R' }, // stale namespace target
        ],
    },
    {
        token: B, dot_name: 'Graph.Middle', abstraction: 'GraphMiddle',
        lump_type: 'code', content_type: 'code', language: 'cloomc',
        lump_size: 96, ns_slot: 11,
        clist_entries: [{ target_token: C, perms: 'R' }],
    },
    {
        token: C, dot_name: 'Graph.Leaf', abstraction: 'GraphLeaf',
        lump_type: 'code', content_type: 'code', language: 'cloomc',
        lump_size: 80, ns_slot: 12,
        clist_entries: [{ target_token: A, perms: 'R' }], // cycle
    },
];

async function openGraph(page) {
    await page.route('**/api/lumps/list', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(STUB_LUMPS),
    }));
    await page.route('**/api/lumps/*/detail', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ capabilities: [], api_definition: null }),
    }));

    await page.goto('/simulator/');
    await page.waitForFunction(() => typeof switchView === 'function');
    await page.evaluate(() => switchView('lumps'));
    await page.locator('#lumpsListContent .lump-deep-dive-btn').first()
        .waitFor({ state: 'visible' });
}

test.describe('LUMP DNA graph regression', () => {
    test('renders recursive cycles, repeated edges, and explicit leaves', async ({ page }) => {
        await openGraph(page);

        const trigger = page.locator(`button[data-deep-dive-token="${A}"]`);
        await trigger.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#lumpDeepDiveModal')).toBeVisible();

        const graph = page.locator('#lumpDeepDiveModal .lump-deep-dive-svg');
        await expect(graph).toHaveAttribute('aria-label', 'Recursive DNA dependency graph');
        await expect(graph).toContainText('Graph.Middle');
        await expect(graph).toContainText('Graph.Leaf');
        await expect(graph).toContainText('NULL · C-List slot 2');
        await expect(graph).toContainText('LEGACY · C-List slot 3');
        await expect(graph).toContainText('UNRESOLVED · NS[999]');
        await expect(graph.locator('text', { hasText: 'reused/cycle' })).toHaveCount(2);

        // The picker/list remain mounted behind the modal and keep their
        // normal interaction state.
        await expect(page.locator('#lumpPickerSelect')).toBeVisible();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');

        const dialog = page.locator('#lumpDeepDiveModal');
        const close = dialog.locator('.lump-deep-dive-close');
        const zoomIn = dialog.locator('#lumpDeepZoomIn');
        const zoomOut = dialog.locator('#lumpDeepZoomOut');
        const zoomReset = dialog.locator('#lumpDeepZoomReset');
        await expect(close).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(zoomReset).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(close).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(zoomIn).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(zoomOut).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(zoomReset).toBeFocused();

        await page.keyboard.press('Escape');
        await expect(page.locator('#lumpDeepDiveModal')).toHaveCount(0);
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(trigger).toBeFocused();
    });

    test('opens and closes cleanly at a narrow viewport', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 720 });
        await openGraph(page);

        const trigger = page.locator(`button[data-deep-dive-token="${A}"]`);
        await trigger.click();
        const modal = page.locator('#lumpDeepDiveModal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('.lump-deep-dive-dialog')).toBeVisible();
        const close = modal.locator('.lump-deep-dive-close');
        const zoomIn = modal.locator('#lumpDeepZoomIn');
        const zoomReset = modal.locator('#lumpDeepZoomReset');
        await expect(close).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(zoomIn).toBeFocused();
        await zoomReset.focus();
        await page.keyboard.press('Tab');
        await expect(close).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(zoomReset).toBeFocused();
        await modal.locator('.lump-deep-dive-close').click();
        await expect(modal).toHaveCount(0);
        await expect(page.locator('#lumpPickerSelect')).toBeVisible();
    });
});
