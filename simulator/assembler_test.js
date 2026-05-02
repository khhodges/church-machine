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

// ── CALL SlideRule, MethodName  (abstraction-name comma form) ───────────────

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

// ── CALL SlideRule.MethodName  (dot-notation form) ───────────────────────────

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

    // P12p: SWITCH CR11 → no error (CR11 is the boundary)
    const p = new ChurchAssembler();
    p.assemble('SWITCH CR11, 0');
    assert('P12p SWITCH CR11: no error', p.errors.length === 0,
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
        '  DREAD DR1, CR14, #V1',    // word 0 → imm should be 2
        '  RETURN',                   // word 1
        'V1:',
        '  WORD 99',                  // word 2
    ].join('\n'));
    assert('DL2 DREAD #label: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const dImm = r.words[0] & 0x7FFF;
    assert('DL2 DREAD #label: imm = 2 (absolute offset of V1)', dImm === 2,
        `imm=${dImm}`);
}

// DL3: DREAD encodes label without hash prefix — V1 (no #)
{
    const a = new ChurchAssembler();
    const r = a.assemble([
        '  DREAD DR1, CR14, V1',     // word 0 → imm should be 2
        '  RETURN',                   // word 1
        'V1:',
        '  WORD 99',                  // word 2
    ].join('\n'));
    assert('DL3 DREAD label (no #): no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    const dImm2 = r.words[0] & 0x7FFF;
    assert('DL3 DREAD label (no #): imm = 2', dImm2 === 2, `imm=${dImm2}`);
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
        '  DREAD DR1, CR14, V1',     // word 0 → imm=3
        '  DREAD DR2, CR14, V2',     // word 1 → imm=4
        '  RETURN',                   // word 2
        'V1:',
        '  WORD 10',                  // word 3
        'V2:',
        '  WORD 20',                  // word 4
    ].join('\n'));
    assert('DL5 multi WORD labels: no errors', a.errors.length === 0,
        a.errors.map(e => e.message).join('; '));
    assert('DL5 V1 offset = 3', (r.words[0] & 0x7FFF) === 3,
        `imm0=${r.words[0]&0x7FFF}`);
    assert('DL5 V2 offset = 4', (r.words[1] & 0x7FFF) === 4,
        `imm1=${r.words[1]&0x7FFF}`);
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

// ── ELOADCALL method-index encoding ──────────────────────────────────────────
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
//       SlideRule256 is mapped to slot 256 in a local namespace.
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
//       ELOADCALL CR0, CR11, #256, 0 — slot must be 0–255 even when method index is present.
{
    const a = new ChurchAssembler(CONVENTIONS);
    a.assemble('ELOADCALL CR0, CR11, #256, 0');
    assert('EL16 ELOADCALL explicit row=256 (with method): produces an error',
        a.errors.length > 0, 'expected at least one error');
    assert('EL16 error says "out of range" and shows 256',
        a.errors.some(e => e.message.includes('out of range') && e.message.includes('256')),
        a.errors.map(e => e.message).join('; '));
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
    assert('SA1 opcode=19 (SHR)', opcode === 19, 'got ' + opcode);
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
    assert('SA2 opcode=19 (SHR)', opcode === 19, 'got ' + opcode);
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
        if (((w >>> 27) & 0x1F) === 19) {
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

// ── TP: TPERM simulator integration tests (task-873) ─────────────────────────
// These tests exercise _execTperm directly via step() to verify:
//   C.1 — reserved presets fault with TPERM_RSV (not silent Z=0)
//   C.2 — out-of-bounds GT base+size fails the bounds check (Z=0, not Z=1)
//   Regression — valid preset + in-range GT still passes (Z=1)
//
// TPERM instruction word layout: opcode[31:27]=6, crDst[22:19], imm[14:0]
// GT word layout: permBits[31:25], type[24:23], seq[22:16], index[15:0]
//   R perm = permBits bit 0; Inform type = 0b01

// GT word for CR0: R permission, Inform type, NS index 0, seq 0
// GT bits: permBits[31:25]=0b0000001(R), type[24:23]=0b01(Inform), seq[22:16]=0, index[15:0]=0
const TP_GT_R_IDX0 = ((0b0000001 << 25) | (0b01 << 23) | 0) >>> 0;

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

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
