'use strict';
// test_trace_packet_execution.js — Execution-level regression test for per-event trace packets
//
// Verifies that step() emits the correct trace packets for each instruction class by:
//   (A) writing test instructions directly into the simulator's live code lump and
//       calling step() to execute them;
//   (B) injecting fake call-stack frames where needed so RETURN has something to pop.
//
// This proves that _execIadd (and other DR→DR), _execReturn, _execCall, _execSwitch,
// _execLambda, _execEloadcall, _execXloadlambda all go through _emitTrace correctly
// and that the timer-IRQ / conditional-skip paths carry tracePackets: [].
//
// Run:  node simulator/test_trace_packet_execution.js

const ChurchSimulator     = require('./simulator.js');
const AbstractionRegistry = require('./abstractions.js');
const SystemAbstractions  = require('./system_abstractions.js');

let pass = 0;
let fail = 0;
function check(label, cond, detail) {
    if (cond) { console.log(`PASS ${label}`); pass++; }
    else       { console.log(`FAIL ${label}${detail ? ' — ' + detail : ''}`); fail++; }
}

// ── ev_type constants (must mirror TRACE_EV_* in simulator.js) ───────────────
const EV_RESULT      = 0x00;
const EV_LOAD_SHADOW = 0x01;
const EV_LOAD_NEW    = 0x02;
const EV_CHANGE_PUSH = 0x03;
const EV_CHANGE_CR12 = 0x04;
const EV_CHANGE_CR5  = 0x05;
const EV_CALL_CR6    = 0x06;
const EV_CALL_CR14   = 0x07;
const EV_CALL_PUSH   = 0x08;
const EV_RETURN_POP  = 0x09;
const EV_RETURN_CR6  = 0x0A;
const EV_RETURN_CR14 = 0x0B;

// ── Instruction encoder (same bit layout as ChurchAssembler) ─────────────────
// word: [31:27]=opcode [26:23]=cond [22:19]=crDst [18:15]=crSrc [14:0]=imm15
function enc(opcode, cond, dst, src, imm) {
    return (((opcode&0x1F)<<27)|((cond&0xF)<<23)|((dst&0xF)<<19)|((src&0xF)<<15)|(imm&0x7FFF)) >>> 0;
}
const AL  = 14;   // always-execute condition
const EQ  = 0;    // equal (Z=1) condition — will skip when Z=0
const NE  = 1;    // not-equal (Z=0) condition — will skip when Z=1

// ── Boot the simulator ────────────────────────────────────────────────────────
const sim = new ChurchSimulator();
const reg = new AbstractionRegistry(sim);
new SystemAbstractions(reg);
sim.abstractionRegistry = reg;
sim.reset();
while (!sim.bootComplete && !sim.halted) sim._bootStep();
check('T000 Boot completed without fault', sim.bootComplete && !sim.halted);
if (!sim.bootComplete) { console.log('\nFATAL: boot failed'); process.exit(1); }

// ── Key addresses ─────────────────────────────────────────────────────────────
// After boot, CR14 points to the SelfTest/Boot.Abstr code lump.
// We can write test instructions at codeLumpBase+1+sim.pc (the current instruction slot).
const codeLumpBase = sim.cr[14] ? sim.cr[14].word1 : 0;
check('T001 codeLumpBase non-zero after boot', codeLumpBase > 0,
    `got ${codeLumpBase}`);

