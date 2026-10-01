'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const keys = ['CHURCH_TEST_LUMPS_DIR', 'CHURCH_TEST_BOOT_CONFIG_PATH',
    'CHURCH_TEST_BUILD_SNAPSHOTS_DIR', 'CHURCH_TEST_DB_PATH'];
const production = fs.realpathSync(path.resolve(__dirname, '../../server'));
if (process.env.CHURCH_TEST_ISOLATED_MODE !== '1' || keys.some(key =>
    !process.env[key] || !fs.existsSync(process.env[key]) ||
    !path.relative(production, fs.realpathSync(process.env[key])).startsWith('..'))) {
    throw new Error('Namespace inspector browser checks require all four isolated fixture paths');
}
const hash = file => fs.existsSync(file)
    ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;

test('inspect and cancel are read-only; reviewed design correction preserves slot and other deliverables', async ({ page }, testInfo) => {
    test.setTimeout(90000);
    const stateFile = path.join(process.env.CHURCH_TEST_LUMPS_DIR, 'ns-state.json');
    const original = JSON.parse(fs.readFileSync(stateFile));
    const target = original.abstractions.find(r => r.symbolic && r.resident && r.selection);
    test.skip(!target, 'Isolated library fixture needs a mixed design/executable assignment');
    const protectedFiles = ['boot-image.bin', 'boot-image.provenance.json']
        .map(name => path.join(process.env.CHURCH_TEST_LUMPS_DIR, name))
        .concat(process.env.CHURCH_TEST_BOOT_CONFIG_PATH);
    const before = protectedFiles.map(hash);
    const mutations = [];
    await page.route('**/*', route => {
        const request = route.request();
        if (/(hardware|wukong|fpga|serial|usb|flash)/i.test(request.url())) return route.abort();
        if (!['GET', 'HEAD'].includes(request.method())) mutations.push(request.url());
        return route.continue();
    });
    await page.goto('/simulator/index.html#namespace');
    await page.waitForFunction(() => !!window.NamespaceInspector);
    const inspector = page.locator('#namespaceInspector');
    mutations.length = 0;
    const stateHash = hash(stateFile);
    await page.evaluate(slot => NamespaceInspector.open(slot), target.slot);
    await expect(inspector).toContainText(target.name);
    await expect(inspector).toContainText(target.selection.filename);
    await expect(inspector.locator('.ns-inspector-issues').first()).toContainText('Next action:');
    await expect(inspector.locator('.ns-inspector-issues details[open]')).toHaveCount(0);
    await expect(inspector.locator('.ns-inspector-limitations li').first()).toBeVisible();
    await page.screenshot({ path: '/tmp/namespace-inspector-opened.png' });
    await page.setViewportSize({ width: 1024, height: 576 });
    await inspector.locator('[data-scroll]').evaluate(el => { el.scrollTop = el.scrollHeight; });
    const bounds = await inspector.evaluate(el => {
        const close = el.querySelector('[data-close]').getBoundingClientRect();
        const apply = el.querySelector('[data-apply]').getBoundingClientRect();
        return { closeTop: close.top, closeBottom: close.bottom,
            applyTop: apply.top, applyBottom: apply.bottom, height: innerHeight };
    });
    expect(bounds.closeTop).toBeGreaterThanOrEqual(0);
    expect(bounds.closeBottom).toBeLessThanOrEqual(bounds.height);
    expect(bounds.applyTop).toBeGreaterThanOrEqual(0);
    expect(bounds.applyBottom).toBeLessThanOrEqual(bounds.height);
    await page.screenshot({ path: '/tmp/namespace-inspector-compact.png' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await inspector.locator('[data-close]').click();
    expect(hash(stateFile)).toBe(stateHash);
    expect(mutations.filter(url => /\/api\/namespace\//.test(url))).toEqual([]);
    await page.evaluate(slot => NamespaceInspector.open(slot), target.slot);
    await inspector.locator('[data-action]').selectOption('keep-design');
    await inspector.locator('[data-preview]').click();
    await expect(inspector.locator('[data-apply]')).toBeEnabled();
    await expect(inspector.locator('[data-review]')).toContainText('REMOVED');
    await expect(inspector.locator('[data-review]')).toContainText('(absent)');
    expect(hash(stateFile)).toBe(stateHash);
    await inspector.locator('[data-review]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('namespace-inspector-reviewed.png') });
    await page.screenshot({ path: '/tmp/namespace-inspector-reviewed.png' });
    await inspector.locator('[data-apply]').click();
    await page.getByRole('button', { name: 'Confirm this change', exact: true }).click();
    await expect(inspector.locator('[data-status]')).toContainText('correction saved');
    const updated = JSON.parse(fs.readFileSync(stateFile)).abstractions;
    const repaired = updated.find(r => r.slot === target.slot);
    expect(repaired.name).toBe(target.name);
    expect(repaired.seq).toBe(target.seq);
    expect(repaired.selection).toEqual(target.selection);
    expect(repaired.resident).not.toBe(true);
    expect(repaired.filename).toBeUndefined();
    expect(updated.filter(r => r.slot !== target.slot)).toEqual(original.abstractions.filter(r => r.slot !== target.slot));
    expect(protectedFiles.map(hash)).toEqual(before);
});