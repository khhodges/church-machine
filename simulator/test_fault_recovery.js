'use strict';
// test_fault_recovery.js — Unit tests for Task #1077 three-tier fault recovery
// Run:  node simulator/test_fault_recovery.js
//
// Coverage:
//   T001 — Tier 1: .catch method invoked when present on the faulting abstraction
//   T002 — Tier 2: .catch absent, Scheduler.IRQ dispatched with registered handler
//   T003 — Tier 3: double-fault (fault while irqActive=true) calls _returnToBoot
//   T004 — pause timer fire: Scheduler.pause arms timer; step to deadline fires IRQ
//   T005 — Wait flag-set wake: pendingWakeFlags signals sleeping thread via IRQ sweep
//   T006 — Structured fault record: all new fields populated on an unhandled fault
//   T008 — Scheduler.pause method-table index 4: assembled ELOADCALL encodes index 4,
//           dispatch chain resolves to pause handler, thread transitions to sleeping
//   T010 — Continuous step() loop: timer fires naturally via natural stepCount
//           increments (UI "Run" simulation) without manual stepCount assignment
//   T011 — Multi-thread pause: Thread 0 sleeps via Scheduler.pause while Thread 1
//           continues running; timer fires and wakes Thread 0; Thread 1 never sleeps

const ChurchSimulator   = require('./simulator.js');
const AbstractionRegistry = require('./abstractions.js');
const SystemAbstractions  = require('./system_abstractions.js');
const ChurchAssembler     = require('./assembler.js');

let pass = 0;
let fail = 0;

function check(label, cond) {
    if (cond) {
        console.log(`PASS ${label}`);
        pass++;
    } else {
        console.log(`FAIL ${label}`);
        fail++;
    }
}

// Build a minimal simulator wired to a fresh registry + system abstractions.
function makeTestSim() {
    const sim = new ChurchSimulator();
    const registry = new AbstractionRegistry();
    // SystemAbstractions binds all methods (including Scheduler.pause and Scheduler.IRQ)
    const sysAbs = new SystemAbstractions(registry);
    sim.abstractionRegistry = registry;
    sim.bootComplete = true;
    return { sim, registry, sysAbs };
}

// ── T001: Tier 1 — .catch method invoked when present ─────────────────────────
console.log('\n--- T001: Tier 1 (.catch) ---');
{
    const { sim, registry } = makeTestSim();
    // Point CR14 at NS slot 10 (DijkstraFlag) as the "currently executing lump"
    if (!sim.cr) sim.cr = new Array(16).fill(null);
    sim.cr[14] = { word0: 10, word1: 0, word2: 0, word3: 0 };

    // Bind a .catch handler on slot 10 that signals recovery
    let catchCalled = false;
    registry.bindMethod(10, '.catch', (s, args) => {
        catchCalled = true;
        return { handled: true };
    });

    const pcBefore = sim.pc;
    sim.fault('PERM_R', 'Test Tier 1 catch');

    check('T001a: machine NOT halted after Tier 1 catch', !sim.halted);
    check('T001b: faultLog has exactly one entry', sim.faultLog.length === 1);
    check('T001c: fault entry tier === 1', sim.faultLog[0].tier === 1);
    check('T001d: fault entry catchInvoked === true', sim.faultLog[0].catchInvoked === true);
    check('T001e: .catch function was actually called', catchCalled === true);
    check('T001f: faultCode matches PERM_R', sim.faultLog[0].faultCode === ChurchSimulator.FAULT_CODES.PERM_R);
    check('T001g: faultingAbstractionSlot === 10', sim.faultLog[0].faultingAbstractionSlot === 10);
    check('T001h: PC advanced past faulting instruction', sim.pc === pcBefore + 1);
    check('T001i: irqActive is false (not entered IRQ frame)', !sim.irqState.irqActive);
}

// ── T002: Tier 2 — .catch absent, Scheduler.IRQ succeeds ──────────────────────
console.log('\n--- T002: Tier 2 (Scheduler.IRQ) ---');
{
    const { sim, registry, sysAbs } = makeTestSim();
    // CR14 points at NS slot 10 but no .catch bound → Tier 1 skipped
    if (!sim.cr) sim.cr = new Array(16).fill(null);
    sim.cr[14] = { word0: 10, word1: 0, word2: 0, word3: 0 };

    // Register a fault recovery handler so Tier 2 can succeed
    let handlerCalled = false;
    sysAbs._schedulerState.faultRecoveryHandler = (faultRecord) => {
        handlerCalled = true;
        return true;
    };

    const pcBefore = sim.pc;
    sim.fault('PERM_W', 'Test Tier 2 IRQ escalation');

    check('T002a: machine NOT halted after Tier 2 recovery', !sim.halted);
    check('T002b: faultLog has exactly one entry', sim.faultLog.length === 1);
    check('T002c: fault entry tier === 2', sim.faultLog[0].tier === 2);
    check('T002d: fault entry irqInvoked === true', sim.faultLog[0].irqInvoked === true);
    check('T002e: fault entry catchInvoked === false (Tier 1 was skipped)', !sim.faultLog[0].catchInvoked);
    check('T002f: faultRecoveryHandler was called', handlerCalled === true);
    check('T002g: irqActive reset to false after Tier 2', !sim.irqState.irqActive);
    check('T002h: PC advanced past faulting instruction', sim.pc === pcBefore + 1);
}

// ── T003: Tier 3 — double-fault while irqActive=true ─────────────────────────
console.log('\n--- T003: Tier 3 (double-fault) ---');
{
    const { sim } = makeTestSim();
    // Simulate: fault fires while Scheduler.IRQ is already executing
    sim.irqState.irqActive = true;

    // Spy on _returnToBoot so we can verify it's called without running the full boot
    let tier3Called = false;
    const origReturn = sim._returnToBoot ? sim._returnToBoot.bind(sim) : null;
    sim._returnToBoot = () => {
        tier3Called = true;
        if (origReturn) origReturn();
    };

    sim.fault('NULL_CAP', 'Test Tier 3 double-fault');

    check('T003a: faultLog has exactly one entry', sim.faultLog.length === 1);
    check('T003b: fault entry tier === 3', sim.faultLog[0].tier === 3);
    check('T003c: fault entry tier3Recovery === true', sim.faultLog[0].tier3Recovery === true);
    check('T003d: _returnToBoot was called', tier3Called === true);
    check('T003e: irqActive cleared after Tier 3 recovery', !sim.irqState.irqActive);
    check('T003f: machine is NOT permanently halted (Tier 3 resets to boot)', !sim.halted);
}

// ── T004: pause timer fire ────────────────────────────────────────────────────
console.log('\n--- T004: Scheduler.pause timer fire ---');
{
    const { sim, registry, sysAbs } = makeTestSim();
    const DURATION = 5;
    const stepAtCall = sim.stepCount;

    // Invoke Scheduler.pause(duration=5) via the registry
    const pauseResult = registry.dispatchMethod(8, 'pause', sim, { duration: DURATION });

    check('T004a: Scheduler.pause — ok=true', pauseResult && pauseResult.ok === true);
    check('T004b: Scheduler.pause — irqState.timerArmed=true', sim.irqState.timerArmed === true);
    check('T004c: Scheduler.pause — timerDeadline = stepAtCall + DURATION',
        sim.irqState.timerDeadline === stepAtCall + DURATION);
    check('T004d: Scheduler.pause — timerRegs[4] = 1 (CTL armed)', sim.timerRegs[4] === 1);
    check('T004e: Scheduler.pause — timerRegs[3] = deadline (ALARM_CMP)',
        sim.timerRegs[3] === stepAtCall + DURATION);

    // Advance stepCount to the deadline so the timer fires
    sim.stepCount = sim.irqState.timerDeadline;

    // _fireSchedulerIRQ('TIMER') should now succeed and clear the alarm
    const swept = sysAbs._schedulerState._irqSweepCount;
    const fired = sim._fireSchedulerIRQ('TIMER', null);

    check('T004f: _fireSchedulerIRQ(TIMER) returned true', fired === true);
    check('T004g: timerArmed cleared to false after IRQ fires', !sim.irqState.timerArmed);
    check('T004h: irqSweepCount incremented', sysAbs._schedulerState._irqSweepCount === swept + 1);
    check('T004i: irqActive is false after TIMER IRQ completes', !sim.irqState.irqActive);
}

