// assembler_test.js — regression tests for ChurchAssembler
// Run with: node simulator/assembler_test.js
'use strict';

const ChurchAssembler = require('./assembler.js');

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log('PASS ' + label);
        passed++;
    } else {
        console.log('FAIL ' + label + (detail ? ' — ' + detail : ''));
        failed++;
    }
}

const CONVENTIONS = {
    'SlideRule': {
        'Multiply': { index: 0 },
        'Divide':   { index: 1 },
        'Sqrt':     { index: 2 },
    }
};

const NS_SYMBOLS = { 'SlideRule': 3 };

// ── CALL CR<n>, MethodName  (task-478) ──────────────────────────────────────

// T1: CALL CR11, Multiply succeeds when CR11 is bound to SlideRule via a prior LOAD.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL CR11, Multiply');
    const errors = a.errors;
    const word   = result.words[1];
    const opcode = (word >>> 27) & 0x1F;
    const crDst  = (word >>> 19) & 0xF;
    const crSrc  = (word >>> 15) & 0xF;
    assert('T1 CALL CR11, Multiply assembles with no errors',
        errors.length === 0, errors.map(e => e.message).join('; '));
    assert('T1 opcode=2 (CALL)', opcode === 2, 'got ' + opcode);
    assert('T1 crDst=11', crDst === 11, 'got ' + crDst);
    assert('T1 crSrc=0 (Multiply index)', crSrc === 0, 'got ' + crSrc);
}

// T2: CALL CR11, Multiply produces a clear, targeted error when no binding exists.
{
    const a = new ChurchAssembler(CONVENTIONS);
    const result = a.assemble('CALL CR11, Multiply');
    const errors = a.errors;
    assert('T2 CALL CR11,Multiply (unbound) produces an error',
        errors.length > 0, 'expected at least one error');
    assert('T2 error message mentions CR11 and no-binding',
        errors.length > 0 && errors[0].message.includes('CR11') && errors[0].message.includes('no known'),
        errors.length > 0 ? errors[0].message : '(no error)');
}

// T3: CALL CR11, 0 (numeric selector) is unaffected by the change.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL CR11, 0');
    const errors = a.errors;
    const word   = result.words[1];
    const crSrc  = (word >>> 15) & 0xF;
    assert('T3 CALL CR11, 0 (numeric) assembles without errors',
        errors.length === 0, errors.map(e => e.message).join('; '));
    assert('T3 crSrc=0', crSrc === 0, 'got ' + crSrc);
}

// T4: Bound abstraction with no registered conventions produces a clear error.
{
    const a = new ChurchAssembler({});   // empty conventions
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL CR11, Multiply');
    const errors = a.errors;
    assert('T4 CALL CR11, Multiply (no conventions) produces an error',
        errors.length > 0, 'expected at least one error');
    assert('T4 error message mentions no conventions',
        errors.length > 0 && errors[0].message.includes('No method conventions'),
        errors.length > 0 ? errors[0].message : '(no error)');
}

// T5: Unknown method name produces a clear error listing known methods.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL CR11, UnknownMethod');
    const errors = a.errors;
    assert('T5 CALL CR11, UnknownMethod produces an error',
        errors.length > 0, 'expected at least one error');
    assert('T5 error message says "not a known method" and lists known methods',
        errors.length > 0 &&
        errors[0].message.includes('not a known method') &&
        errors[0].message.includes('Multiply'),
        errors.length > 0 ? errors[0].message : '(no error)');
}

// ── CALL SlideRule, MethodName  (abstraction-name comma form) ───────────────

// T9: CALL SlideRule, Multiply succeeds when SlideRule was bound via LOAD.
//     crDst should resolve to 11 (SlideRule's CR), crSrc to 0 (Multiply index).
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL SlideRule, Multiply');
    const errors = a.errors;
    const word   = result.words[1];
    const opcode = (word >>> 27) & 0x1F;
    const crDst  = (word >>> 19) & 0xF;
    const crSrc  = (word >>> 15) & 0xF;
    assert('T9 CALL SlideRule, Multiply assembles with no errors',
        errors.length === 0, errors.map(e => e.message).join('; '));
    assert('T9 opcode=2 (CALL)', opcode === 2, 'got ' + opcode);
    assert('T9 crDst=11 (SlideRule → CR11)', crDst === 11, 'got ' + crDst);
    assert('T9 crSrc=0 (Multiply index)', crSrc === 0, 'got ' + crSrc);
}

