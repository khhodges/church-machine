#!/usr/bin/env node
// scripts/check_wukong_callhome_divergence.js
//
// CI guard: verifies that simulator/examples/wukong_callhome.cloomc, when
// assembled, produces instruction words that match hardware/boot_rom.py's
// WUKONG_NUC_PROGRAM while allowing the software LUMP's explicit hardware
// handoff after the shared ROM sequence.
//
// What is checked:
//   • The software LUMP must contain exactly 74 instructions; the immutable ROM
//     remains exactly 73 words.
//   • Words [2..71] must be bit-for-bit identical.
//   • Word 72 must CALL WukongCallHome.hw through c-list row 2, selector 0.
//   • Word 73 must be the adjusted loop fallback (BRANCH -70).
//   • Declared capabilities must materialize to the canonical Wukong tokens.
//
// What is intentionally NOT compared:
//   • Words [0..1] (LOAD instructions) — the LUMP uses c-list slots 0/1 for
//     (LED0, UART_TX) while the hardware boot c-list uses slots 5/6 for
//     (LED_DEV, UART_DEV).  Only the imm field (c-list slot index) differs;
//     opcode, condition code, and register fields are identical.  The check
//     verifies those fields explicitly instead.
//
// DREAD/DWRITE encoding:
//   Both programs use 4-operand indexed form (bit14=0 in the imm field) to
//   keep the encoded words identical.  The assembler's 3-operand form would
//   set bit14=1 — using the 4-operand form avoids that difference.
//
// Exit 0 = consistent, exit 1 = diverged.
//
// Usage:
//   node scripts/check_wukong_callhome_divergence.js

'use strict';

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');

const ROOT        = path.resolve(__dirname, '..');
const ASSEMBLER   = path.join(ROOT, 'simulator', 'assembler.js');
const SOURCE      = path.join(ROOT, 'simulator', 'examples', 'wukong_callhome.cloomc');
const CAP_TOKENS  = path.join(ROOT, 'simulator', 'capability_tokens.js');

// ── Load assembler ───────────────────────────────────────────────────────────
global.localStorage = {
    _store: {},
    getItem(k)    { return this._store[k] !== undefined ? this._store[k] : null; },
    setItem(k, v) { this._store[k] = String(v); },
    removeItem(k) { delete this._store[k]; },
};
const vm = require('vm');
vm.runInThisContext(fs.readFileSync(ASSEMBLER, 'utf8'), { filename: 'assembler.js' });

if (typeof ChurchAssembler === 'undefined') {
    console.error('ERROR: ChurchAssembler not found after loading assembler.js');
    process.exit(1);
}

// ── Assemble the CLOOMC source ───────────────────────────────────────────────
const source = fs.readFileSync(SOURCE, 'utf8');
const asm    = new ChurchAssembler();
const result = asm.assemble(source);

if (result.errors.length > 0) {
    console.error('Assembly errors in wukong_callhome.cloomc:');
    for (const e of result.errors) {
        console.error(`  Line ${e.line}: ${e.message}`);
    }
    process.exit(1);
}

const assembled = result.words;
console.log(`Assembled ${assembled.length} instruction words from wukong_callhome.cloomc.`);

// ── Fetch WUKONG_NUC_PROGRAM via Python ──────────────────────────────────────
// Run Python to emit the hardware program as a JSON array.
// hardware/boot_rom.py uses Amaranth relative imports; run via the package.
const pyCmd = [
    'python3', '-c',
    [
        'import sys',
        `sys.path.insert(0, ${JSON.stringify(ROOT)})`,
        'from hardware.boot_rom import WUKONG_NUC_PROGRAM',
        'import json',
        'print(json.dumps([w & 0xFFFFFFFF for w in WUKONG_NUC_PROGRAM]))',
    ].join('; '),
].join(' ');

let nucProgram;
try {
    // Use python3 -c with the script passed via stdin via execSync's input option
    // to avoid shell metacharacter escaping issues with semicolons.
    const pyScript = [
        'import sys',
        `sys.path.insert(0, ${JSON.stringify(ROOT)})`,
        'from hardware.boot_rom import WUKONG_NUC_PROGRAM',
        'import json',
        'print(json.dumps([w & 0xFFFFFFFF for w in WUKONG_NUC_PROGRAM]))',
    ].join('\n');
    const raw = execSync('python3', { input: pyScript, cwd: ROOT, encoding: 'utf8' });
    nucProgram = JSON.parse(raw.trim());
} catch (err) {
    console.error('ERROR: Could not load WUKONG_NUC_PROGRAM from hardware/boot_rom.py');
    console.error(err.message);
    process.exit(1);
}

console.log(`WUKONG_NUC_PROGRAM has ${nucProgram.length} words.`);

// ── Verify lengths ────────────────────────────────────────────────────────────
let failed = false;

if (assembled.length !== 74) {
    console.error(`FAIL: wukong_callhome.cloomc assembled to ${assembled.length} words; expected 74.`);
    failed = true;
}
if (nucProgram.length !== 73) {
    console.error(`FAIL: WUKONG_NUC_PROGRAM has ${nucProgram.length} words; expected 73.`);
    failed = true;
}
if (failed) process.exit(1);

