'use strict';

// Browser regression for the shared physical-breakpoint contract:
// every execution control must stop before the same SelfTest instruction, and
// a normal breakpoint must remain armed after it fires.

const { test, expect } = require('@playwright/test');
const { loadSimulator } = require('./helpers/simulator');

function formatAddress(addr) {
    return `0x${addr.toString(16).toUpperCase().padStart(4, '0')}`;
}

async function isolateSoftwareSimulator(page) {
    await page.route('**/hardware/wukong/status', route => route.abort());
    await page.route('**/hardware/wukong/events**', route => route.abort());
    await page.route('**/hardware/wukong/boot-info', route => route.abort());
}

async function installLazyRetryFixture(page) {
    return page.evaluate(async () => {
        const codeSlot = 30;
        const lazySlot = 31;
        const codeBase = 0x3000;
        const lumpSize = 64;
        const clistBase = codeBase + lumpSize - 1;
        const cacheToken = 0xB16B00B5;
        const dotName = 'Breakpoint.Lazy';
        const issueN = 1;

        const payload = new Array(lumpSize).fill(0);
        payload[0] = sim.packLumpHeader(0, 4, 2, 0);
        for (let i = 1; i <= 4; i++) {
            payload[i] = sim.encodeInstruction(3, 14, 0, 0, 0);
        }

        const wordsToBytes = words => {
            const bytes = new Uint8Array(words.length * 4);
            const view = new DataView(bytes.buffer);
            words.forEach((word, index) => view.setUint32(index * 4, word >>> 0, false));
            return bytes;
        };
        const hashHex = async bytes => {
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            return Array.from(new Uint8Array(digest))
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join('');
        };
        const binaryHash = await hashHex(wordsToBytes(payload));
        const identityHash = await hashHex(new TextEncoder().encode(`${dotName}#${issueN}`));

        sim.withNamespaceWrite('breakpoint lazy-download e2e fixture', () => {
            sim.writeNSEntry(codeSlot, codeBase, lumpSize - 1, 0, 0, 1, 0, 1, 0);
            sim.writeNSEntry(lazySlot, 0, lumpSize - 3, 0, 0, 2, 0, 2, cacheToken);
        });
        sim.nsCount = Math.max(sim.nsCount, lazySlot + 1);
        sim.nsLabels[codeSlot] = 'BreakpointCaller';
        sim.nsLabels[lazySlot] = dotName;

        sim.memory.fill(0, codeBase, codeBase + lumpSize);
        sim.memory[codeBase] = sim.packLumpHeader(0, 2, 1, 0);
        sim.memory[codeBase + 1] = sim.encodeInstruction(0, 14, 3, 6, 0);
        sim.memory[codeBase + 2] = sim.encodeInstruction(0, 15, 0, 0, 0);

        const codeEntry = sim.readNSEntry(codeSlot);
        const codeSeq = sim.parseNSWord1(codeEntry.word1_limit).gtSeq;
        const lazyEntry = sim.readNSEntry(lazySlot);
        const lazySeq = sim.parseNSWord1(lazyEntry.word1_limit).gtSeq;
        const outformGT = sim.createGT(lazySeq, lazySlot, { E: 1 }, 2);
        sim.memory[clistBase] = outformGT;
        sim._nsClistCount[codeSlot] = 1;

        sim.registerSlotIdentity(lazySlot, {
            cacheToken,
            dotName,
            issueN,
            identityHash,
            binaryHash,
            grants: ['E'],
            capabilityType: 2,
            authorized: true,
            outformWords: [
                lazyEntry.word1_limit,
                lazyEntry.word2_seals,
                cacheToken,
            ],
            gtSeq: lazySeq,
        }, { secure: true });

        const codeGT = sim.createGT(codeSeq, codeSlot, { R: 1, X: 1 }, 1);
        const clistGT = sim.createGT(codeSeq, codeSlot, { L: 1 }, 1);
        sim.cr[14] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
        sim.cr[6] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
        sim._writeCR(14, codeGT, codeEntry);
        sim._writeCR(6, clistGT, codeEntry);
        sim.cr[6].word1 = clistBase;
        sim.pc = 0;
        sim.physicalPC = codeBase + 1;
        sim.halted = false;
        sim.running = false;
        sim.awaitingLump = null;
        sim._breakpointResumeAddr = null;
        sim.faultLog = [];

        const retryAddr = sim._nextPhysicalAddr();
        const initialStepCount = sim.stepCount;
        const initialSuccessful = sim.executionStats.successful;
        const framed = [sim._crc32Words(payload), ...payload];
        return {
            retryAddr,
            initialStepCount,
            initialSuccessful,
            token: sim._outformToken96(lazyEntry),
            cacheTokenHex: cacheToken.toString(16).padStart(8, '0'),
            dotName,
            issueN,
            identityHash,
            binaryHash,
            body: Array.from(wordsToBytes(framed)),
            lazySlot,
        };
    });
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
        await isolateSoftwareSimulator(page);
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

test('one-shot breakpoint pauses before a lazy-load retry and is consumed once', async ({ page }) => {
    test.setTimeout(60000);
    await isolateSoftwareSimulator(page);
    await loadSimulator(page);

    const fixture = await installLazyRetryFixture(page);
    let releaseLazyRequest;
    const lazyRequest = new Promise(resolve => { releaseLazyRequest = resolve; });
    await page.route(`**/api/lump/${fixture.token}`, route => {
        releaseLazyRequest(route);
    });

    await page.locator('#toolStepBtn').click();
    const pendingRoute = await lazyRequest;
    await expect.poll(
        () => page.evaluate(() => sim.awaitingLump !== null),
        { timeout: 10000 }
    ).toBe(true);
    await page.evaluate(() => {
        const checkbox = document.getElementById('breakAtEntryChk');
        checkbox.checked = true;
        _setEntryBreakpoint();
        checkbox.checked = false;
    });
    await expect(page.locator('#breakList .break-item')).toHaveCount(1);

    await pendingRoute.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: {
            'X-Lump-Source': 'local',
            'X-Lump-Cache-Token': fixture.cacheTokenHex,
            'X-Lump-Dot-Name': fixture.dotName,
            'X-Lump-Issue-N': String(fixture.issueN),
            'X-Lump-Identity-Hash': fixture.identityHash,
            'X-Lump-Binary-Hash': fixture.binaryHash,
            'X-Lump-Trust': 'canonical',
        },
        body: Buffer.from(fixture.body),
    });

    await expect(page.locator('#editorConsole')).toContainText(
        `Breakpoint at ${formatAddress(fixture.retryAddr)} before lazy-load retry`,
        { timeout: 10000 }
    );
    const paused = await page.evaluate(({ retryAddr, lazySlot }) => ({
        nextPhysicalAddr: sim._nextPhysicalAddr(),
        stepCount: sim.stepCount,
        successful: sim.executionStats.successful,
        pc: sim.pc,
        persistentArmed: simBreakpoints.has(retryAddr),
        oneShotArmed: _oneShotBreakpoints.has(retryAddr),
        loadedType: sim.readNSEntry(lazySlot).gtType,
        destinationGT: sim.cr[3].word0 >>> 0,
    }), fixture);

    expect(paused.nextPhysicalAddr).toBe(fixture.retryAddr);
    expect(paused.stepCount, 'only the suspended fetch attempt is counted before retry')
        .toBe(fixture.initialStepCount + 1);
    expect(paused.successful, 'the retry instruction must not retire before pausing')
        .toBe(fixture.initialSuccessful);
    expect(paused.pc).toBe(0);
    expect(paused.persistentArmed, 'the fired one-shot must leave the live set').toBe(false);
    expect(paused.oneShotArmed, 'the one-shot marker must be consumed with the pause').toBe(false);
    expect(paused.loadedType, 'the download must finish before the retry breakpoint').toBe(1);
    expect(paused.destinationGT, 'LOAD has not populated its destination yet').toBe(0);
    await expect(page.locator('#breakList .break-item')).toHaveCount(0);

    await page.locator('#toolStepBtn').click();
    await expect.poll(() => page.evaluate(() => sim.stepCount), { timeout: 10000 })
        .toBe(fixture.initialStepCount + 2);
    const resumed = await page.evaluate(lazySlot => ({
        pc: sim.pc,
        successful: sim.executionStats.successful,
        destinationType: sim.parseGT(sim.cr[3].word0).type,
        destinationSlot: sim.parseGT(sim.cr[3].word0).index,
    }), fixture.lazySlot);
    expect(resumed.pc).toBe(1);
    expect(resumed.successful).toBe(fixture.initialSuccessful + 1);
    expect(resumed.destinationType).toBe(1);
    expect(resumed.destinationSlot).toBe(fixture.lazySlot);
});

