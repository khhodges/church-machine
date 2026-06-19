'use strict';

/**
 * simulator/lump_builder.js — server-side lump binary assembly (Node.js)
 *
 * Extracts the binary-packing logic from simulator/app-compile.js so it can
 * be required() from a Node subprocess without any browser API dependencies.
 *
 * Takes a CLOOMCCompiler result object and packs it into the flat word-array
 * format used by the Church Machine runtime:
 *
 *   word[0]             = header (type tag + size fields + cw + cc)
 *   word[1..cw]         = concatenated method code words
 *   word[lumpSize-cc..] = c-list entries (0 = unresolved server-side)
 *
 * Header layout (32 bits):
 *   [31:27] = 0x1F  (LUMP type tag)
 *   [26:23] = nMinus6   (log2(lumpSize) - 6)
 *   [22:10] = cw        (code-word count, 13 bits)
 *   [9:8]   = 00        (gt_type = Inform)
 *   [7:0]   = cc        (c-list count)
 */

/**
 * @param {object} result    Output of CLOOMCCompiler.compile() or a specific
 *                           compile* method.  Requires:
 *                             result.methods[]  — array of {code: number[]}
 *                             result.capabilities[] — array of {name, rights}
 * @param {object} [opts]
 *   opts.allocationWords    Minimum lump size in words (must be power of 2 ≥ 64).
 *                           Lump will grow to the next power of 2 that fits if
 *                           1 + cw + cc exceeds this value.
 *
 * @returns {{
 *   words:      number[],   flat array of 32-bit unsigned words
 *   header:     number,     words[0]
 *   cw:         number,     code-word count
 *   cc:         number,     c-list count
 *   lumpSize:   number,     total lump size in words (power of 2, ≥ 64)
 *   clistStart: number,     index of the first c-list word
 * }}
 */
function buildLump(result, opts) {
    opts = opts || {};
    const methods = result.methods || [];
    const caps    = result.capabilities || [];

    const allCode = [];
    for (const m of methods) {
        const words = m.code || [];
        for (let i = 0; i < words.length; i++) allCode.push(words[i]);
    }

    const cw = allCode.length;
    const cc = caps.length;

    let lumpSize = (opts.allocationWords && opts.allocationWords >= 64)
        ? opts.allocationWords
        : 64;
    while (lumpSize < 1 + cw + cc) lumpSize <<= 1;

    let nMinus6 = 0;
    while ((64 << nMinus6) < lumpSize) nMinus6++;

    const header = (((0x1F) << 27) |
                    ((nMinus6 & 0x0F) << 23) |
                    ((cw & 0x1FFF) << 10) |
                    ((0 & 0x03) << 8) |
                    (cc & 0xFF)) >>> 0;

    const words = new Array(lumpSize).fill(0);
    words[0] = header;

    for (let i = 0; i < cw; i++) {
        words[1 + i] = (allCode[i] >>> 0);
    }

    const clistStart = lumpSize - cc;
    for (let i = 0; i < cc; i++) {
        words[clistStart + i] = 0;
    }

    return { words, header, cw, cc, lumpSize, clistStart };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildLump };
}
