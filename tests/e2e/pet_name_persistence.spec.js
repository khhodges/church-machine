'use strict';

// pet_name_persistence.spec.js — Playwright E2E tests verifying that NS-slot
// pet names survive a full page reload and appear in each major IDE surface.
//
// Surfaces covered:
//   1. Namespace table  — #namespaceTable td.ns-label cells
//   2. Run listing (trace view) — #traceTableBody Description column
//   3. Fault trace (gate log / fault modal) — Location row in fault modal
//   4. Compile view — #editorConsole output
//
// Approach:
//   Rather than triggering full compilation or execution flows, the tests
//   inject state directly into the live JS runtime via page.evaluate() and
//   call the real persistence/rendering functions. This mirrors the pattern
//   used in fault_history_persistence.spec.js.
//
// Pet name persistence mechanisms:
//   • Catalog labels (Boot.NS, Boot.Thread, Navana, …) are re-applied on
//     every page load by _initNamespaceTable() — they are always present.
//   • User-assigned custom labels are persisted to localStorage under the
//     key 'church_namespace' via saveNamespaceState() and restored on load
//     by loadNamespaceState() (called from app-shell.js on startup).
//   • The fault log (including the _nsSnapshot.label pet name) is persisted
//     to 'cm_fault_log' via _saveFaultLog() and restored by _restoreFaultLog().

const { test, expect } = require('@playwright/test');

// ─── Shared constants ─────────────────────────────────────────────────────────

// 'Navana' is at NS slot 4 in the static abstraction catalog.
// It is a reliable anchor label that is always set by _initNamespaceTable().
const CATALOG_LABEL = 'Navana';

// A custom label injected into a free slot (slot 64 is above the catalog and
// pool range 50–63, and starts as empty/null after _initNamespaceTable).
// Slot 50 was previously used here but is now allocated to Scheduler.IRQ.Thread
// (task-1077) and Identity (catalog), so 64 is used instead.
const CUSTOM_LABEL    = 'TestPetLabel';
const CUSTOM_NS_SLOT  = 64;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Open the hamburger menu and click a named menu item.
 * @param {import('@playwright/test').Page} page
 * @param {string} itemId - element ID of the menu button (e.g. 'hamItem-namespace')
 */
async function openHamburgerItem(page, itemId) {
    const hamBtn = page.locator('#hamBtn');
    await hamBtn.waitFor({ state: 'visible' });
    await hamBtn.click();
    const item = page.locator(`#${itemId}`);
    await item.waitFor({ state: 'visible' });
    await item.click();
}

/**
 * Navigate to the namespace view and wait for the table to render.
 * The namespace view is rendered by updateNamespace() which populates
 * #namespaceTable.  We force a fresh render via evaluate so the table
 * is definitely up-to-date before assertions.
 */
async function openNamespaceView(page) {
    await openHamburgerItem(page, 'hamItem-namespace');
    await page.evaluate(() => { if (typeof updateNamespace === 'function') updateNamespace(); });
    await page.locator('#namespaceTable').waitFor({ state: 'visible' });
}

/**
 * Open the Gate Log dashboard tab and wait for it to become active.
 */
async function openGateLogTab(page) {
    // Gate Log was removed from the hamburger; navigate to Dashboard first
    // then click the Gate Log tab inside the dashboard panel.
    await openHamburgerItem(page, 'hamItem-dashboard');
    const gateLogTabBtn = page.locator('#dashTab-gatelog');
    await gateLogTabBtn.waitFor({ state: 'visible' });
    await gateLogTabBtn.click();
    const panel = page.locator('#dashPanel-gatelog');
    await expect(panel).toHaveClass(/\bactive\b/);
}

/**
 * Click the "Details" button in the Gate Log fault banner and wait for the
 * fault modal overlay to appear.
 */
async function openFaultModal(page) {
    const detailsBtn = page.locator('#gateLogContent .fault-gate-banner-open');
    await detailsBtn.waitFor({ state: 'visible' });
    await detailsBtn.click();
    await page.locator('#faultModalOverlay').waitFor({ state: 'visible' });
}