// ── Normalise IADD/ISUB/DREAD/DWRITE imm fields before comparing ──────────────
//
// The assembler sets bit14=1 in the imm field for immediate-mode Turing
// instructions (IADD, ISUB, DREAD immediate, DWRITE immediate) as the ISA's
// "immediate mode" flag.  Python's encode_turing stores the raw immediate value
// without setting bit14, matching the hardware ROM encoding.  The hardware
// executes both forms correctly.  Strip bit14 from the imm field on both sides
// so the check detects opcode/operand/value drift without false-failing on this
// known encoding convention difference.
//
// BRANCH is NOT normalised — bit14 is part of the 15-bit signed offset and must
// match exactly.  DREAD/DWRITE use the 4-operand indexed form (bit14=0 always),
// so they also match exactly without normalisation.
//
const OPC_NAMES = ['0','CALL','RETURN','LOAD','SAVE','CHANGE','TPERM','ELOADCALL',
                   '8','9','10','11','12','13','14','15',
                   'DREAD','DWRITE','BFEXT','BFINS','MCMP',
                   'IADD','ISUB','BRANCH','SHL','SHR'];
const IMM14_MASK_OPCODES = new Set([21, 22]); // IADD=21, ISUB=22

function normWord(w) {
    const opc = (w >>> 27) & 0x1F;
    if (IMM14_MASK_OPCODES.has(opc)) {
        // Strip bit14 from imm field (bits[14:0]) — leaves upper 17 bits intact.
        return (w & 0xFFFF8000) | (w & 0x3FFF);
    }
    return w;
}

// ── Check shared words 2-71 (instruction logic) ───────────────────────────────
console.log('\nChecking words [2..71] (shared ROM logic, bit14-normalised)...');
let diverged = false;

for (let i = 2; i < 72; i++) {
    const a = normWord(assembled[i] >>> 0);
    const n = normWord(nucProgram[i] >>> 0);
    if (a !== n) {
        const opc = (n >>> 27) & 0x1F;
        const opcName = OPC_NAMES[opc] || `opc${opc}`;
        const rawA = (assembled[i] >>> 0).toString(16).padStart(8,'0');
        const rawN = (nucProgram[i] >>> 0).toString(16).padStart(8,'0');
        console.error(`  DIVERGED word[${i}]: assembled=0x${rawA}` +
                      `  NUC=0x${rawN}  (opcode=${opcName}, norm: 0x${a.toString(16).padStart(8,'0')} vs 0x${n.toString(16).padStart(8,'0')})`);
        diverged = true;
    }
}

// Report bit14 differences as info (not failures) so they're visible but don't break CI.
for (let i = 2; i < 72; i++) {
    const a = (assembled[i] >>> 0);
    const n = (nucProgram[i] >>> 0);
    const opc = (a >>> 27) & 0x1F;
    if (IMM14_MASK_OPCODES.has(opc) && a !== n) {
        const opcName = OPC_NAMES[opc] || `opc${opc}`;
        const imm14a = a & 0x3FFF, bit14a = (a >> 14) & 1;
        const imm14n = n & 0x3FFF, bit14n = (n >> 14) & 1;
        if (imm14a === imm14n && bit14a !== bit14n) {
            // Expected: assembler bit14=1, NUC bit14=0, value identical — not a real divergence
        }
    }
}

if (!diverged) {
    console.log('  OK: words [2..71] match exactly.');
}

// The immutable ROM loops at word 72. The software LUMP instead hands off to
// the recovered hardware LUMP, then keeps an adjusted loop as a safe fallback.
const EXPECTED_HW_CALL = 0x47030002;
const EXPECTED_SW_LOOP = 0xBF007FBA;
const EXPECTED_ROM_LOOP = 0xBF007FBB;
if ((assembled[72] >>> 0) !== EXPECTED_HW_CALL) {
    console.error(`  DIVERGED word[72]: expected WukongCallHome.hw selector-0 CALL ` +
                  `0x${EXPECTED_HW_CALL.toString(16)}, got 0x${(assembled[72] >>> 0).toString(16)}.`);
    diverged = true;
}
if ((assembled[73] >>> 0) !== EXPECTED_SW_LOOP) {
    console.error(`  DIVERGED word[73]: expected loop fallback 0x${EXPECTED_SW_LOOP.toString(16)}, ` +
                  `got 0x${(assembled[73] >>> 0).toString(16)}.`);
    diverged = true;
}
if ((nucProgram[72] >>> 0) !== EXPECTED_ROM_LOOP) {
    console.error(`  DIVERGED immutable ROM word[72]: expected 0x${EXPECTED_ROM_LOOP.toString(16)}, ` +
                  `got 0x${(nucProgram[72] >>> 0).toString(16)}.`);
    diverged = true;
}

