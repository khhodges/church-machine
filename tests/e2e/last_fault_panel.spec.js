'use strict';

// last_fault_panel.spec.js — Playwright E2E test for the Last Fault panel flow
//
// The fault snapshot flow has three moving parts that must all work together:
//
//   1. Emit  — simulator calls _onSimFaultSnapshot(snap) after a fault + reboot
//   2. POST  — _onSimFaultSnapshot() sends the snapshot to POST /api/fault-snapshot
//   3. GET   — after boot completes, _fetchAndShowLastFaultPanel() fetches
//              GET /api/fault-snapshot and renders #last-fault-panel
//
// This test exercises the full chain:
//   a) Call _onSimFaultSnapshot() with a BOUNDS fault snapshot and assert that
//      #last-fault-panel appears immediately (emit + show path).
//   b) Hide the panel without clearing server state, then call
//      _fetchAndShowLastFaultPanel() to re-fetch from the server (GET path)
//      and assert the panel re-appears with the same content.
//
// A regression in any of the three segments (emit, POST, GET) causes at least
// one assertion to fail, making previously-silent regressions visible.
//
// Note: waitForLoadState('networkidle') is intentionally avoided here because
// the simulator's background Wukong-polling keeps the network permanently busy.
// Tests wait for concrete JS globals (_onSimFaultSnapshot defined) instead.

const { test, expect } = require('@playwright/test');

// ─── Stub fault snapshot ──────────────────────────────────────────────────────

const FAULT_CODE    = 3;          // BOUNDS fault code
const FAULT_MESSAGE = 'BOUNDS: out-of-range memory access (E2E test)';
const FAULT_NIA     = 0x00001234;
const FAULT_NIA_HEX = '0x00001234';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Wait until the simulator JS runtime and the Last Fault helpers are ready.
 * Must be called after page.goto() in every test.
 */
async function waitForSimReady(page) {
    await page.waitForFunction(
        () => typeof sim !== 'undefined'
           && sim !== null
           && typeof _onSimFaultSnapshot === 'function'
           && typeof _fetchAndShowLastFaultPanel === 'function',
        { timeout: 20000 }
    );
}

/**
 * Clear the server-side fault snapshot via DELETE so each test starts clean.
 * Done via fetch() inside the page context so it uses the same origin/port.
 */
