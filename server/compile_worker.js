'use strict';
/**
 * server/compile_worker.js — CLOOMC / Assembly compile subprocess worker
 *
 * Reads one JSON object from stdin:
 *   { source: string, language: string, namespace_hint?: { allocation_words?: number }, ... }
 *
 * Writes one JSON object to stdout:
 *   Success: { ok: true,  language, abstractionName, methods, words, lump_binary, warnings }
 *   Failure: { ok: false, language, error, errors? }
 *
 * Language routing:
 *   "assembly"    → CLOOMCCompiler.compileAssembly()  (needs ChurchAssembler shim)
 *   "symbolic"    → CLOOMCCompiler.compileSymbolic()  (stateless; always fails w/o session)
 *   "lambda"      → CLOOMCCompiler.compileLambda()
 *   "haskell"     → CLOOMCCompiler.compileHaskell()
 *   "javascript"  → CLOOMCCompiler.compileJS()
 *   "english"     → CLOOMCCompiler.compile() auto-detect so that both natural-English
 *                   prose and CLOOMC++ source (abstraction Name { ... }) are accepted
 *   "auto"        → CLOOMCCompiler.compile() auto-detect
 *
 * IMPORTANT: global.ChurchAssembler must be set before requiring CLOOMCCompiler
 * because compileAssembly() checks typeof ChurchAssembler as a bare global lookup.
 * See memory note: church-assembler-node-shim.md
 */

const path = require('path');

// ── Set up global shim before loading the compiler ──────────────────────────
const SIM_DIR = path.join(__dirname, '..', 'simulator');

global.ChurchAssembler = require(path.join(SIM_DIR, 'assembler.js'));
const CLOOMCCompiler   = require(path.join(SIM_DIR, 'cloomc_compiler.js'));
const { buildLump }    = require(path.join(SIM_DIR, 'lump_builder.js'));

// ── Language → compiler method mapping ───────────────────────────────────────
// "english" uses compile() auto-detect so that CLOOMC++ syntax (abstraction Name
// { method ... }) compiles successfully, matching what the live API tests send.
// All other named languages use their dedicated compiler path for correct semantics.
function dispatch(compiler, language, source) {
    switch (language) {
        case 'assembly':   return compiler.compileAssembly(source);
        case 'javascript': return compiler.compileJS(source);
        case 'haskell':    return compiler.compileHaskell(source);
        case 'lambda':     return compiler.compileLambda(source);
        case 'symbolic':   return compiler.compileSymbolic(source);
        // english + auto: use full auto-detect so CLOOMC++ and English prose both work
        case 'english':
        case 'auto':
        default:           return compiler.compile(source);
    }
}

// ── Read stdin ────────────────────────────────────────────────────────────────
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
    let payload;
    try {
        payload = JSON.parse(raw);
    } catch (err) {
        write({ ok: false, language: '', error: `Invalid JSON input: ${err.message}` });
        return;
    }

    const source   = (payload.source   || '').toString();
    const language = (payload.language || 'auto').toString().toLowerCase();

    if (!source.trim()) {
        write({ ok: false, language, error: '`source` must be a non-empty string' });
        return;
    }

    let compileResult;
    try {
        const compiler = new CLOOMCCompiler();
        compileResult  = dispatch(compiler, language, source);
    } catch (err) {
        write({ ok: false, language, error: `Compiler threw an exception: ${err.message}` });
        return;
    }

    // ── Compile errors ───────────────────────────────────────────────────────
    const errors   = compileResult.errors   || [];
    const warnings = compileResult.warnings || [];

    if (errors.length > 0) {
        // Normalise errors to {line, message} objects
        const normErrors = errors.map(e =>
            (e && typeof e === 'object' && 'message' in e)
                ? { line: e.line || 0, message: String(e.message) }
                : { line: 0, message: String(e) }
        );
        write({
            ok:       false,
            language: compileResult.language || language,
            error:    normErrors.map(e => `L${e.line}: ${e.message}`).join('\n'),
            errors:   normErrors,
            warnings,
        });
        return;
    }

    // ── Build LUMP binary ────────────────────────────────────────────────────
    // Forward namespace_hint.allocation_words so callers can request a specific
    // lump size (must be a power of 2, >= 64).
    const nsHint   = payload.namespace_hint || {};
    const lumpOpts = {};
    if (nsHint.allocation_words && Number.isInteger(nsHint.allocation_words) &&
            nsHint.allocation_words >= 64) {
        lumpOpts.allocationWords = nsHint.allocation_words;
    }

    let lumpResult;
    try {
        lumpResult = buildLump(compileResult, lumpOpts);
    } catch (err) {
        write({ ok: false, language, error: `LUMP packing failed: ${err.message}` });
        return;
    }

    const words = lumpResult.words;    // number[] — uint32 values

    // Encode as big-endian binary (Church Machine native byte order)
    const buf = Buffer.allocUnsafe(words.length * 4);
    for (let i = 0; i < words.length; i++) {
        buf.writeUInt32BE(words[i] >>> 0, i * 4);
    }
    const lump_binary = buf.toString('base64');

    // Summarise methods for the caller (include aliasOf for alias entries)
    const methods = (compileResult.methods || []).map(m => ({
        name:       m.name,
        visibility: m.visibility || 'public',
        ...(m.aliasOf ? { aliasOf: m.aliasOf } : {}),
    }));

    write({
        ok:              true,
        language:        compileResult.language || language,
        abstractionName: compileResult.abstractionName || '',
        methods,
        words:           Array.from(words),   // plain JS array for JSON serialisation
        lump_binary,
        warnings:        warnings.map(w =>
            (w && typeof w === 'object' && 'message' in w) ? w : { message: String(w) }
        ),
    });
});

function write(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}
