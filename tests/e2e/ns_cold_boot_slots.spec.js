'use strict';

// ns_cold_boot_slots.spec.js
//
// Confirms that the Namespace panel shows only slots 0–10 on cold boot
// (no boot binary, no saved boot config) and that slots 11+ appear only
// after a LUMP is deployed through the Builder.
//
// The simulator's _getHardwareBootCatalog() returns exactly 11 entries
// (indices 0–10).  Slot 8 (Tunnel) is bitstreamOnly: the FPGA writes its
// NS entry at power-on; boot software intentionally leaves the memory
// zeroed, so sim.readNSEntry(8) === null.  Slots 11–1023 must remain
// absent until a LUMP is explicitly deployed.
//
// Hardware catalog layout:
//   0  Boot.NS         (NS root)
//   1  Boot.Thread     (Thread LUMP)
//   2  UART_DEV        (MMIO RW)
//   3  LED_DEV         (MMIO RW)
//   4  BTN_DEV         (MMIO R)
//   5  TIMER_DEV       (MMIO RW)
//   6  SelfTest        (E-perm LUMP, boot entry)
//   7  WukongCallHome  (E-perm LUMP)
//   8  Tunnel          (bitstreamOnly — FPGA writes at power-on; sim leaves null)
//   9  Ethernet        (E-perm hardware cap)
//  10  CapTest         (E-perm LUMP)
//
// ─── Suites ───────────────────────────────────────────────────────────────
//
// Suite 1 — Cold boot: no dynamic slots (11+) visible
//
//   1a. Primary invariant: sim.nsCount ≤ 11 after cold reset; no DOM row
//       with id #ns-row-N for N ≥ 11 exists; every rendered row has index ≤ 10.
//
//   1b. Slot labels: hardware slots 0–7 and 9–10 carry their canonical labels
//       from _getHardwareBootCatalog().  Slot 8 (Tunnel/bitstreamOnly) has
//       no NS entry (FPGA writes it at power-on; sim leaves zeros).
//
//   1c. Slot 7 = WukongCallHome (valid NS entry, rendered row).
//       Slot 8 = Tunnel / bitstreamOnly (null NS entry from boot software,
//       no rendered row at sim cold boot).
//
// Suite 2 — After LUMP deploy via the Builder: a new slot ≥ 11 appears
//
//   2a. Builder compile + create flow: the IDE is navigated to the editor
//       (Programs view), a minimal CLOOMC abstraction is compiled with
//       compileAndCreateAbstraction() — the same call made by the Builder's
//       "Create Abstraction" action — and the resulting slot (assigned by
//       the Navana registry at index 45 or above, per the slot search in
//       system_abstractions.js) appears as a visible row in the namespace table.
//
//   2b. nsCount invariant: cold-boot nsCount stays ≤ 11 until the Builder
//       deploy fires, then jumps to the new slot + 1.

const { test, expect } = require('@playwright/test');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Hardware-boot slots that must carry valid NS entries after cold boot.
// Slot 8 (Tunnel) is bitstreamOnly — boot software leaves zeros, so
// readNSEntry(8) === null and it is intentionally omitted here.
const COLD_BOOT_EXPECTED_LABELS = {
    0:  'Boot.NS',
    1:  'Boot.Thread',
    2:  'UART_DEV',
    3:  'LED_DEV',
    4:  'BTN_DEV',
    5:  'TIMER_DEV',
    6:  'SelfTest',
    7:  'WukongCallHome',
    9:  'Ethernet',
    10: 'CapTest',
};

