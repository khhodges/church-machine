'use strict';

// Browser-script integration coverage for promotion repair. Load
// all of app-lumps.js so this test exercises its real approval/save-plan
// helpers and catches missing browser globals or integration-time failures.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto, createHash } = require('crypto');
const { JSDOM } = require('jsdom');
const actionableErrors = require('./actionable_errors.js');
const { checkCacheKeys } = require('../scripts/check_assembler_browser_freshness.js');

// Behavior alone cannot detect an entry page pinned to incompatible old helpers.
const entryPage = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert.deepStrictEqual(checkCacheKeys(entryPage).failures, [],
    'every pinned browser script must match its current content');
for (const name of ['actionable_errors.js', 'app-lumps.js', 'lump_save_handler.js']) {
    const pin = new RegExp(`${name.replace(/\./g, '\\.')}\\?v=sha256-[a-f0-9]{12}`);
    assert(pin.test(entryPage), `${name} must remain pinned`);
    for (const invalid of ['sha256-000000000000', 'sha256-000000000000-promotion1']) {
        const stalePage = entryPage.replace(pin, `${name}?v=${invalid}`);
        assert(checkCacheKeys(stalePage).failures.some(failure => failure.includes(name)),
            `${name}: freshness guard must reject ${invalid}`);
    }
}

const appSource = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
const HASH = 'a'.repeat(64);
const ARCHIVE = { token: 'old-token', abstraction: 'Demo', lump_version: 1 };
const CANDIDATE = {
    ok: true,
    abstraction: 'Demo',
    revision: 2,
    token: 'new-token',
    binary_hash: HASH,
    intrinsic_source: true,
    immutable: true,
    source: '.abstraction Demo\n.method Main\n  RETURN AL\n.end',
    words: [0xf8000401, 0x1f000000],
    approval: {
        binary_hash: HASH,
        author: 'Alice',
        grants: ['E'],
        capability_type: 'inform',
    },
    promotion_binding: {
        binding_id: 'server-binding',
        abstraction: 'Demo',
        token: 'new-token',
        revision: 2,
        binary_hash: HASH,
        ns_slot: null,
        namespace_sequence: null,
        bootstrap_snapshot: null,
    },
};

