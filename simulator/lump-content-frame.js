'use strict';
/**
 * lump-content-frame.js — V1.3 0xAB self-definition content frame helpers
 *
 * Shared by app-lumps.js (production) and test_lump_roundtrip.js (tests).
 * Testing this module is equivalent to testing the production encode/decode paths.
 *
 * Exports (via module.exports in Node.js; via window.LumpContentFrame in browser):
 *
 *   lumpFrameUtf8Bytes(str)  → Array<number>
 *       UTF-8 encode a string to a byte array.
 *
 *   lumpFramePackBE(bytes)   → Array<number>  (32-bit unsigned words)
 *       Pack a byte array big-endian into a word array (last word zero-padded).
 *
 *   lumpFrameDeflateRaw(bytes)  → Promise<Array<number>>
 *       Deflate-raw compress a byte array via native CompressionStream.
 *       Throws if CompressionStream is not available.
 *
 *   lumpBuildContentFrame(apiObj, srcText, options)  → Promise<{frameWords, flags}>
 *       Build the 0xAB frame word array for a LUMP freespace zone.
 *       apiObj  — plain object to JSON-encode as the API definition
 *                 (must NOT contain token or issue — circular hash rule).
 *       srcText — source string to embed.
 *       options.profile — 'api', 'compact', or 'full' (defaults to 'full').
 *       Compression uses flags 0x05/0x07 and falls back to 0x01/0x03 when
 *       CompressionStream is unavailable.
 *       frameWords[0] is the 0xAB header word; frameWords.length gives the
 *       total word count the caller must reserve in the freespace zone.
 *
 *   lumpDecodeContentFrame(serverWords)  → Promise<string|null>
 *       Parse the 0xAB content frame from a full LUMP word array and return
 *       the embedded source string, or null when absent / malformed.
 *       Decompression (flags & 0x04) is performed via DecompressionStream.
 *       Silent exceptions return null (caller falls through to sidecar/disasm).
 *
 * CM_LUMP_SPECIFICATION.md §Freespace Content and Self-Definition,
 * §Mint Validation Sequence step 7.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * UTF-8 encode a string to a byte array.
 * Uses TextEncoder when available (browser + Node ≥ 11); manual fallback
 * covers BMP characters only (no surrogate pairs) for legacy environments.
 */
function lumpFrameUtf8Bytes(s) {
    if (typeof TextEncoder !== 'undefined') {
        return Array.from(new TextEncoder().encode(String(s)));
    }
    var out = [];
    for (var _ci = 0; _ci < s.length; _ci++) {
        var _ch = s.charCodeAt(_ci);
        if (_ch < 0x80) {
            out.push(_ch);
        } else if (_ch < 0x800) {
            out.push(0xC0 | (_ch >> 6));
            out.push(0x80 | (_ch & 0x3F));
        } else {
            out.push(0xE0 | (_ch >> 12));
            out.push(0x80 | ((_ch >> 6) & 0x3F));
            out.push(0x80 | (_ch & 0x3F));
        }
    }
    return out;
}

/**
 * Pack a byte array big-endian into a 32-bit word array.
 * The last word is zero-padded to a full 4 bytes.
 */
function lumpFramePackBE(bytes) {
    var nw = Math.ceil(bytes.length / 4);
    var ws = new Array(nw).fill(0);
    for (var _bi = 0; _bi < bytes.length; _bi++) {
        ws[_bi >> 2] = (ws[_bi >> 2] | (bytes[_bi] << (24 - (_bi & 3) * 8))) >>> 0;
    }
    return ws;
}

/** Remove comment-only lines and trailing assembly / C-style line comments. */
function lumpFrameStripComments(source) {
    return String(source || '').split('\n')
        .map(function(line) { return line.replace(/;.*$/, '').replace(/\/\/.*$/, ''); })
        .filter(function(line) { return line.trim().length > 0; })
        .join('\n');
}

function lumpFrameOutputProfile(options) {
    var profile = options;
    if (options && typeof options === 'object') profile = options.profile || options.tier;
    if (profile === 0 || profile === '0' || profile === 'api') return 'api';
    if (profile === 1 || profile === '1' || profile === 'compact') return 'compact';
    if (profile === 2 || profile === '2' || profile === 'full' || profile == null) return 'full';
    throw new Error('Unknown LUMP output profile: ' + profile);
}

/**
 * Deflate-raw compress a byte array using the browser-native CompressionStream.
 * Returns a Promise that resolves to the compressed byte array.
 * Throws if CompressionStream is not available.
 */
async function lumpFrameDeflateRaw(bytes) {
    var cs = new CompressionStream('deflate-raw');
    var wr = cs.writable.getWriter();
    wr.write(new Uint8Array(bytes));
    wr.close();
    return Array.from(new Uint8Array(await new Response(cs.readable).arrayBuffer()));
}

// ── Production encode/decode ──────────────────────────────────────────────────

