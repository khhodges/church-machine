'use strict';

// Static regression coverage for the saved-LUMP execution trust boundary.
// Runtime facts must come from exact words; user/security fields must come
// from an approval view bound to the same SHA-256.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const actionable = require('./actionable_errors.js');

const src = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
let passed = 0;
let failed = 0;
function check(label, condition) {
    console.log((condition ? 'PASS ' : 'FAIL ') + label);
    condition ? passed++ : failed++;
}

const loaderStart = src.indexOf('async function _loadLumpBinaryIntoSim(');
const loaderEnd = src.indexOf('\nasync function _lumpGTNameCommit', loaderStart);
const loader = src.slice(loaderStart, loaderEnd);

check('SLCG-1: saved-LUMP loader is present', loaderStart >= 0 && loaderEnd > loaderStart);
check('SLCG-2: loader fetches exact immutable words',
    loader.includes('/api/lump/${token}/words'));
check('SLCG-3: loader obtains hash-bound approval view',
    loader.includes('_loadSavedLumpCapabilities(token, data)'));
const confirmPos = loader.indexOf('if (!confirm(`Deploy "');
const deployIntentPos = loader.indexOf("_requestLumpApprovalIntent(rawWords, 'deploy'");
const deployAuthorizePos = loader.indexOf("fetch('/api/lumps/deploy-authorize'");
const authorizeSuccessPos = loader.indexOf("await _actionableJsonResponse(_deployAuth, 'Authorize LUMP deployment'");
const instantBootPos = loader.indexOf('if (!sim.bootComplete && typeof instantBoot');
const simulatorLoadPos = loader.indexOf('sim.loadLumpBinary(');
const authorizationSection = loader.slice(deployAuthorizePos, instantBootPos);
check('SLCG-4: deploy intent is requested only after explicit confirmation',
    confirmPos >= 0 && deployIntentPos > confirmPos);
check('SLCG-5: loader validates C-List before simulator mutation',
    loader.indexOf('_validateSavedLumpClist(rawWords') < simulatorLoadPos);
check('SLCG-6: no metadata endpoint is used as runtime authority',
    !loader.includes('/' + ['me', 'ta'].join('')));
check('SLCG-7: missing approval fails closed',
    src.includes('matching user approval record is unavailable'));
check('SLCG-8: mismatched approval digest fails closed',
    src.includes('user approval record is not bound to the fetched LUMP binary hash'));
check('SLCG-9: legacy synthetic self-seal bypass is absent',
    !src.includes('legacySelfSeal'));
check('SLCG-10: deploy intent is submitted to the authorization endpoint before load',
    deployAuthorizePos > deployIntentPos && simulatorLoadPos > deployAuthorizePos);
check('SLCG-11: simulator load occurs only after successful authorization check',
    authorizeSuccessPos > deployAuthorizePos &&
    authorizationSection.includes('await _actionableJsonResponse(_deployAuth') &&
    simulatorLoadPos > authorizeSuccessPos);
check('SLCG-12: cancellation and authorization failure precede simulator mutation',
    instantBootPos > authorizeSuccessPos && simulatorLoadPos > authorizeSuccessPos);

// Exercise the real loader and real response validator. Only the dependencies
// outside this authorization boundary are stubbed; no live server/data is used.
const executableLoader = src.slice(loaderStart, src.indexOf('\n// ── Run Selftest shortcut', loaderStart));

