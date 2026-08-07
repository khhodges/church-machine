'use strict';
// test_boot_gt_words.js — Regression test: boot trace packets carry correct GT values
//
// Verifies that the 8 per-event trace packets emitted by _bootStep() carry the
// correct GT word0 values for each boot-ROM instruction, matching the documented
// encoding tables in docs/architecture.md "Boot Sequence".
//
// Previously parsed [BOOT] text messages from sim.output; now reads from
// sim._tracePacketsBuf which carries the hardware-compatible packet stream.
//
// Run:  node simulator/test_boot_gt_words.js
//
// Boot trace packet map (hardware NIA 0=LOAD, 1=CHANGE, 2=CALL):
//   T001 — B:01 LOAD_NS  (NIA=0): LOAD_NEW   payload=0x02000000 (zero-perm Inform, slot=0)
//   T002 — B:02/B:03     (NIA=1): CHANGE_CR12 payload=0x02000001 (zero-perm Inform, slot=1)
//   T003 — B:03 INIT_HEAP(NIA=1): CHANGE_CR5  payload=0x32000001 (R+W Turing, slot=1)
//   T004 — B:05 INIT_ABSTR: CR6 interim E-GT has 0x4A prefix (Church E)
//   T005 — B:06 NUC_CLIST:  CALL_CR6 packet carries final CR6 at CALL time (0=NULL if cc=0)
//   T006 — B:07 NUC_CODE (NIA=2): CALL_CR14 payload has 0x52 prefix (R+X Turing)
//   T006b — B:07 NUC_CODE: sim.cr[0].word0 after boot has 0x4A prefix (Church E)
//   T007 — Exactly 8 boot trace packets: NIA=0,0,1,1,1,2,2,2; ev_types 1–8 in order
//   T008 — CHANGE_CR5 payload low byte=0x01 (slot=1, not slot=0)
//   T009 — Boot completes without fault
//   T010 — sim.cr[14].word1 (lump base) is non-zero after boot

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

// ── Set up simulator with full abstraction registry ───────────────────────────
const sim = new ChurchSimulator();
const reg = new AbstractionRegistry(sim);
new SystemAbstractions(reg);
sim.abstractionRegistry = reg;
sim.reset();

// ── T004 setup: capture CR6 after B:05 INIT_ABSTR (before B:06 clears it) ───
// Run exactly B:00–B:05 (cases 0–5, 6 calls) so CR6 holds the E-GT
for (let i = 0; i < 6; i++) {
    if (sim.bootComplete || sim.halted) break;
    sim._bootStep();
}
const cr6AfterB05 = sim.cr[6] ? (sim.cr[6].word0 >>> 0) : 0;

// ── Complete boot (B:06 and B:07) ────────────────────────────────────────────
for (let i = 0; i < 20; i++) {
    if (sim.bootComplete || sim.halted) break;
    sim._bootStep();
}

// ── Trace packet helpers ──────────────────────────────────────────────────────
const pkts = sim._tracePacketsBuf;

// ev_type constants (mirror TRACE_EV_* in simulator.js)
const LOAD_SHADOW  = 1;
const LOAD_NEW     = 2;
const CHANGE_PUSH  = 3;
const CHANGE_CR12  = 4;
const CHANGE_CR5   = 5;
const CALL_CR6     = 6;
const CALL_CR14    = 7;
const CALL_PUSH    = 8;

const pktByType = ev => pkts.find(p => p.ev_type === ev);

// ── T001: LOAD_NS CR15 word0 ──────────────────────────────────────────────────
const loadNewPkt = pktByType(LOAD_NEW);
const cr15w0 = loadNewPkt ? (loadNewPkt.payload_gt >>> 0) : null;
check('T001 LOAD_NS CR15 word0=0x02000000', cr15w0 === 0x02000000,
    `got 0x${(cr15w0||0).toString(16)}`);

// ── T002: INIT_THRD CR12 word0 ────────────────────────────────────────────────
const changeCR12Pkt = pktByType(CHANGE_CR12);
const cr12w0 = changeCR12Pkt ? (changeCR12Pkt.payload_gt >>> 0) : null;
check('T002 INIT_THRD CR12 word0=0x02000001', cr12w0 === 0x02000001,
    `got 0x${(cr12w0||0).toString(16)}`);

// ── T003: INIT_HEAP CR5 word0 ─────────────────────────────────────────────────
const changeCR5Pkt = pktByType(CHANGE_CR5);
const cr5w0 = changeCR5Pkt ? (changeCR5Pkt.payload_gt >>> 0) : null;
check('T003 INIT_HEAP CR5 word0=0x32000001 (R+W Turing slot=1)', cr5w0 === 0x32000001,
    `got 0x${(cr5w0||0).toString(16)}`);

