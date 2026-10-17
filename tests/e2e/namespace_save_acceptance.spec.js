'use strict';

// One real-browser acceptance journey. No mocked save or inspection responses.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
test.use({ screenshot: 'only-on-failure' });

const root = path.resolve(__dirname, '../..');
const serverRoot = fs.realpathSync(path.join(root, 'server'));
const keys = ['CHURCH_TEST_LUMPS_DIR', 'CHURCH_TEST_BOOT_CONFIG_PATH',
    'CHURCH_TEST_BUILD_SNAPSHOTS_DIR', 'CHURCH_TEST_DB_PATH', 'CHURCH_TEST_IDE_HIERARCHY_PATH'];
const requested = process.env.CHURCH_NAMESPACE_SAVE_ACCEPTANCE === '1';
test.skip(!requested, 'Use the dedicated isolated Namespace acceptance runner');
if (requested && (process.env.CHURCH_TEST_ISOLATED_MODE !== '1' || keys.some(key =>
    !process.env[key] || !fs.existsSync(process.env[key]) ||
    path.relative(serverRoot, fs.realpathSync(process.env[key])).split(path.sep)[0] !== '..'))) {
    throw new Error('Run through scripts/run_namespace_save_acceptance.py browser; refusing live state');
}
// These paths are never read or written for skipped ordinary-suite cases.
const lumps = process.env.CHURCH_TEST_LUMPS_DIR || '';
const statePath = path.join(lumps, 'ns-state.json');
const manifestPath = path.join(lumps, 'manifest.json');
const state = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function protectedHashes() {
    const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(file);
        if (file === statePath || entry.name.startsWith('.') ||
            !/\.(json|lump|bin|cloomc)$/.test(entry.name)) return [];
        return [[path.relative(lumps, file), hash(file)]];
    });
    return [...walk(lumps), ['boot-config', hash(process.env.CHURCH_TEST_BOOT_CONFIG_PATH)]]
        .sort((a, b) => a[0].localeCompare(b[0]));
}
async function ready(page) {
    await page.waitForFunction(() => typeof sim !== 'undefined' && sim &&
        Array.isArray(window._nsState?.savedAbstractions));
    const intro = page.getByRole('button', { name: /Let's Try It!/ });
    if (await intro.isVisible().catch(() => false)) await intro.click();
    // IDE-03 concerns the existing ns-state save/boot controls, not the
    // separately persisted ascending-v1 candidate editor (the default view).
    await page.locator('#namespaceDesignProfile').selectOption('legacy');
    await page.waitForFunction(() => window.NamespaceDesignV1?.state.active === false);
    await expect(page.locator('#ns-row-7')).toBeVisible();
}
async function finishReview(page, accept = true) {
    const confirm = page.getByRole('button', { name: accept ?
        'Confirm this change' : 'Reject — keep unchanged', exact: true });
    const upgrades = page.getByRole('heading', { name: 'Choose LUMP upgrades', exact: true });
    await expect(upgrades.or(confirm)).toBeVisible({ timeout: 30000 });
    if (await upgrades.isVisible()) {
        const dialog = upgrades.locator('..');
        // Newer library revisions are real fixture data, not permission to
        // replace any selected artifact. Explicitly keep all current choices.
        for (const checkbox of await dialog.getByRole('checkbox').all()) {
            await expect(checkbox).not.toBeChecked();
        }
        await dialog.getByRole('button', { name: 'Confirm and Save', exact: true }).click();
    }
    await expect(confirm).toBeVisible();
    await confirm.click();
}
async function save(page, accept = true) {
    await page.locator('#nsSaveBtn').click();
    await finishReview(page, accept);
    await expect.poll(() => page.evaluate(() => window._nsTableSaveInFlight)).toBe(false);
    if (accept) {
        await expect(page.locator('#nsSaveBtn')).toHaveText('✓ Table saved — image unchanged');
        expect(await page.evaluate(() => window._nsTableSaveError)).toBeNull();
    }
}

async function setup(page, context) {
    const originalRows = state().abstractions;
    // Remove active catalog memberships only in this disposable fixture.
    const selected = new Set(originalRows.map(row => row.filename).filter(Boolean));
    const catalog = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fs.writeFileSync(manifestPath, JSON.stringify(catalog.filter(row => !selected.has(row.filename))));
    const before = protectedHashes();
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        return url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' ||
            /^\/(hardware|api\/hardware|api\/wukong)/.test(url.pathname)
            ? route.abort() : route.continue();
    });
    await context.addInitScript(() => {
        localStorage.setItem('church_welcome_dismissed', '1');
        localStorage.setItem('church_welcome_dismissed_perm', '1');
        localStorage.setItem('churchMachine_mathGuideDismissed_perm', '1');
        sessionStorage.setItem('church_welcome_dismissed_session', '1');
        // Synthetic credential configured only in the disposable subprocess.
        sessionStorage.setItem('ba_build_token', 'namespace-acceptance-test-only');
        for (const lang of ['cloomc', 'javascript', 'haskell', 'english',
            'symbolic', 'lambda', 'assembly']) {
            localStorage.setItem(`church_intro_dismissed_${lang}`, 'true');
        }
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/simulator/index.html#namespace');
    await ready(page);
    return { originalRows, before, errors };
}

test('Namespace save/reload: resident choices, cancellation and stale tab', async ({ page, context }, testInfo) => {
    test.setTimeout(120000);
    const { originalRows, before, errors } = await setup(page, context);
    const memory = await page.evaluate(() => Array.from(sim.memory));
    const policy = page.getByLabel('Load policy for slot 7');
    await expect(policy).toHaveValue('Resident');

    // Cancellation preserves disk, resident choice and all immutable artifacts.
    const originalState = fs.readFileSync(statePath);
    await policy.selectOption('Lazy');
    await save(page, false);
    expect(fs.readFileSync(statePath).equals(originalState)).toBe(true);
    expect(protectedHashes()).toEqual(before);
    await page.reload();
    await ready(page);
    await expect(policy).toHaveValue('Resident');

    // A second tab retains the old fingerprint while the first commits.
    const stale = await context.newPage();
    await stale.goto('/simulator/index.html#namespace');
    await ready(stale);
    await policy.selectOption('Lazy');
    await save(page);
    const lazyRows = structuredClone(originalRows);
    Object.assign(lazyRows.find(row => row.slot === 7), { resident: false, load_policy: 'Lazy' });
    expect(state().abstractions).toEqual(lazyRows);
    expect(await page.evaluate(() => Array.from(sim.memory))).toEqual(memory);
    await page.reload();
    await ready(page);
    await expect(policy).toHaveValue('Lazy');
    expect(await page.evaluate(() => window._nsState.savedAbstractions)).toEqual(lazyRows);
    const committed = fs.readFileSync(statePath);
    await stale.getByLabel('Load policy for slot 7').selectOption('Preload');
    await stale.locator('#nsSaveBtn').click();
    await expect(stale.locator('#nsSaveLayoutNote')).toContainText(/Namespace changed.*reload/i);
    expect(fs.readFileSync(statePath).equals(committed)).toBe(true);
    await stale.close();

    // Restore residency, proving exact filename/hash/layout did not change.
    await policy.selectOption('Resident');
    await save(page);
    expect(state().abstractions).toEqual(originalRows);
    expect(protectedHashes()).toEqual(before);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('namespace-resident-reload.png'), fullPage: true });
});

