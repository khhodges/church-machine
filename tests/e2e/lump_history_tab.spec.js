'use strict';

// lump_history_tab.spec.js — Playwright E2E tests for the LUMP History tab.
//
// Suite 1 — history table renders rows:
//   Navigate to the Lumps view, open a lump's History tab, verify the
//   history table appears with the correct version number, a formatted
//   timestamp, and a Restore button.
//
// Suite 2 — save-via-UI then browse:
//   Click the Restore button (the UI-level action that triggers
//   _restoreLumpFromHistory → POST /api/lumps/save).  After the save
//   completes, re-open the History tab (the loaded flag was cleared by
//   _restoreLumpFromHistory) and verify that a second archived version row
//   appears, confirming the save created a new history entry.
//
// Suite 3 — Restore fires /api/lumps/save and the word-count chip reverts:
//   Click the Restore button, accept the confirm() dialog, verify the POST
//   payload carries the archived binary and correct token, verify the
//   "Restored" toast appears, and verify the lump header strip updates to
//   reflect the smaller word count after a re-render.
//
// All suites intercept the relevant API endpoints so results are deterministic
// and no real server lumps are read or written.

const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
    // History is a software-library view. Live board events can open the fault
    // modal asynchronously and block otherwise unrelated History controls.
    await page.route('**/hardware/wukong/status', route => route.abort());
    await page.route('**/hardware/wukong/events**', route => route.abort());
    await page.route('**/hardware/wukong/boot-info', route => route.abort());
    // Keep the history fixtures deterministic. Tests that need telemetry
    // register their own more-specific response below.
    await page.route('**/api/lump/version-telemetry/TestAbs', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ versions: [] }),
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared stub data
// ─────────────────────────────────────────────────────────────────────────────

const STUB_TOKEN = 'ab1e86af';
// token.replace(/[^a-z0-9]/gi, '') — already alphanumeric for this token
const STUB_TK    = 'ab1e86af';

// Minimal lump entry for /api/lumps/list — current version has 64 words.
const STUB_LUMP = {
    token:        STUB_TOKEN,
    abstraction:  'TestAbs',
    ns_slot:      20,
    lump_size:    64,
    cw:           10,
    cc:           2,
    content_type: 'code',
    language:     'assembly',
    lump_type:    'code',
    version:      2,
};

// Header word: magic=0x1F (bits 31-27), typ=0 (code), cw=10 (bits 22-10), cc=2 (bits 7-0).
// (0x1F << 27) | (10 << 10) | 2  = 0xF8002802
const HDR_WORD = 0xF8002802;

function makeWords(count) {
    const arr = Array(count).fill(0);
    arr[0] = HDR_WORD;
    return arr;
}

// 32-word archived binary for v1.
const ARCHIVED_WORDS = makeWords(32);

// Use noon UTC to keep the formatted date stable across all CI timezones.
// 2024-05-20 12:00:00 UTC → always shows 20 May 2024 regardless of UTC±12.
const COMPILED_AT = 1716206400;

// One archived history entry (v1).
const STUB_HISTORY_V1 = {
    version:     1,
    lump_size:   32,
    cw:          10,
    cc:          2,
    compiled_at: COMPILED_AT,
    abstraction: 'TestAbs',
    binary_hash: 'a'.repeat(64),
    binary_valid: true,
    preview_enabled: true,
    restore_enabled: true,
};

// Response for GET /api/lumps/<token>/history — single entry.
const STUB_HISTORY_RESPONSE = {
    token:   STUB_TOKEN,
    history: [STUB_HISTORY_V1],
};

// Response for GET /api/lumps/<token>/history — two entries (after a save).
const STUB_HISTORY_RESPONSE_2 = {
    token:   STUB_TOKEN,
    history: [
        {
            version: 2, current: true, lump_size: 64, cw: 10, cc: 2,
            compiled_at: COMPILED_AT + 3600, abstraction: 'TestAbs',
            binary_hash: 'b'.repeat(64), binary_available: true,
        },
        STUB_HISTORY_V1,
    ],
};

// Response for GET /api/lumps/<token>/words/1.
const STUB_WORDS_V1 = {
    token:       STUB_TOKEN,
    version:     1,
    words:       ARCHIVED_WORDS,
    count:       ARCHIVED_WORDS.length,
    cw:          10,
    cc:          2,
    lump_size:   32,
    abstraction: 'TestAbs',
    ns_slot:     20,
    compiled_at: COMPILED_AT,
    profile:     'IoT',
    language:    'assembly',
    author:      '',
    source:      'Abstraction TestAbs {\n    Method Init() {\n        RETURN\n    }\n}',
    binary_hash: 'a'.repeat(64),
    binary_valid: true,
};

// Response for GET /api/lump/<token>/words — current (live) version, 64 words.
// Note the singular "lump" path used by _lumpHistoryPreview for the diff fetch.
const CURRENT_WORDS = makeWords(64);
const STUB_WORDS_CURRENT = {
    token:  STUB_TOKEN,
    words:  CURRENT_WORDS,
    count:  CURRENT_WORDS.length,
    binary_hash: 'b'.repeat(64),
    binary_valid: true,
    lump_size: 64,
    cw: 10,
    cc: 2,
};

// ─────────────────────────────────────────────────────────────────────────────
// Navigation helpers
// ─────────────────────────────────────────────────────────────────────────────

// Navigates to the Lumps view and opens the detail panel for STUB_TOKEN.
// Callers must already have set up the /api/lumps/list route interceptor.
async function openLumpDetail(page) {
    await page.goto('/simulator/', { waitUntil: 'domcontentloaded' });
    // Wait until app-shell.js has executed and switchView is in scope.
    await page.waitForFunction(() => typeof switchView === 'function');

    // switchView('lumps') automatically calls renderLumps() which fetches
    // /api/lumps/list and populates _lumpsCache.
    await page.evaluate(() => switchView('lumps'));

    // Wait for the lump picker <select> to appear, confirming renderLumps()
    // finished and the list view is live.
    await page.locator('#lumpPickerSelect').waitFor({ state: 'visible', timeout: 12000 });

    // Open the detail panel for our stub lump.
    await page.evaluate((token) => showLumpDetail(token), STUB_TOKEN);

    // Wait for the tab bar to render.
    await page.locator(`#lumpTabBar_${STUB_TK}`).waitFor({ state: 'visible', timeout: 8000 });
}