/**
 * Inject a synthetic fault into the live sim.faultLog and persist it via the
 * real _saveFaultLog() path.  Also triggers updateGateLog() + faultAlertOn()
 * so the gate log banner is immediately visible.
 *
 * The _nsSnapshot.label field carries the pet name displayed in the modal's
 * "Location" row.
 */
async function injectFaultWithPetName(page, label) {
    return page.evaluate((label) => {
        const fault = {
            type:          'CAP_EXPIRED',
            message:       'CAP_EXPIRED: capability has expired',
            pc:            0x0042,
            physicalPC:    0x0042,
            step:          7,
            faultStep:     7,
            _nsSnapshot:   { label, offset: 0, nsIdx: 4 },
            instrHistory:  [{ step: 7, physicalPC: 0x0042, raw: 0 }],
            crSnapshot:    [],
            drSnapshot:    [],
            flagsSnapshot: {},
        };
        sim.faultLog.push(fault);
        if (typeof _saveFaultLog === 'function')  _saveFaultLog();
        if (typeof updateGateLog  === 'function')  updateGateLog();
        if (typeof faultAlertOn   === 'function')  faultAlertOn();
        return localStorage.getItem('cm_fault_log');
    }, label);
}

// ─── Suite 1: Namespace table ─────────────────────────────────────────────────

test.describe('pet names in namespace table survive page reload', () => {

    // ── Test 1a: catalog labels always appear ─────────────────────────────────
    //
    // The static abstraction catalog hard-codes well-known labels (Boot.NS,
    // Boot.Thread, Navana, Mint, …).  _initNamespaceTable() writes them into
    // sim.nsLabels on every page load, so they are always present regardless
    // of localStorage.

    test('catalog label "Navana" appears in namespace table before and after reload', async ({ page }) => {
        await page.goto('/simulator/');
        await page.waitForLoadState('networkidle');

        // ── Pre-reload ────────────────────────────────────────────────────────
        await openNamespaceView(page);

        const labelCells = page.locator('#namespaceTable td.ns-label');
        await expect(labelCells.filter({ hasText: CATALOG_LABEL })).toHaveCount(1);

        // ── Reload — no script injection; relies on _initNamespaceTable ───────
        await page.reload();
        await page.waitForLoadState('networkidle');

        // ── Post-reload ───────────────────────────────────────────────────────
        await openNamespaceView(page);

        const labelCellsAfter = page.locator('#namespaceTable td.ns-label');
        await expect(labelCellsAfter.filter({ hasText: CATALOG_LABEL })).toHaveCount(1);
    });

    // ── Test 1b: user-assigned custom label persists via saveNamespaceState ───
    //
    // A custom pet name is injected into an empty NS slot (above the catalog
    // range), then saveNamespaceState() writes it to localStorage.  After a
    // fresh page load, loadNamespaceState() (called from app-shell startup)
    // fills the slot back in — the label survives without any re-injection.

    test('custom pet name saved via saveNamespaceState survives page reload', async ({ page }) => {
        await page.goto('/simulator/');
        await page.waitForLoadState('networkidle');

        // ── Inject custom label into free slot and persist ────────────────────
        const savedJson = await page.evaluate(({ slot, label }) => {
            // Write a minimal valid NS entry for the free slot.
            const base = sim.NS_TABLE_BASE + slot * sim.NS_ENTRY_WORDS;
            // word0: non-zero location to make isNSEntryValid return true
            sim.memory[base + 0] = 0x00000100;
            // word1: minimal limit field (16-bit = 63 words, GT type 1 = Inform)
            sim.memory[base + 1] = (1 << 26) | 63; // gtType=1 in bits[27:26], limit=63
            sim.memory[base + 2] = 0;
            // Extend nsCount to include this slot.
            if (slot >= sim.nsCount) sim.nsCount = slot + 1;
            // Set the pet name label.
            sim.nsLabels[slot] = label;
            // Persist all namespace state (including our new slot) to localStorage.
            if (typeof saveNamespaceState === 'function') saveNamespaceState();
            // Render so the table is visible.
            if (typeof updateNamespace === 'function') updateNamespace();
            return localStorage.getItem('church_namespace');
        }, { slot: CUSTOM_NS_SLOT, label: CUSTOM_LABEL });

        // Guard: saveNamespaceState must have written the key before we reload.
        expect(savedJson).not.toBeNull();
        const saved = JSON.parse(savedJson);
        const savedEntry = saved[CUSTOM_NS_SLOT];
        expect(savedEntry).not.toBeNull();
        expect(savedEntry.label).toBe(CUSTOM_LABEL);

        // ── Navigate to namespace view and confirm label is visible ───────────
        await openNamespaceView(page);

        const customCell = page.locator('#namespaceTable td.ns-label');
        await expect(customCell.filter({ hasText: CUSTOM_LABEL })).toHaveCount(1);

        // ── Reload — no re-injection; only what saveNamespaceState wrote ──────
        await page.reload();
        await page.waitForLoadState('networkidle');

        // ── Post-reload: app startup restores the custom slot automatically ─────
        // app-shell.js calls loadNamespaceState() once at init (line ~409) and
        // again after sim.loadBootImage() resolves, so both the label and the
        // NS-entry memory words are in place by the time networkidle fires.
        // Read the live sim.nsLabels to confirm persistence — no workaround.
        const persistedLabel = await page.evaluate(({ slot }) => {
            return sim.nsLabels[slot];
        }, { slot: CUSTOM_NS_SLOT });
        expect(persistedLabel).toBe(CUSTOM_LABEL);

        await openNamespaceView(page);

        const customCellAfter = page.locator('#namespaceTable td.ns-label');
        await expect(customCellAfter.filter({ hasText: CUSTOM_LABEL })).toHaveCount(1);
    });

});

