'use strict';

const { test, expect } = require('@playwright/test');

const trigger = '#lumpThreadPanel #btnThreadHeapRecord';
const config = { step1: { totalNamespaceWords: 16384, namespaceLumpWords: 1024,
    threadLumpWords: 256, threadCount: 3 } };

async function setup(page, { delayedReference = false } = {}) {
    const writes = [];
    // No dependency on live saved LUMPs, board connections, or server writes.
    await page.route('**/api/**', async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (!['GET', 'HEAD'].includes(request.method())) writes.push(path);
        let body = {};
        if (path === '/api/boot-config') body = config;
        if (path === '/api/boot-image/ns-state') body = { abstractions: [] };
        if (path === '/api/lumps/list') body = [];
        await route.fulfill({ status: path === '/api/boot-image/binary' ? 503 : 200,
            contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route('**/hardware/**', route => route.fulfill({
        contentType: 'application/json', body: '{}'
    }));
    // Hold the actual reference script, not the render function. This exercises
    // the real retry timer and asynchronous DOM replacement.
    let releaseReference;
    if (delayedReference) {
        const gate = new Promise(resolve => { releaseReference = resolve; });
        await page.route('**/thread_tutorial.js*', async route => {
            await gate;
            await route.continue();
        });
    }
    await page.addInitScript(() => {
        localStorage.setItem('church_whatsnew_dismissed_perm', '1');
        localStorage.setItem('churchMachine_autoBootOnOpen', '0');
        localStorage.setItem('church_builderTab', 'lump-thread');
    });
    await page.goto('/simulator/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof sim !== 'undefined' && sim &&
        typeof switchView === 'function' && window.ThreadHeapRecord && window.TargetState);
    // Use the real navigation guards throughout; never stub switchView or
    // editor ownership/consent checks to force navigation to succeed.
    await page.evaluate(() => switchView('builder'));
    await expect(page.locator('#builder')).toBeVisible();
    await page.locator('#builderViewTab-lump-thread').click();
    await expect(page.locator(trigger)).toBeVisible();
    await page.evaluate(fixtureConfig => {
        window.bootConfig = fixtureConfig;
        sim = new ChurchSimulator();
        const t = sim.getThreadInstanceLayout(11);
        sim.cr[12] = {word0: sim.createGT(0, 11, {R:1, W:1}, 2),
            word1:t.base, word2:255, word3:0, m:0};
        sim.cr[5] = {word0: sim.createGT(0, 11, {R:1, W:1}, 1),
            word1:t.base + t.heapStart, word2:t.heapWords - 1, word3:0, m:0};
        TargetState.select({mode: TargetState.MODES.SIMULATOR});
        window.heapForbiddenCalls = [];
        const forbid = (owner, name) => {
            if (typeof owner[name] !== 'function') return;
            owner[name] = () => {
                heapForbiddenCalls.push(name);
                throw new Error('Unexpected mutation: ' + name);
            };
        };
        ['reservePool', 'allocate', 'release', 'importRecord', 'updateRecord']
            .forEach(name => forbid(ThreadHeapRecord, name));
        ['lumpEditorSaveThread', 'lumpEditorPostStep1', 'compileAndBuild',
            'saveEditorState', 'resetSim', 'instantBoot', 'slowBoot',
            'uploadToTang', 'downloadHardwareImage'].forEach(name => forbid(window, name));
        ['loadProgram', 'prepareThread', 'boot', 'reset', 'writeNSEntry']
            .forEach(name => forbid(sim, name));
        window.heapSnapshot = () => JSON.stringify({
            memory: Array.from(sim.memory), cr: sim.cr, dr: sim.dr,
            pc: sim.pc, running: sim.running, walkActive: sim.walkActive,
            run: _simRunActive, walk: walkRunning, boot: bootAnimating,
            target: TargetState.resolve(), editor: document.getElementById('asmEditor').value,
            bootConfig: window.bootConfig
        });
    }, config);
    writes.length = 0;
    return { writes, releaseReference };
}

async function assertReadOnly(page, before, writes) {
    expect(await page.evaluate(() => heapSnapshot())).toBe(before);
    expect(await page.evaluate(() => heapForbiddenCalls)).toEqual([]);
    expect(writes).toEqual([]);
}

test('Thread design owns the action through delayed reference, settings, navigation and refresh', async ({ page }) => {
    const { writes, releaseReference } = await setup(page, { delayedReference: true });
    await expect(page.locator('#lumpThreadPanel .le-design-loading')).toBeVisible();
    await expect(page.locator('#threadHeapRecordContext')).toContainText('not the saved/build design');
    const before = await page.evaluate(() => heapSnapshot());
    await page.locator(trigger).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', {name: 'Thread heap call record'})).toBeVisible();
    await expect(page.locator('#thrOffset')).toBeFocused();
    await expect(page.locator('#thrAllocations')).toContainText('No pool reserved');
    await expect(page.locator('#thrStatus')).toContainText('writes nothing');
    // A repeated opener and replacement trigger must not create a second modal.
    await page.evaluate(() => openThreadHeapRecord(document.getElementById('btnThreadHeapRecord')));
    releaseReference();
    await expect(page.locator('#lumpThreadPanel .le-design-step').first()).toBeVisible();
    await expect(page.locator('.thr-backdrop')).toHaveCount(1);
    const close = page.getByRole('button', {name: 'Close dialog', exact: true});
    await close.focus();
    await page.keyboard.press('Shift+Tab');
    // Shared code-block enhancement can append a Copy button after the source.
    // The trap must wrap to the current last focusable, not a hardcoded node.
    expect(await page.evaluate(() => {
        const controls = Array.from(document.querySelectorAll(
            '.thr-dialog button,.thr-dialog input,.thr-dialog textarea,.thr-dialog [tabindex]'
        )).filter(n => !n.disabled && n.offsetParent !== null);
        return document.activeElement === controls[controls.length - 1];
    })).toBe(true);
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.thr-backdrop')).toHaveCount(0);
    await expect(page.locator(trigger)).toBeFocused();
    await assertReadOnly(page, before, writes);

    // A real settings handler rerenders, including while a dialog is open.
    await page.locator('#le-t-lump-sel').selectOption('9');
    await expect(page.locator(trigger)).toBeVisible();
    await page.locator(trigger).click();
    await page.evaluate(() => lumpEditorThreadLumpSize(8));
    await close.click();
    await expect(page.locator(trigger)).toBeFocused();
    await page.locator('#builderViewTab-lump-ns').click();
    await expect(page.locator('#lumpNSPanel')).toBeVisible();
    await expect(page.locator('#lumpNSPanel [onclick*="openThreadHeapRecord"]')).toHaveCount(0);
    await page.locator('#builderViewTab-lump-thread').click();
    await page.locator(trigger).click();
    await page.locator('.thr-backdrop').click({position: {x: 2, y: 2}});
    await expect(page.locator('.thr-backdrop')).toHaveCount(0);
    await expect(page.locator(trigger)).toBeFocused();

    // Inspect the actual Code DOM at desktop and mobile widths, including its
    // Actions menu, not just whether the old controls happen to be hidden.
    await page.evaluate(() => switchView('editor'));
    await expect(page.locator('#editor')).toBeVisible();
    for (const width of [1280, 390]) {
        await page.setViewportSize({width, height: 900});
        await expect(page.locator('#editor [onclick*="openThreadHeapRecord"]')).toHaveCount(0);
        await expect(page.locator('#editor button').filter({hasText: /heap record/i})).toHaveCount(0);
    }
    await page.evaluate(() => switchView('builder'));
    await page.locator('#builderViewTab-lump-thread').click();
    await page.locator(trigger).click();
    await expect(page.locator('#thrOffset')).toBeFocused();
    await close.click();
    await expect(page.locator(trigger)).toBeFocused();
    await assertReadOnly(page, before, writes);
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => typeof switchView === 'function');
    await page.evaluate(() => switchView('builder'));
    await page.locator('#builderViewTab-lump-thread').click();
    await page.locator(trigger).click();
    await expect(page.locator('.thr-backdrop')).toHaveCount(1);
    await close.click();
    await expect(page.locator(trigger)).toBeFocused();
});

test('opening and closing never correct unsafe runtime or hardware target states', async ({ page }) => {
    const { writes } = await setup(page);
    for (const state of ['missing', 'running', 'walkActive', 'run', 'walk', 'boot', 'runtime', 'bitstream']) {
        await page.evaluate(state => {
            if (!window.heapOriginalCR5) window.heapOriginalCR5 = {...sim.cr[5]};
            sim.cr[5] = {...heapOriginalCR5};
            sim.running = state === 'running';
            sim.walkActive = state === 'walkActive';
            _simRunActive = state === 'run';
            walkRunning = state === 'walk';
            bootAnimating = state === 'boot';
            if (state === 'missing') sim.cr[5].word0 = 0;
            TargetState.select({mode: state === 'runtime' ? TargetState.MODES.RUNTIME :
                state === 'bitstream' ? TargetState.MODES.BITSTREAM : TargetState.MODES.SIMULATOR});
        }, state);
        const before = await page.evaluate(() => heapSnapshot());
        await page.locator(trigger).click();
        const refusal = state === 'missing' ? /No active Thread/ :
            ['runtime', 'bitstream'].includes(state) ? /select Simulator RAM/ : /Pause Run, Walk, and Boot/;
        await expect(page.locator('#thrAllocations')).toContainText(refusal);
        await page.getByRole('button', {name: 'Read current', exact: true}).click();
        await expect(page.locator('#thrStatus')).toContainText(refusal);
        await page.keyboard.press('Escape');
        await expect(page.locator(trigger)).toBeFocused();
        await assertReadOnly(page, before, writes);
    }
});

test('source preview and downloads remain read-only at the new location', async ({ page }) => {
    const { writes } = await setup(page);
    const before = await page.evaluate(() => heapSnapshot());
    await page.locator(trigger).click();
    await page.getByRole('button', {name: 'Preview', exact: true}).click();
    await expect(page.locator('#thrSource')).toContainText('abstraction ide.CallRecord');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Download .cloomc', exact: true}).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('thread-heap-record-0.cloomc');
    await page.getByRole('button', {name: 'Close dialog', exact: true}).click();
    await assertReadOnly(page, before, writes);
});