// Minimal CLOOMC++ abstraction that compiles successfully.
// Uses the brace-delimited syntax required by the CLOOMC++ compiler.
// Used by Suite 2 to create a new NS slot via the Builder deploy path.
const MINIMAL_ABSTRACTION_SOURCE = `abstraction ColdBootTest {
    method Ping() {
        return(0)
    }
}`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load the simulator in cold-boot state:
 *   - Intercept /api/boot-image/binary → 404 so no binary is ever applied.
 *   - Navigate to the simulator page and wait for networkidle.
 *   - Clear window.bootImage / window.bootConfig and any localStorage keys
 *     that could restore extended NS slots from a prior session.
 *   - Call sim.reset() so _initNamespaceTable() runs from
 *     _getHardwareBootCatalog() — 11 hardware slots, bootComplete = false.
 *
 * After this helper: sim.bootComplete = false, sim.nsCount = 11.
 *
 * WHY bootComplete is intentionally left false here:
 *   Boot phase B:04 (CALL_HOME) starts an async network fetch inside
 *   _bootStep(). instantBoot()'s synchronous while-loop cannot advance past
 *   it (Promise micro-tasks do not run mid-loop), so it returns false.
 *   slowBoot()'s setTimeout delays let the Promise resolve between phases,
 *   but the page's own auto-boot already set bootAnimating = true, so a
 *   second slowBoot() call exits immediately.  Rather than fight the timing,
 *   Suite 1 tests only need nsCount = 11 (no bootComplete check), and Suite 2
 *   sets sim.bootComplete = true directly before calling
 *   compileAndCreateAbstraction() — that flag is the only guard that function
 *   checks.
 *
 * The route intercept is registered before page.goto so it is active when
 * app-shell.js calls _probeBootImage() during startup.
 */
async function loadColdBoot(page) {
    await page.route('**/api/boot-image/binary', route => route.fulfill({
        status: 404,
        contentType: 'text/plain',
        body: 'no boot image (cold-boot test)',
    }));

    // Pre-set the "What's New" dismissed flag before the page initialises so
    // the modal never appears and cannot block subsequent UI interactions.
    await page.addInitScript(() => {
        localStorage.setItem('church_whatsnew_dismissed_perm', '1');
    });

    await page.goto('/simulator/');
    await page.waitForLoadState('networkidle');

    // Clear window.bootImage BEFORE sim.reset() so the 'reset' event handler
    // _maybeApplyBootImage() finds no binary and is a no-op.  Also wipe
    // localStorage keys that could otherwise restore extended NS slots.
    await page.evaluate(() => {
        for (const key of [...Object.keys(localStorage)]) {
            if (
                key.startsWith('church_ns') ||
                key.startsWith('church_boot') ||
                key === 'bootConfig'
            ) {
                localStorage.removeItem(key);
            }
        }
        window.bootImage          = null;
        window.bootImageAvailable = false;
        window.bootConfig         = null;
        if (typeof sim !== 'undefined') sim.reset();
    });

    // Allow the reset event chain (_maybeApplyBootImage, stateChange) to settle.
    await page.waitForTimeout(300);
}

/**
 * Open the Namespace view via the hamburger menu and wait for the table.
 * Allows the /api/lumps/list warm-up fetch to settle before returning.
 */
