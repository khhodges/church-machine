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

// ── V1.3 self-defining freespace ─────────────────────────────────────────────
// Every typ=lump binary carries an 0xAB-tagged content frame in freespace
// (CM_LUMP_SPECIFICATION.md §Freespace Content and Self-Definition):
//   word cw+1   = 0xAB<<24 | flags<<16 | api_byte_length
//   words cw+2… = API definition JSON (UTF-8, big-endian packed, zero-padded)
//   tier ≥ 1    : one word source_byte_length, then source bytes (same packing)
//   remainder   = all zero (mandatory)
// flags: 0x00 = API only (Tier 0), 0x01 = API + source w/o comments (Tier 1),
//        0x03 = API + full source (Tier 2, the default).

const CONTENT_MAGIC = 0xAB;
const TIER_FLAGS = { 0: 0x00, 1: 0x01, 2: 0x03 };
const N_MAX = 15;

/** Strip comment-only lines and trailing comments for Tier 1 embedding. */
function stripComments(src) {
    return src.split('\n')
        .map(l => l.replace(/;.*$/, '').replace(/\/\/.*$/, ''))
        .filter(l => l.trim().length > 0)
        .join('\n');
}

/**
 * Build the embeddable API definition from a compile result + built words.
 * Never includes `token` or `issue` — identity lives outside the binary
 * (embedding the token would be a circular fixed point).
 */
function buildApiDefinition(result, words) {
    const methods = result.methods || [];
    const api = {
        name: result.abstractionName || '',
        language: result.language || 'assembly',
        returnConvention: { register: 'DR0', description: 'return value' },
        methods: [],
        capabilities: (result.capabilities || []).map(cap => ({
            name: cap.name || '',
            rights: Array.isArray(cap.rights) ? cap.rights.slice() : [],
        })),
    };
    methods.forEach((m, i) => {
        if (m.visibility === 'private') return;
        const branchOffset = words && (1 + i) < words.length ? (words[1 + i] & 0x7FFF) : 0;
        const inputs = (m.params || []).map((p, pi) => ({ name: p, register: `DR${pi + 1}` }));
        api.methods.push({
            name: m.name,
            index: i,
            branchOffset,
            inputs,
            returns: { name: 'result', register: 'DR0' },
        });
    });
    return api;
}

/** UTF-8 string → array of big-endian packed words (zero-padded). */
function packBEWords(str) {
    const bytes = Buffer.from(str, 'utf-8');
    const out = [];
    for (let i = 0; i < bytes.length; i += 4) {
        out.push((((bytes[i] || 0) << 24) | ((bytes[i + 1] || 0) << 16) |
                  ((bytes[i + 2] || 0) << 8) | (bytes[i + 3] || 0)) >>> 0);
    }
    return { words: out, byteLength: bytes.length };
}

/**
 * Embed the 0xAB content frame into a built lump's freespace, growing the
 * lump (next power of 2, c-list moved to the new end) when the frame does
 * not fit. Returns the (possibly new) words array. Throws if the frame will
 * not fit even at the maximum size (n=15).
 *
 * @param {number[]} words  built lump words (words[0] = header)
 * @param {object}   api    API definition object (buildApiDefinition output)
 * @param {string}   source full source text
 * @param {number}   tier   0 | 1 | 2 (default 2 — full source + comments)
 */
function embedSelfDefinition(words, api, source, tier) {
    if (tier === undefined || tier === null) tier = 2;
    if (!(tier in TIER_FLAGS)) throw new Error(`unknown tier ${tier} — one of 0, 1, 2`);
    if (tier >= 1 && (!source || !source.length)) {
        throw new Error(`tier ${tier} requires non-empty source`);
    }
    if (api && ('token' in api || 'issue' in api)) {
        throw new Error("API payload must not contain 'token' or 'issue'");
    }

    const header = words[0] >>> 0;
    let nMinus6  = (header >>> 23) & 0x0F;
    const cw     = (header >>> 10) & 0x1FFF;
    const cc     = header & 0xFF;
    const typ    = (header >>> 8) & 0x03;

    const apiPacked = packBEWords(JSON.stringify(api || { name: '', methods: [] }));
    if (apiPacked.byteLength === 0 || apiPacked.byteLength > 0xFFFF) {
        throw new Error(`API definition size out of range: ${apiPacked.byteLength} bytes`);
    }
    let srcPacked = { words: [], byteLength: 0 };
    if (tier >= 1) {
        srcPacked = packBEWords(tier === 1 ? stripComments(source) : source);
    }
    const need = 1 + apiPacked.words.length +
                 (tier >= 1 ? 1 + srcPacked.words.length : 0);

    let n = nMinus6 + 6;
    while (((1 << n) - 1 - cw - cc) < need && n < N_MAX) n++;
    if (((1 << n) - 1 - cw - cc) < need) {
        throw new Error(`content frame (${need} words) does not fit the biggest lump`);
    }

    const lumpSize = 1 << n;
    const out = new Array(lumpSize).fill(0);
    out[0] = (((0x1F) << 27) | (((n - 6) & 0x0F) << 23) |
              ((cw & 0x1FFF) << 10) | ((typ & 0x03) << 8) | (cc & 0xFF)) >>> 0;
    for (let i = 0; i < cw; i++) out[1 + i] = words[1 + i] >>> 0;
    const oldSize = words.length;
    for (let i = 0; i < cc; i++) {
        out[lumpSize - cc + i] = words[oldSize - cc + i] >>> 0;
    }

    let pos = 1 + cw;
    out[pos++] = ((CONTENT_MAGIC << 24) | (TIER_FLAGS[tier] << 16) |
                  (apiPacked.byteLength & 0xFFFF)) >>> 0;
    for (const w of apiPacked.words) out[pos++] = w;
    if (tier >= 1) {
        out[pos++] = srcPacked.byteLength >>> 0;
        for (const w of srcPacked.words) out[pos++] = w;
    }
    return out;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildLump, embedSelfDefinition, buildApiDefinition, stripComments };
}
