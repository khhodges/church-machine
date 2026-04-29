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

    // P12h: CALL crSrc CR13 (method selector via CR syntax) → error
    const h = new ChurchAssembler();
    h.assemble('CALL CR0, CR13, 0');
    assert('P12h CALL CR0 CR13: error (priv-zone method selector)', h.errors.length > 0, 'expected an error');
    assert('P12h error mentions CR13', h.errors.some(e => e.message.includes('CR13')),
        h.errors.map(e => e.message).join('; '));

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

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
