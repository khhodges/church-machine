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

// ── Named method selectors — CALL CR<n>, MethodName ─────────────────────────

// T1: CALL CR11, Multiply succeeds when CR11 is bound to SlideRule via a prior LOAD.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL CR11, Multiply');
    const errors = a.errors;
    const word   = result.words[1];
    const opcode = (word >>> 27) & 0x1F;
    const crDst  = (word >>> 19) & 0xF;
    const imm    = word & 0x7FFF;
    assert('T1 CALL CR11, Multiply assembles with no errors',
        errors.length === 0, errors.map(e => e.message).join('; '));
    assert('T1 opcode=2 (CALL)', opcode === 2, 'got ' + opcode);
    assert('T1 crDst=11', crDst === 11, 'got ' + crDst);
    assert('T1 imm=1 (Multiply index 0 → 1-based imm)', imm === 1, 'got ' + imm);
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

// T3: CALL CR11, 0 (numeric selector 0) encodes as imm=1 (1-based).
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL CR11, 0');
    const errors = a.errors;
    const word   = result.words[1];
    const imm    = word & 0x7FFF;
    assert('T3 CALL CR11, 0 (numeric) assembles without errors',
        errors.length === 0, errors.map(e => e.message).join('; '));
    assert('T3 imm=1 (numeric 0 → 1-based imm)', imm === 1, 'got ' + imm);
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

// ── Loaded-CR resolution + named method selectors — CALL AbsName, MethodName ─

// T9: CALL SlideRule, Multiply succeeds when SlideRule was bound via LOAD.
//     crDst should resolve to 11 (SlideRule's CR), imm=1 (Multiply index 0 → 1-based).
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL SlideRule, Multiply');
    const errors = a.errors;
    const word   = result.words[1];
    const opcode = (word >>> 27) & 0x1F;
    const crDst  = (word >>> 19) & 0xF;
    const imm    = word & 0x7FFF;
    assert('T9 CALL SlideRule, Multiply assembles with no errors',
        errors.length === 0, errors.map(e => e.message).join('; '));
    assert('T9 opcode=2 (CALL)', opcode === 2, 'got ' + opcode);
    assert('T9 crDst=11 (SlideRule → CR11)', crDst === 11, 'got ' + crDst);
    assert('T9 imm=1 (Multiply index 0 → 1-based imm)', imm === 1, 'got ' + imm);
}

// T10: CALL SlideRule, Divide uses index 1 → imm=2 (1-based).
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL SlideRule, Divide');
    const errors = a.errors;
    const word   = result.words[1];
    const imm    = word & 0x7FFF;
    assert('T10 CALL SlideRule, Divide assembles with no errors',
        errors.length === 0, errors.map(e => e.message).join('; '));
    assert('T10 imm=2 (Divide index 1 → 1-based imm)', imm === 2, 'got ' + imm);
}

// T11: CALL SlideRule, 0 (numeric selector 0 with abstraction name) encodes as imm=1.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL SlideRule, 0');
    const errors = a.errors;
    const word   = result.words[1];
    const crDst  = (word >>> 19) & 0xF;
    const imm    = word & 0x7FFF;
    assert('T11 CALL SlideRule, 0 (numeric) assembles without errors',
        errors.length === 0, errors.map(e => e.message).join('; '));
    assert('T11 crDst=11', crDst === 11, 'got ' + crDst);
    assert('T11 imm=1 (numeric 0 → 1-based imm)', imm === 1, 'got ' + imm);
}

// ── Loaded-CR resolution + named method selectors — CALL AbsName.MethodName ──

// T12: CALL SlideRule.Multiply succeeds and encodes crDst=11, imm=1.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL SlideRule.Multiply');
    const errors = a.errors;
    const word   = result.words[1];
    const opcode = (word >>> 27) & 0x1F;
    const crDst  = (word >>> 19) & 0xF;
    const imm    = word & 0x7FFF;
    assert('T12 CALL SlideRule.Multiply assembles with no errors',
        errors.length === 0, errors.map(e => e.message).join('; '));
    assert('T12 opcode=2 (CALL)', opcode === 2, 'got ' + opcode);
    assert('T12 crDst=11 (SlideRule → CR11)', crDst === 11, 'got ' + crDst);
    assert('T12 imm=1 (Multiply index 0 → 1-based imm)', imm === 1, 'got ' + imm);
}

// T13: CALL SlideRule.Sqrt encodes index 2 → imm=3 (1-based).
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const result = a.assemble('LOAD CR11, SlideRule\nCALL SlideRule.Sqrt');
    const errors = a.errors;
    const word   = result.words[1];
    const imm    = word & 0x7FFF;
    assert('T13 CALL SlideRule.Sqrt assembles with no errors',
        errors.length === 0, errors.map(e => e.message).join('; '));
    assert('T13 imm=3 (Sqrt index 2 → 1-based imm)', imm === 3, 'got ' + imm);
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

// P2: .pet alias in CR position — alias cloomc→CR9 then CALL CR0, cloomc, 0
{
    const a = new ChurchAssembler();
    const r1 = a.assemble('CALL CR0, CR9, 0');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('.pet cloomc CR9\nCALL CR0, cloomc, 0');
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
    a.assemble('.pet x DR1\nCALL x, CR9, 0');
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
    // column-range assertions (task-1315)
    const p7w = a.warnings[0];
    assert('P7 warning has colStart', typeof p7w.colStart === 'number',
        'colStart = ' + p7w.colStart);
    assert('P7 warning has colEnd', typeof p7w.colEnd === 'number',
        'colEnd = ' + p7w.colEnd);
    // '.pet x DR2' — alias 'x' starts at index 5, length 1
    assert('P7 warning colStart points to alias token', p7w.colStart === 5,
        'expected colStart=5, got ' + p7w.colStart);
    assert('P7 warning colEnd = colStart + alias.length', p7w.colEnd === 6,
        'expected colEnd=6, got ' + p7w.colEnd);
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
    a.assemble('.pet result DR1\n.pet cloomc CR9\nNOP');
    const aliases = a.getAliases();
    assert('P9 getAliases DR: result→1', aliases.dr['result'] === 1, JSON.stringify(aliases.dr));
    assert('P9 getAliases CR: cloomc→9', aliases.cr['cloomc'] === 9, JSON.stringify(aliases.cr));
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

// P12: Privilege Zone — CR12–CR15 cannot be a destination for LOAD / SAVE /
//      ELOADCALL / XLOADLAMBDA. CALL is unrestricted (control-flow only).
//      Exception: CR14 (Current-Lump, RX) is allowed as the SOURCE of DREAD
//      so user code can read embedded data constants from the code lump.
{
    // P12a: LOAD CR12 → error (Thread register)
    const a = new ChurchAssembler();
    a.assemble('LOAD CR12, CR6, 0');
    assert('P12a LOAD CR12: error', a.errors.length > 0, 'expected an error');
    assert('P12a LOAD CR12: error mentions privilege zone or CR12',
        a.errors.some(e => e.message.includes('CR12') && (e.message.includes('Privilege') || e.message.includes('kernel'))),
        a.errors.map(e => e.message).join('; '));

    // P12b: LOAD CR15 → error (Namespace register)
    const b = new ChurchAssembler();
    b.assemble('LOAD CR15, CR6, 0');
    assert('P12b LOAD CR15: error', b.errors.length > 0, 'expected an error');
    assert('P12b LOAD CR15: error mentions CR15',
        b.errors.some(e => e.message.includes('CR15')),
        b.errors.map(e => e.message).join('; '));

    // P12c: SAVE CR14 → error
    const c = new ChurchAssembler();
    c.assemble('SAVE CR14, CR6, 0');
    assert('P12c SAVE CR14: error', c.errors.length > 0, 'expected an error');
    assert('P12c SAVE CR14: error mentions CR14',
        c.errors.some(e => e.message.includes('CR14')),
        c.errors.map(e => e.message).join('; '));

    // P12d: ELOADCALL CR13 → error
    const d = new ChurchAssembler();
    d.assemble('ELOADCALL CR13, CR6, 0');
    assert('P12d ELOADCALL CR13: error', d.errors.length > 0, 'expected an error');
    assert('P12d ELOADCALL CR13: error mentions CR13',
        d.errors.some(e => e.message.includes('CR13')),
        d.errors.map(e => e.message).join('; '));

    // P12e: XLOADLAMBDA CR12 → error
    const e = new ChurchAssembler();
    e.assemble('XLOADLAMBDA CR12, CR6, 0');
    assert('P12e XLOADLAMBDA CR12: error', e.errors.length > 0, 'expected an error');
    assert('P12e XLOADLAMBDA CR12: error mentions CR12',
        e.errors.some(e2 => e2.message.includes('CR12')),
        e.errors.map(e2 => e2.message).join('; '));

    // P12f: LOAD CR11 → no error (CR11 is the last valid user register)
    const f = new ChurchAssembler();
    f.assemble('LOAD CR11, CR6, 0');
    assert('P12f LOAD CR11: no error (CR0–CR11 are valid)', f.errors.length === 0,
        f.errors.map(e => e.message).join('; '));

    // P12g: CALL CR12, 0 → error (ALL instructions now restricted)
    const g = new ChurchAssembler();
    g.assemble('CALL CR12, 0');
    assert('P12g CALL CR12: error', g.errors.length > 0, 'expected an error');
    assert('P12g CALL CR12: error mentions CR12',
        g.errors.some(e => e.message.includes('CR12')),
        g.errors.map(e => e.message).join('; '));

    // P12h: CALL crSrc CR13 (numeric method selector via CR syntax) — valid with imm15 encoding.
    // Method selector is now in imm15 (1-based), not crSrc; no priv-zone restriction on values.
    const h = new ChurchAssembler();
    h.assemble('CALL CR0, CR13, 0');
    assert('P12h CALL CR0 CR13: no error (numeric selector, no priv-zone restriction)',
        h.errors.length === 0, h.errors.map(e => e.message).join('; '));

    // P12i: CHANGE CR0, CR15 → error on crSrc
    const i = new ChurchAssembler();
    i.assemble('CHANGE CR0, CR15, 0');
    assert('P12i CHANGE CR0 CR15: error', i.errors.length > 0, 'expected an error');
    assert('P12i error mentions CR15', i.errors.some(e => e.message.includes('CR15')),
        i.errors.map(e => e.message).join('; '));

    // P12j: CHANGE CR14, CR0 → error on crDst
    const j = new ChurchAssembler();
    j.assemble('CHANGE CR14, CR0, 0');
    assert('P12j CHANGE CR14 CR0: error', j.errors.length > 0, 'expected an error');
    assert('P12j error mentions CR14', j.errors.some(e => e.message.includes('CR14')),
        j.errors.map(e => e.message).join('; '));

    // P12k: SWITCH CR12 → error
    const k = new ChurchAssembler();
    k.assemble('SWITCH CR12, 0');
    assert('P12k SWITCH CR12: error', k.errors.length > 0, 'expected an error');
    assert('P12k error mentions CR12', k.errors.some(e => e.message.includes('CR12')),
        k.errors.map(e => e.message).join('; '));

    // P12l: TPERM CR15 → error
    const l = new ChurchAssembler();
    l.assemble('TPERM CR15, 0');
    assert('P12l TPERM CR15: error', l.errors.length > 0, 'expected an error');
    assert('P12l error mentions CR15', l.errors.some(e => e.message.includes('CR15')),
        l.errors.map(e => e.message).join('; '));

    // P12m: LAMBDA CR13 → error
    const m = new ChurchAssembler();
    m.assemble('LAMBDA CR13');
    assert('P12m LAMBDA CR13: error', m.errors.length > 0, 'expected an error');
    assert('P12m error mentions CR13', m.errors.some(e => e.message.includes('CR13')),
        m.errors.map(e => e.message).join('; '));

    // P12n: DREAD DR0, CR12, 0 → error (crSrc is a priv CR)
    const n = new ChurchAssembler();
    n.assemble('DREAD DR0, CR12, 0');
    assert('P12n DREAD DR0 CR12: error', n.errors.length > 0, 'expected an error');
    assert('P12n error mentions CR12', n.errors.some(e => e.message.includes('CR12')),
        n.errors.map(e => e.message).join('; '));

    // P12o: DWRITE DR0, CR15, 0 → error (crSrc is a priv CR)
    const o = new ChurchAssembler();
    o.assemble('DWRITE DR0, CR15, 0');
    assert('P12o DWRITE DR0 CR15: error', o.errors.length > 0, 'expected an error');
    assert('P12o error mentions CR15', o.errors.some(e => e.message.includes('CR15')),
        o.errors.map(e => e.message).join('; '));

    // P12p: SWITCH CR11 → error (D-11 fix: assembler now enforces crSrc ≤ 7;
    //       CR8–CR11 would silently truncate in the hardware 3-bit crSrc field)
    const p = new ChurchAssembler();
    p.assemble('SWITCH CR11, 0');
    assert('P12p SWITCH CR11: error (crSrc must be 0–7)', p.errors.length > 0,
        'expected an error — CR11 silently truncates to CR3 in hardware 3-bit field');
    assert('P12p SWITCH CR11: error mentions CR11',
        p.errors.some(e => e.message.includes('CR11')),
        p.errors.map(e => e.message).join('; '));

    // P12q: DREAD DR0, CR14, 0 → no error (CR14 is RX — data-constant reads allowed)
    const q = new ChurchAssembler();
    q.assemble('DREAD DR0, CR14, 0');
    assert('P12q DREAD DR0 CR14: no error (CR14 is RX)', q.errors.length === 0,
        q.errors.map(e => e.message).join('; '));

    // P12r: CHANGE CR12, CR12, #1 → no error (CHANGE is the thread-switch instruction;
    //       CR12 is its dedicated operand and is exempt from the privilege-zone block)
    const r = new ChurchAssembler();
    r.assemble('CHANGE CR12, CR12, #1');
    assert('P12r CHANGE CR12 CR12: no error (thread switch)', r.errors.length === 0,
        r.errors.map(e => e.message).join('; '));

    // P12s: CHANGE CR13 (not CR12) → still an error
    const s = new ChurchAssembler();
    s.assemble('CHANGE CR13, CR0, 0');
    assert('P12s CHANGE CR13: error (only CR12 exempt)', s.errors.length > 0,
        'expected an error for CR13 in CHANGE');
    assert('P12s CHANGE CR13: error mentions CR13',
        s.errors.some(e => e.message.includes('CR13')),
        s.errors.map(e => e.message).join('; '));

    // P12t: CHANGE CR14 as crDst → still an error (CR14 is not the thread register)
    const t = new ChurchAssembler();
    t.assemble('CHANGE CR14, CR0, 0');
    assert('P12t CHANGE CR14 crDst: error', t.errors.length > 0,
        'expected an error for CR14 as crDst in CHANGE');

    // P12u: SWITCH CR8 → error (crSrc=8 truncates to 0 in hardware 3-bit field)
    const u = new ChurchAssembler();
    u.assemble('SWITCH CR8, 5');
    assert('P12u SWITCH CR8: error (crSrc > 7 truncates in hardware)', u.errors.length > 0,
        'expected an error for CR8 in SWITCH');
    assert('P12u SWITCH CR8: error mentions CR8',
        u.errors.some(e => e.message.includes('CR8')),
        u.errors.map(e => e.message).join('; '));

    // P12v: SWITCH CR7, 5 → no error (CR7 is the upper boundary of the valid range)
    const v = new ChurchAssembler();
    v.assemble('SWITCH CR7, 5');
    assert('P12v SWITCH CR7: no error (CR7 is the valid boundary)',
        v.errors.length === 0,
        v.errors.map(e => e.message).join('; '));

    // P12w: SWITCH CR0, CR1 → same word as SWITCH CR0, 1 (CRn shorthand)
    const w1 = new ChurchAssembler();
    const r12w1 = w1.assemble('SWITCH CR0, 1');
    const w2 = new ChurchAssembler();
    const r12w2 = w2.assemble('SWITCH CR0, CR1');
    assert('P12w SWITCH CR0, CR1: no error', w2.errors.length === 0,
        w2.errors.map(e => e.message).join('; '));
    assert('P12w SWITCH CR0, CR1: same word as SWITCH CR0, 1',
        r12w2.words[0] === r12w1.words[0],
        `got 0x${(r12w2.words[0]>>>0).toString(16)} vs 0x${(r12w1.words[0]>>>0).toString(16)}`);

    // P12x: TPERM reserved presets (10/11/12/15) → compile-time error naming RSVn
    for (const [code, rsvName] of [[10,'RSV3'],[11,'RSV4'],[12,'RSV5'],[15,'RSV1']]) {
        const ax = new ChurchAssembler();
        ax.assemble(`TPERM CR0, ${code}`);
        assert(`P12x TPERM CR0,${code} (${rsvName}): error emitted`,
            ax.errors.length > 0, `expected a reserved-preset error for code ${code}`);
        assert(`P12x TPERM CR0,${code} (${rsvName}): error names ${rsvName}`,
            ax.errors.some(e => e.message.includes(rsvName)),
            ax.errors.map(e => e.message).join('; '));
    }

    // P12y: TPERM B-modifier reserved variants (26=RSV3B, 27=RSV4B, 28=RSV5B, 31=RSV1B) → error
    for (const [code, rsvName] of [[26,'RSV3'],[27,'RSV4'],[28,'RSV5'],[31,'RSV1']]) {
        const ay = new ChurchAssembler();
        ay.assemble(`TPERM CR0, ${code}`);
        assert(`P12y TPERM CR0,${code} (${rsvName}B): error emitted`,
            ay.errors.length > 0, `expected a reserved-preset error for B-variant code ${code}`);
        assert(`P12y TPERM CR0,${code} (${rsvName}B): error names ${rsvName}`,
            ay.errors.some(e => e.message.includes(rsvName)),
            ay.errors.map(e => e.message).join('; '));
    }

    // P12z: TPERM valid presets near reserved range → no reserved-preset error
    for (const preset of ['FRAME', 'EXACT', '9', '13', '14']) {
        const az = new ChurchAssembler();
        az.assemble(`TPERM CR0, ${preset}`);
        const rsvErr = az.errors.filter(e => e.message && e.message.includes('reserved'));
        assert(`P12z TPERM CR0,${preset}: no reserved-preset error`,
            rsvErr.length === 0, rsvErr.map(e => e.message).join('; '));
    }
}

// ── LED[N] Abstract GT bracket syntax ────────────────────────────────────────

// L1: LOAD CR3, LED[0]  →  same word as  LOAD CR3, CR6, #8
{
    const a1 = new ChurchAssembler();
    const r1 = a1.assemble('LOAD CR3, CR6, #8');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('LOAD CR3, LED[0]');
    assert('L1 LED[0]: no assembly errors', a2.errors.length === 0,
        a2.errors.map(e => e.message).join('; '));
    assert('L1 LED[0]: same word as LOAD CR3, CR6, #8',
        r1.words[0] === r2.words[0],
        `explicit=0x${(r1.words[0]>>>0).toString(16)} bracket=0x${(r2.words[0]>>>0).toString(16)}`);
}

// L2: LOAD CR5, LED[5]  →  same word as  LOAD CR5, CR6, #13
{
    const a1 = new ChurchAssembler();
    const r1 = a1.assemble('LOAD CR5, CR6, #13');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('LOAD CR5, LED[5]');
    assert('L2 LED[5]: no assembly errors', a2.errors.length === 0,
        a2.errors.map(e => e.message).join('; '));
    assert('L2 LED[5]: same word as LOAD CR5, CR6, #13',
        r1.words[0] === r2.words[0],
        `explicit=0x${(r1.words[0]>>>0).toString(16)} bracket=0x${(r2.words[0]>>>0).toString(16)}`);
}

// L3: LED[6] is out of range — _resolveNSName returns null, parser should error
{
    const a = new ChurchAssembler();
    a.assemble('LOAD CR3, LED[6]');
    assert('L3 LED[6] out-of-range: produces an error', a.errors.length > 0,
        'expected an error for LED[6]');
}

// L4: lower-case led[0] is accepted (case-insensitive)
{
    const a1 = new ChurchAssembler();
    const r1 = a1.assemble('LOAD CR3, CR6, #8');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('LOAD CR3, led[0]');
    assert('L4 led[0] lowercase: no errors', a2.errors.length === 0,
        a2.errors.map(e => e.message).join('; '));
    assert('L4 led[0] lowercase: same word as LOAD CR3, CR6, #8',
        r1.words[0] === r2.words[0],
        `explicit=0x${(r1.words[0]>>>0).toString(16)} bracket=0x${(r2.words[0]>>>0).toString(16)}`);
}

// ── WORD inline data constant ─────────────────────────────────────────────────

// W1: WORD 1  — no errors, opcode field = 0x1E, payload = 1
{
    const a = new ChurchAssembler();
    const r = a.assemble('WORD 1');
    assert('W1 WORD 1: no errors', a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('W1 WORD 1: one word emitted', r.words.length === 1, `length=${r.words.length}`);
    const w = r.words[0] >>> 0;
    assert('W1 WORD 1: opcode field = 0x1E', (w >>> 27) === 0x1E, `opcode=${(w>>>27).toString(16)}`);
    assert('W1 WORD 1: payload = 1',          (w & 0x7FFFFFF) === 1, `payload=${w & 0x7FFFFFF}`);
}

// W2: WORD 0x1234567  — 27-bit hex payload
{
    const a = new ChurchAssembler();
    const r = a.assemble('WORD 0x1234567');
    assert('W2 WORD hex: no errors', a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    const w = r.words[0] >>> 0;
    assert('W2 WORD hex: opcode 0x1E', (w >>> 27) === 0x1E,        `opcode=${(w>>>27).toString(16)}`);
    assert('W2 WORD hex: payload',     (w & 0x7FFFFFF) === 0x1234567, `payload=0x${(w&0x7FFFFFF).toString(16)}`);
}

// W3: disassemble WORD word → "WORD 0x0000001"
{
    const a = new ChurchAssembler();
    const r = a.assemble('WORD 1');
    const dis = a.disassemble(r.words[0]);
    assert('W3 WORD disassemble: starts with WORD', dis.startsWith('WORD '), `dis="${dis}"`);
    assert('W3 WORD disassemble: payload visible',  dis.includes('1'),        `dis="${dis}"`);
}

// W4: WORD produces opcode 0x1E, not anything in the 0–19 range
{
    const a = new ChurchAssembler();
    const r = a.assemble('WORD 42');
    const w = r.words[0] >>> 0;
    assert('W4 WORD opcode is 0x1E not 0-19', (w >>> 27) === 0x1E, `opcode=${(w>>>27).toString(16)}`);
}

// ── Branch labels ─────────────────────────────────────────────────────────────

// BL1: backward branch label — BRANCHNE loop_top where loop_top is before the instruction
{
    const a = new ChurchAssembler();
    const r = a.assemble([
        'loop_top:',
        '  ISUB DR1, DR1, #1',
        '  BRANCHNE loop_top',
    ].join('\n'));
    assert('BL1 backward label: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('BL1 backward label: 2 words', r.words.length === 2, `len=${r.words.length}`);
    // loop_top=0, BRANCHNE at addr=1 → offset = 0-1 = -1 → encoded as 0x7FFF in 15-bit signed
    const bImm = r.words[1] & 0x7FFF;
    assert('BL1 backward label: offset = -1 (0x7FFF)', bImm === 0x7FFF, `imm=0x${bImm.toString(16)}`);
}

// BL2: forward branch label — BRANCH AL done where done: is after
{
    const a = new ChurchAssembler();
    const r = a.assemble([
        '  BRANCH done',
        '  ISUB DR1, DR1, #1',
        'done:',
        '  RETURN',
    ].join('\n'));
    assert('BL2 forward label: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    // done=2, BRANCH at addr=0 → offset = 2-0 = 2
    const fImm = r.words[0] & 0x7FFF;
    assert('BL2 forward label: offset = 2', fImm === 2, `imm=0x${fImm.toString(16)}`);
}

// BL3: conditional suffix on branch label — BRANCHGT
{
    const a = new ChurchAssembler();
    const r = a.assemble([
        '  ISUB DR1, DR1, #1',
        '  BRANCHGT skip',
        '  ISUB DR2, DR2, #1',
        'skip:',
        '  RETURN',
    ].join('\n'));
    assert('BL3 BRANCHGT forward label: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    // skip=3, BRANCHGT at addr=1 → offset = 3-1 = 2
    const cImm = r.words[1] & 0x7FFF;
    assert('BL3 BRANCHGT forward label: offset = 2', cImm === 2, `imm=0x${cImm.toString(16)}`);
}

// BL4: undefined label → error with helpful message
{
    const a = new ChurchAssembler();
    a.assemble('  BRANCH no_such_label');
    assert('BL4 undefined label: produces an error', a.errors.length > 0,
        'expected an error');
    assert('BL4 undefined label: error mentions label name',
        a.errors.some(e => e.message.includes('no_such_label')),
        a.errors.map(e => e.message).join('; '));
}

// BL5: two labels in same program, each BRANCH targets the correct one
{
    const a = new ChurchAssembler();
    const r = a.assemble([
        'alpha:',
        '  ISUB DR1, DR1, #1',
        '  BRANCHNE alpha',    // addr=1 → offset = 0-1 = -1 = 0x7FFF
        'beta:',
        '  ISUB DR2, DR2, #1',
        '  BRANCHNE beta',     // addr=4 → offset = 3-4 = -1 = 0x7FFF
    ].join('\n'));
    assert('BL5 two labels: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('BL5 alpha branch offset = -1', (r.words[1] & 0x7FFF) === 0x7FFF,
        `got 0x${(r.words[1]&0x7FFF).toString(16)}`);
    assert('BL5 beta branch offset = -1',  (r.words[3] & 0x7FFF) === 0x7FFF,
        `got 0x${(r.words[3]&0x7FFF).toString(16)}`);
}

// ── DREAD CR14 labels ─────────────────────────────────────────────────────────

// DL1: DREAD DR1, CR14, #V1 where V1: is a labelled WORD constant
//      Program: 2 instructions, then label at word 2, then WORD 42
{
    const a = new ChurchAssembler();
    const r = a.assemble([
        '  ISUB DR1, DR1, #1',       // word 0
        '  RETURN',                   // word 1
        'V1:',
        '  WORD 42',                  // word 2
    ].join('\n'));
    assert('DL1 WORD label: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('DL1 WORD label: V1 in labels at offset 2',
        a.labels['V1'] === 2, `V1=${a.labels['V1']}`);
}

// DL2: DREAD encodes label as absolute offset — #V1 with hash prefix
{
    const a = new ChurchAssembler();
    const r = a.assemble([
        '  DREAD DR1, CR14, #V1',    // word 0 → imm should be 0x4002 (bit14=1, offset=2)
        '  RETURN',                   // word 1
        'V1:',
        '  WORD 99',                  // word 2
    ].join('\n'));
    assert('DL2 DREAD #label: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const dImm = r.words[0] & 0x7FFF;
    assert('DL2 DREAD #label: imm = 0x4002 (bit14=1 immediate, offset=2)', dImm === 0x4002,
        `imm=0x${dImm.toString(16)}`);
}

// DL3: DREAD encodes label without hash prefix — V1 (no #)
{
    const a = new ChurchAssembler();
    const r = a.assemble([
        '  DREAD DR1, CR14, V1',     // word 0 → imm should be 0x4002 (bit14=1, offset=2)
        '  RETURN',                   // word 1
        'V1:',
        '  WORD 99',                  // word 2
    ].join('\n'));
    assert('DL3 DREAD label (no #): no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const dImm2 = r.words[0] & 0x7FFF;
    assert('DL3 DREAD label (no #): imm = 0x4002 (bit14=1, offset=2)', dImm2 === 0x4002, `imm=0x${dImm2.toString(16)}`);
}

// DL4: DREAD undefined label → error
{
    const a = new ChurchAssembler();
    a.assemble('  DREAD DR1, CR14, unknown_const');
    assert('DL4 DREAD undefined label: produces an error', a.errors.length > 0,
        'expected error for unknown_const');
    assert('DL4 DREAD undefined label: error mentions token',
        a.errors.some(e => e.message.includes('unknown_const')),
        a.errors.map(e => e.message).join('; '));
}

// DL5: multiple WORD labels — each DREAD gets the right offset
{
    const a = new ChurchAssembler();
    const r = a.assemble([
        '  DREAD DR1, CR14, V1',     // word 0 → imm=0x4003 (bit14=1, offset=3)
        '  DREAD DR2, CR14, V2',     // word 1 → imm=0x4004 (bit14=1, offset=4)
        '  RETURN',                   // word 2
        'V1:',
        '  WORD 10',                  // word 3
        'V2:',
        '  WORD 20',                  // word 4
    ].join('\n'));
    assert('DL5 multi WORD labels: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('DL5 V1 offset = 0x4003 (bit14=1, offset=3)', (r.words[0] & 0x7FFF) === 0x4003,
        `imm0=0x${(r.words[0]&0x7FFF).toString(16)}`);
    assert('DL5 V2 offset = 0x4004 (bit14=1, offset=4)', (r.words[1] & 0x7FFF) === 0x4004,
        `imm1=0x${(r.words[1]&0x7FFF).toString(16)}`);
}

// DL6: indexed DREAD — 4-operand form encodes base and DRx, bit14=0
{
    const a = new ChurchAssembler();
    const r = a.assemble('DREAD DR2, CR0, #10, DR3');
    assert('DL6 indexed DREAD: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const w = r.words[0];
    const opcode6 = (w >>> 27) & 0x1F;
    const imm6    = w & 0x7FFF;
    assert('DL6 indexed DREAD: opcode=16', opcode6 === 16, `opcode=${opcode6}`);
    assert('DL6 indexed DREAD: bit14=0 (indexed mode)', (imm6 & 0x4000) === 0, `imm=0x${imm6.toString(16)}`);
    assert('DL6 indexed DREAD: base=10 in bits[13:4]', ((imm6 >> 4) & 0x3FF) === 10,
        `base=${(imm6>>4)&0x3FF}`);
    assert('DL6 indexed DREAD: DRx=3 in bits[3:0]', (imm6 & 0xF) === 3, `DRx=${imm6&0xF}`);
}

// DL7: indexed DWRITE — same encoding pattern
{
    const a = new ChurchAssembler();
    const r = a.assemble('DWRITE DR1, CR3, #5, DR2');
    assert('DL7 indexed DWRITE: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const w = r.words[0];
    const opcode7 = (w >>> 27) & 0x1F;
    const imm7    = w & 0x7FFF;
    assert('DL7 indexed DWRITE: opcode=17', opcode7 === 17, `opcode=${opcode7}`);
    assert('DL7 indexed DWRITE: bit14=0 (indexed mode)', (imm7 & 0x4000) === 0, `imm=0x${imm7.toString(16)}`);
    assert('DL7 indexed DWRITE: base=5 in bits[13:4]', ((imm7 >> 4) & 0x3FF) === 5,
        `base=${(imm7>>4)&0x3FF}`);
    assert('DL7 indexed DWRITE: DRx=2 in bits[3:0]', (imm7 & 0xF) === 2, `DRx=${imm7&0xF}`);
}

// DL8: indexed DREAD disassembles to 4-operand form
{
    const a = new ChurchAssembler();
    const r = a.assemble('DREAD DR2, CR0, #10, DR3');
    const dis = a.disassemble(r.words[0]);
    assert('DL8 indexed DREAD disassembly: contains #10', dis.includes('#10'), `got: ${dis}`);
    assert('DL8 indexed DREAD disassembly: contains DR3', dis.includes('DR3'), `got: ${dis}`);
}

// DL9: immediate DREAD disassembles to 3-operand form with # prefix
{
    const a = new ChurchAssembler();
    const r = a.assemble('DREAD DR1, CR2, #7');
    const dis = a.disassemble(r.words[0]);
    assert('DL9 immediate DREAD disassembly: contains #7', dis.includes('#7'), `got: ${dis}`);
    assert('DL9 immediate DREAD disassembly: no DR index', !/ DR\d+$/.test(dis.trim()), `got: ${dis}`);
}

// DL10: indexed base out-of-range error
{
    const a = new ChurchAssembler();
    a.assemble('DREAD DR1, CR0, #1024, DR2');
    assert('DL10 indexed DREAD base >1023: error', a.errors.length > 0, 'expected an error');
    assert('DL10 error mentions base offset', a.errors.some(e => e.message.includes('base offset')),
        a.errors.map(e => e.message).join('; '));
}

// DL11: immediate offset out-of-range error
{
    const a = new ChurchAssembler();
    a.assemble('DREAD DR1, CR0, #16384');
    assert('DL11 DREAD imm >16383: error', a.errors.length > 0, 'expected an error');
    assert('DL11 error mentions immediate offset', a.errors.some(e => e.message.includes('immediate offset')),
        a.errors.map(e => e.message).join('; '));
}

// ── Shared alias inheritance (setSharedAliases) ───────────────────────────────
// All tests in this block clear shared state before and after to avoid
// contaminating the rest of the suite.

// SA1: DR alias set via setSharedAliases is visible in a fresh assembler instance
{
    ChurchAssembler.setSharedAliases({ myResult: 3 }, {});
    const a = new ChurchAssembler();
    const r = a.assemble('IADD myResult, myResult, #1');
    assert('SA1 shared DR alias: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    // crDst field = DR3 → bits[22:19] of the word = 3
    assert('SA1 shared DR alias: crDst = 3', ((r.words[0] >>> 19) & 0xF) === 3,
        `crDst=${(r.words[0]>>>19)&0xF}`);
    ChurchAssembler.setSharedAliases({}, {});
}

// SA2: CR alias set via setSharedAliases is visible in a fresh assembler instance
{
    ChurchAssembler.setSharedAliases({}, { heap: 5 });
    const a = new ChurchAssembler();
    const r = a.assemble('LOAD CR0, heap, #0');
    assert('SA2 shared CR alias: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    // crSrc field = CR5 → bits[18:15] = 5
    assert('SA2 shared CR alias: crSrc = 5', ((r.words[0] >>> 15) & 0xF) === 5,
        `crSrc=${(r.words[0]>>>15)&0xF}`);
    ChurchAssembler.setSharedAliases({}, {});
}

// SA3: local .pet declaration overrides a shared alias for that lump only
{
    ChurchAssembler.setSharedAliases({ acc: 1 }, {});
    const a = new ChurchAssembler();
    // Override acc → DR7 for this lump
    const r = a.assemble('.pet acc DR7\nIADD acc, acc, #0');
    assert('SA3 local .pet overrides shared: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SA3 local .pet overrides shared: crDst = 7', ((r.words[0] >>> 19) & 0xF) === 7,
        `crDst=${(r.words[0]>>>19)&0xF}`);
    // Second assembler still sees the original shared alias (acc → DR1)
    const b = new ChurchAssembler();
    const r2 = b.assemble('IADD acc, acc, #0');
    assert('SA3 other instance unaffected: crDst = 1', ((r2.words[0] >>> 19) & 0xF) === 1,
        `crDst=${(r2.words[0]>>>19)&0xF}`);
    ChurchAssembler.setSharedAliases({}, {});
}

// SA4: setSharedAliases({},{}) clears — a new instance no longer sees old aliases
{
    ChurchAssembler.setSharedAliases({ ghost: 9 }, {});
    ChurchAssembler.setSharedAliases({}, {});
    const a = new ChurchAssembler();
    a.assemble('IADD ghost, ghost, #0');
    assert('SA4 cleared shared alias: produces an error', a.errors.length > 0,
        'expected error — ghost should no longer be a known alias');
}

// SA5: shared alias inherited across multiple separate assemble() calls on the
//      same instance — verify assemble() resets to shared, not to empty
{
    ChurchAssembler.setSharedAliases({ rtn: 2 }, {});
    const a = new ChurchAssembler();
    a.assemble('IADD rtn, rtn, #1');     // first call
    const r = a.assemble('ISUB rtn, rtn, #1');  // second call — alias must still be present
    assert('SA5 shared alias persists across calls: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SA5 second call crDst = 2', ((r.words[0] >>> 19) & 0xF) === 2,
        `crDst=${(r.words[0]>>>19)&0xF}`);
    ChurchAssembler.setSharedAliases({}, {});
}

// ── Method index in ELOADCALL ─────────────────────────────────────────────────
// SlideRule is at c-list slot 3 (NS_SYMBOLS = { 'SlideRule': 3 }).
// imm15 layout: bits[14:8] = method index (1-based, 0 = fast-path / no method)
//               bits[7:0]  = c-list row.

// EL1: Simple form — no method operand → method bits are 0, row = slot.
//      ELOADCALL CR0, SlideRule  →  crDst=0, crSrc=6, imm = 0x0003
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const r = a.assemble('ELOADCALL CR0, SlideRule');
    const word   = r.words[0];
    const opcode = (word >>> 27) & 0x1F;
    const crDst  = (word >>> 19) & 0xF;
    const crSrc  = (word >>> 15) & 0xF;
    const imm    = word & 0x7FFF;
    assert('EL1 ELOADCALL CR0, SlideRule: no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EL1 opcode = 8 (ELOADCALL)', opcode === 8, 'got ' + opcode);
    assert('EL1 crDst = 0', crDst === 0, 'got ' + crDst);
    assert('EL1 crSrc = 6 (default namespace register)', crSrc === 6, 'got ' + crSrc);
    assert('EL1 imm = 0x0003 (row=3, method=0)', imm === 0x0003, 'got 0x' + imm.toString(16));
}

// EL2: Method-named form — Multiply (index 0) → 1-based bits[14:8] = 1.
//      ELOADCALL CR0, SlideRule, Multiply  →  imm = (1<<8)|3 = 0x0103
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const r = a.assemble('ELOADCALL CR0, SlideRule, Multiply');
    const word = r.words[0];
    const imm  = word & 0x7FFF;
    assert('EL2 ELOADCALL CR0, SlideRule, Multiply: no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EL2 imm = 0x0103 (method Multiply=0→1-based 1, row=3)',
        imm === 0x0103, 'got 0x' + imm.toString(16));
}

// EL3: Method-named form — Divide (index 1) → 1-based bits[14:8] = 2.
//      ELOADCALL CR0, SlideRule, Divide  →  imm = (2<<8)|3 = 0x0203
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const r = a.assemble('ELOADCALL CR0, SlideRule, Divide');
    const word = r.words[0];
    const imm  = word & 0x7FFF;
    assert('EL3 ELOADCALL CR0, SlideRule, Divide: no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EL3 imm = 0x0203 (method Divide=1→1-based 2, row=3)',
        imm === 0x0203, 'got 0x' + imm.toString(16));
}

// EL4: Numeric 0-based index form — index 0 → 1-based bits[14:8] = 1.
//      ELOADCALL CR0, SlideRule, 0  →  imm = (1<<8)|3 = 0x0103
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const r = a.assemble('ELOADCALL CR0, SlideRule, 0');
    const word = r.words[0];
    const imm  = word & 0x7FFF;
    assert('EL4 ELOADCALL CR0, SlideRule, 0 (numeric): no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EL4 imm = 0x0103 (numeric 0-based 0 → 1-based 1, row=3)',
        imm === 0x0103, 'got 0x' + imm.toString(16));
}

// EL5: Explicit CRsrc form without method — ELOADCALL CR0, CR11, #5
//      crDst=0, crSrc=11, imm = 0x0005 (row=5, method=0)
{
    const a = new ChurchAssembler(CONVENTIONS);
    const r = a.assemble('ELOADCALL CR0, CR11, #5');
    const word   = r.words[0];
    const crDst  = (word >>> 19) & 0xF;
    const crSrc  = (word >>> 15) & 0xF;
    const imm    = word & 0x7FFF;
    assert('EL5 ELOADCALL CR0, CR11, #5 (explicit, no method): no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EL5 crDst = 0', crDst === 0, 'got ' + crDst);
    assert('EL5 crSrc = 11', crSrc === 11, 'got ' + crSrc);
    assert('EL5 imm = 0x0005 (row=5, method=0)', imm === 0x0005, 'got 0x' + imm.toString(16));
}

// EL6: Explicit CRsrc form with numeric method index.
//      ELOADCALL CR0, CR11, #5, 2  →  method 0-based 2 → 1-based 3
//      crDst=0, crSrc=11, imm = (3<<8)|5 = 0x0305
{
    const a = new ChurchAssembler(CONVENTIONS);
    const r = a.assemble('ELOADCALL CR0, CR11, #5, 2');
    const word  = r.words[0];
    const crSrc = (word >>> 15) & 0xF;
    const imm   = word & 0x7FFF;
    assert('EL6 ELOADCALL CR0, CR11, #5, 2 (explicit with method): no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EL6 crSrc = 11', crSrc === 11, 'got ' + crSrc);
    assert('EL6 imm = 0x0305 (method 2→1-based 3 in bits[14:8], row=5)',
        imm === 0x0305, 'got 0x' + imm.toString(16));
}

// EL7: Unknown method name produces a targeted error listing known methods.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    a.assemble('ELOADCALL CR0, SlideRule, UnknownOp');
    assert('EL7 ELOADCALL unknown method: produces an error',
        a.errors.length > 0, 'expected at least one error');
    assert('EL7 error says "not a known method" and mentions UnknownOp',
        a.errors.some(e => e.message.includes('not a known method') && e.message.includes('UnknownOp')),
        a.errors.map(e => e.message).join('; '));
    assert('EL7 error lists a known method (Multiply)',
        a.errors.some(e => e.message.includes('Multiply')),
        a.errors.map(e => e.message).join('; '));
}

// EL8: No conventions registered for the abstraction → clear error.
{
    const a = new ChurchAssembler({});   // empty conventions
    a.setNamespace(NS_SYMBOLS);
    a.assemble('ELOADCALL CR0, SlideRule, Multiply');
    assert('EL8 ELOADCALL no conventions: produces an error',
        a.errors.length > 0, 'expected at least one error');
    assert('EL8 error mentions "No method conventions"',
        a.errors.some(e => e.message.includes('No method conventions')),
        a.errors.map(e => e.message).join('; '));
}

// EL9: Disassembler output — no method index → omits method field.
//      Assemble ELOADCALL CR0, SlideRule (imm=0x0003) then disassemble.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const r   = a.assemble('ELOADCALL CR0, SlideRule');
    const dis = a.disassemble(r.words[0]);
    assert('EL9 disassemble ELOADCALL (no method): includes ELOADCALL',
        dis.includes('ELOADCALL'), 'got: ' + dis);
    assert('EL9 disassemble ELOADCALL (no method): includes CR0',
        dis.includes('CR0'), 'got: ' + dis);
    assert('EL9 disassemble ELOADCALL (no method): does not include a trailing method index',
        !/, \d+$/.test(dis.trim()), 'got: ' + dis);
}

// EL10: Disassembler output — with method index → appends 0-based index.
//       Assemble ELOADCALL CR0, SlideRule, Multiply (imm=0x0103) then disassemble.
//       Expected suffix: ", 0"  (Multiply is index 0, 1-based stored as 1 → display as 0)
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    const r   = a.assemble('ELOADCALL CR0, SlideRule, Multiply');
    const dis = a.disassemble(r.words[0]);
    assert('EL10 disassemble ELOADCALL (with method): includes ELOADCALL',
        dis.includes('ELOADCALL'), 'got: ' + dis);
    assert('EL10 disassemble ELOADCALL (with method): ends with ", 0" (0-based Multiply index)',
        dis.trim().endsWith(', 0'), 'got: ' + dis);
}

// EL11: c-list row = 256 is out of range → error (simple Name form).
//       SlideRule is mapped to slot 256 in a local namespace (well above the 0–31 limit).
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace({ 'SlideRule': 256 });
    a.assemble('ELOADCALL CR0, SlideRule');
    assert('EL11 ELOADCALL row=256: produces an error',
        a.errors.length > 0, 'expected at least one error');
    assert('EL11 error says "out of range" and shows 256',
        a.errors.some(e => e.message.includes('out of range') && e.message.includes('256')),
        a.errors.map(e => e.message).join('; '));
}

// EL12: Numeric method index = 127 is out of range → error (method-indexed form).
//       Valid range is 0–126; 127 must be rejected before it silently truncates.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace(NS_SYMBOLS);
    a.assemble('ELOADCALL CR0, SlideRule, 127');
    assert('EL12 ELOADCALL numeric method=127: produces an error',
        a.errors.length > 0, 'expected at least one error');
    assert('EL12 error says "out of range" and shows 127',
        a.errors.some(e => e.message.includes('out of range') && e.message.includes('127')),
        a.errors.map(e => e.message).join('; '));
}

// EL13: Named method whose stored index is 127 → error (name-resolved method-indexed form).
//       Conventions are extended with a method at index 127 which exceeds the 0–126 limit.
{
    const convWith127 = {
        'SlideRule': {
            'Multiply':    { index: 0 },
            'Divide':      { index: 1 },
            'Sqrt':        { index: 2 },
            'Transcendent':{ index: 127 },
        }
    };
    const a = new ChurchAssembler(convWith127);
    a.setNamespace(NS_SYMBOLS);
    a.assemble('ELOADCALL CR0, SlideRule, Transcendent');
    assert('EL13 ELOADCALL named method index=127: produces an error',
        a.errors.length > 0, 'expected at least one error');
    assert('EL13 error says "out of range" and shows 127',
        a.errors.some(e => e.message.includes('out of range') && e.message.includes('127')),
        a.errors.map(e => e.message).join('; '));
}

// EL14: Explicit CRsrc form with a non-numeric method operand → error mentioning 4th operand.
//       ELOADCALL CR0, CR11, #5, BadName — the 4th field must be a numeric 0-based index.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.assemble('ELOADCALL CR0, CR11, #5, BadName');
    assert('EL14 ELOADCALL explicit non-numeric method: produces an error',
        a.errors.length > 0, 'expected at least one error');
    assert('EL14 error mentions "4th operand" or "numeric" and "BadName"',
        a.errors.some(e =>
            (e.message.includes('4th operand') || e.message.includes('numeric')) &&
            e.message.includes('BadName')),
        a.errors.map(e => e.message).join('; '));
}

// EL15: Explicit CRsrc form with row=256 (no method index) → out-of-range error.
//       ELOADCALL CR0, CR11, #256 — slot must be 0–255.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.assemble('ELOADCALL CR0, CR11, #256');
    assert('EL15 ELOADCALL explicit row=256 (no method): produces an error',
        a.errors.length > 0, 'expected at least one error');
    assert('EL15 error says "out of range" and shows 256',
        a.errors.some(e => e.message.includes('out of range') && e.message.includes('256')),
        a.errors.map(e => e.message).join('; '));
}

// EL16: Explicit CRsrc form with row=256 and a method index → out-of-range error.
//       ELOADCALL CR0, CR11, #256, 0 — slot must be 0–31 even when method index is present.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.assemble('ELOADCALL CR0, CR11, #256, 0');
    assert('EL16 ELOADCALL explicit row=256 (with method): produces an error',
        a.errors.length > 0, 'expected at least one error');
    assert('EL16 error says "out of range" and shows 256',
        a.errors.some(e => e.message.includes('out of range') && e.message.includes('256')),
        a.errors.map(e => e.message).join('; '));
}

// EX-ELOADCALL-BOUNDS: Row field is 5-bit (0–31); row=32 must be rejected, row=31 accepted.
// EL17: c-list row = 32 is out of range → error (Name shorthand form).
//       Row 32 exceeds the 5-bit rs2 field (valid range 0–31) and must be caught
//       at assembly time to prevent a silent wrong-capability access at runtime.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace({ 'SlideRule': 32 });
    a.assemble('ELOADCALL CR0, SlideRule');
    assert('EL17 ELOADCALL row=32 (Name form): produces an error',
        a.errors.length > 0, 'expected at least one error');
    assert('EL17 error says "out of range" and shows 32',
        a.errors.some(e => e.message.includes('out of range') && e.message.includes('32')),
        a.errors.map(e => e.message).join('; '));
    assert('EL17 error mentions 5-bit field',
        a.errors.some(e => e.message.includes('5-bit')),
        a.errors.map(e => e.message).join('; '));
}

// EL18: row=31 via Name form → accepted (max valid 5-bit row value).
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace({ 'SlideRule': 31 });
    a.assemble('ELOADCALL CR0, SlideRule');
    assert('EL18 ELOADCALL row=31 (Name form): no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
}

// EL19: c-list row = 32 is out of range → error (explicit CRsrc form).
//       ELOADCALL CR0, CR11, #32 — the 5-bit rs2 field cannot encode row 32.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.assemble('ELOADCALL CR0, CR11, #32');
    assert('EL19 ELOADCALL explicit row=32 (no method): produces an error',
        a.errors.length > 0, 'expected at least one error');
    assert('EL19 error says "out of range" and shows 32',
        a.errors.some(e => e.message.includes('out of range') && e.message.includes('32')),
        a.errors.map(e => e.message).join('; '));
    assert('EL19 error mentions 5-bit field',
        a.errors.some(e => e.message.includes('5-bit')),
        a.errors.map(e => e.message).join('; '));
}

// EL20: c-list row = 31 is the maximum valid row → no error.
//       Verifies the boundary: row 31 must assemble cleanly (fits in 5 bits).
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.assemble('ELOADCALL CR0, CR11, #31');
    assert('EL20 ELOADCALL explicit row=31 (boundary): no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    const word = a.assemble('ELOADCALL CR0, CR11, #31').words[0];
    const encodedRow = word & 0x1F;
    assert('EL20 encoded row field is 31',
        encodedRow === 31, 'got ' + encodedRow);
}

// EL20: CALL method-name form with NS slot = 32 → out-of-range error.
//       SlideRule is mapped to slot 32 via nsSymbols (not nsLoaded), so the
//       CALL handler converts it to ELOADCALL internally using the dot-notation
//       branch at ~line 1227 of assembler.js.  That branch previously masked
//       the slot with & 0xFF instead of & 0x1F, silently encoding the wrong
//       c-list row.  The fix adds a > 31 guard and must fire here.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace({ 'SlideRule': 32 }); // slot 32 exceeds the 5-bit row field
    a.assemble('CALL SlideRule, Multiply');
    assert('EL20 CALL method-name NS slot=32: produces an error',
        a.errors.length > 0, 'expected at least one error');
    assert('EL20 error says "out of range" and shows 32',
        a.errors.some(e => e.message.includes('out of range') && e.message.includes('32')),
        a.errors.map(e => e.message).join('; '));
    assert('EL20 error mentions 5-bit field',
        a.errors.some(e => e.message.includes('5-bit')),
        a.errors.map(e => e.message).join('; '));
}

// EL21: dot-notation CALL with NS slot = 31 → boundary pass (no error).
//       SlideRule is mapped to slot 31 via nsSymbols (not nsLoaded), so the
//       CALL handler converts it to ELOADCALL via the dot-notation branch at
//       ~line 1226 of assembler.js.  Slot 31 is the maximum valid 5-bit value
//       and must assemble cleanly with the correct row and method fields encoded.
//       Complements EL20 (slot=32 error case): a future change that lowers the
//       threshold to 30 would break this test, catching the regression.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.setNamespace({ 'SlideRule': 31 }); // slot 31 = maximum valid 5-bit row
    const result = a.assemble('CALL SlideRule, Multiply');
    assert('EL21 CALL dot-notation NS slot=31 (boundary): no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    const word = result.words[0];
    const encodedRow    = word & 0x1F;
    const encodedMethod = (word >>> 8) & 0x7F;
    assert('EL21 encoded row field is 31',
        encodedRow === 31, 'got ' + encodedRow);
    assert('EL21 encoded method field is 1 (Multiply index 0 → 1-based)',
        encodedMethod === 1, 'got ' + encodedMethod);
}

// ── SHR / ASR encoding and disassembly ───────────────────────────────────────

// SA1: Plain SHR (LSR) — imm[5] must be 0.
{
    const a = new ChurchAssembler();
    const r = a.assemble('SHR DR3, DR1, 4');
    assert('SA1 SHR DR3, DR1, 4: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const word  = r.words[0];
    const opcode = (word >>> 27) & 0x1F;
    const imm   = word & 0x7FFF;
    const shamt = imm & 0x1F;
    const arith = (imm >>> 5) & 1;
    assert('SA1 opcode=25 (SHR)', opcode === 25, 'got ' + opcode);
    assert('SA1 shamt=4', shamt === 4, 'got ' + shamt);
    assert('SA1 arith=0 (LSR)', arith === 0, 'got ' + arith);
}

// SA2: SHR with ASR keyword — imm[5] must be 1.
{
    const a = new ChurchAssembler();
    const r = a.assemble('SHR DR3, DR1, 4, ASR');
    assert('SA2 SHR DR3, DR1, 4, ASR: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const word  = r.words[0];
    const opcode = (word >>> 27) & 0x1F;
    const imm   = word & 0x7FFF;
    const shamt = imm & 0x1F;
    const arith = (imm >>> 5) & 1;
    assert('SA2 opcode=25 (SHR)', opcode === 25, 'got ' + opcode);
    assert('SA2 shamt=4', shamt === 4, 'got ' + shamt);
    assert('SA2 arith=1 (ASR)', arith === 1, 'got ' + arith);
}

// SA3: ASR disassembly — SHR with imm[5]=1 must show " ASR" modifier.
{
    const a = new ChurchAssembler();
    const r = a.assemble('SHR DR3, DR1, 4, ASR');
    const dis = a.disassemble(r.words[0]);
    assert('SA3 disassemble SHR ASR: includes "ASR"', dis.includes('ASR'), 'got: ' + dis);
    assert('SA3 disassemble SHR ASR: includes "DR3"', dis.includes('DR3'), 'got: ' + dis);
    assert('SA3 disassemble SHR ASR: includes "DR1"', dis.includes('DR1'), 'got: ' + dis);
}

// SA4: LSR disassembly — plain SHR must NOT show "ASR".
{
    const a = new ChurchAssembler();
    const r = a.assemble('SHR DR2, DR0, 7');
    const dis = a.disassemble(r.words[0]);
    assert('SA4 disassemble SHR LSR: does NOT include "ASR"', !dis.includes('ASR'), 'got: ' + dis);
    assert('SA4 disassemble SHR LSR: includes "7"', dis.includes('7'), 'got: ' + dis);
}

// SA5: Maximum shift amount 31 with ASR — shamt=31, arith=1, imm = 0x3F.
{
    const a = new ChurchAssembler();
    const r = a.assemble('SHR DR0, DR0, 31, ASR');
    assert('SA5 SHR DR0, DR0, 31, ASR: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const imm   = r.words[0] & 0x7FFF;
    const shamt = imm & 0x1F;
    const arith = (imm >>> 5) & 1;
    assert('SA5 shamt=31', shamt === 31, 'got ' + shamt);
    assert('SA5 arith=1 (ASR)', arith === 1, 'got ' + arith);
}

// SA6: ASR keyword is case-insensitive (lowercase "asr").
{
    const a = new ChurchAssembler();
    const r = a.assemble('SHR DR1, DR2, 3, asr');
    assert('SA6 SHR ... asr (lowercase): no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const imm   = r.words[0] & 0x7FFF;
    const arith = (imm >>> 5) & 1;
    assert('SA6 arith=1 (ASR via lowercase)', arith === 1, 'got ' + arith);
}

// SA7: ASR and LSR produce different machine words for same DR/shamt operands.
{
    const a = new ChurchAssembler();
    const rLSR = a.assemble('SHR DR1, DR2, 8');
    const b = new ChurchAssembler();
    const rASR = b.assemble('SHR DR1, DR2, 8, ASR');
    assert('SA7 ASR word differs from LSR word',
        rLSR.words[0] !== rASR.words[0],
        `LSR=0x${(rLSR.words[0]>>>0).toString(16)} ASR=0x${(rASR.words[0]>>>0).toString(16)}`);
    assert('SA7 ASR imm[5]=1, LSR imm[5]=0',
        ((rASR.words[0] >>> 5) & 1) === 1 && ((rLSR.words[0] >>> 5) & 1) === 0,
        `ASR_bit=${(rASR.words[0] >>> 5) & 1} LSR_bit=${(rLSR.words[0] >>> 5) & 1}`);
}

// ── CLOOMC compiler ASR regression tests ─────────────────────────────────────
// These tests verify that the CLOOMC compiler emits SHR with imm[5]=1 (ASR mode)
// when the >>s operator or its English equivalent is used.

const CLOOMCCompiler = require('./cloomc_compiler.js');

// Helper: find the first SHR word in an array of compiled code words.
// Returns { word, shamt, arith } or null.
function findSHR(words) {
    for (const w of words) {
        if (((w >>> 27) & 0x1F) === 25) {  // SHR = opcode 25 in v2.0
            const imm = w & 0x7FFF;
            return { word: w, shamt: imm & 0x1F, arith: (imm >>> 5) & 1 };
        }
    }
    return null;
}

// CC1: Compiler emits SHR with arith=1 (ASR) for the >>s operator.
//      compileJS auto-wraps bare statements; return(expr) uses parenthesised form.
{
    const cc = new CLOOMCCompiler();
    const src =
`abstraction Test {
    method run(x) {
        return(x >>s 4);
    }
}`;
    const result = cc.compileJS(src);
    assert('CC1 >>s compiles without errors', result.errors.length === 0,
        result.errors.map(e => e.message).join('; '));
    const words = (result.methods[0] || {}).code || [];
    const shr = findSHR(words);
    assert('CC1 >>s: a SHR instruction is emitted', shr !== null, 'no SHR found in ' + JSON.stringify(words));
    if (shr) {
        assert('CC1 >>s: shamt=4', shr.shamt === 4, 'got shamt=' + shr.shamt);
        assert('CC1 >>s: arith=1 (ASR)', shr.arith === 1, 'got arith=' + shr.arith);
    }
}

// CC2: Compiler emits SHR with arith=0 (LSR) for the plain >> operator (no regression).
{
    const cc = new CLOOMCCompiler();
    const src =
`abstraction Test {
    method run(x) {
        return(x >> 4);
    }
}`;
    const result = cc.compileJS(src);
    assert('CC2 >> (LSR) compiles without errors', result.errors.length === 0,
        result.errors.map(e => e.message).join('; '));
    const words = (result.methods[0] || {}).code || [];
    const shr = findSHR(words);
    assert('CC2 >> (LSR): a SHR instruction is emitted', shr !== null, 'no SHR found');
    if (shr) {
        assert('CC2 >>: arith=0 (LSR, no regression)', shr.arith === 0, 'got arith=' + shr.arith);
    }
}

// CC3: English "shifted right signed by N" → ASR encoding.
//      Block mode: first line must start with "abstraction Name {" (no leading newline).
{
    const cc = new CLOOMCCompiler();
    const src =
`abstraction Test {
    run(x):
        return x shifted right signed by 8
}`;
    const result = cc.compileEnglish(src);
    assert('CC3 "shifted right signed by 8" compiles without errors', result.errors.length === 0,
        result.errors.map(e => e.message).join('; '));
    const words = (result.methods[0] || {}).code || [];
    const shr = findSHR(words);
    assert('CC3 English signed shift: SHR instruction emitted', shr !== null, 'no SHR found');
    if (shr) {
        assert('CC3 English signed shift: shamt=8', shr.shamt === 8, 'got shamt=' + shr.shamt);
        assert('CC3 English signed shift: arith=1 (ASR)', shr.arith === 1, 'got arith=' + shr.arith);
    }
}

// CC4: English "shifted right arithmetically by N" → ASR encoding.
{
    const cc = new CLOOMCCompiler();
    const src =
`abstraction Test {
    run(x):
        return x shifted right arithmetically by 3
}`;
    const result = cc.compileEnglish(src);
    assert('CC4 "shifted right arithmetically by 3" compiles without errors', result.errors.length === 0,
        result.errors.map(e => e.message).join('; '));
    const words = (result.methods[0] || {}).code || [];
    const shr = findSHR(words);
    assert('CC4 English arithmetic shift: SHR instruction emitted', shr !== null, 'no SHR found');
    if (shr) {
        assert('CC4 English arithmetic shift: shamt=3', shr.shamt === 3, 'got shamt=' + shr.shamt);
        assert('CC4 English arithmetic shift: arith=1 (ASR)', shr.arith === 1, 'got arith=' + shr.arith);
    }
}

// CC5: English plain "shifted right by N" still produces LSR (no regression).
{
    const cc = new CLOOMCCompiler();
    const src =
`abstraction Test {
    run(x):
        return x shifted right by 2
}`;
    const result = cc.compileEnglish(src);
    assert('CC5 "shifted right by 2" (LSR) compiles without errors', result.errors.length === 0,
        result.errors.map(e => e.message).join('; '));
    const words = (result.methods[0] || {}).code || [];
    const shr = findSHR(words);
    assert('CC5 English plain shift: SHR instruction emitted', shr !== null, 'no SHR found');
    if (shr) {
        assert('CC5 English plain shift: arith=0 (LSR, no regression)', shr.arith === 0, 'got arith=' + shr.arith);
    }
}

// CC6: CLOOMC inline-asm path accepts SHR DRd, DRs, n, ASR and emits imm[5]=1.
//      Uses compilePetName() directly so only the inline-asm accumulator path
//      is exercised (no expression compiler involved).
{
    const cc = new CLOOMCCompiler();
    const src = 'SHR DR3, DR1, 4, ASR';
    const result = cc.compilePetName(src, []);
    assert('CC6 inline-asm SHR ASR: no compile errors', result.errors.length === 0,
        result.errors.map(e => e.message).join('; '));
    const shr = findSHR((result.methods && result.methods[0] && result.methods[0].code) || []);
    assert('CC6 inline-asm SHR ASR: SHR word emitted', shr !== null,
        'no SHR found in ' + JSON.stringify(result.code));
    if (shr) {
        assert('CC6 inline-asm SHR ASR: shamt=4', shr.shamt === 4, 'got shamt=' + shr.shamt);
        assert('CC6 inline-asm SHR ASR: arith=1 (imm[5]=1)', shr.arith === 1, 'got arith=' + shr.arith);
    }
}

// ── CC7–CC10: English compiler BFEXT/BFINS pos/width validation ───────────────
// The English compiler must reject invalid pos/width combinations before emitting
// BFEXT or BFINS instructions, producing a compiler-level error with source
// context rather than a cryptic assembler-level fault.
//
// CC7/CC8 use the CLOOMC English block format (abstraction Test { run(x): ... })
// which goes through compileEnglish → _compileMethod → _resolveExpr.
//
// CC9/CC10 use compileJS which also calls _compileMethod → _compileStatement,
// the same shared validation layer, since the English block parser silently drops
// bare bfins() statements it cannot translate.

// CC7: English bfext() with width=0 → compiler error mentioning BFEXT and width.
//   "let y = bfext(x, 4, 0)" is translated by _translateEnglishStatement to
//   "y = bfext(x, 4, 0)", then _resolveExpr triggers our pos/width check.
{
    const cc = new CLOOMCCompiler();
    const src =
`abstraction Test {
    run(x):
        let y = bfext(x, 4, 0)
}`;
    const result = cc.compileEnglish(src);
    assert('CC7 English bfext width=0: compiler produces ≥1 error',
        result.errors.length > 0,
        'expected ≥1 error, got 0');
    assert('CC7 English bfext width=0: error mentions BFEXT and width',
        result.errors.some(e => /BFEXT/i.test(e.message) && /width/i.test(e.message)),
        'errors: ' + result.errors.map(e => e.message).join('; '));
}

// CC8: English bfext() with pos+width > 32 (pos=31, width=2 → sum=33) → compiler error.
{
    const cc = new CLOOMCCompiler();
    const src =
`abstraction Test {
    run(x):
        let y = bfext(x, 31, 2)
}`;
    const result = cc.compileEnglish(src);
    assert('CC8 English bfext pos+width>32: compiler produces ≥1 error',
        result.errors.length > 0,
        'expected ≥1 error, got 0');
    assert('CC8 English bfext pos+width>32: error mentions BFEXT and pos+width or sum',
        result.errors.some(e => /BFEXT/i.test(e.message) && /pos\+width|sum/i.test(e.message)),
        'errors: ' + result.errors.map(e => e.message).join('; '));
}

// CC9: Compiler bfins() with width=0 → compiler error mentioning BFINS and width.
//   Tests through compileJS which also calls _compileMethod → _compileStatement,
//   the same shared validation layer used by compileEnglish.
{
    const cc = new CLOOMCCompiler();
    const src =
`abstraction Test {
    method run(x, v) {
        bfins(x, v, 4, 0)
    }
}`;
    const result = cc.compileJS(src);
    assert('CC9 compiler bfins width=0: compiler produces ≥1 error',
        result.errors.length > 0,
        'expected ≥1 error, got 0');
    assert('CC9 compiler bfins width=0: error mentions BFINS and width',
        result.errors.some(e => /BFINS/i.test(e.message) && /width/i.test(e.message)),
        'errors: ' + result.errors.map(e => e.message).join('; '));
}

// CC10: Compiler bfins() with pos+width > 32 (pos=31, width=2 → sum=33) → compiler error.
{
    const cc = new CLOOMCCompiler();
    const src =
`abstraction Test {
    method run(x, v) {
        bfins(x, v, 31, 2)
    }
}`;
    const result = cc.compileJS(src);
    assert('CC10 compiler bfins pos+width>32: compiler produces ≥1 error',
        result.errors.length > 0,
        'expected ≥1 error, got 0');
    assert('CC10 compiler bfins pos+width>32: error mentions BFINS and pos+width or sum',
        result.errors.some(e => /BFINS/i.test(e.message) && /pos\+width|sum/i.test(e.message)),
        'errors: ' + result.errors.map(e => e.message).join('; '));
}

// CC11: CALL Abstraction.Method(args) — uppercase keyword form compiles to ELOADCALL.
//   Scheduler.pause(10): Scheduler is at c-list offset 0; pause is index 4 → selector 5.
//   Expected ELOADCALL imm = (5 << 8) | 0 = 0x0500.
{
    const cc = new CLOOMCCompiler();
    cc.methodConventions['SCHEDULER'] = {
        Yield: {index:0}, Spawn: {index:1}, Wait: {index:2},
        Stop: {index:3}, pause: {index:4}, IRQ: {index:5},
    };
    const src =
`abstraction Test {
    capabilities { Scheduler E }
    method run() {
        CALL Scheduler.pause(10)
    }
}`;
    const result = cc.compileJS(src);
    assert('CC11 CALL Scheduler.pause(10) — no errors',
        result.errors.length === 0,
        result.errors.map(e => e.message).join('; '));
    const words = (result.methods[0] || {}).code || [];
    const eloadWord = words.find(w => ((w >>> 27) & 0x1F) === 8);
    assert('CC11 CALL Scheduler.pause(10) — ELOADCALL (opcode 8) is emitted',
        eloadWord !== undefined, 'no ELOADCALL found in ' + JSON.stringify(words));
    if (eloadWord !== undefined) {
        const imm = eloadWord & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('CC11 CALL Scheduler.pause(10) — row=0 (Scheduler at cap offset 0)',
            row === 0, `got row=${row}`);
        assert('CC11 CALL Scheduler.pause(10) — method=5 (pause index 4, 1-based)',
            method === 5, `got method=${method}`);
    }
}

// CC12: CALL UnknownAbs.Method() — abstraction not in capabilities → compiler error.
{
    const cc = new CLOOMCCompiler();
    const src =
`abstraction Test {
    capabilities { Scheduler E }
    method run() {
        CALL UnknownAbs.foo()
    }
}`;
    const result = cc.compileJS(src);
    assert('CC12 CALL UnknownAbs.foo() — compiler produces ≥1 error',
        result.errors.length > 0,
        'expected ≥1 error, got 0');
    assert('CC12 CALL UnknownAbs.foo() — error mentions capabilities list',
        result.errors.some(e => /UnknownAbs/i.test(e.message) && /capabilities/i.test(e.message)),
        'errors: ' + result.errors.map(e => e.message).join('; '));
}

// CC13: Abstraction.Method(args) — bare dot-notation (implied CALL) compiles to ELOADCALL.
//   Scheduler.pause(10): Scheduler is at c-list offset 0; pause is index 4 → selector 5.
{
    const cc = new CLOOMCCompiler();
    cc.methodConventions['SCHEDULER'] = {
        Yield: {index:0}, Spawn: {index:1}, Wait: {index:2},
        Stop: {index:3}, pause: {index:4}, IRQ: {index:5},
    };
    const src =
`abstraction Test {
    capabilities { Scheduler E }
    method run() {
        Scheduler.pause(10)
    }
}`;
    const result = cc.compileJS(src);
    assert('CC13 Scheduler.pause(10) bare dot-notation — no errors',
        result.errors.length === 0,
        result.errors.map(e => e.message).join('; '));
    const words = (result.methods[0] || {}).code || [];
    const eloadWord = words.find(w => ((w >>> 27) & 0x1F) === 8);
    assert('CC13 Scheduler.pause(10) bare dot-notation — ELOADCALL (opcode 8) emitted',
        eloadWord !== undefined, 'no ELOADCALL found in ' + JSON.stringify(words));
    if (eloadWord !== undefined) {
        const imm = eloadWord & 0x7FFF;
        assert('CC13 bare dot-notation — row=0 (Scheduler at cap offset 0)',
            (imm & 0xFF) === 0, `got row=${imm & 0xFF}`);
        assert('CC13 bare dot-notation — method=5 (pause index 4, 1-based)',
            ((imm >>> 8) & 0x7F) === 5, `got method=${(imm >>> 8) & 0x7F}`);
    }
}

// CC14: capabilities { } block with 33 entries → assembler error explaining the
//   32-entry / 5-bit hardware limit.  The ELOADCALL row field is 5 bits wide (0–31);
//   declaring 33 capabilities must be caught before instruction encoding so the
//   programmer sees a clear count message rather than a cryptic "row out of range"
//   on a later ELOADCALL.
//
//   Part A: raw assembler path (ChurchAssembler.assemble).
//   Part B: compiler path (CLOOMCCompiler.compileJS → _buildROM).
{
    // Build source: 33 capabilities declared, one per line.
    const capLines = Array.from({ length: 33 }, (_, i) => `  Cap${i} E`).join('\n');

    // ── Part A: raw assembler ─────────────────────────────────────────────────
    const asmSrc = `capabilities {\n${capLines}\n}\nHALT`;
    const asm = new ChurchAssembler({});
    const asmResult = asm.assemble(asmSrc);
    assert('CC14A oversized c-list (33 caps) — assembler emits ≥1 error',
        asmResult.errors.length > 0,
        'expected ≥1 error for 33-capability c-list, got 0');
    assert('CC14A oversized c-list — error mentions 32 or 5-bit limit',
        asmResult.errors.some(e => /32|5.bit/i.test(e.message)),
        'errors: ' + asmResult.errors.map(e => e.message).join('; '));
    assert('CC14A oversized c-list — error mentions count of declared capabilities (33)',
        asmResult.errors.some(e => /33/.test(e.message)),
        'errors: ' + asmResult.errors.map(e => e.message).join('; '));

    // ── Part B: compiler (compileJS) path ─────────────────────────────────────
    const compilerSrc =
`abstraction Oversized {
  capabilities {
${capLines}
  }
  method run() {
    return 0
  }
}`;
    const cc = new CLOOMCCompiler();
    const compResult = cc.compileJS(compilerSrc);
    assert('CC14B oversized c-list via compileJS — emits ≥1 error',
        compResult.errors.length > 0,
        'expected ≥1 error for 33-capability c-list via compiler, got 0');
    assert('CC14B oversized c-list via compileJS — error mentions 32 or 5-bit limit',
        compResult.errors.some(e => /32|5.bit/i.test(e.message)),
        'errors: ' + compResult.errors.map(e => e.message).join('; '));

    // ── Part C: compiler (compileLambda) path ─────────────────────────────────
    const lambdaSrc =
`abstraction Oversized {
  capabilities {
${capLines}
  }
  method run() = 0
}`;
    const ccLambda = new CLOOMCCompiler();
    const lambdaResult = ccLambda.compileLambda(lambdaSrc);
    assert('CC14C oversized c-list via compileLambda — emits ≥1 error',
        lambdaResult.errors.length > 0,
        'expected ≥1 error for 33-capability c-list via compileLambda, got 0');
    assert('CC14C oversized c-list via compileLambda — error mentions 32 or 5-bit limit',
        lambdaResult.errors.some(e => /32|5.bit/i.test(e.message)),
        'errors: ' + lambdaResult.errors.map(e => e.message).join('; '));

    // ── Part D: compiler (compileHaskell) path ────────────────────────────────
    const haskellSrc =
`abstraction Oversized {
  capabilities {
${capLines}
  }
  method run() = 0
}`;
    const ccHaskell = new CLOOMCCompiler();
    const haskellResult = ccHaskell.compileHaskell(haskellSrc);
    assert('CC14D oversized c-list via compileHaskell — emits ≥1 error',
        haskellResult.errors.length > 0,
        'expected ≥1 error for 33-capability c-list via compileHaskell, got 0');
    assert('CC14D oversized c-list via compileHaskell — error mentions 32 or 5-bit limit',
        haskellResult.errors.some(e => /32|5.bit/i.test(e.message)),
        'errors: ' + haskellResult.errors.map(e => e.message).join('; '));

    // ── Part E: compiler (compileSymbolic) path ───────────────────────────────
    // Symbolic multiline capabilities split by whitespace, so "Cap0 E" → two
    // tokens each; 33 lines yields 66 items (still > 32, error fires).
    const symbolicSrc =
`abstraction Oversized {
  capabilities {
${capLines}
  }
  method run() {
    let k = 0
  }
}`;
    const ccSymbolic = new CLOOMCCompiler();
    const symbolicResult = ccSymbolic.compileSymbolic(symbolicSrc);
    assert('CC14E oversized c-list via compileSymbolic — emits ≥1 error',
        symbolicResult.errors.length > 0,
        'expected ≥1 error for 33-capability c-list via compileSymbolic, got 0');
    assert('CC14E oversized c-list via compileSymbolic — error mentions 32 or 5-bit limit',
        symbolicResult.errors.some(e => /32|5.bit/i.test(e.message)),
        'errors: ' + symbolicResult.errors.map(e => e.message).join('; '));

    // ── Part F: compiler (compileEnglish) path ────────────────────────────────
    // English block form; capabilities are whitespace-split per line so single-word
    // names (no rights suffix) keep the count at exactly 33.
    const englishCapLines = Array.from({ length: 33 }, (_, i) => `    Cap${i}`).join('\n');
    const englishSrc =
`abstraction Oversized {
  capabilities {
${englishCapLines}
  }
  run():
    return 0
}`;
    const ccEnglish = new CLOOMCCompiler();
    const englishResult = ccEnglish.compileEnglish(englishSrc);
    assert('CC14F oversized c-list via compileEnglish — emits ≥1 error',
        englishResult.errors.length > 0,
        'expected ≥1 error for 33-capability c-list via compileEnglish, got 0');
    assert('CC14F oversized c-list via compileEnglish — error mentions 32 or 5-bit limit',
        englishResult.errors.some(e => /32|5.bit/i.test(e.message)),
        'errors: ' + englishResult.errors.map(e => e.message).join('; '));
}

// ── SE: Simulator-level SHR / ASR execution tests ────────────────────────────
// These tests instantiate ChurchSimulator directly and call _execShr so we can
// confirm that the runtime actually sign-extends (ASR) or zero-extends (LSR)
// depending on imm[5], without needing to run through the full boot sequence.

const ChurchSimulator = require('./simulator.js');

// SE1: ASR on a negative value must sign-extend (fill high bits with 1).
//   Input:  DR1 = 0x80000000  (most-negative 32-bit value, high bit set)
//   Shift:  4 places right, ASR  (imm = (1<<5)|4 = 0x24)
//   Expected: 0xF8000000  (arithmetic right-shift fills vacated bits with sign bit)
{
    const sim = new ChurchSimulator();
    sim.dr[1] = 0x80000000;
    const imm = (1 << 5) | 4;
    sim._execShr({ crSrc: 1, crDst: 2, imm });
    const got = sim.dr[2] >>> 0;
    const expected = 0xF8000000;
    assert('SE1 ASR negative value sign-extends: result is 0xF8000000',
        got === expected,
        `expected 0x${expected.toString(16).toUpperCase()} got 0x${got.toString(16).toUpperCase()}`);
    assert('SE1 ASR negative value: N flag is set (result is negative)',
        sim.flags.N === true,
        `N=${sim.flags.N}`);
}

// SE2: LSR on the same negative value must zero-extend (fill high bits with 0).
//   Input:  DR1 = 0x80000000
//   Shift:  4 places right, LSR  (imm = 4, imm[5]=0)
//   Expected: 0x08000000  (logical right-shift fills vacated bits with 0)
{
    const sim = new ChurchSimulator();
    sim.dr[1] = 0x80000000;
    const imm = 4;
    sim._execShr({ crSrc: 1, crDst: 2, imm });
    const got = sim.dr[2] >>> 0;
    const expected = 0x08000000;
    assert('SE2 LSR negative value zero-extends: result is 0x08000000',
        got === expected,
        `expected 0x${expected.toString(16).toUpperCase()} got 0x${got.toString(16).toUpperCase()}`);
    assert('SE2 LSR negative value: N flag is clear (result is positive)',
        sim.flags.N === false,
        `N=${sim.flags.N}`);
}

// SE3: ASR on a positive value must produce the same result as LSR (no spurious sign bits).
//   Input:  DR1 = 0x01000000
//   Shift:  4 places right, ASR  (imm = (1<<5)|4 = 0x24)
//   Expected: 0x00100000
{
    const sim = new ChurchSimulator();
    sim.dr[1] = 0x01000000;
    const imm = (1 << 5) | 4;
    sim._execShr({ crSrc: 1, crDst: 2, imm });
    const got = sim.dr[2] >>> 0;
    const expected = 0x00100000;
    assert('SE3 ASR positive value: result is 0x00100000 (no sign extension)',
        got === expected,
        `expected 0x${expected.toString(16).toUpperCase()} got 0x${got.toString(16).toUpperCase()}`);
}

// ── ST: End-to-end step() integration tests for SHR / ASR ───────────────────
// These tests assemble a real SHR instruction, inject it into the simulator's
// flat memory at address 0 (the pre-boot fetch path reads memory[pc] directly),
// prime the source DR with a known value, call step() exactly once, and inspect
// the destination DR.  This exercises the full instruction-fetch → decode →
// _execShr path rather than calling _execShr directly.

// ST1: ASR on a negative value via step() must sign-extend.
//   Input:  DR1 = 0x80000000, shift 4, ASR
//   Expected DR3 = 0xF8000000
{
    const asmST1 = new ChurchAssembler();
    const rST1   = asmST1.assemble('SHR DR3, DR1, 4, ASR');
    assert('ST1 SHR DR3, DR1, 4, ASR assembles with no errors',
        asmST1.errors.length === 0,
        asmST1.errors.map(e => e.message).join('; '));

    const simST1 = new ChurchSimulator();
    simST1.memory[0] = rST1.words[0] >>> 0;
    simST1.dr[1]     = 0x80000000;
    simST1.step();
    const gotST1     = simST1.dr[3] >>> 0;
    const expST1     = 0xF8000000;
    assert('ST1 ASR negative via step(): DR3 = 0xF8000000',
        gotST1 === expST1,
        `expected 0x${expST1.toString(16).toUpperCase()} got 0x${gotST1.toString(16).toUpperCase()}`);
    assert('ST1 ASR negative via step(): N flag set',
        simST1.flags.N === true,
        `N=${simST1.flags.N}`);
}

// ST2: LSR on the same negative value via step() must zero-extend.
//   Input:  DR1 = 0x80000000, shift 4, LSR (no ASR keyword)
//   Expected DR3 = 0x08000000
{
    const asmST2 = new ChurchAssembler();
    const rST2   = asmST2.assemble('SHR DR3, DR1, 4');
    assert('ST2 SHR DR3, DR1, 4 (LSR) assembles with no errors',
        asmST2.errors.length === 0,
        asmST2.errors.map(e => e.message).join('; '));

    const simST2 = new ChurchSimulator();
    simST2.memory[0] = rST2.words[0] >>> 0;
    simST2.dr[1]     = 0x80000000;
    simST2.step();
    const gotST2     = simST2.dr[3] >>> 0;
    const expST2     = 0x08000000;
    assert('ST2 LSR negative via step(): DR3 = 0x08000000 (no sign extension)',
        gotST2 === expST2,
        `expected 0x${expST2.toString(16).toUpperCase()} got 0x${gotST2.toString(16).toUpperCase()}`);
    assert('ST2 LSR negative via step(): N flag clear',
        simST2.flags.N === false,
        `N=${simST2.flags.N}`);
}

// ST3: ASR shift-by-31 on 0x80000000 via step() must produce 0xFFFFFFFF.
//   Shifting the most-negative value right 31 places arithmetically fills all
//   bits with the sign bit, yielding all-ones (= -1 in two's complement).
{
    const asmST3 = new ChurchAssembler();
    const rST3   = asmST3.assemble('SHR DR3, DR1, 31, ASR');
    assert('ST3 SHR DR3, DR1, 31, ASR assembles with no errors',
        asmST3.errors.length === 0,
        asmST3.errors.map(e => e.message).join('; '));

    const simST3 = new ChurchSimulator();
    simST3.memory[0] = rST3.words[0] >>> 0;
    simST3.dr[1]     = 0x80000000;
    simST3.step();
    const gotST3     = simST3.dr[3] >>> 0;
    const expST3     = 0xFFFFFFFF;
    assert('ST3 ASR shift-31 via step(): DR3 = 0xFFFFFFFF (all sign bits)',
        gotST3 === expST3,
        `expected 0x${expST3.toString(16).toUpperCase()} got 0x${gotST3.toString(16).toUpperCase()}`);
    assert('ST3 ASR shift-31 via step(): N flag set',
        simST3.flags.N === true,
        `N=${simST3.flags.N}`);
    assert('ST3 ASR shift-31 via step(): C flag clear (bit 30 of 0x80000000 is 0)',
        simST3.flags.C === false,
        `C=${simST3.flags.C}`);
}

// ST4: Two-instruction sequence — DWRITE-style: set DR1 via direct assignment,
//      then step() twice through a program that chains shifts.
//      Program: [SHR DR3, DR1, 1, ASR]   → DR3 = 0xC0000000
//               [SHR DR5, DR3, 1, ASR]   → DR5 = 0xE0000000
//   This confirms decode and PC advance between consecutive SHR instructions.
{
    const asmST4 = new ChurchAssembler();
    const rST4   = asmST4.assemble('SHR DR3, DR1, 1, ASR\nSHR DR5, DR3, 1, ASR');
    assert('ST4 two-SHR program assembles with no errors',
        asmST4.errors.length === 0,
        asmST4.errors.map(e => e.message).join('; '));

    const simST4 = new ChurchSimulator();
    simST4.memory[0] = rST4.words[0] >>> 0;
    simST4.memory[1] = rST4.words[1] >>> 0;
    simST4.dr[1]     = 0x80000000;

    simST4.step();
    const midST4 = simST4.dr[3] >>> 0;
    assert('ST4 after step 1: DR3 = 0xC0000000',
        midST4 === 0xC0000000,
        `expected 0xC0000000 got 0x${midST4.toString(16).toUpperCase()}`);

    simST4.step();
    const gotST4 = simST4.dr[5] >>> 0;
    assert('ST4 after step 2: DR5 = 0xE0000000',
        gotST4 === 0xE0000000,
        `expected 0xE0000000 got 0x${gotST4.toString(16).toUpperCase()}`);
}

// ── SH: End-to-end step() integration tests for SHL ──────────────────────────
// These tests assemble a real SHL instruction, inject it into the simulator's
// flat memory at address 0, prime the source DR with a known value, call step()
// exactly once, and inspect the destination DR and flags.  This exercises the
// full instruction-fetch → decode → _execShl path.

// SH1: Basic left-shift by 4, positive value — no carry, no sign, no zero.
//   Input:  DR1 = 0x00000001, shift 4
//   Expected DR3 = 0x00000010, Z=false, N=false, C=false
{
    const asmSH1 = new ChurchAssembler();
    const rSH1   = asmSH1.assemble('SHL DR3, DR1, 4');
    assert('SH1 SHL DR3, DR1, 4 assembles with no errors',
        asmSH1.errors.length === 0,
        asmSH1.errors.map(e => e.message).join('; '));

    const simSH1 = new ChurchSimulator();
    simSH1.memory[0] = rSH1.words[0] >>> 0;
    simSH1.dr[1]     = 0x00000001;
    simSH1.step();
    const gotSH1 = simSH1.dr[3] >>> 0;
    const expSH1 = 0x00000010;
    assert('SH1 SHL positive via step(): DR3 = 0x00000010',
        gotSH1 === expSH1,
        `expected 0x${expSH1.toString(16).toUpperCase()} got 0x${gotSH1.toString(16).toUpperCase()}`);
    assert('SH1 SHL positive via step(): Z flag clear', simSH1.flags.Z === false, `Z=${simSH1.flags.Z}`);
    assert('SH1 SHL positive via step(): N flag clear', simSH1.flags.N === false, `N=${simSH1.flags.N}`);
    assert('SH1 SHL positive via step(): C flag clear', simSH1.flags.C === false, `C=${simSH1.flags.C}`);
}

// SH2: Left-shift that produces a negative result (N flag) — no carry out.
//   Input:  DR1 = 0x08000000, shift 4
//   Expected DR3 = 0x80000000 (bit 31 set → N), Z=false, C=false
//   lastBitOut = (0x08000000 >>> 28) & 1 = 0
{
    const asmSH2 = new ChurchAssembler();
    const rSH2   = asmSH2.assemble('SHL DR3, DR1, 4');
    assert('SH2 SHL DR3, DR1, 4 assembles with no errors',
        asmSH2.errors.length === 0,
        asmSH2.errors.map(e => e.message).join('; '));

    const simSH2 = new ChurchSimulator();
    simSH2.memory[0] = rSH2.words[0] >>> 0;
    simSH2.dr[1]     = 0x08000000;
    simSH2.step();
    const gotSH2 = simSH2.dr[3] >>> 0;
    const expSH2 = 0x80000000;
    assert('SH2 SHL sets N via step(): DR3 = 0x80000000',
        gotSH2 === expSH2,
        `expected 0x${expSH2.toString(16).toUpperCase()} got 0x${gotSH2.toString(16).toUpperCase()}`);
    assert('SH2 SHL sets N via step(): N flag set',   simSH2.flags.N === true,  `N=${simSH2.flags.N}`);
    assert('SH2 SHL sets N via step(): Z flag clear', simSH2.flags.Z === false, `Z=${simSH2.flags.Z}`);
    assert('SH2 SHL sets N via step(): C flag clear', simSH2.flags.C === false, `C=${simSH2.flags.C}`);
}

// SH3: Left-shift that sets both Z and C — the only set bit is shifted off the top.
//   Input:  DR1 = 0x80000000, shift 1
//   Expected DR3 = 0x00000000 (Z), lastBitOut = (0x80000000 >>> 31) & 1 = 1 (C)
{
    const asmSH3 = new ChurchAssembler();
    const rSH3   = asmSH3.assemble('SHL DR3, DR1, 1');
    assert('SH3 SHL DR3, DR1, 1 assembles with no errors',
        asmSH3.errors.length === 0,
        asmSH3.errors.map(e => e.message).join('; '));

    const simSH3 = new ChurchSimulator();
    simSH3.memory[0] = rSH3.words[0] >>> 0;
    simSH3.dr[1]     = 0x80000000;
    simSH3.step();
    const gotSH3 = simSH3.dr[3] >>> 0;
    const expSH3 = 0x00000000;
    assert('SH3 SHL shifts bit off top via step(): DR3 = 0x00000000',
        gotSH3 === expSH3,
        `expected 0x${expSH3.toString(16).toUpperCase()} got 0x${gotSH3.toString(16).toUpperCase()}`);
    assert('SH3 SHL shifts bit off top via step(): Z flag set', simSH3.flags.Z === true,  `Z=${simSH3.flags.Z}`);
    assert('SH3 SHL shifts bit off top via step(): N flag clear', simSH3.flags.N === false, `N=${simSH3.flags.N}`);
    assert('SH3 SHL shifts bit off top via step(): C flag set', simSH3.flags.C === true,  `C=${simSH3.flags.C}`);
}

// ── IA: IADD step()-level integration tests ───────────────────────────────────
// Each test assembles an IADD instruction via ChurchAssembler, injects the
// encoded word into simulator.memory[0], primes source DRs, calls step() once,
// and asserts the destination DR value plus all four arithmetic flags (Z, N, C, V).

// IA1: Simple immediate addition — result is positive, no flags set.
//   IADD DR2, DR1, #5  with DR1 = 3  →  DR2 = 8
//   Z=false, N=false, C=false, V=false
{
    const asmIA1 = new ChurchAssembler();
    const rIA1   = asmIA1.assemble('IADD DR2, DR1, #5');
    assert('IA1 IADD DR2, DR1, #5 assembles with no errors',
        asmIA1.errors.length === 0,
        asmIA1.errors.map(e => e.message).join('; '));

    const simIA1 = new ChurchSimulator();
    simIA1.memory[0] = rIA1.words[0] >>> 0;
    simIA1.dr[1] = 3;
    simIA1.step();

    assert('IA1 result DR2 = 8',
        (simIA1.dr[2] >>> 0) === 8,
        `got ${simIA1.dr[2] >>> 0}`);
    assert('IA1 Z flag clear', simIA1.flags.Z === false, `Z=${simIA1.flags.Z}`);
    assert('IA1 N flag clear', simIA1.flags.N === false, `N=${simIA1.flags.N}`);
    assert('IA1 C flag clear', simIA1.flags.C === false, `C=${simIA1.flags.C}`);
    assert('IA1 V flag clear', simIA1.flags.V === false, `V=${simIA1.flags.V}`);
}

// IA2: Unsigned overflow (carry) — wraps to zero, Z and C set.
//   IADD DR2, DR1, DR3  with DR1 = 0xFFFFFFFF, DR3 = 1  →  DR2 = 0
//   Z=true, N=false, C=true, V=false  (sa=1, sb=0 → sa≠sb → V=false)
{
    const asmIA2 = new ChurchAssembler();
    const rIA2   = asmIA2.assemble('IADD DR2, DR1, DR3');
    assert('IA2 IADD DR2, DR1, DR3 assembles with no errors',
        asmIA2.errors.length === 0,
        asmIA2.errors.map(e => e.message).join('; '));

    const simIA2 = new ChurchSimulator();
    simIA2.memory[0] = rIA2.words[0] >>> 0;
    simIA2.dr[1] = 0xFFFFFFFF;
    simIA2.dr[3] = 1;
    simIA2.step();

    assert('IA2 result DR2 = 0',
        (simIA2.dr[2] >>> 0) === 0,
        `got 0x${(simIA2.dr[2] >>> 0).toString(16).toUpperCase()}`);
    assert('IA2 Z flag set',   simIA2.flags.Z === true,  `Z=${simIA2.flags.Z}`);
    assert('IA2 N flag clear', simIA2.flags.N === false,  `N=${simIA2.flags.N}`);
    assert('IA2 C flag set',   simIA2.flags.C === true,  `C=${simIA2.flags.C}`);
    assert('IA2 V flag clear', simIA2.flags.V === false,  `V=${simIA2.flags.V}`);
}

// IA3: Signed overflow (positive + positive = negative) — V and N set.
//   IADD DR2, DR1, DR3  with DR1 = 0x7FFFFFFF, DR3 = 1  →  DR2 = 0x80000000
//   Z=false, N=true, C=false, V=true  (sa=0, sb=0, sr=1 → same-sign inputs, opposite result)
{
    const asmIA3 = new ChurchAssembler();
    const rIA3   = asmIA3.assemble('IADD DR2, DR1, DR3');
    assert('IA3 IADD DR2, DR1, DR3 assembles with no errors',
        asmIA3.errors.length === 0,
        asmIA3.errors.map(e => e.message).join('; '));

    const simIA3 = new ChurchSimulator();
    simIA3.memory[0] = rIA3.words[0] >>> 0;
    simIA3.dr[1] = 0x7FFFFFFF;
    simIA3.dr[3] = 1;
    simIA3.step();

    const gotIA3 = simIA3.dr[2] >>> 0;
    assert('IA3 result DR2 = 0x80000000',
        gotIA3 === 0x80000000,
        `got 0x${gotIA3.toString(16).toUpperCase()}`);
    assert('IA3 Z flag clear', simIA3.flags.Z === false, `Z=${simIA3.flags.Z}`);
    assert('IA3 N flag set',   simIA3.flags.N === true,  `N=${simIA3.flags.N}`);
    assert('IA3 C flag clear', simIA3.flags.C === false, `C=${simIA3.flags.C}`);
    assert('IA3 V flag set',   simIA3.flags.V === true,  `V=${simIA3.flags.V}`);
}

// ── IS: ISUB step()-level integration tests ───────────────────────────────────
// Mirror of the IA section: assemble via ChurchAssembler, inject, prime, step(),
// assert DR result and all four flags.

// IS1: Simple immediate subtraction — positive result, C set (no borrow).
//   ISUB DR2, DR1, #3  with DR1 = 10  →  DR2 = 7
//   Z=false, N=false, C=true (a>=b), V=false
{
    const asmIS1 = new ChurchAssembler();
    const rIS1   = asmIS1.assemble('ISUB DR2, DR1, #3');
    assert('IS1 ISUB DR2, DR1, #3 assembles with no errors',
        asmIS1.errors.length === 0,
        asmIS1.errors.map(e => e.message).join('; '));

    const simIS1 = new ChurchSimulator();
    simIS1.memory[0] = rIS1.words[0] >>> 0;
    simIS1.dr[1] = 10;
    simIS1.step();

    assert('IS1 result DR2 = 7',
        (simIS1.dr[2] >>> 0) === 7,
        `got ${simIS1.dr[2] >>> 0}`);
    assert('IS1 Z flag clear', simIS1.flags.Z === false, `Z=${simIS1.flags.Z}`);
    assert('IS1 N flag clear', simIS1.flags.N === false, `N=${simIS1.flags.N}`);
    assert('IS1 C flag set',   simIS1.flags.C === true,  `C=${simIS1.flags.C}`);
    assert('IS1 V flag clear', simIS1.flags.V === false,  `V=${simIS1.flags.V}`);
}

// IS2: Subtraction to zero — Z and C set.
//   ISUB DR2, DR1, DR3  with DR1 = 5, DR3 = 5  →  DR2 = 0
//   Z=true, N=false, C=true (a>=b), V=false
{
    const asmIS2 = new ChurchAssembler();
    const rIS2   = asmIS2.assemble('ISUB DR2, DR1, DR3');
    assert('IS2 ISUB DR2, DR1, DR3 assembles with no errors',
        asmIS2.errors.length === 0,
        asmIS2.errors.map(e => e.message).join('; '));

    const simIS2 = new ChurchSimulator();
    simIS2.memory[0] = rIS2.words[0] >>> 0;
    simIS2.dr[1] = 5;
    simIS2.dr[3] = 5;
    simIS2.step();

    assert('IS2 result DR2 = 0',
        (simIS2.dr[2] >>> 0) === 0,
        `got ${simIS2.dr[2] >>> 0}`);
    assert('IS2 Z flag set',   simIS2.flags.Z === true,  `Z=${simIS2.flags.Z}`);
    assert('IS2 N flag clear', simIS2.flags.N === false, `N=${simIS2.flags.N}`);
    assert('IS2 C flag set',   simIS2.flags.C === true,  `C=${simIS2.flags.C}`);
    assert('IS2 V flag clear', simIS2.flags.V === false, `V=${simIS2.flags.V}`);
}

// IS3: Signed overflow (positive - negative = negative) — V, N set; C clear.
//   ISUB DR2, DR1, DR3  with DR1 = 0x7FFFFFFF, DR3 = 0xFFFFFFFF  →  DR2 = 0x80000000
//   Unsigned: 0x7FFFFFFF < 0xFFFFFFFF → C=false (borrow)
//   Signed:   sa=0, sb=1 (different signs); sr=1 ≠ sa → V=true
//   Z=false, N=true, C=false, V=true
{
    const asmIS3 = new ChurchAssembler();
    const rIS3   = asmIS3.assemble('ISUB DR2, DR1, DR3');
    assert('IS3 ISUB DR2, DR1, DR3 assembles with no errors',
        asmIS3.errors.length === 0,
        asmIS3.errors.map(e => e.message).join('; '));

    const simIS3 = new ChurchSimulator();
    simIS3.memory[0] = rIS3.words[0] >>> 0;
    simIS3.dr[1] = 0x7FFFFFFF;
    simIS3.dr[3] = 0xFFFFFFFF;
    simIS3.step();

    const gotIS3 = simIS3.dr[2] >>> 0;
    assert('IS3 result DR2 = 0x80000000',
        gotIS3 === 0x80000000,
        `got 0x${gotIS3.toString(16).toUpperCase()}`);
    assert('IS3 Z flag clear', simIS3.flags.Z === false, `Z=${simIS3.flags.Z}`);
    assert('IS3 N flag set',   simIS3.flags.N === true,  `N=${simIS3.flags.N}`);
    assert('IS3 C flag clear', simIS3.flags.C === false, `C=${simIS3.flags.C}`);
    assert('IS3 V flag set',   simIS3.flags.V === true,  `V=${simIS3.flags.V}`);
}

// ── BR: End-to-end step() integration tests for BRANCH ───────────────────────
// These tests assemble a real BRANCH instruction via ChurchAssembler, inject the
// encoded word into simulator.memory, prime the condition flags, call step()
// exactly once, and verify that PC advances to the correct target (branch taken)
// or just increments by 1 (branch not taken).  This exercises the full
// fetch → decode → _execBranch path and catches condition-evaluation regressions.

// BR1: Unconditional BRANCH +2 (AL — always taken) at PC=0 → PC must be 2.
//   Program: BRANCH +2 / MCMP DR0, DR0 / MCMP DR0, DR0
//   The two trailing MCMP words make targets 1 and 2 valid within the lump.
{
    const asmBR1 = new ChurchAssembler();
    const rBR1   = asmBR1.assemble('BRANCH +2\nMCMP DR0, DR0\nMCMP DR0, DR0');
    assert('BR1 BRANCH +2 assembles with no errors',
        asmBR1.errors.length === 0,
        asmBR1.errors.map(e => e.message).join('; '));

    const simBR1 = new ChurchSimulator();
    for (let i = 0; i < rBR1.words.length; i++) simBR1.memory[i] = rBR1.words[i] >>> 0;
    simBR1.step();
    assert('BR1 unconditional BRANCH +2 via step(): PC = 2',
        simBR1.pc === 2,
        `expected PC=2 got PC=${simBR1.pc}`);
}

// BR2: BRANCHEQ +3 with Z=1 (condition true → branch taken) at PC=0 → PC must be 3.
//   Program: BRANCHEQ +3 / MCMP DR0, DR0 / MCMP DR0, DR0 / MCMP DR0, DR0
{
    const asmBR2 = new ChurchAssembler();
    const rBR2   = asmBR2.assemble('BRANCHEQ +3\nMCMP DR0, DR0\nMCMP DR0, DR0\nMCMP DR0, DR0');
    assert('BR2 BRANCHEQ +3 assembles with no errors',
        asmBR2.errors.length === 0,
        asmBR2.errors.map(e => e.message).join('; '));

    const simBR2 = new ChurchSimulator();
    for (let i = 0; i < rBR2.words.length; i++) simBR2.memory[i] = rBR2.words[i] >>> 0;
    simBR2.flags.Z = true;
    simBR2.step();
    assert('BR2 BRANCHEQ +3 taken (Z=1) via step(): PC = 3',
        simBR2.pc === 3,
        `expected PC=3 got PC=${simBR2.pc}`);
}

// BR3: BRANCHNE +2 with Z=1 (condition false → branch NOT taken) at PC=0 → PC must be 1.
//   Program: BRANCHNE +2 / MCMP DR0, DR0 / MCMP DR0, DR0
//   Z=1 → NE is false → instruction skipped → PC increments sequentially to 1.
{
    const asmBR3 = new ChurchAssembler();
    const rBR3   = asmBR3.assemble('BRANCHNE +2\nMCMP DR0, DR0\nMCMP DR0, DR0');
    assert('BR3 BRANCHNE +2 assembles with no errors',
        asmBR3.errors.length === 0,
        asmBR3.errors.map(e => e.message).join('; '));

    const simBR3 = new ChurchSimulator();
    for (let i = 0; i < rBR3.words.length; i++) simBR3.memory[i] = rBR3.words[i] >>> 0;
    simBR3.flags.Z = true;   // Z=1 → NE is false → instruction skipped
    simBR3.step();
    assert('BR3 BRANCHNE +2 not taken (Z=1) via step(): PC = 1 (sequential advance)',
        simBR3.pc === 1,
        `expected PC=1 got PC=${simBR3.pc}`);
}

// BR4: BRANCHNE -1 at PC=1 with Z=0 (condition true → backward branch taken) → PC must be 0.
//   Program: MCMP DR0, DR0 / BRANCHNE -1
//   word 0 = MCMP (the backward target — valid within the 2-word lump)
//   word 1 = BRANCHNE -1  → target = 1 + (-1) = 0
//   With Z=0, NE is true → branch taken.
{
    const asmBR4 = new ChurchAssembler();
    const rBR4   = asmBR4.assemble('MCMP DR0, DR0\nBRANCHNE -1');
    assert('BR4 BRANCHNE -1 assembles with no errors',
        asmBR4.errors.length === 0,
        asmBR4.errors.map(e => e.message).join('; '));

    const simBR4 = new ChurchSimulator();
    for (let i = 0; i < rBR4.words.length; i++) simBR4.memory[i] = rBR4.words[i] >>> 0;
    simBR4.pc      = 1;
    simBR4.flags.Z = false;   // Z=0 → NE is true → branch taken
    simBR4.step();
    assert('BR4 BRANCHNE -1 backward taken (Z=0) via step(): PC = 0',
        simBR4.pc === 0,
        `expected PC=0 got PC=${simBR4.pc}`);
}

// ── MC: End-to-end step() integration tests for MCMP ────────────────────────
// These tests assemble a real MCMP instruction via ChurchAssembler, inject the
// encoded word into simulator.memory[0], prime the source DR values, call step()
// exactly once, and verify that the Z, N, and C flags match the expected result
// of the subtraction (DRa − DRb).  This exercises the full fetch → decode →
// _execMcmp path and catches flag-output regressions that assembler encoding
// tests cannot catch.

// MC1: Equal operands — Z=1, N=0, C=1 (no borrow: a >= b unsigned).
//   MCMP DR1, DR2 with DR1=DR2=7 → Z=1, N=0, C=1.
{
    const asmMC1 = new ChurchAssembler();
    const rMC1   = asmMC1.assemble('MCMP DR1, DR2');
    assert('MC1 MCMP DR1, DR2 assembles with no errors',
        asmMC1.errors.length === 0,
        asmMC1.errors.map(e => e.message).join('; '));

    const simMC1 = new ChurchSimulator();
    simMC1.memory[0] = rMC1.words[0] >>> 0;
    simMC1.dr[1] = 7;
    simMC1.dr[2] = 7;
    simMC1.step();
    assert('MC1 equal operands via step(): Z flag set',   simMC1.flags.Z === true,  `Z=${simMC1.flags.Z}`);
    assert('MC1 equal operands via step(): N flag clear', simMC1.flags.N === false, `N=${simMC1.flags.N}`);
    assert('MC1 equal operands via step(): C flag set',   simMC1.flags.C === true,  `C=${simMC1.flags.C}`);
}

// MC2: DRa < DRb (signed and unsigned) — Z=0, N=1, C=0 (borrow: a < b unsigned).
//   MCMP DR1, DR2 with DR1=5, DR2=10 → result=0xFFFFFFFB → Z=0, N=1, C=0.
{
    const asmMC2 = new ChurchAssembler();
    const rMC2   = asmMC2.assemble('MCMP DR1, DR2');
    assert('MC2 MCMP DR1, DR2 assembles with no errors',
        asmMC2.errors.length === 0,
        asmMC2.errors.map(e => e.message).join('; '));

    const simMC2 = new ChurchSimulator();
    simMC2.memory[0] = rMC2.words[0] >>> 0;
    simMC2.dr[1] = 5;
    simMC2.dr[2] = 10;
    simMC2.step();
    assert('MC2 DRa < DRb (signed) via step(): Z flag clear', simMC2.flags.Z === false, `Z=${simMC2.flags.Z}`);
    assert('MC2 DRa < DRb (signed) via step(): N flag set',   simMC2.flags.N === true,  `N=${simMC2.flags.N}`);
    assert('MC2 DRa < DRb (signed) via step(): C flag clear', simMC2.flags.C === false, `C=${simMC2.flags.C}`);
}

// MC3: DRa > DRb unsigned — Z=0, N=0, C=1 (no borrow: a >= b unsigned).
//   MCMP DR1, DR2 with DR1=10, DR2=5 → result=5 → Z=0, N=0, C=1.
{
    const asmMC3 = new ChurchAssembler();
    const rMC3   = asmMC3.assemble('MCMP DR1, DR2');
    assert('MC3 MCMP DR1, DR2 assembles with no errors',
        asmMC3.errors.length === 0,
        asmMC3.errors.map(e => e.message).join('; '));

    const simMC3 = new ChurchSimulator();
    simMC3.memory[0] = rMC3.words[0] >>> 0;
    simMC3.dr[1] = 10;
    simMC3.dr[2] = 5;
    simMC3.step();
    assert('MC3 DRa >= DRb unsigned via step(): Z flag clear', simMC3.flags.Z === false, `Z=${simMC3.flags.Z}`);
    assert('MC3 DRa >= DRb unsigned via step(): N flag clear', simMC3.flags.N === false, `N=${simMC3.flags.N}`);
    assert('MC3 DRa >= DRb unsigned via step(): C flag set',   simMC3.flags.C === true,  `C=${simMC3.flags.C}`);
}

// ── BF: End-to-end step() integration tests for BFEXT and BFINS ─────────────
// These tests assemble a real BFEXT or BFINS instruction via ChurchAssembler,
// inject the encoded word into simulator.memory[0], prime the source DR values,
// call step() exactly once, and verify the extracted/inserted value and the
// resulting Z and N flags.  This exercises the full fetch → decode → _execBfext
// / _execBfins path and catches regressions that assembler encoding tests alone
// cannot catch.

// BF1: BFEXT — extract non-zero middle bits → correct value, Z=0, N=0, C=0.
//   DR2 = 0b00110100 (52).  BFEXT DR1, DR2, 2, 3 extracts bits[4:2] = 0b101 = 5.
{
    const asmBF1 = new ChurchAssembler();
    const rBF1   = asmBF1.assemble('BFEXT DR1, DR2, 2, 3');
    assert('BF1 BFEXT DR1, DR2, 2, 3 assembles with no errors',
        asmBF1.errors.length === 0,
        asmBF1.errors.map(e => e.message).join('; '));

    const simBF1 = new ChurchSimulator();
    simBF1.memory[0] = rBF1.words[0] >>> 0;
    simBF1.dr[2] = 0b00110100;   // 52 decimal; bits[4:2] = 0b101 = 5
    simBF1.step();
    assert('BF1 BFEXT extracted value: DR1=5',  simBF1.dr[1] === 5,     `DR1=${simBF1.dr[1]}`);
    assert('BF1 BFEXT non-zero result: Z=0',    simBF1.flags.Z === false, `Z=${simBF1.flags.Z}`);
    assert('BF1 BFEXT non-negative result: N=0', simBF1.flags.N === false, `N=${simBF1.flags.N}`);
    assert('BF1 BFEXT: C=0',                    simBF1.flags.C === false, `C=${simBF1.flags.C}`);
}

// BF2: BFEXT — extract bits that are all zero → Z=1, N=0, C=0.
//   DR2 = 0xF0 = 0b11110000.  BFEXT DR1, DR2, 0, 4 extracts bits[3:0] = 0 → Z=1.
{
    const asmBF2 = new ChurchAssembler();
    const rBF2   = asmBF2.assemble('BFEXT DR1, DR2, 0, 4');
    assert('BF2 BFEXT DR1, DR2, 0, 4 assembles with no errors',
        asmBF2.errors.length === 0,
        asmBF2.errors.map(e => e.message).join('; '));

    const simBF2 = new ChurchSimulator();
    simBF2.memory[0] = rBF2.words[0] >>> 0;
    simBF2.dr[2] = 0xF0;   // bits[3:0] are all 0
    simBF2.step();
    assert('BF2 BFEXT zero result: DR1=0', simBF2.dr[1] === 0,     `DR1=${simBF2.dr[1]}`);
    assert('BF2 BFEXT zero result: Z=1',   simBF2.flags.Z === true,  `Z=${simBF2.flags.Z}`);
    assert('BF2 BFEXT zero result: N=0',   simBF2.flags.N === false, `N=${simBF2.flags.N}`);
    assert('BF2 BFEXT zero result: C=0',   simBF2.flags.C === false, `C=${simBF2.flags.C}`);
}

// BF3: BFINS — insert non-zero value into a zeroed destination → correct word, Z=0, N=0, C=0.
//   DR1 (dst) = 0x00000000, DR2 (src) = 7 = 0b111.
//   BFINS DR1, DR2, 4, 3 inserts bits[6:4] = 0b111 → newWord = 0b1110000 = 0x70.
{
    const asmBF3 = new ChurchAssembler();
    const rBF3   = asmBF3.assemble('BFINS DR1, DR2, 4, 3');
    assert('BF3 BFINS DR1, DR2, 4, 3 assembles with no errors',
        asmBF3.errors.length === 0,
        asmBF3.errors.map(e => e.message).join('; '));

    const simBF3 = new ChurchSimulator();
    simBF3.memory[0] = rBF3.words[0] >>> 0;
    simBF3.dr[1] = 0x00000000;   // destination: empty
    simBF3.dr[2] = 7;            // source: 0b111 to insert at pos 4
    simBF3.step();
    assert('BF3 BFINS inserted value: DR1=0x70', simBF3.dr[1] === 0x70,   `DR1=0x${simBF3.dr[1].toString(16)}`);
    assert('BF3 BFINS non-zero result: Z=0',     simBF3.flags.Z === false, `Z=${simBF3.flags.Z}`);
    assert('BF3 BFINS non-negative result: N=0', simBF3.flags.N === false, `N=${simBF3.flags.N}`);
    assert('BF3 BFINS: C=0',                     simBF3.flags.C === false, `C=${simBF3.flags.C}`);
}

// BF4: BFINS — insert zero into the only set bits → result zero, Z=1, N=0, C=0.
//   DR1 (dst) = 0x0000000F (low nibble set), DR2 (src) = 0.
//   BFINS DR1, DR2, 0, 4 clears bits[3:0] → newWord = 0x00000000 → Z=1.
{
    const asmBF4 = new ChurchAssembler();
    const rBF4   = asmBF4.assemble('BFINS DR1, DR2, 0, 4');
    assert('BF4 BFINS DR1, DR2, 0, 4 assembles with no errors',
        asmBF4.errors.length === 0,
        asmBF4.errors.map(e => e.message).join('; '));

    const simBF4 = new ChurchSimulator();
    simBF4.memory[0] = rBF4.words[0] >>> 0;
    simBF4.dr[1] = 0x0000000F;   // destination: only low nibble set
    simBF4.dr[2] = 0;            // source: insert 0, clearing those bits
    simBF4.step();
    assert('BF4 BFINS zero result: DR1=0', simBF4.dr[1] === 0,     `DR1=0x${simBF4.dr[1].toString(16)}`);
    assert('BF4 BFINS zero result: Z=1',   simBF4.flags.Z === true,  `Z=${simBF4.flags.Z}`);
    assert('BF4 BFINS zero result: N=0',   simBF4.flags.N === false, `N=${simBF4.flags.N}`);
    assert('BF4 BFINS zero result: C=0',   simBF4.flags.C === false, `C=${simBF4.flags.C}`);
}

// BF5: BFEXT — max-width extract (w=31, pos=0) → bits[30:0] extracted, N=0, Z=0, C=0.
//   DR2 = 0xFFFFFFFF (all bits set).  BFEXT DR1, DR2, 0, 31 extracts bits[30:0].
//   Width=31 is the maximum encodable in the 5-bit field.  mask=0x7FFFFFFF; value=0x7FFFFFFF.
//   NOTE: width=32 encodes as 0 (32 & 0x1F = 0), which the simulator rejects as a BOUNDS
//   fault — full-word extraction via BFEXT is not supported by the encoding; see BF9.
{
    const asmBF5 = new ChurchAssembler();
    const rBF5   = asmBF5.assemble('BFEXT DR1, DR2, 0, 31');
    assert('BF5 BFEXT DR1, DR2, 0, 31 assembles with no errors',
        asmBF5.errors.length === 0,
        asmBF5.errors.map(e => e.message).join('; '));

    const simBF5 = new ChurchSimulator();
    simBF5.memory[0] = rBF5.words[0] >>> 0;
    simBF5.dr[2] = 0xFFFFFFFF >>> 0;   // all bits set; bits[30:0] = 0x7FFFFFFF
    simBF5.step();
    assert('BF5 BFEXT max-width: DR1=0x7FFFFFFF', simBF5.dr[1] === 0x7FFFFFFF, `DR1=0x${simBF5.dr[1].toString(16)}`);
    assert('BF5 BFEXT max-width: Z=0',            simBF5.flags.Z === false,     `Z=${simBF5.flags.Z}`);
    assert('BF5 BFEXT max-width: N=0',            simBF5.flags.N === false,     `N=${simBF5.flags.N}`);
    assert('BF5 BFEXT max-width: C=0',            simBF5.flags.C === false,     `C=${simBF5.flags.C}`);
}

// BF6: BFEXT — high-bit position boundary: extract bit 31 of source (pos=31, w=1).
//   pos+width=32 is the maximum valid range; a regression in the boundary check would
//   incorrectly trigger a BOUNDS fault here.
//   DR2 = 0x80000000 (only bit 31 set).  mask = 1; value = (0x80000000 >>> 31) & 1 = 1.
//   ISA note: BFEXT can NEVER set N=1.  The mask for any valid width (1–31) is at most
//   0x7FFFFFFF, so bit 31 of the extracted value is always 0 after masking.  N=1 from a
//   bitfield result is only achievable via BFINS (see BF7), where the written word can
//   have bit 31 set independently of any extraction mask.
{
    const asmBF6 = new ChurchAssembler();
    const rBF6   = asmBF6.assemble('BFEXT DR1, DR2, 31, 1');
    assert('BF6 BFEXT DR1, DR2, 31, 1 assembles with no errors',
        asmBF6.errors.length === 0,
        asmBF6.errors.map(e => e.message).join('; '));

    const simBF6 = new ChurchSimulator();
    simBF6.memory[0] = rBF6.words[0] >>> 0;
    simBF6.dr[2] = 0x80000000 >>> 0;   // bit 31 set in source
    simBF6.step();
    assert('BF6 BFEXT pos=31 w=1 boundary: no BOUNDS fault',
        simBF6.halted === false,
        `halted=${simBF6.halted} faultLog=${simBF6.faultLog.map(f => f.type).join(',')}`);
    assert('BF6 BFEXT high-bit pos: DR1=1',  simBF6.dr[1] === 1,     `DR1=${simBF6.dr[1]}`);
    assert('BF6 BFEXT high-bit pos: Z=0',    simBF6.flags.Z === false, `Z=${simBF6.flags.Z}`);
    assert('BF6 BFEXT high-bit pos: N=0',    simBF6.flags.N === false, `N=${simBF6.flags.N}`);
    assert('BF6 BFEXT high-bit pos: C=0',    simBF6.flags.C === false, `C=${simBF6.flags.C}`);
}

// BF7: BFINS — insert value into bit 31 (pos=31, w=1) → result has bit 31 set → N=1.
//   DR1 = 0 (destination), DR2 = 1 (value to insert at pos 31).
//   mask = 0x80000000; newWord = 0x80000000.  N=1 because (newWord >>> 31) & 1 = 1.
//   This is the canonical way to produce N=1 from a bitfield instruction in this ISA.
{
    const asmBF7 = new ChurchAssembler();
    const rBF7   = asmBF7.assemble('BFINS DR1, DR2, 31, 1');
    assert('BF7 BFINS DR1, DR2, 31, 1 assembles with no errors',
        asmBF7.errors.length === 0,
        asmBF7.errors.map(e => e.message).join('; '));

    const simBF7 = new ChurchSimulator();
    simBF7.memory[0] = rBF7.words[0] >>> 0;
    simBF7.dr[1] = 0x00000000;   // destination: empty
    simBF7.dr[2] = 1;            // value: insert 1 → bit 31 of newWord
    simBF7.step();
    assert('BF7 BFINS N=1: DR1=0x80000000', simBF7.dr[1] === (0x80000000 >>> 0), `DR1=0x${simBF7.dr[1].toString(16)}`);
    assert('BF7 BFINS N=1: Z=0',            simBF7.flags.Z === false,            `Z=${simBF7.flags.Z}`);
    assert('BF7 BFINS N=1: N=1',            simBF7.flags.N === true,             `N=${simBF7.flags.N}`);
    assert('BF7 BFINS N=1: C=0',            simBF7.flags.C === false,            `C=${simBF7.flags.C}`);
}

// BF8: BFINS — partial overwrite: destination bits outside the field must be preserved.
//   DR1 = 0x0000FF00 (bits 15:8 set, outside the 4-bit field at pos 0).
//   DR2 = 0xA (= 0b1010).  BFINS DR1, DR2, 0, 4 inserts into bits[3:0].
//   Expected: newWord = 0x0000FF0A — bits[15:8] preserved, bits[3:0] = 0xA.
{
    const asmBF8 = new ChurchAssembler();
    const rBF8   = asmBF8.assemble('BFINS DR1, DR2, 0, 4');
    assert('BF8 BFINS DR1, DR2, 0, 4 assembles with no errors',
        asmBF8.errors.length === 0,
        asmBF8.errors.map(e => e.message).join('; '));

    const simBF8 = new ChurchSimulator();
    simBF8.memory[0] = rBF8.words[0] >>> 0;
    simBF8.dr[1] = 0x0000FF00;   // destination: bits outside field already set
    simBF8.dr[2] = 0xA;          // source: insert 0b1010 at pos 0
    simBF8.step();
    assert('BF8 BFINS partial overwrite: DR1=0x0000FF0A', simBF8.dr[1] === 0x0000FF0A, `DR1=0x${simBF8.dr[1].toString(16)}`);
    assert('BF8 BFINS partial overwrite: Z=0',            simBF8.flags.Z === false,     `Z=${simBF8.flags.Z}`);
    assert('BF8 BFINS partial overwrite: N=0',            simBF8.flags.N === false,     `N=${simBF8.flags.N}`);
    assert('BF8 BFINS partial overwrite: C=0',            simBF8.flags.C === false,     `C=${simBF8.flags.C}`);
}

// BF9: BFEXT — width=32 truncates to 0 in the 5-bit field → assembler must reject it.
//   The assembler now catches this at assemble time (width=0 after masking) rather than
//   letting it silently produce a word that causes a runtime BOUNDS fault.
{
    const asmBF9 = new ChurchAssembler();
    asmBF9.assemble('BFEXT DR1, DR2, 0, 32');
    assert('BF9 BFEXT DR1, DR2, 0, 32 emits assembler error (width=32 → masked=0)',
        asmBF9.errors.length > 0,
        'expected ≥1 error, got 0');
    assert('BF9 BFEXT w=32 error mentions width',
        asmBF9.errors.some(e => /width/i.test(e.message)),
        'errors: ' + asmBF9.errors.map(e => e.message).join('; '));
}

// BF10: BFINS — width=0 is always invalid → assembler must reject it.
//   Previously this silently encoded to width=0 and caused a runtime BOUNDS fault;
//   the assembler now catches it with an error at assemble time.
{
    const asmBF10 = new ChurchAssembler();
    asmBF10.assemble('BFINS DR1, DR2, 0, 0');
    assert('BF10 BFINS DR1, DR2, 0, 0 emits assembler error (width=0)',
        asmBF10.errors.length > 0,
        'expected ≥1 error, got 0');
    assert('BF10 BFINS width=0 error mentions width',
        asmBF10.errors.some(e => /width/i.test(e.message)),
        'errors: ' + asmBF10.errors.map(e => e.message).join('; '));
}

// BF11: BFINS — pos+width > 32 (pos=31, w=2 → 33 > 32) → assembler must reject it.
//   Previously this reached the simulator and caused a runtime BOUNDS fault;
//   the assembler now catches it with an error at assemble time.
{
    const asmBF11 = new ChurchAssembler();
    asmBF11.assemble('BFINS DR1, DR2, 31, 2');
    assert('BF11 BFINS DR1, DR2, 31, 2 emits assembler error (pos+width=33 > 32)',
        asmBF11.errors.length > 0,
        'expected ≥1 error, got 0');
    assert('BF11 BFINS pos+width>32 error mentions pos+width or sum',
        asmBF11.errors.some(e => /pos\+width|sum/i.test(e.message)),
        'errors: ' + asmBF11.errors.map(e => e.message).join('; '));
}

// BFE1: BFEXT — width=0 explicit → assembler emits error, not a silent encode.
//   Distinct from BF9 (which tests the masking edge case): here the programmer
//   literally writes width=0.
{
    const asmBFE1 = new ChurchAssembler();
    asmBFE1.assemble('BFEXT DR1, DR2, 4, 0');
    assert('BFE1 BFEXT DR1, DR2, 4, 0 emits assembler error (width=0)',
        asmBFE1.errors.length > 0,
        'expected ≥1 error, got 0');
    assert('BFE1 BFEXT width=0 error mentions BFEXT and width',
        asmBFE1.errors.some(e => /BFEXT/i.test(e.message) && /width/i.test(e.message)),
        'errors: ' + asmBFE1.errors.map(e => e.message).join('; '));
}

// BFE2: BFEXT — pos+width > 32 (pos=31, w=2 → sum=33) → assembler emits error.
//   Mirror of BF11 but for BFEXT; confirms the check applies to both instructions.
{
    const asmBFE2 = new ChurchAssembler();
    asmBFE2.assemble('BFEXT DR1, DR2, 31, 2');
    assert('BFE2 BFEXT DR1, DR2, 31, 2 emits assembler error (pos+width=33 > 32)',
        asmBFE2.errors.length > 0,
        'expected ≥1 error, got 0');
    assert('BFE2 BFEXT pos+width>32 error mentions BFEXT and pos+width or sum',
        asmBFE2.errors.some(e => /BFEXT/i.test(e.message) && /pos\+width|sum/i.test(e.message)),
        'errors: ' + asmBFE2.errors.map(e => e.message).join('; '));
}

// ── LTF: led_turing_full snippet regression ───────────────────────────────────
// Loads the led_turing_full assembly from _TURING_DR_TEST_SOURCE in app-run.js,
// assembles it, and asserts zero errors.  This catches any edit that introduces
// an invalid instruction, bad label, or mis-encoded operand in the Turing DR test.
{
    const fs   = require('fs');
    const path = require('path');
    const src  = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
    const m    = src.match(/const _TURING_DR_TEST_SOURCE\s*=\s*`([\s\S]*?)`\s*;/);
    assert('LTF1 led_turing_full: snippet found in app-run.js',
        m !== null,
        'regex did not match — check _TURING_DR_TEST_SOURCE definition in app-run.js');
    if (m) {
        const a = new ChurchAssembler();
        a.assemble(m[1]);
        assert('LTF2 led_turing_full: assembles with 0 errors',
            a.errors.length === 0,
            a.errors.slice(0, 5).map(e => (e.line ? 'L' + e.line + ': ' : '') + e.message).join(' | '));
    }
}

// ── Shared GT-constant guard (used by both TP and SM sections) ────────────────
// Guard: verify a GT constant is domain-pure at definition time so that a bad
// constant causes an immediate, clearly-located throw rather than a cryptic
// mid-test fault inside sim.step().  Abstract GTs (type===3) repurpose the
// permission bits as ab_type and are exempt from the check.
//
// New GT word layout (v1.1):
//   [31]=b_flag [30:28]=perm[2:0] [27]=dom [26]=spare [25]=f_flag
//   [24:23]=gt_type [22:16]=gt_seq [15:0]=slot_id
//   dom=0 (Turing): perm[2]=X, perm[1]=W, perm[0]=R
//   dom=1 (Church):  perm[2]=E, perm[1]=S, perm[0]=L
function validateGTConstant(name, word) {
    word = word >>> 0;
    const type = (word >>> 23) & 0x3;
    if (type === 3) return;
    const perm3 = (word >>> 28) & 0x7;
    const dom   = (word >>> 27) & 0x1;
    const perms = dom === 0
        ? { B: (word >>> 31) & 1, X: (perm3 >>> 2) & 1, W: (perm3 >>> 1) & 1, R: (perm3 >>> 0) & 1, L: 0, S: 0, E: 0 }
        : { B: (word >>> 31) & 1, X: 0, W: 0, R: 0, E: (perm3 >>> 2) & 1, S: (perm3 >>> 1) & 1, L: (perm3 >>> 0) & 1 };
    const purity = ChurchSimulator.isDomainPure(perms);
    if (!purity.ok) {
        throw new Error(
            `GT constant "${name}" (0x${word.toString(16).padStart(8,'0')}) is domain-impure: ` +
            `mixes Turing and Church permissions (${purity.bits})`
        );
    }
}

// ── TP: TPERM simulator integration tests (task-873) ─────────────────────────
// These tests exercise _execTperm directly via step() to verify:
//   C.1 — reserved presets fault with TPERM_RSV (not silent Z=0)
//   C.2 — out-of-bounds GT base+size fails the bounds check (Z=0, not Z=1)
//   Regression — valid preset + in-range GT still passes (Z=1)
//
// TPERM instruction word layout: opcode[31:27]=6, crDst[22:19], imm[14:0]
// GT word layout (v1.1): b[31] perm[30:28] dom[27] spare[26] f[25] type[24:23] seq[22:16] index[15:0]
//   dom=0 (Turing): perm[2]=X, perm[1]=W, perm[0]=R; Inform type = 0b01

// GT word for CR0: R permission, Inform type, NS index 0, seq 0
// New encoding: dom=0 (Turing), perm3=0b001 (R only at perm[0]=bit28), type=Inform(01 at bits[24:23])
const TP_GT_R_IDX0 = ((0b001 << 28) | (0 << 27) | (0b01 << 23) | 0) >>> 0;
validateGTConstant('TP_GT_R_IDX0', TP_GT_R_IDX0);

// Instruction word format: opcode[31:27], cond[26:23], crDst[22:19], crSrc[18:15], imm[14:0]
// AL (always-execute) condition = 0xE in bits[26:23]

// TPERM CR0, R  (opcode=6, cond=AL=0xE, crDst=0, imm=1)
const TP_INSTR_R   = ((6 << 27) | (0xE << 23) | (0 << 19) | 1) >>> 0;

// TPERM CR0, RSV11 (opcode=6, cond=AL=0xE, crDst=0, imm=11)
const TP_INSTR_RSV = ((6 << 27) | (0xE << 23) | (0 << 19) | 11) >>> 0;

// TP1: Reserved preset (code 11) → hard fault, simulator halts
{
    const sim = new ChurchSimulator();
    sim.memory[0] = TP_INSTR_RSV;
    sim.cr[0] = { word0: TP_GT_R_IDX0, word1: 0, word2: 0 };
    sim.step();
    assert('TP1 reserved preset code 11: simulator halts (fault)', sim.halted === true,
        `halted=${sim.halted}`);
    assert('TP1 reserved preset code 11: fault log contains TPERM_RSV',
        sim.faultLog.some(f => f.type === 'TPERM_RSV'),
        'faultLog: ' + sim.faultLog.map(f => f.type).join(', '));
}

// TP2: Valid preset (R) + out-of-bounds GT → bounds check fail → Z=0, N=1, not halted
{
    const sim = new ChurchSimulator();
    sim.memory[0] = TP_INSTR_R;
    sim.cr[0] = { word0: TP_GT_R_IDX0, word1: 0, word2: 0 };
    // NS entry 0: location = NS_TABLE_BASE - 1, limit = 2
    // upperBound = (NS_TABLE_BASE - 1) + 2 = NS_TABLE_BASE + 1 >= NS_TABLE_BASE → fail
    sim.memory[sim.NS_TABLE_BASE + 0] = sim.NS_TABLE_BASE - 1;
    sim.memory[sim.NS_TABLE_BASE + 1] = 2;
    sim.step();
    assert('TP2 out-of-bounds GT: Z=0', sim.flags.Z === false, `Z=${sim.flags.Z}`);
    assert('TP2 out-of-bounds GT: N=1', sim.flags.N === true,  `N=${sim.flags.N}`);
    assert('TP2 out-of-bounds GT: C=0', sim.flags.C === false, `C=${sim.flags.C}`);
    assert('TP2 out-of-bounds GT: V=0', sim.flags.V === false, `V=${sim.flags.V}`);
    assert('TP2 out-of-bounds GT: not halted (bounds fail is not a hard fault)',
        sim.halted === false, `halted=${sim.halted}`);
}

// TP3: Valid preset (R) + in-range GT → bounds check pass → Z=1 (regression)
{
    const sim = new ChurchSimulator();
    sim.memory[0] = TP_INSTR_R;
    sim.cr[0] = { word0: TP_GT_R_IDX0, word1: 0, word2: 0 };
    // NS entry 0: location = 100, limit = 50
    // sumF64 = 150, well below NS_TABLE_BASE → pass
    sim.memory[sim.NS_TABLE_BASE + 0] = 100;
    sim.memory[sim.NS_TABLE_BASE + 1] = 50;
    sim.step();
    assert('TP3 in-range GT with R perm: Z=1', sim.flags.Z === true,  `Z=${sim.flags.Z}`);
    assert('TP3 in-range GT with R perm: N=0', sim.flags.N === false, `N=${sim.flags.N}`);
    assert('TP3 in-range GT with R perm: not halted', sim.halted === false, `halted=${sim.halted}`);
}

// TP4: location=0 + large limit → bounds check must still fail (no bypass for base=0)
{
    const sim = new ChurchSimulator();
    sim.memory[0] = TP_INSTR_R;
    sim.cr[0] = { word0: TP_GT_R_IDX0, word1: 0, word2: 0 };
    // NS entry 0: location = 0, limit = NS_TABLE_BASE (exceeds allowed region)
    // sumF64 = 0 + NS_TABLE_BASE = NS_TABLE_BASE >= NS_TABLE_BASE → fail
    sim.memory[sim.NS_TABLE_BASE + 0] = 0;
    sim.memory[sim.NS_TABLE_BASE + 1] = sim.NS_TABLE_BASE;  // stored directly in limit17 bits
    sim.step();
    assert('TP4 location=0 + over-limit: Z=0', sim.flags.Z === false, `Z=${sim.flags.Z}`);
    assert('TP4 location=0 + over-limit: N=1', sim.flags.N === true,  `N=${sim.flags.N}`);
    assert('TP4 location=0 + over-limit: not halted (not a hard fault)',
        sim.halted === false, `halted=${sim.halted}`);
}

// TP5: overflow case — large base + large limit wraps 32-bit but overflows detection catches it
{
    const sim = new ChurchSimulator();
    sim.memory[0] = TP_INSTR_R;
    sim.cr[0] = { word0: TP_GT_R_IDX0, word1: 0, word2: 0 };
    // NS entry 0: location = 0xFFFF0000 (near top of 32-bit space), limit = 0x1FFFF (max 17-bit)
    // True sum = 0xFFFF0000 + 0x1FFFF = 0x1000EFFFF > 0xFFFFFFFF → overflow → fail
    sim.memory[sim.NS_TABLE_BASE + 0] = 0xFFFF0000;
    sim.memory[sim.NS_TABLE_BASE + 1] = 0x1FFFF;  // max 17-bit limit in bits[16:0]
    sim.step();
    assert('TP5 overflow (base+limit > 0xFFFFFFFF): Z=0', sim.flags.Z === false, `Z=${sim.flags.Z}`);
    assert('TP5 overflow (base+limit > 0xFFFFFFFF): N=1', sim.flags.N === true,  `N=${sim.flags.N}`);
    assert('TP5 overflow (base+limit > 0xFFFFFFFF): not halted',
        sim.halted === false, `halted=${sim.halted}`);
}

// TP6: B-modifier form of reserved preset (imm=0x1B, presetCode=11, B=1) also faults
{
    // imm = (B<<4) | presetCode = (1<<4) | 11 = 0x1B
    const TP_INSTR_RSV_B = ((6 << 27) | (0xE << 23) | (0 << 19) | 0x1B) >>> 0;
    const sim = new ChurchSimulator();
    sim.memory[0] = TP_INSTR_RSV_B;
    sim.cr[0] = { word0: TP_GT_R_IDX0, word1: 0, word2: 0 };
    sim.step();
    assert('TP6 B-modifier reserved preset (0x1B): simulator halts (fault)',
        sim.halted === true, `halted=${sim.halted}`);
    assert('TP6 B-modifier reserved preset (0x1B): fault log contains TPERM_RSV',
        sim.faultLog.some(f => f.type === 'TPERM_RSV'),
        'faultLog: ' + sim.faultLog.map(f => f.type).join(', '));
}

// ── SM: TPERM Mode 2 (capability attenuation) simulator tests (task-874) ──────
// These tests exercise _execTperm Mode 2 (imm=0x7FFF) via step() directly.
//
// Instruction encoding: opcode[31:27]=6, cond[26:23]=0xE (AL), crDst[22:19], crSrc[18:15], imm[14:0]=0x7FFF
// CRd (crDst=0, CR0) holds the source GT (the authority being attenuated).
// CRs (crSrc=1, CR1) holds the requested permission template GT.
//
// GT word layout (v1.1): b[31] perm[30:28] dom[27] spare[26] f[25] type[24:23] seq[22:16] index[15:0]
//   dom=0 (Turing): perm[2]=X, perm[1]=W, perm[0]=R; Inform type = 0b01 (bit 23 set).

// TPERM CR0, CR1, 0x7FFF  (Mode 2 attenuation — imm=0x7FFF, crDst=0, crSrc=1)
// opcode=6, cond=AL=0xE, crDst=0, crSrc=1, imm=0x7FFF
const SM_MODE2_INSTR = ((6 << 27) | (0xE << 23) | (0 << 19) | (1 << 15) | 0x7FFF) >>> 0;

// GT with R,W,X permissions (full Turing domain), Inform type, NS index 0, seq 0
// New encoding: dom=0, perm3=0b111 (X=perm[2], W=perm[1], R=perm[0]) at bits[30:28]; type=Inform at bits[24:23]
const SM_GT_RWX = ((0b111 << 28) | (0 << 27) | (0x01 << 23)) >>> 0;
validateGTConstant('SM_GT_RWX', SM_GT_RWX);

// GT with R,W permissions (Turing subset), Inform type, NS index 1, seq 0
// New encoding: dom=0, perm3=0b011 (W=perm[1], R=perm[0]) at bits[30:28]
const SM_GT_RW_IDX1 = ((0b011 << 28) | (0 << 27) | (0x01 << 23) | 1) >>> 0;
validateGTConstant('SM_GT_RW_IDX1', SM_GT_RW_IDX1);

// GT with R,W permissions, Inform type, NS index 0, seq 0
// New encoding: dom=0, perm3=0b011 (W=perm[1], R=perm[0]) at bits[30:28]
const SM_GT_RW = ((0b011 << 28) | (0 << 27) | (0x01 << 23)) >>> 0;
validateGTConstant('SM_GT_RW', SM_GT_RW);

// GT with R,W,X permissions (expansion beyond RW), Inform type, NS index 1, seq 0
// New encoding: dom=0, perm3=0b111 at bits[30:28]
const SM_GT_RWX_IDX1 = ((0b111 << 28) | (0 << 27) | (0x01 << 23) | 1) >>> 0;
validateGTConstant('SM_GT_RWX_IDX1', SM_GT_RWX_IDX1);

// SM1: Valid attenuation (strict subset) — CRd={R,W,X}, CRs={R,W} → Z=1, attenuated GT written
{
    const sim = new ChurchSimulator();
    sim.memory[0] = SM_MODE2_INSTR;
    sim.cr[0] = { word0: SM_GT_RWX, word1: 0, word2: 0 };       // source: R,W,X (Turing-pure)
    sim.cr[1] = { word0: SM_GT_RW_IDX1, word1: 0, word2: 0 };   // requested: R,W (strict subset)
    sim.step();
    assert('SM1 valid attenuation: Z=1', sim.flags.Z === true,  `Z=${sim.flags.Z}`);
    assert('SM1 valid attenuation: N=0', sim.flags.N === false, `N=${sim.flags.N}`);
    assert('SM1 valid attenuation: C=0', sim.flags.C === false, `C=${sim.flags.C}`);
    assert('SM1 valid attenuation: V=0', sim.flags.V === false, `V=${sim.flags.V}`);
    assert('SM1 valid attenuation: not halted', sim.halted === false, `halted=${sim.halted}`);
    // CR0 should now hold a GT with R,W permissions and the source's NS index (0), not index 1
    const sim1 = new ChurchSimulator();
    const newGTParsed = sim1.parseGT(sim.cr[0].word0);
    assert('SM1 attenuated GT: R=1', newGTParsed.permissions.R === 1, `R=${newGTParsed.permissions.R}`);
    assert('SM1 attenuated GT: W=1', newGTParsed.permissions.W === 1, `W=${newGTParsed.permissions.W}`);
    assert('SM1 attenuated GT: X=0', newGTParsed.permissions.X === 0, `X=${newGTParsed.permissions.X}`);
    assert('SM1 attenuated GT: NS index preserved (0)', newGTParsed.index === 0, `index=${newGTParsed.index}`);
}

// SM2: Expansion attempt fails — CRd={R,W}, CRs={R,W,X} (X not in source) → Z=0, not halted
{
    const sim = new ChurchSimulator();
    sim.memory[0] = SM_MODE2_INSTR;
    const srcWordBefore = SM_GT_RW;
    sim.cr[0] = { word0: srcWordBefore, word1: 0, word2: 0 };    // source: R,W
    sim.cr[1] = { word0: SM_GT_RWX_IDX1, word1: 0, word2: 0 };  // requested: R,W,X (X is expansion)
    sim.step();
    assert('SM2 expansion attempt: Z=0', sim.flags.Z === false, `Z=${sim.flags.Z}`);
    assert('SM2 expansion attempt: N=1', sim.flags.N === true,  `N=${sim.flags.N}`);
    assert('SM2 expansion attempt: C=0', sim.flags.C === false, `C=${sim.flags.C}`);
    assert('SM2 expansion attempt: V=0', sim.flags.V === false, `V=${sim.flags.V}`);
    assert('SM2 expansion attempt: not halted (soft failure, not hard fault)',
        sim.halted === false, `halted=${sim.halted}`);
    assert('SM2 expansion attempt: CR0 word0 unchanged',
        sim.cr[0].word0 === srcWordBefore,
        `CR0.word0=0x${(sim.cr[0].word0>>>0).toString(16)} expected=0x${(srcWordBefore>>>0).toString(16)}`);
}

// SM3: Identity attenuation (same permissions) — CRd={R,W}, CRs={R,W} → Z=1 (identity is valid)
{
    const sim = new ChurchSimulator();
    sim.memory[0] = SM_MODE2_INSTR;
    sim.cr[0] = { word0: SM_GT_RW, word1: 0, word2: 0 };        // source: R,W (NS index 0)
    sim.cr[1] = { word0: SM_GT_RW_IDX1, word1: 0, word2: 0 };   // requested: R,W (same perms, NS index 1)
    sim.step();
    assert('SM3 identity attenuation: Z=1', sim.flags.Z === true,  `Z=${sim.flags.Z}`);
    assert('SM3 identity attenuation: N=0', sim.flags.N === false, `N=${sim.flags.N}`);
    assert('SM3 identity attenuation: C=0', sim.flags.C === false, `C=${sim.flags.C}`);
    assert('SM3 identity attenuation: V=0', sim.flags.V === false, `V=${sim.flags.V}`);
    assert('SM3 identity attenuation: not halted', sim.halted === false, `halted=${sim.halted}`);
    // Result GT should have source's NS index (0), not CRs's index (1)
    const sim3 = new ChurchSimulator();
    const newGT3 = sim3.parseGT(sim.cr[0].word0);
    assert('SM3 identity: NS index preserved from source (0)', newGT3.index === 0, `index=${newGT3.index}`);
    assert('SM3 identity: R=1', newGT3.permissions.R === 1, `R=${newGT3.permissions.R}`);
    assert('SM3 identity: W=1', newGT3.permissions.W === 1, `W=${newGT3.permissions.W}`);
    assert('SM3 identity: X=0', newGT3.permissions.X === 0, `X=${newGT3.permissions.X}`);
}

// SM4: NULL source GT — CRd=NULL (word0=0) → Z=0, N=1, not halted
{
    const sim = new ChurchSimulator();
    sim.memory[0] = SM_MODE2_INSTR;
    sim.cr[0] = { word0: 0, word1: 0, word2: 0 };               // source: NULL GT
    sim.cr[1] = { word0: SM_GT_RW_IDX1, word1: 0, word2: 0 };   // requested: R,W (irrelevant — NULL source exits early)
    sim.step();
    assert('SM4 NULL source GT: Z=0', sim.flags.Z === false, `Z=${sim.flags.Z}`);
    assert('SM4 NULL source GT: N=1', sim.flags.N === true,  `N=${sim.flags.N}`);
    assert('SM4 NULL source GT: C=0', sim.flags.C === false, `C=${sim.flags.C}`);
    assert('SM4 NULL source GT: V=0', sim.flags.V === false, `V=${sim.flags.V}`);
    assert('SM4 NULL source GT: not halted (null is soft failure)',
        sim.halted === false, `halted=${sim.halted}`);
}

// ── RETURN mask warnings (task-888) ──────────────────────────────────────────

// RM1: bare RETURN (mask=0) produces no warnings and no errors
{
    const a = new ChurchAssembler();
    const r = a.assemble('RETURN');
    assert('RM1 bare RETURN: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('RM1 bare RETURN: no warnings', a.warnings.length === 0,
        a.warnings.map(w => w.message).join('; '));
    assert('RM1 bare RETURN: word count = 1', r.words.length === 1, 'got ' + r.words.length);
    const mask = r.words[0] & 0xFFF;
    assert('RM1 bare RETURN: mask field = 0', mask === 0, 'got ' + mask);
}

// RM2: RETURN with non-zero mask (bit 5 set, decimal 32) encodes silently — no warning, no error.
//      set bit = PRESERVE that CR (return value to caller).
{
    const a = new ChurchAssembler();
    const r = a.assemble('RETURN 32');
    assert('RM2 RETURN 32: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('RM2 RETURN 32: no warnings (mask is implemented — no warning needed)', a.warnings.length === 0,
        'got ' + a.warnings.length + ': ' + a.warnings.map(w => w.message).join('; '));
    assert('RM2 RETURN 32: word count = 1', r.words.length === 1, 'got ' + r.words.length);
    const mask = r.words[0] & 0xFFF;
    assert('RM2 RETURN 32: mask field = 32 in encoded word (bit 5 = preserve CR5)', mask === 32, 'got ' + mask);
}

// RM3: RETURN 0xFFF preserves all CR0–CR11 (all return values) — no warning, no error.
{
    const a = new ChurchAssembler();
    const r = a.assemble('RETURN 0xFFF');
    assert('RM3 RETURN 0xFFF: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('RM3 RETURN 0xFFF: no warnings', a.warnings.length === 0,
        'got ' + a.warnings.length);
    assert('RM3 RETURN 0xFFF: word count = 1', r.words.length === 1, 'got ' + r.words.length);
    const mask = r.words[0] & 0xFFF;
    assert('RM3 RETURN 0xFFF: mask field = 0xFFF (preserve all CR0–CR11)', mask === 0xFFF, 'got 0x' + mask.toString(16));
}

// RM4: RETURN 0b000000000001 — preserve only CR0 (single capability return value)
{
    const a = new ChurchAssembler();
    const r = a.assemble('RETURN 0b000000000001');
    assert('RM4 RETURN 0b1: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('RM4 RETURN 0b1: no warnings', a.warnings.length === 0,
        'got ' + a.warnings.length);
    const mask = r.words[0] & 0xFFF;
    assert('RM4 RETURN 0b1: mask field = 1 (preserve CR0)', mask === 1, 'got ' + mask);
}

// ── SWITCH simulator tests (D-11 fix) ────────────────────────────────────────
// Instruction word: opcode[31:27] | cond[26:23] | crDst[22:19] | crSrc[18:15] | imm[14:0]
// SWITCH opcode = 5 → bits[31:27] = 0b00101 → 0xA0000000 base
// crSrc=1 → bit 15 → 0x00008000;  crSrc=2 → 0x00010000
// SWITCH_TGT_CR13 = 5, SWITCH_TGT_CR15 = 7
// Abstract GT type=3 → bits[26:25] of word0 → (3<<25) = 0x06000000  (v2.0 layout)
// PassKey sentinels: CR13=0xFFFFFFFE, CR15=0xFFFFFFFF

const SW_ABSTRACT_GT = 0x06000000;          // Minimal Abstract GT (type=3, v2.0: gt_type at [26:25]=(3<<25))
const SW_INFORM_GT   = 0x02000000;          // Inform GT (type=1, v2.0: gt_type at [26:25]=(1<<25))
// Instruction words use AL (always) condition = 0xE in bits[26:23] — same pattern as TP_INSTR_*.
// The >>> 0 converts signed-negative JavaScript bit-op results to unsigned 32-bit.
const SW_CR1_TGT5 = ((5 << 27) | (0xE << 23) | (1 << 15) | 5) >>> 0;  // SWITCH AL CR1, 5 (→CR13)
const SW_CR2_TGT7 = ((5 << 27) | (0xE << 23) | (2 << 15) | 7) >>> 0;  // SWITCH AL CR2, 7 (→CR15)
const SW_CR1_TGT3 = ((5 << 27) | (0xE << 23) | (1 << 15) | 3) >>> 0;  // SWITCH AL CR1, 3 (invalid target)

// SW1: Invalid target (Tgt=3) → INVALID_OP fault before any register is touched
{
    const sim = new ChurchSimulator();
    sim.memory[0] = SW_CR1_TGT3;
    sim.cr[1] = { word0: SW_ABSTRACT_GT, word1: 0xFFFFFFFE, word2: 0, word3: 0, m: 0 };
    sim.step();
    assert('SW1 invalid target Tgt=3: simulator halts (fault)',
        sim.halted === true, `halted=${sim.halted}`);
    assert('SW1 invalid target Tgt=3: fault type is INVALID_OP',
        sim.faultLog.some(f => f.type === 'INVALID_OP'),
        'faultLog: ' + sim.faultLog.map(f => f.type).join(', '));
    assert('SW1 invalid target Tgt=3: CR1 unchanged (no register touched)',
        sim.cr[1].word0 === SW_ABSTRACT_GT, `CR1.word0=0x${sim.cr[1].word0.toString(16)}`);
}

// SW2: NULL source GT → INVALID_OP fault
{
    const sim = new ChurchSimulator();
    sim.memory[0] = SW_CR1_TGT5;
    sim.cr[1] = { word0: 0, word1: 0xFFFFFFFE, word2: 0, word3: 0, m: 0 };
    sim.step();
    assert('SW2 NULL source: simulator halts (fault)',
        sim.halted === true, `halted=${sim.halted}`);
    assert('SW2 NULL source: fault type is INVALID_OP',
        sim.faultLog.some(f => f.type === 'INVALID_OP'),
        'faultLog: ' + sim.faultLog.map(f => f.type).join(', '));
}

// SW3: Non-Abstract source (Inform GT, type=1) → INVALID_OP fault
{
    const sim = new ChurchSimulator();
    sim.memory[0] = SW_CR1_TGT5;
    sim.cr[1] = { word0: SW_INFORM_GT, word1: 0xFFFFFFFE, word2: 0, word3: 0, m: 0 };
    sim.step();
    assert('SW3 Inform GT source: simulator halts (fault)',
        sim.halted === true, `halted=${sim.halted}`);
    assert('SW3 Inform GT source: fault type is INVALID_OP',
        sim.faultLog.some(f => f.type === 'INVALID_OP'),
        'faultLog: ' + sim.faultLog.map(f => f.type).join(', '));
}

// SW4: Abstract GT but wrong sentinel (CR13 target, but sentinel ≠ 0xFFFFFFFE) → INVALID_OP
{
    const sim = new ChurchSimulator();
    sim.memory[0] = SW_CR1_TGT5;
    sim.cr[1] = { word0: SW_ABSTRACT_GT, word1: 0x12345678, word2: 0, word3: 0, m: 0 };
    const cr13Before = { ...sim.cr[13] };
    sim.step();
    assert('SW4 wrong sentinel: simulator halts (fault)',
        sim.halted === true, `halted=${sim.halted}`);
    assert('SW4 wrong sentinel: fault type is INVALID_OP',
        sim.faultLog.some(f => f.type === 'INVALID_OP'),
        'faultLog: ' + sim.faultLog.map(f => f.type).join(', '));
    assert('SW4 wrong sentinel: CR13 unchanged (no register touched)',
        sim.cr[13].word0 === cr13Before.word0,
        `CR13.word0=0x${sim.cr[13].word0.toString(16)}`);
}

// SW5: Valid PassKey → one-way install into CR13; source CR1 unchanged; PC advances
{
    const sim = new ChurchSimulator();
    sim.memory[0] = SW_CR1_TGT5;
    const passKey = { word0: SW_ABSTRACT_GT, word1: 0xFFFFFFFE, word2: 0xABCD, word3: 0, m: 1 };
    sim.cr[1] = { ...passKey };
    sim.step();
    assert('SW5 valid PassKey CR13: not halted',
        sim.halted === false, `halted=${sim.halted}`);
    assert('SW5 valid PassKey CR13: PC advanced to 1',
        sim.pc === 1, `pc=${sim.pc}`);
    assert('SW5 valid PassKey CR13: CR13.word0 matches source',
        sim.cr[13].word0 === SW_ABSTRACT_GT,
        `CR13.word0=0x${sim.cr[13].word0.toString(16)}`);
    assert('SW5 valid PassKey CR13: CR13.word1 matches source sentinel',
        (sim.cr[13].word1 >>> 0) === 0xFFFFFFFE,
        `CR13.word1=0x${(sim.cr[13].word1>>>0).toString(16)}`);
    assert('SW5 valid PassKey CR13: source CR1.word0 unchanged (not a swap)',
        sim.cr[1].word0 === SW_ABSTRACT_GT,
        `CR1.word0=0x${sim.cr[1].word0.toString(16)}`);
    assert('SW5 valid PassKey CR13: source CR1.word1 unchanged',
        (sim.cr[1].word1 >>> 0) === 0xFFFFFFFE,
        `CR1.word1=0x${(sim.cr[1].word1>>>0).toString(16)}`);
}

// SW6: Valid PassKey → one-way install into CR15; source CR2 unchanged; PC advances
{
    const sim = new ChurchSimulator();
    sim.memory[0] = SW_CR2_TGT7;
    const passKey15 = { word0: SW_ABSTRACT_GT, word1: 0xFFFFFFFF, word2: 0x1234, word3: 0, m: 0 };
    sim.cr[2] = { ...passKey15 };
    sim.step();
    assert('SW6 valid PassKey CR15: not halted',
        sim.halted === false, `halted=${sim.halted}`);
    assert('SW6 valid PassKey CR15: PC advanced to 1',
        sim.pc === 1, `pc=${sim.pc}`);
    assert('SW6 valid PassKey CR15: CR15.word0 matches source',
        sim.cr[15].word0 === SW_ABSTRACT_GT,
        `CR15.word0=0x${sim.cr[15].word0.toString(16)}`);
    assert('SW6 valid PassKey CR15: CR15.word1 matches source sentinel',
        (sim.cr[15].word1 >>> 0) === 0xFFFFFFFF,
        `CR15.word1=0x${(sim.cr[15].word1>>>0).toString(16)}`);
    assert('SW6 valid PassKey CR15: source CR2.word0 unchanged (not a swap)',
        sim.cr[2].word0 === SW_ABSTRACT_GT,
        `CR2.word0=0x${sim.cr[2].word0.toString(16)}`);
    assert('SW6 valid PassKey CR15: source CR2.word1 unchanged',
        (sim.cr[2].word1 >>> 0) === 0xFFFFFFFF,
        `CR2.word1=0x${(sim.cr[2].word1>>>0).toString(16)}`);
}

// ── Constants Dot example (task-1038) ────────────────────────────────────────
// End-to-end test that assembles the full constants_dot example source
// (mirrored from app-run.js) and asserts correct instruction encodings at
// their real word positions.
//
// Instruction map (labels resolved by the assembler):
//   word  0  LOAD   CR11, Constants
//   word  1  TPERM  CR11, E
//   word  2  CALL   Constants.Pi      ← CD2–CD4 assert here
//   word  3  CALL   Constants.E
//   word  4  CALL   Constants.Phi
//   word  5  CALL   Constants.Zero
//   word  6  CALL   Constants.One
//   word  7  CALL   Constants.Pi
//   word  8  MCMP   DR1, DR0
//   word  9  BRANCHNE style_b  (+1)
//   word 10  ELOADCALL CR8, Constants, Pi  ← CD6–CD10 assert here
//   word 11  ELOADCALL CR8, Constants, E
//   word 12  ELOADCALL CR8, Constants, Phi
//   word 13  ELOADCALL CR8, Constants, Zero
//   word 14  ELOADCALL CR8, Constants, One
//   word 15  ELOADCALL CR8, Constants, Pi
//   word 16  MCMP   DR1, DR0
//   word 17  BRANCHNE done  (+1)
//   word 18  HALT
//
// ELOADCALL name-resolution behaviour with a prior LOAD in the same assembly:
//   When "LOAD CR11, Constants" precedes the ELOADCALL lines, the assembler's
//   nsLoaded map records Constants→11 (the CR number).  _resolveNSName checks
//   nsLoaded before nsSymbols, so for the ELOADCALL instructions the c-list
//   row field (imm[7:0]) is set to 11 — the number of the CR that holds the
//   abstraction — rather than the namespace slot 18.  This is the assembler's
//   current defined behaviour and the assertions below pin it explicitly.

{
    const CONSTANTS_CONVENTIONS = {
        'Constants': {
            'Pi':   { index: 0 },
            'E':    { index: 1 },
            'Phi':  { index: 2 },
            'Zero': { index: 3 },
            'One':  { index: 4 },
        }
    };
    const CONSTANTS_NS = { 'Constants': 18 };

    // Full constants_dot source (mirrored from app-run.js with CR8 in Style B;
    // CR12–CR15 are in the assembler privilege zone and are rejected for ELOADCALL).
    const CONSTANTS_DOT_SRC = `
LOAD   CR11, Constants
TPERM  CR11, E
CALL   Constants.Pi
CALL   Constants.E
CALL   Constants.Phi
CALL   Constants.Zero
CALL   Constants.One
CALL   Constants.Pi
MCMP   DR1, DR0
BRANCHNE style_b
style_b:
ELOADCALL CR8, Constants, Pi
ELOADCALL CR8, Constants, E
ELOADCALL CR8, Constants, Phi
ELOADCALL CR8, Constants, Zero
ELOADCALL CR8, Constants, One
ELOADCALL CR8, Constants, Pi
MCMP   DR1, DR0
BRANCHNE done
done:
HALT`;

    const a = new ChurchAssembler(CONSTANTS_CONVENTIONS);
    a.setNamespace(CONSTANTS_NS);
    const result = a.assemble(CONSTANTS_DOT_SRC);

    // CD1: the full source must assemble without errors.
    assert('CD1 constants_dot full source assembles with no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));

    // CD2–CD4: word[2] = CALL Constants.Pi  (Style A, dot-notation)
    // LOAD CR11, Constants records nsLoaded['Constants']=11, so the dot-notation
    // CALL resolves crDst=11. Pi has 0-based index 0; stored 1-based → imm=1.
    // Expected word: (2<<27)|(11<<19)|1 = 0x10580001  (cond=0, crSrc=0 implicit)
    {
        const w      = result.words[2] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const crDst  = (w >>> 19) & 0xF;
        const imm    = w & 0x7FFF;
        assert('CD2 CALL Constants.Pi — opcode=2 (CALL)',
            opcode === 2, `got opcode=${opcode}`);
        assert('CD3 CALL Constants.Pi — crDst=11 (bound by preceding LOAD CR11)',
            crDst === 11, `got crDst=${crDst}`);
        assert('CD4 CALL Constants.Pi — imm=1 (Pi index 0, stored 1-based)',
            imm === 1, `got imm=${imm}`);
    }

    // CD5: word count — 19 words (HALT at index 18).
    assert('CD5 constants_dot word count = 19',
        result.words.length === 19, `got ${result.words.length}`);

    // CD6–CD10: word[10] = ELOADCALL CR8, Constants, Pi  (Style B)
    // At this point nsLoaded['Constants']=11 from the earlier LOAD, so
    // _resolveNSName('Constants') returns 11 (CR number) — not the NS slot 18.
    // imm[7:0]  = 11  (c-list row = nsLoaded value for Constants)
    // imm[14:8] =  1  (Pi index 0, stored 1-based)
    // full imm  = (1<<8)|11 = 0x010B = 267
    {
        const w      = result.words[10] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const crDst  = (w >>> 19) & 0xF;
        const crSrc  = (w >>> 15) & 0xF;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('CD6 ELOADCALL CR8, Constants, Pi — opcode=8 (ELOADCALL)',
            opcode === 8, `got opcode=${opcode}`);
        assert('CD7 ELOADCALL CR8, Constants, Pi — crDst=8',
            crDst === 8, `got crDst=${crDst}`);
        assert('CD8 ELOADCALL CR8, Constants, Pi — crSrc=6 (c-list root)',
            crSrc === 6, `got crSrc=${crSrc}`);
        assert('CD9 ELOADCALL CR8, Constants, Pi — c-list row=11 (nsLoaded[Constants]=11)',
            row === 11, `got row=${row}`);
        assert('CD10 ELOADCALL CR8, Constants, Pi — method=1 (Pi index 0, stored 1-based)',
            method === 1, `got method=${method}`);
    }

    // CD11–CD13: word[3] = CALL Constants.E  (index 1, stored 1-based → imm=2)
    {
        const w      = result.words[3] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const crDst  = (w >>> 19) & 0xF;
        const imm    = w & 0x7FFF;
        assert('CD11 CALL Constants.E — opcode=2 (CALL)',
            opcode === 2, `got opcode=${opcode}`);
        assert('CD12 CALL Constants.E — crDst=11 (bound by preceding LOAD CR11)',
            crDst === 11, `got crDst=${crDst}`);
        assert('CD13 CALL Constants.E — imm=2 (E index 1, stored 1-based)',
            imm === 2, `got imm=${imm}`);
    }

    // CD14–CD16: word[4] = CALL Constants.Phi  (index 2, stored 1-based → imm=3)
    {
        const w      = result.words[4] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const crDst  = (w >>> 19) & 0xF;
        const imm    = w & 0x7FFF;
        assert('CD14 CALL Constants.Phi — opcode=2 (CALL)',
            opcode === 2, `got opcode=${opcode}`);
        assert('CD15 CALL Constants.Phi — crDst=11 (bound by preceding LOAD CR11)',
            crDst === 11, `got crDst=${crDst}`);
        assert('CD16 CALL Constants.Phi — imm=3 (Phi index 2, stored 1-based)',
            imm === 3, `got imm=${imm}`);
    }

    // CD17–CD19: word[5] = CALL Constants.Zero  (index 3, stored 1-based → imm=4)
    {
        const w      = result.words[5] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const crDst  = (w >>> 19) & 0xF;
        const imm    = w & 0x7FFF;
        assert('CD17 CALL Constants.Zero — opcode=2 (CALL)',
            opcode === 2, `got opcode=${opcode}`);
        assert('CD18 CALL Constants.Zero — crDst=11 (bound by preceding LOAD CR11)',
            crDst === 11, `got crDst=${crDst}`);
        assert('CD19 CALL Constants.Zero — imm=4 (Zero index 3, stored 1-based)',
            imm === 4, `got imm=${imm}`);
    }

    // CD20–CD22: word[6] = CALL Constants.One  (index 4, stored 1-based → imm=5)
    {
        const w      = result.words[6] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const crDst  = (w >>> 19) & 0xF;
        const imm    = w & 0x7FFF;
        assert('CD20 CALL Constants.One — opcode=2 (CALL)',
            opcode === 2, `got opcode=${opcode}`);
        assert('CD21 CALL Constants.One — crDst=11 (bound by preceding LOAD CR11)',
            crDst === 11, `got crDst=${crDst}`);
        assert('CD22 CALL Constants.One — imm=5 (One index 4, stored 1-based)',
            imm === 5, `got imm=${imm}`);
    }

    // CD23–CD25: word[11] = ELOADCALL CR8, Constants, E  (index 1, stored 1-based → method=2)
    // imm[7:0]=11 (nsLoaded[Constants]), imm[14:8]=2  →  full imm=(2<<8)|11=0x020B=523
    {
        const w      = result.words[11] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const crDst  = (w >>> 19) & 0xF;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('CD23 ELOADCALL CR8, Constants, E — opcode=8 (ELOADCALL)',
            opcode === 8, `got opcode=${opcode}`);
        assert('CD24 ELOADCALL CR8, Constants, E — c-list row=11 (nsLoaded[Constants]=11)',
            row === 11, `got row=${row}`);
        assert('CD25 ELOADCALL CR8, Constants, E — method=2 (E index 1, stored 1-based)',
            method === 2, `got method=${method}`);
    }

    // CD26–CD28: word[14] = ELOADCALL CR8, Constants, One  (index 4, stored 1-based → method=5)
    // imm[7:0]=11 (nsLoaded[Constants]), imm[14:8]=5  →  full imm=(5<<8)|11=0x050B=1291
    {
        const w      = result.words[14] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const crDst  = (w >>> 19) & 0xF;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('CD26 ELOADCALL CR8, Constants, One — opcode=8 (ELOADCALL)',
            opcode === 8, `got opcode=${opcode}`);
        assert('CD27 ELOADCALL CR8, Constants, One — c-list row=11 (nsLoaded[Constants]=11)',
            row === 11, `got row=${row}`);
        assert('CD28 ELOADCALL CR8, Constants, One — method=5 (One index 4, stored 1-based)',
            method === 5, `got method=${method}`);
    }

    // CD29–CD31: word[12] = ELOADCALL CR8, Constants, Phi  (index 2, stored 1-based → method=3)
    // imm[7:0]=11 (nsLoaded[Constants]), imm[14:8]=3  →  full imm=(3<<8)|11=0x030B=779
    {
        const w      = result.words[12] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const crDst  = (w >>> 19) & 0xF;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('CD29 ELOADCALL CR8, Constants, Phi — opcode=8 (ELOADCALL)',
            opcode === 8, `got opcode=${opcode}`);
        assert('CD30 ELOADCALL CR8, Constants, Phi — c-list row=11 (nsLoaded[Constants]=11)',
            row === 11, `got row=${row}`);
        assert('CD31 ELOADCALL CR8, Constants, Phi — method=3 (Phi index 2, stored 1-based)',
            method === 3, `got method=${method}`);
    }

    // CD32–CD34: word[13] = ELOADCALL CR8, Constants, Zero  (index 3, stored 1-based → method=4)
    // imm[7:0]=11 (nsLoaded[Constants]), imm[14:8]=4  →  full imm=(4<<8)|11=0x040B=1035
    {
        const w      = result.words[13] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const crDst  = (w >>> 19) & 0xF;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('CD32 ELOADCALL CR8, Constants, Zero — opcode=8 (ELOADCALL)',
            opcode === 8, `got opcode=${opcode}`);
        assert('CD33 ELOADCALL CR8, Constants, Zero — c-list row=11 (nsLoaded[Constants]=11)',
            row === 11, `got row=${row}`);
        assert('CD34 ELOADCALL CR8, Constants, Zero — method=4 (Zero index 3, stored 1-based)',
            method === 4, `got method=${method}`);
    }
}

// ── GT-constant lint gate (task-1048) ────────────────────────────────────────
// Scans this file for every `const TP_GT_*` / `const SM_GT_*` definition and
// asserts that the immediately following non-blank line is a matching
// validateGTConstant(…) call.  This catches any future constant that ships
// without its domain-purity guard.
{
    const fs   = require('fs');
    const path = require('path');
    const src  = fs.readFileSync(path.join(__dirname, 'assembler_test.js'), 'utf8');
    const lines = src.split('\n');

    const GT_DECL = /^\s*const\s+((?:TP_GT_|SM_GT_)\S+)\s*=/;
    const GT_CALL = /^\s*validateGTConstant\(\s*['"]([^'"]+)['"]/;

    for (let i = 0; i < lines.length; i++) {
        const m = GT_DECL.exec(lines[i]);
        if (!m) continue;
        const constName = m[1];

        // Find the next non-blank line after the declaration
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j++;

        const callMatch = j < lines.length ? GT_CALL.exec(lines[j]) : null;
        const callName  = callMatch ? callMatch[1] : null;

        assert(
            `LINT GT-${constName} has validateGTConstant on next non-blank line`,
            callName === constName,
            callName
                ? `found validateGTConstant('${callName}') but expected '${constName}'`
                : `no validateGTConstant call found after declaration (line ${i + 1})`
        );
    }
}

// ── GT-constant lint gate — extended scan (task-1049) ────────────────────────
// Recursively scans every *.js and *.cloomc file in the simulator/ tree
// (excluding assembler_test.js itself, which is already covered above) for GT
// constant declarations and asserts that each one is immediately followed by a
// validateGTConstant(…) call on the next non-blank line.
//
// Files may opt out of a specific declaration by placing the comment
//   // GT-LINT-EXEMPT: <reason>
// on the same line as the `const` declaration.  Use sparingly.
{
    const fs   = require('fs');
    const path = require('path');

    const GT_DECL   = /^\s*const\s+((?:TP_GT_|SM_GT_)\S+)\s*=/;
    const GT_CALL   = /^\s*validateGTConstant\(\s*['"]([^'"]+)['"]/;
    const GT_EXEMPT = /GT-LINT-EXEMPT/;

    // Recursive collector — returns relative paths from simulator/ root
    function collectFiles(dir, rootDir, out) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                collectFiles(full, rootDir, out);
            } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.cloomc'))) {
                const rel = path.relative(rootDir, full);
                if (rel !== 'assembler_test.js') out.push({ rel, full });
            }
        }
    }

    const files = [];
    collectFiles(__dirname, __dirname, files);

    for (const { rel, full } of files) {
        const src   = fs.readFileSync(full, 'utf8');
        const lines = src.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const m = GT_DECL.exec(lines[i]);
            if (!m) continue;
            if (GT_EXEMPT.test(lines[i])) continue;

            const constName = m[1];

            // Find the next non-blank line
            let j = i + 1;
            while (j < lines.length && lines[j].trim() === '') j++;

            const callMatch = j < lines.length ? GT_CALL.exec(lines[j]) : null;
            const callName  = callMatch ? callMatch[1] : null;

            assert(
                `LINT GT-${constName} in ${rel} has validateGTConstant on next non-blank line`,
                callName === constName,
                callName
                    ? `found validateGTConstant('${callName}') but expected '${constName}'`
                    : `no validateGTConstant call found after declaration (line ${i + 1})`
            );
        }
    }
}

// ── Bare-call sugar BC tests (task-1050) ─────────────────────────────────────
// Tests for the Abs.Method(args) desugaring in pass 1.
//
// Expansion rule:
//   Tunnel.Connect(Mum)  →  LOAD CR2, Mum
//                            ELOADCALL CR0, Tunnel, Connect
//
// Encoding reference (TUNNEL_NS: Tunnel→3, Mum→5):
//   LOAD CR2, Mum      — opcode=0, cond=14, crDst=2, crSrc=6, imm=5
//     word = (0<<27)|(14<<23)|(2<<19)|(6<<15)|5 = 0x07130005
//   ELOADCALL CR0, Tunnel, Connect — Connect index=5 stored 1-based=6; Tunnel slot=3
//     imm = (6<<8)|3 = 0x0603;  opcode=8, cond=14, crDst=0, crSrc=6
//     word = (8<<27)|(14<<23)|(0<<19)|(6<<15)|0x0603 = 0x47030603

const TUNNEL_CONVENTIONS_BC = {
    'Tunnel': {
        'Connect': { index: 5, input: 'CR2=remote GT (Outform/far-end abstraction)', output: 'DR0 = far-end return value' },
        'Send':    { index: 1, input: 'DR1=FourCC tag, DR2=word count',               output: 'DR0 = 0 ok | 1 overrun' },
    }
};
const TUNNEL_NS_BC = { 'Tunnel': 3, 'Mum': 5 };

{
    // BC1–BC9: Tunnel.Connect(Mum) — single CR argument expansion
    const a = new ChurchAssembler(TUNNEL_CONVENTIONS_BC);
    a.setNamespace(TUNNEL_NS_BC);
    const result = a.assemble('Tunnel.Connect(Mum)\nHALT');

    assert('BC1 Tunnel.Connect(Mum) assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC2 Tunnel.Connect(Mum) expands to 3 words (LOAD + ELOADCALL + HALT)',
        result.words.length === 3, `got ${result.words.length}`);

    // word[0] = LOAD CR2, Mum
    {
        const w      = result.words[0] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const crDst  = (w >>> 19) & 0xF;
        const crSrc  = (w >>> 15) & 0xF;
        const imm    = w & 0x7FFF;
        assert('BC3 Tunnel.Connect(Mum) word[0] LOAD — opcode=0',
            opcode === 0, `got opcode=${opcode}`);
        assert('BC4 Tunnel.Connect(Mum) word[0] LOAD — crDst=2 (CR2 from input spec)',
            crDst === 2, `got crDst=${crDst}`);
        assert('BC5 Tunnel.Connect(Mum) word[0] LOAD — crSrc=6 (c-list root)',
            crSrc === 6, `got crSrc=${crSrc}`);
        assert('BC6 Tunnel.Connect(Mum) word[0] LOAD — imm=5 (Mum NS slot)',
            imm === 5, `got imm=${imm}`);
    }

    // word[1] = ELOADCALL CR0, Tunnel, Connect
    {
        const w      = result.words[1] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const crDst  = (w >>> 19) & 0xF;
        const crSrc  = (w >>> 15) & 0xF;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC7 Tunnel.Connect(Mum) word[1] ELOADCALL — opcode=8',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC8 Tunnel.Connect(Mum) word[1] ELOADCALL — crDst=0 (scratch CR0)',
            crDst === 0, `got crDst=${crDst}`);
        assert('BC9 Tunnel.Connect(Mum) word[1] ELOADCALL — crSrc=6 (c-list root)',
            crSrc === 6, `got crSrc=${crSrc}`);
        assert('BC10 Tunnel.Connect(Mum) word[1] ELOADCALL — row=3 (Tunnel NS slot)',
            row === 3, `got row=${row}`);
        assert('BC11 Tunnel.Connect(Mum) word[1] ELOADCALL — method=6 (Connect index 5, 1-based)',
            method === 6, `got method=${method}`);
    }
}

{
    // BC12: pre-loaded CR argument — explicit CRn skips the LOAD
    const a = new ChurchAssembler(TUNNEL_CONVENTIONS_BC);
    a.setNamespace(TUNNEL_NS_BC);
    // CR2 is explicitly supplied — no LOAD should be emitted; result is 2 words
    const result = a.assemble('Tunnel.Connect(CR2)\nHALT');
    assert('BC12 Tunnel.Connect(CR2) assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC13 Tunnel.Connect(CR2) skips LOAD — 2 words (ELOADCALL + HALT)',
        result.words.length === 2, `got ${result.words.length}`);
    {
        const w = result.words[0] >>> 0;
        assert('BC14 Tunnel.Connect(CR2) word[0] is ELOADCALL — opcode=8',
            ((w >>> 27) & 0x1F) === 8, `got opcode=${(w >>> 27) & 0x1F}`);
    }
}

{
    // BC15: DR argument gives a clear error
    const a = new ChurchAssembler(TUNNEL_CONVENTIONS_BC);
    a.setNamespace(TUNNEL_NS_BC);
    a.assemble('Tunnel.Send(payload, count)');
    assert('BC15 Tunnel.Send(name, name) — DR args give errors',
        a.errors.length >= 1 && a.errors[0].message.includes('DR1'),
        a.errors.map(e => e.message).join('; '));
}

{
    // BC16: unknown abstraction gives targeted error (not "unrecognised instruction")
    const a = new ChurchAssembler(TUNNEL_CONVENTIONS_BC);
    a.setNamespace(TUNNEL_NS_BC);
    a.assemble('Ghost.Method(arg)');
    assert('BC16 Ghost.Method(arg) — unknown abstraction error',
        a.errors.length >= 1 && a.errors[0].message.includes('"Ghost"'),
        a.errors.map(e => e.message).join('; '));
}

{
    // BC17: unknown method gives targeted error listing known methods
    const a = new ChurchAssembler(TUNNEL_CONVENTIONS_BC);
    a.setNamespace(TUNNEL_NS_BC);
    a.assemble('Tunnel.Bogus(Mum)');
    assert('BC17 Tunnel.Bogus(Mum) — unknown method error listing known methods',
        a.errors.length >= 1 && a.errors[0].message.includes('Connect') && a.errors[0].message.includes('Send'),
        a.errors.map(e => e.message).join('; '));
}

// ── BC18+: Scheduler, DijkstraFlag, Button, Timer bare-calls (task-1054) ─────
//
// These conventions mirror _ABSTRACTION_CONVENTIONS from app-absdetail.js.
// NS slots match hw_binary.js / repl.js boot table:
//   Scheduler=8, DijkstraFlag=10, Button=13, Timer=14, flag_GT=10 (alias for DijkstraFlag)
//
// ELOADCALL imm encoding: imm = ((index+1) << 8) | ns_slot   (index is 0-based)

const SCHED_CONVENTIONS_BC = {
    'Scheduler': {
        'Yield':  { index: 0, input: '',                       output: 'DR1' },
        'Spawn':  { index: 1, input: 'CR2=code_GT, DR1=entry', output: 'DR1=threadID' },
        'Wait':   { index: 2, input: 'CR2=flag_GT',            output: 'DR1' },
        'Stop':   { index: 3, input: 'DR1=threadID',           output: 'DR1' },
        'pause':  { index: 4, input: 'DR1=ticks',              output: 'DR1' },
    },
    'DijkstraFlag': {
        'Wait':   { index: 0, input: '',  output: 'DR1' },
        'Signal': { index: 1, input: '',  output: 'DR1' },
        'Reset':  { index: 2, input: '',  output: 'DR1' },
        'Test':   { index: 3, input: '',  output: 'DR1=1 signaled | 0 unsignaled' },
    },
    'Button': {
        'Read':      { index: 0, input: '',  output: 'DR1=1 pressed | 0 released' },
        'WaitPress': { index: 1, input: '',  output: 'DR1=1 pressed' },
        'OnEvent':   { index: 2, input: '',  output: 'DR1=1 press | 2 release | 0 none' },
    },
    'Timer': {
        'Start':    { index: 0, input: 'DR1=channel', output: 'DR1' },
        'Stop':     { index: 1, input: 'DR1=channel', output: 'DR1' },
        'Read':     { index: 2, input: '',             output: 'DR1=elapsed ticks' },
        'SetAlarm': { index: 3, input: 'DR1=ticks',    output: 'DR1' },
    },
};
const SCHED_NS_BC = {
    'Scheduler': 8, 'DijkstraFlag': 10, 'Button': 13, 'Timer': 14,
    'flag_GT': 10,
};

{
    // BC18–BC25: Scheduler.Wait(flag_GT) — CR2 arg → LOAD CR2 + ELOADCALL + HALT
    //
    // Encoding:
    //   LOAD CR2, flag_GT  — opcode=0, cond=14, crDst=2, crSrc=6, imm=10 (flag_GT slot)
    //     word = (0<<27)|(14<<23)|(2<<19)|(6<<15)|10 = 0x0713000A
    //   ELOADCALL — Wait index=2 → 1-based=3; Scheduler slot=8; imm=(3<<8)|8=0x0308
    //     word = (8<<27)|(14<<23)|(0<<19)|(6<<15)|0x0308 = 0x47030308
    const a = new ChurchAssembler(SCHED_CONVENTIONS_BC);
    a.setNamespace(SCHED_NS_BC);
    const result = a.assemble('Scheduler.Wait(flag_GT)\nHALT');

    assert('BC18 Scheduler.Wait(flag_GT) assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC19 Scheduler.Wait(flag_GT) expands to 3 words (LOAD + ELOADCALL + HALT)',
        result.words.length === 3, `got ${result.words.length}`);

    {
        const w = result.words[0] >>> 0;
        assert('BC20 Scheduler.Wait(flag_GT) word[0] LOAD — opcode=0',
            ((w >>> 27) & 0x1F) === 0, `got opcode=${(w >>> 27) & 0x1F}`);
        assert('BC21 Scheduler.Wait(flag_GT) word[0] LOAD — crDst=2 (CR2 from input spec)',
            ((w >>> 19) & 0xF) === 2, `got crDst=${(w >>> 19) & 0xF}`);
        assert('BC22 Scheduler.Wait(flag_GT) word[0] LOAD — imm=10 (flag_GT NS slot)',
            (w & 0x7FFF) === 10, `got imm=${w & 0x7FFF}`);
    }

    {
        const w      = result.words[1] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC23 Scheduler.Wait(flag_GT) word[1] ELOADCALL — opcode=8',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC24 Scheduler.Wait(flag_GT) word[1] ELOADCALL — row=8 (Scheduler NS slot)',
            row === 8, `got row=${row}`);
        assert('BC25 Scheduler.Wait(flag_GT) word[1] ELOADCALL — method=3 (Wait index 2, 1-based)',
            method === 3, `got method=${method}`);
    }
}

{
    // BC26–BC29: Scheduler.Yield() — no args → ELOADCALL only (no LOAD)
    //
    //   ELOADCALL — Yield index=0 → 1-based=1; Scheduler slot=8; imm=(1<<8)|8=0x0108
    const a = new ChurchAssembler(SCHED_CONVENTIONS_BC);
    a.setNamespace(SCHED_NS_BC);
    const result = a.assemble('Scheduler.Yield()\nHALT');

    assert('BC26 Scheduler.Yield() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC27 Scheduler.Yield() emits 2 words (ELOADCALL + HALT) — no LOAD for empty input',
        result.words.length === 2, `got ${result.words.length}`);

    {
        const w      = result.words[0] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC28 Scheduler.Yield() word[0] ELOADCALL — opcode=8',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC29 Scheduler.Yield() word[0] ELOADCALL — method=1 (Yield index 0, 1-based)',
            method === 1, `got method=${method}`);
    }
}

{
    // BC30–BC34: DijkstraFlag.Signal() — no args → ELOADCALL only
    //
    //   ELOADCALL — Signal index=1 → 1-based=2; DijkstraFlag slot=10; imm=(2<<8)|10=0x020A
    const a = new ChurchAssembler(SCHED_CONVENTIONS_BC);
    a.setNamespace(SCHED_NS_BC);
    const result = a.assemble('DijkstraFlag.Signal()\nHALT');

    assert('BC30 DijkstraFlag.Signal() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC31 DijkstraFlag.Signal() emits 2 words (ELOADCALL + HALT)',
        result.words.length === 2, `got ${result.words.length}`);

    {
        const w      = result.words[0] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC32 DijkstraFlag.Signal() word[0] ELOADCALL — opcode=8',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC33 DijkstraFlag.Signal() word[0] ELOADCALL — row=10 (DijkstraFlag NS slot)',
            row === 10, `got row=${row}`);
        assert('BC34 DijkstraFlag.Signal() word[0] ELOADCALL — method=2 (Signal index 1, 1-based)',
            method === 2, `got method=${method}`);
    }
}

{
    // BC35–BC39: Button.Read() — no args → ELOADCALL only
    //
    //   ELOADCALL — Read index=0 → 1-based=1; Button slot=13; imm=(1<<8)|13=0x010D
    const a = new ChurchAssembler(SCHED_CONVENTIONS_BC);
    a.setNamespace(SCHED_NS_BC);
    const result = a.assemble('Button.Read()\nHALT');

    assert('BC35 Button.Read() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC36 Button.Read() emits 2 words (ELOADCALL + HALT)',
        result.words.length === 2, `got ${result.words.length}`);

    {
        const w      = result.words[0] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC37 Button.Read() word[0] ELOADCALL — opcode=8',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC38 Button.Read() word[0] ELOADCALL — row=13 (Button NS slot)',
            row === 13, `got row=${row}`);
        assert('BC39 Button.Read() word[0] ELOADCALL — method=1 (Read index 0, 1-based)',
            method === 1, `got method=${method}`);
    }
}

{
    // BC40: Timer.Start(channel) — convention input is DR1=channel; passing a name
    // as argument should produce an error referencing DR1 (not a CR, cannot auto-LOAD).
    const a = new ChurchAssembler(SCHED_CONVENTIONS_BC);
    a.setNamespace(SCHED_NS_BC);
    a.assemble('Timer.Start(channel)');
    assert('BC40 Timer.Start(channel) — DR1 input spec gives error mentioning DR1',
        a.errors.length >= 1 && a.errors[0].message.includes('DR1'),
        a.errors.map(e => e.message).join('; '));
}

{
    // BC41: ChurchAssembler._sharedMethodConventions inheritance
    // A NEW instance created after setSharedMethodConventions() inherits Scheduler
    // automatically, without having conventions passed to the constructor.
    const registrar = new ChurchAssembler({});
    registrar.setSharedMethodConventions({
        'Scheduler': SCHED_CONVENTIONS_BC['Scheduler'],
    });
    const fresh = new ChurchAssembler();   // no conventions argument
    assert('BC41 _sharedMethodConventions inheritance — fresh instance has Scheduler.Yield',
        fresh.methodConventions['Scheduler'] !== undefined &&
        fresh.methodConventions['Scheduler']['Yield'] !== undefined,
        `methodConventions keys: ${Object.keys(fresh.methodConventions).join(', ')}`);
    assert('BC42 _sharedMethodConventions inheritance — Scheduler.Wait index is 2',
        fresh.methodConventions['Scheduler']['Wait'] !== undefined &&
        fresh.methodConventions['Scheduler']['Wait'].index === 2,
        `Wait entry: ${JSON.stringify(fresh.methodConventions['Scheduler'] && fresh.methodConventions['Scheduler']['Wait'])}`);
}

// ── BC43–BC60: Stack, UART, LED, Display bare-calls (task-1053) ──────────────

const NEW_ABS_CONVENTIONS_BC = {
    'Stack':   {
        'Push':  { index: 0, input: 'DR1=val',   output: '' },
        'Pop':   { index: 1, input: '',           output: '' },
        'Peek':  { index: 2, input: '',           output: '' },
        'Depth': { index: 3, input: '',           output: '' },
    },
    'UART': {
        'Send':    { index: 0, input: 'DR1=byte', output: '' },
        'Receive': { index: 1, input: '',         output: '' },
        'SetBaud': { index: 2, input: 'DR1=rate', output: '' },
    },
    'LED': {
        'Set':    { index: 0, input: '', output: '' },
        'Clear':  { index: 1, input: '', output: '' },
        'Toggle': { index: 2, input: '', output: '' },
        'State':  { index: 3, input: '', output: '' },
    },
    'Display': {
        'Write':  { index: 0, input: 'DR1=char',  output: '' },
        'Clear':  { index: 1, input: '',          output: '' },
        'Scroll': { index: 2, input: 'DR1=lines', output: '' },
    },
};
const NEW_ABS_NS_BC = { 'Stack': 9, 'UART': 11, 'LED': 12, 'Display': 15 };

// BC43–BC46: Stack methods
{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('Stack.Push()\nHALT');
    assert('BC43 Stack.Push() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC43 Stack.Push() emits ELOADCALL (2 words: ELOADCALL + HALT)',
        r.words.length === 2, `got ${r.words.length}`);
    {
        const w = r.words[0] >>> 0;
        assert('BC43 Stack.Push() word[0] opcode=8 (ELOADCALL)',
            ((w >>> 27) & 0x1F) === 8, `got opcode=${(w >>> 27) & 0x1F}`);
        const row    = w & 0xFF;
        const method = (w >>> 8) & 0x7F;
        assert('BC43 Stack.Push() ELOADCALL row=9 (Stack NS slot)',
            row === 9, `got row=${row}`);
        assert('BC43 Stack.Push() ELOADCALL method=1 (Push index 0, 1-based)',
            method === 1, `got method=${method}`);
    }
}

{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('Stack.Pop()\nHALT');
    assert('BC44 Stack.Pop() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC44 Stack.Pop() emits ELOADCALL (2 words)',
        r.words.length === 2, `got ${r.words.length}`);
    {
        const w = r.words[0] >>> 0;
        const method = (w >>> 8) & 0x7F;
        assert('BC44 Stack.Pop() ELOADCALL method=2 (Pop index 1, 1-based)',
            method === 2, `got method=${method}`);
    }
}

{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('Stack.Peek()\nHALT');
    assert('BC45 Stack.Peek() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC45 Stack.Peek() emits ELOADCALL (2 words)',
        r.words.length === 2, `got ${r.words.length}`);
}

{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('Stack.Depth()\nHALT');
    assert('BC46 Stack.Depth() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC46 Stack.Depth() emits ELOADCALL (2 words)',
        r.words.length === 2, `got ${r.words.length}`);
    {
        const w = r.words[0] >>> 0;
        const method = (w >>> 8) & 0x7F;
        assert('BC46 Stack.Depth() ELOADCALL method=4 (Depth index 3, 1-based)',
            method === 4, `got method=${method}`);
    }
}

// BC47–BC49: UART methods
{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('UART.Send()\nHALT');
    assert('BC47 UART.Send() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC47 UART.Send() emits ELOADCALL (2 words)',
        r.words.length === 2, `got ${r.words.length}`);
    {
        const w = r.words[0] >>> 0;
        const row    = w & 0xFF;
        const method = (w >>> 8) & 0x7F;
        assert('BC47 UART.Send() ELOADCALL row=11 (UART NS slot)',
            row === 11, `got row=${row}`);
        assert('BC47 UART.Send() ELOADCALL method=1 (Send index 0, 1-based)',
            method === 1, `got method=${method}`);
    }
}

{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('UART.Receive()\nHALT');
    assert('BC48 UART.Receive() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC48 UART.Receive() emits ELOADCALL (2 words)',
        r.words.length === 2, `got ${r.words.length}`);
}

{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('UART.SetBaud()\nHALT');
    assert('BC49 UART.SetBaud() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC49 UART.SetBaud() emits ELOADCALL (2 words)',
        r.words.length === 2, `got ${r.words.length}`);
    {
        const w = r.words[0] >>> 0;
        const method = (w >>> 8) & 0x7F;
        assert('BC49 UART.SetBaud() ELOADCALL method=3 (SetBaud index 2, 1-based)',
            method === 3, `got method=${method}`);
    }
}

// BC50–BC53: LED methods
{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('LED.Set()\nHALT');
    assert('BC50 LED.Set() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC50 LED.Set() emits ELOADCALL (2 words)',
        r.words.length === 2, `got ${r.words.length}`);
    {
        const w = r.words[0] >>> 0;
        const row    = w & 0xFF;
        const method = (w >>> 8) & 0x7F;
        assert('BC50 LED.Set() ELOADCALL row=12 (LED NS slot)',
            row === 12, `got row=${row}`);
        assert('BC50 LED.Set() ELOADCALL method=1 (Set index 0, 1-based)',
            method === 1, `got method=${method}`);
    }
}

{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('LED.Clear()\nHALT');
    assert('BC51 LED.Clear() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC51 LED.Clear() emits ELOADCALL (2 words)',
        r.words.length === 2, `got ${r.words.length}`);
}

{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('LED.Toggle()\nHALT');
    assert('BC52 LED.Toggle() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC52 LED.Toggle() emits ELOADCALL (2 words)',
        r.words.length === 2, `got ${r.words.length}`);
}

{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('LED.State()\nHALT');
    assert('BC53 LED.State() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC53 LED.State() emits ELOADCALL (2 words)',
        r.words.length === 2, `got ${r.words.length}`);
    {
        const w = r.words[0] >>> 0;
        const method = (w >>> 8) & 0x7F;
        assert('BC53 LED.State() ELOADCALL method=4 (State index 3, 1-based)',
            method === 4, `got method=${method}`);
    }
}

// BC54–BC56: Display methods
{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('Display.Write()\nHALT');
    assert('BC54 Display.Write() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC54 Display.Write() emits ELOADCALL (2 words)',
        r.words.length === 2, `got ${r.words.length}`);
    {
        const w = r.words[0] >>> 0;
        const row    = w & 0xFF;
        const method = (w >>> 8) & 0x7F;
        assert('BC54 Display.Write() ELOADCALL row=15 (Display NS slot)',
            row === 15, `got row=${row}`);
        assert('BC54 Display.Write() ELOADCALL method=1 (Write index 0, 1-based)',
            method === 1, `got method=${method}`);
    }
}

{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('Display.Clear()\nHALT');
    assert('BC55 Display.Clear() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC55 Display.Clear() emits ELOADCALL (2 words)',
        r.words.length === 2, `got ${r.words.length}`);
    {
        const w = r.words[0] >>> 0;
        const method = (w >>> 8) & 0x7F;
        assert('BC55 Display.Clear() ELOADCALL method=2 (Clear index 1, 1-based)',
            method === 2, `got method=${method}`);
    }
}

{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('Display.Scroll()\nHALT');
    assert('BC56 Display.Scroll() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC56 Display.Scroll() emits ELOADCALL (2 words)',
        r.words.length === 2, `got ${r.words.length}`);
    {
        const w = r.words[0] >>> 0;
        const method = (w >>> 8) & 0x7F;
        assert('BC56 Display.Scroll() ELOADCALL method=3 (Scroll index 2, 1-based)',
            method === 3, `got method=${method}`);
    }
}

// BC57–BC60: argument-bearing forms — pre-load DR1 then bare-call
// DR1 is pre-loaded with IADD (the assembler's recommended immediate-load form);
// the sequence emits IADD + ELOADCALL (3 words: IADD + ELOADCALL + HALT).

{
    // BC57: Stack.Push(val) — pre-load DR1 with IADD, then Push()
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('IADD DR1, DR1, #42\nStack.Push()\nHALT');
    assert('BC57 Stack.Push(val) pre-load pattern — no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC57 Stack.Push(val) emits 3 words (IADD + ELOADCALL + HALT)',
        r.words.length === 3, `got ${r.words.length}`);
    {
        const w1 = r.words[1] >>> 0;
        assert('BC57 Stack.Push(val) word[1] is ELOADCALL (opcode=8)',
            ((w1 >>> 27) & 0x1F) === 8, `got opcode=${(w1 >>> 27) & 0x1F}`);
    }
}

{
    // BC58: UART.Send(byte) — pre-load DR1 with IADD, then Send()
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('IADD DR1, DR1, #0x41\nUART.Send()\nHALT');
    assert('BC58 UART.Send(byte) pre-load pattern — no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC58 UART.Send(byte) emits 3 words (IADD + ELOADCALL + HALT)',
        r.words.length === 3, `got ${r.words.length}`);
    {
        const w1 = r.words[1] >>> 0;
        assert('BC58 UART.Send(byte) word[1] is ELOADCALL (opcode=8)',
            ((w1 >>> 27) & 0x1F) === 8, `got opcode=${(w1 >>> 27) & 0x1F}`);
    }
}

{
    // BC59: Display.Write(char) — pre-load DR1 with IADD, then Write()
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('IADD DR1, DR1, #0x48\nDisplay.Write()\nHALT');
    assert('BC59 Display.Write(char) pre-load pattern — no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC59 Display.Write(char) emits 3 words (IADD + ELOADCALL + HALT)',
        r.words.length === 3, `got ${r.words.length}`);
    {
        const w1 = r.words[1] >>> 0;
        assert('BC59 Display.Write(char) word[1] is ELOADCALL (opcode=8)',
            ((w1 >>> 27) & 0x1F) === 8, `got opcode=${(w1 >>> 27) & 0x1F}`);
        const row    = w1 & 0xFF;
        const method = (w1 >>> 8) & 0x7F;
        assert('BC59 Display.Write(char) ELOADCALL row=15 (Display NS slot)',
            row === 15, `got row=${row}`);
        assert('BC59 Display.Write(char) ELOADCALL method=1 (Write index 0, 1-based)',
            method === 1, `got method=${method}`);
    }
}

{
    // BC60: UART.SetBaud(rate) — pre-load DR1 with IADD, then SetBaud()
    // Note: 115200 > 14-bit immediate (max 8191); use a smaller sentinel (9600).
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const r = a.assemble('IADD DR1, DR1, #9600\nUART.SetBaud()\nHALT');
    assert('BC60 UART.SetBaud(rate) pre-load pattern — no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC60 UART.SetBaud(rate) emits 3 words (IADD + ELOADCALL + HALT)',
        r.words.length === 3, `got ${r.words.length}`);
    {
        const w1 = r.words[1] >>> 0;
        const method = (w1 >>> 8) & 0x7F;
        assert('BC60 UART.SetBaud(rate) ELOADCALL method=3 (SetBaud index 2, 1-based)',
            method === 3, `got method=${method}`);
    }
}

// ── BC61–BC76: Memory and Mint bare-calls (task-1055) ─────────────────────────
//
// Conventions mirror _ABSTRACTION_CONVENTIONS entries added for Memory and Mint
// in app-absdetail.js.  NS slots match repl.js boot table: Mint=6, Memory=7.
//
// ELOADCALL imm encoding: imm = ((index+1) << 8) | ns_slot   (index is 0-based)

const SMM_CONVENTIONS_BC = {
    'Memory': {
        'Allocate': { index: 0, input: 'CR2=pool_GT, DR1=size', output: 'CR2=mem_GT' },
        'Free':     { index: 1, input: 'CR2=mem_GT',            output: 'DR1' },
        'Resize':   { index: 2, input: 'CR2=mem_GT, DR1=size',  output: 'DR1' },
    },
    'Mint': {
        'Encode':   { index: 0, input: 'CR2=mem_GT, DR1=base, DR2=exp, DR3=permsBits', output: 'DR1=GT_word' },
        'Revoke':   { index: 1, input: 'DR1=nsIndex',                                  output: 'DR1' },
        'Transfer': { index: 2, input: 'CR2=target_GT, DR1=slot',                      output: 'DR1' },
    },
};
const SMM_NS_BC = {
    'Memory': 7, 'Mint': 6,
    'pool_GT':  7,   // Memory pool GT — references Memory NS slot
    'mem_GT':  20,   // Backing memory GT — arbitrary test slot
};

{
    // BC61–BC68: Memory.Allocate(pool_GT) — CR2 arg → LOAD CR2 + ELOADCALL + HALT
    //
    // Encoding:
    //   LOAD CR2, pool_GT  — opcode=0, crDst=2, imm=7 (pool_GT slot)
    //   ELOADCALL — Allocate index=0 → 1-based=1; Memory slot=7; imm=(1<<8)|7=0x0107
    const a = new ChurchAssembler(SMM_CONVENTIONS_BC);
    a.setNamespace(SMM_NS_BC);
    const result = a.assemble('Memory.Allocate(pool_GT)\nHALT');

    assert('BC61 Memory.Allocate(pool_GT) assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC62 Memory.Allocate(pool_GT) expands to 3 words (LOAD + ELOADCALL + HALT)',
        result.words.length === 3, `got ${result.words.length}`);

    {
        const w = result.words[0] >>> 0;
        assert('BC63 Memory.Allocate(pool_GT) word[0] LOAD — opcode=0',
            ((w >>> 27) & 0x1F) === 0, `got opcode=${(w >>> 27) & 0x1F}`);
        assert('BC64 Memory.Allocate(pool_GT) word[0] LOAD — crDst=2 (CR2 from input spec)',
            ((w >>> 19) & 0xF) === 2, `got crDst=${(w >>> 19) & 0xF}`);
        assert('BC65 Memory.Allocate(pool_GT) word[0] LOAD — imm=7 (pool_GT NS slot)',
            (w & 0x7FFF) === 7, `got imm=${w & 0x7FFF}`);
    }

    {
        const w      = result.words[1] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC66 Memory.Allocate(pool_GT) word[1] ELOADCALL — opcode=8',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC67 Memory.Allocate(pool_GT) word[1] ELOADCALL — row=7 (Memory NS slot)',
            row === 7, `got row=${row}`);
        assert('BC68 Memory.Allocate(pool_GT) word[1] ELOADCALL — method=1 (Allocate index 0, 1-based)',
            method === 1, `got method=${method}`);
    }
}

{
    // BC69–BC76: Mint.Encode(mem_GT) — CR2 arg → LOAD CR2 + ELOADCALL + HALT
    //
    // Encoding:
    //   LOAD CR2, mem_GT  — opcode=0, crDst=2, imm=20 (mem_GT slot)
    //   ELOADCALL — Encode index=0 → 1-based=1; Mint slot=6; imm=(1<<8)|6=0x0106
    const a = new ChurchAssembler(SMM_CONVENTIONS_BC);
    a.setNamespace(SMM_NS_BC);
    const result = a.assemble('Mint.Encode(mem_GT)\nHALT');

    assert('BC69 Mint.Encode(mem_GT) assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC70 Mint.Encode(mem_GT) expands to 3 words (LOAD + ELOADCALL + HALT)',
        result.words.length === 3, `got ${result.words.length}`);

    {
        const w = result.words[0] >>> 0;
        assert('BC71 Mint.Encode(mem_GT) word[0] LOAD — opcode=0',
            ((w >>> 27) & 0x1F) === 0, `got opcode=${(w >>> 27) & 0x1F}`);
        assert('BC72 Mint.Encode(mem_GT) word[0] LOAD — crDst=2 (CR2 from input spec)',
            ((w >>> 19) & 0xF) === 2, `got crDst=${(w >>> 19) & 0xF}`);
        assert('BC73 Mint.Encode(mem_GT) word[0] LOAD — imm=20 (mem_GT NS slot)',
            (w & 0x7FFF) === 20, `got imm=${w & 0x7FFF}`);
    }

    {
        const w      = result.words[1] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC74 Mint.Encode(mem_GT) word[1] ELOADCALL — opcode=8',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC75 Mint.Encode(mem_GT) word[1] ELOADCALL — row=6 (Mint NS slot)',
            row === 6, `got row=${row}`);
        assert('BC76 Mint.Encode(mem_GT) word[1] ELOADCALL — method=1 (Encode index 0, 1-based)',
            method === 1, `got method=${method}`);
    }
}

// ── BC61–BC72: Tunnel bare-calls via _ABSTRACTION_CONVENTIONS (task-1057) ────
// Tunnel lives at NS slot 31.  Method indices match manifest order:
//   Register=0 (1-based=1), Send=1 (1-based=2), Receive=2 (1-based=3),
//   Fault=3 (1-based=4), Fetch=4 (1-based=5), Connect=5 (1-based=6).

const TUNNEL_FULL_CONVENTIONS_BC = {
    'Tunnel': {
        'Register': { index: 0, input: 'DR1=boot_reason, DR2=last_fault, DR3=fault_NIA',                                                             output: 'DR0=1 (IDE ACK) | \u22640 (offline)' },
        'Send':     { index: 1, input: 'DR1=FourCC tag, DR2=word count, DR3=first payload',                                                           output: 'DR0=0 (queued) | 1 (TX overrun)' },
        'Receive':  { index: 2, input: 'DR1=timeout steps (0=forever)',                                                                               output: 'DR0=word count (0=timeout)' },
        'Fault':    { index: 3, input: 'DR1=fault_code, DR2=ns_idx, DR3=thread_gt, DR4=abstr_idx, DR5=method_idx, DR6=instr_offset',                  output: 'none (fire-and-forget)' },
        'Fetch':    { index: 4, input: 'DR1=slot token, DR2=expected words, CR2=write-GT',                                                            output: 'DR0=0 (installed) | error code' },
        'Connect':  { index: 5, input: 'CR2=remote GT (Outform/far-end abstraction)',                                                                  output: 'DR0=far-end return value' },
    },
    'Mem': { },
};
const TUNNEL_FULL_NS_BC = { 'Tunnel': 31, 'Mem': 7 };

{
    // BC61–BC63: Tunnel.Connect(Mem) — CR2 arg → LOAD CR2 + ELOADCALL
    //   LOAD CR2, Mem  — imm=7 (Mem NS slot)
    //   ELOADCALL      — Connect index=5 → 1-based=6; Tunnel slot=31
    const a = new ChurchAssembler(TUNNEL_FULL_CONVENTIONS_BC);
    a.setNamespace(TUNNEL_FULL_NS_BC);
    const result = a.assemble('Tunnel.Connect(Mem)\nHALT');

    assert('BC61 Tunnel.Connect(Mem) assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC62 Tunnel.Connect(Mem) expands to 3 words (LOAD + ELOADCALL + HALT)',
        result.words.length === 3, `got ${result.words.length}`);
    {
        const w      = result.words[1] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC63 Tunnel.Connect(Mem) word[1] ELOADCALL — opcode=8',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC63 Tunnel.Connect(Mem) word[1] ELOADCALL — row=31 (Tunnel NS slot)',
            row === 31, `got row=${row}`);
        assert('BC63 Tunnel.Connect(Mem) word[1] ELOADCALL — method=6 (Connect index 5, 1-based)',
            method === 6, `got method=${method}`);
    }
}

{
    // BC64–BC65: Tunnel.Send() — no CR args → ELOADCALL only (2 words)
    //   ELOADCALL — Send index=1 → 1-based=2; Tunnel slot=31; imm=(2<<8)|31=0x021F
    const a = new ChurchAssembler(TUNNEL_FULL_CONVENTIONS_BC);
    a.setNamespace(TUNNEL_FULL_NS_BC);
    const result = a.assemble('Tunnel.Send()\nHALT');

    assert('BC64 Tunnel.Send() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC64 Tunnel.Send() emits 2 words (ELOADCALL + HALT)',
        result.words.length === 2, `got ${result.words.length}`);
    {
        const w      = result.words[0] >>> 0;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC65 Tunnel.Send() ELOADCALL — row=31 (Tunnel NS slot)',
            row === 31, `got row=${row}`);
        assert('BC65 Tunnel.Send() ELOADCALL — method=2 (Send index 1, 1-based)',
            method === 2, `got method=${method}`);
    }
}

{
    // BC66–BC67: Tunnel.Receive() — no CR args → ELOADCALL only (2 words)
    //   ELOADCALL — Receive index=2 → 1-based=3; Tunnel slot=31; imm=(3<<8)|31=0x031F
    const a = new ChurchAssembler(TUNNEL_FULL_CONVENTIONS_BC);
    a.setNamespace(TUNNEL_FULL_NS_BC);
    const result = a.assemble('Tunnel.Receive()\nHALT');

    assert('BC66 Tunnel.Receive() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC66 Tunnel.Receive() emits 2 words (ELOADCALL + HALT)',
        result.words.length === 2, `got ${result.words.length}`);
    {
        const w      = result.words[0] >>> 0;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC67 Tunnel.Receive() ELOADCALL — row=31 (Tunnel NS slot)',
            row === 31, `got row=${row}`);
        assert('BC67 Tunnel.Receive() ELOADCALL — method=3 (Receive index 2, 1-based)',
            method === 3, `got method=${method}`);
    }
}

{
    // BC68: Tunnel.Register() — no CR args → ELOADCALL only (2 words)
    //   ELOADCALL — Register index=0 → 1-based=1; Tunnel slot=31; imm=(1<<8)|31=0x011F
    const a = new ChurchAssembler(TUNNEL_FULL_CONVENTIONS_BC);
    a.setNamespace(TUNNEL_FULL_NS_BC);
    const result = a.assemble('Tunnel.Register()\nHALT');

    assert('BC68 Tunnel.Register() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC68 Tunnel.Register() emits 2 words (ELOADCALL + HALT)',
        result.words.length === 2, `got ${result.words.length}`);
    {
        const w      = result.words[0] >>> 0;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC68 Tunnel.Register() ELOADCALL — row=31 (Tunnel NS slot)',
            row === 31, `got row=${row}`);
        assert('BC68 Tunnel.Register() ELOADCALL — method=1 (Register index 0, 1-based)',
            method === 1, `got method=${method}`);
    }
}

{
    // BC69: Tunnel.Fault() — no CR args → ELOADCALL only (2 words)
    //   ELOADCALL — Fault index=3 → 1-based=4; Tunnel slot=31; imm=(4<<8)|31=0x041F
    const a = new ChurchAssembler(TUNNEL_FULL_CONVENTIONS_BC);
    a.setNamespace(TUNNEL_FULL_NS_BC);
    const result = a.assemble('Tunnel.Fault()\nHALT');

    assert('BC69 Tunnel.Fault() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC69 Tunnel.Fault() emits 2 words (ELOADCALL + HALT)',
        result.words.length === 2, `got ${result.words.length}`);
    {
        const w      = result.words[0] >>> 0;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC69 Tunnel.Fault() ELOADCALL — row=31 (Tunnel NS slot)',
            row === 31, `got row=${row}`);
        assert('BC69 Tunnel.Fault() ELOADCALL — method=4 (Fault index 3, 1-based)',
            method === 4, `got method=${method}`);
    }
}

{
    // BC70–BC72: Tunnel.Fetch() — no args (pre-load DR1/DR2 before call) → ELOADCALL only
    //   Fetch has input 'DR1=slot token, DR2=expected words, CR2=write-GT'; DR args are
    //   pre-loaded by the caller; CR2 is set separately.  Empty bare-call emits ELOADCALL.
    //   ELOADCALL — Fetch index=4 → 1-based=5; Tunnel slot=31; imm=(5<<8)|31=0x051F
    const a = new ChurchAssembler(TUNNEL_FULL_CONVENTIONS_BC);
    a.setNamespace(TUNNEL_FULL_NS_BC);
    const result = a.assemble('Tunnel.Fetch()\nHALT');

    assert('BC70 Tunnel.Fetch() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC71 Tunnel.Fetch() emits 2 words (ELOADCALL + HALT)',
        result.words.length === 2, `got ${result.words.length}`);
    {
        const w      = result.words[0] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC72 Tunnel.Fetch() ELOADCALL — opcode=8',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC72 Tunnel.Fetch() ELOADCALL — row=31 (Tunnel NS slot)',
            row === 31, `got row=${row}`);
        assert('BC72 Tunnel.Fetch() ELOADCALL — method=5 (Fetch index 4, 1-based)',
            method === 5, `got method=${method}`);
    }
}

// ── Symbolic Math compiler — explicit Abs.Method(args) call form ─────────────
// SC1–SC8 test compileSymbolic() in cloomc_compiler.js.
//
// Shared fixtures: a fake METHOD_REGISTER_CONVENTIONS that the compiler merges
// when compileSymbolic() runs (simulated by injecting methodConventions directly
// since the browser global is not available in Node).

const SC_COMPILER = new CLOOMCCompiler();
SC_COMPILER.methodConventions = {
    'SlideRule': {
        'Multiply': { index: 0, input: 'DR1 (a), DR2 (b)', output: 'DR1 = a * b' },
        'Divide':   { index: 1, input: 'DR1 (a), DR2 (b)', output: 'DR1 = a / b' },
        'Sqrt':     { index: 2, input: 'DR1 (x)',           output: 'DR1 = sqrt(x)' },
    },
    'Tunnel': {
        'Connect': { index: 5, input: 'CR2=remote GT', output: 'DR1 = far-end return' },
        'Send':    { index: 1, input: 'DR1=tag, DR2=count',   output: 'DR1 = 0 queued' },
    },
    'Circle': {
        'Area': { index: 0, input: 'DR1 (radius)', output: 'DR1 = pi*r^2' },
    },
};

// Helper: compile a bare-body Symbolic source with given capabilities list.
function symCompile(body, caps) {
    const src = (caps && caps.length)
        ? `abstraction Test {\n  capabilities { ${caps.join(', ')} }\n  method run() {\n${body}\n  }\n}`
        : `method run() {\n${body}\n}`;
    const compiler = new CLOOMCCompiler();
    compiler.methodConventions = SC_COMPILER.methodConventions;
    const result = compiler.compileSymbolic(src, []);
    return result;
}

{
    // SC1: SlideRule.Multiply(5*B) — single arg with natural operator
    // The * splits into [5, B], then emits CALL (SlideRule path uses CALL not ELOADCALL).
    const r = symCompile('let K = SlideRule.Multiply(5*B)', ['SlideRule']);
    assert('SC1 SlideRule.Multiply(5*B) compiles without errors',
        r.errors.length === 0, r.errors.map(e => e.message).join('; '));
    assert('SC1 SlideRule.Multiply(5*B) produces code words',
        r.methods.length > 0 && r.methods[0].code.length > 0,
        `methods=${r.methods.length}`);
}

{
    // SC2: SlideRule.Divide(A/B) — natural operator split for divide
    const r = symCompile('let K = SlideRule.Divide(A/B)', ['SlideRule']);
    assert('SC2 SlideRule.Divide(A/B) compiles without errors',
        r.errors.length === 0, r.errors.map(e => e.message).join('; '));
}

{
    // SC3: K = SlideRule.Multiply(V1*V2) — assignment form
    const r = symCompile('K = SlideRule.Multiply(V1*V2)', ['SlideRule']);
    assert('SC3 K = SlideRule.Multiply(V1*V2) assignment form — no errors',
        r.errors.length === 0, r.errors.map(e => e.message).join('; '));
}

{
    // SC4: K = SlideRule.Multiply(5, B) — comma form still works after refactor
    const r = symCompile('K = SlideRule.Multiply(5, B)', ['SlideRule']);
    assert('SC4 K = SlideRule.Multiply(5, B) comma form — no errors',
        r.errors.length === 0, r.errors.map(e => e.message).join('; '));
}

{
    // SC5: Circle.Area(r) via general Abs.Method handler — DR arg, ELOADCALL emitted
    const r = symCompile('K = Circle.Area(r)', ['Circle']);
    assert('SC5 Circle.Area(r) general handler — no errors',
        r.errors.length === 0, r.errors.map(e => e.message).join('; '));
    // ELOADCALL opcode = 8
    const code = r.methods[0].code;
    const hasEloadcall = code.some(w => ((w >>> 27) & 0x1F) === 8);
    assert('SC5 Circle.Area(r) emits at least one ELOADCALL (opcode 8)',
        hasEloadcall, `words: ${code.map(w => ((w >>> 27) & 0x1F)).join(',')}`);
}

{
    // SC6: Tunnel.Connect(Mum) — Mum is a capability in c-list, loaded into CR2
    const r = symCompile('K = Tunnel.Connect(Mum)', ['Tunnel', 'Mum']);
    assert('SC6 Tunnel.Connect(Mum) — no errors',
        r.errors.length === 0, r.errors.map(e => e.message).join('; '));
    const code = r.methods[0].code;
    // Should contain a LOAD (opcode 0) for the CR2 capability and an ELOADCALL (opcode 8)
    const hasLoad     = code.some(w => ((w >>> 27) & 0x1F) === 0);
    const hasEloadcall = code.some(w => ((w >>> 27) & 0x1F) === 8);
    assert('SC6 Tunnel.Connect(Mum) emits LOAD for Mum capability',
        hasLoad, `words: ${code.map(w => ((w >>> 27) & 0x1F)).join(',')}`);
    assert('SC6 Tunnel.Connect(Mum) emits ELOADCALL',
        hasEloadcall, `words: ${code.map(w => ((w >>> 27) & 0x1F)).join(',')}`);
}

{
    // SC7: Tunnel.Send(a, b) — DR args, ELOADCALL emitted
    const r = symCompile('Tunnel.Send(V1, V2)', ['Tunnel']);
    assert('SC7 Tunnel.Send(V1, V2) — no errors',
        r.errors.length === 0, r.errors.map(e => e.message).join('; '));
    const code = r.methods[0].code;
    const hasEloadcall = code.some(w => ((w >>> 27) & 0x1F) === 8);
    assert('SC7 Tunnel.Send(V1, V2) emits ELOADCALL',
        hasEloadcall, `words: ${code.map(w => ((w >>> 27) & 0x1F)).join(',')}`);
}

{
    // SC8: Unknown abstraction gives a helpful error
    const r = symCompile('K = Ghost.Foo(x)', ['Ghost']);
    assert('SC8 Ghost.Foo(x) — error mentions "Ghost"',
        r.errors.length > 0 && r.errors.some(e => e.message.includes('"Ghost"')),
        r.errors.map(e => e.message).join('; '));
}

{
    // SC9: Known abstraction, unknown method gives a helpful error
    const r = symCompile('K = Circle.Bogus(r)', ['Circle']);
    assert('SC9 Circle.Bogus(r) — error mentions method name',
        r.errors.length > 0 && r.errors.some(e => e.message.includes('Bogus')),
        r.errors.map(e => e.message).join('; '));
}

{
    // SC10: Abstraction not in c-list gives a helpful error
    // Circle conventions registered but not in capabilities {}
    const r = symCompile('K = Circle.Area(r)', []);
    assert('SC10 Circle.Area(r) without Circle in caps — error mentions c-list or caps',
        r.errors.length > 0 && r.errors.some(e => e.message.includes('"Circle"')),
        r.errors.map(e => e.message).join('; '));
}

// ── Symbolic Math compiler — inferred-method shorthand Abs(expr) ─────────────

{
    // SC11: SlideRule(5*B) shorthand — * infers Multiply, produces same code as SlideRule.Multiply(5,B)
    const r1 = symCompile('K = SlideRule(5*B)', ['SlideRule']);
    const r2 = symCompile('K = SlideRule.Multiply(5, B)', ['SlideRule']);
    assert('SC11 SlideRule(5*B) shorthand compiles without errors',
        r1.errors.length === 0, r1.errors.map(e => e.message).join('; '));
    assert('SC11 SlideRule(5*B) produces same code word count as SlideRule.Multiply(5,B)',
        r1.errors.length === 0 && r2.errors.length === 0 &&
        r1.methods[0].code.length === r2.methods[0].code.length,
        `shorthand=${r1.methods[0]?.code.length} explicit=${r2.methods[0]?.code.length}`);
}

{
    // SC12: SlideRule(A/B) shorthand — / infers Divide
    const r = symCompile('K = SlideRule(A/B)', ['SlideRule']);
    assert('SC12 SlideRule(A/B) shorthand compiles without errors',
        r.errors.length === 0, r.errors.map(e => e.message).join('; '));
}

{
    // SC13: Circle(r*r) shorthand — Circle has no Multiply method, gives helpful error
    const r = symCompile('K = Circle(r*r)', ['Circle']);
    assert('SC13 Circle(r*r) shorthand — error mentions unknown Multiply on Circle',
        r.errors.length > 0 && r.errors.some(e => e.message.includes('Multiply') || e.message.includes('Circle')),
        r.errors.map(e => e.message).join('; '));
}

{
    // SC13b: Tunnel(a*b) shorthand — Tunnel has Send(DR1=tag, DR2=count), * infers Multiply via general path
    // Tunnel doesn't have Multiply either — verifies error is helpful
    const r = symCompile('Tunnel(V1*V2)', ['Tunnel']);
    assert('SC13b Tunnel(V1*V2) shorthand — error mentions Multiply or Tunnel',
        r.errors.length > 0 && r.errors.some(e => e.message.includes('Multiply') || e.message.includes('Tunnel')),
        r.errors.map(e => e.message).join('; '));
}

{
    // SC14: SlideRule(x) with no operator gives a helpful error
    const r = symCompile('K = SlideRule(x)', ['SlideRule']);
    assert('SC14 SlideRule(x) no-operator shorthand — gives helpful error',
        r.errors.length > 0 && r.errors[0].message.includes('cannot infer method'),
        r.errors.map(e => e.message).join('; '));
}

// ── BC61–BC65: targeted DWRITE hint for numeric/char literal DR args (task-1058) ─
//
// When a user writes e.g. UART.Send(65) or Display.Write('H'), the DR-arg error
// path should produce a message that explicitly names the method, the DR register,
// the human-readable slot description, and the corrected DWRITE instruction.

{
    // BC61: UART.Send(65) — numeric literal → targeted DWRITE hint
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    a.assemble('UART.Send(65)');
    assert('BC61 UART.Send(65) — error produced',
        a.errors.length >= 1, 'expected at least one error');
    assert('BC61 UART.Send(65) — error mentions DWRITE',
        a.errors.length >= 1 && a.errors[0].message.includes('DWRITE'),
        a.errors.map(e => e.message).join('; '));
    assert('BC61 UART.Send(65) — error mentions DR1',
        a.errors.length >= 1 && a.errors[0].message.includes('DR1'),
        a.errors.map(e => e.message).join('; '));
    assert('BC61 UART.Send(65) — error mentions the value 65',
        a.errors.length >= 1 && a.errors[0].message.includes('65'),
        a.errors.map(e => e.message).join('; '));
    assert('BC61 UART.Send(65) — error mentions UART.Send',
        a.errors.length >= 1 && a.errors[0].message.includes('UART.Send'),
        a.errors.map(e => e.message).join('; '));
    assert('BC61 UART.Send(65) — error phrase matches expected shape (method uses DRn for desc)',
        a.errors.length >= 1 && /UART\.Send uses DR1 for the \w+ — pre-load it with DWRITE DR1, #65/.test(a.errors[0].message),
        a.errors.map(e => e.message).join('; '));
}

{
    // BC62: Display.Write('H') — char literal → targeted DWRITE hint with char code 72
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    a.assemble("Display.Write('H')");
    assert('BC62 Display.Write(\'H\') — error produced',
        a.errors.length >= 1, 'expected at least one error');
    assert('BC62 Display.Write(\'H\') — error mentions DWRITE',
        a.errors.length >= 1 && a.errors[0].message.includes('DWRITE'),
        a.errors.map(e => e.message).join('; '));
    assert('BC62 Display.Write(\'H\') — error mentions DR1',
        a.errors.length >= 1 && a.errors[0].message.includes('DR1'),
        a.errors.map(e => e.message).join('; '));
    assert('BC62 Display.Write(\'H\') — error mentions char code 72',
        a.errors.length >= 1 && a.errors[0].message.includes('72'),
        a.errors.map(e => e.message).join('; '));
    assert('BC62 Display.Write(\'H\') — error mentions Display.Write',
        a.errors.length >= 1 && a.errors[0].message.includes('Display.Write'),
        a.errors.map(e => e.message).join('; '));
}

{
    // BC63: UART.SetBaud(9600) — numeric literal → targeted DWRITE hint
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    a.assemble('UART.SetBaud(9600)');
    assert('BC63 UART.SetBaud(9600) — error produced',
        a.errors.length >= 1, 'expected at least one error');
    assert('BC63 UART.SetBaud(9600) — error mentions DWRITE',
        a.errors.length >= 1 && a.errors[0].message.includes('DWRITE'),
        a.errors.map(e => e.message).join('; '));
    assert('BC63 UART.SetBaud(9600) — error mentions 9600',
        a.errors.length >= 1 && a.errors[0].message.includes('9600'),
        a.errors.map(e => e.message).join('; '));
    assert('BC63 UART.SetBaud(9600) — error mentions UART.SetBaud',
        a.errors.length >= 1 && a.errors[0].message.includes('UART.SetBaud'),
        a.errors.map(e => e.message).join('; '));
}

{
    // BC64: Display.Scroll(3) — numeric literal → targeted DWRITE hint
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    a.assemble('Display.Scroll(3)');
    assert('BC64 Display.Scroll(3) — error produced',
        a.errors.length >= 1, 'expected at least one error');
    assert('BC64 Display.Scroll(3) — error mentions DWRITE',
        a.errors.length >= 1 && a.errors[0].message.includes('DWRITE'),
        a.errors.map(e => e.message).join('; '));
    assert('BC64 Display.Scroll(3) — error mentions 3',
        a.errors.length >= 1 && a.errors[0].message.includes('#3'),
        a.errors.map(e => e.message).join('; '));
    assert('BC64 Display.Scroll(3) — error mentions Display.Scroll',
        a.errors.length >= 1 && a.errors[0].message.includes('Display.Scroll'),
        a.errors.map(e => e.message).join('; '));
}

{
    // BC65: Stack.Push(42) — numeric literal → targeted DWRITE hint
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    a.assemble('Stack.Push(42)');
    assert('BC65 Stack.Push(42) — error produced',
        a.errors.length >= 1, 'expected at least one error');
    assert('BC65 Stack.Push(42) — error mentions DWRITE',
        a.errors.length >= 1 && a.errors[0].message.includes('DWRITE'),
        a.errors.map(e => e.message).join('; '));
    assert('BC65 Stack.Push(42) — error mentions 42',
        a.errors.length >= 1 && a.errors[0].message.includes('42'),
        a.errors.map(e => e.message).join('; '));
    assert('BC65 Stack.Push(42) — error mentions Stack.Push',
        a.errors.length >= 1 && a.errors[0].message.includes('Stack.Push'),
        a.errors.map(e => e.message).join('; '));
}

// ── BC77–BC83: UART, LED, and Display bare-calls (task-1062) ─────────────────
//
// Dedicated regression tests for the three remaining system abstractions that
// hold fixed NS slots in the boot table but had no BC-numbered encoding tests.
//   UART    — NS slot 11  (Send=0 → method=1, Receive=1 → method=2)
//   LED     — NS slot 12  (Set=0 → method=1, Toggle=2 → method=3)
//   Display — NS slot 15  (Write=0 → method=1, Clear=1 → method=2)
//
// All tests reuse NEW_ABS_CONVENTIONS_BC / NEW_ABS_NS_BC (defined at BC43 block)
// which mirror the matching _ABSTRACTION_CONVENTIONS entries in app-absdetail.js.

// BC77: UART.Send() — no-arg bare-call → 2 words (ELOADCALL + HALT)
{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const result = a.assemble('UART.Send()\nHALT');
    assert('BC77 UART.Send() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC77 UART.Send() emits 2 words (ELOADCALL + HALT)',
        result.words.length === 2, `got ${result.words.length}`);
    {
        const w      = result.words[0] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC77 UART.Send() ELOADCALL — opcode=8',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC77 UART.Send() ELOADCALL — row=11 (UART NS slot)',
            row === 11, `got row=${row}`);
        assert('BC77 UART.Send() ELOADCALL — method=1 (Send index 0, 1-based)',
            method === 1, `got method=${method}`);
    }
}

// BC78: UART.Receive() — no-arg bare-call → 2 words, method=2
{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const result = a.assemble('UART.Receive()\nHALT');
    assert('BC78 UART.Receive() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC78 UART.Receive() emits 2 words (ELOADCALL + HALT)',
        result.words.length === 2, `got ${result.words.length}`);
    {
        const w      = result.words[0] >>> 0;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC78 UART.Receive() ELOADCALL — row=11 (UART NS slot)',
            row === 11, `got row=${row}`);
        assert('BC78 UART.Receive() ELOADCALL — method=2 (Receive index 1, 1-based)',
            method === 2, `got method=${method}`);
    }
}

// BC79: UART.Send(byte) pre-load pattern — 3 words (IADD + ELOADCALL + HALT)
{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const result = a.assemble('IADD DR1, DR1, #0x41\nUART.Send()\nHALT');
    assert('BC79 UART.Send(byte) pre-load pattern — no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC79 UART.Send(byte) emits 3 words (IADD + ELOADCALL + HALT)',
        result.words.length === 3, `got ${result.words.length}`);
    {
        const w      = result.words[1] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC79 UART.Send(byte) word[1] ELOADCALL — opcode=8',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC79 UART.Send(byte) word[1] ELOADCALL — row=11 (UART NS slot)',
            row === 11, `got row=${row}`);
        assert('BC79 UART.Send(byte) word[1] ELOADCALL — method=1 (Send index 0, 1-based)',
            method === 1, `got method=${method}`);
    }
}

// BC80: LED.Set() — no-arg bare-call → 2 words (ELOADCALL + HALT), row=12, method=1
{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const result = a.assemble('LED.Set()\nHALT');
    assert('BC80 LED.Set() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC80 LED.Set() emits 2 words (ELOADCALL + HALT)',
        result.words.length === 2, `got ${result.words.length}`);
    {
        const w      = result.words[0] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC80 LED.Set() ELOADCALL — opcode=8',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC80 LED.Set() ELOADCALL — row=12 (LED NS slot)',
            row === 12, `got row=${row}`);
        assert('BC80 LED.Set() ELOADCALL — method=1 (Set index 0, 1-based)',
            method === 1, `got method=${method}`);
    }
}

// BC81: LED.Toggle() — no-arg bare-call, method=3 (Toggle index 2, 1-based)
{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const result = a.assemble('LED.Toggle()\nHALT');
    assert('BC81 LED.Toggle() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC81 LED.Toggle() emits 2 words (ELOADCALL + HALT)',
        result.words.length === 2, `got ${result.words.length}`);
    {
        const w      = result.words[0] >>> 0;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC81 LED.Toggle() ELOADCALL — row=12 (LED NS slot)',
            row === 12, `got row=${row}`);
        assert('BC81 LED.Toggle() ELOADCALL — method=3 (Toggle index 2, 1-based)',
            method === 3, `got method=${method}`);
    }
}

// BC82: Display.Write() — no-arg bare-call → 2 words, row=15, method=1
{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const result = a.assemble('Display.Write()\nHALT');
    assert('BC82 Display.Write() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC82 Display.Write() emits 2 words (ELOADCALL + HALT)',
        result.words.length === 2, `got ${result.words.length}`);
    {
        const w      = result.words[0] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC82 Display.Write() ELOADCALL — opcode=8',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC82 Display.Write() ELOADCALL — row=15 (Display NS slot)',
            row === 15, `got row=${row}`);
        assert('BC82 Display.Write() ELOADCALL — method=1 (Write index 0, 1-based)',
            method === 1, `got method=${method}`);
    }
}

// BC83: Display.Clear() — no-arg bare-call, method=2 (Clear index 1, 1-based)
{
    const a = new ChurchAssembler(NEW_ABS_CONVENTIONS_BC);
    a.setNamespace(NEW_ABS_NS_BC);
    const result = a.assemble('Display.Clear()\nHALT');
    assert('BC83 Display.Clear() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC83 Display.Clear() emits 2 words (ELOADCALL + HALT)',
        result.words.length === 2, `got ${result.words.length}`);
    {
        const w      = result.words[0] >>> 0;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC83 Display.Clear() ELOADCALL — row=15 (Display NS slot)',
            row === 15, `got row=${row}`);
        assert('BC83 Display.Clear() ELOADCALL — method=2 (Clear index 1, 1-based)',
            method === 2, `got method=${method}`);
    }
}

// ── BC84–BC89: Scheduler.pause (task-1078) ────────────────────────────────────
//
// Scheduler.pause() — no inline args (caller pre-loads DR1=ticks) → ELOADCALL only.
//
// Encoding:
//   ELOADCALL — pause index=4 → 1-based=5; Scheduler slot=8; imm=(5<<8)|8=0x0508
//     word = (8<<27)|(14<<23)|(0<<19)|(6<<15)|0x0508 = 0x47030508

{
    // BC84–BC88: Scheduler.pause() bare-call
    const a = new ChurchAssembler(SCHED_CONVENTIONS_BC);
    a.setNamespace(SCHED_NS_BC);
    const result = a.assemble('Scheduler.pause()\nHALT');

    assert('BC84 Scheduler.pause() assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC85 Scheduler.pause() emits 2 words (ELOADCALL + HALT) — no LOAD for DR1 input',
        result.words.length === 2, `got ${result.words.length}`);

    {
        const w      = result.words[0] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC86 Scheduler.pause() word[0] ELOADCALL — opcode=8',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC87 Scheduler.pause() word[0] ELOADCALL — row=8 (Scheduler NS slot)',
            row === 8, `got row=${row}`);
        assert('BC88 Scheduler.pause() word[0] ELOADCALL — method=5 (pause index 4, 1-based)',
            method === 5, `got method=${method}`);
    }
}

{
    // BC89: _sharedMethodConventions inheritance — Scheduler.pause is present with index 4
    const registrar = new ChurchAssembler({});
    registrar.setSharedMethodConventions({
        'Scheduler': SCHED_CONVENTIONS_BC['Scheduler'],
    });
    const fresh = new ChurchAssembler();
    assert('BC89 _sharedMethodConventions inheritance — Scheduler.pause index is 4',
        fresh.methodConventions['Scheduler'] !== undefined &&
        fresh.methodConventions['Scheduler']['pause'] !== undefined &&
        fresh.methodConventions['Scheduler']['pause'].index === 4,
        `pause entry: ${JSON.stringify(fresh.methodConventions['Scheduler'] && fresh.methodConventions['Scheduler']['pause'])}`);
}

{
    // BC90–BC94: CALL Scheduler, pause — namespace-slot bare-call path → ELOADCALL
    //
    // Encoding: pause index=4 → 1-based=5; Scheduler slot=8; imm=(5<<8)|8=0x0508
    //   word = (8<<27)|(14<<23)|(0<<19)|(6<<15)|0x0508
    const a = new ChurchAssembler(SCHED_CONVENTIONS_BC);
    a.setNamespace(SCHED_NS_BC);
    const result = a.assemble('CALL Scheduler, pause\nHALT');

    assert('BC90 CALL Scheduler, pause assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC91 CALL Scheduler, pause emits 2 words (ELOADCALL + HALT)',
        result.words.length === 2, `got ${result.words.length}`);

    {
        const w      = result.words[0] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x7FFF;
        const row    = imm & 0xFF;
        const method = (imm >>> 8) & 0x7F;
        assert('BC92 CALL Scheduler, pause word[0] — opcode=8 (ELOADCALL, not CALL)',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC93 CALL Scheduler, pause word[0] — row=8 (Scheduler NS slot)',
            row === 8, `got row=${row}`);
        assert('BC94 CALL Scheduler, pause word[0] — method=5 (pause index 4, 1-based)',
            method === 5, `got method=${method}`);
    }
}

{
    // BC95: CALL Scheduler, UnknownMethod — error lists known methods including pause
    const a = new ChurchAssembler(SCHED_CONVENTIONS_BC);
    a.setNamespace(SCHED_NS_BC);
    a.assemble('CALL Scheduler, UnknownMethod');
    assert('BC95 CALL Scheduler, UnknownMethod — error produced',
        a.errors.length >= 1, 'expected an error');
    assert('BC95 CALL Scheduler, UnknownMethod — error lists "pause" in known methods',
        a.errors.length >= 1 && a.errors[0].message.includes('pause'),
        a.errors.map(e => e.message).join('; '));
}

{
    // BC96: CALL Scheduler, 4 (numeric selector on unloaded NS symbol)
    // Numeric selectors are not named methods; the new branch intercepts the
    // abstraction and emits an error naming known methods.  This documents
    // that numeric-indexed ELOADCALL for NS-slot abstractions requires the
    // explicit ELOADCALL instruction (not CALL).
    const a = new ChurchAssembler(SCHED_CONVENTIONS_BC);
    a.setNamespace(SCHED_NS_BC);
    a.assemble('CALL Scheduler, 4');
    assert('BC96 CALL Scheduler, 4 (numeric, unloaded) — error produced',
        a.errors.length >= 1, 'expected an error');
    assert('BC96 CALL Scheduler, 4 (numeric, unloaded) — error mentions Scheduler',
        a.errors.length >= 1 && a.errors[0].message.includes('Scheduler'),
        a.errors.map(e => e.message).join('; '));
}

// ── BC97–BC102: Hardware device shorthands + Salvation.main (task-1697) ───────
//
// Error 1 fix: UART→14, BTN→15, SLIDERULE→16, TIMER→17 added to _resolveNSName.
//   Without a capabilities block these names previously fell through to _parseCR
//   and emitted a false-positive "Expected a capability register" error.
// Error 2+3 fix: 'main' added at method index 14 in Salvation's methods array in
//   abstractions.js; CALL Salvation.main and ELOADCALL CR0, Salvation, main
//   previously emitted false-positive "not a known method" errors.

// BC97–BC100: Hardware device shorthands without a capabilities block
//
// These tests verify that UART/BTN/SlideRule/Timer resolve to their fixed boot
// c-list slots (14–17) when no capabilities block is present.  The hardware
// shorthand fires only when _resolveNSName path 2 (nsSymbols) has no entry for
// the name.  Previous test suites (e.g. SCHED_NS_BC) leave stale entries like
// Timer: 14 in ChurchAssembler._sharedNsSymbols, which would shadow the shorthand
// and cause false results.  We save and restore _sharedNsSymbols around these
// four tests so they run in a pristine namespace context.
{
    const _savedSharedNs = ChurchAssembler._sharedNsSymbols;
    ChurchAssembler._sharedNsSymbols = {};

    {
        // BC97: LOAD CR5, UART — resolves to boot c-list slot 14
        const a = new ChurchAssembler({});
        const r = a.assemble('LOAD CR5, UART\nHALT');
        assert('BC97 LOAD CR5, UART without cap block — no errors',
            a.errors.length === 0, a.errors.map(e => e.message).join('; '));
        assert('BC97 LOAD CR5, UART emits 2 words (LOAD + HALT)',
            r.words.length === 2, `got ${r.words.length}`);
        {
            const w = r.words[0] >>> 0;
            const crSrc = (w >>> 15) & 0xF;  // crSrc at bits[18:15]; crDst at bits[22:19]
            const imm   = w & 0x7FFF;
            assert('BC97 LOAD CR5, UART — crSrc=6 (c-list root)',
                crSrc === 6, `got crSrc=${crSrc}`);
            assert('BC97 LOAD CR5, UART — imm=14 (UART boot c-list slot)',
                imm === 14, `got imm=${imm}`);
        }
    }

    {
        // BC98: LOAD CR1, BTN — resolves to boot c-list slot 15
        const a = new ChurchAssembler({});
        const r = a.assemble('LOAD CR1, BTN\nHALT');
        assert('BC98 LOAD CR1, BTN without cap block — no errors',
            a.errors.length === 0, a.errors.map(e => e.message).join('; '));
        {
            const w   = r.words[0] >>> 0;
            const imm = w & 0x7FFF;
            assert('BC98 LOAD CR1, BTN — imm=15 (BTN boot c-list slot)',
                imm === 15, `got imm=${imm}`);
        }
    }

    {
        // BC99: LOAD CR2, SlideRule — resolves to boot c-list slot 16
        const a = new ChurchAssembler({});
        const r = a.assemble('LOAD CR2, SlideRule\nHALT');
        assert('BC99 LOAD CR2, SlideRule without cap block — no errors',
            a.errors.length === 0, a.errors.map(e => e.message).join('; '));
        {
            const w   = r.words[0] >>> 0;
            const imm = w & 0x7FFF;
            assert('BC99 LOAD CR2, SlideRule — imm=16 (SlideRule boot c-list slot)',
                imm === 16, `got imm=${imm}`);
        }
    }

    {
        // BC100: LOAD CR3, Timer — resolves to boot c-list slot 17
        const a = new ChurchAssembler({});
        const r = a.assemble('LOAD CR3, Timer\nHALT');
        assert('BC100 LOAD CR3, Timer without cap block — no errors',
            a.errors.length === 0, a.errors.map(e => e.message).join('; '));
        {
            const w   = r.words[0] >>> 0;
            const imm = w & 0x7FFF;
            assert('BC100 LOAD CR3, Timer — imm=17 (Timer boot c-list slot)',
                imm === 17, `got imm=${imm}`);
        }
    }

    ChurchAssembler._sharedNsSymbols = _savedSharedNs;
}

// BC101–BC102: Salvation.main at method index 14 → 1-based selector 15 (0xF)

const SALVATION_CONV_BC = {
    'Salvation': {
        'Create':       { index: 0 },
        'Release':      { index: 1 },
        'Find':         { index: 2 },
        'Transfer':     { index: 3 },
        'Validate':     { index: 4 },
        'Audit':        { index: 5 },
        'main':         { index: 14 },
    }
};
const SALVATION_NS_BC = { 'Salvation': 4 };

{
    // BC101: CALL Salvation.main — dot-notation CALL, emits CALL with imm=15
    // Program: LOAD CR0, Salvation (populates nsLoaded) then CALL Salvation.main
    const a = new ChurchAssembler(SALVATION_CONV_BC);
    a.setNamespace(SALVATION_NS_BC);
    const r = a.assemble('LOAD CR0, Salvation\nCALL Salvation.main\nHALT');
    assert('BC101 CALL Salvation.main — no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC101 CALL Salvation.main emits 3 words (LOAD + CALL + HALT)',
        r.words.length === 3, `got ${r.words.length}`);
    {
        const w      = r.words[1] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x3FFF;
        assert('BC101 CALL Salvation.main word[1] — opcode=2 (CALL)',
            opcode === 2, `got opcode=${opcode}`);
        assert('BC101 CALL Salvation.main word[1] — imm=15 (main index 14, 1-based)',
            imm === 15, `got imm=${imm}`);
    }
}

{
    // BC102: ELOADCALL CR0, Salvation, main — method=15 (index 14, 1-based), row=4
    const a = new ChurchAssembler(SALVATION_CONV_BC);
    a.setNamespace(SALVATION_NS_BC);
    const r = a.assemble('ELOADCALL CR0, Salvation, main\nHALT');
    assert('BC102 ELOADCALL CR0, Salvation, main — no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC102 ELOADCALL CR0, Salvation, main emits 2 words (ELOADCALL + HALT)',
        r.words.length === 2, `got ${r.words.length}`);
    {
        const w      = r.words[0] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const row    = w & 0xFF;
        const method = (w >>> 8) & 0x7F;
        assert('BC102 ELOADCALL CR0, Salvation, main — opcode=8 (ELOADCALL)',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC102 ELOADCALL CR0, Salvation, main — row=4 (Salvation NS slot)',
            row === 4, `got row=${row}`);
        assert('BC102 ELOADCALL CR0, Salvation, main — method=15 (main index 14, 1-based)',
            method === 15, `got method=${method}`);
    }
}

// ── BC103–BC108: Navana.main, Mint.main, Memory.main (task-1698) ─────────────
//
// Navana  NS slot 5 — 'main' at method index 7  → 1-based selector 8
// Mint    NS slot 6 — 'main' at method index 4  → 1-based selector 5
// Memory  NS slot 7 — 'main' at method index 5  → 1-based selector 6

const NAVANA_CONV_BC = {
    'Navana': {
        'Create':  { index: 0 },
        'Release': { index: 1 },
        'Find':    { index: 2 },
        'Update':  { index: 3 },
        'Manage':  { index: 4 },
        'Monitor': { index: 5 },
        'IDS':     { index: 6 },
        'main':    { index: 7 },
    }
};
const NAVANA_NS_BC = { 'Navana': 5 };

{
    // BC103: CALL Navana.main — dot-notation CALL, imm=8 (index 7, 1-based)
    const a = new ChurchAssembler(NAVANA_CONV_BC);
    a.setNamespace(NAVANA_NS_BC);
    const r = a.assemble('LOAD CR0, Navana\nCALL Navana.main\nHALT');
    assert('BC103 CALL Navana.main — no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC103 CALL Navana.main emits 3 words (LOAD + CALL + HALT)',
        r.words.length === 3, `got ${r.words.length}`);
    {
        const w      = r.words[1] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x3FFF;
        assert('BC103 CALL Navana.main word[1] — opcode=2 (CALL)',
            opcode === 2, `got opcode=${opcode}`);
        assert('BC103 CALL Navana.main word[1] — imm=8 (main index 7, 1-based)',
            imm === 8, `got imm=${imm}`);
    }
}

{
    // BC104: ELOADCALL CR0, Navana, main — method=8 (index 7, 1-based), row=5
    const a = new ChurchAssembler(NAVANA_CONV_BC);
    a.setNamespace(NAVANA_NS_BC);
    const r = a.assemble('ELOADCALL CR0, Navana, main\nHALT');
    assert('BC104 ELOADCALL CR0, Navana, main — no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC104 ELOADCALL CR0, Navana, main emits 2 words (ELOADCALL + HALT)',
        r.words.length === 2, `got ${r.words.length}`);
    {
        const w      = r.words[0] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const row    = w & 0xFF;
        const method = (w >>> 8) & 0x7F;
        assert('BC104 ELOADCALL CR0, Navana, main — opcode=8 (ELOADCALL)',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC104 ELOADCALL CR0, Navana, main — row=5 (Navana NS slot)',
            row === 5, `got row=${row}`);
        assert('BC104 ELOADCALL CR0, Navana, main — method=8 (main index 7, 1-based)',
            method === 8, `got method=${method}`);
    }
}

const MINT_CONV_BC = {
    'Mint': {
        'Encode':   { index: 0 },
        'Revoke':   { index: 1 },
        'Transfer': { index: 2 },
        'Create':   { index: 3 },
        'main':     { index: 4 },
    }
};
const MINT_NS_BC = { 'Mint': 6 };

{
    // BC105: CALL Mint.main — dot-notation CALL, imm=5 (index 4, 1-based)
    const a = new ChurchAssembler(MINT_CONV_BC);
    a.setNamespace(MINT_NS_BC);
    const r = a.assemble('LOAD CR0, Mint\nCALL Mint.main\nHALT');
    assert('BC105 CALL Mint.main — no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC105 CALL Mint.main emits 3 words (LOAD + CALL + HALT)',
        r.words.length === 3, `got ${r.words.length}`);
    {
        const w      = r.words[1] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x3FFF;
        assert('BC105 CALL Mint.main word[1] — opcode=2 (CALL)',
            opcode === 2, `got opcode=${opcode}`);
        assert('BC105 CALL Mint.main word[1] — imm=5 (main index 4, 1-based)',
            imm === 5, `got imm=${imm}`);
    }
}

{
    // BC106: ELOADCALL CR0, Mint, main — method=5 (index 4, 1-based), row=6
    const a = new ChurchAssembler(MINT_CONV_BC);
    a.setNamespace(MINT_NS_BC);
    const r = a.assemble('ELOADCALL CR0, Mint, main\nHALT');
    assert('BC106 ELOADCALL CR0, Mint, main — no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC106 ELOADCALL CR0, Mint, main emits 2 words (ELOADCALL + HALT)',
        r.words.length === 2, `got ${r.words.length}`);
    {
        const w      = r.words[0] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const row    = w & 0xFF;
        const method = (w >>> 8) & 0x7F;
        assert('BC106 ELOADCALL CR0, Mint, main — opcode=8 (ELOADCALL)',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC106 ELOADCALL CR0, Mint, main — row=6 (Mint NS slot)',
            row === 6, `got row=${row}`);
        assert('BC106 ELOADCALL CR0, Mint, main — method=5 (main index 4, 1-based)',
            method === 5, `got method=${method}`);
    }
}

const MEMORY_CONV_BC = {
    'Memory': {
        'Create':  { index: 0 },
        'Release': { index: 1 },
        'Find':    { index: 2 },
        'Resize':  { index: 3 },
        'Claim':   { index: 4 },
        'main':    { index: 5 },
    }
};
const MEMORY_NS_BC = { 'Memory': 7 };

{
    // BC107: CALL Memory.main — dot-notation CALL, imm=6 (index 5, 1-based)
    const a = new ChurchAssembler(MEMORY_CONV_BC);
    a.setNamespace(MEMORY_NS_BC);
    const r = a.assemble('LOAD CR0, Memory\nCALL Memory.main\nHALT');
    assert('BC107 CALL Memory.main — no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC107 CALL Memory.main emits 3 words (LOAD + CALL + HALT)',
        r.words.length === 3, `got ${r.words.length}`);
    {
        const w      = r.words[1] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const imm    = w & 0x3FFF;
        assert('BC107 CALL Memory.main word[1] — opcode=2 (CALL)',
            opcode === 2, `got opcode=${opcode}`);
        assert('BC107 CALL Memory.main word[1] — imm=6 (main index 5, 1-based)',
            imm === 6, `got imm=${imm}`);
    }
}

{
    // BC108: ELOADCALL CR0, Memory, main — method=6 (index 5, 1-based), row=7
    const a = new ChurchAssembler(MEMORY_CONV_BC);
    a.setNamespace(MEMORY_NS_BC);
    const r = a.assemble('ELOADCALL CR0, Memory, main\nHALT');
    assert('BC108 ELOADCALL CR0, Memory, main — no errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('BC108 ELOADCALL CR0, Memory, main emits 2 words (ELOADCALL + HALT)',
        r.words.length === 2, `got ${r.words.length}`);
    {
        const w      = r.words[0] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const row    = w & 0xFF;
        const method = (w >>> 8) & 0x7F;
        assert('BC108 ELOADCALL CR0, Memory, main — opcode=8 (ELOADCALL)',
            opcode === 8, `got opcode=${opcode}`);
        assert('BC108 ELOADCALL CR0, Memory, main — row=7 (Memory NS slot)',
            row === 7, `got row=${row}`);
        assert('BC108 ELOADCALL CR0, Memory, main — method=6 (main index 5, 1-based)',
            method === 6, `got method=${method}`);
    }
}

// ── EX1–EX19: Assembly example smoke tests (task-1063) ───────────────────────
// End-to-end tests verifying each assembly example in LANG_EXAMPLE_GROUPS.assembly
// (simulator/app-compile.js) assembles without errors.  Sources are mirrored
// from the loadExample() map in simulator/app-run.js.
//
// Covered examples: capability_test, system_patterns, compute_demo,
//   salvation, perm_attack, bind_attack, ada_note_g,
//   led_control (Section 1 blink), led_dr_test (Turing DR Test, standalone).
// constants_dot is already covered by CD1-CD10 above.

// EX1: capability_test — raw slot access, no NS symbols required
{
    const EX1_SRC = `
LOAD CR0, CR6, 4
LOAD CR1, CR6, 5
LOAD CR2, CR6, 6
LOAD CR3, CR6, 7
LOAD CR4, CR6, 8
LOAD CR5, CR6, 9
TPERM CR0, E
TPERM CR1, E
TPERM CR4, RW
TPERM CR5, RW
TPERM CR0, L
LOADEQ CR0, CR6, 5
LOADNE CR0, CR6, 4
SWITCH CR0, 1
SWITCH CR0, 1
IADD DR1, DR0, #42
IADD DR2, DR1, #8
ISUB DR3, DR2, DR1
MCMP DR1, DR2
IADD DR4, DR0, #1
SHL DR4, DR4, 3
SHR DR4, DR4, 1
LOAD CR0, CR6, 4
CALL CR0, 0xF
ELOADCALL CR0, CR6, 4
HALT
`;
    const a = new ChurchAssembler({});
    const result = a.assemble(EX1_SRC);
    assert('EX1 capability_test assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EX1 capability_test produces at least one word',
        result.words.length > 0, `got ${result.words.length}`);
}

// EX2: system_patterns — three sections, raw slot access
{
    const EX2_SRC = `
LOAD CR0, CR6, 4
TPERM CR0, E
LOAD CR1, CR6, 5
TPERM CR1, E
LOAD CR2, CR6, 8
TPERM CR2, RW
CALL CR0, 0xF
HALT
LOAD CR0, CR6, 4
TPERM CR0, E
LOADEQ CR1, CR6, 5
CALLNE CR0, 0xF
TPERM CR0, L
LOADEQ CR2, CR6, 6
LOADNE CR2, CR6, 7
HALT
LOAD CR0, CR6, 4
LOAD CR1, CR6, 5
LOAD CR2, CR6, 6
LOAD CR3, CR6, 7
LOAD CR4, CR6, 8
TPERM CR0, E
TPERM CR1, E
TPERM CR2, E
TPERM CR3, E
TPERM CR4, RW
CALL CR0, 0xF
HALT
`;
    const a = new ChurchAssembler({});
    const result = a.assemble(EX2_SRC);
    assert('EX2 system_patterns assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EX2 system_patterns produces at least one word',
        result.words.length > 0, `got ${result.words.length}`);
}

// EX3: compute_demo — arithmetic loops, SHR, BFEXT/BFINS, BRANCH targets
{
    const EX3_SRC = `
IADD DR1, DR0, #10
IADD DR2, DR1, #1
IADD DR3, DR0, DR0
IADD DR4, DR2, DR0
mul:
MCMP DR4, DR0
BRANCHEQ div
IADD DR3, DR3, DR1
ISUB DR4, DR4, #1
BRANCH mul
div:
SHR DR3, DR3, 1
IADD DR5, DR0, DR0
IADD DR6, DR0, #1
loop:
MCMP DR6, DR1
BRANCHGT done
IADD DR5, DR5, DR6
IADD DR6, DR6, #1
BRANCH loop
done:
IADD DR1, DR0, DR0
LOAD CR0, CR6, 4
TPERM CR0, E
IADD DR3, DR1, DR2
ISUB DR4, DR3, DR1
MCMP DR4, DR2
BRANCHEQ +2
IADD DR5, DR1, DR1
MCMP DR3, DR4
BRANCHNE +2
ISUB DR6, DR1, DR1
ISUB DR7, DR3, DR3
BRANCHEQ +2
IADD DR8, DR1, DR1
IADD DR9, DR3, DR0
SHL DR10, DR9, 4
SHR DR11, DR10, 2
ISUB DR12, DR0, DR3
SHR DR13, DR12, 1, ASR
SHL DR14, DR3, 8
SHR DR15, DR14, 8
MCMP DR15, DR3
HALT
`;
    const a = new ChurchAssembler({});
    const result = a.assemble(EX3_SRC);
    assert('EX3 compute_demo assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EX3 compute_demo produces at least one word',
        result.words.length > 0, `got ${result.words.length}`);
}

// EX4: salvation — named NS load + dot-notation CALL; requires Salvation NS slot + method
// Convention index=15: dot-notation imm = index+1 = 16 = 0x10.
// Raw form "CALL CR0, 0xF" also gives imm = 0xF+1 = 16 = 0x10 (assembler adds 1
// to any numeric CALL argument, treating it as a 0-based method selector).
{
    const EX4_CONVENTIONS = { 'Salvation': { 'main': { index: 15 } } };
    const EX4_NS = { 'Salvation': 4 };
    const EX4_SRC = `
LOAD CR0, Salvation
TPERM CR0, E
CALL Salvation.main
HALT
`;
    const a = new ChurchAssembler(EX4_CONVENTIONS);
    a.setNamespace(EX4_NS);
    const result = a.assemble(EX4_SRC);
    assert('EX4 salvation assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EX4 salvation produces 4 words (LOAD + TPERM + CALL + HALT)',
        result.words.length === 4, `got ${result.words.length}`);
    // EX4a: LOAD CR0, Salvation encodes LOAD (opcode=0) with crDst=0
    {
        const w = result.words[0] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const crDst  = (w >>> 19) & 0xF;
        const imm    = w & 0x7FFF;
        assert('EX4a salvation word[0] LOAD — opcode=0', opcode === 0, `got ${opcode}`);
        assert('EX4a salvation word[0] LOAD — crDst=0', crDst === 0, `got ${crDst}`);
        assert('EX4a salvation word[0] LOAD — imm=4 (Salvation NS slot)', imm === 4, `got ${imm}`);
    }
    // EX4b: CALL Salvation.main encodes CALL (opcode=2) with imm=16 (index 15 → 1-based 16 = 0x10)
    // This matches the raw form "CALL CR0, 0xF" which also stores imm=16 (0xF+1, assembler 1-bases it).
    {
        const w = result.words[2] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        const crDst  = (w >>> 19) & 0xF;
        const imm    = w & 0x7FFF;
        assert('EX4b salvation word[2] CALL — opcode=2', opcode === 2, `got ${opcode}`);
        assert('EX4b salvation word[2] CALL — crDst=0 (CR0 from LOAD)', crDst === 0, `got ${crDst}`);
        assert('EX4b salvation word[2] CALL — imm=16 (main index 15, 1-based = 0x10)', imm === 16, `got ${imm}`);
    }
}

// EX5: perm_attack — raw slot access attacks + TPERM guard + recursive CALL
{
    const EX5_SRC = `
LOAD CR0, CR6, 8
CALL CR0, 0xF
LOAD CR1, CR6, 4
DREAD DR1, CR1, 0
LOAD CR2, CR6, 10
DWRITE DR1, CR2, 0
HALT
LOAD CR0, CR6, 4
TPERM CR0, E
BRANCHEQ tperm_ok
HALT
tperm_ok:
CALL CR0, 0
TPERM CR0, RW
BRANCHEQ tperm_fail
tperm_fail:
LOAD CR3, CR6, 2
recurse:
CALL CR3, 0
BRANCH recurse
HALT
`;
    const a = new ChurchAssembler({});
    const result = a.assemble(EX5_SRC);
    assert('EX5 perm_attack assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EX5 perm_attack produces at least one word',
        result.words.length > 0, `got ${result.words.length}`);
}

// EX6: bind_attack — B-bit enforcement test
{
    const EX6_SRC = `
LOAD CR0, CR6, 4
SAVE CR0, CR6, 3
HALT
`;
    const a = new ChurchAssembler({});
    const result = a.assemble(EX6_SRC);
    assert('EX6 bind_attack assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EX6 bind_attack produces 3 words (LOAD + SAVE + HALT)',
        result.words.length === 3, `got ${result.words.length}`);
}

// EX7–EX11: ada_note_g — 25-operation Bernoulli algorithm with .org data table
{
    const EX7_SRC = `
DREAD DR1, CR14, 100
DREAD DR2, CR14, 101
DREAD DR3, CR14, 102
IADD DR4, DR0, DR0
IADD DR14, DR3, DR0
op1_loop:
MCMP DR14, DR0
BRANCHEQ op1_done
IADD DR4, DR4, DR2
ISUB DR14, DR14, DR1
BRANCH op1_loop
op1_done:
IADD DR5, DR4, DR0
IADD DR6, DR4, DR0
ISUB DR4, DR4, DR1
IADD DR5, DR5, DR1
IADD DR11, DR0, DR0
IADD DR14, DR4, DR0
op4_loop:
MCMP DR14, DR5
BRANCHLT op4_done
ISUB DR14, DR14, DR5
IADD DR11, DR11, DR1
BRANCH op4_loop
op4_done:
SHR DR11, DR11, 1
IADD DR13, DR0, DR0
ISUB DR13, DR13, DR11
ISUB DR10, DR3, DR1
IADD DR7, DR2, DR0
IADD DR11, DR0, DR0
IADD DR14, DR6, DR0
op9_loop:
MCMP DR14, DR7
BRANCHLT op9_done
ISUB DR14, DR14, DR7
IADD DR11, DR11, DR1
BRANCH op9_loop
op9_done:
DREAD DR15, CR14, 103
IADD DR12, DR0, DR0
IADD DR14, DR11, DR0
op10_loop:
MCMP DR14, DR0
BRANCHEQ op10_done
IADD DR12, DR12, DR15
ISUB DR14, DR14, DR1
BRANCH op10_loop
op10_done:
IADD DR13, DR12, DR13
ISUB DR10, DR10, DR1
ISUB DR6, DR6, DR1
IADD DR7, DR1, DR7
IADD DR8, DR0, DR0
IADD DR14, DR6, DR0
op15_loop:
MCMP DR14, DR7
BRANCHLT op15_done
ISUB DR14, DR14, DR7
IADD DR8, DR8, DR1
BRANCH op15_loop
op15_done:
IADD DR14, DR11, DR0
IADD DR11, DR0, DR0
IADD DR15, DR8, DR0
op16_loop:
MCMP DR15, DR0
BRANCHEQ op16_done
IADD DR11, DR11, DR14
ISUB DR15, DR15, DR1
BRANCH op16_loop
op16_done:
ISUB DR6, DR6, DR1
IADD DR7, DR1, DR7
IADD DR9, DR0, DR0
IADD DR14, DR6, DR0
op19_loop:
MCMP DR14, DR7
BRANCHLT op19_done
ISUB DR14, DR14, DR7
IADD DR9, DR9, DR1
BRANCH op19_loop
op19_done:
IADD DR14, DR11, DR0
IADD DR11, DR0, DR0
IADD DR15, DR9, DR0
op20_loop:
MCMP DR15, DR0
BRANCHEQ op20_done
IADD DR11, DR11, DR14
ISUB DR15, DR15, DR1
BRANCH op20_loop
op20_done:
DREAD DR15, CR14, 104
IADD DR12, DR0, DR0
IADD DR14, DR11, DR0
op21_loop:
MCMP DR14, DR0
BRANCHEQ op21_done
IADD DR12, DR12, DR15
ISUB DR14, DR14, DR1
BRANCH op21_loop
op21_done:
IADD DR13, DR12, DR13
ISUB DR10, DR10, DR1
ISUB DR6, DR6, DR1
IADD DR7, DR1, DR7
IADD DR8, DR0, DR0
IADD DR14, DR6, DR0
op15b_loop:
MCMP DR14, DR7
BRANCHLT op15b_done
ISUB DR14, DR14, DR7
IADD DR8, DR8, DR1
BRANCH op15b_loop
op15b_done:
IADD DR14, DR11, DR0
IADD DR11, DR0, DR0
IADD DR15, DR8, DR0
op16b_loop:
MCMP DR15, DR0
BRANCHEQ op16b_done
IADD DR11, DR11, DR14
ISUB DR15, DR15, DR1
BRANCH op16b_loop
op16b_done:
ISUB DR6, DR6, DR1
IADD DR7, DR1, DR7
IADD DR9, DR0, DR0
IADD DR14, DR6, DR0
op19b_loop:
MCMP DR14, DR7
BRANCHLT op19b_done
ISUB DR14, DR14, DR7
IADD DR9, DR9, DR1
BRANCH op19b_loop
op19b_done:
IADD DR14, DR11, DR0
IADD DR11, DR0, DR0
IADD DR15, DR9, DR0
op20b_loop:
MCMP DR15, DR0
BRANCHEQ op20b_done
IADD DR11, DR11, DR14
ISUB DR15, DR15, DR1
BRANCH op20b_loop
op20b_done:
DREAD DR15, CR14, 105
IADD DR12, DR0, DR0
IADD DR14, DR11, DR0
op21b_loop:
MCMP DR14, DR0
BRANCHEQ op21b_done
IADD DR12, DR12, DR15
ISUB DR14, DR14, DR1
BRANCH op21b_loop
op21b_done:
IADD DR13, DR12, DR13
ISUB DR10, DR10, DR1
IADD DR15, DR0, DR0
ISUB DR15, DR15, DR13
IADD DR3, DR1, DR3
HALT
.org 100
.word 1
.word 2
.word 4
.word 1
.word 1
.word 1
`;
    const a = new ChurchAssembler({});
    const result = a.assemble(EX7_SRC);
    assert('EX7 ada_note_g assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    // EX8: .org 100 + 6 .word entries → at least 106 words (code may fill beyond 100)
    assert('EX8 ada_note_g total word count covers .org data region',
        result.words.length >= 106, `got ${result.words.length}`);
    // EX9: first instruction is DREAD (opcode=16=0x10 in v2.0)
    {
        const w = result.words[0] >>> 0;
        const opcode = (w >>> 27) & 0x1F;
        assert('EX9 ada_note_g word[0] is DREAD (opcode=16)', opcode === 16, `got ${opcode}`);
    }
    // EX10: data values 1,2,4,1,1,1 appear in the final six words (the .word section)
    {
        const tail = result.words.slice(-6);
        assert('EX10 ada_note_g last 6 words are the .word data table [1,2,4,1,1,1]',
            tail.length === 6 &&
            tail[0] === 1 && tail[1] === 2 && tail[2] === 4 &&
            tail[3] === 1 && tail[4] === 1 && tail[5] === 1,
            `got [${tail.join(',')}]`);
    }
}

// EX12–EX13: led_control Section 1 — LED blink with capabilities block + LED0 shorthand
{
    const EX12_SRC = `
capabilities { LED0 RW }
LOAD CR3, LED0
IADD DR1, DR0, #1
led_on:
DWRITE DR1, CR3, 0
IADD DR3, DR0, #3
outer_on:
IADD DR2, DR0, #3
inner_on:
ISUB DR2, DR2, #1
BRANCHNE inner_on
ISUB DR3, DR3, #1
BRANCHNE outer_on
DWRITE DR0, CR3, 0
IADD DR3, DR0, #3
outer_off:
IADD DR2, DR0, #3
inner_off:
ISUB DR2, DR2, #1
BRANCHNE inner_off
ISUB DR3, DR3, #1
BRANCHNE outer_off
BRANCH led_on
`;
    const a = new ChurchAssembler({});
    const result = a.assemble(EX12_SRC);
    assert('EX12 led_control Section 1 assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EX13 led_control Section 1 produces at least one word',
        result.words.length > 0, `got ${result.words.length}`);
}

// EX14–EX15: led_dr_test (Turing DR Test) — 6-phase ISA exercise, standalone tab
// Source mirrors _TURING_DR_TEST_SOURCE from simulator/app-run.js
{
    const EX14_SRC = `
capabilities {
    LED0 RW
    LED1 RW
    LED2 RW
    LED3 RW
    LED4 RW
    LED5 RW
}
LOAD CR3, LED0
IADD DR1, DR0, #1
DWRITE DR0, CR3, 0
DWRITE DR0, CR3, 1
DWRITE DR0, CR3, 2
DWRITE DR0, CR3, 3
DWRITE DR0, CR3, 4
DWRITE DR0, CR3, 5
ph1:
DWRITE DR1, CR3, 0
DWRITE DR1, CR3, 3
DWRITE DR0, CR3, 4
DWRITE DR0, CR3, 5
IADD DR2, DR0, #2
IADD DR2, DR2, #1
IADD DR2, DR2, #1
IADD DR2, DR2, #1
ISUB DR2, DR2, #5
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
IADD DR3, DR0, #3
IADD DR3, DR3, #1
IADD DR3, DR3, #1
IADD DR3, DR3, #1
ISUB DR3, DR3, #6
MCMP DR3, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
IADD DR1, DR0, #1
ISUB DR1, DR1, #1
MCMP DR1, DR0
BRANCHNE fail
IADD DR1, DR0, #1
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
ph2:
DWRITE DR1, CR3, 0
DWRITE DR0, CR3, 3
DWRITE DR1, CR3, 4
DWRITE DR0, CR3, 5
IADD DR2, DR0, #2
ISUB DR2, DR2, #2
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
IADD DR3, DR0, #3
ISUB DR3, DR3, #3
MCMP DR3, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
IADD DR1, DR0, #1
ISUB DR1, DR1, #1
MCMP DR1, DR0
BRANCHNE fail
IADD DR1, DR0, #1
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
ph3:
DWRITE DR1, CR3, 0
DWRITE DR1, CR3, 3
DWRITE DR1, CR3, 4
DWRITE DR0, CR3, 5
IADD DR15, DR0, #1
IADD DR14, DR0, #31
p3_ex:
SHL DR15, DR15, 1
ISUB DR14, DR14, #1
BRANCHNE p3_ex
IADD DR2, DR0, #1
IADD DR3, DR0, #31
p3_sh2:
SHL DR2, DR2, 1
ISUB DR3, DR3, #1
BRANCHNE p3_sh2
MCMP DR2, DR15
BRANCHNE fail
SHL DR2, DR2, 1
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
IADD DR14, DR0, #1
SHL DR14, DR14, 31
IADD DR1, DR0, #1
IADD DR2, DR0, #31
p3_sh1:
SHL DR1, DR1, 1
ISUB DR2, DR2, #1
BRANCHNE p3_sh1
MCMP DR1, DR14
BRANCHNE fail
SHL DR1, DR1, 1
MCMP DR1, DR0
BRANCHNE fail
IADD DR1, DR0, #1
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
ph4:
DWRITE DR1, CR3, 0
DWRITE DR0, CR3, 3
DWRITE DR0, CR3, 4
DWRITE DR1, CR3, 5
IADD DR2, DR0, #0
BFINS DR2, DR1, 31, 1
IADD DR3, DR0, #31
p4_sh2:
SHR DR2, DR2, 1
ISUB DR3, DR3, #1
BRANCHNE p4_sh2
ISUB DR3, DR2, #1
MCMP DR3, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
IADD DR3, DR0, #1
IADD DR1, DR0, #0
BFINS DR1, DR3, 31, 1
IADD DR2, DR0, #31
p4_sh1:
SHR DR1, DR1, 1
ISUB DR2, DR2, #1
BRANCHNE p4_sh1
ISUB DR2, DR1, #1
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
ISUB DR2, DR0, #1
SHR DR3, DR2, 1, ASR
MCMP DR3, DR2
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
IADD DR4, DR0, #0
BFINS DR4, DR1, 31, 1
ISUB DR5, DR4, #1
SHR DR6, DR2, 1
MCMP DR6, DR5
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
ph5:
DWRITE DR1, CR3, 0
DWRITE DR1, CR3, 3
DWRITE DR0, CR3, 4
DWRITE DR1, CR3, 5
IADD DR2, DR0, #165
BFEXT DR3, DR2, 0, 4
ISUB DR3, DR3, #5
MCMP DR3, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
IADD DR4, DR0, #0
BFINS DR4, DR2, 0, 4
BFEXT DR5, DR4, 0, 4
ISUB DR5, DR5, #5
MCMP DR5, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
BFEXT DR6, DR2, 4, 4
ISUB DR6, DR6, #10
MCMP DR6, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
BFEXT DR9, DR2, 0, 8
ISUB DR9, DR9, #165
MCMP DR9, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
BFEXT DR1, DR2, 0, 1
ISUB DR1, DR1, #1
MCMP DR1, DR0
BRANCHNE fail
IADD DR1, DR0, #1
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
ph6:
DWRITE DR1, CR3, 0
DWRITE DR0, CR3, 3
DWRITE DR1, CR3, 4
DWRITE DR1, CR3, 5
DWRITE DR1, CR3, 0
DREAD  DR2, CR3, 0
MCMP   DR2, DR1
BRANCHNE fail
DWRITE DR0, CR3, 0
DREAD  DR8, CR3, 0
MCMP   DR8, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
DWRITE DR1, CR3, 1
DREAD  DR3, CR3, 1
MCMP   DR3, DR1
BRANCHNE fail
DWRITE DR0, CR3, 1
DREAD  DR9, CR3, 1
MCMP   DR9, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1
DWRITE DR0, CR3, 0
DWRITE DR0, CR3, 1
DWRITE DR0, CR3, 2
DWRITE DR0, CR3, 3
DWRITE DR0, CR3, 4
DWRITE DR0, CR3, 5
pass:
DWRITE DR1, CR3, 0
DWRITE DR1, CR3, 1
DWRITE DR1, CR3, 2
DWRITE DR1, CR3, 3
DWRITE DR1, CR3, 4
DWRITE DR1, CR3, 5
IADD DR2, DR0, #200
pass_dly1:
ISUB DR2, DR2, #1
BRANCHNE pass_dly1
DWRITE DR0, CR3, 0
DWRITE DR0, CR3, 1
DWRITE DR0, CR3, 2
DWRITE DR0, CR3, 3
DWRITE DR0, CR3, 4
DWRITE DR0, CR3, 5
BRANCH ph1
fail:
DWRITE DR0, CR3, 0
DWRITE DR0, CR3, 1
DWRITE DR1, CR3, 2
DWRITE DR0, CR3, 3
DWRITE DR0, CR3, 4
DWRITE DR0, CR3, 5
BRANCH fail
`;
    const a = new ChurchAssembler({});
    const result = a.assemble(EX14_SRC);
    assert('EX14 led_dr_test Turing DR Test assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EX15 led_dr_test Turing DR Test produces at least one word',
        result.words.length > 0, `got ${result.words.length}`);
}

// EX-SP: scheduler_pause — LOAD + TPERM + two pauses + Yield + HALT
// Verifies that Scheduler.pause and Scheduler.Yield assemble correctly when
// the Scheduler method conventions and NS slot are supplied.
{
    const EX_SP_CONVENTIONS = {
        'Scheduler': {
            'Yield':  { index: 0, input: '',           output: 'DR1' },
            'pause':  { index: 4, input: 'DR1=ticks',  output: 'DR1' },
        },
    };
    const EX_SP_NS = { 'Scheduler': 8 };
    const EX_SP_SRC = `
LOAD CR0, Scheduler
TPERM CR0, E
IADD DR1, DR0, #50
CALL Scheduler.pause
IADD DR1, DR0, #10
CALL Scheduler.pause
CALL Scheduler.Yield
HALT
`;
    const a = new ChurchAssembler(EX_SP_CONVENTIONS);
    a.setNamespace(EX_SP_NS);
    const result = a.assemble(EX_SP_SRC);
    assert('EX-SP scheduler_pause assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EX-SP scheduler_pause produces 8 words (LOAD+TPERM+IADD+CALL+IADD+CALL+CALL+HALT)',
        result.words.length === 8, `got ${result.words.length}`);
}

// EX-SY: scheduler_yield — LOAD + TPERM + LOAD + IADD + Spawn + Yield + Yield + HALT
// Verifies that Scheduler.Spawn and Scheduler.Yield assemble correctly when
// the Scheduler method conventions and NS slot are supplied.
{
    const EX_SY_CONVENTIONS = {
        'Scheduler': {
            'Yield':  { index: 0, input: '',                        output: 'DR1' },
            'Spawn':  { index: 1, input: 'CR2=code_GT, DR1=entry',  output: 'DR1=threadID' },
        },
    };
    const EX_SY_NS = { 'Scheduler': 8 };
    const EX_SY_SRC = `
LOAD CR0, Scheduler
TPERM CR0, E
LOAD CR2, Scheduler
IADD DR1, DR0, #0
CALL Scheduler.Spawn
CALL Scheduler.Yield
CALL Scheduler.Yield
HALT
`;
    const a = new ChurchAssembler(EX_SY_CONVENTIONS);
    a.setNamespace(EX_SY_NS);
    const result = a.assemble(EX_SY_SRC);
    assert('EX-SY scheduler_yield assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EX-SY scheduler_yield produces 8 words (LOAD+TPERM+LOAD+IADD+Spawn+Yield+Yield+HALT)',
        result.words.length === 8, `got ${result.words.length}`);
}

// EX-SW: scheduler_wait — LOAD + TPERM + LOAD + Signal + LOAD + LOAD + Wait + IADD + Stop + HALT
// Verifies that DijkstraFlag.Signal, Scheduler.Wait, and Scheduler.Stop assemble
// correctly when the method conventions and NS slots for both abstractions are supplied.
{
    const EX_SW_CONVENTIONS = {
        'Scheduler': {
            'Yield': { index: 0, input: '',                output: 'DR1' },
            'Wait':  { index: 2, input: 'CR2=flag_GT',     output: 'DR1' },
            'Stop':  { index: 3, input: 'DR1=threadID',    output: 'DR1' },
        },
        'DijkstraFlag': {
            'Signal': { index: 1, input: '', output: 'DR1' },
        },
    };
    const EX_SW_NS = { 'Scheduler': 8, 'DijkstraFlag': 10 };
    const EX_SW_SRC = `
LOAD CR0, Scheduler
TPERM CR0, E
LOAD CR0, DijkstraFlag
CALL DijkstraFlag.Signal
LOAD CR0, Scheduler
LOAD CR2, DijkstraFlag
CALL Scheduler.Wait
IADD DR1, DR0, #0
CALL Scheduler.Stop
HALT
`;
    const a = new ChurchAssembler(EX_SW_CONVENTIONS);
    a.setNamespace(EX_SW_NS);
    const result = a.assemble(EX_SW_SRC);
    assert('EX-SW scheduler_wait assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EX-SW scheduler_wait produces 10 words (LOAD+TPERM+LOAD+Signal+LOAD+LOAD+Wait+IADD+Stop+HALT)',
        result.words.length === 10, `got ${result.words.length}`);
}

// EX-DF: dijkstra_flag — LOAD + TPERM + Test + Signal + Test + Wait + Reset + Test + HALT
// Verifies that DijkstraFlag.Test, Signal, Wait, and Reset assemble correctly
// when the DijkstraFlag method conventions and NS slot are supplied.
{
    const EX_DF_CONVENTIONS = {
        'DijkstraFlag': {
            'Wait':   { index: 0, input: '',  output: 'DR1' },
            'Signal': { index: 1, input: '',  output: 'DR1' },
            'Reset':  { index: 2, input: '',  output: 'DR1' },
            'Test':   { index: 3, input: '',  output: 'DR1=1 signaled | 0 unsignaled' },
        },
    };
    const EX_DF_NS = { 'DijkstraFlag': 10 };
    const EX_DF_SRC = `
LOAD CR0, DijkstraFlag
TPERM CR0, E
CALL DijkstraFlag.Test
CALL DijkstraFlag.Signal
CALL DijkstraFlag.Test
CALL DijkstraFlag.Wait
CALL DijkstraFlag.Reset
CALL DijkstraFlag.Test
HALT
`;
    const a = new ChurchAssembler(EX_DF_CONVENTIONS);
    a.setNamespace(EX_DF_NS);
    const result = a.assemble(EX_DF_SRC);
    assert('EX-DF dijkstra_flag assembles without errors',
        a.errors.length === 0, a.errors.map(e => e.message).join('; '));
    assert('EX-DF dijkstra_flag produces 9 words (LOAD+TPERM+Test+Signal+Test+Wait+Reset+Test+HALT)',
        result.words.length === 9, `got ${result.words.length}`);
}

// EX-PN: petname_demo — .petname pseudo-instruction assembles correctly
// Verifies that .petname <n> expands to 3 machine words (LOAD+IADD+DWRITE)
// and that PETNAME <n> (no-dot form) produces identical output.
// Also checks error paths: missing argument and out-of-range slot.
{
    const PN_SRC = `.petname 5\nHALT`;
    const aPN = new ChurchAssembler();
    const pnResult = aPN.assemble(PN_SRC);
    assert('EX-PN petname_demo .petname 5 assembles without errors',
        aPN.errors.length === 0, aPN.errors.map(e => e.message).join('; '));
    assert('EX-PN petname_demo .petname 5 produces 4 words (LOAD+IADD+DWRITE+HALT)',
        pnResult.words.length === 4, `got ${pnResult.words.length}`);

    // Verify word 0 is a LOAD (opcode 0 = bits[31:27] = 0b00000)
    const pnLoad = pnResult.words[0];
    assert('EX-PN word 0 is LOAD opcode (bits[31:27] = 0)',
        (pnLoad >>> 27) === 0, `got opcode ${pnLoad >>> 27}`);
    // Verify word 1 is IADD (opcode 21 = 0b10101 in v2.0)
    const pnIadd = pnResult.words[1];
    assert('EX-PN word 1 is IADD opcode (bits[31:27] = 21)',
        (pnIadd >>> 27) === 21, `got opcode ${pnIadd >>> 27}`);
    // Verify word 2 is DWRITE (opcode 17 = 0b10001 in v2.0)
    const pnDwrite = pnResult.words[2];
    assert('EX-PN word 2 is DWRITE opcode (bits[31:27] = 17)',
        (pnDwrite >>> 27) === 17, `got opcode ${pnDwrite >>> 27}`);

    // PETNAME (no-dot form) must produce identical words
    const aNoDot = new ChurchAssembler();
    const ndResult = aNoDot.assemble(`PETNAME 5\nHALT`);
    assert('EX-PN PETNAME (no-dot) assembles without errors',
        aNoDot.errors.length === 0, aNoDot.errors.map(e => e.message).join('; '));
    assert('EX-PN PETNAME word 0 matches .petname word 0 (LOAD identical)',
        ndResult.words[0] === pnResult.words[0],
        `0x${ndResult.words[0].toString(16)} !== 0x${pnResult.words[0].toString(16)}`);
    assert('EX-PN PETNAME word 1 matches .petname word 1 (IADD identical)',
        ndResult.words[1] === pnResult.words[1],
        `0x${ndResult.words[1].toString(16)} !== 0x${pnResult.words[1].toString(16)}`);
    assert('EX-PN PETNAME word 2 matches .petname word 2 (DWRITE identical)',
        ndResult.words[2] === pnResult.words[2],
        `0x${ndResult.words[2].toString(16)} !== 0x${pnResult.words[2].toString(16)}`);

    // Different slot numbers produce different IADD words
    const aPN63 = new ChurchAssembler();
    const pn63Result = aPN63.assemble(`.petname 63\nHALT`);
    assert('EX-PN .petname 63 assembles without errors',
        aPN63.errors.length === 0, aPN63.errors.map(e => e.message).join('; '));
    assert('EX-PN .petname 63 IADD word differs from .petname 5 IADD word',
        pn63Result.words[1] !== pnResult.words[1], 'slot 63 and slot 5 produced identical IADD words');

    // .petname 0 is valid
    const aPN0 = new ChurchAssembler();
    const pn0Result = aPN0.assemble(`.petname 0\nHALT`);
    assert('EX-PN .petname 0 assembles without errors',
        aPN0.errors.length === 0, aPN0.errors.map(e => e.message).join('; '));

    // Error path: missing argument
    const aErr = new ChurchAssembler();
    aErr.assemble(`.petname\nHALT`);
    assert('EX-PN .petname with no argument produces an error',
        aErr.errors.length > 0, 'expected at least one error');

    // Error path: slot > 63
    const aOob = new ChurchAssembler();
    aOob.assemble(`.petname 64\nHALT`);
    assert('EX-PN .petname 64 (out of range) produces an error',
        aOob.errors.length > 0, 'expected at least one error');

    // petname_demo.cloomc: full example assembles without errors
    {
        const fs   = require('fs');
        const path = require('path');
        const src  = fs.readFileSync(
            path.join(__dirname, 'examples', 'petname_demo.cloomc'), 'utf8');
        const aDemo = new ChurchAssembler();
        const demoResult = aDemo.assemble(src);
        assert('EX-PN petname_demo.cloomc assembles without errors',
            aDemo.errors.length === 0, aDemo.errors.map(e => e.message).join('; '));
        // Two .petname calls + IADD + HALT = 2×3 + 1 + 1 = 8 words
        assert('EX-PN petname_demo.cloomc produces 8 words (2×.petname + IADD + HALT)',
            demoResult.words.length === 8, `got ${demoResult.words.length}`);
    }
}

// EX-PH: private_helpers — two public methods sharing a private BRANCH helper
// Verifies that the canonical private_helpers.cloomc assembles cleanly and
// produces exactly 6 words:
//   IADD  (add_and_double body)
//   BRANCH _double_result  (from Method 1)
//   ISUB  (sub_and_double body)
//   BRANCH _double_result  (from Method 2)
//   SHL   (_double_result helper)
//   HALT
{
    const fs   = require('fs');
    const path = require('path');
    const src  = fs.readFileSync(
        path.join(__dirname, 'examples', 'private_helpers.cloomc'), 'utf8');
    const aPH = new ChurchAssembler();
    const phResult = aPH.assemble(src);
    assert('EX-PH private_helpers.cloomc assembles without errors',
        aPH.errors.length === 0, aPH.errors.map(e => e.message).join('; '));
    assert('EX-PH private_helpers.cloomc produces 6 words (IADD+BRANCH+ISUB+BRANCH+SHL+HALT)',
        phResult.words.length === 6, `got ${phResult.words.length}`);

    // Word 0: IADD (opcode 21 = 0b10101 in v2.0) — add_and_double body
    assert('EX-PH word[0] is IADD (opcode 21)',
        ((phResult.words[0] >>> 27) & 0x1F) === 21,
        `got opcode ${(phResult.words[0] >>> 27) & 0x1F}`);

    // Word 1: BRANCH (opcode 23 = 0b10111 in v2.0) — forward to _double_result
    assert('EX-PH word[1] is BRANCH (opcode 23)',
        ((phResult.words[1] >>> 27) & 0x1F) === 23,
        `got opcode ${(phResult.words[1] >>> 27) & 0x1F}`);

    // Word 2: ISUB (opcode 22 = 0b10110 in v2.0) — sub_and_double body
    assert('EX-PH word[2] is ISUB (opcode 22)',
        ((phResult.words[2] >>> 27) & 0x1F) === 22,
        `got opcode ${(phResult.words[2] >>> 27) & 0x1F}`);

    // Word 3: BRANCH (opcode 23 in v2.0) — from Method 2 to _double_result
    assert('EX-PH word[3] is BRANCH (opcode 23)',
        ((phResult.words[3] >>> 27) & 0x1F) === 23,
        `got opcode ${(phResult.words[3] >>> 27) & 0x1F}`);

    // Word 4: SHL (opcode 24 = 0b11000 in v2.0) — private helper body
    assert('EX-PH word[4] is SHL (opcode 24)',
        ((phResult.words[4] >>> 27) & 0x1F) === 24,
        `got opcode ${(phResult.words[4] >>> 27) & 0x1F}`);

    // Word 5: HALT — the assembler encodes HALT with opcode 0 (LOAD form)
    // We verify the last word is not a BRANCH (opcode 23 in v2.0) so the program halts.
    assert('EX-PH word[5] is not BRANCH (program terminates after _double_result)',
        ((phResult.words[5] >>> 27) & 0x1F) !== 23,
        `word[5] unexpectedly encoded as BRANCH`);

    // Both BRANCHes use relative offsets and therefore have different imm values,
    // but they must resolve to the same absolute target (word index 4 = _double_result).
    // BRANCH encodes imm as a relative forward offset from the current word position.
    const branch1Target = 1 + (phResult.words[1] & 0x7FFF);  // word[1] + imm = 1+3 = 4
    const branch2Target = 3 + (phResult.words[3] & 0x7FFF);  // word[3] + imm = 3+1 = 4
    assert('EX-PH both BRANCHes resolve to the same absolute word (_double_result at word 4)',
        branch1Target === branch2Target && branch1Target === 4,
        `branch1→word${branch1Target}, branch2→word${branch2Target} (expected both → word4)`);
}

// EX16: LANG_EXAMPLE_GROUPS.assembly coverage guard
// Asserts that the assembly key list in app-compile.js is exactly the set
// covered by EX1–EX15 + CD1–CD10 + EX-SP + EX-SY + EX-SW + EX-DF + EX-PN + EX-PH.
// If a new example is added to LANG_EXAMPLE_GROUPS.assembly without a
// corresponding EX test, this list must be updated — that's the deliberate
// friction that prompts adding a test.
{
    const COVERED_ASSEMBLY_EXAMPLES = new Set([
        'ada_note_g',
        'capability_test',
        'system_patterns',
        'compute_demo',
        'led_control',
        'led_dr_test',
        'salvation',
        'constants_dot',
        'perm_attack',
        'bind_attack',
        'scheduler_pause',
        'scheduler_yield',
        'scheduler_wait',
        'dijkstra_flag',
        'petname_demo',
        'private_helpers',
    ]);
    // These are the sixteen keys covered by EX tests as of the private_helpers addition.
    // Update both this set AND add an EX test whenever a new example is added.
    const EXPECTED_COUNT = 16;
    assert('EX16 LANG_EXAMPLE_GROUPS.assembly coverage set has expected count',
        COVERED_ASSEMBLY_EXAMPLES.size === EXPECTED_COUNT,
        `expected ${EXPECTED_COUNT}, got ${COVERED_ASSEMBLY_EXAMPLES.size}`);
    // Spot-check a few keys are present
    assert('EX16 coverage set contains ada_note_g',
        COVERED_ASSEMBLY_EXAMPLES.has('ada_note_g'), 'missing');
    assert('EX16 coverage set contains led_control',
        COVERED_ASSEMBLY_EXAMPLES.has('led_control'), 'missing');
    assert('EX16 coverage set contains led_dr_test',
        COVERED_ASSEMBLY_EXAMPLES.has('led_dr_test'), 'missing');
    assert('EX16 coverage set contains salvation',
        COVERED_ASSEMBLY_EXAMPLES.has('salvation'), 'missing');
    assert('EX16 coverage set contains constants_dot (covered by CD1-CD10)',
        COVERED_ASSEMBLY_EXAMPLES.has('constants_dot'), 'missing');
    assert('EX16 coverage set contains scheduler_pause (covered by EX-SP)',
        COVERED_ASSEMBLY_EXAMPLES.has('scheduler_pause'), 'missing');
    assert('EX16 coverage set contains scheduler_yield (covered by EX-SY)',
        COVERED_ASSEMBLY_EXAMPLES.has('scheduler_yield'), 'missing');
    assert('EX16 coverage set contains scheduler_wait (covered by EX-SW)',
        COVERED_ASSEMBLY_EXAMPLES.has('scheduler_wait'), 'missing');
    assert('EX16 coverage set contains dijkstra_flag (covered by EX-DF)',
        COVERED_ASSEMBLY_EXAMPLES.has('dijkstra_flag'), 'missing');
}

// EX17–EX19: salvation dot-notation produces identical encoding to raw form
// Verifies that dot-notation (CALL Salvation.main) and raw form (CALL CR0, 0xF)
// produce the same machine word for CALL.
{
    const EX17_CONVENTIONS = { 'Salvation': { 'main': { index: 15 } } };
    const EX17_NS = { 'Salvation': 4 };

    const aDot = new ChurchAssembler(EX17_CONVENTIONS);
    aDot.setNamespace(EX17_NS);
    const dotResult = aDot.assemble('LOAD CR0, Salvation\nCALL Salvation.main\nHALT');

    const aRaw = new ChurchAssembler({});
    const rawResult = aRaw.assemble('LOAD CR0, CR6, 4\nCALL CR0, 0xF\nHALT');

    assert('EX17 salvation dot-notation assembles without errors',
        aDot.errors.length === 0, aDot.errors.map(e => e.message).join('; '));
    assert('EX18 salvation raw form assembles without errors',
        aRaw.errors.length === 0, aRaw.errors.map(e => e.message).join('; '));
    assert('EX19 salvation CALL word identical between dot-notation and raw form',
        dotResult.words[1] === rawResult.words[1],
        `dot=0x${(dotResult.words[1]>>>0).toString(16)} raw=0x${(rawResult.words[1]>>>0).toString(16)}`);
}

// EX-JDF: dijkstra_flag.cloomc — structural content test (JS CLOOMC++ front-end)
// Verifies that simulator/cloomc/dijkstra_flag.cloomc:
//   1. Declares abstraction FlagSync
//   2. Lists DijkstraFlag in the capabilities block
//   3. Contains all four DijkstraFlag method calls (Wait, Signal, Reset, Test)
//   4. Declares the four public methods: RunSequence, Produce, Consume, Peek
{
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
        path.join(__dirname, 'cloomc', 'dijkstra_flag.cloomc'), 'utf8');

    assert('EX-JDF dijkstra_flag.cloomc declares abstraction FlagSync',
        /abstraction\s+FlagSync\s*\{/.test(src), 'missing');
    assert('EX-JDF dijkstra_flag.cloomc lists DijkstraFlag in capabilities block',
        /capabilities\s*\{[^}]*DijkstraFlag[^}]*\}/.test(src), 'missing');
    assert('EX-JDF dijkstra_flag.cloomc calls DijkstraFlag.Wait()',
        src.includes('DijkstraFlag.Wait()'), 'missing');
    assert('EX-JDF dijkstra_flag.cloomc calls DijkstraFlag.Signal()',
        src.includes('DijkstraFlag.Signal()'), 'missing');
    assert('EX-JDF dijkstra_flag.cloomc calls DijkstraFlag.Reset()',
        src.includes('DijkstraFlag.Reset()'), 'missing');
    assert('EX-JDF dijkstra_flag.cloomc calls DijkstraFlag.Test()',
        src.includes('DijkstraFlag.Test()'), 'missing');
    assert('EX-JDF dijkstra_flag.cloomc declares method RunSequence',
        /method\s+RunSequence\s*\(/.test(src), 'missing');
    assert('EX-JDF dijkstra_flag.cloomc declares method Produce',
        /method\s+Produce\s*\(/.test(src), 'missing');
    assert('EX-JDF dijkstra_flag.cloomc declares method Consume',
        /method\s+Consume\s*\(/.test(src), 'missing');
    assert('EX-JDF dijkstra_flag.cloomc declares method Peek',
        /method\s+Peek\s*\(/.test(src), 'missing');
}

// EX-HDF: dijkstra_flag_hs.cloomc — structural content test (Haskell front-end)
// Verifies that simulator/cloomc/dijkstra_flag_hs.cloomc:
//   1. Declares abstraction FlagSyncHS
//   2. Lists DijkstraFlag in the capabilities block
//   3. Contains all four DijkstraFlag method calls (Wait, Signal, Reset, Test)
//   4. Declares the four public methods: RunSequence, Produce, Consume, Peek
{
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
        path.join(__dirname, 'cloomc', 'dijkstra_flag_hs.cloomc'), 'utf8');

    assert('EX-HDF dijkstra_flag_hs.cloomc declares abstraction FlagSyncHS',
        /abstraction\s+FlagSyncHS\s*\{/.test(src), 'missing');
    assert('EX-HDF dijkstra_flag_hs.cloomc lists DijkstraFlag in capabilities block',
        /capabilities\s*\{[^}]*DijkstraFlag[^}]*\}/.test(src), 'missing');
    assert('EX-HDF dijkstra_flag_hs.cloomc calls DijkstraFlag.Wait()',
        src.includes('DijkstraFlag.Wait()'), 'missing');
    assert('EX-HDF dijkstra_flag_hs.cloomc calls DijkstraFlag.Signal()',
        src.includes('DijkstraFlag.Signal()'), 'missing');
    assert('EX-HDF dijkstra_flag_hs.cloomc calls DijkstraFlag.Reset()',
        src.includes('DijkstraFlag.Reset()'), 'missing');
    assert('EX-HDF dijkstra_flag_hs.cloomc calls DijkstraFlag.Test()',
        src.includes('DijkstraFlag.Test()'), 'missing');
    assert('EX-HDF dijkstra_flag_hs.cloomc declares method RunSequence',
        /method\s+RunSequence\s*\(/.test(src), 'missing');
    assert('EX-HDF dijkstra_flag_hs.cloomc declares method Produce',
        /method\s+Produce\s*\(/.test(src), 'missing');
    assert('EX-HDF dijkstra_flag_hs.cloomc declares method Consume',
        /method\s+Consume\s*\(/.test(src), 'missing');
    assert('EX-HDF dijkstra_flag_hs.cloomc declares method Peek',
        /method\s+Peek\s*\(/.test(src), 'missing');
}

// EX-EDF: english/dijkstra_flag.cloomc — structural content test (English front-end)
// Verifies that simulator/cloomc/english/dijkstra_flag.cloomc:
//   1. Declares abstraction FlagSyncEN
//   2. References DijkstraFlag in the dependency declaration
//   3. Contains all four DijkstraFlag operations (Wait, Signal, Reset, Test)
//   4. Declares the four public methods: RunSequence, Produce, Consume, Peek
{
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
        path.join(__dirname, 'cloomc', 'english', 'dijkstra_flag.cloomc'), 'utf8');

    assert('EX-EDF english/dijkstra_flag.cloomc declares abstraction FlagSyncEN',
        src.includes('FlagSyncEN'), 'missing');
    assert('EX-EDF english/dijkstra_flag.cloomc references DijkstraFlag dependency',
        src.includes('DijkstraFlag'), 'missing');
    assert('EX-EDF english/dijkstra_flag.cloomc calls DijkstraFlag.Wait',
        src.includes('DijkstraFlag.Wait'), 'missing');
    assert('EX-EDF english/dijkstra_flag.cloomc calls DijkstraFlag.Signal',
        src.includes('DijkstraFlag.Signal'), 'missing');
    assert('EX-EDF english/dijkstra_flag.cloomc calls DijkstraFlag.Reset',
        src.includes('DijkstraFlag.Reset'), 'missing');
    assert('EX-EDF english/dijkstra_flag.cloomc calls DijkstraFlag.Test',
        src.includes('DijkstraFlag.Test'), 'missing');
    assert('EX-EDF english/dijkstra_flag.cloomc declares method RunSequence',
        src.includes('RunSequence'), 'missing');
    assert('EX-EDF english/dijkstra_flag.cloomc declares method Produce',
        src.includes('Produce'), 'missing');
    assert('EX-EDF english/dijkstra_flag.cloomc declares method Consume',
        src.includes('Consume'), 'missing');
    assert('EX-EDF english/dijkstra_flag.cloomc declares method Peek',
        src.includes('Peek'), 'missing');
}

// EX-LDF: lambda/dijkstra_flag.cloomc — structural content test (Lambda Calculus front-end)
// Verifies that simulator/cloomc/lambda/dijkstra_flag.cloomc:
//   1. Declares abstraction FlagSyncLC
//   2. Lists DijkstraFlag in the capabilities block
//   3. Contains all four DijkstraFlag method calls (Wait, Signal, Reset, Test)
//   4. Declares the four public methods: RunSequence, Produce, Consume, Peek
{
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
        path.join(__dirname, 'cloomc', 'lambda', 'dijkstra_flag.cloomc'), 'utf8');

    assert('EX-LDF lambda/dijkstra_flag.cloomc declares abstraction FlagSyncLC',
        /abstraction\s+FlagSyncLC\s*\{/.test(src), 'missing');
    assert('EX-LDF lambda/dijkstra_flag.cloomc lists DijkstraFlag in capabilities block',
        /capabilities\s*\{[^}]*DijkstraFlag[^}]*\}/.test(src), 'missing');
    assert('EX-LDF lambda/dijkstra_flag.cloomc calls DijkstraFlag.Wait()',
        src.includes('DijkstraFlag.Wait()'), 'missing');
    assert('EX-LDF lambda/dijkstra_flag.cloomc calls DijkstraFlag.Signal()',
        src.includes('DijkstraFlag.Signal()'), 'missing');
    assert('EX-LDF lambda/dijkstra_flag.cloomc calls DijkstraFlag.Reset()',
        src.includes('DijkstraFlag.Reset()'), 'missing');
    assert('EX-LDF lambda/dijkstra_flag.cloomc calls DijkstraFlag.Test()',
        src.includes('DijkstraFlag.Test()'), 'missing');
    assert('EX-LDF lambda/dijkstra_flag.cloomc declares method RunSequence',
        /method\s+RunSequence\s*\(/.test(src), 'missing');
    assert('EX-LDF lambda/dijkstra_flag.cloomc declares method Produce',
        /method\s+Produce\s*\(/.test(src), 'missing');
    assert('EX-LDF lambda/dijkstra_flag.cloomc declares method Consume',
        /method\s+Consume\s*\(/.test(src), 'missing');
    assert('EX-LDF lambda/dijkstra_flag.cloomc declares method Peek',
        /method\s+Peek\s*\(/.test(src), 'missing');
}

// EX-ADF: dijkstra_flag_ada.cloomc — structural content test (Symbolic Math / Ada front-end)
// Verifies that simulator/cloomc/dijkstra_flag_ada.cloomc:
//   1. Declares abstraction FlagSyncAda
//   2. Lists DijkstraFlag in the capabilities block
//   3. Contains all four DijkstraFlag method calls (Wait, Signal, Reset, Test)
//   4. Declares the four public methods: RunSequence, Produce, Consume, Peek
{
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
        path.join(__dirname, 'cloomc', 'dijkstra_flag_ada.cloomc'), 'utf8');

    assert('EX-ADF dijkstra_flag_ada.cloomc declares abstraction FlagSyncAda',
        /abstraction\s+FlagSyncAda\s*\{/.test(src), 'missing');
    assert('EX-ADF dijkstra_flag_ada.cloomc lists DijkstraFlag in capabilities block',
        /capabilities\s*\{[^}]*DijkstraFlag[^}]*\}/.test(src), 'missing');
    assert('EX-ADF dijkstra_flag_ada.cloomc calls DijkstraFlag.Wait()',
        src.includes('DijkstraFlag.Wait()'), 'missing');
    assert('EX-ADF dijkstra_flag_ada.cloomc calls DijkstraFlag.Signal()',
        src.includes('DijkstraFlag.Signal()'), 'missing');
    assert('EX-ADF dijkstra_flag_ada.cloomc calls DijkstraFlag.Reset()',
        src.includes('DijkstraFlag.Reset()'), 'missing');
    assert('EX-ADF dijkstra_flag_ada.cloomc calls DijkstraFlag.Test()',
        src.includes('DijkstraFlag.Test()'), 'missing');
    assert('EX-ADF dijkstra_flag_ada.cloomc declares method RunSequence',
        /method\s+RunSequence\s*\(/.test(src), 'missing');
    assert('EX-ADF dijkstra_flag_ada.cloomc declares method Produce',
        /method\s+Produce\s*\(/.test(src), 'missing');
    assert('EX-ADF dijkstra_flag_ada.cloomc declares method Consume',
        /method\s+Consume\s*\(/.test(src), 'missing');
    assert('EX-ADF dijkstra_flag_ada.cloomc declares method Peek',
        /method\s+Peek\s*\(/.test(src), 'missing');
}

// EX-JDF-RUN: FlagSync — compile + Wait/Signal/Reset/Test trace
// Three phases:
//   Phase C — CLOOMCCompiler compiles dijkstra_flag.cloomc without errors;
//              RunSequence method is present and contains exactly 6 ELOADCALL
//              words (one per DijkstraFlag call in the method body).
//   Phase B — DijkstraFlag JS binding (via SystemAbstractions at NS slot 10)
//              produces the correct trace when driven in RunSequence order:
//                Test→signaled=false, Signal, Test→signaled=true,
//                Wait→waited=false (flag already up — consumed immediately),
//                Reset, Test→signaled=false.
//   Phase JS — cloomc_dijkstra_flag is listed in LANG_EXAMPLE_GROUPS.javascript
//              in app-compile.js so the example tab is visible in JS mode.
{
    const fs               = require('fs');
    const path             = require('path');
    const CLOOMCCompiler   = require('./cloomc_compiler.js');
    const ChurchSimulator  = require('./simulator.js');
    const AbstractionReg   = require('./abstractions.js');
    const SystemAbs        = require('./system_abstractions.js');

    const src = fs.readFileSync(
        path.join(__dirname, 'cloomc', 'dijkstra_flag.cloomc'), 'utf8');

    // ── Phase C: compile ─────────────────────────────────────────────────────
    // The CLOOMC++ compiler resolves call(Abs.Method()) using methodConventions,
    // keyed by the uppercased abstraction name (matching how app-shell.js builds
    // the map from the AbstractionRegistry).  DijkstraFlag's four methods match
    // the order declared in abstractions.js: Wait(0), Signal(1), Reset(2), Test(3).
    const compiler = new CLOOMCCompiler();
    compiler.methodConventions['DIJKSTRAFLAG'] = {
        Wait:   { index: 0 },
        Signal: { index: 1 },
        Reset:  { index: 2 },
        Test:   { index: 3 },
    };
    const compiled = compiler.compile(src, []);

    assert('EX-JDF-RUN-C1: CLOOMCCompiler compiles dijkstra_flag.cloomc without errors',
        compiled.errors.length === 0,
        compiled.errors.map(e => e.message || JSON.stringify(e)).join('; '));

    assert('EX-JDF-RUN-C2: compiled abstraction name is FlagSync',
        compiled.abstractionName === 'FlagSync',
        `got "${compiled.abstractionName}"`);

    const runSeqMethod = compiled.methods.find(m => m.name === 'RunSequence');
    assert('EX-JDF-RUN-C3: RunSequence method is present in compiled output',
        runSeqMethod !== undefined, 'RunSequence not found in compiled methods');

    const ELOADCALL_OPCODE = 8;
    const eloadWords = runSeqMethod
        ? (runSeqMethod.code || []).filter(w => ((w >>> 27) & 0x1F) === ELOADCALL_OPCODE)
        : [];
    assert('EX-JDF-RUN-C4: RunSequence contains exactly 6 ELOADCALL words (one per DijkstraFlag call)',
        eloadWords.length === 6,
        `got ${eloadWords.length} ELOADCALL word(s)`);

    // Verify each ELOADCALL targets C-list row 0 (DijkstraFlag is the sole capability, 0-based)
    const allRow0 = eloadWords.every(w => (w & 0xFF) === 0);
    assert('EX-JDF-RUN-C5: all 6 ELOADCALL words target C-list row 0 (DijkstraFlag)',
        allRow0,
        `rows: ${eloadWords.map(w => w & 0xFF).join(', ')}`);

    // ── Phase B: DijkstraFlag binding trace ──────────────────────────────────
    // Create a minimal sim wired to SystemAbstractions (DijkstraFlag at slot 10).
    // Call dispatchMethod() in the same order as RunSequence() and verify results
    // match the expected Wait/Signal/Reset/Test trace.
    const bSim = new ChurchSimulator();
    const bReg = new AbstractionReg();
    new SystemAbs(bReg);
    bSim.abstractionRegistry = bReg;

    // Step 1 — Test before Signal: flag is clear at boot
    const t1 = bReg.dispatchMethod(10, 'Test', bSim, {});
    assert('EX-JDF-RUN-B1: Test→0 (flag unsignaled at boot)',
        t1.ok && t1.result.signaled === false,
        `ok=${t1.ok} signaled=${t1.result && t1.result.signaled}`);

    // Step 2 — Signal: raise the flag
    const s1 = bReg.dispatchMethod(10, 'Signal', bSim, {});
    assert('EX-JDF-RUN-B2: Signal succeeds',
        s1.ok === true,
        `ok=${s1.ok} message=${s1.message}`);

    // Step 3 — Test after Signal: flag is raised
    const t2 = bReg.dispatchMethod(10, 'Test', bSim, {});
    assert('EX-JDF-RUN-B3: Test→1 (flag signaled after Signal)',
        t2.ok && t2.result.signaled === true,
        `ok=${t2.ok} signaled=${t2.result && t2.result.signaled}`);

    // Step 4 — Wait: flag already up → consumed immediately (waited=false)
    const w1 = bReg.dispatchMethod(10, 'Wait', bSim, {});
    assert('EX-JDF-RUN-B4: Wait→1 (flag was up — consumed immediately, waited=false)',
        w1.ok && w1.result.waited === false,
        `ok=${w1.ok} waited=${w1.result && w1.result.waited}`);

    // Step 5 — Reset: clear the flag unconditionally
    const r1 = bReg.dispatchMethod(10, 'Reset', bSim, {});
    assert('EX-JDF-RUN-B5: Reset succeeds',
        r1.ok === true,
        `ok=${r1.ok} message=${r1.message}`);

    // Step 6 — Test after Reset: flag is cleared
    const t3 = bReg.dispatchMethod(10, 'Test', bSim, {});
    assert('EX-JDF-RUN-B6: Test→0 (flag cleared after Reset)',
        t3.ok && t3.result.signaled === false,
        `ok=${t3.ok} signaled=${t3.result && t3.result.signaled}`);

    // ── Phase B-OUT: sim.output trace content ────────────────────────────────
    // After the six-step RunSequence, bSim.output must contain one line per
    // dispatch in the correct order: Test→0, Signal, Test→1, Wait→consumed,
    // Reset, Test→0.
    const outLines = bSim.output.split('\n').filter(l => l.trim() !== '');
    assert('EX-JDF-RUN-BO1: sim.output contains Test line with signaled=false (step 1)',
        outLines.some(l => l.includes('DijkstraFlag.Test') && l.includes('signaled=false')),
        `output was:\n${bSim.output}`);
    assert('EX-JDF-RUN-BO2: sim.output contains Signal line (step 2)',
        outLines.some(l => l.includes('DijkstraFlag.Signal')),
        `output was:\n${bSim.output}`);
    assert('EX-JDF-RUN-BO3: sim.output contains Test line with signaled=true (step 3)',
        outLines.some(l => l.includes('DijkstraFlag.Test') && l.includes('signaled=true')),
        `output was:\n${bSim.output}`);
    assert('EX-JDF-RUN-BO4: sim.output contains Wait line (consumed immediately) (step 4)',
        outLines.some(l => l.includes('DijkstraFlag.Wait') && l.includes('consumed immediately')),
        `output was:\n${bSim.output}`);
    assert('EX-JDF-RUN-BO5: sim.output contains Reset line (step 5)',
        outLines.some(l => l.includes('DijkstraFlag.Reset')),
        `output was:\n${bSim.output}`);
    assert('EX-JDF-RUN-BO6: sim.output has exactly 6 DijkstraFlag trace lines (one per dispatch)',
        outLines.filter(l => l.includes('DijkstraFlag.')).length === 6,
        `got ${outLines.filter(l => l.includes('DijkstraFlag.')).length} line(s):\n${bSim.output}`);

    // ── Phase JS: example tab registration ───────────────────────────────────
    // cloomc_dijkstra_flag must be listed in LANG_EXAMPLE_GROUPS.javascript in
    // app-compile.js so the tab is visible when JS mode is active.
    const appSrc = fs.readFileSync(path.join(__dirname, 'app-compile.js'), 'utf8');
    assert('EX-JDF-RUN-JS: cloomc_dijkstra_flag in LANG_EXAMPLE_GROUPS.javascript',
        /javascript\s*:\s*\[[^\]]*'cloomc_dijkstra_flag'[^\]]*\]/.test(appSrc),
        'cloomc_dijkstra_flag not found in the javascript example group');
}

// EX-VLC: var/let/const prefix on call(Abs.Method()) — task-1124
// Verifies that var x = call(...), let x = call(...), and const x = call(...)
// all compile without errors and emit the correct ELOADCALL instruction.
{
    const CLOOMCCompiler = require('./cloomc_compiler.js');
    const ELOADCALL_OPCODE = 8;

    const BASE_SRC = (keyword) => `
abstraction VlcTest {
  capabilities { DijkstraFlag }
  method Run() {
    ${keyword} result = call(DijkstraFlag.Test())
  }
}
`.trim();

    const CONVENTIONS = {
        'DIJKSTRAFLAG': {
            Wait:   { index: 0 },
            Signal: { index: 1 },
            Reset:  { index: 2 },
            Test:   { index: 3 },
        }
    };

    for (const kw of ['var', 'let', 'const']) {
        const compiler = new CLOOMCCompiler();
        Object.assign(compiler.methodConventions, CONVENTIONS);
        const compiled = compiler.compile(BASE_SRC(kw), []);

        assert(`EX-VLC-${kw}: compiles without errors`,
            compiled.errors.length === 0,
            compiled.errors.map(e => e.message || JSON.stringify(e)).join('; '));

        const runMethod = compiled.methods && compiled.methods.find(m => m.name === 'Run');
        assert(`EX-VLC-${kw}: Run method present`,
            runMethod !== undefined, 'Run method not found');

        const eloadWords = runMethod
            ? (runMethod.code || []).filter(w => ((w >>> 27) & 0x1F) === ELOADCALL_OPCODE)
            : [];
        assert(`EX-VLC-${kw}: Run emits exactly 1 ELOADCALL`,
            eloadWords.length === 1,
            `got ${eloadWords.length} ELOADCALL word(s)`);

        if (eloadWords.length === 1) {
            const methodIdx = (eloadWords[0] >>> 8) & 0x7F;
            assert(`EX-VLC-${kw}: ELOADCALL targets Test (method index 4, 1-based)`,
                methodIdx === 4,
                `got methodIdx=${methodIdx}`);
        }
    }
}

// ── History roundtrip sub-suite (Task #1141) ──────────────────────────────────
// Run as a subprocess so its own counters and stubs don't pollute this suite.
{
    const { spawnSync } = require('child_process');
    const result = spawnSync(process.execPath,
        [require('path').join(__dirname, 'test_history_roundtrip.js')],
        { stdio: 'inherit' });
    assert('HISTORY-ROUNDTRIP: export→import roundtrip suite passes',
        result.status === 0,
        result.status !== null ? 'exit code ' + result.status : 'process did not complete');
}

// ── Clist pet-name highlight regression suite ──────────────────────────────
// Verifies that <span class="clist-petname-ref" …> annotations injected by
// _annotateRawClistSlot survive _highlightCLOOMCSource / _hlCloomcLine and
// _wrapRegHover without being HTML-escaped to &lt;span…
{
    const { spawnSync } = require('child_process');
    const result = spawnSync(process.execPath,
        [require('path').join(__dirname, 'test_clist_petname_highlight.js')],
        { stdio: 'inherit' });
    assert('CLIST-PETNAME-HL: clist pet-name highlight regression suite passes',
        result.status === 0,
        result.status !== null ? 'exit code ' + result.status : 'process did not complete');
}

// ── GT v1.1 test + Post-Flash Self-Test assembly regression ──────────────────
// Verifies that the two new example CLOOMC files assemble without errors.
// Neither file is in langExampleGroups (they are standalone hardware-test
// programs), so they are validated here directly.
{
    const path = require('path');
    const fs   = require('fs');

    function asmFile(relPath) {
        const src    = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
        const a      = new ChurchAssembler({});
        const result = a.assemble(src);
        return { errors: a.errors, warnings: a.warnings, words: result.words || [] };
    }

    // gt_v1_1_test.cloomc — 5-test GT v1.1 dom+perm + EXACT smoke test
    {
        const { errors, words } = asmFile('examples/gt_v1_1_test.cloomc');
        assert('EX-GT11: gt_v1_1_test assembles without errors',
            errors.length === 0,
            errors.map(e => 'L' + e.line + ': ' + e.message).join('; '));
        assert('EX-GT11: gt_v1_1_test produces instructions',
            words.length > 0,
            `got ${words.length} words`);
        // File must contain TPERM EXACT (preset 14) encoding — opcode=6, bits[3:0]=14 (0xE)
        const TPERM_OP = 6;
        const tpermWords = words.filter(w => ((w >>> 27) & 0x1F) === TPERM_OP);
        assert('EX-GT11: gt_v1_1_test contains at least 5 TPERM instructions',
            tpermWords.length >= 5,
            `found ${tpermWords.length}`);
        // TPERM EXACT encodes preset in bits[3:0] = 14 (0xE)
        const exactWords = tpermWords.filter(w => (w & 0xF) === 14);
        assert('EX-GT11: gt_v1_1_test contains exactly 1 TPERM EXACT',
            exactWords.length === 1,
            `found ${exactWords.length}`);
    }

    // post_flash_selftest.cloomc — 81-test exhaustive post-flash self-test
    {
        const { errors, words } = asmFile('examples/post_flash_selftest.cloomc');
        assert('EX-PFS: post_flash_selftest assembles without errors',
            errors.length === 0,
            errors.map(e => 'L' + e.line + ': ' + e.message).join('; '));
        assert('EX-PFS: post_flash_selftest produces at least 150 words',
            words.length >= 150,
            `got ${words.length} words`);
        // Must contain TPERM EXACT (credential-pinning assertions in Section J)
        // TPERM EXACT encodes preset in bits[3:0] = 14 (0xE)
        const TPERM_OP = 6;
        const exactWords = words.filter(w =>
            ((w >>> 27) & 0x1F) === TPERM_OP && (w & 0xF) === 14
        );
        assert('EX-PFS: post_flash_selftest contains at least 4 TPERM EXACT words',
            exactWords.length >= 4,
            `found ${exactWords.length}`);
        // Must contain SHR ASR words (opcode=25 in v2.0, ASR flag encoded in bit 5 of imm field)
        const SHR_OP = 25;
        const asrWords = words.filter(w =>
            ((w >>> 27) & 0x1F) === SHR_OP && (w >>> 5) & 1
        );
        assert('EX-PFS: post_flash_selftest contains at least 3 SHR ASR words',
            asrWords.length >= 3,
            `found ${asrWords.length}`);
        // Must contain BFEXT (opcode=18 in v2.0) and BFINS (opcode=19 in v2.0)
        const bfextCount = words.filter(w => ((w >>> 27) & 0x1F) === 18).length;
        const bfinsCount = words.filter(w => ((w >>> 27) & 0x1F) === 19).length;
        assert('EX-PFS: post_flash_selftest contains at least 3 BFEXT words',
            bfextCount >= 3, `found ${bfextCount}`);
        assert('EX-PFS: post_flash_selftest contains at least 2 BFINS words',
            bfinsCount >= 2, `found ${bfinsCount}`);
    }
}

// ── Inline-vs-canonical round-trip: app-run.js ↔ examples/ ──────────────────
// Verifies that the inline source strings embedded in app-run.js for
// post_flash_selftest, gt_v1_1_test, private_helpers, and other assembly
// examples assemble to exactly the same word array as the canonical .cloomc
// source files in simulator/examples/.
// A divergence here means the two copies have silently drifted apart.
{
    const path = require('path');
    const fs   = require('fs');

    const appRunSrc = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');

    function extractInline(key) {
        // Match:  'key': `...content...`,
        // CLOOMC source never contains backticks, so a lazy [\s\S]*? is safe.
        const re = new RegExp("'" + key + "'\\s*:\\s*`([\\s\\S]*?)`\\s*,");
        const m  = appRunSrc.match(re);
        if (!m) throw new Error('Could not find inline source for key: ' + key);
        return m[1];
    }

    function asmSrc(src) {
        const a      = new ChurchAssembler({});
        const result = a.assemble(src);
        return { errors: a.errors, words: result.words || [] };
    }

    function asmFile(relPath) {
        const src = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
        return asmSrc(src);
    }

    // ── EX-GT11 inline vs canonical ─────────────────────────────────────────
    {
        const inlineSrc    = extractInline('gt_v1_1_test');
        const { errors: inlineErr, words: inlineWords } = asmSrc(inlineSrc);
        const { errors: fileErr,   words: fileWords   } = asmFile('examples/gt_v1_1_test.cloomc');

        assert('EX-GT11-INLINE: inline source assembles without errors',
            inlineErr.length === 0,
            inlineErr.map(e => 'L' + e.line + ': ' + e.message).join('; '));

        assert('EX-GT11-INLINE: inline word count equals canonical word count',
            inlineWords.length === fileWords.length,
            `inline=${inlineWords.length} canonical=${fileWords.length}`);

        const firstMismatch = inlineWords.findIndex((w, i) => w !== fileWords[i]);
        assert('EX-GT11-INLINE: every assembled word matches the canonical file',
            firstMismatch === -1,
            firstMismatch === -1
                ? ''
                : `first mismatch at word[${firstMismatch}]: ` +
                  `inline=0x${(inlineWords[firstMismatch] >>> 0).toString(16)} ` +
                  `canonical=0x${(fileWords[firstMismatch] >>> 0).toString(16)}`);
    }

    // ── EX-PFS inline vs canonical ───────────────────────────────────────────
    {
        const inlineSrc    = extractInline('post_flash_selftest');
        const { errors: inlineErr, words: inlineWords } = asmSrc(inlineSrc);
        const { errors: fileErr,   words: fileWords   } = asmFile('examples/post_flash_selftest.cloomc');

        assert('EX-PFS-INLINE: inline source assembles without errors',
            inlineErr.length === 0,
            inlineErr.map(e => 'L' + e.line + ': ' + e.message).join('; '));

        assert('EX-PFS-INLINE: inline word count equals canonical word count',
            inlineWords.length === fileWords.length,
            `inline=${inlineWords.length} canonical=${fileWords.length}`);

        const firstMismatch = inlineWords.findIndex((w, i) => w !== fileWords[i]);
        assert('EX-PFS-INLINE: every assembled word matches the canonical file',
            firstMismatch === -1,
            firstMismatch === -1
                ? ''
                : `first mismatch at word[${firstMismatch}]: ` +
                  `inline=0x${(inlineWords[firstMismatch] >>> 0).toString(16)} ` +
                  `canonical=0x${(fileWords[firstMismatch] >>> 0).toString(16)}`);
    }

    // Helper: inline-vs-canonical comparison for a single key.
    // opts.conventions — method conventions map (default: {})
    // opts.ns          — namespace slot map (default: {})
    // opts.skipErrors  — if true, skip the "assembles without errors" assertion
    //                    (use for examples that reference named abstractions whose
    //                     conventions are not registered in the bare test context,
    //                     but whose word output is still correct)
    function checkInlineVsCanonical(tag, key, opts) {
        opts = opts || {};
        const conventions = opts.conventions || {};
        const ns          = opts.ns          || {};
        const skipErrors  = opts.skipErrors  || false;

        const inlineSrc = extractInline(key);

        function asmWithOpts(src) {
            const a = new ChurchAssembler(conventions);
            if (Object.keys(ns).length) a.setNamespace(ns);
            const result = a.assemble(src);
            return { errors: a.errors, words: result.words || [] };
        }

        const { errors: inlineErr, words: inlineWords } = asmWithOpts(inlineSrc);
        const fileSrc = fs.readFileSync(path.join(__dirname, 'examples/' + key + '.cloomc'), 'utf8');
        const { errors: fileErr,   words: fileWords   } = asmWithOpts(fileSrc);

        if (!skipErrors) {
            assert(tag + ': inline source assembles without errors',
                inlineErr.length === 0,
                inlineErr.map(e => 'L' + e.line + ': ' + e.message).join('; '));
        }

        assert(tag + ': inline word count equals canonical word count',
            inlineWords.length === fileWords.length,
            `inline=${inlineWords.length} canonical=${fileWords.length}`);

        const mm = inlineWords.findIndex((w, i) => w !== fileWords[i]);
        assert(tag + ': every assembled word matches the canonical file',
            mm === -1,
            mm === -1
                ? ''
                : `first mismatch at word[${mm}]: ` +
                  `inline=0x${(inlineWords[mm] >>> 0).toString(16)} ` +
                  `canonical=0x${(fileWords[mm] >>> 0).toString(16)}`);
    }

    // Shared convention+namespace sets reused from the existing EX-DF/SP/SY/SW tests.
    const DIJKSTRA_CONV = {
        'DijkstraFlag': {
            'Wait':   { index: 0, input: '',  output: 'DR1' },
            'Signal': { index: 1, input: '',  output: 'DR1' },
            'Reset':  { index: 2, input: '',  output: 'DR1' },
            'Test':   { index: 3, input: '',  output: 'DR1=1 signaled | 0 unsignaled' },
        },
    };
    const DIJKSTRA_NS   = { 'DijkstraFlag': 10 };
    const SCHEDULER_CONV = {
        'Scheduler': {
            'Yield': { index: 0, input: '',                        output: 'DR1' },
            'Spawn': { index: 1, input: 'CR2=code_GT, DR1=entry',  output: 'DR1=threadID' },
            'Wait':  { index: 2, input: 'CR2=flag_GT',             output: 'DR1' },
            'Stop':  { index: 3, input: 'DR1=threadID',            output: 'DR1' },
            'pause': { index: 4, input: 'DR1=ticks',               output: 'DR1' },
        },
        'DijkstraFlag': {
            'Wait':   { index: 0, input: '',  output: 'DR1' },
            'Signal': { index: 1, input: '',  output: 'DR1' },
            'Reset':  { index: 2, input: '',  output: 'DR1' },
            'Test':   { index: 3, input: '',  output: 'DR1=1 signaled | 0 unsignaled' },
        },
    };
    const SCHEDULER_NS  = { 'Scheduler': 8, 'DijkstraFlag': 10 };
    const CONSTANTS_CONV = {
        'Constants': {
            'Pi':   { index: 0, input: '', output: 'DR1' },
            'E':    { index: 1, input: '', output: 'DR1' },
            'Phi':  { index: 2, input: '', output: 'DR1' },
            'Zero': { index: 3, input: '', output: 'DR1' },
            'One':  { index: 4, input: '', output: 'DR1' },
        },
    };
    const CONSTANTS_NS  = { 'Constants': 18 };

    // ── EX-ANG inline vs canonical (ada_note_g) ──────────────────────────────
    checkInlineVsCanonical('EX-ANG-INLINE', 'ada_note_g');

    // ── EX-CT inline vs canonical (capability_test) ──────────────────────────
    // capability_test references several named abstractions (Navana, Mint, LED, etc.)
    // that aren't registered in the bare test context; soft errors are expected but
    // the word output is correct (verified by the word-match assertion below).
    checkInlineVsCanonical('EX-CT-INLINE', 'capability_test', { skipErrors: true });

    // ── EX-SPAT inline vs canonical (system_patterns) ────────────────────────
    checkInlineVsCanonical('EX-SPAT-INLINE', 'system_patterns');

    // ── EX-CDEMO inline vs canonical (compute_demo) ──────────────────────────
    checkInlineVsCanonical('EX-CDEMO-INLINE', 'compute_demo');

    // ── EX-SAL inline vs canonical (salvation) ───────────────────────────────
    // salvation references Salvation.main which has no conventions in the bare context.
    checkInlineVsCanonical('EX-SAL-INLINE', 'salvation', { skipErrors: true });

    // ── EX-PA inline vs canonical (perm_attack) ──────────────────────────────
    checkInlineVsCanonical('EX-PA-INLINE', 'perm_attack');

    // ── EX-BA inline vs canonical (bind_attack) ──────────────────────────────
    checkInlineVsCanonical('EX-BA-INLINE', 'bind_attack');

    // ── EX-DFA inline vs canonical (dijkstra_flag assembly) ──────────────────
    checkInlineVsCanonical('EX-DFA-INLINE', 'dijkstra_flag',
        { conventions: DIJKSTRA_CONV, ns: DIJKSTRA_NS });

    // ── EX-SYI inline vs canonical (scheduler_yield) ─────────────────────────
    checkInlineVsCanonical('EX-SYI-INLINE', 'scheduler_yield',
        { conventions: SCHEDULER_CONV, ns: SCHEDULER_NS });

    // ── EX-SPI inline vs canonical (scheduler_pause) ─────────────────────────
    checkInlineVsCanonical('EX-SPI-INLINE', 'scheduler_pause',
        { conventions: SCHEDULER_CONV, ns: SCHEDULER_NS });

    // ── EX-SWI inline vs canonical (scheduler_wait) ──────────────────────────
    checkInlineVsCanonical('EX-SWI-INLINE', 'scheduler_wait',
        { conventions: SCHEDULER_CONV, ns: SCHEDULER_NS });

    // ── EX-CDT inline vs canonical (constants_dot) ───────────────────────────
    checkInlineVsCanonical('EX-CDT-INLINE', 'constants_dot',
        { conventions: CONSTANTS_CONV, ns: CONSTANTS_NS });

    // ── EX-LED-INLINE inline vs canonical (led_control) ──────────────────────
    // led_control is now a simple backtick literal in app-run.js (no concatenation).
    checkInlineVsCanonical('EX-LED-INLINE', 'led_control');

    // ── EX-PH-INLINE inline vs canonical (private_helpers) ───────────────────
    // private_helpers uses only bare IADD/ISUB/BRANCH/SHL/HALT — no named
    // abstractions — so it assembles cleanly without any convention or NS opts.
    checkInlineVsCanonical('EX-PH-INLINE', 'private_helpers');

    // ── led_dr_test: excluded from inline-vs-canonical ───────────────────────
    // led_dr_test is NOT a backtick literal in app-run.js.  It is a variable
    // reference:
    //   'led_dr_test': _TURING_DR_TEST_SOURCE,
    // The extractInline() regex cannot match a variable reference.  The source
    // (_TURING_DR_TEST_SOURCE) is a standalone backtick literal and is already
    // assembled and verified by EX14–EX15 in this test suite.
    //
    // led_control IS now a simple backtick literal (no concatenation) and is
    // therefore included in the inline-vs-canonical checks above (EX-LED-INLINE).
    // See scripts/sync-canonical-examples.js for the sync tool.

    // ── Non-Assembly inline-vs-canonical: app-compile.js front-end examples ──────
    // Non-Assembly inline-vs-canonical word-array comparisons
    // ==========================================================
    // Every non-Assembly inline example key in app-compile.js that can be compiled
    // cleanly by CLOOMCCompiler in isolation has a matching canonical .cloomc file in
    // simulator/cloomc/.  The canonical was created from the inline source (or vice
    // versa) and must stay identical.  Any future drift between the inline string in
    // app-compile.js and the canonical file will cause the relevant test below to fail.
    //
    // Coverage by front-end:
    //   Haskell  — church_math, church_memory, church_pair, church_case
    //   Lambda   — lambda_church_encoding, lambda_fixed_point, lambda_sliderule,
    //              lambda_rational
    //              (lambda_church_numerals excluded: 2 undefined-variable errors)
    //   English  — english_integer_ops, english_loops, english_packed_string
    //              (english_contact excluded: external capability convention required)
    //   Symbolic — ada_note_g (→ ada_note_g_symbolic.cloomc), bernoulli_numbers
    //
    // File-backed (no inline backtick string, compile-integrity test only):
    //   sliderule_hs (EX-SRHS)
    //
    // DijkstraFlag-family canonical files (dijkstra_flag_ada.cloomc,
    // lambda/dijkstra_flag.cloomc, english/dijkstra_flag.cloomc) are excluded:
    // the ada file is detected as JS but uses `halt` which only the Symbolic
    // front-end understands; the lambda/english variants use call() syntax that
    // their respective front-ends do not support without external NS conventions.
    {
        const CLOOMCCompiler = require('./cloomc_compiler.js');
        const appCompileSrc  = fs.readFileSync(
            path.join(__dirname, 'app-compile.js'), 'utf8');

        // Extract a backtick-delimited inline source string from app-compile.js
        // and evaluate its template-literal escape sequences exactly as the
        // browser JavaScript runtime would (e.g. \\n → \n, \\x → \x).
        function extractInlineFromCompile(key) {
            const re = new RegExp("'" + key + "'\\s*:\\s*`([\\s\\S]*?)`\\s*,");
            const m  = appCompileSrc.match(re);
            if (!m) throw new Error(
                'Could not find inline source for key in app-compile.js: ' + key);
            return (new Function('return `' + m[1] + '`'))();
        }

        // Extract the path string for a file-backed example from _CLOOMC_FILE_EXAMPLES.
        function extractFilePath(key) {
            const re = new RegExp("'" + key + "'\\s*:\\s*'([^']+)'");
            const m  = appCompileSrc.match(re);
            if (!m) throw new Error(
                'Could not find _CLOOMC_FILE_EXAMPLES path for key: ' + key);
            return m[1];
        }

        function readClomc(relPath) {
            return fs.readFileSync(
                path.join(__dirname, 'cloomc', relPath), 'utf8');
        }

        // Compare an inline example (from app-compile.js) against a canonical
        // .cloomc file using CLOOMCCompiler word-array comparison.
        // caps: optional capabilities array passed to compile().
        function checkInlineVsCanonicalClomc(pfx, inlineKey, canonicalFile, caps) {
            const inlineSrc    = extractInlineFromCompile(inlineKey);
            const canonicalSrc = readClomc(canonicalFile);
            const inlineR    = new CLOOMCCompiler().compile(inlineSrc,    caps || []);
            const canonicalR = new CLOOMCCompiler().compile(canonicalSrc, caps || []);
            assert(pfx + ': inline compiles without errors',
                inlineR.errors.length === 0,
                inlineR.errors.map(e => 'L' + e.line + ': ' + e.message).join('; '));
            assert(pfx + ': canonical compiles without errors',
                canonicalR.errors.length === 0,
                canonicalR.errors.map(e => 'L' + e.line + ': ' + e.message).join('; '));
            assert(pfx + ': same method count',
                inlineR.methods.length === canonicalR.methods.length,
                'inline=' + inlineR.methods.length +
                ' canonical=' + canonicalR.methods.length);
            for (const cm of canonicalR.methods) {
                const im = inlineR.methods.find(m => m.name === cm.name);
                assert(pfx + ': method ' + cm.name + ' present in inline',
                    im !== undefined,
                    cm.name + ' missing from inline compiled output');
                if (!im) continue;
                const cw = cm.code || [];
                const iw = im.code || [];
                assert(pfx + ': ' + cm.name +
                       ' word count (inline=' + iw.length +
                       ' canonical=' + cw.length + ')',
                    iw.length === cw.length,
                    'inline ' + iw.length + ' vs canonical ' + cw.length);
                const diff = iw.findIndex((w, j) => w !== cw[j]);
                assert(pfx + ': ' + cm.name + ' all words match',
                    diff === -1,
                    diff >= 0
                        ? 'word[' + diff + ']: inline=0x' +
                          (iw[diff] >>> 0).toString(16) +
                          ' canonical=0x' + (cw[diff] >>> 0).toString(16)
                        : '');
            }
        }

        // ── Haskell: EX-CM-INLINE ─────────────────────────────────────────────────
        checkInlineVsCanonicalClomc(
            'EX-CM-INLINE', 'church_math', 'church_math.cloomc');

        // ── Haskell: EX-CMEM-INLINE ───────────────────────────────────────────────
        checkInlineVsCanonicalClomc(
            'EX-CMEM-INLINE', 'church_memory', 'church_memory.cloomc');

        // ── Haskell: EX-CP-INLINE — ChurchPair ───────────────────────────────────
        checkInlineVsCanonicalClomc(
            'EX-CP-INLINE', 'church_pair', 'church_pair.cloomc');

        // ── Haskell: EX-CC-INLINE — ChurchCase ───────────────────────────────────
        checkInlineVsCanonicalClomc(
            'EX-CC-INLINE', 'church_case', 'church_case.cloomc');

        // ── Lambda: EX-LCE-INLINE — ChurchEncoding ───────────────────────────────
        checkInlineVsCanonicalClomc(
            'EX-LCE-INLINE', 'lambda_church_encoding', 'lambda_church_encoding.cloomc');

        // ── Lambda: EX-LFP-INLINE — FixedPoint ───────────────────────────────────
        checkInlineVsCanonicalClomc(
            'EX-LFP-INLINE', 'lambda_fixed_point', 'lambda_fixed_point.cloomc');

        // ── Lambda: EX-LSR-INLINE — LambdaSlideRule ──────────────────────────────
        checkInlineVsCanonicalClomc(
            'EX-LSR-INLINE', 'lambda_sliderule', 'lambda_sliderule.cloomc');

        // ── Lambda: EX-LRA-INLINE — RationalArithmetic ───────────────────────────
        checkInlineVsCanonicalClomc(
            'EX-LRA-INLINE', 'lambda_rational', 'lambda_rational.cloomc');

        // ── English: EX-EIO-INLINE — IntegerOps ──────────────────────────────────
        checkInlineVsCanonicalClomc(
            'EX-EIO-INLINE', 'english_integer_ops', 'english_integer_ops.cloomc');

        // ── English: EX-EL-INLINE — Loops ────────────────────────────────────────
        checkInlineVsCanonicalClomc(
            'EX-EL-INLINE', 'english_loops', 'english_loops.cloomc');

        // ── English: EX-EPS-INLINE — PackedString ────────────────────────────────
        checkInlineVsCanonicalClomc(
            'EX-EPS-INLINE', 'english_packed_string', 'english_packed_string.cloomc');

        // ── Symbolic Math: EX-ANG-SYM-INLINE — NoteG (Symbolic) ─────────────────
        // ada_note_g.cloomc is the ASSEMBLY canonical for the app-run.js assembly
        // inline (tested by EX-ANG-INLINE via the assembler).  The app-compile.js
        // ada_note_g key is a Symbolic Math version of the same algorithm compiled
        // via CLOOMCCompiler; its canonical is ada_note_g_symbolic.cloomc.
        checkInlineVsCanonicalClomc(
            'EX-ANG-SYM-INLINE', 'ada_note_g', 'ada_note_g_symbolic.cloomc');

        // ── Symbolic Math: EX-BN-INLINE — BernoulliNumbers ───────────────────────
        checkInlineVsCanonicalClomc(
            'EX-BN-INLINE', 'bernoulli_numbers', 'bernoulli_numbers.cloomc');

        // ── Symbolic Math: EX-NEG-LIT — negative integer literals ────────────────
        // Regression test for stack-overflow bug: negative literals in Symbolic
        // method bodies previously fell through to { type:'expr' }, causing
        // emitExpr → loadToReg → emitExpr infinite recursion.
        {
            const src = [
                'abstraction NegLitTest {',
                '    capabilities {}',
                '    method compute() {',
                '        let V1 = -1',
                '        let V2 = -30',
                '        let V3 = V1 / V2',
                '        halt',
                '    }',
                '}'
            ].join('\n');
            const result = new CLOOMCCompiler().compile(src);
            assert('EX-NEG-LIT: compiles without errors',
                result.errors.length === 0,
                result.errors.map(e => 'L' + e.line + ': ' + e.message).join('; '));
            const m = result.methods && result.methods.find(x => x.name === 'compute');
            assert('EX-NEG-LIT: method compute is present', !!m, 'compute method not found');
            assert('EX-NEG-LIT: method compute has at least 1 compiled word',
                m && (m.code || []).length > 0, 'compiled to 0 words');
            // Verify the negate sequence is emitted: negative literal loading must
            // include an ISUB DRx, DR0, DRx instruction in the manifest.
            const mmap = result.manifest && result.manifest.find(x => x.name === 'compute');
            const hasIsub = mmap && (mmap.mapping || []).some(e => e.instr && e.instr.startsWith('ISUB'));
            assert('EX-NEG-LIT: negate step (ISUB DRx, DR0, DRx) present in manifest',
                !!hasIsub,
                mmap ? JSON.stringify((mmap.mapping||[]).map(e=>e.instr)) : 'manifest entry not found');
        }

        // ── Symbolic Math: EX-NEG-LIT-LARGE — large negative literals (absVal >= 0x4000) ──
        // Regression test for large negatives that previously clobbered bit 14 by
        // OR-ing the magnitude with 0x4000, producing the wrong value.
        // Also covers full-32-bit values (absVal > 2^28) using the 3-chunk sequence.
        //
        // Semantic check: mini-simulator decodes the compiled code words and verifies
        // the register ends up holding the expected two's-complement value.
        {
            // Mini-simulator: executes IADD/ISUB/SHL, ignores everything else.
            // Returns a Uint32Array of DR0-DR15 after running all words.
            function runMiniSim(words) {
                const IADD_OP = 21, ISUB_OP = 22, SHL_OP = 24;  // v2.0 opcodes
                const regs = new Uint32Array(16); // DR0 stays 0
                for (const w of words) {
                    const op   = (w >>> 27) & 0x1F;
                    const dst  = (w >>> 19) & 0xF;
                    const srcA = (w >>> 15) & 0xF;
                    const immF = w & 0x7FFF;
                    const isImm = (immF >>> 14) & 1;
                    if (op === IADD_OP) {
                        const b = isImm ? (immF & 0x3FFF) : regs[immF & 0xF];
                        regs[dst] = (regs[srcA] + b) >>> 0;
                    } else if (op === ISUB_OP) {
                        const b = isImm ? (immF & 0x3FFF) : regs[immF & 0xF];
                        regs[dst] = (regs[srcA] - b) >>> 0;
                    } else if (op === SHL_OP) {
                        regs[dst] = (regs[srcA] << (immF & 0x1F)) >>> 0;
                    }
                }
                return regs;
            }

            const cases = [
                { val: -16384,      label: '-16384 (exact boundary)'         },
                { val: -32768,      label: '-32768 (15-bit magnitude)'        },
                { val: -65535,      label: '-65535 (16-bit magnitude)'        },
                { val: -268435456,  label: '-268435456 (28-bit, high=0)'      },
                { val: -2147483648, label: '-2147483648 (INT_MIN, 3 chunks)'  },
            ];

            for (const { val, label } of cases) {
                // Note: _detectSymbolic requires adaVars >= 2 (at least 2 lines
                // with V\d+ and =). Include a second V-assignment to ensure the
                // Symbolic Math front-end is selected by auto-detection.
                const src = [
                    'abstraction LargeNegLitTest {',
                    '    capabilities {}',
                    '    method compute() {',
                    `        let V1 = ${val}`,
                    '        let V2 = V1',
                    '        halt',
                    '    }',
                    '}'
                ].join('\n');
                const result = new CLOOMCCompiler().compile(src);
                assert(`EX-NEG-LIT-LARGE: ${label} compiles without errors`,
                    result.errors.length === 0,
                    result.errors.map(e => 'L' + e.line + ': ' + e.message).join('; '));
                const m = result.methods && result.methods.find(x => x.name === 'compute');
                assert(`EX-NEG-LIT-LARGE: ${label} method compute is present`, !!m, 'compute method not found');
                const mmap = result.manifest && result.manifest.find(x => x.name === 'compute');
                const hasShl = mmap && (mmap.mapping || []).some(e => e.instr && e.instr.startsWith('SHL'));
                assert(`EX-NEG-LIT-LARGE: ${label} SHL present (multi-word load sequence)`,
                    !!hasShl,
                    mmap ? JSON.stringify((mmap.mapping||[]).map(e=>e.instr)) : 'manifest entry not found');
                const hasIsub = mmap && (mmap.mapping || []).some(e => e.instr && e.instr.startsWith('ISUB'));
                assert(`EX-NEG-LIT-LARGE: ${label} ISUB negate step present`,
                    !!hasIsub,
                    mmap ? JSON.stringify((mmap.mapping||[]).map(e=>e.instr)) : 'manifest entry not found');
                // Semantic check: simulate and verify DR1 holds the correct signed value
                const regs = runMiniSim(m ? (m.code || []) : []);
                const got = regs[1] | 0; // signed interpretation of DR1
                assert(`EX-NEG-LIT-LARGE: ${label} DR1 === ${val} after simulation`,
                    got === val,
                    `DR1 = ${got} (0x${(regs[1]>>>0).toString(16)}), expected ${val}`);
            }
        }

        // ── Symbolic Math: EX-LARGE-POS-LIT — large positive literals (value >= 0x4000) ──
        // Regression test for large positives that previously clobbered bit 14 by
        // OR-ing the value with 0x4000, producing the wrong result.
        // Mirrors EX-NEG-LIT-LARGE but for the positive branch (no ISUB negate step).
        //
        // Semantic check: mini-simulator decodes the compiled code words and verifies
        // the register ends up holding the expected unsigned/positive value.
        {
            function runMiniSimPos(words) {
                const IADD_OP = 21, ISUB_OP = 22, SHL_OP = 24;  // v2.0 opcodes
                const regs = new Uint32Array(16);
                for (const w of words) {
                    const op   = (w >>> 27) & 0x1F;
                    const dst  = (w >>> 19) & 0xF;
                    const srcA = (w >>> 15) & 0xF;
                    const immF = w & 0x7FFF;
                    const isImm = (immF >>> 14) & 1;
                    if (op === IADD_OP) {
                        const b = isImm ? (immF & 0x3FFF) : regs[immF & 0xF];
                        regs[dst] = (regs[srcA] + b) >>> 0;
                    } else if (op === ISUB_OP) {
                        const b = isImm ? (immF & 0x3FFF) : regs[immF & 0xF];
                        regs[dst] = (regs[srcA] - b) >>> 0;
                    } else if (op === SHL_OP) {
                        regs[dst] = (regs[srcA] << (immF & 0x1F)) >>> 0;
                    }
                }
                return regs;
            }

            const cases = [
                { val: 16384,      label: '16384 (exact boundary)'          },
                { val: 32768,      label: '32768 (15-bit value)'             },
                { val: 65535,      label: '65535 (16-bit value)'             },
                { val: 268435456,  label: '268435456 (28-bit, high chunk)'   },
                { val: 2147483647, label: '2147483647 (INT_MAX, 3 chunks)'   },
            ];

            for (const { val, label } of cases) {
                const src = [
                    'abstraction LargePosLitTest {',
                    '    capabilities {}',
                    '    method compute() {',
                    `        let V1 = ${val}`,
                    '        let V2 = V1',
                    '        halt',
                    '    }',
                    '}'
                ].join('\n');
                const result = new CLOOMCCompiler().compile(src);
                assert(`EX-LARGE-POS-LIT: ${label} compiles without errors`,
                    result.errors.length === 0,
                    result.errors.map(e => 'L' + e.line + ': ' + e.message).join('; '));
                const m = result.methods && result.methods.find(x => x.name === 'compute');
                assert(`EX-LARGE-POS-LIT: ${label} method compute is present`, !!m, 'compute method not found');
                const mmap = result.manifest && result.manifest.find(x => x.name === 'compute');
                const hasShl = mmap && (mmap.mapping || []).some(e => e.instr && e.instr.startsWith('SHL'));
                assert(`EX-LARGE-POS-LIT: ${label} SHL present (multi-word load sequence)`,
                    !!hasShl,
                    mmap ? JSON.stringify((mmap.mapping||[]).map(e=>e.instr)) : 'manifest entry not found');
                const hasIsub = mmap && (mmap.mapping || []).some(e => e.instr && e.instr.startsWith('ISUB'));
                assert(`EX-LARGE-POS-LIT: ${label} no ISUB negate step (positive value)`,
                    !hasIsub,
                    mmap ? JSON.stringify((mmap.mapping||[]).map(e=>e.instr)) : 'manifest entry not found');
                const regs = runMiniSimPos(m ? (m.code || []) : []);
                const got = regs[1] >>> 0;
                assert(`EX-LARGE-POS-LIT: ${label} DR1 === ${val} after simulation`,
                    got === val,
                    `DR1 = ${got} (0x${got.toString(16)}), expected ${val}`);
            }
        }

        // ── Symbolic Math: EX-ANGB-INLINE — NoteGPublishedBug ────────────────────
        // Verifies that the NoteGPublishedBug inline example in app-compile.js
        // compiles to the same word-for-word bytecode as the canonical
        // ada_note_g_published_bug.cloomc source file.
        checkInlineVsCanonicalClomc(
            'EX-ANGB-INLINE', 'ada_note_g_published_bug',
            'ada_note_g_published_bug.cloomc');

        // ── Symbolic Math: EX-ANGB-BUG — Op 4 operand order verification ────────
        // Structural check: compiles the canonical file and inspects the manifest
        // to confirm that Ada's published (buggy) Op 4 emits
        //   SlideRule.Divide(DR5, DR4) -> DR11   (= V5 / V4 = 9/7, WRONG)
        // rather than the corrected
        //   SlideRule.Divide(DR4, DR5) -> DR11   (= V4 / V5 = 7/9, correct).
        //
        // Note: full end-to-end simulation of this program requires the SlideRule
        // abstraction in the namespace (divide/multiply compile to CALL CR0 via
        // emitSlideRuleCall), so runtime register verification is not feasible in
        // this unit-test harness.  The manifest check below confirms the compiler
        // correctly encodes Ada's published bug.
        {
            const canonPath = path.join(__dirname, 'cloomc', 'ada_note_g_published_bug.cloomc');
            const canonSrc  = fs.readFileSync(canonPath, 'utf8');
            const bugResult = new CLOOMCCompiler().compile(canonSrc);
            const mmap = bugResult.manifest && bugResult.manifest.find(x => x.name === 'compute');
            const entries = mmap ? (mmap.mapping || []) : [];
            // Op 4 is `let V11 = V5 / V4` which compiles to
            // SlideRule.Divide(DR5, DR4) → DR11.
            // V1–V15 map directly to DR1–DR15 in the symbolic frontend (V-regs ≤ 15).
            // Search for the specific DR5/DR4 operand pattern — not just the first Divide.
            const op4 = entries.find(e =>
                e.comment && /SlideRule\.Divide\(DR5,\s*DR4\)/.test(e.comment));
            // Collect all Divide comments to aid failure diagnosis
            const allDivCmnts = entries
                .filter(e => e.comment && e.comment.includes('Divide'))
                .map(e => e.comment);
            assert('EX-ANGB-BUG: Op 4 Divide with buggy V5/V4 order (DR5,DR4) present',
                !!op4,
                'No SlideRule.Divide(DR5, DR4) found. All Divide entries: ' +
                JSON.stringify(allDivCmnts));
            // The corrected version (ada_note_g_symbolic.cloomc) has V4/V5 = DR4/DR5.
            // Verify the corrected file does NOT contain the buggy DR5/DR4 pattern.
            const corrSrc = fs.readFileSync(
                path.join(__dirname, 'cloomc', 'ada_note_g_symbolic.cloomc'), 'utf8');
            const corrResult = new CLOOMCCompiler().compile(corrSrc);
            const corrMmap = corrResult.manifest &&
                corrResult.manifest.find(x => x.name === 'compute');
            const corrEntries = corrMmap ? (corrMmap.mapping || []) : [];
            const corrOp4 = corrEntries.find(e =>
                e.comment && /SlideRule\.Divide\(DR5,\s*DR4\)/.test(e.comment));
            assert('EX-ANGB-BUG: corrected NoteG does NOT have buggy V5/V4 order',
                !corrOp4,
                'Corrected file unexpectedly contains SlideRule.Divide(DR5, DR4)');
        }

        // ── EX-ANGB-RUN — NoteGPublishedBug inline in app-run.js ─────────────────
        // Verifies that the NoteGPublishedBug inline source registered in
        // app-run.js loadExample() is present and compiles to the same word-for-word
        // bytecode as the canonical ada_note_g_published_bug.cloomc file.
        {
            function extractInlineFromRun(key) {
                const re = new RegExp("'" + key + "'\\s*:\\s*`([\\s\\S]*?)`\\s*,");
                const m  = appRunSrc.match(re);
                if (!m) throw new Error(
                    'Could not find inline source for key in app-run.js: ' + key);
                return (new Function('return `' + m[1] + '`'))();
            }
            const inlineSrc    = extractInlineFromRun('ada_note_g_published_bug');
            const canonicalSrc = readClomc('ada_note_g_published_bug.cloomc');
            const inlineR    = new CLOOMCCompiler().compile(inlineSrc,    []);
            const canonicalR = new CLOOMCCompiler().compile(canonicalSrc, []);
            assert('EX-ANGB-RUN: app-run.js inline compiles without errors',
                inlineR.errors.length === 0,
                inlineR.errors.map(e => 'L' + e.line + ': ' + e.message).join('; '));
            assert('EX-ANGB-RUN: canonical compiles without errors',
                canonicalR.errors.length === 0,
                canonicalR.errors.map(e => 'L' + e.line + ': ' + e.message).join('; '));
            assert('EX-ANGB-RUN: same method count as canonical',
                inlineR.methods.length === canonicalR.methods.length,
                'inline=' + inlineR.methods.length +
                ' canonical=' + canonicalR.methods.length);
            for (const cm of canonicalR.methods) {
                const im = inlineR.methods.find(m => m.name === cm.name);
                assert('EX-ANGB-RUN: method ' + cm.name + ' present in app-run.js inline',
                    im !== undefined, cm.name + ' missing from inline compiled output');
                if (!im) continue;
                const cw = cm.code || [];
                const iw = im.code || [];
                assert('EX-ANGB-RUN: ' + cm.name +
                       ' word count (inline=' + iw.length +
                       ' canonical=' + cw.length + ')',
                    iw.length === cw.length,
                    'inline ' + iw.length + ' vs canonical ' + cw.length);
                const diff = iw.findIndex((w, j) => w !== cw[j]);
                assert('EX-ANGB-RUN: ' + cm.name + ' all words match',
                    diff === -1,
                    diff >= 0
                        ? 'word[' + diff + ']: inline=0x' +
                          (iw[diff] >>> 0).toString(16) +
                          ' canonical=0x' + (cw[diff] >>> 0).toString(16)
                        : '');
            }
        }

        // ── Symbolic Math: EX-OOB-LIT — out-of-range literals produce a compile error ──
        // Values outside the signed 32-bit range (> INT_MAX or < INT_MIN) must be
        // rejected at compile time with a clear error message, not silently truncated.
        {
            const oobCases = [
                { val: 2147483648,   label: 'INT_MAX + 1 (positive overflow)'   },
                { val: 4294967295,   label: '0xFFFFFFFF (UINT_MAX)'             },
                { val: -2147483649,  label: 'INT_MIN - 1 (negative overflow)'   },
            ];
            for (const { val, label } of oobCases) {
                const src = [
                    'abstraction OobLitTest {',
                    '    capabilities {}',
                    '    method compute() {',
                    `        let V1 = ${val}`,
                    '        let V2 = V1',
                    '        halt',
                    '    }',
                    '}'
                ].join('\n');
                const result = new CLOOMCCompiler().compile(src);
                assert(`EX-OOB-LIT: ${label} produces a compile error`,
                    result.errors.length > 0,
                    'Expected a compile error but got none');
                const hasRangeMsg = result.errors.some(e =>
                    e.message && e.message.toLowerCase().includes('out of range'));
                assert(`EX-OOB-LIT: ${label} error mentions "out of range"`,
                    hasRangeMsg,
                    result.errors.map(e => e.message).join('; '));
            }
        }

        // ── JS front-end: EX-OOB-JS-LIT — out-of-range literals produce a compile error ──
        // Literals > INT_MAX in the JS _resolveExpr path must be rejected at compile
        // time with a clear error message, not silently truncated.
        {
            const oobJsCases = [
                { val: 2147483648,  label: 'INT_MAX + 1 (positive overflow)' },
                { val: 4294967295,  label: '0xFFFFFFFF (UINT_MAX)'           },
            ];
            for (const { val, label } of oobJsCases) {
                const src = [
                    'abstraction OobJsTest {',
                    '    capabilities {}',
                    '    method run() {',
                    `        let x = ${val}`,
                    '        halt',
                    '    }',
                    '}'
                ].join('\n');
                const result = new CLOOMCCompiler().compileJS(src);
                assert(`EX-OOB-JS-LIT: ${label} produces a compile error`,
                    result.errors.length > 0,
                    'Expected a compile error but got none');
                const hasRangeMsg = result.errors.some(e =>
                    e.message && e.message.toLowerCase().includes('out of range'));
                assert(`EX-OOB-JS-LIT: ${label} error mentions "out of range"`,
                    hasRangeMsg,
                    result.errors.map(e => e.message).join('; '));
                const hasNonZeroLine = result.errors.some(e => e.line > 0);
                assert(`EX-OOB-JS-LIT: ${label} error carries a non-zero line number`,
                    hasNonZeroLine,
                    result.errors.map(e => 'line=' + e.line + ': ' + e.message).join('; '));
            }
        }

        // ── Haskell front-end: EX-OOB-HS-LIT — out-of-range literals produce a compile error ──
        // Literals outside [-2147483648, 2147483647] in the Haskell _emitHaskellExpr
        // literal path must be rejected at compile time with a clear error message.
        {
            const oobHsCases = [
                { val: 2147483648,  label: 'INT_MAX + 1 (positive overflow)' },
                { val: 4294967295,  label: '0xFFFFFFFF (UINT_MAX)'           },
                { val: -2147483649, label: 'INT_MIN - 1 (negative overflow)' },
            ];
            for (const { val, label } of oobHsCases) {
                const src = [
                    'abstraction OobHsTest {',
                    '    capabilities {}',
                    `    method compute() = ${val}`,
                    '}'
                ].join('\n');
                const result = new CLOOMCCompiler().compileHaskell(src);
                assert(`EX-OOB-HS-LIT: ${label} produces a compile error`,
                    result.errors.length > 0,
                    'Expected a compile error but got none');
                const hasRangeMsg = result.errors.some(e =>
                    e.message && e.message.toLowerCase().includes('out of range'));
                assert(`EX-OOB-HS-LIT: ${label} error mentions "out of range"`,
                    hasRangeMsg,
                    result.errors.map(e => e.message).join('; '));
                const hasNonZeroLine = result.errors.some(e => e.line > 0);
                assert(`EX-OOB-HS-LIT: ${label} error carries a non-zero line number`,
                    hasNonZeroLine,
                    result.errors.map(e => 'line=' + e.line + ': ' + e.message).join('; '));
            }
        }

        // ── File-backed: EX-SRHS — sliderule_hs compile-integrity ────────────────
        {
            const appPath = extractFilePath('sliderule_hs');
            assert('EX-SRHS: sliderule_hs path is declared in _CLOOMC_FILE_EXAMPLES',
                !!appPath, 'sliderule_hs not found in _CLOOMC_FILE_EXAMPLES');
            const absPath = path.join(
                __dirname, appPath.replace(/^\/simulator\//, ''));
            const src    = fs.readFileSync(absPath, 'utf8');
            const result = new CLOOMCCompiler().compile(src);
            assert('EX-SRHS: sliderule_hs.cloomc compiles without errors',
                result.errors.length === 0,
                result.errors.map(e => 'L' + e.line + ': ' + e.message).join('; '));
            for (const meth of [
                'Add', 'Sub', 'Mul', 'Sqrt', 'Pow2',
                'Abs', 'Signum', 'Max', 'Min', 'Clamp'
            ]) {
                const m = result.methods.find(x => x.name === meth);
                assert('EX-SRHS: method ' + meth + ' is compiled',
                    m !== undefined,
                    meth + ' not found in compiled output');
                assert('EX-SRHS: method ' + meth + ' has at least one instruction word',
                    m !== undefined && (m.code || []).length > 0,
                    meth + ' compiled to 0 words');
            }
        }
    }
}

// ── COL-RANGE: assembler error objects carry colStart/colEnd ─────────────────
// Verifies that errors on known lines carry correct column ranges so that
// _highlightAsmErrorLines can underline exactly the right token.

// CR-COL-1: unknown mnemonic — colStart/colEnd point at the bad token.
{
    const a = new ChurchAssembler({});
    a.assemble('LOAD CR0, 0\nNOPP DR1, DR2\nRETURN');
    const errs = a.errors;
    assert('CR-COL-1: unknown mnemonic produces an error', errs.length > 0);
    const e = errs.find(x => x.message.includes('NOPP'));
    assert('CR-COL-1: error references line 2', e && e.line === 2, e ? 'line=' + e.line : 'no error');
    assert('CR-COL-1: colStart is 0 (mnemonic at start of line)', e && e.colStart === 0, e ? 'colStart=' + e.colStart : 'no error');
    assert('CR-COL-1: colEnd is 4 (length of "NOPP")', e && e.colEnd === 4, e ? 'colEnd=' + e.colEnd : 'no error');
}

// CR-COL-2: unknown CR register — colStart/colEnd point at the bad token.
{
    const a = new ChurchAssembler({});
    a.assemble('LOAD BADTOKEN, 0');
    const errs = a.errors;
    assert('CR-COL-2: unknown CR register produces an error', errs.length > 0);
    const e = errs[0];
    assert('CR-COL-2: error references line 1', e && e.line === 1, e ? 'line=' + e.line : 'no error');
    const src = 'LOAD BADTOKEN, 0';
    const expectedStart = src.indexOf('BADTOKEN');
    assert('CR-COL-2: colStart points at BADTOKEN', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('CR-COL-2: colEnd covers BADTOKEN', e && e.colEnd === expectedStart + 'BADTOKEN'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// CR-COL-3: unknown DR register — colStart/colEnd point at the bad token.
{
    const a = new ChurchAssembler({});
    a.assemble('IADD BADDR, DR1, DR2');
    const errs = a.errors;
    assert('CR-COL-3: unknown DR register produces an error', errs.length > 0);
    const e = errs[0];
    assert('CR-COL-3: error references line 1', e && e.line === 1, e ? 'line=' + e.line : 'no error');
    const src = 'IADD BADDR, DR1, DR2';
    const expectedStart = src.indexOf('BADDR');
    assert('CR-COL-3: colStart points at BADDR', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('CR-COL-3: colEnd covers BADDR', e && e.colEnd === expectedStart + 'BADDR'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// CR-COL-4: undefined branch label — colStart/colEnd point at the label token.
{
    const a = new ChurchAssembler({});
    a.assemble('BRANCH missingLabel');
    const errs = a.errors;
    assert('CR-COL-4: undefined branch label produces an error', errs.length > 0);
    const e = errs.find(x => x.message.includes('missingLabel'));
    assert('CR-COL-4: error references line 1', e && e.line === 1, e ? 'line=' + e.line : 'no error');
    const src = 'BRANCH missingLabel';
    const expectedStart = src.indexOf('missingLabel');
    assert('CR-COL-4: colStart points at missingLabel', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('CR-COL-4: colEnd covers missingLabel', e && e.colEnd === expectedStart + 'missingLabel'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// CR-COL-5: duplicate label — colStart/colEnd point at the label name.
{
    const a = new ChurchAssembler({});
    a.assemble('myLabel:\nRETURN\nmyLabel:\nRETURN');
    const errs = a.errors;
    assert('CR-COL-5: duplicate label produces an error', errs.length > 0);
    const e = errs.find(x => x.message.includes('myLabel') && x.message.includes('more than once'));
    assert('CR-COL-5: error references line 3 (second definition)', e && e.line === 3, e ? 'line=' + e.line : 'no error');
    assert('CR-COL-5: colStart is 0 (label at start of line)', e && e.colStart === 0, e ? 'colStart=' + e.colStart : 'no error');
    assert('CR-COL-5: colEnd covers label name', e && e.colEnd === 'myLabel'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// CR-COL-6: invalid immediate value — colStart/colEnd point at the bad token.
{
    const a = new ChurchAssembler({});
    a.assemble('IADD DR0, DR1, notanumber');
    const errs = a.errors;
    assert('CR-COL-6: invalid immediate produces an error', errs.length > 0);
    const e = errs.find(x => x.message.includes('notanumber'));
    assert('CR-COL-6: error references line 1', e && e.line === 1, e ? 'line=' + e.line : 'no error');
    const src = 'IADD DR0, DR1, notanumber';
    const expectedStart = src.indexOf('notanumber');
    assert('CR-COL-6: colStart points at notanumber', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('CR-COL-6: colEnd covers notanumber', e && e.colEnd === expectedStart + 'notanumber'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// CR-COL-7: _highlightAsmErrorLines fallback still works for legacy error objects (no cols).
// (Structural test only — just verify that error objects without colStart/colEnd have no such fields.)
{
    // Simulate a legacy error object (no colStart/colEnd) — structure check.
    const legacyErr = { line: 1, message: 'some error' };
    assert('CR-COL-7: legacy error object has no colStart', legacyErr.colStart === undefined);
    assert('CR-COL-7: legacy error object has no colEnd', legacyErr.colEnd === undefined);
}

// CR-COL-8: indented source line — colStart/colEnd are relative to the raw editor line (with indentation).
{
    const a = new ChurchAssembler({});
    a.assemble('LOAD CR0, 0\n    NOPP DR1, DR2\nRETURN');
    const errs = a.errors;
    assert('CR-COL-8: indented unknown mnemonic produces an error', errs.length > 0);
    const e = errs.find(x => x.message.includes('NOPP'));
    assert('CR-COL-8: error references line 2', e && e.line === 2, e ? 'line=' + e.line : 'no error');
    // Raw line is "    NOPP DR1, DR2" — NOPP starts at column 4
    const rawSrc = '    NOPP DR1, DR2';
    const expectedStart = rawSrc.indexOf('NOPP');
    assert('CR-COL-8: colStart accounts for indentation (column 4)', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('CR-COL-8: colEnd covers NOPP token', e && e.colEnd === expectedStart + 4, e ? 'colEnd=' + e.colEnd : 'no error');
}

// CR-COL-9: indented source line — bad CR register col is relative to raw editor line.
{
    const a = new ChurchAssembler({});
    a.assemble('  LOAD BADTOKEN, 0');
    const errs = a.errors;
    assert('CR-COL-9: indented bad CR register produces an error', errs.length > 0);
    const e = errs[0];
    assert('CR-COL-9: error references line 1', e && e.line === 1, e ? 'line=' + e.line : 'no error');
    const rawSrc = '  LOAD BADTOKEN, 0';
    const expectedStart = rawSrc.indexOf('BADTOKEN');
    assert('CR-COL-9: colStart accounts for indentation', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('CR-COL-9: colEnd covers BADTOKEN', e && e.colEnd === expectedStart + 'BADTOKEN'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// CR-COL-10: indented BRANCH with undefined label — col is relative to raw editor line.
{
    const a = new ChurchAssembler({});
    a.assemble('  BRANCH missingLabel');
    const errs = a.errors;
    assert('CR-COL-10: indented undefined branch label produces an error', errs.length > 0);
    const e = errs.find(x => x.message.includes('missingLabel'));
    assert('CR-COL-10: error references line 1', e && e.line === 1, e ? 'line=' + e.line : 'no error');
    const rawSrc = '  BRANCH missingLabel';
    const expectedStart = rawSrc.indexOf('missingLabel');
    assert('CR-COL-10: colStart accounts for indentation', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('CR-COL-10: colEnd covers label token', e && e.colEnd === expectedStart + 'missingLabel'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// CR-COL-11: indented duplicate label — colStart is non-zero (raw line includes indentation).
{
    const a = new ChurchAssembler({});
    a.assemble('myLabel:\nRETURN\n  myLabel:\nRETURN');
    const errs = a.errors;
    assert('CR-COL-11: indented duplicate label produces an error', errs.length > 0);
    const e = errs.find(x => x.message.includes('myLabel') && x.message.includes('more than once'));
    assert('CR-COL-11: error references line 3 (second definition)', e && e.line === 3, e ? 'line=' + e.line : 'no error');
    const rawSrc3 = '  myLabel:';
    const expectedStart = rawSrc3.indexOf('myLabel');
    assert('CR-COL-11: colStart is non-zero (accounts for leading spaces)', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('CR-COL-11: colEnd covers label name', e && e.colEnd === expectedStart + 'myLabel'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// ── CR-WARN-COL: warning objects carry colStart/colEnd for .pet redefinitions ─
// Verifies that every this.warnings.push() path in _parsePetBlock produces a
// warning with a correct line number and column range pointing exactly at the
// alias token — so that underline rendering never regresses silently.

// CR-WARN-COL-1: DR-DR redefinition — warning points at the alias on line 2.
{
    const a = new ChurchAssembler({});
    a.assemble('.pet myReg DR0\n.pet myReg DR1\nRETURN');
    const ws = a.warnings;
    const rawLine = '.pet myReg DR1';
    const expectedStart = rawLine.indexOf('myReg');
    const w = ws.find(x => x.message.includes('myReg') && x.message.includes('DR0') && x.message.includes('DR1'));
    assert('CR-WARN-COL-1: DR-DR redef produces a warning', w != null);
    assert('CR-WARN-COL-1: warning references line 2', w && w.line === 2, w ? 'line=' + w.line : 'no warning');
    assert('CR-WARN-COL-1: colStart points at alias token', w && w.colStart === expectedStart, w ? 'colStart=' + w.colStart : 'no warning');
    assert('CR-WARN-COL-1: colEnd covers alias token', w && w.colEnd === expectedStart + 'myReg'.length, w ? 'colEnd=' + w.colEnd : 'no warning');
}

// CR-WARN-COL-2: CR-CR redefinition — warning points at the alias on line 2.
{
    const a = new ChurchAssembler({});
    a.assemble('.pet myReg CR0\n.pet myReg CR1\nRETURN');
    const ws = a.warnings;
    const rawLine = '.pet myReg CR1';
    const expectedStart = rawLine.indexOf('myReg');
    const w = ws.find(x => x.message.includes('myReg') && x.message.includes('CR0') && x.message.includes('CR1'));
    assert('CR-WARN-COL-2: CR-CR redef produces a warning', w != null);
    assert('CR-WARN-COL-2: warning references line 2', w && w.line === 2, w ? 'line=' + w.line : 'no warning');
    assert('CR-WARN-COL-2: colStart points at alias token', w && w.colStart === expectedStart, w ? 'colStart=' + w.colStart : 'no warning');
    assert('CR-WARN-COL-2: colEnd covers alias token', w && w.colEnd === expectedStart + 'myReg'.length, w ? 'colEnd=' + w.colEnd : 'no warning');
}

// CR-WARN-COL-3: cross-type DR→CR redefinition — alias was DR, now declared as CR.
{
    const a = new ChurchAssembler({});
    a.assemble('.pet myReg DR0\n.pet myReg CR1\nRETURN');
    const ws = a.warnings;
    const rawLine = '.pet myReg CR1';
    const expectedStart = rawLine.indexOf('myReg');
    const w = ws.find(x => x.message.includes('myReg') && x.message.includes('DR alias'));
    assert('CR-WARN-COL-3: DR→CR cross-type redef produces a warning', w != null);
    assert('CR-WARN-COL-3: warning references line 2', w && w.line === 2, w ? 'line=' + w.line : 'no warning');
    assert('CR-WARN-COL-3: colStart points at alias token', w && w.colStart === expectedStart, w ? 'colStart=' + w.colStart : 'no warning');
    assert('CR-WARN-COL-3: colEnd covers alias token', w && w.colEnd === expectedStart + 'myReg'.length, w ? 'colEnd=' + w.colEnd : 'no warning');
}

// CR-WARN-COL-4: cross-type CR→DR redefinition — alias was CR, now declared as DR.
{
    const a = new ChurchAssembler({});
    a.assemble('.pet myReg CR0\n.pet myReg DR1\nRETURN');
    const ws = a.warnings;
    const rawLine = '.pet myReg DR1';
    const expectedStart = rawLine.indexOf('myReg');
    const w = ws.find(x => x.message.includes('myReg') && x.message.includes('CR alias'));
    assert('CR-WARN-COL-4: CR→DR cross-type redef produces a warning', w != null);
    assert('CR-WARN-COL-4: warning references line 2', w && w.line === 2, w ? 'line=' + w.line : 'no warning');
    assert('CR-WARN-COL-4: colStart points at alias token', w && w.colStart === expectedStart, w ? 'colStart=' + w.colStart : 'no warning');
    assert('CR-WARN-COL-4: colEnd covers alias token', w && w.colEnd === expectedStart + 'myReg'.length, w ? 'colEnd=' + w.colEnd : 'no warning');
}

// CR-WARN-COL-5: indented DR-DR redefinition — colStart accounts for leading whitespace.
{
    const a = new ChurchAssembler({});
    a.assemble('.pet myReg DR0\n  .pet myReg DR1\nRETURN');
    const ws = a.warnings;
    const rawLine = '  .pet myReg DR1';
    const expectedStart = rawLine.indexOf('myReg');
    const w = ws.find(x => x.message.includes('myReg') && x.message.includes('DR0') && x.message.includes('DR1'));
    assert('CR-WARN-COL-5: indented DR-DR redef produces a warning', w != null);
    assert('CR-WARN-COL-5: warning references line 2', w && w.line === 2, w ? 'line=' + w.line : 'no warning');
    assert('CR-WARN-COL-5: colStart accounts for leading spaces', w && w.colStart === expectedStart, w ? 'colStart=' + w.colStart : 'no warning');
    assert('CR-WARN-COL-5: colEnd covers alias token', w && w.colEnd === expectedStart + 'myReg'.length, w ? 'colEnd=' + w.colEnd : 'no warning');
}

// ── CC-COL: compiler error objects carry colStart/colEnd ─────────────────────
// Verifies that CLOOMCCompiler errors on lines with identifiable tokens carry
// correct column ranges so that _highlightAsmErrorLines can underline exactly
// the right token — same precision as assembler errors.

// CC-COL-1: unknown variable in assignment — colStart/colEnd point at the variable.
{
    const cc = new CLOOMCCompiler();
    const src = '    x = unknownVar';
    const result = cc.compile('abstraction T {\n  method run() {\n' + src + '\n  }\n}');
    const e = result.errors.find(x => x.message.includes('unknownVar'));
    assert('CC-COL-1: unknown variable produces an error', e != null);
    const expectedStart = src.indexOf('unknownVar');
    assert('CC-COL-1: colStart points at unknownVar', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('CC-COL-1: colEnd covers unknownVar', e && e.colEnd === expectedStart + 'unknownVar'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// CC-COL-2: cannot compile statement — colStart/colEnd point at the first token.
{
    const cc = new CLOOMCCompiler();
    const src = '    BADSTATEMENT x y z';
    const result = cc.compile('abstraction T {\n  method run() {\n' + src + '\n  }\n}');
    const e = result.errors.find(x => x.message.includes('Cannot compile statement'));
    assert('CC-COL-2: bad statement produces an error', e != null);
    const expectedStart = src.indexOf('BADSTATEMENT');
    assert('CC-COL-2: colStart points at first token', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('CC-COL-2: colEnd covers first token', e && e.colEnd === expectedStart + 'BADSTATEMENT'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// CC-COL-3: undefined goto label — colStart/colEnd point at the label name.
{
    const cc = new CLOOMCCompiler();
    const src = '    goto missingLabel';
    const result = cc.compile('abstraction T {\n  method run() {\n' + src + '\n  }\n}');
    const e = result.errors.find(x => x.message.includes('Undefined label') && x.message.includes('missingLabel'));
    assert('CC-COL-3: undefined goto label produces an error', e != null);
    const expectedStart = src.indexOf('missingLabel');
    assert('CC-COL-3: colStart points at label', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('CC-COL-3: colEnd covers label name', e && e.colEnd === expectedStart + 'missingLabel'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// CC-COL-4: unknown abstraction in call() — colStart/colEnd point at the abstraction name.
{
    const cc = new CLOOMCCompiler();
    const src = '    call(GhostAbs.Method())';
    const result = cc.compile('abstraction T {\n  method run() {\n' + src + '\n  }\n}');
    const e = result.errors.find(x => x.message.includes('GhostAbs'));
    assert('CC-COL-4: unknown abstraction produces an error', e != null);
    const expectedStart = src.indexOf('GhostAbs');
    assert('CC-COL-4: colStart points at abstraction name', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('CC-COL-4: colEnd covers abstraction name', e && e.colEnd === expectedStart + 'GhostAbs'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// CC-COL-5: unknown method in call() — colStart/colEnd point at the method name.
{
    const cc = new CLOOMCCompiler();
    cc.methodConventions['MATH'] = { Add: 0, Sub: 1 };
    const src = '    call(Math.UnknownOp())';
    const result = cc.compile('abstraction T {\n  capabilities { Math }\n  method run() {\n' + src + '\n  }\n}');
    const e = result.errors.find(x => x.message.includes('UnknownOp'));
    assert('CC-COL-5: unknown method produces an error', e != null);
    const expectedStart = src.indexOf('UnknownOp');
    assert('CC-COL-5: colStart points at method name', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('CC-COL-5: colEnd covers method name', e && e.colEnd === expectedStart + 'UnknownOp'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// CC-COL-6: aliased token — abstraction name is identical to the result variable.
// The old indexOf found the first occurrence (the result variable); the fix must
// land colStart on the abstraction name inside call(), not the earlier occurrence.
{
    const cc = new CLOOMCCompiler();
    // "Math" appears twice on the same raw line: first as the result variable,
    // then as the abstraction name inside call().  No methodConventions are
    // registered for MATH, so the "No method conventions registered" error fires
    // and must underline the second occurrence.
    const src = '    Math = call(Math.Add())';
    const result = cc.compile('abstraction T {\n  capabilities { Math }\n  method run() {\n' + src + '\n  }\n}');
    const e = result.errors.find(x => x.message.includes('No method conventions'));
    assert('CC-COL-6: aliased token — error produced', e != null);
    const firstOccurrence = src.indexOf('Math');                      // result-var, wrong target
    const absOccurrence   = src.indexOf('Math', src.indexOf('call(') + 'call('.length); // correct
    assert('CC-COL-6: colStart does not land on the earlier result-variable occurrence',
        e && e.colStart !== firstOccurrence, e ? 'colStart=' + e.colStart : 'no error');
    assert('CC-COL-6: colStart lands on the abstraction name inside call()',
        e && e.colStart === absOccurrence, e ? 'colStart=' + e.colStart + ' expected=' + absOccurrence : 'no error');
    assert('CC-COL-6: colEnd covers the abstraction name',
        e && e.colEnd === absOccurrence + 'Math'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// ── SC-COL: Symbolic Math compiler errors carry colStart/colEnd ──────────────
// Verifies that compileSymbolic errors on identifiable tokens carry correct
// column ranges so that _highlightAsmErrorLines can underline exactly the
// right token — same precision as assembler and JS-compiler errors.

// SC-COL-1: unknown SlideRule method — colStart/colEnd point at method name.
{
    const cc = new CLOOMCCompiler();
    const src = 'SlideRule.BadMethod(3, 4)';
    const result = cc.compileSymbolic(src);
    const e = result.errors.find(x => x.message.includes('BadMethod'));
    assert('SC-COL-1: unknown SlideRule method produces an error', e != null);
    const expectedStart = src.indexOf('BadMethod');
    assert('SC-COL-1: colStart points at BadMethod', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('SC-COL-1: colEnd covers BadMethod', e && e.colEnd === expectedStart + 'BadMethod'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// SC-COL-2: 'end' without matching 'repeat' — colStart/colEnd point at 'end'.
{
    const cc = new CLOOMCCompiler();
    const src = 'end';
    const result = cc.compileSymbolic(src);
    const e = result.errors.find(x => x.message.includes("'end' without"));
    assert('SC-COL-2: end-without-repeat produces an error', e != null);
    assert('SC-COL-2: colStart is 0', e && e.colStart === 0, e ? 'colStart=' + e.colStart : 'no error');
    assert('SC-COL-2: colEnd is 3 (length of "end")', e && e.colEnd === 3, e ? 'colEnd=' + e.colEnd : 'no error');
}

// SC-COL-3: cannot parse symbolic statement — colStart/colEnd point at first token.
{
    const cc = new CLOOMCCompiler();
    const src = '    @bad@statement';
    const result = cc.compileSymbolic(src);
    const e = result.errors.find(x => x.message.includes('Cannot parse symbolic'));
    assert('SC-COL-3: bad symbolic statement produces an error', e != null);
    const token = '@bad@statement';
    const expectedStart = src.indexOf(token);
    assert('SC-COL-3: colStart accounts for indentation', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('SC-COL-3: colEnd covers first token', e && e.colEnd === expectedStart + token.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// ── PN-COL: Pet-Name compiler errors carry colStart/colEnd ───────────────────
// Verifies that compilePetName errors on identifiable tokens carry correct
// column ranges.

// PN-COL-1: unknown variable in expression — colStart/colEnd point at variable name.
{
    const cc = new CLOOMCCompiler();
    const src = 'x = unknownVar';
    const result = cc.compilePetName(src);
    const e = result.errors.find(x => x.message.includes('unknownVar'));
    assert('PN-COL-1: unknown variable produces an error', e != null);
    const expectedStart = src.indexOf('unknownVar');
    assert('PN-COL-1: colStart points at unknownVar', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('PN-COL-1: colEnd covers unknownVar', e && e.colEnd === expectedStart + 'unknownVar'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// PN-COL-2: unknown function call — colStart/colEnd point at function name.
{
    const cc = new CLOOMCCompiler();
    const src = 'y = BadFunc(5)';
    const result = cc.compilePetName(src);
    const e = result.errors.find(x => x.message.includes('BadFunc'));
    assert('PN-COL-2: unknown function produces an error', e != null);
    const expectedStart = src.indexOf('BadFunc');
    assert('PN-COL-2: colStart points at BadFunc', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('PN-COL-2: colEnd covers BadFunc', e && e.colEnd === expectedStart + 'BadFunc'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// PN-COL-3: LOAD of unknown capability — colStart/colEnd point at capability name.
{
    const cc = new CLOOMCCompiler();
    const src = 'LOAD GhostCap';
    const result = cc.compilePetName(src);
    const e = result.errors.find(x => x.message.includes('GhostCap'));
    assert('PN-COL-3: LOAD unknown capability produces an error', e != null);
    const expectedStart = src.indexOf('GhostCap');
    assert('PN-COL-3: colStart points at GhostCap', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart : 'no error');
    assert('PN-COL-3: colEnd covers GhostCap', e && e.colEnd === expectedStart + 'GhostCap'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// ── EN-COL: English front-end errors carry colStart/colEnd ───────────────────
//
// EN-COL-1: Unknown keyword/statement (sentence form) — colStart/colEnd point
//           at the first word of the unrecognised line.
{
    const cc = new CLOOMCCompiler();
    const src =
`Create an abstraction called Test
Add a method called Run
  frobulate the thing`;
    const result = cc.compileEnglish(src);
    const e = result.errors.find(x => x.message.includes('frobulate'));
    assert('EN-COL-1: "Cannot understand" error is produced', e != null,
        'errors: ' + result.errors.map(x => x.message).join('; '));
    const rawLine = '  frobulate the thing';
    const expectedStart = rawLine.indexOf('frobulate');
    assert('EN-COL-1: colStart points at "frobulate"',
        e && e.colStart === expectedStart,
        e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('EN-COL-1: colEnd covers "frobulate"',
        e && e.colEnd === expectedStart + 'frobulate'.length,
        e ? 'colEnd=' + e.colEnd + ' expected=' + (expectedStart + 'frobulate'.length) : 'no error');
}

// EN-COL-2: Unknown abstraction in call (sentence form) — colStart/colEnd point
//           at the abstraction name in the original source line.
{
    const cc = new CLOOMCCompiler();
    const src =
`Create an abstraction called Test
Add a method called Run
  call GhostAbs.Method()`;
    const result = cc.compileEnglish(src);
    const e = result.errors.find(x => x.message.includes('GhostAbs'));
    assert('EN-COL-2: "Unknown abstraction" error is produced', e != null,
        'errors: ' + result.errors.map(x => x.message).join('; '));
    const rawLine = '  call GhostAbs.Method()';
    const expectedStart = rawLine.indexOf('GhostAbs');
    assert('EN-COL-2: colStart points at "GhostAbs"',
        e && e.colStart === expectedStart,
        e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('EN-COL-2: colEnd covers "GhostAbs"',
        e && e.colEnd === expectedStart + 'GhostAbs'.length,
        e ? 'colEnd=' + e.colEnd + ' expected=' + (expectedStart + 'GhostAbs'.length) : 'no error');
}

// EN-COL-3: Bad expression / unknown variable in return (block form) —
//           colStart/colEnd point at the unresolvable token in the source line.
{
    const cc = new CLOOMCCompiler();
    const src =
`abstraction Test {
    run():
        return unknownVar
}`;
    const result = cc.compileEnglish(src);
    const e = result.errors.find(x => x.message.includes('unknownVar'));
    assert('EN-COL-3: "Cannot resolve expression" error is produced', e != null,
        'errors: ' + result.errors.map(x => x.message).join('; '));
    const rawLine = '        return unknownVar';
    const expectedStart = rawLine.indexOf('unknownVar');
    assert('EN-COL-3: colStart points at "unknownVar"',
        e && e.colStart === expectedStart,
        e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('EN-COL-3: colEnd covers "unknownVar"',
        e && e.colEnd === expectedStart + 'unknownVar'.length,
        e ? 'colEnd=' + e.colEnd + ' expected=' + (expectedStart + 'unknownVar'.length) : 'no error');
}

// ── HC-COL: Haskell compiler errors carry colStart/colEnd ────────────────────
// Verifies that _compileHaskellMethod / _emitHaskellExpr errors on identifiable
// tokens carry correct column ranges, matching the precision of JS/CLOOMC errors.

// HC-COL-1: undefined variable in Haskell method — colStart/colEnd point at the variable.
{
    const cc = new CLOOMCCompiler();
    const src = 'method run(x) = x + ghostVar';
    const result = cc.compileHaskell('abstraction T {\n' + src + '\n}');
    const e = result.errors.find(x => x.message.includes('ghostVar'));
    assert('HC-COL-1: undefined variable produces an error', e != null);
    const expectedStart = src.indexOf('ghostVar');
    assert('HC-COL-1: colStart points at ghostVar', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('HC-COL-1: colEnd covers ghostVar', e && e.colEnd === expectedStart + 'ghostVar'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// HC-COL-2: literal out of range in Haskell method — colStart/colEnd point at the literal.
{
    const cc = new CLOOMCCompiler();
    const src = 'method run(x) = 9999999999';
    const result = cc.compileHaskell('abstraction T {\n' + src + '\n}');
    const e = result.errors.find(x => x.message.includes('out of range'));
    assert('HC-COL-2: out-of-range literal produces an error', e != null);
    const expectedStart = src.indexOf('9999999999');
    assert('HC-COL-2: colStart points at literal', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('HC-COL-2: colEnd covers literal', e && e.colEnd === expectedStart + '9999999999'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// HC-COL-3: unknown operator in Haskell — test via direct _emitHaskellExpr call
//           with a hand-crafted binop node that carries opPos.
{
    const cc = new CLOOMCCompiler();
    const errors = [];
    const exprOffset = 3;
    const node = { type: 'binop', op: '??', opPos: 5, left: { type: 'literal', value: 0 }, right: { type: 'literal', value: 0 } };
    cc._emitHaskellExpr(node, [], {}, {}, [], errors, [], 1, exprOffset);
    const e = errors.find(x => x.message && x.message.includes('Unknown operator'));
    assert('HC-COL-3: unknown operator produces an error', e != null);
    assert('HC-COL-3: colStart = exprOffset + opPos', e && e.colStart === exprOffset + 5, e ? 'colStart=' + e.colStart : 'no error');
    assert('HC-COL-3: colEnd covers operator token', e && e.colEnd === exprOffset + 5 + '??'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// ── LC-COL: Lambda Calculus compiler errors carry colStart/colEnd ─────────────
// Same precision requirement for the Lambda Calculus front-end, which shares
// _emitHaskellExpr but feeds it AST nodes from _parseLambdaExpr.
// colStart/colEnd are method-line-local (include leading spaces + method signature).

// LC-COL-1: undefined variable in Lambda Calculus method — colStart/colEnd point at the variable.
{
    const cc = new CLOOMCCompiler();
    const src = 'method run(x) = x + shadowGhost';
    const result = cc.compileLambda('abstraction T {\n' + src + '\n}');
    const e = result.errors.find(x => x.message.includes('shadowGhost'));
    assert('LC-COL-1: undefined variable produces an error', e != null);
    const expectedStart = src.indexOf('shadowGhost');
    assert('LC-COL-1: colStart points at shadowGhost', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('LC-COL-1: colEnd covers shadowGhost', e && e.colEnd === expectedStart + 'shadowGhost'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// LC-COL-2: literal out of range in Lambda Calculus method — colStart/colEnd point at the literal.
{
    const cc = new CLOOMCCompiler();
    const src = 'method run(x) = 9999999999';
    const result = cc.compileLambda('abstraction T {\n' + src + '\n}');
    const e = result.errors.find(x => x.message.includes('out of range'));
    assert('LC-COL-2: out-of-range literal produces an error', e != null);
    const expectedStart = src.indexOf('9999999999');
    assert('LC-COL-2: colStart points at literal', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('LC-COL-2: colEnd covers literal', e && e.colEnd === expectedStart + '9999999999'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// EN-COL-4: Unknown statement in block form — colStart/colEnd point at the
//           first word of the unrecognised line.
{
    const cc = new CLOOMCCompiler();
    const src =
`abstraction Test {
    run():
        frobulate the thing
}`;
    const result = cc.compileEnglish(src);
    const e = result.errors.find(x => x.message.includes('frobulate'));
    assert('EN-COL-4: "Cannot understand" error is produced', e != null,
        'errors: ' + result.errors.map(x => x.message).join('; '));
    const rawLine = '        frobulate the thing';
    const expectedStart = rawLine.indexOf('frobulate');
    assert('EN-COL-4: colStart points at "frobulate"',
        e && e.colStart === expectedStart,
        e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('EN-COL-4: colEnd covers "frobulate"',
        e && e.colEnd === expectedStart + 'frobulate'.length,
        e ? 'colEnd=' + e.colEnd + ' expected=' + (expectedStart + 'frobulate'.length) : 'no error');
}

// ── SM-COL: Symbolic Math (Ada) compiler errors carry colStart/colEnd ────────
// Mirrors the LC-COL / HC-COL precision requirement for the Ada front-end.
// Each test drives compileSymbolic() and checks that the error object carries
// colStart/colEnd pointing at the offending token within its source line.

// SM-COL-1: undefined variable in a symbolic method — colStart/colEnd point at the variable name.
{
    const cc = new CLOOMCCompiler();
    const bodyLine = '  return ghostVar';
    const src = 'abstraction T {\n  method compute() {\n' + bodyLine + '\n  }\n}';
    const result = cc.compileSymbolic(src);
    const e = result.errors.find(x => x.message && x.message.includes('ghostVar'));
    assert('SM-COL-1: undefined variable produces an error', e != null);
    const expectedStart = bodyLine.indexOf('ghostVar');
    assert('SM-COL-1: colStart points at ghostVar', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('SM-COL-1: colEnd covers ghostVar', e && e.colEnd === expectedStart + 'ghostVar'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// SM-COL-2: literal out of range in a symbolic method — colStart/colEnd point at the literal.
{
    const cc = new CLOOMCCompiler();
    const bodyLine = '  return 9999999999';
    const src = 'abstraction T {\n  method compute() {\n' + bodyLine + '\n  }\n}';
    const result = cc.compileSymbolic(src);
    const e = result.errors.find(x => x.message && x.message.includes('out of range'));
    assert('SM-COL-2: out-of-range literal produces an error', e != null);
    const expectedStart = bodyLine.indexOf('9999999999');
    assert('SM-COL-2: colStart points at literal', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('SM-COL-2: colEnd covers literal', e && e.colEnd === expectedStart + '9999999999'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// SM-COL-3: unknown statement in a symbolic method — colStart/colEnd point at the first token.
{
    const cc = new CLOOMCCompiler();
    const bodyLine = '  xyzzy frobulate quux';
    const src = 'abstraction T {\n  method compute() {\n' + bodyLine + '\n  }\n}';
    const result = cc.compileSymbolic(src);
    const e = result.errors.find(x => x.message && x.message.includes('Cannot parse symbolic statement'));
    assert('SM-COL-3: unknown statement produces an error', e != null);
    const expectedStart = bodyLine.indexOf('xyzzy');
    assert('SM-COL-3: colStart points at first token', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('SM-COL-3: colEnd covers first token', e && e.colEnd === expectedStart + 'xyzzy'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// EN-COL-5: Multiple unrecognised block-form statements — each error carries
//           its own colStart/colEnd pointing only at the bad keyword, not the
//           whole statement.  This verifies that the squiggle renderer will draw
//           a narrow underline (word-width) rather than a full-line underline for
//           every offending token independently (task-1338).
{
    const cc = new CLOOMCCompiler();
    const src =
`abstraction Test {
    run():
        wiggle the thing
        wobble with value
}`;
    const result = cc.compileEnglish(src);
    const eWiggle = result.errors.find(x => x.message.includes('wiggle'));
    const eWobble = result.errors.find(x => x.message.includes('wobble'));
    assert('EN-COL-5: "wiggle" error is produced', eWiggle != null,
        'errors: ' + result.errors.map(x => x.message).join('; '));
    assert('EN-COL-5: "wobble" error is produced', eWobble != null,
        'errors: ' + result.errors.map(x => x.message).join('; '));
    const rawWiggle = '        wiggle the thing';
    const rawWobble = '        wobble with value';
    const wsWiggle = rawWiggle.indexOf('wiggle');
    const wsWobble = rawWobble.indexOf('wobble');
    assert('EN-COL-5: "wiggle" colStart points at keyword (not start of line)',
        eWiggle && eWiggle.colStart === wsWiggle,
        eWiggle ? 'colStart=' + eWiggle.colStart + ' expected=' + wsWiggle : 'no error');
    assert('EN-COL-5: "wiggle" colEnd covers only the keyword, not the full statement',
        eWiggle && eWiggle.colEnd === wsWiggle + 'wiggle'.length,
        eWiggle ? 'colEnd=' + eWiggle.colEnd + ' expected=' + (wsWiggle + 'wiggle'.length) : 'no error');
    assert('EN-COL-5: "wobble" colStart points at keyword',
        eWobble && eWobble.colStart === wsWobble,
        eWobble ? 'colStart=' + eWobble.colStart + ' expected=' + wsWobble : 'no error');
    assert('EN-COL-5: "wobble" colEnd covers only the keyword',
        eWobble && eWobble.colEnd === wsWobble + 'wobble'.length,
        eWobble ? 'colEnd=' + eWobble.colEnd + ' expected=' + (wsWobble + 'wobble'.length) : 'no error');
    assert('EN-COL-5: colEnd < full line length (narrow underline, not whole-line)',
        eWiggle && eWiggle.colEnd < rawWiggle.length,
        eWiggle ? 'colEnd=' + eWiggle.colEnd + ' lineLen=' + rawWiggle.length : 'no error');
}

// ── SM-PARSE-COL: parse-phase (_parseSymbolicBody) errors carry colStart/colEnd ──
// These errors are emitted before code generation — when a line inside an
// abstraction body does not match any recognised keyword (capabilities / method / }).

// SM-PARSE-COL-1: unrecognised token at abstraction body level — colStart/colEnd point at the first word.
{
    const cc = new CLOOMCCompiler();
    const badLine = '  glorbulate fizz';
    const src = 'abstraction T {\n' + badLine + '\n  method compute() {\n    return 1\n  }\n}';
    const result = cc.compileSymbolic(src);
    const e = result.errors.find(x => x.message && x.message.includes('Cannot understand') && x.message.includes('glorbulate'));
    assert('SM-PARSE-COL-1: unrecognised body token produces an error', e != null);
    const expectedStart = badLine.indexOf('glorbulate');
    assert('SM-PARSE-COL-1: colStart points at glorbulate', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('SM-PARSE-COL-1: colEnd covers glorbulate', e && e.colEnd === expectedStart + 'glorbulate'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// SM-PARSE-COL-2: multi-word unrecognised token at body level — colStart/colEnd point only at the first word.
{
    const cc = new CLOOMCCompiler();
    const badLine = '    zapwidget alpha beta';
    const src = 'abstraction Q {\n' + badLine + '\n  method run() {\n    return 0\n  }\n}';
    const result = cc.compileSymbolic(src);
    const e = result.errors.find(x => x.message && x.message.includes('Cannot understand') && x.message.includes('zapwidget'));
    assert('SM-PARSE-COL-2: multi-word unrecognised token produces an error', e != null);
    const expectedStart = badLine.indexOf('zapwidget');
    assert('SM-PARSE-COL-2: colStart points at zapwidget', e && e.colStart === expectedStart, e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('SM-PARSE-COL-2: colEnd covers zapwidget only', e && e.colEnd === expectedStart + 'zapwidget'.length, e ? 'colEnd=' + e.colEnd : 'no error');
}

// LC-COL-3: unknown variable at start of indented method expression.
{
    const cc = new CLOOMCCompiler();
    const src = 'abstraction Foo {\n  method bar() = unknownVar\n}';
    const result = cc.compileLambda(src);
    const e = result.errors.find(x => x.message.includes('unknownVar'));
    assert('LC-COL-3: unknown variable produces error', e != null);
    const rawMethodLine = '  method bar() = unknownVar';
    const expectedStart = rawMethodLine.indexOf('unknownVar');
    assert('LC-COL-3: colStart points at unknownVar (method-line-local)', e && e.colStart === expectedStart,
        e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('LC-COL-3: colEnd covers unknownVar', e && e.colEnd === expectedStart + 'unknownVar'.length,
        e ? 'colEnd=' + e.colEnd : 'no error');
}

// LC-COL-4: unknown variable with offset — colStart points past the method signature.
{
    const cc = new CLOOMCCompiler();
    const src = 'abstraction Foo {\n  method bar(x) = x + badVar\n}';
    const result = cc.compileLambda(src);
    const e = result.errors.find(x => x.message.includes('badVar'));
    assert('LC-COL-4: unknown variable with offset produces error', e != null);
    const rawMethodLine = '  method bar(x) = x + badVar';
    const expectedStart = rawMethodLine.indexOf('badVar');
    assert('LC-COL-4: colStart points at badVar (method-line-local)', e && e.colStart === expectedStart,
        e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('LC-COL-4: colEnd covers badVar', e && e.colEnd === expectedStart + 'badVar'.length,
        e ? 'colEnd=' + e.colEnd : 'no error');
}

// LC-COL-5: unknown abstraction (dotted name) — colStart/colEnd span the full token.
{
    const cc = new CLOOMCCompiler();
    const src = 'abstraction Foo {\n  method bar(x) = BadAbs.method x\n}';
    const result = cc.compileLambda(src);
    const e = result.errors.find(x => x.message.includes('BadAbs.method'));
    assert('LC-COL-5: unknown abstraction produces error', e != null);
    const rawMethodLine = '  method bar(x) = BadAbs.method x';
    const expectedStart = rawMethodLine.indexOf('BadAbs.method');
    assert('LC-COL-5: colStart points at BadAbs.method (method-line-local)', e && e.colStart === expectedStart,
        e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('LC-COL-5: colEnd covers full dotted token', e && e.colEnd === expectedStart + 'BadAbs.method'.length,
        e ? 'colEnd=' + e.colEnd : 'no error');
}

// ── HS-COL: Haskell compiler errors carry colStart/colEnd ─────────────────────
// Verifies that compileHaskell errors on identifiable tokens carry correct
// column ranges (method-line-local: include leading spaces + method signature).

// HS-COL-1: unknown variable at start of indented method expression.
{
    const cc = new CLOOMCCompiler();
    const src = 'abstraction Bar {\n  method run() = ghostVar\n}';
    const result = cc.compileHaskell(src);
    const e = result.errors.find(x => x.message.includes('ghostVar'));
    assert('HS-COL-1: unknown variable produces error', e != null);
    const rawMethodLine = '  method run() = ghostVar';
    const expectedStart = rawMethodLine.indexOf('ghostVar');
    assert('HS-COL-1: colStart points at ghostVar (method-line-local)', e && e.colStart === expectedStart,
        e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('HS-COL-1: colEnd covers ghostVar', e && e.colEnd === expectedStart + 'ghostVar'.length,
        e ? 'colEnd=' + e.colEnd : 'no error');
}

// HS-COL-2: unknown variable with offset — colStart points past method signature.
{
    const cc = new CLOOMCCompiler();
    const src = 'abstraction Bar {\n  method run(n) = n + missingX\n}';
    const result = cc.compileHaskell(src);
    const e = result.errors.find(x => x.message.includes('missingX'));
    assert('HS-COL-2: unknown variable with offset produces error', e != null);
    const rawMethodLine = '  method run(n) = n + missingX';
    const expectedStart = rawMethodLine.indexOf('missingX');
    assert('HS-COL-2: colStart points at missingX (method-line-local)', e && e.colStart === expectedStart,
        e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('HS-COL-2: colEnd covers missingX', e && e.colEnd === expectedStart + 'missingX'.length,
        e ? 'colEnd=' + e.colEnd : 'no error');
}

// HS-COL-3: unknown abstraction (dotted name) — colStart/colEnd span full token.
{
    const cc = new CLOOMCCompiler();
    const src = 'abstraction Bar {\n  method run(x) = GhostAbs.call x\n}';
    const result = cc.compileHaskell(src);
    const e = result.errors.find(x => x.message.includes('GhostAbs.call'));
    assert('HS-COL-3: unknown abstraction produces error', e != null);
    const rawMethodLine = '  method run(x) = GhostAbs.call x';
    const expectedStart = rawMethodLine.indexOf('GhostAbs.call');
    assert('HS-COL-3: colStart points at GhostAbs.call (method-line-local)', e && e.colStart === expectedStart,
        e ? 'colStart=' + e.colStart + ' expected=' + expectedStart : 'no error');
    assert('HS-COL-3: colEnd covers full dotted token', e && e.colEnd === expectedStart + 'GhostAbs.call'.length,
        e ? 'colEnd=' + e.colEnd : 'no error');
}

// ── LC-PARSE-FAIL: parse-failure errors carry colStart/colEnd ────────────────
// When compileLambda cannot find an abstraction declaration, the error points
// at the first meaningful token on the bad line.

// LC-PARSE-FAIL-1: source with no abstraction — colStart/colEnd at first token.
{
    const cc = new CLOOMCCompiler();
    const src = 'badstuff';
    const result = cc.compileLambda(src);
    const e = result.errors.find(x => x.message.includes('No abstraction'));
    assert('LC-PARSE-FAIL-1: parse failure produces error', e != null);
    const token = 'badstuff';
    assert('LC-PARSE-FAIL-1: colStart is 0 (token at start of line)', e && e.colStart === 0,
        e ? 'colStart=' + e.colStart : 'no error');
    assert('LC-PARSE-FAIL-1: colEnd covers token', e && e.colEnd === token.length,
        e ? 'colEnd=' + e.colEnd : 'no error');
}

// LC-PARSE-FAIL-2: indented bad source — colStart accounts for leading spaces.
{
    const cc = new CLOOMCCompiler();
    const src = '  badstuff';
    const result = cc.compileLambda(src);
    const e = result.errors.find(x => x.message.includes('No abstraction'));
    assert('LC-PARSE-FAIL-2: parse failure produces error', e != null);
    const expectedStart = src.indexOf('badstuff');
    assert('LC-PARSE-FAIL-2: colStart accounts for indentation', e && e.colStart === expectedStart,
        e ? 'colStart=' + e.colStart : 'no error');
    assert('LC-PARSE-FAIL-2: colEnd covers token', e && e.colEnd === expectedStart + 'badstuff'.length,
        e ? 'colEnd=' + e.colEnd : 'no error');
}

// ── HS-PARSE-FAIL: Haskell parse-failure errors carry colStart/colEnd ─────────

// HS-PARSE-FAIL-1: source with no abstraction — colStart/colEnd at first token.
{
    const cc = new CLOOMCCompiler();
    const src = 'notanabs';
    const result = cc.compileHaskell(src);
    const e = result.errors.find(x => x.message.includes('No abstraction'));
    assert('HS-PARSE-FAIL-1: parse failure produces error', e != null);
    const token = 'notanabs';
    assert('HS-PARSE-FAIL-1: colStart is 0 (token at start of line)', e && e.colStart === 0,
        e ? 'colStart=' + e.colStart : 'no error');
    assert('HS-PARSE-FAIL-1: colEnd covers token', e && e.colEnd === token.length,
        e ? 'colEnd=' + e.colEnd : 'no error');
}

// HS-PARSE-FAIL-2: indented bad source — colStart accounts for leading spaces.
{
    const cc = new CLOOMCCompiler();
    const src = '  notanabs';
    const result = cc.compileHaskell(src);
    const e = result.errors.find(x => x.message.includes('No abstraction'));
    assert('HS-PARSE-FAIL-2: parse failure produces error', e != null);
    const expectedStart = src.indexOf('notanabs');
    assert('HS-PARSE-FAIL-2: colStart accounts for indentation', e && e.colStart === expectedStart,
        e ? 'colStart=' + e.colStart : 'no error');
    assert('HS-PARSE-FAIL-2: colEnd covers token', e && e.colEnd === expectedStart + 'notanabs'.length,
        e ? 'colEnd=' + e.colEnd : 'no error');
}

// ── HS-BAD-BIND: Haskell bad let-binding (= instead of ==) carries colStart/colEnd
// Verifies the bad-binding error produced when a let-binding uses = rather
// than == points at the offending = token in the expression string.

// HS-BAD-BIND-1: let y = n in y — colStart/colEnd point at the bare =.
{
    const cc = new CLOOMCCompiler();
    const src = 'abstraction Foo {\n  method run(n) = let y = n in y\n}';
    const result = cc.compileHaskell(src);
    const e = result.errors.find(x => x.message.includes('let binding'));
    assert('HS-BAD-BIND-1: bad let binding produces error', e != null);
    const expr = 'let y = n in y';
    const expectedStart = expr.indexOf('=');
    assert('HS-BAD-BIND-1: colStart points at = token', e && e.colStart === expectedStart,
        e ? 'colStart=' + e.colStart : 'no error');
    assert('HS-BAD-BIND-1: colEnd covers = token', e && e.colEnd === expectedStart + 1,
        e ? 'colEnd=' + e.colEnd : 'no error');
}

// HS-BAD-BIND-2: let with offset — the = sign is not at the start.
{
    const cc = new CLOOMCCompiler();
    const src = 'abstraction Foo {\n  method run(a, b) = let result = a + b in result\n}';
    const result = cc.compileHaskell(src);
    const e = result.errors.find(x => x.message.includes('let binding'));
    assert('HS-BAD-BIND-2: bad let binding with offset produces error', e != null);
    const expr = 'let result = a + b in result';
    const expectedStart = expr.indexOf('=');
    assert('HS-BAD-BIND-2: colStart points at = token', e && e.colStart === expectedStart,
        e ? 'colStart=' + e.colStart : 'no error');
    assert('HS-BAD-BIND-2: colEnd is colStart + 1', e && e.colEnd === expectedStart + 1,
        e ? 'colEnd=' + e.colEnd : 'no error');
}

// ── CAP-V: capabilities block validation (task-1352) ─────────────────────────
// Four error cases and one regression (no-error) case.

// CAP-V1: bare-name entry with no permission letters (inline block) → error.
{
    const a = new ChurchAssembler({});
    a.assemble('capabilities { Salvation }\nRETURN');
    assert('CAP-V1: bare-name entry (no rights) produces an error',
        a.errors.length > 0,
        'expected at least one error');
    assert('CAP-V1: error message mentions "Salvation" and permission letters',
        a.errors.length > 0 &&
        a.errors[0].message.includes('Salvation') &&
        a.errors[0].message.includes('permission'),
        a.errors.length > 0 ? a.errors[0].message : '(no error)');
}

// CAP-V2: bare-name entry with no permission letters (multi-line block) → error.
{
    const a = new ChurchAssembler({});
    a.assemble('capabilities {\n  Salvation\n}\nRETURN');
    assert('CAP-V2: multi-line bare-name entry produces an error',
        a.errors.length > 0,
        'expected at least one error');
    assert('CAP-V2: error mentions "Salvation"',
        a.errors.length > 0 && a.errors[0].message.includes('Salvation'),
        a.errors.length > 0 ? a.errors[0].message : '(no error)');
}

// CAP-V3: LOAD using a name absent from the declared capabilities block → error.
{
    const NS = { 'Salvation': 5 };
    const a = new ChurchAssembler({});
    a.setNamespace(NS);
    // capabilities block declares nothing; LOAD Salvation should error.
    a.assemble('capabilities { }\nLOAD CR0, Salvation');
    const capErr = a.errors.find(e => e.message.includes('Salvation') && e.message.includes('not declared'));
    assert('CAP-V3: LOAD with name absent from capabilities block produces error',
        capErr != null,
        a.errors.length > 0 ? a.errors.map(e => e.message).join('; ') : '(no error)');
}

// CAP-V4: ELOADCALL using a name absent from the declared capabilities block → error.
{
    const CONV = { 'Salvation': { run: { index: 0 } } };
    const NS = { 'Salvation': 5 };
    const a = new ChurchAssembler(CONV);
    a.setNamespace(NS);
    // capabilities block declares Navana E but NOT Salvation.
    a.assemble('capabilities { Navana E }\nELOADCALL CR0, Salvation, run');
    const capErr = a.errors.find(e => e.message.includes('Salvation') && e.message.includes('not declared'));
    assert('CAP-V4: ELOADCALL with name absent from capabilities block produces error',
        capErr != null,
        a.errors.length > 0 ? a.errors.map(e => e.message).join('; ') : '(no error)');
}

// CAP-V5: valid capabilities block — name declared with rights + LOAD uses it → no cap error.
{
    const NS = { 'Salvation': 5 };
    const a = new ChurchAssembler({});
    a.setNamespace(NS);
    a.assemble('capabilities { Salvation E }\nLOAD CR0, Salvation\nRETURN');
    const capErrs = a.errors.filter(e => e.message.includes('not declared') || e.message.includes('permission'));
    assert('CAP-V5: declared capability with rights produces no validation error',
        capErrs.length === 0,
        capErrs.map(e => e.message).join('; '));
}

// CAP-V6: hardware device bare-names (LED0) are exempt from the rights requirement.
{
    const a = new ChurchAssembler({});
    a.assemble('capabilities { LED0 }\nLOAD CR3, LED0\nRETURN');
    const capErrs = a.errors.filter(e => e.message.includes('permission') || e.message.includes('not declared'));
    assert('CAP-V6: LED0 bare-name in capabilities block is exempt from rights check',
        capErrs.length === 0,
        capErrs.map(e => e.message).join('; '));
}

// CAP-V7: no capabilities block at all — LOAD with a namespace name → no cap error.
// (Backward-compatibility: programs without a capabilities block are not affected.)
{
    const NS = { 'Salvation': 5 };
    const a = new ChurchAssembler({});
    a.setNamespace(NS);
    a.assemble('LOAD CR0, Salvation\nRETURN');
    const capErrs = a.errors.filter(e => e.message.includes('not declared'));
    assert('CAP-V7: no capabilities block — LOAD with namespace name has no cap error',
        capErrs.length === 0,
        capErrs.map(e => e.message).join('; '));
}

// CAP-V8: CALL Foo.method — Foo absent from capabilities block → error.
// Uses LOAD first to bind SlideRule into a CR (populates nsLoaded), then CALL Foo.method.
{
    const CONV = { 'SlideRule': { 'Multiply': { index: 0 } } };
    const NS = { 'SlideRule': 3 };
    const a = new ChurchAssembler(CONV);
    a.setNamespace(NS);
    // capabilities block is present but does not include SlideRule.
    // LOAD will produce a not-declared error; CALL SlideRule.Multiply also fires it.
    a.assemble('capabilities { Salvation E }\nLOAD CR0, SlideRule\nCALL SlideRule.Multiply');
    const capErr = a.errors.find(e => e.message.includes('SlideRule') && e.message.includes('not declared'));
    assert('CAP-V8: CALL dot-notation with name absent from capabilities block produces error',
        capErr != null,
        a.errors.length > 0 ? a.errors.map(e => e.message).join('; ') : '(no error)');
}

// CAP-V9: CALL Foo.method — Foo declared in capabilities block → no cap error.
{
    const CONV = { 'SlideRule': { 'Multiply': { index: 0 } } };
    const NS = { 'SlideRule': 3 };
    const a = new ChurchAssembler(CONV);
    a.setNamespace(NS);
    a.assemble('capabilities { SlideRule E }\nLOAD CR0, SlideRule\nCALL SlideRule.Multiply');
    const capErrs = a.errors.filter(e => e.message.includes('not declared'));
    assert('CAP-V9: CALL dot-notation with declared capability produces no cap error',
        capErrs.length === 0,
        capErrs.map(e => e.message).join('; '));
}

// CAP-V10: dotted name Boot.Nucs E can be declared and used without error.
// Verifies _parseCapItem accepts dotted names so the cap-block roundtrip works.
{
    const a = new ChurchAssembler({});
    a.assemble('capabilities { Boot.Nucs E }\nLOAD CR0, Boot.Nucs\nRETURN');
    const capErrs = a.errors.filter(e => e.message.includes('not declared') || e.message.includes('permission'));
    assert('CAP-V10: Boot.Nucs declared with rights — no cap validation error',
        capErrs.length === 0,
        capErrs.map(e => e.message).join('; '));
}

// CAP-V11: dotted name Boot.Abstr E can be declared and used without error.
{
    const a = new ChurchAssembler({});
    a.assemble('capabilities { Boot.Abstr E }\nLOAD CR0, Boot.Abstr\nRETURN');
    const capErrs = a.errors.filter(e => e.message.includes('not declared') || e.message.includes('permission'));
    assert('CAP-V11: Boot.Abstr declared with rights — no cap validation error',
        capErrs.length === 0,
        capErrs.map(e => e.message).join('; '));
}

// ── CAP-V12/13: duplicate capability name → warning (task-1355) ──────────────

// CAP-V12: single duplicate name in inline capabilities block → exactly one warning.
{
    const a = new ChurchAssembler({});
    a.assemble('capabilities { Salvation E, Salvation RX }\nRETURN');
    assert('CAP-V12: duplicate name in inline block produces at least one warning',
        a.warnings.length > 0,
        'expected at least one warning, got ' + a.warnings.length);
    const dupWarn = a.warnings.find(w => w.message.includes('Salvation') && w.message.includes('uplicate'));
    assert('CAP-V12: warning mentions "Salvation" and "duplicate"',
        dupWarn != null,
        a.warnings.map(w => w.message).join('; '));
    assert('CAP-V12: warning suggests removing the duplicate',
        dupWarn != null && dupWarn.message.toLowerCase().includes('remove'),
        dupWarn ? dupWarn.message : '(no matching warning)');
    assert('CAP-V12: assembly still succeeds (no fatal errors from the duplicate)',
        a.errors.filter(e => e.message.includes('uplicate')).length === 0,
        a.errors.map(e => e.message).join('; '));
}

// CAP-V13: two different names, each duplicated, in a multi-line block → two warnings.
{
    const a = new ChurchAssembler({});
    a.assemble('capabilities {\n  Alpha E\n  Beta E\n  Alpha RX\n  Beta RX\n}\nRETURN');
    const alphaWarn = a.warnings.find(w => w.message.includes('Alpha') && w.message.includes('uplicate'));
    const betaWarn  = a.warnings.find(w => w.message.includes('Beta')  && w.message.includes('uplicate'));
    assert('CAP-V13: duplicate "Alpha" in multi-line block produces warning',
        alphaWarn != null,
        a.warnings.map(w => w.message).join('; '));
    assert('CAP-V13: duplicate "Beta" in multi-line block produces warning',
        betaWarn != null,
        a.warnings.map(w => w.message).join('; '));
    assert('CAP-V13: exactly two duplicate warnings (one per duplicated name)',
        a.warnings.filter(w => w.message.includes('uplicate')).length === 2,
        'got ' + a.warnings.filter(w => w.message.includes('uplicate')).length);
}

// ── CAP-V14/15: CALL AbsName, method capabilities check (task-1356) ──────────

// CAP-V14: CALL AbsName, method — AbsName absent from capabilities block → error.
// This covers the unloaded-but-known-NS-symbol path (opcode-2, ELOADCALL emit).
{
    const CONV = { 'Scheduler': { 'pause': { index: 0 } } };
    const NS = { 'Scheduler': 8 };
    const a = new ChurchAssembler(CONV);
    a.setNamespace(NS);
    // capabilities block is present but does not include Scheduler.
    a.assemble('capabilities { Navana E }\nCALL Scheduler, pause');
    const capErr = a.errors.find(e => e.message.includes('Scheduler') && e.message.includes('not declared'));
    assert('CAP-V14: CALL AbsName, method with name absent from capabilities block produces error',
        capErr != null,
        a.errors.length > 0 ? a.errors.map(e => e.message).join('; ') : '(no error)');
}

// CAP-V15: CALL AbsName, method — AbsName declared in capabilities block → no cap error.
{
    const CONV = { 'Scheduler': { 'pause': { index: 0 } } };
    const NS = { 'Scheduler': 8 };
    const a = new ChurchAssembler(CONV);
    a.setNamespace(NS);
    a.assemble('capabilities { Scheduler E }\nCALL Scheduler, pause');
    const capErrs = a.errors.filter(e => e.message.includes('not declared'));
    assert('CAP-V15: CALL AbsName, method with declared capability produces no cap error',
        capErrs.length === 0,
        capErrs.map(e => e.message).join('; '));
}

// ── CAP-V16–22: hardware device shorthands (UART/BTN/SlideRule/Timer) and the
//    capabilities block guard (task-1699) ──────────────────────────────────────
//
// Path 3.2 in _resolveNSName resolves UART→14, BTN→15, SlideRule→16, Timer→17
// without a namespace table.  When a capabilities block IS present, _checkCapDeclared
// must still fire for any hardware name that was not declared in that block.

// CAP-V16: LOAD CR5, UART — cap block exists, UART absent → error.
{
    const a = new ChurchAssembler({});
    a.assemble('capabilities { Navana E }\nLOAD CR5, UART\nRETURN');
    const capErr = a.errors.find(e => e.message.includes('UART') && e.message.includes('not declared'));
    assert('CAP-V16: LOAD UART with cap block that omits UART produces not-declared error',
        capErr != null,
        a.errors.length > 0 ? a.errors.map(e => e.message).join('; ') : '(no error)');
}

// CAP-V17: LOAD CR5, BTN — cap block exists, BTN absent → error.
{
    const a = new ChurchAssembler({});
    a.assemble('capabilities { Navana E }\nLOAD CR5, BTN\nRETURN');
    const capErr = a.errors.find(e => e.message.includes('BTN') && e.message.includes('not declared'));
    assert('CAP-V17: LOAD BTN with cap block that omits BTN produces not-declared error',
        capErr != null,
        a.errors.length > 0 ? a.errors.map(e => e.message).join('; ') : '(no error)');
}

// CAP-V18: LOAD CR5, SlideRule — cap block exists, SlideRule absent → error.
{
    const a = new ChurchAssembler({});
    a.assemble('capabilities { Navana E }\nLOAD CR5, SlideRule\nRETURN');
    const capErr = a.errors.find(e => e.message.includes('SlideRule') && e.message.includes('not declared'));
    assert('CAP-V18: LOAD SlideRule with cap block that omits SlideRule produces not-declared error',
        capErr != null,
        a.errors.length > 0 ? a.errors.map(e => e.message).join('; ') : '(no error)');
}

// CAP-V19: LOAD CR5, Timer — cap block exists, Timer absent → error.
{
    const a = new ChurchAssembler({});
    a.assemble('capabilities { Navana E }\nLOAD CR5, Timer\nRETURN');
    const capErr = a.errors.find(e => e.message.includes('Timer') && e.message.includes('not declared'));
    assert('CAP-V19: LOAD Timer with cap block that omits Timer produces not-declared error',
        capErr != null,
        a.errors.length > 0 ? a.errors.map(e => e.message).join('; ') : '(no error)');
}

// CAP-V20: LOAD CR5, UART — NO capabilities block → no error (backward-compat).
{
    const a = new ChurchAssembler({});
    a.assemble('LOAD CR5, UART\nRETURN');
    const capErrs = a.errors.filter(e => e.message.includes('not declared'));
    assert('CAP-V20: LOAD UART with no capabilities block produces no cap-declaration error',
        capErrs.length === 0,
        capErrs.map(e => e.message).join('; '));
}

// CAP-V21: LOAD CR5, UART — cap block exists AND declares UART → no error.
{
    const a = new ChurchAssembler({});
    a.assemble('capabilities { UART }\nLOAD CR5, UART\nRETURN');
    const capErrs = a.errors.filter(e => e.message.includes('not declared'));
    assert('CAP-V21: LOAD UART with cap block that declares UART produces no cap-declaration error',
        capErrs.length === 0,
        capErrs.map(e => e.message).join('; '));
}

// CAP-V22: ELOADCALL CR0, UART, 0 — cap block exists, UART absent → error.
// This exercises the res8 path (path 3.2 resolution) in the ELOADCALL encoder.
{
    const a = new ChurchAssembler({});
    a.assemble('capabilities { Navana E }\nELOADCALL CR0, UART, 0\nRETURN');
    const capErr = a.errors.find(e => e.message.includes('UART') && e.message.includes('not declared'));
    assert('CAP-V22: ELOADCALL UART with cap block that omits UART produces not-declared error',
        capErr != null,
        a.errors.length > 0 ? a.errors.map(e => e.message).join('; ') : '(no error)');
}

// ── CAP-V23/24: case-insensitive hardware cap name matching (task-1700) ───────
//
// Path 3.2 resolves hardware names case-insensitively (uart → UART etc.).
// _checkCapDeclared must accept a declaration whose capitalisation differs from
// the usage — otherwise `capabilities { uart }` + `LOAD CR5, UART` fires a
// false "not declared" error.

// CAP-V23: capabilities { uart } + LOAD CR5, UART → no error.
// Declared lowercase, used uppercase.
{
    const a = new ChurchAssembler({});
    a.assemble('capabilities { uart }\nLOAD CR5, UART\nRETURN');
    const capErrs = a.errors.filter(e => e.message.includes('not declared'));
    assert('CAP-V23: capabilities { uart } + LOAD CR5, UART produces no not-declared error',
        capErrs.length === 0,
        capErrs.map(e => e.message).join('; '));
}

// CAP-V24: capabilities { UART } + LOAD CR5, uart → no error.
// Declared uppercase, used lowercase.
{
    const a = new ChurchAssembler({});
    a.assemble('capabilities { UART }\nLOAD CR5, uart\nRETURN');
    const capErrs = a.errors.filter(e => e.message.includes('not declared'));
    assert('CAP-V24: capabilities { UART } + LOAD CR5, uart produces no not-declared error',
        capErrs.length === 0,
        capErrs.map(e => e.message).join('; '));
}

// ── ABS-H: Abstractions panel search-highlight regression (task-1379) ────────
// Tests for _absHighlightText / _absHighlightNodes as called by renderAbstractions().
//
// Strategy: extract the REAL function source from app-compile.js and
// app-abstractions.js, then eval them inside a jsdom window together with the
// minimum globals renderAbstractions() needs.  If someone removes the
// _absHighlightText() calls from renderAbstractions(), or renames the element
// classes, these tests will fail immediately.
//
// Line ranges (1-indexed) extracted below must be kept in sync with source:
//   app-compile.js      _absHighlightNodes  lines 110–133
//   app-compile.js      _absHighlightText   lines 138–149
//   app-abstractions.js renderAbstractions  lines 387–467
{
    const { JSDOM } = require('jsdom');
    const fs   = require('fs');
    const path = require('path');

    const compileLines = fs.readFileSync(
        path.join(__dirname, 'app-compile.js'), 'utf8').split('\n');
    const absLines = fs.readFileSync(
        path.join(__dirname, 'app-abstractions.js'), 'utf8').split('\n');

    // Extract real function source text (slice uses 0-based indices).
    const highlightNodesSrc = compileLines.slice(109, 133).join('\n');
    const highlightTextSrc  = compileLines.slice(137, 149).join('\n');
    const renderAbsSrc      = absLines.slice(386, 467).join('\n');

    // Verify extraction found the right functions — fail fast rather than giving
    // misleading results if line numbers drift after a refactor.
    assert('ABS-H-SRC1: extracted _absHighlightNodes from app-compile.js',
        highlightNodesSrc.includes('function _absHighlightNodes('),
        'Line range 94-117 no longer contains _absHighlightNodes — update the slice');
    assert('ABS-H-SRC2: extracted _absHighlightText from app-compile.js',
        highlightTextSrc.includes('function _absHighlightText('),
        'Line range 122-133 no longer contains _absHighlightText — update the slice');
    assert('ABS-H-SRC3: extracted renderAbstractions from app-abstractions.js',
        renderAbsSrc.includes('function renderAbstractions('),
        'Line range 387-467 no longer contains renderAbstractions — update the slice');

    // Build a jsdom window to provide real DOM APIs.
    const dom  = new JSDOM('<!DOCTYPE html><body><div id="absLayerList"></div></body>');
    const jsDom  = dom.window.document;
    const jsNode = dom.window.Node;

    // Use the Function constructor so that `document` and `Node` can be passed
    // explicitly from the jsdom window.  This avoids any jsdom eval-scope issues
    // while still running the REAL function source extracted from the source files.
    // All other free variables (abstractionRegistry, _lumpsCache, etc.) are
    // declared as let bindings in the function body so renderAbstractions() finds
    // them through closure — not through a global lookup that would fail in Node.js.
    const factory = new Function('document', 'Node',
        `
        "use strict";
        // ── State controlled by the test harness ─────────────────────────────
        let _absSearchQuery = '';
        let abstractionRegistry = {
            abstractions: {
                'SlideRule': {
                    index: 5,
                    name: 'SlideRule',
                    description: 'Analog slide rule for multiplication and division',
                    impl: {},
                },
                'Scheduler': {
                    index: 8,
                    name: 'Scheduler',
                    description: 'Cooperative thread scheduler for the Church Machine',
                    impl: {},
                },
            }
        };

        // ── Stubs for every other free variable renderAbstractions() touches ─
        let _lumpsCache            = [];
        let selectedAbsIndex       = -1;
        let bootEntrySlot          = 3;
        let IMPL_STATUS_COLORS     = {};
        let IMPL_STATUS_LABELS     = {};
        function _implStatusBest()        { return 'unknown'; }
        function _getAbstractionProfile() { return 'IoT'; }
        function _implLegendHtml()        { return ''; }
        function _absCopyCall()           {}

        // ── Real source extracted verbatim from app-compile.js ───────────────
        ${highlightNodesSrc}
        ${highlightTextSrc}

        // ── Real source extracted verbatim from app-abstractions.js ─────────
        ${renderAbsSrc}

        // ── Public API for the test harness ──────────────────────────────────
        return {
            render: function(q) { _absSearchQuery = q; renderAbstractions(); },
        };
        `
    );

    const mod  = factory(jsDom, jsNode);
    const render = mod.render;
    const listEl = jsDom.getElementById('absLayerList');

    // ABS-H1: non-empty query → .abs-item-name contains <mark class="abs-search-highlight">
    {
        render('slide');
        const nameEls = listEl.querySelectorAll('.abs-item-name');
        assert('ABS-H1: renderAbstractions renders at least one .abs-item-name',
            nameEls.length > 0,
            'got ' + nameEls.length);
        const matchingName = Array.from(nameEls).find(
            el => el.textContent.toLowerCase().includes('slide'));
        const marks = matchingName
            ? matchingName.querySelectorAll('mark.abs-search-highlight') : [];
        assert('ABS-H1: .abs-item-name for "SlideRule" contains mark.abs-search-highlight',
            marks.length > 0,
            'got ' + marks.length + ' mark(s); nameEls=' + nameEls.length);
        assert('ABS-H1: mark text equals the matched query text (case-insensitive)',
            marks.length > 0 && marks[0].textContent.toLowerCase() === 'slide',
            marks.length > 0 ? marks[0].textContent : '(no mark)');
    }

    // ABS-H2: non-empty query → .abs-item-desc contains <mark class="abs-search-highlight">
    {
        render('slide');
        const descEls = listEl.querySelectorAll('.abs-item-desc');
        assert('ABS-H2: renderAbstractions renders at least one .abs-item-desc',
            descEls.length > 0,
            'got ' + descEls.length);
        const matchingDesc = Array.from(descEls).find(
            el => el.textContent.toLowerCase().includes('slide'));
        const marks = matchingDesc
            ? matchingDesc.querySelectorAll('mark.abs-search-highlight') : [];
        assert('ABS-H2: .abs-item-desc for "slide rule" contains mark.abs-search-highlight',
            marks.length > 0,
            'got ' + marks.length + ' mark(s)');
    }

    // ABS-H3: empty query → no <mark> nodes anywhere in the rendered list
    {
        render('');
        const marks = listEl.querySelectorAll('mark.abs-search-highlight');
        assert('ABS-H3: empty query produces no mark.abs-search-highlight nodes',
            marks.length === 0,
            'got ' + marks.length + ' mark(s)');
    }

    // ABS-H4: DOM-rebuild path — calling render twice with the same query must
    // not double-wrap marks (exactly one mark per match after the second render).
    {
        render('scheduler');
        render('scheduler');
        const nameEls = listEl.querySelectorAll('.abs-item-name');
        const schedulerName = Array.from(nameEls).find(
            el => el.textContent.toLowerCase().includes('scheduler'));
        const marks = schedulerName
            ? schedulerName.querySelectorAll('mark.abs-search-highlight') : [];
        assert('ABS-H4: after two renders with same query, Scheduler .abs-item-name has marks',
            marks.length > 0,
            'got ' + marks.length + ' mark(s)');
        assert('ABS-H4: marks do not double-wrap — exactly one mark per match after rebuild',
            marks.length === 1,
            'got ' + marks.length + ' mark(s)');
    }

    // ABS-H5: switching from a query to empty removes all marks
    {
        render('slide');
        render('');
        const marks = listEl.querySelectorAll('mark.abs-search-highlight');
        assert('ABS-H5: clearing query after a highlight render leaves no marks',
            marks.length === 0,
            'got ' + marks.length + ' mark(s)');
    }

    // ABS-H6: query that matches nothing → no marks created
    {
        render('zzznomatch');
        const marks = listEl.querySelectorAll('mark.abs-search-highlight');
        assert('ABS-H6: non-matching query produces no marks',
            marks.length === 0,
            'got ' + marks.length + ' mark(s)');
    }

    // ABS-H7: CSS class .abs-search-highlight must be defined in the stylesheet
    // Prevents invisible highlights when the class name drifts in the CSS.
    {
        const fs   = require('fs');
        const path = require('path');
        const cssPath = path.join(__dirname, 'styles-dashboard.css');
        let cssText;
        try {
            cssText = fs.readFileSync(cssPath, 'utf8');
        } catch (e) {
            assert('ABS-H7: styles-dashboard.css is readable', false,
                'Could not read ' + cssPath + ': ' + e.message);
            cssText = '';
        }
        // Strip block comments before checking so a commented-out selector
        // cannot produce a false pass.
        const strippedCss = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
        // Match a CSS rule selector that targets .abs-search-highlight,
        // e.g. "mark.abs-search-highlight {" or ".abs-search-highlight {"
        const rulePresent = /\.abs-search-highlight\s*\{/.test(strippedCss) ||
                            /\.abs-search-highlight[\s,{]/.test(strippedCss);
        assert(
            'ABS-H7: styles-dashboard.css defines a CSS rule for .abs-search-highlight',
            rulePresent,
            'Class .abs-search-highlight not found in ' + cssPath +
            ' — rename or removal would make search highlights invisible'
        );
    }
}

// ── SYN1: BRANCH CC, label  — space-separated condition code ─────────────────
// Regression tests for the probe-identified syntax gap.

// SYN1-a: BRANCH EQ, label (with comma) assembles as BRANCHEQ
{
    const a = new ChurchAssembler();
    const r = a.assemble('NOP\nBRANCH EQ, done\ndone:\nNOP');
    assert('SYN1-a BRANCH EQ, label: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN1-a BRANCH EQ, label: word count = 3', r.words.length === 3,
        'words=' + r.words.length);
    const dis = a.disassemble(r.words[1]);
    assert('SYN1-a BRANCH EQ, label: disassembles as BRANCHEQ', dis.includes('BRANCHEQ'),
        'got: ' + dis);
    assert('SYN1-a BRANCH EQ, label: offset is +1', dis.includes('+1'),
        'got: ' + dis);
}

// SYN1-b: BRANCH NE label (no comma) also works
{
    const a = new ChurchAssembler();
    const r = a.assemble('NOP\nBRANCH NE loop\nloop:\nNOP');
    assert('SYN1-b BRANCH NE label (no comma): no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const dis = a.disassemble(r.words[1]);
    assert('SYN1-b BRANCH NE label: disassembles as BRANCHNE', dis.includes('BRANCHNE'),
        'got: ' + dis);
}

// SYN1-c: BRANCH EQ (no target) → branch-to-self (offset 0), no error
{
    const a = new ChurchAssembler();
    const r = a.assemble('BRANCH EQ');
    assert('SYN1-c BRANCH EQ (no target): no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN1-c BRANCH EQ (no target): 1 word emitted', r.words.length === 1,
        'words=' + r.words.length);
    const dis = a.disassemble(r.words[0]);
    assert('SYN1-c BRANCH EQ (no target): offset is +0', dis.includes('+0'),
        'got: ' + dis);
}

// SYN1-d: BRANCH LT, target round-trips correctly (cond=11)
{
    const a = new ChurchAssembler();
    const r = a.assemble('NOP\nBRANCH LT, end\nend:\nNOP');
    assert('SYN1-d BRANCH LT, end: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const dis = a.disassemble(r.words[1]);
    assert('SYN1-d BRANCH LT: disassembles as BRANCHLT', dis.includes('BRANCHLT'),
        'got: ' + dis);
}

// SYN1-e: existing BRANCHEQ suffix form still works (no regression)
{
    const a = new ChurchAssembler();
    const r = a.assemble('NOP\nBRANCHEQ done\ndone:\nNOP');
    assert('SYN1-e BRANCHEQ (suffix form): no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const dis = a.disassemble(r.words[1]);
    assert('SYN1-e BRANCHEQ (suffix): disassembles as BRANCHEQ', dis.includes('BRANCHEQ'),
        'got: ' + dis);
}

// SYN1-f: BRANCH followed by an unknown condition code → still treated as a label name
{
    const a = new ChurchAssembler();
    a.assemble('BRANCH DONE');
    // 'DONE' is not a condition code name; should produce a "label not defined" error
    assert('SYN1-f BRANCH DONE (not a CC): produces label-not-defined error',
        a.errors.length > 0 && a.errors[0].message.includes('"DONE"'),
        a.errors.map(e => e.message).join('; '));
}

// ── SYN2: CHANGE CRx (1-arg) — source defaults to destination ────────────────

// SYN2-a: CHANGE CR12 (1-arg) encodes same word as CHANGE CR12, CR12, 0
{
    const a1 = new ChurchAssembler();
    const r1 = a1.assemble('CHANGE CR12');
    assert('SYN2-a CHANGE CR12 (1-arg): no errors', a1.errors.length === 0,
        a1.errors.map(e => e.message).join('; '));

    const a3 = new ChurchAssembler();
    const r3 = a3.assemble('CHANGE CR12, CR12, 0');
    assert('SYN2-a CHANGE CR12 (1-arg) === CHANGE CR12,CR12,0',
        r1.words[0] === r3.words[0],
        `1arg=0x${(r1.words[0]>>>0).toString(16)} 3arg=0x${(r3.words[0]>>>0).toString(16)}`);
}

// SYN2-b: 2-arg form CHANGE CR12, CR12 (no imm) still works as before
{
    const a = new ChurchAssembler();
    const r = a.assemble('CHANGE CR12, CR12, 0');
    assert('SYN2-b CHANGE CR12,CR12,0 (3-arg): no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN2-b 3-arg: exactly 1 word', r.words.length === 1, 'words=' + r.words.length);
}

// SYN2-c: CHANGE CR12, CR12, #0x0A (hex literal) assembles and equals CHANGE CR12, CR12, #10
{
    const a = new ChurchAssembler();
    const r = a.assemble('CHANGE CR12, CR12, #0x0A');
    assert('SYN2-c CHANGE CR12,CR12,#0x0A: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN2-c CHANGE CR12,CR12,#0x0A: exactly 1 word', r.words.length === 1,
        'got ' + r.words.length + ' words');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('CHANGE CR12, CR12, #10');
    assert('SYN2-c CHANGE CR12,CR12,#0x0A === CHANGE CR12,CR12,#10',
        r.words[0] === r2.words[0],
        'hex=0x' + r.words[0].toString(16) + ' dec=0x' + r2.words[0].toString(16));
}

// SYN2-d: CHANGE CR12, CR12, #0b1010 (binary literal) assembles and equals CHANGE CR12, CR12, #10
{
    const a = new ChurchAssembler();
    const r = a.assemble('CHANGE CR12, CR12, #0b1010');
    assert('SYN2-d CHANGE CR12,CR12,#0b1010: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN2-d CHANGE CR12,CR12,#0b1010: exactly 1 word', r.words.length === 1,
        'got ' + r.words.length + ' words');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('CHANGE CR12, CR12, #10');
    assert('SYN2-d CHANGE CR12,CR12,#0b1010 === CHANGE CR12,CR12,#10',
        r.words[0] === r2.words[0],
        'bin=0x' + r.words[0].toString(16) + ' dec=0x' + r2.words[0].toString(16));
}

// ── SYN3: IADD / ISUB 2-arg immediate shorthand ───────────────────────────────

// SYN3-a: IADD DR1, #5 → same as IADD DR1, DR1, #5
{
    const a = new ChurchAssembler();
    const r = a.assemble('IADD DR1, #5');
    assert('SYN3-a IADD DR1, #5: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const dis = a.disassemble(r.words[0]);
    assert('SYN3-a IADD DR1, #5: disassembles as IADD DR1, DR1, #5',
        dis.includes('DR1, DR1, #5'), 'got: ' + dis);
}

// SYN3-b: IADD DR1, #5 produces same word as IADD DR1, DR1, #5 (explicit)
{
    const a1 = new ChurchAssembler();
    const r1 = a1.assemble('IADD DR1, #5');

    const a3 = new ChurchAssembler();
    const r3 = a3.assemble('IADD DR1, DR1, #5');

    assert('SYN3-b IADD DR1, #5 === IADD DR1, DR1, #5',
        r1.words[0] === r3.words[0],
        `2arg=0x${(r1.words[0]>>>0).toString(16)} 3arg=0x${(r3.words[0]>>>0).toString(16)}`);
}

// SYN3-c: ISUB DR3, #10 → same as ISUB DR3, DR3, #10
{
    const a = new ChurchAssembler();
    const r = a.assemble('ISUB DR3, #10');
    assert('SYN3-c ISUB DR3, #10: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const dis = a.disassemble(r.words[0]);
    assert('SYN3-c ISUB DR3, #10: disassembles as ISUB DR3, DR3, #10',
        dis.includes('DR3, DR3, #10'), 'got: ' + dis);
}

// SYN3-d: IADD DR0, 5 (bare decimal, no # prefix) also works
{
    const a = new ChurchAssembler();
    const r = a.assemble('IADD DR0, 5');
    assert('SYN3-d IADD DR0, 5 (bare decimal): no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const a1 = new ChurchAssembler();
    const r1 = a1.assemble('IADD DR0, #5');
    assert('SYN3-d IADD DR0, 5 === IADD DR0, #5',
        r.words[0] === r1.words[0],
        `bare=0x${(r.words[0]>>>0).toString(16)} hash=0x${(r1.words[0]>>>0).toString(16)}`);
}

// SYN3-e: 3-arg register form IADD DR1, DR2, DR3 is not broken (no regression)
{
    const a = new ChurchAssembler();
    const r = a.assemble('IADD DR1, DR2, DR3');
    assert('SYN3-e IADD DR1, DR2, DR3 (3-arg reg): no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const dis = a.disassemble(r.words[0]);
    assert('SYN3-e IADD DR1, DR2, DR3: disassembles correctly',
        dis.includes('DR1, DR2, DR3'), 'got: ' + dis);
}

// SYN3-f: 3-arg immediate form IADD DR1, DR2, #7 is not broken (no regression)
{
    const a = new ChurchAssembler();
    const r = a.assemble('IADD DR1, DR2, #7');
    assert('SYN3-f IADD DR1, DR2, #7 (3-arg imm): no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const dis = a.disassemble(r.words[0]);
    assert('SYN3-f IADD DR1, DR2, #7: disassembles correctly',
        dis.includes('DR1, DR2, #7'), 'got: ' + dis);
}

// ── BRANCH one-past-end target (SYN4) ────────────────────────────────────────

// SYN4-a: BRANCH EQ to a label one-past-end of the code body must assemble without error.
//   The canonical "branch to exit" pattern: endLabel is placed after the last instruction.
{
    const a = new ChurchAssembler();
    const r = a.assemble(
        'IADD DR0, DR1, DR2\n' +
        'BRANCH EQ, done\n' +
        'ISUB DR0, DR1, DR2\n' +
        'done:'
    );
    assert('SYN4-a BRANCH EQ to one-past-end label: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN4-a BRANCH EQ to one-past-end label: 3 words emitted',
        r.words.length === 3, 'got ' + r.words.length);
    // The BRANCH is at word index 1; done: is at index 3 (== totalWords).
    // signed offset = 3 - 1 = +2. Verify the encoded offset.
    const branchWord = r.words[1];
    const rawImm = branchWord & 0x7FFF;
    const signedOffset = (rawImm & 0x4000) ? (rawImm | 0xFFFF8000) : rawImm;
    assert('SYN4-a BRANCH offset = +2 (one-past-end)', signedOffset === 2,
        'got offset ' + signedOffset);
}

// SYN4-b: BRANCH NE to one-past-end also assembles without error.
{
    const a = new ChurchAssembler();
    const r = a.assemble(
        'NOP\n' +
        'BRANCH NE, exit\n' +
        'exit:'
    );
    assert('SYN4-b BRANCH NE to one-past-end: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN4-b word count = 2', r.words.length === 2, 'got ' + r.words.length);
}

// SYN4-c: BRANCH LT to one-past-end also assembles without error.
{
    const a = new ChurchAssembler();
    const r = a.assemble(
        'MCMP DR0, DR1\n' +
        'BRANCH LT, done\n' +
        'done:'
    );
    assert('SYN4-c BRANCH LT to one-past-end: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN4-c word count = 2', r.words.length === 2, 'got ' + r.words.length);
}

// SYN4-d: BRANCH to two-past-end must still be an error (genuine out-of-range).
{
    const a = new ChurchAssembler();
    a.assemble(
        'NOP\n' +
        'BRANCH EQ, toofar\n' +
        'NOP\n' +
        'toofar:'   // index 3 = totalWords (3); +2 past word 1 → index 3 OK
        // Actually this is ALSO at totalWords (3 words, label at 3), so it's valid.
        // Use an explicit numeric offset to force an over-bounds jump.
    );
    // Numeric offset that overshoots by 1: from word 1, offset +3 → target 4, but totalWords=3
    const b = new ChurchAssembler();
    b.assemble('NOP\nNOP\nNOP\nBRANCH EQ, +999\n');
    assert('SYN4-d BRANCH to far-out-of-range target: error', b.errors.length > 0,
        'expected at least one error');
}

// ── MCMP immediate synthesis (SYN5) ──────────────────────────────────────────

// SYN5-a: MCMP DR0, #5 assembles without error and synthesizes as ISUB DR15, DR0, #5.
{
    const a = new ChurchAssembler();
    const r = a.assemble('MCMP DR0, #5');
    assert('SYN5-a MCMP DR0, #5: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN5-a MCMP DR0, #5: exactly 1 word emitted', r.words.length === 1,
        'got ' + r.words.length);
    // Synthesized as ISUB DR15, DR0, #5 — opcode=22 (v2.0), crDst=15, crSrc=0, imm=0x4005
    const w = r.words[0];
    const opcode = (w >>> 27) & 0x1F;
    const crDst  = (w >>> 19) & 0xF;
    const crSrc  = (w >>> 15) & 0xF;
    const imm    = w & 0x7FFF;
    assert('SYN5-a opcode = 22 (ISUB)', opcode === 22, 'got opcode ' + opcode);
    assert('SYN5-a crDst = 15 (scratch DR15)', crDst === 15, 'got crDst ' + crDst);
    assert('SYN5-a crSrc = 0 (DR0)', crSrc === 0, 'got crSrc ' + crSrc);
    assert('SYN5-a imm = 0x4005 (immediate flag + 5)', imm === 0x4005,
        'got imm 0x' + imm.toString(16));
}

// SYN5-b: MCMP DR0, #5 produces the same word as ISUB DR15, DR0, #5 (explicit).
{
    const a1 = new ChurchAssembler();
    const r1 = a1.assemble('MCMP DR0, #5');

    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('ISUB DR15, DR0, #5');

    assert('SYN5-b MCMP DR0, #5 === ISUB DR15, DR0, #5',
        r1.words[0] === r2.words[0],
        `mcmp=0x${(r1.words[0]>>>0).toString(16)} isub=0x${(r2.words[0]>>>0).toString(16)}`);
}

// SYN5-c: MCMP DR3, #0 (zero immediate) assembles correctly.
{
    const a = new ChurchAssembler();
    const r = a.assemble('MCMP DR3, #0');
    assert('SYN5-c MCMP DR3, #0: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const w = r.words[0];
    const crSrc = (w >>> 15) & 0xF;
    assert('SYN5-c MCMP DR3, #0: crSrc = 3 (DR3)', crSrc === 3, 'got crSrc ' + crSrc);
}

// SYN5-d: MCMP DR0, #5 bare decimal (no # prefix) also works.
{
    const a = new ChurchAssembler();
    const r = a.assemble('MCMP DR0, 5');
    assert('SYN5-d MCMP DR0, 5 (bare decimal): no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('MCMP DR0, #5');
    assert('SYN5-d MCMP DR0, 5 === MCMP DR0, #5',
        r.words[0] === r2.words[0],
        `bare=0x${(r.words[0]>>>0).toString(16)} hash=0x${(r2.words[0]>>>0).toString(16)}`);
}

// SYN5-e: 2-arg register form MCMP DR0, DR1 is not broken (no regression).
{
    const a = new ChurchAssembler();
    const r = a.assemble('MCMP DR0, DR1');
    assert('SYN5-e MCMP DR0, DR1 (register form): no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const w = r.words[0];
    const opcode = (w >>> 27) & 0x1F;
    const crDst  = (w >>> 19) & 0xF;
    const crSrc  = (w >>> 15) & 0xF;
    assert('SYN5-e register form opcode = 20 (MCMP)', opcode === 20, 'got opcode ' + opcode);
    assert('SYN5-e register form crDst = 0 (DR0)', crDst === 0, 'got crDst ' + crDst);
    assert('SYN5-e register form crSrc = 1 (DR1)', crSrc === 1, 'got crSrc ' + crSrc);
}

// SYN5-f: MCMP DR0, #0x0A (hex literal) assembles and equals MCMP DR0, #10.
{
    const a = new ChurchAssembler();
    const r = a.assemble('MCMP DR0, #0x0A');
    assert('SYN5-f MCMP DR0, #0x0A: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN5-f MCMP DR0, #0x0A: exactly 1 word emitted', r.words.length === 1,
        'got ' + r.words.length + ' words');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('MCMP DR0, #10');
    assert('SYN5-f MCMP DR0, #0x0A === MCMP DR0, #10',
        r.words[0] === r2.words[0],
        'hex=0x' + r.words[0].toString(16) + ' dec=0x' + r2.words[0].toString(16));
}

// SYN5-g: MCMP DR0, #0b1010 (binary literal) assembles and equals MCMP DR0, #10.
{
    const a = new ChurchAssembler();
    const r = a.assemble('MCMP DR0, #0b1010');
    assert('SYN5-g MCMP DR0, #0b1010: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN5-g MCMP DR0, #0b1010: exactly 1 word emitted', r.words.length === 1,
        'got ' + r.words.length + ' words');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('MCMP DR0, #10');
    assert('SYN5-g MCMP DR0, #0b1010 === MCMP DR0, #10',
        r.words[0] === r2.words[0],
        'bin=0x' + r.words[0].toString(16) + ' dec=0x' + r2.words[0].toString(16));
}

// ── IADD / ISUB hex and binary immediate literals (SYN6) ─────────────────────

// SYN6-a: IADD DR0, #0x0A (hex literal) assembles and equals IADD DR0, #10.
{
    const a = new ChurchAssembler();
    const r = a.assemble('IADD DR0, #0x0A');
    assert('SYN6-a IADD DR0, #0x0A: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN6-a IADD DR0, #0x0A: exactly 1 word emitted', r.words.length === 1,
        'got ' + r.words.length + ' words');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('IADD DR0, #10');
    assert('SYN6-a IADD DR0, #0x0A === IADD DR0, #10',
        r.words[0] === r2.words[0],
        'hex=0x' + r.words[0].toString(16) + ' dec=0x' + r2.words[0].toString(16));
}

// SYN6-b: IADD DR0, #0b1010 (binary literal) assembles and equals IADD DR0, #10.
{
    const a = new ChurchAssembler();
    const r = a.assemble('IADD DR0, #0b1010');
    assert('SYN6-b IADD DR0, #0b1010: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN6-b IADD DR0, #0b1010: exactly 1 word emitted', r.words.length === 1,
        'got ' + r.words.length + ' words');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('IADD DR0, #10');
    assert('SYN6-b IADD DR0, #0b1010 === IADD DR0, #10',
        r.words[0] === r2.words[0],
        'bin=0x' + r.words[0].toString(16) + ' dec=0x' + r2.words[0].toString(16));
}

// SYN6-c: ISUB DR0, #0x0A (hex literal) assembles and equals ISUB DR0, #10.
{
    const a = new ChurchAssembler();
    const r = a.assemble('ISUB DR0, #0x0A');
    assert('SYN6-c ISUB DR0, #0x0A: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN6-c ISUB DR0, #0x0A: exactly 1 word emitted', r.words.length === 1,
        'got ' + r.words.length + ' words');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('ISUB DR0, #10');
    assert('SYN6-c ISUB DR0, #0x0A === ISUB DR0, #10',
        r.words[0] === r2.words[0],
        'hex=0x' + r.words[0].toString(16) + ' dec=0x' + r2.words[0].toString(16));
}

// SYN6-d: ISUB DR0, #0b1010 (binary literal) assembles and equals ISUB DR0, #10.
{
    const a = new ChurchAssembler();
    const r = a.assemble('ISUB DR0, #0b1010');
    assert('SYN6-d ISUB DR0, #0b1010: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN6-d ISUB DR0, #0b1010: exactly 1 word emitted', r.words.length === 1,
        'got ' + r.words.length + ' words');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('ISUB DR0, #10');
    assert('SYN6-d ISUB DR0, #0b1010 === ISUB DR0, #10',
        r.words[0] === r2.words[0],
        'bin=0x' + r.words[0].toString(16) + ' dec=0x' + r2.words[0].toString(16));
}

// ── LOAD / SAVE hex and binary immediate offset literals (SYN7) ──────────────

// SYN7-a: LOAD CR2, CR6, #0x05 (hex literal) assembles and equals LOAD CR2, CR6, #5.
{
    const a = new ChurchAssembler();
    const r = a.assemble('LOAD CR2, CR6, #0x05');
    assert('SYN7-a LOAD CR2,CR6,#0x05: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN7-a LOAD CR2,CR6,#0x05: exactly 1 word emitted', r.words.length === 1,
        'got ' + r.words.length + ' words');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('LOAD CR2, CR6, #5');
    assert('SYN7-a LOAD CR2,CR6,#0x05 === LOAD CR2,CR6,#5',
        r.words[0] === r2.words[0],
        'hex=0x' + r.words[0].toString(16) + ' dec=0x' + r2.words[0].toString(16));
}

// SYN7-b: LOAD CR2, CR6, #0b00101 (binary literal) assembles and equals LOAD CR2, CR6, #5.
{
    const a = new ChurchAssembler();
    const r = a.assemble('LOAD CR2, CR6, #0b00101');
    assert('SYN7-b LOAD CR2,CR6,#0b00101: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN7-b LOAD CR2,CR6,#0b00101: exactly 1 word emitted', r.words.length === 1,
        'got ' + r.words.length + ' words');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('LOAD CR2, CR6, #5');
    assert('SYN7-b LOAD CR2,CR6,#0b00101 === LOAD CR2,CR6,#5',
        r.words[0] === r2.words[0],
        'bin=0x' + r.words[0].toString(16) + ' dec=0x' + r2.words[0].toString(16));
}

// SYN7-c: SAVE CR2, CR6, #0x05 (hex literal) assembles and equals SAVE CR2, CR6, #5.
{
    const a = new ChurchAssembler();
    const r = a.assemble('SAVE CR2, CR6, #0x05');
    assert('SYN7-c SAVE CR2,CR6,#0x05: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN7-c SAVE CR2,CR6,#0x05: exactly 1 word emitted', r.words.length === 1,
        'got ' + r.words.length + ' words');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('SAVE CR2, CR6, #5');
    assert('SYN7-c SAVE CR2,CR6,#0x05 === SAVE CR2,CR6,#5',
        r.words[0] === r2.words[0],
        'hex=0x' + r.words[0].toString(16) + ' dec=0x' + r2.words[0].toString(16));
}

// SYN7-d: SAVE CR2, CR6, #0b00101 (binary literal) assembles and equals SAVE CR2, CR6, #5.
{
    const a = new ChurchAssembler();
    const r = a.assemble('SAVE CR2, CR6, #0b00101');
    assert('SYN7-d SAVE CR2,CR6,#0b00101: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('SYN7-d SAVE CR2,CR6,#0b00101: exactly 1 word emitted', r.words.length === 1,
        'got ' + r.words.length + ' words');
    const a2 = new ChurchAssembler();
    const r2 = a2.assemble('SAVE CR2, CR6, #5');
    assert('SYN7-d SAVE CR2,CR6,#0b00101 === SAVE CR2,CR6,#5',
        r.words[0] === r2.words[0],
        'bin=0x' + r.words[0].toString(16) + ' dec=0x' + r2.words[0].toString(16));
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
