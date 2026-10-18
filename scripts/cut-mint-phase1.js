#!/usr/bin/env node
'use strict';

// Freeze a definition and ordinary-compiler evidence. Never publish a LUMP
// from failing source or substitute the protected simulator's private lowering.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
global.ChurchAssembler = require('../simulator/assembler');
global.METHOD_REGISTER_CONVENTIONS = {};
global.BOOT_UPLOADS = [];
const Compiler = require('../simulator/cloomc_compiler');

const definitionPath = 'docs/reviews/mint-phase1/cloomc-step-1.md';
const definition = read(definitionPath);
const control = new Compiler().compile(
    'abstraction ide.CompileProbe {\ncapabilities { SELF E }\nmethod Run {\nIADD DR1, DR0, #0\nRETURN\n}\n}', []);
assert.deepEqual(control.errors, [], 'Ordinary compiler control must pass');

const inputs = [
    'simulator/cloomc/mint.cloomc',
    'docs/archive/phase-1-expanded-collection/source-drafts/ide.Mint.cloomc',
];
const evidence = inputs.map(sourcePath => {
    const source = read(sourcePath);
    const result = new Compiler().compile(source, []);
    return {
        sourcePath, source, sha256: sha256(source),
        compilationErrors: result.errors,
        methods: result.methods.map(m => m.name),
        compatibleWithLatestDefinition: false,
    };
});
// Obtain source only. Do not run the protected runtime or reuse emitted words.
const protectedSource = require('../simulator/mint/protected-programs').programs().mint.source;
const assembler = new global.ChurchAssembler();
assembler.assemble(protectedSource);
evidence.push({
    sourcePath: 'simulator/mint/protected-programs.js (generated Mint source)',
    source: protectedSource, sha256: sha256(protectedSource),
    compilationErrors: assembler.errors,
    compatibleWithLatestDefinition: false,
});

const compilerPaths = [
    'simulator/cloomc_compiler.js', 'simulator/assembler.js',
    'simulator/mint/protected-programs.js',
];
const compilerHashes = Object.fromEntries(compilerPaths.map(p => [p, sha256(read(p))]));
const fingerprint = sha256(JSON.stringify({
    definition: sha256(definition), compilerHashes,
    sources: evidence.map(e => e.sha256),
}));
const out = path.join(ROOT, 'generated-artifacts', `mint-phase1-cut-${fingerprint.slice(0,12)}`);
fs.mkdirSync(out, {recursive: true});
function freeze(name, content) {
    const file = path.join(out, name);
    if (fs.existsSync(file)) {
        assert.equal(fs.readFileSync(file, 'utf8'), content,
            `Refusing to overwrite frozen cut file: ${name}`);
    } else {
        fs.writeFileSync(file, content, {flag: 'wx'});
    }
}
freeze('definition.md', definition);
evidence.forEach((e, i) => freeze(`inspected-source-${i + 1}.cloomc`, e.source));
const report = {
    status: 'DEFINITION_CUT_ONLY_LUMP_BLOCKED',
    definitionPath, definitionSha256: sha256(definition),
    fingerprint, compilerHashes, ordinaryCompilerControlPassed: true,
    lumpCreated: false, liveNamespaceChanged: false,
    evidence: evidence.map(({source, ...e}) => e),
    implementationGaps: [
        'No current ordinary-CLOOMC CREATE/DESTROY source implementing this definition.',
        'Hierarchy routing and typed Abstraction-specific argument ABI are not specified.',
        'Credential issuance record and recipient-delivery binding are not specified.',
        'GC safe-point/root bindings, TRACE/destruction bindings and cycle ABI are not specified.',
        'MakeOutform/MakeInform ABI and preserved/remote lifetime checks are not specified.',
        'Protected fixture service operations are privately lowered and implemented by host code.',
    ],
};
freeze('compiler-evidence.json', JSON.stringify(report, null, 2) + '\n');
freeze('README.md', `# Mint Phase 1 definition cut

Status: **definition frozen; executable CLOOMC LUMP not produced**.

The definition is copied byte-for-byte from ${definitionPath}.
SHA-256: ${report.definitionSha256}

This is not a compiled release and must not be installed as one.
Inspected source snapshots are historical or test-only evidence, not new
implementations of the frozen definition. See compiler-evidence.json for
ordinary compilation errors and the remaining implementation interfaces.

Reproduce from the workspace: node scripts/cut-mint-phase1.js
The script checks an ordinary compiler control, refuses to overwrite changed
cut files, and writes only under generated-artifacts.
No Namespace, live LUMP, boot image or hardware is modified.
`);
console.log(JSON.stringify({
    output: path.relative(ROOT, out), status: report.status,
    ordinaryCompilerControlPassed: true,
    compilationErrorCounts: evidence.map(e => e.compilationErrors.length),
    lumpCreated: false,
}, null, 2));