// ─── Suite 2: Run listing (trace view) ───────────────────────────────────────

test.describe('pet names in run listing (trace view) survive page reload', () => {

    // The trace view is an in-memory log (_traceData) that is not itself stored
    // in localStorage.  What persists across a reload is sim.nsLabels — so that
    // new trace entries produced after a reload still carry the correct pet name
    // in their Description cell.
    //
    // Test strategy:
    //   1. Read sim.nsLabels[4] (live state) — must equal CATALOG_LABEL.
    //   2. Inject a synthetic trace entry whose Description is built from the
    //      live sim.nsLabels value (not a hardcoded constant), then flush render.
    //   3. Verify the trace view shows the label.
    //   4. Reload the page.
    //   5. Read sim.nsLabels[4] again — must still equal CATALOG_LABEL, proving
    //      _initNamespaceTable() re-populates it on every load.
    //   6. Inject the same entry from the live label and verify it appears again.

    test('pet name appears in trace Description column before and after reload', async ({ page }) => {
        test.setTimeout(30000);
        await page.goto('/simulator/');
        await page.waitForLoadState('networkidle');

        // ── Find which NS slot holds CATALOG_LABEL and inject a trace entry ─────
        // We scan sim.nsLabels by value (not by a hardcoded index) so the test
        // remains correct even if the catalog order shifts between runs.  Finding
        // the slot itself proves the label is present in the live sim state.
        const CATALOG_SLOT = await page.evaluate((label) => {
            const nsLabels = sim.nsLabels;
            for (const k of Object.keys(nsLabels)) {
                if (nsLabels[k] === label) return parseInt(k, 10);
            }
            return -1;
        }, CATALOG_LABEL);
        expect(CATALOG_SLOT).toBeGreaterThanOrEqual(0);

        await page.evaluate((slot) => {
            const petName = sim.nsLabels[slot] || '';
            const entry = {
                step:       1,
                pc:         '0x0004',
                opName:     'ELOADCALL',
                cond:       'AL',
                dst:        '14',
                src:        '15',
                desc:       `NS[${slot}] \u2192 [${petName}]`,
                skipped:    false,
                dr:         new Array(16).fill(0),
                flags:      { N: false, Z: false, C: false, V: false },
                sto:        243,
                gateChecks: null,
            };
            // _traceData is module-level; push directly and flush render.
            _traceData.push(entry);
            _traceFlushRender();
        }, CATALOG_SLOT);

        // ── Switch to trace view ──────────────────────────────────────────────
        await openHamburgerItem(page, 'hamItem-trace');
        await page.locator('#traceTable').waitFor({ state: 'visible' });

        // Description is the 7th cell (0-indexed: 6) of each trace row.
        const descCell = page.locator('#traceTableBody tr').first().locator('td').nth(6);
        await descCell.waitFor({ state: 'visible' });
        await expect(descCell).toContainText(CATALOG_LABEL);

        // ── Reload ────────────────────────────────────────────────────────────
        await page.reload();
        await page.waitForLoadState('networkidle');
        // Wait until sim.nsLabels is populated (_initNamespaceTable runs during reset(),
        // long before bootComplete — this fires seconds earlier than waiting for bootComplete).
        await page.waitForFunction(() =>
            typeof sim !== 'undefined' && sim !== null &&
            typeof sim.nsLabels === 'object' && sim.nsLabels !== null &&
            Object.keys(sim.nsLabels).length > 0
        );

        // ── Post-reload: verify label persists in nsLabels AND appears in table ─
        // Read the live label from sim.nsLabels (not a constant) and inject a
        // new trace entry from it. If nsLabels was not re-initialised correctly,
        // the label would be empty and the table assertion below would fail.
        const labelAfterReload = await page.evaluate((slot) => {
            const petName = sim.nsLabels[slot] || '';
            if (petName) {
                const entry = {
                    step:       2,
                    pc:         '0x0004',
                    opName:     'ELOADCALL',
                    cond:       'AL',
                    dst:        '14',
                    src:        '15',
                    desc:       `NS[${slot}] \u2192 [${petName}]`,
                    skipped:    false,
                    dr:         new Array(16).fill(0),
                    flags:      { N: false, Z: false, C: false, V: false },
                    sto:        243,
                    gateChecks: null,
                };
                _traceData.push(entry);
                _traceFlushRender();
            }
            return petName;
        }, CATALOG_SLOT);

        expect(labelAfterReload).toBe(CATALOG_LABEL);

        // ── Switch to trace view and verify ───────────────────────────────────
        await openHamburgerItem(page, 'hamItem-trace');
        await page.locator('#traceTable').waitFor({ state: 'visible' });

        const descCellAfter = page.locator('#traceTableBody tr').first().locator('td').nth(6);
        await descCellAfter.waitFor({ state: 'visible' });
        await expect(descCellAfter).toContainText(CATALOG_LABEL);
    });

});

