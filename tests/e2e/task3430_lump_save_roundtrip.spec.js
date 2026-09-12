'use strict';

// task3430_lump_save_roundtrip.spec.js
//
// This test intentionally runs only against the disposable fixture harness.
// The save flow is a real browser flow: the browser obtains a server-authored
// save plan, confirms it, obtains the one-use approval intent, and then posts
// the exact approved binary to /api/lumps/save.

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const REQUIRED_FIXTURE_ENV = [
    'CHURCH_TEST_ISOLATED_MODE',
    'CHURCH_TEST_LUMPS_DIR',
    'CHURCH_TEST_BOOT_CONFIG_PATH',
    'CHURCH_TEST_BUILD_SNAPSHOTS_DIR',
    'CHURCH_TEST_DB_PATH',
];
const missingFixtureEnv = REQUIRED_FIXTURE_ENV.filter(key => !process.env[key]);
if (missingFixtureEnv.length) {
    throw new Error(
        `Task 3430 requires isolated fixture overrides; missing ${missingFixtureEnv.join(', ')}. ` +
        'Run npm run test:e2e:task3430 instead of pointing Playwright at production paths.'
    );
}
if (!['1', 'true', 'yes', 'on'].includes(
    String(process.env.CHURCH_TEST_ISOLATED_MODE).trim().toLowerCase())) {
    throw new Error(
        'Task 3430 requires CHURCH_TEST_ISOLATED_MODE; refusing to run with ' +
        'external report/GitHub jobs or Wukong listeners enabled.'
    );
}

const LUMPS_DIR = path.resolve(process.env.CHURCH_TEST_LUMPS_DIR);
const BOOT_CONFIG_PATH = path.resolve(process.env.CHURCH_TEST_BOOT_CONFIG_PATH);
const BUILD_SNAPSHOTS_DIR = path.resolve(process.env.CHURCH_TEST_BUILD_SNAPSHOTS_DIR);
const DB_PATH = path.resolve(process.env.CHURCH_TEST_DB_PATH);
const PRODUCTION_ROOT = path.resolve(__dirname, '..', '..', 'server');
const PRODUCTION_PATHS = [
    [LUMPS_DIR, path.join(PRODUCTION_ROOT, 'lumps'), true],
    [BOOT_CONFIG_PATH, path.join(PRODUCTION_ROOT, 'boot-config.json'), false],
    [BUILD_SNAPSHOTS_DIR, path.join(PRODUCTION_ROOT, 'build-snapshots'), true],
    [DB_PATH, path.join(PRODUCTION_ROOT, 'church_machine.db'), false],
];
function isProductionWritablePath(candidate, production, isDirectory) {
    const serverRelative = path.relative(PRODUCTION_ROOT, candidate);
    if (serverRelative === '' || (!serverRelative.startsWith('..' + path.sep) &&
        serverRelative !== '..' && !path.isAbsolute(serverRelative))) {
        return true;
    }
    if (!isDirectory) return candidate === path.resolve(production);
    const relative = path.relative(path.resolve(production), candidate);
    return relative === '' || (!relative.startsWith('..' + path.sep) &&
        relative !== '..' && !path.isAbsolute(relative));
}
if (PRODUCTION_PATHS.some(([candidate, production, isDirectory]) =>
    isProductionWritablePath(candidate, production, isDirectory)) ||
        !fs.existsSync(LUMPS_DIR) ||
        !fs.existsSync(BOOT_CONFIG_PATH) ||
        !fs.existsSync(BUILD_SNAPSHOTS_DIR) ||
        !fs.existsSync(DB_PATH)) {
    throw new Error(
        'Task 3430 fixture overrides are absent, invalid, or point at production ' +
        'writable state; refusing to risk production state.'
    );
}

const ABSTRACTION_NAME = 'Task3430RoundTrip';
const SOURCE = `abstraction ${ABSTRACTION_NAME} {
    method Ping() {
        return(3430)
    }
}
`;

