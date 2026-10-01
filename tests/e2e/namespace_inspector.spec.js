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
    // Seed only the guarded disposable fixture, independent of the user's
    // current Mallory intent. Never skip the regression after live data changes.
    const selected = original.abstractions.find(r => r.slot === 15 && r.filename) ||
        original.abstractions.find(r => r.slot > 5 && r.filename && !r.boot);
    if (!selected) throw new Error('Private fixture requires one exact saved artifact reference');
    const target = { ...selected, slot: 15, name: 'InspectorDesignFixture',
        seq: 0, location: '0x00000000', limit: '0x00000',
        symbolic: true, implementationMissing: true, resident: true, load_policy: 'Resident',
        selection: { filename: selected.filename, token: selected.token,
            binaryHash: selected.binary_hash, status: 'unresolved',
            diagnostic: 'Private inspector design selection fixture' } };
    delete target.boot;
    original.abstractions = original.abstractions.filter(r => r.slot !== 15).concat(target);
    fs.writeFileSync(stateFile, JSON.stringify(original));
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
    await expect(inspector.locator('.ns-inspector-issues').first()).toContainText('How to fix it:');
    await expect(inspector.locator('.ns-inspector-issues details[open]')).toHaveCount(0);
    await expect(inspector.locator('[data-technical]')).not.toHaveAttribute('open', '');
    await expect(inspector.locator('.ns-inspector-limitations li').first()).toBeHidden();
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
    await inspector.locator('[data-fix-action="keep-design"]').first().click();
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
    await expect(inspector.locator('[data-status]')).toContainText('Namespace table change saved;');
    await expect(inspector.locator('[data-content]')).toContainText('Currently saved: design-only assignment');
    await expect(inspector.locator('[data-content]')).toContainText('remaining problems');
    const updated = JSON.parse(fs.readFileSync(stateFile)).abstractions;
    const repaired = updated.find(r => r.slot === target.slot);
    expect(repaired.name).toBe(target.name);
    expect(repaired.seq).toBe(target.seq);
    expect(repaired.selection).toEqual(target.selection);
    expect(repaired.symbolic).toBe(true);
    expect(repaired.implementationMissing).toBe(true);
    expect(repaired.resident).not.toBe(true);
    expect(repaired.filename).toBeUndefined();
    expect(updated.filter(r => r.slot !== target.slot)).toEqual(original.abstractions.filter(r => r.slot !== target.slot));
    expect(protectedFiles.map(hash)).toEqual(before);
});

test('artifact lookup token is preserved while real allocation problems remain visible', async ({ page }) => {
    const directory = process.env.CHURCH_TEST_LUMPS_DIR;
    const stateFile = path.join(directory, 'ns-state.json');
    const state = JSON.parse(fs.readFileSync(stateFile));
    // Structural legacy fixture only, never executed or certified.
    const bytes = Buffer.alloc(256 * 4);
    bytes.writeUInt32BE(0xf9000401, 0);
    bytes.writeUInt32BE(0x4a00000e, 255 * 4);
    const filename = 'InspectorBindingFixture.1.12345678.lump';
    fs.writeFileSync(path.join(directory, filename), bytes);
    const row = { slot: 14, name: 'InspectorBindingFixture', type: 'Inform',
        seq: 0, f: 0, g: 0, location: '0x00000400', limit: '0x000FF',
        seal: '0xDEADBEEF', resident: true, load_policy: 'Resident',
        filename, token: '12345678',
        binary_hash: crypto.createHash('sha256').update(bytes).digest('hex') };
    const overlapping = { ...row, slot: 16, name: 'InspectorOverlapFixture' };
    state.abstractions = state.abstractions.filter(r => ![14, 16].includes(r.slot)).concat(row, overlapping);
    fs.writeFileSync(stateFile, JSON.stringify(state));
    const protectedFiles = ['boot-image.bin', 'boot-image.provenance.json']
        .map(name => path.join(directory, name)).concat(process.env.CHURCH_TEST_BOOT_CONFIG_PATH);
    const protectedHashes = protectedFiles.map(hash);
    const binaryHash = hash(path.join(directory, filename));
    await page.route('**/*', route => /(hardware|wukong|fpga|serial|usb|flash)/i.test(route.request().url())
        ? route.abort() : route.continue());
    await page.goto('/simulator/index.html#namespace');
    await page.waitForFunction(() => !!window.NamespaceInspector);
    await page.evaluate(() => NamespaceInspector.open(14));
    const inspector = page.locator('#namespaceInspector');
    await expect(inspector.locator('[data-fix-action="repair-binding"]')).toHaveCount(0);
    await expect(inspector.locator('[data-action] option[value="repair-binding"]')).toHaveCount(0);
    await expect(inspector.locator('[data-fix-action="edit-geometry"]').first()).toBeVisible();
    await expect(inspector.locator('[data-content]')).not.toContainText('Namespace binding does not match');
    await expect(inspector.locator('[data-content]')).toContainText('overlaps NS[16]');
    await expect(inspector.locator('[data-content]')).toContainText('This edits the saved plan, not an existing image.');
    const updated = JSON.parse(fs.readFileSync(stateFile)).abstractions;
    expect(updated.find(r => r.slot === 14)).toEqual(row);
    expect(updated.filter(r => r.slot !== 14)).toEqual(state.abstractions.filter(r => r.slot !== 14));
    expect(protectedFiles.map(hash)).toEqual(protectedHashes);
    expect(hash(path.join(directory, filename))).toBe(binaryHash);
});