// ─── Suite 3: Fault trace (gate log / fault modal) ───────────────────────────

test.describe('pet name in fault trace (Location field) survives page reload', () => {

    // The fault log is serialised to 'cm_fault_log' in localStorage by
    // _saveFaultLog() and restored on startup by _restoreFaultLog().  The
    // _nsSnapshot.label field carries the pet name shown in the modal's
    // "Location" row.

    test('pet name in fault Location row appears before and after reload', async ({ page }) => {
        await page.goto('/simulator/');
        await page.waitForLoadState('networkidle');

        // ── Inject fault and persist ──────────────────────────────────────────
        const savedJson = await injectFaultWithPetName(page, CATALOG_LABEL);

        expect(savedJson).not.toBeNull();
        const saved = JSON.parse(savedJson);
        expect(saved).toHaveLength(1);
        expect(saved[0].type).toBe('CAP_EXPIRED');

        // ── Pre-reload: Gate Log and fault modal assertions ───────────────────
        await openGateLogTab(page);

        const typeBadge = page.locator('#gateLogContent .fault-type-badge');
        await expect(typeBadge).toBeVisible();
        await expect(typeBadge).toHaveText('CAP_EXPIRED');

        await openFaultModal(page);

        const locationRow = page.locator('#faultModalOverlay .fault-detail-row', {
            has: page.locator('.fault-detail-label', { hasText: 'Location' }),
        });
        await expect(locationRow.locator('.fault-detail-value')).toContainText(CATALOG_LABEL);

        await page.locator('#faultModalOverlay .fault-modal-close').click();
        await page.locator('#faultModalOverlay').waitFor({ state: 'hidden' });

        // ── Reload — fault log is restored from 'cm_fault_log' ───────────────
        await page.reload();
        await page.waitForLoadState('networkidle');

        // ── Post-reload: Gate Log and fault modal assertions ──────────────────
        await openGateLogTab(page);

        const typeBadgeAfter = page.locator('#gateLogContent .fault-type-badge');
        await expect(typeBadgeAfter).toBeVisible();
        await expect(typeBadgeAfter).toHaveText('CAP_EXPIRED');

        await openFaultModal(page);

        const locationRowAfter = page.locator('#faultModalOverlay .fault-detail-row', {
            has: page.locator('.fault-detail-label', { hasText: 'Location' }),
        });
        await expect(locationRowAfter.locator('.fault-detail-value')).toContainText(CATALOG_LABEL);

        await page.locator('#faultModalOverlay .fault-modal-close').click();
        await page.locator('#faultModalOverlay').waitFor({ state: 'hidden' });
    });

});

