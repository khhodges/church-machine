// Harness used by test_navana_call_method1.py.
//
// Reads a JSON envelope from stdin:
//   {
//     "imageBase64":  "<base64-encoded 32-bit LE boot image>",
//     "config":       { ... boot config ... },
//     "navanaLumpWords": [headerWord, tableEntry1, bodyWord]  // from boot_rom.py
//   }
//
// Exercises the full hardware simulator CALL path for CALL CR_navana, 1:
//
//   1. Instantiates ChurchSimulator with AbstractionRegistry + SystemAbstractions.
//   2. Loads the boot image via loadBootImage().
//   3. Drives _bootStep() until bootComplete.
//   4. Locates the Navana NS entry (NS slot 5) to find lumpBaseWord.
//   5. Injects the three Navana lump words from boot_rom.py into simulator
//      memory at lumpBaseWord, lumpBaseWord+1, lumpBaseWord+2.
//      This mirrors exactly what boot_rom.py does on hardware: the lump header,
//      method_table[1] = _NAVANA_INIT_BODY_OFFSET (= 2), and the RETURN AL body.
//   6. Constructs a valid Inform E-GT for NS slot 5 using the live gt_seq from
//      the NS table so that mLoad's version and seal checks pass.
//   7. Places that GT into CR0, clears CR15.m, and calls sim._execCall()
//      with method index 1 — exercising the hardware method-table dispatch.
//   8. Emits a JSON result line on stdout.
//
// The test asserts:
//   - No PRIVATE_METHOD fault (and no other new fault).
//   - tableEntry (memory[lumpBase + 1]) is non-zero after injection.
//   - PC after CALL equals tableEntry (= 2, the RETURN AL offset).

'use strict';

