// test_bare_space_ns_fallback.js — regression test for bare-space sugar NS fallback
//
// Legacy "AbsName MethodName" lowering still requests retired ELOADCALL.
// Namespace fallback and known method metadata must not bypass its hard error.
//
// Also verifies that when conventions ARE loaded, method-name validation still
// fires for an unknown method name.
//
// Run with:
//   node simulator/test_bare_space_ns_fallback.js

'use strict';

global.window = { bootConfig: {} };

const ChurchAssembler = require('./assembler.js');

let passed = 0;
let failed = 0;

function assert(condition, label) {
    if (condition) {
        console.log(`  [PASS] ${label}`);
        passed++;
    } else {
        console.error(`  [FAIL] ${label}`);
        failed++;
    }
}

// ── Helper: fresh assembler with given namespace, no shared conventions ───────
function makeAsm(nsMap) {
    // Reset shared state so tests don't bleed into each other.
    ChurchAssembler._sharedMethodConventions = {};
    const asm = new ChurchAssembler();
    asm.setNamespace(nsMap || {});
    // Ensure no conventions for any name in the namespace.
    asm.methodConventions = {};
    return asm;
}

// ── Helper: check that wordComments contains the expected instruction ─────────
function hasWordComment(result, pattern) {
    return Object.values(result.wordComments || {}).some(c => pattern.test(c));
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: bare-space with no conventions, abstraction in namespace → zero errors
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nTest 1: legacy bare-space lowering rejects retired ELOADCALL');
{
    const asm = makeAsm({ 'SelfTest': 2 });

    const src = `capabilities {
  SelfTest E
}
SelfTest Run`;

    const result = asm.assemble(src);
    assert(result.errors.some(e => /ELOADCALL is retired/.test(e.message)),
        'legacy bare-space lowering is explicitly rejected');
    // Retirement must leave neither an executable word nor a success annotation.
    assert(!hasWordComment(result, /SelfTest\s+Run/),
        'retired call is not emitted');
    assert(result.words.length === 0,
        'retired call produces no executable words');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: bare-space without capabilities block — NS fallback still fires
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nTest 2: NS fallback fires without an explicit capabilities block');
{
    const asm = makeAsm({ 'SelfTest': 2 });

    const result = asm.assemble('SelfTest Run');
    assert(result.errors.some(e => /ELOADCALL is retired/.test(e.message)),
        'namespace fallback cannot bypass retirement');
    assert(!hasWordComment(result, /SelfTest\s+Run/),
        'no retired call emitted without capabilities block');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: abstraction NOT in namespace → falls through to unknown-instruction
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nTest 3: abstraction absent from namespace → error, no ELOADCALL');
{
    // Empty namespace; no conventions.
    const asm = makeAsm({});
    const result = asm.assemble('Nonexistent Method');
    // Should produce an error (unknown instruction), NOT an ELOADCALL.
    assert(result.errors.length > 0,
        'error produced for abstraction not in namespace');
    const noSpuriousEloadcall = !hasWordComment(result, /Nonexistent\s+Method/);
    assert(noSpuriousEloadcall,
        'no spurious ELOADCALL emitted for unknown abstraction');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: conventions loaded → known method compiles; unknown method errors
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nTest 4: method-name validation fires when conventions ARE loaded');
{
    const asm = makeAsm({ 'SelfTest': 2 });
    asm.methodConventions['SelfTest'] = {
        'Run':  { index: 0, input: '', output: '' },
        'Stop': { index: 1, input: '', output: '' },
    };

    // Known method metadata does not authorize a retired instruction.
    const r1 = asm.assemble(`capabilities { SelfTest E }\nSelfTest Run`);
    assert(r1.errors.some(e => /ELOADCALL is retired/.test(e.message)),
        'known methods do not exempt legacy lowering from retirement');

    // Re-create to avoid state bleed.
    const asm2 = makeAsm({ 'SelfTest': 2 });
    asm2.methodConventions['SelfTest'] = {
        'Run':  { index: 0, input: '', output: '' },
        'Stop': { index: 1, input: '', output: '' },
    };
    const r2 = asm2.assemble(`capabilities { SelfTest E }\nSelfTest Typo`);
    assert(r2.errors.length > 0,
        'unknown method name produces an error when conventions are loaded');
    const errMsg = r2.errors[0] && r2.errors[0].message;
    assert(errMsg && errMsg.includes('not a known method'),
        'error message mentions "not a known method"');
    assert(errMsg && errMsg.includes('Run') && errMsg.includes('Stop'),
        'error message lists known methods');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: real-opcode first token is NOT treated as bare-space sugar
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nTest 5: real opcode + register not mistaken for bare-space sugar');
{
    const asm = makeAsm({ 'SelfTest': 2 });
    const result = asm.assemble('LOAD CR0, CR6[0x0002]');
    // Should compile cleanly as a LOAD instruction, not error as unknown abstraction.
    assert(result.errors.length === 0,
        'LOAD instruction is not treated as bare-space sugar');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: warning is emitted for unvalidated method name (no conventions)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nTest 6: warning emitted for unvalidated method name when conventions absent');
{
    const asm = makeAsm({ 'SelfTest': 2 });
    const result = asm.assemble('SelfTest Run');
    // Should have at least one warning about unvalidated method.
    assert(result.warnings.length > 0,
        'warning issued when method name is unvalidated');
    const warnMsg = result.warnings[0] && result.warnings[0].message;
    assert(warnMsg && (warnMsg.includes('not loaded') || warnMsg.includes('unvalidated') || warnMsg.includes('conventions')),
        'warning message mentions missing conventions or unvalidated method');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
