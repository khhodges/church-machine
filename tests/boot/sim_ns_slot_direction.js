// Harness: verify NS slot addresses count DOWN from the top of the NS region.
//
// Creates a ChurchSimulator with A7-profile memory (131072 words), writes a
// distinct sentinel to each of slots 0 and 1 via writeNSEntry(), then scans
// memory to confirm the sentinels land at the count-DOWN addresses specified
// in cloomc-foundation.md §5:
//
//   slot 0 → word 0x1FFFC  (= 131072 - 4)
//   slot 1 → word 0x1FFF8  (= 131072 - 8)
//
// Output (JSON to stdout):
//   {
//     "ns_table_base":  <hex string>,
//     "ns_table_reserve": <decimal>,
//     "slot0_base":     <decimal>,
//     "slot1_base":     <decimal>,
//     "slot0_expected": <decimal>,
//     "slot1_expected": <decimal>,
//     "slot0_ok":       <bool>,
//     "slot1_ok":       <bool>,
//     "sentinel0_found_at": <decimal | null>,
//     "sentinel1_found_at": <decimal | null>
//   }

const TOTAL_WORDS    = 131072;   // A7 profile: 131072 × 4 = 512 KB
const SLOT0_EXPECTED = TOTAL_WORDS - 4;   // 0x1FFFC
const SLOT1_EXPECTED = TOTAL_WORDS - 8;   // 0x1FFF8

const SENTINEL0 = 0xCA110001 >>> 0;
const SENTINEL1 = 0xCA110002 >>> 0;

global.window = {
    bootConfig: {
        step1: {
            totalNamespaceWords: TOTAL_WORDS,
            namespaceLumpWords:  64,
            threadLumpWords:     256,
        },
    },
};

const ChurchSimulator = require('../../simulator/simulator.js');

const sim = new ChurchSimulator();

// The simulator initialises with a default 65536-word memory; we need to
// rebuild it with A7-profile memory so NS_TABLE_BASE reflects 131072 words.
// Recreate with the correct totalNamespaceWords config.
sim.memory     = new Uint32Array(TOTAL_WORDS);
sim.NS_TABLE_RESERVE = 4096;   // default 1024-entry table (4096 words)
sim.NS_TABLE_BASE    = TOTAL_WORDS - sim.NS_TABLE_RESERVE;   // 0x1FC00
sim.MAX_NS_ENTRIES   = sim.NS_TABLE_RESERVE / sim.NS_ENTRY_WORDS;

// Write sentinel word0 values to slots 0 and 1.
// writeNSEntry(idx, location, limit17, bFlag, gBit, gtType, version, clistCount, abstract_gt)
sim.writeNSEntry(0, SENTINEL0, 0x3FFFF, 0, 0, 1, 0, 0, 0);
sim.writeNSEntry(1, SENTINEL1, 0x00100, 0, 0, 1, 0, 0, 0);

// Locate where each sentinel actually landed in memory.
let sentinel0At = null;
let sentinel1At = null;
for (let i = 0; i < TOTAL_WORDS; i++) {
    if (sim.memory[i] === SENTINEL0 && sentinel0At === null) sentinel0At = i;
    if (sim.memory[i] === SENTINEL1 && sentinel1At === null) sentinel1At = i;
}

const slot0Base = sim._nsSlotBase(0);
const slot1Base = sim._nsSlotBase(1);

const result = {
    ns_table_base:     '0x' + sim.NS_TABLE_BASE.toString(16).toUpperCase(),
    ns_table_reserve:  sim.NS_TABLE_RESERVE,
    slot0_base:        slot0Base,
    slot1_base:        slot1Base,
    slot0_expected:    SLOT0_EXPECTED,
    slot1_expected:    SLOT1_EXPECTED,
    slot0_ok:          slot0Base === SLOT0_EXPECTED && sentinel0At === SLOT0_EXPECTED,
    slot1_ok:          slot1Base === SLOT1_EXPECTED && sentinel1At === SLOT1_EXPECTED,
    sentinel0_found_at: sentinel0At,
    sentinel1_found_at: sentinel1At,
};

process.stdout.write(JSON.stringify(result) + '\n');
