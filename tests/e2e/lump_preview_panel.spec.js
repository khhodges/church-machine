'use strict';

// lump_preview_panel.spec.js — Playwright E2E tests for the LUMP preview panel
// toggle and live-update behaviour.
//
// The preview panel (#lumpSourcePreview) lives inside the CLOOMC editing tab
// of a lump detail panel.  It is populated by _updatePreview() (which calls
// _highlightCLOOMCSource) immediately when the tab opens, and again on every
// textarea `input` event.  A "Preview" button (#lumpSourcePreviewBtn) toggles
// the panel by adding/removing .lump-source-preview-hidden.
//
// Suite 1 — panel visible by default and contains highlighting spans:
//   Stub /api/lumps/list and /api/lump-source/<abstraction>.  Open the CLOOMC
//   tab, assert #lumpSourcePreview is visible and its innerHTML contains at
//   least one .lump-hl-* span (confirming _highlightCLOOMCSource ran).
//
// Suite 2 — toggle hides then re-shows the panel:
//   Click #lumpSourcePreviewBtn → assert .lump-source-preview-hidden added.
//   Click again → assert class removed and content still present.
//
// Suite 3 — live update on textarea input:
//   Clear the textarea and type new source; assert the preview updates to
//   contain a span for the newly typed keyword.
//
// All suites intercept the relevant API endpoints so results are deterministic
// and no real server lumps are read or written.

const { test, expect } = require('@playwright/test');

// ─────────────────────────────────────────────────────────────────────────────
// Shared stub data
// ─────────────────────────────────────────────────────────────────────────────

const STUB_TOKEN = 'ab1e86af';
const STUB_TK    = 'ab1e86af';

// Minimal lump entry returned by /api/lumps/list.
const STUB_LUMP = {
    token:        STUB_TOKEN,
    abstraction:  'TestAbs',
    ns_slot:      20,
    lump_size:    64,
    cw:           10,
    cc:           2,
    content_type: 'code',
    language:     'cloomc',
    lump_type:    'code',
    version:      1,
    source_hash:  'abc123',
    forked:       false,
};

// CLOOMC++ source returned by /api/lump-source/TestAbs.
// Contains keywords (abstraction, method, RETURN) that _highlightCLOOMCSource
// will wrap in .lump-hl-keyword and .lump-hl-mnemonic spans.
const STUB_SOURCE = `abstraction TestAbs
  method Run
    RETURN
  end
end`;

const STUB_LUMP_SOURCE_RESP = {
    abstraction:  'TestAbs',
    source:       STUB_SOURCE,
    binary_only:  false,
    language:     'cloomc',
};

// ─────────────────────────────────────────────────────────────────────────────
// Navigation helpers
// ─────────────────────────────────────────────────────────────────────────────

