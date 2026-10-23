// Per-word region classification for LUMP hex previews.
// Classification is derived ONLY from the exact displayed words (header word
// and embedded 0xAB content frame), never from catalog metadata.
(function (root) {
    'use strict';
    const REGIONS = {
        header:  {label: 'Header',  desc: 'LUMP header word'},
        code:    {label: 'Code',    desc: 'Code words (header cw)'},
        api:     {label: 'API',     desc: 'Embedded API frame (0xAB header + JSON)'},
        source:  {label: 'Source',  desc: 'Embedded source (length word + payload)'},
        clist:   {label: 'C-List',  desc: 'C-List slots (header cc)'},
        padding: {label: 'Padding', desc: 'Zero padding / free space'},
        other:   {label: 'Other',   desc: 'Unclassified or malformed bytes (shown raw)'},
    };
    const ORDER = ['header', 'code', 'api', 'source', 'clist', 'padding', 'other'];

    function classifyLumpWords(words) {
        const n = words ? words.length : 0;
        const regions = new Array(n).fill('other');
        const diagnostics = [];
        if (!n) return {regions, diagnostics};
        const h = words[0] >>> 0;
        regions[0] = 'header';
        if ((h >>> 27) !== 0x1F) {
            diagnostics.push('Invalid header magic; regions unclassified');
            return {regions, diagnostics};
        }
        const cw = (h >>> 10) & 0x1FFF;
        const cc = h & 0xFF;
        let lumpSize = 64 << ((h >>> 23) & 0x0F);
        if (lumpSize > n) {
            diagnostics.push(`Header size ${lumpSize}w exceeds displayed ${n}w`);
            return {regions, diagnostics};
        }
        if (1 + cw > lumpSize - cc) {
            diagnostics.push('Header cw/cc overlap or exceed size');
            return {regions, diagnostics};
        }
        const codeEnd = Math.min(1 + cw, lumpSize);
        const clStart = Math.max(codeEnd, lumpSize - cc);
        for (let i = 1; i < codeEnd; i++) regions[i] = 'code';
        for (let i = clStart; i < lumpSize; i++) regions[i] = 'clist';
        let free = codeEnd;
        if (free < clStart && (words[free] >>> 24) === 0xAB) {
            const fh = words[free] >>> 0;
            const flags = (fh >>> 16) & 0xFF;
            const apiBytes = fh & 0xFFFF;
            const apiEnd = free + 1 + Math.ceil(apiBytes / 4);
            if (![0, 1, 3, 5, 7].includes(flags) || apiBytes === 0 || apiEnd > clStart) {
                diagnostics.push(`Malformed content frame at word ${free}`);
            } else {
                for (let i = free; i < apiEnd; i++) regions[i] = 'api';
                free = apiEnd;
                if (flags & 1) {
                    if (free >= clStart) {
                        diagnostics.push('Content frame source length word missing');
                    } else {
                        const srcEnd = free + 1 + Math.ceil((words[free] >>> 0) / 4);
                        if (srcEnd > clStart) {
                            diagnostics.push(`Malformed source length at word ${free}`);
                        } else {
                            for (let i = free; i < srcEnd; i++) regions[i] = 'source';
                            free = srcEnd;
                        }
                    }
                }
            }
        }
        // Remaining free span: zero words are padding; anything else stays raw "other".
        for (let i = free; i < clStart; i++) {
            if (regions[i] === 'other' && (words[i] >>> 0) === 0) regions[i] = 'padding';
        }
        return {regions, diagnostics};
    }

    function regionCellAttrs(region, index) {
        const r = REGIONS[region] || REGIONS.other;
        return {cls: `lump-hex-reg lump-hex-reg-${region}`,
            attrs: ` data-region="${region}" title="${r.label} \u2014 word ${index}"`};
    }

    function regionLegendHtml(regions) {
        const counts = {};
        for (const r of regions) counts[r] = (counts[r] || 0) + 1;
        let html = '<div class="lump-hex-reg-legend" role="list" aria-label="Byte region legend">';
        for (const k of ORDER) {
            if (!counts[k]) continue;
            html += `<span role="listitem" class="lump-hex-reg-key lump-hex-reg-${k}" title="${REGIONS[k].desc}">` +
                `<span class="lump-hex-reg-swatch"></span>${REGIONS[k].label} ${counts[k]}w</span>`;
        }
        return html + '</div>';
    }

    const api = {REGIONS, ORDER, classifyLumpWords, regionCellAttrs, regionLegendHtml};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.LumpHexRegions = api;
})(typeof window !== 'undefined' ? window : globalThis);