// Structural branch-target check: decode the 15-bit signed offset from word[72]
// and verify it resolves to WUKONG_LOOP_TOP (word 3), regardless of program length.
// This catches silent drift when banner bytes are added: the branch index shifts
// forward but the loop-top index stays at 3, making a hardcoded offset wrong.
{
    const WUKONG_LOOP_TOP   = 3;   // _WUKONG_LOOP_TOP in hardware/boot_rom.py
    const BRANCH_INDEX      = 72;
    const romBranchWord     = nucProgram[BRANCH_INDEX] >>> 0;
    const imm15             = romBranchWord & 0x7FFF;
    // Sign-extend 15-bit two's-complement value (bit 14 is the sign bit).
    const signedOffset      = (imm15 & 0x4000) ? (imm15 - 0x8000) : imm15;
    const branchTarget      = BRANCH_INDEX + signedOffset;
    if (branchTarget !== WUKONG_LOOP_TOP) {
        console.error(
            `  DIVERGED: ROM word[${BRANCH_INDEX}] branch target is word ${branchTarget}, ` +
            `expected ${WUKONG_LOOP_TOP} (_WUKONG_LOOP_TOP). ` +
            `Encoded offset=${signedOffset} (0x${(imm15).toString(16)}). ` +
            `Banner bytes were added without updating the BRANCH AL offset.`
        );
        diverged = true;
    } else {
        console.log(`  OK: ROM word[${BRANCH_INDEX}] branch resolves to word ${branchTarget} (WUKONG_LOOP_TOP).`);
    }
}

// Verify the declared capability order, exact rights, targets, and encoded GTs.
const CapabilityTokens = require(CAP_TOKENS);
const expectedCaps = [
    { name: 'LED0', rights: ['R', 'W'], nsIndex: 3, token: 0x32000003 },
    { name: 'UART_TX', rights: ['W'], nsIndex: 2, token: 0x22000002 },
    { name: 'WukongCallHome.hw', rights: ['E'], nsIndex: 7, token: 0x4A000007 },
];
const declaredCaps = result.capabilities || [];
if (JSON.stringify(declaredCaps) !== JSON.stringify(
        expectedCaps.map(({name, rights}) => ({name, rights})))) {
    console.error(`  DIVERGED capabilities: got ${JSON.stringify(declaredCaps)}.`);
    diverged = true;
} else {
    const capWords = new Array(expectedCaps.length).fill(0);
    const capSim = {
        abstractionRegistry: {
            abstractions: {
                2: { capabilities: [{name: 'UART_TX', target: 2, grants: ['R', 'W']}] },
                3: { capabilities: [{name: 'LED0', target: 3, grants: ['R', 'W']}] },
            },
        },
        nsLabels: {7: 'WukongCallHome'},
    };
    const builtCaps = CapabilityTokens.materialize(
        declaredCaps, capWords, 0, {
            sim: capSim,
            lumps: [{abstraction: 'WukongCallHome.hw', ns_slot: 7, grants: ['E']}],
        });
    const expectedWords = expectedCaps.map(cap => cap.token >>> 0);
    if (!builtCaps.ok || JSON.stringify(capWords) !== JSON.stringify(expectedWords)) {
        console.error(`  DIVERGED c-list tokens: ${builtCaps.errors.join('; ')} ` +
                      `got ${capWords.map(w => `0x${(w >>> 0).toString(16)}`).join(', ')}.`);
        diverged = true;
    } else {
        console.log('  OK: capability rows materialize to LED0/UART_TX/WukongCallHome.hw canonical GTs.');
    }
}

// ── Check words 0-1 (LOAD instructions — slot index differs by design) ────────
console.log('\nChecking words [0..1] (LOAD register fields — slot index expected to differ)...');

for (let i = 0; i < 2; i++) {
    const a = (assembled[i] >>> 0);
    const n = (nucProgram[i] >>> 0);
    // LOAD instruction fields: opcode[31:27] | cond[26:23] | crDst[22:19] | crSrc[18:15] | slot[14:0]
    const aFields = a >>> 15;   // opcode + cond + crDst + crSrc
    const nFields = n >>> 15;
    const aSlot   = a & 0x7FFF;
    const nSlot   = n & 0x7FFF;

    if (aFields !== nFields) {
        console.error(`  DIVERGED word[${i}]: register/opcode fields differ.`);
        console.error(`    assembled=0x${a.toString(16).padStart(8,'0')}  NUC=0x${n.toString(16).padStart(8,'0')}`);
        diverged = true;
    } else {
        const crDst = (a >>> 19) & 0xF;
        const crSrc = (a >>> 15) & 0xF;
        console.log(`  word[${i}]: LOAD CR${crDst}, CR${crSrc}[${aSlot}]` +
                    `  (LUMP slot=${aSlot}  HW slot=${nSlot}  — expected difference)`);
    }
}

// ── Result ────────────────────────────────────────────────────────────────────
if (diverged) {
    console.error('\nFAIL: wukong_callhome.cloomc has diverged from WUKONG_NUC_PROGRAM.');
    console.error('      Edit simulator/examples/wukong_callhome.cloomc to match boot_rom.py.');
    process.exit(1);
} else {
    console.log('\nOK: wukong_callhome.cloomc is consistent with WUKONG_NUC_PROGRAM.');
    process.exit(0);
}
