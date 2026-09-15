'use strict';

// Focused runtime coverage for the real stale-conflict helper and the
// production save-plan/approval boundary.  No repository or browser workflow
// is started here: each case supplies the same explicit conflict chooser that
// the accessible browser modal returns.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { _lumpSaveStaleConflictAction } = require('./lump_save_handler.js');

const appLumps = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');

function extractFunction(source, name) {
    let start = source.indexOf(`function ${name}(`);
    if (start >= 6 && source.slice(start - 6, start) === 'async ') start -= 6;
    if (start < 0) throw new Error(`missing ${name}`);
    let depth = 0;
    let end = -1;
    for (let i = start; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) {
            end = i + 1;
            break;
        }
    }
    if (end < 0) throw new Error(`unterminated ${name}`);
    return source.slice(start, end);
}

function makeFlow(choice, options = {}) {
    const requests = [];
    let planCalls = 0;
    let approvalCalls = 0;
    let openCalls = 0;
    const window = {
        confirm: () => true,
        _showLumpSaveStaleConflictDialog: () => choice,
        _saveNSPreparedSnapshot: { candidate: 'old' },
        _pendingLumpData: { binary: [11, 22], sourceText: 'old source' },
    };
    const metadata = {
        abstraction: 'SelfTest',
        token: 'old-token',
        editor_base: {
            token: 'old-token',
            compiled_at: '2026-01-01T00:00:00Z',
            source_hash: 'old-source',
            abstraction: 'SelfTest',
        },
    };
    const context = {
        console,
        window,
        _lumpSaveStaleConflictAction,
        _formatLumpSavePlan: () => 'save plan',
        _requestLumpSavePlan: async (words, plannedMetadata) => {
            requests.push({ words: words.slice(), metadata: plannedMetadata });
            planCalls++;
            if (planCalls === 1 && options.stale !== false) {
                const error = new Error('stale editor base');
                error.response = {
                    stale_editor_base: true,
                    latest: { token: 'new-token', abstraction: 'SelfTest' },
                };
                throw error;
            }
            return {
                plan_id: 'plan-' + planCalls,
                action: 'save',
                consequence: 'create',
                final_binary: words.slice(),
            };
        },
        _requestLumpApprovalIntent: async (words, action, plannedMetadata, plan) => {
            approvalCalls++;
            return { intent: 'one-time', digest: 'digest', plan_id: plan.plan_id };
        },
        openLumpInEditor: async token => {
            openCalls++;
            if (options.reloadFails) throw new Error('latest source unavailable');
            assert.strictEqual(token, 'new-token');
        },
    };
    vm.createContext(context);
    vm.runInContext(
        extractFunction(appLumps, '_confirmLumpSavePlan') +
        '\nthis.confirm = _confirmLumpSavePlan;',
        context
    );
    return { context, metadata, requests, get planCalls() { return planCalls; },
        get approvalCalls() { return approvalCalls; }, get openCalls() { return openCalls; } };
}

(async () => {
    {
        const flow = makeFlow('reload');
        const result = await flow.context.confirm([11, 22], flow.metadata, 'save');
        assert.strictEqual(result.status, 'reloaded');
        assert.strictEqual(result.outcome, 'reload');
        assert.strictEqual(flow.planCalls, 1);
        assert.strictEqual(flow.openCalls, 1);
        assert.strictEqual(flow.approvalCalls, 0);
        assert.strictEqual(flow.context.window._saveNSPreparedSnapshot, null);
        assert.strictEqual(flow.context.window._pendingLumpData, null);
    }

    {
        const flow = makeFlow('preserve');
        const words = [11, 22];
        const result = await flow.context.confirm(words, flow.metadata, 'save');
        assert.strictEqual(result.status, 'approved');
        assert.strictEqual(result.outcome, 'preserve');
        assert.strictEqual(flow.planCalls, 2);
        assert.strictEqual(flow.approvalCalls, 1);
        assert.strictEqual(flow.requests[1].metadata.preserve_stale_revision, true);
        assert.deepStrictEqual(flow.requests[1].words, [11, 22]);
        assert.strictEqual(flow.metadata.preserve_stale_revision, true);
    }

    {
        const flow = makeFlow('keep-editing');
        const result = await flow.context.confirm([11, 22], flow.metadata, 'save');
        assert.strictEqual(result.status, 'cancelled');
        assert.strictEqual(result.outcome, 'keep-editing');
        assert.strictEqual(flow.planCalls, 1);
        assert.strictEqual(flow.approvalCalls, 0);
        assert.notStrictEqual(flow.context.window._saveNSPreparedSnapshot, null);
    }

    {
        const flow = makeFlow('reload', { reloadFails: true });
        const result = await flow.context.confirm([11, 22], flow.metadata, 'save');
        assert.strictEqual(result.status, 'reload-failed');
        assert.strictEqual(result.outcome, 'reload-failed');
        assert.strictEqual(flow.planCalls, 1);
        assert.strictEqual(flow.approvalCalls, 0);
        assert.strictEqual(flow.context.window._saveNSPreparedSnapshot, null);
        assert.strictEqual(flow.context.window._pendingLumpData, null);
    }

    {
        const flow = makeFlow('preserve');
        const words = [11, 22];
        flow.context.window._showLumpSaveStaleConflictDialog = () => {
            // Simulate a newer source becoming live while the conflict modal
            // is open. The approved request must retain the old pair.
            words[0] = 99;
            flow.metadata.editor_base.token = 'new-token';
            return 'preserve';
        };
        const result = await flow.context.confirm(words, flow.metadata, 'save');
        assert.strictEqual(result.status, 'approved');
        assert.deepStrictEqual(flow.requests[1].words, [11, 22]);
        assert.strictEqual(flow.requests[1].metadata.editor_base.token, 'old-token');
    }

    console.log('LUMP stale conflict runtime flow: PASS');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