// Clicks the "History" tab and waits for the history body to finish loading.
async function clickHistoryTab(page) {
    const tabBar = page.locator(`#lumpTabBar_${STUB_TK}`);
    const histBtn = tabBar.locator('button.lump-tab', { hasText: 'History' });
    await histBtn.waitFor({ state: 'visible' });
    await histBtn.click();

    const histBody = page.locator(`#lumpHistoryBody_${STUB_TK}`);
    await histBody.waitFor({ state: 'visible', timeout: 10000 });
    // Spinner disappears once the fetch resolves.
    await expect(histBody.locator('text=Loading history')).toHaveCount(0, { timeout: 8000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — history table renders rows correctly
// ─────────────────────────────────────────────────────────────────────────────

test.describe('LUMP History tab — table renders rows', () => {

    test.beforeEach(async ({ page }) => {
        await page.route('**/api/lumps/list', async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify([STUB_LUMP]),
            });
        });
        await page.route(`**/api/lumps/${STUB_TOKEN}/history`, async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_HISTORY_RESPONSE),
            });
        });
    });

    test('history table appears with the correct version number', async ({ page }) => {
        test.setTimeout(40000);
        await openLumpDetail(page);
        await clickHistoryTab(page);

        const histBody = page.locator(`#lumpHistoryBody_${STUB_TK}`);

        // The table itself must be present.
        await expect(histBody.locator(`#lumpHistoryTable_${STUB_TK}`)).toBeVisible({ timeout: 8000 });

        // There must be exactly one data row.
        const rows = histBody.locator('tr.lump-history-row');
        await expect(rows).toHaveCount(1);

        // The version cell shows "v1" in bold.
        await expect(rows.first().locator('td strong')).toHaveText('v1');
    });

    test('history row shows a formatted timestamp containing the year and month', async ({ page }) => {
        test.setTimeout(40000);
        await openLumpDetail(page);
        await clickHistoryTab(page);

        const histBody = page.locator(`#lumpHistoryBody_${STUB_TK}`);
        const row = histBody.locator('tr.lump-history-row').first();
        await expect(row).toBeVisible({ timeout: 8000 });

        // The timestamp cell (third column, index 2) — fmtDate renders as
        // "<day> <MonthAbbr> <year> HH:MM".  The epoch 1716206400 is
        // 2024-05-20 12:00 UTC; noon UTC stays on May 20 across all ±12
        // timezones, so "May" and "2024" must both appear in the cell text.
        const tsCell = row.locator('td').nth(2);
        const tsText = await tsCell.innerText();
        expect(tsText).toMatch(/May/);
        expect(tsText).toMatch(/2024/);
        // Must NOT be the em-dash fallback.
        expect(tsText.trim()).not.toBe('\u2014');
    });

    test('history row shows CW, CC, and size columns', async ({ page }) => {
        test.setTimeout(40000);
        await openLumpDetail(page);
        await clickHistoryTab(page);

        const histBody = page.locator(`#lumpHistoryBody_${STUB_TK}`);
        const row = histBody.locator('tr.lump-history-row').first();
        await expect(row).toBeVisible({ timeout: 8000 });

        // The programmer-controlled "This" checkbox is index 1.
        await expect(row.getByRole('checkbox', { name: 'Make v1 the current LUMP' })).toBeVisible();
        // CW column (index 3).
        await expect(row.locator('td').nth(3)).toHaveText('10');
        // CC column (index 4).
        await expect(row.locator('td').nth(4)).toHaveText('2');
        // Size column (index 5) — rendered as "<n>w" plus the content profile.
        await expect(row.locator('td').nth(5)).toContainText('32w');
    });

    test('hovering or focusing Size reveals device, fault, and health telemetry', async ({ page }) => {
        test.setTimeout(40000);
        await page.route(`**/api/lump/version-telemetry/TestAbs`, async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    versions: [{
                        lump_version: 1,
                        lump_token: STUB_TOKEN,
                        compiled_at: COMPILED_AT,
                        device_count: 7,
                        total_faults: 2,
                        total_steps: 2000,
                        observed: true,
                        fault_rate_per_1000: 1,
                        stable_status: 'amber',
                    }],
                }),
            });
        });
        await openLumpDetail(page);
        await clickHistoryTab(page);

        const sizeTrigger = page.locator(
            `#lumpHistoryBody_${STUB_TK} .lump-history-size-trigger`
        );
        await sizeTrigger.hover();
        const popup = sizeTrigger.locator('.lump-history-size-popup');
        await expect(popup).toBeVisible();
        await expect(popup).toContainText('Devices 7');
        await expect(popup).toContainText('Faults/1k 1.0000/1k');
        await expect(popup).toContainText('Health');

        await sizeTrigger.focus();
        await expect(popup).toBeVisible();
    });

    test('history row has an unchecked This checkbox for a valid archive', async ({ page }) => {
        test.setTimeout(40000);
        await openLumpDetail(page);
        await clickHistoryTab(page);

        const histBody = page.locator(`#lumpHistoryBody_${STUB_TK}`);
        const row = histBody.locator('tr.lump-history-row').first();
        await expect(row).toBeVisible({ timeout: 8000 });

        const currentBox = row.getByRole('checkbox', { name: 'Make v1 the current LUMP' });
        await expect(currentBox).toBeVisible();
        await expect(currentBox).not.toBeChecked();
        await expect(currentBox).toBeEnabled();
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — save via UI then browse: clicking Restore saves and History updates
// ─────────────────────────────────────────────────────────────────────────────
//
// The This checkbox is the UI control users click to trigger a LUMP save
// (_setLumpHistoryCurrent → _restoreLumpFromHistory → POST /api/lumps/save).
// After the save lands,
// _restoreLumpFromHistory deletes _lumpHistoryLoaded[tk].  Re-clicking the
// History tab then re-fetches, and the updated endpoint returns a second
// archived version — confirming the save was seen by the history view.

test.describe('LUMP History tab — save via UI then browse', () => {

    test('after selecting This, re-opening History shows a new archived version', async ({ page }) => {
        test.setTimeout(40000);

        let historyCallCount = 0;

        await page.route('**/api/lumps/list', async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify([STUB_LUMP]),
            });
        });
        // First fetch → 1 entry; subsequent fetches → 2 entries (restore created v2).
        await page.route(`**/api/lumps/${STUB_TOKEN}/history`, async route => {
            historyCallCount++;
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(
                    historyCallCount === 1 ? STUB_HISTORY_RESPONSE : STUB_HISTORY_RESPONSE_2
                ),
            });
        });
        await page.route(`**/api/lumps/${STUB_TOKEN}/words/1`, async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_WORDS_V1),
            });
        });
        await page.route(`**/api/lump/${STUB_TOKEN}/words`, async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_WORDS_CURRENT),
            });
        });
        await page.route('**/api/lumps/save', async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify({ ok: true, token: STUB_TOKEN }),
            });
        });

        // Auto-accept the confirm() dialog shown by _restoreLumpFromHistory.
        page.on('dialog', dialog => dialog.accept());
        await openLumpDetail(page);
        await clickHistoryTab(page);

        const histBody = page.locator(`#lumpHistoryBody_${STUB_TK}`);

        // Before save: exactly 1 history row (v1).
        await expect(histBody.locator('tr.lump-history-row')).toHaveCount(1, { timeout: 8000 });

        // Select the This checkbox — this is the UI-level activation action.
        // _restoreLumpFromHistory fetches the archived binary, POSTs it to
        // /api/lumps/save, then clears _lumpHistoryLoaded[tk] so the next
        // History tab click will re-fetch.
        await histBody.getByRole('checkbox', { name: 'Make v1 the current LUMP' }).click();

        // Wait for the save POST to complete.
        await page.waitForResponse(
            resp => new URL(resp.url()).pathname === '/api/lumps/save' &&
                resp.request().method() === 'POST',
            { timeout: 10000 }
        );

        // Re-click the History tab.  Because _lumpHistoryLoaded[tk] was
        // cleared, _switchLumpTab will call _fetchAndShowLumpHistory again,
        // triggering the second /api/lumps/<token>/history request.
        const tabBar = page.locator(`#lumpTabBar_${STUB_TK}`);
        await tabBar.locator('button.lump-tab', { hasText: 'History' }).click();
        await expect(histBody.locator('text=Loading history')).toHaveCount(0, { timeout: 8000 });

        // After save: 2 history rows — v2 (created by activation) and v1.
        await expect(histBody.locator('tr.lump-history-row')).toHaveCount(2, { timeout: 8000 });
        const activeRow = histBody.locator('tr.lump-history-row').first();
        await expect(activeRow.locator('td strong')).toHaveText('v2');
        await expect(activeRow.getByRole('checkbox', { name: 'v2 is the current LUMP' })).toBeChecked();
        await activeRow.getByRole('button', { name: 'Preview' }).click();
        const activePreview = await waitForHexTable(page);
        await expect(activePreview).toContainText('Viewing the current live binary');
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — This checkbox activates via /api/lumps/save and preserves exact binary metadata
// ─────────────────────────────────────────────────────────────────────────────

