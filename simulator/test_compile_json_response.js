const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, 'app-compile.js'), 'utf8');
const start = source.indexOf('async function _readCompileJsonResponse');
const end = source.indexOf('\nasync function compileAndBuild', start);
assert(start >= 0 && end > start, 'compile response reader must be present');

const context = {};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

function response(status, contentType, body) {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: { get: () => contentType },
        json: async () => JSON.parse(body),
    };
}

(async () => {
    const configuredError = 'Configure M_BIT_IDE_SECRET, then retry.';
    await assert.rejects(
        context._readCompileJsonResponse(response(
        503, 'application/json; charset=utf-8',
        JSON.stringify({
            ok: false,
            code: 'compiler_attestation_unavailable',
            error: configuredError,
        }))),
        error => error.message === configuredError);

    const successful = await context._readCompileJsonResponse(response(
        200, 'application/json', JSON.stringify({ ok: true, words: [1] })));
    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(successful)), { ok: true, words: [1] });

    await assert.rejects(
        context._readCompileJsonResponse(response(
            500, 'text/html; charset=utf-8', '<!doctype html><title>Error</title>')),
        error => error.message === 'server returned HTTP 500 instead of JSON' &&
            !error.message.includes('<!doctype'));

    await assert.rejects(
        context._readCompileJsonResponse(response(503, 'application/json', '<html>')),
        /server returned invalid JSON \(HTTP 503\)/);

    console.log('PASS compile JSON response handling');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});