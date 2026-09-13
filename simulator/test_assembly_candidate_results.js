'use strict';

// Production-function regression: a failed raw assembly must return its own
// structured failure, never let smartCompile infer success from an older
// registry candidate.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function extractBlock(source, marker) {
    const start = source.indexOf(marker);
    if (start < 0) throw new Error(`missing ${marker}`);
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`unterminated ${marker}`);
}

const source = fs.readFileSync('simulator/app-run.js', 'utf8');
const editor = { value: 'BROKEN INSTRUCTION' };
const consoleEl = { textContent: '', style: {}, className: '' };
const languageEl = { value: 'assembly' };
let assemblyResult = { errors: [{ line: 1, message: 'unknown opcode' }], warnings: [] };
const context = {
    window: {},
    document: { getElementById(id) {
        if (id === 'asmEditor') return editor;
        if (id === 'langSelector') return languageEl;
        return consoleEl;
    } },
    cloomcCompiler: null,
    assembler: {
        assemble() { return assemblyResult; },
    },
    saveEditorState() {},
    switchCodeTab() {},
    showNextSteps() {},
    _showAsmErrors() {},
    _clearAsmWarnings() {},
    requirePermission() { return true; },
};
vm.createContext(context);
vm.runInContext(extractBlock(source, 'function assembleAndLoad(') +
    '\nthis.assembleAndLoad = assembleAndLoad;', context);

const result = context.assembleAndLoad({ source: editor.value, candidateOnly: true });
assert.strictEqual(result.ok, false, 'failed assembly returned a success-like value');
assert.strictEqual(result.kind, 'assembly');
assert.match(result.error, /unknown opcode/);

// Keep a valid-looking older registry entry present. smartCompile must still
// return the current assembler failure, rather than infer that old entry as
// a successful build.
context.window.LumpRegistry = {
    getCurrent() { return 'old-candidate'; },
    resolve() { return { sources: { memory: { words: [0x1f800000] } } }; },
};
assemblyResult = { errors: [], warnings: [], words: [], capabilities: [], labels: {} };
const emptyResult = context.assembleAndLoad({ source: '; comments and labels only', candidateOnly: true });
assert.strictEqual(emptyResult.ok, false,
    'comments/labels-only assembly produced an installable candidate');
assert.match(emptyResult.error, /no executable instruction words/);
assert.strictEqual(context.window.LumpRegistry.getCurrent(), 'old-candidate',
    'empty assembly disturbed the prior successful candidate');

context.cloomcCompiler = {
    _detectPetName() { return false; },
    _detectEnglish() { return false; },
    _detectHaskell() { return false; },
    _detectSymbolic() { return false; },
    compile() { return { errors: [], warnings: [], methods: [], capabilities: [] }; },
};
const emptyHighLevel = context.assembleAndLoad({
    source: 'abstraction Empty {}', candidateOnly: true,
});
assert.strictEqual(emptyHighLevel.ok, false,
    'zero-method high-level source produced an installable candidate');
assert.match(emptyHighLevel.error, /no executable instruction words/);
assert.strictEqual(context.window.LumpRegistry.getCurrent(), 'old-candidate',
    'empty high-level build disturbed the prior successful candidate');

assemblyResult = { errors: [{ line: 1, message: 'unknown opcode' }], warnings: [] };
const compileSource = fs.readFileSync('simulator/app-compile.js', 'utf8');
vm.runInContext(extractBlock(compileSource, 'function smartCompile(') +
    '\nthis.smartCompile = smartCompile;', context);
context.smartCompile({ source: editor.value }).then(smartResult => {
    assert.strictEqual(smartResult.ok, false,
        'smartCompile inferred success from a preserved older registry candidate');
    assert.match(smartResult.error, /unknown opcode/);
    console.log('assembly candidate result regression: PASS');
}).catch(error => {
    console.error(error);
    process.exit(1);
});