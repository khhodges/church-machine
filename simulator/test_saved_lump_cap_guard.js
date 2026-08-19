'use strict';

// Regression coverage for the saved-LUMP execution trust boundary. Every load
// must retrieve capability metadata from the canonical sidecar; a missing or
// stale catalogue entry must not bypass C-list token validation.

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`PASS ${label}`);
    } else {
        failed++;
        console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    }
}

function response(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
    };
}

async function rejects(promise, pattern) {
    try {
        await promise;
        return false;
    } catch (err) {
        return pattern.test(String(err && err.message));
    }
}

async function main() {
    const src = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
    const start = src.indexOf('async function _loadSavedLumpCapabilities(');
    const end = src.indexOf('\n// ── Load a saved LUMP binary into the simulator', start);
    assert('SLCG-1: saved-LUMP capability guard source located',
        start >= 0 && end > start);

    const detailCaps = [
        { name: 'LED0', rights: ['R', 'W'], nsIndex: 3 },
        { name: 'UART_TX', rights: ['W'], nsIndex: 2 },
        { name: 'WukongCallHome.hw', rights: ['E'], nsIndex: 7 },
    ];
    const makeGuard = (fetchImpl) => new Function(
        'fetch',
        `${src.slice(start, end)}
         return _loadSavedLumpCapabilities;`
    )(fetchImpl);

    const seenUrls = [];
    const guard = makeGuard(async (url) => {
        seenUrls.push(url);
        return response(200, { capabilities: detailCaps });
    });
    const savedMetadata = await guard('46738c7a');
    assert('SLCG-2: load fetches canonical sidecar metadata',
        seenUrls.length === 1 && seenUrls[0] === '/api/lumps/46738c7a/detail');
    assert('SLCG-3: load returns canonical declared capability rows',
        JSON.stringify(savedMetadata.capabilities) === JSON.stringify(detailCaps));

    const missingCapsGuard = makeGuard(async () => response(200, {}));
    assert('SLCG-4: missing sidecar capability metadata blocks execution',
        await rejects(missingCapsGuard('46738c7a'), /unavailable or malformed/));

    const staleCatalogGuard = makeGuard(async () => response(200, { capabilities: detailCaps }));
    assert('SLCG-5: stale supplied catalogue metadata blocks execution',
        await rejects(
            staleCatalogGuard('46738c7a', [{ name: 'LED0', rights: ['E'], nsIndex: 3 }]),
            /does not match/
        ));

    const unavailableGuard = makeGuard(async () => response(409, { error: 'integrity failure' }));
    assert('SLCG-6: unreadable canonical sidecar blocks execution',
        await rejects(unavailableGuard('46738c7a'), /server returned 409/));

    const validatorStart = src.indexOf('function _validateSavedLumpClist(');
    const validatorEnd = src.indexOf('\n// ── Load a saved LUMP binary into the simulator', validatorStart);
    assert('SLCG-7: saved-LUMP c-list validator source located',
        validatorStart >= 0 && validatorEnd > validatorStart);
    const validateSavedClist = new Function(
        'CapabilityTokens', '_lumpsCache',
        `${src.slice(validatorStart, validatorEnd)}
         return _validateSavedLumpClist;`
    )({}, []);
    const legacyHeader = { cc: 3, lumpSize: 64 };
    const legacyRaw = Array(64).fill(0);
    const legacyIdentityHash = '01234567' + '0'.repeat(56);
    legacyRaw[61] = (0x0A000000 | (0x01234567 & 0x1FFFFFF)) >>> 0;
    const legacyMetadata = {
        capabilities: [],
        identityHash: legacyIdentityHash,
        identitySealLocation: 'c-list[0]',
    };
    assert('SLCG-8: multi-row legacy identity seal validates at c-list row 0',
        Array.isArray(validateSavedClist(legacyRaw, legacyHeader, legacyMetadata, {})));
    legacyRaw[62] = 0x80000003;
    assert('SLCG-9: nonzero reserved legacy c-list row blocks execution',
        await rejects(
            Promise.resolve().then(() => validateSavedClist(legacyRaw, legacyHeader, legacyMetadata, {})),
            /malformed undeclared rows/
        ));

    const loaderStart = src.indexOf('async function _loadLumpBinaryIntoSim(');
    const fetchGuardPos = src.indexOf('_loadSavedLumpCapabilities(token, caps)', loaderStart);
    const loadBinaryPos = src.indexOf('sim.loadLumpBinary(', loaderStart);
    assert('SLCG-10: loader obtains sidecar metadata before mutating simulator memory',
        fetchGuardPos > loaderStart && loadBinaryPos > fetchGuardPos);
    assert('SLCG-11: loader invokes the shared saved-LUMP c-list validator',
        src.indexOf('_validateSavedLumpClist(rawWords, _runHeader, _savedMetadata, sim)', loaderStart) > loaderStart);

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
    console.error(err.stack || err);
    process.exitCode = 1;
});