async function exerciseAuthorization({ status = 200, body = '{"ok":true}', confirm = true, delayed = false, loaderSource = executableLoader } = {}) {
    const events = [];
    const alerts = [];
    let release;
    const pendingBody = new Promise(resolve => { release = resolve; });
    const context = vm.createContext({
        ...actionable,
        confirm: () => confirm,
        alert: message => alerts.push(message),
        _loadSavedLumpCapabilities: async () => ({ approval: {} }),
        _validateSavedLumpClist: () => [],
        _requestLumpApprovalIntent: async () => {
            events.push('intent');
            return { intent: 'test-intent' };
        },
        fetch: async url => {
            if (url.endsWith('/words')) return { ok: true, json: async () => ({ words: [1] }) };
            assert.equal(url, '/api/lumps/deploy-authorize');
            events.push('authorize');
            return {
                ok: status >= 200 && status < 300, status,
                text: async () => {
                    events.push('body-requested');
                    const result = delayed ? await pendingBody : body;
                    events.push('body-resolved');
                    return result;
                },
            };
        },
        instantBoot: () => events.push('boot'),
        sim: {
            bootComplete: false,
            parseLumpHeader: () => ({ valid: true }),
            // Stop after observing the mutation boundary; unrelated rendering
            // and execution-identity dependencies need not be faked.
            loadLumpBinary: () => { events.push('load'); return false; },
        },
    });
    vm.runInContext(loaderSource, context);
    const running = context._loadLumpBinaryIntoSim('test-token', 'Test', null, 10);
    if (delayed) {
        // Flush the loader's async prerequisites without timing assumptions.
        await new Promise(resolve => setImmediate(resolve));
        const beforeRelease = events.slice();
        release(body);
        await running;
        return { events, alerts, beforeRelease };
    }
    await running;
    return { events, alerts };
}

(async () => {
    for (const [label, options] of [
        ['HTTP rejection', { status: 403, body: '{"ok":true}' }],
        ['authorization body rejection', { body: '{"ok":false,"error":"Denied"}' }],
        ['malformed response', { body: '<html>Not authorization</html>' }],
        ['cancelled confirmation', { confirm: false }],
    ]) {
        const result = await exerciseAuthorization(options);
        check(`Runtime: ${label} never boots or loads`, !result.events.includes('boot') && !result.events.includes('load'));
        check(`Runtime: ${label} reports failure or cancels cleanly`,
            options.confirm === false ? result.events.length === 0 && result.alerts.length === 0 : result.alerts.length === 1);
        check(`Runtime: ${label} does not mutate before authorization response`,
            options.confirm === false ||
            (result.events.includes('body-resolved') &&
                !result.events.includes('boot') &&
                !result.events.includes('load')));
    }
    const accepted = await exerciseAuthorization({ delayed: true });
    check('Runtime: pending authorization body prevents simulator mutation',
        accepted.beforeRelease.includes('body-requested') &&
        !accepted.beforeRelease.includes('body-resolved') &&
        !accepted.beforeRelease.includes('boot') && !accepted.beforeRelease.includes('load'));
    check('Runtime: accepted authorization reaches boot then load',
        accepted.events.indexOf('body-resolved') > accepted.events.indexOf('authorize') &&
        accepted.events.indexOf('boot') > accepted.events.indexOf('body-resolved') &&
        accepted.events.indexOf('load') > accepted.events.indexOf('boot'));

    // Mutation sensitivity: demonstrate that removing await would be caught.
    // Use a successful delayed body to avoid a deliberately unhandled rejection.
    const unawaited = await exerciseAuthorization({
        delayed: true,
        loaderSource: executableLoader.replace('await _actionableJsonResponse(_deployAuth', '_actionableJsonResponse(_deployAuth'),
    });
    check('Harness catches an unawaited authorization regression',
        unawaited.beforeRelease.includes('boot') &&
        unawaited.beforeRelease.includes('load') &&
        !unawaited.beforeRelease.includes('body-resolved'));
    const bypassed = await exerciseAuthorization({
        body: '{"ok":false}',
        loaderSource: executableLoader.replace(
            /await _actionableJsonResponse\(_deployAuth,[\s\S]*?\n        \}\);/,
            '/* deliberately bypassed for test sensitivity */'),
    });
    check('Harness catches a bypassed authorization regression',
        bypassed.events.includes('boot') &&
        bypassed.events.includes('load') &&
        !bypassed.events.includes('body-resolved'));
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});