// ── T005: Wait(flag) + signal + IRQ sweep wake ────────────────────────────────
// Uses the production Scheduler.Wait() path to suspend a thread on a flag,
// then signals the flag via pendingWakeFlags and fires Scheduler.IRQ to sweep.
console.log('\n--- T005: Scheduler.Wait(flag) / signal / wake ---');
{
    const { sim, registry, sysAbs } = makeTestSim();

    // Add a second thread that will call Wait('startFlag')
    sysAbs._schedulerState.threads.push({ id: 1, state: 'running', name: 'waiter' });
    sysAbs._schedulerState.currentThread = 1;

    // Call Scheduler.Wait('startFlag') via the production registry binding
    const waitResult = registry.dispatchMethod(8, 'Wait', sim, { flag: 'startFlag' });

    check('T005a: Scheduler.Wait — ok=true', waitResult && waitResult.ok === true);
    const waiterBefore = sysAbs._schedulerState.threads.find(t => t.id === 1);
    check('T005b: Scheduler.Wait — thread state = sleeping', waiterBefore && waiterBefore.state === 'sleeping');
    check('T005c: Scheduler.Wait — thread.waitFlag = startFlag', waiterBefore && waiterBefore.waitFlag === 'startFlag');
    check('T005d: Scheduler.Wait — irqState.waitingOnFlags[1] = startFlag',
        sim.irqState.waitingOnFlags['1'] === 'startFlag');

    // An external event signals 'startFlag': enqueue it in pendingWakeFlags
    sim.irqState.pendingWakeFlags = ['startFlag'];

    // Fire Scheduler.IRQ with reason=TIMER — sweep should wake the waiting thread
    const irqResult = registry.dispatchMethod(8, 'IRQ', sim, {
        reason: 'TIMER', faultRecord: null, savedContext: null
    });

    check('T005e: IRQ dispatch ok=true', irqResult && irqResult.ok === true);
    const waiterAfter = sysAbs._schedulerState.threads.find(t => t.id === 1);
    check('T005f: thread woken to ready after flag signal', waiterAfter && waiterAfter.state === 'ready');
    check('T005g: waitFlag cleared from thread', waiterAfter && !waiterAfter.waitFlag);
    check('T005h: irqState.waitingOnFlags[1] cleared after wake', !sim.irqState.waitingOnFlags['1']);
    check('T005i: pendingWakeFlags cleared (startFlag consumed)',
        !(sim.irqState.pendingWakeFlags || []).includes('startFlag'));
    check('T005j: irqSweepCount incremented', sysAbs._schedulerState._irqSweepCount >= 1);
}

// ── T006: Structured fault record fields (baseline — unhandled fault) ─────────
console.log('\n--- T006: Structured fault record (unhandled) ---');
{
    const { sim } = makeTestSim();
    sim.fault('BOUNDS', 'Test structured record fields (no recovery)');

    const entry = sim.faultLog[0];
    check('T006a: faultLog has one entry', sim.faultLog.length === 1);
    check('T006b: faultCode = BOUNDS code', entry.faultCode === ChurchSimulator.FAULT_CODES.BOUNDS);
    check('T006c: tier is null (all tiers failed — halt)', entry.tier === null);
    check('T006d: catchInvoked=false', entry.catchInvoked === false);
    check('T006e: irqInvoked=true (Scheduler.IRQ always dispatched before halt)', entry.irqInvoked === true);
    check('T006f: tier3Recovery=false', entry.tier3Recovery === false);
    check('T006g: machine halted', sim.halted === true);
    check('T006h: ChurchSimulator.SCHEDULER_NS_SLOT === 8',
        ChurchSimulator.SCHEDULER_NS_SLOT === 8);
    check('T006i: ChurchSimulator.SCHEDULER_IRQ_NS_SLOT === 50',
        ChurchSimulator.SCHEDULER_IRQ_NS_SLOT === 50);
    check('T006j: FAULT_CODES object has PERM_R key',
        ChurchSimulator.FAULT_CODES.PERM_R === 0x01);
    check('T006k: FAULT_CODES object has NULL_CAP key',
        ChurchSimulator.FAULT_CODES.NULL_CAP === 0x07);
}

// ── T007: .catch throws — catchInvoked=true, escalation continues ────────────
// Verifies that catchInvoked is true even when the .catch handler throws,
// and that the fault escalates to Tier 2/halt rather than being silently dropped.
console.log('\n--- T007: .catch throws → catchInvoked=true, escalation ---');
{
    const { sim, registry } = makeTestSim();

    // Bind a .catch method on NS slot 10 that throws
    registry.abstractions[10] = registry.abstractions[10] || { dispatch: {} };
    registry.abstractions[10].dispatch['.CATCH'] = function(_sim, _args) {
        throw new Error('deliberate .catch failure for T007');
    };

    // Simulate CR14 pointing to NS slot 10 so fault() resolves faultingAbstractionSlot=10
    sim.cr[14] = { word0: 10 };
    // No faultRecoveryHandler → Tier 2 also fails → halt
    sim.fault('PERM_R', 'T007 test — .catch throws');

    const entry = sim.faultLog[0];
    check('T007a: faultLog has one entry', sim.faultLog.length === 1);
    check('T007b: catchInvoked=true (handler was called even though it threw)',
        entry.catchInvoked === true);
    check('T007c: irqInvoked=true (escalated to Scheduler.IRQ after .catch threw)',
        entry.irqInvoked === true);
    check('T007d: tier is null (all tiers exhausted — halt)', entry.tier === null);
    check('T007e: machine halted', sim.halted === true);
    check('T007f: output mentions .catch threw', sim.output.includes('threw'));
}