/**
 * Build the 0xAB content frame for embedding in a LUMP freespace zone.
 *
 * @param {object} apiObj  — JSON-serialisable API definition (no token/issue).
 * @param {string|null} srcText — source text to embed.
 * @param {{profile?: 'api'|'compact'|'full'}|string|number} [options]
 * @returns {Promise<{frameWords: number[], flags: number, profile: string,
 *                    apiBytesLength: number, sourceBytesLength: number}>}
 *   frameWords — complete frame word array; frameWords[0] is the 0xAB header.
 *   flags      — the flags byte written into frameWords[0][23:16]:
 *                  0x00 Tier 0 (API only)
 *                  0x01 Tier 1 compact uncompressed source
 *                  0x05 Tier 1 compact deflate-raw source
 *                  0x03 Tier 2 full uncompressed source
 *                  0x07 Tier 2 full deflate-raw source
 */
async function lumpBuildContentFrame(apiObj, srcText, options) {
    var _apiBytes = lumpFrameUtf8Bytes(JSON.stringify(apiObj));
    var _apiWds   = lumpFramePackBE(_apiBytes);
    if (_apiBytes.length > 0xFFFF) {
        throw new Error('Embedded API JSON exceeds the 65535-byte frame limit');
    }

    var _profile = lumpFrameOutputProfile(options);
    var _requestedProfile = options !== undefined && options !== null;
    var _srcText = (srcText && typeof srcText === 'string') ? srcText : '';
    if (_profile === 'compact') _srcText = lumpFrameStripComments(_srcText);
    if (_profile === 'api') _srcText = '';
    if (_profile !== 'api' && _srcText.trim().length === 0) {
        if (_requestedProfile) {
            throw new Error('The ' + _profile + ' output profile requires saved source');
        }
        _profile = 'api';
        _srcText = '';
    }
    var _srcRaw   = _srcText ? lumpFrameUtf8Bytes(_srcText) : null;
    var _srcBytes = null;
    var _compressed = false;

    if (_srcRaw) {
        try {
            _srcBytes   = await lumpFrameDeflateRaw(_srcRaw);
            _compressed = true;
        } catch (_ce) {
            _srcBytes   = _srcRaw;   // uncompressed fallback
            _compressed = false;
        }
    }

    var _srcWds  = _srcBytes ? lumpFramePackBE(_srcBytes) : null;
    var _flags   = 0x00;
    if (_srcWds) {
        _flags = _profile === 'compact'
            ? (_compressed ? 0x05 : 0x01)
            : (_compressed ? 0x07 : 0x03);
    }

    // frameWords layout:
    //   [0]           — 0xAB header  (filled below)
    //   [1..apiWords] — API JSON bytes packed big-endian
    //   [apiWords+1]  — source_byte_length word (only when has_source)
    //   [apiWords+2..] — source bytes packed big-endian (only when has_source)
    var _frameWds = [null].concat(_apiWds);
    if (_srcWds) {
        _frameWds = _frameWds.concat([_srcBytes.length >>> 0], _srcWds);
    }
    _frameWds[0] = ((0xAB << 24) | (_flags << 16) | (_apiBytes.length & 0xFFFF)) >>> 0;

    return {
        frameWords: _frameWds,
        flags: _flags,
        profile: _srcWds ? _profile : 'api',
        apiBytesLength: _apiBytes.length,
        sourceBytesLength: _srcBytes ? _srcBytes.length : 0
    };
}

/**
 * Decode the JSON API document from a valid 0xAB content frame.
 * Returns null when no frame or valid JSON API is available.
 */
function lumpDecodeContentFrameApi(serverWords) {
    try {
        if (!serverWords || serverWords.length === 0) return null;
        var _bhdr = serverWords[0] >>> 0;
        var _cw = (_bhdr >>> 10) & 0x1FFF;
        var _cc = _bhdr & 0xFF;
        var _sz = 64 << ((_bhdr >>> 23) & 0x0F);
        var _start = 1 + _cw;
        var _end = _sz - _cc;
        if (_start >= _end || _start >= serverWords.length) return null;
        var _hdr = serverWords[_start] >>> 0;
        if (((_hdr >>> 24) & 0xFF) !== 0xAB) return null;
        var _byteLength = _hdr & 0xFFFF;
        var _wordLength = Math.ceil(_byteLength / 4);
        if (_byteLength === 0 || _start + 1 + _wordLength > _end) return null;
        var _bytes = [];
        for (var _i = 0; _i < _wordLength; _i++) {
            var _word = serverWords[_start + 1 + _i] >>> 0;
            _bytes.push((_word >>> 24) & 0xFF, (_word >>> 16) & 0xFF,
                        (_word >>> 8) & 0xFF, _word & 0xFF);
        }
        return JSON.parse(new TextDecoder().decode(new Uint8Array(_bytes.slice(0, _byteLength))));
    } catch (_e) { return null; }
}

