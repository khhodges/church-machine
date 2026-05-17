'use strict';

// preset_notice_bar.spec.js — Playwright E2E tests for the buggy-vs-corrected
// notice bar (#presetNoticeBar).
//
// The bar is updated inside loadExample(). The notice bar element lives inside
// the #editor panel, which is not visible unless the editor view is active.
// Each test therefore:
//   1. Navigates to the editor view via the hamburger menu.
//   2. Invokes loadExample() via JS evaluation (the example-tab buttons for
//      some keys are hidden by the language filter in app-compile.js, so
//      direct JS calls are more reliable than clicking DOM buttons).
//   3. Asserts on #presetNoticeBar visibility and text.
//
// Three cases are covered:
//   1. ada_note_g_published_bug → bar visible, text mentions "dividend and
//      divisor swapped"
//   2. ada_note_g              → bar visible, text mentions "Integer arithmetic
//      only"
//   3. capability_test         → bar hidden (any non-Ada example clears it)

const { test, expect } = require('@playwright/test');

async function openEditorView(page) {
    const hamBtn = page.locator('#hamBtn');
    await hamBtn.waitFor({ state: 'visible' });
    await hamBtn.click();

    const editorBtn = page.locator('#hamItem-editor');
    await editorBtn.waitFor({ state: 'visible' });
    await editorBtn.click();

    // Wait for the editor panel to become the active view.
    const editorPanel = page.locator('#editor');
    await expect(editorPanel).toBeVisible({ timeout: 5000 });
}

test.describe('preset notice bar', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/simulator/');
        await page.waitForLoadState('networkidle');
    });

    // ── Case 1: published-bug example ────────────────────────────────────────
    test('shows "dividend and divisor swapped" notice for ada_note_g_published_bug', async ({ page }) => {
        test.setTimeout(30000);

        await openEditorView(page);

        // ada_note_g_published_bug is defined in the loadExample() examples dict
        // and its name matches the notice-bar branch, so we call loadExample
        // directly rather than loadCLOOMCExample (which doesn't touch the bar).
        await page.evaluate(() => window.loadExample('ada_note_g_published_bug'));

        const noticeBar = page.locator('#presetNoticeBar');
        await expect(noticeBar).toBeVisible();

        const textEl = noticeBar.locator('.preset-notice-text');
        await expect(textEl).toContainText('dividend and divisor swapped');
    });

    // ── Case 2: corrected Ada Note G assembly example ─────────────────────────
    test('shows "Integer arithmetic only" notice for ada_note_g', async ({ page }) => {
        test.setTimeout(30000);

        await openEditorView(page);

        await page.evaluate(() => window.loadExample('ada_note_g'));

        const noticeBar = page.locator('#presetNoticeBar');
        await expect(noticeBar).toBeVisible();

        const textEl = noticeBar.locator('.preset-notice-text');
        await expect(textEl).toContainText('Integer arithmetic only');
    });

    // ── Case 3: any non-Ada example hides the bar ─────────────────────────────
    test('hides the notice bar when a non-Ada example is loaded', async ({ page }) => {
        test.setTimeout(30000);

        await openEditorView(page);

        // Start with the bug example so the bar is visible first.
        await page.evaluate(() => window.loadExample('ada_note_g_published_bug'));

        const noticeBar = page.locator('#presetNoticeBar');
        await expect(noticeBar).toBeVisible();

        // Now switch to capability_test — bar should disappear.
        await page.evaluate(() => window.loadExample('capability_test'));
        await expect(noticeBar).not.toBeVisible();
    });

});
