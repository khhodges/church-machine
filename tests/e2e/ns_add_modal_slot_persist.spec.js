'use strict';

// ns_add_modal_slot_persist.spec.js
//
// Verifies that the ADD modal (#_nsAddModalOverlay) pre-populates
// #_nsSlotPolicy and #_nsSlotInput from the persisted sidecar / in-memory
// cache after:
//   (a) same-session re-open — _nsPersistedSlotMeta must override a /detail
//       response that still returns null values (proving the cache path, not
//       the server-fetch path)
//   (b) page reload re-open — _nsPersistedSlotMeta is gone; the modal must
//       read ns_slot_policy / ns_slot from the fresh /api/lumps/<token>/detail
//       response (which now reflects the PATCH fired by _nsTableAddConfirm)
//
// Two-phase detail response strategy keeps the two paths isolated:
//   Phase A (/detail returns BASE_DETAIL — null policy/slot) covers (a).
//   Phase B (/detail returns patched values) covers (b).
// A DOM regression in the `selected` attribute or `value` binding that is
// invisible to pure-JS unit tests would be caught here.
//
// All API calls are intercepted so the test is hermetic and does not depend
// on real lumps being present on the server.

const { test, expect } = require('@playwright/test');

// ── Constants ────────────────────────────────────────────────────────────────

// Slot well above the hardware catalog range (0-10) so it is always free.
const TARGET_SLOT   = 45;
const TARGET_POLICY = 'static';

const FAKE_TOKEN       = 'aabbccdd';
const FAKE_ABSTRACTION = 'TestLumpAddPersist';

// Minimal valid lump header word (parseLumpHeader: magic bits[31:27] === 0x1F):
//   bits[31:27] = 0x1F  (magic)
//   bits[26:23] = 0     (n_minus_6 => lumpSize = 64 words)
//   bits[22:10] = 4     (cw = 4 code words)
//   bits[ 9: 8] = 0     (typ = code)
//   bits[ 7: 0] = 0     (cc = 0 c-list entries)
// = (0x1F << 27) | (4 << 10) = 0xF8001000
const LUMP_HEADER_WORD = 0xF8001000;

// Full 64-word array (matches lumpSize = 64) for /api/lump/<token>/words.
const FAKE_WORDS = Array.from({ length: 64 }, (_, i) => (i === 0 ? LUMP_HEADER_WORD : 0));