/**
 * Return the output profile encoded by a valid 0xAB content frame.
 * This is deliberately synchronous so Save/History UI can preserve and label
 * the allocation choice without decoding or inflating the embedded source.
 */
function lumpContentFrameProfile(serverWords) {
    try {
        if (!serverWords || serverWords.length === 0) return null;
        var _bhdr = serverWords[0] >>> 0;
        var _cw = (_bhdr >>> 10) & 0x1FFF;
        var _cc = _bhdr & 0xFF;
        var _sz = 64 << ((_bhdr >>> 23) & 0x0F);
        var _start = 1 + _cw;
        var _end = _sz - _cc;
        if (_start >= _end || _start >= serverWords.length) return null;
        var _frameHeader = serverWords[_start] >>> 0;
        if (((_frameHeader >>> 24) & 0xFF) !== 0xAB) return null;
        var _flags = (_frameHeader >>> 16) & 0xFF;
        if (_flags === 0x00) return 'api';
        if (_flags === 0x01 || _flags === 0x05) return 'compact';
        if (_flags === 0x03 || _flags === 0x07) return 'full';
        return null;
    } catch (_e) {
        return null;
    }
}

/**
 * Parse the 0xAB content frame from a complete LUMP word array and return the
 * embedded source string, or null when absent, malformed, or on any error.
 *
 * Mirrors the decode block in openLumpInEditor (app-lumps.js ~line 4694).
 * When flags bit 2 (0x04) is set the source region is inflated via
 * DecompressionStream('deflate-raw').
 *
 * @param {number[]|Uint32Array} serverWords — complete LUMP binary word array.
 * @returns {Promise<string|null>}
 */
async function lumpDecodeContentFrame(serverWords) {
    try {
        if (!serverWords || serverWords.length === 0) return null;
        var _bhdr  = serverWords[0] >>> 0;
        var _bCw   = (_bhdr >>> 10) & 0x1FFF;
        var _bCc   = _bhdr & 0xFF;
        var _bNm6  = (_bhdr >>> 23) & 0x0F;
        var _bSz   = 64 << _bNm6;
        var _bFsS  = 1 + _bCw;
        var _bFsE  = _bSz - _bCc;
        if (_bFsS >= _bFsE || _bFsS >= serverWords.length) return null;
        if ((((serverWords[_bFsS] >>> 0) >>> 24) & 0xFF) !== 0xAB) return null;

        var _fHdr    = serverWords[_bFsS] >>> 0;
        var _fFlags  = (_fHdr >>> 16) & 0xFF;
        var _fApiLen = _fHdr & 0xFFFF;
        var _fApiW   = Math.ceil(_fApiLen / 4);
        var _fCursor = _bFsS + 1 + _fApiW;
        if ((_fFlags & 0x01) === 0 || _fCursor >= _bFsE) return null;

        var _fSrcLen = serverWords[_fCursor] >>> 0;
        var _fSrcW   = Math.ceil(_fSrcLen / 4);
        if (_fSrcLen === 0 || _fCursor + 1 + _fSrcW > _bFsE) return null;

        // Unpack big-endian words → byte array, then trim to srcLen.
        var _fBytes = [];
        for (var _fsi = 0; _fsi < _fSrcW; _fsi++) {
            var _fsw = serverWords[_fCursor + 1 + _fsi] >>> 0;
            _fBytes.push((_fsw >>> 24) & 0xFF, (_fsw >>> 16) & 0xFF,
                         (_fsw >>>  8) & 0xFF,  _fsw         & 0xFF);
        }
        _fBytes = _fBytes.slice(0, _fSrcLen);

        if ((_fFlags & 0x04) !== 0 && typeof DecompressionStream !== 'undefined') {
            // Compressed — inflate with native DecompressionStream.
            var _ds = new DecompressionStream('deflate-raw');
            var _dw = _ds.writable.getWriter();
            _dw.write(new Uint8Array(_fBytes));
            _dw.close();
            _fBytes = Array.from(new Uint8Array(
                await new Response(_ds.readable).arrayBuffer()));
        }

        var _decoded = new TextDecoder().decode(new Uint8Array(_fBytes));
        return _decoded.trim().length > 0 ? _decoded : null;
    } catch (_e) { return null; }
}

// ── Module export (Node.js) / browser global ──────────────────────────────────
var _lcfExports = {
    lumpFrameUtf8Bytes:    lumpFrameUtf8Bytes,
    lumpFramePackBE:       lumpFramePackBE,
    lumpFrameStripComments: lumpFrameStripComments,
    lumpFrameDeflateRaw:   lumpFrameDeflateRaw,
    lumpBuildContentFrame: lumpBuildContentFrame,
    lumpContentFrameProfile: lumpContentFrameProfile,
    lumpDecodeContentFrameApi: lumpDecodeContentFrameApi,
    lumpDecodeContentFrame: lumpDecodeContentFrame,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = _lcfExports;
} else if (typeof window !== 'undefined') {
    window.LumpContentFrame = _lcfExports;
}
