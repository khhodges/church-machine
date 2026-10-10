'use strict';

// Opt-in against the disposable private IDX1 fixture server:
// IDX1_PRIVATE_FIXTURE_URL=http://127.0.0.1:5001 npx playwright test \
//   --config tests/e2e/idx1-private.config.js
//
// This deliberately does not use the default application server or any
// production/live artifact state. The fixture server owns both revisions.
const { test, expect } = require('@playwright/test');

test('opens each exact saved IDX1 source revision and preserves editor on bundle error', async ({ browser }) => {
    const fixtureOrigin = process.env.IDX1_PRIVATE_FIXTURE_URL;
    test.skip(!fixtureOrigin, 'Set IDX1_PRIVATE_FIXTURE_URL to the private IDX1 fixture server.');

    const context = await browser.newContext({ baseURL: fixtureOrigin });
    const page = await context.newPage();
    try {
        const fixtureResponse = await context.request.get('/__test_idx1_revisions');
        expect(fixtureResponse.ok()).toBeTruthy();
        const revisions = await fixtureResponse.json();
        expect(revisions).toHaveLength(2);
        const [first, second] = revisions;
        expect(first.token).toBe(second.token);
        expect(first.binary_hash).toBe(second.binary_hash);
        expect(first.filename).not.toBe(second.filename);
        expect(first.source).toContain('; exact first revision');
        expect(second.source).toContain('; exact second revision');

        await page.goto('/simulator/');
        await page.waitForFunction(() =>
            typeof window.openLumpInEditor === 'function'
            && !!document.querySelector('#asmEditor')
        );

        const openExactRevision = async revision => page.evaluate(
            ({ token, filename, binary_hash }) => window.openLumpInEditor(
                token,
                { exactSavedArtifact: { token, filename, binary_hash } }
            ),
            {
                token: revision.token,
                filename: revision.filename,
                binary_hash: revision.binary_hash,
            }
        );

        await openExactRevision(first);
        await expect(page.locator('#asmEditor')).toHaveValue(first.source);
        await expect(page.getByText('Source restored from saved LUMP')).toBeVisible();

        await openExactRevision(second);
        await expect(page.locator('#asmEditor')).toHaveValue(second.source);
        await expect(page.getByText('Source restored from saved LUMP')).toBeVisible();

        // The archived first revision must still reopen exactly after v2.
        await openExactRevision(first);
        await expect(page.locator('#asmEditor')).toHaveValue(first.source);
        await expect(page.getByText('Source restored from saved LUMP')).toBeVisible();

        const editorBeforeError = await page.locator('#asmEditor').inputValue();
        const encodedFilename = encodeURIComponent(first.filename);
        const wordsUrl = new RegExp(
            '^' + fixtureOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            + `/api/lump/${first.token}/words\\?exact_filename=${encodedFilename}`
            + `&binary_hash=${first.binary_hash}$`
        );
        let interceptedWordsResponses = 0;
        await page.route(wordsUrl, async route => {
            const response = await route.fetch();
            const payload = await response.json();
            payload.variant_error = 'Test injected: exact source bundle could not be loaded.';
            interceptedWordsResponses += 1;
            await route.fulfill({ response, body: JSON.stringify(payload) });
        });

        await openExactRevision(first);
        await expect(page.locator('#asmEditor')).toHaveValue(editorBeforeError);
        await expect(page.getByText('Saved source unavailable')).toBeVisible();
        await expect(page.getByText(/Your editor text was kept/i)).toBeVisible();
        await expect(page.getByText(/Restore this revision.s source bundle and reopen it/i)).toBeVisible();
        expect(interceptedWordsResponses).toBe(1);
    } finally {
        await context.close();
    }
});

