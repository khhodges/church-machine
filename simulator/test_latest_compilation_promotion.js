'use strict';

// Behavioral regression coverage for Task #3393.  This deliberately loads the
// production recovery function into a small jsdom context; it does not copy its
// implementation or assert on source text.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
function extractFunction(name) {
    const start = source.indexOf(`async function ${name}(`);
    assert(start >= 0, `${name} exists`);
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`unterminated ${name}`);
}

const HASH = 'a'.repeat(64);
const ARCHIVE = { token: 'old-token', abstraction: 'Demo', lump_version: 1 };
const CANDIDATE = {
    ok: true, abstraction: 'Demo', revision: 2, token: 'new-token',
    binary_hash: HASH, intrinsic_source: true, immutable: true,
    source: '.abstraction Demo\n.method Main\n  RETURN AL\n.end',
    words: [0xf8000401, 0x1f000000],
    approval: { binary_hash: HASH, grants: ['E'], capability_type: 'inform' },
    promotion_binding: {
        binding_id: 'server-binding', abstraction: 'Demo',
        token: 'new-token', revision: 2, binary_hash: HASH,
        ns_slot: null, namespace_sequence: null, bootstrap_snapshot: null,
    },
};

function response(payload, ok = true, status = 200) {
    return { ok, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

function makeContext(fetchImpl) {
    const dom = new JSDOM('<!doctype html><body><div id="lumpsDetailContent"></div></body>');
    const calls = { fetch: [], saves: [], detail: [], render: 0, namespace: 0, boot: 0 };
    const sandbox = {
        window: { _latestPromotionRequestId: 0 },
        document: dom.window.document,
        _lumpsCache: [ARCHIVE],
        _escHtml: value => String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        _actionableJsonResponse: async (resp, operation) => {
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || `${operation} failed`);
            return data;
        },
        _hashBoundLumpApproval: (payload, hash) => {
            assert.strictEqual(payload.approval.binary_hash, hash);
            return payload.approval;
        },
        _confirmLumpSavePlan: async (words, metadata) => {
            calls.saves.push({ words, metadata });
            return sandbox.confirmResult;
        },
        showLumpDetail: token => calls.detail.push(token),
        renderLumps: async () => { calls.render++; },
        updateNamespace: () => { calls.namespace++; },
        _loadBootConfig: async () => { calls.boot++; },
        fetch: async (...args) => {
            calls.fetch.push(args);
            return fetchImpl(...args);
        },
        console,
    };
    vm.createContext(sandbox);
    vm.runInContext(extractFunction('_showLatestCompilationPromotion'), sandbox);
    return { sandbox, calls, document: dom.window.document };
}

async function open(ctx) {
    await vm.runInContext('_showLatestCompilationPromotion("old-token")', ctx.sandbox);
}
function candidateFetch(_url) { return response(CANDIDATE); }

(async () => {
    // Exact source is rendered and cancellation is non-destructive.
    {
        const ctx = makeContext(candidateFetch);
        ctx.sandbox.confirmResult = null;
        await open(ctx);
        assert(ctx.document.querySelector('.lump-promotion-source').textContent
            .includes(CANDIDATE.source));
        ctx.document.getElementById('lumpPromotionCancel').click();
        assert.deepStrictEqual(ctx.calls.detail, ['old-token']);
        assert.strictEqual(ctx.calls.saves.length, 0);
    }

    // A slower first request cannot overwrite the second request's preview.
    {
        let resolveFirst;
        const first = new Promise(resolve => { resolveFirst = resolve; });
        let count = 0;
        const ctx = makeContext(() => (++count === 1 ? first : Promise.resolve(response({
            ...CANDIDATE, source: 'SECOND SOURCE',
        }))));
        const firstOpen = vm.runInContext(
            '_showLatestCompilationPromotion("old-token")', ctx.sandbox);
        await vm.runInContext('_showLatestCompilationPromotion("old-token")', ctx.sandbox);
        resolveFirst(response({ ...CANDIDATE, source: 'STALE FIRST SOURCE' }));
        await firstOpen;
        assert(ctx.document.querySelector('.lump-promotion-source').textContent
            .includes('SECOND SOURCE'));
        assert(!ctx.document.body.textContent.includes('STALE FIRST SOURCE'));
    }

    // Confirmation carries the exact candidate words/hash-bound approval to save.
    {
        const ctx = makeContext(async function(url, options) {
            if (String(url).includes('/latest-primary/')) return response(CANDIDATE);
            ctx.calls.savePayload = JSON.parse((options || {}).body || '{}');
            return response({ ok: true, token: 'final-token', seal: 'final-seal' });
        });
        ctx.sandbox.confirmResult = { plan: { plan_id: 'p' }, intent: { intent: 'i' } };
        await open(ctx);
        await ctx.document.getElementById('lumpPromotionConfirm').onclick();
        // The fetch mock above cannot use arrow `arguments`; make the save
        // assertion from the metadata/word inputs recorded by the save-plan
        // shim and the resulting success DOM.
        assert.deepStrictEqual(ctx.calls.saves[0].words, CANDIDATE.words);
        assert.strictEqual(ctx.calls.saves[0].metadata.binary_hash, HASH);
        const saveCall = ctx.calls.fetch.find(call => String(call[0]).endsWith('/api/lumps/save'));
        assert(saveCall, 'promotion posts through canonical save endpoint');
        const saveBody = JSON.parse(saveCall[1].body);
        assert.deepStrictEqual(saveBody.binary, CANDIDATE.words);
        assert.strictEqual(saveBody.metadata.approval_intent, 'i');
        assert(ctx.document.getElementById('lumpPromotionStatus').textContent.includes('final-token'));
        assert(ctx.document.getElementById('lumpPromotionStatus').textContent.includes('final-seal'));
        assert.strictEqual(ctx.calls.render, 1);
        assert.strictEqual(ctx.calls.namespace, 1);
        assert.strictEqual(ctx.calls.boot, 1);
    }

    // A committed save followed by a view-refresh failure remains a committed
    // result; it must not be presented as a no-change failure.
    {
        const ctx = makeContext(async function(url) {
            return String(url).includes('/latest-primary/')
                ? response(CANDIDATE)
                : response({ ok: true, token: 'committed-token', seal: 'committed-seal' });
        });
        ctx.sandbox.confirmResult = { plan: { plan_id: 'p' }, intent: { intent: 'i' } };
        ctx.sandbox.renderLumps = async () => { throw new Error('repository refresh failed'); };
        await open(ctx);
        await ctx.document.getElementById('lumpPromotionConfirm').onclick();
        const text = ctx.document.getElementById('lumpPromotionStatus').textContent;
        assert(text.includes('committed-token'));
        assert(text.includes('committed-seal'));
        assert(text.includes('Refresh needed'));
        assert(!text.includes('no data was changed'));
    }

    // Server failure is explicit and says that no data changed.
    {
        const ctx = makeContext(() => response({ error: 'candidate unavailable' }, false, 409));
        await open(ctx);
        assert(ctx.document.body.textContent.includes('No data was changed'));
        assert.strictEqual(ctx.calls.saves.length, 0);
    }

    // An authoritative save rejection is not mislabeled as an unknown outcome.
    {
        const ctx = makeContext((url) => String(url).includes('/latest-primary/')
            ? response(CANDIDATE)
            : response({ error: 'candidate became stale', committed: false }, false, 409));
        ctx.sandbox.confirmResult = { plan: { plan_id: 'p' }, intent: { intent: 'i' } };
        await open(ctx);
        await ctx.document.getElementById('lumpPromotionConfirm').onclick();
        const text = ctx.document.getElementById('lumpPromotionStatus').textContent;
        assert(text.includes('candidate became stale'));
        assert(!text.includes('outcome is unknown'));
    }
    console.log('PASS latest compilation promotion behavioral tests');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});