/**
 * Annotate NS[N] references in already HTML-escaped code text.
 * Wraps each NS[N] token with a tooltip span showing the abstraction name
 * at namespace slot N.  Uses sim.nsLabels (runtime NS table) first, then
 * abstractionRegistry as a static fallback.
 * NS[N] IS a namespace reference, so namespace lookup is correct here.
 */
function _annotateNsRefInCode(html) {
    return html.replace(/\bNS\[(\d+)\]/g, function(m, numStr) {
        const idx = parseInt(numStr, 10);
        const label = (sim && sim.nsLabels && sim.nsLabels[idx]) ||
                      (typeof abstractionRegistry !== 'undefined' &&
                       abstractionRegistry.abstractions &&
                       abstractionRegistry.abstractions[idx] &&
                       abstractionRegistry.abstractions[idx].name) ||
                      null;
        if (!label) return m;
        const safe = label.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `<span class="clist-petname-ref" ` +
               `onmouseenter="showPetNameTip(event,'${safe}')" ` +
               `onmouseleave="hidePetNameTip()">${m}</span>`;
    });
}

/**
 * Syntax-highlight and annotate raw assembly / CLOOMC source text.
 * Delegates to _highlightCLOOMCSource (app-lumps.js) for keyword, mnemonic,
 * directive, comment, string, number, register, and label colouring.
 * _highlightCLOOMCSource calls _annotateNsRefInCode internally, so NS[N]
 * hover tooltips are preserved.  _wrapRegHover is applied afterwards to add
 * CR/DR hover popups on top of the colour spans.
 *
 * @param {string} rawText  Raw source text (not HTML-escaped).
 * @param {string} [language]  'assembly' enables mnemonic/label/directive
 *     colours; any other value (or omitted) gives keyword/comment colouring
 *     only.  Defaults to 'assembly'.
 * Used for <pre class="abs-method-panel-code"> blocks in the Abstraction view.
 */
function _annotateAbsCodeHtml(rawText, language) {
    if (!rawText) return '';
    let html;
    if (typeof _highlightCLOOMCSource === 'function') {
        html = _highlightCLOOMCSource(rawText, language || 'assembly');
    } else {
        // Fallback when app-lumps.js is not loaded
        html = rawText
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        html = _annotateNsRefInCode(html);
    }
    // Wrap CRN / DRN tokens with hover spans (reuses cr-detail helpers).
    // Safe to apply after highlight spans — the register text sits inside its
    // lump-hl-register span and _wrapRegHover nests a cr/dr-hover-target span
    // around it, giving both colour and interactive tooltip.
    if (typeof _wrapRegHover === 'function') html = _wrapRegHover(html);
    return html;
}

function _signedReturnDesc(dr1, absIndex) {
    if (absIndex === 12) {
        if (dr1 > 0)        return dr1 === 1 ? 'on / success' : 'success';
        if (dr1 === 0)      return 'off';
        return dr1 === -1 ? 'invalid offset' : 'fault';
    }
    if (dr1 > 0)            return 'success';
    if (dr1 === 0)          return 'zero';
    return 'fault';
}

function _buildSignedReturnHtml(absIndex) {
    const sr = sim ? sim.lastSignedReturn : null;
    if (!sr || sr.absIndex !== absIndex || sr.dr1 === 0) {
        return '';
    }
    const _dr1 = sr.dr1;
    const _badgeClass = _dr1 > 0 ? 'dr0-badge-green' : (_dr1 < 0 ? 'dr0-badge-red' : 'dr0-badge-grey');
    const _desc = _signedReturnDesc(_dr1, absIndex);
    const _chipText = (absIndex === 12)
        ? (sr.ledIndex !== null && sr.ledIndex !== undefined ? `LED ${sr.ledIndex}` : 'LED ?')
        : sr.methodName;
    const _chipClass = (absIndex === 12) ? 'signed-return-chip signed-return-chip-led' : 'signed-return-chip';
    return `<div class="abs-detail-label">Last return</div>` +
        `<div class="abs-signed-return" id="absSignedReturnBody">` +
        `<span class="${_chipClass}">${_chipText}</span>` +
        `<span style="color:var(--text-secondary);font-size:0.8rem;">DR1:</span> ` +
        `<span class="dr0-badge ${_badgeClass}" style="font-size:0.85rem;padding:2px 8px;">${_dr1}</span>` +
        `<span class="dr0-badge-desc" style="margin-left:6px;">(${_desc})</span>` +
        `</div>` +
        `<div class="abs-note-text" style="margin-top:6px;">DR1 carries the signed result after the CALL (≥0 success, &lt;0 fault). ` +
        `Use <code>BGE</code> (branch if &ge; 0) or <code>BLT</code> (branch if &lt; 0) immediately after the CALL to act on the result.</div>`;
}

function _refreshSignedReturnReadout() {
    const section = document.getElementById('absSignedReturnSection');
    if (!section) return;
    const absIdx = (typeof selectedAbsIndex === 'number') ? selectedAbsIndex : -1;
    const html = _buildSignedReturnHtml(absIdx);
    if (!html) {
        section.style.display = 'none';
        section.innerHTML = '';
    } else {
        section.style.display = '';
        section.innerHTML = html;
    }
}

// ── Boot.NS word-cell hover tooltip ──────────────────────────────────────────
function _nsdGetTip() {
    let tip = document.getElementById('_nsd-tip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = '_nsd-tip';
        tip.className = 'abs-nsdecoder-wordtip';
        tip.style.display = 'none';
        document.body.appendChild(tip);
    }
    return tip;
}

function _nsdShowTip(el) {
    const raw = el.getAttribute('data-nsdtip');
    if (!raw) return;
    const tip = _nsdGetTip();
    tip.innerHTML = raw;
    tip.style.display = 'block';
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth || 220;
    let left = r.left + window.scrollX;
    if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
    tip.style.left = left + 'px';
    tip.style.top  = (r.bottom + window.scrollY + 5) + 'px';
}

function _nsdHideTip() {
    const tip = document.getElementById('_nsd-tip');
    if (tip) tip.style.display = 'none';
}

function _renderBootNSDecoder(contentEl, abs) {
    let html = '';
    const simReady = typeof sim !== 'undefined' && sim && typeof sim.readNSEntry === 'function';

    if (!simReady || !sim.memory) {
        html += '<div class="abs-nsdecoder-placeholder">Boot the simulator to decode the namespace image.</div>';
        contentEl.innerHTML = html;
        return;
    }

    const ns0 = sim.readNSEntry(0);
    const ns1 = sim.readNSEntry(1);
    // Authoritative boot-entry source: the E-GT at Thread stack CR0
    // (threadBase + THREAD_CAPS_OFFSET). setBootEntrySlot() always writes here
    // but does NOT update mem[NS_TABLE_BASE-2], so reading that word gives stale data.
    let bootSlot;
    {
        const capsOff   = (typeof THREAD_CAPS_OFFSET !== 'undefined') ? THREAD_CAPS_OFFSET : 244;
        const ns1Loc    = ns1 ? (ns1.word0_location >>> 0) : 0;
        const cr0Word   = (ns1Loc && sim.memory) ? (sim.memory[ns1Loc + capsOff] >>> 0) : 0;
        if (cr0Word) {
            const cr0GT = sim.parseGT(cr0Word);
            if (cr0GT && cr0GT.type === 1 && cr0GT.permissions && cr0GT.permissions.E) {
                bootSlot = cr0GT.index;
            }
        }
        if (bootSlot == null) {
            bootSlot = (typeof sim.bootEntrySlot === 'number') ? sim.bootEntrySlot : 3;
        }
    }
    const bootEntryName = (sim.nsLabels && sim.nsLabels[bootSlot]) ||
        (abstractionRegistry && abstractionRegistry.abstractions && abstractionRegistry.abstractions[bootSlot] &&
         abstractionRegistry.abstractions[bootSlot].name) || `NS[${bootSlot}]`;

    const fmtAddr = a => '0x' + ((a >>> 0)).toString(16).toUpperCase().padStart(4, '0');
    const fmtW    = v => '0x' + ((v >>> 0)).toString(16).toUpperCase().padStart(8, '0');

    html += '<div class="abs-nsdecoder-section">';
    html += '<div class="abs-nsdecoder-heading">Hardware Boot Sequence</div>';
    html += '<table class="abs-nsdecoder-boot-table"><tbody>';

    const ns0Addr = ns0 ? fmtAddr(ns0.word0_location) : '?';
    html += `<tr>
        <td class="abs-nsdecoder-step">Step 1</td>
        <td class="abs-nsdecoder-op">Load CR15</td>
        <td class="abs-nsdecoder-desc">Namespace lump @ ${ns0Addr}</td>
        <td class="abs-nsdecoder-name">Boot.NS</td>
    </tr>`;

    const ns1Addr = ns1 ? fmtAddr(ns1.word0_location) : '?';
    html += `<tr>
        <td class="abs-nsdecoder-step">Step 2</td>
        <td class="abs-nsdecoder-op">Load CR12</td>
        <td class="abs-nsdecoder-desc">Thread lump &nbsp;@ ${ns1Addr}</td>
        <td class="abs-nsdecoder-name">Boot.Thread <span class="abs-nsdecoder-badge-thread">Thread</span> (NS[1])</td>
    </tr>`;

    html += `<tr>
        <td class="abs-nsdecoder-step">Step 3</td>
        <td class="abs-nsdecoder-op">CALL CR0</td>
        <td class="abs-nsdecoder-desc">Boot entry &nbsp;&nbsp;NS[${bootSlot}]</td>
        <td class="abs-nsdecoder-name"><span class="abs-nsdecoder-badge-boot">&#x26A1;</span> ${bootEntryName}</td>
    </tr>`;

    html += '</tbody></table>';
    html += '</div>';

    // ── Hardwired Golden Tokens (CR15 + CR12) ───────────────────────────────
    html += '<div class="abs-nsdecoder-section">';
    html += '<div class="abs-clist-heading">Hardwired Golden Tokens</div>';
    html += '<div class="abs-nsdecoder-hint">CR15 (NS root) and CR12 (Thread stack) are loaded by hardware at reset \u2014 never writable by CLOOMC programs</div>';
    html += '<table class="abs-clist-table" style="margin-top:0.5rem;"><thead><tr>';
    html += '<th>CR</th><th>GT (HEX)</th><th>PERMS</th><th>TYPE</th><th>RESOLVED NAME</th>';
    html += '</tr></thead><tbody>';

    // Hardwired GT values are architectural constants defined by the boot ROM spec:
    //   createGT(gt_seq=0, slotId, perms=0x00, type=1/Inform)
    //   GT word = (permBits<<25)|(type<<23)|(gt_seq<<16)|slotId
    //   CR15: (0<<25)|(1<<23)|(0<<16)|0 = 0x00800000  (NS root,    Slot 0)
    //   CR12: (0<<25)|(1<<23)|(0<<16)|1 = 0x00800001  (Thread stack, Slot 1)
    const HW_GTS = [
        [15, 'CR15 \u00b7 Step\u00a01', 0x00800000],
        [12, 'CR12 \u00b7 Step\u00a02', 0x00800001],
    ];
    for (const [, crLabel, hwWord] of HW_GTS) {
        const parsed = sim.parseGT(hwWord);
        const p = { ...parsed.permissions, F: parsed.type === 2 ? 1 : 0 };
        let permHtml = '';
        for (const bit of ['B','R','W','X','E','L','S','F']) {
            permHtml += `<span class="abs-perm-badge ${p[bit] ? 'perm-on' : 'perm-off'}">${bit}</span>`;
        }
        const nsIdx = parsed.index;
        const lbl = (sim.nsLabels && sim.nsLabels[nsIdx]) ||
            (typeof abstractionRegistry !== 'undefined' && abstractionRegistry &&
             abstractionRegistry.abstractions && abstractionRegistry.abstractions[nsIdx] &&
             abstractionRegistry.abstractions[nsIdx].name) || null;
        const nameStr = lbl ? `NS[${nsIdx}] \u2014 ${lbl}` : `NS[${nsIdx}]`;
        const gtHex = '0x' + hwWord.toString(16).toUpperCase().padStart(8, '0');
        html += `<tr>`;
        html += `<td class="abs-clist-idx">${crLabel}</td>`;
        html += `<td class="abs-clist-gt">${gtHex}</td>`;
        html += `<td class="abs-clist-perms">${permHtml}</td>`;
        html += `<td class="abs-clist-type">${parsed.typeName}</td>`;
        html += `<td class="abs-clist-name">${nameStr}</td>`;
        html += `</tr>`;
    }
    html += '</tbody></table>';
    html += '</div>';

    html += '<div class="abs-nsdecoder-section">';
    html += '<div class="abs-nsdecoder-heading">Namespace Lump \u2014 4-Word Slots</div>';
    html += '<div class="abs-nsdecoder-hint">Hover W1\u2013W4 for decoded fields</div>';
    html += '<div class="abs-nsdecoder-table-wrap">';
    html += '<table class="abs-nsdecoder-ns-table"><thead><tr>';
    html += '<th>Slot</th><th>Name</th><th>W1</th><th>W2</th><th>W3</th><th>W4</th>';
    html += '</tr></thead><tbody>';

    const count = (typeof sim.nsCount === 'number') ? sim.nsCount : 0;
    for (let i = 0; i < count; i++) {
        const memBase = sim.NS_TABLE_BASE + i * sim.NS_ENTRY_WORDS;
        const rw0 = sim.memory[memBase + 0] >>> 0;
        const rw1 = sim.memory[memBase + 1] >>> 0;
        const rw2 = sim.memory[memBase + 2] >>> 0;
        const rw3 = sim.memory[memBase + 3] >>> 0;

        if (rw0 === 0 && rw1 === 0) {
            html += `<tr><td class="abs-nsdecoder-slot">${i}</td><td colspan="5" class="abs-nsdecoder-empty">\u2014 (empty)</td></tr>`;
            continue;
        }

        const w1f = sim.parseNSWord1(rw1);
        const slotName = (sim.nsLabels && sim.nsLabels[i]) ||
            (abstractionRegistry && abstractionRegistry.abstractions && abstractionRegistry.abstractions[i] &&
             abstractionRegistry.abstractions[i].name) || `Slot ${i}`;

        let badges = '';
        if (i === 1)        badges += ' <span class="abs-nsdecoder-badge-thread">Thread</span>';
        if (i === bootSlot) badges += ' <span class="abs-nsdecoder-badge-boot">&#x26A1;</span>';

        // ── Decoded popup content for each word ──────────────────────────────
        const tipW1 = `<div class='nsdtip-hdr'>W1 — Location</div>` +
            `<div class='nsdtip-row'><span>Base address</span><span>${fmtAddr(rw0)}</span></div>` +
            `<div class='nsdtip-row'><span>Raw</span><span>${fmtW(rw0)}</span></div>`;

        const tipW2 = `<div class='nsdtip-hdr'>W2 — Limit &amp; Flags</div>` +
            `<div class='nsdtip-row'><span>lim17</span><span>0x${w1f.limit.toString(16).toUpperCase()} (${w1f.limit})</span></div>` +
            `<div class='nsdtip-row'><span>cc</span><span>${w1f.clistCount}</span></div>` +
            `<div class='nsdtip-row'><span>Chainable</span><span>${w1f.chainable ? 'Yes' : 'No'}</span></div>` +
            `<div class='nsdtip-row'><span>F (far)</span><span>${w1f.f ? 'Yes' : 'No'}</span></div>` +
            `<div class='nsdtip-row'><span>B (bind)</span><span>${(w1f.b !== undefined ? w1f.b : '—')}</span></div>` +
            `<div class='nsdtip-row'><span>Raw</span><span>${fmtW(rw1)}</span></div>`;

        const tipW3 = `<div class='nsdtip-hdr'>W3 — Version Seal</div>` +
            `<div class='nsdtip-row'><span>Seal</span><span>${fmtW(rw2)}</span></div>` +
            `<div class='nsdtip-note'>Tamper-evidence seal computed from location and lim17. Hardware rejects mismatched seals.</div>`;

        const tipW4 = rw3
            ? `<div class='nsdtip-hdr'>W4 — Extended</div><div class='nsdtip-row'><span>Value</span><span>${fmtW(rw3)}</span></div>`
            : `<div class='nsdtip-hdr'>W4 — Reserved</div><div class='nsdtip-row'><span>Value</span><span>0x00000000</span></div>`;

        const rowClass = i === 0 ? ' class="abs-nsdecoder-ns-row-self"' : (i === bootSlot ? ' class="abs-nsdecoder-ns-row-boot"' : '');
        html += `<tr${rowClass}>`;
        html += `<td class="abs-nsdecoder-slot">${i}</td>`;
        html += `<td class="abs-nsdecoder-name-cell">${slotName}${badges}</td>`;
        html += `<td class="abs-nsdecoder-word" data-nsdtip="${tipW1.replace(/"/g, '&quot;')}" onmouseenter="_nsdShowTip(this)" onmouseleave="_nsdHideTip()">${fmtW(rw0)}</td>`;
        html += `<td class="abs-nsdecoder-word" data-nsdtip="${tipW2.replace(/"/g, '&quot;')}" onmouseenter="_nsdShowTip(this)" onmouseleave="_nsdHideTip()">${fmtW(rw1)}</td>`;
        html += `<td class="abs-nsdecoder-word" data-nsdtip="${tipW3.replace(/"/g, '&quot;')}" onmouseenter="_nsdShowTip(this)" onmouseleave="_nsdHideTip()">${fmtW(rw2)}</td>`;
        html += `<td class="abs-nsdecoder-word abs-nsdecoder-word-res" data-nsdtip="${tipW4.replace(/"/g, '&quot;')}" onmouseenter="_nsdShowTip(this)" onmouseleave="_nsdHideTip()">${fmtW(rw3)}</td>`;
        html += '</tr>';
    }

    html += '</tbody></table>';
    html += '</div>';
    html += '</div>';

    contentEl.innerHTML = html;
}

