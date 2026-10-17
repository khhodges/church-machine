'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '../..');
const requested = process.env.CHURCH_NAMESPACE_SAVE_ACCEPTANCE === '1';
test.skip(!requested, 'Use scripts/run_namespace_save_acceptance.py browser --profile phase1 --remaining node');
const keys = ['CHURCH_TEST_LUMPS_DIR', 'CHURCH_TEST_BOOT_CONFIG_PATH',
    'CHURCH_TEST_BUILD_SNAPSHOTS_DIR', 'CHURCH_TEST_DB_PATH', 'CHURCH_TEST_IDE_HIERARCHY_PATH'];
if (requested && (process.env.CHURCH_TEST_ISOLATED_MODE !== '1' || keys.some(key =>
    !process.env[key] || !fs.existsSync(process.env[key]) ||
    path.relative(fs.realpathSync(path.join(root, 'server')),
        fs.realpathSync(process.env[key])).split(path.sep)[0] !== '..'))) {
    throw Error('Refusing IDE node acceptance without private state');
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('IDE node isolated: consent, cancellation, main Save and reload never change real settings',
    async ({ page, context }, testInfo) => {
    test.setTimeout(90000);
    const privatePath = process.env.CHURCH_TEST_IDE_HIERARCHY_PATH;
    const originalBytes = fs.readFileSync(privatePath);
    const original = JSON.parse(originalBytes);
    const originalNode = original?.node || '';
    const livePath = path.join(root, 'server/ide-hierarchy.json');
    const liveHash = () => fs.existsSync(livePath) ? hash(livePath) : null;
    const realHash = liveHash();
    const writes = [], blocked = [], errors = [];
    // Protect every copied artifact except the hierarchy being deliberately
    // edited. Review records live in the disposable database.
    function protectedHashes() {
        const walk = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => {
            const file = path.join(dir, entry.name);
            return entry.isDirectory() ? walk(file) :
                entry.name.endsWith('.lock') ? [] : [[file, hash(file)]];
        });
        return [...walk(process.env.CHURCH_TEST_LUMPS_DIR),
            ...walk(process.env.CHURCH_TEST_BUILD_SNAPSHOTS_DIR),
            [process.env.CHURCH_TEST_BOOT_CONFIG_PATH, hash(process.env.CHURCH_TEST_BOOT_CONFIG_PATH)]];
    }
    const protectedBefore = protectedHashes();
    await context.route('**/*', route => {
        const req = route.request(), url = new URL(req.url());
        if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
            /^\/(hardware|api\/hardware|api\/wukong)/.test(url.pathname)) return route.abort();
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) {
            const allowed = (req.method() === 'PUT' && url.pathname === '/api/ide-hierarchy') ||
                (req.method() === 'PUT' && url.pathname === '/api/namespace/design-v1' &&
                    url.search === '?profile=phase1') || url.pathname.startsWith('/api/change-reviews/');
            (allowed ? writes : blocked).push({url:url.pathname + url.search, body:req.postDataJSON()});
            if (!allowed) return route.abort('blockedbyclient');
        }
        return route.continue();
    });
    await context.addInitScript(() => {
        localStorage.setItem('church_welcome_dismissed', '1');
        localStorage.setItem('church_welcome_dismissed_perm', '1');
        localStorage.setItem('churchMachine_mathGuideDismissed_perm', '1');
        sessionStorage.setItem('church_welcome_dismissed_session', '1');
        for (const lang of ['cloomc','javascript','haskell','english','symbolic','lambda','assembly'])
            localStorage.setItem(`church_intro_dismissed_${lang}`, 'true');
    });
    page.on('pageerror', error => errors.push(error.message));
    const input = page.locator('#namespaceIdeNodeInput');
    const status = page.locator('#namespaceIdeNodeStatus');
    const nodeWrites = () => writes.filter(row => row.url === '/api/ide-hierarchy');
    const readPrivate = () => JSON.parse(fs.readFileSync(privatePath));
    async function dialogClick(selector, accept, text) {
        const pending = page.waitForEvent('dialog');
        const click = page.locator(selector).click();
        const dialog = await pending;
        expect(dialog.message()).toContain(text);
        if (accept) await dialog.accept(); else await dialog.dismiss();
        await click;
    }
    try {
        await page.goto('/simulator/index.html#namespace');
        await expect(input).toHaveValue(originalNode);
        await page.locator('#namespaceDesignProfile').selectOption('phase1');
        await page.waitForFunction(() => window.NamespaceDesignV1?.state.profile === 'phase1' &&
            !window.NamespaceDesignV1.state.loading && window.NamespaceDesignV1.state.document);
        const memory = await page.evaluate(() => Array.from(sim.memory));
        // Neither save surface writes anything when node consent is declined.
        for (const button of ['#namespaceIdeNodeSave', '#nsSaveBtn']) {
            await input.fill('acceptanceprivate');
            await dialogClick(button, false, 'Change IDE node from');
            await expect(status).toContainText('Save cancelled');
            await page.waitForFunction(() => !window.NamespaceDesignV1.state.saving);
            expect(writes).toHaveLength(0);
            expect(fs.readFileSync(privatePath)).toEqual(originalBytes);
        }
        // Reload has its own discard consent; cancelling retains the edit.
        await dialogClick('#namespaceIdeNodeReload', false, 'Discard the unsaved');
        await expect(input).toHaveValue('acceptanceprivate');
        await dialogClick('#namespaceIdeNodeReload', true, 'Discard the unsaved');
        await expect(input).toHaveValue(originalNode);
        await input.fill('acceptanceprivate');
        await dialogClick('#namespaceIdeNodeSave', true, 'Change IDE node from');
        await expect(status).toContainText('Saved IDE node: acceptanceprivate');
        const saved = readPrivate();
        expect(nodeWrites()).toHaveLength(1);
        expect(nodeWrites()[0].body).toEqual({node:'acceptanceprivate', expected:original, confirmed:true});
        expect(saved.definitions).toEqual(original?.definitions || {});
        expect(saved.aliases).toEqual(Object.fromEntries(Object.entries(original?.aliases || {}).map(([alias, target]) =>
            [alias, target.slice(0, target.lastIndexOf('.')) === originalNode
                ? 'acceptanceprivate' + target.slice(target.lastIndexOf('.')) : target])));
        expect(liveHash()).toBe(realHash);
        await page.reload();
        await expect(input).toHaveValue('acceptanceprivate');
        // Main Save must persist the pending node first. Reject the separate
        // Namespace review so this test changes only the private hierarchy.
        await page.locator('#namespaceDesignProfile').selectOption('phase1');
        await page.waitForFunction(() => !window.NamespaceDesignV1.state.loading);
        await input.fill('acceptancemain');
        await dialogClick('#nsSaveBtn', true, 'Change IDE node from');
        await page.getByRole('button', {name:'Reject — keep unchanged', exact:true}).click({timeout:30000});
        await page.waitForFunction(() => !window.NamespaceDesignV1.state.saving);
        expect(nodeWrites()).toHaveLength(2);
        expect(readPrivate().node).toBe('acceptancemain');
        expect(await page.evaluate(() => Array.from(sim.memory))).toEqual(memory);
        await page.reload();
        await expect(input).toHaveValue('acceptancemain');
        await expect(status).toContainText('Current saved node: acceptancemain');
        expect(blocked).toEqual([]);
        expect(errors).toEqual([]);
        await page.screenshot({path:testInfo.outputPath('private-ide-node-reload.png')});
    } finally {
        fs.writeFileSync(privatePath, originalBytes);
        expect(liveHash()).toBe(realHash);
        expect(protectedHashes()).toEqual(protectedBefore);
    }
});