test.describe('LUMP History tab — This checkbox activates via /api/lumps/save', () => {

    test('selecting This POSTs the archived binary and keeps the exact current size', async ({ page }) => {
        test.setTimeout(40000);

        let capturedSaveBody = null;
        let restored         = false;

        // First /api/lumps/list call serves the current 64-word lump.
        // Subsequent calls (after restore triggers renderLumps) serve the
        // reverted 32-word lump so the header strip can be asserted.
        await page.route('**/api/lumps/list', async route => {
            const lump = restored
                ? { ...STUB_LUMP, lump_size: 32 }                   // 32w after restore
                : STUB_LUMP;                                        // 64w before restore
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify([lump]),
            });
        });
        await page.route(`**/api/lumps/${STUB_TOKEN}/history`, async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_HISTORY_RESPONSE),
            });
        });
        await page.route(`**/api/lumps/${STUB_TOKEN}/words/1`, async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_WORDS_V1),
            });
        });
        await page.route(`**/api/lump/${STUB_TOKEN}/words`, async route => {
            const currentWords = restored
                ? { ...STUB_WORDS_CURRENT, words: ARCHIVED_WORDS, count: ARCHIVED_WORDS.length }
                : STUB_WORDS_CURRENT;
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(currentWords),
            });
        });
        await page.route('**/api/lumps/save', async route => {
            capturedSaveBody = JSON.parse(route.request().postData() || '{}');
            restored = true;
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify({ ok: true, token: STUB_TOKEN }),
            });
        });

        // Auto-accept the confirm() dialog shown by _restoreLumpFromHistory.
        page.on('dialog', dialog => dialog.accept());

        await openLumpDetail(page);
        await clickHistoryTab(page);

        const histBody = page.locator(`#lumpHistoryBody_${STUB_TK}`);
        const row = histBody.locator('tr.lump-history-row').first();
        await expect(row).toBeVisible({ timeout: 8000 });

        // Select This to make this archive live.
        await row.getByRole('checkbox', { name: 'Make v1 the current LUMP' }).click();

        // Wait for the POST to /api/lumps/save to complete.
        await page.waitForResponse(
            resp => new URL(resp.url()).pathname === '/api/lumps/save' &&
                resp.request().method() === 'POST',
            { timeout: 10000 }
        );

        // ── Assert 1: POST payload carries the archived binary ─────────────
        expect(capturedSaveBody).not.toBeNull();
        expect(capturedSaveBody).toHaveProperty('binary');
        expect(capturedSaveBody).toHaveProperty('metadata');
        expect(capturedSaveBody.binary).toHaveLength(ARCHIVED_WORDS.length);  // 32 words
        expect(capturedSaveBody.binary[0]).toBe(HDR_WORD);
        expect(capturedSaveBody.metadata.token).toBe(STUB_TOKEN);

        // ── Assert 2: the toast confirms the restore in the UI ─────────────
        // _restoreLumpFromHistory calls _showFpgaToast('Restored', ...) which
        // appends a div#fpgaToastEl containing the title text.
        const toast = page.locator('#fpgaToastEl');
        await expect(toast).toBeVisible({ timeout: 5000 });
        await expect(toast.locator('.fpga-toast-title')).toHaveText('Restored');

        // ── Assert 3: exact current binary metadata remains authoritative ───
        // Force a renderLumps() pass. The fixture's current words use a
        // 64-word allocation header, so the binary-derived chip remains 64w
        // even though the archived compact fixture reports 32 words.
        await page.evaluate((token) => {
            if (typeof renderLumps === 'function') {
                return renderLumps().then(() => showLumpDetail(token));
            }
        }, STUB_TOKEN);

        // The Size chip is derived from the inspected current words, not the
        // historical row's compact metadata.
        const sizeChip = page.locator(
            `.lump-header-strip .lump-hs-chip:has(.lump-hs-label:text("Size"))`
        );
        await expect(sizeChip).toContainText('64w', { timeout: 8000 });
    });

    test('selecting This with dialog dismissed does not fire /api/lumps/save', async ({ page }) => {
        test.setTimeout(40000);

        let saveCallCount = 0;

        await page.route('**/api/lumps/list', async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify([STUB_LUMP]),
            });
        });
        await page.route(`**/api/lumps/${STUB_TOKEN}/history`, async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_HISTORY_RESPONSE),
            });
        });
        await page.route(`**/api/lumps/${STUB_TOKEN}/words/1`, async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_WORDS_V1),
            });
        });
        await page.route(`**/api/lump/${STUB_TOKEN}/words`, async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_WORDS_CURRENT),
            });
        });
        await page.route('**/api/lumps/save', async route => {
            saveCallCount++;
            await route.continue();
        });

        // Dismiss the confirm() dialog — user chose "Cancel".
        page.on('dialog', dialog => dialog.dismiss());

        await openLumpDetail(page);
        await clickHistoryTab(page);

        const histBody = page.locator(`#lumpHistoryBody_${STUB_TK}`);
        const row = histBody.locator('tr.lump-history-row').first();
        await expect(row).toBeVisible({ timeout: 8000 });

        // Select This, then dismiss the approval dialog.
        await row.getByRole('checkbox', { name: 'Make v1 the current LUMP' }).click();

        // Give the page a moment to fire any inadvertent fetch.
        await page.waitForTimeout(500);

        // No save must have been attempted.
        expect(saveCallCount).toBe(0);
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for Suites 4 and 5 — Preview / row-onclick paths
// ─────────────────────────────────────────────────────────────────────────────