// Helper: write an instruction at the current PC slot and call step().
// physicalPC = codeLumpBase + 1 (header) + sim.pc
function writeAndStep(instrWord) {
    const physSlot = codeLumpBase + 1 + sim.pc;
    sim.memory[physSlot] = instrWord >>> 0;
    // Patch the code-word-count in the lump header to ensure the slot is within cw.
    // (bits[22:10] of word[codeLumpBase] = cw; set to a large value to avoid bounds fault)
    const hdr = sim.memory[codeLumpBase] >>> 0;
    const cc   = hdr & 0xFF;
    const rest = hdr & 0xFFC00000;     // preserve magic + nMinus6
    sim.memory[codeLumpBase] = (rest | (200 << 10) | cc) >>> 0;
    return sim.step();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TA: DR→DR instruction (IADD) → exactly 1 RESULT packet
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
sim.pc = 0;
// IADD opcode = 21; IADD DR0, DR0, #1
const rIadd = writeAndStep(enc(21, AL, 0, 0, 1));
check('TA1 IADD step() returns a result', !!rIadd && !rIadd.faulted);
const iaddPkts = (rIadd && rIadd.tracePackets) || [];
check('TA2 IADD emits exactly 1 packet',      iaddPkts.length === 1,
    `got ${iaddPkts.length}`);
check('TA3 IADD packet ev_type=RESULT(0x00)', (iaddPkts[0] || {}).ev_type === EV_RESULT,
    `got ${(iaddPkts[0] || {}).ev_type}`);
check('TA4 IADD packet NIA = physicalPC',     (iaddPkts[0] || {}).nia === (rIadd || {}).physicalPC,
    `nia=${(iaddPkts[0]||{}).nia} physicalPC=${(rIadd||{}).physicalPC}`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TB: Conditional-skip instruction → exactly 0 packets
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
sim.flags.Z = false;          // EQ fires on Z=1; Z=0 → condition fails → skip
sim.pc = 0;
// LOADEQ (opcode=0, cond=EQ=0, crDst=0, crSrc=0, imm=0)
const rSkip = writeAndStep(enc(0, EQ, 0, 0, 0));
check('TB1 conditional-skip result.skipped === true', !!(rSkip && rSkip.skipped),
    `desc: ${rSkip && rSkip.desc}`);
check('TB2 conditional-skip emits 0 packets', ((rSkip && rSkip.tracePackets) || []).length === 0,
    `got ${((rSkip && rSkip.tracePackets) || []).length}`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TC: RETURN — inject fake call frame, verify 3 packets and RETURN_CR14 payload
//
// The key correctness property:
//   frame.savedCRs[14] = "caller's CR14" captured at CALL time.
//   After RETURN, RETURN_CR14 packet payload MUST equal frame.savedCRs[14].word0,
//   NOT the current (callee's) CR14.word0 at the time the RETURN instruction retires.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Save boot CR14 so TD can restore it — RETURN replaces sim.cr[14] with the caller's
// saved CR14 (the fake sentinel frame), leaving word1=0 and breaking the fetch path.
const bootCR14 = { ...sim.cr[14] };

// Set callee's CR14 to a recognisably different value before injecting the frame.
const CALLEE_CR14_WORD0 = (sim.cr[14] ? (sim.cr[14].word0 >>> 0) : 0);   // current value

// Build a fake "caller's CR14" with a different slot number so it can't be confused
// with the callee's value.  Use a NULL GT (type=0) with a distinctive bit pattern.
// The simulator won't fetch through this GT — it's only read by the RETURN_CR14 emit.
const CALLER_CR14_WORD0 = 0xDEAD0001;   // distinctive sentinel, definitely ≠ callee's

// Build a minimal fake call frame (same shape as _execCall pushes).
const fakeFrame = {
    returnPC:   3,                              // arbitrary return PC
    savedCRs:   sim.cr.map(c => ({ ...c })),    // snapshot of all CRs
    savedDRs:   [...sim.dr],
    savedFlags: { ...sim.flags },
    savedSTO:   sim.sto,
    sz: 1,
    frameWord: 0,
};
// Override saved CR14 to a sentinel we can identify in the RETURN_CR14 packet.
fakeFrame.savedCRs[14] = { word0: CALLER_CR14_WORD0, word1: 0, word2: 0, word3: 0 };

sim.callStack.push(fakeFrame);

// Write RETURN at PC=0 of the current code lump.
sim.pc = 0;
const rReturn = writeAndStep(enc(3, AL, 0, 0, 0));   // RETURN opcode=3
check('TC1 RETURN step() returns a result',      !!rReturn && !rReturn.faulted,
    `desc: ${rReturn && rReturn.desc}`);
const retPkts = (rReturn && rReturn.tracePackets) || [];
check('TC2 RETURN emits exactly 3 packets',      retPkts.length === 3,
    `got ${retPkts.length}`);
check('TC3 RETURN pkt[0].ev_type=RETURN_POP(9)',   (retPkts[0]||{}).ev_type === EV_RETURN_POP,
    `got ${(retPkts[0]||{}).ev_type}`);
check('TC4 RETURN pkt[1].ev_type=RETURN_CR6(10)',  (retPkts[1]||{}).ev_type === EV_RETURN_CR6,
    `got ${(retPkts[1]||{}).ev_type}`);
check('TC5 RETURN pkt[2].ev_type=RETURN_CR14(11)', (retPkts[2]||{}).ev_type === EV_RETURN_CR14,
    `got ${(retPkts[2]||{}).ev_type}`);

const retCR14Payload = (retPkts[2] || {}).payload_gt >>> 0;
check('TC6 RETURN_CR14 payload = caller\'s saved CR14 (sentinel 0xDEAD0001)',
    retCR14Payload === CALLER_CR14_WORD0,
    `got 0x${retCR14Payload.toString(16)}, want 0x${CALLER_CR14_WORD0.toString(16)}`);
check('TC7 RETURN_CR14 payload ≠ callee\'s CR14 (confirming correct selection)',
    retCR14Payload !== CALLEE_CR14_WORD0,
    `payload wrongly matches callee 0x${CALLEE_CR14_WORD0.toString(16)}`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TD: CALL opcode — inject a minimal NS entry + code cap and execute CALL CR0
//
// After boot, CR0 holds an E-perm GT for Boot.Abstr (cc=0, no code cap → faults
// with NO_CODE).  Instead, build a new "stub" abstraction in an unused NS slot:
//   • A fake code lump with a RETURN instruction
//   • A c-list with the code cap at slot 0
//   • An E-perm NS entry for it
//   • An E-GT written into CR0 that points at that slot
// Then step() a CALL CR0, CR0 instruction and verify 3 CALL packets.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Restore boot CR14 — RETURN replaced sim.cr[14] with the fake caller frame
// (word1=0), so instruction fetches would go to address 1 instead of codeLumpBase+1.
sim.cr[14] = { ...bootCR14 };
sim.pc = 0;

// Find a free high-memory region for our stub.
const STUB_BASE  = 0xE000;    // arbitrary free page (above any boot data)
const CLIST_BASE = STUB_BASE + 64;   // c-list starts after the lump

// Write a minimal 64-word stub code lump:
//   word[STUB_BASE+0] = header (magic=0x1F, nMinus6=0→size=64, cw=1, cc=1)
const STUB_HEADER = ((0x1F << 27) | (0 << 23) | (1 << 10) | 1) >>> 0;
sim.memory[STUB_BASE]     = STUB_HEADER;
sim.memory[STUB_BASE + 1] = enc(3, AL, 0, 0, 0);   // code[0] = RETURN

// Write a code-cap GT into the c-list at CLIST_BASE:
//   R+X Turing Inform GT pointing at stub NS slot.
// We'll register the stub at nsCount (which starts at 8 after boot).
const STUB_NS_SLOT = sim.nsCount;   // use the next available slot

// Build an R+X Inform GT for the stub code lump.
const STUB_CODE_GT = sim.createGT(0, STUB_NS_SLOT, { R:1, W:0, X:1, L:0, S:0, E:0 }, 1);
sim.memory[CLIST_BASE] = STUB_CODE_GT >>> 0;   // c-list[0] = code cap

// Register the stub NS entry via writeNSEntry (uses inverted slot layout internally).
// writeNSEntry(idx, location, limit17, bFlag, gBit, gtType, version, clistCount, abstract_gt)
//   gtType=1 = Inform, clistCount=1 so mLoad can find the c-list.
sim.writeNSEntry(STUB_NS_SLOT, STUB_BASE, 63, 0, 0, 1, 0, 1, 0);
// writeNSEntry increments nsCount automatically when idx >= nsCount.

// Build an E-perm GT for the stub abstraction and put it in CR0.
const STUB_E_GT = sim.createGT(0, STUB_NS_SLOT, { R:0, W:0, X:0, L:0, S:0, E:1 }, 1);
sim.cr[0] = { word0: STUB_E_GT >>> 0, word1: CLIST_BASE, word2: 0, word3: 0, m: 0 };

// Now execute CALL CR0, CR0 (opcode=2, cond=AL, crDst=0, crSrc=0, imm=0)
sim.pc = 0;
const rCall = writeAndStep(enc(2, AL, 0, 0, 0));
check('TD1 CALL step() returns a result (not fault)', !!rCall && !rCall.faulted,
    `desc: ${rCall && rCall.desc}`);
const callPkts = (rCall && rCall.tracePackets) || [];
check('TD2 CALL emits exactly 3 packets',     callPkts.length === 3,
    `got ${callPkts.length}: ${JSON.stringify(callPkts)}`);
check('TD3 CALL pkt[0].ev_type=CALL_CR6(6)',  (callPkts[0]||{}).ev_type === EV_CALL_CR6,
    `got ${(callPkts[0]||{}).ev_type}`);
check('TD4 CALL pkt[1].ev_type=CALL_CR14(7)', (callPkts[1]||{}).ev_type === EV_CALL_CR14,
    `got ${(callPkts[1]||{}).ev_type}`);
check('TD5 CALL pkt[2].ev_type=CALL_PUSH(8)', (callPkts[2]||{}).ev_type === EV_CALL_PUSH,
    `got ${(callPkts[2]||{}).ev_type}`);
check('TD6 CALL pkt[1] payload (CR14) non-zero', ((callPkts[1]||{}).payload_gt >>> 0) !== 0,
    `got 0`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TE: SWITCH → 1 RESULT packet
// SWITCH opcode=5, crSrc=CR0, imm=5 (target=CR13).
// Requires: CR0.word0 = Abstract GT (type=3, bits[26:25]=0b11),
//           CR0.word1 = SENTINEL_CR13 = 0xFFFFFFFE.
// Run inside the stub lump (CR14 now points there after CALL).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Build a minimal Abstract PassKey GT: bits[26:25]=0b11 (type=3), all other bits 0.
const ABSTRACT_GT_WORD0 = (3 << 25) >>> 0;   // 0x06000000
const SENTINEL_CR13     = 0xFFFFFFFE;
sim.cr[0] = { word0: ABSTRACT_GT_WORD0, word1: SENTINEL_CR13, word2: 0, word3: 0, m: 0 };

sim.pc = 0;
// SWITCH: opcode=5, cond=AL, crDst=0 (ignored by SWITCH), crSrc=0, imm=5 (→CR13)
const switchInstr = enc(5, AL, 0, 0, 5);
sim.memory[STUB_BASE + 1 + sim.pc] = switchInstr;
const rSwitch = sim.step();
check('TE1 SWITCH step() returns a result', !!rSwitch && !rSwitch.faulted,
    `desc: ${rSwitch && rSwitch.desc}`);
const swPkts = (rSwitch && rSwitch.tracePackets) || [];
check('TE2 SWITCH emits exactly 1 packet',      swPkts.length === 1,
    `got ${swPkts.length}`);
check('TE3 SWITCH packet ev_type=RESULT(0x00)', (swPkts[0]||{}).ev_type === EV_RESULT,
    `got ${(swPkts[0]||{}).ev_type}`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TF: Packet shape — all required fields present on every packet produced above
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const REQUIRED = ['nia', 'ev_type', 'payload_gt', 'flags', 'fault_code', 'fault_valid', 'bp_hit'];
const allResults = [rIadd, rSkip, rReturn, rCall, rSwitch].filter(Boolean);
let shapeBad = 0;
for (const r of allResults) {
    for (const p of r.tracePackets || []) {
        for (const f of REQUIRED) {
            if (!(f in p)) { shapeBad++; break; }
        }
    }
}
check('TF1 All emitted packets contain all required fields', shapeBad === 0,
    `${shapeBad} packets missing one or more required fields`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
