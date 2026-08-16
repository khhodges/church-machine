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
 *   word[1..N]          = dispatch table (N = method count)
 *                           public entry  = lump-word offset of body (1-based)
 *                           private entry = 0  (PRIVATE_METHOD fault on external CALL)
 *   word[N+1..cw]       = concatenated method code words
 *   word[lumpSize-cc..] = c-list entries (0 = unresolved server-side)
 *
 * Header layout (32 bits):
 *   [31:27] = 0x1F  (LUMP type tag)
 *   [26:23] = nMinus6   (log2(lumpSize) - 6)
 *   [22:10] = cw        (code-word count, 13 bits; includes dispatch table)
 *   [9:8]   = 00        (object type: 00 = lump/abstraction; see CM_LUMP_SPECIFICATION.md §Header typ field)
 *   [7:0]   = cc        (c-list count)
 *
 * Dispatch table:
 *   Mirrors the logic in simulator/app-compile.js loadCLOOMCIntoSim()
 *   (lines 1799-1817).  Entry value = lump-word offset of body start
 *   (codeOffset + 1, 1-based because word 0 is the header).  Private
 *   methods get entry 0, which the hardware interprets as PRIVATE_METHOD.
 *
 * Cross-method BRANCH patching:
 *   When a CLOOMC++ method calls a private same-abstraction helper, the
 *   compiler emits a BRANCH with offset=0 and records the reference in
 *   method.crossMethodRefs = [{addr, target}].  buildLump resolves these
 *   after computing all body offsets.
 */

/**
 * @param {object} result    Output of CLOOMCCompiler.compile() or a specific
 *                           compile* method.  Requires:
 *                             result.methods[]  — array of {name, code, visibility,
 *                                                  aliasOf?, crossMethodRefs?}
 *                             result.capabilities[] — array of {name, rights}
 * @param {object} [opts]
 *   opts.allocationWords    Minimum lump size in words (must be power of 2 ≥ 64).
 *                           Lump will grow to the next power of 2 that fits if
 *                           1 + cw + cc exceeds this value.
 *
 * @returns {{
 *   words:      number[],   flat array of 32-bit unsigned words
 *   header:     number,     words[0]
 *   cw:         number,     code-word count (dispatch table + all bodies)
 *   cc:         number,     c-list count
 *   lumpSize:   number,     total lump size in words (power of 2, ≥ 64)
 *   clistStart: number,     index of the first c-list word
 * }}
 */
function buildLump(result, opts) {
    opts = opts || {};
    const methods = result.methods || [];
    const caps    = result.capabilities || [];

    const N = methods.length; // total methods = dispatch table size

    // ── Pass 1: compute lump-PC (0-indexed from word 1) of each method body ──
    // The dispatch table occupies lump-PCs 0..N-1, so the first body starts at N.
    let codeOffset = N;
    const methodBodyOffsets = {}; // name → lump-PC of first body word
    for (const m of methods) {
        if (!m.aliasOf) {
            methodBodyOffsets[m.name] = codeOffset;
            codeOffset += (m.code || []).length;
        }
    }

    // ── Pass 2: build dispatch table (N entries) ──
    // Public entry  = bodyOffset + 1  (1-based lump-word address of body start)
    // Private entry = 0               (PRIVATE_METHOD fault on external CALL)
    // Alias entry   = same lump-word as the method it aliases (public alias only)
    const allCode = [];
    for (const m of methods) {
        if (m.visibility === 'private') {
            allCode.push(0);
        } else if (m.aliasOf) {
            const aliasedOff = methodBodyOffsets[m.aliasOf];
            allCode.push(aliasedOff !== undefined ? aliasedOff + 1 : 0);
        } else {
            const bodyOff = methodBodyOffsets[m.name];
            allCode.push(bodyOff !== undefined ? bodyOff + 1 : 0);
        }
    }

    // ── Pass 3: append body words (aliases share a body; skip them here) ──
    for (const m of methods) {
        if (!m.aliasOf) {
            for (const w of (m.code || [])) allCode.push(w >>> 0);
        }
    }

    // ── Pass 4: patch cross-method BRANCH placeholders ──
    // The CLOOMC++ compiler emits BRANCH offset=0 for intra-LUMP private helper
    // calls and records {addr, target} in method.crossMethodRefs.  Now that we
    // know every body's lump-PC we can compute the correct relative offset.
    //
    // BRANCH encoding: new_pc = branch_lump_pc + relOffset
    //   ⇒ relOffset = targetLumpPC - branchLumpPC
    for (const m of methods) {
        if (!m.crossMethodRefs || !m.crossMethodRefs.length) continue;
        const srcBodyStart = methodBodyOffsets[m.name];
        if (srcBodyStart === undefined) continue;
        for (const ref of m.crossMethodRefs) {
            const targetBodyStart = methodBodyOffsets[ref.target];
            if (targetBodyStart === undefined) continue;
            // branchLumpPC = position of the BRANCH word in allCode
            //              = srcBodyStart + ref.addr
            //   (allCode[0..N-1] are table entries; allCode[N..] are body words;
            //    srcBodyStart already equals N + sum(prev body lengths))
            const branchLumpPC = srcBodyStart + ref.addr;
            const relOffset    = targetBodyStart - branchLumpPC;
            allCode[branchLumpPC] = (allCode[branchLumpPC] & ~0x7FFF) | (relOffset & 0x7FFF);
            allCode[branchLumpPC] = allCode[branchLumpPC] >>> 0;
        }
    }

    const cw = allCode.length; // N (dispatch table) + total body words
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