test('Run honors a breakpoint added between asynchronous batches', async ({ page }) => {
    test.setTimeout(60000);
    await isolateSoftwareSimulator(page);
    await loadSimulator(page);

    await page.evaluate(() => {
        runBatchSize = 1;
        window.__midBatchBreakpoint = null;
        const originalRun = sim.run.bind(sim);
        sim.run = function(maxSteps, breakpoints) {
            const result = originalRun(maxSteps, breakpoints);
            if (!window.__midBatchBreakpoint && result.stopReason === 'maxSteps') {
                const addr = sim._nextPhysicalAddr();
                const stepCount = sim.stepCount;
                addBreakpoint(addr);
                window.__midBatchBreakpoint = { addr, stepCount };
            }
            return result;
        };
    });

    await page.locator('#btnRunSim').click();
    await expect.poll(
        () => page.evaluate(() => window.__midBatchBreakpoint),
        { timeout: 10000 }
    ).not.toBeNull();
    await expect.poll(
        () => page.evaluate(() => _simRunActive),
        { timeout: 10000 }
    ).toBe(false);

    const state = await page.evaluate(() => ({
        injected: window.__midBatchBreakpoint,
        stepCount: sim.stepCount,
        nextPhysicalAddr: sim._nextPhysicalAddr(),
        running: sim.running,
        activeBreakpoint: window.__midBatchBreakpoint
            ? simBreakpoints.has(window.__midBatchBreakpoint.addr)
            : false,
    }));
    expect(state.injected, 'the first Run batch must install the test breakpoint').not.toBeNull();
    expect(state.stepCount, 'the next batch must pause before executing its instruction')
        .toBe(state.injected.stepCount);
    expect(state.nextPhysicalAddr).toBe(state.injected.addr);
    expect(state.running).toBe(false);
    expect(state.activeBreakpoint).toBe(true);
    await expect(page.locator('#editorConsole')).toContainText(
        `Breakpoint at ${formatAddress(state.injected.addr)}`
    );
});
