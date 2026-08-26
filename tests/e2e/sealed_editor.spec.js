'use strict';

// sealed_editor.spec.js — Playwright E2E test
//
// Verifies that the editor remains fully editable after a clean compile.
// The old sealed-editor behaviour (readOnly = true, cm-editor-sealed class,
// cm_sealed_lump in localStorage) was intentionally removed so that users can
// continue refining their code without navigating away after each compile.
//
// This suite now asserts the OPPOSITE of the old behaviour:
//   1. After compileAndBuild() the editor must still be editable.
//   2. The cm-editor-sealed CSS class must NOT be present.
//   3. localStorage['cm_sealed_lump'] must be null / absent.
//   4. All three conditions must survive a page reload.

const { test, expect } = require('@playwright/test');

// Minimal assembly source: one instruction.  The compiler defaults the name
// to 'Unnamed' and builds the smallest valid binary (cw=1, cc=0).
const MINIMAL_SOURCE = 'HALT';

/**
 * Inject MINIMAL_SOURCE into #asmEditor, suppress lumpAudit and the blob
 * download, call compileAndBuild(), and return an editable-state snapshot.
 */
async function triggerCompile(page) {
    return page.evaluate((src) => {
        const editor = document.getElementById('asmEditor');
        if (editor) editor.value = src;

        const sel = document.getElementById('langSelector');
        if (sel) sel.value = 'assembly';

        // Bypass lumpAudit — minimal binary would fail structural rules.
        const savedAudit = window.lumpAudit;
        window.lumpAudit = undefined;

        // Suppress the blob download.
        const origAnchorClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
            if (this.hasAttribute('download')) return;
            return origAnchorClick.call(this);
        };
        const origCreateObjURL = URL.createObjectURL;
        URL.createObjectURL = () => 'blob:suppressed-by-test';

        try {
            compileAndBuild();
        } finally {
            window.lumpAudit = savedAudit;
            HTMLAnchorElement.prototype.click = origAnchorClick;
            URL.createObjectURL = origCreateObjURL;
        }

        const ed = document.getElementById('asmEditor');
        return {
            readOnly:   ed ? ed.readOnly : null,
            hasClass:   ed ? ed.classList.contains('cm-editor-sealed') : false,
            sealedLump: localStorage.getItem('cm_sealed_lump'),
        };
    }, MINIMAL_SOURCE);
}

async function readEditableState(page) {
    return page.evaluate(() => {
        const ed = document.getElementById('asmEditor');
        return {
            readOnly:   ed ? ed.readOnly : null,
            hasClass:   ed ? ed.classList.contains('cm-editor-sealed') : false,
            sealedLump: localStorage.getItem('cm_sealed_lump'),
        };
    });
}

test.describe('Editor remains editable after compile', () => {

    test('editor is editable after compile and stays editable after page reload', async ({ page }) => {
        test.setTimeout(60000);

        // Intercept server save so no artefacts are written.
        await page.route('**/api/lumps/save', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true, lump: 'Unnamed.lump', token: 'test0000' }),
            });
        });

        await page.goto('/simulator/');
        await page.waitForFunction(() =>
            typeof window.compileAndBuild === 'function' &&
            !!document.getElementById('asmEditor'));

        const after = await triggerCompile(page);

        // Editor must remain editable — NOT read-only
        expect(after.readOnly, '#asmEditor must stay editable after compile').toBe(false);

        // The sealed CSS class must not be present
        expect(after.hasClass, '#asmEditor must not carry cm-editor-sealed').toBe(false);

        // No sealed-lump token should be stored
        expect(after.sealedLump, 'cm_sealed_lump must be absent from localStorage').toBeNull();

        // ── Reload and re-assert ──────────────────────────────────────────────
        await page.reload();
        await page.waitForFunction(() =>
            typeof window.compileAndBuild === 'function' &&
            !!document.getElementById('asmEditor'));

        const afterReload = await readEditableState(page);

        expect(afterReload.readOnly,
            '#asmEditor must still be editable after reload').toBe(false);

        expect(afterReload.hasClass,
            '#asmEditor must not carry cm-editor-sealed after reload').toBe(false);

        expect(afterReload.sealedLump,
            'cm_sealed_lump must still be absent after reload').toBeNull();
    });

    test('Enter keeps focus in raw assembly after compiling', async ({ page }) => {
        test.setTimeout(60000);

        await page.goto('/simulator/');
        await page.waitForFunction(() =>
            typeof window.assembleAndLoad === 'function' &&
            !!document.getElementById('asmEditor'));

        await page.evaluate(() => {
            window.switchView('editor');
            const editor = document.getElementById('asmEditor');
            const language = document.getElementById('langSelector');
            if (language) language.value = 'assembly';
            editor.value = 'HALT';
            window.assembleAndLoad();
        });

        const editor = page.locator('#asmEditor');
        await editor.focus();
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await page.keyboard.type('IADD DR1, DR1, #9');

        const afterNewline = await page.evaluate(() => {
            const ed = document.getElementById('asmEditor');
            return {
                focused: document.activeElement === ed,
                readOnly: ed ? ed.readOnly : null,
                value: ed ? ed.value : '',
                pickerVisible: !!(window.AsmInstructionPicker && window.AsmInstructionPicker.isVisible()),
            };
        });
        expect(afterNewline.focused, 'Enter must keep keyboard focus in the editor').toBe(true);
        expect(afterNewline.readOnly, 'editor must remain writable after Enter').toBe(false);
        expect(afterNewline.pickerVisible, 'Enter must not auto-open the instruction picker').toBe(false);
        expect(afterNewline.value).toContain('HALT\nIADD DR1, DR1, #9');
    });

});