function showAbstractionDetail(index) {
    selectedAbsIndex = index;
    renderAbstractions();

    if (!abstractionRegistry) return;
    const abs = abstractionRegistry.getAbstraction(index);
    if (!abs) return;

    const titleEl = document.getElementById('absDetailTitle');
    const contentEl = document.getElementById('absDetailContent');
    if (!titleEl || !contentEl) return;

    if (abs.index === 0) {
        titleEl.textContent = `${abs.name} \u2014 Abstraction 0`;
        _renderBootNSDecoder(contentEl, abs);
        return;
    }

    if (abs.index === 1) {
        titleEl.textContent = `${abs.name} \u2014 Abstraction 1`;
        const simReady = typeof sim !== 'undefined' && sim &&
                         typeof renderThreadMemoryLayout === 'function';
        if (!simReady || !sim.memory) {
            contentEl.innerHTML =
                '<div class="abs-nsdecoder-placeholder">' +
                'Boot the simulator to view the Boot.Thread memory layout.</div>';
        } else {
            contentEl.innerHTML = renderThreadMemoryLayout(1);
        }
        return;
    }

    const layerNames = abstractionRegistry.getLayerNames();
    const layerName = layerNames[abs.layer] || `Layer ${abs.layer}`;
    titleEl.textContent = `${abs.name} \u2014 Abstraction ${abs.index}`;

    const p = abs.perms || {};
    const permStr = (p.B?'B':'')+(p.R?'R':'')+(p.W?'W':'')+(p.X?'X':'')+(p.L?'L':'')+(p.S?'S':'')+(p.E?'E':'') || 'none';

    let html = '';

    const detailProfile = _getAbstractionProfile(abs);
    const detailProfileClass = detailProfile === 'Full' ? 'profile-badge-full' : detailProfile === 'XC7A100T' ? 'profile-badge-xc7a100t' : 'profile-badge-iot';

    html += '<div class="abs-detail-section">';
    html += `<div class="abs-detail-badge layer-${abs.layer}">Layer ${abs.layer} \u2014 ${layerName}</div>`;
    html += ` <span class="abs-profile-badge ${detailProfileClass}" style="margin-left:4px;font-size:0.62rem;">${detailProfile}</span>`;
    html += `<div class="abs-detail-desc">${abs.description}</div>`;
    html += '</div>';

    {
        let clistLoaded = false;
        let cc = 0;
        const clistSlots = [];
        let isThreadLump = false;

        if (typeof sim !== 'undefined' && sim && typeof sim.readNSEntry === 'function') {
            const nsEntry = sim.readNSEntry(abs.index);
            if (nsEntry && nsEntry.word0_location != null) {
                const lumpBase = nsEntry.word0_location >>> 0;
                const headerWord = sim.memory[lumpBase] >>> 0;
                if (typeof sim.parseLumpHeader === 'function') {
                    const hdr = sim.parseLumpHeader(headerWord);
                    if (hdr.valid) {
                        clistLoaded = true;
                        if (hdr.typ === 2) {
                            isThreadLump = true;
                            const capsOff = (typeof THREAD_CAPS_OFFSET !== 'undefined') ? THREAD_CAPS_OFFSET : 244;
                            cc = 12;
                            const clistStart = lumpBase + capsOff;
                            for (let si = 0; si < 12; si++) {
                                clistSlots.push(sim.memory[clistStart + si] >>> 0);
                            }
                        } else {
                            cc = hdr.cc;
                            const clistStart = lumpBase + hdr.lumpSize - cc;
                            for (let si = 0; si < cc; si++) {
                                clistSlots.push(sim.memory[clistStart + si] >>> 0);
                            }
                        }
                    }
                }
            }
        }

        html += '<div class="abs-detail-section abs-clist-section">';
        html += '<div class="abs-detail-label">Golden Tokens</div>';

        if (!clistLoaded) {
            const rawCaps = Array.isArray(abs.capabilities) ? abs.capabilities : [];
            const staticCaps = rawCaps.map(c =>
                (typeof c === 'string') ? { name: c, target: null, grants: [] } : c
            );
            if (staticCaps.length === 0) {
                html += '<div class="abs-clist-empty">Empty (cc\u00a0=\u00a00) \u2014 this abstraction holds no capabilities.</div>';
            } else {
                const hasGrants = staticCaps.some(c => Array.isArray(c.grants) && c.grants.length > 0);
                html += `<div class="abs-clist-count">cc\u00a0=\u00a0${staticCaps.length} slot${staticCaps.length !== 1 ? 's' : ''}`;
                html += ` <span class="abs-clist-static-badge">static \u00b7 live after boot</span></div>`;
                html += '<table class="abs-clist-table"><thead><tr>';
                html += '<th>#</th><th>Name</th><th>Target</th>';
                if (hasGrants) html += '<th>Grants</th>';
                html += '</tr></thead><tbody>';
                for (let si = 0; si < staticCaps.length; si++) {
                    const cap = staticCaps[si];
                    const capName = cap.name || '\u2014';
                    let targetStr = '\u2014';
                    if (cap.target != null) {
                        const regLabel = (typeof abstractionRegistry !== 'undefined' && abstractionRegistry &&
                            abstractionRegistry.abstractions && abstractionRegistry.abstractions[cap.target] &&
                            abstractionRegistry.abstractions[cap.target].name) || null;
                        targetStr = regLabel ? `NS[${cap.target}] \u2014 ${regLabel}` : `NS[${cap.target}]`;
                    }
                    html += `<tr>`;
                    html += `<td class="abs-clist-idx">${si}</td>`;
                    html += `<td class="abs-clist-name">${capName}</td>`;
                    html += `<td class="abs-clist-name abs-clist-target">${targetStr}</td>`;
                    if (hasGrants) {
                        const grants = Array.isArray(cap.grants) ? cap.grants : [];
                        let grantsHtml = '';
                        for (const bit of ['B','R','W','X','E','L','S','F']) {
                            const on = grants.includes(bit);
                            grantsHtml += `<span class="abs-perm-badge ${on ? 'perm-on' : 'perm-off perm-static'}">${bit}</span>`;
                        }
                        html += `<td class="abs-clist-perms">${grantsHtml}</td>`;
                    }
                    html += `</tr>`;
                }
                html += '</tbody></table>';
            }
        } else if (cc === 0) {
            html += '<div class="abs-clist-empty">Empty (cc\u00a0=\u00a00) \u2014 this abstraction holds no capabilities.</div>';
        } else {
            html += `<div class="abs-clist-count">cc\u00a0=\u00a0${cc} slot${cc !== 1 ? 's' : ''}</div>`;
            html += '<table class="abs-clist-table"><thead><tr>';
            html += '<th>#</th><th>GT (hex)</th><th>Perms</th><th>Type</th><th>Resolved Name</th>';
            html += '</tr></thead><tbody>';
            for (let si = 0; si < clistSlots.length; si++) {
                const gt32 = clistSlots[si];
                const slotLabel = isThreadLump ? `CR${si}` : `${si}`;
                if (gt32 === 0) {
                    html += `<tr><td class="abs-clist-idx">${slotLabel}</td><td colspan="4" class="abs-clist-empty-slot">\u2014 (empty slot)</td></tr>`;
                } else {
                    const parsed = sim.parseGT(gt32);
                    const p = { ...parsed.permissions, F: parsed.type === 2 ? 1 : 0 };
                    let permHtml = '';
                    for (const bit of ['B','R','W','X','E','L','S','F']) {
                        const cls = p[bit] ? 'perm-on' : 'perm-off';
                        permHtml += `<span class="abs-perm-badge ${cls}">${bit}</span>`;
                    }
                    let nameStr;
                    if (parsed.type === 3) {
                        const abInfo = sim.parseAbstractGT(gt32);
                        const DC = { 1: 'LED', 2: 'UART', 3: 'BTN', 4: 'TIMER', 5: 'DISPLAY' };
                        const dcName = DC[abInfo.device_class] || `dc${abInfo.device_class}`;
                        nameStr = `${dcName}[${abInfo.device_data}]`;
                    } else {
                        const nsIdx = parsed.index;
                        const label = (sim.nsLabels && sim.nsLabels[nsIdx]) ||
                            (typeof abstractionRegistry !== 'undefined' && abstractionRegistry &&
                             abstractionRegistry.abstractions && abstractionRegistry.abstractions[nsIdx] &&
                             abstractionRegistry.abstractions[nsIdx].name) || null;
                        nameStr = label ? `NS[${nsIdx}] \u2014 ${label}` : `NS[${nsIdx}]`;
                    }
                    const gtHex = '0x' + gt32.toString(16).toUpperCase().padStart(8, '0');
                    html += `<tr>`;
                    html += `<td class="abs-clist-idx">${slotLabel}</td>`;
                    html += `<td class="abs-clist-gt">${gtHex}</td>`;
                    html += `<td class="abs-clist-perms">${permHtml}</td>`;
                    html += `<td class="abs-clist-type">${parsed.typeName}</td>`;
                    html += `<td class="abs-clist-name">${nameStr}</td>`;
                    html += `</tr>`;
                }
            }
            html += '</tbody></table>';
        }
        html += '</div>';
    }

    {
        const methodPurposes = getMethodPurposes(abs);
        const methodExamples = getMethodExamples(abs);
        const methods = (abs.methods && abs.methods.length > 0) ? abs.methods : [];
        const uid = abs.index;
        html += '<div class="abs-detail-section abs-methods-section">';
        html += '<div class="abs-detail-label">Methods</div>';
        if (methods.length === 0) {
            html += '<div class="abs-method-empty">No methods registered \u2014 CALL enters the abstraction directly.</div>';
            const absLvlStatus = _implStatusGet(`abs:${uid}`);
            const absStatusOpts = IMPL_STATUS_LEVELS.map(s =>
                `<option value="${s}"${s === absLvlStatus ? ' selected' : ''}>${IMPL_STATUS_LABELS[s]}</option>`
            ).join('');
            html += `<div class="abs-method-tabs abs-method-tabs-empty" style="display:flex;align-items:center;gap:6px;margin-top:4px">`;
            html += `<span style="font-size:0.65rem;color:var(--text-secondary)">Status:</span>`;
            html += `<select class="impl-status-select impl-status-${absLvlStatus}" title="Abstraction implementation status" onchange="_implStatusSet('abs:${uid}',this.value);showAbstractionDetail(${uid})">${absStatusOpts}</select>`;
            html += `<button class="btn abs-method-ctrl-btn" title="Add method" onclick="absShowAddForm(${uid})">+</button>`;
            html += '</div>';
        } else {
            // Helper: determine compile-state badge for a method key
            const _getCompileState = (mKey) => {
                const md = userMethodData[mKey];
                if (!md) return 'pseudo';
                if (md.compileError) return 'error';
                if (md.compiled && md.compiled.length > 0) return 'compiled';
                if (md.example) return 'pseudo';
                return 'pseudo';
            };
            const _MONTHS_CS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const _fmtTs = ts => {
                if (!ts) return '—';
                const d = new Date(ts);
                const hh = String(d.getHours()).padStart(2, '0');
                const mm = String(d.getMinutes()).padStart(2, '0');
                return `${d.getDate()} ${_MONTHS_CS[d.getMonth()]} ${d.getFullYear()} ${hh}:${mm}`;
            };

            html += `<div class="abs-method-tabs" id="abs-tabs-${uid}">`;
            for (let mi = 0; mi < methods.length; mi++) {
                const m = methods[mi];
                const active = mi === 0 ? ' abs-method-tab-active' : '';
                const mStatus = _implStatusGet(`${uid}:${m}`);
                const badgeLabel = IMPL_STATUS_SHORT[mStatus] || mStatus;
                const mKey = `${uid}:${m}`;
                const compileState = _getCompileState(mKey);
                const csLabel = compileState === 'compiled' ? '\u2022Compiled' : compileState === 'error' ? '\u2022Error' : '\u2022Pseudo';
                const isMain = m.toLowerCase() === 'main';
                const mainTabClass = isMain ? ' abs-method-tab-main' : '';
                html += `<span class="abs-method-tab${active}${mainTabClass}" onclick="absOpenMethodInEditor(${uid},'${m}',this,'abs-panel-${uid}-${mi}')">`;
                html += `<span class="abs-method-selector-num" title="Selector ${mi + 1}">#${mi + 1}</span>`;
                html += `${m}`;
                if (isMain) html += `<span class="abs-method-main-badge" title="Primary entry point \u2014 CALL enters here with no selector">entry</span>`;
                html += `<span class="abs-compile-state-badge abs-compile-state-${compileState}" title="Compile state: ${csLabel}">${csLabel}</span>`;
                html += `<span class="abs-method-status-badge abs-method-status-badge-${mStatus}" onclick="event.stopPropagation();absToggleStatusDropdown(${uid},${mi},event)" title="Status: ${IMPL_STATUS_LABELS[mStatus]} — click to change">`;
                html += `<span class="abs-method-status-badge-dot"></span>${badgeLabel}`;
                html += `</span>`;
                html += `</span>`;
            }
            html += `<span class="abs-method-tab-spacer"></span>`;
            html += `<button class="btn abs-method-ctrl-btn" title="Add method" onclick="absShowAddForm(${uid})">+</button>`;
            html += `<button class="btn abs-method-ctrl-btn abs-method-del-ctrl" title="Delete method" onclick="absShowDeleteForm(${uid})">\u2212</button>`;
            html += '</div>';

            // Check if all methods have compiled words for LUMP assembly toolbar
            const _allCompiled = methods.every(function(m) {
                const md = userMethodData[`${uid}:${m}`];
                return md && md.compiled && md.compiled.length > 0;
            });
            const _anyCompiled = methods.some(function(m) {
                const md = userMethodData[`${uid}:${m}`];
                return md && (md.compiled || md.compileError);
            });
            {
                html += `<div class="abs-lump-assemble-bar">`;
                if (_anyCompiled) {
                    if (_allCompiled) {
                        html += `<span class="abs-lump-assemble-ready">\u2713 All methods compiled</span>`;
                    } else {
                        const _nComp = methods.filter(function(m) {
                            const md = userMethodData[`${uid}:${m}`];
                            return md && md.compiled && md.compiled.length > 0;
                        }).length;
                        html += `<span class="abs-lump-assemble-partial">${_nComp}/${methods.length} methods compiled</span>`;
                    }
                    html += `<button class="btn btn-sm abs-lump-assemble-btn" onclick="_assembleLumpFromCatalog(${uid})" title="Pack all compiled methods into a LUMP binary">Assemble LUMP</button>`;
                }
                html += `<button class="btn btn-sm abs-lump-export-btn" onclick="_exportAbsHistory(${uid})" title="Download compile history for all methods as JSON">Export history</button>`;
                html += `<button class="btn btn-sm abs-lump-import-btn" onclick="_importAbsHistory(${uid})" title="Restore compile history from a previously exported JSON file">Import history</button>`;
                html += `</div>`;
            }

            html += `<div class="abs-method-panels" id="abs-panels-${uid}">`;
            for (let mi = 0; mi < methods.length; mi++) {
                const m = methods[mi];
                const purpose = methodPurposes[m] || 'Dispatched via CALL';
                const example = methodExamples[m] || null;
                const display = mi === 0 ? '' : ' style="display:none"';
                const mKey2 = `${uid}:${m}`;
                const md = userMethodData[mKey2] || {};
                const isMainPanel = m.toLowerCase() === 'main';
                html += `<div class="abs-method-panel-item" id="abs-panel-${uid}-${mi}"${display}>`;
                html += `<div class="abs-method-panel-header">`;
                html += `<div class="abs-method-panel-name">`;
                html += `<span class="abs-method-panel-selector" title="Selector ${mi + 1}">#${mi + 1}</span>`;
                html += `${abs.name}.${m}`;
                if (isMainPanel) html += ` <span class="abs-method-main-badge abs-method-main-badge-lg" title="Primary entry point \u2014 CALL without a selector goes here">primary entry point</span>`;
                html += ` <button class="btn btn-xs abs-method-copy-call-btn" title="Copy: CALL ${abs.name}.${m}" onclick="event.stopPropagation();_absCopyCall('${abs.name.replace(/'/g,"\\'")}','${m.replace(/'/g,"\\'")}',this)">copy CALL</button>`;
                html += `</div>`;
                html += `<div class="abs-method-panel-actions">`;
                // Generate button (hidden if no OPENAI_API_KEY)
                if (window._hasOpenAIKey !== false) {
                    html += `<button class="btn btn-sm abs-generate-btn" title="Generate CLOOMC source using AI" onclick="absGenerateMethod(${uid},'${m.replace(/'/g,"\\'")}')">Generate \u2736</button>`;
                }
                html += `<button class="btn abs-method-ctrl-btn abs-method-edit-btn" title="Edit method" onclick="absShowEditForm(${uid},${mi})">&#9998;</button>`;
                html += `</div>`;
                html += `</div>`;
                html += `<div class="abs-method-panel-desc">${purpose}</div>`;
                const regConv = METHOD_REGISTER_CONVENTIONS[abs.name] && METHOD_REGISTER_CONVENTIONS[abs.name][m];
                if (regConv) {
                    html += '<table class="abs-reg-conv-table"><tbody>';
                    html += `<tr><td>Method Index</td><td>${regConv.index}</td></tr>`;
                    html += `<tr><td>Input</td><td>${regConv.input}</td></tr>`;
                    html += `<tr><td>Output</td><td>${regConv.output}</td></tr>`;
                    html += `<tr><td>Dispatch</td><td><code>${regConv.dispatch}</code></td></tr>`;
                    if (regConv.note) {
                        html += `<tr><td>Note</td><td>${regConv.note}</td></tr>`;
                    }
                    html += '</tbody></table>';
                }
                // Compile error display
                if (md.compileError) {
                    html += `<div class="abs-compile-error-block"><span class="abs-compile-error-label">\u2022Error</span><pre class="abs-compile-error-pre">${md.compileError.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></div>`;
                }
                // Compiled word count
                if (md.compiled && md.compiled.length > 0) {
                    html += `<div class="abs-compiled-meta">\u2022Compiled &mdash; ${md.compiled.length} word${md.compiled.length !== 1 ? 's' : ''}, ${md.compiledLang || 'unknown'}, ${_fmtTs(md.compiledAt)}</div>`;
                }
                // Source code block
                const liveSnips = (typeof ChurchAssembler !== 'undefined') ? ChurchAssembler.getLiveSnippets(abs.name, m) : null;
                if (liveSnips && liveSnips.length > 0) {
                    html += '<div class="snippet-history">';
                    html += `<span class="snippet-ts">compiled ${_fmtTs(liveSnips[0].ts)}</span>`;
                    html += `<pre class="abs-method-panel-code">${_annotateAbsCodeHtml(liveSnips[0].source)}</pre>`;
                    for (let _si = 1; _si < liveSnips.length; _si++) {
                        html += `<details><summary>compiled ${_fmtTs(liveSnips[_si].ts)}</summary>`;
                        html += `<pre class="abs-method-panel-code">${_annotateAbsCodeHtml(liveSnips[_si].source)}</pre>`;
                        html += `</details>`;
                    }
                    html += '</div>';
                } else if (md.example) {
                    html += `<pre class="abs-method-panel-code">${_annotateAbsCodeHtml(md.example)}</pre>`;
                } else if (example) {
                    html += `<pre class="abs-method-panel-code">${_annotateAbsCodeHtml(example)}</pre>`;
                }

                // Version history block
                const hist = md.history || [];
                if (hist.length > 0) {
                    html += `<details class="abs-method-history-details">`;
                    html += `<summary class="abs-method-history-summary">History (${hist.length} version${hist.length !== 1 ? 's' : ''})</summary>`;
                    html += `<div class="abs-method-history-list">`;
                    for (let hi = 0; hi < hist.length; hi++) {
                        const hv = hist[hi];
                        const hvState = hv.compileError ? 'error' : (hv.compiled && hv.compiled.length > 0 ? 'compiled' : 'pseudo');
                        const hvLabel = hvState === 'compiled' ? '\u2022Compiled' : hvState === 'error' ? '\u2022Error' : '\u2022Pseudo';
                        html += `<div class="abs-method-history-row">`;
                        html += `<span class="abs-method-history-ver">v${hist.length - hi}</span>`;
                        html += `<span class="abs-method-history-ts">${_fmtTs(hv.savedAt)}</span>`;
                        html += `<span class="abs-method-history-lang">${hv.lang || '—'}</span>`;
                        html += `<span class="abs-compile-state-badge abs-compile-state-${hvState}">${hvLabel}</span>`;
                        html += `<button class="btn btn-sm abs-method-history-restore" onclick="absRestoreMethodVersion(${uid},'${m.replace(/'/g,"\\'")}',${hi})" title="Load this version into the editor">Restore</button>`;
                        html += `</div>`;
                        if (hv.src) {
                            html += `<details class="abs-method-history-src-details"><summary>Source</summary><pre class="abs-method-panel-code abs-method-history-pre">${_annotateAbsCodeHtml(hv.src, hv.lang)}</pre></details>`;
                        }
                    }
                    html += `</div></details>`;
                }

                html += '</div>';
            }
            html += '</div>';
        }
        html += `<div class="abs-method-form-container" id="abs-form-${uid}"></div>`;
        html += '</div>';
    }

    const _methods = (abs.methods && abs.methods.length > 0) ? abs.methods : [];
    if (BOOT_SEQ_CODE[abs.index] !== undefined && _methods.length === 0) {
        html += '<div class="abs-detail-section abs-boot-code-section">';
        html += '<div class="abs-detail-label">Boot Sequence Code</div>';
        html += '<div class="abs-boot-code-desc">Installed implementation \u2014 executed by the STEP controller at power-on reset. Mirrors <code>_bootStep()</code> in simulator.js exactly.</div>';
        html += `<pre class="abs-method-panel-code abs-boot-code-pre">${_annotateAbsCodeHtml(BOOT_SEQ_CODE[abs.index])}</pre>`;
        html += '</div>';
    }

    html += '<div class="abs-detail-section">';
    html += '<div class="abs-detail-label">Properties</div>';
    html += '<table class="abs-props-table"><tbody>';
    html += `<tr><td>Index</td><td>${abs.index}</td></tr>`;
    html += `<tr><td>Name</td><td>${abs.name}</td></tr>`;
    html += `<tr><td>Layer</td><td>${abs.layer} \u2014 ${layerName}</td></tr>`;
    html += `<tr><td>Permissions</td><td>[${permStr}]</td></tr>`;
    html += `<tr><td>Chainable</td><td>${abs.chainable ? 'Yes' : 'No'}</td></tr>`;
    if (abs.handler) {
        html += `<tr><td>Handler</td><td>${abs.handler}</td></tr>`;
    }
    const faults = abs.faultCount || 0;
    const mtbf = (abstractionRegistry && faults > 0) ? abstractionRegistry.getMTBF(abs.index) : Infinity;
    const mtbfStr = mtbf === Infinity ? '\u221e (no faults)' : `${(mtbf / 1000).toFixed(1)}s`;
    html += `<tr><td>Fault Count</td><td>${faults}</td></tr>`;
    html += `<tr><td>MTBF</td><td>${mtbfStr}</td></tr>`;
    html += '</tbody></table>';
    html += '</div>';

    // ── Scheduler live runtime state (NS slot 8 only) ─────────────────────────
    if (abs.index === 8) {
        const _sa = (typeof sim !== 'undefined' && sim && sim.systemAbstractions) ? sim.systemAbstractions : null;
        const _ss = _sa ? _sa._schedulerState : null;
        const _irq = (typeof sim !== 'undefined' && sim) ? sim.irqState : null;

        html += '<div class="abs-detail-section">';
        html += '<div class="abs-detail-label">Live Scheduler State</div>';
        html += '<div class="sched-state-section">';

        if (!_ss && !_irq) {
            html += '<div style="color:#666;font-size:0.8rem;font-style:italic;">Boot the simulator to see live scheduler state.</div>';
        } else {
            const _sweepCount = _ss ? (_ss._irqSweepCount || 0) : 0;
            const _threads = (_ss && Array.isArray(_ss.threads)) ? _ss.threads : [];
            const _timerArmed = _irq ? !!_irq.timerArmed : false;
            const _timerDeadline = _irq ? (_irq.timerDeadline || 0) : 0;
            const _timerDuration = _irq ? (_irq.timerDuration || 0) : 0;
            const _stepCount = (typeof sim !== 'undefined' && sim) ? (sim.stepCount || 0) : 0;
            const _irqActive = _irq ? !!_irq.irqActive : false;
            const _countdown = _timerArmed ? Math.max(0, _timerDeadline - _stepCount) : 0;

            html += '<table class="sched-state-table">';
            html += `<tr><td>IRQ sweep count</td><td><span class="sched-sweep-count">${_sweepCount}</span></td></tr>`;
            html += `<tr><td>Active threads</td><td><span class="sched-thread-count">${_threads.length}</span></td></tr>`;
            html += `<tr><td>IRQ active</td><td>${_irqActive ? '<span style="color:#ff9800;font-weight:600;">yes</span>' : '<span style="color:#666;">no</span>'}</td></tr>`;
            if (_timerArmed) {
                html += `<tr><td>Timer</td><td><span class="sched-timer-armed">&#x23F0; ARMED</span> &mdash; fires at step&nbsp;${_timerDeadline} (${_countdown} step${_countdown !== 1 ? 's' : ''} remaining, duration&nbsp;${_timerDuration})</td></tr>`;
            } else {
                html += `<tr><td>Timer</td><td><span class="sched-timer-disarmed">disarmed</span></td></tr>`;
            }
            if (_threads.length > 0) {
                html += `<tr><td style="vertical-align:top;">Threads</td><td>`;
                for (const _t of _threads) {
                    const _stateColor = _t.state === 'running' ? '#66bb6a' : _t.state === 'sleeping' ? '#ffb74d' : '#9ca3af';
                    html += `<div style="margin-bottom:2px;"><span style="color:${_stateColor};font-weight:600;">${_t.state || '?'}</span>&nbsp;<span style="color:#a0a0c0;">${_t.name || ('thread-' + _t.id)}</span> <span style="color:#666;">#${_t.id}</span></div>`;
                }
                html += `</td></tr>`;
            }
            html += '</table>';
        }
        html += '</div>';
        html += '</div>';
    }

    html += '<div class="abs-detail-section">';
    html += '<div class="abs-detail-label">CR6/CR14 Canonical Form</div>';
    html += '<div class="abs-canonical">';
    html += '<div class="abs-canonical-diagram">';
    html += `<div class="abs-cr-box cr6-box">`;
    html += `<div class="abs-cr-label">CR6 (C-List)</div>`;
    html += `<div class="abs-cr-content">GT \u2192 NS[${abs.index}]</div>`;
    html += `<div class="abs-cr-perms">[E] Enter permission</div>`;
    html += `</div>`;
    html += `<div class="abs-cr-arrow">\u2192 CALL \u2192</div>`;
    html += `<div class="abs-cr-box cr7-box">`;
    html += `<div class="abs-cr-label">CR14 (CLOOMC)</div>`;
    html += `<div class="abs-cr-content">Code at NS[${abs.index}].location</div>`;
    html += `<div class="abs-cr-perms">[X] Execute permission</div>`;
    html += `</div>`;
    html += '</div>';
    html += '</div>';
    html += '</div>';

    if (abs.doc) {
        html += '<div class="abs-detail-section abs-doc-section">';
        html += '<div class="abs-doc-label">Self-Documentation</div>';
        if (abs.doc.author) html += `<div class="abs-doc-field"><strong>Author:</strong> ${abs.doc.author}</div>`;
        if (abs.doc.date) html += `<div class="abs-doc-field"><strong>Date:</strong> ${abs.doc.date}</div>`;
        if (abs.doc.languageLabel) html += `<div class="abs-doc-field"><strong>Language:</strong> ${abs.doc.languageLabel}</div>`;
        if (abs.doc.description) html += `<div class="abs-doc-field"><strong>Description:</strong> ${abs.doc.description}</div>`;
        if (abs.doc.tags && abs.doc.tags.length > 0) html += `<div class="abs-doc-field"><strong>Tags:</strong> ${abs.doc.tags.join(', ')}</div>`;
        if (abs.doc.methods && abs.doc.methods.length > 0) {
            html += '<div class="abs-doc-field"><strong>Method Signatures:</strong></div>';
            for (const m of abs.doc.methods) {
                const params = m.params && m.params.length > 0 ? `(${m.params.join(', ')})` : '()';
                html += `<div class="abs-doc-field" style="padding-left:1rem;">${m.name}${params} — ${m.instructions} instruction${m.instructions !== 1 ? 's' : ''}</div>`;
            }
        }
        html += '</div>';
    }

    if (abs.layer === 7) {
        html += '<div class="abs-detail-section abs-note-security">';
        html += '<div class="abs-detail-label">Internet Security Model</div>';
        html += '<div class="abs-note-text">Layer 7 abstractions use L (Load) permission for accessing remote resources. ';
        html += 'The F-bit (Far) on namespace entries routes access through encrypted capability tunnels. ';
        html += 'All Internet abstractions require parent-approved contact lists \u2014 children can only reach ';
        html += 'endpoints whose GTs appear in their c-list. No ambient authority, no URLs, no DNS \u2014 ';
        html += 'only capabilities.</div>';
        html += '</div>';
    }

    if (abs.layer === 5) {
        html += '<div class="abs-detail-section abs-note-security">';
        html += '<div class="abs-detail-label">Namespace Isolation</div>';
        html += '<div class="abs-note-text">Layer 5 social abstractions operate within isolated namespaces. ';
        html += 'Each child\'s social interactions are mediated through CALL/RETURN \u2014 the abstraction ';
        html += 'receives only the capabilities explicitly passed by the caller. Parent oversight is ';
        html += 'enforced via the Family abstraction (NS[28]) which must approve all social connections. ';
        html += 'SWITCH instruction can move between namespace domains atomically.</div>';
        html += '</div>';
    }

    {
        const _srHtml = _buildSignedReturnHtml(abs.index);
        const _srStyle = _srHtml ? '' : ' style="display:none;"';
        html += `<div class="abs-detail-section abs-signed-return-section" id="absSignedReturnSection"${_srStyle}>`;
        html += _srHtml;
        html += '</div>';
    }

    if (abs.index === 51) {
        html += '<div class="abs-detail-section abs-note-security">';
        html += '<div class="abs-detail-label">XC7A100T Hardware — Ethernet</div>';
        html += '<table class="abs-props-table"><tbody>';
        html += '<tr><td>Board</td><td>QMTECH Wukong Artix-7 XC7A100T</td></tr>';
        html += '<tr><td>NS Slot</td><td>51</td></tr>';
        html += '<tr><td>Token</td><td><code>0x00003300</code></td></tr>';
        html += '<tr><td>Permissions</td><td>[E] — callers hold E-only GT; device GT is internal</td></tr>';
        html += '<tr><td>Transport</td><td>Raw Ethernet frames (no TCP/IP stack)</td></tr>';
        html += '<tr><td>Role</td><td>Lazy-load channel — Locator fetches all other abstractions through it</td></tr>';
        html += '</tbody></table>';
        html += '<div class="abs-note-text" style="margin-top:8px;">';
        html += 'This abstraction is present <strong>only</strong> in the 3-LUMP XC7A100T ROM image. ';
        html += 'Tang Nano 20K and Ti60 F225 boots use UART (Tunnel abstraction) as the lazy-load channel instead. ';
        html += '</div>';
        html += `<div style="margin-top:8px;"><a href="#" class="abs-doc-link" onclick="event.preventDefault();openDocAnchor('hardware-wukong-xc7a100t.md','#ethernet-abstraction-ns-slot-51')">View hardware documentation \u2192</a></div>`;
        html += '</div>';
    }

    if (abs.name === 'SlideRule') {
        html += '<div class="abs-detail-section abs-note-security">';
        html += '<div class="abs-detail-label">Namespace Extension Model</div>';
        html += '<div class="abs-note-text">SlideRule demonstrates the Church Machine\u2019s extensibility principle: ';
        html += 'one CALL opcode, one namespace entry (NS[16]), and 22 methods accessed via two dispatch rules.<br><br>';
        html += '<b>Rule 1 \u2014 Direct (methods 0\u201314):</b> <code>CALL d, CRs, #imm</code> \u2014 the method index is the bare number <code>d</code> ';
        html += 'encoded directly in the instruction. Example: <code>CALL 0, CR6, 16</code> calls Multiply (index 0) from c-list offset 16.<br>';
        html += '<b>Rule 2 \u2014 DR3 Escape (methods 15+):</b> <code>CALL 15, CRs, #imm</code> \u2014 when <code>d=15</code>, the hardware reads DR3 ';
        html += 'as the actual method index. Set DR3 first, then issue the escape CALL. ';
        html += 'Example: <code>IADD DR3, DR0, #17</code> then <code>CALL 15, CR6, 16</code> calls GCD (index 17).<br><br>';
        html += 'Adding a new method means adding one entry to the dispatch table \u2014 no new instructions, no hardware changes, no grammar changes. ';
        html += 'The namespace IS the extension mechanism.</div>';
        html += '</div>';
    }

    contentEl.innerHTML = html;
}

function absSelectMethod(tabEl, panelId) {
    const tabsContainer = tabEl.parentElement;
    tabsContainer.querySelectorAll('.abs-method-tab').forEach(t => t.classList.remove('abs-method-tab-active'));
    tabEl.classList.add('abs-method-tab-active');
    const panelsContainer = tabsContainer.nextElementSibling;
    if (panelsContainer) {
        panelsContainer.querySelectorAll('.abs-method-panel-item').forEach(p => p.style.display = 'none');
    }
    const panel = document.getElementById(panelId);
    if (panel) panel.style.display = '';
}

function absOpenMethodInEditor(absIdx, methodName, tabEl, panelId) {
    absSelectMethod(tabEl, panelId);

    // Method-tab clicks always load catalog source into the editor and set the
    // edit context. The backing LUMP (if any) is a reference file accessible from
    // the Lumps view — clicking a method tab is specifically a "write this method"
    // action, so we never redirect to openLumpInEditor here.
    const key = `${absIdx}:${methodName}`;
    const abs = (typeof abstractionRegistry !== 'undefined' && abstractionRegistry)
                    ? abstractionRegistry.getAbstraction(absIdx) : null;

    // Prefer userMethodData.example (catalog source, persisted), then static examples.
    let code;
    if (userMethodData[key] && userMethodData[key].example) {
        code = userMethodData[key].example;
    } else {
        const examples = abs ? getMethodExamples(abs) : {};
        code = (examples && examples[methodName])
            || `; ${abs ? abs.name + '.' : ''}${methodName}\n; Write CLOOMC++ assembly here and click Compile & Save.\n`;
    }

    if (typeof switchView === 'function') switchView('editor');
    const sel = document.getElementById('langSelector');
    if (sel) sel.value = 'assembly';
    const asmEd = document.getElementById('asmEditor');
    if (asmEd) {
        asmEd.value = code;
        if (typeof updateLineNumbers === 'function') updateLineNumbers();
    }
    const outEl = document.getElementById('assemblyOutput');
    if (outEl) outEl.innerHTML = '';

    // Set catalog edit context so Save button shows "↑ Compile & Save"
    window._pseudoEditContext = { absIdx: absIdx, methodName: methodName };
    if (typeof updateSavePseudoBtn === 'function') updateSavePseudoBtn();
}

function absShowAddForm(absIdx) {
    const fc = document.getElementById(`abs-form-${absIdx}`);
    if (!fc) return;
    if (fc.dataset.mode === 'add') { fc.innerHTML = ''; fc.dataset.mode = ''; return; }
    fc.dataset.mode = 'add';
    fc.innerHTML = `
<div class="abs-method-form">
  <div class="abs-method-form-title">Add Method</div>
  <label class="abs-method-form-label">Method name</label>
  <input class="abs-method-form-input" id="abs-add-name-${absIdx}" type="text" placeholder="e.g. Run" spellcheck="false">
  <label class="abs-method-form-label">Description</label>
  <textarea class="abs-method-form-textarea" id="abs-add-desc-${absIdx}" rows="2" placeholder="What this method does…"></textarea>
  <label class="abs-method-form-label">Pseudocode / Assembly (optional)</label>
  <textarea class="abs-method-form-textarea abs-method-form-code" id="abs-add-code-${absIdx}" rows="4" placeholder="; assembly here…" spellcheck="false"></textarea>
  <div class="abs-method-form-actions">
    <button class="btn btn-sm" onclick="absSaveMethod(${absIdx})">Save</button>
    <button class="btn btn-sm abs-method-form-cancel" onclick="absHideForm(${absIdx})">Cancel</button>
  </div>
</div>`;
}