// This is deliberately raw Assembly: it reproduces the regression where a
// compiler-owned SELF row appears beside a named SelfTest row before the first
// named LOAD.  The server must replace row zero with the destination-local
// SELF GT and never persist the compiler placeholder.
const SELF_PRIOR_LOAD_SOURCE = `; Abstraction: CapabilityTest
; Task 3430 SELF + SelfTest prior-LOAD reproducer.
capabilities {
    SELF E,
    SelfTest E
}
LOAD CR0, SelfTest
HALT
`;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function walkFiles(root, relative = '') {
    const directory = path.join(root, relative);
    const output = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const rel = path.join(relative, entry.name);
        if (entry.isDirectory()) output.push(...walkFiles(root, rel));
        else output.push(rel);
    }
    return output;
}

function isTransientFixturePath(relative) {
    const normalized = relative.split(path.sep).join('/');
    return normalized.startsWith('save-operations/') ||
        normalized.startsWith('save-candidates/') ||
        normalized === 'save-runtime-diagnostics.jsonl' ||
        normalized === 'save-runtime-diagnostics.lock' ||
        normalized.endsWith('.lock');
}

// Save-plan and diagnostics intentionally create quarantine/diagnostic files.
// The authoritative repository state must nevertheless remain byte-for-byte
// unchanged for cancellation and rejected-save paths.
function readAuthoritativeFixtureState() {
    const state = {};
    for (const relative of walkFiles(LUMPS_DIR).filter(file =>
        !isTransientFixturePath(file)).sort()) {
        state[relative.split(path.sep).join('/')] =
            fs.readFileSync(path.join(LUMPS_DIR, relative)).toString('base64');
    }
    state.__boot_config__ = fs.readFileSync(BOOT_CONFIG_PATH).toString('base64');
    state.__build_snapshots__ = walkFiles(BUILD_SNAPSHOTS_DIR).sort().map(file => [
        file.split(path.sep).join('/'),
        fs.readFileSync(path.join(BUILD_SNAPSHOTS_DIR, file)).toString('base64'),
    ]);
    return state;
}

function readDiagnosticRows() {
    const filename = path.join(LUMPS_DIR, 'save-runtime-diagnostics.jsonl');
    if (!fs.existsSync(filename)) return [];
    return fs.readFileSync(filename, 'utf8').split('\n')
        .filter(Boolean)
        .map(line => {
            try { return JSON.parse(line); } catch (_) { return null; }
        })
        .filter(Boolean);
}

async function waitForDiagnosticRows(predicate, timeout = 12000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const rows = readDiagnosticRows();
        if (predicate(rows)) return rows;
        await sleep(100);
    }
    return readDiagnosticRows();
}

function wordsFromLump(filename) {
    const bytes = fs.readFileSync(path.join(LUMPS_DIR, filename));
    const words = [];
    for (let offset = 0; offset + 4 <= bytes.length; offset += 4) {
        words.push(bytes.readUInt32BE(offset));
    }
    return words;
}

function assertNoSelfPlaceholder(words, label) {
    expect(words.length, `${label} must contain a binary`).toBeGreaterThan(1);
    const header = words[0] >>> 0;
    const lumpSize = 64 << ((header >>> 23) & 0x0F);
    const cc = header & 0xFF;
    expect(words.length, `${label} must contain its declared allocation`).toBeGreaterThanOrEqual(lumpSize);
    for (let row = 0; row < cc; row++) {
        expect(words[lumpSize - cc + row] >>> 16,
            `${label} c-list row ${row} still contains SELF placeholder`)
            .not.toBe(0xFEED);
    }
}

