'use strict';

// Real original table and controls, actual persistence/review endpoints.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
test.use({ screenshot: 'only-on-failure' });
const root = path.resolve(__dirname, '../..');
const requested = process.env.CHURCH_NAMESPACE_SAVE_ACCEPTANCE === '1';
test.skip(!requested, 'Use scripts/run_namespace_save_acceptance.py browser --profile phase1');
const keys = ['CHURCH_TEST_LUMPS_DIR', 'CHURCH_TEST_BOOT_CONFIG_PATH',
    'CHURCH_TEST_BUILD_SNAPSHOTS_DIR', 'CHURCH_TEST_DB_PATH'];
if (requested && (process.env.CHURCH_TEST_ISOLATED_MODE !== '1' || keys.some(key =>
    !process.env[key] || !fs.existsSync(process.env[key]) ||
    path.relative(fs.realpathSync(path.join(root, 'server')),
        fs.realpathSync(process.env[key])).split(path.sep)[0] !== '..'))) {
    throw Error('Refusing browser acceptance against live state');
}
const lumps = process.env.CHURCH_TEST_LUMPS_DIR || '';
const designPath = path.join(lumps, 'design-drafts/phase1.json');
const ascendingPath = path.join(lumps, 'design-drafts/ascending-v1.json');
const target = require('../fixtures/phase1_namespace_target.json');
const disk = () => JSON.parse(fs.readFileSync(designPath));
function protectedHashes() {
    const walk = dir => fs.readdirSync(dir, { withFileTypes:true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(file);
        if (file === designPath || entry.name.startsWith('.') || entry.name.endsWith('.lock')) return [];
        return [[file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]];
    });
    return [...walk(lumps), ...[process.env.CHURCH_TEST_BOOT_CONFIG_PATH,
        path.join(root, 'server/ide-hierarchy.json')].map(file =>
        [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')])];
}
async function ready(page, select = false) {
    await page.waitForFunction(() => window.NamespaceDesignV1?.state.document &&
        !window.NamespaceDesignV1.state.loading);
    if (select) await page.locator('#namespaceDesignProfile').selectOption('phase1');
    await page.waitForFunction(() => window.NamespaceDesignV1.state.profile === 'phase1' &&
        !window.NamespaceDesignV1.state.loading && window.NamespaceDesignV1.state.document);
    await expect(page.locator('#namespaceDesignProfile')).toHaveValue('phase1');
    await expect(page.locator('#ns-row-17')).toBeVisible();
}
const documentState = page => page.evaluate(() => window.NamespaceDesignV1.state.document);
async function edit(page, slot) {
    await page.locator(`#ns-row-${slot}`).getByRole('button', { name:'Inspect and resolve', exact:true }).click();
    await page.getByRole('button', { name:'Edit placement', exact:true }).click();
    await expect(page.locator('#nsDraftName')).toBeVisible();
}
async function save(page, accept = true) {
    await page.locator('#nsSaveBtn').click();
    await page.getByRole('button', {
        name:accept ? 'Confirm this change' : 'Reject — keep unchanged', exact:true,
    }).click({ timeout:30000 });
    await page.waitForFunction(() => !window.NamespaceDesignV1.state.saving);
    if (accept) {
        expect(await page.evaluate(() => window.NamespaceDesignV1.state.dirty)).toBe(false);
        expect(disk()).toEqual(await documentState(page));
        await page.getByRole('button', { name:'Close all', exact:true }).click();
    }
}

test('Phase 1 approved 256-slot design: edits, cancellation, boot, exact revisions and profile isolation',
    async ({ page, context }, testInfo) => {
    test.setTimeout(150000);
    const initial = disk();
    const expectedInitial = structuredClone(target);
    // Current saved design has a spelling error; correct it only through the UI
    // in this private copy. Never rewrite a live design or select new artifacts.
    expectedInitial.rows.find(r => r.slot === 16).name =
        initial.rows.find(r => r.slot === 16).name;
    expect(initial).toEqual(expectedInitial);
    const before = protectedHashes();
    const writes = [], errors = [];
    await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
            /^\/(hardware|api\/hardware|api\/wukong)/.test(url.pathname)) return route.abort();
        if (['POST','PUT','PATCH','DELETE'].includes(request.method())) {
            writes.push(url.pathname + url.search);
            // The journey is allowed to save this design/review only. In
            // particular, never write IDE hierarchy, images or another profile.
            if (!(url.pathname === '/api/namespace/design-v1' && url.search === '?profile=phase1') &&
                !url.pathname.startsWith('/api/change-reviews/')) {
                return route.abort('blockedbyclient');
            }
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
    await page.goto('/simulator/index.html#namespace');
    await ready(page, true);
    await expect(page.locator('#namespaceIdeNodeInput')).toHaveValue('ide');
    const memory = await page.evaluate(() => Array.from(sim.memory));
    await expect(page.locator('#namespaceTable')).toContainText('1024 table words / 4096 bytes');
    await expect(page.locator('#namespaceTable')).toContainText('CR15 table-only limit 1023');
    await expect(page.locator('#ns-row-10 .ns-boot-btn')).toHaveClass(/boot-entry-active/);
    expect(await page.locator('#namespaceTable select[aria-label^="Load policy"]').count()).toBe(0);

    if (!process.env.CHURCH_PHASE1_ACCEPTANCE_REMAINING) {
    // Editing without selecting a catalog revision visibly retains exact v45.
    await edit(page, 10);
    await expect(page.locator('#nsDraftLump')).toHaveValue('retained');
    await expect(page.locator('#nsDraftLump option:checked')).toContainText('45');
    await page.locator('#nsDraftApply').click();
    expect((await documentState(page)).rows.find(r => r.slot === 10).selection)
        .toEqual(target.rows.find(r => r.slot === 10).selection);
    // Cancel a local placement edit; no write and no document change.
    const beforeClose = await documentState(page);
    await edit(page, 16);
    await page.locator('#nsDraftName').fill('ide.Cancelled');
    await page.locator('#nsDraftClose').click();
    expect(await documentState(page)).toEqual(beforeClose);

    await edit(page, 16);
    await page.locator('#nsDraftName').fill('ide.AliceDraft');
    await page.locator('#nsDraftApply').click();
    await save(page, false);
    expect(disk()).toEqual(initial);
    expect((await documentState(page)).rows.find(r => r.slot === 16).name).toBe('ide.AliceDraft');
    await page.reload();
    await ready(page);
    expect(await documentState(page)).toEqual(initial);

    await edit(page, 16);
    await page.locator('#nsDraftName').fill('ide.Alice');
    await page.locator('#nsDraftApply').click();
    await save(page);
    expect(disk()).toEqual(target);
    await page.reload();
    await ready(page);
    expect(await documentState(page)).toEqual(target);
    }

    // A Phase 1 placement dialog cannot apply into another profile.
    const phaseBytes = fs.readFileSync(designPath);
    const ascendingBytes = fs.existsSync(ascendingPath) ? fs.readFileSync(ascendingPath) : null;
    await edit(page, 16);
    await page.locator('#namespaceDesignProfile').selectOption('ascending', { force:true });
    await expect(page.locator('#namespaceDesignDialog')).toHaveCount(0);
    await page.waitForFunction(() => !window.NamespaceDesignV1.state.loading &&
        window.NamespaceDesignV1.state.document?.format === 'ascending-nst-metadata-slot0-v1');
    const ascendingDocument = await documentState(page);
    await page.locator('#namespaceDesignProfile').selectOption('phase1');
    await ready(page);
    expect(await documentState(page)).toEqual(target);

    // Boot changes are explicit design edits, and retain exact revision identities.
    for (const slot of process.env.CHURCH_PHASE1_ACCEPTANCE_REMAINING === 'profiles' ? [] : [7, 10]) {
        await page.locator(`#ns-row-${slot} .ns-boot-btn`).click();
        await save(page);
        await page.reload();
        await ready(page);
        await expect(page.locator(`#ns-row-${slot} .ns-boot-btn`)).toHaveClass(/boot-entry-active/);
        expect(disk().rows.filter(r => r.boot).map(r => r.slot)).toEqual([slot]);
        expect(disk().rows.map(({boot, ...row}) => row)).toEqual(target.rows.map(({boot, ...row}) => row));
    }
    // Restore the exact approved serialization, including optional boot fields,
    // via ordinary editing is unnecessary: false flags do not change layout.
    const finalDocument = await documentState(page);
    expect(finalDocument.rows.filter(r => !r.selection && r.kind === 'lump').map(r => r.name))
        .toEqual(['ide.Mint','nstab','pkverify','ide.Alice','ide.Mallory']);
    expect(finalDocument.rows.every(r => r.policy !== 'Lazy')).toBe(true);
    expect(finalDocument.rows).toHaveLength(17);
    await page.locator('#namespaceDesignProfile').selectOption('ascending');
    await page.waitForFunction(() => !window.NamespaceDesignV1.state.loading &&
        window.NamespaceDesignV1.state.document?.format === 'ascending-nst-metadata-slot0-v1');
    expect(await documentState(page)).toEqual(ascendingDocument);
    await page.locator('#namespaceDesignProfile').selectOption('legacy');
    await page.locator('#namespaceDesignProfile').selectOption('phase1');
    await ready(page);
    expect(await documentState(page)).toEqual(finalDocument);
    expect(fs.existsSync(ascendingPath) ? fs.readFileSync(ascendingPath) : null).toEqual(ascendingBytes);
    expect(JSON.parse(phaseBytes).rows.map(({boot,...r}) => r))
        .toEqual(finalDocument.rows.map(({boot,...r}) => r));
    expect(protectedHashes()).toEqual(before);
    expect(await page.evaluate(() => Array.from(sim.memory))).toEqual(memory);
    expect(errors).toEqual([]);
    if (process.env.CHURCH_PHASE1_ACCEPTANCE_REMAINING !== 'profiles')
        expect(writes.some(url => url === '/api/namespace/design-v1?profile=phase1')).toBe(true);
    expect(writes.every(url => url === '/api/namespace/design-v1?profile=phase1' ||
        url.startsWith('/api/change-reviews/'))).toBe(true);
    await page.screenshot({path:testInfo.outputPath('phase1-approved-save-reload.png'), fullPage:true});
    await testInfo.attach('phase1-final-document', {
        body:JSON.stringify(finalDocument, null, 2), contentType:'application/json'});
});
