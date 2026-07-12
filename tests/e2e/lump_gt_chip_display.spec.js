'use strict';

// lump_gt_chip_display.spec.js — Playwright E2E regression tests for GT chip labels.
//
// The Lump Repository has two separate GT chip renderers:
//
//   Renderer A — Content tab  (_renderLumpCodeContent, ~line 3266 of app-lumps.js)
//               Inline C-list section inside the code content view.
//               Live GT chip name element: <span class="lump-gt-chip-name">
//
//   Renderer B — Tokens tab   (_loadLumpTokens, ~line 3443 of app-lumps.js)
//               Standalone GT chip list rendered when Tokens tab opens.
//               Live GT chip name element: <input class="lump-gt-name-input" value="...">
//
// Both renderers had identical bit-shift bugs that caused chip labels to show
// raw "NS[N]" strings instead of the declared capability name.  This spec
// exercises BOTH renderers against a deterministic stub lump that has exactly
// one live Inform GT and a named capability ("Boot.Abstr"), asserting:
//
//   1. The chip label (or input value) equals the declared capability name.
//   2. It does NOT match the "NS[N]" pattern that the bug produced.
//   3. Both renderers agree on the same label for the same lump word.
//
// ── Lump word layout ─────────────────────────────────────────────────────────
//
// sim.parseLumpHeader() computes lumpSize = 2^(n_minus_6+6) — minimum 64 words.
// A sub-64-word stub array causes parseLumpHeader to return a huge lumpSize so
// the clistStart lands outside the array and wVal reads as 0 (null GT).
// This spec uses a proper 64-word lump (n_minus_6=0 → lumpSize=64) so the
// INFORM_GT word lands at the correct clistStart index.
//
// Header word bit layout (simulator.js parseLumpHeader):
//   bits[31:27] magic     = 0x1F
//   bits[26:23] n_minus_6 = 0   (lumpSize = 1 << (0+6) = 64)
//   bits[22:10] cw        = 62  (62 code words)
//   bits[9:8]   typ       = 0
//   bits[7:0]   cc        = 1
//
// → (0x1F<<27)|(0<<23)|(62<<10)|1 = 0xF800F801
//
// The 64-word binary:
//   words[0]    = 0xF800F801  (header)
//   words[1..62]= 0           (code NOPs)
//   words[63]   = 0x02070006  (Inform GT: gtType=1, gtSeq=7, NS slot=6)
//
// clistStart = lumpSize - cc = 64 - 1 = 63 → words[63] is the GT word.
//
// All API endpoints are intercepted — no real server lumps are read or written.

const { test, expect } = require('@playwright/test');

// ─────────────────────────────────────────────────────────────────────────────
// Stub data
// ─────────────────────────────────────────────────────────────────────────────

const STUB_TOKEN = 'deadbeef';
const STUB_TK    = 'deadbeef';

// Lump manifest: one code lump, cc=1, named capability "Boot.Abstr".
const STUB_LUMP = {
    token:        STUB_TOKEN,
    abstraction:  'Boot.Abstr',
    ns_slot:      6,
    lump_size:    64,
    cw:           62,
    cc:           1,
    content_type: 'code',
    language:     'assembly',
    lump_type:    'code',
    version:      1,
    forked:       false,
    capabilities: [{ name: 'Boot.Abstr' }],
};

// Header word — proper 64-word lump (n_minus_6=0 → lumpSize=64):
//   (0x1F << 27) | (0 << 23) | (62 << 10) | 1 = 0xF800F801
//
// Inform GT word — gtType=1, gtSeq=7, NS slot=6:
//   (1 << 25) | (7 << 16) | 6 = 0x02070006

const HDR_WORD  = 0xF800F801;
const INFORM_GT = 0x02070006;

// Build the 64-word array: header + 62 NOPs + 1 Inform GT
const _words = new Array(64).fill(0);
_words[0]  = HDR_WORD;
_words[63] = INFORM_GT;
const STUB_WORDS = { words: _words };

// ─────────────────────────────────────────────────────────────────────────────
// Route setup helper — intercept all lump API calls
// ─────────────────────────────────────────────────────────────────────────────