function absShowDeleteForm(absIdx) {
    const fc = document.getElementById(`abs-form-${absIdx}`);
    if (!fc) return;
    if (fc.dataset.mode === 'del') { fc.innerHTML = ''; fc.dataset.mode = ''; return; }
    const abs = abstractionRegistry && abstractionRegistry.getAbstraction(absIdx);
    if (!abs || !abs.methods || abs.methods.length === 0) return;
    fc.dataset.mode = 'del';
    let opts = abs.methods.map(m => `<option value="${m}">${m}</option>`).join('');
    fc.innerHTML = `
<div class="abs-method-form">
  <div class="abs-method-form-title">Delete Method</div>
  <label class="abs-method-form-label">Select method to remove</label>
  <select class="abs-method-form-select" id="abs-del-select-${absIdx}">${opts}</select>
  <div class="abs-method-form-actions">
    <button class="btn btn-sm abs-method-del-confirm" onclick="absDeleteMethod(${absIdx})">Delete</button>
    <button class="btn btn-sm abs-method-form-cancel" onclick="absHideForm(${absIdx})">Cancel</button>
  </div>
</div>`;
}

function absHideForm(absIdx) {
    const fc = document.getElementById(`abs-form-${absIdx}`);
    if (fc) { fc.innerHTML = ''; fc.dataset.mode = ''; }
}