// T10: CALL SlideRule, Divide uses index 1.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL SlideRule, Divide');
    const errors = a.errors;
    const word   = result.words[1];
    const crSrc  = (word >>> 15) & 0xF;
    assert('T10 CALL SlideRule, Divide assembles with no errors',
        errors.length === 0, errors.map(e => e.message).join('; '));
    assert('T10 crSrc=1 (Divide index)', crSrc === 1, 'got ' + crSrc);
}

// T11: CALL SlideRule, 0 (numeric selector with abstraction name) passes through unmodified.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL SlideRule, 0');
    const errors = a.errors;
    const word   = result.words[1];
    const crDst  = (word >>> 19) & 0xF;
    const crSrc  = (word >>> 15) & 0xF;
    assert('T11 CALL SlideRule, 0 (numeric) assembles without errors',
        errors.length === 0, errors.map(e => e.message).join('; '));
    assert('T11 crDst=11', crDst === 11, 'got ' + crDst);
    assert('T11 crSrc=0', crSrc === 0, 'got ' + crSrc);
}

// ── CALL SlideRule.MethodName  (dot-notation form) ───────────────────────────

// T12: CALL SlideRule.Multiply succeeds and encodes crDst=11, crSrc=0.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL SlideRule.Multiply');
    const errors = a.errors;
    const word   = result.words[1];
    const opcode = (word >>> 27) & 0x1F;
    const crDst  = (word >>> 19) & 0xF;
    const crSrc  = (word >>> 15) & 0xF;
    assert('T12 CALL SlideRule.Multiply assembles with no errors',
        errors.length === 0, errors.map(e => e.message).join('; '));
    assert('T12 opcode=2 (CALL)', opcode === 2, 'got ' + opcode);
    assert('T12 crDst=11 (SlideRule → CR11)', crDst === 11, 'got ' + crDst);
    assert('T12 crSrc=0 (Multiply index)', crSrc === 0, 'got ' + crSrc);
}

// T13: CALL SlideRule.Sqrt encodes index 2.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL SlideRule.Sqrt');
    const errors = a.errors;
    const word   = result.words[1];
    const crSrc  = (word >>> 15) & 0xF;
    assert('T13 CALL SlideRule.Sqrt assembles with no errors',
        errors.length === 0, errors.map(e => e.message).join('; '));
    assert('T13 crSrc=2 (Sqrt index)', crSrc === 2, 'got ' + crSrc);
}

// T14: CALL SlideRule.Multiply without a prior LOAD produces a clear error.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('CALL SlideRule.Multiply');
    const errors = a.errors;
    assert('T14 CALL SlideRule.Multiply (unbound) produces an error',
        errors.length > 0, 'expected at least one error');
    assert('T14 error message mentions SlideRule and "not been loaded"',
        errors.length > 0 &&
        errors[0].message.includes('SlideRule') &&
        errors[0].message.includes('not been loaded'),
        errors.length > 0 ? errors[0].message : '(no error)');
}

// T15: CALL SlideRule.UnknownMethod produces an error listing known methods.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL SlideRule.UnknownMethod');
    const errors = a.errors;
    assert('T15 CALL SlideRule.UnknownMethod produces an error',
        errors.length > 0, 'expected at least one error');
    assert('T15 error mentions "not a known method" and lists known methods',
        errors.length > 0 &&
        errors[0].message.includes('not a known method') &&
        errors[0].message.includes('Multiply'),
        errors.length > 0 ? errors[0].message : '(no error)');
}

