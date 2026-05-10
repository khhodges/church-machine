'use strict';

// GT View — live inventory of every GT in memory, grouped by type.
// Each item expands to show which abstraction c-lists (and CRs) contain it.

function renderGTView() {
    const el = document.getElementById('gt-view-body');
    if (!el) return;
    if (typeof sim === 'undefined' || !sim) {
        el.innerHTML = '<div class="gtv-empty">Simulator not loaded.</div>';
        return;
    }

    // ── Collect GTs ─────────────────────────────────────────────────────────
    // key:   Inform/Outform → "slot:<nsIndex>"   Abstract → "ab:<ab_type>:<ab_data>"
    // value: { label, perms, gtWord, type, parsedAb, sources: string[] }
    const byKey = {};
    const groups = { 0: [], 1: [], 2: [], 3: [] };

    function slotLabel(idx) {
        return (sim.nsLabels && sim.nsLabels[idx]) ? sim.nsLabels[idx] : `NS[${idx}]`;
    }

    const DEVICE_CLASSES = { 1: 'LED', 2: 'UART', 3: 'Button', 4: 'Timer', 5: 'Display' };

    function abstractLabel(parsedAb) {
        if (parsedAb.ab_type === 0) {
            const dc = DEVICE_CLASSES[parsedAb.device_class] || `dc${parsedAb.device_class}`;
            return `${dc}[${parsedAb.device_data}]`;
        }
        if (parsedAb.ab_type === 1) {
            return `M-Elevation 0x${parsedAb.ab_data.toString(16).toUpperCase()}`;
        }
        return `Abstract(ab_type=0x${parsedAb.ab_type.toString(16).toUpperCase()})`;
    }

    function addGT(gtWord, sourceStr) {
        gtWord = gtWord >>> 0;
        if (gtWord === 0) return;
        const parsed = sim.parseGT(gtWord);

        let key, label, parsedAb = null;
        if (parsed.type === 3) {
            parsedAb = sim.parseAbstractGT(gtWord);
            label = abstractLabel(parsedAb);
            key   = `ab:${parsedAb.ab_type}:${parsedAb.ab_data}`;
        } else {
            label = slotLabel(parsed.index);
            key   = `slot:${parsed.type}:${parsed.index}`;
        }

        if (!byKey[key]) {
            const entry = { label, perms: parsed.permissions, gtWord, type: parsed.type, parsedAb, sources: [] };
            byKey[key] = entry;
            groups[parsed.type].push(entry);
        }
        if (sourceStr && !byKey[key].sources.includes(sourceStr)) {
            byKey[key].sources.push(sourceStr);
        }
    }

    // 1. All NS slot c-lists
    for (let i = 0; i < (sim.nsCount || 0); i++) {
        const entry = sim.readNSEntry(i);
        if (!entry) continue;
        const w1f = sim.parseNSWord1(entry.word1_limit);
        const cc  = w1f.clistCount;
        if (!cc) continue;
        const base      = entry.word0_location;
        const lumpSize  = w1f.limit + 1;
        const clistBase = base + lumpSize - cc;
        const owner     = slotLabel(i);
        for (let ci = 0; ci < cc; ci++) {
            const addr = clistBase + ci;
            if (addr >= 0 && addr < sim.memory.length) {
                const gtWord = sim.memory[addr] >>> 0;
                if (gtWord) addGT(gtWord, `${owner} c-list[${ci}]`);
            }
        }
    }

    // 2. demoClistGTs — Boot.Abstr DEMO c-list (available even before first run)
    if (sim.demoClistGTs) {
        const owner = slotLabel(3);
        sim.demoClistGTs.forEach((gtWord, ci) => {
            if (gtWord) addGT(gtWord, `${owner} c-list[${ci}]`);
        });
    }

    // 3. Live CRs (CR0–CR15)
    if (sim.cr) {
        for (let i = 0; i < 16; i++) {
            const cr = sim.cr[i];
            if (cr && cr.word0) addGT(cr.word0 >>> 0, `CR${i}`);
        }
    }

    // ── Render ───────────────────────────────────────────────────────────────
    const TYPE_NAMES = ['NULL', 'Inform', 'Outform', 'Abstract'];
    const TYPE_COLOR = ['#6b7280', '#60a5fa', '#f97316', '#a78bfa'];
    const TYPE_DESC  = [
        'Empty slot — no capability.',
        'Lump resident in memory. Carries an NS slot index.',
        'Lump not yet loaded — Loader fires on first use.',
        'Self-contained token. No NS slot, no lump.',
    ];

    const total = groups[0].length + groups[1].length + groups[2].length + groups[3].length;
    let html = `<div class="gtv-summary">${total} unique GT${total !== 1 ? 's' : ''} found across all loaded c-lists and live CRs</div>`;

    for (const type of [1, 2, 3, 0]) {
        const list  = groups[type];
        const color = TYPE_COLOR[type];
        const count = list.length;

        html += `<div class="gtv-section">`;
        html += `<div class="gtv-section-hdr">`;
        html += `<span class="gtv-type-pill" style="background:${color}22;color:${color};border:1px solid ${color}44;">`;
        html += `Type ${type} — ${TYPE_NAMES[type]}</span>`;
        html += `<span class="gtv-count">${count}</span>`;
        html += `<span class="gtv-desc">${TYPE_DESC[type]}</span>`;
        html += `</div>`;

        if (count === 0) {
            html += `<div class="gtv-none">— none —</div>`;
        } else {
            html += `<div class="gtv-list">`;
            list.forEach((entry, idx) => {
                const permsStr = Object.entries(entry.perms).filter(([,v]) => v).map(([k]) => k).join('') || '—';
                const gtHex    = `0x${(entry.gtWord >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
                const n        = entry.sources.length;
                const itemId   = `gtv-${type}-${idx}`;

                html += `<div class="gtv-item" id="${itemId}">`;
                html += `<div class="gtv-row" onclick="gtvToggle('${itemId}')">`;
                html += `<span class="gtv-label">${entry.label}</span>`;
                html += `<span class="gtv-perms" style="color:${color};">[${permsStr}]</span>`;
                html += `<span class="gtv-hex">${gtHex}</span>`;
                html += `<span class="gtv-chevron" id="${itemId}-chv">${n} location${n !== 1 ? 's' : ''} ▾</span>`;
                html += `</div>`;

                html += `<div class="gtv-popdown" id="${itemId}-pop">`;
                if (n === 0) {
                    html += `<div class="gtv-src gtv-src-none">— not found in any scanned c-list or CR —</div>`;
                } else {
                    entry.sources.forEach(src => {
                        html += `<div class="gtv-src">&#x1F4CD; ${src}</div>`;
                    });
                }
                html += `</div>`;
                html += `</div>`;
            });
            html += `</div>`;
        }
        html += `</div>`;
    }

    el.innerHTML = html;
}

function gtvToggle(itemId) {
    const pop = document.getElementById(itemId + '-pop');
    const chv = document.getElementById(itemId + '-chv');
    if (!pop) return;
    const open = pop.classList.toggle('gtv-open');
    if (chv) {
        chv.textContent = chv.textContent.replace(/[▾▴]$/, open ? '▴' : '▾');
    }
}
