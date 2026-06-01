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
        { version: 2, lump_size: 64, cw: 10, cc: 2, compiled_at: COMPILED_AT + 3600, abstraction: 'TestAbs' },
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
};

// Response for GET /api/lump/<token>/words — current (live) version, 64 words.
// Note the singular "lump" path used by _lumpHistoryPreview for the diff fetch.
const CURRENT_WORDS = makeWords(64);
const STUB_WORDS_CURRENT = {
    token:  STUB_TOKEN,
    words:  CURRENT_WORDS,
    count:  CURRENT_WORDS.length,
};

// ─────────────────────────────────────────────────────────────────────────────
// Navigation helpers
// ─────────────────────────────────────────────────────────────────────────────

// Navigates to the Lumps view and opens the detail panel for STUB_TOKEN.
// Callers must already have set up the /api/lumps/list route interceptor.
async function openLumpDetail(page) {
    await page.goto('/simulator/');
    await page.waitForLoadState('networkidle');
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

        // The timestamp cell (second column, index 1) — fmtDate renders as
        // "<day> <MonthAbbr> <year> HH:MM".  The epoch 1716206400 is
        // 2024-05-20 12:00 UTC; noon UTC stays on May 20 across all ±12
        // timezones, so "May" and "2024" must both appear in the cell text.
        const tsCell = row.locator('td').nth(1);
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

        // CW column (index 2).
        await expect(row.locator('td').nth(2)).toHaveText('10');
        // CC column (index 3).
        await expect(row.locator('td').nth(3)).toHaveText('2');
        // Size column (index 4) — rendered as "<n>w".
        await expect(row.locator('td').nth(4)).toHaveText('32w');
    });

    test('history row has a Restore button', async ({ page }) => {
        test.setTimeout(40000);
        await openLumpDetail(page);
        await clickHistoryTab(page);

        const histBody = page.locator(`#lumpHistoryBody_${STUB_TK}`);
        const row = histBody.locator('tr.lump-history-row').first();
        await expect(row).toBeVisible({ timeout: 8000 });

        const restoreBtn = row.locator('button.lump-history-restore-btn');
        await expect(restoreBtn).toBeVisible();
        // Restore is disabled until a Preview has been loaded for that row.
        await expect(restoreBtn).toBeDisabled();
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — save via UI then browse: clicking Restore saves and History updates
// ─────────────────────────────────────────────────────────────────────────────
//
// The Restore button is the UI control users click to trigger a LUMP save
// (_restoreLumpFromHistory → POST /api/lumps/save).  After the save lands,
// _restoreLumpFromHistory deletes _lumpHistoryLoaded[tk].  Re-clicking the
// History tab then re-fetches, and the updated endpoint returns a second
// archived version — confirming the save was seen by the history view.

test.describe('LUMP History tab — save via UI then browse', () => {

    test('after Restore-triggered save, re-opening History shows a new archived version', async ({ page }) => {
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

        // Click Preview to load the hex dump — this enables the Restore button.
        await histBody.locator('button[title^="Preview hex dump"]').first().click();
        await waitForHexTable(page);

        // Click the Restore button — this is the UI-level save action.
        // _restoreLumpFromHistory fetches the archived binary, POSTs it to
        // /api/lumps/save, then clears _lumpHistoryLoaded[tk] so the next
        // History tab click will re-fetch.
        await histBody.locator('button.lump-history-restore-btn').first().click();

        // Wait for the save POST to complete.
        await page.waitForResponse(
            resp => resp.url().includes('/api/lumps/save') && resp.request().method() === 'POST',
            { timeout: 10000 }
        );

        // Re-click the History tab.  Because _lumpHistoryLoaded[tk] was
        // cleared, _switchLumpTab will call _fetchAndShowLumpHistory again,
        // triggering the second /api/lumps/<token>/history request.
        const tabBar = page.locator(`#lumpTabBar_${STUB_TK}`);
        await tabBar.locator('button.lump-tab', { hasText: 'History' }).click();
        await expect(histBody.locator('text=Loading history')).toHaveCount(0, { timeout: 8000 });

        // After save: 2 history rows — v2 (created by restore save) and v1.
        await expect(histBody.locator('tr.lump-history-row')).toHaveCount(2, { timeout: 8000 });
        await expect(histBody.locator('tr.lump-history-row').first().locator('td strong')).toHaveText('v2');
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Restore fires /api/lumps/save and the word-count chip reverts
// ─────────────────────────────────────────────────────────────────────────────

test.describe('LUMP History tab — Restore fires /api/lumps/save', () => {

    test('clicking Restore POSTs the archived binary and the size chip reverts to 32w', async ({ page }) => {
        test.setTimeout(40000);

        let capturedSaveBody = null;
        let listCallCount    = 0;

        // First /api/lumps/list call serves the current 64-word lump.
        // Subsequent calls (after restore triggers renderLumps) serve the
        // reverted 32-word lump so the header strip can be asserted.
        await page.route('**/api/lumps/list', async route => {
            listCallCount++;
            const lump = listCallCount === 1
                ? STUB_LUMP                                         // 64w before restore
                : { ...STUB_LUMP, lump_size: 32 };                 // 32w after restore
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
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_WORDS_CURRENT),
            });
        });
        await page.route('**/api/lumps/save', async route => {
            capturedSaveBody = JSON.parse(route.request().postData() || '{}');
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

        // Click Preview to load the hex dump — this enables the Restore button.
        await row.locator('button[title^="Preview hex dump"]').click();
        await waitForHexTable(page);

        // Click Restore.
        await row.locator('button.lump-history-restore-btn').click();

        // Wait for the POST to /api/lumps/save to complete.
        await page.waitForResponse(
            resp => resp.url().includes('/api/lumps/save') && resp.request().method() === 'POST',
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

        // ── Assert 3: lump header strip reverts to 32w after re-render ─────
        // Force a renderLumps() pass so the header strip reads the updated
        // lump_size: 32 from the second /api/lumps/list call.
        await page.evaluate((token) => {
            if (typeof renderLumps === 'function') {
                return renderLumps().then(() => showLumpDetail(token));
            }
        }, STUB_TOKEN);

        // The Size chip in the lump header strip must now read "32w".
        const sizeChip = page.locator(
            `.lump-header-strip .lump-hs-chip:has(.lump-hs-label:text("Size"))`
        );
        await expect(sizeChip).toContainText('32w', { timeout: 8000 });
    });

    test('clicking Restore with dialog dismissed does not fire /api/lumps/save', async ({ page }) => {
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

        // Click Preview to enable the Restore button, then click Restore (dialog dismissed).
        await row.locator('button[title^="Preview hex dump"]').click();
        await waitForHexTable(page);

        await row.locator('button.lump-history-restore-btn').click();

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

// Waits until the hex preview div contains a rendered lump-hex-table.
async function waitForHexTable(page) {
    const previewDiv = page.locator(`#lumpHistoryHexPreview_${STUB_TK}`);
    await expect(previewDiv.locator('table.lump-hex-table')).toBeVisible({ timeout: 10000 });
    return previewDiv;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Preview button fetches archived binary and renders hex dump table
// ─────────────────────────────────────────────────────────────────────────────
//
// Clicking the "Preview" button on a history row calls _lumpHistoryPreview,
// which fetches /api/lumps/<token>/words/<version> (archived binary) and
// /api/lump/<token>/words (current binary for diff), then renders a
// lump-hex-table inside #lumpHistoryHexPreview_<tk>.

test.describe('LUMP History tab — Preview button renders hex dump', () => {

    test('clicking Preview button fetches /api/lumps/<token>/words/1 and renders lump-hex-table', async ({ page }) => {
        test.setTimeout(40000);

        await stubPreviewRoutes(page);
        await openLumpDetail(page);
        await clickHistoryTab(page);

        const histBody = page.locator(`#lumpHistoryBody_${STUB_TK}`);
        const row = histBody.locator('tr.lump-history-row').first();
        await expect(row).toBeVisible({ timeout: 8000 });

        // Click the Preview button — stopPropagation means only _lumpHistoryPreview fires.
        const previewBtn = row.locator('button[title^="Preview hex dump"]');
        await expect(previewBtn).toBeVisible();
        await previewBtn.click();

        // The hex table must appear inside the preview div.
        const previewDiv = await waitForHexTable(page);
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

        await row.locator('button[title^="Preview hex dump"]').click();

        const previewDiv = await waitForHexTable(page);
        const hexTable = previewDiv.locator('table.lump-hex-table');

        // ARCHIVED_WORDS is 32 words, 8 columns → ceil(32/8) = 4 data rows.
        // Each data row has class lump-hex-hdr-row, lump-hex-clist-row,
        // lump-hex-pad-row, or no class — they are all <tr> inside <tbody>.
        const dataRows = hexTable.locator('tbody tr');
        await expect(dataRows).toHaveCount(4);

        // The diff summary section must also be present (changed or identical).
        await expect(previewDiv.locator('.lump-detail-section')).toBeVisible();
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

        // The hex table must appear in the preview div.
        const previewDiv = page.locator(`#lumpHistoryHexPreview_${STUB_TK}`);
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