test('IDX1 compiled candidate defaults to API and keeps snapshot profile/binary in sync', async ({ browser }) => {
    const fixtureOrigin = process.env.IDX1_PRIVATE_FIXTURE_URL;
    test.skip(!fixtureOrigin, 'Set IDX1_PRIVATE_FIXTURE_URL to the private IDX1 fixture server.');

    const context = await browser.newContext({ baseURL: fixtureOrigin });
    const page = await context.newPage();
    try {
        const response = await context.request.get('/__test_idx1_revisions');
        expect(response.ok()).toBeTruthy();
        const [, revision] = await response.json();

        await page.goto('/simulator/');
        await page.waitForFunction(() =>
            typeof window.openLumpInEditor === 'function'
            && typeof window.IDEActions?.compile === 'function'
            && typeof window.showFormatLump === 'function'
        );
        await page.evaluate(({ token, filename, binary_hash }) => window.openLumpInEditor(
            token,
            { exactSavedArtifact: { token, filename, binary_hash } }
        ), {
            token: revision.token,
            filename: revision.filename,
            binary_hash: revision.binary_hash,
        });
        await expect(page.locator('#asmEditor')).toHaveValue(revision.source);

        const explicitIndexedSource = [
            '; @abstraction PrivateIDX1',
            'BFEXT DR2, DR3, DR11, 3',
            'RETURN',
            '; explicit indexed profile',
            '',
        ].join('\n');
        await page.locator('#asmEditor').fill(explicitIndexedSource);
        const compileResult = await page.evaluate(() => IDEActions.compile());
        expect(compileResult.ok).toBeTruthy();
        expect(compileResult.candidate).toBeTruthy();
        expect(compileResult.sourceText).toBe(explicitIndexedSource);
        // The compile result exposes only candidate:true; the editor's
        // candidate status identifies the inferred ISA before the format UI.
        await expect(page.getByText(/IDX1 candidate: Save LUMP/)).toBeVisible();
        await page.evaluate(() => showFormatLump());

        const initial = await page.evaluate(() => {
            const pending = window._pendingLumpData;
            const snapshot = window._saveNSPreparedSnapshot?.pending;
            return {
                isaProfile: pending?.isaProfile,
                selectedProfile: pending?.selectedProfile,
                snapshotProfile: snapshot?.selectedProfile,
                apiBinary: pending?.candidates?.api?.binary,
                fullBinary: pending?.candidates?.full?.binary,
                pendingBinary: pending?.binary,
                snapshotBinary: snapshot?.binary,
            };
        });
        expect(initial.isaProfile).toBe('IDX1');
        expect(initial.selectedProfile).toBe('api');
        expect(initial.snapshotProfile).toBe('api');
        expect(initial.pendingBinary).toEqual(initial.apiBinary);
        expect(initial.snapshotBinary).toEqual(initial.apiBinary);
        expect(initial.fullBinary).not.toEqual(initial.apiBinary);
        await expect(page.getByRole('dialog')).toContainText('API only — build/test');
        await expect(page.getByRole('dialog')).toContainText('no embedded source');
        await expect(page.getByRole('dialog')).toContainText('36 frame words');

        await page.getByRole('radio', { name: /Full — IDE editing/ }).click();
        const full = await page.evaluate(() => ({
            selectedProfile: window._pendingLumpData?.selectedProfile,
            snapshotProfile: window._saveNSPreparedSnapshot?.pending?.selectedProfile,
            pendingBinary: window._pendingLumpData?.binary,
            snapshotBinary: window._saveNSPreparedSnapshot?.pending?.binary,
            fullBinary: window._pendingLumpData?.candidates?.full?.binary,
        }));
        expect(full.selectedProfile).toBe('full');
        expect(full.snapshotProfile).toBe('full');
        expect(full.pendingBinary).toEqual(full.fullBinary);
        expect(full.snapshotBinary).toEqual(full.fullBinary);
        await expect(page.getByRole('dialog')).toContainText('57 frame words');

        await page.getByRole('radio', { name: /API only — build\/test/ }).click();
        const apiAgain = await page.evaluate(() => ({
            selectedProfile: window._pendingLumpData?.selectedProfile,
            snapshotProfile: window._saveNSPreparedSnapshot?.pending?.selectedProfile,
            pendingBinary: window._pendingLumpData?.binary,
            snapshotBinary: window._saveNSPreparedSnapshot?.pending?.binary,
            apiBinary: window._pendingLumpData?.candidates?.api?.binary,
        }));
        expect(apiAgain.selectedProfile).toBe('api');
        expect(apiAgain.snapshotProfile).toBe('api');
        expect(apiAgain.pendingBinary).toEqual(apiAgain.apiBinary);
        expect(apiAgain.snapshotBinary).toEqual(apiAgain.apiBinary);
    } finally {
        await context.close();
    }
});