// ── T008: Scheduler.pause — assembled ELOADCALL + runtime dispatch integration ─
//
// Verifies the full chain:
//   1. ChurchAssembler encodes Scheduler.pause() as ELOADCALL with method index 5
//      (1-based) → 0-based index 4, matching the methods array in abstractions.js.
//   2. The simulator's ELOADCALL dispatch path (methods[ecMethodIdx-1] → dispatchMethod)
//      resolves to the 'pause' handler and returns ok=true (no fault/halt).
//   3. The calling thread transitions to 'sleeping' with wakeStep set — the concrete
//      scheduler state change that signals a correct pause rather than a fault.
//
// Assembler conventions used here mirror SCHED_CONVENTIONS_BC from assembler_test.js
// (BC84–BC88 / BC90–BC94).  Encoding: pause index=4 → 1-based=5; slot=8; imm=0x0508.
console.log('\n--- T008: Scheduler.pause assembled ELOADCALL + runtime dispatch ---');
{
    const { sim, registry, sysAbs } = makeTestSim();

    // ── T008a/b: method-table shape (prerequisite) ──────────────────────────
    const sched = registry.abstractions[8];
    check('T008a: NS slot 8 is the Scheduler abstraction', sched && sched.name === 'Scheduler');
    check('T008b: Scheduler.methods[4] === "pause" (0-based index 4)',
        sched && sched.methods[4] === 'pause');

    // ── T008c-e: assemble Scheduler.pause() and verify ELOADCALL encoding ──
    // Use the same convention table the application assembler uses for Scheduler
    // bare-calls (mirrors SCHED_CONVENTIONS_BC from assembler_test.js BC84-BC88).
    const SCHED_CONV = {
        'Scheduler': {
            'Yield': { index: 0, input: '',              output: 'DR1' },
            'Spawn': { index: 1, input: 'CR2=code_GT',  output: 'DR1=threadID' },
            'Wait':  { index: 2, input: 'CR2=flag_GT',  output: 'DR1' },
            'Stop':  { index: 3, input: 'DR1=threadID', output: 'DR1' },
            'pause': { index: 4, input: 'DR1=ticks',    output: 'DR1' },
        }
    };
    const SCHED_NS = { 'Scheduler': 8 };

    const asm = new ChurchAssembler(SCHED_CONV);
    asm.setNamespace(SCHED_NS);
    const asmResult = asm.assemble('Scheduler.pause()\nHALT');

    check('T008c: Scheduler.pause() assembles without errors',
        asmResult.errors.length === 0,
        (asmResult.errors[0] || {}).message);

    // Decode the ELOADCALL word — same bit-field extraction the simulator uses:
    //   imm = word & 0x7FFF
    //   ecRow      = imm & 0xFF          → Scheduler NS slot (8)
    //   ecMethodIdx = (imm >>> 8) & 0x7F → 1-based method index (5 for pause)
    const eloadWord = (asmResult.words[0] || 0) >>> 0;
    const encodedImm     = eloadWord & 0x7FFF;
    const encodedRow     = encodedImm & 0xFF;
    const encodedMethod1 = (encodedImm >>> 8) & 0x7F;   // 1-based
    const encodedMethod0 = encodedMethod1 - 1;           // 0-based index into methods[]

    check('T008d: assembled ELOADCALL encodes Scheduler NS slot (row=8)',
        encodedRow === 8);
    check('T008e: assembled ELOADCALL encodes method 5 (1-based) for pause (0-based index 4)',
        encodedMethod1 === 5 && encodedMethod0 === 4);

    // ── T008f-g: simulator ELOADCALL dispatch chain resolves to 'pause' ────
    // The simulator does exactly:
    //   methodName = abstraction.methods[ecMethodIdx]   (0-based, extracted above)
    //   result     = dispatchMethod(nsSlot, methodName, sim, args)
    // Replicate this chain to confirm the link is not broken.
    const resolvedName = sched ? sched.methods[encodedMethod0] : undefined;
    check('T008f: methods[encodedMethod0] resolves to "pause"', resolvedName === 'pause');

    const DURATION = 10;
    const stepAtCall = sim.stepCount;
    const result = registry.dispatchMethod(8, resolvedName, sim, { duration: DURATION });

    check('T008g: dispatch via assembled index returns ok=true (no fault)',
        result && result.ok === true);

    // ── T008h-j: concrete scheduler state — thread is sleeping, not faulted ─
    const bootThread = sysAbs._schedulerState.threads[sysAbs._schedulerState.currentThread];
    check('T008h: calling thread state === "sleeping" (not "running" or faulted)',
        bootThread && bootThread.state === 'sleeping');
    check('T008i: wakeStep is set to stepAtCall + DURATION',
        bootThread && bootThread.wakeStep === stepAtCall + DURATION);
    check('T008j: machine did NOT halt (pause is not a fault)',
        !sim.halted);
}

// ── T008-step: Scheduler.pause via sim.step() — CALL CR0 with DR3=4 ─────────
//
// A full simulator-step integration: places a CALL instruction in memory,
// runs sim.step(), and verifies the thread enters the sleeping state.
//
// The CALL instruction uses legacy mode (imm=0) which reads DR3 as the 0-based
// method index (DR3=4 → methods[4]='pause').  Pre-boot fetch mode is used so
// memory[pc] is read directly without CR14 lump, keeping the setup minimal
// while still exercising the real _execCall → _dispatchAbstraction →
// dispatchMethod path that fires for system abstractions in production.
//
// Encoding:  opcode=2(CALL) | cond=14(AL) | crDst=0 | crSrc=0 | imm=0
//            = 0x17000000
console.log('\n--- T008-step: sim.step() executes Scheduler.pause (method index 4) ---');
{
    const { sim: stepSim, sysAbs: stepSysAbs } = makeTestSim();

    // Use pre-boot fetch (bootComplete=false) so the simulator reads instructions
    // directly from memory[pc] without requiring a CR14 code lump.  This keeps
    // the test self-contained while still exercising the full _execCall path.
    stepSim.bootComplete = false;

    // Write a valid NS entry for Scheduler at slot 8 so mLoad can pass.
    // location=0 (no code lump) causes lumpIsResident=false → system-abstraction
    // fast path fires; limit17=1, gtType=1(Inform) gives a valid non-null entry.
    stepSim.writeNSEntry(8, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0);

    // Create an E-permission Inform GT for NS slot 8 (Scheduler).
    const schedGT = stepSim.createGT(0, 8, {E:1}, 1);

    // CR0 holds the Scheduler GT (crDst=0 in CALL instruction).
    stepSim.cr[0] = {word0: schedGT, word1: 0, word2: 0, word3: 0, m: 0};

    // Legacy CALL mode reads DR3 as the 0-based method index.
    // DR3=4 maps to methods[4]='pause'.  DR1=20 is the duration argument.
    const STEP_DURATION = 20;
    stepSim.dr[3] = 4;             // method index 4 → pause
    stepSim.dr[1] = STEP_DURATION; // pause duration in simulation steps

    // CALL CR0 (opcode=2, cond=AL=14, crDst=0, crSrc=0, imm=0 = legacy mode).
    // Equivalent assembly: CALL CR0   (with DR3 pre-set to method index)
    const CALL_CR0_LEGACY = ((2 << 27) | (14 << 23) | (0 << 19) | (0 << 15) | 0) >>> 0;
    stepSim.memory[0] = CALL_CR0_LEGACY; // placed at PC=0

    const stepResult = stepSim.step();

    // T008-step-a: step() must not return null (instruction executed)
    check('T008-step-a: step() executed the CALL instruction (non-null result)',
        stepResult !== null);

    // T008-step-b: the dispatch description confirms 'Scheduler.pause' was called
    check('T008-step-b: step() desc confirms Scheduler.pause was dispatched',
        stepResult && stepResult.desc &&
        stepResult.desc.includes('Scheduler') &&
        stepResult.desc.includes('pause'));

    // T008-step-c: no faults triggered — pause is not an error path
    check('T008-step-c: no faults logged after CALL (pause is not a fault)',
        stepSim.faultLog.length === 0);

    // T008-step-d: machine did not halt
    check('T008-step-d: machine NOT halted after Scheduler.pause step()',
        !stepSim.halted);

    // T008-step-e: thread state changed to sleeping (concrete scheduler transition)
    const stepThread = stepSysAbs._schedulerState.threads[0];
    check('T008-step-e: thread[0].state === "sleeping" after step()',
        stepThread && stepThread.state === 'sleeping');

    // T008-step-f: wakeStep is set (timer deadline registered on the thread)
    check('T008-step-f: thread[0].wakeStep is set (timer deadline > 0)',
        stepThread && typeof stepThread.wakeStep === 'number' && stepThread.wakeStep > 0);
}

