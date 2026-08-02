'use strict';
// test_boot_gt_words.js — Regression test: boot [BOOT] output lines include word0/word1/word2
//
// Verifies that every CR-write step in _bootStep() emits `word0=0x...`/`word1=0x...`/`word2=0x...`
// and that the hardwired GT word0 values match the documented encoding tables in
// docs/architecture.md "Boot Sequence".
//
// Run:  node simulator/test_boot_gt_words.js
//
// Coverage:
//   T001 — LOAD_NS (B:01): CR15 word0=0x02000000 (zero-perm Inform, slot=0)
//   T002 — INIT_THRD (B:02): CR12 word0=0x02000001 (zero-perm Inform, slot=1)
//   T003 — INIT_HEAP (B:03): CR5 word0=0x32000001 (R+W Turing, slot=1)
//   T004 — INIT_ABSTR (B:05): CR6 word0 has Church E-perm bits (0x4A prefix)
//   T005 — NUC_CLIST (B:06): CR6 word0 has Church L-perm bits (0x1A prefix)
//   T006 — NUC_CODE (B:07): CR14 word0=0x52000000|slot (R+X Turing), CR0 word0=E-GT
//   T007 — All CR-write lines include word0=0x.../word1=0x.../word2=0x... fields
//   T008 — CR5 uses slot=1 (not slot=0); word0 low byte is 0x01

const ChurchSimulator     = require('./simulator.js');
const AbstractionRegistry = require('./abstractions.js');
const SystemAbstractions  = require('./system_abstractions.js');

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
    if (cond) {
        console.log(`PASS ${label}`);
        pass++;
    } else {
        console.log(`FAIL ${label}${detail ? ' — ' + detail : ''}`);
        fail++;
    }
}

// ── Boot the simulator through all boot steps ─────────────────────────────────

const sim = new ChurchSimulator();
const reg = new AbstractionRegistry(sim);
new SystemAbstractions(reg);
sim.abstractionRegistry = reg;

sim.reset();
// Run all boot steps (B:00 through B:07)
for (let i = 0; i < 20; i++) {
    if (sim.bootComplete || sim.halted) break;
    sim._bootStep();
}

const output = sim.output || '';
const lines  = output.split('\n');

// ── Helper: find first [BOOT] line matching a keyword ─────────────────────────
function bootLine(keyword) {
    return lines.find(l => l.includes('[BOOT]') && l.includes(keyword)) || '';
}

// ── Extract a hex value from a word0/word1/word2 field ────────────────────────
function extractField(line, field) {
    // matches e.g. "word0=0x02000000"
    const m = line.match(new RegExp(field + '=0x([0-9A-Fa-f]{8})'));
    return m ? parseInt(m[1], 16) : null;
}

// ── T001: LOAD_NS CR15 word0 ──────────────────────────────────────────────────
const loadNSLine = bootLine('LOAD_NS');
const cr15w0 = extractField(loadNSLine, 'word0');
check('T001 LOAD_NS CR15 word0=0x02000000', cr15w0 === 0x02000000, `got 0x${(cr15w0||0).toString(16)}`);

// ── T002: INIT_THRD CR12 word0 ────────────────────────────────────────────────
const initThrdLine = bootLine('INIT_THRD');
const cr12w0 = extractField(initThrdLine, 'word0');
check('T002 INIT_THRD CR12 word0=0x02000001', cr12w0 === 0x02000001, `got 0x${(cr12w0||0).toString(16)}`);

// ── T003: INIT_HEAP CR5 word0 ─────────────────────────────────────────────────
const initHeapLine = bootLine('INIT_HEAP');
const cr5w0 = extractField(initHeapLine, 'word0');
check('T003 INIT_HEAP CR5 word0=0x32000001 (R+W Turing slot=1)', cr5w0 === 0x32000001, `got 0x${(cr5w0||0).toString(16)}`);

// ── T004: INIT_ABSTR B:05 CR6 E-GT (Church E = 0x4A prefix) ─────────────────
const initAbstrLine = bootLine('INIT_ABSTR');
const cr6eW0 = extractField(initAbstrLine, 'word0');
// Church E-perm: (0b100<<28)|(1<<27)|(0b01<<25) = 0x4A000000 + slot
check('T004 INIT_ABSTR CR6 E-GT has 0x4A prefix (Church E)',
    cr6eW0 !== null && (cr6eW0 >>> 24) === 0x4A,
    `got 0x${(cr6eW0||0).toString(16).toUpperCase()}`);

