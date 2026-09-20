'use strict';

const { test, expect } = require('@playwright/test');

async function openNamespace(page) {
    await page.goto('/simulator/');
    await page.addStyleTag({
        content: '#faultModalOverlay, #whatsNewModal { display: none !important; }',
    });
    await page.waitForFunction(() =>
        typeof sim !== 'undefined' && sim && sim.nsCount > 0 &&
        typeof window._namespaceSummarySnapshot === 'function');
}

test('Namespace summary uses effective policy while Thread and I/O stay resident', async ({ page }) => {
    await openNamespace(page);

    const result = await page.evaluate(() => {
        const occupied = Array.from({ length: sim.nsCount }, (_, slot) => slot)
            .filter(slot => sim.readNSEntry(slot));
        const ordinary = occupied.filter(slot => {
            const entry = sim.readNSEntry(slot);
            return !_isBootstrapSlot(slot, entry.label) &&
                !_isResidentIORegister(slot, entry.label) &&
                !_nsSlotHasResidentThreadBody(slot);
        });
        if (ordinary.length < 2) throw new Error('mixed-policy fixture needs two ordinary rows');
        const lazySlot = ordinary[0];
        const residentSlot = ordinary[1];

        window._nsState = {
            namespaceFingerprint: 'summary-fixture',
            abstractions: occupied.map(slot => ({
                slot,
                load_policy: slot === lazySlot ? 'Lazy' :
                    (slot === residentSlot ? 'Resident' : 'Resident'),
            })),
        };
        window.bootConfig = { slotRules: {}, step2: { lumps: [] } };
        window._nsPrefetchDirty = false;
        window._nsPrefetchDirtySlots = {};
        const snapshot = window._namespaceSummarySnapshot();
        const fixed = snapshot.slots.filter(row => row.entry &&
            (_isResidentIORegister(row.slot, row.entry.label) ||
             _nsSlotHasResidentThreadBody(row.slot)));
        return {
            lazy: snapshot.slots[lazySlot].classification,
            resident: snapshot.slots[residentSlot].classification,
            fixed: fixed.map(row => row.classification),
            total: snapshot.counts.resident + snapshot.counts.lazy +
                snapshot.counts.garbage + snapshot.counts.free,
            max: snapshot.counts.max,
        };
    });

    expect(result.lazy).toBe('lazy');
    expect(result.resident).toBe('resident');
    expect(result.fixed.length).toBeGreaterThan(0);
    expect(result.fixed.every(value => value === 'resident')).toBe(true);
    expect(result.total).toBe(result.max);
});

test('Namespace summary follows pending policy, clear, and authoritative refresh transitions', async ({ page }) => {
    await openNamespace(page);

    const result = await page.evaluate(() => {
        const slot = Array.from({ length: sim.nsCount }, (_, index) => index)
            .find(index => {
                const entry = sim.readNSEntry(index);
                return entry && index >= sim.firstUserNsSlot() &&
                    index !== bootEntrySlot &&
                    !_isResidentIORegister(index, entry.label) &&
                    !_nsSlotHasResidentThreadBody(index);
            });
        if (!Number.isInteger(slot)) throw new Error('no clearable ordinary row');

        window._nsState = {
            namespaceFingerprint: 'authority-before',
            abstractions: [{ slot, load_policy: 'Resident' }],
        };
        window.bootConfig = { slotRules: {}, step2: { lumps: [] } };
        window._nsPrefetchDirty = false;
        window._nsPrefetchDirtySlots = {};
        const authoritativeResident =
            window._namespaceSummarySnapshot().slots[slot].classification;

        window.bootConfig.step2.lumps = [{
            nsSlot: slot, loadPolicy: 'Lazy', resident: false,
        }];
        window._nsPrefetchDirty = true;
        window._nsPrefetchDirtySlots[String(slot)] = true;
        const pendingLazy =
            window._namespaceSummarySnapshot().slots[slot].classification;

        _nsTableClear(slot);
        const cleared = window._namespaceSummarySnapshot();
        const garbage = cleared.slots[slot].classification;

        // A fresh authoritative projection must supersede a settled local edit.
        sim.withNamespaceWrite('summary test reissue', () => {
            sim.writeNSEntry(slot, 1, 0, 0, 0, 1, 0, 0, 0);
        });
        window._nsState = {
            namespaceFingerprint: 'authority-after',
            abstractions: [{ slot, load_policy: 'Resident' }],
        };
        window._nsPrefetchDirty = false;
        window._nsPrefetchDirtySlots = {};
        const refreshedResident =
            window._namespaceSummarySnapshot().slots[slot].classification;
        return {
            authoritativeResident,
            pendingLazy,
            garbage,
            refreshedResident,
            total: cleared.counts.resident + cleared.counts.lazy +
                cleared.counts.garbage + cleared.counts.free,
            max: cleared.counts.max,
        };
    });

    expect(result).toMatchObject({
        authoritativeResident: 'resident',
        pendingLazy: 'lazy',
        garbage: 'garbage',
        refreshedResident: 'resident',
    });
    expect(result.total).toBe(result.max);
});