'use strict';

/**
 * server/compile_worker.js — Node.js stdin→stdout compile worker
 *
 * Protocol
 * --------
 *   stdin:  one JSON object (the compile request)
 *   stdout: one JSON object (the compile response)
 *   exit:   always 0 — errors live in the JSON, not the exit code
 *
 * Request fields
 * --------------
 *   source           string   required  Raw source text
 *   language         string   required  One of: english | javascript | haskell |
 *                                       symbolic | lambda | assembly
 *   abstraction_name string   optional  Overrides name detected from source
 *   namespace_hint   object   optional  {gt_type, allocation_words, clist_slots}
 *   (any extra fields are silently ignored)
 *
 * Response fields — success
 * -------------------------
 *   ok           true
 *   language     string    detected/normalised language name
 *   words        number[]  raw uint32 lump word array
 *   lump_binary  string    base64 of the same binary (for clients that prefer bytes)
 *   warnings     object[]  present when there are soft warnings (may be [])
 *
 * Response fields — failure
 * -------------------------
 *   ok       false
 *   language string   (echo of request language, or "")
 *   error    string   human-readable compile error
 */

const path = require('path');

// ChurchAssembler must be a global before requiring the compiler so that
// compileAssembly()'s `typeof ChurchAssembler !== 'undefined'` guard passes.
// (The browser loads it as a <script> global; Node needs this explicit shim.)
global.ChurchAssembler = require(path.join(__dirname, '..', 'simulator', 'assembler.js'));

const CLOOMCCompiler = require(path.join(__dirname, '..', 'simulator', 'cloomc_compiler.js'));
const { buildLump }  = require(path.join(__dirname, '..', 'simulator', 'lump_builder.js'));

const LANG_MAP = {
    'english'    : 'compileEnglish',
    'javascript' : 'compileJS',
    'haskell'    : 'compileHaskell',
    'symbolic'   : 'compileSymbolic',
    'lambda'     : 'compileLambda',
    'assembly'   : 'compileAssembly',
};

const UNRESOLVED_PATTERNS = [
    /not in capabilities list/i,
    /not a known method/i,
    /unknown abstraction/i,
    /undeclared symbol/i,
    /no binding/i,
];

function isUnresolvedError(err) {
    const msg = err.message || '';
    return UNRESOLVED_PATTERNS.some(p => p.test(msg));
}

function wordsToBase64(words) {
    const buf = Buffer.alloc(words.length * 4);
    for (let i = 0; i < words.length; i++) {
        buf.writeUInt32BE(words[i] >>> 0, i * 4);
    }
    return buf.toString('base64');
}

function failResp(language, message) {
    return { ok: false, language: language || '', error: message };
}

function run(req) {
    const source          = req.source          || '';
    const language        = req.language         || '';
    const abstractionName = req.abstraction_name || null;
    const namespaceHint   = req.namespace_hint   || {};

    const compiler = new CLOOMCCompiler();

    let result;
    try {
        const method = LANG_MAP[language];
        if (method && typeof compiler[method] === 'function') {
            result = compiler[method](source, []);
        } else {
            result = compiler.compile(source, []);
        }
    } catch (ex) {
        return failResp(language, `Internal compiler error: ${ex.message}`);
    }

    const allErrors   = result.errors   || [];
    const allWarnings = result.warnings  || [];

    const hardErrors   = [];
    const softWarnings = [];

    for (const err of allErrors) {
        if (isUnresolvedError(err)) {
            softWarnings.push({
                line:        err.line    || null,
                message:     err.message,
                severity:    'warning',
                resolve_via: 'lazy_resolve',
            });
        } else {
            hardErrors.push(err);
        }
    }
    for (const w of allWarnings) {
        softWarnings.push({ line: w.line || null, message: w.message, severity: 'warning' });
    }

    if (hardErrors.length > 0) {
        const first = hardErrors[0].message;
        return failResp(language, first || 'Compile failed');
    }

    const { words } = buildLump(result, {
        allocationWords: namespaceHint.allocation_words,
    });

    const detectedLang = result.language || language || 'assembly';
    const lump_binary  = wordsToBase64(words);

    return {
        ok:          true,
        language:    detectedLang,
        words:       Array.from(words.map(w => w >>> 0)),
        lump_binary,
        warnings:    softWarnings,
    };
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
    let req;
    try {
        req = JSON.parse(inputData);
    } catch (ex) {
        process.stdout.write(JSON.stringify(
            failResp('', 'Invalid JSON request')
        ) + '\n');
        process.exit(0);
    }
    const resp = run(req);
    process.stdout.write(JSON.stringify(resp) + '\n');
    process.exit(0);
});