// Stubs all four endpoints consumed by _lumpHistoryPreview:
//   /api/lumps/list, /api/lumps/<token>/history,
//   /api/lumps/<token>/words/1 (archived binary),
//   /api/lump/<token>/words  (current binary for diff — singular "lump" path).
async function stubPreviewRoutes(page) {
    await page.route('**/api/lumps/list', async route => {
        await route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify([STUB_LUMP]),
        });
    });
    await page.route(`**/api/lumps/${STUB_TOKEN}/history`, async route => {
        await route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify(STUB_HISTORY_RESPONSE),
        });
    });
    await page.route(`**/api/lumps/${STUB_TOKEN}/words/1`, async route => {
        await route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify(STUB_WORDS_V1),
        });
    });
    await page.route(`**/api/lump/${STUB_TOKEN}/words`, async route => {
        await route.fulfill({
            status:      200,
            contentType: 'application/json',
            body:        JSON.stringify(STUB_WORDS_CURRENT),
        });
    });
}

// Waits until the Preview popup contains a rendered lump-hex-table.
async function waitForHexTable(page) {
    const previewDiv = page.locator('#lumpHistoryPreviewModal .lump-history-preview-body');
    await expect(previewDiv.locator('table.lump-hex-table')).toBeVisible({ timeout: 10000 });
    return previewDiv;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Preview button fetches archived binary, shows source, and renders
// the hex dump table in a popup
// ─────────────────────────────────────────────────────────────────────────────
//
// Clicking the "Preview" button on a history row calls _lumpHistoryPreview,
// which fetches /api/lumps/<token>/words/<version> (archived binary) and
// /api/lump/<token>/words (current binary for diff), then renders the embedded
// source and a lump-hex-table inside the Preview popup.

test.describe('LUMP History tab — Preview button renders hex dump', () => {

    test('clicking Preview button fetches the archived source and renders lump-hex-table', async ({ page }) => {
        test.setTimeout(40000);

        await stubPreviewRoutes(page);
        await openLumpDetail(page);
        await clickHistoryTab(page);

        const histBody = page.locator(`#lumpHistoryBody_${STUB_TK}`);
        const row = histBody.locator('tr.lump-history-row').first();
        await expect(row).toBeVisible({ timeout: 8000 });

        // Click the Preview button — stopPropagation means only _lumpHistoryPreview fires.
        const previewBtn = row.getByRole('button', { name: 'Preview' });
        await expect(previewBtn).toBeVisible();
        await previewBtn.click();

        // The hex table must appear inside the preview div.
        const previewDiv = await waitForHexTable(page);
        await expect(previewDiv.locator('.lump-history-source-section')).toContainText('Abstraction TestAbs');
        await expect(previewDiv.locator('.lump-history-source-pre')).toContainText('RETURN');
        const hexTable = previewDiv.locator('table.lump-hex-table');
        await expect(hexTable).toBeVisible();

        // The first address cell must show offset 0x000000.
        await expect(hexTable.locator('td.lump-hex-addr').first()).toHaveText('0x000000');
    });

    test('clicking Preview button shows hex table with correct row count for 32-word binary', async ({ page }) => {
        test.setTimeout(40000);

        await stubPreviewRoutes(page);
        await openLumpDetail(page);
        await clickHistoryTab(page);

        const histBody = page.locator(`#lumpHistoryBody_${STUB_TK}`);
        const row = histBody.locator('tr.lump-history-row').first();
        await expect(row).toBeVisible({ timeout: 8000 });

        await row.getByRole('button', { name: 'Preview' }).click();

        const previewDiv = await waitForHexTable(page);
        const hexTable = previewDiv.locator('table.lump-hex-table');

        // ARCHIVED_WORDS is 32 words, 8 columns → ceil(32/8) = 4 data rows.
        // Each data row has class lump-hex-hdr-row, lump-hex-clist-row,
        // lump-hex-pad-row, or no class — they are all <tr> inside <tbody>.
        const dataRows = hexTable.locator('tbody tr');
        await expect(dataRows).toHaveCount(4);

        // The diff summary section must also be present (changed or identical).
        await expect(previewDiv.locator('.lump-detail-section:not(.lump-history-source-section)')).toBeVisible();
    });

});

test.describe('LUMP History tab — legacy bootstrap evidence', () => {
    test('legacy manifest record is previewable and can be deleted', async ({ page }) => {
        test.setTimeout(40000);
        const legacyToken = 'b6182a95';
        const invalidIdentity = {
            applies: true,
            valid: false,
            record_token: legacyToken,
            row0_gt: '4a000006',
            expected_gt: '4a00000a',
        };
        await page.route('**/api/lumps/list', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([STUB_LUMP]),
        }));
        await page.route(`**/api/lumps/${STUB_TOKEN}/history`, route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                token: STUB_TOKEN,
                history: [{
                    ...STUB_HISTORY_V1,
                    historical_record: true,
                    record_token: legacyToken,
                    preview_enabled: true,
                    restore_enabled: false,
                    binary_valid: false,
                    archive_filename: 'CapabilityTest_legacy.lump',
                    record_filename: 'CapabilityTest_legacy.lump',
                    legacy_incompatible: true,
                    bootstrap_identity: invalidIdentity,
                }],
            }),
        }));
        await page.route(`**/api/lumps/${STUB_TOKEN}/words/1**`, route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ...STUB_WORDS_V1,
                token: legacyToken,
                bootstrap_identity: invalidIdentity,
            }),
        }));
        await page.route(`**/api/lump/${STUB_TOKEN}/words`, route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(STUB_WORDS_CURRENT),
        }));
        let deleteRequest = null;
        await page.route(`**/api/lumps/${STUB_TOKEN}/history/1`, async route => {
            deleteRequest = route.request();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    token: STUB_TOKEN,
                    version: 1,
                    deleted: ['CapabilityTest_legacy.lump'],
                }),
            });
        });

        await openLumpDetail(page);
        await clickHistoryTab(page);
        const row = page.locator(`#lumpHistoryBody_${STUB_TK} tr.lump-history-row`).first();
        await expect(row.getByRole('button', { name: 'Preview' })).toBeVisible();
        await expect(row.getByRole('button', { name: 'Delete' })).toBeVisible();
        await expect(row.locator('button.lump-history-restore-btn')).toHaveCount(0);
        await row.getByRole('button', { name: 'Preview' }).click();
        const preview = await waitForHexTable(page);
        const repair = preview.locator('.lump-bootstrap-repair');
        await expect(repair).toContainText('Specification corrections required');
        await expect(repair.locator('.lump-bootstrap-repair-checkbox')).toHaveCount(2);
        const confirmButton = repair.locator('.lump-bootstrap-repair-confirm');
        await expect(confirmButton).toBeDisabled();
        await repair.locator('.lump-bootstrap-repair-checkbox').first().check();
        await expect(confirmButton).toBeDisabled();
        await repair.locator('.lump-bootstrap-repair-checkbox').nth(1).check();
        await expect(confirmButton).toBeEnabled();

        await page.locator('#lumpHistoryPreviewModal .lump-history-preview-close').click();
        page.once('dialog', dialog => dialog.accept());
        await row.getByRole('button', { name: 'Delete' }).click();
        await expect.poll(() => deleteRequest && deleteRequest.method()).toBe('DELETE');
        expect(JSON.parse(deleteRequest.postData()).archive_filename).toBe('CapabilityTest_legacy.lump');
    });
});

