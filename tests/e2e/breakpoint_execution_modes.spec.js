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

async function assertStepCanResume(page, addr, initialStepCount) {
    await page.locator('#toolStepBtn').click();
    await expect.poll(
        () => page.evaluate(() => sim.stepCount),
        { timeout: 10000 }
    ).toBeGreaterThan(initialStepCount);
    const state = await page.evaluate(target => ({
        nextPhysicalAddr: sim._nextPhysicalAddr(),
        activeBreakpoint: simBreakpoints.has(target),
        running: sim.running,
    }), addr);
    expect(state.nextPhysicalAddr).not.toBe(addr);
    expect(state.activeBreakpoint, 'resume must not remove persistent breakpoint').toBe(true);
    expect(state.running).toBe(false);
}

async function assertRunCanResume(page, addr, initialStepCount) {
    await page.locator('#btnRunSim').click();
    await expect.poll(
        () => page.evaluate(() => sim.stepCount),
        { timeout: 10000 }
    ).toBeGreaterThan(initialStepCount);
    expect(
        await page.evaluate(target => simBreakpoints.has(target), addr),
        'Run resume must not remove persistent breakpoint'
    ).toBe(true);
}

async function assertUiResumeThenRunRebreaks(page, addr, initialStepCount, resumeMode) {
    const pausedContext = await page.evaluate(() => ({
        pc: sim.pc,
        cr14: { ...sim.cr[14] },
    }));
    if (resumeMode === 'Walk') {
        await page.locator('#toolWalkBtn').click();
    } else {
        await page.locator('#toolStepBtn').click();
    }
    await expect.poll(
        () => page.evaluate(() => sim.stepCount),
        { timeout: 10000 }
    ).toBeGreaterThan(initialStepCount);
    if (resumeMode === 'Walk') await page.evaluate(() => finishWalk());

    const beforeReturn = await page.evaluate(context => {
        sim.pc = context.pc;
        sim.cr[14] = { ...context.cr14 };
        sim.halted = false;
        return sim.stepCount;
    }, pausedContext);
    expect(await page.evaluate(() => sim._nextPhysicalAddr())).toBe(addr);

    await page.locator('#btnRunSim').click();
    await expect.poll(() => page.evaluate(() => sim.running), { timeout: 10000 }).toBe(false);
    const state = await page.evaluate(() => ({
        stepCount: sim.stepCount,
        nextPhysicalAddr: sim._nextPhysicalAddr(),
    }));
    expect(state.stepCount, 'Run must pause again after returning to the armed address').toBe(beforeReturn);
    expect(state.nextPhysicalAddr).toBe(addr);
}

async function assertRunResumeThenUiRebreaks(page, addr, initialStepCount, resumeMode) {
    const pausedContext = await page.evaluate(() => ({
        pc: sim.pc,
        cr14: { ...sim.cr[14] },
    }));
    const runResult = await page.evaluate(() => sim.run(1, simBreakpoints));
    expect(runResult.steps).toBe(1);
    expect(runResult.stopReason).toBe('maxSteps');
    expect(await page.evaluate(() => sim.stepCount)).toBeGreaterThan(initialStepCount);

    const beforeReturn = await page.evaluate(context => {
        sim.pc = context.pc;
        sim.cr[14] = { ...context.cr14 };
        sim.halted = false;
        return sim.stepCount;
    }, pausedContext);
    if (resumeMode === 'Walk') {
        await page.locator('#toolWalkBtn').click();
    } else {
        await page.locator('#toolStepBtn').click();
    }
    await expect.poll(() => page.evaluate(() => walkRunning), { timeout: 10000 }).toBe(false);
    const state = await page.evaluate(() => ({
        stepCount: sim.stepCount,
        nextPhysicalAddr: sim._nextPhysicalAddr(),
    }));
    expect(state.stepCount, `${resumeMode} must pause after Run returns to the armed address`).toBe(beforeReturn);
    expect(state.nextPhysicalAddr).toBe(addr);
}

for (const mode of ['Step', 'Walk', 'Run']) {
    test(`physical breakpoint pauses before SelfTest when started with ${mode}`, async ({ page }) => {
        test.setTimeout(60000);
        // This suite validates software-simulator controls only. Live board
        // events can update CR14 asynchronously and invalidate the fixture.
        await page.route('**/hardware/wukong/status', route => route.abort());
        await page.route('**/hardware/wukong/events**', route => route.abort());
        await page.route('**/hardware/wukong/boot-info', route => route.abort());
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
        if (mode === 'Run') {
            await assertRunCanResume(page, targetAddr, initialStepCount);
        } else if (mode === 'Step') {
            await assertUiResumeThenRunRebreaks(page, targetAddr, initialStepCount, mode);
        } else {
            await assertRunResumeThenUiRebreaks(page, targetAddr, initialStepCount, mode);
        }
    });
}