// ── T005: NUC_CLIST B:06 — word fields present; correct word0 for cc=0 or cc>0 ─
// cc=0 (default): Boot.Abstr has no c-list → CR6←NULL (word0=0x00000000).
// cc>0 (saved-lump): CR6 gets L-perm c-list token (word0=0x1A000000|slot).
const nucClistLine0 = bootLine('cc=0');          // cc=0 path
const nucClistLineL = bootLine('INIT_CLIST CR6(L)');  // cc>0 path
const nucClistLine  = nucClistLine0 || nucClistLineL;
const isCC0 = !!nucClistLine0;
const cr6lW0 = extractField(nucClistLine, 'word0');
if (isCC0) {
    // cc=0: expect NULL GT
    check('T005 NUC_CLIST (cc=0) CR6←NULL word0=0x00000000',
        cr6lW0 === 0x00000000,
        `got 0x${(cr6lW0||0).toString(16).toUpperCase()}`);
} else {
    // cc>0: expect Church L-perm (0x1A prefix)
    check('T005 NUC_CLIST (cc>0) CR6 L c-list word0 has 0x1A prefix',
        cr6lW0 !== null && (cr6lW0 >>> 24) === 0x1A,
        `got 0x${(cr6lW0||0).toString(16).toUpperCase()}`);
}

// ── T006: NUC_CODE B:07 CR14 R+X and CR0 E-GT ────────────────────────────────
const nucCodeLine = bootLine('NUC_CODE');
// CR14: two word0= tokens appear; first is CR14
const cr14Match = nucCodeLine.match(/CR14\(R\+X\).*?word0=0x([0-9A-Fa-f]{8})/);
const cr14w0 = cr14Match ? parseInt(cr14Match[1], 16) : null;
// Turing R+X: (0b101<<28)|(0b01<<25) = 0x52000000 + slot
check('T006 NUC_CODE CR14 word0=0x52000000|slot (R+X Turing)',
    cr14w0 !== null && (cr14w0 & 0xFF000000) === 0x52000000,
    `got 0x${(cr14w0||0).toString(16).toUpperCase()}`);

const cr0Match = nucCodeLine.match(/CR0.*?word0=0x([0-9A-Fa-f]{8})/);
const cr0w0 = cr0Match ? parseInt(cr0Match[1], 16) : null;
// Church E: 0x4A prefix
check('T006b NUC_CODE CR0 word0 has 0x4A prefix (Church E)',
    cr0w0 !== null && (cr0w0 >>> 24) === 0x4A,
    `got 0x${(cr0w0||0).toString(16).toUpperCase()}`);

// ── T007: All CR-write [BOOT] lines include word0/word1/word2 ─────────────────
const crWriteKeywords = ['LOAD_NS', 'INIT_THRD', 'INIT_HEAP', 'INIT_ABSTR', 'NUC_CODE'];
let allHaveWords = true;
for (const kw of crWriteKeywords) {
    const l = bootLine(kw);
    const hasAll = l.includes('word0=0x') && l.includes('word1=0x') && l.includes('word2=0x');
    if (!hasAll) {
        console.log(`  MISSING word fields in: "${l.trim()}"`);
        allHaveWords = false;
    }
}
check('T007 All CR-write [BOOT] lines include word0/word1/word2 fields', allHaveWords);

// ── T008: CR5 slot=1 (word0 low byte = 0x01, not 0x00) ───────────────────────
check('T008 CR5 word0 low byte = 0x01 (slot=1, not slot=0)',
    cr5w0 !== null && (cr5w0 & 0xFF) === 0x01,
    `got low byte 0x${((cr5w0||0) & 0xFF).toString(16)}`);

// ── T009: Boot completes (all steps ran without fault) ────────────────────────
check('T009 Boot completes without fault', sim.bootComplete && !sim.halted);

// ── T010: NUC_CODE CR14/CR0 word1/word2 present ──────────────────────────────
const cr14HasWords = nucCodeLine.includes('word1=0x') && nucCodeLine.includes('word2=0x');
const cr0HasWords  = /CR0.*word1=0x/.test(nucCodeLine) && /CR0.*word2=0x/.test(nucCodeLine);
check('T010 NUC_CODE line includes CR14 word1/word2', cr14HasWords, `line: "${nucCodeLine.trim().slice(0,120)}"`);
check('T010b NUC_CODE line includes CR0 word1/word2', cr0HasWords, `line: "${nucCodeLine.trim().slice(0,120)}"`);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
