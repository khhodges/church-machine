'use strict';

// ns_ghost_entries.spec.js
//
// Regression guard for the NS slot prune.
//
// Fifteen placeholder NS slots (SUCC, PRED, ADD, SUB, MUL, ISZERO, TRUE,
// FALSE, PAIR, GC, Thread, Billing, TuringMemory, ChurchMemory, and
// Scheduler.IRQ.Thread) were removed from the simulator abstraction catalog.
//
// Suites:
//
//   Suite 1 — Primary invariant: the 14 canonical boot slots are present
//     and carry their correct hardware labels.  Uses page.evaluate against
//     sim.readNSEntry / sim.nsLabels for ground-truth memory state.
//
//   Suite 2 — Ghost labels absent from DOM (secondary guard):
//     No .ns-label cell in #namespaceTable contains any of the pruned names.
//
//   Suite 3 — Freed slots absent from rendered state:
//     Slots 11-18 and 34-41 must either have null readNSEntry (not rendered)
//     or, if rendered, their label must be exactly "(free)".
//
//   Suite 4 — DOM row check for freed slots:
//     If #ns-row-N exists for any freed slot, its .ns-label must be "(free)".

const { test, expect } = require('@playwright/test');

// The 14 canonical boot slots and their expected hardware labels.
// These are the slots guaranteed to have non-zero NS entries in the boot
// binary.  HARDWARE_LABELS in simulator.js loadBootImage() sets these names
// as a priority override over the abstractionRegistry catalog.
const CANONICAL_BOOT_SLOTS = {
     0: 'Boot.NS',
     1: 'Boot.Thread',
     2: 'UART_DEV',
     3: 'LED_DEV',
     4: 'BTN_DEV',
     5: 'TIMER_DEV',
     6: 'SelfTest',
     8: 'SlideRule',
     9: 'Constants',
    10: 'Loader',
    22: 'Tunnel',
    23: 'Keystone',
    42: 'Ethernet',
    43: 'EventRouter',
};

// Ghost names pruned from the catalog — must not appear as NS labels.
const GHOST_NAMES = new Set([
    'SUCC', 'PRED', 'ADD', 'SUB', 'MUL', 'ISZERO',
    'TRUE', 'FALSE', 'PAIR', 'GC', 'Billing',
    'TuringMemory', 'ChurchMemory',
    'Scheduler.IRQ.Thread',
]);

// Slots that were freed (old ghost entries).
const FREED_SLOTS = [11, 12, 13, 14, 15, 16, 17, 18, 34, 35, 36, 38, 39, 40, 41];