function response(payload, ok = true, status = 200) {
    return {
        ok,
        status,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify(payload),
        json: async () => payload,
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function makeContext(fetchImpl, confirmed = true) {
    const dom = new JSDOM(
        '<!doctype html><html><body><div id="lumpsDetailContent"></div></body></html>',
        { url: 'http://localhost/' });
    const calls = { fetch: [], confirms: [], render: 0, namespace: 0, boot: 0 };
    const sandbox = {
        window: dom.window,
        document: dom.window.document,
        navigator: dom.window.navigator,
        location: dom.window.location,
        crypto: webcrypto,
        TextEncoder,
        TextDecoder,
        Uint8Array,
        ArrayBuffer,
        Blob: dom.window.Blob,
        URL: dom.window.URL,
        console,
        setTimeout,
        clearTimeout,
        encodeURIComponent,
        decodeURIComponent,
        _lumpsCache: [clone(ARCHIVE)],
        _escHtml: value => String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        ...actionableErrors,
        confirm: message => {
            calls.confirms.push(message);
            return typeof confirmed === 'function' ? confirmed(message) : confirmed;
        },
        alert: () => {},
        renderLumps: async () => { calls.render++; },
        updateNamespace: async () => { calls.namespace++; },
        _loadBootConfig: async () => { calls.boot++; },
        _lumpSaveRequest: async (requestFetch, url, payload) => {
            const response = await requestFetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const result = await response.json();
            if (!response.ok) {
                const error = new Error(result.error || 'save failed');
                error.committed = result.committed;
                throw error;
            }
            return result;
        },
        fetch: async (...args) => {
            calls.fetch.push(args);
            return fetchImpl(...args);
        },
    };
    dom.window.confirm = sandbox.confirm;
    dom.window.alert = sandbox.alert;
    dom.window.fetch = sandbox.fetch;
    vm.createContext(sandbox);
    vm.runInContext(appSource, sandbox, { filename: 'app-lumps.js' });
    assert.strictEqual(typeof sandbox.window._showLatestCompilationPromotion, 'function',
        'complete app-lumps.js exposes promotion integration');
    return { sandbox, calls, document: dom.window.document };
}

async function open(ctx) {
    await ctx.sandbox.window._showLatestCompilationPromotion('old-token');
}

function preview(ctx) {
    return ctx.document.querySelector('.lump-promotion-source');
}

function status(ctx) {
    const element = ctx.document.getElementById('lumpPromotionStatus');
    return element ? element.textContent : '';
}

function request(ctx, endpoint) {
    return ctx.calls.fetch.find(call => String(call[0]) === endpoint);
}

function assertPreviewPreserved(ctx) {
    assert(preview(ctx), 'source preview remains mounted');
    assert.strictEqual(preview(ctx).textContent, CANDIDATE.source,
        'exact immutable candidate source remains visible');
}

(async () => {
    // Candidate GET renders exact intrinsic source, and the preview's Cancel
    // action performs no planning, approval, or mutation request.
    {
        const ctx = makeContext(() => response(CANDIDATE));
        await open(ctx);
        assert.strictEqual(ctx.calls.fetch[0][0],
            '/api/lumps/latest-primary/Demo?from_token=old-token&from_revision=1');
        assert.deepStrictEqual(clone(ctx.calls.fetch[0][1]), { cache: 'no-store' });
        assertPreviewPreserved(ctx);
        ctx.document.getElementById('lumpPromotionCancel').click();
        assert.strictEqual(ctx.calls.fetch.length, 1);
    }

    // The production confirmation path must obtain a server-authored plan,
    // then a one-time approval intent, then submit the canonical save.
    {
        const ctx = makeContext(async (url, options) => {
            if (String(url).includes('/latest-primary/')) return response(CANDIDATE);
            const body = JSON.parse(options.body);
            if (url === '/api/lumps/save-plan') {
                const digest = createHash('sha256').update(Buffer.from(
                    body.binary.flatMap(word => [
                        (word >>> 24) & 0xFF, (word >>> 16) & 0xFF,
                        (word >>> 8) & 0xFF, word & 0xFF,
                    ])
                )).digest('hex');
                return response({
                    ok: true,
                    plan_id: 'promotion-plan',
                    action: 'save',
                    consequence: 'create',
                    digest,
                    final_binary: body.binary.slice(),
                    ns_slot: null,
                });
            }
            if (url === '/api/lumps/approval-intent') {
                return response({
                    ok: true,
                    intent: 'promotion-intent',
                    digest: body.digest,
                    action: body.action,
                    plan_id: body.plan,
                });
            }
            if (url === '/api/lumps/save') {
                return response({ ok: true, token: 'final-token', seal: 'final-seal' });
            }
            throw new Error(`unexpected request ${url}`);
        });
        await open(ctx);
        await ctx.document.getElementById('lumpPromotionConfirm').onclick();

        assert.deepStrictEqual(ctx.calls.fetch.map(call => call[0]), [
            '/api/lumps/latest-primary/Demo?from_token=old-token&from_revision=1',
            '/api/lumps/save-plan',
            '/api/lumps/approval-intent',
            '/api/lumps/save',
        ]);
        const plan = JSON.parse(request(ctx, '/api/lumps/save-plan')[1].body);
        assert.deepStrictEqual(plan.binary, CANDIDATE.words);
        assert.strictEqual(plan.metadata.binary_hash, HASH);
        assert.strictEqual(plan.metadata.promotion_binding.binding_id, 'server-binding');
        const approval = JSON.parse(request(ctx, '/api/lumps/approval-intent')[1].body);
        assert.deepStrictEqual(approval, {
            digest: createHash('sha256').update(Buffer.from(
                plan.binary.flatMap(word => [
                    (word >>> 24) & 0xFF, (word >>> 16) & 0xFF,
                    (word >>> 8) & 0xFF, word & 0xFF,
                ])
            )).digest('hex'),
            action: 'save',
            confirmation: true,
            plan: 'promotion-plan',
            approval: {
                abstraction: 'Demo',
                author: 'Alice',
                grants: ['E'],
                capability_type: 'inform',
            },
        });
        const save = JSON.parse(request(ctx, '/api/lumps/save')[1].body);
        assert.deepStrictEqual(save.binary, CANDIDATE.words);
        assert.strictEqual(save.metadata.save_plan_id, 'promotion-plan');
        assert.strictEqual(save.metadata.approval_intent, 'promotion-intent');
        assert.strictEqual(save.metadata.promoted_from_token, 'new-token');
        assert(status(ctx).includes('final-token'));
        assert(status(ctx).includes('final-seal'));
        assert.deepStrictEqual(
            [ctx.calls.render, ctx.calls.namespace, ctx.calls.boot], [1, 1, 1]);
    }

    // Declining the real plan confirmation occurs after planning but before
    // approval or save, and leaves the candidate available for reconsideration.
    {
        const ctx = makeContext((url) => String(url).includes('/latest-primary/')
            ? response(CANDIDATE)
            : response({
                ok: true, plan_id: 'cancel-plan', action: 'save',
                consequence: 'create',
                digest: createHash('sha256').update(Buffer.from(
                    CANDIDATE.words.flatMap(word => [
                        (word >>> 24) & 0xFF, (word >>> 16) & 0xFF,
                        (word >>> 8) & 0xFF, word & 0xFF,
                    ])
                )).digest('hex'),
                final_binary: CANDIDATE.words.slice(), ns_slot: null,
            }), false);
        await open(ctx);
        await ctx.document.getElementById('lumpPromotionConfirm').onclick();
        assert.deepStrictEqual(ctx.calls.fetch.map(call => call[0]), [
            '/api/lumps/latest-primary/Demo?from_token=old-token&from_revision=1',
            '/api/lumps/save-plan',
        ]);
        assert.strictEqual(ctx.calls.confirms.length, 1);
        assert(status(ctx).includes('Cancelled'));
        assert(status(ctx).includes('no data was changed'));
        assertPreviewPreserved(ctx);
    }

    // Candidate endpoint errors retain the authentic server reason and give a
    // non-mutating recovery action.
    {
        const ctx = makeContext(() =>
            response({ ok: false, error: 'candidate unavailable' }, false, 409));
        await open(ctx);
        const text = ctx.document.body.textContent;
        assert(text.includes('candidate unavailable'));
        assert(text.includes('No data was changed'));
        assert(text.includes('Reload the LUMP repository'));
        assert.strictEqual(ctx.calls.fetch.length, 1);
    }

    // A pre-save server rejection is actionable without removing the preview.
    {
        const ctx = makeContext((url) => String(url).includes('/latest-primary/')
            ? response(CANDIDATE)
            : response({ ok: false, error: 'policy denied this save plan' }, false, 403));
        await open(ctx);
        await ctx.document.getElementById('lumpPromotionConfirm').onclick();
        assert(status(ctx).includes('policy denied this save plan'));
        assert(status(ctx).includes('No data was changed'));
        assert(status(ctx).includes('Next:'));
        assertPreviewPreserved(ctx);
        assert(!request(ctx, '/api/lumps/save'));
    }

    // Client-side hash/approval validation also remains explicitly pre-save and
    // keeps the immutable source visible.
    {
        const badCandidate = clone(CANDIDATE);
        badCandidate.approval.binary_hash = 'b'.repeat(64);
        const ctx = makeContext(() => response(badCandidate));
        await open(ctx);
        await ctx.document.getElementById('lumpPromotionConfirm').onclick();
        assert(status(ctx).includes('not bound to the fetched LUMP binary hash'));
        assert(status(ctx).includes('No data was changed'));
        assert(status(ctx).includes('Next:'));
        assertPreviewPreserved(ctx);
        assert.strictEqual(ctx.calls.fetch.length, 1);
    }

    // An authoritative save rejection is known not to have committed and
    // preserves both the reason and preview.
    {
        const ctx = makeContext((url, options) => {
            if (String(url).includes('/latest-primary/')) return response(CANDIDATE);
            if (url === '/api/lumps/save-plan') {
                return response({
                    ok: true, plan_id: 'p', action: 'save',
                    consequence: 'create',
                    digest: createHash('sha256').update(Buffer.from(
                        CANDIDATE.words.flatMap(word => [
                            (word >>> 24) & 0xFF, (word >>> 16) & 0xFF,
                            (word >>> 8) & 0xFF, word & 0xFF,
                        ])
                    )).digest('hex'),
                    final_binary: CANDIDATE.words.slice(), ns_slot: null,
                });
            }
            if (url === '/api/lumps/approval-intent') {
                const body = JSON.parse(options.body);
                return response({
                    ok: true, intent: 'i', digest: body.digest,
                    action: body.action, plan_id: body.plan,
                });
            }
            return response({
                ok: false, error: 'candidate became stale', committed: false,
            }, false, 409);
        });
        await open(ctx);
        await ctx.document.getElementById('lumpPromotionConfirm').onclick();
        assert(status(ctx).includes('candidate became stale'));
        assert(status(ctx).includes('No data was changed'));
        assert(!status(ctx).includes('outcome is unknown'));
        assertPreviewPreserved(ctx);
    }

    // Once the canonical save transport starts, loss of the response is an
    // unknown outcome.  Do not discard the original transport diagnosis.
    {
        const ctx = makeContext((url, options) => {
            if (String(url).includes('/latest-primary/')) return response(CANDIDATE);
            if (url === '/api/lumps/save-plan') {
                return response({
                    ok: true, plan_id: 'p', action: 'save',
                    consequence: 'create',
                    digest: createHash('sha256').update(Buffer.from(
                        CANDIDATE.words.flatMap(word => [
                            (word >>> 24) & 0xFF, (word >>> 16) & 0xFF,
                            (word >>> 8) & 0xFF, word & 0xFF,
                        ])
                    )).digest('hex'),
                    final_binary: CANDIDATE.words.slice(), ns_slot: null,
                });
            }
            if (url === '/api/lumps/approval-intent') {
                const body = JSON.parse(options.body);
                return response({
                    ok: true, intent: 'i', digest: body.digest,
                    action: body.action, plan_id: body.plan,
                });
            }
            throw new Error('socket reset while sending canonical save');
        });
        await open(ctx);
        await ctx.document.getElementById('lumpPromotionConfirm').onclick();
        assert(status(ctx).includes('socket reset while sending canonical save'));
        assert(status(ctx).includes('outcome is unknown'));
        assert(status(ctx).includes('verify the repository'));
        assertPreviewPreserved(ctx);
    }

    console.log('PASS latest compilation promotion behavioral tests');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});