async function clearServerSnapshot(page) {
    await page.evaluate(async () => {
        try {
            await fetch('/api/fault-snapshot', { method: 'DELETE' });
        } catch (_) {}
    });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe('Last Fault panel — emit → POST → GET round-trip', () => {

    test('panel appears after _onSimFaultSnapshot and survives a re-fetch from server', async ({ page }) => {
        test.setTimeout(60000);

        // Suppress the What's New modal so it doesn't obscure the panel.
        await page.addInitScript(() => {
            localStorage.setItem('church_whatsnew_dismissed_perm', '1');
        });

        await page.goto('/simulator/');
        await waitForSimReady(page);

        // Clear any stale server snapshot from a prior run.
        await clearServerSnapshot(page);

        // Switch to the editor view so #editorConsole (and its parent, which is
        // the panel's insertion point) is in the visible DOM.
        await page.evaluate(() => {
            if (typeof switchView === 'function') switchView('editor');
        });

        // ── Step 1: emit path ─────────────────────────────────────────────────
        // Call _onSimFaultSnapshot() with a synthetic BOUNDS fault snapshot.
        // This immediately calls _showLastFaultPanel() AND POSTs to the server.
        const emitOk = await page.evaluate(({ faultCode, faultMessage, faultNia }) => {
            // Reset dismiss state so the panel is not suppressed.
            if (typeof _lastFaultSnapshotDismissed !== 'undefined') {
                // eslint-disable-next-line no-global-assign
                _lastFaultSnapshotDismissed = false;
            }
            const snap = {
                fault_code:        faultCode,
                fault_message:     faultMessage,
                nia:               faultNia,
                pc:                faultNia,
                flags:             0,
                call_depth:        1,
                led_bits:          0,
                abstraction_label: 'SelfTest',
                abstraction_slot:  5,
                source:            'simulator',
                ts:                Date.now() / 1000,
                cr: Array.from({ length: 16 }, (_, i) =>
                    i === 0 ? [0x40000001, 0x00010000, 0x00020000] : [0, 0, 0]),
                dr: Array.from({ length: 16 }, (_, i) => i * 4),
            };
            _onSimFaultSnapshot(snap);
            return true;
        }, { faultCode: FAULT_CODE, faultMessage: FAULT_MESSAGE, faultNia: FAULT_NIA });

        expect(emitOk, '_onSimFaultSnapshot must be callable').toBe(true);

        // ── Assert: panel visible after emit ──────────────────────────────────
        const panel = page.locator('#last-fault-panel');
        await panel.waitFor({ state: 'attached', timeout: 5000 });
        await expect(panel).toBeVisible();

        // The fault message and key fields must appear inside the panel.
        await expect(panel).toContainText('BOUNDS');
        await expect(panel).toContainText(FAULT_NIA_HEX);
        await expect(panel).toContainText('SelfTest');

        // ── Step 2: server round-trip ─────────────────────────────────────────
        // Give the async POST to the server time to land, then hide the panel
        // WITHOUT clearing server state or setting the dismissed flag, so
        // _fetchAndShowLastFaultPanel() is not short-circuited.
        await page.waitForTimeout(600);

        const hideOk = await page.evaluate(() => {
            if (typeof _hideLastFaultPanel !== 'function') return false;
            // Pass false so server snapshot and dismiss flag are both preserved.
            _hideLastFaultPanel(false);
            return true;
        });
        expect(hideOk, '_hideLastFaultPanel must be defined').toBe(true);

        // Panel should be gone now.
        await panel.waitFor({ state: 'detached', timeout: 3000 });

        // Call the browser-GET path: fetch from server and re-render.
        const fetchOk = await page.evaluate(() => {
            if (typeof _fetchAndShowLastFaultPanel !== 'function') return false;
            _fetchAndShowLastFaultPanel();
            return true;
        });
        expect(fetchOk, '_fetchAndShowLastFaultPanel must be defined').toBe(true);

        // The panel must re-appear because the server still holds the snapshot.
        await panel.waitFor({ state: 'attached', timeout: 5000 });
        await expect(panel).toBeVisible();

        // Content check on the re-fetched panel.
        await expect(panel).toContainText('BOUNDS');
        await expect(panel).toContainText(FAULT_NIA_HEX);

        // Clean up server state after the test.
        await clearServerSnapshot(page);
    });

    test('#last-fault-panel is absent when no fault snapshot exists on the server', async ({ page }) => {
        test.setTimeout(40000);

        await page.addInitScript(() => {
            localStorage.setItem('church_whatsnew_dismissed_perm', '1');
        });

        // Intercept GET /api/fault-snapshot to return 404 so _fetchAndShowLastFaultPanel
        // finds nothing, regardless of any snapshot left by a prior test or run.
        await page.route('/api/fault-snapshot', async (route) => {
            if (route.request().method() === 'GET') {
                await route.fulfill({
                    status: 404,
                    contentType: 'application/json',
                    body: JSON.stringify({ ok: false, error: 'no fault snapshot' }),
                });
            } else {
                await route.continue();
            }
        });

        await page.goto('/simulator/');
        await waitForSimReady(page);

        // Call _fetchAndShowLastFaultPanel — server returns 404, so no panel
        // should appear.
        await page.evaluate(() => {
            if (typeof _fetchAndShowLastFaultPanel === 'function') {
                _fetchAndShowLastFaultPanel();
            }
        });

        // Give any async work time to settle.
        await page.waitForTimeout(800);

        const panel = page.locator('#last-fault-panel');
        await expect(panel).toHaveCount(0);
    });

});
