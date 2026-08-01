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
 * Timeout architecture
 * --------------------
 * The compiler (dispatch → CLOOMCCompiler) runs synchronously on the event loop.
 * A plain setTimeout() cannot preempt it.  Instead the main thread spawns a
 * worker_threads Worker for the compilation and calls worker.terminate() if it
 * does not respond within WORKER_TIMEOUT_MS.  worker.terminate() is an OS-level
 * signal that stops the worker thread even if it is spinning in CPU-bound code.
 *
 * Additionally, compile_api.py passes timeout=10 to subprocess.run(), giving the
 * Python layer a second, independent enforcement mechanism via SIGKILL.
 *
 * Language routing (in the worker thread):
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

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');

const WORKER_TIMEOUT_MS = 10_000; // 10 seconds — main thread terminates worker if exceeded

// ── Main thread ───────────────────────────────────────────────────────────────
// Reads stdin, validates input, spawns a worker thread for compilation,
// enforces a hard timeout via worker.terminate().
if (isMainThread) {
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

        // Spawn compilation in a worker thread so we can terminate it preemptively
        let responded = false;
        const worker = new Worker(__filename, { workerData: { payload } });

        const timer = setTimeout(() => {
            if (responded) return;
            responded = true;
            worker.terminate();
            write({
                ok:    false,
                language,
                error: `Compile timed out after ${WORKER_TIMEOUT_MS / 1000}s — reduce source complexity`,
            });
            process.exitCode = 1;
        }, WORKER_TIMEOUT_MS);

        worker.on('message', result => {
            if (responded) return;
            responded = true;
            clearTimeout(timer);
            write(result);
        });

        worker.on('error', err => {
            if (responded) return;
            responded = true;
            clearTimeout(timer);
            write({ ok: false, language, error: `Worker error: ${err.message}` });
        });

        // 'exit' fires after 'message' or after terminate(); clean up timer defensively
        worker.on('exit', () => {
            clearTimeout(timer);
        });
    });

// ── Worker thread ─────────────────────────────────────────────────────────────
// Runs the actual compilation.  Reports result via parentPort.postMessage().
// This code is only reached when isMainThread is false (i.e. we are the Worker).
} else {
    const { payload } = workerData;
    const SIM_DIR = path.join(__dirname, '..', 'simulator');

    // Set up global shim before loading the compiler
    global.ChurchAssembler = require(path.join(SIM_DIR, 'assembler.js'));
    const CLOOMCCompiler   = require(path.join(SIM_DIR, 'cloomc_compiler.js'));
    const { buildLump }    = require(path.join(SIM_DIR, 'lump_builder.js'));

    const source   = (payload.source   || '').toString();
    const language = (payload.language || 'auto').toString().toLowerCase();

    // ── Language → compiler method mapping ───────────────────────────────────
    function dispatch(compiler, lang, src) {
        switch (lang) {
            case 'assembly':   return compiler.compileAssembly(src);
            case 'javascript': return compiler.compileJS(src);
            case 'haskell':    return compiler.compileHaskell(src);
            case 'lambda':     return compiler.compileLambda(src);
            case 'symbolic':   return compiler.compileSymbolic(src);
            // english + auto: use full auto-detect so CLOOMC++ and English prose both work
            case 'english':
            case 'auto':
            default:           return compiler.compile(src);
        }
    }

    let compileResult;
    try {
        const compiler = new CLOOMCCompiler();
        compileResult  = dispatch(compiler, language, source);
    } catch (err) {
        parentPort.postMessage({ ok: false, language, error: `Compiler threw an exception: ${err.message}` });
        return;
    }

    // ── Compile errors ────────────────────────────────────────────────────────
    const errors   = compileResult.errors   || [];
    const warnings = compileResult.warnings || [];

    if (errors.length > 0) {
        const normErrors = errors.map(e =>
            (e && typeof e === 'object' && 'message' in e)
                ? { line: e.line || 0, message: String(e.message) }
                : { line: 0, message: String(e) }
        );
        parentPort.postMessage({
            ok:       false,
            language: compileResult.language || language,
            error:    normErrors.map(e => `L${e.line}: ${e.message}`).join('\n'),
            errors:   normErrors,
            warnings,
        });
        return;
    }

    // ── Build LUMP binary ─────────────────────────────────────────────────────
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
        parentPort.postMessage({ ok: false, language, error: `LUMP packing failed: ${err.message}` });
        return;
    }

    const words = lumpResult.words;

    // Encode as big-endian binary (Church Machine native byte order)
    const buf = Buffer.allocUnsafe(words.length * 4);
    for (let i = 0; i < words.length; i++) {
        buf.writeUInt32BE(words[i] >>> 0, i * 4);
    }
    const lump_binary = buf.toString('base64');

    const methods = (compileResult.methods || []).map(m => ({
        name:       m.name,
        visibility: m.visibility || 'public',
        ...(m.aliasOf ? { aliasOf: m.aliasOf } : {}),
    }));

    parentPort.postMessage({
        ok:              true,
        language:        compileResult.language || language,
        abstractionName: compileResult.abstractionName || '',
        methods,
        words:           Array.from(words),
        lump_binary,
        warnings:        warnings.map(w =>
            (w && typeof w === 'object' && 'message' in w) ? w : { message: String(w) }
        ),
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function write(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}