// Base sidecar returned by /api/lumps/<token>/detail before any PATCH.
const BASE_DETAIL = {
    token:          FAKE_TOKEN,
    abstraction:    FAKE_ABSTRACTION,
    cw:             4,
    cc:             0,
    ns_slot_policy: null,
    ns_slot:        null,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Navigate to /simulator/ in cold-boot state:
 *   - /api/boot-image/binary => 404 so no boot binary is applied
 *   - localStorage ns/boot keys wiped; sim.reset() called
 */
async function loadColdBoot(page) {
    await page.route('**/api/boot-image/binary', route => route.fulfill({
        status:      404,
        contentType: 'text/plain',
        body:        'no boot image (test)',
    }));

    await page.addInitScript(() => {
        localStorage.setItem('church_whatsnew_dismissed_perm', '1');
    });

    await page.goto('/simulator/');

    // networkidle is unreliable (background polling); wait for concrete globals.
    await page.waitForFunction(
        () => typeof sim !== 'undefined' && typeof _nsTableAdd === 'function',
        { timeout: 20000 }
    );

    // Wipe session state that could restore extended NS slots.
    await page.evaluate(() => {
        for (const key of [...Object.keys(localStorage)]) {
            if (key.startsWith('church_ns') || key.startsWith('church_boot') || key === 'bootConfig') {
                localStorage.removeItem(key);
            }
        }
        window.bootImage          = null;
        window.bootImageAvailable = false;
        window.bootConfig         = null;
        if (typeof sim !== 'undefined') sim.reset();
    });

    await page.waitForTimeout(300);
}

/** Open the Namespace view via the hamburger menu and wait for the table. */
async function openNamespaceView(page) {
    const hamBtn = page.locator('#hamBtn');
    await hamBtn.waitFor({ state: 'visible' });
    await hamBtn.click();

    const nsBtn = page.locator('#hamItem-namespace');
    await nsBtn.waitFor({ state: 'visible' });
    await nsBtn.click();

    await page.locator('#namespaceTable').waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
}

/** Open the ADD modal via _nsTableAdd() and wait for the LUMP dropdown. */
async function openAddModal(page) {
    await page.evaluate(() => { _nsTableAdd(); });
    await page.locator('#_nsAddModalOverlay').waitFor({ state: 'visible' });
    await page.locator('#_nsAddSelect').waitFor({ state: 'visible', timeout: 10000 });
}

/** Wait for the metadata panel to finish loading (Install button enabled). */
async function waitForMetaReady(page) {
    await page.waitForFunction(() => {
        const btn = document.getElementById('_nsAddConfirmBtn');
        return btn && !btn.disabled;
    }, { timeout: 10000 });
}

/** Close the ADD modal without clicking Install. */
async function closeAddModal(page) {
    await page.evaluate(() => {
        const ov = document.getElementById('_nsAddModalOverlay');
        if (ov) ov.remove();
    });
}

// ── Test suite ───────────────────────────────────────────────────────────────

test.describe('ADD modal — slot/policy persists on re-open and after page reload', () => {

    test('pre-populates #_nsSlotPolicy and #_nsSlotInput after install (cache path) and after page reload (fresh-fetch path)', async ({ page }) => {
        test.setTimeout(90000);

        // ── Step 0: wire API interceptors ─────────────────────────────────────
        //
        // Two-phase /detail strategy keeps same-session and reload paths isolated:
        //
        //   Phase A (servePatched = false): /detail always returns BASE_DETAIL
        //   (null ns_slot_policy / ns_slot). The per-modal cache is cleared by
        //   _nsTableAdd() before re-open, so _nsPopulateAddMeta does a fresh fetch
        //   and gets null values. The DOM can only show the correct slot/policy if
        //   _nsSlotPolicyResolve overlays window._nsPersistedSlotMeta on top.
        //   This is the only guarantee that the in-memory cache path is exercised.
        //
        //   Phase B (servePatched = true): set just before page.reload(). /detail
        //   now returns BASE_DETAIL merged with the captured PATCH body. After
        //   reload _nsPersistedSlotMeta is gone, so the DOM must reflect the fresh
        //   /detail response — proving the server round-trip path.

        let capturedPatch = null;   // filled by PATCH interceptor; null until Install fires
        let servePatched  = false;  // toggled to true just before page.reload()

        await page.route('**/api/lumps/list', route => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([{
                token:       FAKE_TOKEN,
                abstraction: FAKE_ABSTRACTION,
                cw: 4, cc: 0,
            }]),
        }));

        // /detail: Phase A => BASE_DETAIL; Phase B => BASE_DETAIL + capturedPatch
        await page.route(`**/api/lumps/${FAKE_TOKEN}/detail`, route => {
            const payload = (servePatched && capturedPatch)
                ? Object.assign({}, BASE_DETAIL, capturedPatch)
                : Object.assign({}, BASE_DETAIL);
            route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) });
        });

        await page.route(`**/api/lump/${FAKE_TOKEN}/words`, route => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(FAKE_WORDS),
        }));

        // PATCH /meta: capture body for Phase B. Do NOT merge into /detail yet —
        // that would let Phase A pass even if _nsPersistedSlotMeta were absent.
        await page.route(`**/api/lump/${FAKE_TOKEN}/meta`, async route => {
            if (route.request().method() === 'PATCH') {
                try {
                    capturedPatch = JSON.parse(route.request().postData() || '{}');
                } catch (_) { /* ignore */ }
                await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
            } else {
                await route.continue();
            }
        });

        // Silence the slot-label POST (not relevant to this test).
        await page.route('**/api/boot-config/slot-label', route => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ ok: true }),
        }));

        // ── Step 1: cold boot + namespace view ────────────────────────────────
        await loadColdBoot(page);
        await openNamespaceView(page);

        // ── Step 2: open ADD modal; confirm fake LUMP appears ─────────────────
        await openAddModal(page);
        await waitForMetaReady(page);

        const selectedToken = await page.locator('#_nsAddSelect').inputValue();
        expect(selectedToken, 'ADD modal should list the fake LUMP').toBe(FAKE_TOKEN);

        // ── Step 3: set slot = TARGET_SLOT, policy = static ───────────────────
        await page.locator('#_nsSlotInput').fill(String(TARGET_SLOT));
        await page.locator('#_nsSlotPolicy').selectOption(TARGET_POLICY);

        // Sanity-check DOM before Install.
        expect(await page.locator('#_nsSlotPolicy').inputValue()).toBe(TARGET_POLICY);
        expect(await page.locator('#_nsSlotInput').inputValue()).toBe(String(TARGET_SLOT));

        // ── Step 4: Install ───────────────────────────────────────────────────
        await page.locator('#_nsAddConfirmBtn').click();
        await page.waitForTimeout(600); // allow Install + async PATCH to fire

        const overlayGone = await page.locator('#_nsAddModalOverlay').count();
        expect(overlayGone, 'ADD modal should close after successful Install').toBe(0);

        // Confirm PATCH was captured (needed for Phase B).
        expect(capturedPatch, 'PATCH body must have been captured by the interceptor').not.toBeNull();
        expect(capturedPatch.ns_slot_policy).toBe(TARGET_POLICY);
        expect(capturedPatch.ns_slot).toBe(TARGET_SLOT);

        // ── Step 5: same-session re-open (Phase A — cache path) ───────────────
        // Remove the token from _tokenSlotMap so it reappears in the LUMP list.
        // /detail still returns null values (servePatched is still false), so the
        // only source of correct slot/policy is window._nsPersistedSlotMeta.
        await page.evaluate((token) => {
            if (typeof sim !== 'undefined' && sim._tokenSlotMap) {
                sim._tokenSlotMap.delete(token);
            }
        }, FAKE_TOKEN);

        await openAddModal(page);
        await waitForMetaReady(page);

        // ── Step 6: assert pre-population from in-memory cache ────────────────
        const cachePolicyVal = await page.locator('#_nsSlotPolicy').inputValue();
        const cacheSlotVal   = await page.locator('#_nsSlotInput').inputValue();

        expect(
            cachePolicyVal,
            `[cache] #_nsSlotPolicy must be "${TARGET_POLICY}" (from _nsPersistedSlotMeta, not /detail)`
        ).toBe(TARGET_POLICY);

        expect(
            cacheSlotVal,
            `[cache] #_nsSlotInput must be "${TARGET_SLOT}" (from _nsPersistedSlotMeta, not /detail)`
        ).toBe(String(TARGET_SLOT));

        await closeAddModal(page);

        // ── Step 7: switch to Phase B, then reload ────────────────────────────
        // Now /detail returns BASE_DETAIL + capturedPatch. page.route() interceptors
        // survive page.reload() so all mocks remain active.
        servePatched = true;

        await page.reload();
        await page.waitForFunction(
            () => typeof sim !== 'undefined' && typeof _nsTableAdd === 'function',
            { timeout: 20000 }
        );
        await page.waitForTimeout(400);

        // _nsPersistedSlotMeta is in-memory only; it must be gone after reload.
        const persistedAfterReload = await page.evaluate(() =>
            Object.keys(window._nsPersistedSlotMeta || {})
        );
        expect(
            persistedAfterReload,
            'window._nsPersistedSlotMeta must be empty after page reload'
        ).toHaveLength(0);

        // ── Step 8: reload + open ADD modal (Phase B — fresh-fetch path) ──────
        await openNamespaceView(page);

        // _tokenSlotMap is fresh after reload; no need to delete the token.
        await openAddModal(page);
        await waitForMetaReady(page);

        // ── Step 9: assert pre-population from /detail fresh-fetch ───────────
        const freshPolicyVal = await page.locator('#_nsSlotPolicy').inputValue();
        const freshSlotVal   = await page.locator('#_nsSlotInput').inputValue();

        expect(
            freshPolicyVal,
            `[fresh-fetch] #_nsSlotPolicy must be "${TARGET_POLICY}" from /detail response`
        ).toBe(TARGET_POLICY);

        expect(
            freshSlotVal,
            `[fresh-fetch] #_nsSlotInput must be "${TARGET_SLOT}" from /detail response`
        ).toBe(String(TARGET_SLOT));
    });

});