// T16: dot-notation with no registered conventions produces a clear error.
{
    const a = new ChurchAssembler({});   // empty conventions
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL SlideRule.Multiply');
    const errors = a.errors;
    assert('T16 CALL SlideRule.Multiply (no conventions) produces an error',
        errors.length > 0, 'expected at least one error');
    assert('T16 error mentions "No method conventions"',
        errors.length > 0 && errors[0].message.includes('No method conventions'),
        errors.length > 0 ? errors[0].message : '(no error)');
}

// ── Disassembly: method name resolution (task-483) ───────────────────────────

// T6: disassemble() resolves CALL CR11, 0 → "CALL  CR11, Multiply" after binding.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL CR11, Multiply');
    const word = result.words[1];  // CALL word, selector=0
    const dis  = a.disassemble(word);
    assert('T6 disassemble CALL CR11,0 → includes "Multiply"',
        dis.includes('Multiply'), 'got: ' + dis);
    assert('T6 disassemble CALL CR11,0 → includes "CR11"',
        dis.includes('CR11'), 'got: ' + dis);
}

// T7: disassemble() resolves CALL CR11, 1 → "CALL  CR11, Divide".
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL CR11, Divide');
    const word = result.words[1];  // CALL word, selector=1
    const dis  = a.disassemble(word);
    assert('T7 disassemble CALL CR11,1 → includes "Divide"',
        dis.includes('Divide'), 'got: ' + dis);
}

// T8: disassemble() without binding context falls back to raw form.
{
    const a = new ChurchAssembler(CONVENTIONS);
    // No assemble() call — nsLoaded is empty, no binding context
    // Encode CALL CR11, selector=1 manually: opcode=2, crDst=11, crSrc=1
    const word = (2 << 27) | (14 << 23) | (11 << 19) | (1 << 15);
    const dis = a.disassemble(word >>> 0);
    assert('T8 disassemble without binding context emits raw sel form',
        !dis.includes('Divide') && !dis.includes('Multiply'), 'got: ' + dis);
}

// ── .pet directive tests ─────────────────────────────────────────────────────

// P1: .pet alias in DR position — LOAD result DR1 then IADD result, result, DR2
{
    const a = new ChurchAssembler();
    const result = a.assemble(
        '.pet result DR1\n' +
        'IADD DR1, DR1, DR2'   // baseline
    );
    const a2 = new ChurchAssembler();
    const result2 = a2.assemble(
        '.pet result DR1\n' +
        'IADD result, result, DR2'   // uses alias
    );
    assert('P1 .pet DR alias: no errors', a2.errors.length === 0,
        a2.errors.map(e => e.message).join('; '));
    assert('P1 .pet DR alias: same word as canonical',
        result.words[0] === result2.words[0],
        `canonical=0x${(result.words[0]>>>0).toString(16)} alias=0x${(result2.words[0]>>>0).toString(16)}`);
}

// P2: .pet alias in CR position — LOAD cloomc CR14 then CALL CR0, cloomc, 0
{
    const a = new ChurchAssembler();
    const r1 = a.assemble('CALL CR0, CR14, 0');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('.pet cloomc CR14\nCALL CR0, cloomc, 0');
    assert('P2 .pet CR alias: no errors', a2.errors.length === 0,
        a2.errors.map(e => e.message).join('; '));
    assert('P2 .pet CR alias: same word as canonical',
        r1.words[0] === r2.words[0],
        `canonical=0x${(r1.words[0]>>>0).toString(16)} alias=0x${(r2.words[0]>>>0).toString(16)}`);
}

// P3: .pet lines produce no machine words
{
    const a = new ChurchAssembler();
    const r = a.assemble('.pet result DR1\n.pet cloomc CR14\nNOP');
    assert('P3 .pet produces no words: word count = 1', r.words.length === 1,
        'got ' + r.words.length);
}

// P4: cross-type error — DR alias used where CR expected
{
    const a = new ChurchAssembler();
    a.assemble('.pet x DR1\nCALL x, CR14, 0');
    assert('P4 cross-type DR in CR position: error', a.errors.length > 0, 'expected an error');
    assert('P4 cross-type error message mentions DR alias',
        a.errors.some(e => e.message.includes('DR alias')),
        a.errors.map(e => e.message).join('; '));
}

