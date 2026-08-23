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
// Namespace labels come from the committed boot catalog / boot configuration.
// Browser localStorage is deliberately not a source of Namespace occupancy or
// labels. The fault log remains independently persisted in localStorage.

const { test, expect } = require('@playwright/test');

// ─── Shared constants ─────────────────────────────────────────────────────────

// 'SelfTest' is at NS slot 6 in the hardware boot catalog.
// It is a reliable anchor label that is always set by loadBootImage() HARDWARE_LABELS.
const CATALOG_LABEL = 'SelfTest';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function waitForSimulatorReady(page) {
    await page.waitForFunction(() =>
        typeof sim !== 'undefined' && sim &&
        window.bootImageAvailable === true &&
        sim.nsLabels && sim.nsLabels[6] === 'SelfTest'
    );
}

/**
 * Open the hamburger menu and click a named menu item.
 * @param {import('@playwright/test').Page} page
 * @param {string} itemId - element ID of the menu button (e.g. 'hamItem-namespace')
 */
async function openHamburgerItem(page, itemId) {
    const item = page.locator(`#${itemId}`);
    await item.waitFor({ state: 'attached' });
    await item.evaluate(element => element.click());
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

    test('catalog label "SelfTest" appears in namespace table before and after reload', async ({ page }) => {
        await page.goto('/simulator/');
        await waitForSimulatorReady(page);

        // ── Pre-reload ────────────────────────────────────────────────────────
        await openNamespaceView(page);

        const labelCells = page.locator('#namespaceTable td.ns-label');
        await expect(labelCells.filter({ hasText: CATALOG_LABEL })).toHaveCount(1);

        // ── Reload — no script injection; relies on _initNamespaceTable ───────
        await page.reload();
        await waitForSimulatorReady(page);

        // ── Post-reload ───────────────────────────────────────────────────────
        await openNamespaceView(page);

        const labelCellsAfter = page.locator('#namespaceTable td.ns-label');
        await expect(labelCellsAfter.filter({ hasText: CATALOG_LABEL })).toHaveCount(1);
    });

    test('custom label survives the canonical Save NS Table and reset path', async ({ page }) => {
        let labelSaved = false;
        let tableSaved = false;
        await page.route('**/api/boot-config/slot-label', async route => {
            labelSaved = true;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true, slot: 11, label: 'CanonicalE2ELabel' })
            });
        });
        await page.route('**/api/boot-image/save-ns', async route => {
            tableSaved = true;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true })
            });
        });

        await page.goto('/simulator/');
        await waitForSimulatorReady(page);

        const result = await page.evaluate(async () => {
            const label = 'CanonicalE2ELabel';
            const slot = sim.saveToNamespace(label, [0x18000000], null, 1, []);
            await window._persistNamespaceSlotLabel(slot, label);
            await window._nsTableSave(null);

            const committedImage = window.bootImage.slice(0);
            sim.reset();
            const loaded = sim.loadBootImage(committedImage);
            return {
                slot,
                loaded,
                valid: sim.isNSEntryValid(slot),
                label: sim.nsLabels[slot]
            };
        });

        expect(labelSaved).toBe(true);
        expect(tableSaved).toBe(true);
        expect(result.slot).toBe(11);
        expect(result.loaded).toBe(true);
        expect(result.valid).toBe(true);
        expect(result.label).toBe('CanonicalE2ELabel');
    });

    test('legacy browser Namespace payload is removed and cannot restore labels', async ({ page }) => {
        const roguePayload = new Array(48).fill(null);
        roguePayload[45] = { nsWords: [0x1200, 63, 1], label: 'SlideRule', dataWords: [1, 2, 3] };
        roguePayload[46] = { nsWords: [0x1300, 63, 1], label: 'Constants', dataWords: [4, 5, 6] };
        roguePayload[47] = { nsWords: [0x1400, 63, 1], label: 'AdaExample1', dataWords: [7, 8, 9] };
        await page.addInitScript((payload) => {
            localStorage.setItem('church_namespace', JSON.stringify(payload));
        }, roguePayload);

        await page.goto('/simulator/');
        await waitForSimulatorReady(page);

        const beforeReload = await page.evaluate(() => ({
            legacy: localStorage.getItem('church_namespace'),
            rogue: [45, 46, 47].map(slot => ({
                valid: sim.isNSEntryValid(slot),
                label: sim.nsLabels[slot] || ''
            }))
        }));
        expect(beforeReload.legacy).toBeNull();
        expect(beforeReload.rogue.every(entry => !entry.valid)).toBe(true);
        expect(beforeReload.rogue.every(entry => !entry.label ||
            entry.label === '(free)' || entry.label === '(reserved)')).toBe(true);

        await page.reload();
        await waitForSimulatorReady(page);

        const afterReload = await page.evaluate(() =>
            [45, 46, 47].map(slot => ({
                valid: sim.isNSEntryValid(slot),
                label: sim.nsLabels[slot] || ''
            }))
        );
        expect(afterReload.every(entry => !entry.valid)).toBe(true);
        expect(afterReload.every(entry => !entry.label ||
            entry.label === '(free)' || entry.label === '(reserved)')).toBe(true);
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
        await waitForSimulatorReady(page);

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
        await waitForSimulatorReady(page);
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
        await waitForSimulatorReady(page);

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
        await waitForSimulatorReady(page);

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
        await waitForSimulatorReady(page);

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
        await waitForSimulatorReady(page);

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