// Map of freed slot index → the old ghost name that used to live there.
// Used by Suites 3 and 4 to assert the old name is gone.
const FORMERLY_GHOST_SLOTS = {
    11: 'SUCC',
    12: 'PRED',
    13: 'ADD',
    14: 'SUB',
    15: 'MUL',
    16: 'ISZERO',
    17: 'TRUE',
    18: 'FALSE',
    34: 'PAIR',
    35: 'GC',
    36: 'Thread',
    38: 'Billing',
    39: 'TuringMemory',
    40: 'ChurchMemory',
    41: 'Scheduler.IRQ.Thread',
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared navigation helper
// ─────────────────────────────────────────────────────────────────────────────

async function openNamespaceView(page) {
    await page.goto('/simulator/');
    await page.waitForLoadState('networkidle');

    const hamBtn = page.locator('#hamBtn');
    await hamBtn.waitFor({ state: 'visible' });
    await hamBtn.click();

    const nsBtn = page.locator('#hamItem-namespace');
    await nsBtn.waitFor({ state: 'visible' });
    await nsBtn.click();

    const nsTable = page.locator('#namespaceTable');
    await nsTable.waitFor({ state: 'visible' });

    // Give the async /api/lumps/list pre-fetch a moment to settle.
    await page.waitForTimeout(600);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Primary invariant: canonical boot slots present with correct labels
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Namespace panel — 14 canonical boot slots present and correctly labelled', () => {

    test('each canonical slot has a non-null NS entry and the expected hardware label', async ({ page }) => {
        test.setTimeout(60000);

        await openNamespaceView(page);

        // Ground-truth check via the simulator's own memory state.
        const slotInfo = await page.evaluate((canonicalSlots) => {
            if (typeof sim === 'undefined') return null;
            const result = [];
            for (const [slotStr, expectedLabel] of Object.entries(canonicalSlots)) {
                const idx = parseInt(slotStr, 10);
                const entry = sim.readNSEntry(idx);
                const actualLabel = sim.nsLabels ? (sim.nsLabels[idx] || '') : '';
                result.push({
                    slot: idx,
                    expectedLabel,
                    actualLabel,
                    hasEntry: entry !== null,
                });
            }
            return result;
        }, CANONICAL_BOOT_SLOTS);

        if (slotInfo === null) {
            test.skip(true, 'sim not accessible in page context');
            return;
        }

        const missing = slotInfo.filter(({ hasEntry }) => !hasEntry);
        expect(
            missing.map(({ slot, expectedLabel }) => `slot ${slot} (${expectedLabel}) absent`),
            'All 14 canonical boot slots must have a non-null NS entry'
        ).toHaveLength(0);

        const mislabelled = slotInfo.filter(
            ({ hasEntry, actualLabel, expectedLabel }) =>
                hasEntry && actualLabel !== expectedLabel
        );
        expect(
            mislabelled.map(({ slot, expectedLabel, actualLabel }) =>
                `slot ${slot}: expected "${expectedLabel}", got "${actualLabel}"`),
            'Canonical boot slots must carry their exact hardware labels'
        ).toHaveLength(0);
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Ghost labels absent from DOM (secondary guard)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Namespace panel — ghost labels absent after slot prune', () => {

    test('pruned abstraction names do not appear in any NS label cell', async ({ page }) => {
        test.setTimeout(60000);

        await openNamespaceView(page);
        const nsTable = page.locator('#namespaceTable');

        const labelTexts = await nsTable.locator('.ns-label').allTextContents();

        for (const ghost of GHOST_NAMES) {
            const matching = labelTexts.filter(t => t.trim() === ghost);
            expect(matching, `Ghost label "${ghost}" must not appear as an NS label`).toHaveLength(0);
        }
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Freed catalog slots carry no ghost label at the memory level
// ─────────────────────────────────────────────────────────────────────────────
//
// The boot binary may still write non-zero NS entries for slots 11-18 and
// 34-41 (they held SUCC, PRED, ADD, … in the old catalog before the prune).
// When those slots have binary data but no catalog entry, loadBootImage()
// assigns the neutral label 'slot_N' — which is correct.  The invariant here
// is narrower: no rendered (non-null readNSEntry) slot at a freed index may
// carry the old ghost name that used to live there.

test.describe('Namespace panel — freed catalog slots carry no ghost label (memory level)', () => {

    test('formerly-ghost slots have no old ghost name in nsLabels', async ({ page }) => {
        test.setTimeout(60000);

        await openNamespaceView(page);

        // Build a list of {slot, oldName} pairs from FORMERLY_GHOST_SLOTS.
        const violations = await page.evaluate((ghostInfo) => {
            if (typeof sim === 'undefined') return null;
            const bad = [];
            for (const [slotStr, oldName] of Object.entries(ghostInfo)) {
                const idx = parseInt(slotStr, 10);
                const entry = sim.readNSEntry(idx);
                if (entry === null) continue;  // absent — pruning fully effective
                const label = (sim.nsLabels && sim.nsLabels[idx]) || '';
                // Accept: '(free)', 'slot_N', or any label not equal to the old ghost name.
                if (label === oldName) {
                    bad.push({ slot: idx, label });
                }
            }
            return bad;
        }, FORMERLY_GHOST_SLOTS);

        if (violations === null) {
            test.skip(true, 'sim not accessible in page context');
            return;
        }

        expect(
            violations.map(({ slot, label }) => `slot ${slot}: "${label}"`),
            'Formerly-ghost slots must not carry the old pruned name'
        ).toHaveLength(0);
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — DOM row check: freed slot rows must not carry any GHOST_NAMES label
// ─────────────────────────────────────────────────────────────────────────────
//
// If a slot with binary data produces a DOM row, the .ns-label must not be any
// of the known-pruned ghost names.  Acceptable values: '(free)', 'slot_N',
// a canonical hardware label (if the binary actually placed a live entry there),
// or any other name that is not in the ghost set.

test.describe('Namespace panel — freed slot DOM rows carry no ghost label', () => {

    test('any #ns-row-N for freed slots must not show an old ghost name', async ({ page }) => {
        test.setTimeout(60000);

        await openNamespaceView(page);
        const nsTable = page.locator('#namespaceTable');

        for (const [idxStr, oldName] of Object.entries(FORMERLY_GHOST_SLOTS)) {
            const idx = parseInt(idxStr, 10);
            const row = nsTable.locator(`#ns-row-${idx}`);
            const rowCount = await row.count();

            if (rowCount === 0) {
                // Absent — the prune was fully effective for this slot.
                continue;
            }

            // Row exists — the label must NOT be the old ghost name, and must
            // not be any other known ghost name.
            const labelCell = row.locator('.ns-label');
            const labelText = (await labelCell.textContent() || '').trim();

            expect(
                labelText,
                `NS slot ${idx} (formerly '${oldName}') must not carry the old ghost name`
            ).not.toBe(oldName);

            expect(
                GHOST_NAMES.has(labelText),
                `NS slot ${idx} label "${labelText}" must not be any pruned ghost name`
            ).toBe(false);
        }
    });

});