test.describe('LUMP History tab — approved bootstrap corrections', () => {
    const legacyToken = 'b6182a95';
    const invalidIdentity = {
        applies: true,
        valid: false,
        record_token: legacyToken,
        row0_gt: '4a000006',
        expected_gt: '4a00000a',
    };

    async function stubRepairableHistory(page) {
        let repaired = false;
        await page.route('**/api/lumps/list', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([STUB_LUMP]),
        }));
        await page.route(`**/api/lumps/${STUB_TOKEN}/history`, route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                token: STUB_TOKEN,
                history: repaired ? [{
                    ...STUB_HISTORY_V1,
                    version: 3,
                    current: true,
                    binary_hash: 'f'.repeat(64),
                    binary_valid: true,
                    preview_enabled: false,
                    restore_enabled: false,
                }] : [{
                    ...STUB_HISTORY_V1,
                    historical_record: true,
                    record_token: legacyToken,
                    preview_enabled: true,
                    restore_enabled: false,
                    binary_valid: false,
                    archive_filename: 'CapabilityTest_legacy.lump',
                    record_filename: 'CapabilityTest_legacy.lump',
                    legacy_incompatible: true,
                    bootstrap_identity: invalidIdentity,
                }],
            }),
        }));
        await page.route(`**/api/lumps/${STUB_TOKEN}/words/1**`, route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ...STUB_WORDS_V1,
                token: legacyToken,
                bootstrap_identity: invalidIdentity,
            }),
        }));
        await page.route(`**/api/lump/${STUB_TOKEN}/words`, route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(STUB_WORDS_CURRENT),
        }));
        return {
            markRepaired: () => { repaired = true; },
        };
    }

    test('applies every approved correction through plan, intent, and repair then refreshes History', async ({ page }) => {
        test.setTimeout(40000);
        const state = await stubRepairableHistory(page);
        let planRequest = null;
        let approvalRequest = null;
        let repairRequest = null;
        await page.route(`**/api/lumps/${STUB_TOKEN}/history/1/bootstrap-repair-plan`, async route => {
            planRequest = route.request();
            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify({
                    plan_id: 'repair-plan-1',
                    digest: 'd'.repeat(64),
                    action: 'save',
                    namespace_slot: 2,
                    namespace_sequence: 0,
                    destination_token: '4a000002',
                    corrections: [
                        { id: 'repair-sealed-row-zero-gt' },
                        { id: 'issue-canonical-bootstrap-identity' },
                    ],
                    consequence: 'A new compliant live revision will be saved.',
                }),
            });
        });
        await page.route('**/api/lumps/approval-intent', async route => {
            approvalRequest = route.request();
            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify({ intent: 'repair-intent-1' }),
            });
        });
        await page.route(`**/api/lumps/${STUB_TOKEN}/history/1/bootstrap-repair`, async route => {
            repairRequest = route.request();
            state.markRepaired();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    lump_version: 3,
                    namespace_slot: 2,
                    namespace_sequence: 0,
                    destination_token: '4a000002',
                }),
            });
        });

        await openLumpDetail(page);
        await clickHistoryTab(page);
        await page.locator(`#lumpHistoryBody_${STUB_TK} button`, { hasText: 'Preview' }).click();
        const repair = page.locator('#lumpHistoryPreviewModal .lump-bootstrap-repair');
        await repair.locator('.lump-bootstrap-repair-checkbox').nth(0).check();
        await repair.locator('.lump-bootstrap-repair-checkbox').nth(1).check();
        const confirmButton = repair.locator('.lump-bootstrap-repair-confirm');
        await expect(confirmButton).toHaveText('Confirm 2 approved corrections');
        page.once('dialog', dialog => dialog.accept());
        await confirmButton.click();

        await expect.poll(() => repairRequest && repairRequest.method()).toBe('POST');
        expect(JSON.parse(planRequest.postData())).toEqual({
            archive_filename: 'CapabilityTest_legacy.lump',
        });
        expect(JSON.parse(approvalRequest.postData())).toMatchObject({
            digest: 'd'.repeat(64),
            action: 'save',
            plan_id: 'repair-plan-1',
            confirmation: true,
        });
        expect(JSON.parse(repairRequest.postData())).toMatchObject({
            archive_filename: 'CapabilityTest_legacy.lump',
            plan_id: 'repair-plan-1',
            approval_intent: 'repair-intent-1',
            corrections: [
                'repair-sealed-row-zero-gt',
                'issue-canonical-bootstrap-identity',
            ],
        });
        const toast = page.locator('#fpgaToastEl');
        await expect(toast).toBeVisible();
        await expect(toast.locator('.fpga-toast-title')).toHaveText('Corrections applied');
        await expect(toast.locator('.fpga-toast-body')).toContainText(
            'Namespace slot 2'
        );
        await expect(page.locator('#lumpHistoryPreviewModal')).toHaveCount(0);

        await clickHistoryTab(page);
        const refreshed = page.locator(`#lumpHistoryBody_${STUB_TK}`);
        const currentRow = refreshed.locator('tr.lump-history-row[data-version="3"]');
        await expect(currentRow.getByRole('checkbox', {
            name: 'v3 is the current LUMP',
        })).toBeChecked();
    });

    test('cancelling confirmation keeps the archive untouched and sends no approval or repair request', async ({ page }) => {
        test.setTimeout(40000);
        await stubRepairableHistory(page);
        let approvalRequests = 0;
        let repairRequests = 0;
        await page.route(`**/api/lumps/${STUB_TOKEN}/history/1/bootstrap-repair-plan`, route => route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                plan_id: 'repair-plan-cancel',
                digest: 'c'.repeat(64),
                action: 'replace',
                corrections: [
                    { id: 'repair-sealed-row-zero-gt' },
                    { id: 'issue-canonical-bootstrap-identity' },
                ],
            }),
        }));
        await page.route('**/api/lumps/approval-intent', route => {
            approvalRequests += 1;
            return route.abort();
        });
        await page.route(`**/api/lumps/${STUB_TOKEN}/history/1/bootstrap-repair`, route => {
            repairRequests += 1;
            return route.abort();
        });

        await openLumpDetail(page);
        await clickHistoryTab(page);
        await page.locator(`#lumpHistoryBody_${STUB_TK} button`, { hasText: 'Preview' }).click();
        const repair = page.locator('#lumpHistoryPreviewModal .lump-bootstrap-repair');
        await repair.locator('.lump-bootstrap-repair-checkbox').nth(0).check();
        await repair.locator('.lump-bootstrap-repair-checkbox').nth(1).check();
        page.once('dialog', dialog => dialog.dismiss());
        await repair.locator('.lump-bootstrap-repair-confirm').click();

        await expect(repair.locator('.lump-bootstrap-repair-status')).toContainText(
            'No data was changed. Corrections were not confirmed.'
        );
        expect(approvalRequests).toBe(0);
        expect(repairRequests).toBe(0);
        await expect(page.locator(`#lumpHistoryBody_${STUB_TK} tr.lump-history-row`)).toHaveCount(1);
    });
});