// ── T004: INIT_ABSTR B:05 CR6 E-GT (Church E = 0x4A prefix) ─────────────────
// Church E-perm: (0b100<<28)|(1<<27)|(0b01<<25) = 0x4A000000 + slot
check('T004 INIT_ABSTR CR6 E-GT has 0x4A prefix (Church E)',
    (cr6AfterB05 >>> 24) === 0x4A,
    `got 0x${cr6AfterB05.toString(16).toUpperCase()}`);

// ── T005: NUC_CLIST B:06 — CALL_CR6 packet shows final CR6 at CALL time ──────
// cc=0 (default): Boot.Abstr has no c-list → CR6 cleared to NULL before CALL
// cc>0 (saved-lump): CR6 holds L-perm c-list token (word0=0x1A000000|slot)
const callCR6Pkt = pktByType(CALL_CR6);
const cr6atCall = callCR6Pkt ? (callCR6Pkt.payload_gt >>> 0) : null;
const isCC0 = cr6atCall === 0x00000000;
if (isCC0) {
    check('T005 NUC_CLIST (cc=0) CALL_CR6 payload=0x00000000 (NULL, direct dispatch)',
        cr6atCall === 0x00000000,
        `got 0x${(cr6atCall||0).toString(16).toUpperCase()}`);
} else {
    check('T005 NUC_CLIST (cc>0) CALL_CR6 payload has 0x1A prefix (Church L)',
        cr6atCall !== null && (cr6atCall >>> 24) === 0x1A,
        `got 0x${(cr6atCall||0).toString(16).toUpperCase()}`);
}

// ── T006: NUC_CODE B:07 CR14 R+X ─────────────────────────────────────────────
const callCR14Pkt = pktByType(CALL_CR14);
const cr14w0 = callCR14Pkt ? (callCR14Pkt.payload_gt >>> 0) : null;
// Turing R+X: (0b101<<28)|(0b01<<25) = 0x52000000 + slot
check('T006 NUC_CODE CR14 word0 has 0x52 prefix (R+X Turing)',
    cr14w0 !== null && (cr14w0 & 0xFF000000) === 0x52000000,
    `got 0x${(cr14w0||0).toString(16).toUpperCase()}`);

// ── T006b: NUC_CODE CR0 E-GT after boot ──────────────────────────────────────
const cr0w0 = sim.cr[0] ? (sim.cr[0].word0 >>> 0) : 0;
// Church E: 0x4A prefix
check('T006b NUC_CODE CR0 word0 has 0x4A prefix (Church E)',
    (cr0w0 >>> 24) === 0x4A,
    `got 0x${cr0w0.toString(16).toUpperCase()}`);

// ── T007: Exactly 8 boot trace packets in the correct NIA/ev_type sequence ───
const expectedNIAs    = [0, 0, 1, 1, 1, 2, 2, 2];
const expectedEvTypes = [LOAD_SHADOW, LOAD_NEW, CHANGE_PUSH, CHANGE_CR12, CHANGE_CR5,
                         CALL_CR6, CALL_CR14, CALL_PUSH];
check('T007a Exactly 8 boot trace packets', pkts.length === 8, `got ${pkts.length}`);
let packetShapeOk = true;
for (let i = 0; i < Math.max(8, pkts.length); i++) {
    const p = pkts[i];
    const expNia = expectedNIAs[i];
    const expEv  = expectedEvTypes[i];
    if (!p || p.nia !== expNia || p.ev_type !== expEv) {
        console.log(`  packet[${i}]: expected nia=${expNia} ev_type=${expEv}, ` +
                    `got nia=${p && p.nia} ev_type=${p && p.ev_type}`);
        packetShapeOk = false;
    }
}
check('T007b Boot trace packets NIA and ev_type sequence correct', packetShapeOk);

// ── T008: CR5 slot=1 (CHANGE_CR5 payload low byte = 0x01, not 0x00) ──────────
check('T008 CR5 word0 low byte=0x01 (slot=1, not slot=0)',
    cr5w0 !== null && (cr5w0 & 0xFF) === 0x01,
    `got low byte 0x${((cr5w0||0) & 0xFF).toString(16)}`);

// ── T009: Boot completes without fault ────────────────────────────────────────
check('T009 Boot completes without fault', sim.bootComplete && !sim.halted);

// ── T010: NUC_CODE CR14 lump base (word1) set after boot ─────────────────────
const cr14w1 = sim.cr[14] ? (sim.cr[14].word1 >>> 0) : 0;
check('T010 NUC_CODE CR14 word1 (lump base) non-zero after boot', cr14w1 !== 0,
    `got 0x${cr14w1.toString(16)}`);

const cr14w2 = sim.cr[14] ? sim.cr[14].word2 : null;
check('T010b NUC_CODE CR14 word2 (limit field) accessible after boot', cr14w2 !== null);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
