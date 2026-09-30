'use strict';
// Browser-only read-only check. Run only against an isolated test server with
// CHURCH_TEST_ISOLATED_MODE and all CHURCH_TEST_* fixture paths set.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const fixturePaths = ['CHURCH_TEST_LUMPS_DIR', 'CHURCH_TEST_BOOT_CONFIG_PATH',
    'CHURCH_TEST_BUILD_SNAPSHOTS_DIR', 'CHURCH_TEST_DB_PATH'];
const production = fs.realpathSync(path.resolve(__dirname, '..', '..', 'server'));
if (!['1', 'true', 'yes', 'on'].includes(String(process.env.CHURCH_TEST_ISOLATED_MODE).toLowerCase()) ||
        fixturePaths.some(key => !process.env[key] || !fs.existsSync(process.env[key]) ||
            !path.relative(production, fs.realpathSync(process.env[key])).startsWith('..'))) {
    throw new Error('Save LUMP picker browser test requires isolated fixture paths outside server/');
}

test('Save LUMP shows only committed destinations and reopens Alice in place without writes', async ({ page }, testInfo) => {
    const committed = {
        namespaceFingerprint: 'test-committed-snapshot',
        abstractions: Array.from({ length: 16 }, (_, slot) => ({
            slot,
            name: slot === 14 ? 'ide.Alice' : slot === 15 ? 'ide.Mallory' :
                slot === 0 ? 'Boot.NS' : slot === 1 ? 'Boot.Thread' : `NS${slot}`,
            token: slot === 14 ? '4730c311' : `fixture-token-${slot}`,
        })),
    };
    const rejectedWrites = [];
    const blockedHardware = [];
    await page.route('**/api/**', route => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
            rejectedWrites.push(route.request().url());
            return route.abort();
        }
        return route.continue();
    });
    await page.route('**/*', route => {
        const url = route.request().url();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
            rejectedWrites.push(url);
            return route.abort();
        }
        if (/(hardware|wukong|fpga|devices|serial|usb|call-home|flash)/i.test(url)) {
            blockedHardware.push(url);
            return route.abort();
        }
        return route.continue();
    });
    await page.route('**/api/boot-image/ns-state', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committed) }));
    await page.goto('/simulator/index.html');
    await page.waitForFunction(() => typeof showSaveToNamespace === 'function' &&
        typeof sim !== 'undefined' && !!sim && Number.isInteger(sim.MAX_NS_ENTRIES) &&
        !!document.getElementById('saveNSDialog'));
    // Only measure the modal operation; startup calls are outside this test.
    rejectedWrites.length = 0;
    await page.evaluate(() => {
        window.ChurchIDX1IDE = null;
        window._pendingLumpData = null;
        window.bootConfig = window.bootConfig || {};
        window.bootConfig.slotLabels = { 14: 'Bridge.Preload', 16: 'Policy.Probe', 17: 'Ghost' };
        window.LumpRegistry = {
            getCurrent: () => 'new-compiled-token',
            resolve: () => ({ sources: { memory: { words: [1, 2] } } }),
        };
        window._captureLumpSaveSnapshot = () => ({
            words: [1, 2], token: 'new-compiled-token',
            editorBaseIdentity: { token: '4730c311', abstraction: 'ide.Alice' },
        });
        showSaveToNamespace();
    });
    await expect(page.locator('#saveNSSlot')).toBeEnabled();
    await expect(page.locator('#saveNSConfirmBtn')).toBeEnabled();
    await expect(page.locator('#saveNSSlot')).toHaveValue('14');
    await expect(page.locator('#saveNSLabel')).toHaveValue('ide.Alice');
    const picker = await page.locator('#saveNSSlot option').evaluateAll(options =>
        options.map(option => ({ value: option.value, label: option.textContent, disabled: option.disabled })));
    expect(picker).toHaveLength(17);
    expect(picker[15]).toEqual({ value: '14', label: '[14] ide.Alice', disabled: false });
    expect(picker[16]).toEqual({ value: '15', label: '[15] ide.Mallory', disabled: false });
    expect(picker[1].disabled).toBe(true);
    expect(picker[2].disabled).toBe(true);
    expect(picker.slice(3).every(option => !option.disabled)).toBe(true);
    expect(picker.some(option => ['16', '17'].includes(option.value))).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('save-lump-picker-authority.png') });
    await page.locator('#saveNSCancelBtn').click();
    await expect(page.locator('#saveNSDialog')).toBeHidden();
    expect(await page.evaluate(() => window.bootConfig.slotLabels)).toEqual({
        14: 'Bridge.Preload', 16: 'Policy.Probe', 17: 'Ghost',
    });
    expect(rejectedWrites.filter(url => !url.endsWith('/api/browser-diagnostics'))).toEqual([]);
});