// ── T009: Full step()-level integration: assembler + loadProgram + timer fire ─
//
// Verifies the complete mid-execution pause flow as an end-to-end integration:
//
//   Phase A — Assembler encoding (prerequisite):
//     The ChurchAssembler is used to encode Scheduler.pause() as an ELOADCALL
//     instruction.  The encoded method index (0-based = 4, 1-based = 5) is
//     extracted from the instruction word and used as the DR3 value for the
//     subsequent CALL step, establishing a provable link between the assembler
//     output and the runtime behaviour.
//
//   Phase B — loadProgram + step() → thread sleeps:
//     A two-word program [CALL CR0 (legacy mode), HALT] is written into a fresh
//     simulator via loadProgram() (pre-boot path: writes to memory[startAddr]).
//     step() is called once; the CALL instruction is decoded and dispatched
//     through _execCall → _dispatchAbstraction → Scheduler.pause.  The calling
//     thread transitions to 'sleeping' and irqState.timerArmed is set.
//
//   Phase C — bootComplete + stepCount advance → step() fires timer IRQ:
//     Setting bootComplete=true enables the hardware alarm check at the top of
//     step() (the check is deliberately masked during pre-boot execution).
//     stepCount is advanced to the timer deadline; the next step() call detects
//     the expired alarm BEFORE fetching any instruction, injects a hidden
//     Scheduler.IRQ, wakes the sleeping thread (state → 'ready'), and returns
//     a timerResult sentinel without further execution.
//
// This test uniquely exercises the step() timer-injection path (Phase C) and
// the loadProgram integration (Phase B), neither of which is covered by the
// earlier registry-dispatch tests (T004) or the direct-memory CALL test (T008-step).
console.log('\n--- T009: loadProgram + step() pause + step() timer wake ---');
{
    const { sim: t9sim, registry: t9reg, sysAbs: t9sys } = makeTestSim();

    // ── Phase A: assembler produces ELOADCALL for Scheduler.pause() ──────────
    // The same convention table used in T008 (mirrors SCHED_CONVENTIONS_BC).
    const T9_CONV = {
        'Scheduler': {
            'Yield': { index: 0, input: '',              output: 'DR1' },
            'Spawn': { index: 1, input: 'CR2=code_GT',  output: 'DR1=threadID' },
            'Wait':  { index: 2, input: 'CR2=flag_GT',  output: 'DR1' },
            'Stop':  { index: 3, input: 'DR1=threadID', output: 'DR1' },
            'pause': { index: 4, input: 'DR1=ticks',    output: 'DR1' },
        }
    };
    const T9_NS = { 'Scheduler': 8 };
    const t9asm = new ChurchAssembler(T9_CONV);
    t9asm.setNamespace(T9_NS);
    const t9asmResult = t9asm.assemble('Scheduler.pause()\nHALT');

    check('T009-A1: assembler produces no errors for Scheduler.pause()',
        t9asmResult.errors.length === 0);

    // Extract the 0-based method index from the ELOADCALL encoding:
    //   imm15[7:0]  = c-list row = NS slot (8 for Scheduler)
    //   imm15[14:8] = method index 1-based (5 for pause → 0-based = 4)
    const t9eloadWord = (t9asmResult.words[0] || 0) >>> 0;
    const t9Imm       = t9eloadWord & 0x7FFF;
    const t9Method1   = (t9Imm >>> 8) & 0x7F;   // 1-based
    const t9Method0   = t9Method1 - 1;            // 0-based index into methods[]

    check('T009-A2: ELOADCALL encodes Scheduler NS slot 8 in imm[7:0]',
        (t9Imm & 0xFF) === 8);
    check('T009-A3: ELOADCALL encodes method index 5 (1-based) for pause',
        t9Method1 === 5 && t9Method0 === 4);

    // ── Phase B: loadProgram writes runnable code + step() pauses thread ─────
    // Use pre-boot fetch mode (bootComplete=false) so step() reads instructions
    // directly from memory[pc] without requiring a CR14 code capability.
    // This keeps the setup minimal while still exercising the real
    // _execCall → _dispatchAbstraction → dispatchMethod chain.
    t9sim.bootComplete = false;

    // Write a valid NS entry for Scheduler at slot 8.
    // location=0, gtType=1 (Inform) → lumpIsResident=false triggers the
    // system-abstraction fast path in _execCall rather than code execution.
    t9sim.writeNSEntry(8, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0);

    // Create an E-permission Inform GT for NS slot 8 (Scheduler) and put it in CR0.
    const t9schedGT = t9sim.createGT(0, 8, { E: 1 }, 1);
    t9sim.cr[0] = { word0: t9schedGT, word1: 0, word2: 0, word3: 0, m: 0 };

    // Pre-load DR3 with the 0-based method index derived from the ELOADCALL word.
    // Legacy CALL mode (imm=0) reads DR3 as the method selector: DR3=4 → pause.
    const T9_DURATION = 15;
    t9sim.dr[3] = t9Method0;      // method index proven by assembler encoding
    t9sim.dr[1] = T9_DURATION;    // pause duration in simulation steps

    // Encode: CALL CR0 (opcode=2, cond=AL=14, crDst=0, crSrc=0, imm=0 = legacy).
    const T9_CALL_CR0 = ((2 << 27) | (14 << 23) | (0 << 19) | (0 << 15) | 0) >>> 0;

    // Load a two-word program [CALL CR0, HALT] via loadProgram (pre-boot path).
    // loadProgram with bootComplete=false writes words to memory[startAddr + i].
    t9sim.loadProgram([T9_CALL_CR0, 0x00000000 /*HALT*/], 0);

    // Execute the CALL instruction via step().
    const t9stepResult1 = t9sim.step();

    check('T009-B1: step() executed the CALL instruction (non-null result)',
        t9stepResult1 !== null);
    check('T009-B2: step() desc confirms Scheduler.pause was dispatched',
        t9stepResult1 && t9stepResult1.desc &&
        t9stepResult1.desc.includes('Scheduler') &&
        t9stepResult1.desc.includes('pause'));
    check('T009-B3: no faults after CALL (pause is not a fault path)',
        t9sim.faultLog.length === 0);
    check('T009-B4: machine did NOT halt (pause ≠ HALT instruction)',
        !t9sim.halted);
    check('T009-B5: irqState.timerArmed === true after pause call',
        t9sim.irqState && t9sim.irqState.timerArmed === true);
    check('T009-B6: timerDeadline = stepCount + T9_DURATION at call time',
        t9sim.irqState && t9sim.irqState.timerDeadline === t9sim.stepCount + T9_DURATION);

    const t9bootThread = t9sys._schedulerState.threads[t9sys._schedulerState.currentThread];
    check('T009-B7: calling thread state === "sleeping" after pause',
        t9bootThread && t9bootThread.state === 'sleeping');
    check('T009-B8: thread.wakeStep is set to timerDeadline',
        t9bootThread && t9bootThread.wakeStep === t9sim.irqState.timerDeadline);

    // ── Phase C: enable timer check + advance stepCount → step() fires IRQ ───
    // The timer check inside step() is gated on bootComplete===true.
    // Setting it here enables the alarm without changing the already-armed
    // timerArmed / timerDeadline (those were set by Scheduler.pause in Phase B).
    t9sim.bootComplete = true;

    // Advance stepCount to the deadline so the alarm has expired.
    // step() will detect this BEFORE fetching any instruction and will inject
    // a hidden Scheduler.IRQ (no CR14 is needed for this path).
    t9sim.stepCount = t9sim.irqState.timerDeadline;

    const t9irqSweepBefore = t9sys._schedulerState._irqSweepCount;
    const t9stepResult2    = t9sim.step();

    check('T009-C1: second step() returned a result (timer IRQ injected)',
        t9stepResult2 !== null);
    check('T009-C2: result carries timerIRQ=true sentinel',
        t9stepResult2 && t9stepResult2.timerIRQ === true);
    check('T009-C3: result desc mentions "Timer IRQ" or "Scheduler.IRQ"',
        t9stepResult2 && t9stepResult2.desc &&
        (t9stepResult2.desc.includes('Timer') || t9stepResult2.desc.includes('Scheduler.IRQ')));
    check('T009-C4: irqState.timerArmed cleared to false after IRQ fires',
        t9sim.irqState && !t9sim.irqState.timerArmed);
    check('T009-C5: _irqSweepCount incremented (IRQ sweep ran)',
        t9sys._schedulerState._irqSweepCount === t9irqSweepBefore + 1);
    check('T009-C6: sleeping thread woken to "ready" state after timer IRQ',
        t9bootThread && t9bootThread.state === 'ready');
    check('T009-C7: thread.waitFlag cleared after wake',
        !t9bootThread.waitFlag);
    check('T009-C8: machine still NOT halted (timer IRQ is not a fault)',
        !t9sim.halted);
    check('T009-C9: no new faults logged during timer IRQ phase',
        t9sim.faultLog.length === 0);
}

