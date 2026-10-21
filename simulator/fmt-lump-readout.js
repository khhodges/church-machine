'use strict';
/**
 * fmt-lump-readout.js — presentation helpers for the Save LUMP dialog.
 * Pure string builders; no compile/save semantics live here.
 * Browser: window.FmtLumpReadout. Node: module.exports.
 */
(function(root) {
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function num(n) { return Number(n).toLocaleString('en-US'); }
    function utf8Len(s) {
        if (typeof s !== 'string') return 0;
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
        return Buffer.byteLength(s, 'utf8');
    }

    // used = header(1) + code words + content-frame words + c-list rows
    function layout(c) {
        var frameWords = c.frame && c.frame.frameWords ? c.frame.frameWords.length : 0;
        var used = 1 + c.cw + frameWords + c.cc;
        var allocated = c.lumpSize;
        return {
            header: 1, cw: c.cw, cc: c.cc, frameWords: frameWords,
            usedWords: used, usedBytes: used * 4,
            allocatedWords: allocated, allocatedBytes: allocated * 4,
            paddingWords: allocated - used, paddingBytes: (allocated - used) * 4
        };
    }

    function sourceInfo(profile, frame, sourceText) {
        var flags = frame ? (frame.flags >>> 0) : 0;
        var embedded = (flags & 0x01) !== 0;
        var plain = utf8Len(sourceText);
        if (!embedded) {
            return {
                embedded: false, compressed: false, plaintextBytes: plain,
                text: plain > 0
                    ? 'Source not embedded; exact source (' + num(plain) + ' B plaintext) kept in linked revision bundle'
                    : 'No source'
            };
        }
        var compressed = (flags & 0x04) !== 0;
        var stored = frame.sourceBytesLength || 0;
        var what = profile === 'compact' ? 'comment-stripped source' : 'full source';
        return {
            embedded: true, compressed: compressed, storedBytes: stored, plaintextBytes: plain,
            text: 'Embedded ' + what + ': ' + num(stored) + ' B ' +
                (compressed ? 'deflate-compressed' : 'uncompressed') +
                (profile === 'full' ? ' (from ' + num(plain) + ' B plaintext)' : '')
        };
    }

    function layoutText(L) {
        return {
            content: num(L.usedWords) + ' words used',
            formula: '1 hdr + ' + L.cw + ' code + ' + L.frameWords + ' frame + ' + L.cc + ' c-list',
            allocation: num(L.allocatedWords) + ' words / ' + num(L.allocatedBytes) + ' B allocated',
            padding: num(L.paddingWords) + ' words padding'
        };
    }

    function renderProfileStats(profile, c, sourceText) {
        var L = layout(c), T = layoutText(L), S = sourceInfo(profile, c.frame, sourceText);
        return '<span class="fmt-profile-stats">' +
            '<span class="fmt-stat"><span class="fmt-stat-k">Content</span><span class="fmt-stat-v" data-used="' + L.usedWords + '">' + T.content + '</span></span>' +
            '<span class="fmt-stat-formula">' + T.formula + '</span>' +
            '<span class="fmt-stat"><span class="fmt-stat-k">Block</span><span class="fmt-stat-v" data-allocated="' + L.allocatedWords + '">' + T.allocation + '</span></span>' +
            '<span class="fmt-stat"><span class="fmt-stat-k">Padding</span><span class="fmt-stat-v" data-padding="' + L.paddingWords + '">' + T.padding + '</span></span>' +
            '<span class="fmt-stat-source">' + esc(S.text) + '</span></span>';
    }

    var ALLOCATION_NOTE = 'Blocks are allocated in power-of-two sizes (minimum 64 words), so the unused tail is padding. ' +
        'Different profiles can occupy the same block size even when their content differs.';

    function knownRevision(entry) {
        if (!entry || typeof entry !== 'object') return null;
        if (entry.sources && entry.sources.server) entry = entry.sources.server;
        var v = entry.lump_version != null ? entry.lump_version : entry.savedRevision;
        return Number.isInteger(v) && v >= 0 ? v : null;
    }

    function identity(opts) {
        return {
            program: opts.name && opts.name.includes('.') ? opts.name :
                (opts.petname ? opts.petname + '.' : '') + (opts.name || '(unnamed)'),
            issue: opts.issue,
            revision: opts.revision == null ? null : opts.revision,
            token: opts.token || ''
        };
    }

    function renderIdentity(opts) {
        var id = identity(opts);
        return '<div class="fmt-id-grid">' +
            '<div class="fmt-id-cell fmt-id-program"><span class="fmt-id-k">Program</span><span class="fmt-id-v">' + esc(id.program) + '</span></div>' +
            '<div class="fmt-id-cell"><span class="fmt-id-k">Issue</span><span class="fmt-id-v">#' + esc(id.issue) + '</span></div>' +
            '<div class="fmt-id-cell"><span class="fmt-id-k">Saved base revision</span><span class="fmt-id-v">' +
                (id.revision == null ? '<span class="fmt-id-none">none known</span>' : 'v' + esc(id.revision)) + '</span></div>' +
            '</div>' +
            '<div class="fmt-id-note">Issue is not the revision. The revision assigned by this save is reported by the server after saving.</div>' +
            (id.token ? '<details class="fmt-id-tech"><summary>Technical detail</summary>' +
                '<span class="fmt-id-k">Preview identity token (computed from code words and capabilities)</span> ' +
                '<code class="fmt-ref-hash">' + esc(id.token) + '</code>' +
                '<div class="fmt-id-note">Not a hash of the complete saved binary.</div></details>' : '');
    }

    var api = { layout: layout, layoutText: layoutText, sourceInfo: sourceInfo,
        renderProfileStats: renderProfileStats, renderIdentity: renderIdentity,
        identity: identity, knownRevision: knownRevision, ALLOCATION_NOTE: ALLOCATION_NOTE };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.FmtLumpReadout = api;
})(typeof window !== 'undefined' ? window : null);
