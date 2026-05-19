// pet_name_audit.js — Pre-save LUMP pet name integrity check.
//
// Pure function: no browser globals, no DOM, no sim object.
// Loaded as a <script> in the IDE and require()-able in Node.js unit tests.
//
// petNameAudit(words, hdr, nsLabels, nsSymbols)
//
//   words     — Array of lump word values (indices 0..lumpSize-1).
//   hdr       — { cw, cc, lumpSize }.
//   nsLabels  — Object: NS-slot-id (number) → abstraction name (string).
//               Pass {} when unavailable.
//   nsSymbols — Object: pet-name (string) → c-list-slot (number).
//               Pass {} when unavailable.
//
// Returns { ok, warnCount, lines }:
//   ok        — false when a Church instruction references a null-GT slot
//               (guaranteed runtime fault); true otherwise.
//   warnCount — number of soft warnings (unnamed occupied slots).
//   lines     — human-readable audit lines for the save-modal.
//
// BLOCKING (ok=false):
//   LOAD / SAVE / ELOADCALL / XLOADLAMBDA via CR6 accesses a slot whose GT
//   is null (0x00000000).  The lump will fault on that instruction.
//
// SOFT WARNING (ok=true, warnCount>0):
//   A non-null occupied slot has no derivable or registered name.
//   The code runs but the capability is anonymous — add a pet name.

(function (global) {
    'use strict';

    const _AB_DEV_CLS = ['?', 'LED', 'UART', 'Button', 'Timer', 'Display'];

    const _CHURCH_OPS = new Set([0, 1, 8, 9]);
    const _OP_NAME    = { 0: 'LOAD', 1: 'SAVE', 8: 'ELOADCALL', 9: 'XLOADLAMBDA' };

    function _isPendingGT(wVal) {
        return ((wVal >>> 0) >>> 16) === 0xFEED;
    }

    function _pendingGTName(wVal) {
        const idx = (wVal >>> 0) & 0xFFFF;
        // Try global registry first (browser); fall back to tag-based name.
        if (typeof ChurchSimulator !== 'undefined' && ChurchSimulator.PENDING_GT_NAMES) {
            return ChurchSimulator.PENDING_GT_NAMES[idx] || ('pending#' + idx);
        }
        return 'pending#' + idx;
    }

    function _deriveName(wVal, nsLabels) {
        if (!wVal) return '';
        if (_isPendingGT(wVal)) return _pendingGTName(wVal);
        const gtType = (wVal >>> 23) & 0x3;
        if (gtType === 3) {
            const abType = (wVal >>> 27) & 0x1F;
            const devCls = (wVal >>>  8) & 0xFF;
            const devDat =  wVal         & 0xFF;
            if (abType === 0) return (_AB_DEV_CLS[devCls] || ('Dev' + devCls)) + devDat;
            if (abType === 1) return 'M-Elevation';
            return 'Abs' + abType;
        } else {
            const slotId = wVal & 0xFFFF;
            return (nsLabels && nsLabels[slotId]) ? String(nsLabels[slotId]) : '';
        }
    }

    function petNameAudit(words, hdr, nsLabels, nsSymbols) {
        const { cw, cc, lumpSize } = hdr;
        const lines = [];
        let ok        = true;
        let warnCount = 0;

        if (cc === 0) {
            lines.push('\u2139 Pet Name Audit: cc=0 \u2014 no c-list slots to audit');
            return { ok, warnCount, lines };
        }

        const clistBase = lumpSize - cc;

        // slot → name derived from GT value
        const slotDerived = {};
        for (let s = 0; s < cc; s++) {
            const wVal = (words[clistBase + s] >>> 0) || 0;
            slotDerived[s] = _deriveName(wVal, nsLabels);
        }

        // slot → name registered in assembler.nsSymbols (reverse map)
        const slotRegistered = {};
        if (nsSymbols) {
            for (const [nm, sl] of Object.entries(nsSymbols)) {
                if (typeof sl === 'number' && sl >= 0 && sl < cc && !slotRegistered[sl]) {
                    slotRegistered[sl] = nm;
                }
            }
        }

        // Scan code words: collect per-slot Church-instruction references
        const issuesBySlot = {};
        for (let wi = 1; wi <= cw && wi < words.length; wi++) {
            const ww    = (words[wi] >>> 0) || 0;
            const op    = (ww >>> 27) & 0x1F;
            const crSrc = (ww >>> 15) & 0xF;
            const slot  =  ww         & 0x7FFF;
            if (!_CHURCH_OPS.has(op) || crSrc !== 6 || slot >= cc) continue;
            if (!issuesBySlot[slot]) issuesBySlot[slot] = { nullFault: false, opWords: [] };
            const gt = (words[clistBase + slot] >>> 0) || 0;
            if (!gt) issuesBySlot[slot].nullFault = true;
            issuesBySlot[slot].opWords.push({ wi, opName: _OP_NAME[op] });
        }

        // One report line per slot
        const issueLines = [];
        let namedCount = 0;

        for (let s = 0; s < cc; s++) {
            const wVal    = (words[clistBase + s] >>> 0) || 0;
            const iss     = issuesBySlot[s];
            const regName = slotRegistered[s] || '';
            const derName = slotDerived[s]    || '';
            const best    = regName || derName;

            if (!wVal) {
                if (iss && iss.nullFault) {
                    const ops = iss.opWords.map(o => 'word[' + o.wi + '] ' + o.opName).join(', ');
                    issueLines.push(
                        '  \u2717 slot [' + s + ']: null GT referenced by ' + ops +
                        ' \u2014 will FAULT at runtime'
                    );
                    ok = false;
                }
                continue;
            }

            if (!best) {
                const refNote = iss
                    ? ' (used by ' + iss.opWords.map(o => 'word[' + o.wi + '] ' + o.opName).join(', ') + ')'
                    : ' (not referenced by code)';
                issueLines.push(
                    '  \u26A0 slot [' + s + ']: GT=0x' +
                    wVal.toString(16).toUpperCase().padStart(8, '0') +
                    ' \u2014 no pet name' + refNote
                );
                warnCount++;
            } else {
                const nameNote = (regName && derName && regName !== derName)
                    ? '"' + regName + '" (registered) / "' + derName + '" (derived)'
                    : '"' + best + '"';
                issueLines.push('  \u2713 slot [' + s + ']: ' + nameNote);
                namedCount++;
            }
        }

        if (!ok) {
            lines.push('\u2717 Pet Name Audit: null-GT fault(s) \u2014 fix before saving');
        } else if (warnCount > 0) {
            lines.push(
                '\u26A0 Pet Name Audit: ' + namedCount + ' slot(s) named, ' +
                warnCount + ' slot(s) unnamed \u2014 consider adding pet names'
            );
        } else {
            lines.push(
                '\u2713 Pet Name Audit: ' + namedCount + ' slot(s) named, ' +
                'all Church instructions reference named capabilities'
            );
        }
        for (const l of issueLines) lines.push(l);

        return { ok, warnCount, lines };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { petNameAudit };
    } else {
        global.petNameAudit = petNameAudit;
    }

})(typeof globalThis !== 'undefined' ? globalThis : this);
