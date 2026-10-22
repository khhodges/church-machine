'use strict';

// Genesis-side image preparation only. This module does NOT execute manager
// methods, grant callers authority, install Namespace entries, or dispatch CALL.
// All name lookup, proof allocation and collision retries execute in CLOOMC.
const { randomFillSync } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const NAMES = Object.freeze([
    'ZERO', 'ONE', 'NEG_ONE', 'TWO', 'NEG_TWO', 'THREE', 'FOUR', 'FIVE',
    'TEN', 'HUNDRED', 'I', 'NEG_I', 'HALF', 'THIRD', 'QUARTER', 'FIFTH',
    'SIXTH', 'TENTH', 'TWO_THIRDS', 'THREE_QUARTERS',
    'SQRT_TWO', 'SQRT_THREE', 'SQRT_FIVE', 'SQRT_SIX', 'SQRT_SEVEN',
    'SQRT_TEN', 'SQRT_ELEVEN', 'SQRT_THIRTEEN', 'INV_SQRT_TWO',
    'INV_SQRT_THREE', 'CBRT_TWO', 'CBRT_THREE', 'CBRT_FIVE',
    'FOURTH_ROOT_TWO', 'GOLDEN_RATIO', 'INV_GOLDEN_RATIO', 'SILVER_RATIO',
    'PLASTIC_RATIO', 'TRIBONACCI_CONSTANT', 'SUPERGOLDEN_RATIO',
    'PI', 'TAU', 'HALF_PI', 'QUARTER_PI', 'THIRD_PI', 'SIXTH_PI',
    'EIGHTH_PI', 'TWELFTH_PI', 'DEG_TO_RAD', 'RAD_TO_DEG', 'INV_PI',
    'INV_TAU', 'TWO_OVER_PI', 'FOUR_OVER_PI', 'PI_SQUARED', 'SQRT_PI',
    'SQRT_TAU', 'INV_SQRT_TAU', 'SQRT_TWO_OVER_PI', 'TWO_OVER_SQRT_PI',
    'E', 'E_SQUARED', 'E_CUBED', 'INV_E', 'SQRT_E', 'E_TO_PI', 'E_TO_NEG_PI',
    'TWO_TO_SQRT_TWO', 'LN_TWO', 'LN_THREE', 'LN_FIVE', 'LN_TEN', 'LN_PI',
    'LN_GOLDEN_RATIO', 'LOG2_E', 'LOG10_E', 'LOG2_TEN', 'LOG10_TWO',
    'LN_TWO_SQUARED', 'LN_SQRT_TWO', 'EULER_MASCHERONI', 'CATALAN', 'APERY',
    'ZETA_FIVE', 'ZETA_SEVEN', 'ZETA_NINE', 'KHINCHIN', 'GLAISHER_KINKELIN',
    'FEIGENBAUM_DELTA', 'FEIGENBAUM_ALPHA', 'OMEGA', 'LIOUVILLE',
    'CHAMPERNOWNE_BASE10', 'CONWAY', 'BRUN_TWIN_PRIMES',
    'TWIN_PRIME_CONSTANT', 'MEISSEL_MERTENS', 'LANDAU_RAMANUJAN',
    'LAPLACE_LIMIT', 'RAMANUJAN_SOLDNER',
]);
const ALIASES = Object.freeze({ PHI: 'GOLDEN_RATIO' });
const RECORD_WORDS = 33;
const MAX_NAME = 31;

function packAbstract(subtype, payload) {
    if (![0, 1].includes(subtype) || !Number.isInteger(payload) ||
        payload < 0 || payload > 0x7ffffff) throw new RangeError('Invalid Abstract subtype/payload');
    return ((subtype << 29) | (3 << 25) | (payload & 0x1ffffff) |
        ((payload >>> 25) << 27)) >>> 0;
}

function encodeName(name) {
    if (typeof name !== 'string' || !/^[\x21-\x7e]{1,31}$/.test(name)) {
        throw new RangeError('Name must be 1..31 printable non-space ASCII characters');
    }
    // Word zero is reserved for the DATA LUMP header supplied by the installer.
    return Uint32Array.from([0, name.length, ...Array.from(name, c => c.charCodeAt(0))]);
}

function catalogueImage() {
    const entries = NAMES.map((name, i) => [name, packAbstract(0, i + 1)]);
    for (const [alias, canonical] of Object.entries(ALIASES)) {
        entries.push([alias, entries[NAMES.indexOf(canonical)][1]]);
    }
    const words = new Uint32Array(2 + RECORD_WORDS * entries.length);
    words[1] = entries.length;
    entries.forEach(([name, token], i) => {
        const p = 2 + i * RECORD_WORDS;
        words[p] = name.length;
        words[p + 1] = token;
        words.set(encodeName(name).slice(2), p + 2);
    });
    return words;
}

function stateImage(capacity = 64) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1024) {
        throw new RangeError('Proof capacity must be 1..1024');
    }
    const words = new Uint32Array(6 + capacity * RECORD_WORDS);
    words[2] = capacity;
    return words;
}

function randomImage(count = 256) {
    if (!Number.isInteger(count) || count < 1 || count > 1048576) {
        throw new RangeError('Random input count must be 1..1048576');
    }
    const words = new Uint32Array(count + 2);
    words[1] = count;
    randomFillSync(words.subarray(2)); // throws on failure; never Math.random
    return words;
}

function source() {
    return fs.readFileSync(path.join(__dirname, 'cloomc/abstract_gt_manager.cloomc'), 'utf8');
}

module.exports = { NAMES, ALIASES, RECORD_WORDS, MAX_NAME, packAbstract,
    encodeName, catalogueImage, stateImage, randomImage, source };