// ─── Suite 4: Compile view ────────────────────────────────────────────────────

test.describe('pet names in compile view (editor console) survive page reload', () => {

    // The compile view uses sim.nsLabels to annotate compile output and to
    // label the NS slot a program is saved into.  appendOutput() writes to
    // #editorConsole.  Since sim.nsLabels is re-populated from the static
    // catalog on every load, catalog labels are always available here.
    //
    // The test confirms that:
    //   1. appendOutput() with a label derived from sim.nsLabels[CATALOG_SLOT] is
    //      visible in #editorConsole — proving the label is in live sim state.
    //   2. After a reload, sim.nsLabels[CATALOG_SLOT] still equals CATALOG_LABEL
    //      and appendOutput() called with that live value still renders correctly.
    //      If nsLabels were empty after reload, the injected text would not contain
    //      CATALOG_LABEL and the assertion would fail.

    test('pet name appears in compile output console before and after reload', async ({ page }) => {
        await page.goto('/simulator/');
        await page.waitForLoadState('networkidle');

        // ── Navigate to Programs (editor) view ────────────────────────────────
        // After switchView('editor'), the Console Output sub-tab must be active
        // for #editorConsole to be visible — click it explicitly.
        await openHamburgerItem(page, 'hamItem-editor');
        await page.locator('#codeTabConsole').click();
        await page.locator('#editorConsole').waitFor({ state: 'visible' });

        // ── Find which NS slot holds CATALOG_LABEL and inject compile output ────
        // Scan sim.nsLabels by value (not a hardcoded index) — finding the slot
        // proves the label is present in live sim state.  If the catalog order
        // shifts between runs the test remains correct.
        const CATALOG_SLOT = await page.evaluate((label) => {
            const nsLabels = sim.nsLabels;
            for (const k of Object.keys(nsLabels)) {
                if (nsLabels[k] === label) return parseInt(k, 10);
            }
            return -1;
        }, CATALOG_LABEL);
        expect(CATALOG_SLOT).toBeGreaterThanOrEqual(0);

        await page.evaluate((slot) => {
            const petName = sim.nsLabels[slot] || '';
            if (typeof appendOutput === 'function') {
                // Mirrors what app-compile.js emits after a successful compile:
                //   appendOutput(`Draft: "${result.abstractionName}" — …`, 'info');
                appendOutput(`Draft: "${petName}" — 2 methods, 3 caps, 64 alloc`, 'info');
            }
        }, CATALOG_SLOT);

        const console1 = page.locator('#editorConsole');
        await expect(console1).toContainText(CATALOG_LABEL);

        // ── Reload ────────────────────────────────────────────────────────────
        await page.reload();
        await page.waitForLoadState('networkidle');

        // ── Post-reload: read live nsLabels and inject output from that value ──
        // If _initNamespaceTable() did not re-populate nsLabels after reload,
        // petName would be '' and the assertion on console2 would fail.
        const labelAfterReload = await page.evaluate((slot) => {
            return sim.nsLabels[slot] || '';
        }, CATALOG_SLOT);
        expect(labelAfterReload).toBe(CATALOG_LABEL);

        // ── Navigate to Programs view and inject output from live label ────────
        await openHamburgerItem(page, 'hamItem-editor');
        await page.locator('#codeTabConsole').click();
        await page.locator('#editorConsole').waitFor({ state: 'visible' });

        await page.evaluate((slot) => {
            const petName = sim.nsLabels[slot] || '';
            if (typeof appendOutput === 'function') {
                appendOutput(`Draft: "${petName}" — 2 methods, 3 caps, 64 alloc`, 'info');
            }
        }, CATALOG_SLOT);

        const console2 = page.locator('#editorConsole');
        await expect(console2).toContainText(CATALOG_LABEL);
    });

});
