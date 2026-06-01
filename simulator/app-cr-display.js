function updateCRDisplay() {
    if (!sim) return;
    const container = document.getElementById('crRegs');
    if (!container) return;
    const localNames = {
        0: 'Result', 1: 'Arg 1', 5: 'Heap', 6: 'C-List',
        12: 'Thread', 13: 'IRQ', 14: 'CLOOMC', 15: 'Namespace'
    };
    const crMeta = {
        0:  { group: 'gt',     role: 'arch',   badge: 'Arch'   },
        1:  { group: 'gt',     role: 'arch',   badge: 'Arch'   },
        2:  { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        3:  { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        4:  { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        5:  { group: 'gt',     role: 'arch',   badge: 'Arch'   },
        6:  { group: 'gt',     role: 'arch',   badge: 'Arch'   },
        7:  { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        8:  { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        9:  { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        10: { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        11: { group: 'gt',     role: 'prog',   badge: 'Prog'   },
        12: { group: 'privil', role: 'privil', badge: 'Priv'   },
        13: { group: 'system', role: 'system', badge: 'System' },
        14: { group: 'privil', role: 'privil', badge: 'Priv'   },
        15: { group: 'privil', role: 'privil', badge: 'Priv'   },
    };
    const COLS = 14;
    let html = '<table class="cr-table"><thead><tr>';
    html += '<th>CR</th><th>M</th><th>Name</th><th>Role</th>';
    html += '<th>R0: GT</th><th>Perms</th><th>Seq</th><th>Idx</th><th>Type</th>';
    html += '<th>R1: Location</th>';
    html += '<th>R0:B</th><th>F</th><th>Limit[16:0]</th>';
    html += '<th>R3: Seq</th><th>CRC Seal</th>';
    html += '</tr></thead><tbody>';
    for (let i = 0; i < 16; i++) {
        if (i === 12) {
            html += `<tr class="cr-separator"><td colspan="${COLS + 1}">&#9472;&#9472; Not in GT zone &#9472;&#9472; CR12 Thread Stack (Priv) \u00b7 CR13 Interrupt Handler (System) \u00b7 CR14\u201315 Privileged &#9472;&#9472;</td></tr>`;
        }
        const cr = sim.getFormattedCR(i);
        const petCR = _petNameCRMap[i];
        let name = petCR || localNames[i] || '';
        if (!name && cr.word0_gt && cr.word0_gt !== '00000000') {
            try {
                const _raw = parseInt(cr.word0_gt, 16) >>> 0;
                const _p = sim.parseGT(_raw);
                if (_p.type === 3) {
                    const _ab = sim.parseAbstractGT(_raw);
                    const _DC = { 1: 'LED', 2: 'UART', 3: 'Button', 4: 'Timer', 5: 'Display' };
                    if (_ab.ab_type === 0) name = `${_DC[_ab.device_class] || 'dc'+_ab.device_class}[${_ab.device_data}]`;
                }
            } catch(_e) {}
        }
        const meta = crMeta[i];
        const nullCls = cr.isNull ? ' cr-null' : ' cr-active';
        const groupCls = meta.group === 'system' ? ' cr-system' : meta.group === 'privil' ? ' cr-privil' : (meta.role === 'arch' ? ' cr-arch' : '');
        const clickable = !cr.isNull ? ' cr-clickable' : '';
        const lumpTag = (i === 6 || i === 14) && !cr.isNull && sim.programName
            ? `<span class="cr-lump-name">${sim.programName}</span>` : '';
        html += `<tr class="${nullCls}${groupCls}${clickable}" ${!cr.isNull ? `onclick="openCRDetail(${i})"` : ''}>`;
        html += `<td class="cr-idx">${i}</td>`;
        html += `<td class="cr-m ${cr.mBit ? 'cr-m-set' : ''}">${cr.mBit}</td>`;
        html += `<td class="cr-name" onmouseenter="showCRPopup(event,${i})" onmouseleave="hideCRPopup()">${name}${lumpTag}</td>`;
        html += `<td><span class="cr-role-badge cr-role-${meta.role}">${meta.badge}</span></td>`;
        html += `<td class="cr-gt">0x${cr.word0_gt}</td>`;
        html += `<td class="cr-perms">[${cr.perms}]</td>`;
        html += `<td>${cr.gtSeq}</td>`;
        html += `<td>${cr.gtIndex}</td>`;
        html += `<td class="cr-type">${cr.gtTypeName}</td>`;
        html += `<td>0x${cr.word1_location.toString(16).toUpperCase().padStart(8, '0')}</td>`;
        html += `<td class="cr-flag">${cr.limitB}</td>`;
        html += `<td class="cr-flag">${cr.limitF}</td>`;
        html += `<td>0x${cr.limit17.toString(16).toUpperCase().padStart(5, '0')}</td>`;
        html += `<td>${cr.sealGtSeq}</td>`;
        html += `<td>0x${cr.sealCRC.toString(16).toUpperCase().padStart(4, '0')}</td>`;
        html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

let selectedCR = null;

// ── CR cycle button ───────────────────────────────────────────────────────────
// Cycles through four dashboard views:
//   0 → CR0-CR15  (register table)
//   1 → CR14 CLOOMC  (detail)
//   2 → CR12 Thread stack  (detail)
//   3 → NS   Namespace table
let _crCycleState = 0;

const _crCycleViews = [
    { label: 'CRs',  title: 'CR0–CR15 — 128-bit Context Registers (4 × 32-bit words)' },
    { label: 'CR14', title: 'CR14 — CLOOMC' },
    { label: 'CR12', title: 'CR12 — Thread stack (system-wide, privileged)' },
    { label: 'NS',   title: 'Namespace — NS table slots and GT types' },
];

function cycleCRView() {
    _crCycleState = (_crCycleState + 1) % 4;
    _applyCRCycleState();
}

function _applyCRCycleState() {
    switchView('dashboard');
    const cur  = _crCycleViews[_crCycleState];
    const next = _crCycleViews[(_crCycleState + 1) % 4];
    const btn  = document.getElementById('crCycleBtn');
    if (btn) {
        btn.textContent = cur.label;
        btn.setAttribute('data-tooltip',
            `${cur.title} · click for ${next.title}`);
        btn.classList.toggle('cr-cycle-detail', _crCycleState !== 0);
    }
    if (_crCycleState === 0) {
        switchDashTab('cr');
    } else if (_crCycleState === 1) {
        openCRDetail(14);
    } else if (_crCycleState === 2) {
        openCRDetail(12);
    } else {
        switchView('namespace');
    }
}
// ─────────────────────────────────────────────────────────────────────────────

function openCRDetail(crIdx) {
    selectedCR = crIdx;
    crDetailTab = 'code';
    const detailTab = document.getElementById('dashTab-crdetail');
    const cr = sim.getFormattedCR(crIdx);

    // ── Binary-path pet names: apply lump-level pet names when the CR holds
    // a known lump from the repository (identified by its NS slot / gtIndex).
    // If sim.pc falls within a method of that lump, also pass the methodIdx so
    // method-level pet names override the lump-level defaults.
    if (cr && !cr.isNull) {
        const nsIdx = cr.gtIndex;
        if (nsIdx !== undefined && nsIdx !== null && typeof _lumpsCache !== 'undefined' && Array.isArray(_lumpsCache)) {
            const lump = _lumpsCache.find(l =>
                l.ns_slot !== undefined && l.ns_slot !== null && parseInt(l.ns_slot) === nsIdx
            );
            // Only supplement pet names in binary-lump context; when the assembler
            // has source-compiled CR aliases, let those take priority and skip.
            const _hasAsmAliases = typeof assembler !== 'undefined' && assembler &&
                Object.keys((assembler.getAliases && assembler.getAliases().cr) || {}).length > 0;
            if (lump && !_hasAsmAliases && typeof _applyLumpPetNames === 'function') {
                let methodIdx = undefined;
                try {
                    const nse = sim.nsTable && sim.nsTable[nsIdx];
                    const slotBase = nse && nse.word0_location !== undefined
                        ? (nse.word0_location >>> 0) : null;
                    const numMethods = (lump.methods || []).length;
                    if (slotBase !== null && numMethods > 0 && sim.pc >= slotBase) {
                        const pcOffset = sim.pc - slotBase;
                        // Method table: words [slotBase+0 .. slotBase+numMethods-1]
                        // each word is the code-entry offset (from slotBase) for that method.
                        const entries = [];
                        for (let mi = 0; mi < numMethods; mi++) {
                            entries.push(sim.memory[slotBase + mi] >>> 0);
                        }
                        for (let mi = numMethods - 1; mi >= 0; mi--) {
                            if (pcOffset >= entries[mi]) {
                                methodIdx = mi;
                                break;
                            }
                        }
                    }
                } catch(e) { methodIdx = undefined; }
                _applyLumpPetNames(lump, methodIdx);
            }
        }
    }

    if (detailTab) {
        const localNames = {
            0: 'Result', 1: 'Arg 1', 6: 'C-List',
            12: 'Thread', 13: 'IRQ', 14: 'CLOOMC', 15: 'Namespace'
        };
        const petCR = _petNameCRMap[crIdx];
        const name = petCR || localNames[crIdx] || '';
        detailTab.textContent = `CR${crIdx}${name ? ' \u2014 ' + name : ''}`;
        detailTab.style.display = '';
    }
    switchDashTab('crdetail');
    updateCRDetail();
}

function openCRDetailAtPC(pc, physicalPC) {
    _crDetailHighlightPC = (pc !== undefined && pc !== null) ? (pc >>> 0) : null;

    // Find which CR register (if any) currently holds the lump that contained
    // physicalPC at gate time. CR14 is the executing code register; but after
    // a reboot it may point to Boot.NS — so we scan all X-permitted CRs.
    if (physicalPC !== undefined && physicalPC !== null && sim && sim.getFormattedCR) {
        const ns = _nsOwnerOf(physicalPC >>> 0);
        if (ns && ns.nsIdx !== undefined) {
            // Scan CRs for one whose gtIndex matches the executing lump.
            let targetCR = -1;
            for (let ci = 0; ci < 16; ci++) {
                const _cr = sim.getFormattedCR(ci);
                if (!_cr || _cr.isNull) continue;
                if (_cr.gtIndex === ns.nsIdx) { targetCR = ci; break; }
            }
            if (targetCR >= 0) {
                openCRDetail(targetCR);
                return;
            }
            // No CR currently holds the executing lump (e.g. after reboot).
            // Fall back to opening the lump in the editor / namespace browser.
            if (typeof faultModalOpenBinaryLump === 'function') {
                faultModalOpenBinaryLump(ns.nsIdx);
                return;
            }
        }
    }
    // Default: open CR14 (code register for current execution context).
    openCRDetail(14);
}

let crDetailTab = 'code';
let clistExpandedIdx = null;

function toggleCListEntry(nsIdx) {
    clistExpandedIdx = (clistExpandedIdx === nsIdx) ? null : nsIdx;
    updateCRDetail();
}

function renderCListEntryDetail(nsIdx, entry) {
    let h = '<div class="clist-detail">';
    const label = entry.label || `NS[${nsIdx}]`;
    h += `<div class="clist-detail-title">${label} \u2014 Namespace Entry ${nsIdx}</div>`;

    h += '<table class="cr-table" style="margin-bottom:0.5rem;"><tbody>';
    const loc = entry.word0_location >>> 0;
    const lim = sim.parseNSWord1(entry.word1_limit);
    const ver = (entry.word2_seals >>> 25) & 0x7F;
    const seal = entry.word2_seals & 0xFFFF;
    h += `<tr><td style="color:var(--church-blue);width:120px;">W0: Location</td><td>0x${loc.toString(16).toUpperCase().padStart(8,'0')}</td></tr>`;
    const typeNames = ['NULL','Inform','Outform','Abstract'];
    h += `<tr><td style="color:var(--church-blue)">W1: Type</td><td>${typeNames[entry.gtType] || '?'} (${entry.gtType})</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">W1: F (Far)</td><td>${lim.f}</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">W1: G (GC)</td><td>${entry.gBit}</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">W1: Chainable</td><td>${lim.chainable ? 'Yes' : 'No'}</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">W1: Limit</td><td>0x${lim.limit.toString(16).toUpperCase().padStart(5,'0')} (${lim.limit + 1} words)</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">W2: Version</td><td>${ver}</td></tr>`;
    h += `<tr><td style="color:var(--church-blue)">W2: CRC Seal</td><td>0x${seal.toString(16).toUpperCase().padStart(4,'0')}</td></tr>`;
    h += '</tbody></table>';

    const wordCount = lim.limit + 1;
    const isBootNS = (nsIdx === 0 && loc === sim.NS_TABLE_BASE);
    if (isBootNS) {
        h += '<div class="clist-detail-title" style="margin-top:0.4rem;">Namespace Table Entries</div>';
        h += renderMemoryDump(loc, lim.limit + 1, nsIdx);
    } else {
        // ── Read lump header at word 0 to derive layout (hardware-accurate) ─────────
        const hdrRaw  = (loc < sim.memory.length) ? (sim.memory[loc] >>> 0) : 0;
        const hdr     = sim.parseLumpHeader(hdrRaw);
        if (hdr.valid) {
            const cw        = hdr.cw;          // declared code word count
            const cc        = hdr.cc;          // c-list slot count
            const lumpSize  = hdr.lumpSize;    // physical slot size (2^(n_minus_6+6))
            const clistStart = lumpSize - cc;  // c-list at physical end
            const hdrHex    = '0x' + (hdrRaw >>> 0).toString(16).toUpperCase().padStart(8,'0');
            const typNames  = ['lump','namespace','Thread','Outform'];
            // ── Lump Header ──────────────────────────────────────────────────
            h += `<div class="clist-detail-title" style="margin-top:0.4rem;color:var(--church-gold);">Header`
               + ` <span style="font-size:0.72rem;">word 0 \u00b7 ${hdrHex}`
               + ` \u00b7 magic=0x${hdr.magic.toString(16).toUpperCase()}`
               + ` \u00b7 n\u22126=${hdr.n_minus_6}\u2192${lumpSize}w`
               + ` \u00b7 cw=${cw} \u00b7 typ=${typNames[hdr.typ]||hdr.typ} \u00b7 cc=${cc}`
               + `</span></div>`;
            // ── CLOOMC Code (words 1..cw at loc+1..loc+cw) ──────────────────
            // Scan for the last non-zero instruction to separate code from trailing freespace.
            let actualCodeEnd = 0;
            for (let w = 0; w < cw; w++) {
                const codeAddr = loc + 1 + w;
                if (codeAddr < sim.memory.length && sim.memory[codeAddr]) actualCodeEnd = w + 1;
            }
            {
                const asm = new ChurchAssembler();
                const isEmpty = actualCodeEnd === 0;
                h += '<div class="clist-detail-title" style="margin-top:0.3rem;">CLOOMC Code';
                if (cw === 0) {
                    h += ' <span style="color:#555;font-size:0.72rem;">(cw=0 \u2014 no code region)</span></div>';
                } else {
                    if (isEmpty) h += ' <span style="color:#555;font-size:0.72rem;">(empty \u2014 not loaded)</span>';
                    h += '</div>';
                    // Always show all cw slots so the user sees the code region layout.
                    // Empty slots (word=0) are shown dimmed; loaded instructions are bright.
                    const _clBase = (cc > 0) ? (loc + lumpSize - cc) : 0;
                    const _crPets1 = {};
                    const _cw1 = [];
                    for (let w = 0; w < cw; w++) {
                        const a = loc + 1 + w;
                        _cw1.push(a < sim.memory.length ? (sim.memory[a] >>> 0) : 0);
                    }
                    const _ba1 = _computeBranchArrows(_cw1);
                    let codeHtml = '<table class="cr-table code-view-table"><thead><tr>';
                    codeHtml += '<th>Off</th><th>Addr</th><th>Hex</th><th>Decode</th>';
                    if (_ba1.hasBranches) codeHtml += '<th class="br-arrow-hdr"></th>';
                    codeHtml += '<th class="code-decompiled-hdr">Decompiled</th></tr></thead><tbody>';
                    for (let w = 0; w < cw; w++) {
                        const addr = loc + 1 + w;
                        if (addr >= sim.memory.length) break;
                        const word = _cw1[w];
                        const _mObj1 = _methodAtOffset(nsIdx, w);
                        const _disasm1 = _applyMethodCRNames(_applyMethodDRNames(_annotateRawClistSlot(asm.disassemble(word), _clBase, nsIdx), _mObj1), _mObj1);
                        const decoded = word === 0 ? 'HALT' : _wrapRegHover(typeof _highlightCLOOMCSource === 'function' ? _highlightCLOOMCSource(_disasm1, 'assembly') : _disasm1);
                        const isPC   = sim.bootComplete && (addr === (sim.memory[sim.NS_TABLE_BASE + 2 * sim.NS_ENTRY_WORDS] || (2 * sim.SLOT_SIZE)) + 1 + sim.pc);
                        const dimmed = word === 0 ? ' style="opacity:0.35;"' : '';
                        const _dc = _decompileWord(word, addr, nsIdx, _clBase, _crPets1);
                        const _dcCls = _dc ? (_dc.compiler ? 'code-decompiled-compiler' : 'code-decompiled-user') : '';
                        const rowCls = isPC ? 'code-pc-row' : (_dc && _dc.compiler ? 'code-row-compiler' : '');
                        codeHtml += `<tr class="${rowCls}"${dimmed}>`;
                        codeHtml += `<td class="cr-idx">+${w + 1}</td>`;
                        codeHtml += `<td class="cr-idx">0x${addr.toString(16).toUpperCase().padStart(4,'0')}</td>`;
                        codeHtml += `<td class="cr-gt">0x${word.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                        codeHtml += `<td class="code-disasm">${decoded}</td>`;
                        if (_ba1.hasBranches) codeHtml += `<td class="br-arrow-col">${_ba1.html[w]}</td>`;
                        codeHtml += `<td class="code-decompiled ${_dcCls}">${_dc ? _wrapRegHover(_dc.desc) : ''}</td>`;
                        codeHtml += '</tr>';
                    }
                    codeHtml += '</tbody></table>';
                    h += codeHtml;
                }
            }
            // ── Freespace (words actualCodeEnd+1 .. clistStart-1 relative to word 1) ──
            // Freespace = gap between last instruction and c-list (from the code region's perspective).
            const totalFreeWords = clistStart - 1 - actualCodeEnd;  // words between last code and c-list
            if (totalFreeWords > 0) {
                const freeBase = loc + 1 + actualCodeEnd;
                const freeEnd  = loc + clistStart - 1;
                h += `<div class="clist-detail-title" style="margin-top:0.3rem;color:var(--church-gold);">Freespace`
                   + ` <span style="font-size:0.72rem;">`
                   + `words +${1 + actualCodeEnd}\u2013+${clistStart - 1}`
                   + ` \u00b7 ${totalFreeWords} unused words`
                   + ` \u00b7 0x${freeBase.toString(16).toUpperCase().padStart(4,'0')}\u20130x${freeEnd.toString(16).toUpperCase().padStart(4,'0')}`
                   + `</span></div>`;
            }
            // ── C-List (words lumpSize-cc .. lumpSize-1 at physical end) ─────
            h += `<div class="clist-detail-title" style="margin-top:0.4rem;">C-List (${cc} GT entries)</div>`;
            let gtHtml = '<table class="cr-table code-view-table"><thead><tr><th>#</th><th>Addr</th><th>Hex</th><th>GT Decoded</th></tr></thead><tbody>';
            for (let w = 0; w < cc; w++) {
                const addr = loc + clistStart + w;
                if (addr >= sim.memory.length) break;
                const word = sim.memory[addr] || 0;
                gtHtml += _renderGTRow(w, addr, word);
            }
            gtHtml += '</tbody></table>';
            h += gtHtml;
        } else {
            // No valid lump header — derive LUMP layout from NS entry fields
            const cc2        = lim.clistCount;
            const allocSize2 = lim.limit + 1;
            const clistStart2 = cc2 > 0 ? (allocSize2 - cc2) : allocSize2;
            const locHex2    = '0x' + loc.toString(16).toUpperCase().padStart(4,'0');
            const hdrHex2    = '0x' + (hdrRaw >>> 0).toString(16).toUpperCase().padStart(8,'0');
            // Header note
            h += `<div class="clist-detail-title" style="margin-top:0.4rem;color:rgba(156,220,254,0.35);">Header`;
            h += ` <span style="font-size:0.72rem;color:#3f3f46;">no lump header at ${locHex2}`;
            h += ` \u00b7 layout from NS entry \u00b7 alloc=${allocSize2}w \u00b7 cc=${cc2}</span></div>`;
            h += '<table class="cr-table code-view-table"><thead><tr><th>Off</th><th>Addr</th><th>Hex</th><th>Note</th></tr></thead><tbody>';
            h += `<tr style="opacity:0.3;"><td class="cr-idx">+0</td>`;
            h += `<td class="cr-idx">${locHex2}</td>`;
            h += `<td class="cr-gt">${hdrHex2}</td>`;
            h += `<td class="code-disasm" style="font-style:italic;color:#3f3f46;">(no lump header \u2014 raw word)</td></tr>`;
            h += '</tbody></table>';
            // Code section
            h += `<div class="clist-detail-title" style="margin-top:0.3rem;">CLOOMC Code`;
            if (clistStart2 === 0) {
                h += ' <span style="color:#555;font-size:0.72rem;">(no code region)</span>';
            }
            h += '</div>';
            if (clistStart2 > 0) {
                const asm2 = new ChurchAssembler();
                const _clBase2 = (cc2 > 0) ? (loc + allocSize2 - cc2) : 0;
                const _crPets2 = {};
                const _cw2 = [];
                for (let w = 0; w < clistStart2; w++) {
                    const a = loc + w;
                    _cw2.push(a < sim.memory.length ? (sim.memory[a] >>> 0) : 0);
                }
                const _ba2 = _computeBranchArrows(_cw2);
                let codeHtml2 = '<table class="cr-table code-view-table"><thead><tr>';
                codeHtml2 += '<th>Off</th><th>Addr</th><th>Hex</th><th>Decode</th>';
                if (_ba2.hasBranches) codeHtml2 += '<th class="br-arrow-hdr"></th>';
                codeHtml2 += '<th class="code-decompiled-hdr">Decompiled</th></tr></thead><tbody>';
                for (let w = 0; w < clistStart2; w++) {
                    const addr = loc + w;
                    if (addr >= sim.memory.length) break;
                    const word = _cw2[w];
                    const _mObj2 = _methodAtOffset(nsIdx, w);
                    const _disasm2 = _applyMethodCRNames(_applyMethodDRNames(_annotateRawClistSlot(asm2.disassemble(word), _clBase2, nsIdx), _mObj2), _mObj2);
                    const decoded = word === 0 ? 'HALT' : _wrapRegHover(typeof _highlightCLOOMCSource === 'function' ? _highlightCLOOMCSource(_disasm2, 'assembly') : _disasm2);
                    const dimmed = word === 0 ? ' style="opacity:0.35;"' : '';
                    const _dc2 = _decompileWord(word, addr, nsIdx, _clBase2, _crPets2);
                    const _dc2Cls = _dc2 ? (_dc2.compiler ? 'code-decompiled-compiler' : 'code-decompiled-user') : '';
                    const rowCls2 = _dc2 && _dc2.compiler ? ' class="code-row-compiler"' : '';
                    codeHtml2 += `<tr${rowCls2}${dimmed}>`;
                    codeHtml2 += `<td class="cr-idx">+${w}</td>`;
                    codeHtml2 += `<td class="cr-idx">0x${addr.toString(16).toUpperCase().padStart(4,'0')}</td>`;
                    codeHtml2 += `<td class="cr-gt">0x${word.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                    codeHtml2 += `<td class="code-disasm">${decoded}</td>`;
                    if (_ba2.hasBranches) codeHtml2 += `<td class="br-arrow-col">${_ba2.html[w]}</td>`;
                    codeHtml2 += `<td class="code-decompiled ${_dc2Cls}">${_dc2 ? _wrapRegHover(_dc2.desc) : ''}</td></tr>`;
                }
                codeHtml2 += '</tbody></table>';
                h += codeHtml2;
            }
            // C-List section
            if (cc2 > 0) {
                h += `<div class="clist-detail-title" style="margin-top:0.4rem;">C-List (${cc2} GT entries)</div>`;
                let gtHtml2 = '<table class="cr-table code-view-table"><thead><tr><th>#</th><th>Addr</th><th>Hex</th><th>GT Decoded</th></tr></thead><tbody>';
                for (let w = 0; w < cc2; w++) {
                    const addr = loc + clistStart2 + w;
                    if (addr >= sim.memory.length) break;
                    const word = sim.memory[addr] || 0;
                    gtHtml2 += _renderGTRow(w, addr, word);
                }
                gtHtml2 += '</tbody></table>';
                h += gtHtml2;
            }
        }
    }

    h += '</div>';
    return h;
}

function switchCRDetailTab(tab) {
    crDetailTab = tab;
    document.querySelectorAll('.crd-menu-item[data-tab]').forEach(it => it.classList.remove('crd-menu-item-active'));
    const menuItem = document.querySelector(`.crd-menu-item[data-tab="${tab}"]`);
    if (menuItem) menuItem.classList.add('crd-menu-item-active');
    document.querySelectorAll('.crd-tab').forEach(b => b.classList.remove('active'));
    const activeTabBtn = document.querySelector(`.crd-tab[onclick*="'${tab}'"]`);
    if (activeTabBtn) activeTabBtn.classList.add('active');
    document.querySelectorAll('.crd-panel').forEach(p => p.style.display = 'none');
    const panel = document.getElementById('crdPanel-' + tab);
    if (panel) panel.style.display = 'block';
    const labelEl = document.getElementById('crdMenuActiveLabel');
    if (labelEl) {
        const absLabel = labelEl.dataset.absLabel || '';
        const tabLabel =
            tab === 'clist'    ? 'C-List'   :
            tab === 'api'      ? 'API'      :
            tab === 'lump'     ? 'Lump'     :
            tab === 'register' ? 'Register' :
            tab === 'binary'   ? 'Binary'   : '';
        labelEl.textContent = absLabel
            ? (tabLabel ? `${absLabel} \u2014 ${tabLabel}` : absLabel)
            : (tabLabel || 'Code');
    }
}

function scrollToThreadZone(zone) {
    switchCRDetailTab('lump');
    // Allow the panel to become visible before scrolling
    requestAnimationFrame(() => {
        // Helper: measure sticky offset (tabs row + thread-layout header)
        function getStickyOffset(scroller) {
            const tabsEl   = scroller.querySelector('.crd-menu-bar');
            const stickyEl = scroller.querySelector('.thread-layout-sticky');
            const tabsH    = tabsEl   ? tabsEl.offsetHeight   : 46;
            const stickyH  = stickyEl ? stickyEl.offsetHeight : 0;
            return tabsH + stickyH + 6;
        }
        // Helper: find nearest scrollable ancestor
        function findScroller(el) {
            let s = el.parentElement;
            while (s && s !== document.body) {
                const ov = getComputedStyle(s).overflowY;
                if (ov === 'auto' || ov === 'scroll') return s;
                s = s.parentElement;
            }
            return null;
        }
        // Helper: scroll an element to the top of the viewport (below sticky headers)
        function scrollToTop(scroller, target, extraPad) {
            const stickyOffset = getStickyOffset(scroller);
            const targetTop = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
            scroller.scrollTo({ top: Math.max(0, targetTop - stickyOffset - (extraPad || 0)), behavior: 'smooth' });
        }

        if (zone === 2) {
            // Zone 2 (LIFO Stack): scroll so the Top of Stack frame (+1 frame below)
            // is visible at the top of the viewport. The top frame sits at sto+1 (E-GT)
            // and sto+2 (frame word); we anchor on sto+1 so both rows are shown first,
            // with the next frame's rows visible below.
            const sto = (sim && sim.sto != null) ? sim.sto : null;
            let anchorRow = null;
            if (sto != null) {
                // sto+1 is the E-GT word of the topmost frame; sto+2 is the frame word.
                // Show 1 row above the E-GT for visual breathing room (+2 px of padding).
                const egOffset = sto + 1;
                anchorRow = document.getElementById('thread-stack-row-' + egOffset);
            }
            // Fallback: if STO is unknown or the row isn't rendered, use the zone banner
            if (!anchorRow) anchorRow = document.getElementById('thread-zone-2');
            if (!anchorRow) return;
            const scroller = findScroller(anchorRow);
            if (scroller) {
                scrollToTop(scroller, anchorRow, 4);
            } else {
                anchorRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            return;
        }

        const id = 'thread-zone-' + zone;
        const target = document.getElementById(id);
        if (!target) return;
        const scroller = findScroller(target);
        if (scroller) {
            scrollToTop(scroller, target);
        } else {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
}

// ── Zone-button rich hover popups ────────────────────────────────────────────
let _zdpHideTimer = null;

function cancelHideZonePopup() {
    if (_zdpHideTimer) { clearTimeout(_zdpHideTimer); _zdpHideTimer = null; }
}

function hideZonePopup(immediate) {
    if (immediate) {
        cancelHideZonePopup();
        const pop = document.getElementById('zone-data-popup');
        if (pop) pop.style.display = 'none';
        return;
    }
    _zdpHideTimer = setTimeout(() => {
        const pop = document.getElementById('zone-data-popup');
        if (pop) pop.style.display = 'none';
    }, 80);
}

function showZonePopup(evt, zone, nsIdx) {
    cancelHideZonePopup();
    const pop = document.getElementById('zone-data-popup');
    if (!pop || !sim) return;

    const entry = sim.readNSEntry ? sim.readNSEntry(nsIdx) : null;
    const slotBase = (entry && entry.word0_location != null) ? (entry.word0_location >>> 0) : (nsIdx * 256);
    const TL = THREAD_LAYOUT;
    const hexW = w => '0x' + (w >>> 0).toString(16).toUpperCase().padStart(8, '0');
    const hex4 = n => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(4, '0');

    let html = '';

    if (zone === 'hdr') {
        const hdrWord = (sim.memory[slotBase] >>> 0) || TL.THREAD_HEADER;
        const hdr = sim.parseLumpHeader ? sim.parseLumpHeader(hdrWord) : {};
        const typNames = ['lump','namespace','thread','outform'];
        html += `<div class="zdp-title" style="border-color:#6b7280;color:#9ca3af;">Lump Header · word +0</div>`;
        html += `<table>`;
        html += `<tr><td>raw</td><td class="zdp-hex">${hexW(hdrWord)}</td></tr>`;
        if (hdr.valid) {
            html += `<tr><td>magic</td><td class="zdp-val">0x1F <span class="zdp-lbl">(valid)</span></td></tr>`;
            html += `<tr><td>n−6</td><td class="zdp-val">${hdr.n_minus_6} → <span class="zdp-note">${hdr.lumpSize} words</span></td></tr>`;
            html += `<tr><td>cw</td><td class="zdp-val">${hdr.cw} <span class="zdp-lbl">code words</span></td></tr>`;
            html += `<tr><td>typ</td><td class="zdp-val">${hdr.typ} <span class="zdp-lbl">${typNames[hdr.typ] || hdr.typ}</span></td></tr>`;
            html += `<tr><td>cc</td><td class="zdp-val">${hdr.cc} <span class="zdp-lbl">c-list slots</span></td></tr>`;
        } else {
            html += `<tr><td colspan="2" class="zdp-empty">no valid lump header at this address</td></tr>`;
        }
        html += `</table>`;

    } else if (zone === 5) {
        html += `<div class="zdp-title" style="border-color:#a855f7;color:#c084fc;">⑤ Data Registers · DR0–DR15</div>`;
        html += `<table>`;
        const drSrc = (sim.dr && sim.dr.length >= 16) ? sim.dr : null;
        for (let i = 0; i < 16; i++) {
            const live = drSrc ? (drSrc[i] >>> 0) : 0;
            const mem  = (sim.memory[slotBase + TL.DR_START + i] >>> 0) || 0;
            const val  = drSrc ? live : mem;
            const cls  = val ? 'zdp-val' : 'zdp-dim';
            const src  = drSrc ? '' : '<span class="zdp-lbl"> (mem)</span>';
            const pn = _petNameDRMap[i];
            const drLabel = pn ? `DR${i} (${pn})` : `DR${i}`;
            html += `<tr><td style="color:#a855f7;">${drLabel}</td><td class="${cls}">${hexW(val)}${src}</td></tr>`;
        }
        html += `</table>`;

    } else if (zone === 4) {
        const dr5 = (sim.dr && sim.dr[5] != null) ? (sim.dr[5] >>> 0) : null;
        let allocCount = 0;
        let allocWords = [];
        for (let i = 0; i < TL.HEAP_WORDS; i++) {
            const w = sim.memory[slotBase + TL.HEAP_START + i] >>> 0;
            if (w) { allocCount++; if (allocWords.length < 4) allocWords.push({off: TL.HEAP_START + i, w}); }
        }
        html += `<div class="zdp-title" style="border-color:#22c55e;color:#4ade80;">④ Heap · +${TL.HEAP_START}…+${TL.HEAP_END}</div>`;
        html += `<table>`;
        html += `<tr><td>allocated</td><td class="zdp-note">${allocCount} / ${TL.HEAP_WORDS} words</td></tr>`;
        if (dr5 !== null) html += `<tr><td>DR5 (frontier)</td><td class="zdp-hex">${hexW(dr5)}</td></tr>`;
        if (allocWords.length === 0) {
            html += `<tr><td colspan="2" class="zdp-empty">heap is empty</td></tr>`;
        } else {
            html += `<tr><td colspan="2" style="color:#6b8faf;padding-top:0.25rem;">first ${allocWords.length} non-zero word${allocWords.length!==1?'s':''}:</td></tr>`;
            for (const {off, w} of allocWords) html += `<tr><td>+${off}</td><td class="zdp-hex">${hexW(w)}</td></tr>`;
        }
        html += `</table>`;

    } else if (zone === 3) {
        const sto = (sim.sto != null) ? sim.sto : TL.STACK_END;
        const freeWords = sto - TL.HEAP_END;          // between heap top and STO
        let nonZero = 0;
        for (let i = TL.FREE_START; i <= TL.FREE_END; i++) {
            if (sim.memory[slotBase + i]) nonZero++;
        }
        html += `<div class="zdp-title" style="border-color:#6b7280;color:#9ca3af;">③ Freespace · +${TL.FREE_START}…+${TL.FREE_END}</div>`;
        html += `<table>`;
        html += `<tr><td>STO (live)</td><td class="zdp-note">${sto} <span class="zdp-lbl">(stack top offset)</span></td></tr>`;
        html += `<tr><td>free gap</td><td class="zdp-val">${Math.max(0, freeWords)} words</td></tr>`;
        html += `<tr><td>non-zero</td><td class="${nonZero?'zdp-note':'zdp-dim'}">${nonZero} word${nonZero!==1?'s':''}</td></tr>`;
        html += `</table>`;

    } else if (zone === 2) {
        const sto = (sim.sto != null) ? sim.sto : TL.STACK_END;
        const SP_MAX = TL.STACK_END;  // 243

        // Walk physical memory: frame word at ptr (high), E-GT at ptr-1 (low).
        // ptr starts at sto+2 (the frame word of the most-recent frame).
        // prev_STO field in each frame word gives the ptr for the next older frame.
        const frames = [];
        let ptr = sto + 2;
        const MAX_WALK = 16;  // safety cap against corrupt stacks
        while (ptr >= TL.STACK_START && ptr <= SP_MAX && frames.length < MAX_WALK) {
            const fw  = sim.memory[slotBase + ptr] >>> 0;
            if (!fw) break;
            const niaBits = (fw >>> 13) & 0x7FFF;
            const szBit   = (fw >>> 12) & 1;
            const prevSTO =  fw & 0xFFF;
            const egt     = (szBit && ptr > TL.STACK_START) ? (sim.memory[slotBase + ptr - 1] >>> 0) : 0;
            frames.push({ ptr, fw, niaBits, szBit, prevSTO, egt });
            if (prevSTO >= ptr || prevSTO < TL.STACK_START) break;  // guard against bad prev_STO
            ptr = prevSTO;
        }

        html += `<div class="zdp-title" style="border-color:#38bdf8;color:#7dd3fc;">② LIFO Stack · STO=${sto} · sp_max=${SP_MAX}</div>`;
        html += `<table>`;
        html += `<tr><td>depth</td><td class="zdp-note">${frames.length} frame${frames.length!==1?'s':''} (incl. sentinel)</td></tr>`;
        html += `</table>`;

        // Show top 2 frames decoded
        const showN = Math.min(2, frames.length);
        for (let fi = 0; fi < showN; fi++) {
            const f = frames[fi];
            const isTop = fi === 0;
            const isSentinel = f.niaBits === 0x7FFF;
            const cls   = isTop ? 'zdp-frame-top' : 'zdp-frame-more';
            const label = isTop ? '▶ top' : '  +1';

            let egtStr = '';
            if (f.egt) {
                const gt = sim.parseGT ? sim.parseGT(f.egt) : null;
                if (gt && gt.type !== 0) {
                    const perms = Object.entries(gt.permissions || {}).filter(([,v])=>v).map(([k])=>k).join('') || 'none';
                    const lbl = (typeof _gtPetName === 'function') ? _gtPetName(f.egt) : ((sim.nsLabels && sim.nsLabels[gt.index]) || '');
                    egtStr = `${gt.typeName} s=${gt.index}${lbl?' <span class="zdp-lbl">('+lbl+')</span>':''} [${perms}]`;
                } else {
                    egtStr = hexW(f.egt);
                }
            }

            html += `<div style="margin-top:0.4rem;padding-top:0.3rem;border-top:1px solid #1e3a5f;">`;
            html += `<span class="${cls}">frame @+${f.ptr}</span>`;
            if (isSentinel) html += ` <span class="zdp-sentinel">sentinel</span>`;
            html += `<table>`;
            html += `<tr><td style="color:#6b8faf;">fw</td><td class="zdp-hex">${hexW(f.fw)}</td></tr>`;
            if (!isSentinel) {
                html += `<tr><td>returnPC</td><td class="zdp-val">${f.niaBits} <span style="color:#555;">${hex4(f.niaBits)}</span></td></tr>`;
            }
            html += `<tr><td>sz</td><td class="zdp-val">${f.szBit} <span class="zdp-lbl">${f.szBit?'CALL':'LAMBDA'}</span></td></tr>`;
            html += `<tr><td>prev STO</td><td class="zdp-val">${f.prevSTO}</td></tr>`;
            if (f.egt) html += `<tr><td>E-GT @+${f.ptr-1}</td><td class="zdp-note">${egtStr}</td></tr>`;
            html += `</table>`;
            html += `</div>`;
        }

        if (frames.length === 0) {
            html += `<div class="zdp-empty" style="margin-top:0.3rem;">no frames found in memory (stack may be empty or sim not started)</div>`;
        } else if (frames.length > 2) {
            html += `<div style="margin-top:0.3rem;color:#4b5563;font-size:0.69rem;">… ${frames.length - 2} more frame${frames.length-2!==1?'s':''} below — click ②\u202FStack to see all</div>`;
        }

    } else if (zone === 1) {
        html += `<div class="zdp-title" style="border-color:#f4b942;color:#fde68a;">① Capabilities · CR0–CR11 (c-list tail)</div>`;
        html += `<table>`;
        for (let i = 0; i < TL.CAPS_WORDS; i++) {
            const off  = TL.CAPS_START + i;
            const word = sim.memory[slotBase + off] >>> 0;
            if (!word) {
                html += `<tr><td style="color:#f4b942;">CR${i}</td><td class="zdp-dim">0x00000000</td></tr>`;
                continue;
            }
            const gt = sim.parseGT ? sim.parseGT(word) : null;
            let decoded = hexW(word);
            if (gt && gt.type !== 0) {
                const perms = Object.entries(gt.permissions || {}).filter(([,v])=>v).map(([k])=>k).join('') || 'none';
                const lbl = (typeof _gtPetName === 'function') ? _gtPetName(word) : ((sim.nsLabels && sim.nsLabels[gt.index]) || '');
                decoded = `<span class="zdp-hex">${hexW(word)}</span> <span class="zdp-note">${gt.typeName}</span> s=${gt.index}${lbl?' <span class="zdp-lbl">('+lbl+')</span>':''} [${perms}]`;
            }
            html += `<tr><td style="color:#f4b942;">CR${i}</td><td>${decoded}</td></tr>`;
        }
        html += `</table>`;
    }

    const dismissBtn = `<button class="zdp-dismiss" onclick="hideZonePopup(true)" title="Close">&times;</button>`;
    pop.innerHTML = dismissBtn + html;
    pop.style.display = 'block';

    // Position below the button; only flip above if there is more room above than below.
    const rect  = evt.currentTarget.getBoundingClientRect();
    const vw    = window.innerWidth;
    const vh    = window.innerHeight;
    const spaceBelow = vh - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    // Measure natural popup size (place off-screen first so layout runs)
    pop.style.left = '-9999px'; pop.style.top = '-9999px';
    const pw = pop.offsetWidth  || 300;
    const ph = pop.offsetHeight || 200;
    // Choose side with more room; prefer below
    let top;
    if (spaceBelow >= ph || spaceBelow >= spaceAbove) {
        top = rect.bottom + 6;   // below the button
    } else {
        top = Math.max(8, rect.top - ph - 6);  // above the button
    }
    let left = rect.left;
    if (left + pw > vw - 8) left = Math.max(8, vw - pw - 8);
    pop.style.left = left + 'px';
    pop.style.top  = top  + 'px';
}

let _crPopupTimer = null;
let _crPopupSuppressed = true;
let _crPopupSuppressTimer = null;
let _crAutoFadeTimer = null;

function _cancelAutoFade() {
    if (_crAutoFadeTimer) { clearTimeout(_crAutoFadeTimer); _crAutoFadeTimer = null; }
}

function _startAutoFade() {
    _cancelAutoFade();
    _crAutoFadeTimer = setTimeout(() => hideCRPopup(true), 10000);
}

function cancelHideCRPopup() {
    if (_crPopupTimer) { clearTimeout(_crPopupTimer); _crPopupTimer = null; }
}

function enterCRPopup() {
    cancelHideCRPopup();
    _cancelAutoFade();
}

function hideCRPopup(immediate) {
    if (immediate) {
        cancelHideCRPopup();
        _cancelAutoFade();
        const pop = document.getElementById('cr-hover-popup');
        if (pop) pop.style.display = 'none';
        if (_crPopupSuppressTimer) clearTimeout(_crPopupSuppressTimer);
        _crPopupSuppressed = true;
        _crPopupSuppressTimer = setTimeout(() => { _crPopupSuppressed = false; }, 350);
        return;
    }
    _crPopupTimer = setTimeout(() => {
        _cancelAutoFade();
        const pop = document.getElementById('cr-hover-popup');
        if (pop) pop.style.display = 'none';
    }, 80);
}

function _positionPopup(pop, evt, anchorEl) {
    const row  = evt.currentTarget;
    const col3 = anchorEl || (row && row.querySelectorAll ? row.querySelectorAll('td')[2] : null);
    const rect = col3 ? col3.getBoundingClientRect() : row.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    pop.style.left = '-9999px'; pop.style.top = '-9999px';
    const pw = pop.offsetWidth || 260;
    const ph = pop.offsetHeight || 160;
    // Anchor to left edge of column 3; open to the left, fall back right
    const margin = 8;
    let left = rect.left - pw - margin;
    if (left < 8) left = rect.right + margin;
    if (left + pw > vw - 8) left = vw - pw - 8;
    const spaceBelow = vh - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    let top;
    if (spaceBelow >= ph || spaceBelow >= spaceAbove) {
        top = rect.top;
    } else {
        top = Math.max(8, rect.bottom - ph);
    }
    if (top + ph > vh - 8) top = vh - ph - 8;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
}

function showDRPopup(evt, drIdx) {
    if (_crPopupSuppressed) return;
    cancelHideCRPopup();
    const pop = document.getElementById('cr-hover-popup');
    if (!pop || !sim) return;

    const val = sim.dr[drIdx] >>> 0;
    const valSigned = val | 0;
    const petName = _petNameDRMap[drIdx];
    const hexW = w => '0x' + (w >>> 0).toString(16).toUpperCase().padStart(8, '0');
    const _drArchNames = { 0: 'Accumulator', 1: 'Argument 1' };
    const archName = _drArchNames[drIdx];
    const _drLabel = petName || archName || '';
    const _drMain  = _drLabel || `DR${drIdx}`;
    const _drSub   = _drLabel ? ` <span class="popup-sub-id">(DR${drIdx})</span>` : '';

    let html = '';
    if (val === 0) {
        html += `<div class="zdp-title" style="border-color:#374151;color:#6b7280;">${_drMain}${_drSub} · ZERO</div>`;
        html += `<table>`;
        html += `<tr><td>Value</td><td class="zdp-hex">0x00000000 <span class="zdp-lbl">(zero)</span></td></tr>`;
        if (drIdx === 0) {
            html += `<tr><td>Role</td><td class="zdp-note">Accumulator — holds operation result</td></tr>`;
        } else if (archName) {
            html += `<tr><td>Role</td><td class="zdp-note">${archName}</td></tr>`;
        } else if (petName) {
            html += `<tr><td>Pet name</td><td class="zdp-note">${petName}</td></tr>`;
        }
        html += `</table>`;
    } else {
        html += `<div class="zdp-title" style="border-color:#a855f7;color:#c084fc;">${_drMain}${_drSub}</div>`;
        html += `<table>`;
        html += `<tr><td>Hex</td><td class="zdp-hex">${hexW(val)}</td></tr>`;
        if (valSigned < 0) {
            html += `<tr><td>Decimal</td><td class="zdp-val">${valSigned} <span class="zdp-lbl">(unsigned: ${val})</span></td></tr>`;
        } else {
            html += `<tr><td>Decimal</td><td class="zdp-val">${val}</td></tr>`;
        }
        if (petName) html += `<tr><td>Pet name</td><td class="zdp-note">${petName}</td></tr>`;
        if (archName && !petName) html += `<tr><td>Role</td><td class="zdp-note">${archName}</td></tr>`;

        {
            let _nsMatch = null;
            if (sim.readNSEntry && sim.nsCount > 0) {
                for (let _si = 0; _si < sim.nsCount; _si++) {
                    const _nse = sim.readNSEntry(_si);
                    if (_nse && (_nse.word0_location >>> 0) === val) {
                        _nsMatch = { slot: _si, label: _nse.label };
                        break;
                    }
                }
            }
            if (!_nsMatch && sim.getFormattedCR) {
                for (let i = 0; i < 16; i++) {
                    const _cr = sim.getFormattedCR(i);
                    if (!_cr || _cr.isNull) continue;
                    if ((_cr.word1_location >>> 0) === val) {
                        _nsMatch = { slot: _cr.gtIndex, label: (sim.nsLabels && sim.nsLabels[_cr.gtIndex]) || '' };
                        break;
                    }
                }
            }
            if (_nsMatch) {
                html += `<tr><td colspan="2" style="color:#f4b942;padding-top:0.3rem;">&#x25C6; NS slot ${_nsMatch.slot}${_nsMatch.label ? ' <span class="zdp-lbl">('+_nsMatch.label+')</span>' : ''} base</td></tr>`;
            }
        }

        if (sim.getFormattedCR) {
            const _cr14 = sim.getFormattedCR(14);
            const _cr14Base = (_cr14 && !_cr14.isNull) ? (_cr14.word1_location >>> 0) : null;
            const _absPC = _cr14Base !== null ? (_cr14Base + 1 + (sim.pc >>> 0)) : null;
            for (let i = 0; i < 16; i++) {
                const _xcr = sim.getFormattedCR(i);
                if (!_xcr || _xcr.isNull || _xcr.perms.indexOf('X') === -1) continue;
                const base = _xcr.word1_location >>> 0;
                const limit = _xcr.limit17 || 0;
                if (val > base && val <= base + limit) {
                    const nsLbl = (sim.nsLabels && sim.nsLabels[_xcr.gtIndex]) || '';
                    const offset = val - base;
                    const isSelf = _absPC !== null && _absPC >= base && _absPC <= base + limit;
                    if (isSelf) {
                        html += `<tr><td colspan="2" style="color:#fbbf24;padding-top:0.3rem;">&#x21BB; Self-loop target — within current lump${nsLbl ? ' ('+nsLbl+')' : ''} +${offset}</td></tr>`;
                    } else {
                        html += `<tr><td colspan="2" style="color:#7dd3fc;padding-top:0.3rem;">&#x2192; Code offset +${offset} in CR${i}${nsLbl ? ' ('+nsLbl+')' : ''}</td></tr>`;
                    }
                    break;
                }
            }
        }

        {
            const _symStore = window._assemblerSymbols || (assembler && assembler.labels ? { labels: assembler.labels, lumpName: '' } : null);
            if (_symStore && sim.getFormattedCR) {
                const _sCR14 = sim.getFormattedCR(14);
                const _sBase = (_sCR14 && !_sCR14.isNull) ? (_sCR14.word1_location >>> 0) : null;
                if (_sBase !== null) {
                    for (const [symName, symOff] of Object.entries(_symStore.labels)) {
                        if ((_sBase + 1 + symOff) === val) {
                            const _lumpCtx = _symStore.lumpName ? ` in ${_symStore.lumpName}` : '';
                            html += `<tr><td colspan="2" style="color:#34d399;padding-top:0.3rem;">&#x22B9; Symbol: .${symName}${_lumpCtx}</td></tr>`;
                            break;
                        }
                    }
                }
            }
        }

        html += `</table>`;
    }

    const dismissBtn = `<button class="zdp-dismiss" onclick="hideCRPopup(true)" title="Close">&times;</button>`;
    pop.innerHTML = dismissBtn + html;
    pop.style.display = 'block';
    _positionPopup(pop, evt);
    cancelHideCRPopup();
    _startAutoFade();
}

function clistSelectName(lbl) {
    hideCRPopup(true);
    const ed = document.getElementById('asmEditor');
    if (!ed) return;
    const start = ed.selectionStart;
    const end   = ed.selectionEnd;
    const val   = ed.value;
    ed.value = val.substring(0, start) + lbl + val.substring(end);
    ed.selectionStart = ed.selectionEnd = start + lbl.length;
    if (typeof switchView === 'function') switchView('editor');
    setTimeout(() => {
        ed.focus();
        ed.dispatchEvent(new Event('input', { bubbles: true }));
    }, 60);
}

function showCListPopup(evt, clistBase, cc) {
    if (_crPopupSuppressed) return;
    cancelHideCRPopup();
    const pop = document.getElementById('cr-hover-popup');
    if (!pop || !sim) return;

    const hexW = w => '0x' + (w >>> 0).toString(16).toUpperCase().padStart(8, '0');
    const limit = (cc > 0 && cc <= 64) ? cc : 32;

    let html = `<div class="zdp-title" style="border-color:#f4b942;color:#f4b942;">CR6 &middot; C-List (${limit} slot${limit !== 1 ? 's' : ''})</div>`;
    html += `<div class="clist-select-hint">Click a name to insert into editor</div>`;
    html += `<table class="clist-select-table">`;
    let anyEntry = false;
    for (let j = 0; j < limit; j++) {
        const addr = clistBase + j;
        if (addr >= sim.memory.length) break;
        const gtWord = sim.memory[addr] >>> 0;
        if (gtWord === 0) {
            html += `<tr><td class="clist-sel-idx popup-sub-id">[${j}]</td><td class="zdp-dim" colspan="2">null</td></tr>`;
        } else {
            anyEntry = true;
            const lbl = (typeof _gtPetName === 'function') ? _gtPetName(gtWord) : '';
            const safeLbl = lbl ? lbl.replace(/\\/g, '\\\\').replace(/'/g, "\\'") : '';
            if (lbl) {
                let _permsStr = '';
                if (sim.parseGT) {
                    const _p = sim.parseGT(gtWord);
                    if (_p.type === 3 && sim.parseAbstractGT) {
                        const _ab = sim.parseAbstractGT(gtWord);
                        if (_ab.R) _permsStr += 'R';
                        if (_ab.W) _permsStr += 'W';
                    } else {
                        const _pm = _p.permissions || {};
                        if (_pm.R) _permsStr += 'R';
                        if (_pm.W) _permsStr += 'W';
                        if (_pm.X) _permsStr += 'X';
                        if (_pm.E) _permsStr += 'E';
                    }
                }
                const _insertStr  = _permsStr ? `${lbl} ${_permsStr}` : lbl;
                const _safeInsert = _insertStr.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                const _permsBadge = _permsStr
                    ? ` <span class="clist-sel-perms">${_permsStr}</span>`
                    : '';
                html += `<tr>` +
                    `<td class="clist-sel-name" onclick="clistSelectName('${_safeInsert}')" title="Insert '${_insertStr}'">${lbl}${_permsBadge} <span class="clist-sel-arrow">&#x2B9E;</span></td>` +
                    `<td class="zdp-hex" style="font-size:0.71rem;">${hexW(gtWord)}</td>` +
                    `<td class="clist-sel-idx popup-sub-id">[${j}]</td>` +
                    `</tr>`;
            } else {
                html += `<tr>` +
                    `<td class="clist-sel-idx">[${j}]</td>` +
                    `<td class="zdp-hex" style="font-size:0.71rem;">${hexW(gtWord)}</td>` +
                    `<td></td>` +
                    `</tr>`;
            }
        }
    }
    if (!anyEntry) html += `<tr><td colspan="3" class="zdp-empty">C-List is empty</td></tr>`;
    html += `</table>`;

    const dismissBtn = `<button class="zdp-dismiss" onclick="hideCRPopup(true)" title="Close">&times;</button>`;
    pop.innerHTML = dismissBtn + html;
    pop.style.display = 'block';
    _positionPopup(pop, evt);
    cancelHideCRPopup();
    _startAutoFade();
}

function showCListSlotPopup(evt, clistBase, slotIdx, cc) {
    if (_crPopupSuppressed) return;
    cancelHideCRPopup();
    const pop = document.getElementById('cr-hover-popup');
    if (!pop || !sim) return;

    const hexW = w => '0x' + (w >>> 0).toString(16).toUpperCase().padStart(8, '0');
    const addr = clistBase + slotIdx;
    let html = '';

    const _ck = pass => pass
        ? `<span class="mload-pass">&#x2713; PASS</span>`
        : `<span class="mload-fail">&#x2717; FAIL</span>`;

    if (addr >= sim.memory.length) {
        html += `<div class="zdp-title" style="border-color:#ef4444;color:#f87171;">clist[${slotIdx}] &middot; OUT OF RANGE</div>`;
        html += `<table><tr><td colspan="2" class="zdp-dim">Address ${hexW(addr)} exceeds memory</td></tr></table>`;
    } else {
        const gtWord = sim.memory[addr] >>> 0;
        const lbl = (gtWord !== 0 && typeof _gtPetName === 'function') ? _gtPetName(gtWord) : '';
        const titleBorder = gtWord === 0 ? '#374151' : '#f4b942';
        const titleText   = gtWord === 0 ? '#6b7280' : '#f4b942';
        const titleMain   = lbl ? lbl : `clist[${slotIdx}]`;
        const titleSuffix = lbl
            ? ` <span class="popup-sub-id">\u00b7 slot\u00a0${slotIdx}</span>`
            : (gtWord === 0 ? ' \u00b7 NULL' : '');
        html += `<div class="zdp-title" style="border-color:${titleBorder};color:${titleText};">${titleMain}${titleSuffix}</div>`;
        html += `<table>`;

        if (gtWord !== 0) {
            html += `<tr><td>GT word</td><td class="zdp-hex">${hexW(gtWord)}</td></tr>`;
            if (sim.parseGT) {
                const gt = sim.parseGT(gtWord);
                if (gt) {
                    const perms = (gt.permissions.B?'B':'-')+(gt.permissions.R?'R':'-')+(gt.permissions.W?'W':'-')+(gt.permissions.X?'X':'-')+(gt.permissions.L?'L':'-')+(gt.permissions.S?'S':'-')+(gt.permissions.E?'E':'-');
                    html += `<tr><td>Type</td><td class="zdp-val">${gt.typeName || '?'}</td></tr>`;
                    html += `<tr><td>NS slot</td><td class="zdp-val">${gt.index}</td></tr>`;
                    html += `<tr><td>Perms</td><td class="zdp-val">${perms}</td></tr>`;
                }
            }
        } else {
            html += `<tr><td colspan="2" class="zdp-dim">Slot is unloaded / empty</td></tr>`;
        }

        html += `<tr><td colspan="2" class="mload-section-hdr">mLoad check &mdash; LOAD CR&middot;, CR6[${slotIdx}]</td></tr>`;

        const cr6Word0 = (sim.cr && sim.cr[6]) ? (sim.cr[6].word0 >>> 0) : 0;
        let versionPass = false, sealPass = false;
        if (cr6Word0 !== 0 && sim.parseGT && sim.readNSEntry && sim.validateMAC) {
            const parsedCR6 = sim.parseGT(cr6Word0);
            if (parsedCR6 && parsedCR6.index < sim.nsCount) {
                const nsEntry = sim.readNSEntry(parsedCR6.index);
                if (nsEntry) {
                    const nsGtSeq = (nsEntry.word2_seals >>> 25) & 0x7F;
                    versionPass = parsedCR6.gt_seq === nsGtSeq;
                    sealPass    = sim.validateMAC(nsEntry);
                }
            }
        }
        const boundsPass = (cc > 0) ? (slotIdx < cc) : (addr < sim.memory.length);
        const slotPass   = gtWord !== 0;
        const overallPass = versionPass && sealPass && boundsPass && slotPass;

        html += `<tr><td class="mload-lbl">CR6 version</td><td>${_ck(versionPass)}</td></tr>`;
        html += `<tr><td class="mload-lbl">CR6 seal</td><td>${_ck(sealPass)}</td></tr>`;
        html += `<tr><td class="mload-lbl">Bounds</td><td>${_ck(boundsPass)} <span class="zdp-dim">[${slotIdx}${cc > 0 ? '/' + cc : ''}]</span></td></tr>`;
        html += `<tr><td class="mload-lbl">Slot GT</td><td>${_ck(slotPass)}</td></tr>`;
        html += `<tr><td colspan="2" class="mload-overall ${overallPass ? 'mload-overall-pass' : 'mload-overall-fail'}">${overallPass ? '&#x2713; mLoad PASS' : '&#x2717; mLoad FAIL'}</td></tr>`;
        html += `</table>`;
    }

    const dismissBtn = `<button class="zdp-dismiss" onclick="hideCRPopup(true)" title="Close">&times;</button>`;
    pop.innerHTML = dismissBtn + html;
    pop.style.display = 'block';
    _positionPopup(pop, evt);
    cancelHideCRPopup();
    _startAutoFade();
}

function showCRPopup(evt, crIdx) {
    if (_crPopupSuppressed) return;
    cancelHideCRPopup();
    const pop = document.getElementById('cr-hover-popup');
    if (!pop || !sim) return;

    const cr = sim.getFormattedCR(crIdx);

    const hexW = w => '0x' + (w >>> 0).toString(16).toUpperCase().padStart(8, '0');
    const petCR = _petNameCRMap[crIdx];
    const _archNames = { 0: 'Result', 1: 'Arg 1', 5: 'Heap', 6: 'C-List', 12: 'Thread', 13: 'IRQ', 14: 'CLOOMC', 15: 'Namespace' };
    const _reservedCRs = new Set([0, 5, 6, 12, 13, 14, 15]);

    let html = '';

    if (cr.isNull) {
        const archName = _archNames[crIdx];
        const isReserved = _reservedCRs.has(crIdx);
        if (isReserved) {
            const _nullMain = archName || `CR${crIdx}`;
            const _nullSub  = archName ? ` <span class="popup-sub-id">(CR${crIdx})</span>` : '';
            html += `<div class="zdp-title" style="border-color:#6b7280;color:#9ca3af;">${_nullMain}${_nullSub} · NULL</div>`;
            html += `<table>`;
            html += `<tr><td>Status</td><td class="zdp-dim">NULL (all words zero)</td></tr>`;
            html += `<tr><td>Role</td><td class="zdp-note">Reserved (${archName || 'architectural'})</td></tr>`;
            html += `</table>`;
        } else {
            html += `<div class="zdp-title" style="border-color:#374151;color:#6b7280;">CR${crIdx} · EMPTY</div>`;
            html += `<table>`;
            html += `<tr><td>Status</td><td class="zdp-dim">Empty — available for use</td></tr>`;
            html += `<tr><td>Role</td><td class="zdp-note">Programmer register (CR1–CR4, CR7–CR11)</td></tr>`;
            html += `</table>`;
        }
    } else {

    const nsIdx = cr.gtIndex;
    const nsLabel = (sim.nsLabels && sim.nsLabels[nsIdx]) || '';
    const displayName = petCR || nsLabel || '';
    const _crMain = displayName || `CR${crIdx}`;
    const _crSub  = displayName ? ` <span class="popup-sub-id">(CR${crIdx})</span>` : '';
    const hasL = cr.perms.indexOf('L') !== -1;

    if (hasL) {
        html += `<div class="zdp-title" style="border-color:#f4b942;color:#f4b942;">${_crMain}${_crSub} · C-List</div>`;
        html += `<table>`;
        html += `<tr><td>Type</td><td class="zdp-val">${cr.gtTypeName}</td></tr>`;
        html += `<tr><td>NS Slot</td><td class="zdp-val">${nsLabel ? nsLabel+' <span class="popup-sub-id">('+nsIdx+')</span>' : nsIdx}</td></tr>`;
        html += `<tr><td>Location</td><td class="zdp-hex">${hexW(cr.word1_location)}</td></tr>`;

        const loc = cr.word1_location >>> 0;
        const hdrWord = (loc < sim.memory.length) ? (sim.memory[loc] >>> 0) : 0;
        const hdr = sim.parseLumpHeader(hdrWord);
        if (hdr.valid && hdr.cc > 0) {
            const lumpSize = hdr.lumpSize;
            const clistBase = loc + lumpSize - hdr.cc;
            html += `<tr><td colspan="2" style="color:#6b8faf;padding-top:0.25rem;">C-List entries (${hdr.cc} slots):</td></tr>`;
            for (let j = 0; j < hdr.cc; j++) {
                const addr = clistBase + j;
                if (addr >= sim.memory.length) break;
                const gtWord = sim.memory[addr] >>> 0;
                if (gtWord === 0) {
                    html += `<tr><td style="color:#f4b942;">[${j}]</td><td class="zdp-dim">NULL</td></tr>`;
                } else {
                    const gt = sim.parseGT(gtWord);
                    const perms = (gt.permissions.B?'B':'-')+(gt.permissions.R?'R':'-')+(gt.permissions.W?'W':'-')+(gt.permissions.X?'X':'-')+(gt.permissions.L?'L':'-')+(gt.permissions.S?'S':'-')+(gt.permissions.E?'E':'-');
                    const lbl = (typeof _gtPetName === 'function') ? _gtPetName(gtWord) : ((sim.nsLabels && sim.nsLabels[gt.index]) || '');
                    const lblStr = lbl ? ` <span class="zdp-lbl">(${lbl})</span>` : '';
                    html += `<tr><td style="color:#f4b942;">[${j}]</td><td class="zdp-hex">${hexW(gtWord)} <span class="zdp-note">${gt.typeName}</span> s=${gt.index}${lblStr} [${perms}]</td></tr>`;
                }
            }
        } else if (sim.nsClistMap && sim.nsClistMap[nsIdx]) {
            const children = sim.nsClistMap[nsIdx];
            html += `<tr><td colspan="2" style="color:#6b8faf;padding-top:0.25rem;">C-List children (${children.length}):</td></tr>`;
            for (let j = 0; j < children.length; j++) {
                const childIdx = children[j];
                const lbl = (sim.nsLabels && sim.nsLabels[childIdx]) || '';
                html += `<tr><td style="color:#f4b942;">[${j}]</td><td class="zdp-val">NS[${childIdx}]${lbl ? ' <span class="zdp-lbl">('+lbl+')</span>' : ''}</td></tr>`;
            }
        } else {
            html += `<tr><td colspan="2" class="zdp-empty">no c-list entries found</td></tr>`;
        }
        html += `</table>`;
    } else {
        const _deviceInfo = {
            11: { name: 'UART',   ioBase: '0xFE00', regs: ['TX','STATUS','RX'] },
            12: { name: 'LED',    ioBase: '0xFE10', regs: ['LED0','LED1','LED2','LED3','LED4'] },
            13: { name: 'Button', ioBase: '0xFE20', regs: ['BTN_STATE'] },
            14: { name: 'Timer',  ioBase: '0xFE30', regs: ['TICKS_LO','TICKS_HI','TOD_EPOCH','ALARM_CMP','ALARM_CTL'] },
        };
        const dev = _deviceInfo[nsIdx];
        if (dev) {
            html += `<div class="zdp-title" style="border-color:#4ade80;color:#4ade80;">${_crMain}${_crSub} · I/O Device</div>`;
            html += `<table>`;
            html += `<tr><td>Device</td><td class="zdp-val">${dev.name}</td></tr>`;
            html += `<tr><td>NS Slot</td><td class="zdp-val">${nsLabel ? nsLabel+' <span class="popup-sub-id">('+nsIdx+')</span>' : nsIdx}</td></tr>`;
            html += `<tr><td>Perms</td><td class="zdp-val">[${cr.perms}]</td></tr>`;
            html += `<tr><td>I/O Base</td><td class="zdp-hex">${dev.ioBase} <span class="zdp-lbl">(memory-mapped)</span></td></tr>`;
            html += `<tr><td>Registers</td><td class="zdp-val">${dev.regs.length}</td></tr>`;
            html += `<tr><td colspan="2" style="color:#6b8faf;padding-top:0.25rem;">Register map:</td></tr>`;
            for (let r = 0; r < dev.regs.length; r++) {
                const regAddr = parseInt(dev.ioBase, 16) + r;
                const regHex = '0x' + regAddr.toString(16).toUpperCase().padStart(4, '0');
                html += `<tr><td style="color:#4ade80;">[${r}]</td><td class="zdp-val">${regHex} ${dev.regs[r]}</td></tr>`;
            }
            html += `<tr><td>Role</td><td class="zdp-note">I/O range (device registers)</td></tr>`;
            html += `</table>`;
        } else {
            html += `<div class="zdp-title" style="border-color:#60a5fa;color:#60a5fa;">${_crMain}${_crSub}</div>`;
            html += `<table>`;
            html += `<tr><td>Type</td><td class="zdp-val">${cr.gtTypeName}</td></tr>`;
            html += `<tr><td>NS Slot</td><td class="zdp-val">${nsLabel ? nsLabel+' <span class="popup-sub-id">('+nsIdx+')</span>' : nsIdx}</td></tr>`;
            html += `<tr><td>Perms</td><td class="zdp-val">[${cr.perms}]</td></tr>`;
            html += `<tr><td>Location</td><td class="zdp-hex">${hexW(cr.word1_location)}</td></tr>`;
            html += `<tr><td>Limit</td><td class="zdp-hex">0x${cr.limit17.toString(16).toUpperCase().padStart(5, '0')}</td></tr>`;
            if (cr.perms.indexOf('X') !== -1) {
                html += `<tr><td>Role</td><td class="zdp-note">Code (executable)</td></tr>`;
                const baseLoc2 = cr.word1_location >>> 0;
                if (baseLoc2 < sim.memory.length) {
                    const lhdr2 = sim.parseLumpHeader ? sim.parseLumpHeader(sim.memory[baseLoc2] >>> 0) : null;
                    const cEnd2 = lhdr2 && lhdr2.valid ? baseLoc2 + 1 + lhdr2.cw : baseLoc2 + Math.min(cr.limit17 || 0, 64);
                    let isSelfLoop = false;
                    for (let _w = baseLoc2 + 1; _w < cEnd2 && _w < sim.memory.length; _w++) {
                        const _wd = sim.memory[_w] >>> 0;
                        if (((_wd >>> 27) & 0x1F) === 7) {
                            const _crDstIdx = (_wd >>> 19) & 0xF;
                            const _tmplCR = sim.getFormattedCR ? sim.getFormattedCR(_crDstIdx) : null;
                            if (_tmplCR && !_tmplCR.isNull && (_tmplCR.word1_location >>> 0) === baseLoc2) {
                                isSelfLoop = true;
                                break;
                            }
                        }
                    }
                    if (isSelfLoop) {
                        html += `<tr><td>Pattern</td><td class="zdp-note">&#x21BB; Self-loop <span class="zdp-lbl">(LAMBDA tail-call)</span></td></tr>`;
                    }
                }
            } else if (cr.perms.indexOf('R') !== -1 && cr.perms.indexOf('W') !== -1) {
                html += `<tr><td>Role</td><td class="zdp-note">Data (read/write)</td></tr>`;
            } else if (cr.perms.indexOf('R') !== -1) {
                html += `<tr><td>Role</td><td class="zdp-note">Data (read-only)</td></tr>`;
            } else if (cr.perms.indexOf('E') !== -1) {
                html += `<tr><td>Role</td><td class="zdp-note">Entry gate (callable)</td></tr>`;
            }
            html += `</table>`;
        }
    }
    }

    const dismissBtn = `<button class="zdp-dismiss" onclick="hideCRPopup(true)" title="Close">&times;</button>`;
    pop.innerHTML = dismissBtn + html;
    pop.style.display = 'block';
    _positionPopup(pop, evt);
    cancelHideCRPopup();
    _startAutoFade();
}

var _editorCREditActive = false;

function editCRCodeInEditor() {
    if (selectedCR === null) return;
    const crIdx = selectedCR;
    const cr = sim.getFormattedCR(crIdx);
    const baseLoc = cr.word1_location >>> 0;
    const nsIdx = cr.gtIndex;
    const word0 = (baseLoc < sim.memory.length) ? (sim.memory[baseLoc] >>> 0) : 0;
    const lumpHdr = sim.parseLumpHeader(word0);

    let codeStart = baseLoc;
    let codeLimit = (cr.limit17 || 0) + 1;
    if (lumpHdr.valid) {
        codeStart = baseLoc + 1;
        codeLimit = lumpHdr.cw;
    }

    const rawWords = [];
    for (let w = 0; w < codeLimit; w++) {
        const addr = codeStart + w;
        if (addr >= sim.memory.length) break;
        rawWords.push(sim.memory[addr] >>> 0);
    }
    let trimLen = rawWords.length;
    while (trimLen > 0 && rawWords[trimLen - 1] === 0) trimLen--;
    const trimmedWords = rawWords.slice(0, trimLen);

    const lines = [];
    const _lhCc       = lumpHdr.valid ? lumpHdr.cc : null;
    const _lhFree     = lumpHdr.valid ? (lumpHdr.lumpSize - 1 - lumpHdr.cw - lumpHdr.cc) : null;
    const _lhExtra    = lumpHdr.valid ? `, cc=${_lhCc}, ${_lhFree} free` : '';
    lines.push(`; Disassembly of CR${crIdx}  NS[${nsIdx}]  @ 0x${baseLoc.toString(16).toUpperCase().padStart(4,'0')}  (${codeLimit} word${codeLimit !== 1 ? 's' : ''}${_lhExtra})`);
    // Inject capabilities { } block from sidecar metadata when available.
    if (typeof _lumpsCache !== 'undefined' && Array.isArray(_lumpsCache) &&
            nsIdx !== null && nsIdx !== undefined) {
        const _lumpMeta = _lumpsCache.find(l =>
            l.ns_slot !== null && l.ns_slot !== undefined &&
            parseInt(l.ns_slot) === nsIdx);
        if (_lumpMeta && Array.isArray(_lumpMeta.capabilities) && _lumpMeta.capabilities.length > 0) {
            const _capItems = _lumpMeta.capabilities.map(c => {
                const _n = c.name || String(c);
                const _r = (c.grants || c.rights || []).join('');
                return _r ? `${_n} ${_r}` : _n;
            }).filter(Boolean).join(', ');
            lines.push(`capabilities { ${_capItems} }`);
            lines.push('');
        }
    }
    if (trimmedWords.length === 0) {
        lines.push('; (empty lump)');
    } else {
        lines.push(...ChurchAssembler.decompileWords(trimmedWords));
    }

    _editorCREditActive = true;
    _editorCREditCR = crIdx;
    _editorCREditNS = nsIdx;
    switchView('editor');
    const sel = document.getElementById('langSelector');
    if (sel) sel.value = 'assembly';
    const asmEd = document.getElementById('asmEditor');
    if (asmEd) {
        asmEd.value = lines.join('\n');
        // Title must match the code module name — look up the abstraction for this NS slot.
        if (typeof _updateEditorCodeName === 'function') {
            const _crLumpMeta = (typeof _lumpsCache !== 'undefined' && Array.isArray(_lumpsCache))
                ? _lumpsCache.find(l => l.ns_slot !== null && l.ns_slot !== undefined && parseInt(l.ns_slot) === nsIdx)
                : null;
            _updateEditorCodeName(_crLumpMeta ? (_crLumpMeta.abstraction || `CR${crIdx}`) : `CR${crIdx}`);
        }
        if (!asmEd._mtbfListenerAttached) {
            asmEd.addEventListener('input', function() {
                if (_simRunHash && _currentEditorHash() !== _simRunHash) {
                    _simRunHistory = [];
                    _simRunHash = '';
                    _faultFreeInstrTotal = 0;
                }
                _updateMtbfIndicator();
            });
            asmEd._mtbfListenerAttached = true;
        }
    }
    _simRunHash = '';
    _simRunHistory = [];
    _faultFreeInstrTotal = 0;
    switchCodeTab('console');
    _updateEditorPatchBar();
    _updateMtbfIndicator();
}

var _editorCREditCR = null;
var _editorCREditNS = null;

function showEditorCListPopup(evt) {
    return;
    cancelHideCRPopup();
    const pop = document.getElementById('cr-hover-popup');
    if (!pop) return;

    if (!sim || !sim.cr || !sim.cr[6]) {
        _showEditorCListNotice(pop, evt, 'Simulator not running \u2014 boot first, then run a program that sets CR6');
    } else {
        const cr6w0 = sim.cr[6].word0 >>> 0;
        const cr6w1 = sim.cr[6].word1 >>> 0;

        if (cr6w0 === 0 || cr6w1 === 0) {
            // Fallback: if a lump is being edited, show its own c-list directly
            if (_editorCREditNS !== null && sim.readNSEntry && sim.parseLumpHeader && sim.memory) {
                const _edNse = sim.readNSEntry(_editorCREditNS);
                if (_edNse) {
                    const _edLoc  = _edNse.word0_location >>> 0;
                    const _edW0   = _edLoc < sim.memory.length ? (sim.memory[_edLoc] >>> 0) : 0;
                    const _edHdr  = sim.parseLumpHeader(_edW0);
                    if (_edHdr && _edHdr.valid && _edHdr.cc > 0) {
                        const _edBase = _edLoc + _edHdr.lumpSize - _edHdr.cc;
                        showCListPopup(evt, _edBase, _edHdr.cc);
                        return;
                    }
                }
            }
            _showEditorCListNotice(pop, evt, 'No C-List loaded \u2014 run a program that sets CR6 first');
        } else {
            const clistBase = cr6w1;
            let cc = 0;
            if (sim.parseGT) {
                const gt = sim.parseGT(cr6w0);
                if (gt && gt.index !== undefined && sim.readNSEntry && sim.parseNSWord1) {
                    const nse = sim.readNSEntry(gt.index);
                    if (nse) {
                        const lim = sim.parseNSWord1(nse.word1_limit);
                        cc = (lim && lim.clistCount) || 0;
                    }
                }
            }
            showCListPopup(evt, clistBase, cc);
        }
    }

    setTimeout(function() {
        document.addEventListener('click', function _clistClickOut(e) {
            const _pop = document.getElementById('cr-hover-popup');
            if (!_pop || _pop.style.display === 'none') {
                document.removeEventListener('click', _clistClickOut);
                return;
            }
            if (!_pop.contains(e.target)) {
                hideCRPopup(true);
                document.removeEventListener('click', _clistClickOut);
            }
        });
    }, 0);
}

function showPetNameTip(evt, label) {
    const tip = document.getElementById('code-pet-tip');
    if (!tip) return;
    tip.textContent = label;
    tip.style.display = 'block';
    tip.style.left = (evt.clientX + 14) + 'px';
    tip.style.top  = (evt.clientY - 28) + 'px';
}

function hidePetNameTip() {
    const tip = document.getElementById('code-pet-tip');
    if (tip) tip.style.display = 'none';
}

function _showEditorCListNotice(pop, evt, msg) {
    const dismissBtn = `<button class="zdp-dismiss" onclick="hideCRPopup(true)" title="Close">&times;</button>`;
    pop.innerHTML = dismissBtn +
        `<div class="zdp-title" style="border-color:#374151;color:#6b7280;">C-List Picker</div>` +
        `<div class="zdp-empty" style="padding:0.4rem 0;">${msg}</div>`;
    pop.style.display = 'block';
    _positionPopup(pop, evt);
    _startAutoFade();
}