// ── T010: Continuous step() loop — timer fires naturally without manual stepCount ─
//
// Verifies that the scheduler timer alarm fires correctly when the simulator is
// driven by a step() loop (mirroring the UI "Run" button) rather than by
// manually advancing stepCount to the deadline (as T009-Phase-C does).
//
// Setup:
//   • The same pre-boot / direct-memory approach as T008-step and T009 is used to
//     avoid full lump / CR14 setup while still exercising the real dispatch chain.
//   • DURATION NOP-like instruction words (cond=NV, always-skip, non-zero) are
//     written into memory[1..DURATION] so the processor can execute them naturally
//     while bootComplete=false masks the timer check.
//   • A guard inside the loop detects when stepCount reaches the deadline WITHOUT
//     writing to stepCount, then flips bootComplete=true.  The next step() call
//     triggers the timer check at the top of step() — before any instruction fetch
//     — so no CR14 lump is needed for that final step.
//
// This uniquely validates:
//   (a) stepCount increments driven purely by instruction execution reach the
//       deadline — no test previously verified this without a manual assignment.
//   (b) The timer check fires at exactly the right step when the loop flips
//       bootComplete rather than when stepCount is manually set.
//   (c) Thread wakes and sweep count increment through the same loop-driven path
//       used by the UI Run button.
//
// NOP word encoding:  cond=0xF (NV — checkCondition always returns false)
//   Any instruction with cond=NV is unconditionally skipped (PC++ only).
//   Word = (0xF << 23) | 0x00000001  =  0x07800001  (non-zero, safe in pre-boot).
//
// CALL CR0 legacy encoding:  opcode=2, cond=AL=0xE, crDst=0, crSrc=0, imm=0
//   = ((2 << 27) | (0xE << 23) | 0) >>> 0  =  0x17000000
console.log('\n--- T010: continuous step() loop — timer fires without manual stepCount ---');
{
    const { sim: t10sim, registry: t10reg, sysAbs: t10sys } = makeTestSim();

    const DURATION   = 4;    // timer deadline = stepCount_after_CALL + DURATION
    const MAX_STEPS  = 50;   // safety guard — loop must not run forever
    const NOP_WORD   = (0xF << 23) | 0x00000001;   // cond=NV → always skipped
    const CALL_CR0   = ((2 << 27) | (0xE << 23) | 0) >>> 0;

    // ── Phase A: write program into memory and set up Scheduler in CR0 ────────
    // Slot 8 (Scheduler): no code lump → system-abstraction fast path in _execCall.
    t10sim.writeNSEntry(8, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0);
    const t10schedGT = t10sim.createGT(0, 8, { E: 1 }, 1);
    t10sim.cr[0] = { word0: t10schedGT, word1: 0, word2: 0, word3: 0, m: 0 };

    // DR3 = 0-based method index 4 (pause).  DR1 = duration.
    t10sim.dr[3] = 4;
    t10sim.dr[1] = DURATION;

    // memory[0] = CALL CR0 (arms Scheduler.pause)
    // memory[1..DURATION] = NOP words (cond=NV, always-skip) executed naturally
    //   to increment stepCount from 1 up to the timer deadline without any
    //   manual stepCount manipulation.
    // memory[DURATION+1] = 0x00000000 (HALT) — should not be reached before IRQ.
    t10sim.memory[0] = CALL_CR0;
    for (let i = 1; i <= DURATION; i++) {
        t10sim.memory[i] = NOP_WORD;
    }
    t10sim.memory[DURATION + 1] = 0x00000000;  // HALT sentinel

    // Pre-boot mode: step() reads memory[pc] directly (no CR14 lump needed).
    t10sim.bootComplete = false;

    // ── Phase B: execute CALL via step() — arms the timer ─────────────────────
    const t10callResult = t10sim.step();

    check('T010-B1: CALL step returned non-null (instruction executed)',
        t10callResult !== null);
    check('T010-B2: CALL desc confirms Scheduler.pause was dispatched',
        t10callResult && t10callResult.desc &&
        t10callResult.desc.includes('Scheduler') &&
        t10callResult.desc.includes('pause'));
    check('T010-B3: no faults after CALL (pause is not a fault path)',
        t10sim.faultLog.length === 0);
    check('T010-B4: irqState.timerArmed === true after CALL',
        t10sim.irqState && t10sim.irqState.timerArmed === true);

    // The deadline is set to sim.stepCount + DURATION at the moment pause runs.
    // stepCount++ fires after decode but before dispatch, so after the CALL step
    // stepCount === 1.  Therefore deadline === 1 + DURATION.
    const t10deadline = t10sim.irqState.timerDeadline;
    check('T010-B5: timerDeadline === stepCount + DURATION at time of pause call',
        t10deadline === t10sim.stepCount + DURATION);

    const t10pauseThread = t10sys._schedulerState.threads[t10sys._schedulerState.currentThread];
    check('T010-B6: calling thread state === "sleeping" after pause',
        t10pauseThread && t10pauseThread.state === 'sleeping');
    check('T010-B7: thread.wakeStep === timerDeadline',
        t10pauseThread && t10pauseThread.wakeStep === t10deadline);

    // ── Phase C: step() loop — stepCount increments naturally via NOPs ─────────
    // The loop does NOT write to sim.stepCount.
    // Each NOP step increments stepCount by 1 (via decode → stepCount++).
    // When the guard detects stepCount has reached the deadline, bootComplete is
    // flipped to true so the NEXT step() call triggers the hardware alarm check
    // at the top of step() (before any instruction fetch — no CR14 needed).
    let t10timerResult  = null;
    let t10timerFiredAt = null;
    const t10sweepBefore = t10sys._schedulerState._irqSweepCount;

    for (let iteration = 0; iteration < MAX_STEPS; iteration++) {
        // Enable timer check once the deadline is reached — no stepCount write.
        if (t10sim.irqState.timerArmed &&
            t10sim.stepCount >= t10sim.irqState.timerDeadline) {
            t10sim.bootComplete = true;
        }

        const r = t10sim.step();

        if (r && r.timerIRQ === true) {
            t10timerResult  = r;
            t10timerFiredAt = t10sim.stepCount;
            break;
        }
        if (t10sim.halted || r === null) break;
    }

    check('T010-C1: timer IRQ fired before max_steps guard expired',
        t10timerResult !== null);
    check('T010-C2: timerIRQ sentinel is true in the result',
        t10timerResult && t10timerResult.timerIRQ === true);
    check('T010-C3: result desc mentions "Timer" or "Scheduler.IRQ"',
        t10timerResult && t10timerResult.desc &&
        (t10timerResult.desc.includes('Timer') ||
         t10timerResult.desc.includes('Scheduler.IRQ')));
    check('T010-C4: timer fired at step == deadline (±0)',
        t10timerFiredAt !== null && t10sim.stepCount === t10deadline);
    check('T010-C5: irqState.timerArmed cleared to false after IRQ fires',
        t10sim.irqState && !t10sim.irqState.timerArmed);
    check('T010-C6: _irqSweepCount incremented (IRQ sweep ran)',
        t10sys._schedulerState._irqSweepCount === t10sweepBefore + 1);
    check('T010-C7: sleeping thread woken to "ready" state after timer IRQ',
        t10pauseThread && t10pauseThread.state === 'ready');
    check('T010-C8: thread.waitFlag cleared after wake',
        t10pauseThread && !t10pauseThread.waitFlag);
    check('T010-C9: machine NOT halted (timer IRQ is not a fault)',
        !t10sim.halted);
    check('T010-C10: no faults logged during loop (timer is not a fault path)',
        t10sim.faultLog.length === 0);
    check('T010-C11: HALT sentinel not reached before timer IRQ',
        !t10sim.halted);
}