// Restore a history version: loads its source into the editor and sets the edit context
function absRestoreMethodVersion(absIdx, methodName, histIdx) {
    const key = `${absIdx}:${methodName}`;
    const md = userMethodData[key];
    if (!md || !md.history || !md.history[histIdx]) return;
    const hv = md.history[histIdx];
    const src = hv.src || '';

    if (typeof switchView === 'function') switchView('editor');
    const sel = document.getElementById('langSelector');
    if (sel) sel.value = 'assembly';
    const asmEd = document.getElementById('asmEditor');
    if (asmEd) {
        asmEd.value = src;
        if (typeof updateLineNumbers === 'function') updateLineNumbers();
    }
    const outEl = document.getElementById('assemblyOutput');
    if (outEl) outEl.innerHTML = '';

    window._pseudoEditContext = { absIdx: absIdx, methodName: methodName };
    if (typeof updateSavePseudoBtn === 'function') updateSavePseudoBtn();

    const msg = document.createElement('div');
    msg.style.cssText = 'color:#ffb74d;font-style:italic;padding:2px 0;';
    msg.textContent = '\u21ba Restored v' + (md.history.length - histIdx) + ' of ' + methodName + ' \u2014 review and click Compile & Save when ready';
    if (outEl) outEl.appendChild(msg);
    setTimeout(function() { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 4000);
}

// Check if all methods for an abstraction are compiled; if so, auto-build the LUMP
// in memory and surface the Load-into-Sim toolbar in the editor console.
// No download is triggered — the "Assemble LUMP" button in the catalog panel handles that.
function _tryAutoAssembleLump(absIdx) {
    const abs = (typeof abstractionRegistry !== 'undefined' && abstractionRegistry)
        ? abstractionRegistry.getAbstraction(absIdx) : null;
    if (!abs || !abs.methods || abs.methods.length === 0) return;
    const allCompiled = abs.methods.every(function(m) {
        const md = userMethodData[`${absIdx}:${m}`];
        return md && md.compiled && md.compiled.length > 0;
    });

    // Always refresh the detail panel so the Assemble LUMP bar updates
    if (typeof showAbstractionDetail === 'function') showAbstractionDetail(absIdx);

    if (!allCompiled) return;

    // Build the LUMP binary in memory (same layout as _assembleLumpFromCatalog)
    const methods = abs.methods;
    const N = methods.length;
    const methodTable = [];
    const bodies = [];
    let bodyOffset = N;
    for (let i = 0; i < N; i++) {
        const md = userMethodData[`${absIdx}:${methods[i]}`] || {};
        const code = (md.compiled && md.compiled.length > 0) ? md.compiled : [0];
        // Emit a BRANCH instruction (opcode 23 in v2.0) as the method-table entry.
        // Mirrors _assembleLumpFromCatalog: branchOffset = bodyOffset - i.
        // CALL dispatcher resolves: pc = (methodIndex-1) + offset = i + (bodyOffset-i) = bodyOffset.
        const branchOffset = bodyOffset - i;
        methodTable.push(((23 << 27) | (branchOffset & 0x7FFF)) >>> 0);
        bodies.push(code);
        bodyOffset += code.length;
    }
    const totalWords = 1 + N + bodies.reduce(function(s, b) { return s + b.length; }, 0);
    const buf = new Uint32Array(totalWords);
    let lumpSize = 64;
    while (lumpSize < totalWords) lumpSize *= 2;
    const n_minus_6 = Math.round(Math.log2(lumpSize)) - 6;
    const cw = totalWords - 1;
    buf[0] = ((0x1F << 27) | ((n_minus_6 & 0xF) << 23) | ((cw & 0x1FFF) << 10)) >>> 0;
    for (let i = 0; i < N; i++) buf[1 + i] = methodTable[i] >>> 0;
    let wp = 1 + N;
    for (const body of bodies) { for (const w of body) { buf[wp++] = w >>> 0; } }

    // Persist in-memory payload for Load-into-Sim
    window._lastCatalogLumpWords = Array.from(buf.slice(1, totalWords));
    window._lastCatalogLumpName = abs.name;

    // Show Load-into-Sim toolbar in the editor console
    const con = document.getElementById('editorConsole');
    if (con) {
        con.className = 'cmp-html';
        con.innerHTML = `<div class="cmp-load-toolbar">
            <button class="cmp-load-sim-btn" onclick="_loadCatalogLumpIntoSim()" data-tooltip="Load assembled catalog LUMP into the simulator">Load into Sim &#x25b6;</button>
            <button class="cmp-load-sim-btn" style="margin-left:6px;background:rgba(74,222,128,0.15);color:#4ade80;border-color:rgba(74,222,128,0.4);" onclick="_assembleLumpFromCatalog(${absIdx})" data-tooltip="Download LUMP binary">Download .lump</button>
        </div>
        <div class="cmp-file-hdr">; Auto-assembled catalog LUMP \u2014 &quot;${abs.name.replace(/</g,'&lt;')}&quot; \u2014 ${N} method${N!==1?'s':''}, ${totalWords} words (all compiled)</div>`;
    }
}

// Assemble a LUMP binary from all compiled methods and offer download + Load into Sim
// NOTE: The pure encoding logic below mirrors simulator/lump_assembler.js (assembleLump).
// Browser code cannot use require(), so this is an inline copy.
// Any change to the BRANCH-encoding formula or header packing MUST also be applied
// to lump_assembler.js in the same commit.
function _assembleLumpFromCatalog(absIdx) {
    const abs = (typeof abstractionRegistry !== 'undefined' && abstractionRegistry)
        ? abstractionRegistry.getAbstraction(absIdx) : null;
    if (!abs || !abs.methods || abs.methods.length === 0) return;

    const methods = abs.methods;
    const N = methods.length;
    const methodTable = [];   // one entry per method: lump-word address of body start
    const bodies = [];        // concatenated body word arrays

    let bodyOffset = N;  // first body starts at lump-word N+1; lump-relative PC = N
    for (let i = 0; i < N; i++) {
        const md = userMethodData[`${absIdx}:${methods[i]}`] || {};
        const code = (md.compiled && md.compiled.length > 0) ? md.compiled : [0]; // zero-pad placeholder
        // Emit a BRANCH instruction (opcode 23 in v2.0) as the method-table entry.
        // The table entry for method (i+1) sits at lump word (i+1), lump-relative PC = i.
        // Branch offset = bodyOffset - i so the CALL dispatcher resolves:
        //   new pc = (methodIndex - 1) + offset = i + (bodyOffset - i) = bodyOffset.
        // Fetch: physAddr = lump_base + 1 + bodyOffset → first instruction of the body.
        const branchOffset = bodyOffset - i;
        methodTable.push(((23 << 27) | (branchOffset & 0x7FFF)) >>> 0);
        bodies.push(code);
        bodyOffset += code.length;
    }

    // Pack words: header (word 0) + method table + bodies
    const totalWords = 1 + N + bodies.reduce(function(s, b) { return s + b.length; }, 0);
    const buf = new Uint32Array(totalWords);
    // Word 0: lump header — simplified (magic + cw + cc)
    // magic=0x1F (5 bits), n_minus_6 (4 bits, size=next pow2>=totalWords), cw (13 bits), cc (8 bits)
    let lumpSize = 64;
    while (lumpSize < totalWords) lumpSize *= 2;
    const n_minus_6 = Math.round(Math.log2(lumpSize)) - 6;
    const cw = totalWords - 1;  // code words excluding header
    const cc = 0;               // no capabilities in assembled LUMP
    buf[0] = ((0x1F << 27) | ((n_minus_6 & 0xF) << 23) | ((cw & 0x1FFF) << 10) | (cc & 0xFF)) >>> 0;
    for (let i = 0; i < N; i++) buf[1 + i] = methodTable[i] >>> 0;
    let wp = 1 + N;
    for (const body of bodies) {
        for (const w of body) { buf[wp++] = w >>> 0; }
    }

    // Zero-pad to lumpSize
    const padded = new Uint32Array(lumpSize);
    padded.set(buf);

    // Convert to byte array (big-endian)
    const bytes = new Uint8Array(lumpSize * 4);
    for (let i = 0; i < lumpSize; i++) {
        bytes[i * 4 + 0] = (padded[i] >>> 24) & 0xFF;
        bytes[i * 4 + 1] = (padded[i] >>> 16) & 0xFF;
        bytes[i * 4 + 2] = (padded[i] >>> 8) & 0xFF;
        bytes[i * 4 + 3] = padded[i] & 0xFF;
    }

    const filename = (abs.name || 'abstraction').toLowerCase().replace(/[^a-z0-9_]/g, '_') + '.lump';
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Also offer Load into Sim using the word array
    const words = Array.from(buf.slice(1, totalWords));  // skip header
    window._lastCatalogLumpWords = words;
    window._lastCatalogLumpName = abs.name;

    // Show feedback
    const outEl = document.getElementById('assemblyOutput');
    if (outEl) {
        const msg = document.createElement('div');
        msg.style.cssText = 'color:#8f8;font-weight:600;padding:2px 0;';
        msg.textContent = '\u2713 LUMP assembled \u2014 ' + totalWords + ' words, downloading ' + filename;
        outEl.appendChild(msg);
        setTimeout(function() { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 3000);
    }

    if (typeof switchView === 'function') switchView('editor');
    const con = document.getElementById('editorConsole');
    if (con) {
        con.className = 'cmp-html';
        con.innerHTML = `<div class="cmp-load-toolbar">
            <button class="cmp-load-sim-btn" onclick="_loadCatalogLumpIntoSim()" data-tooltip="Load assembled catalog LUMP into the simulator">Load into Sim &#x25b6;</button>
        </div>
        <div class="cmp-file-hdr">; Catalog LUMP \u2014 &quot;${abs.name.replace(/</g,'&lt;')}&quot; \u2014 ${N} method${N!==1?'s':''}, ${totalWords} words</div>`;
    }
}

// Load the most-recently assembled catalog LUMP into the simulator.
// Uses sim.loadProgram() directly so the NS-slot redirect and CR14
// wiring happen immediately (extended-code path included).
function _loadCatalogLumpIntoSim() {
    const words = window._lastCatalogLumpWords;
    const name = window._lastCatalogLumpName || 'catalog';
    if (!words || !words.length) return;

    if (!sim.bootComplete && typeof instantBoot === 'function') instantBoot();

    // Call loadProgram() directly — handles NS-slot 3 redirect + CR14 wiring.
    sim.loadProgram(words, 0);
    if (typeof _syncBootEntryFromSim === 'function') _syncBootEntryFromSim();

    // Mirror into lastAssembledWords so C-list injection and other
    // post-load machinery (save-to-NS, code-view labels, etc.) still work.
    if (typeof lastAssembledWords !== 'undefined') lastAssembledWords = words.slice();
    if (typeof _defaultProgramLoaded !== 'undefined') window._defaultProgramLoaded = true;
    // C-list injection: call _injectClistNow if available, otherwise fall
    // through to _applyPendingSimLoad on first Step/Run.
    if (typeof _injectClistNow === 'function') {
        _injectClistNow();
        if (typeof _pendingSimLoad !== 'undefined') window._pendingSimLoad = false;
    } else {
        if (typeof _pendingSimLoad !== 'undefined') window._pendingSimLoad = true;
    }
    if (sim.programName !== undefined) sim.programName = name;

    const btn = document.querySelector('[onclick="_loadCatalogLumpIntoSim()"]');
    if (btn) { btn.textContent = 'Loaded \u2713'; btn.disabled = true; }

    const con = document.getElementById('editorConsole');
    if (con) {
        con.className = '';
        con.textContent = 'Loaded catalog LUMP \u201c' + name + '\u201d \u2014 ' + words.length + ' words \u2014 click Step or Run';
    }
}

// ── Export / Import history (JSON roundtrip) ─────────────────────────────────

/**
 * Export compile history for all methods of an abstraction as a JSON file.
 * Schema: { version:1, abstractionName, abstractionIndex, methods: { name: entry } }
 */
function _exportAbsHistory(absIdx) {
    const abs = (typeof abstractionRegistry !== 'undefined' && abstractionRegistry)
        ? abstractionRegistry.getAbstraction(absIdx) : null;
    if (!abs) return;

    const methods = abs.methods || [];
    const exported = {};
    for (const m of methods) {
        exported[m] = userMethodData[`${absIdx}:${m}`] || {};
    }

    const payload = {
        version: 1,
        abstractionName: abs.name,
        abstractionIndex: absIdx,
        methods: exported
    };

    const json = JSON.stringify(payload, null, 2);
    const filename = (abs.name || 'abstraction').toLowerCase().replace(/[^a-z0-9_]/g, '_') + '_history.json';
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Import compile history from a JSON file produced by _exportAbsHistory.
 * Merges into the current abstraction's userMethodData entries without
 * touching any other abstraction's data.
 */
function _importAbsHistory(absIdx) {
    const abs = (typeof abstractionRegistry !== 'undefined' && abstractionRegistry)
        ? abstractionRegistry.getAbstraction(absIdx) : null;
    if (!abs) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);

    function _cleanupInput() {
        if (input.parentNode) document.body.removeChild(input);
    }

    input.addEventListener('cancel', _cleanupInput);
    window.addEventListener('focus', function _winFocus() {
        window.removeEventListener('focus', _winFocus);
        setTimeout(_cleanupInput, 500);
    }, { once: true });

    input.addEventListener('change', function() {
        const file = input.files && input.files[0];
        _cleanupInput();
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            let payload;
            try {
                payload = JSON.parse(e.target.result);
            } catch (err) {
                _absHistoryImportError(absIdx, 'Invalid JSON: ' + err.message);
                return;
            }

            // Schema validation
            if (!payload || typeof payload !== 'object') {
                _absHistoryImportError(absIdx, 'File is not a valid history export (expected a JSON object).');
                return;
            }
            if (payload.version !== 1) {
                _absHistoryImportError(absIdx, 'Unsupported history version: ' + JSON.stringify(payload.version) + '. Expected 1.');
                return;
            }
            if (typeof payload.abstractionName !== 'string') {
                _absHistoryImportError(absIdx, 'Missing or invalid "abstractionName" field.');
                return;
            }
            if (!payload.methods || typeof payload.methods !== 'object' || Array.isArray(payload.methods)) {
                _absHistoryImportError(absIdx, 'Missing or invalid "methods" field (expected an object).');
                return;
            }

            // Identity check: warn if the file came from a different abstraction
            const nameMismatch = payload.abstractionName !== abs.name;
            if (nameMismatch) {
                const ok = confirm(
                    'This history file is from "' + payload.abstractionName + '" but you are importing into "' + abs.name + '".\n\n' +
                    'Only methods whose names match this abstraction will be imported. Continue?'
                );
                if (!ok) return;
            }

            const knownMethods = new Set(abs.methods || []);
            const VALID_KEYS = new Set(['purpose', 'example', 'compiled', 'compiledLang', 'compiledAt', 'compileError', 'history']);
            let importCount = 0;
            let skipCount = 0;
            for (const [mName, entry] of Object.entries(payload.methods)) {
                if (!entry || typeof entry !== 'object') {
                    _absHistoryImportError(absIdx, 'Method "' + mName + '" has an invalid entry (expected an object).');
                    return;
                }
                // Skip methods not present in this abstraction's method list
                if (!knownMethods.has(mName)) {
                    skipCount++;
                    continue;
                }
                const entryKeys = Object.keys(entry);
                if (entryKeys.length === 0) continue;
                const hasKnownKey = entryKeys.some(k => VALID_KEYS.has(k));
                if (!hasKnownKey) {
                    _absHistoryImportError(absIdx, 'Method "' + mName + '" entry has no recognised fields (expected at least one of: purpose, example, compiled, history).');
                    return;
                }
                if (entry.compiled !== undefined && !Array.isArray(entry.compiled)) {
                    _absHistoryImportError(absIdx, 'Method "' + mName + '": "compiled" must be an array.');
                    return;
                }
                if (entry.history !== undefined && !Array.isArray(entry.history)) {
                    _absHistoryImportError(absIdx, 'Method "' + mName + '": "history" must be an array.');
                    return;
                }

                // Whitelist: only carry known fields into the merge
                const safeEntry = {};
                for (const k of VALID_KEYS) {
                    if (Object.prototype.hasOwnProperty.call(entry, k)) safeEntry[k] = entry[k];
                }

                const key = `${absIdx}:${mName}`;
                const prev = userMethodData[key] || {};
                userMethodData[key] = Object.assign({}, prev, safeEntry);
                importCount++;
            }

            _absMethodsSave();
            showAbstractionDetail(absIdx);

            const outEl = document.getElementById('assemblyOutput');
            if (outEl) {
                const msg = document.createElement('div');
                msg.style.cssText = 'color:#8f8;font-weight:600;padding:2px 0;';
                let summary = '\u2713 History imported from "' + payload.abstractionName + '" \u2014 ' +
                    importCount + ' method' + (importCount !== 1 ? 's' : '') + ' merged';
                if (skipCount > 0) summary += ', ' + skipCount + ' unknown skipped';
                summary += '.';
                msg.textContent = summary;
                outEl.appendChild(msg);
                setTimeout(function() { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 4000);
            }
        };
        reader.readAsText(file);
    });

    input.click();
}

function _absHistoryImportError(absIdx, message) {
    const outEl = document.getElementById('assemblyOutput');
    if (outEl) {
        const msg = document.createElement('div');
        msg.style.cssText = 'color:#f87171;font-weight:600;padding:2px 0;';
        msg.textContent = '\u2717 Import failed: ' + message;
        outEl.appendChild(msg);
        setTimeout(function() { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 6000);
    } else {
        alert('History import failed: ' + message);
    }
}

// AI-assisted method generation (Phase 2)
function absGenerateMethod(absIdx, methodName) {
    const abs = (typeof abstractionRegistry !== 'undefined' && abstractionRegistry)
        ? abstractionRegistry.getAbstraction(absIdx) : null;
    const absName = abs ? abs.name : ('NS[' + absIdx + ']');
    const purposes = abs ? getMethodPurposes(abs) : {};
    const desc = purposes[methodName] || '';
    const caps = (abs && abs.capabilities) ? abs.capabilities : [];

    const btn = document.activeElement;
    if (btn) { btn.textContent = 'Generating\u2026'; btn.disabled = true; }

    const _genHeaders = { 'Content-Type': 'application/json' };
    if (window._generateToken) _genHeaders['X-Generate-Token'] = window._generateToken;

    fetch('/api/generate-method', {
        method: 'POST',
        headers: _genHeaders,
        body: JSON.stringify({
            abstraction: absName,
            method: methodName,
            description: desc,
            capabilities: caps
        })
    }).then(function(r) { return r.json(); }).then(function(data) {
        if (data.source) {
            if (typeof switchView === 'function') switchView('editor');
            const asmEd = document.getElementById('asmEditor');
            if (asmEd) {
                asmEd.value = data.source;
                if (typeof updateLineNumbers === 'function') updateLineNumbers();
            }
            window._pseudoEditContext = { absIdx: absIdx, methodName: methodName };
            if (typeof updateSavePseudoBtn === 'function') updateSavePseudoBtn();
            const outEl = document.getElementById('assemblyOutput');
            if (outEl) {
                const msg = document.createElement('div');
                msg.style.cssText = 'color:#c084fc;font-style:italic;padding:2px 0;';
                msg.textContent = '\u2736 AI draft for ' + methodName + ' loaded \u2014 review and click Compile & Save when ready';
                outEl.appendChild(msg);
                setTimeout(function() { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 5000);
            }
        } else {
            alert('Generate failed: ' + (data.error || 'unknown error'));
        }
    }).catch(function(err) {
        alert('Generate request failed: ' + err.message);
    }).finally(function() {
        if (btn) { btn.textContent = 'Generate \u2736'; btn.disabled = false; }
    });
}

function absShowEditForm(absIdx, mi) {
    const fc = document.getElementById(`abs-form-${absIdx}`);
    if (!fc) return;
    const abs = abstractionRegistry && abstractionRegistry.getAbstraction(absIdx);
    if (!abs) return;
    const mName = abs.methods[mi];
    if (!mName) return;
    if (fc.dataset.mode === 'edit' && fc.dataset.editTarget === mName) {
        fc.innerHTML = ''; fc.dataset.mode = ''; fc.dataset.editTarget = ''; return;
    }
    const purposes = getMethodPurposes(abs);
    const examples = getMethodExamples(abs);
    const curDesc = purposes[mName] || '';
    const curCode = examples[mName] || '';
    const safe = mName.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    fc.dataset.mode = 'edit';
    fc.dataset.editTarget = mName;
    fc.innerHTML = `
<div class="abs-method-form">
  <div class="abs-method-form-title">Edit \u2014 ${safe}</div>
  <label class="abs-method-form-label">Description</label>
  <textarea class="abs-method-form-textarea" id="abs-edit-desc-${absIdx}" rows="2">${curDesc.replace(/</g,'&lt;')}</textarea>
  <label class="abs-method-form-label">Pseudocode / Assembly</label>
  <textarea class="abs-method-form-textarea abs-method-form-code" id="abs-edit-code-${absIdx}" rows="4" spellcheck="false">${curCode.replace(/</g,'&lt;')}</textarea>
  <div class="abs-method-form-actions">
    <button class="btn btn-sm" onclick="absUpdateMethod(${absIdx})">Save</button>
    <button class="btn btn-sm abs-method-form-cancel" onclick="absHideForm(${absIdx})">Cancel</button>
  </div>
</div>`;
    fc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function absUpdateMethod(absIdx) {
    const fc = document.getElementById(`abs-form-${absIdx}`);
    const mName = fc ? fc.dataset.editTarget : null;
    if (!mName) return;
    const descEl = document.getElementById(`abs-edit-desc-${absIdx}`);
    const codeEl = document.getElementById(`abs-edit-code-${absIdx}`);
    if (!descEl) return;
    const key = `${absIdx}:${mName}`;
    // Preserve compile state and history; only update purpose and example source
    const prev = userMethodData[key] || {};
    userMethodData[key] = Object.assign({}, prev, {
        purpose: descEl.value.trim(),
        example: codeEl ? codeEl.value.trim() : (prev.example || '')
    });
    _absMethodsSave();
    showAbstractionDetail(absIdx);
}

function absSaveMethod(absIdx) {
    const nameEl = document.getElementById(`abs-add-name-${absIdx}`);
    const descEl = document.getElementById(`abs-add-desc-${absIdx}`);
    const codeEl = document.getElementById(`abs-add-code-${absIdx}`);
    if (!nameEl) return;
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }
    const abs = abstractionRegistry && abstractionRegistry.getAbstraction(absIdx);
    if (!abs) return;
    if (!abs.methods) abs.methods = [];
    if (!abs.methods.includes(name)) abs.methods.push(name);
    const key = `${absIdx}:${name}`;
    userMethodData[key] = {
        purpose: descEl ? descEl.value.trim() : '',
        example: codeEl ? codeEl.value.trim() : ''
    };
    userMethodLists[absIdx] = abs.methods.slice();
    _absMethodsSave();
    showAbstractionDetail(absIdx);
}

function absDeleteMethod(absIdx) {
    const sel = document.getElementById(`abs-del-select-${absIdx}`);
    if (!sel) return;
    const name = sel.value;
    if (!confirm(`Delete method "${name}"? This cannot be undone.`)) return;
    const abs = abstractionRegistry && abstractionRegistry.getAbstraction(absIdx);
    if (!abs || !abs.methods) return;
    abs.methods = abs.methods.filter(m => m !== name);
    delete userMethodData[`${absIdx}:${name}`];
    userMethodLists[absIdx] = abs.methods.slice();
    _absMethodsSave();
    showAbstractionDetail(absIdx);
}

const METHOD_REGISTER_CONVENTIONS = {
    'LED': {
        'Set':    { index: 0, input: 'none (LED = capability offset 0\u20135 in C-list slot)', output: 'DR0 = 1 (success) or DR0 = -1 (invalid offset)',  dispatch: 'CALL 0, CR6, #(8+led)', note: 'C-list slot 8 = LED 0, 9 = LED 1, \u2026 13 = LED 5. No DR arg needed.' },
        'Clear':  { index: 1, input: 'none (LED = capability offset 0\u20135 in C-list slot)', output: 'DR0 = 1 (success) or DR0 = -1 (invalid offset)',  dispatch: 'CALL 1, CR6, #(8+led)' },
        'Toggle': { index: 2, input: 'none (LED = capability offset 0\u20135 in C-list slot)', output: 'DR0 = 1 (success) or DR0 = -1 (invalid offset)',  dispatch: 'CALL 2, CR6, #(8+led)' },
        'State':  { index: 3, input: 'none (LED = capability offset 0\u20135 in C-list slot)', output: 'DR0 = 1 (on), DR0 = 0 (off), DR0 = -1 (fault)',   dispatch: 'CALL 3, CR6, #(8+led)', note: 'Signed return: \u22650 success, <0 fault. Caller checks BGE/BLT on DR0.' },
    },
    'SlideRule': {
        'Multiply':  { index: 0,  input: 'DR1 (a), DR2 (b)', output: 'DR1 = a * b',  dispatch: 'CALL 0, CRs, #imm' },
        'Divide':    { index: 1,  input: 'DR1 (a), DR2 (b)', output: 'DR1 = a / b',  dispatch: 'CALL 1, CRs, #imm' },
        'Sqrt':      { index: 2,  input: 'DR1 (x)',           output: 'DR1 = \u221ax',     dispatch: 'CALL 2, CRs, #imm' },
        'Mod':       { index: 3,  input: 'DR1 (a), DR2 (b)', output: 'DR1 = a % b',  dispatch: 'CALL 3, CRs, #imm' },
        'Sin':       { index: 4,  input: 'DR1 (radians)',     output: 'DR1 = sin(x)', dispatch: 'CALL 4, CRs, #imm' },
        'Cos':       { index: 5,  input: 'DR1 (radians)',     output: 'DR1 = cos(x)', dispatch: 'CALL 5, CRs, #imm' },
        'Tan':       { index: 6,  input: 'DR1 (radians)',     output: 'DR1 = tan(x)', dispatch: 'CALL 6, CRs, #imm' },
        'Asin':      { index: 7,  input: 'DR1 (x)',           output: 'DR1 = asin(x)', dispatch: 'CALL 7, CRs, #imm' },
        'Acos':      { index: 8,  input: 'DR1 (x)',           output: 'DR1 = acos(x)', dispatch: 'CALL 8, CRs, #imm' },
        'Atan':      { index: 9,  input: 'DR1 (x)',           output: 'DR1 = atan(x)', dispatch: 'CALL 9, CRs, #imm' },
        'ToDegrees': { index: 10, input: 'DR1 (radians)',     output: 'DR1 = degrees', dispatch: 'CALL 10, CRs, #imm' },
        'ToRadians': { index: 11, input: 'DR1 (degrees)',     output: 'DR1 = radians', dispatch: 'CALL 11, CRs, #imm' },
        'Bernoulli': { index: 12, input: 'DR1 (n)',           output: 'DR1 = numerator, DR2 = denominator', dispatch: 'CALL 12, CRs, #imm', note: 'Dual-register return: exact rational B(n).' },
        'Abs':       { index: 13, input: 'DR1 (n)',           output: 'DR1 = |n|',    dispatch: 'CALL 13, CRs, #imm' },
        'Pow':       { index: 14, input: 'DR1 (base), DR2 (exp)', output: 'DR1 = base^exp', dispatch: 'CALL 14, CRs, #imm' },
        'Min':       { index: 15, input: 'DR1 (a), DR2 (b)', output: 'DR1 = min(a,b)', dispatch: 'DR3=15, CALL 15, CRs, #imm' },
        'Max':       { index: 16, input: 'DR1 (a), DR2 (b)', output: 'DR1 = max(a,b)', dispatch: 'DR3=16, CALL 15, CRs, #imm' },
        'GCD':       { index: 17, input: 'DR1 (a), DR2 (b)', output: 'DR1 = gcd(a,b)', dispatch: 'DR3=17, CALL 15, CRs, #imm' },
        'Factorial': { index: 18, input: 'DR1 (n)',           output: 'DR1 = n!',     dispatch: 'DR3=18, CALL 15, CRs, #imm' },
        'Log2':      { index: 19, input: 'DR1 (n)',           output: 'DR1 = floor(log2(n))', dispatch: 'DR3=19, CALL 15, CRs, #imm' },
        'Atan2':     { index: 20, input: 'DR1 (y), DR2 (x)', output: 'DR1 = atan2(y,x)', dispatch: 'DR3=20, CALL 15, CRs, #imm' },
        'Signum':    { index: 21, input: 'DR1 (n)',           output: 'DR1 = sign(n)', dispatch: 'DR3=21, CALL 15, CRs, #imm' },
    },
    // Circle inherits all SlideRule methods (Multiply, Sqrt, Sin, Cos, …) via the
    // parent chain in AbstractionRegistry — Circle.Area and Circle.Circumference
    // are its own c-list entries; SlideRule methods dispatch through Circle's
    // SlideRule GT held in its c-list.
    'Circle': {
        'Area':          { index: 0, input: 'DR1 (radius)',              output: 'DR1 = \u03c0r\u00b2',          dispatch: 'CALL 0, CRc',          note: 'Delegates to SlideRule.Multiply and Constants.Pi internally.' },
        'Circumference': { index: 1, input: 'DR1 (radius)',              output: 'DR1 = 2\u03c0r',             dispatch: 'CALL 1, CRc',          note: 'Delegates to SlideRule.Multiply and Constants.Pi internally.' },
    },
    // Constants: five built-in mathematical constants.
    // Indices 0–4 match _bindConstants() in system_abstractions.js.
    // Usage: LOAD CR11, Constants  then  CALL Constants.Pi  (dot-notation) or  CALL CR11, 1  (1-based, method index 0)
    'Constants': {
        'Pi':   { index: 0, input: 'none', output: 'DR1 = \u03c0 (IEEE 754)',  dispatch: 'CALL Constants.Pi', note: 'LOAD CR11, Constants first, then use dot-notation: CALL Constants.Pi. Low-level: CALL CR11, 1.' },
        'E':    { index: 1, input: 'none', output: 'DR1 = e (IEEE 754)',        dispatch: 'CALL Constants.E',   note: 'Returns Euler\u2019s number \u2248 2.71828. Low-level: CALL CR11, 2.' },
        'Phi':  { index: 2, input: 'none', output: 'DR1 = \u03c6 (IEEE 754)',  dispatch: 'CALL Constants.Phi', note: 'Returns the golden ratio \u03c6 \u2248 1.61803. Low-level: CALL CR11, 3.' },
        'Zero': { index: 3, input: 'none', output: 'DR1 = 0.0 (IEEE 754)',      dispatch: 'CALL Constants.Zero', note: 'Returns IEEE 754 positive zero. Low-level: CALL CR11, 4.' },
        'One':  { index: 4, input: 'none', output: 'DR1 = 1.0 (IEEE 754)',      dispatch: 'CALL Constants.One',  note: 'Returns IEEE 754 1.0. Low-level: CALL CR11, 5.' },
    },
    // Tunnel: six methods matching the manifest order (indices 0–5).
    // These also drive the dot-notation popup (asm-method-popup.js) and the
    // assembler's CALL Tunnel.X / ELOADCALL encoding (app-shell.js feeds
    // METHOD_REGISTER_CONVENTIONS directly into new ChurchAssembler(conv)).
    'Ethernet': {
        'Send':    { index: 0, input: 'CR1 = data GT (R-perm Inform), DR1 = byte length', output: 'DR0 = 0 (queued) | \u22120x01 (TX busy) | \u22120x02 (link down)', dispatch: 'CALL Ethernet.Send',    note: 'Fire-and-forget raw frame send. Caller holds an E-only GT on Ethernet; the device GT is internal to the abstraction\u2019s c-list.' },
        'Receive': { index: 1, input: 'DR1 = timeout steps (0 = wait forever)',           output: 'CR0 = data GT (R-perm Inform), DR0 = byte length (0 = timeout)', dispatch: 'CALL Ethernet.Receive', note: 'Block until a frame arrives or timeout expires. Returned GT covers exactly byteLen bytes; caller must mSave before returning.' },
        'Connect': { index: 2, input: 'DR1 = IPv4 address (packed 32-bit), DR2 = port',   output: 'DR0 = 0 (link up) | \u22120x10 (PHY fault) | \u22120x11 (timeout)',  dispatch: 'CALL Ethernet.Connect', note: 'Configure the remote endpoint; arms the PHY and waits for link. Only needed when acting as a client; server mode calls Receive immediately.' },
        'Status':  { index: 3, input: 'none',                                              output: 'DR0 = 0 (down) | 1 (up) | 2 (busy)',                             dispatch: 'CALL Ethernet.Status',  note: 'Non-blocking status poll. Returns link state without blocking. XC7A100T only \u2014 not present on Tang Nano 20K or Ti60 F225.' },
    },
    'Tunnel': {
        'Register': { index: 0, input: 'DR1=boot_reason, DR2=last_fault, DR3=fault_NIA', output: 'DR0 = 1 (IDE ACK) | \u22640 (offline)', dispatch: 'CALL Tunnel.Register', note: 'Send 23-byte call-home packet to IDE and await ACK. Replaces hardwired B:02\u00bd boot step.' },
        'Send':     { index: 1, input: 'DR1=FourCC tag, DR2=word count, DR3=first payload', output: 'DR0 = 0 (queued) | 1 (TX overrun)',      dispatch: 'CALL Tunnel.Send',     note: 'Fire-and-forget media packet. Tags: TEXT=0x54455854 \u00b7 LUMP=0x4C554D50 \u00b7 GTKN=0x47544B4E \u2026' },
        'Receive':  { index: 2, input: 'DR1=timeout steps (0=forever)',                    output: 'DR0=word count (0=timeout), DR1=FourCC tag, DR2\u2026=payload', dispatch: 'CALL Tunnel.Receive', note: 'Block until IDE sends a media packet or timeout expires.' },
        'Fault':    { index: 3, input: 'DR1=fault_code, DR2=ns_idx, DR3=thread_gt, DR4=abstr_idx, DR5=method_idx, DR6=instr_offset', output: 'none (fire-and-forget)', dispatch: 'CALL Tunnel.Fault', note: 'Report full semantic fault location to IDE Devices view. Bypasses send queue.' },
        'Fetch':    { index: 4, input: 'DR1=slot token, DR2=expected words, CR2=write-GT', output: 'DR0 = 0 (installed) | error code',       dispatch: 'CALL Tunnel.Fetch',    note: 'Download lump binary from IDE by NS slot token. Validates header (magic, CRC) before writing.' },
        'Connect':  { index: 5, input: 'CR2=remote GT (Outform/far-end abstraction)',      output: 'DR0 = far-end return value',              dispatch: 'CALL Tunnel.Connect', note: 'Hello Mum primitive: forward CALL via GTKN packet to far-end Mum.Greet().' },
    },
    // ── System layer 1 abstractions ─────────────────────────────────────────────────────
    // Indices match the methods[] array in abstractions.js createAbstraction() calls.
    'Navana': {
        'Create':  { index: 0, input: 'DR1=size, DR2=type, DR3=perms', output: 'DR1=ns_slot, DR2=expiry', dispatch: 'ELOADCALL Navana.Create',  note: 'Allocate a new NS slot; returns (ns_slot, expiry) pair.' },
        'Add':     { index: 0, input: 'DR1=buf GT, DR2=size, DR3=type, DR4=perms', output: 'DR1=ns_slot, DR2=expiry', dispatch: 'ELOADCALL Navana.Add', note: 'Tutorial alias for Create — allocate NS slot for a buffer GT.' },
        'Release': { index: 1, input: 'DR1=ns_slot', output: 'DR1=0 (released)', dispatch: 'ELOADCALL Navana.Release', note: 'Release a previously allocated NS slot.' },
        'Find':    { index: 2, input: 'DR1=name GT', output: 'DR1=ns_slot (−1 if not found)', dispatch: 'ELOADCALL Navana.Find', note: 'Look up an NS slot by name token.' },
        'Update':  { index: 3, input: 'DR1=ns_slot, DR2=new GT', output: 'DR1=0 (ok) | −1 (fault)', dispatch: 'ELOADCALL Navana.Update', note: 'Update the GT stored in an existing NS slot.' },
        'Manage':  { index: 4, input: 'none', output: 'none (runs indefinitely)', dispatch: 'ELOADCALL Navana.Manage', note: 'Abstraction lifecycle management — not user-callable.' },
        'Monitor': { index: 5, input: 'none', output: 'none', dispatch: 'ELOADCALL Navana.Monitor', note: 'System health monitoring loop.' },
        'IDS':     { index: 6, input: 'none', output: 'none', dispatch: 'ELOADCALL Navana.IDS', note: 'Intrusion Detection via GT anomaly scanning.' },
    },
    'Mint': {
        'Encode':   { index: 0, input: 'DR1=ns_slot, DR2=expiry, DR3=permsBits, DR4=bindable, DR5=far', output: 'DR1=GT word', dispatch: 'ELOADCALL Mint.Encode',   note: 'Forge a GT with bounded permissions. Domain purity + E-isolation enforced.' },
        'Revoke':   { index: 1, input: 'DR1=ns_slot', output: 'DR1=0 (revoked)', dispatch: 'ELOADCALL Mint.Revoke',   note: 'Increment NS version — all existing GTs for this slot become invalid instantly.' },
        'Transfer': { index: 2, input: 'DR1=GT, DR2=target_clist GT, DR3=slot', output: 'DR1=0 (ok)', dispatch: 'ELOADCALL Mint.Transfer', note: 'Move a GT into a target c-list slot.' },
        'Create':   { index: 3, input: 'DR1=size, DR2=permsBits', output: 'DR1=GT word', dispatch: 'ELOADCALL Mint.Create',   note: 'Legacy shorthand: allocate memory + encode GT in one step.' },
    },
    'Memory': {
        'Allocate': { index: 0, input: 'DR1=size (words)', output: 'DR1=memory GT', dispatch: 'ELOADCALL Memory.Allocate', note: 'Reserve a memory region and return a bounded GT.' },
        'Free':     { index: 1, input: 'DR1=memory GT', output: 'DR1=0 (freed)', dispatch: 'ELOADCALL Memory.Free',     note: 'Release a memory region and zero its contents.' },
        'Find':     { index: 2, input: 'DR1=name GT', output: 'DR1=memory GT (0 if not found)', dispatch: 'ELOADCALL Memory.Find', note: 'Look up a named allocation.' },
        'Resize':   { index: 3, input: 'DR1=memory GT, DR2=new_size', output: 'DR1=new GT', dispatch: 'ELOADCALL Memory.Resize',   note: 'Adjust the size of an existing allocation; returns updated GT.' },
        'Claim':    { index: 4, input: 'DR1=base_addr, DR2=size', output: 'DR1=memory GT', dispatch: 'ELOADCALL Memory.Claim',    note: 'Claim a specific address range (boot use only).' },
    },
    'Scheduler': {
        'Yield': { index: 0, input: 'none', output: 'DR0=next thread id', dispatch: 'ELOADCALL Scheduler.Yield', note: 'Save thread state; switch to next ready thread.' },
        'Spawn': { index: 1, input: 'CR1=code GT, DR1=entry offset', output: 'DR0=thread id', dispatch: 'ELOADCALL Scheduler.Spawn', note: 'Create thread with isolated CR set; begins at entry offset.' },
        'Wait':  { index: 2, input: 'CR1=flag GT (DijkstraFlag)', output: 'DR0=1 (woken)', dispatch: 'ELOADCALL Scheduler.Wait',  note: 'Block calling thread until the flag is signaled.' },
        'Stop':  { index: 3, input: 'DR1=thread id', output: 'DR0=0 (stopped)', dispatch: 'ELOADCALL Scheduler.Stop',  note: 'Terminate a thread and release its CR set.' },
        'pause': { index: 4, input: 'DR1=ticks', output: 'none (resumes after ticks steps)', dispatch: 'ELOADCALL Scheduler.pause', note: 'Suspend calling thread for ticks steps; Scheduler.IRQ wakes it on timer fire.' },
        'IRQ':   { index: 5, input: 'none (hardware-injected only)', output: 'none', dispatch: 'hidden ELOADCALL (NS slot 8)', note: 'Hardware timer/fault interrupt entry. Not user-callable — injected by step() before each instruction when timer fires.' },
    },
    'Stack': {
        'Push':  { index: 0, input: 'DR1=value', output: 'DR0=depth after push', dispatch: 'ELOADCALL Stack.Push',  note: 'Push value; faults on overflow (max 256 entries).' },
        'Pop':   { index: 1, input: 'none', output: 'DR0=popped value', dispatch: 'ELOADCALL Stack.Pop',   note: 'Pop and return top value; faults on underflow.' },
        'Peek':  { index: 2, input: 'none', output: 'DR0=top value (stack unchanged)', dispatch: 'ELOADCALL Stack.Peek',  note: 'Read top without removing; faults on empty stack.' },
        'Depth': { index: 3, input: 'none', output: 'DR0=current entry count', dispatch: 'ELOADCALL Stack.Depth', note: 'Return current stack depth (0 = empty).' },
    },
    'DijkstraFlag': {
        'Wait':   { index: 0, input: 'none', output: 'DR0=1 (woken by signal)', dispatch: 'ELOADCALL DijkstraFlag.Wait',   note: 'P() — block if unsignaled; consume signal when it arrives.' },
        'Signal': { index: 1, input: 'none', output: 'DR0=1 (woke a waiter) | 0 (flag set, no waiter)', dispatch: 'ELOADCALL DijkstraFlag.Signal', note: 'V() — wake one waiter or raise the flag.' },
        'Reset':  { index: 2, input: 'none', output: 'DR0=0 (cleared)', dispatch: 'ELOADCALL DijkstraFlag.Reset',  note: 'Clear the flag to unsignaled state without blocking.' },
        'Test':   { index: 3, input: 'none', output: 'DR0=1 (signaled) | 0 (unsignaled)', dispatch: 'ELOADCALL DijkstraFlag.Test',   note: 'Non-blocking read — flag state is not changed.' },
    },
    'UART': {
        'Send':    { index: 0, input: 'DR1=byte value', output: 'DR0=0 (queued) | −1 (TX busy)', dispatch: 'ELOADCALL UART.Send',    note: 'Write one byte to the UART TX register.' },
        'Receive': { index: 1, input: 'none', output: 'DR0=byte value | −1 (RX empty)', dispatch: 'ELOADCALL UART.Receive', note: 'Read one byte from the UART RX register; non-blocking.' },
        'SetBaud': { index: 2, input: 'DR1=baud rate', output: 'DR0=0 (ok) | −1 (unsupported rate)', dispatch: 'ELOADCALL UART.SetBaud',  note: 'Configure baud rate; typical values: 9600, 115200.' },
    },
    // ── Tutorial / Stage-3 Contact abstractions ───────────────────────────────────────────
    // These exist in the namespace vocabulary tutorial but have no simulator implementation.
    'Identity': {
        'Lookup':     { index: 0, input: 'DR1=identity token GT', output: 'DR1=address token GT', dispatch: 'ELOADCALL Identity.Lookup',     note: 'Resolve an identity token (person/device) to a network address token.' },
        'GetAddress': { index: 1, input: 'DR1=address token GT', output: 'DR1=raw network address word', dispatch: 'ELOADCALL Identity.GetAddress', note: 'Map an address token to a raw network location word (internal helper).' },
    },
    'Routing': {
        'SelectMedium': { index: 0, input: 'DR1=callerAddress GT, DR2=calleeAddress GT', output: 'DR1=medium GT (voice/text/email)', dispatch: 'ELOADCALL Routing.SelectMedium', note: 'Choose the best communication medium given two endpoint addresses.' },
    },
    'Media': {
        'Open':        { index: 0, input: 'DR1=medium GT, DR2=callerAddress GT, DR3=calleeAddress GT', output: 'DR1=session GT', dispatch: 'ELOADCALL Media.Open',        note: 'Open a communication session on the chosen medium.' },
        'Close':       { index: 1, input: 'DR1=sessionToken GT', output: 'DR1=0 (closed)', dispatch: 'ELOADCALL Media.Close',       note: 'Close and release the session identified by sessionToken.' },
        'QueryStatus': { index: 2, input: 'DR1=sessionToken GT', output: 'DR1=status (0=offline, 1=active)', dispatch: 'ELOADCALL Media.QueryStatus', note: 'Query the current state of a session without modifying it.' },
    },
    'WordString': {
        'GetCharCount': { index: 0, input: 'DR1=string GT', output: 'DR1=character count', dispatch: 'ELOADCALL WordString.GetCharCount', note: 'Return the number of characters in the string.' },
        'GetChar':      { index: 1, input: 'DR1=string GT, DR2=index', output: 'DR1=character code (0 if out of range)', dispatch: 'ELOADCALL WordString.GetChar',      note: 'Return the character at the given 0-based index.' },
        'Compare':      { index: 2, input: 'DR1=string GT A, DR2=string GT B', output: 'DR1=0 (equal) | 1 (A>B) | −1 (A<B)', dispatch: 'ELOADCALL WordString.Compare',      note: 'Lexicographic comparison of two strings.' },
        'Concat':       { index: 3, input: 'DR1=string GT A, DR2=string GT B', output: 'DR1=new string GT', dispatch: 'ELOADCALL WordString.Concat',       note: 'Concatenate two strings; returns a new string GT.' },
    },
};

function getMethodPurposes(abs) {
    const purposes = {};
    const knownPurposes = {
        'Salvation': { 'LOAD': 'Proves namespace lookup', 'TPERM': 'Proves permission check', 'LAMBDA': 'Proves Church reduction', 'TransitionToNavana': 'Transitions to Navana (does not RETURN)' },
        'Navana': { 'Init': 'Initialize all abstractions', 'Manage': 'Abstraction lifecycle management', 'Monitor': 'System health monitoring', 'IDS': 'Intrusion Detection via GT anomalies' },
        'Mint': { 'Encode': 'Mint.Encode(base, exp, permsBits, bindable, far) — preconditions: (1) domain purity (permsBits must be Turing-only or Church-only, never mixed), (2) E isolation (E perm may not be combined with R/W/X), (3) non-NULL type (base type 00 is rejected). CALL Memory.Allocate for backing storage, find free NS entry, increment version, write NS entry, forge ready-to-use GT', 'Revoke': 'Mint.Revoke(nsIndex) — increment version, kill all GT copies instantly', 'Transfer': 'Mint.Transfer(gt, target_clist, slot) — move GT between c-lists' },
        'Memory': { 'Allocate': 'Memory.Allocate(size) — reserve a memory region, return location and size', 'Free': 'Memory.Free(location) — release a memory region, zero its contents', 'Resize': 'Memory.Resize(location, newSize) — adjust the size of an existing allocation' },
        'Scheduler': { 'Yield': 'Scheduler.Yield() — save thread state, switch to next ready thread', 'Spawn': 'Scheduler.Spawn(code_GT, entry) — create thread with isolated CR set', 'Wait': 'Scheduler.Wait(flag_GT) — block thread on DijkstraFlag', 'Stop': 'Scheduler.Stop(threadID) — terminate thread, release CRs', 'pause': 'Scheduler.pause(ticks) — suspend calling thread for ticks steps; Scheduler.IRQ wakes it when the timer fires' },
        'Stack': { 'Push': 'Stack.Push(value) — DWRITE to stack location, increment depth', 'Pop': 'Stack.Pop() — decrement depth, DREAD from stack location', 'Peek': 'Stack.Peek() — DREAD top without decrementing', 'Depth': 'Stack.Depth() — return current entry count' },
        'DijkstraFlag': { 'Wait': 'DijkstraFlag.Wait() — P() operation: block if unsignaled', 'Signal': 'DijkstraFlag.Signal() — V() operation: wake one waiter or set flag', 'Reset': 'DijkstraFlag.Reset() — clear flag to unsignaled state', 'Test': 'DijkstraFlag.Test() — non-blocking read of flag state' },
        'UART': { 'Send': 'UART.Send(byte) — SAVE byte to device (S perm)', 'Receive': 'UART.Receive() — LOAD byte from device (L perm)', 'SetBaud': 'UART.SetBaud(rate) — configure via CALL (E perm)' },
        'LED': { 'Set': 'LED.Set \u2014 turn on the LED identified by the capability offset (0\u20135). No DR args. DR0 \u22650 success, <0 fault.', 'Clear': 'LED.Clear \u2014 turn off the LED identified by the capability offset (0\u20135). No DR args. DR0 \u22650 success, <0 fault.', 'Toggle': 'LED.Toggle \u2014 flip the LED identified by the capability offset. No DR args. DR0 \u22650 success, <0 fault.', 'State': 'LED.State \u2014 read the on/off state of the LED at the capability offset. Returns DR0=1 (on), DR0=0 (off), DR0<0 (fault).' },
        'Button': { 'Read': 'Button.Read() — LOAD state from device (L perm)', 'WaitPress': 'Button.WaitPress() — block via Scheduler until press (E perm)', 'OnEvent': 'Button.OnEvent() — dequeue press/release event (E perm)' },
        'Timer': { 'Start': 'Timer.Start(channel) — SAVE start command to device (S perm)', 'Stop': 'Timer.Stop(channel) — SAVE stop command (S perm)', 'Read': 'Timer.Read() — LOAD elapsed ticks from device (L perm)', 'SetAlarm': 'Timer.SetAlarm(ticks) — SAVE threshold to device (S perm)' },
        'Display': { 'Write': 'Display.Write(char) — SAVE character to device (S perm)', 'Clear': 'Display.Clear() — SAVE clear command (S perm)', 'Scroll': 'Display.Scroll(lines) — SAVE scroll command (S perm)' },
        'SlideRule': { 'Multiply': 'SlideRule.Multiply(a, b) — DR1*DR2. CALL 0, CRs, #imm', 'Divide': 'SlideRule.Divide(a, b) — DR1/DR2 (truncated). CALL 1, CRs, #imm. Div by zero returns 0.', 'Sqrt': 'SlideRule.Sqrt(x) — floor(√DR1). CALL 2, CRs, #imm', 'Mod': 'SlideRule.Mod(a, b) — DR1%DR2. CALL 3, CRs, #imm. Mod by zero returns 0.', 'Sin': 'SlideRule.Sin(angle) — CORDIC sine (fixed-point). CALL 4, CRs, #imm', 'Cos': 'SlideRule.Cos(angle) — CORDIC cosine (fixed-point). CALL 5, CRs, #imm', 'Tan': 'SlideRule.Tan(angle) — CORDIC tangent (fixed-point). CALL 6, CRs, #imm', 'Asin': 'SlideRule.Asin(x) — CORDIC inverse sine. CALL 7, CRs, #imm', 'Acos': 'SlideRule.Acos(x) — CORDIC inverse cosine. CALL 8, CRs, #imm', 'Atan': 'SlideRule.Atan(x) — CORDIC inverse tangent. CALL 9, CRs, #imm', 'ToDegrees': 'SlideRule.ToDegrees(rad) — radians → degrees (×180/π). CALL 10, CRs, #imm', 'ToRadians': 'SlideRule.ToRadians(deg) — degrees → radians (×π/180). CALL 11, CRs, #imm', 'Bernoulli': 'SlideRule.Bernoulli(n) — exact rational B(n). DR1=numerator, DR2=denominator. CALL 12, CRs, #imm', 'Abs': 'SlideRule.Abs(n) — |DR1|. CALL 13, CRs, #imm', 'Pow': 'SlideRule.Pow(base, exp) — base^exp (exp≥0). CALL 14, CRs, #imm', 'Min': 'SlideRule.Min(a, b) — min(DR1, DR2). DR3=15, CALL 15, CRs, #imm (escape)', 'Max': 'SlideRule.Max(a, b) — max(DR1, DR2). DR3=16, CALL 15, CRs, #imm (escape)', 'GCD': 'SlideRule.GCD(a, b) — gcd(DR1, DR2). DR3=17, CALL 15, CRs, #imm (escape)', 'Factorial': 'SlideRule.Factorial(n) — n!. DR3=18, CALL 15, CRs, #imm (escape)', 'Log2': 'SlideRule.Log2(n) — floor(log₂(n)). DR3=19, CALL 15, CRs, #imm (escape)', 'Atan2': 'SlideRule.Atan2(y, x) — two-argument arctangent. DR3=20, CALL 15, CRs, #imm (escape)', 'Signum': 'SlideRule.Signum(n) — sign(DR1): +1/0/−1. DR3=21, CALL 15, CRs, #imm (escape)' },
        'Abacus': { 'Add': 'Abacus.Add(a, b) — integer add', 'Sub': 'Abacus.Sub(a, b) — integer subtract', 'Mul': 'Abacus.Mul(a, b) — integer multiply', 'Div': 'Abacus.Div(a, b) — integer divide', 'Mod': 'Abacus.Mod(a, b) — remainder', 'Abs': 'Abacus.Abs(x) — absolute value' },
        'Constants': { 'Pi': 'Constants.Pi() — return \u03c0 as IEEE 754', 'E': 'Constants.E() — return e', 'Phi': 'Constants.Phi() — return \u03c6', 'Zero': 'Constants.Zero() — return 0.0', 'One': 'Constants.One() — return 1.0' },
        'Loader': { 'Load': 'Loader.Load(slot) — fault-driven lazy load of a warm/cold abstraction', 'Prefetch': 'Loader.Prefetch(slot) — hint-driven pre-load without blocking', 'Evict': 'Loader.Evict(slot) — unload a cold abstraction to free memory' },
        'Circle': { 'Area': 'Circle.Area(radius) — \u03c0r\u00b2 via SlideRule.Multiply + Constants.Pi', 'Circumference': 'Circle.Circumference(radius) — 2\u03c0r via SlideRule' },
        'Family': { 'Register': 'Family.Register(parent_GT, child_GT) — bind parent-child in c-list', 'Hello': 'Family.Hello(target_GT) — send greeting to any family member via their GT', 'Oversight': 'Family.Oversight(child_GT) — parent queries child activity' },
        'Schoolroom': { 'Join': 'Schoolroom.Join(class_GT) — student enters class', 'Lesson': 'Schoolroom.Lesson(class_GT, content_GT) — teacher posts lesson', 'Submit': 'Schoolroom.Submit(work_GT) — student submits work', 'Grade': 'Schoolroom.Grade(work_GT, score) — teacher grades work' },
        'Friends': { 'Request': 'Friends.Request(peer_GT) — send friend request (needs parent approval)', 'Accept': 'Friends.Accept(requester_GT) — accept request', 'Share': 'Friends.Share(friend_GT, cap_GT) — share capability', 'Revoke': 'Friends.Revoke(cap_GT) — revoke shared capability' },
        'Ethernet': {
            'Send':    'Ethernet.Send(dataGT, byteLen) — transmit a raw Ethernet frame. CR1 = R-perm Inform GT covering the frame buffer; DR1 = byte length. Fire-and-forget; DR0 \u2190 0 queued | \u22120x01 TX busy | \u22120x02 link down. XC7A100T only.',
            'Receive': 'Ethernet.Receive(timeout) — block until a frame arrives. DR1 = timeout in steps (0 = wait forever). CR0 \u2190 R-perm Inform GT covering exactly byteLen bytes of the received frame; DR0 \u2190 byte length (0 = timeout). Caller must copy data before returning.',
            'Connect': 'Ethernet.Connect(ipv4, port) — configure remote endpoint and arm the PHY. DR1 = packed IPv4 (big-endian 32-bit); DR2 = port number. DR0 \u2190 0 link up | \u22120x10 PHY fault | \u22120x11 timeout. Only required for client-mode connections.',
            'Status':  'Ethernet.Status() — non-blocking link state poll. No inputs. DR0 \u2190 0 (down) | 1 (up) | 2 (busy). Use before Send to avoid TX errors. XC7A100T only \u2014 absent on Tang Nano 20K and Ti60 F225.',
        },
        'Tunnel': {
            'Register': 'Tunnel.Register(boot_reason, last_fault, fault_NIA) — send the 23-byte call-home identification packet [0xCE11 · board · FW · HMAC(4B) · UID(8B) · reason · fault · NIA(4B)] and await ACK. Replaces the hardwired B:02\u00BD boot step. DR0 \u2190 1 (IDE connected) | 0 (offline).',
            'Send': 'Tunnel.Send(type_tag, word_count, payload\u2026) — transmit a self-identifying media packet to the IDE host. DR1 = FourCC type tag (TEXT=0x54455854 \u00b7 VOIC=0x564F4943 \u00b7 LUMP=0x4C554D50 \u00b7 GTKN=0x47544B4E \u00b7 JPEG=0x4A504547 \u00b7 \u2026), DR2 = word count (1\u201313), DR3\u2026 = payload words. Fire-and-forget; no ACK. DR0 \u2190 0 = queued | 0x01 = TX overrun.',
            'Receive': 'Tunnel.Receive(timeout_steps) — block until the IDE host sends a self-identifying media packet or timeout expires. DR1 = timeout in steps (0 = wait forever). DR0 \u2190 word count (0 = timeout), DR1 \u2190 FourCC type tag (TEXT \u00b7 VOIC \u00b7 LUMP \u00b7 GTKN \u00b7 \u2026), DR2\u2026 = payload. Caller dispatches on DR1.',
            'Fault': 'Tunnel.Fault(fault_code, ns_idx, thread_gt, abstr_idx, method_idx, instr_offset) — report a fault with full semantic location. DR1 = fault_code, DR2 = ns_idx (active namespace slot), DR3 = thread_gt (NS index of faulting thread), DR4 = abstr_idx (NS slot of executing abstraction), DR5 = method_idx, DR6 = instr_offset. Bypasses send queue. IDE logs full location in Devices view. Fire-and-forget.',
            'Fetch': 'Tunnel.Fetch(token, expected_words, mem_GT) — request a lump binary from the IDE by NS slot token. CR2 = Memory W-GT for the write destination. DR1 = slot token, DR2 = expected size in words. Validates header (magic, CRC) before writing. DR0 \u2190 0 = installed | error code.',
            'Connect': 'Tunnel.Connect(remote_GT) — forward a CALL through the tunnel to a remote capability. CR2 = remote GT (Outform, far-end abstraction). Encodes the GT as a GTKN packet (tag=0x47544B4E), transmits it, and awaits the far-end RETURN. This is the "Hello Mum" primitive: CALL(CONNECT(me, mymother)). DR0 \u2190 far-end return value.',
        },
        'Negotiate': { 'Propose': 'Negotiate.Propose(cap_GT) — request special grant (dual-approval)', 'Approve': 'Negotiate.Approve(proposal_id) — parent or teacher approves', 'Reject': 'Negotiate.Reject(proposal_id) — reject proposal', 'Status': 'Negotiate.Status(proposal_id) — query proposal state' },
        'Editor': { 'Open': 'Editor.Open(file_GT) — load DATA object into editor buffer', 'Save': 'Editor.Save() — DWRITE buffer to NS slot, recompute seal', 'Load': 'Editor.Load(nsIndex) — DREAD source from slot into buffer', 'Undo': 'Editor.Undo() — pop previous state from undo stack' },
        'Assembler': { 'Assemble': 'Assembler.Assemble(source_GT) — parse + encode to 32-bit instructions', 'Disassemble': 'Assembler.Disassemble(binary_GT) — decode instructions to text', 'Validate': 'Assembler.Validate(source_GT) — check syntax + register refs' },
        'Debugger': { 'Step': 'Debugger.Step() — fetch-decode-execute one instruction', 'Run': 'Debugger.Run() — execute until halt/breakpoint/fault', 'Breakpoint': 'Debugger.Breakpoint(address) — set/clear breakpoint', 'Inspect': 'Debugger.Inspect(address) — read and decode memory/NS entry' },
        'Deployer': (function() {
            const b = getSelectedBoard();
            const chip = b === 'ti60-f225' ? 'Efinix Ti60F225' : 'Gowin GW2AR-18';
            const brd  = b === 'ti60-f225' ? 'Ti60 F225' : 'Tang Nano';
            return { 'Build': `Deployer.Build(binary_GT) — package for ${chip}`, 'Upload': `Deployer.Upload() — send via UART to ${brd} (S perm)`, 'Verify': 'Deployer.Verify() — readback + checksum via UART (L perm)', 'Boot': 'Deployer.Boot() — send boot command, FPGA begins execution' };
        })(),
        'Browser': { 'Navigate': 'Browser.Navigate(site_GT) — LOAD content via L perm (no URLs)', 'Back': 'Browser.Back() — pop previous site GT from history', 'Bookmark': 'Browser.Bookmark(site_GT) — SAVE GT to bookmark c-list', 'Search': 'Browser.Search(scope_GT) — search within GT scope only' },
        'Messenger': { 'Send': 'Messenger.Send(recipient_GT, msg_GT) — send to approved contact', 'Receive': 'Messenger.Receive() — dequeue from inbox c-list', 'Contacts': 'Messenger.Contacts() — list parent-approved contact GTs', 'Block': 'Messenger.Block(contact_GT) — Mint.Revoke contact GT' },
        'Photos': { 'View': 'Photos.View(photo_GT) — LOAD photo data via L perm', 'Share': 'Photos.Share(photo_GT, recipient_GT) — TPERM to L-only, transfer', 'Upload': 'Photos.Upload(data_GT) — Memory.Allocate + store photo', 'Album': 'Photos.Album() — walk album c-list, return count' },
        'Social': { 'Post': 'Social.Post(content_GT) — publish to followers\' feed c-lists', 'Read': 'Social.Read() — LOAD next feed entry via L perm', 'Follow': 'Social.Follow(account_GT) — request follow (parent-gated)', 'Feed': 'Social.Feed() — count feed items available' },
        'Video': { 'Watch': 'Video.Watch(video_GT) — LOAD + stream via L perm', 'Search': 'Video.Search(scope_GT) — search within approved scope', 'Playlist': 'Video.Playlist() — walk playlist c-list', 'Share': 'Video.Share(video_GT, recipient_GT) — TPERM to L-only, transfer' },
        'Email': { 'Compose': 'Email.Compose(recipient_GT, body_GT) — allocate + send to inbox', 'Read': 'Email.Read() — dequeue from inbox c-list', 'Reply': 'Email.Reply(original_GT, body_GT) — reply in thread chain', 'Contacts': 'Email.Contacts() — list parent-approved email contacts' },
        'GC': { 'Scan': 'GC.Scan() — walk CRs + c-lists, set G-bit on live NS entries', 'Identify': 'GC.Identify() — find entries where G-bit != polarity', 'Clear': 'GC.Clear() — zero word0+word1 on garbage entries', 'Flip': 'GC.Flip() — toggle polarity for bidirectional cycle' },
        'Thread': {
            'switchTo': 'Thread.switchTo(thread_GT) — issues CHANGE targeting thread_GT; saves the calling thread\u2019s full context (DR0\u2013DR15, PC, FLAGS, STO, CR0\u2013CR11, CR14, CR15) into its lump, then restores the target thread\u2019s saved context and resumes it at its saved PC. Requires E perm on thread_GT.',
            'Kill':     'Thread.Kill(thread_GT) — terminates the target thread: suspends it via CHANGE, releases its lump via Memory.Free, revokes its Thread GT via Mint.Revoke (incrementing gt_seq so all live copies of the GT become instantly invalid). Requires E perm on thread_GT.',
            'Compile':  'Thread.Compile(f_GT) \u2014 creates a new Thread Abstraction whose initial start abstraction is f. Calls Memory.Allocate for a fresh lump (GT zone + LIFO stack + heap + DR file), calls Mint.Encode(Inform, lumpSize, 0) to mint a zero-perm thread stack GT (CR12 of the new thread), stores f_GT into the new thread\u2019s c-list as CR0 (the return/first-call slot), and returns the new Thread GT to the caller. The new thread is ready to run as soon as switchTo is called on its GT.',
        },
        'LED flash': {
            'Run': 'LED flash.Run \u2014 method selector 0. Drives the on-board LED through a Set \u2192 delay \u2192 Clear cycle using the LED[0] Abstract GT in c-list slot 0, then RETURNs. Caller writes DR0=0 (method index) before CALL.',
        },
        'Boot.Thread': {
            'run': 'Boot.Thread.run \u2014 The initial thread\u2019s continuous existence as the hardware execution context. ' +
                   'CR12 holds the thread stack GT as an \u2018Inform\u2019: perms=[none], meaning no E-bit, so no code can invoke it via CALL. ' +
                   'The final comment in B:02 \u2014 \u201cInforms-only: cannot be used for direct CALL\u201d \u2014 means exactly this: ' +
                   'the thread does not run by being invoked. It runs because it IS the processor\u2019s current execution context \u2014 ' +
                   'the STEP controller simply advances PC through the thread\u2019s code lump each cycle. ' +
                   'You cannot CALL a thread from outside; you can only CHANGE into one via Thread.switchTo (which requires E perm on the Thread GT, not on CR12).',
        },
    };
    const base = knownPurposes[abs.name] ? Object.assign({}, knownPurposes[abs.name]) : purposes;
    for (const m of abs.methods) {
        const key = `${abs.index}:${m}`;
        if (userMethodData[key] && userMethodData[key].purpose) {
            base[m] = userMethodData[key].purpose;
        } else if (!base[m]) {
            base[m] = 'Dispatched via CALL';
        }
    }
    return base;
}

function getMethodExamples(abs) {
    const examples = {
        'LED flash': {
            'Run': `; LED flash.Run — method selector 0
; c-list[0] = LED[0] Abstract GT (device_class=LED, device_data=0)
; Caller: DWRITE DR0, 0  ; method = Run
;         CALL   CR6, 0xF ; enter LED flash

; ── Turn LED on ────────────────────────────────────────────────────────
      DR0   <- 0x01       ; cmd = Set, ledIdx = 0
      CALL CR6, 0xF       ; LED driver dispatch (Abstract GT in CR6)
;                         ; DR0 >= 0 success, < 0 fault

; ── Delay loop ─────────────────────────────────────────────────────────
      DR1   <- 0x7FFF     ; ~half-second on Tang Nano 20K
.loop:
      ISUB  DR1, DR1, 1
      BRANCH .loop, DR1 != 0

; ── Turn LED off ───────────────────────────────────────────────────────
      DR0   <- 0x02       ; cmd = Clear, ledIdx = 0
      CALL CR6, 0xF

; ── Return to Boot.Abstr sentinel frame ────────────────────────────────
      RETURN`,
        },
        'Salvation': {
            'LOAD': `; Salvation.LOAD — prove namespace lookup via mLoad pipeline
; mLoad 7-step: type check -> version match -> seal verify
;   -> bounds check -> perm check -> F-bit -> deliver
LOAD   CR1, NS[4]       ; mLoad pipeline validates GT:
                         ;   1. Type != NULL (00=NULL, 01=Inform, 10=Outform, 11=Abstract)
                         ;   2. GT.gt_seq == NS[4].word2[31:25]
                         ;   3. CRC-16 seal(word0,word1) == word2[15:0]
                         ;   4. Index 4 within NS bounds
                         ;   5. L perm required for LOAD
                         ;   6. F-bit=0 (local, not tunneled)
                         ;   7. CR1 <- 128-bit capability register
; CR1.word0 = GT packed: Ver(7)|Idx(17)|Perms(6)|Type(2)
; CR1.word1 = NS[4].word0 (location)
; CR1.word2 = NS[4].word1 (B|F|G|...|limit[16:0])
; CR1.word3 = NS[4].word2 (version[31:25]|seal[24:0])`,
            'TPERM': `; Salvation.TPERM — prove GT health check
; TPERM checks permissions + validity + bounds in one cycle
; Sets Z flag: Z=1 = all passed, Z=0 = something failed
; Never traps — enables conditional execution (try-catch)
LOAD   CR1, NS[4]       ; CR1 holds Salvation GT [E]
TPERM  CR1, E            ; Check E permission, valid, MAC
; Z=1: permission present, GT valid
; Z=0: permission denied or GT invalid
; Subsequent EQ instructions skip if Z=0
; Note: TPERM can also restrict permissions (monotonic)
; — permissions can only be removed, never added.`,
            'LAMBDA': `; Salvation.LAMBDA — prove Church numeral reduction
; LAMBDA dispatches a method within an abstraction
; It is NOT a security block — just an instruction
LOAD   CR1, NS[20]      ; Load SUCC GT (X+L+E perms)
                         ;   mLoad validates X perm for code
DWRITE DR1, #3           ; Church numeral 3 in data register
LAMBDA CR1, DR1          ; Apply SUCC: DR1 <- SUCC(3) = 4
                         ;   CR1 must have X perm (code exec)
                         ;   SUCC's CLOOMC is a DATA-domain object
; Result: DR1 = 4`,
            'TransitionToNavana': `; Salvation -> Navana transition (Salvation does NOT return)
; Boot flow: Boot -> CALL Salvation -> Salvation -> Navana
; Navana runs forever as the namespace controller
LOAD   CR2, NS[5]       ; Load Navana E-GT via mLoad
                         ;   7-step pipeline validates:
                         ;   ver match, seal check, E perm
CALL   CR2              ; Enter Navana:
                         ;   1. Push return state to call stack
                         ;   2. CR6 <- E-GT (c-list for Navana)
                         ;   3. CR14 <- X-GT (CLOOMC, privileged)
                         ;   4. B-bits cleared on all CRs
                         ;   5. PC <- Navana code entry point
; Navana takes over — runs indefinitely, never RETURNs`,
        },
        'Navana': {
            'Init': `; Navana.Init — bootstrap all abstractions (Layer 1-8)
; Navana is the namespace controller, runs forever
; Init walks the abstraction table and creates each one
LOAD   CR1, NS[5]       ; Load Navana E-GT
CALL   CR1              ; Enter Navana
                         ;   CR6 <- Navana c-list
                         ;   CR14 <- Navana CLOOMC (DATA-domain, privileged)
; Inside Navana.Init:
;   for each abstraction index 6..44:
;     LOAD  CR3, NS[7]  ; Load Memory GT
;     CALL  CR3          ; Memory.Allocate -> backing storage
;     LOAD  CR4, NS[6]  ; Load Mint GT
;     CALL  CR4          ; Mint.Encode -> NS entry + GT
;   Navana.Init never returns — enters event loop`,
            'Manage': `; Navana.Manage — abstraction lifecycle
; Navana dispatches create/destroy/call/inspect uniformly
; Every abstraction shares this polymorphic interface
LOAD   CR1, NS[5]       ; Load Navana E-GT
DWRITE DR1, #33         ; Target: Editor abstraction (NS[33])
DWRITE DR2, #0          ; Operation: 0=create
CALL   CR1              ; Navana.Manage dispatches:
;   1. Mint.Encode(base, exp, permsBits):
;      a. Memory.Allocate(size) -> location
;      b. Find free NS entry
;      c. Write NS entry + compute seal
;      d. Forge GT with version/perms
;   2. Return GT to caller via CR`,
            'Monitor': `; Navana.Monitor — system health / MTBF tracking
; Every abstraction is a security block with MTBF
; MTBF = uptime / faultCount for that block
LOAD   CR1, NS[5]       ; Load Navana E-GT
CALL   CR1              ; Navana.Monitor checks:
;   for each abstraction 0..44:
;     read faultCount from registry
;     compute MTBF = activeTime / faultCount
;     if MTBF < threshold: flag degraded
;   DR1 <- total fault count across all blocks
;   DR2 <- index of lowest-MTBF abstraction`,
            'IDS': `; Navana.IDS — Intrusion Detection System
; Detects GT forgery attempts and version anomalies
LOAD   CR1, NS[5]       ; Load Navana E-GT
CALL   CR1              ; Navana.IDS scans:
;   for each active NS entry:
;     recompute seal = CRC-16(word0, word1)
;     compare seal vs word2[15:0]
;     if mismatch: FAULT — tampered entry
;     check version consistency across all GTs
;     if GT.version > NS.version: stale/forged
;   Report anomalies to Navana.Monitor`,
            'ValidatePassKey': `; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
; LED via Navana PassKey — complete 3-step flow
; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
; PassKey = ABSTRACTION GT (type=0b11=Abstract)
;   GT index encodes: device[15:8] | permMask[7:4] | id[3:0]
; Navana = gatekeeper. Validates PassKey,
;   writes E-perm LED driver GT to C-list slot 8+N.
; LED driver = callable. No DR args — the capability IS the LED.
; Caller never sees hardware address or NS index.
;
; Step 1: Load PassKey from thread's c-list
; Step 2: CALL Navana with PassKey in CR1
; Step 3: CALL LED driver at C-list offset — no DR args needed

; ── STEP 1: Load PassKey ──────────────────────
LOAD   CR1, [CR6 + 0]   ; Load PassKey GT from thread c-list
                          ;   Abstract type (0b11)
                          ;   Index encodes: device=LED(0x01),
                          ;     permMask=ALL(0x0F), id
                          ;   Placed by Navana.Init at boot

; ── STEP 2: CALL Navana — present PassKey ─────
LOAD   CR2, NS[5]        ; Load Navana E-GT
                          ;   CR1 still holds PassKey
CALL   CR2                ; CALL Navana detects Abstract GT in CR1:
;   Navana.ValidatePassKey dispatched automatically:
;   1. Parse CR1 GT: type must be Abstract (0b11)
;   2. Decode index: device selector, perm mask
;   3. Lookup in Navana's PassKey registry
;   4. Check not revoked, not tampered
;   5. Write E-perm LED driver GT into C-list slot 8+N (LED N)
;   6. Store permMask for driver calls
;   DR1 <- permMask granted
; If invalid: PERM fault — no hardware state changes

; ── STEP 3: CALL LED driver — set LED 3 ON ────
; E-perm LED driver GT is now at C-list offset 11 (LED 3 = 8+3)
; No DR argument needed — the capability IS the LED
CALL   0, CR6, #11       ; LED.Set on LED 3 (C-list offset 11):
;   1. Method = 0 (Set) encoded in CALL immediate
;   2. LED identity = C-list offset 11 (8 base + 3 for LED 3)
;   3. Hardware write at 0xFE10 (invisible to caller)
;   4. DR0 <- signed return (≥0 success, -1 invalid capability offset)
; Gate Log shows full chain of custody:
;   PassKey presented -> Navana validated ->
;   LED.Set called via capability offset -> device write committed`,
            'CallLEDDriver': `; LED via Navana PassKey — capability-offset API
;
; Assumes PassKey already validated (Step 1-2 done)
; Navana writes LED driver GTs into C-list slots 8..13 (LED 0..5)
; LED identity = C-list slot offset (8=LED0 ... 13=LED5)
; No DR argument needed — the capability IS the LED

; ---- LED.Set on LED 2 (C-list offset 10) ----
CALL   0, CR6, #10        ; Set LED 2; DR0 <- 1 (ok) or -1 (fault)
BGE    DR0, #0, .ok       ; branch if non-negative (success)
; handle fault (DR0 < 0)

.ok:
; ---- LED.State on LED 2 ----
CALL   3, CR6, #10        ; Read LED 2 state; DR0 = 1(on) / 0(off) / -1(fault)
BGE    DR0, #0, .got_state
; handle fault
.got_state:
; DR0 = current on/off state`,
            'MintPassKey': `; Navana.MintPassKey — create a new PassKey
; PRIVILEGED: requires M-elevation (boot/kernel only)
; Unprivileged callers get PERM fault.
LOAD   CR1, NS[5]        ; Load Navana E-GT
DWRITE DR1, #4            ; DR1=4 selects MintPassKey method
DWRITE DR2, #0x010F       ; DR2[15:8]=device(LED=0x01), DR2[7:0]=permMask(ALL=0x0F)
CALL   CR1                ; Navana.MintPassKey:
;   1. Check M-elevation (unprivileged -> PERM fault)
;   2. Allocate PassKey ID (monotonic counter)
;   3. Pack Abstract GT (type=0b11):
;      index = device[15:8] | permMask[7:4] | id[3:0]
;      E perm for CALL capability
;   4. Store in Navana's private PassKey registry
;   5. CR1 <- PassKey GT (ready to grant to thread)
; PassKey is unforgeable:
;   - Only Navana can mint (M-elevation required)
;   - GT index encoding cross-checked against registry
;   - Thread receives but cannot modify or copy`,
        },
        'Mint': {
            'Encode': `; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
; Mint.Encode(base, exp, permsBits, bindable, far)
; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;   type:  00=NULL  01=Inform  10=Outform  11=Abstract
;          NULL cannot be created (it IS the zero value)
;   size:  words to allocate via Memory.Allocate
;   perms: any valid combo within ONE domain:
;     Turing domain:  R, W, X  (any combo: R, RW, RX, RWX, W, X, WX)
;     Church domain:  L, S, E  (any combo: L, LS, LE, LSE, S, E, SE)
;   bind:  B-bit (default 0, auto-cleared by CALL)
;   far:   F-bit (default 0, auto-set for Outform)
;
; Process:
;   1. Domain purity check (Turing OR Church, never mixed)
;   2. CALL Memory.Allocate(size) for backing storage (returns location)
;   3. Find free NS entry (Mint manages NS table)
;   4. Increment version (never reset — monotonic)
;   5. Write 3-word NS entry with B/F flags + seal
;   6. Pack GT, return ready to use
;
; Returns: GT packed as Version(7)|Index(17)|Perms(6)|Type(2)
; Faults:  DOMAIN_PURITY, OOM, TYPE (NULL not creatable)
; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

; ── EXAMPLE A: Inform + Turing R,W (data buffer) ──────────
LOAD   CR1, NS[6]       ; Load Mint E-GT (mLoad validates)
DWRITE DR1, #1          ; type = 01 (Inform)
DWRITE DR2, #128        ; size = 128 words
DWRITE DR3, #0b000011   ; perms = R+W (Turing domain)
                         ;   bit0=R, bit1=W
CALL   CR1              ; Mint.Encode internally:
;   1. Domain purity: R+W = Turing only — OK
;   2. CALL Memory.Allocate(128):
;      Memory scans NS for free slot (word0=0 AND word1=0)
;      skips reserved 0..44, finds e.g. slot 50
;      returns { nsIndex: 50, location: 0x3200 }
;   3. Version increment:
;      read NS[50].word2, extract ver = (word2>>25)&0x7F
;      newVer = (ver + 1) & 0x7F  (never reset to 0)
;   4. Pack NS entry at NS_TABLE_BASE + 50*3:
;      word0 = location (0x3200)
;      word1 = B(0)|F(0)|G(0)|type(01)|...|limit(127)
;      word2 = (newVer<<25) | CRC16_seal(loc, limit)
;   5. Pack GT:
;      GT = (seq<<16)|(50)|(0b000001<<25)|(0b01<<23)
;         = seq=1, idx=50, R+W, Inform
; Result: CR1 <- ready-to-use GT for NS[50]

; ── EXAMPLE B: Inform + Turing R,W,X (full data+code) ────
LOAD   CR1, NS[6]       ; Load Mint E-GT
DWRITE DR1, #1          ; type = 01 (Inform)
DWRITE DR2, #64         ; size = 64 words
DWRITE DR3, #0b000111   ; perms = R+W+X (full Turing)
                         ;   bit0=R, bit1=W, bit2=X
CALL   CR1              ; Mint.Encode:
;   Domain purity: R+W+X = Turing only — OK
;   Memory.Allocate(64) -> location for backing storage
;   Mint finds free NS entry, increments version, packs GT
; Result: CR1 <- GT with full Turing access
;   DREAD/DWRITE for data, LAMBDA for execution

; ── EXAMPLE C: Inform + Turing X only (execute-only code) ─
LOAD   CR1, NS[6]       ; Load Mint E-GT
DWRITE DR1, #1          ; type = 01 (Inform)
DWRITE DR2, #32         ; size = 32 words
DWRITE DR3, #0b000100   ; perms = X only (Turing)
                         ;   bit2=X — execute but no read
CALL   CR1              ; Mint.Encode:
;   Code object you can run but not inspect
;   CR14 loads via X perm (privileged code register)

; ── EXAMPLE D: Inform + Church L,S,E (c-list) ────────────
LOAD   CR1, NS[6]       ; Load Mint E-GT
DWRITE DR1, #1          ; type = 01 (Inform)
DWRITE DR2, #16         ; size = 16 slots
DWRITE DR3, #0b111000   ; perms = L+S+E (full Church)
                         ;   bit3=L, bit4=S, bit5=E
CALL   CR1              ; Mint.Encode:
;   Domain purity: L+S+E = Church only — OK
;   Memory.Allocate(16) -> location for c-list storage
;   Mint finds free NS entry, increments version
; Result: CR1 <- GT for c-list
;   L: LOAD GTs from this c-list
;   S: SAVE GTs into this c-list
;   E: CALL/enter through this c-list

; ── EXAMPLE E: Inform + Church E only (abstraction) ──────
LOAD   CR1, NS[6]       ; Load Mint E-GT
DWRITE DR1, #1          ; type = 01 (Inform)
DWRITE DR2, #8          ; size = 8 words
DWRITE DR3, #0b100000   ; perms = E only (Church)
                         ;   bit5=E
CALL   CR1              ; Mint.Encode:
;   Standard abstraction entry point — E only
;   Can CALL but cannot LOAD/SAVE

; ── EXAMPLE F: Inform + Bind flag ─────────────────────────
LOAD   CR1, NS[6]       ; Load Mint E-GT
DWRITE DR1, #1          ; type = 01 (Inform)
DWRITE DR2, #64         ; size = 64 words
DWRITE DR3, #0b000011   ; perms = R+W (Turing)
DWRITE DR4, #1          ; bind = 1 (B-bit set)
CALL   CR1              ; Mint.Encode:
;   B-bit=1 in word1[31] — GT bound to a thread
;   B-bit auto-cleared by CALL (hardware enforced)
;   Prevents GT from being used before binding

; ── EXAMPLE G: Outform + Far + Church L,E (remote) ───────
LOAD   CR1, NS[6]       ; Load Mint E-GT
DWRITE DR1, #2          ; type = 10 (Outform)
DWRITE DR2, #32         ; size = 32 words (local proxy)
DWRITE DR3, #0b101000   ; perms = L+E (Church)
                         ;   bit3=L, bit5=E
CALL   CR1              ; Mint.Encode:
;   Outform: F-bit auto-set (Far = remote resource)
;   CALL Memory.Allocate for URL proxy object
;   mLoad step 6 detects F-bit, routes through Tunnel
;   All access mediated by encrypted capability tunnel

; ── EXAMPLE H: Abstract type (new abstraction) ───────────
LOAD   CR1, NS[6]       ; Load Mint E-GT
DWRITE DR1, #3          ; type = 11 (Abstract)
DWRITE DR2, #256        ; size = 256 words
DWRITE DR3, #0b100000   ; perms = E only (Church)
CALL   CR1              ; Mint.Encode:
;   Abstract type: this GT represents a new abstraction
;   Responds to polymorphic interface: create/destroy/call/inspect
;   Navana manages its lifecycle

; ── ILLEGAL: NULL type (FAULT) ────────────────────────────
; DWRITE DR1, #0          ; type = 00 (NULL) — ILLEGAL!
;   -> FAULT: TYPE
;   NULL is the zero/absent value, not creatable

; ── ILLEGAL: Mixed domain (FAULT) ─────────────────────────
; DWRITE DR2, #0b001011 ; R+W+L — ILLEGAL!
;   Turing(R,W) mixed with Church(L)
;   -> FAULT: DOMAIN_PURITY`,
            'Revoke': `; Mint.Revoke — instant revocation via version increment
; Incrementing the version in the NS entry kills ALL
; outstanding copies of the GT — they will fail mLoad
; step 2 (version mismatch) on next use
LOAD   CR1, NS[6]       ; Load Mint E-GT
DWRITE DR1, #50         ; Target NS slot to revoke

CALL   CR1              ; Mint.Revoke:
;   base = NS_TABLE_BASE + 50 * 3
;   word2 = mem[base+2]
;   oldVer = (word2 >>> 25) & 0x7F     ; extract version
;   newVer = (oldVer + 1) & 0x7F       ; increment (wraps at 128)
;   seal = word2 & 0xFFFF               ; preserve CRC-16 seal
;   mem[base+2] = (newVer << 25) | seal ; write back
;
; All GTs with old version are now dead:
;   any LOAD/CALL with stale GT hits mLoad step 2:
;   GT.version(7 bits) != NS[50].word2.version(7 bits)
;   -> FAULT: VERSION_MISMATCH
; DR1 <- new version number`,
            'Transfer': `; Mint.Transfer — move GT between c-lists
; The c-list IS the parental approval — transferring a GT
; to a child's c-list grants them access to that resource
LOAD   CR1, NS[6]       ; Load Mint E-GT
LOAD   CR2, NS[50]      ; Source: GT to transfer
LOAD   CR3, NS[60]      ; Target: destination c-list GT

; Transfer requires:
;   1. Caller holds L perm on source c-list (can read GT)
;   2. Caller holds S perm on target c-list (can write GT)
;   3. B-bit (Bind) on source GT must be 0 (transferable)
;      B-bit is auto-cleared by CALL instruction
CALL   CR1              ; Mint.Transfer:
;   read GT from source c-list[slot]
;   validate B-bit = 0 (can be moved)
;   SAVE GT to target c-list[slot] via S perm
;   optionally zero source slot (move vs copy)
; The child now has the GT in their c-list`,
        },
        'Memory': {
            'Allocate': `; Memory.Allocate — reserve a memory region
; Memory manages address space as a pool of allocations.
; It does NOT manage the NS table — that is Mint/Navana's job.
LOAD   CR1, NS[7]       ; Load Memory E-GT via mLoad
DWRITE DR1, #128        ; Request 128 words of storage

CALL   CR1              ; Memory.Allocate:
;   1. Check if requested size fits in available memory
;      (next free address + size must not exceed NS_TABLE_BASE)
;      if no room: FAULT OOM
;   2. Record allocation at current free address
;   3. Advance free address pointer by size
;
; DR1 <- base location address
; DR2 <- allocation size (128)
; Memory only returns a location — Mint.Encode handles
; the NS entry, GT creation, and version management`,
            'Free': `; Memory.Free — release a memory region
LOAD   CR1, NS[7]       ; Load Memory E-GT
DWRITE DR1, #0x2D00     ; Location to free (from original Allocate)

CALL   CR1              ; Memory.Free:
;   1. Look up allocation at given location
;      if not found: FAULT BOUNDS
;   2. Zero the memory contents
;   3. Remove allocation record
; The NS entry is NOT touched — use Mint.Revoke to
; invalidate GTs, then free the backing memory here`,
            'Resize': `; Memory.Resize — adjust allocation size
LOAD   CR1, NS[7]       ; Load Memory E-GT
DWRITE DR1, #0x2D00     ; Location to resize (from original Allocate)
DWRITE DR2, #256        ; New size (words)

CALL   CR1              ; Memory.Resize:
;   1. Look up allocation at given location
;      if not found: FAULT BOUNDS
;   2. Update the allocation record with new size
; NOTE: if an NS entry references this location,
; Mint must also update the NS entry's limit field
; and recompute the CRC-16 seal separately`,
        },
        'Scheduler': {
            'Yield': `; Scheduler.Yield — voluntarily yield time slice
LOAD   CR1, NS[8]       ; Load Scheduler E-GT
CALL   CR1              ; Scheduler.Yield:
;   1. Save current thread state (CRs, DRs, flags, PC)
;   2. Select next ready thread from run queue
;   3. Restore next thread's state
;   4. Transfer control (PC <- next thread's saved PC)
; Current thread goes to back of run queue`,
            'Spawn': `; Scheduler.Spawn — create a new thread
; Each thread gets its own CR set and namespace view
LOAD   CR1, NS[8]       ; Load Scheduler E-GT
LOAD   CR2, NS[50]      ; Code GT for new thread (X perm)
                         ;   must be DATA-domain object
DWRITE DR1, #0x0200     ; Entry point address within code

CALL   CR1              ; Scheduler.Spawn:
;   1. Memory.Allocate for thread control block
;   2. Initialize CRs (copy parent's c-list subset)
;   3. Set new thread PC = entry point
;   4. Each child thread has isolated namespace view
;   5. Add to run queue
; DR1 <- new thread ID`,
            'Wait': `; Scheduler.Wait — block thread on DijkstraFlag
; Thread stops running until the flag is signaled
LOAD   CR1, NS[8]       ; Load Scheduler E-GT
LOAD   CR2, NS[10]      ; DijkstraFlag GT (event source)

CALL   CR1              ; Scheduler.Wait:
;   1. Remove current thread from run queue
;   2. Add to DijkstraFlag's wait queue
;   3. Save thread state
;   4. Switch to next ready thread
; Thread resumes when DijkstraFlag.Signal fires`,
            'Stop': `; Scheduler.Stop — terminate a thread
LOAD   CR1, NS[8]       ; Load Scheduler E-GT
DWRITE DR1, #2          ; Thread ID to terminate

CALL   CR1              ; Scheduler.Stop:
;   1. Remove thread from run/wait queue
;   2. Memory.Free thread control block
;   3. Clear thread's CRs (release capabilities)
;   4. If terminated thread held GTs, they become
;      unreachable (GC will reclaim via G-bit scan)`,
        },
        'Stack': {
            'Push': `; Stack.Push — push value onto managed stack
; Stack uses a Memory-allocated DATA region for storage
LOAD   CR1, NS[9]       ; Load Stack E-GT
DWRITE DR1, #42         ; Value to push

CALL   CR1              ; Stack.Push:
;   1. Check stack not full (depth < limit from word1)
;   2. DWRITE value to mem[location + depth]
;      location = NS[stack_slot].word0
;   3. Increment depth counter
;   4. If full: WARN STACK_OVERFLOW — thread suspended for programmed recovery`,
            'Pop': `; Stack.Pop — pop value from stack
LOAD   CR1, NS[9]       ; Load Stack E-GT

CALL   CR1              ; Stack.Pop:
;   1. Check stack not empty (depth > 0)
;   2. Decrement depth counter
;   3. DREAD value from mem[location + depth]
;   4. If empty: FAULT STACK_UNDERFLOW
; DR1 <- popped value`,
            'Peek': `; Stack.Peek — read top without removing
LOAD   CR1, NS[9]       ; Load Stack E-GT

CALL   CR1              ; Stack.Peek:
;   1. Check stack not empty
;   2. DREAD mem[location + depth - 1]
;   3. Do NOT decrement depth
; DR1 <- top value (stack unchanged)`,
            'Depth': `; Stack.Depth — query current stack depth
LOAD   CR1, NS[9]       ; Load Stack E-GT

CALL   CR1              ; Stack.Depth:
;   DR1 <- current number of entries on stack`,
        },
        'DijkstraFlag': {
            'Wait': `; DijkstraFlag.Wait — block thread until flag signaled
; Implements Dijkstra's semaphore P() operation
; Integrates with Scheduler for thread management
LOAD   CR1, NS[10]      ; Load DijkstraFlag E-GT

CALL   CR1              ; DijkstraFlag.Wait:
;   1. Test flag state
;   2. If signaled: clear flag, continue (no block)
;   3. If not signaled:
;      a. Add current thread to flag's wait queue
;      b. Scheduler.Wait(this flag) — block thread
;      c. Thread sleeps until Signal wakes it
; Thread resumes here after being signaled`,
            'Signal': `; DijkstraFlag.Signal — wake one waiting thread
; Implements Dijkstra's semaphore V() operation
LOAD   CR1, NS[10]      ; Load DijkstraFlag E-GT

CALL   CR1              ; DijkstraFlag.Signal:
;   1. If threads waiting on this flag:
;      a. Remove one thread from wait queue
;      b. Scheduler.Spawn/resume that thread
;   2. If no threads waiting:
;      a. Set flag state = signaled
;      b. Next Wait() will consume it immediately`,
            'Reset': `; DijkstraFlag.Reset — clear flag state
LOAD   CR1, NS[10]      ; Load DijkstraFlag E-GT

CALL   CR1              ; DijkstraFlag.Reset:
;   1. Clear flag to unsignaled state
;   2. Does NOT affect threads in wait queue
;   3. Used to re-arm one-shot events`,
            'Test': `; DijkstraFlag.Test — non-blocking check
LOAD   CR1, NS[10]      ; Load DijkstraFlag E-GT

CALL   CR1              ; DijkstraFlag.Test:
;   1. Read flag state without blocking
;   2. Does NOT consume the signal
;   DR1 <- 1 if signaled, 0 if not`,
        },
        'UART': {
            'Send': `; UART.Send — transmit byte via Church domain S perm
; Hardware devices use L/S/E only (Church domain)
; NOT R/W (that's Turing domain for DATA objects)
LOAD   CR1, NS[11]      ; Load UART GT [L,S,E] via mLoad
                         ;   mLoad checks: type, version, seal,
                         ;   bounds, perms, F-bit, deliver
DWRITE DR1, #0x41       ; Byte to send ('A') in data register
SAVE   CR1, DR1         ; S perm: save data TO device
                         ;   SAVE checks S permission on GT
                         ;   Church domain: capability-gated I/O
; Byte queued for transmission on pin 69 (TX)`,
            'Receive': `; UART.Receive — read byte via Church domain L perm
LOAD   CR1, NS[11]      ; Load UART GT [L,S,E]

LOAD   DR1, CR1         ; L perm: load data FROM device
                         ;   LOAD checks L permission on GT
                         ;   Only capability holders can read UART
; DR1 <- received byte from pin 70 (RX)
; If no byte available: DR1 = 0, Z flag set`,
            'SetBaud': `; UART.SetBaud — configure baud rate via CALL
LOAD   CR1, NS[11]      ; Load UART E-GT
DWRITE DR1, #115200     ; Target baud rate

CALL   CR1              ; UART.SetBaud via E perm:
;   1. Validate baud rate is supported
;   2. Configure UART divider register
;   3. BL616 USB bridge at 27MHz clock
; Note: E perm required for configuration methods
; L/S only for data transfer`,
        },
        'LED': {
            'Set': `; LED.Set — turn LED on via S (Save) permission
; Tang Nano 20K: 6 LEDs on pins 15-20 (active-low)
; LED identity = C-list slot offset (8=LED0, 9=LED1 ... 13=LED5)
; No DR arg needed — the capability selects the LED.
CALL   0, CR6, #11      ; LED.Set LED 3 (C-list offset 11)
;   DR0 <- 1 (success), or DR0 <- -1 (invalid offset)
BGE    DR0, #0, .ok     ; non-negative = success
.ok:`,
            'Clear': `; LED.Clear — turn LED off (no DR arg)
; LED identity from C-list slot: offset 8=LED0, 9=LED1 ... 13=LED5
CALL   1, CR6, #11      ; LED.Clear LED 3 (C-list offset 11)
;   DR0 <- 1 (success), DR0 <- -1 (fault)
BGE    DR0, #0, .ok     ; check sign
.ok:`,
            'Toggle': `; LED.Toggle — flip LED state (no DR arg)
; LED identity from C-list slot: offset 8=LED0, 9=LED1 ... 13=LED5
CALL   2, CR6, #11      ; LED.Toggle LED 3 (C-list offset 11)
;   DR0 <- 1 (success), DR0 <- -1 (fault)`,
            'State': `; LED.State — read on/off state (no DR arg)
; LED identity from C-list slot: offset 8=LED0, 9=LED1 ... 13=LED5
CALL   3, CR6, #11      ; LED.State LED 3 (C-list offset 11)
;   DR0 = 1 (on), DR0 = 0 (off), DR0 = -1 (fault)
BGE    DR0, #0, .got_state
; DR0 < 0: capability fault
.got_state:
; DR0 = current LED state (0 or 1)`,
        },
        'Button': {
            'Read': `; Button.Read — read button state via L perm
; Button is L+E only (no S — you can't write to a button)
; Tang Nano 20K button on pin 88
LOAD   CR1, NS[13]      ; Load Button GT [L,E]
LOAD   DR1, CR1         ; L perm: load state from device
; DR1 <- 1 if pressed, 0 if released`,
            'WaitPress': `; Button.WaitPress — block until button press
LOAD   CR1, NS[13]      ; Load Button GT [L,E]

CALL   CR1              ; Button.WaitPress via E perm:
;   1. Read current state via L perm
;   2. If pressed: return immediately
;   3. If released: Scheduler.Wait on button event
;      thread blocks until hardware interrupt
; DR1 <- 1 (pressed) when thread resumes`,
            'OnEvent': `; Button.OnEvent — dequeue button event
LOAD   CR1, NS[13]      ; Load Button GT [L,E]

CALL   CR1              ; Button.OnEvent via E perm:
;   1. Check event queue (press/release transitions)
;   2. If event pending: dequeue and return
;   3. If no event: DR1 = 0, Z flag set
; DR1 <- event type (1=press, 2=release, 0=none)`,
        },
        'Timer': {
            'Start': `; Timer.Start — begin counting via S perm
LOAD   CR1, NS[14]      ; Load Timer GT [L,S,E]
DWRITE DR1, #0          ; Timer channel

SAVE   CR1, DR1         ; S perm: save "start" to device
; Timer begins counting from 27MHz clock`,
            'Stop': `; Timer.Stop — halt timer via S perm
LOAD   CR1, NS[14]      ; Load Timer GT [L,S,E]
DWRITE DR1, #0          ; Timer channel

CALL   CR1              ; Timer.Stop via E perm:
;   S perm: write stop command to device
;   Timer halts, counter preserved for reading`,
            'Read': `; Timer.Read — get elapsed time via L perm
LOAD   CR1, NS[14]      ; Load Timer GT [L,S,E]

LOAD   DR1, CR1         ; L perm: load elapsed from device
; DR1 <- elapsed ticks since Start
; At 27MHz: ticks / 27000000 = seconds`,
            'SetAlarm': `; Timer.SetAlarm — set alarm threshold via S perm
LOAD   CR1, NS[14]      ; Load Timer GT [L,S,E]
DWRITE DR1, #27000000   ; Alarm at 1 second (27M ticks)

SAVE   CR1, DR1         ; S perm: save alarm to device
; When counter reaches threshold:
;   hardware signals DijkstraFlag for this timer
;   waiting thread wakes via DijkstraFlag.Signal`,
        },
        'Display': {
            'Write': `; Display.Write — write character via S perm
LOAD   CR1, NS[15]      ; Load Display GT [L,S,E]
DWRITE DR1, #0x48       ; Character 'H'

SAVE   CR1, DR1         ; S perm: save char to device
; Character appears at current cursor position`,
            'Clear': `; Display.Clear — clear screen via E perm
LOAD   CR1, NS[15]      ; Load Display GT [L,S,E]

CALL   CR1              ; Display.Clear via E perm:
;   S perm: write clear command to device
;   All pixels/chars zeroed, cursor reset to (0,0)`,
            'Scroll': `; Display.Scroll — scroll display via E perm
LOAD   CR1, NS[15]      ; Load Display GT [L,S,E]
DWRITE DR1, #1          ; Scroll 1 line up

CALL   CR1              ; Display.Scroll via E perm:
;   S perm: write scroll command to device
;   Top line lost, bottom line cleared`,
        },
        'SlideRule': {
            'Multiply': `; SlideRule.Multiply — DR1 * DR2
; Method index 0 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #2     ; Left operand
IADD   DR2, DR0, #3     ; Right operand
IADD   DR3, DR0, #0     ; Method selector: Multiply (index 0)
CALL   CR1              ; DR1 <- 6`,
            'Divide': `; SlideRule.Divide — DR1 / DR2
; Method index 1 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #10    ; Dividend
IADD   DR2, DR0, #2     ; Divisor
IADD   DR3, DR0, #1     ; Method selector: Divide (index 1)
CALL   CR1              ; DR1 <- 5
; Div by zero returns 0 with fault message`,
            'Sqrt': `; SlideRule.Sqrt — floor(sqrt(DR1))
; Method index 2 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #9     ; Input
IADD   DR3, DR0, #2     ; Method selector: Sqrt (index 2)
CALL   CR1              ; DR1 <- 3`,
            'Mod': `; SlideRule.Mod — DR1 % DR2
; Method index 3 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #10    ; Dividend
IADD   DR2, DR0, #3     ; Divisor
IADD   DR3, DR0, #3     ; Method selector: Mod (index 3)
CALL   CR1              ; DR1 <- 1`,
            'Sin': `; SlideRule.Sin — sine (radians)
; Method index 4 — via NS LOAD + DR3 method select
; FPGA uses CORDIC; simulator uses IEEE 754
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #0x3FC90FDB  ; pi/2 (1.5708 rad)
IADD   DR3, DR0, #4     ; Method selector: Sin (index 4)
CALL   CR1              ; DR1 <- 0x3F800000 (1.0)`,
            'Cos': `; SlideRule.Cos — cosine (radians)
; Method index 5 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #0     ; 0.0 rad
IADD   DR3, DR0, #5     ; Method selector: Cos (index 5)
CALL   CR1              ; DR1 <- 0x3F800000 (1.0)`,
            'Tan': `; SlideRule.Tan — tangent (radians)
; Method index 6 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #0x3F490FDB  ; pi/4 (0.7854 rad)
IADD   DR3, DR0, #6     ; Method selector: Tan (index 6)
CALL   CR1              ; DR1 <- 0x3F800000 (1.0)
; Near pi/2: FAULT DOMAIN_ERROR (asymptote)`,
            'Asin': `; SlideRule.Asin — inverse sine -> radians
; Method index 7 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #0x3F800000  ; 1.0
IADD   DR3, DR0, #7     ; Method selector: Asin (index 7)
CALL   CR1              ; DR1 <- 0x3FC90FDB (pi/2)
; |input| > 1.0: FAULT DOMAIN_ERROR`,
            'Acos': `; SlideRule.Acos — inverse cosine -> radians
; Method index 8 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #0x3F800000  ; 1.0
IADD   DR3, DR0, #8     ; Method selector: Acos (index 8)
CALL   CR1              ; DR1 <- 0x00000000 (0.0)`,
            'Atan': `; SlideRule.Atan — inverse tangent -> radians
; Method index 9 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #0x3F800000  ; 1.0
IADD   DR3, DR0, #9     ; Method selector: Atan (index 9)
CALL   CR1              ; DR1 <- 0x3F490FDB (pi/4)`,
            'ToDegrees': `; SlideRule.ToDegrees — radians to degrees
; Method index 10 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #0x40490FDB  ; pi (3.14159 rad)
IADD   DR3, DR0, #10    ; Method selector: ToDegrees (index 10)
CALL   CR1              ; DR1 <- 0x43340000 (180.0 deg)
; Multiply by 180/pi internally`,
            'ToRadians': `; SlideRule.ToRadians — degrees to radians
; Method index 11 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #0x43340000  ; 180.0 degrees
IADD   DR3, DR0, #11    ; Method selector: ToRadians (index 11)
CALL   CR1              ; DR1 <- 0x40490FDB (pi rad)
; Multiply by pi/180 internally`,
            'Bernoulli': `; SlideRule.Bernoulli(n) — exact rational B(n)
; Method index 12 — via NS LOAD + DR3 method select
; Returns: numerator in DR1, denominator in DR2
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #6     ; n=6 -> B(6) = 1/42
IADD   DR3, DR0, #12    ; Method selector: Bernoulli (index 12)
CALL   CR1              ; DR1 <- 1 (numerator)
                         ; DR2 <- 42 (denominator)
; Odd n>1 returns 0/1`,
            'Abs': `; SlideRule.Abs — |DR1|
; Method index 13 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #42    ; Input
ISUB   DR1, DR0, DR1    ; Negate: DR1 = -42
IADD   DR3, DR0, #13    ; Method selector: Abs (index 13)
CALL   CR1              ; DR1 <- 42`,
            'Pow': `; SlideRule.Pow — base^exp (integer, exp >= 0)
; Method index 14 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #2     ; Base
IADD   DR2, DR0, #10    ; Exponent
IADD   DR3, DR0, #14    ; Method selector: Pow (index 14)
CALL   CR1              ; DR1 <- 1024
; Negative exponent returns 0`,
            'Min': `; SlideRule.Min — min(DR1, DR2)
; Method index 15 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #7     ; First value
IADD   DR2, DR0, #3     ; Second value
IADD   DR3, DR0, #15    ; Method selector: Min (index 15)
CALL   CR1              ; DR1 <- 3`,
            'Max': `; SlideRule.Max — max(DR1, DR2)
; Method index 16 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #7     ; First value
IADD   DR2, DR0, #3     ; Second value
IADD   DR3, DR0, #16    ; Method selector: Max (index 16)
CALL   CR1              ; DR1 <- 7`,
            'GCD': `; SlideRule.GCD — greatest common divisor
; Method index 17 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #12    ; First value
IADD   DR2, DR0, #8     ; Second value
IADD   DR3, DR0, #17    ; Method selector: GCD (index 17)
CALL   CR1              ; DR1 <- 4`,
            'Factorial': `; SlideRule.Factorial — n!
; Method index 18 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #10    ; n=10
IADD   DR3, DR0, #18    ; Method selector: Factorial (index 18)
CALL   CR1              ; DR1 <- 3628800`,
            'Log2': `; SlideRule.Log2 — floor(log2(n))
; Method index 19 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #256   ; Input
IADD   DR3, DR0, #19    ; Method selector: Log2 (index 19)
CALL   CR1              ; DR1 <- 8
; n<1 returns 0`,
            'Atan2': `; SlideRule.Atan2 — atan2(y, x)
; Method index 20 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #0x3F800000  ; y = 1.0
IADD   DR2, DR0, #0x3F800000  ; x = 1.0
IADD   DR3, DR0, #20    ; Method selector: Atan2 (index 20)
CALL   CR1              ; DR1 <- 0x3F490FDB (pi/4)`,
            'Signum': `; SlideRule.Signum — sign of DR1: +1, 0, or -1
; Method index 21 — via NS LOAD + DR3 method select
;
LOAD   CR1, NS[16]      ; Load SlideRule E-GT from NS
IADD   DR1, DR0, #42    ; Positive input
IADD   DR3, DR0, #21    ; Method selector: Signum (index 21)
CALL   CR1              ; DR1 <- 1`,
        },
        'Abacus': {
            'Add': `; Abacus.Add — integer addition (Turing domain data)
LOAD   CR1, NS[17]      ; Load Abacus E-GT
DWRITE DR1, #7
DWRITE DR2, #5
CALL   CR1              ; DR1 <- 12
; Overflow: sets V (overflow) flag`,
            'Sub': `; Abacus.Sub — integer subtract
LOAD   CR1, NS[17]      ; Load Abacus E-GT
DWRITE DR1, #10
DWRITE DR2, #3
CALL   CR1              ; DR1 <- 7
; Underflow: sets N (negative) flag`,
            'Mul': `; Abacus.Mul — integer multiply
LOAD   CR1, NS[17]      ; Load Abacus E-GT
DWRITE DR1, #6
DWRITE DR2, #7
CALL   CR1              ; DR1 <- 42`,
            'Div': `; Abacus.Div — integer divide
LOAD   CR1, NS[17]      ; Load Abacus E-GT
DWRITE DR1, #42
DWRITE DR2, #6
CALL   CR1              ; DR1 <- 7 (quotient)
; Div by zero: FAULT MATH_ERROR`,
            'Mod': `; Abacus.Mod — modulo (remainder)
LOAD   CR1, NS[17]      ; Load Abacus E-GT
DWRITE DR1, #17
DWRITE DR2, #5
CALL   CR1              ; DR1 <- 2`,
            'Abs': `; Abacus.Abs — absolute value
LOAD   CR1, NS[17]      ; Load Abacus E-GT
DWRITE DR1, #-42        ; Negative input (two's complement)
CALL   CR1              ; DR1 <- 42`,
        },
        'Constants': {
            'Pi': `; Constants.Pi — return π as IEEE 754
; Step 1: bind Constants by name (Level-2 load)
LOAD   CR11, Constants   ; CR11 = Constants E-GT (NS[18])
; Step 2: call via dot-notation — assembler encodes CALL CR11, 1
CALL   Constants.Pi      ; DR1 <- 0x40490FDB  (π ≈ 3.14159265)
; Low-level equivalent:  LOAD CR11, NS[18]  then  CALL CR11, 1`,
            'E': `; Constants.E — return Euler's number as IEEE 754
LOAD   CR11, Constants   ; CR11 = Constants E-GT (NS[18])
CALL   Constants.E       ; DR1 <- 0x402DF854  (e ≈ 2.71828183)
; Low-level equivalent:  CALL CR11, 2`,
            'Phi': `; Constants.Phi — return golden ratio as IEEE 754
LOAD   CR11, Constants   ; CR11 = Constants E-GT (NS[18])
CALL   Constants.Phi     ; DR1 <- 0x3FCFBE77  (φ ≈ 1.61803399)
; Low-level equivalent:  CALL CR11, 3`,
            'Zero': `; Constants.Zero — return IEEE 754 +0.0
LOAD   CR11, Constants   ; CR11 = Constants E-GT (NS[18])
CALL   Constants.Zero    ; DR1 <- 0x00000000  (0.0 IEEE 754)
; Low-level equivalent:  CALL CR11, 4`,
            'One': `; Constants.One — return IEEE 754 1.0
LOAD   CR11, Constants   ; CR11 = Constants E-GT (NS[18])
CALL   Constants.One     ; DR1 <- 0x3F800000  (1.0 IEEE 754)
; Low-level equivalent:  CALL CR11, 5`,
        },
        'Loader': {
            'Load': `; Loader.Load — fault-driven lazy load
; Normally called automatically by the fault handler
; when a CALL targets a warm/cold NULL slot.
; Can also be called explicitly:
DWRITE DR1, #16         ; Slot 16 (SlideRule)
LOAD   CR1, NS[19]      ; Load Loader E-GT
CALL   CR1              ; Loader.Load(16):
;   1. Read manifest[16] — source, path, size, priority
;   2. Fetch lump bytes (UART or local)
;   3. Memory.Allocate(size)
;   4. Write lump into allocated region
;   5. Navana.Abstraction.Add(slot, lump)
;   6. Mint.Encode(GT for loaded abstraction)
; Slot 16 is now live — subsequent CALLs work`,
            'Prefetch': `; Loader.Prefetch — hint-driven pre-load
DWRITE DR1, #16         ; Slot to prefetch
DWRITE DR3, #1          ; Method index 1 (Prefetch)
LOAD   CR1, NS[19]      ; Load Loader E-GT
CALL   CR1              ; Returns immediately
; Lump will be loaded in background
; No fault if already loaded`,
            'Evict': `; Loader.Evict — unload a cold abstraction
DWRITE DR1, #16         ; Slot to evict
DWRITE DR3, #2          ; Method index 2 (Evict)
LOAD   CR1, NS[19]      ; Load Loader E-GT
CALL   CR1              ; Loader.Evict(16):
;   1. Clear NS entry for slot 16
;   2. Memory.Free(slot 16 lump region)
;   3. NULL the GT — next CALL triggers re-load
; Slot 16 is now NULL — saves memory`,
        },
        'Circle': {
            'Area': `; Circle.Area — pi * r^2 (delegates to SlideRule)
LOAD   CR1, NS[46]      ; Load Circle E-GT
DWRITE DR1, #0x40A00000 ; Radius: 5.0

CALL   CR1              ; Circle.Area internally:
;   1. LOAD CR2, NS[16] — get SlideRule GT
;   2. CALL SlideRule.Multiply(r, r)  -> r^2 = 25.0
;   3. LOAD CR3, NS[18] — get Constants GT
;   4. CALL Constants.Pi             -> pi
;   5. CALL SlideRule.Multiply(pi, r^2) -> 78.5398
; DR1 <- 0x429CE5A0 (78.54)
; Circle has no trig itself — delegates to SlideRule`,
            'Circumference': `; Circle.Circumference — 2 * pi * r
LOAD   CR1, NS[46]      ; Load Circle E-GT
DWRITE DR1, #0x40A00000 ; Radius: 5.0

CALL   CR1              ; Circle.Circumference internally:
;   1. CALL Constants.Pi             -> pi
;   2. CALL SlideRule.Multiply(2.0, pi) -> 2*pi
;   3. CALL SlideRule.Multiply(2pi, r)  -> 31.4159
; DR1 <- 0x41FB53D1 (31.416)`,
        },
        'SUCC': {
            'Apply': `; SUCC.Apply — Church successor via LAMBDA
; Church numerals use LAMBDA instruction, not CALL
; LAMBDA dispatches within an abstraction (not a security block)
LOAD   CR1, NS[20]      ; Load SUCC GT [X]
                         ;   X perm only (Turing domain — code object)
                         ;   SUCC's CLOOMC holds the reduction code
DWRITE DR1, #3          ; Church numeral 3

LAMBDA CR1, DR1         ; Apply SUCC:
                         ;   CR1 must have X perm (execute code)
                         ;   SUCC's code performs: f(f(f(x))) -> f(f(f(f(x))))
                         ;   i.e. add one application of f
; DR1 <- 4 (Church numeral for successor of 3)`,
        },
        'PRED': {
            'Apply': `; PRED.Apply — Church predecessor
LOAD   CR1, NS[21]      ; Load PRED GT [X]
DWRITE DR1, #5          ; Church numeral 5

LAMBDA CR1, DR1         ; Apply PRED:
                         ;   Removes one application of f
                         ;   f(f(f(f(f(x))))) -> f(f(f(f(x))))
; DR1 <- 4 (predecessor of 5)
; PRED(0) = 0 (Church numerals have no negatives)`,
        },
        'ADD': {
            'Apply': `; ADD.Apply — Church addition
LOAD   CR1, NS[22]      ; Load ADD GT [X]
DWRITE DR1, #3          ; First Church numeral
DWRITE DR2, #4          ; Second Church numeral

LAMBDA CR1, DR1         ; Apply ADD:
                         ;   ADD m n = apply SUCC m times to n
                         ;   3 + 4 = SUCC(SUCC(SUCC(4))) = 7
; DR1 <- 7`,
        },
        'SUB': {
            'Apply': `; SUB.Apply — Church subtraction
LOAD   CR1, NS[23]      ; Load SUB GT [X]
DWRITE DR1, #7
DWRITE DR2, #3

LAMBDA CR1, DR1         ; Apply SUB:
                         ;   SUB m n = apply PRED n times to m
                         ;   7 - 3 = PRED(PRED(PRED(7))) = 4
; DR1 <- 4
; SUB where n > m yields 0 (no negatives)`,
        },
        'MUL': {
            'Apply': `; MUL.Apply — Church multiplication
LOAD   CR1, NS[24]      ; Load MUL GT [X]
DWRITE DR1, #3
DWRITE DR2, #4

LAMBDA CR1, DR1         ; Apply MUL:
                         ;   MUL m n = compose m and n
                         ;   3 * 4 = apply (ADD 4) three times to 0
; DR1 <- 12`,
        },
        'ISZERO': {
            'Apply': `; ISZERO.Apply — Church zero test
LOAD   CR1, NS[25]      ; Load ISZERO GT [X]
DWRITE DR1, #0          ; Church numeral to test

LAMBDA CR1, DR1         ; Apply ISZERO:
                         ;   if numeral is 0 (no f applications):
                         ;     return TRUE (Church boolean)
                         ;   else:
                         ;     return FALSE
; DR1 <- TRUE (NS[26] GT) because input was 0`,
        },
        'PAIR': {
            'Apply': `; PAIR.Apply — Church pair constructor
LOAD   CR1, NS[43]      ; Load PAIR GT [X]
DWRITE DR1, #10         ; First element
DWRITE DR2, #20         ; Second element

LAMBDA CR1, DR1         ; Apply PAIR:
                         ;   Construct pair: \\f. f 10 20
                         ;   Extract first:  PAIR TRUE  -> 10
                         ;   Extract second: PAIR FALSE -> 20
; DR1 <- PAIR(10, 20) encoded as closure`,
        },
        'Family': {
            'Register': `; Family.Register — bind parent-child relationship
; The c-list IS the parental approval mechanism
LOAD   CR1, NS[28]      ; Load Family E-GT
LOAD   CR2, NS[50]      ; Parent GT (identifies parent)
LOAD   CR3, NS[51]      ; Child GT (identifies child)

CALL   CR1              ; Family.Register:
;   1. Verify CR2 is a valid parent GT (mLoad pipeline)
;   2. Verify CR3 is a valid child GT
;   3. Add parent GT to child's c-list (via Mint.Transfer)
;   4. Add child GT to parent's oversight c-list
;   5. Parent's c-list controls what child can access
; The c-list IS the parental control — not a filter,
; not a blocklist. The child can ONLY reach GTs in
; their c-list, and parent controls that c-list.`,
            'Hello': `; Family.Hello(target_GT) — greet any family member
; Mum is a GT, not a method name. Hello works with ANY GT.
LOAD   CR1, NS[28]      ; Load Family E-GT
LOAD   CR2, NS[50]      ; target_GT — could be:
                         ;   Mum's GT, Dad's GT, sibling's GT,
                         ;   teacher's GT, friend's GT...
                         ;   the GT carries the identity

CALL   CR1              ; Family.Hello(CR2):
;   1. mLoad validates target_GT (type, ver, seal, perms)
;   2. Verify target is in caller's c-list
;      (parent must have approved this contact)
;   3. Send greeting/request to target
;   4. Target receives via their own Family abstraction
; Hello(Mum_GT) sends to Mum
; Hello(Sibling_GT) sends to sibling
; Same method, different GT — that's capability security`,
            'Oversight': `; Family.Oversight — parent queries child activity
LOAD   CR1, NS[28]      ; Load Family E-GT
LOAD   CR2, NS[51]      ; Child GT

CALL   CR1              ; Family.Oversight:
;   1. Verify caller is parent (holds parent GT)
;   2. Read child's abstraction usage log
;   3. Report which GTs the child accessed
;   4. Report fault counts on child's blocks
; DR1 <- activity summary
; Parent can then Mint.Revoke any GT to restrict access`,
        },
        'Schoolroom': {
            'Join': `; Schoolroom.Join — student enters class
LOAD   CR1, NS[29]      ; Load Schoolroom E-GT
LOAD   CR2, NS[60]      ; Classroom GT (from student's c-list)
                         ;   Parent must have placed this GT there

CALL   CR1              ; Schoolroom.Join:
;   1. Verify classroom GT is valid (mLoad)
;   2. Verify student GT is in classroom's roster
;   3. Mint.Encode a session GT for this student
;   4. Add lesson materials GTs to student's c-list`,
            'Lesson': `; Schoolroom.Lesson — teacher posts lesson material
LOAD   CR1, NS[29]      ; Load Schoolroom E-GT
LOAD   CR2, NS[60]      ; Classroom GT
LOAD   CR3, NS[70]      ; Lesson content GT (DATA object)

CALL   CR1              ; Schoolroom.Lesson:
;   1. Verify teacher GT has authority over classroom
;   2. Memory.Allocate for lesson storage
;   3. Mint.Encode GT for lesson (X perm for students)
;   4. Mint.Transfer lesson GT to each student's c-list`,
            'Submit': `; Schoolroom.Submit — student submits work
LOAD   CR1, NS[29]      ; Load Schoolroom E-GT
LOAD   CR2, NS[71]      ; Work GT (student's DATA object)

CALL   CR1              ; Schoolroom.Submit:
;   1. Verify student is enrolled (has session GT)
;   2. Mint.Encode a read-only GT for the work
;   3. Mint.Transfer work GT to teacher's c-list
;   4. Student keeps their R+W copy, teacher gets R only`,
            'Grade': `; Schoolroom.Grade — teacher grades submitted work
LOAD   CR1, NS[29]      ; Load Schoolroom E-GT
LOAD   CR2, NS[71]      ; Work GT (teacher's read copy)
DWRITE DR1, #85         ; Grade: 85%

CALL   CR1              ; Schoolroom.Grade:
;   1. Verify teacher authority
;   2. Memory.Allocate for grade record
;   3. Mint.Encode grade GT, transfer to student's c-list
;   4. Student can LOAD the grade GT to see their score`,
        },
        'Friends': {
            'Request': `; Friends.Request — send friend request (parent-gated)
LOAD   CR1, NS[30]      ; Load Friends E-GT
LOAD   CR2, NS[52]      ; Target peer GT

CALL   CR1              ; Friends.Request:
;   1. Verify target is in caller's namespace
;   2. Create pending request (needs parent approval)
;   3. Negotiate.Propose for parent+peer-parent approval
;   4. Both parents must Negotiate.Approve before
;      any capability sharing is possible`,
            'Accept': `; Friends.Accept — accept friend request
LOAD   CR1, NS[30]      ; Load Friends E-GT
LOAD   CR2, NS[52]      ; Requester GT

CALL   CR1              ; Friends.Accept:
;   1. Verify pending request exists
;   2. Verify both parents have approved (Negotiate)
;   3. Mint.Encode shared-space GT for both friends
;   4. Transfer shared GT to both c-lists`,
            'Share': `; Friends.Share — share capability with friend
LOAD   CR1, NS[30]      ; Load Friends E-GT
LOAD   CR2, NS[52]      ; Friend GT
LOAD   CR3, NS[80]      ; GT to share (capability)

CALL   CR1              ; Friends.Share:
;   1. Verify friendship exists (both accepted)
;   2. TPERM: restrict shared GT permissions
;      (friend gets <= what sharer holds)
;   3. Mint.Transfer restricted GT to friend's c-list
;   4. Original GT unchanged in sharer's c-list`,
            'Revoke': `; Friends.Revoke — revoke shared capability
LOAD   CR1, NS[30]      ; Load Friends E-GT
LOAD   CR2, NS[80]      ; GT to revoke

CALL   CR1              ; Friends.Revoke:
;   1. Mint.Revoke: increment version on NS entry
;   2. All copies of this GT (in friend's c-list) die
;   3. Friend's next mLoad hits version mismatch -> FAULT`,
        },
        'Tunnel': {
            'Register': `; Tunnel.Register — identify this board to the IDE host
; Replaces the hardwired B:02½ CALL_HOME boot step.
; Sends the 23-byte call-home packet and awaits ACK.
;
; Packet layout (23 bytes):
;   [0xCE11(2B) · board_type(1B) · fw_version(1B) ·
;    HMAC-SHA256(4B) · UID(8B) ·
;    boot_reason(1B) · last_fault(1B) · fault_NIA(4B)]
;
; DR1 = boot_reason  (0=cold, 1=warm, 2=fault-recovery)
; DR2 = last_fault   (0 if no prior fault)
; DR3 = fault_NIA    (0 if no prior fault)
; DR0 ← 1 (IDE connected + ACK received) | 0 (offline)

LOAD   CR1, NS[31]       ; Load Tunnel E-GT (resident, layer 1)
DWRITE DR1, #0            ; boot_reason = 0 (cold boot)
DWRITE DR2, #0            ; last_fault  = 0 (none)
DWRITE DR3, #0x00000000   ; fault_NIA   = 0 (none)
CALL   CR1                ; Tunnel.Register:
;   1. Compose 23-byte packet from board ROM + DR args
;   2. Transmit over UART to IDE bridge
;   3. Await ACK frame within ≈500 ms timeout
;   4. If ACK: IDE confirms UID + HMAC valid → DR0 ← 1
;   5. If timeout: offline mode → DR0 ← 0, boot continues`,
            'Send': `; Tunnel.Send — push a self-identifying media packet to the IDE
; Every packet carries a 4-byte ASCII FourCC type tag so the
; receiver knows what it holds without out-of-band agreement.
; New tags are allocated without touching existing dispatch code.
;
; FourCC media tag registry (open — add tags as needed):
;   TEXT = 0x54455854  UTF-8 text, 4 bytes/word
;   VOIC = 0x564F4943  Voice audio, 4×8-bit PCM/word
;   LUMP = 0x4C554D50  Lump binary header or fragment
;   GTKN = 0x47544B4E  Golden Token (GT word + NS index)
;   JPEG = 0x4A504547  JPEG image fragment (future)
;   PDF_ = 0x50444620  PDF document fragment (future)
;
; DR1 = FourCC type tag
; DR2 = payload word count (1–13)
; DR3..DR(2+count) = payload words
; DR0 ← 0 = queued · 0x01 = TX buffer overrun

LOAD   CR1, NS[31]        ; Load Tunnel E-GT
DWRITE DR1, #0x54455854   ; Type tag: TEXT (0x54455854 = "TEXT")
DWRITE DR2, #3             ; 3 payload words
DWRITE DR3, #0x48656C6C   ; "Hell"
DWRITE DR4, #0x6F204D75   ; "o Mu"
DWRITE DR5, #0x6D000000   ; "m\0\0\0"
CALL   CR1                 ; Tunnel.Send:
;   1. Frame: [type_tag · word_count · DR3..DR5]
;   2. Transmit framed packet over UART
;   3. Fire-and-forget — no ACK required
; DR0 ← 0 = sent · 0x01 = overrun (drop this packet)`,
            'Receive': `; Tunnel.Receive — wait for a message from the IDE host
; Blocks the calling thread until data arrives or timeout.
; Navana calls this in its main event loop to receive
; upload commands, patch requests, and configuration data.
;
; DR1 = timeout in CPU steps (0 = wait forever)
; DR0 ← received word count (0 = timeout, no data)
; DR1 ← message type tag
; DR2..DR(n+1) ← payload words

LOAD   CR1, NS[31]        ; Load Tunnel E-GT
DWRITE DR1, #5000          ; Timeout: 5 000 steps
CALL   CR1                 ; Tunnel.Receive:
;   1. Poll UART RX for an incoming framed packet
;   2. On timeout: DR0 ← 0, RETURN
;   3. Read header → DR1 = type_tag, DR0 = word_count
;   4. Read up to 13 payload words into DR2..DR14
;   5. Caller dispatches on DR1 type_tag`,
            'Fault': `; Tunnel.Fault — report a fault with full semantic location
; High-priority: bypasses the normal send queue.
; Called by the fault handler before any recovery action.
; IDE logs the full location in the Devices view for this board.
;
; DR1 = fault_code   (e.g. 0x10=PERM, 0x42=RANGE, 0x80=VERSION)
; DR2 = ns_idx       — active namespace slot
; DR3 = thread_gt    — NS index of the faulting thread
; DR4 = abstr_idx    — NS slot of the executing abstraction
; DR5 = method_idx   — method index within the abstraction
; DR6 = instr_offset — instruction offset within the method

LOAD   CR1, NS[31]        ; Load Tunnel E-GT
DWRITE DR1, #0x42          ; Fault code: RANGE violation
DWRITE DR2, #0x0000        ; Namespace: NS[0] (boot namespace)
DWRITE DR3, #0x0001        ; Thread:    NS[1] (boot thread)
DWRITE DR4, #0x0013        ; Abstraction: NS[19] — Loader
DWRITE DR5, #0x0000        ; Method: 0 (Load)
DWRITE DR6, #0x0003        ; Instruction offset: 3
CALL   CR1                 ; Tunnel.Fault:
;   1. Compose fault packet: [0xFA17 · fault_code · ns_idx · thread_gt · abstr_idx · method_idx · instr_offset]
;   2. Transmit immediately (pre-empts TX queue — high priority)
;   3. IDE records full fault location in Devices view
;   4. Fire-and-forget — RETURN, caller handles recovery`,
            'Fetch': `; Tunnel.Fetch — request and receive a lump from the IDE
; Called by Loader when a NULL_CAP fault hits a cold slot.
; Validates the incoming lump (magic, size, CRC) before
; writing it to memory and updating the NS entry.
;
; CR2 = Memory W-GT (write-perm buffer ≥ expected_words)
; DR1 = NS slot token (index of requested abstraction)
; DR2 = expected lump size in words
; DR0 ← 0 = installed · non-zero = error code

LOAD   CR1, NS[31]        ; Load Tunnel E-GT
LOAD   CR2, NS[7]          ; Load Memory W-GT (write destination)
DWRITE DR1, #0x0025        ; Token: NS[37] — Browser abstraction
DWRITE DR2, #64             ; Expected: 64 words (one slot)
CALL   CR1                  ; Tunnel.Fetch:
;   1. Transmit fetch request: [0xFE7C · token · expected_words]
;   2. Await IDE response: lump header + data words (≤500 ms)
;   3. Validate: magic=0x1F · size=DR2 · CRC-16 over all words
;   4. Write validated words to CR2 base via mSave (W-perm)
;   5. Update NS entry: base, limit, version, seal
; DR0 ← 0 = lump installed · non-zero = error (timeout/CRC/size)`,
            'Connect': `; Tunnel.Connect — forward a CALL through the tunnel to a remote capability
; The "Hello Mum" primitive: the caller presents a remote GT and
; Tunnel encodes it as a GTKN packet, transmits it, then blocks
; awaiting the far-end RETURN.  From the caller's view this is one
; Church instruction — apply an abstraction and receive a result.
;
; CALL(CONNECT(me, mymother)):
;   1. me       = CR8 (Inform GT — the caller's thread GT)
;   2. mymother = CR2 (Outform GT — remote service, F-bit set)
;   3. Tunnel   = CR1 (E-GT — the tunnel itself is the channel)
;
; CR2 = remote GT (Outform type, F-bit set in NS word1[30])
; DR0 ← far-end return value · non-zero on error / timeout

LOAD   CR1, NS[31]        ; Load Tunnel E-GT
LOAD   CR2, NS[55]        ; Load remote GT (mymother — F-bit=1)
CALL   CR1                 ; Tunnel.Call:
;   1. Read CR2 GT word and NS index
;   2. Compose GTKN packet: [0x47544B4E · GT_word · ns_idx]
;   3. Transmit over UART to IDE bridge
;   4. IDE routes to far-end namespace via F-bit tunnel
;   5. Far-end CALL executes; RETURN value relayed back
;   6. DR0 ← far-end DR0 return value`,
        },
        'Negotiate': {
            'Propose': `; Negotiate.Propose — request special grant
; Dual-approval: parent AND teacher must both approve
LOAD   CR1, NS[32]      ; Load Negotiate E-GT
LOAD   CR2, NS[80]      ; Requested capability GT

CALL   CR1              ; Negotiate.Propose:
;   1. Create proposal record (Memory.Allocate)
;   2. Mint.Encode proposal GT for parent
;   3. Mint.Encode proposal GT for teacher
;   4. Both must Negotiate.Approve before grant
; DR1 <- proposal ID`,
            'Approve': `; Negotiate.Approve — parent or teacher approves
LOAD   CR1, NS[32]      ; Load Negotiate E-GT
DWRITE DR1, #1          ; Proposal ID

CALL   CR1              ; Negotiate.Approve:
;   1. Verify caller is authorized approver
;   2. Record approval (parent or teacher)
;   3. If BOTH have approved:
;      a. Mint.Encode the requested GT
;      b. Mint.Transfer to child's c-list
;      c. Log grant for audit trail
;   4. If only one approved: wait for other`,
            'Reject': `; Negotiate.Reject — reject proposal
LOAD   CR1, NS[32]      ; Load Negotiate E-GT
DWRITE DR1, #1          ; Proposal ID

CALL   CR1              ; Negotiate.Reject:
;   1. Mark proposal as rejected
;   2. Mint.Revoke proposal GTs
;   3. Notify other approver of rejection`,
            'Status': `; Negotiate.Status — check proposal state
LOAD   CR1, NS[32]      ; Load Negotiate E-GT
DWRITE DR1, #1          ; Proposal ID

CALL   CR1              ; Negotiate.Status:
; DR1 <- status: 0=pending, 1=parent_ok,
;   2=teacher_ok, 3=both_approved, 4=rejected`,
        },
        'Editor': {
            'Open': `; Editor.Open — open source file from namespace
LOAD   CR1, NS[33]      ; Load Editor E-GT
LOAD   CR2, NS[80]      ; File GT (DATA-domain object, R+W)
                         ;   mLoad validates R perm for reading

CALL   CR1              ; Editor.Open:
;   1. mLoad CR2 (validates type, ver, seal, R perm)
;   2. DREAD file contents from location (word0)
;      up to limit (word1[16:0]) bytes
;   3. Load into editor buffer
;   4. File is a DATA object — Turing domain (R+W)`,
            'Save': `; Editor.Save — save source to namespace
LOAD   CR1, NS[33]      ; Load Editor E-GT

CALL   CR1              ; Editor.Save:
;   1. Get editor buffer contents
;   2. If no existing slot: Memory.Allocate new DATA slot
;   3. DWRITE buffer to mem[location] (W perm required)
;   4. Recompute seal: CRC-16(word0, word1) for integrity
;   5. Update word2 = (gt_seq << 25) | newCRC`,
            'Load': `; Editor.Load — load source from NS slot into editor
LOAD   CR1, NS[33]      ; Load Editor E-GT
DWRITE DR1, #80         ; NS slot containing source

CALL   CR1              ; Editor.Load:
;   1. LOAD GT for NS[80] (needs L perm in c-list)
;   2. mLoad validates: type, ver, seal, bounds
;   3. DREAD contents into editor buffer
;   4. Source is DATA domain — code is never Church domain`,
            'Undo': `; Editor.Undo — undo last edit
LOAD   CR1, NS[33]      ; Load Editor E-GT

CALL   CR1              ; Editor.Undo:
;   1. Pop previous state from undo stack
;   2. Restore editor buffer
;   3. Stack managed via Stack abstraction internally`,
        },
        'Assembler': {
            'Assemble': `; Assembler.Assemble — source to machine code
; Output is a DATA-domain object (code is DATA, not Church)
LOAD   CR1, NS[34]      ; Load Assembler E-GT
LOAD   CR2, NS[80]      ; Source GT (DATA object, R perm)

CALL   CR1              ; Assembler.Assemble:
;   1. DREAD source text from CR2's location
;   2. Parse assembly mnemonics
;   3. Encode each instruction as 32-bit word:
;      opcode(5)|cond(4)|dst(4)|src(4)|imm(15)
;   4. Memory.Allocate for output binary (new DATA slot)
;   5. DWRITE binary to new slot
;   6. Mint.Encode GT for binary (R+X perms)
;      Code is a DATA-domain object with X permission
; CR2 <- binary GT (DATA domain, X perm for execution)`,
            'Disassemble': `; Assembler.Disassemble — binary to assembly text
LOAD   CR1, NS[34]      ; Load Assembler E-GT
LOAD   CR2, NS[81]      ; Binary GT (DATA object, X perm)

CALL   CR1              ; Assembler.Disassemble:
;   1. DREAD binary words from CR2's location
;   2. Decode each 32-bit instruction:
;      opcode(5)|cond(4)|dst(4)|src(4)|imm(15)
;   3. Generate assembly text
;   4. Memory.Allocate for output text
;   5. Mint.Encode GT for text (R+W perms)
; CR2 <- source text GT`,
            'Validate': `; Assembler.Validate — check code validity
LOAD   CR1, NS[34]      ; Load Assembler E-GT
LOAD   CR2, NS[80]      ; Source GT

CALL   CR1              ; Assembler.Validate:
;   1. Parse source for syntax errors
;   2. Check register references (CR0-15, DR0-15)
;   3. Verify condition codes (EQ,NE,CS,CC,MI,PL,...)
;   4. Check opcode encoding fits 5-bit field
; DR1 <- 1 if valid, 0 if errors found
; DR2 <- error count`,
        },
        'Debugger': {
            'Step': `; Debugger.Step — single-step one instruction
LOAD   CR1, NS[35]      ; Load Debugger E-GT

CALL   CR1              ; Debugger.Step:
;   1. Fetch instruction at current PC
;   2. Decode: opcode(5)|cond(4)|dst(4)|src(4)|imm(15)
;   3. Evaluate condition code against flags (N,Z,C,V)
;   4. If condition met: execute instruction
;   5. If LOAD/CALL: run full mLoad 7-step pipeline
;   6. Update PC, flags, step counter
;   7. Return state snapshot to IDE`,
            'Run': `; Debugger.Run — run until halt or breakpoint
LOAD   CR1, NS[35]      ; Load Debugger E-GT

CALL   CR1              ; Debugger.Run:
;   1. Loop: fetch-decode-execute
;   2. Check breakpoint list each cycle
;   3. If PC matches breakpoint: halt, report
;   4. If FAULT: halt, report fault type and PC
;   5. Max steps limit prevents infinite loops`,
            'Breakpoint': `; Debugger.Breakpoint — set/clear breakpoint
LOAD   CR1, NS[35]      ; Load Debugger E-GT
DWRITE DR1, #0x0040     ; Address to break at

CALL   CR1              ; Debugger.Breakpoint:
;   1. If address already has breakpoint: clear it
;   2. If no breakpoint: set one at DR1
;   3. Breakpoints stored in debugger's DATA slot`,
            'Inspect': `; Debugger.Inspect — inspect register or memory
LOAD   CR1, NS[35]      ; Load Debugger E-GT
DWRITE DR1, #0x0100     ; Memory address to inspect

CALL   CR1              ; Debugger.Inspect:
;   1. If address is in NS table range (>= 0xFD00):
;      read NS entry (3 words), decode fields
;   2. If address is in data memory:
;      DREAD the word at that address
;   3. Return decoded view (GT fields, NS entry fields)
; DR1 <- value at inspected address`,
        },
        'Deployer': (function() {
            const b = getSelectedBoard();
            const isTi60 = b === 'ti60-f225';
            const chip     = isTi60 ? 'Efinix Ti60F225' : 'Gowin GW2AR-18';
            const brdName  = isTi60 ? 'Ti60 F225' : 'Tang Nano 20K';
            const uartNote = isTi60 ? ';   3. UART via FTDI FT232H USB bridge (50MHz clock)' : ';   3. UART TX on pin 69 -> BL616 USB bridge';
            const clkNote  = isTi60 ? ';   5. 50MHz clock begins instruction execution' : ';   5. 27MHz clock begins instruction execution';
            const bootLine = isTi60 ? `;   2. ${brdName} begins executing from boot vector` : `;   2. ${brdName} begins executing from boot vector`;
            return {
                'Build': `; Deployer.Build — compile binary for ${brdName}\nLOAD   CR1, NS[36]      ; Load Deployer E-GT\nLOAD   CR2, NS[81]      ; Binary GT (DATA object)\n\nCALL   CR1              ; Deployer.Build:\n;   1. DREAD binary from CR2's location\n;   2. Add boot vector and NS table initialization\n;   3. Package for FPGA: ${chip} bitstream\n;   4. Memory.Allocate for deployment image\n;   5. Mint.Encode GT for image\n; CR2 <- deployment image GT`,
                'Upload': `; Deployer.Upload — send to ${brdName} via UART\nLOAD   CR1, NS[36]      ; Load Deployer E-GT\n\nCALL   CR1              ; Deployer.Upload:\n;   1. LOAD UART GT from c-list (NS[11])\n;   2. For each word in deployment image:\n;      SAVE word to UART (S perm on UART GT)\n${uartNote}\n;   4. Wait for ACK after each block`,
                'Verify': `; Deployer.Verify — verify upload integrity\nLOAD   CR1, NS[36]      ; Load Deployer E-GT\n\nCALL   CR1              ; Deployer.Verify:\n;   1. Request readback from ${brdName} via UART\n;   2. LOAD bytes from UART (L perm)\n;   3. Compare against original image\n;   4. Compute checksum match\n; DR1 <- 1 if verified, 0 if mismatch`,
                'Boot': `; Deployer.Boot — boot the FPGA\nLOAD   CR1, NS[36]      ; Load Deployer E-GT\n\nCALL   CR1              ; Deployer.Boot:\n;   1. Send boot command via UART\n${bootLine}\n;   3. FPGA initializes NS table (slots 0-45)\n;   4. Boot -> Salvation -> Navana (same as simulator)\n${clkNote}`,
            };
        })(),
        'Browser': {
            'Navigate': `; Browser.Navigate — go to GT-addressed site
; No URLs, no DNS — only capability-addressed resources
LOAD   CR1, NS[37]      ; Load Browser E-GT [L,E]
LOAD   CR2, NS[90]      ; Site GT from child's c-list
                         ;   Parent placed this GT in the c-list
                         ;   Child can ONLY reach sites in c-list

CALL   CR1              ; Browser.Navigate:
;   1. mLoad validates site GT (type, ver, seal, L perm)
;   2. If F-bit=1: route through Tunnel (encrypted)
;   3. LOAD page content via L perm on site GT
;   4. Render content in display
; No ambient authority — no way to reach unlisted sites`,
            'Back': `; Browser.Back — navigate back
LOAD   CR1, NS[37]      ; Load Browser E-GT
CALL   CR1              ; Pop previous site GT from history stack`,
            'Bookmark': `; Browser.Bookmark — save GT bookmark to c-list
LOAD   CR1, NS[37]      ; Load Browser E-GT
LOAD   CR2, NS[90]      ; Site GT to bookmark

CALL   CR1              ; Browser.Bookmark:
;   1. Verify GT is valid (mLoad)
;   2. SAVE GT to bookmark c-list (S perm)
;   3. Bookmark is just a GT in the c-list`,
            'Search': `; Browser.Search — search within GT scope
LOAD   CR1, NS[37]      ; Load Browser E-GT [L,E]
LOAD   CR2, NS[91]      ; Search scope GT (e.g. library site)

CALL   CR1              ; Browser.Search:
;   1. LOAD search index via L perm on scope GT
;   2. Results are GTs in the scope's c-list
;   3. Child can only see results parent approved`,
        },
        'Messenger': {
            'Send': `; Messenger.Send — send message to approved contact
LOAD   CR1, NS[38]      ; Load Messenger E-GT [L,E]
LOAD   CR2, NS[50]      ; Recipient GT (must be in c-list)
LOAD   CR3, NS[85]      ; Message content GT (DATA object)

CALL   CR1              ; Messenger.Send:
;   1. Verify recipient GT is in caller's c-list
;      (parent must have approved this contact)
;   2. If F-bit=1: route via Tunnel (encrypted)
;   3. SAVE message to recipient's inbox c-list
;   4. Signal recipient via DijkstraFlag`,
            'Receive': `; Messenger.Receive — read incoming message
LOAD   CR1, NS[38]      ; Load Messenger E-GT [L,E]

CALL   CR1              ; Messenger.Receive:
;   1. LOAD from inbox c-list (L perm)
;   2. Dequeue oldest message GT
;   3. If no messages: Scheduler.Wait on inbox event
; CR2 <- message content GT (DATA object)`,
            'Contacts': `; Messenger.Contacts — list parent-approved contacts
LOAD   CR1, NS[38]      ; Load Messenger E-GT [L,E]

CALL   CR1              ; Messenger.Contacts:
;   1. Walk the contact c-list
;   2. Each contact is a GT placed by parent
;   3. Return count and list of valid GTs
; DR1 <- number of approved contacts`,
            'Block': `; Messenger.Block — block a contact
LOAD   CR1, NS[38]      ; Load Messenger E-GT
LOAD   CR2, NS[52]      ; Contact GT to block

CALL   CR1              ; Messenger.Block:
;   1. Mint.Revoke the contact GT (version bump)
;   2. Contact can no longer send messages
;   3. Parent notified via Family.Oversight`,
        },
        'Photos': {
            'View': `; Photos.View — view a photo
LOAD   CR1, NS[39]      ; Load Photos E-GT [L,E]
LOAD   CR2, NS[85]      ; Photo GT (DATA object)

CALL   CR1              ; Photos.View:
;   1. mLoad validates photo GT (type, ver, seal, L perm)
;   2. DREAD photo data from location (word0)
;   3. Render on Display (via Display.Write with S perm)`,
            'Share': `; Photos.Share — share photo with GT
LOAD   CR1, NS[39]      ; Load Photos E-GT
LOAD   CR2, NS[85]      ; Photo GT
LOAD   CR3, NS[50]      ; Recipient GT

CALL   CR1              ; Photos.Share:
;   1. TPERM: create read-only copy of photo GT (L only)
;   2. Mint.Transfer restricted GT to recipient's c-list
;   3. Recipient can View but not modify`,
            'Upload': `; Photos.Upload — upload new photo
LOAD   CR1, NS[39]      ; Load Photos E-GT
LOAD   CR2, NS[86]      ; Photo data GT (DATA object, R+W)

CALL   CR1              ; Photos.Upload:
;   1. Memory.Allocate for photo storage
;   2. DWRITE photo data to new slot
;   3. Mint.Encode GT with L perm (view-only)
;   4. Compute seal for integrity verification`,
            'Album': `; Photos.Album — manage photo album
LOAD   CR1, NS[39]      ; Load Photos E-GT

CALL   CR1              ; Photos.Album:
;   1. Walk album c-list (each entry is a photo GT)
;   2. Return count and metadata
; DR1 <- album entry count`,
        },
        'Social': {
            'Post': `; Social.Post — post content to feed
LOAD   CR1, NS[40]      ; Load Social E-GT [L,E]
LOAD   CR2, NS[85]      ; Content GT (DATA object)

CALL   CR1              ; Social.Post:
;   1. Memory.Allocate for post storage
;   2. DWRITE content to new slot
;   3. Mint.Encode GT for post (L perm for followers)
;   4. Distribute post GT to followers' feed c-lists`,
            'Read': `; Social.Read — read feed
LOAD   CR1, NS[40]      ; Load Social E-GT [L,E]

CALL   CR1              ; Social.Read:
;   1. Walk feed c-list (each entry is a post GT)
;   2. LOAD post content via L perm on each GT
; CR2 <- next feed entry GT`,
            'Follow': `; Social.Follow — follow an account
LOAD   CR1, NS[40]      ; Load Social E-GT
LOAD   CR2, NS[55]      ; Account GT (must be in c-list)

CALL   CR1              ; Social.Follow:
;   1. Verify account GT is parent-approved
;   2. Request follow via Negotiate (if needed)
;   3. Account's posts will appear in feed c-list`,
            'Feed': `; Social.Feed — get feed items
LOAD   CR1, NS[40]      ; Load Social E-GT

CALL   CR1              ; Social.Feed:
;   1. Count entries in feed c-list
; DR1 <- number of feed items available`,
        },
        'Video': {
            'Watch': `; Video.Watch — play a video
LOAD   CR1, NS[41]      ; Load Video E-GT [L,E]
LOAD   CR2, NS[85]      ; Video GT (DATA object)

CALL   CR1              ; Video.Watch:
;   1. mLoad validates video GT (L perm required)
;   2. DREAD video data from location
;   3. If F-bit=1: stream via Tunnel (encrypted)
;   4. Render on Display via S perm`,
            'Search': `; Video.Search — search videos within GT scope
LOAD   CR1, NS[41]      ; Load Video E-GT
LOAD   CR2, NS[91]      ; Search scope GT (library/channel)

CALL   CR1              ; Video.Search:
;   1. LOAD search index via L perm on scope GT
;   2. Results filtered to parent-approved GTs only
;   3. Results placed in caller's c-list`,
            'Playlist': `; Video.Playlist — manage playlist
LOAD   CR1, NS[41]      ; Load Video E-GT

CALL   CR1              ; Video.Playlist:
;   1. Walk playlist c-list
;   2. Each entry is a video GT
; DR1 <- playlist length`,
            'Share': `; Video.Share — share video GT
LOAD   CR1, NS[41]      ; Load Video E-GT
LOAD   CR2, NS[85]      ; Video GT
LOAD   CR3, NS[50]      ; Recipient GT

CALL   CR1              ; Video.Share:
;   1. TPERM: restrict to L-only (view but not copy)
;   2. Mint.Transfer to recipient's c-list`,
        },
        'Email': {
            'Compose': `; Email.Compose — compose and send email
LOAD   CR1, NS[42]      ; Load Email E-GT [L,E]
LOAD   CR2, NS[50]      ; Recipient GT (must be in contacts c-list)
LOAD   CR3, NS[85]      ; Body GT (DATA object)

CALL   CR1              ; Email.Compose:
;   1. Verify recipient GT in contacts c-list
;   2. Memory.Allocate for email storage
;   3. DWRITE body to new slot
;   4. Mint.Encode email GT
;   5. If F-bit=1: route via Tunnel (encrypted)
;   6. SAVE to recipient's inbox c-list`,
            'Read': `; Email.Read — read incoming email
LOAD   CR1, NS[42]      ; Load Email E-GT [L,E]

CALL   CR1              ; Email.Read:
;   1. LOAD from inbox c-list (L perm)
;   2. Dequeue oldest email GT
;   3. DREAD email body from GT's location
; CR2 <- email content GT`,
            'Reply': `; Email.Reply — reply to an email
LOAD   CR1, NS[42]      ; Load Email E-GT
LOAD   CR2, NS[86]      ; Original email GT (for thread)
LOAD   CR3, NS[85]      ; Reply body GT (DATA object)

CALL   CR1              ; Email.Reply:
;   1. Extract sender GT from original email
;   2. Verify sender is still in contacts c-list
;   3. Memory.Allocate for reply
;   4. Link reply to original (thread chain via GTs)
;   5. Send via same path as Compose`,
            'Contacts': `; Email.Contacts — list email contacts
LOAD   CR1, NS[42]      ; Load Email E-GT

CALL   CR1              ; Email.Contacts:
;   1. Walk email contacts c-list
;   2. Each contact is a GT placed by parent
; DR1 <- number of email contacts`,
        },
        'GC': {
            'Scan': `; GC.Scan — mark live entries via G-bit
; PP250 deterministic GC with bidirectional G-bit
; G-bit in word1[29] of each NS entry
LOAD   CR1, NS[44]      ; Load GC E-GT

CALL   CR1              ; GC.Scan:
;   1. Walk all 16 CRs (CR0-CR15):
;      for each valid CR with a GT:
;        extract index from GT bits [24:8]
;        read NS[index].word1
;        set G-bit (word1[29] = current polarity)
;   2. Walk all c-list entries reachable from CRs:
;      for each GT in c-list:
;        set G-bit on referenced NS entry
;   3. Any entry NOT marked is garbage
; mLoad step 7 also resets G-bit on every access`,
            'Identify': `; GC.Identify — find garbage entries
LOAD   CR1, NS[44]      ; Load GC E-GT

CALL   CR1              ; GC.Identify:
;   1. Scan NS table (slots 46..nsCount):
;      read word1[29] (G-bit) for each entry
;      if G-bit != current polarity: entry is garbage
;   2. Build garbage list
; DR1 <- number of garbage entries found
; Skip boot slots 0-45 (always live)`,
            'Clear': `; GC.Clear — zero garbage memory
LOAD   CR1, NS[44]      ; Load GC E-GT

CALL   CR1              ; GC.Clear:
;   1. For each garbage entry from Identify:
;      zero word0 (location = 0)
;      zero word1 (limit/flags = 0)
;      preserve word2 (version stays for stale GT detection)
;   2. Memory at old locations now free
;   3. Slots available for Memory.Allocate reuse
; DR1 <- number of entries cleared`,
            'Flip': `; GC.Flip — invert GC polarity
LOAD   CR1, NS[44]      ; Load GC E-GT

CALL   CR1              ; GC.Flip:
;   1. Toggle polarity flag (0 -> 1 or 1 -> 0)
;   2. After flip, ALL entries appear as garbage
;      until next Scan marks live ones
;   3. This enables the bidirectional GC cycle:
;      Scan(polarity=0) -> Identify -> Clear
;      Flip
;      Scan(polarity=1) -> Identify -> Clear
;      Flip ... (repeat)`,
        },
        'Thread': {
            'switchTo': `; Thread.switchTo(thread_GT) — context switch to target thread
; CR0 holds Thread GT with E perm (obtained from Scheduler c-list)
TPERM  CR0, E           ; verify E perm on thread GT
CHANGE AL, CR0, CR0, #0 ; CHANGE: save calling thread context into
                         ;   its lump (DR0-15, PC, FLAGS, STO, CR12,
                         ;   CR14, CR15), then restore target thread
                         ;   context from its lump and resume at
                         ;   saved PC. CR0 indexes the thread c-list.
; After CHANGE: execution continues in the target thread`,
            'Kill': `; Thread.Kill(thread_GT) — terminate target thread
; CR1 holds target Thread GT (E perm)
TPERM  CR1, E           ; verify E perm — must hold thread GT
CALL   CR_mem, #Free    ; Memory.Free(thread_GT.lumpBase) —
                         ;   release thread lump back to allocator
CALL   CR_mint, #Revoke ; Mint.Revoke(thread_GT) —
                         ;   increment gt_seq in NS entry;
                         ;   all live copies of the GT instantly
                         ;   become version-mismatched (dead)
; Thread is now fully terminated: lump freed, GT revoked`,
            'Compile': `; Thread.Compile(f_GT) — create a new thread, f is the start abstraction
; CR1 holds f_GT (E perm) — the initial abstraction to run
TPERM  CR1, E           ; verify E perm on start abstraction
CALL   CR_mem, #Alloc   ; Memory.Allocate(lumpSize) ->
                         ;   lump: [GT zone 12w][LIFO stack][heap][DR 16w]
CALL   CR_mint, #Encode ; Mint.Encode(Inform, lumpSize, perms=0) ->
                         ;   CR12 of new thread (zero-perm Inform GT)
                         ;   word0_location = lump base
                         ;   word0_limit    = lumpSize - 1
DWRITE DR1, lump[0]     ; store f_GT into new thread's GT zone word 0
                         ;   (CR0 of the new thread = first-call slot)
; Returns: new Thread GT — call Thread.switchTo to begin execution`,
        },
        'Boot.Thread': {
            'run': `; Boot.Thread.run — B:02 INIT_THRD boot step (Slot 1)
; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
; This method IS the thread — it has no entry point.
; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

B:02  INIT_THRD
      GT12 ← createGT(Slot=1, perms=[none], type=Inform)
      entry ← mLoad(GT12)       ; load NS entry for Slot 1
      CR12 ← { word0=GT12, word1=entry.base,
               word2=entry.word1_limit, word3=entry.seals }
      ; CR12 = Thread stack — Priv zone, zero perms
      ; Informs-only: cannot be used for direct CALL  ◄── see below

; ── What does the last line mean? ─────────────────
;
; CR12 holds an Inform GT: perms=[none] means no E-bit.
; In the Church Machine, CALL requires E perm on the GT
; in CR6. CR12 holds the thread stack capability,
; not an *entry point*. It is an Inform — zero perms —
; and also encodes the thread lump bounds for stack checks.
;
; The thread does NOT run by being invoked.
; It runs because it IS the hardware execution context:
;   - The STEP controller advances PC each cycle through
;     the thread's code lump, unconditionally.
;   - No CALL instruction is needed; the thread simply is.
;
; To switch threads: Thread.switchTo(thread_GT)
;   — that requires E perm on the *Thread GT* (not CR12),
;     and uses CHANGE to save/restore full register state.
;
; An Inform is a capability with zero permissions.
; It can be passed, stored, and compared, but never used
; to invoke computation. The thread stack tells the
; hardware where the thread lump lives — and encodes lump bounds.`,
        },
    };
    const base = Object.assign({}, examples[abs.name] || {});
    for (const m of abs.methods) {
        const key = `${abs.index}:${m}`;
        if (userMethodData[key] && userMethodData[key].example) {
            base[m] = userMethodData[key].example;
        }
    }
    return base;
}

// ── _ABSTRACTION_CONVENTIONS ───────────────────────────────────────────────
// Bare-call method conventions for abstractions defined in the Reference view.
// Register assignments are derived from the assembly snippets above.
// Format: { AbsName: { MethodName: { index: N, input: '...', output: '...' } } }
// index — 0-based method selector (ELOADCALL stores index+1 in imm[14:8]).
// input — ordered CR/DR register specs parsed by ChurchAssembler bare-call
//         expansion; pattern \b(CR|DR)(\d+)= drives the arg → register mapping.
// output — informational only (not parsed by the assembler).
//
// Method order matches _methodDocs insertion order (which reflects the
// abstraction's compiled method table).
const _ABSTRACTION_CONVENTIONS = {
    'Scheduler': {
        'Yield':  { index: 0, input: '',                        output: 'DR1' },
        'Spawn':  { index: 1, input: 'CR2=code_GT, DR1=entry',  output: 'DR1=threadID' },
        'Wait':   { index: 2, input: 'CR2=flag_GT',             output: 'DR1' },
        'Stop':   { index: 3, input: 'DR1=threadID',            output: 'DR1' },
        'pause':  { index: 4, input: 'DR1=ticks',               output: 'DR1' },
    },
    'DijkstraFlag': {
        'Wait':   { index: 0, input: '',  output: 'DR1' },
        'Signal': { index: 1, input: '',  output: 'DR1' },
        'Reset':  { index: 2, input: '',  output: 'DR1' },
        'Test':   { index: 3, input: '',  output: 'DR1=1 signaled | 0 unsignaled' },
    },
    'Button': {
        'Read':      { index: 0, input: '',  output: 'DR1=1 pressed | 0 released' },
        'WaitPress': { index: 1, input: '',  output: 'DR1=1 pressed' },
        'OnEvent':   { index: 2, input: '',  output: 'DR1=1 press | 2 release | 0 none' },
    },
    'Timer': {
        'Start':    { index: 0, input: 'DR1=channel',  output: 'DR1' },
        'Stop':     { index: 1, input: 'DR1=channel',  output: 'DR1' },
        'Read':     { index: 2, input: '',             output: 'DR1=elapsed ticks' },
        'SetAlarm': { index: 3, input: 'DR1=ticks',    output: 'DR1' },
    },
    'Stack': {
        'Push':  { index: 0, input: 'DR1=val',   output: 'DR1=0 ok | -1 overflow' },
        'Pop':   { index: 1, input: '',           output: 'DR1=popped value | fault on underflow' },
        'Peek':  { index: 2, input: '',           output: 'DR1=top value (stack unchanged)' },
        'Depth': { index: 3, input: '',           output: 'DR1=current depth' },
    },
    'UART': {
        'Send':    { index: 0, input: 'DR1=byte', output: 'S-perm SAVE; byte queued for TX' },
        'Receive': { index: 1, input: '',         output: 'L-perm LOAD; DR1=received byte | 0 if empty' },
        'SetBaud': { index: 2, input: 'DR1=rate', output: 'DR1=0 ok | -1 unsupported rate' },
    },
    'LED': {
        'Set':    { index: 0, input: '',  output: 'DR1=1 ok | -1 fault' },
        'Clear':  { index: 1, input: '',  output: 'DR1=1 ok | -1 fault' },
        'Toggle': { index: 2, input: '',  output: 'DR1=1 ok | -1 fault' },
        'State':  { index: 3, input: '',  output: 'DR1=1 on | 0 off | -1 fault' },
    },
    'Display': {
        'Write':  { index: 0, input: 'DR1=char',  output: 'char appears at cursor; cursor advances' },
        'Clear':  { index: 1, input: '',          output: 'screen cleared, cursor reset to (0,0)' },
        'Scroll': { index: 2, input: 'DR1=lines', output: 'display scrolled up N lines' },
    },
    'Memory': {
        'Allocate': { index: 0, input: 'CR2=pool_GT, DR1=size', output: 'CR2=mem_GT' },
        'Free':     { index: 1, input: 'CR2=mem_GT',            output: 'DR1' },
        'Resize':   { index: 2, input: 'CR2=mem_GT, DR1=size',  output: 'DR1' },
    },
    'Mint': {
        'Encode':   { index: 0, input: 'CR2=mem_GT, DR1=base, DR2=exp, DR3=permsBits', output: 'DR1=GT_word' },
        'Revoke':   { index: 1, input: 'DR1=nsIndex',                                  output: 'DR1' },
        'Transfer': { index: 2, input: 'CR2=target_GT, DR1=slot',                      output: 'DR1' },
    },
    'Tunnel': {
        'Register': { index: 0, input: 'DR1=boot_reason, DR2=last_fault, DR3=fault_NIA',                                                                  output: 'DR0=1 (IDE ACK) | \u22640 (offline)' },
        'Send':     { index: 1, input: 'DR1=FourCC tag, DR2=word count, DR3=first payload',                                                                output: 'DR0=0 (queued) | 1 (TX overrun)' },
        'Receive':  { index: 2, input: 'DR1=timeout steps (0=forever)',                                                                                    output: 'DR0=word count (0=timeout), DR1=FourCC tag, DR2\u2026=payload' },
        'Fault':    { index: 3, input: 'DR1=fault_code, DR2=ns_idx, DR3=thread_gt, DR4=abstr_idx, DR5=method_idx, DR6=instr_offset',                       output: 'none (fire-and-forget)' },
        'Fetch':    { index: 4, input: 'DR1=slot token, DR2=expected words, CR2=write-GT',                                                                 output: 'DR0=0 (installed) | error code' },
        'Connect':  { index: 5, input: 'CR2=remote GT (Outform/far-end abstraction)',                                                                       output: 'DR0=far-end return value' },
    },
};

// Register conventions class-wide so all ChurchAssembler instances created
// anywhere in the app (compile, test, decompile paths) inherit them without
// a page reload.  Guard against the script loading before assembler.js in
// unusual environments (e.g. unit-test harnesses that load files out of order).
if (typeof ChurchAssembler !== 'undefined') {
    ChurchAssembler.setSharedMethodConventions(_ABSTRACTION_CONVENTIONS);
}

function _absCopyCall(absName, methodName, btnEl) {
    const text = `CALL ${absName}.${methodName}`;
    const _flash = (el, msg) => {
        if (!el) return;
        const orig = el.textContent;
        el.textContent = msg;
        setTimeout(() => { if (el) el.textContent = orig; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            _flash(btnEl, 'copied!');
        }).catch(() => {
            _absCopyCallFallback(text);
            _flash(btnEl, 'copied!');
        });
    } else {
        _absCopyCallFallback(text);
        _flash(btnEl, 'copied!');
    }
}

function _absCopyCallFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
}