// P5: cross-type error — CR alias used where DR expected
{
    const a = new ChurchAssembler();
    a.assemble('.pet cap CR14\nIADD cap, DR1, DR2');
    assert('P5 cross-type CR in DR position: error', a.errors.length > 0, 'expected an error');
    assert('P5 cross-type error message mentions CR alias',
        a.errors.some(e => e.message.includes('CR alias')),
        a.errors.map(e => e.message).join('; '));
}

// P6: redeclare alias to same register — silently accepted
{
    const a = new ChurchAssembler();
    a.assemble('.pet result DR1\n.pet result DR1\nNOP');
    assert('P6 duplicate .pet same register: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
}

// P7: redeclare alias to different register — non-fatal warning, assembly succeeds
{
    const a = new ChurchAssembler();
    a.assemble('.pet x DR1\n.pet x DR2\nNOP');
    assert('P7 .pet redeclare to different register: assembly succeeds (no errors)', a.errors.length === 0,
        'expected no errors, got: ' + a.errors.map(e => e.message).join('; '));
    assert('P7 .pet redeclare: warning issued in warnings array', a.warnings.length > 0,
        'expected a warning in a.warnings');
    assert('P7 warning mentions redefining',
        a.warnings.some(w => w.message.includes('redefining')),
        a.warnings.map(w => w.message).join('; '));
}

// P8: out-of-range register — error
{
    const a = new ChurchAssembler();
    a.assemble('.pet x DR99\nNOP');
    assert('P8 out-of-range DR alias: error', a.errors.length > 0, 'expected an error');
    assert('P8 error mentions out of range',
        a.errors.some(e => e.message.includes('out of range')),
        a.errors.map(e => e.message).join('; '));
}

// P9: getAliases() returns correct maps
{
    const a = new ChurchAssembler();
    a.assemble('.pet result DR1\n.pet cloomc CR14\nNOP');
    const aliases = a.getAliases();
    assert('P9 getAliases DR: result→1', aliases.dr['result'] === 1, JSON.stringify(aliases.dr));
    assert('P9 getAliases CR: cloomc→14', aliases.cr['cloomc'] === 14, JSON.stringify(aliases.cr));
}

// P10: built-in register names DR0..DR15 / CR0..CR15 are rejected as alias names
{
    const a = new ChurchAssembler();
    a.assemble('.pet DR1 DR2\nNOP');
    assert('P10 DR alias name DR1: error', a.errors.length > 0, 'expected an error');
    assert('P10 DR alias name DR1: error mentions built-in',
        a.errors.some(e => e.message.includes('built-in')),
        a.errors.map(e => e.message).join('; '));
    // Alias was not stored
    assert('P10 DR alias name DR1: alias not stored', a._drAliases['DR1'] === undefined, JSON.stringify(a._drAliases));
    const b = new ChurchAssembler();
    b.assemble('.pet CR3 DR5\nNOP');
    assert('P10 CR alias name CR3: error', b.errors.length > 0, 'expected an error');
    assert('P10 CR alias name CR3: error mentions built-in',
        b.errors.some(e => e.message.includes('built-in')),
        b.errors.map(e => e.message).join('; '));
}

// P11: malformed .pet syntax — explicit error, assembly still completes
{
    const a = new ChurchAssembler();
    // ".pet" with no operands after it is malformed
    a.assemble('.pet\nNOP');
    assert('P11 malformed .pet (no operands): error', a.errors.length > 0, 'expected an error');
    assert('P11 malformed .pet error mentions invalid syntax',
        a.errors.some(e => e.message.includes('invalid .pet syntax')),
        a.errors.map(e => e.message).join('; '));
    const b = new ChurchAssembler();
    // ".pet" with only one token (no register) is malformed
    b.assemble('.pet onlyalias\nNOP');
    assert('P11 malformed .pet (missing register): error', b.errors.length > 0, 'expected an error');
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