// Navigates to the Lumps view, opens the detail panel for STUB_TOKEN, and
// clicks the CLOOMC tab so that the source editor and preview panel are shown.
// Callers must have registered the /api/lumps/list and /api/lump-source/*
// route interceptors before calling this helper.
async function openCLOOMCTab(page) {
    await page.goto('/simulator/');
    await page.waitForLoadState('networkidle');

    // Ensure the app shell is initialised.
    await page.waitForFunction(() => typeof switchView === 'function');

    // Ensure preview is open by default (clear any stale localStorage flag).
    await page.evaluate(() => localStorage.removeItem('lumpSourcePreviewOpen'));

    // switchView('lumps') triggers renderLumps() → fetches /api/lumps/list.
    await page.evaluate(() => switchView('lumps'));

    // Wait for the lump picker to confirm the list rendered.
    await page.locator('#lumpPickerSelect').waitFor({ state: 'visible', timeout: 12000 });

    // Open detail panel for the stub lump.
    await page.evaluate((token) => showLumpDetail(token), STUB_TOKEN);

    // Wait for the tab bar.
    await page.locator(`#lumpTabBar_${STUB_TK}`).waitFor({ state: 'visible', timeout: 8000 });

    // Set up a response-promise BEFORE clicking so the intercepted fetch (which
    // resolves near-instantly) cannot fire and complete before our listener
    // is registered.
    const sourceRespPromise = page.waitForResponse(
        resp => resp.url().includes('/api/lump-source/'),
        { timeout: 10000 }
    );

    // Click the CLOOMC tab.
    const tabBar  = page.locator(`#lumpTabBar_${STUB_TK}`);
    const cloomcBtn = tabBar.locator('button.lump-tab', { hasText: 'CLOOMC' });
    await cloomcBtn.waitFor({ state: 'visible' });
    await cloomcBtn.click();

    // Wait for the /api/lump-source fetch to complete so the panel is ready.
    await sourceRespPromise;

    // Wait for the preview element to appear inside the tab panel.
    await page.locator('#lumpSourcePreview').waitFor({ state: 'attached', timeout: 8000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared route setup helper
// ─────────────────────────────────────────────────────────────────────────────

async function setupRoutes(page) {
    await page.route('**/api/lumps/list', async route => {
        await route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify([STUB_LUMP]),
        });
    });
    await page.route('**/api/lump-source/**', async route => {
        await route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify(STUB_LUMP_SOURCE_RESP),
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — panel visible by default and syntax-highlighted
// ─────────────────────────────────────────────────────────────────────────────

test.describe('LUMP preview panel — visible by default with highlighting', () => {

    test.beforeEach(async ({ page }) => {
        await setupRoutes(page);
    });

    test('preview panel is visible when the CLOOMC tab opens', async ({ page }) => {
        test.setTimeout(45000);
        await openCLOOMCTab(page);

        const preview = page.locator('#lumpSourcePreview');

        // The panel must be present and not carry the hidden class.
        await expect(preview).toBeAttached();
        await expect(preview).not.toHaveClass(/lump-source-preview-hidden/);
        // CSS display:none is only set via the hidden class, so visibility
        // follows from the class check above, but an explicit check is clear.
        await expect(preview).toBeVisible();
    });

    test('preview panel innerHTML contains at least one .lump-hl-* span', async ({ page }) => {
        test.setTimeout(45000);
        await openCLOOMCTab(page);

        // _updatePreview() runs immediately; wait for at least one hl span.
        const hlSpan = page.locator('#lumpSourcePreview [class^="lump-hl-"]');
        await expect(hlSpan.first()).toBeAttached({ timeout: 8000 });

        const count = await hlSpan.count();
        expect(count).toBeGreaterThan(0);
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — toggle hides then re-shows the panel
// ─────────────────────────────────────────────────────────────────────────────

test.describe('LUMP preview panel — toggle hides and restores the panel', () => {

    test.beforeEach(async ({ page }) => {
        await setupRoutes(page);
    });

    test('clicking Preview adds .lump-source-preview-hidden', async ({ page }) => {
        test.setTimeout(45000);
        await openCLOOMCTab(page);

        const preview    = page.locator('#lumpSourcePreview');
        const previewBtn = page.locator('#lumpSourcePreviewBtn');

        // Panel must start visible.
        await expect(preview).not.toHaveClass(/lump-source-preview-hidden/);

        // First click → panel hidden.
        await previewBtn.click();
        await expect(preview).toHaveClass(/lump-source-preview-hidden/);
    });

    test('second click removes .lump-source-preview-hidden and content remains', async ({ page }) => {
        test.setTimeout(45000);
        await openCLOOMCTab(page);

        const preview    = page.locator('#lumpSourcePreview');
        const previewBtn = page.locator('#lumpSourcePreviewBtn');

        // First click hides.
        await previewBtn.click();
        await expect(preview).toHaveClass(/lump-source-preview-hidden/);

        // Second click → panel visible again.
        await previewBtn.click();
        await expect(preview).not.toHaveClass(/lump-source-preview-hidden/);
        await expect(preview).toBeVisible();

        // Content must still be present (at least one highlight span).
        const hlSpan = preview.locator('[class^="lump-hl-"]');
        await expect(hlSpan.first()).toBeAttached({ timeout: 6000 });
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — live update: preview reflects textarea changes
// ─────────────────────────────────────────────────────────────────────────────

test.describe('LUMP preview panel — live update on textarea input', () => {

    test.beforeEach(async ({ page }) => {
        await setupRoutes(page);
    });

    test('typing into the editor updates the preview panel', async ({ page }) => {
        test.setTimeout(45000);
        await openCLOOMCTab(page);

        const preview  = page.locator('#lumpSourcePreview');
        const textarea = page.locator('#lumpSourceEditor');

        // Replace the textarea content with a short CLOOMC snippet containing
        // a distinctive keyword that will be highlighted.  Playwright's fill()
        // selects-all and replaces the full content, so no explicit select-all
        // is needed.
        await textarea.fill('abstraction LiveTest\nend');

        // Trigger the input event that _updatePreview listens for.
        await textarea.dispatchEvent('input');

        // The preview must update to contain a highlighted span for the keyword.
        // Use a broad hl-span selector so the test is not tied to a specific
        // CSS class variant.
        const hlSpan = preview.locator('[class^="lump-hl-"]');
        await expect(hlSpan.first()).toBeAttached({ timeout: 8000 });

        // The raw text should be reflected somewhere in the preview.
        await expect(preview).toContainText('LiveTest');
    });

});
