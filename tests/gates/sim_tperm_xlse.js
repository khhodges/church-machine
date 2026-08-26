'use strict';
// Headless harness for tests/test_tperm_xlse.py.
//
// Tests strict ordinary TPERM matching and domain purity. Same-domain
// missing/extra permissions are ordinary Z=0 results; a cross-domain request
// is a hard DOMAIN_PURITY fault.
//
// GT word layout (simulator parseGT):
//   bits [15: 0]  slot_id
//   bits [22:16]  gt_seq
//   bits [24:23]  gt_type  (0b01 = Inform)
//   bits [31:25]  permBits: R=bit0 W=bit1 X=bit2 L=bit3 S=bit4 E=bit5 B=bit6
//                           → X at bit 27, L at bit 28, S at bit 29
//
// Preset code 11 is a reserved slot reused here as the test-only X+L preset.
// Preset code 14 is reused as the test-only X+S preset.
// Preset code 13 is reused as the test-only X+E preset.
//
// Stdin:  (none — scenarios are hardcoded)
// Stdout: JSON array of result objects

global.window = { bootConfig: {} };
const { bootSim } = require('./sim_helpers');

function runTperm(scenarioName, crIdx, word0GT, presetCode, customPresetPerms) {
    const sim = bootSim();
    if (!sim.bootComplete) {
        return { name: scenarioName, error: 'boot did not complete' };
    }

    // Preload the target CR with the desired GT word.
    // slot_id=1 (Boot.Thread) ensures the GT references a valid NS entry so
    // mLoad version/seal checks inside TPERM pass.
    if (sim.cr[crIdx] === undefined) sim.cr[crIdx] = {};
    sim.cr[crIdx].word0 = word0GT >>> 0;

    // Inject the custom preset if requested.
    if (customPresetPerms !== null) {
        sim.tpermPresetMasks[presetCode] = customPresetPerms;
    }

    // Find the code lump.
    const cr14 = sim.cr[14];
    const codeBase = cr14 ? cr14.word1 : null;
    if (codeBase == null) return { name: scenarioName, error: 'CR14.word1 is null' };

    // Encode TPERM (opcode=6), targeting crIdx, imm = preset code.
    const imm = presetCode;
    const instr = sim.encodeInstruction(6, 0xE, crIdx, 0, imm);
    sim.memory[codeBase + 1] = instr >>> 0;

    sim.pc = 0;
    sim.halted = false;
    const before = sim.cr[crIdx].word0 >>> 0;
    const faultsBefore = sim.faultLog ? sim.faultLog.length : 0;
    sim.step();
    const faultsAfter = sim.faultLog ? sim.faultLog.length : 0;
    const newFaults = sim.faultLog ? sim.faultLog.slice(faultsBefore) : [];

    return {
        name:      scenarioName,
        faulted:   newFaults.length > 0,
        faultCode: newFaults.length ? newFaults[0].type : null,
        faultMsg:  newFaults.length ? newFaults[0].message : null,
        flags:     { Z: sim.flags.Z, N: sim.flags.N, C: sim.flags.C, V: sim.flags.V },
        unchanged: (sim.cr[crIdx].word0 >>> 0) === before,
    };
}

// GT word constants (canonical v2 layout): type=Inform at bits [26:25],
// domain at bit 27, and the domain-local permission payload at [30:28].
const makeGT = (dom, perm3) => ((dom << 27) | (perm3 << 28) | (1 << 25) | 1) >>> 0;
const GT_R_ONLY  = makeGT(0, 0b001);
const GT_RW      = makeGT(0, 0b011);
const GT_X_ONLY  = makeGT(0, 0b100);
const GT_E_ONLY  = makeGT(1, 0b100);

const results = [
    runTperm('T_STRICT1_exact_R_passes',          5, GT_R_ONLY, 1, null),
    runTperm('T_STRICT2_extra_RW_for_R_fails',    5, GT_RW,     1, null),
    runTperm('T_STRICT3_missing_W_for_RW_fails',  5, GT_R_ONLY, 2, null),
    runTperm('T_STRICT4_exact_RW_passes',         5, GT_RW,     2, null),
    runTperm('T_STRICT5_exact_E_passes',          5, GT_E_ONLY, 8, null),
    runTperm('T_STRICT6_missing_LS_for_E_fails',  5, GT_E_ONLY, 9, null),
    runTperm('T_STRICT7_cross_domain_faults',     5, GT_E_ONLY, 3, null),
    // Mixed custom requests are also domain-purity faults.
    runTperm('T_STRICT8_mixed_request_faults',   5, GT_R_ONLY, 11, ['X','L']),
];

process.stdout.write(JSON.stringify(results, null, 2) + '\n');