test.describe('Task 3430 — hamburger Save Lump source round-trip', () => {
    test.beforeEach(async ({ page }) => {
        // Hardware notifications are unrelated to this repository flow and can
        // otherwise open a live-device toast while a modal is being exercised.
        await page.route('**/hardware/**', route => route.abort());

        // Keep welcome/tutorial overlays from covering the hamburger controls.
        // A fresh diagnostics queue is part of the test contract: a stale
        // browser session must not be allowed to masquerade as this save.
        await page.addInitScript(() => {
            localStorage.setItem('church_welcome_dismissed', '1');
            localStorage.setItem('church_welcome_dismissed_perm', '1');
            localStorage.setItem('churchMachine_mathGuideDismissed_perm', '1');
            localStorage.removeItem('church.lump-save-diagnostics:v1');
            sessionStorage.setItem('church_welcome_dismissed_session', '1');
            for (const lang of [
                'cloomc', 'javascript', 'haskell', 'english', 'symbolic',
                'lambda', 'assembly',
            ]) {
                localStorage.setItem(`church_intro_dismissed_${lang}`, 'true');
            }
        });
    });

    test('replaces CapabilityTest, preserves cancelled/failed saves, and restores exact source', async ({ page }) => {
        test.setTimeout(120000);

        await page.goto('/simulator/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof switchView === 'function');
        expect(await page.evaluate(() => JSON.parse(
            localStorage.getItem('church.lump-save-diagnostics:v1') || '[]'
        ))).toEqual([]);

        // Use the global hamburger to reach Programs / Editor.
        await page.locator('#hamBtn').click();
        // Menu groups are collapsed by default; expand Code before selecting
        // the editor item (the item exists in the DOM but is not actionable
        // until its group is opened).
        await page.locator('#hamDropdown .ham-section').filter({ hasText: 'Code' })
            .locator('.ham-section-head').click();
        await page.locator('#hamItem-editor').click();
        await page.locator('#asmEditor').waitFor({ state: 'visible', timeout: 10000 });

        async function compile(source, language) {
            await page.locator('#langSelector').selectOption(language);
            await page.locator('#asmEditor').fill(source);
            await page.locator('#editorActionsBtn').click();
            await page.locator('#editorActionsDropdown').waitFor({ state: 'visible' });
            const dismissAutomaticCompileApproval = async dialog => {
                await dialog.dismiss();
            };
            page.on('dialog', dismissAutomaticCompileApproval);
            await page.locator('#btnHamCompile').click();
            await expect.poll(
                () => page.evaluate(() => {
                    const token = window.LumpRegistry && window.LumpRegistry.getCurrent();
                    const entry = token && window.LumpRegistry.resolve(token);
                    const memory = entry && entry.sources && entry.sources.memory;
                    return !!(memory && Array.isArray(memory.words) && memory.words.length > 0);
                }),
                { timeout: 20000, message: 'compile did not register LUMP words' }
            ).toBe(true);
            page.off('dialog', dismissAutomaticCompileApproval);
        }

        async function openSaveDialog() {
            await page.locator('#editorActionsBtn').click();
            await page.locator('#btnHamSaveLump').click();
            const formatDialog = page.locator('#formatLumpDialog');
            await expect(page.locator('#formatLumpDialog:visible, #saveNSDialog:visible')).toBeVisible({ timeout: 10000 });
            if (await formatDialog.isVisible().catch(() => false)) {
                await expect(formatDialog).toBeVisible();
                const proceed = page.locator('#fmtProceedBtn');
                await expect(proceed).toBeEnabled();
                await proceed.click();
                await expect(formatDialog).toBeHidden({ timeout: 10000 });
            }
            await expect(page.locator('#saveNSDialog')).toBeVisible({ timeout: 10000 });
        }

        async function saveThroughApproval(slot, label) {
            await page.locator('#saveNSSlot').selectOption(String(slot));
            await page.locator('#saveNSLabel').fill(label);

            const planResponsePromise = page.waitForResponse(response =>
                response.url().endsWith('/api/lumps/save-plan') &&
                response.request().method() === 'POST');
            const intentResponsePromise = page.waitForResponse(response =>
                response.url().endsWith('/api/lumps/approval-intent') &&
                response.request().method() === 'POST');
            const saveRequestPromise = page.waitForRequest(request =>
                request.url().endsWith('/api/lumps/save') &&
                request.method() === 'POST');
            const saveResponsePromise = page.waitForResponse(response =>
                response.url().endsWith('/api/lumps/save') &&
                response.request().method() === 'POST');
            const dialogPromise = page.waitForEvent('dialog');
            await page.locator('#saveNSConfirmBtn').click();
            const planResponse = await planResponsePromise;
            if (!planResponse.ok()) {
                throw new Error(`save-plan ${planResponse.status()}: ${
                    JSON.stringify(await planResponse.json())}`);
            }
            const approvalDialog = await dialogPromise;
            expect(approvalDialog.message()).toMatch(/Replace|Create/);
            await approvalDialog.accept();

            const [intentResponse, saveRequest, saveResponse] =
                await Promise.all([
                    intentResponsePromise,
                    saveRequestPromise, saveResponsePromise,
                ]);
            expect(intentResponse.ok()).toBeTruthy();
            expect(saveResponse.ok()).toBeTruthy();
            const plan = await planResponse.json();
            const intent = await intentResponse.json();
            const requestBody = saveRequest.postDataJSON();
            const responseBody = await saveResponse.json();
            expect(plan).toEqual(expect.objectContaining({
                plan_id: expect.any(String),
                action: expect.stringMatching(/^(save|replace)$/),
                consequence: expect.stringMatching(/^(create|replace)$/),
                final_binary: expect.any(Array),
            }));
            expect(intent).toEqual(expect.objectContaining({
                intent: expect.any(String),
                digest: expect.any(String),
            }));
            expect(requestBody.metadata).toEqual(expect.objectContaining({
                approval_intent: expect.any(String),
                save_plan_id: plan.plan_id,
                diagnostic_attempt_id: expect.any(String),
            }));
            expect(saveRequest.headers()['x-lump-save-operation']).toEqual(
                expect.any(String)
            );
            expect(responseBody).toEqual(expect.objectContaining({
                ok: true,
                token: expect.any(String),
                lump_version: expect.anything(),
                operation_id: expect.any(String),
            }));
            expect(Number(responseBody.lump_version)).toBeGreaterThan(0);
            if (slot !== 'new') expect(responseBody.ns_slot).toBe(Number(slot));
            await expect(page.locator('#saveNSDialog')).toBeHidden({ timeout: 15000 });
            await page.evaluate(async () => Promise.all(
                window._nsLabelPersistPromises || []
            ));
            return { plan, intent, requestBody, responseBody };
        }

        // First exercise the requested CLOOMC++ compile and create a disposable
        // user entry.  The later raw-assembly save replaces the pre-existing
        // CapabilityTest-style Namespace row.
        await compile(SOURCE, 'javascript');
        const created = await (async () => {
            await openSaveDialog();
            return saveThroughApproval('new', ABSTRACTION_NAME);
        })();
        expect(created.plan.consequence).toBe('create');

        // Reproduce SELF + named SelfTest before LOAD, then replace NS[10]
        // (the copied fixture's existing CapabilityTest entry).
        await compile(SELF_PRIOR_LOAD_SOURCE, 'assembly');
        await openSaveDialog();
        const replaced = await saveThroughApproval('10', 'CapabilityTest');
        expect(replaced.plan.action).toBe('replace');
        expect(replaced.plan.consequence).toBe('replace');
        expect(replaced.plan.ns_slot).toBe(10);
        expect(replaced.requestBody.metadata.ns_slot).toBe(10);

        const saved = replaced.responseBody;
        expect(saved.final_binary).toEqual(expect.any(Array));
        assertNoSelfPlaceholder(saved.final_binary, 'server final_binary');
        const persistedWords = wordsFromLump(saved.lump);
        assertNoSelfPlaceholder(persistedWords, 'persisted replacement artifact');
        await page.screenshot({
            path: 'test-results/task3430-save-commit-success.png',
            fullPage: true,
        });

        const manifest = JSON.parse(fs.readFileSync(
            path.join(LUMPS_DIR, 'manifest.json'), 'utf8'));
        const manifestEntry = manifest.find(entry => entry.token === saved.token);
        expect(manifestEntry).toEqual(expect.objectContaining({
            token: saved.token,
            filename: saved.lump,
        }));
        const namespace = JSON.parse(fs.readFileSync(
            path.join(LUMPS_DIR, 'ns-state.json'), 'utf8'));
        expect(namespace.abstractions.find(row => row.slot === 10)).toEqual(
            expect.objectContaining({ token: saved.token, filename: saved.lump })
        );

        // Server diagnostics must correlate this fresh browser attempt to the
        // durable operation; a prior localStorage queue cannot be accepted.
        const operationId = saved.operation_id;
        const clientAttemptId = replaced.requestBody.metadata.diagnostic_attempt_id;
        const diagnostics = await waitForDiagnosticRows(rows =>
            rows.some(row => row.operation_id === operationId &&
                row.stage === 'commit' && row.outcome === 'committed'));
        const matchingDiagnostics = diagnostics.filter(row =>
            row.operation_id === operationId);
        expect(matchingDiagnostics.length).toBeGreaterThan(0);
        const authoritativeDiagnostics = matchingDiagnostics.filter(row =>
            row.authoritative === true);
        expect(authoritativeDiagnostics.length).toBeGreaterThan(0);
        expect(authoritativeDiagnostics.some(row =>
            row.client_diagnostic_attempt_id === clientAttemptId)).toBeTruthy();
        expect(new Set(matchingDiagnostics.map(row => row.attempt_id)).size)
            .toBeGreaterThan(0);

        // Establish the authoritative baseline after the successful commit.
        const committedState = readAuthoritativeFixtureState();
        const sourceBeforeCancel = await page.locator('#asmEditor').inputValue();
        const settingsBeforeCancel = await page.evaluate(() => ({
            slot: document.getElementById('saveNSSlot').value,
            label: document.getElementById('saveNSLabel').value,
            type: document.getElementById('saveNSType').value,
            rights: ['R', 'W', 'X', 'L', 'S', 'E'].reduce((all, right) => {
                all[right] = document.getElementById('perm' + right).checked;
                return all;
            }, {}),
        }));
        expect(sourceBeforeCancel).toBe(SELF_PRIOR_LOAD_SOURCE);
        expect(settingsBeforeCancel.slot).toBe('10');

        // A real server save-plan is still issued, but cancelling the browser
        // approval must not issue /api/lumps/save or alter authoritative state.
        await openSaveDialog();
        await page.locator('#saveNSSlot').selectOption('10');
        await page.locator('#saveNSLabel').fill('CapabilityTest');
        let saveRequestsAfterCancel = 0;
        const countSaveRequest = request => {
            if (request.url().endsWith('/api/lumps/save') && request.method() === 'POST') {
                saveRequestsAfterCancel++;
            }
        };
        page.on('request', countSaveRequest);
        const cancelPlanResponse = page.waitForResponse(response =>
            response.url().endsWith('/api/lumps/save-plan') &&
            response.request().method() === 'POST');
        const cancelDialog = page.waitForEvent('dialog');
        await page.locator('#saveNSConfirmBtn').click();
        const cancellation = await cancelDialog;
        await cancellation.dismiss();
        expect((await cancelPlanResponse).ok()).toBeTruthy();
        await expect(page.locator('#saveNSStatus')).toContainText(
            'Not saved — confirmation was cancelled.'
        );
        await sleep(500);
        page.off('request', countSaveRequest);
        expect(saveRequestsAfterCancel).toBe(0);
        expect(readAuthoritativeFixtureState()).toEqual(committedState);
        expect(await page.locator('#asmEditor').inputValue()).toBe(sourceBeforeCancel);
        const settingsAfterCancel = await page.evaluate(() => ({
            slot: document.getElementById('saveNSSlot').value,
            label: document.getElementById('saveNSLabel').value,
            type: document.getElementById('saveNSType').value,
            rights: ['R', 'W', 'X', 'L', 'S', 'E'].reduce((all, right) => {
                all[right] = document.getElementById('perm' + right).checked;
                return all;
            }, {}),
        }));
        expect(settingsAfterCancel).toEqual(settingsBeforeCancel);

        // Exercise a client-side failure path as well: an empty identity is
        // rejected before any repository mutation and preserves all settings.
        await page.locator('#saveNSLabel').fill('');
        await page.locator('#saveNSConfirmBtn').click();
        await expect(page.locator('#saveNSStatus')).toContainText(
            'Enter a LUMP / Namespace Name'
        );
        expect(readAuthoritativeFixtureState()).toEqual(committedState);
        expect(await page.locator('#asmEditor').inputValue()).toBe(sourceBeforeCancel);

        // Finally send a deliberately invalid approval through the real browser
        // session.  This proves the server failure path preserves the committed
        // Namespace/artifact, rather than merely testing a disabled UI button.
        await page.locator('#saveNSLabel').fill('CapabilityTest');
        await page.locator('#saveNSCancelBtn').click();
        const failedSave = await page.evaluate(async payload => {
            payload.metadata = Object.assign({}, payload.metadata, {
                operation_id: 'task3430-failure-0001',
                operation_key: 'task3430-failure-0001',
                approval_intent: 'invalid-task3430-intent',
            });
            const response = await fetch('/api/lumps/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Lump-Save-Operation': payload.metadata.operation_id,
                },
                body: JSON.stringify(payload),
            });
            return { status: response.status, body: await response.json() };
        }, replaced.requestBody);
        expect(failedSave.status).toBeGreaterThanOrEqual(400);
        expect(failedSave.body).toEqual(expect.objectContaining({
            error: expect.any(String),
        }));
        expect(readAuthoritativeFixtureState()).toEqual(committedState);
        expect(await page.locator('#asmEditor').inputValue()).toBe(sourceBeforeCancel);
        expect(await page.evaluate(() => ({
            slot: document.getElementById('saveNSSlot').value,
            label: document.getElementById('saveNSLabel').value,
            type: document.getElementById('saveNSType').value,
            rights: ['R', 'W', 'X', 'L', 'S', 'E'].reduce((all, right) => {
                all[right] = document.getElementById('perm' + right).checked;
                return all;
            }, {}),
        }))).toEqual(settingsBeforeCancel);

        // Reload to prove source comes from the persisted replacement LUMP, not
        // from the previous page's in-memory editor/registry state.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof switchView === 'function');
        await page.locator('#hamBtn').click();
        await page.locator('#hamDropdown .ham-section-head').filter({ hasText: /^Abstractions$/ }).click();
        await page.locator('#hamItem-lumps').click();
        await page.locator('#lumpPickerSelect').waitFor({ state: 'visible', timeout: 20000 });
        await page.locator('#lumpPickerSelect').selectOption(saved.token);
        const openButton = page.locator(`.lump-edit-btn[data-edit-token="${saved.token}"]`);
        await openButton.waitFor({ state: 'visible', timeout: 15000 });
        await openButton.click();
        await page.locator('#asmEditor').waitFor({ state: 'visible', timeout: 15000 });
        await expect(page.locator('#_lumpSourceRestoredBanner')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#asmEditor')).toHaveValue(
            SELF_PRIOR_LOAD_SOURCE, { timeout: 15000 }
        );
    });
});