const NAVANA_NS = 5;

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
    let env;
    try {
        env = JSON.parse(raw);
    } catch (e) {
        process.stdout.write(JSON.stringify({ ok: false, message: `stdin parse error: ${e.message}` }) + '\n');
        process.exit(1);
    }

    const cfg            = env.config          || {};
    const navanaLumpWords = env.navanaLumpWords || [];
    const imgBuf = Buffer.from(env.imageBase64 || '', 'base64');

    global.window = { bootConfig: cfg };

    const AbstractionRegistry = require('../../simulator/abstractions.js');
    const SystemAbstractions  = require('../../simulator/system_abstractions.js');
    const ChurchSimulator     = require('../../simulator/simulator.js');

    const registry = new AbstractionRegistry();
    new SystemAbstractions(registry);

    const sim = new ChurchSimulator();
    sim.initAbstractions(registry, null, null);

    sim.memory.fill(0);
    const ab = imgBuf.buffer.slice(imgBuf.byteOffset, imgBuf.byteOffset + imgBuf.byteLength);
    const loaded = sim.loadBootImage(ab);

    const MAX_BOOT_STEPS = 64;
    let iters = 0;
    while (iters < MAX_BOOT_STEPS && !sim.bootComplete && !sim.halted) {
        const advanced = sim._bootStep();
        iters++;
        if (!advanced) break;
    }

    const bootComplete = sim.bootComplete === true;
    if (!bootComplete) {
        process.stdout.write(JSON.stringify({
            ok: false,
            message: `Boot did not complete after ${iters} steps — cannot test CALL dispatch`
        }) + '\n');
        process.exit(1);
    }

    // ── Locate the Navana lump in the live NS table ───────────────────────────
    const nsEntry = sim.readNSEntry(NAVANA_NS);
    if (!nsEntry) {
        process.stdout.write(JSON.stringify({
            ok: false,
            message: `readNSEntry(${NAVANA_NS}) returned null — Navana not in NS table`
        }) + '\n');
        process.exit(1);
    }

    const lumpBaseWord = nsEntry.word0_location;

    // ── Snapshot pre-injection state ──────────────────────────────────────────
    // Records what the server-generated boot image placed at lump_base + 1
    // before the hardware lump words are injected.  Useful as a boot-image drift
    // detector: if this becomes non-zero in future, the server image has started
    // embedding the Navana lump and the injection step is no longer needed.
    const preInjectionTableEntry = sim.memory[lumpBaseWord + 1] >>> 0;

    // ── Inject Navana lump words (mirrors boot_rom.py Navana lump injection) ─
    // boot_rom.py writes three words at FULL_ROM[_NAVANA_LUMP_WORD + 0..2]:
    //   [0]  lump header: magic=0x1F, cw=2, cc=0
    //   [1]  method_table[1] = _NAVANA_INIT_BODY_OFFSET (= 2)
    //   [2]  Init body: RETURN AL instruction
    // We replicate that injection at the Navana lump base in the simulator's
    // memory so the hardware dispatch path (which reads memory[lumpBase + 1])
    // sees a non-zero table entry and does not PRIVATE_METHOD fault.
    if (navanaLumpWords.length >= 3) {
        sim.memory[lumpBaseWord + 0] = navanaLumpWords[0] >>> 0;
        sim.memory[lumpBaseWord + 1] = navanaLumpWords[1] >>> 0;
        sim.memory[lumpBaseWord + 2] = navanaLumpWords[2] >>> 0;
    }

    // Read the table entry that the CALL dispatch will see.
    const tableEntry = sim.memory[lumpBaseWord + 1] >>> 0;

    // ── Build a valid Inform E-GT for Navana ─────────────────────────────────
    // mLoad requires gt_seq to match NS entry word2[31:25]; read it from the
    // live NS table so the version check passes.
    const nsW2  = sim.memory[sim._nsSlotBase(NAVANA_NS) + 2] >>> 0;
    const gtSeq = (nsW2 >>> 25) & 0x7F;
    const navanaGT = sim.createGT(gtSeq, NAVANA_NS, { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, 1);

    // ── Place GT into CR0 ─────────────────────────────────────────────────────
    sim.cr[0] = { word0: navanaGT, word1: 0, word2: 0, word3: 0, m: 0 };

    // Ensure M-bit on CR15 is clear so _mwinWriteback() is a no-op (returns
    // true immediately when cr[15].m !== 1 — simulator.js line 2362).
    if (sim.cr[15]) sim.cr[15].m = 0;

    // ── Snapshot fault log before CALL ────────────────────────────────────────
    const faultsBefore = (sim.faultLog || []).length;

    // ── Execute CALL CR0, 1 through the full hardware dispatch path ───────────
    // Decoded instruction: opcode=2 (CALL), cond=AL (0xF), crDst=0, imm=1.
    // This exercises simulator.js _execCall() → mLoad → method-table dispatch.
    const callResult = sim._execCall({
        opcode: 2,
        cond:   0xF,
        crDst:  0,
        crSrc:  0,
        imm:    1,
        raw:    0x40000001,
    });

    const faultsAfter        = (sim.faultLog || []).length;
    const newFaults          = (sim.faultLog || []).slice(faultsBefore);
    const privateMethodFault  = newFaults.some((f) => f.type === 'PRIVATE_METHOD');
    const anyNewFault         = faultsAfter > faultsBefore;

    // ── Evaluate success criteria ─────────────────────────────────────────────
    // 1. No PRIVATE_METHOD fault (and no other new fault after injection).
    // 2. tableEntry != 0 (the injected method_table[1] = _NAVANA_INIT_BODY_OFFSET).
    // 3. PC == tableEntry after CALL (hardware: pc = tableEntry for method index > 0).
    //    Expected PC = 2 (_NAVANA_INIT_BODY_OFFSET = lump word offset of RETURN AL).
    const ok = !anyNewFault && tableEntry !== 0 && sim.pc === tableEntry;

    process.stdout.write(JSON.stringify({
        ok,
        bootComplete,
        loaded:                 loaded === true,
        lumpBaseWord,
        preInjectionTableEntry,
        tableEntry,
        tableEntryHex:          `0x${tableEntry.toString(16).toUpperCase().padStart(8, '0')}`,
        pcAfterCall:            sim.pc,
        privateMethodFault,
        anyNewFault,
        newFaults:              newFaults.map((f) => ({ type: f.type, message: f.message })),
        callResultNull:         callResult === null,
        message: ok
            ? `CALL CR_navana, 1 dispatched correctly: tableEntry=${tableEntry}, PC=${sim.pc} (RETURN AL instruction at lump word ${tableEntry})`
            : `CALL CR_navana, 1 failed: tableEntry=${tableEntry}, PC=${sim.pc}, faults=${JSON.stringify(newFaults)}`,
    }) + '\n');
    process.exit(ok ? 0 : 1);
});