test('Namespace boot selection and incomplete design save/reload', async ({ page, context }, testInfo) => {
    test.setTimeout(120000);
    const { originalRows, before, errors } = await setup(page, context);
    // Actual Lightning Bolt control, exact selected revision, existing auth.
    await page.locator('#ns-row-7 .ns-boot-btn').click();
    await page.getByRole('button', { name: 'Confirm this change', exact: true }).click();
    await expect.poll(() => state().abstractions.find(row => row.boot)?.slot).toBe(7);
    const bootRows = structuredClone(originalRows);
    for (const row of bootRows) {
        delete row.boot;
        if (row.slot === 7) row.boot = true;
    }
    expect(state().abstractions).toEqual(bootRows);
    expect(protectedHashes()).toEqual(before);
    await page.reload();
    await ready(page);
    await expect(page.locator('#ns-row-7 .ns-boot-btn')).toHaveClass(/boot-entry-active/);
    expect(await page.evaluate(() => window._nsState.savedAbstractions)).toEqual(bootRows);

    // Incomplete programmer intent is saved through the normal Add design UI.
    await page.getByRole('button', { name: /Add to Namespace/ }).click();
    await expect(page.locator('#_nsPlacementName')).toBeVisible();
    await page.locator('#_nsPlacementName').fill('Acceptance.Future');
    await page.locator('#_nsPlacementSlot').fill('14');
    await page.getByRole('button', { name: 'Add to Namespace (design)', exact: true }).click();
    await finishReview(page);
    await expect.poll(() => state().abstractions.find(row => row.slot === 14)?.name)
        .toBe('Acceptance.Future');
    const design = state().abstractions.find(row => row.slot === 14);
    expect(design.symbolic).toBe(true);
    expect(design.implementationMissing).toBe(true);
    expect(state().abstractions.filter(row => row.slot !== 14)).toEqual(bootRows);
    const finalRows = state().abstractions;
    await page.reload();
    await ready(page);
    await expect(page.locator('#ns-row-14')).toContainText('Acceptance.Future');
    expect(await page.evaluate(() => window._nsState.savedAbstractions)).toEqual(finalRows);
    expect(protectedHashes()).toEqual(before);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('namespace-save-reload.png'), fullPage: true });
});
