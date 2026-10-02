'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');

const fixtureKeys = [
    'CHURCH_TEST_LUMPS_DIR', 'CHURCH_TEST_BOOT_CONFIG_PATH',
    'CHURCH_TEST_BUILD_SNAPSHOTS_DIR', 'CHURCH_TEST_DB_PATH',
];
const serverRoot = fs.realpathSync(path.resolve(__dirname, '../../server'));
if (process.env.CHURCH_TEST_ISOLATED_MODE !== '1' || fixtureKeys.some(key =>
    !process.env[key] || !fs.existsSync(process.env[key]) ||
    path.relative(serverRoot, fs.realpathSync(process.env[key])).split(path.sep)[0] !== '..')) {
    throw new Error('Clear Tunnel E2E requires four existing fixture paths outside server/ and isolated mode');
}

const lumps = path.resolve(process.env.CHURCH_TEST_LUMPS_DIR);
const statePath = path.join(lumps, 'ns-state.json');
const imagePath = path.join(lumps, 'boot-image.bin');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileSha = file => sha(fs.readFileSync(file));
const state = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));

function libraryHashes() {
    const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(file);
        const rel = path.relative(lumps, file).split(path.sep).join('/');
        if (['ns-state.json', 'boot-image.bin', 'boot-image.provenance.json'].includes(rel) ||
                /\.lock$/.test(rel) || /^(save-operations|save-candidates|\.image-refresh)\//.test(rel) ||
                ['.lump-write-leases.json', '.image-refresh/journal.json'].includes(rel)) return [];
        return [[rel, fileSha(file)]];
    });
    return walk(lumps).sort((a, b) => a[0].localeCompare(b[0]));
}

