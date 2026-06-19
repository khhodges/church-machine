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
 *   source          string   required  Raw source text
 *   language        string   required  See LANG_MAP keys below
 *   target          string   required  simulator | ti60_f225 | wukong_xc7a100t | tang_nano_20k
 *   abstraction_name string  optional  Overrides name detected from source
 *   namespace_hint  object   optional  {gt_type, allocation_words, clist_slots}
 *   options         object   optional  {strict_mode: bool, warn_as_error: bool}
 *
 * Response fields
 * ---------------
 *   status          "ok" | "ok_with_warnings" | "compile_failed"
 *   lump            object   (absent on compile_failed)
 *   console_output  string[]
 *   warnings        object[] (present when status is ok_with_warnings)
 *   errors          object[] (present when status is compile_failed)
 */

const path = require('path');

// ChurchAssembler must be a global before requiring the compiler so that
// compileAssembly()'s `typeof ChurchAssembler !== 'undefined'` guard passes.
// (The browser loads it as a <script> global; Node needs this explicit shim.)
global.ChurchAssembler = require(path.join(__dirname, '..', 'simulator', 'assembler.js'));

const CLOOMCCompiler = require(path.join(__dirname, '..', 'simulator', 'cloomc_compiler.js'));
const { buildLump }  = require(path.join(__dirname, '..', 'simulator', 'lump_builder.js'));

const LANG_MAP = {
    'cloomc++'        : 'compileJS',
    'js_cloomc++'     : 'compileJS',
    'english'         : 'compileEnglish',
    'symbolic_math'   : 'compileSymbolic',
    'assembly'        : 'compileAssembly',
    'haskell_cloomc++': 'compileHaskell',
    'lambda_calculus' : 'compileLambda',
    'abstraction'     : 'compilePetName',
};

const IOT_TARGETS = new Set(['wukong_xc7a100t', 'tang_nano_20k']);

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

function wordsToHex(words) {
    const buf = Buffer.alloc(words.length * 4);
    for (let i = 0; i < words.length; i++) {
        buf.writeUInt32BE(words[i] >>> 0, i * 4);
    }
    return '0x' + buf.toString('hex');
}

function run(req) {
    const source         = req.source         || '';
    const language       = req.language        || '';
    const target         = req.target          || 'simulator';
    const abstractionName = req.abstraction_name || null;
    const namespaceHint  = req.namespace_hint  || {};
    const options        = req.options         || {};
    const strictMode     = options.strict_mode  === true;
    const warnAsError    = options.warn_as_error === true;

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
        const msg = `Internal compiler error: ${ex.message}`;
        return {
            status: 'compile_failed',
            console_output: [msg],
            errors: [{ line: null, message: msg, severity: 'error' }],
        };
    }

    const targetErrors = [];
    if (IOT_TARGETS.has(target) && result.profile === 'Full') {
        const violations = result.profileViolations || [];
        for (const v of violations) {
            targetErrors.push({
                line: v.line || null,
                message: `@target IoT violation: method "${v.method}" uses Full-only opcode ${v.opcodeName} at offset ${v.offset}`,
                severity: 'error',
            });
        }
    }

    const allErrors     = [...(result.errors || []), ...targetErrors];
    const allWarnings   = [...(result.warnings || [])];

    let hardErrors   = [];
    let softWarnings = [];

    for (const err of allErrors) {
        if (!strictMode && !warnAsError && isUnresolvedError(err)) {
            softWarnings.push({
                line:        err.line   || null,
                message:     err.message,
                severity:    'warning',
                resolve_via: 'lazy_resolve',
            });
        } else {
            hardErrors.push({ line: err.line || null, message: err.message, severity: 'error' });
        }
    }

    for (const w of allWarnings) {
        softWarnings.push({ line: w.line || null, message: w.message, severity: 'warning' });
    }

    if (warnAsError && softWarnings.length > 0) {
        hardErrors  = [...hardErrors, ...softWarnings.map(w => ({ ...w, severity: 'error' }))];
        softWarnings = [];
    }

    const absName      = abstractionName || result.abstractionName || 'Unnamed';
    const detectedLang = result.language || language || 'assembly';
    const profile      = result.profile  || 'IoT';

    if (hardErrors.length > 0) {
        const lines = [
            `Compiling ${absName} (${detectedLang})...`,
            ...hardErrors.map(e => `Line ${e.line != null ? e.line : '?'}: ${e.message}`),
            `\u2716 COMPILE FAILED`,
        ];
        return { status: 'compile_failed', console_output: lines, errors: hardErrors };
    }

    const { words, header, cw, cc, lumpSize } = buildLump(result, {
        allocationWords: namespaceHint.allocation_words,
    });

    const method_table = [];
    let offset = 0;
    for (let i = 0; i < result.methods.length; i++) {
        const m   = result.methods[i];
        const len = (m.code || []).length;
        method_table.push({
            index:  i + 1,
            name:   m.name,
            public: !m.private,
            offset,
            length: len,
        });
        offset += len;
    }

    const unresolvedSymbols = [];
    for (const w of softWarnings) {
        if (w.resolve_via === 'lazy_resolve') {
            const match = w.message.match(/'([^']+)'/);
            unresolvedSymbols.push(match ? match[1] : w.message);
        }
    }

    const lumpObj = {
        name:             absName,
        typ:              '00',
        gt_type:          namespaceHint.gt_type || 'inform',
        allocation_words: lumpSize,
        method_table,
        clist_slots:      cc,
        binary_hex:       wordsToHex(words),
        size_words:       lumpSize,
        profile,
        language:         detectedLang,
    };
    if (unresolvedSymbols.length > 0) {
        lumpObj.unresolved_symbols = unresolvedSymbols;
    }

    const status   = softWarnings.length > 0 ? 'ok_with_warnings' : 'ok';
    const pubCount = method_table.filter(m => m.public).length;
    const prvCount = method_table.length - pubCount;

    const consoleLines = [
        `Compiling ${absName} (${detectedLang})...`,
        `${pubCount} public method${pubCount !== 1 ? 's' : ''}, ${prvCount} private`,
    ];
    if (unresolvedSymbols.length > 0) {
        consoleLines.push(
            `${unresolvedSymbols.length} unresolved symbol${unresolvedSymbols.length !== 1 ? 's' : ''} \u2014 marked for lazy-resolve, not blocking`,
            `Compile succeeded with warnings \u2014 ${lumpSize} words allocated`,
        );
    } else {
        consoleLines.push(`Compile succeeded \u2014 ${lumpSize} words allocated`);
    }

    const resp = { status, lump: lumpObj, console_output: consoleLines };
    if (softWarnings.length > 0) resp.warnings = softWarnings;
    return resp;
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
    let req;
    try {
        req = JSON.parse(inputData);
    } catch (ex) {
        process.stdout.write(JSON.stringify({
            status: 'compile_failed',
            console_output: ['Invalid JSON request'],
            errors: [{ line: null, message: 'Invalid JSON request', severity: 'error' }],
        }) + '\n');
        process.exit(0);
    }
    const resp = run(req);
    process.stdout.write(JSON.stringify(resp) + '\n');
    process.exit(0);
});