async function setupRoutes(page) {
    await page.route('**/api/lumps/list', async route => {
        await route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify([STUB_LUMP]),
        });
    });
    // Primary binary endpoint used by _loadLumpContent and _loadLumpTokens.
    await page.route(`**/api/lump/${STUB_TOKEN}/words`, async route => {
        await route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify(STUB_WORDS),
        });
    });
    // Versioned binary endpoint (History/Versions tabs) — stub to avoid noise.
    await page.route(`**/api/lumps/${STUB_TOKEN}/words/**`, async route => {
        await route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify(STUB_WORDS),
        });
    });
    // Detail endpoint — return the same manifest data.
    await page.route(`**/api/lumps/${STUB_TOKEN}/detail`, async route => {
        await route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify(STUB_LUMP),
        });
    });
    // Lump source — not used by these tabs; stub to suppress 404 noise.
    await page.route('**/api/lump-source/**', async route => {
        await route.fulfill({ status: 404, body: '{}' });
    });
}

// Navigate to Lumps view and open the detail panel for STUB_TOKEN.
// Callers must have registered route interceptors before calling this helper.
async function openDetailPanel(page) {
    await page.goto('/simulator/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => typeof switchView === 'function');
    await page.evaluate(() => switchView('lumps'));
    await page.locator('#lumpPickerSelect').waitFor({ state: 'visible', timeout: 12000 });
    await page.evaluate(token => showLumpDetail(token), STUB_TOKEN);
    await page.locator(`#lumpTabBar_${STUB_TK}`).waitFor({ state: 'visible', timeout: 8000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Renderer A: Content tab inline chip strip
// ─────────────────────────────────────────────────────────────────────────────
//
// _renderLumpCodeContent builds an inline C-list section at the bottom of the
// code content view.  Each live GT (Inform/Outform) gets a chip with
// <span class="lump-gt-chip-name"> whose text must be the declared capability
// name, not a raw "NS[N]" fallback.

test.describe('GT chip display — Renderer A: Content tab (inline chip strip)', () => {

    test.beforeEach(async ({ page }) => {
        await setupRoutes(page);
    });

    test('chip label shows declared capability name, not NS[N]', async ({ page }) => {
        test.setTimeout(60000);
        await openDetailPanel(page);

        // Click the "Content" tab — triggers _loadLumpContent → _renderLumpCodeContent.
        const tabBar     = page.locator(`#lumpTabBar_${STUB_TK}`);
        const contentBtn = tabBar.locator('button.lump-tab', { hasText: 'Content' });
        await contentBtn.waitFor({ state: 'visible' });
        await contentBtn.click();

        // Wait for the chip strip to appear inside the Content tab panel.
        const contentPanel = page.locator(`#lumpTabContent_${STUB_TK}`);
        const chip         = contentPanel.locator('.lump-gt-chip').first();
        await chip.waitFor({ state: 'attached', timeout: 12000 });

        // The chip name span must show the declared capability name.
        const chipNameSpan = contentPanel.locator('.lump-gt-chip-name').first();
        await expect(chipNameSpan).toBeAttached({ timeout: 6000 });
        await expect(chipNameSpan).toContainText('Boot.Abstr');

        // Must NOT contain a raw NS-slot pattern (the original bug produced "NS[N]").
        const chipText = await chipNameSpan.textContent();
        expect(chipText).not.toMatch(/^NS\[\d+\]$/);
    });

    test('chip is not the GT#N unresolved fallback', async ({ page }) => {
        test.setTimeout(60000);
        await openDetailPanel(page);

        const tabBar     = page.locator(`#lumpTabBar_${STUB_TK}`);
        const contentBtn = tabBar.locator('button.lump-tab', { hasText: 'Content' });
        await contentBtn.waitFor({ state: 'visible' });
        await contentBtn.click();

        const contentPanel = page.locator(`#lumpTabContent_${STUB_TK}`);
        await contentPanel.locator('.lump-gt-chip').first().waitFor({ state: 'attached', timeout: 12000 });

        // .lump-gt-name-unresolved is only added when no name can be resolved.
        // With capabilities[0].name = 'Boot.Abstr' it must NOT be present.
        const unresolved = contentPanel.locator('.lump-gt-name-unresolved');
        const count = await unresolved.count();
        expect(count).toBe(0);
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Renderer B: Tokens tab card-level chip strip
// ─────────────────────────────────────────────────────────────────────────────
//
// _loadLumpTokens builds a standalone GT chip section.  Unlike Renderer A,
// each live GT (Inform/Outform) chip contains an editable
// <input class="lump-gt-name-input"> whose .value must equal the declared
// capability name, not "NS[N]".

test.describe('GT chip display — Renderer B: Tokens tab (card-level chip strip)', () => {

    test.beforeEach(async ({ page }) => {
        await setupRoutes(page);
    });

    test('chip input value shows declared capability name, not NS[N]', async ({ page }) => {
        test.setTimeout(60000);
        await openDetailPanel(page);

        // Click the "Tokens" tab — triggers _loadLumpTokens.
        const tabBar    = page.locator(`#lumpTabBar_${STUB_TK}`);
        const tokensBtn = tabBar.locator('button.lump-tab', { hasText: 'Tokens' });
        await tokensBtn.waitFor({ state: 'visible' });
        await tokensBtn.click();

        // Wait for the live-GT chip strip to appear inside the Tokens tab panel.
        // Live GTs render as <input class="lump-gt-name-input">.
        const tokensPanel = page.locator(`#lumpTabTokens_${STUB_TK}`);
        const nameInput   = tokensPanel.locator('.lump-gt-name-input').first();
        await nameInput.waitFor({ state: 'attached', timeout: 12000 });

        // The input value must be the declared capability name.
        const inputVal = await nameInput.inputValue();
        expect(inputVal).toBe('Boot.Abstr');

        // Must NOT be a raw NS[N] pattern.
        expect(inputVal).not.toMatch(/^NS\[\d+\]$/);
    });

    test('chip is not the GT#N unresolved fallback', async ({ page }) => {
        test.setTimeout(60000);
        await openDetailPanel(page);

        const tabBar    = page.locator(`#lumpTabBar_${STUB_TK}`);
        const tokensBtn = tabBar.locator('button.lump-tab', { hasText: 'Tokens' });
        await tokensBtn.waitFor({ state: 'visible' });
        await tokensBtn.click();

        const tokensPanel = page.locator(`#lumpTabTokens_${STUB_TK}`);
        await tokensPanel.locator('.lump-gt-name-input').first().waitFor({ state: 'attached', timeout: 12000 });

        // A resolved name input must NOT carry the .lump-gt-name-unresolved class.
        const unresolved = tokensPanel.locator('.lump-gt-name-unresolved');
        const count = await unresolved.count();
        expect(count).toBe(0);
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Cross-renderer consistency: both show the same label
// ─────────────────────────────────────────────────────────────────────────────
//
// Guards against the class of bug where the two renderers drift apart.
// If the same lump data produces different labels in Renderer A vs B,
// one of them has regressed.

test.describe('GT chip display — both renderers agree on the same label', () => {

    test.beforeEach(async ({ page }) => {
        await setupRoutes(page);
    });

    test('Content tab and Tokens tab both show "Boot.Abstr" for the same lump', async ({ page }) => {
        test.setTimeout(90000);
        await openDetailPanel(page);

        const tabBar = page.locator(`#lumpTabBar_${STUB_TK}`);

        // ── Open Content tab (Renderer A) ────────────────────────────────────
        const contentBtn = tabBar.locator('button.lump-tab', { hasText: 'Content' });
        await contentBtn.waitFor({ state: 'visible' });
        await contentBtn.click();

        const contentPanel = page.locator(`#lumpTabContent_${STUB_TK}`);
        await contentPanel.locator('.lump-gt-chip').first().waitFor({ state: 'attached', timeout: 12000 });
        const contentLabel = await contentPanel.locator('.lump-gt-chip-name').first().textContent();

        // ── Open Tokens tab (Renderer B) ─────────────────────────────────────
        const tokensBtn = tabBar.locator('button.lump-tab', { hasText: 'Tokens' });
        await tokensBtn.waitFor({ state: 'visible' });
        await tokensBtn.click();

        const tokensPanel = page.locator(`#lumpTabTokens_${STUB_TK}`);
        await tokensPanel.locator('.lump-gt-name-input').first().waitFor({ state: 'attached', timeout: 12000 });
        const tokensLabel = await tokensPanel.locator('.lump-gt-name-input').first().inputValue();

        // ── Both must resolve to the declared capability name ─────────────────
        expect(contentLabel.trim()).toBe('Boot.Abstr');
        expect(tokensLabel).toBe('Boot.Abstr');
        expect(contentLabel.trim()).toBe(tokensLabel);
    });

});