// ── T011: Multi-thread pause — Thread 0 sleeps, Thread 1 keeps running ────────
//
// Verifies the realistic multi-thread scenario that T004 and T009 do not cover:
//
//   Phase A — Setup: two threads registered; Thread 0 is currentThread.
//   Phase B — Thread 0 calls Scheduler.pause(N): transitions to 'sleeping';
//             Thread 1 state is unaffected ('running').
//   Phase C — Mid-sleep: advance stepCount partway (< deadline); fire the IRQ
//             sweep early to confirm Thread 0 remains 'sleeping' and Thread 1
//             remains 'running'.
//   Phase D — Timer fires at deadline: _fireSchedulerIRQ('TIMER') wakes
//             Thread 0 to 'ready'; Thread 1 was never put to sleep.
//
// This test directly exercises the "suspends calling thread" invariant of
// Scheduler.pause in a multi-thread environment.
console.log('\n--- T011: Multi-thread pause — Thread 0 sleeps, Thread 1 keeps running ---');
{
    const { sim, registry, sysAbs } = makeTestSim();
    const state = sysAbs._schedulerState;

    // ── Phase A: two-thread setup ─────────────────────────────────────────────
    // Thread 0 already exists (created by SystemAbstractions as the boot thread).
    // Set its state to 'running' explicitly so the baseline is clear.
    state.threads[0].state = 'running';
    state.currentThread = 0;

    // Add Thread 1 as a second independently-running thread.
    state.threads.push({ id: 1, state: 'running', name: 'worker' });

    check('T011-A1: Thread 0 starts as running', state.threads[0].state === 'running');
    check('T011-A2: Thread 1 starts as running', state.threads[1].state === 'running');
    check('T011-A3: currentThread is 0 (Thread 0 is the caller)', state.currentThread === 0);

    // ── Phase B: Thread 0 calls Scheduler.pause(DURATION) ────────────────────
    const DURATION = 10;
    const stepAtCall = sim.stepCount;
    const pauseResult = registry.dispatchMethod(8, 'pause', sim, { duration: DURATION });

    check('T011-B1: Scheduler.pause returns ok=true', pauseResult && pauseResult.ok === true);
    check('T011-B2: Thread 0 state is now "sleeping"', state.threads[0].state === 'sleeping');
    check('T011-B3: Thread 0 wakeStep set to stepAtCall + DURATION',
        state.threads[0].wakeStep === stepAtCall + DURATION);
    check('T011-B4: Thread 1 state is still "running" (pause only affects the caller)',
        state.threads[1].state === 'running');
    check('T011-B5: irqState.timerArmed set to true', sim.irqState.timerArmed === true);
    check('T011-B6: timerDeadline equals stepAtCall + DURATION',
        sim.irqState.timerDeadline === stepAtCall + DURATION);
    check('T011-B7: machine did NOT halt (pause is not a fault)', !sim.halted);

    // ── Phase C: mid-sleep inspection — Thread 0 must NOT wake early ─────────
    // In real execution step() only calls _fireSchedulerIRQ after confirming
    // stepCount >= timerDeadline.  Simulate several mid-sleep steps by advancing
    // stepCount partway — no IRQ is fired yet, matching what step() would do.
    sim.stepCount = stepAtCall + Math.floor(DURATION / 2);

    check('T011-C1: Thread 0 still "sleeping" at mid-point (wakeStep not reached)',
        state.threads[0].state === 'sleeping');
    check('T011-C2: Thread 0 wakeStep unchanged at mid-point',
        state.threads[0].wakeStep === stepAtCall + DURATION);
    check('T011-C3: Thread 1 still "running" at mid-point (unaffected by pause)',
        state.threads[1].state === 'running');
    check('T011-C4: timerArmed still true at mid-point (deadline not yet reached)',
        sim.irqState.timerArmed === true);
    check('T011-C5: machine still NOT halted at mid-point', !sim.halted);

    // ── Phase D: advance to deadline — timer fires and wakes Thread 0 ─────────
    sim.stepCount = sim.irqState.timerDeadline;

    const sweptAtDeadline = state._irqSweepCount;
    const deadlineFired = sim._fireSchedulerIRQ('TIMER', null);

    check('T011-D1: _fireSchedulerIRQ at deadline returns true', deadlineFired === true);
    check('T011-D2: _irqSweepCount incremented by deadline sweep',
        state._irqSweepCount === sweptAtDeadline + 1);
    check('T011-D3: Thread 0 woken to "ready" after timer fires',
        state.threads[0].state === 'ready');
    check('T011-D4: Thread 0 waitFlag cleared after wake', !state.threads[0].waitFlag);
    check('T011-D5: Thread 1 is still "running" — was never put to sleep',
        state.threads[1].state === 'running');
    check('T011-D6: timerArmed cleared after deadline IRQ fires',
        !sim.irqState.timerArmed);
    check('T011-D7: machine still NOT halted after full pause cycle', !sim.halted);
    check('T011-D8: no faults logged during the multi-thread pause cycle',
        sim.faultLog.length === 0);

    // ── Phase E: step()-level timer injection in a two-thread environment ─────
    //
    // Re-arms the scenario and verifies the simulator.js timer-check path
    // (bootComplete=true; step() fires the IRQ before fetching any instruction)
    // behaves correctly when two threads are registered.  This mirrors T009's
    // Phase C but exercises it with Thread 1 present.
    //
    // Steps:
    //   1. Reset Thread 0 back to 'running'; Thread 1 remains 'running'.
    //   2. Re-arm Scheduler.pause via registry.dispatchMethod (pre-boot path,
    //      bootComplete=false so the timer check does not fire prematurely).
    //   3. Enable bootComplete=true and advance stepCount to the new deadline.
    //   4. Call step() — the timer check fires before instruction fetch, injects
    //      a hidden Scheduler.IRQ, wakes Thread 0, and returns a timerResult.
    //
    // bootComplete is toggled off for the pause call so the timer check inside
    // step() cannot fire during Phase E setup, then toggled back on before the
    // final step() call — matching the T009 Phase C pattern exactly.
    state.threads[0].state = 'running';
    state.threads[0].wakeStep = undefined;
    sim.bootComplete = false;   // mask the timer check during re-arm

    const E_DURATION = 8;
    const eStepAtCall = sim.stepCount;
    registry.dispatchMethod(8, 'pause', sim, { duration: E_DURATION });

    check('T011-E1: Thread 0 re-armed to "sleeping" for step() phase',
        state.threads[0].state === 'sleeping');
    check('T011-E2: Thread 1 still "running" after re-arm',
        state.threads[1].state === 'running');
    check('T011-E3: timerArmed=true after re-arm', sim.irqState.timerArmed === true);

    // Enable the step()-level timer check and advance to the deadline.
    sim.bootComplete = true;
    sim.stepCount = sim.irqState.timerDeadline;

    const eSweepBefore = state._irqSweepCount;
    const eStepResult = sim.step();

    check('T011-E4: step() returned a non-null result (timer IRQ injected)',
        eStepResult !== null);
    check('T011-E5: step() result carries timerIRQ=true sentinel',
        eStepResult && eStepResult.timerIRQ === true);
    check('T011-E6: step() result desc mentions Timer or Scheduler.IRQ',
        eStepResult && eStepResult.desc &&
        (eStepResult.desc.includes('Timer') || eStepResult.desc.includes('Scheduler.IRQ')));
    check('T011-E7: timerArmed cleared by step() timer path',
        !sim.irqState.timerArmed);
    check('T011-E8: _irqSweepCount incremented by step() timer IRQ',
        state._irqSweepCount === eSweepBefore + 1);
    check('T011-E9: Thread 0 woken to "ready" via step() timer path',
        state.threads[0].state === 'ready');
    check('T011-E10: Thread 1 still "running" after step() timer IRQ',
        state.threads[1].state === 'running');
    check('T011-E11: no faults logged during step() timer phase',
        sim.faultLog.length === 0);
    check('T011-E12: machine NOT halted after step() timer phase', !sim.halted);
}

