'use strict';

// Browser regression for the shared physical-breakpoint contract:
// every execution control must stop before the same SelfTest instruction, and
// a normal breakpoint must remain armed after it fires.

const { test, expect } = require('@playwright/test');
const { loadSimulator } = require('./helpers/simulator');

function formatAddress(addr) {
    return `0x${addr.toString(16).toUpperCase().padStart(4, '0')}`;
}

async function armSelfTestBreakpoint(page) {
    const target = await page.evaluate(() => ({
        addr: sim._nextPhysicalAddr(),
        bootEntrySlot: sim.bootEntrySlot,
        bootEntryLabel: sim.nsLabels[sim.bootEntrySlot],
        stepCount: sim.stepCount,
    }));

    expect(target.bootEntrySlot, 'fixture must boot the SelfTest entry').toBe(6);
    expect(target.bootEntryLabel, 'breakpoint target must be SelfTest').toBe('SelfTest');
    expect(target.addr, 'SelfTest must expose a physical next-instruction address')
        .toBeGreaterThanOrEqual(0);

    // Use the actual Step Settings UI to arm a persistent physical breakpoint.
    await page.locator('#toolBreakBtn').click();
    const input = page.locator('#breakAddrInput');
    await expect(input).toBeVisible();
    await input.fill(formatAddress(target.addr));
    await input.press('Enter');

    const item = page.locator('#breakList .break-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(formatAddress(target.addr));
    return target.addr;
}

async function assertPausedAtPersistentBreakpoint(page, addr, initialStepCount) {
    const addressText = formatAddress(addr);
    await expect(page.locator('#editorConsole')).toContainText(
        `Breakpoint at ${addressText}`,
        { timeout: 10000 }
    );

    const state = await page.evaluate(target => ({
        nextPhysicalAddr: sim._nextPhysicalAddr(),
        stepCount: sim.stepCount,
        running: sim.running,
        walkRunning,
        activeBreakpoint: simBreakpoints.has(target),
    }), addr);

    expect(state.nextPhysicalAddr, 'execution must stop before the target instruction').toBe(addr);
    expect(state.stepCount, 'the breakpoint must fire before SelfTest executes').toBe(initialStepCount);
    expect(state.running, 'the simulator must be paused').toBe(false);
    expect(state.walkRunning, 'Walk must stop when the breakpoint fires').toBe(false);
    expect(state.activeBreakpoint, 'persistent breakpoint must remain armed').toBe(true);

    await expect(page.locator('#breakList .break-item')).toHaveCount(1);
    await expect(page.locator('#breakList .break-item')).toContainText(addressText);
}

for (const mode of ['Step', 'Walk', 'Run']) {
    test(`physical breakpoint pauses before SelfTest when started with ${mode}`, async ({ page }) => {
        test.setTimeout(60000);
        await loadSimulator(page);

        const targetAddr = await armSelfTestBreakpoint(page);
        const initialStepCount = await page.evaluate(() => sim.stepCount);

        if (mode === 'Step') {
            await page.locator('#toolStepBtn').click();
        } else if (mode === 'Walk') {
            await page.locator('#toolWalkBtn').click();
        } else {
            // A single click is the normal Run action; the double-click path
            // opens Run Settings instead of starting execution.
            await page.locator('#btnRunSim').click();
        }

        await assertPausedAtPersistentBreakpoint(page, targetAddr, initialStepCount);
    });
}