test.describe('LUMP History tab — inspectable invalid and binary-only archives', () => {
    async function stubHistoryWithArchive(page, archivePayload, historyOverrides = {}) {
        await page.route('**/api/lumps/list', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([STUB_LUMP]),
        }));
        await page.route(`**/api/lumps/${STUB_TOKEN}/history`, route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                token: STUB_TOKEN,
                history: [{
                    ...STUB_HISTORY_V1,
                    ...historyOverrides,
                }],
            }),
        }));
        await page.route(`**/api/lumps/${STUB_TOKEN}/words/1**`, route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(archivePayload),
        }));
        await page.route(`**/api/lump/${STUB_TOKEN}/words`, route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(STUB_WORDS_CURRENT),
        }));
    }

    test('invalid but word-readable archive renders hex and stays read only', async ({ page }) => {
        test.setTimeout(40000);
        await stubHistoryWithArchive(page, {
            ...STUB_WORDS_V1,
            binary_valid: false,
            validation_errors: ['invalid header magic 0x02'],
            source: '',
        }, {
            binary_hash: 'c'.repeat(64),
            binary_valid: false,
            preview_enabled: true,
            restore_enabled: false,
            validation_errors: ['invalid header magic 0x02'],
        });

        await openLumpDetail(page);
        await clickHistoryTab(page);
        const row = page.locator(`#lumpHistoryBody_${STUB_TK} tr.lump-history-row`).first();
        await expect(row.getByRole('button', { name: 'Preview' })).toBeVisible();
        await expect(row.getByRole('button', { name: 'Delete' })).toBeVisible();
        await row.getByRole('button', { name: 'Preview' }).click();

        const preview = await waitForHexTable(page);
        await expect(preview).not.toContainText('Validation prevents it from becoming live');
        await expect(preview.locator('.lump-history-source-section')).toContainText(
            'No source is embedded'
        );
        await expect(preview.locator('table.lump-hex-table')).toBeVisible();
        await expect(row.locator('button.lump-history-restore-btn')).toHaveCount(0);
    });

    test('standard filename bootstrap archive leads with complete issues and provenance', async ({ page }) => {
        test.setTimeout(40000);
        const invalidIdentity = {
            applies: true,
            valid: false,
            record_token: '4a00000a',
            row0_gt: '4a000006',
            active_namespace_gt: '4a00000a',
            expected_gt: '4a00000a',
            errors: [
                'sealed row-zero GT 0x4a000006 != expected GT 0x4a00000a',
            ],
        };
        await stubHistoryWithArchive(page, {
            ...STUB_WORDS_V1,
            binary_valid: false,
            validation_errors: [
                'bootstrap T-equals-GT validation failed',
            ],
            bootstrap_identity: invalidIdentity,
            source: '',
            archive_provenance: {
                kind: 'standard-filename-pattern',
                filename: 'CapabilityTest_v23.lump',
                description: "This archive was discovered from the active LUMP's standard filename pattern; it has no separate archived manifest row.",
                correction_supported: true,
            },
            preview_issues: [
                { kind: 'validation', message: 'bootstrap T-equals-GT validation failed' },
                { kind: 'bootstrap-identity', message: 'Bootstrap identity is inconsistent.' },
                { kind: 'bootstrap-identity-detail', message: 'sealed row-zero GT 0x4a000006 != expected GT 0x4a00000a' },
                { kind: 'activation', message: 'Direct History activation is disabled because the revision is not a valid live candidate.' },
            ],
        }, {
            archive_filename: 'CapabilityTest_v23.lump',
            record_filename: 'CapabilityTest_v23.lump',
            historical_record: false,
            binary_valid: false,
            preview_enabled: true,
            restore_enabled: false,
            bootstrap_identity: invalidIdentity,
            archive_provenance: {
                kind: 'standard-filename-pattern',
                filename: 'CapabilityTest_v23.lump',
                description: "This archive was discovered from the active LUMP's standard filename pattern; it has no separate archived manifest row.",
                correction_supported: true,
            },
            preview_issues: [
                { kind: 'validation', message: 'bootstrap T-equals-GT validation failed' },
                { kind: 'bootstrap-identity', message: 'Bootstrap identity is inconsistent.' },
                { kind: 'bootstrap-identity-detail', message: 'sealed row-zero GT 0x4a000006 != expected GT 0x4a00000a' },
                { kind: 'activation', message: 'Direct History activation is disabled because the revision is not a valid live candidate.' },
            ],
        });

        await openLumpDetail(page);
        await clickHistoryTab(page);
        const row = page.locator(`#lumpHistoryBody_${STUB_TK} tr.lump-history-row`).first();
        await row.getByRole('button', { name: 'Preview' }).click();
        const preview = await waitForHexTable(page);
        const issues = preview.locator('.lump-history-issues');
        await expect(issues).toContainText('Issues / Why this cannot be set');
        await expect(issues).toContainText('Sealed row-zero GT: 0x4A000006');
        await expect(issues).toContainText('Active Namespace GT: 0x4A00000A');
        await expect(issues).toContainText('Record Token: 0x4A00000A');
        await expect(issues).toContainText('Bootstrap identity is inconsistent');
        await expect(issues).toContainText(
            'Direct History activation is disabled because the revision is not a valid live candidate.'
        );
        await expect(issues).toContainText('CapabilityTest_v23.lump');
        await expect(issues).toContainText('correction path supports this archive');
        await expect(preview.locator('.lump-bootstrap-repair')).toBeVisible();
        await expect(preview.locator('table.lump-hex-table')).toBeVisible();

        const order = await preview.evaluate(container =>
            Array.from(container.children).map(child => child.className)
        );
        expect(order.indexOf('lump-history-issues')).toBeGreaterThanOrEqual(0);
        expect(order.indexOf('lump-history-issues'))
            .toBeLessThan(order.findIndex(name => name.includes('lump-history-source-section')));
        expect(order.indexOf('lump-history-issues'))
            .toBeLessThan(order.findIndex(name => name.includes('lump-detail-section')));
    });

    test('binary-only archive explicitly explains that source is not embedded', async ({ page }) => {
        test.setTimeout(40000);
        await stubHistoryWithArchive(page, {
            ...STUB_WORDS_V1,
            source: '',
        });

        await openLumpDetail(page);
        await clickHistoryTab(page);
        const row = page.locator(`#lumpHistoryBody_${STUB_TK} tr.lump-history-row`).first();
        await row.getByRole('button', { name: 'Preview' }).click();

        const preview = await waitForHexTable(page);
        await expect(preview.locator('.lump-history-source-section')).toContainText(
            'No source is embedded in this archived revision.'
        );
        await expect(preview.locator('table.lump-hex-table')).toBeVisible();
    });

    test('keeps separate preview rows when multiple immutable archives share a version', async ({ page }) => {
        test.setTimeout(40000);
        await page.route('**/api/lumps/list', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([STUB_LUMP]),
        }));
        await page.route(`**/api/lumps/${STUB_TOKEN}/history`, route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                token: STUB_TOKEN,
                history: [
                    {
                        ...STUB_HISTORY_V1,
                        historical_record: true,
                        record_token: '11111111',
                        archive_filename: 'TestAbs.one.lump',
                        record_filename: 'TestAbs.one.lump',
                    },
                    {
                        ...STUB_HISTORY_V1,
                        historical_record: true,
                        record_token: '22222222',
                        archive_filename: 'TestAbs.two.lump',
                        record_filename: 'TestAbs.two.lump',
                    },
                ],
            }),
        }));
        await page.route(`**/api/lumps/${STUB_TOKEN}/words/1**`, route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(STUB_WORDS_V1),
        }));
        await page.route(`**/api/lump/${STUB_TOKEN}/words`, route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(STUB_WORDS_CURRENT),
        }));

        await openLumpDetail(page);
        await clickHistoryTab(page);
        const rows = page.locator(`#lumpHistoryBody_${STUB_TK} tr.lump-history-row`);
        await expect(rows).toHaveCount(2);
        await expect(rows.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — Row onclick (_lumpHistorySelectRow) also triggers the hex preview
// ─────────────────────────────────────────────────────────────────────────────
//
// Clicking anywhere on a history row (not on a button) calls
// _lumpHistorySelectRow, which in turn calls _lumpHistoryPreview.
// The resulting hex dump must be identical to the button-triggered path.

test.describe('LUMP History tab — row onclick triggers hex preview', () => {

    test('clicking a history row directly renders the hex dump table', async ({ page }) => {
        test.setTimeout(40000);

        await stubPreviewRoutes(page);
        await openLumpDetail(page);
        await clickHistoryTab(page);

        const histBody = page.locator(`#lumpHistoryBody_${STUB_TK}`);
        const row = histBody.locator('tr.lump-history-row').first();
        await expect(row).toBeVisible({ timeout: 8000 });

        // Click the version cell (first <td>) to avoid hitting a button.
        await row.locator('td').first().click();

        // The hex table must appear in the History preview popup.
        const previewDiv = page.locator('#lumpHistoryPreviewModal .lump-history-preview-body');
        await expect(previewDiv.locator('table.lump-hex-table')).toBeVisible({ timeout: 10000 });

        // Address column for offset 0x000000 must be present.
        await expect(
            previewDiv.locator('table.lump-hex-table td.lump-hex-addr').first()
        ).toHaveText('0x000000');
    });

    test('clicking a history row directly adds the lump-hex-hdr-row highlight class', async ({ page }) => {
        test.setTimeout(40000);

        await stubPreviewRoutes(page);
        await openLumpDetail(page);
        await clickHistoryTab(page);

        const histBody = page.locator(`#lumpHistoryBody_${STUB_TK}`);
        const row = histBody.locator('tr.lump-history-row').first();
        await expect(row).toBeVisible({ timeout: 8000 });

        await row.locator('td').first().click();

        // _lumpHistorySelectRow adds class lump-hex-hdr-row to the clicked row.
        await expect(row).toHaveClass(/lump-hex-hdr-row/, { timeout: 5000 });
    });

});

test.describe('LUMP History tab — current provenance and unobserved health', () => {
    test('current row shows validated structure and never calls zero observations Stable', async ({ page }) => {
        test.setTimeout(40000);
        await page.route('**/api/lumps/list', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([{ ...STUB_LUMP, lump_version: 10 }]),
            });
        });
        await page.route(`**/api/lumps/${STUB_TOKEN}/history`, async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    token: STUB_TOKEN,
                    missing_versions: [3],
                    history: [
                        {
                            version: 10,
                            current: true,
                            compiled_at: COMPILED_AT,
                            cw: 21,
                            cc: 5,
                            lump_size: 512,
                            binary_hash: 'a'.repeat(64),
                            binary_valid: true,
                            preview_enabled: false,
                            restore_enabled: false,
                        },
                        {
                            version: 9,
                            current: false,
                            compiled_at: COMPILED_AT - 3600,
                            cw: 19,
                            cc: 4,
                            lump_size: 128,
                            binary_hash: 'b'.repeat(64),
                            binary_valid: true,
                            preview_enabled: true,
                            restore_enabled: true,
                        },
                    ],
                }),
            });
        });
        await page.route('**/api/lump/version-telemetry/TestAbs', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    versions: [
                        {
                            lump_token: STUB_TOKEN,
                            lump_version: 10,
                            device_count: 0,
                            total_faults: 0,
                            total_steps: 0,
                            fault_rate_per_1000: 0,
                            observed: false,
                            stable_status: 'unknown',
                        },
                        {
                            lump_token: STUB_TOKEN,
                            lump_version: 9,
                            device_count: 2,
                            total_faults: 0,
                            total_steps: 1000,
                            fault_rate_per_1000: 0,
                            observed: true,
                            stable_status: 'stable',
                        },
                    ],
                }),
            });
        });

        await openLumpDetail(page);
        await clickHistoryTab(page);

        const body = page.locator(`#lumpHistoryBody_${STUB_TK}`);
        const row = body.locator('tr.lump-history-row[data-version="10"]');
        await expect(row).toContainText('21');
        await expect(row).toContainText('5');
        await expect(row).toContainText('512w');
        await expect(row).toContainText('Not observed');
        await expect(row).toContainText('Unknown');
        await expect(row).not.toContainText('Stable');
        await expect(row.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
        await expect(row.getByRole('checkbox', {
            name: 'v10 is the current LUMP',
        })).toBeChecked();
        const archivedRow = body.locator('tr.lump-history-row[data-version="9"]');
        await expect(archivedRow).not.toContainText('(this)');
        await expect(archivedRow.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
        await expect(archivedRow.getByRole('checkbox', {
            name: 'Make v9 the current LUMP',
        })).toBeEnabled();
        await expect(body.locator('.lump-history-provenance-note')).toContainText('v3');
    });
});