// ── T012: Two threads both calling Scheduler.pause with different durations ────
//
// Verifies the exact edge-cases called out in Task #1118:
//   (a) Only the thread whose wakeStep has expired is woken at the first deadline.
//   (b) The thread with the later deadline stays sleeping until its own deadline.
//   (c) A second (and third) timer alarm is correctly armed and fires after the first.
//
// Both threads call the real Scheduler.pause() API via registry.dispatchMethod,
// with state.currentThread switched between calls (the public scheduler convention).
// The simulation is then driven by a step() loop (mirroring the UI Run button) to
// verify wake points at the natural step deadlines.
//
// Key scheduler invariant exercised here:
//   When pause() is called a second time while the timer is already armed, the
//   shared timerDeadline must be the MINIMUM of the two deadlines so the earlier
//   sleeper is woken on time. After waking the first sleeper the IRQ handler
//   auto-re-arms to the next pending wakeStep.
//
// Setup:
//   DURATION_A = 3 (Thread A / Thread 0 — wakes first)
//   DURATION_B = 7 (Thread B / Thread 1 — wakes second)
//   NOP words fill memory so the step() loop can keep incrementing stepCount
//   without reaching a HALT before both IRQs fire.
//
// NOP word:  cond=NV (0xF) → always skipped, PC++.  = (0xF << 23) | 1 = 0x07800001
// CALL CR0 legacy: opcode=2, cond=AL=0xE, crDst=0, crSrc=0, imm=0 = 0x17000000
console.log('\n--- T012: Two threads with different pause durations — step() driven ---');
{
    const { sim, registry, sysAbs } = makeTestSim();
    const state = sysAbs._schedulerState;

    const DURATION_A = 3;
    const DURATION_B = 7;
    const MAX_STEPS  = 80;
    const NOP_WORD   = (0xF << 23) | 0x00000001;

    // ── Phase A: two-thread setup ─────────────────────────────────────────────
    state.threads[0].state = 'running';
    state.currentThread    = 0;
    state.threads.push({ id: 1, state: 'running', name: 'lateWorker' });

    check('T012-A1: Thread 0 starts as "running"', state.threads[0].state === 'running');
    check('T012-A2: Thread 1 starts as "running"', state.threads[1].state === 'running');

    // ── Phase B: both threads call Scheduler.pause via the real API ───────────
    // Thread 0 (currentThread=0) calls pause(DURATION_A=3).
    const stepAtBase = sim.stepCount;
    state.currentThread = 0;
    const pauseA = registry.dispatchMethod(8, 'pause', sim, { duration: DURATION_A });

    check('T012-B1: Thread 0 Scheduler.pause(3) returns ok=true', pauseA && pauseA.ok === true);
    check('T012-B2: Thread 0 state is "sleeping" after pause(3)', state.threads[0].state === 'sleeping');
    check('T012-B3: Thread 0 wakeStep = stepAtBase + 3',
        state.threads[0].wakeStep === stepAtBase + DURATION_A);
    check('T012-B4: timerArmed=true after first pause()', sim.irqState.timerArmed === true);
    check('T012-B5: timerDeadline = stepAtBase + 3 after first pause()',
        sim.irqState.timerDeadline === stepAtBase + DURATION_A);

    // Thread 1 (currentThread=1) calls pause(DURATION_B=7).
    // With the min-deadline fix, timerDeadline must remain stepAtBase + 3 (the earlier deadline).
    state.currentThread = 1;
    const pauseB = registry.dispatchMethod(8, 'pause', sim, { duration: DURATION_B });

    check('T012-B6: Thread 1 Scheduler.pause(7) returns ok=true', pauseB && pauseB.ok === true);
    check('T012-B7: Thread 1 state is "sleeping" after pause(7)', state.threads[1].state === 'sleeping');
    check('T012-B8: Thread 1 wakeStep = stepAtBase + 7',
        state.threads[1].wakeStep === stepAtBase + DURATION_B);
    check('T012-B9: timerDeadline still = stepAtBase + 3 (min-deadline preserved after second pause)',
        sim.irqState.timerDeadline === stepAtBase + DURATION_A);
    check('T012-B10: timerArmed still true', sim.irqState.timerArmed === true);
    check('T012-B11: machine NOT halted after both pause() calls', !sim.halted);

    // ── Phase C: step() loop — drive to first deadline (DURATION_A = +3) ──────
    // Uses the same bootComplete-toggle pattern as T010:
    //   bootComplete=false → step() reads instructions from memory[pc] directly
    //   (pre-boot path, no CR14 lump required), executing NOP words to increment
    //   stepCount naturally.  When the loop guard detects stepCount has reached the
    //   next armed deadline, bootComplete is flipped to true so the NEXT step()
    //   call triggers the hardware timer check BEFORE any instruction fetch, injects
    //   the Scheduler.IRQ, and returns a timerIRQ sentinel.  After each timer fires,
    //   bootComplete is flipped back to false so NOP execution resumes for the
    //   next leg.  No manual stepCount assignment is made in either leg.
    for (let i = 0; i < MAX_STEPS; i++) sim.memory[i] = NOP_WORD;
    sim.bootComplete = false;   // pre-boot mode: reads memory[pc] directly

    const deadlineA = stepAtBase + DURATION_A;
    const deadlineB = stepAtBase + DURATION_B;

    let firstTimerResult = null;
    let firstTimerStep   = null;
    let secondTimerResult = null;
    let secondTimerStep   = null;
    const sweepBefore = state._irqSweepCount;

    // Snapshots captured immediately after each timer fires, before the loop
    // continues — the only correct way to assert mid-loop thread state.
    let snapAfterFirst = null;   // { t0, t1, timerArmed, timerDeadline, sweep }
    let snapAfterSecond = null;

    for (let iteration = 0; iteration < MAX_STEPS; iteration++) {
        // When stepCount reaches (or exceeds) the current armed deadline, flip
        // bootComplete so the NEXT step() triggers the timer check.
        if (sim.irqState.timerArmed &&
            sim.stepCount >= sim.irqState.timerDeadline) {
            sim.bootComplete = true;
        }

        const r = sim.step();

        if (r && r.timerIRQ === true) {
            if (firstTimerResult === null) {
                firstTimerResult = r;
                firstTimerStep   = sim.stepCount;
                // Capture state immediately after first timer fires.
                snapAfterFirst = {
                    t0state:      state.threads[0].state,
                    t0wakeStep:   state.threads[0].wakeStep,
                    t1state:      state.threads[1].state,
                    t1wakeStep:   state.threads[1].wakeStep,
                    timerArmed:   sim.irqState.timerArmed,
                    timerDeadline:sim.irqState.timerDeadline,
                    sweep:        state._irqSweepCount
                };
                // Re-enter pre-boot mode to drive NOPs to the second deadline.
                sim.bootComplete = false;
                // Do NOT break — continue loop to catch the second alarm.
            } else {
                secondTimerResult = r;
                secondTimerStep   = sim.stepCount;
                // Capture state immediately after second timer fires.
                snapAfterSecond = {
                    t0state:    state.threads[0].state,
                    t1state:    state.threads[1].state,
                    t1wakeStep: state.threads[1].wakeStep,
                    timerArmed: sim.irqState.timerArmed,
                    sweep:      state._irqSweepCount
                };
                break;
            }
        }
        if (sim.halted || r === null) break;
    }

    // First timer fires at deadline_A (+3) — checked against snapAfterFirst
    check('T012-C1: first timer IRQ fired (deadline_A = stepAtBase + 3)',
        firstTimerResult !== null);
    check('T012-C2: first timerIRQ sentinel is true', firstTimerResult && firstTimerResult.timerIRQ === true);
    check('T012-C3: first timer fired at stepCount == deadline_A',
        firstTimerStep !== null && firstTimerStep === deadlineA);
    check('T012-C4: Thread 0 woken to "ready" at deadline_A',
        snapAfterFirst && snapAfterFirst.t0state === 'ready');
    check('T012-C5: Thread 0 wakeStep cleared after first timer',
        snapAfterFirst && snapAfterFirst.t0wakeStep == null);
    check('T012-C6: Thread 1 STILL "sleeping" after first timer (wakeStep 7 > stepCount 3)',
        snapAfterFirst && snapAfterFirst.t1state === 'sleeping');
    check('T012-C7: Thread 1 wakeStep unchanged after first timer (still = stepAtBase + 7)',
        snapAfterFirst && snapAfterFirst.t1wakeStep === deadlineB);
    check('T012-C8: timerArmed re-armed to deadline_B by IRQ handler after first fire',
        snapAfterFirst && snapAfterFirst.timerArmed === true &&
        snapAfterFirst.timerDeadline === deadlineB);
    check('T012-C9: _irqSweepCount incremented by first sweep',
        snapAfterFirst && snapAfterFirst.sweep === sweepBefore + 1);
    check('T012-C10: no faults logged during first timer phase', sim.faultLog.length === 0);

    // Second timer fires at deadline_B (+7) — checked against snapAfterSecond
    check('T012-D1: second timer IRQ fired (deadline_B = stepAtBase + 7)',
        secondTimerResult !== null);
    check('T012-D2: second timerIRQ sentinel is true', secondTimerResult && secondTimerResult.timerIRQ === true);
    check('T012-D3: second timer fired at stepCount == deadline_B',
        secondTimerStep !== null && secondTimerStep === deadlineB);
    check('T012-D4: Thread 1 woken to "ready" at deadline_B',
        snapAfterSecond && snapAfterSecond.t1state === 'ready');
    check('T012-D5: Thread 1 wakeStep cleared after second timer',
        snapAfterSecond && snapAfterSecond.t1wakeStep == null);
    check('T012-D6: Thread 0 remains "ready" (undisturbed by second timer)',
        snapAfterSecond && snapAfterSecond.t0state === 'ready');
    check('T012-D7: timerArmed cleared — no more sleeping threads',
        snapAfterSecond && !snapAfterSecond.timerArmed);
    check('T012-D8: _irqSweepCount incremented by second sweep',
        snapAfterSecond && snapAfterSecond.sweep === sweepBefore + 2);
    check('T012-D9: no faults logged during second timer phase', sim.faultLog.length === 0);
    check('T012-D10: machine NOT halted after full two-thread pause cycle', !sim.halted);

    // ── Phase E: re-arm a third alarm — proves sequential alarm lifecycle ──────
    // Reset Thread 0 to 'running', call pause() again, drive via step().
    state.threads[0].state = 'running';
    state.currentThread    = 0;
    const DURATION_C = 5;
    const stepAtC = sim.stepCount;
    const pauseC = registry.dispatchMethod(8, 'pause', sim, { duration: DURATION_C });

    check('T012-E1: third Scheduler.pause() returns ok=true', pauseC && pauseC.ok === true);
    check('T012-E2: timerArmed=true for third alarm', sim.irqState.timerArmed === true);
    check('T012-E3: timerDeadline = stepAtC + 5', sim.irqState.timerDeadline === stepAtC + DURATION_C);
    check('T012-E4: Thread 0 sleeping for third alarm', state.threads[0].state === 'sleeping');

    let thirdTimerResult = null;
    const sweepBeforeE = state._irqSweepCount;
    sim.bootComplete = false;   // pre-boot NOP mode for third leg
    for (let i = 0; i < MAX_STEPS; i++) {
        if (sim.irqState.timerArmed &&
            sim.stepCount >= sim.irqState.timerDeadline) {
            sim.bootComplete = true;
        }
        const r = sim.step();
        if (r && r.timerIRQ === true) { thirdTimerResult = r; break; }
        if (sim.halted || r === null) break;
    }

    check('T012-E5: third alarm fires via step() loop', thirdTimerResult !== null);
    check('T012-E6: third timerIRQ sentinel is true', thirdTimerResult && thirdTimerResult.timerIRQ === true);
    check('T012-E7: Thread 0 woken to "ready" after third alarm', state.threads[0].state === 'ready');
    check('T012-E8: timerArmed cleared after third alarm', !sim.irqState.timerArmed);
    check('T012-E9: _irqSweepCount incremented for third alarm',
        state._irqSweepCount === sweepBeforeE + 1);
    check('T012-E10: no faults at any point in three-alarm sequence', sim.faultLog.length === 0);
    check('T012-E11: machine NOT halted throughout', !sim.halted);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