test('Clear Tunnel NS[8] preserves protected library, refresh and reuse retain generation', async ({ page }) => {
    test.setTimeout(120000);
    const config = {
        targetBoard: 'wukong-xc7a100t',
        step1: { totalNamespaceWords: 8192, namespaceLumpWords: 64, nsSlotsMax: 64,
            threadCount: 1, threadLumpWords: 256, threadStackWords: 32 },
    };
    const rows = [
        { slot: 0, name: 'Boot.NS', type: 'Namespace', location: 0, limit: 4095, seq: 0 },
        { slot: 1, name: 'Boot.Thread', type: 'Thread', location: 512, limit: 7, seq: 0 },
    ];
    const artifactPaths = [];
    for (const [slot, name, location] of [[6, 'Target', 1024], [8, 'Tunnel', 1280]]) {
        const words = [((31 << 27) | (1 << 10) | 1) >>> 0, 0x18000000,
            ...Array(61).fill(0), (0x4a000000 | slot) >>> 0];
        const bytes = Buffer.alloc(256);
        words.forEach((word, index) => bytes.writeUInt32BE(word, index * 4));
        const filename = `${name}.1.${sha(bytes).slice(0, 8)}.lump`;
        fs.writeFileSync(path.join(lumps, filename), bytes);
        artifactPaths.push(path.join(lumps, filename));
        rows.push({
            slot, name, type: 'Inform', location, limit: 1, seq: 0,
            filename, binary_hash: sha(bytes), token: (0x4a000000 | slot).toString(16),
            boot: slot === 6, load_policy: 'Resident',
        });
    }
    fs.writeFileSync(process.env.CHURCH_TEST_BOOT_CONFIG_PATH, JSON.stringify(config));
    fs.writeFileSync(statePath, JSON.stringify({ abstractions: rows }));
    execFileSync('python3', ['-c', [
        'import json, os, sys',
        'from pathlib import Path',
        'from server.namespace_image_refresh import reconstruct',
        'root=Path(sys.argv[1]); cfg=json.loads(Path(sys.argv[2]).read_text())',
        'rows=json.loads((root/"ns-state.json").read_text())["abstractions"]',
        'image, provenance=reconstruct(cfg, rows, root)',
        '(root/"boot-image.bin").write_bytes(image)',
        '(root/"boot-image.provenance.json").write_text(json.dumps(provenance))',
    ].join('\n'), lumps, process.env.CHURCH_TEST_BOOT_CONFIG_PATH], { cwd: path.resolve(__dirname, '../..') });

    const configBefore = fileSha(process.env.CHURCH_TEST_BOOT_CONFIG_PATH);
    const sourceLibraryBefore = libraryHashes();
    const tunnelHash = fileSha(artifactPaths[1]);
    await page.route('**/*', route => /(hardware|wukong|fpga|serial|usb|flash)/i.test(route.request().url())
        ? route.abort() : route.continue());
    await page.addInitScript(() => {
        localStorage.setItem('church_welcome_dismissed', '1');
        localStorage.setItem('church_welcome_dismissed_perm', '1');
        localStorage.setItem('churchMachine_mathGuideDismissed_perm', '1');
        sessionStorage.setItem('church_welcome_dismissed_session', '1');
        for (const lang of ['cloomc', 'javascript', 'haskell', 'english',
            'symbolic', 'lambda', 'assembly']) {
            localStorage.setItem(`church_intro_dismissed_${lang}`, 'true');
        }
    });
    await page.goto('/simulator/index.html#namespace');
    await page.waitForFunction(() => typeof sim !== 'undefined' && sim !== null &&
        !!sim.memory && !!window._nsState);
    const intro = page.getByRole('button', { name: /Let's Try It!/ });
    if (await intro.isVisible().catch(() => false)) await intro.click();

    const memoryBefore = await page.evaluate(() => Array.from(sim.memory));
    const imageBefore = fileSha(imagePath);
    // The UI row is found by its Pet Name; clear is a staged design operation.
    const tunnelRow = page.locator('#ns-row-8');
    await expect(tunnelRow).toBeVisible();
    await tunnelRow.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Array.from(sim.memory))).toEqual(memoryBefore);
    expect(fileSha(imagePath)).toBe(imageBefore);
    expect(state().abstractions.some(row => row.slot === 8)).toBeTruthy();

    // Reject a reviewed Save first: staged Clear is discarded only on reload.
    await page.locator('#nsSaveBtn').click();
    const reject = page.getByRole('button', { name: 'Reject — keep unchanged', exact: true });
    await expect(reject).toBeVisible();
    await reject.click();
    expect(state().abstractions.some(row => row.slot === 8)).toBeTruthy();
    expect(fileSha(imagePath)).toBe(imageBefore);
    expect(libraryHashes()).toEqual(sourceLibraryBefore);
    await page.reload();
    await page.waitForFunction(() => sim && sim.memory && window._nsState);
    await expect(page.locator('#ns-row-8')).toBeVisible();

    // Save and protected confirmation are exercised through the actual UI.
    await page.locator('#ns-row-8').getByRole('button', { name: 'Clear', exact: true }).click();
    await page.locator('#nsSaveBtn').click();
    const confirmation = page.getByRole('button', { name: 'Confirm this change', exact: true });
    await expect(confirmation).toBeVisible();
    await confirmation.click();
    await expect.poll(() => state().abstractions.some(row => row.slot === 8)).toBeFalsy();
    expect(state().freeSlotSequences && state().freeSlotSequences['8']).toBe(1);
    expect(fileSha(process.env.CHURCH_TEST_BOOT_CONFIG_PATH)).toBe(configBefore);
    expect(libraryHashes()).toEqual(sourceLibraryBefore);
    expect(fileSha(artifactPaths[1])).toBe(tunnelHash);

    await page.reload();
    await page.waitForFunction(() => typeof sim !== 'undefined' && sim !== null &&
        sim.memory && !!window._nsState);
    // The committed saved plan no longer has slot 8, but the active simulator
    // deliberately still reflects the pre-refresh image until the image action.
    expect(state().abstractions.some(row => row.slot === 8)).toBeFalsy();
    expect(fileSha(imagePath)).toBe(imageBefore);
    const refresh = page.getByRole('button', { name: 'Refresh Image', exact: true });
    await refresh.click();
    const refreshConfirm = page.getByRole('button', { name: 'Confirm this change', exact: true });
    await expect(refreshConfirm).toBeVisible();
    await refreshConfirm.click();
    await expect.poll(() => fileSha(imagePath)).not.toBe(imageBefore);
    expect(state().abstractions.some(row => row.slot === 8)).toBeFalsy();
    expect(state().freeSlotSequences['8']).toBe(1);
    expect(libraryHashes()).toEqual(sourceLibraryBefore);
    expect(fileSha(artifactPaths[1])).toBe(tunnelHash);
    expect(fileSha(process.env.CHURCH_TEST_BOOT_CONFIG_PATH)).toBe(configBefore);

    // Reuse only via the standard Add -> design form. The selected library
    // artifact is intentionally separate from the requested programmer Pet Name.
    const runtimeMemoryAfterRefresh = await page.evaluate(() => Array.from(sim.memory));
    await page.getByRole('button', { name: /Add to Namespace/ }).click();
    await expect(page.locator('#_nsAddModalOverlay')).toBeVisible();
    await expect(page.locator('#_nsPlacementName')).toBeVisible();
    await page.locator('#_nsPlacementName').fill('Replacement');
    await page.locator('#_nsPlacementSlot').fill('8');
    const picker = page.locator('#_nsAddSelect');
    const tunnelOption = picker.locator('option').filter({ hasText: /Tunnel/ }).first();
    await expect(tunnelOption).toHaveCount(1);
    await picker.selectOption(await tunnelOption.getAttribute('value'));
    await page.locator('#_nsPlacementName').fill('Replacement');
    await page.getByRole('button', { name: 'Add to Namespace (design)', exact: true }).click();
    const reuseConfirm = page.getByRole('button', { name: 'Confirm this change', exact: true });
    await expect(reuseConfirm).toBeVisible();
    await reuseConfirm.click();
    await expect.poll(() => state().abstractions.find(row => row.slot === 8)?.name)
        .toBe('Replacement');
    const replacement = state().abstractions.find(row => row.slot === 8);
    expect(replacement.seq).toBe(1);
    expect(state().freeSlotSequences['8']).toBeUndefined();
    expect(state().abstractions.some(row => row.name === 'Tunnel')).toBeFalsy();
    expect(await page.evaluate(() => Array.from(sim.memory))).toEqual(runtimeMemoryAfterRefresh);
    expect(libraryHashes()).toEqual(sourceLibraryBefore);
    expect(fileSha(artifactPaths[1])).toBe(tunnelHash);
    expect(fileSha(process.env.CHURCH_TEST_BOOT_CONFIG_PATH)).toBe(configBefore);

    // Seed the simulator's frozen-mode marker as test setup (the minimal
    // disposable board fixture has no complete SelfTest binding for preparation).
    // Then exercise the same UI edit gate used by an activated configuration.
    await page.evaluate(() => {
        sim.simulationConfiguration = Object.freeze({ configurationHash: 'e2e-frozen-fixture' });
    });
    const frozenMemory = await page.evaluate(() => Array.from(sim.memory));
    const committedAfterReuse = JSON.stringify(state());
    await page.locator('#ns-row-8').getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.locator('#patchToastOverlay')).toContainText('active simulation configuration is frozen');
    expect(JSON.stringify(state())).toBe(committedAfterReuse);
    expect(await page.evaluate(() => Array.from(sim.memory))).toEqual(frozenMemory);
});