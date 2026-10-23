'use strict';

// Genesis-side image preparation only. This module does NOT execute manager
// Constants/Passkey methods, grant callers authority, install Namespace entries, or dispatch CALL.
// All name lookup, proof allocation and collision retries execute in CLOOMC.
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
const CONSTANT_RECORD_WORDS = 36;
const MAX_NAME = 31;
const FRACTION_BITS = 16;
const SCALE = 2 ** FRACTION_BITS;
const phi = (1 + Math.sqrt(5)) / 2;
// Mathematical approximations used only to prepare the read-only catalogue.
// Runtime lookup and numerical access execute in CLOOMC, not in this helper.
const REAL_VALUES = Object.freeze([
    0, 1, -1, 2, -2, 3, 4, 5, 10, 100, 0, 0,
    1/2, 1/3, 1/4, 1/5, 1/6, 1/10, 2/3, 3/4,
    Math.sqrt(2), Math.sqrt(3), Math.sqrt(5), Math.sqrt(6), Math.sqrt(7),
    Math.sqrt(10), Math.sqrt(11), Math.sqrt(13), 1/Math.sqrt(2), 1/Math.sqrt(3),
    Math.cbrt(2), Math.cbrt(3), Math.cbrt(5), 2 ** 0.25, phi, 1/phi,
    1 + Math.sqrt(2), 1.324717957244746, 1.839286755214161, 1.465571231876768,
    Math.PI, 2*Math.PI, Math.PI/2, Math.PI/4, Math.PI/3, Math.PI/6,
    Math.PI/8, Math.PI/12, Math.PI/180, 180/Math.PI, 1/Math.PI, 1/(2*Math.PI),
    2/Math.PI, 4/Math.PI, Math.PI**2, Math.sqrt(Math.PI), Math.sqrt(2*Math.PI),
    1/Math.sqrt(2*Math.PI), Math.sqrt(2/Math.PI), 2/Math.sqrt(Math.PI),
    Math.E, Math.E**2, Math.E**3, 1/Math.E, Math.sqrt(Math.E), Math.exp(Math.PI),
    Math.exp(-Math.PI), 2**Math.sqrt(2), Math.log(2), Math.log(3), Math.log(5),
    Math.log(10), Math.log(Math.PI), Math.log(phi), Math.LOG2E, Math.LOG10E,
    Math.log2(10), Math.log10(2), Math.log(2)**2, Math.log(2)/2,
    0.5772156649015329, 0.915965594177219, 1.202056903159594,
    1.03692775514337, 1.008349277381923, 1.002008392826082,
    2.685452001065306, 1.282427129100623, 4.66920160910299, 2.502907875095893,
    0.5671432904097838, 0.110001, 0.12345678910111213, 1.303577269034296,
    1.902160583104, 0.6601618158468696, 0.2614972128476428,
    0.7642236535892207, 0.6627434193491816, 1.451369234883381,
]);
function fixed(value) {
    if (!Number.isFinite(value) || value < -32768 || value >= 32768) {
        throw new RangeError('Q16.16 value out of range');
    }
    const rounded = Math.round(value * SCALE);
    if (rounded > 0x7fffffff) throw new RangeError('Q16.16 rounding overflow');
    return rounded >>> 0;
}

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
    if (REAL_VALUES.length !== NAMES.length) throw new Error('Incomplete constants catalogue');
    const entries = NAMES.map((name, i) => [name, packAbstract(0, i + 1),
        fixed(REAL_VALUES[i]), fixed(name === 'I' ? 1 : name === 'NEG_I' ? -1 : 0)]);
    for (const [alias, canonical] of Object.entries(ALIASES)) {
        entries.push([alias, ...entries[NAMES.indexOf(canonical)].slice(1)]);
    }
    const words = new Uint32Array(2 + CONSTANT_RECORD_WORDS * entries.length);
    words[1] = entries.length;
    entries.forEach(([name, token, real, imaginary], i) => {
        const p = 2 + i * CONSTANT_RECORD_WORDS;
        words[p] = name.length;
        words[p + 1] = token;
        words.set(encodeName(name).slice(2), p + 2);
        words.set([real, imaginary, FRACTION_BITS], p + 33);
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

function source(kind) {
    if (!['constants', 'passkey'].includes(kind)) throw new Error('Select constants or passkey explicitly');
    return fs.readFileSync(path.join(__dirname, 'cloomc', kind + '.cloomc'), 'utf8');
}

module.exports = { NAMES, ALIASES, RECORD_WORDS, MAX_NAME, packAbstract,
    CONSTANT_RECORD_WORDS, REAL_VALUES, FRACTION_BITS, SCALE, fixed,
    encodeName, catalogueImage, stateImage, source };
