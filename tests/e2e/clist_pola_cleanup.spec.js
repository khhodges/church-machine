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
        await page.waitForLoadState('networkidle');
    });

    test('POLA button is rendered in the popup header', async ({ page }) => {
        await openClistPopup(page, SOURCE_WITH_UNUSED);

        const polaBtn = page.locator('.clist-viewer-popup [data-action="pola-cleanup"]');
        await polaBtn.waitFor({ state: 'visible' });
        await expect(polaBtn).toContainText('POLA');
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

});
