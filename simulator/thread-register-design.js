'use strict';

// Per-Thread initial register design (pure helpers, no DOM).
// Drafts keep the raw text the programmer typed so invalid entries are shown
// and never coerced.  initialization() converts a valid draft into the
// server schema: {dataRegisters:[16 uint32|null], capabilityRegisters:[12 uint32|null]}.
// null means "keep the build default" for that register of this Thread only.
(function (root) {
    var DR_COUNT = 16, CR_COUNT = 12;
    var PRESETS = {
        alice: { namespaceName: 'ide.Alice', petname: 'Alice', dr1: 0xA11CE002 },
        mallory: { namespaceName: 'ide.Mallory', petname: 'Mallory', dr1: 0x0BAD0003 }
    };

    function blankDraft() {
        var dr = [], cr = [], i;
        for (i = 0; i < DR_COUNT; i++) dr.push('');
        for (i = 0; i < CR_COUNT; i++) cr.push('');
        return { dr: dr, cr: cr, crTargets: {} };
    }

    function hex8(v) { return '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0'); }

    // Returns {value:null} for blank, {value:n} for valid, {error} otherwise.
    function parseWord(text) {
        var s = String(text == null ? '' : text).trim();
        if (s === '') return { value: null };
        var n;
        if (/^0x[0-9a-f]{1,8}$/i.test(s)) n = parseInt(s.slice(2), 16);
        else if (/^\d{1,10}$/.test(s)) n = Number(s);
        else return { error: '"' + s + '" is not a hex (0x...) or decimal number.' };
        if (n > 0xFFFFFFFF) return { error: s + ' exceeds 0xFFFFFFFF.' };
        return { value: n };
    }

    function normalizeDraft(d) {
        var out = blankDraft();
        if (!d || typeof d !== 'object') return out;
        ['dr', 'cr'].forEach(function (k) {
            if (Array.isArray(d[k])) out[k] = out[k].map(function (_, i) {
                var v = d[k][i]; return v == null ? '' : String(v);
            });
        });
        if (d.crTargets && typeof d.crTargets === 'object') {
            Object.keys(d.crTargets).forEach(function (k) {
                var t = d.crTargets[k];
                if (t && typeof t === 'object') out.crTargets[k] = { slot: Number(t.slot), seq: Number(t.seq), name: String(t.name || '') };
            });
        }
        return out;
    }

    // Draft from a server initialization object (values rendered as hex).
    function draftFromInitialization(init) {
        var d = blankDraft();
        if (!init) return d;
        (init.dataRegisters || []).forEach(function (v, i) { if (i < DR_COUNT && v != null) d.dr[i] = hex8(v); });
        (init.capabilityRegisters || []).forEach(function (v, i) { if (i < CR_COUNT && v != null) d.cr[i] = hex8(v); });
        return d;
    }

    function errors(draft) {
        var e = [];
        draft.dr.forEach(function (t, i) { var r = parseWord(t); if (r.error) e.push('DR' + i + ': ' + r.error); });
        draft.cr.forEach(function (t, i) { var r = parseWord(t); if (r.error) e.push('CR' + i + ': ' + r.error); });
        return e;
    }

    function initialization(draft) {
        var e = errors(draft);
        if (e.length) throw new Error(e.join(' '));
        return {
            dataRegisters: draft.dr.map(function (t) { return parseWord(t).value; }),
            capabilityRegisters: draft.cr.map(function (t) { return parseWord(t).value; })
        };
    }

    // E-only Inform GT for the target Namespace row.
    function informGT(row) {
        var slot = Number(row && row.slot), seq = Number(row && row.seq);
        if (!Number.isInteger(slot) || slot < 0 || slot > 0xFFFF) throw new Error('Target slot is unavailable.');
        if (!Number.isInteger(seq) || seq < 0 || seq > 0x3F) throw new Error('Target sequence is unavailable.');
        return (0x4a000000 | (seq << 16) | slot) >>> 0;
    }

    // Exactly one row named namespaceName or petname, else an explicit error.
    function findActor(rows, key) {
        var p = PRESETS[key];
        if (!p) throw new Error('Unknown preset.');
        var hits = (rows || []).filter(function (r) { return r && (r.name === p.namespaceName || r.name === p.petname); });
        if (!hits.length) throw new Error(p.petname + ' (' + p.namespaceName + ') is not in the current Namespace. Nothing changed.');
        if (hits.length > 1) throw new Error(p.petname + ' matches ' + hits.length + ' Namespace rows; it must be unique. Nothing changed.');
        return hits[0];
    }

    // Returns a new draft with DR1 and CR1 set; other registers unchanged.
    function applyPreset(draft, rows, key) {
        var row = findActor(rows, key), next = normalizeDraft(draft);
        var gt = informGT(row);
        next.dr[1] = hex8(PRESETS[key].dr1);
        next.cr[1] = hex8(gt);
        next.crTargets['1'] = { slot: Number(row.slot), seq: Number(row.seq), name: row.name };
        return { draft: next, row: row, gt: gt };
    }

    var api = { DR_COUNT: DR_COUNT, CR_COUNT: CR_COUNT, PRESETS: PRESETS, blankDraft: blankDraft,
        parseWord: parseWord, normalizeDraft: normalizeDraft, draftFromInitialization: draftFromInitialization,
        errors: errors, initialization: initialization, informGT: informGT, findActor: findActor,
        applyPreset: applyPreset, hex8: hex8 };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ThreadRegisterDesign = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
