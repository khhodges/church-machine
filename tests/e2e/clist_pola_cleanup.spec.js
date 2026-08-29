'use strict';

// clist_pola_cleanup.spec.js — Playwright E2E test verifying that the POLA
// ("Principle of Least Authority") button in the C-List viewer popup is wired
// end-to-end: clicking it in the live DOM strips capabilities-block entries
// that are never referenced elsewhere in the editor source, updates the
// #asmEditor textarea, and shows a confirmation toast.
//
// The pure removal logic (_removeUnusedCapabilities) already has thorough
// unit coverage in tests/simulator/sim_clist_pola_cleanup.js. This spec
// instead catches wiring bugs — e.g. the button missing from the rendered
// popup header, the delegated click handler not matching
// data-action="pola-cleanup", or the toast never appearing — by exercising
// the full browser code path: type source → open popup → click button →
// observe editor + toast.
//
// Source-path rendering (buildContentAsync "Path 0") is used here because it
// requires no sim boot and reflects exactly what a user sees while editing:
// the popup lists capabilities parsed directly out of the capabilities { }
// block in #asmEditor.

const { test, expect } = require('@playwright/test');

const SOURCE_WITH_UNUSED = [
    'capabilities {',
    '  LED0 R W',
    '  UNUSED_CAP R',
    '  BTN R',
    '}',
    '',
    'INVOKE LED0',
    'INVOKE BTN',
    'HALT',
].join('\n');

async function openClistPopup(page, source) {
    await page.evaluate((src) => {
        const editor = document.getElementById('asmEditor');
        if (editor) {
            editor.value = src;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const sel = document.getElementById('langSelector');
        if (sel) sel.value = 'assembly';
        window.CListViewer && window.CListViewer.show();
    }, source);
}

test.describe('POLA cleanup button in the C-List viewer', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/simulator/');
        await page.waitForFunction(() =>
            typeof sim !== 'undefined' &&
            window.CListViewer &&
            typeof window.CListViewer.show === 'function' &&
            document.getElementById('asmEditor'));
    });

    test('POLA button is rendered in the popup header', async ({ page }) => {
        await openClistPopup(page, SOURCE_WITH_UNUSED);

        const polaBtn = page.locator('.clist-viewer-popup [data-action="pola-cleanup"]');
        await polaBtn.waitFor({ state: 'visible' });
        await expect(polaBtn).toContainText('POLA');
    });

    test('source POLA stays an explicit static edit, separate from runtime persistence', async ({ page }) => {
        await openClistPopup(page, SOURCE_WITH_UNUSED);

        const contract = await page.evaluate(() => ({
            runtimeSnapshot: typeof sim.snapshotPersistentMemory === 'function',
            persistentWord: typeof sim.persistentMemoryWord === 'function',
            sourceBefore: document.getElementById('asmEditor').value,
        }));
        expect(contract.runtimeSnapshot).toBe(true);
        expect(contract.persistentWord).toBe(true);
        expect(contract.sourceBefore).toMatch(/UNUSED_CAP/);

        await page.locator('.clist-viewer-popup [data-action="pola-cleanup"]').click();
        await expect(page.locator('#asmEditor')).not.toHaveValue(/UNUSED_CAP/);
    });

    test('clicking POLA removes an unused capability and shows a toast', async ({ page }) => {
        await openClistPopup(page, SOURCE_WITH_UNUSED);

        const polaBtn = page.locator('.clist-viewer-popup [data-action="pola-cleanup"]');
        await polaBtn.waitFor({ state: 'visible' });
        await polaBtn.click();

        // Toast confirms exactly one capability was removed, by name.
        const toast = page.locator('.clist-viewer-popup .clist-pola-toast--show');
        await toast.waitFor({ state: 'visible' });
        await expect(toast).toContainText('UNUSED_CAP');

        // The editor's capabilities block no longer declares UNUSED_CAP, but
        // still declares the two names that are referenced elsewhere.
        const editorValue = await page.locator('#asmEditor').inputValue();
        expect(editorValue).not.toMatch(/UNUSED_CAP/);
        expect(editorValue).toMatch(/LED0/);
        expect(editorValue).toMatch(/BTN/);
    });

    test('clicking POLA on an all-used C-List is a no-op with an info toast', async ({ page }) => {
        const allUsedSource = [
            'capabilities {',
            '  LED0 R W',
            '  BTN R',
            '}',
            '',
            'INVOKE LED0',
            'INVOKE BTN',
            'HALT',
        ].join('\n');

        await openClistPopup(page, allUsedSource);

        const polaBtn = page.locator('.clist-viewer-popup [data-action="pola-cleanup"]');
        await polaBtn.waitFor({ state: 'visible' });
        await polaBtn.click();

        const toast = page.locator('.clist-viewer-popup .clist-pola-toast--show');
        await toast.waitFor({ state: 'visible' });
        await expect(toast).toContainText('already follows POLA');

        const editorValue = await page.locator('#asmEditor').inputValue();
        expect(editorValue).toMatch(/LED0/);
        expect(editorValue).toMatch(/BTN/);
    });

    test('clicking POLA that empties the block keeps showing the source view, not the live boot c-list', async ({ page }) => {
        // Every declared capability here is unused, so POLA should strip all
        // of them, leaving an empty capabilities { } block. Regression check
        // for a bug where the popup then fell through to Path 1 (live-sim
        // CR6), which shows unrelated boot-hardwired capabilities and made it
        // look like POLA had *added* GTs instead of removing unused ones.
        const allUnusedSource = [
            'capabilities {',
            '  UNUSED_ONE R',
            '  UNUSED_TWO R',
            '}',
            '',
            'HALT',
        ].join('\n');

        await openClistPopup(page, allUnusedSource);

        const polaBtn = page.locator('.clist-viewer-popup [data-action="pola-cleanup"]');
        await polaBtn.waitFor({ state: 'visible' });
        await polaBtn.click();

        // The popup title must still read the source-view label, not the
        // live-sim "C-List (CR6)" default title.
        const title = page.locator('.clist-viewer-popup .clist-viewer-title');
        await expect(title).toHaveText(/source/);
        await expect(title).not.toHaveText(/\(CR6\)/);

        // No boot-hardwired live capabilities should have appeared.
        const body = page.locator('.clist-viewer-popup .clist-viewer-body');
        await expect(body).not.toContainText('UART_DEV');
        await expect(body).not.toContainText('LED_DEV');
        await expect(body).not.toContainText('Boot.NS');
        await expect(body).not.toContainText('Boot.Thread');

        // Compiler-owned SELF is synthetic and remains display-only even after
        // every source-declared capability is removed.
        await expect(body).toContainText('SELF');
        await expect(body).not.toContainText('UNUSED_ONE');
        await expect(body).not.toContainText('UNUSED_TWO');

        const editorValue = await page.locator('#asmEditor').inputValue();
        expect(editorValue).not.toMatch(/UNUSED_ONE/);
        expect(editorValue).not.toMatch(/UNUSED_TWO/);
    });

});