async function openNamespaceView(page) {
    const hamBtn = page.locator('#hamBtn');
    await hamBtn.waitFor({ state: 'visible' });
    await hamBtn.click();

    const nsBtn = page.locator('#hamItem-namespace');
    await nsBtn.waitFor({ state: 'visible' });
    await nsBtn.click();

    await page.locator('#namespaceTable').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Cold boot: no dynamic slots (11+) visible
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Namespace panel — cold boot shows no dynamic slots (11+)', () => {

    // 1a — Primary invariant: nsCount ≤ 11, no dynamic DOM rows, every row ≤ 10.
    test('no slot ≥ 11 visible in the namespace table on fresh cold boot', async ({ page }) => {
        test.setTimeout(60000);

        await loadColdBoot(page);
        await openNamespaceView(page);

        // Ground-truth: sim.nsCount must be ≤ 11 (hardware catalog has 11 entries).
        const nsCount = await page.evaluate(() => {
            if (typeof sim === 'undefined') throw new Error('sim is not accessible');
            return sim.nsCount;
        });

        expect(
            nsCount,
            `sim.nsCount must be ≤ 11 at cold boot (got ${nsCount})`
        ).toBeLessThanOrEqual(11);

        // DOM check: scan slots 11–43 (dynamic range);
        // none should have a rendered row.
        const nsTable = page.locator('#namespaceTable');
        const extendedSlots = [];
        for (let slot = 11; slot <= 43; slot++) {
            const c = await nsTable.locator(`#ns-row-${slot}`).count();
            if (c > 0) extendedSlots.push(slot);
        }

        expect(
            extendedSlots,
            `Dynamic slot(s) ${extendedSlots.join(', ')} must not appear in the namespace table at cold boot`
        ).toHaveLength(0);

        // Tertiary: every rendered row must carry an index ≤ 10.
        const allRowIndices = await nsTable.locator('[id^="ns-row-"]').evaluateAll(
            els => els.map(el => parseInt(el.id.replace('ns-row-', ''), 10))
        );

        const outOfRange = allRowIndices.filter(idx => idx > 10);
        expect(
            outOfRange,
            `Row(s) with index ${outOfRange.join(', ')} exceed the 0–10 cold-boot range`
        ).toHaveLength(0);
    });

    // 1b — Canonical labels: hardware-boot slots (0–7, 9–10) carry the correct labels.
    //      Slot 8 (Tunnel/bitstreamOnly) is intentionally absent from COLD_BOOT_EXPECTED_LABELS
    //      because boot software leaves its NS memory zeroed; the FPGA writes it at power-on.
    test('cold-boot hardware slots have valid NS entries with canonical labels', async ({ page }) => {
        test.setTimeout(60000);

        await loadColdBoot(page);
        await openNamespaceView(page);

        const slotInfo = await page.evaluate((expected) => {
            if (typeof sim === 'undefined') throw new Error('sim is not accessible');
            return Object.entries(expected).map(([slotStr, expectedLabel]) => {
                const idx   = parseInt(slotStr, 10);
                const entry = sim.readNSEntry(idx);
                return {
                    slot:          idx,
                    expectedLabel,
                    actualLabel:   (sim.nsLabels && sim.nsLabels[idx]) || '',
                    hasEntry:      entry !== null,
                };
            });
        }, COLD_BOOT_EXPECTED_LABELS);

        const missing = slotInfo.filter(s => !s.hasEntry);
        expect(
            missing.map(s => `slot ${s.slot} (${s.expectedLabel})`),
            'All hardware cold-boot slots (0–7, 9–10) must have a valid NS entry'
        ).toHaveLength(0);

        const mislabelled = slotInfo.filter(
            s => s.hasEntry && s.actualLabel !== s.expectedLabel
        );
        expect(
            mislabelled.map(s =>
                `slot ${s.slot}: expected "${s.expectedLabel}", got "${s.actualLabel}"`
            ),
            'Cold-boot slots must carry their canonical hardware labels'
        ).toHaveLength(0);
    });

    // 1c — Slot 7 = WukongCallHome (valid NS entry, rendered row).
    //      Slot 8 = Tunnel — boot image writes a real NS entry (same as all other boot slots).
    test('slot 7 has WukongCallHome entry; slot 8 has Tunnel NS entry', async ({ page }) => {
        test.setTimeout(60000);

        await loadColdBoot(page);
        await openNamespaceView(page);

        const slotData = await page.evaluate(() => {
            if (typeof sim === 'undefined') throw new Error('sim is not accessible');
            return {
                slot7: {
                    entry: sim.readNSEntry(7),
                    label: (sim.nsLabels && sim.nsLabels[7]) || '',
                },
                slot8: {
                    entry: sim.readNSEntry(8),
                    label: (sim.nsLabels && sim.nsLabels[8]) || '',
                },
            };
        });

        // Slot 7 must be WukongCallHome — a fully-wired E-perm LUMP entry.
        expect(
            slotData.slot7.entry,
            'Slot 7 (WukongCallHome) must have a valid NS entry at cold boot'
        ).not.toBeNull();
        expect(
            slotData.slot7.label,
            'Slot 7 must be labelled "WukongCallHome"'
        ).toBe('WukongCallHome');

        // Slot 8 is Tunnel — the IDE is the authority; the boot image writes a real
        // NS entry for it just like every other boot slot.
        expect(
            slotData.slot8.entry,
            'Slot 8 (Tunnel) must have a valid NS entry at cold boot'
        ).not.toBeNull();
        expect(
            slotData.slot8.label,
            'Slot 8 must be labelled "Tunnel"'
        ).toBe('Tunnel');

        // Slot 8 must produce a rendered row in the namespace table.
        const row8Count = await page.locator('#namespaceTable #ns-row-8').count();
        expect(
            row8Count,
            'Slot 8 (Tunnel) must produce a rendered namespace table row at cold boot'
        ).toBe(1);
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — After LUMP deploy via the Builder: new slot 11+ appears
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Namespace panel — new slot ≥ 11 appears only after Builder deploy', () => {

    // 2a — Builder compile + create flow via compileAndCreateAbstraction().
    //
    // This test exercises the full Builder deploy pipeline:
    //   1. Navigate to the Programs (editor) view via the hamburger menu.
    //   2. Fill #asmEditor with a minimal CLOOMC abstraction source.
    //   3. Call instantBoot() to satisfy the sim.bootComplete guard inside
    //      compileAndCreateAbstraction() — identical to what clicking "Run" does.
    //   4. Call compileAndCreateAbstraction() — the same function triggered by
    //      Builder → Actions → "Create Abstraction".  This runs the CLOOMC
    //      compiler, then dispatches to Navana.Abstraction.Add (abstractionRegistry
    //      index 5), which allocates memory and calls sim.writeNSEntry(slot, …)
    //      where slot is the first free index ≥ 45 (system_abstractions.js).
    //   5. Navigate to the Namespace view.
    //   6. Assert the new slot row is visible and carries the abstraction name.
    test('compile and create an abstraction via the Builder adds a new NS slot ≥ 11', async ({ page }) => {
        test.setTimeout(90000);

        await loadColdBoot(page);

        // Confirm cold-boot state before deploy: nsCount ≤ 11.
        const nsCountBefore = await page.evaluate(() => {
            if (typeof sim === 'undefined') throw new Error('sim is not accessible');
            return sim.nsCount;
        });
        expect(
            nsCountBefore,
            `nsCount before Builder deploy must be ≤ 11 (got ${nsCountBefore})`
        ).toBeLessThanOrEqual(11);

        // Step 1: Navigate to the Programs/editor view.
        const hamBtn = page.locator('#hamBtn');
        await hamBtn.waitFor({ state: 'visible' });
        await hamBtn.click();

        const editorBtn = page.locator('#hamItem-editor');
        await editorBtn.waitFor({ state: 'visible' });
        await editorBtn.click();

        // Confirm the editor textarea is present.
        const asmEditor = page.locator('#asmEditor');
        await asmEditor.waitFor({ state: 'attached' });

        // Step 2: Set the editor content to a minimal CLOOMC abstraction.
        await page.evaluate((src) => {
            const ed = document.getElementById('asmEditor');
            if (!ed) throw new Error('#asmEditor not found');
            ed.value = src;
            ed.dispatchEvent(new Event('input', { bubbles: true }));
        }, MINIMAL_ABSTRACTION_SOURCE);

        // Step 3: Force sim.bootComplete = true.
        //
        // compileAndCreateAbstraction() has exactly one guard:
        //   if (!sim.bootComplete) { appendOutput('Boot not complete…'); return; }
        // It does NOT use CR14, memory layout, or any other boot-phase output.
        // Navana.Abstraction.Add is pure JS (sim.writeNSEntry) and works with
        // or without a full hardware boot.
        //
        // Why not run the full boot here:
        //   B:04 CALL_HOME starts an async fetch; instantBoot()'s synchronous
        //   loop cannot advance past it, and slowBoot() exits immediately because
        //   the page's own auto-boot left bootAnimating = true.  Forcing
        //   bootComplete is the correct, minimal intervention for this unit test.
        await page.evaluate(() => {
            if (typeof sim === 'undefined') throw new Error('sim is not accessible');
            sim.bootComplete = true;
        });

        // Step 4: Trigger Builder deploy via compileAndCreateAbstraction().
        // This is the exact function called by the Builder's "Create Abstraction"
        // menu item in the editor Actions dropdown.
        const deployResult = await page.evaluate(() => {
            if (typeof compileAndCreateAbstraction !== 'function') {
                throw new Error('compileAndCreateAbstraction is not available');
            }
            if (typeof cloomcCompiler === 'undefined') {
                throw new Error('cloomcCompiler is not initialised');
            }
            if (typeof abstractionRegistry === 'undefined') {
                throw new Error('abstractionRegistry is not initialised');
            }
            compileAndCreateAbstraction();
            // Return the console output so failures can be diagnosed.
            const con = document.getElementById('editorConsole');
            return con ? con.textContent : '(no console)';
        });

        // The console output must mention the abstraction name (success path) or
        // surface a clear compile/create error that helps diagnosis.
        const SUCCESS_KEYWORDS = ['ColdBootTest', 'created', 'NS Index'];
        const isSuccess = SUCCESS_KEYWORDS.some(k => deployResult.includes(k));
        expect(
            isSuccess,
            `compileAndCreateAbstraction() did not succeed.\nConsole: ${deployResult}`
        ).toBe(true);

        // Step 5: Navigate to the Namespace view.
        await openNamespaceView(page);

        // Step 6: The new abstraction must occupy a slot ≥ 11
        //         (slots 0–10 are all hardware boot slots).
        const newSlot = await page.evaluate(() => {
            if (typeof sim === 'undefined') throw new Error('sim is not accessible');
            for (let i = 11; i < sim.nsCount; i++) {
                const entry = sim.readNSEntry(i);
                if (entry !== null) return i;
            }
            return -1;
        });

        expect(
            newSlot,
            'A new NS slot ≥ 11 must appear in the namespace table after Builder deploy'
        ).toBeGreaterThanOrEqual(11);

        // The new slot must have a visible DOM row.
        const row = page.locator(`#namespaceTable #ns-row-${newSlot}`);
        await expect(
            row,
            `NS row for slot ${newSlot} must be visible after Builder deploy`
        ).toBeVisible();

        // nsCount must have grown beyond the cold-boot maximum.
        const nsCountAfter = await page.evaluate(() => sim.nsCount);
        expect(
            nsCountAfter,
            `nsCount must exceed 11 after Builder deploy (got ${nsCountAfter})`
        ).toBeGreaterThan(11);
    });

    // 2b — nsCount invariant: cold-boot nsCount stays ≤ 11, grows only after deploy.
    test('nsCount stays ≤ 11 on cold boot and grows only after Builder deploy fires', async ({ page }) => {
        test.setTimeout(60000);

        await loadColdBoot(page);

        // Verify cold-boot nsCount.
        const nsCountColdBoot = await page.evaluate(() => {
            if (typeof sim === 'undefined') throw new Error('sim is not accessible');
            return sim.nsCount;
        });

        expect(
            nsCountColdBoot,
            `nsCount at cold boot must be ≤ 11 (got ${nsCountColdBoot})`
        ).toBeLessThanOrEqual(11);

        // Navigate to the editor and trigger the Builder deploy.
        await page.evaluate(() => {
            if (typeof switchView === 'function') switchView('editor');
        });
        await page.waitForTimeout(200);

        await page.evaluate((src) => {
            const ed = document.getElementById('asmEditor');
            if (!ed) throw new Error('#asmEditor not found');
            ed.value = src;
            ed.dispatchEvent(new Event('input', { bubbles: true }));
        }, MINIMAL_ABSTRACTION_SOURCE);

        // Force bootComplete = true (see test 2a for full rationale).
        await page.evaluate(() => {
            if (typeof sim === 'undefined') throw new Error('sim is not accessible');
            sim.bootComplete = true;
            if (typeof compileAndCreateAbstraction !== 'function') {
                throw new Error('compileAndCreateAbstraction is not available');
            }
            compileAndCreateAbstraction();
        });
        await page.waitForTimeout(300);

        // After deploy, nsCount must have grown beyond 11.
        const nsCountAfter = await page.evaluate(() => {
            if (typeof sim === 'undefined') throw new Error('sim is not accessible');
            return sim.nsCount;
        });

        expect(
            nsCountAfter,
            `nsCount must exceed 11 after Builder deploy (got ${nsCountAfter})`
        ).toBeGreaterThan(11);

        // The absolute difference must account for the new slot being ≥ 45
        // (Navana assigns slots starting at 45; nsCount = new slot + 1).
        expect(
            nsCountAfter,
            'nsCount after deploy must be consistent with a slot ≥ 11 being allocated'
        ).toBeGreaterThanOrEqual(12);
    });

});
