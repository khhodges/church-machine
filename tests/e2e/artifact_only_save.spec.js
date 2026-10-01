'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const fixtureKeys = ['CHURCH_TEST_LUMPS_DIR', 'CHURCH_TEST_BOOT_CONFIG_PATH',
    'CHURCH_TEST_BUILD_SNAPSHOTS_DIR', 'CHURCH_TEST_DB_PATH'];
const serverRoot = fs.realpathSync(path.resolve(__dirname, '../../server'));
if (process.env.CHURCH_TEST_ISOLATED_MODE !== '1' ||
    fixtureKeys.some(key => !process.env[key] || !fs.existsSync(process.env[key]) ||
        !path.relative(serverRoot, fs.realpathSync(process.env[key])).startsWith('..'))) {
    throw new Error('Artifact-only save browser test requires all four private isolated fixture paths');
}
const retained = () => ['ns-state.json', 'boot-image.bin', 'boot-image.provenance.json']
    .map(name => path.join(process.env.CHURCH_TEST_LUMPS_DIR, name))
    .concat(process.env.CHURCH_TEST_BOOT_CONFIG_PATH)
    .map(file => [file, fs.existsSync(file)
        ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null]);

test('programmer publishes via real review without assigning or installing', async ({ page }) => {
    test.setTimeout(90000);
    const before = retained();
    const forbidden = [];
    await page.route('**/*', route => {
        const request = route.request();
        const url = request.url();
        if (/(hardware|wukong|fpga|serial|usb|flash)/i.test(url)) return route.abort();
        if (request.method() === 'POST' && /\/api\/(boot-image|simulation)\//.test(url)) {
            forbidden.push(url);
            return route.abort();
        }
        return route.continue();
    });
    await page.addInitScript(() => {
        localStorage.setItem('church_welcome_dismissed_perm', '1');
        sessionStorage.setItem('church_welcome_dismissed_session', '1');
    });
    await page.goto('/simulator/index.html');
    await page.waitForFunction(() => typeof showSaveToNamespace === 'function' &&
        typeof assembleAndLoad === 'function' && typeof sim !== 'undefined' && !!sim);
    const name = `ArtifactOnly${Date.now()}`;
    await page.evaluate(() => {
        switchView('editor');
        document.getElementById('asmEditor').value = 'HALT';
        const result = assembleAndLoad({ source: 'HALT', languageIdentity: 'assembly' });
        if (!result || !result.ok) throw new Error('Fixture compilation failed: ' + JSON.stringify(result));
        showSaveToNamespace();
    });
    const runtimeBefore = await page.evaluate(() => ({
        memory: Array.from(sim.memory), labels: sim.nsLabels,
        configuration: sim.simulationConfiguration || null
    }));
    await expect(page.locator('#saveNSSlot')).toHaveCount(0);
    await expect(page.locator('#saveNSType')).toHaveCount(0);
    await page.locator('#saveNSLabel').fill(name);
    const planResponse = page.waitForResponse(r => r.url().endsWith('/api/lumps/save-plan'));
    await page.locator('#saveNSConfirmBtn').click();
    const plan = await (await planResponse).json();
    expect(plan.error).toBeUndefined();
    expect(plan.ns_slot).toBeNull();
    await expect(page.locator('#saveNSConfirmBtn')).toHaveText('Approve & Save');
    const committed = page.waitForResponse(r =>
        r.url().endsWith('/api/lumps/save') && r.status() === 200);
    // Attach a handler immediately so a fast validation failure is reported
    // from the dialog rather than as an unhandled late commit timeout.
    committed.catch(() => {});
    const approvalResponse = page.waitForResponse(r =>
        r.url().endsWith('/api/lumps/approval-intent'), { timeout: 15000 });
    await page.locator('#saveNSConfirmBtn').click();
    const approval = await approvalResponse.catch(async error => {
        throw new Error(`Approval did not complete: ${await page.locator('#saveNSStatus').textContent()}. ${error.message}`);
    });
    expect(approval.ok(), JSON.stringify(await approval.json())).toBe(true);
    const protectedReview = page.getByRole('button', { name: 'Confirm this change', exact: true });
    if (await protectedReview.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false)) {
        await protectedReview.click();
    }
    const response = await committed;
    expect((await response.json()).ns_slot).toBeNull();
    const metadata = response.request().postDataJSON().metadata;
    expect(metadata.artifact_only).toBe(true);
    for (const key of ['ns_slot', 'new_entry', 'namespaceFingerprint', 'ns_slot_policy'])
        expect(metadata[key]).toBeUndefined();
    await expect(page.locator('#saveNSDialog')).toBeHidden();
    expect(await page.evaluate(() => ({
        memory: Array.from(sim.memory), labels: sim.nsLabels,
        configuration: sim.simulationConfiguration || null
    }))).toEqual(runtimeBefore);
    expect(retained()).toEqual(before);
    expect(forbidden).toEqual([]);
});