function updateCRDetail() {
    if (selectedCR === null) return;
    const titleEl = document.getElementById('crDetailTitle');
    const contentEl = document.getElementById('crDetailContent');
    if (!titleEl || !contentEl) return;

    const crIdx = selectedCR;
    const cr = sim.getFormattedCR(crIdx);
    const localNames = {
        0: 'Result', 1: 'Arg 1', 5: 'Heap', 6: 'C-List',
        12: 'Thread', 13: 'IRQ', 14: 'CLOOMC', 15: 'Namespace'
    };
    const petCR = _petNameCRMap[crIdx];
    const name = petCR || localNames[crIdx] || '';

    if (cr.isNull) {
        titleEl.textContent = `CR${crIdx}${name ? ' \u2014 ' + name : ''} (NULL)`;
        contentEl.innerHTML = '<div style="color:var(--text-secondary);padding:1rem;">Register is empty (all words zero).</div>';
        contentEl.classList.remove('crd-content-thread');
        return;
    }

    titleEl.innerHTML = `CR${crIdx}${name ? ' \u2014 <span style="color:var(--church-blue)">' + name + '</span>' : ''} <button class="btn btn-sm" onclick="switchDashTab(\'cr\')" style="margin-left:1rem;font-size:0.7rem;">\u2190 Back</button>`;

    const parsedPerms = sim.parseGT(sim.cr[crIdx].word0).permissions;
    const hasX = parsedPerms.X;
    const hasL = parsedPerms.L;
    const hasR = parsedPerms.R;
    const hasW = parsedPerms.W;
    const crMbit = sim.cr[crIdx].m;
    const nsIdx = cr.gtIndex;

    const codeRegs = [7];
    const clistRegs = [6];
    const threadRegs = [8, 12];
    const nsRegs = [15];
    const showCode = hasX || (crMbit && codeRegs.includes(crIdx));
    const showCList = hasL || (crMbit && clistRegs.includes(crIdx));
    const showThread = THREAD_NS_SLOTS.has(nsIdx) || (crMbit && threadRegs.includes(crIdx));
    const showNS = crMbit && nsRegs.includes(crIdx);
    const showData = (hasR || hasW) && !showCode && !showCList;

    // Check if the base location holds a valid lump header (needed for Edit button).
    const _editBaseLoc = cr.word1_location >>> 0;
    const _editWord0 = (_editBaseLoc < sim.memory.length) ? (sim.memory[_editBaseLoc] >>> 0) : 0;
    const _editLumpHdr = sim.parseLumpHeader(_editWord0);
    const showEditButton = showCode && _editLumpHdr.valid;

    let html = '';
    html += '<div class="crd-tabs">';
    html += `<button class="crd-tab${crDetailTab==='content'?' active':''}" id="crdTab-content" onclick="switchCRDetailTab('content')">Content</button>`;
    html += `<button class="crd-tab${crDetailTab==='register'?' active':''}" id="crdTab-register" onclick="switchCRDetailTab('register')">Register</button>`;
    html += `<button class="crd-tab${crDetailTab==='binary'?' active':''}" id="crdTab-binary" onclick="switchCRDetailTab('binary')">Binary</button>`;
    if (showThread) {
        html += `<span class="crd-zone-nav" title="Jump to zone · hover for live data">`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone('hdr')" onmouseenter="showZonePopup(event,'hdr',${nsIdx})" onmouseleave="hideZonePopup()">Hdr</button>`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(5)" onmouseenter="showZonePopup(event,5,${nsIdx})" onmouseleave="hideZonePopup()">⑤\u202FDR</button>`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(4)" onmouseenter="showZonePopup(event,4,${nsIdx})" onmouseleave="hideZonePopup()">④\u202FHeap</button>`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(3)" onmouseenter="showZonePopup(event,3,${nsIdx})" onmouseleave="hideZonePopup()">③\u202FFree</button>`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(2)" onmouseenter="showZonePopup(event,2,${nsIdx})" onmouseleave="hideZonePopup()">②\u202FStack</button>`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(1)" onmouseenter="showZonePopup(event,1,${nsIdx})" onmouseleave="hideZonePopup()">①\u202FCaps</button>`;
        html += `</span>`;
    }
    if (showEditButton) {
        html += `<button class="crd-tab crd-tab-action" onclick="editCRCodeInEditor()" data-tooltip="Edit — Load this code lump into the assembly editor">&#x270E; Edit</button>`;
        html += `<button class="crd-tab crd-tab-action" onclick="patchSimulator()" data-tooltip="Patch — Assemble editor code and write it directly into simulator memory at this lump\u2019s base address. Updates lump header, NS limit, and CRC automatically.">&#x21A9; Patch</button>`;
        html += `<button class="crd-tab crd-tab-action crd-tab-fpga" onclick="patchFPGA()" data-tooltip="Patch FPGA — Runs Patch Simulator first, then uploads the updated lump to the Ti60 F225 over WebSerial (UART). Requires an active hardware connection.">&#x21A9; Patch FPGA</button>`;
        html += `<button class="crd-tab crd-tab-action crd-tab-fpga" onclick="exportPatchFile()" data-tooltip="Export Patch — Assembles the code and downloads a .patch file with UART frames, CRC, and RUN sentinel. Flash with: python3 patch_fpga.py /dev/ttyUSB1 file.patch">&#x2B73; Export Patch</button>`;
        html += `<button class="crd-tab crd-tab-action crd-tab-fpga" onclick="exportLumpAsPatch()" data-tooltip="Lump\u2192Patch — Pick a pre-built .lump binary, validate its header, and wrap it into a .patch UART frame file for FPGA flashing.">&#x2B73; Lump&#x2192;Patch</button>`;
        html += `<button class="crd-tab crd-tab-action" onclick="publishToLibrary()" data-tooltip="Publish — Compile and publish this abstraction to the Mum Tunnel Library on GitHub, including machine words, c-list, source, and metadata." style="background:#4a7a2e;">&#x21E1; Publish</button>`;
    }
    html += '</div>';

    html += `<div class="crd-panel" id="crdPanel-content" style="display:${crDetailTab==='content'?'block':'none'}">`;
    html += '<div class="cr-detail-grid">';

    if (showCode) {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">Code View \u2014 Executable Memory</div>';
        const baseLoc   = cr.word1_location >>> 0;
        const limitVal  = cr.limit17;
        const asm       = new ChurchAssembler();

        const word0 = (baseLoc < sim.memory.length) ? (sim.memory[baseLoc] >>> 0) : 0;
        const lumpHdr = sim.parseLumpHeader(word0);

        let codeStart = baseLoc;
        let codeLimit = limitVal + 1;

        let _lumpClistBase = 0;
        if (lumpHdr.valid && lumpHdr.cc > 0) {
            _lumpClistBase = baseLoc + lumpHdr.lumpSize - lumpHdr.cc;
        } else {
            const _nsE = sim.readNSEntry(nsIdx);
            if (_nsE) {
                const _nsLim = sim.parseNSWord1(_nsE.word1_limit);
                if (_nsLim.clistCount > 0) {
                    _lumpClistBase = (_nsE.word0_location >>> 0) + (_nsLim.limit + 1) - _nsLim.clistCount;
                }
            }
        }

        let _codeStartPre = codeStart, _codeLimitPre = codeLimit;
        if (lumpHdr.valid) { _codeStartPre = baseLoc + 1; _codeLimitPre = lumpHdr.cw; }
        const _codeWords = [];
        for (let w = 0; w < _codeLimitPre; w++) {
            const a = _codeStartPre + w;
            if (a >= sim.memory.length) break;
            _codeWords.push(sim.memory[a] >>> 0);
        }
        const _brArrows = _computeBranchArrows(_codeWords);

        let codeHtml = '<table class="cr-table code-view-table"><thead><tr>';
        codeHtml += '<th>Addr</th><th>Hex</th><th>Instruction</th>';
        if (_brArrows.hasBranches) codeHtml += '<th class="br-arrow-hdr"></th>';
        codeHtml += '<th class="code-decompiled-hdr">Decompiled</th>';
        codeHtml += '</tr></thead><tbody>';

        if (nsIdx === bootEntrySlot) {
            const _beLabel = (sim.nsLabels && sim.nsLabels[bootEntrySlot]) || `Slot ${bootEntrySlot}`;
            const _bootPreamble = [
                { addr: 'B:00', desc: 'FAULT_RST',   decomp: 'CR0\u2013CR15 \u2190 NULL \u00b7 DR0\u2013DR15 \u2190 0' },
                { addr: 'B:01', desc: 'LOAD_NS',     decomp: 'CR15 \u2190 NS[0] Namespace (M=1, base=0x0000, perms=none)' },
                { addr: 'B:02', desc: 'INIT_THRD',   decomp: 'CR12 \u2190 NS[1] thread stack GT (M=1, Inform, perms=none) \u00b7 CR5 \u2190 heap (RW, Inform, Slot\u00a01)' },
                { addr: 'B:02\u00BD', desc: 'CALL_HOME',  decomp: 'Tunnel.Register \u2192 23-byte packet [0xCE11, board, FW, HMAC(4), UID(8), reason, fault, NIA(4)] \u00b7 await ACK' },
                { addr: 'B:03', desc: 'INIT_ABSTR',  decomp: `CR6 \u2190 NS[${bootEntrySlot}] \u26a1 ${_beLabel} (M=1, E-type, transient)` },
                { addr: 'B:04', desc: 'LOAD_NUC',    decomp: 'CR14(M=1, R+X) + CR6(M=1, L) \u2190 header \u00b7 push sentinel \u00b7 PC\u21900' },
                { addr: 'B:05', desc: 'COMPLETE',    decomp: 'bootComplete \u2190 true \u00b7 new CRs get M=0 \u00b7 dispatch begins' },
            ];
            const _arrowTd = _brArrows.hasBranches ? '<td class="br-arrow-col"></td>' : '';
            for (const bp of _bootPreamble) {
                codeHtml += `<tr class="code-row-infra">`;
                codeHtml += `<td class="cr-idx">${bp.addr}</td>`;
                codeHtml += `<td class="cr-gt">\u2014</td>`;
                codeHtml += `<td class="code-disasm">${bp.desc}</td>`;
                codeHtml += _arrowTd;
                codeHtml += `<td class="code-decompiled code-decompiled-infra">${bp.decomp}</td>`;
                codeHtml += '</tr>';
            }
        }

        if (lumpHdr.valid) {
            const typNames  = ['code', 'data', 'thread', 'outform'];
            const typStr    = typNames[lumpHdr.typ] || String(lumpHdr.typ);
            const hdrDisasm = `.header ${typStr} n\u22126=${lumpHdr.n_minus_6}\u2192${lumpHdr.lumpSize}w`
                            + ` cw=${lumpHdr.cw} cc=${lumpHdr.cc}`;
            codeHtml += `<tr class="code-row-infra">`;
            codeHtml += `<td class="cr-idx">0x${baseLoc.toString(16).toUpperCase().padStart(4,'0')}</td>`;
            codeHtml += `<td class="cr-gt">0x${word0.toString(16).toUpperCase().padStart(8,'0')}</td>`;
            codeHtml += `<td class="code-disasm">${hdrDisasm}</td>`;
            if (_brArrows.hasBranches) codeHtml += '<td class="br-arrow-col"></td>';
            const _hdrLumpName = (sim.nsLabels && sim.nsLabels[nsIdx]) || (nsIdx >= 0 ? `Slot ${nsIdx}` : '');
            codeHtml += `<td class="code-decompiled code-decompiled-infra">header${_hdrLumpName ? ' \u00b7 <span style="color:#4ec9b0;font-weight:600;">' + _hdrLumpName + '</span>' : ''}</td>`;
            codeHtml += '</tr>';
            codeStart = baseLoc + 1;
            codeLimit = lumpHdr.cw;
        }

        const _crPets3 = {};

        const _brLabelCondNames = ['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE','','NV'];
        const _brTargetSet = new Set();
        for (let i = 0; i < _codeWords.length; i++) {
            const _w = _codeWords[i] >>> 0;
            if (((_w >>> 27) & 0x1F) !== 17) continue;
            const _rawImm = _w & 0x7FFF;
            const _soff = (_rawImm & 0x4000) ? (_rawImm | 0xFFFF8000) : _rawImm;
            const _tgt = i + _soff;
            if (_tgt >= 0 && _tgt < _codeWords.length) _brTargetSet.add(_tgt);
        }
        const _brLabelMap = new Map();
        Array.from(_brTargetSet).sort((a, b) => a - b).forEach((idx, n) => _brLabelMap.set(idx, `L${n}`));

        let hasCodeData = lumpHdr.valid;
        for (let w = 0; w < _codeWords.length; w++) {
            const addr = codeStart + w;
            const word = _codeWords[w];
            if (word === 0 && !hasCodeData) continue;
            hasCodeData = true;
            const isPC    = lumpHdr.valid
                ? (addr === baseLoc + 1 + sim.pc)
                : ((addr === (sim.programBaseAddr || 0) + sim.pc) || (addr === sim.pc));
            const isBP    = simBreakpoints.has(addr);

            if (_brLabelMap.has(w)) {
                const _lbl = _brLabelMap.get(w);
                const _colspan = _brArrows.hasBranches ? 5 : 4;
                codeHtml += `<tr class="code-row-label"><td colspan="${_colspan}" class="code-label-line">${_lbl}:</td></tr>`;
            }

            const decomp = _decompileWord(word, addr, nsIdx, _lumpClistBase, _crPets3);
            const isCompiler = decomp && decomp.compiler;
            let rowClass = isPC ? 'code-pc-row' : (isBP ? 'code-bp-row' : (isCompiler ? 'code-row-compiler' : ''));

            let decoded;
            if (word === 0) {
                decoded = 'NOP / HALT';
            } else if (((word >>> 27) & 0x1F) === 17) {
                const _rawImm = word & 0x7FFF;
                const _soff = (_rawImm & 0x4000) ? (_rawImm | 0xFFFF8000) : _rawImm;
                const _tgt = w + _soff;
                const _condCode = (word >>> 23) & 0xF;
                const _mnemonic = 'BRANCH' + _brLabelCondNames[_condCode];
                const _labelName = _brLabelMap.get(_tgt);
                decoded = _labelName !== undefined
                    ? _wrapRegHover(`${_mnemonic}  ${_labelName}`)
                    : _wrapRegHover(asm.disassemble(word));
            } else {
                decoded = _wrapRegHover(asm.disassemble(word));
            }
            const bpDot    = isBP ? '<span class="bp-dot" title="Breakpoint">&#x25CF;</span> ' : '';
            const decompTd = decomp
                ? `<td class="code-decompiled ${isCompiler ? 'code-decompiled-compiler' : 'code-decompiled-user'}">${_wrapRegHover(decomp.desc)}</td>`
                : '<td class="code-decompiled"></td>';

            codeHtml += `<tr class="${rowClass}" style="cursor:pointer;" title="Double-click to set breakpoint" ondblclick="openBreakPopoverAt(${addr})">`;
            codeHtml += `<td class="cr-idx">0x${addr.toString(16).toUpperCase().padStart(4,'0')}</td>`;
            codeHtml += `<td class="cr-gt">0x${word.toString(16).toUpperCase().padStart(8,'0')}</td>`;
            codeHtml += `<td class="code-disasm">${bpDot}${decoded}</td>`;
            if (_brArrows.hasBranches) codeHtml += `<td class="br-arrow-col">${_brArrows.html[w]}</td>`;
            codeHtml += decompTd;
            codeHtml += '</tr>';
        }
        codeHtml += '</tbody></table>';

        if (!hasCodeData) {
            html += '<div style="color:var(--text-secondary);padding:0.5rem;">No code loaded in this memory range (0x' +
                baseLoc.toString(16).toUpperCase().padStart(4,'0') + ' \u2013 0x' +
                (baseLoc + limitVal).toString(16).toUpperCase().padStart(4,'0') + ').</div>';
        } else {
            if (lumpHdr.valid && codeLimit === 0) {
                codeHtml = codeHtml.replace('</tbody>', `<tr><td colspan="4" style="color:#555;font-style:italic;padding:0.3rem 0.5rem;">` +
                    `(cw=0 \u2014 no instruction words in this lump)</td></tr></tbody>`);
            }
            html += codeHtml;
        }

        html += `<pre id="crInjectLog" class="cr-inject-log" style="display:none;"></pre>`;

        html += '</div>';
    }

    if (showCList) {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">C-List View \u2014 Capability Slots</div>';
        const clistBase = cr.word1_location >>> 0;
        const clistCount = cr.limit17 + 1;
        html += '<table class="cr-table"><thead><tr>';
        html += '<th>Slot</th><th>GT Word</th><th>NS Idx</th><th>Type</th><th>Perms</th><th>Pet Name</th>';
        html += '</tr></thead><tbody>';
        for (let i = 0; i < clistCount; i++) {
            const addr = clistBase + i;
            const gtWord = (addr < sim.memory.length) ? (sim.memory[addr] >>> 0) : 0;
            const parsed = sim.parseGT(gtWord);
            const permsStr = Object.entries(parsed.permissions).filter(([,v]) => v).map(([k]) => k).join('');
            const nsLabel = (sim.nsLabels && sim.nsLabels[parsed.index]) ? sim.nsLabels[parsed.index] : '';
            const isExpanded = (clistExpandedIdx === i);
            const hasGT = gtWord !== 0;
            html += `<tr class="${hasGT ? 'cr-active clist-clickable' : ''}${isExpanded ? ' clist-selected' : ''}" `;
            html += hasGT ? `onclick="toggleCListEntry(${i})" title="Click to inspect NS[${parsed.index}]"` : '';
            html += '>';
            html += `<td class="cr-idx">${i}</td>`;
            html += `<td class="cr-gt">0x${gtWord.toString(16).toUpperCase().padStart(8,'0')}</td>`;
            html += `<td>${hasGT ? parsed.index : '\u2014'}</td>`;
            html += `<td>${hasGT ? parsed.typeName : '\u2014'}</td>`;
            html += `<td class="cr-perms">[${permsStr || '\u2014'}]</td>`;
            html += `<td class="cr-name">${nsLabel}</td>`;
            html += '</tr>';
            if (isExpanded && hasGT) {
                const nsEntry = sim.readNSEntry(parsed.index);
                if (nsEntry) {
                    html += `<tr class="clist-detail-row"><td colspan="6">${renderCListEntryDetail(parsed.index, nsEntry)}</td></tr>`;
                }
            }
        }
        html += '</tbody></table>';
        html += '</div>';
    }

    if (showThread) {
        html += '<div class="cr-detail-section cr-detail-section-thread">';
        html += renderThreadMemoryLayout(nsIdx);
        html += '</div>';
    }

    if (showNS) {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">Namespace Root \u2014 All Entries</div>';
        if (sim.nsCount === 0) {
            html += '<div style="color:var(--text-secondary);padding:0.5rem;">Namespace table is empty.</div>';
        } else {
            html += '<table class="cr-table"><thead><tr>';
            html += '<th>Idx</th><th>Label</th><th>W0: Location</th><th>W1: Type</th><th>W1: F</th><th>W1: G</th><th>W1: Chain</th>';
            html += '</tr></thead><tbody>';
            const typeNames = ['NULL','Inform','Outform','Abstract'];
            for (let i = 0; i < sim.nsCount; i++) {
                const e = sim.readNSEntry(i);
                if (!e) continue;
                const loc = e.word0_location >>> 0;
                html += '<tr class="cr-active">';
                html += `<td class="cr-idx">${i}</td>`;
                html += `<td class="cr-name">${e.label || ''}</td>`;
                html += `<td>0x${loc.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                html += `<td>${typeNames[e.gtType] || '?'}</td>`;
                html += `<td class="cr-flag">${sim.parseNSWord1(e.word1_limit).f}</td>`;
                html += `<td class="cr-flag">${e.gBit}</td>`;
                html += `<td>${e.chainable ? 'Yes' : 'No'}</td>`;
                html += '</tr>';
            }
            html += '</tbody></table>';
        }
        html += '</div>';
    }

    if (showData) {
        const dataBase = cr.word1_location >>> 0;
        const dataLimit = cr.limit17;
        const wordCount = Math.min(dataLimit + 1, 64);
        const nsEntryD = sim.readNSEntry(nsIdx);
        const nsLabel = nsEntryD ? (nsEntryD.label || `NS[${nsIdx}]`) : `NS[${nsIdx}]`;
        const permDesc = [hasR ? 'R' : '', hasW ? 'W' : ''].filter(Boolean).join('|');

        const DEVICE_SLOTS = { 12: 'LED', 11: 'UART', 13: 'Button', 14: 'Timer' };
        const isDevice = nsIdx in DEVICE_SLOTS;

        html += '<div class="cr-detail-section">';
        html += `<div class="cr-detail-heading">Data View \u2014 ${nsLabel} (NS[${nsIdx}]) [${permDesc}]</div>`;

        html += '<table class="cr-table cr-detail-words"><tbody>';
        html += `<tr><td style="color:var(--church-blue)">Target</td><td>NS[${nsIdx}] \u2014 <strong>${nsLabel}</strong></td></tr>`;
        html += `<tr><td style="color:var(--church-blue)">Permissions</td><td class="cr-perms">[${permDesc}]</td></tr>`;
        html += `<tr><td style="color:var(--church-blue)">Base address</td><td>0x${dataBase.toString(16).toUpperCase().padStart(8,'0')}</td></tr>`;
        html += `<tr><td style="color:var(--church-blue)">Size</td><td>${wordCount} word${wordCount !== 1 ? 's' : ''} (limit ${dataLimit})</td></tr>`;
        if (isDevice) {
            html += `<tr><td style="color:var(--church-blue)">Kind</td><td style="color:var(--church-yellow)">Hardware Device \u2014 ${DEVICE_SLOTS[nsIdx]}</td></tr>`;
        }
        html += '</tbody></table>';

        if (isDevice && nsIdx === 12) {
            // LED_DEV: 5 registers (offset 0-4 = LED0-LED4); bit[0] = R (red) drives pin
            // Only bit[0] physically lights the LED on Ti60 F225 — bits[2:1] are G,B (wired but no pin)
            html += '<div class="cr-detail-heading" style="margin-top:0.75rem;">LED Registers</div>';
            html += '<table class="cr-table code-view-table" style="margin-bottom:0.3rem;">';
            html += '<thead><tr><th>Offset</th><th>Name</th><th>Hex</th><th>Pin</th></tr></thead><tbody>';
            for (let ledIdx = 0; ledIdx <= 4; ledIdx++) {
                const addr = dataBase + ledIdx;
                const val = (addr < sim.memory.length) ? (sim.memory[addr] >>> 0) : 0;
                const rBit = val & 1;  // bit[0] = R = drives LED pin
                const pinLabel = ledIdx <= 3 ? (rBit ? 'ON' : 'off') : (rBit ? 'ON (no pin)' : '—');
                const pinColor = (rBit && ledIdx <= 3) ? '#22ff44' : (rBit ? '#ffaa22' : 'var(--text-secondary)');
                html += `<tr>`;
                html += `<td class="cr-idx">+${ledIdx}</td>`;
                html += `<td>LED${ledIdx}</td>`;
                html += `<td class="cr-gt">0x${val.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                html += `<td style="color:${pinColor};font-weight:${rBit?'bold':'normal'}">${pinLabel}</td>`;
                html += `</tr>`;
            }
            html += '</tbody></table>';
            html += '<div style="color:var(--text-secondary);font-size:0.72rem;padding-bottom:0.3rem;">bit[0]=R drives pin · bit[1]=G · bit[2]=B (Ti60: only R connected)</div>';
        }

        if (wordCount > 0 && nsIdx !== 12) {
            // LED device (nsIdx=12) already shows its registers in the LED Registers table above
            html += '<div class="cr-detail-heading" style="margin-top:0.75rem;">Memory Contents</div>';
            html += '<table class="cr-table code-view-table"><thead><tr><th>Addr</th><th>Hex</th><th>Dec</th></tr></thead><tbody>';
            for (let w = 0; w < wordCount; w++) {
                const addr = dataBase + w;
                if (addr >= sim.memory.length) break;
                const val = sim.memory[addr] >>> 0;
                html += '<tr>';
                html += `<td class="cr-idx">+${w}</td>`;
                html += `<td class="cr-gt">0x${val.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                html += `<td>${val}</td>`;
                html += '</tr>';
            }
            html += '</tbody></table>';
        }
        html += '</div>';
    }

    if (!showCode && !showCList && !showThread && !showNS && !showData) {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">Capability Info</div>';
        html += '<div style="color:var(--text-secondary);padding:0.5rem;">GT permissions control visibility. This capability does not grant viewable access (no R, W, X, or L). Run boot sequence to populate registers.</div>';
        html += '</div>';
    }

    html += '</div></div>';

    html += `<div class="crd-panel" id="crdPanel-register" style="display:${crDetailTab==='register'?'block':'none'}">`;
    html += '<div class="cr-detail-grid">';

    html += '<div class="cr-detail-section">';
    html += '<div class="cr-detail-heading">128-bit Context Register Words</div>';
    html += '<table class="cr-table cr-detail-words"><thead><tr>';
    html += '<th>Word</th><th>Value</th><th>Decoded</th>';
    html += '</tr></thead><tbody>';
    html += `<tr><td>R0: GT</td><td class="cr-gt">0x${cr.word0_gt}</td><td>[${cr.perms}] Seq=${cr.gtSeq} Idx=${cr.gtIndex} Type=${cr.gtTypeName}</td></tr>`;
    html += `<tr><td>R1: Location</td><td>0x${cr.word1_location.toString(16).toUpperCase().padStart(8,'0')}</td><td>Base address in memory</td></tr>`;
    html += `<tr><td>R2: Limit</td><td>F=${cr.limitF} Limit=0x${cr.limit17.toString(16).toUpperCase().padStart(5,'0')}</td><td>Far=${cr.limitF} Size=${cr.limit17 + 1} words</td></tr>`;
    html += `<tr><td>R3: Seals</td><td>Seq=${cr.sealGtSeq} CRC=0x${cr.sealCRC.toString(16).toUpperCase().padStart(4,'0')}</td><td>Integrity seal (CRC-16/CCITT)</td></tr>`;
    html += `<tr><td>M bit</td><td class="${cr.mBit ? 'cr-m-set' : ''}">${cr.mBit}</td><td>${cr.mBit ? 'Written under M elevation (boot gift)' : 'Normal write'}</td></tr>`;
    html += '</tbody></table>';
    html += '</div>';

    const nsEntry = sim.readNSEntry(nsIdx);
    if (nsEntry) {
        const entry = nsEntry;
        html += '<div class="cr-detail-section">';
        html += `<div class="cr-detail-heading">Namespace Entry [${nsIdx}] \u2014 ${entry.label || 'unnamed'}</div>`;

        const loc = entry.word0_location >>> 0;
        const lim = sim.parseNSWord1(entry.word1_limit);
        const sealGtSeq = (entry.word2_seals >>> 25) & 0x7F;
        const sealCRC = entry.word2_seals & 0xFFFF;
        const gtPermStr = cr.perms;
        const typeNames = ['NULL','Inform','Outform','Abstract'];

        html += '<table class="cr-table"><tbody>';
        html += `<tr><td>W0: Location</td><td>0x${loc.toString(16).toUpperCase().padStart(8,'0')}</td></tr>`;
        html += `<tr><td>W1: Type</td><td>${typeNames[entry.gtType] || '?'}</td></tr>`;
        html += `<tr><td>W1: F (Far)</td><td>${lim.f}</td></tr>`;
        html += `<tr><td>W1: G (GC)</td><td>${entry.gBit}</td></tr>`;
        html += `<tr><td>W1: Chainable</td><td>${entry.chainable ? 'Yes' : 'No'}</td></tr>`;
        html += `<tr><td>W1: Limit</td><td>0x${lim.limit.toString(16).toUpperCase().padStart(5,'0')} (${lim.limit + 1} words)</td></tr>`;
        html += `<tr><td>W2: GT Seq</td><td>${sealGtSeq}</td></tr>`;
        html += `<tr><td>W2: CRC Seal</td><td>0x${sealCRC.toString(16).toUpperCase().padStart(4,'0')}</td></tr>`;
        const w3raw = (entry.word3_abstract_gt || 0) >>> 0;
        const w3PermBits = (w3raw >>> 25) & 0x3F;
        const w3PermStr = [['R',1],['W',2],['X',4],['L',8],['S',16],['E',32]].filter(([,b]) => w3PermBits & b).map(([n]) => n).join('') || '-';
        html += `<tr><td>W3: Abstract GT</td><td>0x${w3raw.toString(16).toUpperCase().padStart(8,'0')} <span style="color:#aaa;font-size:0.85em;">[${w3PermStr}]</span></td></tr>`;
        html += `<tr><td>CR Permissions</td><td>[${gtPermStr}]</td></tr>`;
        if (entry.codeLength !== undefined) {
            html += `<tr><td>Code Length</td><td>${entry.codeLength} words (${entry.codeLength * 4} bytes)</td></tr>`;
        }
        html += '</tbody></table>';
        html += '</div>';
    }

    if ((showCode || showCList) && nsEntry) {
        const lumpBase = nsEntry.word0_location >>> 0;
        const lumpWord0 = (lumpBase < sim.memory.length) ? (sim.memory[lumpBase] >>> 0) : 0;
        const lHdr = sim.parseLumpHeader(lumpWord0);
        if (lHdr.valid) {
            const cw = lHdr.cw;
            const cc = lHdr.cc;
            const lumpSz = lHdr.lumpSize;
            const clistStart = lumpSz - cc;
            const freeStart = 1 + cw;
            const freeWords = clistStart - freeStart;
            const typNames = ['lump', 'data', 'thread', 'outform'];
            const typStr = typNames[lHdr.typ] || String(lHdr.typ);
            const hexW = n => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
            const hexA = n => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(4, '0');

            html += '<div class="cr-detail-section">';
            html += `<div class="cr-detail-heading">Lump Layout \u2014 ${lumpSz} words at ${hexA(lumpBase)}</div>`;

            html += '<table class="cr-table"><tbody>';
            html += `<tr><td>Raw Header</td><td>${hexW(lumpWord0)}</td></tr>`;
            html += `<tr><td>Magic</td><td>0x1F (valid)</td></tr>`;
            html += `<tr><td>n\u22126</td><td>${lHdr.n_minus_6} \u2192 2<sup>${lHdr.n_minus_6 + 6}</sup> = ${lumpSz} words (${lumpSz * 4} bytes)</td></tr>`;
            html += `<tr><td>Type</td><td>${lHdr.typ} (${typStr})</td></tr>`;
            html += `<tr><td>Code Words (cw)</td><td>${cw}</td></tr>`;
            html += `<tr><td>C-List Slots (cc)</td><td>${cc}</td></tr>`;
            html += '</tbody></table>';

            html += '<div class="lump-map">';
            const barTotal = 300;
            const hdrPx = Math.max(6, Math.round((1 / lumpSz) * barTotal));
            const cwPx  = Math.max(cw > 0 ? 6 : 0, Math.round((cw / lumpSz) * barTotal));
            const ccPx  = Math.max(cc > 0 ? 6 : 0, Math.round((cc / lumpSz) * barTotal));
            const freePx = Math.max(barTotal - hdrPx - cwPx - ccPx, 0);

            html += `<div class="lump-map-bar">`;
            html += `<div class="lump-seg lump-seg-hdr" style="width:${hdrPx}px" title="Header: +0 (${hexA(lumpBase)})"></div>`;
            if (cwPx > 0)  html += `<div class="lump-seg lump-seg-code" style="width:${cwPx}px" title="Code: +1..+${cw} (${hexA(lumpBase + 1)}..${hexA(lumpBase + cw)})"></div>`;
            if (freePx > 0) html += `<div class="lump-seg lump-seg-free" style="width:${freePx}px" title="Free: +${freeStart}..+${clistStart - 1} (${freeWords} words)"></div>`;
            if (ccPx > 0)  html += `<div class="lump-seg lump-seg-clist" style="width:${ccPx}px" title="C-List: +${clistStart}..+${lumpSz - 1} (${cc} slots)"></div>`;
            html += `</div>`;

            html += `<div class="lump-map-legend">`;
            html += `<span class="lump-leg"><span class="lump-swatch lump-swatch-hdr"></span>Header +0</span>`;
            html += `<span class="lump-leg"><span class="lump-swatch lump-swatch-code"></span>Code +1\u2026+${cw} (${cw}w)</span>`;
            html += `<span class="lump-leg"><span class="lump-swatch lump-swatch-free"></span>Free +${freeStart}\u2026+${clistStart - 1} (${freeWords}w)</span>`;
            html += `<span class="lump-leg"><span class="lump-swatch lump-swatch-clist"></span>C-List +${clistStart}\u2026+${lumpSz - 1} (${cc}w)</span>`;
            html += `</div>`;

            html += '</div>';
            html += '</div>';
        }
    }

    html += '</div></div>';

    html += `<div class="crd-panel" id="crdPanel-binary" style="display:${crDetailTab==='binary'?'block':'none'}">`;
    html += '<div class="cr-detail-grid">';
    html += '<div class="cr-detail-section">';
    html += '<div class="cr-detail-heading">Memory Image \u2014 Raw Binary Data</div>';
    const baseLoc2 = cr.word1_location >>> 0;
    const limitVal2 = cr.limit17;
    const dumpCount = Math.min(limitVal2 + 1, 256);
    let nonZeroCount = 0;
    for (let w = 0; w < dumpCount; w++) {
        if (baseLoc2 + w < sim.memory.length && sim.memory[baseLoc2 + w] !== 0) nonZeroCount++;
    }
    html += `<div style="color:var(--text-secondary);font-size:0.72rem;margin-bottom:0.5rem;">Address range: 0x${baseLoc2.toString(16).toUpperCase().padStart(4,'0')} \u2013 0x${(baseLoc2 + dumpCount - 1).toString(16).toUpperCase().padStart(4,'0')} | ${dumpCount} words | ${nonZeroCount} non-zero</div>`;
    html += '<div style="font-family:\'Courier New\',monospace;font-size:0.72rem;line-height:1.5;background:#0a0a1a;padding:0.75rem;border-radius:6px;overflow-x:auto;max-height:400px;overflow-y:auto;">';
    for (let row = 0; row < dumpCount; row += 8) {
        const addr = baseLoc2 + row;
        let line = `<span style="color:var(--church-blue);">${addr.toString(16).toUpperCase().padStart(4,'0')}</span>  `;
        let ascii = '';
        for (let col = 0; col < 8; col++) {
            const idx = row + col;
            if (idx < dumpCount && baseLoc2 + idx < sim.memory.length) {
                const w = sim.memory[baseLoc2 + idx];
                const color = w === 0 ? 'var(--text-secondary)' : 'var(--church-gold)';
                line += `<span style="color:${color};">${w.toString(16).toUpperCase().padStart(8,'0')}</span> `;
                for (let b = 3; b >= 0; b--) {
                    const byte = (w >>> (b * 8)) & 0xFF;
                    ascii += (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : '.';
                }
            } else {
                line += '         ';
                ascii += '    ';
            }
        }
        line += ` <span style="color:var(--text-secondary);">|${ascii}|</span>`;
        html += line + '<br>';
    }
    html += '</div>';
    html += '</div>';
    html += '</div></div>';

    contentEl.innerHTML = html;
    // For thread views, make the content div the scroll container so the
    // title, tabs, and thread header stay frozen while the zone tables scroll.
    if (showThread) {
        contentEl.classList.add('crd-content-thread');
    } else {
        contentEl.classList.remove('crd-content-thread');
    }
    requestAnimationFrame(() => {
        const pcRow = contentEl.querySelector('.code-pc-row');
        if (pcRow) pcRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}

function updateDRDisplay() {
    const container = document.getElementById('drRegs');
    if (!container) return;
    let html = '';
    for (let i = 0; i < 16; i++) {
        const val = sim.dr[i];
        const petName = _petNameDRMap[i];
        const special = i === 0 ? ' (zero)' : (petName ? ` (${petName})` : '');
        html += `<div class="reg-row ${val === 0 ? 'reg-null' : 'reg-active'} dr-hover-row" onmouseenter="showDRPopup(event,${i})" onmouseleave="hideCRPopup()">`;
        html += `<span class="reg-label">DR${i.toString().padStart(2, ' ')}${special}</span>`;
        html += `<span class="reg-value">0x${(val >>> 0).toString(16).toUpperCase().padStart(8, '0')}</span>`;
        html += `<span class="reg-decimal">${val}</span>`;
        html += '</div>';
    }
    container.innerHTML = html;
}

function updateFlagsDisplay() {
    const container = document.getElementById('flagsDisplay');
    if (!container) return;
    const f = sim.flags;
    const bootLabel = !sim.bootComplete ? `BOOT ${sim.bootStep}/4` : '';
    const statusLabel = sim.halted ? 'HALTED' : (sim.bootComplete ? 'READY' : 'RESET');
    const cap = sim.lastCapability;
    let capHtml = '';
    if (cap) {
        const p = cap.perms;
        const gateNames = {L:'LOAD',S:'SAVE',E:'CALL',R:'DREAD',W:'DWRITE',X:'LAMBDA'};
        const gateName = gateNames[cap.op] || cap.op || 'mLoad';
        const req = cap.op;
        capHtml = `
        <span class="flags-sep"></span>
        <span class="cap-group-label">${gateName}</span>
        <span class="cap-bit ${p.R ? 'cap-on' : ''} ${req==='R' ? 'cap-req' : ''}">R</span>
        <span class="cap-bit ${p.W ? 'cap-on' : ''} ${req==='W' ? 'cap-req' : ''}">W</span>
        <span class="cap-bit ${p.X ? 'cap-on' : ''} ${req==='X' ? 'cap-req' : ''}">X</span>
        <span class="cap-sep">|</span>
        <span class="cap-bit ${p.L ? 'cap-on' : ''} ${req==='L' ? 'cap-req' : ''}">L</span>
        <span class="cap-bit ${p.S ? 'cap-on' : ''} ${req==='S' ? 'cap-req' : ''}">S</span>
        <span class="cap-bit ${p.E ? 'cap-on' : ''} ${req==='E' ? 'cap-req' : ''}">E</span>
        <span class="cap-sep">|</span>
        <span class="cap-bit ${cap.b ? 'cap-on cap-b' : ''}">B</span>
        <span class="cap-bit ${cap.f ? 'cap-on cap-f' : ''}">F</span>
        <span class="cap-bit ${cap.versionMatch ? 'cap-on cap-v' : 'cap-fail'}">V${cap.versionMatch ? '\u2713' : '\u2717'}</span>
        <span class="cap-label">${cap.label}</span>`;
    }
    container.innerHTML = `
        <span class="flags-sep"></span>
        <span class="flag ${f.N ? 'flag-set' : ''}">N</span>
        <span class="flag ${f.Z ? 'flag-set' : ''}">Z</span>
        <span class="flag ${f.C ? 'flag-set' : ''}">C</span>
        <span class="flag ${f.V ? 'flag-set' : ''}">V</span>
        <span class="flag-info">PC: ${sim.pc}</span>
        <span class="flag-info">Steps: ${sim.stepCount}</span>
        <span class="flag-info">Stack: ${sim.callStack.length}</span>
        <span class="flag-info">STO: ${sim.sto}</span>
        ${bootLabel ? `<span class="flag-info flag-boot">${bootLabel}</span>` : ''}
        <span class="flag-info">${statusLabel}</span>
        ${capHtml}
    `;
}

function updateInfoDisplay() {
    const container = document.getElementById('machineInfo');
    if (!container) return;
    container.innerHTML = `
        <div class="info-item"><span class="info-label">Architecture</span><span class="info-value">Church Machine (Church + Turing domains)</span></div>
        <div class="info-item"><span class="info-label">Church Opcodes</span><span class="info-value">10 (LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, XLOADLAMBDA)</span></div>
        <div class="info-item"><span class="info-label">Turing Opcodes</span><span class="info-value">10 (DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR) + shared RETURN</span></div>
        <div class="info-item"><span class="info-label">Instruction</span><span class="info-value">32-bit: opcode[5] | cond[4] | dst[4] | src[4] | imm[15]</span></div>
        <div class="info-item"><span class="info-label">Conditions</span><span class="info-value">16 ARM-style (EQ, NE, CS, CC, MI, PL, VS, VC, HI, LS, GE, LT, GT, LE, AL, NV)</span></div>
        <div class="info-item"><span class="info-label">Address Space</span><span class="info-value">Unified: Memory (0x00-FD) | Devices (0xFE) | Registers (0xFF) \u2014 all GT-protected</span></div>
        <div class="info-item"><span class="info-label">Golden Tokens</span><span class="info-value">32-bit: Version(7) | Index(17) | Perms(6) | Type(2)</span></div>
        <div class="info-item"><span class="info-label">Security Gates</span><span class="info-value">mLoad (R\u2192DREAD, W\u2192DWRITE, X\u2192LAMBDA, L\u2192LOAD, S\u2192SAVE, E\u2192CALL) + mSave (Version, Seal, Bounds, B-bit, F-bit)</span></div>
        <div class="info-item"><span class="info-label">Security Blocks</span><span class="info-value">Each abstraction is a security block with MTBF \u2014 Turing hidden inside Church-callable entries, CALL in, RETURN out, atomic</span></div>
        <div class="info-item"><span class="info-label">Abstraction Layers</span><span class="info-value">9 layers, ${abstractionRegistry ? abstractionRegistry.count() : 46} abstractions (Boot, System, Hardware, Math, Lambda Calculus, Social, IDE, Internet, GC)</span></div>
        ${(() => {
            const status = (sim && sim.callHomeStatus) || null;
            if (status === null) {
                return `<div class="info-item"><span class="info-label">IDE Connection</span><span class="info-value"><span class="info-ide-pending">\u2014</span></span></div>`;
            }
            const isOnline = status === 'online';
            const ts = (sim && sim.callHomeTimestamp) || null;
            let timeStr = '';
            if (ts) {
                const diffMs = Date.now() - ts;
                const diffS = Math.floor(diffMs / 1000);
                if (diffS < 60) {
                    timeStr = ` \u2014 ${diffS}s ago`;
                } else if (diffS < 3600) {
                    timeStr = ` \u2014 ${Math.floor(diffS / 60)}m ago`;
                } else {
                    timeStr = ` \u2014 ${Math.floor(diffS / 3600)}h ago`;
                }
            }
            const titleAttr = ts ? ` title="${new Date(ts).toLocaleString()}"` : '';
            return `<div class="info-item"><span class="info-label">IDE Connection</span><span class="info-value"><span class="info-ide-badge ${isOnline ? 'info-ide-online' : 'info-ide-offline'}">IDE: ${status}</span><span class="info-ide-time"${titleAttr}>${timeStr}</span></span></div>`;
        })()}
    `;
}

function setPipelineMode(mode) {
    if (pipelineViz) {
        pipelineViz._setMode(mode);
        pipelineViz.reset();
    }
    if (repl) {
        repl.setPipelineMode(mode);
    }
}

let nsExpandedSlot = -1;

function toggleNSDetail(idx) {
    nsExpandedSlot = (nsExpandedSlot === idx) ? -1 : idx;
    updateNamespace();
}

function _renderGTRow(idx, addr, word) {
    const hex = '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0');
    if (word === 0) {
        return `<tr><td style="color:rgba(200,155,60,0.7);">${idx}</td><td>0x${addr.toString(16).toUpperCase().padStart(4,'0')}</td><td style="color:rgba(206,145,120,0.6);">${hex}</td><td><span style="color:#666;">0 (empty)</span></td></tr>`;
    }
    const p = sim.parseGT(word);
    let decoded;
    if (p.type === 3) {
        // Abstract GT (Task #406): decode ab_type / device_class / device_data
        const ab = sim.parseAbstractGT(word);
        const rwStr = (ab.R ? 'R' : '-') + (ab.W ? 'W' : '-');
        const AB_TYPE_NAMES   = { 0: 'I/O', 1: 'M-Elevation' };
        const DEVICE_CLASSES  = { 1: 'LED', 2: 'UART', 3: 'Button', 4: 'Timer', 5: 'Display' };
        const abTypeName   = AB_TYPE_NAMES[ab.ab_type] || `0x${ab.ab_type.toString(16).toUpperCase()}`;
        const deviceName   = DEVICE_CLASSES[ab.device_class] || `dc=0x${ab.device_class.toString(16).toUpperCase()}`;
        const deviceDetail = ab.ab_type === 0
            ? ` ${deviceName}[${ab.device_data}]`
            : ` 0x${ab.ab_data.toString(16).toUpperCase()}`;
        decoded  = `<span style="color:rgba(52,211,153,0.9);">Abstract</span>`;
        decoded += ` <span style="color:rgba(200,155,60,0.55);">[${rwStr}]</span>`;
        decoded += ` <span style="color:rgba(156,220,254,0.7);">${abTypeName}${deviceDetail}</span>`;
        decoded += ` <span style="color:#555;">seq${ab.gt_seq}</span>`;
    } else {
        const permStr = (p.permissions.B ? 'B' : '-') + (p.permissions.R ? 'R' : '-') + (p.permissions.W ? 'W' : '-') + (p.permissions.X ? 'X' : '-') + (p.permissions.L ? 'L' : '-') + (p.permissions.S ? 'S' : '-') + (p.permissions.E ? 'E' : '-');
        const label = sim.nsLabels[p.index] || '';
        decoded  = `<span style="color:rgba(78,201,176,0.7);">${p.typeName}</span>`;
        decoded += ` <span style="color:rgba(200,155,60,0.55);">[${permStr}]</span>`;
        decoded += ` \u2192 idx <span style="color:rgba(86,156,214,0.7);">${p.index}</span>`;
        if (label) decoded += ` <span style="color:rgba(156,220,254,0.6);">(${label})</span>`;
        decoded += ` seq${p.gt_seq}`;
    }
    return `<tr><td style="color:rgba(200,155,60,0.7);">${idx}</td><td>0x${addr.toString(16).toUpperCase().padStart(4,'0')}</td><td style="color:rgba(206,145,120,0.6);">${hex}</td><td>${decoded}</td></tr>`;
}

function _bootHtmlEsc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderBootNSImage() {
    const typeColors = ['#6b7280','#60a5fa','#c084fc','#34d399'];
    const typeNames  = ['NULL','Inform','Outform','Abstract'];

    let html = '<div class="boot-image-view">';

    // ── Header ────────────────────────────────────────────────────────────
    html += '<div class="boot-image-header">Boot ROM Image — Boot.NS (Slot 0)</div>';
    html += '<div class="boot-image-subtitle">Content below is hardwired at design time and frozen into the FPGA BRAM / SPI-flash bitstream.</div>';

    // ── Section 1: Boot Microcode ──────────────────────────────────────────
    html += '<div class="boot-section-label">① Boot Microcode &nbsp;<span class="boot-section-note">6 steps · hardwired state machine · not stored as code words in RAM</span></div>';
    html += '<div class="boot-microcode">';
    for (const code of Object.values(BOOT_SEQ_CODE)) {
        for (const raw of code.split('\n')) {
            const line = raw;
            if (line.trim() === '') {
                html += '<div class="boot-code-blank"></div>';
            } else if (line.trim().startsWith(';')) {
                html += `<div class="boot-code-comment">${_bootHtmlEsc(line)}</div>`;
            } else if (/^\s*B:\d+/.test(line)) {
                const m = line.match(/^(\s*B:\d+\s+\S+)(.*)/);
                if (m) html += `<div class="boot-code-step"><span class="boot-step-kw">${_bootHtmlEsc(m[1])}</span>${_bootHtmlEsc(m[2])}</div>`;
                else    html += `<div class="boot-code-step">${_bootHtmlEsc(line)}</div>`;
            } else {
                html += `<div class="boot-code-body">${_bootHtmlEsc(line)}</div>`;
            }
        }
        html += '<div class="boot-code-blank"></div>';
    }
    html += '</div>';

    // ── Section 2: NS Table ────────────────────────────────────────────────
    const nsWords = sim.nsCount * sim.NS_ENTRY_WORDS;
    html += `<div class="boot-section-label">② NS Table &nbsp;<span class="boot-section-note">at 0x${sim.NS_TABLE_BASE.toString(16).toUpperCase().padStart(4,'0')} · ${sim.nsCount} entries × 3 words = ${nsWords} words (${nsWords*4} bytes)</span></div>`;
    html += '<table class="ns-mem-table boot-ns-table"><thead><tr>';
    html += '<th>Entry</th><th>Label</th><th>W0 · Base Addr</th><th>W1 · Type / Flags / Limit</th><th>W2 · Ver · CRC</th><th>C-list</th>';
    html += '</tr></thead><tbody>';
    for (let i = 0; i < sim.nsCount; i++) {
        const base  = sim.NS_TABLE_BASE + i * sim.NS_ENTRY_WORDS;
        const w0    = sim.memory[base]     || 0;
        const w1    = sim.memory[base + 1] || 0;
        const w2    = sim.memory[base + 2] || 0;
        const p     = sim.parseNSWord1(w1);
        const ver   = (w2 >>> 25) & 0x7F;
        const seal  = w2 & 0xFFFF;
        const label = sim.nsLabels[i] || '-';
        const tName = typeNames[p.gtType] || '?';
        const tCol  = typeColors[p.gtType] || '#888';
        const empty = (w0 === 0 && w1 === 0 && w2 === 0);
        const flags = (p.f ? ' F' : '') + (p.b ? ' B' : '') + (p.g ? ' G' : '') + (p.chainable ? ' Chain' : '');
        html += `<tr${empty ? ' style="opacity:0.28;"' : ''}>`;
        html += `<td class="boot-ns-idx">NS[${i}]</td>`;
        html += `<td class="boot-ns-label">${_bootHtmlEsc(label)}</td>`;
        html += `<td class="boot-ns-addr">0x${(w0>>>0).toString(16).toUpperCase().padStart(4,'0')}</td>`;
        html += `<td style="color:${tCol};font-family:monospace;font-size:0.75rem;">${tName}${flags} · Lim=0x${p.limit.toString(16).toUpperCase().padStart(4,'0')} (${p.limit+1}w)</td>`;
        html += `<td style="color:#71717a;font-family:monospace;font-size:0.73rem;">v${ver} · CRC=0x${seal.toString(16).toUpperCase().padStart(4,'0')}</td>`;
        html += `<td style="color:#f59e0b;font-size:0.73rem;">${p.clistCount ? p.clistCount + ' GT' + (p.clistCount!==1?'s':'') : ''}</td>`;
        html += '</tr>';
    }
    html += '</tbody></table>';

    // ── Section 3: Boot-entry C-list ──────────────────────────────────────
    const bootAbstrEntry = sim.readNSEntry(bootEntrySlot);
    if (bootAbstrEntry) {
        // Derive layout from lump header at word 0 (hardware-accurate)
        const s2loc      = bootAbstrEntry.word0_location;
        const s2hdrWord  = (s2loc < sim.memory.length) ? (sim.memory[s2loc] >>> 0) : 0;
        const s2hdr      = sim.parseLumpHeader(s2hdrWord);
        const s2lim      = sim.parseNSWord1(bootAbstrEntry.word1_limit);
        const clistCount = s2hdr.valid ? s2hdr.cc : (s2lim.clistCount || 0);
        const lumpSzB    = s2hdr.valid ? s2hdr.lumpSize : (sim.SLOT_SIZE || 64);
        const clistStart = lumpSzB - clistCount;  // c-list at physical end
        const clistBase  = s2loc + clistStart;
        const _beLabel3 = (sim.nsLabels && sim.nsLabels[bootEntrySlot]) || `Slot ${bootEntrySlot}`;
        html += `<div class="boot-section-label">③ \u26a1 ${_beLabel3} C-list &nbsp;<span class="boot-section-note">at 0x${clistBase.toString(16).toUpperCase().padStart(4,'0')} · ${clistCount} capability entries · one GT per NS slot</span></div>`;
        html += '<table class="ns-mem-table boot-clist-table"><thead><tr>';
        html += '<th>#</th><th>Addr</th><th>GT Word (32-bit)</th><th>Slot</th><th>Label</th><th>Perms</th><th>Type</th>';
        html += '</tr></thead><tbody>';
        for (let i = 0; i < clistCount; i++) {
            const addr   = clistBase + i;
            const gtWord = sim.memory[addr] || 0;
            const addrHex = '0x' + addr.toString(16).toUpperCase().padStart(4,'0');
            const gtHex   = '0x' + (gtWord>>>0).toString(16).toUpperCase().padStart(8,'0');
            if (gtWord === 0) {
                html += `<tr style="opacity:0.3;"><td style="color:#888">${i}</td><td>${addrHex}</td><td style="font-family:monospace;">${gtHex}</td><td colspan="4" style="color:#555;">NULL — Slot ${i} (free)</td></tr>`;
                continue;
            }
            const gt       = sim.parseGT(gtWord);
            const slotLabel= sim.nsLabels[gt.index] || '-';
            const perms    = gt.permissions;
            const permStr  = Object.entries(perms).filter(([,v])=>v).map(([k])=>k).join('') || 'none';
            const tCol     = typeColors[gt.type] || '#888';
            html += '<tr>';
            html += `<td style="color:rgba(200,155,60,0.8);font-size:0.73rem;">${i}</td>`;
            html += `<td style="font-family:monospace;color:#525252;font-size:0.73rem;">${addrHex}</td>`;
            html += `<td style="font-family:monospace;color:rgba(206,145,120,0.85);font-size:0.73rem;">${gtHex}</td>`;
            html += `<td style="color:#f59e0b;font-size:0.73rem;">${gt.index}</td>`;
            html += `<td style="color:#93c5fd;font-style:italic;font-size:0.73rem;">${_bootHtmlEsc(slotLabel)}</td>`;
            html += `<td style="color:#4ade80;font-family:monospace;font-size:0.73rem;">${permStr}</td>`;
            html += `<td style="color:${tCol};font-size:0.73rem;">${gt.typeName}</td>`;
            html += '</tr>';
        }
        html += '</tbody></table>';
    }

    html += '</div>';
    return html;
}

// Thread slot layout constants (words within a 256-word slot)
// Word 0 is the lump header (0xF900_020C: magic=0x1F, n-6=2, cw=0, typ=10, cc=12).
// Physical layout (word 0 at top, word 255 at bottom):
//   +0          Lump Header  (1 word)
//   +1  … +16   Zone ⑤ Data Registers — DR0..DR15  (16 words)
//   +17 … +80   Zone ④ Heap ↑ — fixed size, grows upward  (64 words)
//   +81 … +211  Zone ③ Freespace — dynamic gap  (131 words)
//   +212 … +243 Zone ② LIFO Stack ↓ — STO initial = 212  (32 words)
//   +244 … +255 Zone ① Capabilities — CR0..CR11 GT Word 0; c-list tail  (12 words)
const THREAD_LAYOUT = {
    HEADER_WORD:  0,
    THREAD_HEADER: 0xF900_8240,
    DR_START:     1,   DR_END:     16,  DR_WORDS:     16,
    HEAP_START:  17,   HEAP_END:   80,  HEAP_WORDS:   64,
    FREE_START:  81,   FREE_END:  211,  FREE_WORDS:  131,
    STACK_START: 212,  STACK_END: 243,  STACK_WORDS:  32,
    CAPS_START:  244,  CAPS_END:  255,  CAPS_WORDS:   12,
    TOTAL:      256,
};
const THREAD_NS_SLOTS = new Set([1, 45]);

function renderThreadMemoryLayout(nsIndex) {
    const entry = sim.readNSEntry(nsIndex);
    const slotBase = entry ? entry.word0_location : (nsIndex * sim.SLOT_SIZE);
    const label = sim.nsLabels[nsIndex] || ('Slot ' + nsIndex);
    const TL = THREAD_LAYOUT;

    const secHdr = (num, title, note, color, id='') =>
        `<div class="thread-zone-hdr"${id ? ` id="${id}"` : ''} style="border-left-color:${color};">${num} ${title}<span class="thread-zone-note">${note}</span></div>`;

    const addrOf = (off) => '0x' + (slotBase + off).toString(16).toUpperCase().padStart(4, '0');
    const hexOf  = (w)   => '0x' + (w >>> 0).toString(16).toUpperCase().padStart(8, '0');

    let html = '<div class="thread-layout-view">';

    // ── Sticky header block (title + lump header) ─────────────────────────
    const headerWord = sim.memory[slotBase + TL.HEADER_WORD] || TL.THREAD_HEADER;
    html += `<div class="thread-layout-sticky" id="thread-zone-hdr">`;
    html += `<div class="thread-layout-header">${label} — Thread Memory Layout<span class="thread-layout-subhead">NS Slot ${nsIndex} · base ${addrOf(0)} · 256 words (1\u202F024 bytes)</span></div>`;
    html += `<div class="thread-lump-hdr-block">`;
    html += `<span class="thread-lump-hdr-label">Lump Header</span>`;
    html += `<span class="thread-lump-hdr-note">word 0 · magic=0x1F · n\u22126=2 (256w) · sw=32 · typ=10 (Thread) · cc=64</span>`;
    html += `<div class="thread-lump-hdr-row">`;
    html += `<span class="thread-lump-off">+0</span>`;
    html += `<span class="thread-lump-addr">${addrOf(0)}</span>`;
    html += `<span class="thread-lump-hex">${hexOf(headerWord)}</span>`;
    const _hh = hexOf(headerWord); // e.g. "0xF900020C"
    const _hhFmt = '0x' + _hh.slice(2, 6) + '_' + _hh.slice(6); // "0xF900_020C"
    html += `<span class="thread-lump-desc">${_hhFmt} \u2014 never executed \u00b7 traps if PC reaches word\u00a00</span>`;
    html += `</div>`;
    html += `</div>`;
    html += `</div>`;

    // ── Zone ⑤: Data Registers (+1 … +16) ───────────────────────────────────
    html += secHdr('⑤', 'Data Registers', '16 words · DR0–DR15 · offset +1 … +16 · head of the slot (after header)', '#a855f7', 'thread-zone-5');
    html += '<table class="ns-mem-table thread-zone-table"><thead><tr><th>DR</th><th>Offset</th><th>Addr</th><th>Value (hex)</th><th>Value (dec)</th></tr></thead><tbody>';
    for (let i = 0; i < TL.DR_WORDS; i++) {
        const off  = TL.DR_START + i;
        const word = sim.memory[slotBase + off] || 0;
        const rowStyle = word ? '' : ' style="opacity:0.28;"';
        html += `<tr${rowStyle}><td style="color:#a855f7;">DR${i}</td><td style="color:#555;">+${off}</td><td style="font-family:monospace;">${addrOf(off)}</td><td style="color:#c084fc;font-family:monospace;">${hexOf(word)}</td><td style="color:#9ca3af;">${word >>> 0}</td></tr>`;
    }
    html += '</tbody></table>';

    // ── Zone ④: Heap (+17 … +80) ─────────────────────────────────────────
    let heapNonZero = 0;
    for (let i = TL.HEAP_START; i <= TL.HEAP_END; i++) {
        if (sim.memory[slotBase + i]) heapNonZero++;
    }
    html += secHdr('④', 'Heap ↑', `64 words · offset +17 … +80 · base ${addrOf(TL.HEAP_START)} · ${heapNonZero} word${heapNonZero!==1?'s':''} allocated`, '#22c55e', 'thread-zone-4');
    html += '<table class="ns-mem-table thread-zone-table"><thead><tr><th>Off</th><th>Addr</th><th>Hex</th><th>Decoded</th></tr></thead><tbody>';
    for (let i = 0; i < TL.HEAP_WORDS; i++) {
        const off  = TL.HEAP_START + i;
        const word = sim.memory[slotBase + off] || 0;
        const rowStyle = word ? '' : ' style="opacity:0.22;"';
        const decoded  = word ? `<span style="color:#9ca3af;">0x${word.toString(16).toUpperCase().padStart(8,'0')}</span>` : '<span style="color:#374151;">free</span>';
        html += `<tr${rowStyle}><td style="color:#22c55e;">+${off}</td><td style="font-family:monospace;">${addrOf(off)}</td><td style="color:rgba(206,145,120,0.8);font-family:monospace;">${hexOf(word)}</td><td>${decoded}</td></tr>`;
    }
    html += '</tbody></table>';

    // ── Zone ③: Freespace (+81 … +211) ───────────────────────────────────
    let freeNonZero = 0;
    for (let i = TL.FREE_START; i <= TL.FREE_END; i++) {
        if (sim.memory[slotBase + i]) freeNonZero++;
    }
    html += secHdr('③', 'Freespace', `131 words · offset +81 … +211 · ${freeNonZero} non-zero · shrinks as stack grows ↓ and heap grows ↑`, '#6b7280', 'thread-zone-3');
    if (freeNonZero === 0) {
        html += '<div class="thread-free-empty">All 131 words are zero — region is unallocated.</div>';
    } else {
        html += '<table class="ns-mem-table thread-zone-table"><thead><tr><th>Off</th><th>Addr</th><th>Hex</th><th>Note</th></tr></thead><tbody>';
        for (let i = TL.FREE_START; i <= TL.FREE_END; i++) {
            const word = sim.memory[slotBase + i] || 0;
            if (!word) continue;
            html += `<tr><td style="color:#6b7280;">+${i}</td><td style="font-family:monospace;">${addrOf(i)}</td><td style="color:rgba(206,145,120,0.8);font-family:monospace;">${hexOf(word)}</td><td style="color:#4b5563;">non-zero</td></tr>`;
        }
        html += '</tbody></table>';
    }

    // ── Zone ②: LIFO Stack (+212 … +243) ─────────────────────────────────
    const stackWords = sim.memory.slice(slotBase + TL.STACK_START, slotBase + TL.STACK_END + 1);
    const stackUsed  = stackWords.filter(Boolean).length;
    const stoLive    = (sim.sto != null) ? sim.sto : TL.STACK_END;
    // Table first; zone header banner (with scroll anchor) at the bottom where the frames are.
    html += '<table class="ns-mem-table thread-zone-table"><thead><tr><th>Off</th><th>Addr</th><th>Hex</th><th>Decoded</th></tr></thead><tbody>';
    for (let i = 0; i < TL.STACK_WORDS; i++) {
        const off  = TL.STACK_START + i;
        const word = sim.memory[slotBase + off] || 0;
        const hex  = hexOf(word);
        let decoded;
        if (word === 0) {
            decoded = '<span style="color:#374151;">empty</span>';
        } else {
            // Sentinel check MUST run before parseGT:
            // sentinel frameWord = 0x0FFFF0F3 has GT type-field bits = 3 (Abstract),
            // so GT parsing would misclassify it.  Detect by NIA=0x7FFF (poison) first.
            const niaBits = (word >>> 13) & 0x7FFF;
            const szBit   = (word >>> 12) & 1;
            const prevSTO =  word & 0xFFF;
            if (niaBits === 0x7FFF) {
                decoded = `<span style="color:#f97316;font-weight:600;">sentinel frameWord</span> <span style="color:#9ca3af;">(NIA=0x7FFF·poison, sz=${szBit}, prev_STO=${prevSTO})</span>`;
            } else {
                const gt = sim.parseGT(word);
                if (gt.type !== 0) {
                    const perms = Object.entries(gt.permissions).filter(([,v])=>v).map(([k])=>k).join('') || 'none';
                    const lbl = sim.nsLabels[gt.index] || '';
                    decoded = `GT → <span style="color:#38bdf8;">${gt.typeName}</span> Slot=${gt.index}${lbl?' <i style="color:#93c5fd;">('+lbl+')</i>':''} [${perms}]`;
                } else {
                    const returnPC = niaBits;
                    decoded = `<span style="color:#9ca3af;">frame word: returnPC=${returnPC}, sz=${szBit}, prev_STO=${prevSTO}</span>`;
                }
            }
        }
        const rowStyle = word ? '' : ' style="opacity:0.25;"';
        html += `<tr id="thread-stack-row-${off}"${rowStyle}><td style="color:#38bdf8;">+${off}</td><td style="font-family:monospace;">${addrOf(off)}</td><td style="color:rgba(206,145,120,0.85);font-family:monospace;">${hex}</td><td>${decoded}</td></tr>`;
    }
    html += '</tbody></table>';
    html += secHdr('②', 'LIFO Stack ↑', `32 words · STO=${stoLive} · grows ↑ · sentinel: E-GT@+242, fw@+243 (NIA=0x7FFF) · ${stackUsed} word${stackUsed!==1?'s':''} non-zero`, '#38bdf8', 'thread-zone-2');

    // ── Zone ①: Capabilities (+244 … +255) ───────────────────────────────
    html += secHdr('①', 'Capabilities', `12 words · CR0–CR11 · offset +244 … +255 · c-list tail · saved/restored on context switch`, '#f4b942', 'thread-zone-1');
    html += '<table class="ns-mem-table thread-zone-table"><thead><tr><th>CR</th><th>Offset</th><th>Addr</th><th>Hex</th><th>Decoded (GT)</th></tr></thead><tbody>';
    for (let i = 0; i < TL.CAPS_WORDS; i++) {
        const off  = TL.CAPS_START + i;
        const word = sim.memory[slotBase + off] || 0;
        const hex  = hexOf(word);
        let decoded;
        if (word === 0) {
            decoded = '<span style="color:#4b5563;">NULL</span>';
        } else {
            const gt = sim.parseGT(word);
            const perms = Object.entries(gt.permissions).filter(([,v])=>v).map(([k])=>k).join('') || 'none';
            const lbl = sim.nsLabels[gt.index] || '';
            decoded = `<span style="color:#60a5fa;">${gt.typeName}</span> Slot=${gt.index}${lbl ? ' <i style="color:#93c5fd;">('+lbl+')</i>' : ''} p=[${perms}] seq${gt.gt_seq}`;
        }
        html += `<tr><td style="color:#f4b942;">CR${i}</td><td style="color:#555;">+${off}</td><td style="font-family:monospace;">${addrOf(off)}</td><td style="color:rgba(206,145,120,0.9);font-family:monospace;">${hex}</td><td>${decoded}</td></tr>`;
    }
    html += '</tbody></table>';

    html += '</div>';
    return html;
}

function renderMemoryDump(location, limit, nsIndex) {
    if (nsIndex === 0) return renderBootNSImage();
    if (THREAD_NS_SLOTS.has(nsIndex)) return renderThreadMemoryLayout(nsIndex);

    const wordCount = limit;
    if (wordCount <= 0) return '<span style="color:#888;">Empty (limit=0)</span>';

    let html = '<table class="ns-mem-table"><thead><tr>';
    html += '<th>Offset</th><th>Address</th><th>Hex</th><th>Decoded</th>';
    html += '</tr></thead><tbody>';

    {
        // ── Read lump header at word 0 to derive layout (hardware-accurate) ──────
        const hdrWord    = (location < sim.memory.length) ? (sim.memory[location] >>> 0) : 0;
        const hdr        = sim.parseLumpHeader(hdrWord);
        if (hdr.valid) {
            const cw         = hdr.cw;
            const cc         = hdr.cc;
            const lumpSize   = hdr.lumpSize;
            const clistStart = lumpSize - cc;  // c-list at physical end
            const hdrHex     = '0x' + (hdrWord >>> 0).toString(16).toUpperCase().padStart(8, '0');
            const hdrAddrHex = '0x' + location.toString(16).toUpperCase().padStart(4, '0');
            const typNames   = ['lump','data','Thread','Outform'];
            const nsEntry    = sim.readNSEntry(nsIndex);
            const lumpVer    = nsEntry ? ((nsEntry.word2_seals >>> 25) & 0x7F) : 0;
            const lumpSeal   = nsEntry ? (nsEntry.word2_seals & 0xFFFF) : 0;
            const lumpNote   = `magic=0x${hdr.magic.toString(16).toUpperCase()}`
                             + ` \u00b7 n\u22126=${hdr.n_minus_6}\u2192${lumpSize}w`
                             + ` \u00b7 cw=${cw} \u00b7 typ=${typNames[hdr.typ]||hdr.typ} \u00b7 cc=${cc}`
                             + ` \u00b7 ver=${lumpVer} \u00b7 CRC=0x${lumpSeal.toString(16).toUpperCase().padStart(4,'0')}`;
            // ── Lump Header row ────────────────────────────────────────────────
            html = `<div style="color:rgba(156,220,254,0.5);font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:0.2rem;">Header`
                 + ` <span style="color:#3f3f46;font-size:0.72rem;">word 0 of lump \u00b7 ${lumpNote}</span></div>`;
            html += '<table class="ns-mem-table"><thead><tr>'
                  + '<th>Offset</th><th>Address</th><th>Hex</th><th>Note</th>'
                  + '</tr></thead><tbody>';
            html += `<tr style="background:rgba(56,189,248,0.04);">`
                  + `<td style="color:#38bdf8;">+0</td>`
                  + `<td style="font-family:monospace;">${hdrAddrHex}</td>`
                  + `<td style="font-family:monospace;color:rgba(206,145,120,0.7);">${hdrHex}</td>`
                  + `<td style="color:#60a5fa;font-size:0.72rem;">${lumpNote}</td>`
                  + `</tr>`;
            html += '</tbody></table>';
            // ── CLOOMC Code (words 1..cw, skip header at word 0) ──────────────
            html += '<div style="color:rgba(156,220,254,0.7);font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:0.2rem;">CLOOMC Code</div>';
            html += '<table class="ns-mem-table"><thead><tr><th>Offset</th><th>Address</th><th>Hex</th><th>Decoded</th></tr></thead><tbody>';
            var asm = new ChurchAssembler();
            for (let i = 0; i < cw; i++) {
                const addr = location + 1 + i;
                if (addr >= sim.memory.length) break;
                const word = sim.memory[addr] || 0;
                const hex = '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0');
                let decoded = word === 0 ? '<span style="color:#666;">0 (empty)</span>' : asm.disassemble(word);
                const addrHex = '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
                html += `<tr><td style="color:#666;">+${1 + i}</td><td>${addrHex}</td><td style="color:rgba(206,145,120,0.6);">${hex}</td><td>${decoded}</td></tr>`;
            }
            html += '</tbody></table>';
            // ── Freespace (words cw+1 .. clistStart-1, between code end and c-list) ──
            const freeStart = 1 + cw;
            const freeCount = clistStart - freeStart;
            if (freeCount > 0) {
                const freeBaseAbs = location + freeStart;
                const freeEndAbs  = location + clistStart - 1;
                html += `<div style="color:rgba(113,113,122,0.7);font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:0.3rem;">Freespace`
                      + ` <span style="color:#3f3f46;font-size:0.72rem;">`
                      + `words +${freeStart}\u2013+${clistStart - 1}`
                      + ` \u00b7 ${freeCount} words`
                      + ` \u00b7 0x${freeBaseAbs.toString(16).toUpperCase().padStart(4,'0')}\u20130x${freeEndAbs.toString(16).toUpperCase().padStart(4,'0')}`
                      + `</span></div>`;
                html += '<table class="ns-mem-table"><thead><tr>'
                      + '<th>Offset</th><th>Address</th><th>Hex</th><th>Note</th>'
                      + '</tr></thead><tbody>';
                for (let i = 0; i < freeCount; i++) {
                    const off     = freeStart + i;
                    const addr    = location + off;
                    const addrHex = '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
                    const word    = (addr < sim.memory.length) ? (sim.memory[addr] || 0) : 0;
                    const hexW    = '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0');
                    html += `<tr style="opacity:0.28;">`
                          + `<td style="color:#3f3f46;">+${off}</td>`
                          + `<td style="font-family:monospace;color:#3f3f46;">${addrHex}</td>`
                          + `<td style="font-family:monospace;color:#3f3f46;">${hexW}</td>`
                          + `<td style="color:#3f3f46;font-style:italic;font-size:0.72rem;">freespace</td>`
                          + `</tr>`;
                }
                html += '</tbody></table>';
            }
            // ── C-List (words clistStart..lumpSize-1, at physical end) ─────────
            html += '<div style="color:rgba(200,155,60,0.7);font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:0.3rem;">C-List (' + cc + ' GT entries)</div>';
            html += '<table class="ns-mem-table"><thead><tr><th>#</th><th>Address</th><th>Hex</th><th>GT Decoded</th></tr></thead><tbody>';
            for (let i = 0; i < cc; i++) {
                const addr = location + clistStart + i;
                if (addr >= sim.memory.length) break;
                const word = sim.memory[addr] || 0;
                html += _renderGTRow(i, addr, word);
            }
            html += '</tbody></table>';
            return html;
        } else {
            // No valid lump header — derive LUMP layout from NS entry metadata
            const nsEntry2  = sim.readNSEntry(nsIndex);
            const lim2      = nsEntry2 ? sim.parseNSWord1(nsEntry2.word1_limit) : null;
            if (lim2 && lim2.limit > 0) {
                const cc2        = lim2.clistCount;
                const allocSize2 = lim2.limit + 1;
                const clistStart2 = cc2 > 0 ? (allocSize2 - cc2) : allocSize2;
                const lumpVer2   = (nsEntry2.word2_seals >>> 25) & 0x7F;
                const lumpSeal2  = nsEntry2.word2_seals & 0xFFFF;
                const locHex2    = '0x' + location.toString(16).toUpperCase().padStart(4, '0');
                const hdrHex2    = '0x' + (hdrWord >>> 0).toString(16).toUpperCase().padStart(8, '0');

                html  = `<div style="color:rgba(156,220,254,0.3);font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:0.2rem;">Header`;
                html += ` <span style="color:#3f3f46;font-size:0.72rem;">no lump header at ${locHex2}`;
                html += ` \u00b7 layout from NS entry \u00b7 alloc=${allocSize2}w \u00b7 cc=${cc2}`;
                html += ` \u00b7 ver=${lumpVer2} \u00b7 CRC=0x${lumpSeal2.toString(16).toUpperCase().padStart(4,'0')}</span></div>`;
                html += '<table class="ns-mem-table"><thead><tr><th>Offset</th><th>Address</th><th>Hex</th><th>Note</th></tr></thead><tbody>';
                html += `<tr style="opacity:0.3;">`;
                html += `<td style="color:#3f3f46;">+0</td>`;
                html += `<td style="font-family:monospace;color:#3f3f46;">${locHex2}</td>`;
                html += `<td style="font-family:monospace;color:#3f3f46;">${hdrHex2}</td>`;
                html += `<td style="color:#3f3f46;font-style:italic;font-size:0.72rem;">(no lump header \u2014 raw word)</td>`;
                html += `</tr></tbody></table>`;

                html += `<div style="color:rgba(156,220,254,0.7);font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:0.2rem;">CLOOMC Code`;
                html += ` <span style="color:#3f3f46;font-size:0.72rem;">words +0\u2013+${clistStart2 > 0 ? clistStart2-1 : 0} \u00b7 ${clistStart2} words</span></div>`;
                html += '<table class="ns-mem-table"><thead><tr><th>Offset</th><th>Address</th><th>Hex</th><th>Decoded</th></tr></thead><tbody>';
                var asm2 = new ChurchAssembler();
                for (let i = 0; i < clistStart2; i++) {
                    const addr = location + i;
                    if (addr >= sim.memory.length) break;
                    const word = sim.memory[addr] || 0;
                    const hex = '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0');
                    const decoded = word === 0 ? '<span style="color:#666;">0 (empty)</span>' : asm2.disassemble(word);
                    const addrHex = '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
                    html += `<tr><td style="color:#666;">+${i}</td><td>${addrHex}</td><td style="color:rgba(206,145,120,0.6);">${hex}</td><td>${decoded}</td></tr>`;
                }
                html += '</tbody></table>';

                if (cc2 > 0) {
                    html += `<div style="color:rgba(200,155,60,0.7);font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:0.3rem;">C-List (${cc2} GT entries)</div>`;
                    html += '<table class="ns-mem-table"><thead><tr><th>#</th><th>Address</th><th>Hex</th><th>GT Decoded</th></tr></thead><tbody>';
                    for (let i = 0; i < cc2; i++) {
                        const addr = location + clistStart2 + i;
                        if (addr >= sim.memory.length) break;
                        const word = sim.memory[addr] || 0;
                        html += _renderGTRow(i, addr, word);
                    }
                    html += '</tbody></table>';
                }

                return html;
            }
            // Fallback: last resort plain hex dump
            var asm = new ChurchAssembler();
            for (let i = 0; i < wordCount; i++) {
                const addr = location + i;
                const word = sim.memory[addr] || 0;
                const hex = '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0');
                let decoded = word === 0 ? '<span style="color:#666;">0 (empty)</span>' : asm.disassemble(word);
                const addrHex = '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
                html += `<tr><td style="color:#666;">+${i}</td><td>${addrHex}</td><td style="color:rgba(206,145,120,0.6);">${hex}</td><td>${decoded}</td></tr>`;
            }
        }
    }
    html += '</tbody></table>';
    return html;
}

// ===========================================================================
// Boot Image Designer — Step 1: memory allocation (Task #214)
// ---------------------------------------------------------------------------
// Loads/saves a project-level boot config via /api/boot-config. The config is
// also exposed as window.bootConfig so simulator.js (initSim) can pick up
// programmer-chosen lump sizes when constructing the boot image.
// See docs/foundation-lump-design.md §4 for the design rationale.
// ===========================================================================
let _hardwareProfiles = null;
let _lumpCatalog = [];          // [{abstraction, nsSlot, lumpSize, token}]
let _bdLimits = { maxNsEntries: 256, baseNamedNsCount: 47 };
// In-memory mirror of the Step 2 lump grid while the modal is open.
// Keyed by nsSlot → {resident, physAddr, lumpSize, abstraction}.
let _bdStep2State = {};

function _bdIsPow2(n) { return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0; }

// Used by the modal to refresh state. The DOMContentLoaded handler
// performs the *initial* prefetch so window.bootConfig is set before
// the simulator boots; this function just refreshes from the server.
function _loadBootConfig() {
    return fetch('/api/boot-config')
        .then(r => r.json())
        .then(data => {
            window.bootConfig = (data && data.config) || null;
            _hardwareProfiles = (data && data.profiles) || {};
            _lumpCatalog      = (data && data.lumpCatalog) || [];
            if (data && data.limits) _bdLimits = data.limits;
            return data;
        })
        .catch(err => {
            console.warn('[bootConfig] fetch failed:', err);
            return null;
        });
}

function openBootDesigner() {
    const overlay = document.getElementById('bootDesignerOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    document.getElementById('bdStatus').textContent = '';
    document.getElementById('bdError').textContent = '';
    _loadBootConfig().then(data => {
        const sel = document.getElementById('bdTargetBoard');
        sel.innerHTML = '';
        const profiles = _hardwareProfiles || {};
        Object.keys(profiles).forEach(key => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = profiles[key].label || key;
            sel.appendChild(opt);
        });
        // Prefill from saved config when present, otherwise from server
        // defaults so the programmer has a reasonable starting point.
        const cfg = window.bootConfig || (data && data.defaults) || {};
        sel.value = cfg.targetBoard || sel.value;
        const s1 = cfg.step1 || {};
        document.getElementById('bdTotal').value  = s1.totalNamespaceWords  || 16384;
        document.getElementById('bdNs').value     = s1.namespaceLumpWords   || 64;
        document.getElementById('bdThread').value = s1.threadLumpWords      || 256;
        document.getElementById('bdAbstr').value  = s1.abstractionLumpWords || 256;
        bdRefreshHwInfo();
        ['bdTotal','bdNs','bdThread','bdAbstr'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.oninput = _bdValidate;
        });
        _bdInitStep2(cfg);
        // Step 3 (Task #216): empty NS slot reservation. Prefill from saved
        // config or fall back to 0 (historical behaviour: no extra slots).
        const s3 = (cfg.step3) || (data && data.defaults && data.defaults.step3) || {};
        const emptyEl = document.getElementById('bdEmptySlots');
        if (emptyEl) {
            emptyEl.value = Number.isFinite(s3.emptySlotCount) ? s3.emptySlotCount : 0;
            emptyEl.oninput = _bdValidate;
        }
        _bdValidate();
    });
}

// ---------------------------------------------------------------------------
// Step 2 (resident lumps) — table render + state
// ---------------------------------------------------------------------------
function _bdInitStep2(cfg) {
    _bdStep2State = {};
    const savedLumps = ((cfg && cfg.step2 && cfg.step2.lumps) || []);
    const savedMap = {};
    for (const e of savedLumps) savedMap[e.nsSlot] = e;
    // Suggested default phys addresses grow upward from the foundational
    // region; each row falls back to a sensible default if the user toggles
    // resident without picking an address.
    let cursor = (parseInt(document.getElementById('bdNs').value, 10) || 0)
               + (parseInt(document.getElementById('bdThread').value, 10) || 0)
               + (parseInt(document.getElementById('bdAbstr').value, 10) || 0);
    for (const cat of _lumpCatalog) {
        const saved = savedMap[cat.nsSlot];
        const resident = !!(saved && saved.resident);
        const physAddr = (saved && Number.isFinite(saved.physAddr))
                          ? saved.physAddr : cursor;
        if (resident) cursor = physAddr + (cat.lumpSize || 0);
        _bdStep2State[cat.nsSlot] = {
            resident, physAddr,
            lumpSize: cat.lumpSize,
            abstraction: cat.abstraction,
        };
    }
    _bdRenderStep2();
}

function _bdRenderStep2() {
    const tbody = document.getElementById('bdLumpTbody');
    const empty = document.getElementById('bdLumpEmpty');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!_lumpCatalog.length) {
        empty.textContent = 'No catalog lumps available (server/lumps/manifest.json is empty).';
        return;
    }
    empty.textContent = '';
    for (const cat of _lumpCatalog) {
        const st = _bdStep2State[cat.nsSlot] || {};
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #2a2a2a';
        const residentChecked = st.resident ? 'checked' : '';
        const physVal = (st.physAddr != null) ? st.physAddr : '';
        const physDisabled = st.resident ? '' : 'disabled';
        const physStyle = st.resident ? '' : 'opacity:0.4;';
        tr.innerHTML =
            `<td style="padding:5px 4px;color:#ddd;">${cat.abstraction || '?'}</td>` +
            `<td style="padding:5px 4px;color:#aaa;">${cat.nsSlot}</td>` +
            `<td style="padding:5px 4px;color:#aaa;">${cat.lumpSize || '?'}</td>` +
            `<td style="padding:5px 4px;">` +
              `<label style="cursor:pointer;color:${st.resident?'#9c9':'#aaa'};">` +
                `<input type="checkbox" data-bd-slot="${cat.nsSlot}" data-bd-field="resident" ${residentChecked}> ` +
                `${st.resident ? 'Resident' : 'Lazy'}` +
              `</label>` +
            `</td>` +
            `<td style="padding:5px 4px;">` +
              `<input type="number" min="0" step="1" data-bd-slot="${cat.nsSlot}" data-bd-field="physAddr" ` +
                     `value="${physVal}" ${physDisabled} ` +
                     `style="width:120px;background:#111;color:#ddd;border:1px solid #555;padding:3px 6px;${physStyle}">` +
            `</td>`;
        tbody.appendChild(tr);
    }
    tbody.querySelectorAll('input[data-bd-slot]').forEach(inp => {
        inp.oninput = inp.onchange = _bdOnStep2Change;
    });
}

function _bdOnStep2Change(ev) {
    const slot = parseInt(ev.target.getAttribute('data-bd-slot'), 10);
    const field = ev.target.getAttribute('data-bd-field');
    const st = _bdStep2State[slot] || {};
    if (field === 'resident') {
        st.resident = !!ev.target.checked;
    } else if (field === 'physAddr') {
        const v = ev.target.value;
        st.physAddr = (v === '' ? null : parseInt(v, 10));
    }
    _bdStep2State[slot] = st;
    _bdRenderStep2();
    _bdValidate();
}

function closeBootDesigner() {
    const overlay = document.getElementById('bootDesignerOverlay');
    if (overlay) overlay.style.display = 'none';
}

function bdRefreshHwInfo() {
    const sel = document.getElementById('bdTargetBoard');
    const info = document.getElementById('bdHwInfo');
    if (!sel || !info) return;
    const p = (_hardwareProfiles || {})[sel.value];
    if (!p) { info.textContent = 'No hardware profile data.'; return; }
    info.innerHTML =
        `<strong>${p.label}</strong><br>` +
        `Total RAM available for namespace: <strong>${p.totalRamWords} words</strong> ` +
        `(${(p.totalRamWords*4/1024).toFixed(1)} KB at 32-bit)<br>` +
        `Address bits: ${p.addressBits}` +
        (p.addressRange ? `<br>Address range: <code>${p.addressRange}</code>` : '') +
        `<br><span style="color:#888;">${p.notes || ''}</span>`;
    _bdValidate();
}

function _bdValidate() {
    const sel = document.getElementById('bdTargetBoard');
    const p = (_hardwareProfiles || {})[sel.value] || { totalRamWords: 0, label: '?' };
    const total  = parseInt(document.getElementById('bdTotal').value, 10);
    const nsLump = parseInt(document.getElementById('bdNs').value, 10);
    const thrLump = parseInt(document.getElementById('bdThread').value, 10);
    const absLump = parseInt(document.getElementById('bdAbstr').value, 10);
    const errEl = document.getElementById('bdError');
    const sumEl = document.getElementById('bdSummary');
    const saveBtn = document.getElementById('bdSaveBtn');
    let err = '';
    const fields = [['Total namespace memory', total],
                    ['Namespace Lump', nsLump],
                    ['Thread Lump', thrLump],
                    ['Abstraction Lump', absLump]];
    for (const [name, v] of fields) {
        if (!Number.isFinite(v) || v <= 0) { err = `${name} must be a positive integer.`; break; }
        if (!_bdIsPow2(v))                  { err = `${name} must be a power of 2.`; break; }
        if (v < 64)                         { err = `${name} must be at least 64 words.`; break; }
    }
    if (!err && total > p.totalRamWords) {
        err = `Total namespace memory (${total}) exceeds ${p.label} budget (${p.totalRamWords} words).`;
    }
    const sum = (nsLump||0) + (thrLump||0) + (absLump||0);
    const NS_TABLE_RESERVE = 0x300; // 768 words; keep in sync with simulator.js
    const usable = (total||0) - NS_TABLE_RESERVE;
    if (!err && sum > total) {
        err = `Foundational lumps sum to ${sum} words but only ${total} are budgeted.`;
    }
    if (!err && sum > usable) {
        err = `Foundational lumps (${sum} words) exceed the ${usable}-word usable space ` +
              `(total ${total} minus ${NS_TABLE_RESERVE} reserved for the namespace table).`;
    }
    // Step 2 — validate resident lump placements: each phys addr must sit
    // after the foundational region, before the NS-table reserve, and not
    // overlap any other resident lump.
    if (!err) {
        const occ = []; // [{start, end, label}]
        for (const slotStr of Object.keys(_bdStep2State)) {
            const st = _bdStep2State[slotStr];
            if (!st.resident) continue;
            const lbl = `${st.abstraction} (NS ${slotStr})`;
            if (!Number.isFinite(st.physAddr) || st.physAddr < 0) {
                err = `${lbl}: physAddr is required for resident lumps.`; break;
            }
            const sz = st.lumpSize || 0;
            if (sz <= 0) { err = `${lbl}: missing lumpSize.`; break; }
            if (st.physAddr < sum) {
                err = `${lbl}: physAddr ${st.physAddr} overlaps the foundational region (0..${sum-1}).`;
                break;
            }
            if (st.physAddr + sz > usable) {
                err = `${lbl}: ${sz}-word lump at ${st.physAddr} extends past usable region (ends at ${usable}).`;
                break;
            }
            for (const o of occ) {
                if (!(st.physAddr + sz <= o.start || st.physAddr >= o.end)) {
                    err = `${lbl}: overlaps ${o.label}.`; break;
                }
            }
            if (err) break;
            occ.push({start: st.physAddr, end: st.physAddr + sz, label: lbl});
        }
    }
    // Step 3 — validate empty NS slot reservation count. Capacity rule
    // matches the server (_validate_step3): the simulator unconditionally
    // writes baseNamedNsCount entries from the default abstraction
    // catalog at boot, so Step 3 reserves slots ON TOP of that baseline.
    const maxNs = _bdLimits.maxNsEntries || 256;
    const baseNs = _bdLimits.baseNamedNsCount || 47;
    const emptyEl = document.getElementById('bdEmptySlots');
    const emptyCount = emptyEl ? parseInt(emptyEl.value, 10) : 0;
    if (!err && (!Number.isFinite(emptyCount) || emptyCount < 0)) {
        err = 'Empty NS slot count must be a non-negative integer.';
    }
    if (!err) {
        const need = baseNs + emptyCount;
        if (need > maxNs) {
            err = `Reserving ${emptyCount} empty NS slots after the ${baseNs} ` +
                  `named slots written at boot would need ${need} entries but ` +
                  `the NS table only holds ${maxNs}. Max reservable: ${maxNs - baseNs}.`;
        }
    }
    errEl.textContent = err;
    saveBtn.disabled = !!err;
    saveBtn.style.opacity = err ? '0.5' : '1';
    const free = (total||0) - NS_TABLE_RESERVE - sum;
    sumEl.innerHTML =
        `Foundational lumps total: <strong>${sum}</strong> words. ` +
        `Free for resident lumps + reserved slots (Steps 2 & 3): ` +
        `<strong>${free >= 0 ? free : 0}</strong> words ` +
        `<span style="color:#888;">(total ${total||0} − ${NS_TABLE_RESERVE} NS table − ${sum} foundational)</span>.`;
    return !err;
}

function saveBootDesigner() {
    if (!_bdValidate()) return;
    const step2Lumps = [];
    for (const slotStr of Object.keys(_bdStep2State)) {
        const st = _bdStep2State[slotStr];
        const row = { nsSlot: parseInt(slotStr, 10), resident: !!st.resident };
        if (st.resident) {
            row.physAddr = st.physAddr;
            if (st.lumpSize) row.lumpSize = st.lumpSize;
        }
        step2Lumps.push(row);
    }
    const payload = {
        targetBoard: document.getElementById('bdTargetBoard').value,
        step1: {
            totalNamespaceWords:  parseInt(document.getElementById('bdTotal').value, 10),
            namespaceLumpWords:   parseInt(document.getElementById('bdNs').value, 10),
            threadLumpWords:      parseInt(document.getElementById('bdThread').value, 10),
            abstractionLumpWords: parseInt(document.getElementById('bdAbstr').value, 10),
        },
        step2: { lumps: step2Lumps },
        step3: {
            emptySlotCount: parseInt(document.getElementById('bdEmptySlots').value, 10) || 0,
        },
    };
    const status = document.getElementById('bdStatus');
    const errEl = document.getElementById('bdError');
    status.textContent = 'Saving…';
    errEl.textContent = '';
    fetch('/api/boot-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
        .then(r => r.json().then(j => ({ ok: r.ok, body: j })))
        .then(({ ok, body }) => {
            if (!ok || body.ok === false) {
                status.textContent = '';
                errEl.textContent = (body && body.error) || 'Save failed.';
                return;
            }
            window.bootConfig = body.config;
            status.textContent = 'Saved. Reset the simulator to apply the new lump sizes.';
        })
        .catch(err => {
            status.textContent = '';
            errEl.textContent = 'Save failed: ' + err;
        });
}

// Task #217 — fetch the saved boot-image.bin (if any) without triggering
// a 404 console error noise. Returns ArrayBuffer or null.
function _probeBootImage() {
    return fetch('/api/boot-image/binary')
        .then(r => r.ok ? r.arrayBuffer() : null)
        .catch(() => null);
}

// Reset hook: re-overlay the cached boot image (or fetch once) so the
// programmer-authored binary survives manual resets.
function _maybeApplyBootImage() {
    if (window.bootImage) {
        try { sim.loadBootImage(window.bootImage); _syncBootEntryFromSim(); } catch (e) { console.warn('[bootImage] apply failed:', e); }
        return;
    }
    if (window.bootImageAvailable) {
        _probeBootImage().then(buf => {
            if (buf) { window.bootImage = buf;
                       try { sim.loadBootImage(buf); _syncBootEntryFromSim(); } catch(e){ console.warn('[bootImage] apply failed:', e); } }
        });
    }
}

// Task #217 — Generate the binary boot image from the persisted boot
// config. The server writes server/lumps/boot-image.bin and returns
// download / inline-binary URLs; we surface the download link and arm
// the simulator to load the image on the next reset.
function generateBootImage() {
    const result = document.getElementById('bdGenResult');
    const errEl  = document.getElementById('bdError');
    const btn    = document.getElementById('bdGenBtn');
    if (result) result.textContent = 'Generating…';
    if (errEl)  errEl.textContent  = '';
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    fetch('/api/boot-image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entrySlot: bootEntrySlot }),
    })
        .then(r => r.json().then(j => ({ ok: r.ok, body: j })))
        .then(({ ok, body }) => {
            if (!ok || body.ok === false) {
                if (result) result.textContent = '';
                if (errEl)  errEl.textContent  = (body && body.error) || 'Generation failed.';
                return;
            }
            const kib = (body.bytes / 1024).toFixed(1);
            if (result) {
                result.innerHTML =
                    `Generated <strong>${body.bytes.toLocaleString()}</strong> bytes ` +
                    `(${body.words.toLocaleString()} words, ${kib} KiB) — ` +
                    `<a href="${body.downloadUrl}" download="boot-image.bin" ` +
                    `style="color:#9bd;text-decoration:underline;">Download boot-image.bin</a>. ` +
                    `Reset the simulator to apply this image at boot.`;
            }
            // Cache the freshly-generated binary so the next sim.reset()
            // immediately overlays it (no extra round-trip needed). The
            // 'reset' listener calls _maybeApplyBootImage which prefers
            // window.bootImage when present.
            window.bootImageAvailable = true;
            _probeBootImage().then(buf => {
                if (buf) {
                    window.bootImage = buf;
                    try { sim.loadBootImage(buf); _syncBootEntryFromSim(); } catch(e) { console.warn('[bootImage] apply failed:', e); }
                }
            });
        })
        .catch(err => {
            if (result) result.textContent = '';
            if (errEl)  errEl.textContent  = 'Generation failed: ' + err;
        })
        .finally(() => {
            if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
        });
}

function uploadBootImageFile(file) {
    if (!file) return;
    const result  = document.getElementById('bdGenResult');
    const errEl   = document.getElementById('bdError');
    const upBtn   = document.getElementById('bdUploadBtn');
    const genBtn  = document.getElementById('bdGenBtn');
    if (result) result.textContent = 'Uploading…';
    if (errEl)  errEl.textContent  = '';
    if (upBtn)  { upBtn.disabled = true;  upBtn.style.opacity  = '0.6'; }
    if (genBtn) { genBtn.disabled = true; genBtn.style.opacity = '0.6'; }
    const reader = new FileReader();
    reader.onload = function(e) {
        const arrayBuf = e.target.result;
        const bytes    = new Uint8Array(arrayBuf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const data_b64 = btoa(binary);
        fetch('/api/boot-image/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data_b64 }),
        })
            .then(r => r.json().then(j => ({ ok: r.ok, body: j })))
            .then(({ ok, body }) => {
                if (!ok || body.ok === false) {
                    if (result) result.textContent = '';
                    if (errEl)  errEl.textContent  = (body && body.error) || 'Upload failed.';
                    return;
                }
                const kib = (body.bytes / 1024).toFixed(1);
                if (result) {
                    result.innerHTML =
                        `Uploaded <strong>${body.bytes.toLocaleString()}</strong> bytes ` +
                        `(${body.words.toLocaleString()} words, ${kib} KiB) — ` +
                        `<a href="${body.downloadUrl}" download="boot-image.bin" ` +
                        `style="color:#9bd;text-decoration:underline;">Download boot-image.bin</a>. ` +
                        `Reset the simulator to apply this image at boot.`;
                }
                window.bootImageAvailable = true;
                _probeBootImage().then(buf => {
                    if (buf) {
                        window.bootImage = buf;
                        try { sim.loadBootImage(buf); _syncBootEntryFromSim(); } catch(e) { console.warn('[bootImage] apply failed:', e); }
                    }
                });
            })
            .catch(err => {
                if (result) result.textContent = '';
                if (errEl)  errEl.textContent  = 'Upload failed: ' + err;
            })
            .finally(() => {
                if (upBtn)  { upBtn.disabled = false;  upBtn.style.opacity  = '1'; }
                if (genBtn) { genBtn.disabled = false; genBtn.style.opacity = '1'; }
            });
    };
    reader.onerror = function() {
        if (result) result.textContent = '';
        if (errEl)  errEl.textContent  = 'Failed to read file.';
        if (upBtn)  { upBtn.disabled = false;  upBtn.style.opacity  = '1'; }
        if (genBtn) { genBtn.disabled = false; genBtn.style.opacity = '1'; }
    };
    reader.readAsArrayBuffer(file);
}

function handleBootImageUpload(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    input.value = '';
    fetch('/api/boot-image/exists')
        .then(r => r.json())
        .then(({ exists }) => {
            if (exists) {
                const ok = window.confirm(
                    'A boot image already exists on the server.\n\n' +
                    'Uploading will permanently replace it. Continue?'
                );
                if (!ok) return;
            }
            uploadBootImageFile(file);
        })
        .catch(() => {
            const ok = window.confirm(
                'Could not verify whether a boot image already exists on the server.\n\n' +
                'Uploading may overwrite an existing image. Continue?'
            );
            if (ok) uploadBootImageFile(file);
        });
}

function updateNamespace() {
    const container = document.getElementById('namespaceTable');
    if (!container) return;
    let html = '<div class="ns-layout-header">NS_ENTRY_LAYOUT: 3 words per entry (96 bits) \u2014 click a row to inspect memory</div>';
    html += '<table class="ns-table"><thead><tr>';
    html += '<th>Idx</th><th class="ns-label-col">Label</th>';
    html += '<th>W0: Location</th>';
    html += '<th>W1: Type</th><th>W1: F</th><th>W1: G</th><th>W1: Limit</th>';
    html += '<th>W2: Seq</th><th>W2: CRC Seal</th>';
    html += '<th>Actions</th>';
    html += '</tr></thead><tbody>';

    const typeNames = ['NULL','Inform','Outform','Abstract'];
    for (let i = 0; i < sim.nsCount; i++) {
        const e = sim.readNSEntry(i);
        if (!e) continue;
        const manifest = sim.lazyManifest ? sim.lazyManifest[i] : null;
        let codeNotResident = false;
        if (manifest && e.word0_location > 0) {
            // Use lump header magic as the authoritative residency signal:
            // eviction zeroes the entire lump so magic=0x00 ≠ 0x1F (not resident).
            // This reflects the hardware-visible state regardless of the loaded flag.
            const lumpHdr = sim.memory ? sim.parseLumpHeader(sim.memory[e.word0_location]) : null;
            if (lumpHdr && !lumpHdr.valid) codeNotResident = true;
        }
        const lim = sim.parseNSWord1(e.word1_limit);
        const ver = (e.word2_seals >>> 25) & 0x7F;
        const seal = e.word2_seals & 0xFFFF;
        const isExpanded = (nsExpandedSlot === i);
        const isBootNS = (i === bootEntrySlot);
        const warmStyle = codeNotResident ? 'color:#f0a040;font-style:italic;' : '';
        const rowOpacity = codeNotResident ? 'opacity:0.8;' : '';
        html += `<tr class="ns-row${isExpanded ? ' ns-row-active' : ''}" onclick="toggleNSDetail(${i})" style="cursor:pointer;${rowOpacity}">`;
        html += `<td class="ns-idx-cell"><span class="ns-boot-btn${isBootNS ? ' boot-entry-active' : ''}" onclick="event.stopPropagation();setBootEntrySlot(${i})" title="${isBootNS ? 'Current boot entry' : 'Set as boot entry'}">${isBootNS ? '\u26a1' : i}</span></td>`;
        html += `<td class="ns-label" style="${warmStyle}" onmouseenter="showNSEntryTooltip(event,${i})" onmouseleave="hideNSEntryTooltip()">${e.label || '-'}</td>`;
        html += `<td style="${warmStyle}cursor:pointer;text-decoration:underline dotted;color:#4ec9b0;" title="Open memory view at this address" onclick="event.stopPropagation();jumpToMemory(${e.word0_location})">0x${e.word0_location.toString(16).toUpperCase().padStart(8, '0')}</td>`;
        if (codeNotResident) {
            const priorityTag = manifest.priority === 'hot' ? 'Hot' : (manifest.priority === 'cold' ? 'Cold' : 'Warm');
            html += `<td style="${warmStyle}">${typeNames[e.gtType] || '?'} <span style="font-size:0.7rem;">(${priorityTag})</span></td>`;
        } else {
            html += `<td>${typeNames[e.gtType] || '?'}</td>`;
        }
        html += `<td class="ns-flag" style="${warmStyle}">${lim.f}</td>`;
        html += `<td class="ns-flag" style="${warmStyle}">${e.gBit}</td>`;
        html += `<td style="${warmStyle}">0x${lim.limit.toString(16).toUpperCase().padStart(5, '0')}</td>`;
        html += `<td style="${warmStyle}">${ver}</td>`;
        html += `<td style="${warmStyle}">0x${seal.toString(16).toUpperCase().padStart(4, '0')}</td>`;
        if (codeNotResident) {
            html += `<td class="ns-entry-actions"><span style="${warmStyle}">not resident</span></td>`;
        } else {
            html += `<td class="ns-entry-actions"><button class="btn btn-primary btn-xs" onclick="event.stopPropagation();exportEntryMemory(${i})">Export</button> <button class="btn btn-xs" onclick="event.stopPropagation();importEntryMemory(${i})" style="background:#3a86ff;color:#fff;border:none;">Import</button></td>`;
        }
        html += '</tr>';
        if (isExpanded) {
            html += `<tr class="ns-detail-row"><td colspan="10">`;
            html += `<div class="ns-detail-panel">`;
            html += `<div class="ns-detail-title">Memory at 0x${e.word0_location.toString(16).toUpperCase().padStart(4, '0')} \u2014 ${e.label || 'Slot '+i} (${lim.limit + 1} words)</div>`;
            html += renderMemoryDump(e.word0_location, lim.limit + 1, i);
            html += `</div></td></tr>`;
        }
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

// ── Memory dump view ──────────────────────────────────────────────────────────

window.memoryViewAddr = 0;

function jumpToMemory(addr) {
    if (isNaN(addr) || addr < 0) addr = 0;
    addr = addr >>> 0;
    window.memoryViewAddr = addr;
    const inp = document.getElementById('memAddrInput');
    if (inp) inp.value = '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
    switchView('memory');
}

function renderMemoryView() {
    const container = document.getElementById('memoryViewTable');
    if (!container) return;

    const addr  = (window.memoryViewAddr || 0) >>> 0;
    const countEl = document.getElementById('memCountInput');
    const count = Math.max(16, Math.min(4096, parseInt(countEl ? countEl.value : '256', 10) || 256));
    const COLS  = 8;   // words per row

    // Sync address input
    const inp = document.getElementById('memAddrInput');
    if (inp) inp.value = '0x' + addr.toString(16).toUpperCase().padStart(4, '0');

    // Build annotation map: ns slot physical addresses
    const nsAnnot = {};
    if (sim && sim.nsCount) {
        for (let i = 0; i < sim.nsCount; i++) {
            const e = sim.readNSEntry(i);
            if (e && e.word0_location > 0) {
                nsAnnot[e.word0_location] = `← Slot ${i} (${e.label || '?'}) lump start`;
            }
        }
        if (sim.NS_TABLE_BASE) nsAnnot[sim.NS_TABLE_BASE] = '← NS_TABLE_BASE';
    }

    let html = '<table class="ns-mem-table" style="font-family:monospace;font-size:0.76rem;min-width:100%;">';
    html += '<thead><tr><th style="min-width:5rem;">Addr</th>';
    for (let c = 0; c < COLS; c++) html += `<th>+${c}</th>`;
    html += '<th style="padding-left:0.5rem;">Annotation</th></tr></thead><tbody>';

    for (let row = 0; row < count; row += COLS) {
        const rowAddr = addr + row;
        const annot   = nsAnnot[rowAddr] || '';
        const rowStyle = annot ? ' style="background:rgba(200,155,60,0.07);"' : '';
        html += `<tr${rowStyle}>`;
        html += `<td style="color:#6b7280;padding-right:0.5rem;">0x${rowAddr.toString(16).toUpperCase().padStart(4,'0')}</td>`;
        for (let c = 0; c < COLS; c++) {
            const a = rowAddr + c;
            const w = (sim && a < sim.memory.length) ? (sim.memory[a] >>> 0) : 0;
            const style = w ? '' : ' style="color:#3a3a4a;"';
            html += `<td${style}>${w ? ('0x' + w.toString(16).toUpperCase().padStart(8,'0')) : '00000000'}</td>`;
        }
        html += `<td style="color:#c89b3c;padding-left:0.5rem;font-size:0.7rem;">${annot}</td>`;
        html += '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;
}

function _getNSEntryTooltipEl() {
    let el = document.getElementById('nsEntryTooltip');
    if (!el) {
        el = document.createElement('div');
        el.id = 'nsEntryTooltip';
        el.className = 'ns-entry-tooltip';
        document.body.appendChild(el);
    }
    return el;
}

function showNSEntryTooltip(evt, idx) {
    const tt = _getNSEntryTooltipEl();
    const e = sim.readNSEntry(idx);
    if (!e) { tt.classList.remove('visible'); return; }

    const manifest = sim.lazyManifest ? sim.lazyManifest[idx] : null;
    let codeNotResident = false;
    if (manifest && e.word0_location > 0) {
        const lumpHdr = sim.memory ? sim.parseLumpHeader(sim.memory[e.word0_location]) : null;
        if (lumpHdr && !lumpHdr.valid) codeNotResident = true;
    }

    const lim = sim.parseNSWord1(e.word1_limit);
    const typeNames = ['NULL','Inform','Outform','Abstract'];
    const badgeClass = ['ns-tt-badge-null','ns-tt-badge-inform','ns-tt-badge-outform','ns-tt-badge-abstract'];
    const typeName = typeNames[lim.gtType] || '?';
    const ver = (e.word2_seals >>> 25) & 0x7F;
    const seal = e.word2_seals & 0xFFFF;
    const sizeWords = lim.limit + 1;
    const sizeBytes = sizeWords * 4;

    let absMatch = null;
    if (abstractionRegistry && typeof abstractionRegistry.getAbstraction === 'function') {
        absMatch = abstractionRegistry.getAbstraction(idx);
    }

    let html = `<div class="ns-tt-header">Slot ${idx}<span class="ns-tt-badge ${badgeClass[lim.gtType]}">${typeName}</span></div>`;
    if (e.label) html += `<div class="ns-tt-label">"${e.label}"</div>`;
    if (codeNotResident) {
        const priorityTag = manifest.priority === 'hot' ? 'Hot' : (manifest.priority === 'cold' ? 'Cold' : 'Warm');
        html += `<div style="color:#f0a040;font-size:0.75rem;margin-top:0.25rem;margin-bottom:0.25rem;"><b>${priorityTag}</b> — code not resident, will lazy-load on first CALL</div>`;
    }
    if (absMatch) {
        const absName = absMatch.name || '';
        const absLayer = absMatch.layer != null ? ` · Layer ${absMatch.layer}` : '';
        const absMethods = Array.isArray(absMatch.methods) ? absMatch.methods : [];
        const ttProfile = _getAbstractionProfile(absMatch);
        const ttProfileClass = ttProfile === 'Full' ? 'profile-badge-full' : 'profile-badge-iot';
        html += `<div class="ns-tt-abs-name">${absName}<span class="abs-profile-badge ${ttProfileClass}" style="margin-left:6px;vertical-align:middle;">${ttProfile}</span><span style="color:#9ca3af;font-weight:400;font-size:0.7rem;">${absLayer}</span></div>`;
        if (absMatch.description) {
            const d = absMatch.description;
            html += `<div style="color:#9ca3af;font-size:0.72rem;margin-bottom:0.25rem;">${d.slice(0,100)}${d.length > 100 ? '…' : ''}</div>`;
        }
        if (absMethods.length) {
            html += `<div style="color:#6b7280;font-size:0.7rem;margin-bottom:0.2rem;">${absMethods.length} method${absMethods.length !== 1 ? 's' : ''}: <span style="color:#c084fc;">${absMethods.slice(0,5).join(', ')}${absMethods.length > 5 ? ', …' : ''}</span></div>`;
        }
        const catalogEntry = Array.isArray(_lumpCatalog) ? _lumpCatalog.find(c => c.nsSlot === idx) : null;
        const mediaTags = catalogEntry && catalogEntry.mediaTags;
        if (mediaTags && typeof mediaTags === 'object') {
            const tagEntries = Object.entries(mediaTags);
            if (tagEntries.length) {
                html += `<div style="color:#6b7280;font-size:0.7rem;margin-top:0.3rem;margin-bottom:0.15rem;font-weight:600;letter-spacing:0.02em;">Media Types</div>`;
                html += `<table style="font-size:0.69rem;border-collapse:collapse;width:100%;margin-bottom:0.1rem;">`;
                for (const [tag, val] of tagEntries) {
                    const hexStr = (val && val.hex) ? val.hex : (typeof val === 'string' ? val : '');
                    const desc   = (val && val.description) ? val.description : '';
                    html += `<tr><td style="color:#c084fc;font-family:monospace;padding:1px 6px 1px 0;white-space:nowrap;">${tag}</td><td style="color:#9ca3af;padding:1px 6px 1px 0;white-space:nowrap;font-family:monospace;">${hexStr}</td><td style="color:#d1d5db;padding:1px 0;">${desc}</td></tr>`;
                }
                html += `</table>`;
            }
        }
        html += '<hr class="ns-tt-divider">';
    }
    html += `<div class="ns-tt-row"><b>Address</b> 0x${e.word0_location.toString(16).toUpperCase().padStart(8,'0')}</div>`;
    html += `<div class="ns-tt-row"><b>Size</b> ${sizeWords} word${sizeWords !== 1 ? 's' : ''} &nbsp;(${sizeBytes} bytes)</div>`;
    html += `<div class="ns-tt-row"><b>Version</b> ${ver} &nbsp;&nbsp;<b style="margin-left:0.6rem">CRC</b> 0x${seal.toString(16).toUpperCase().padStart(4,'0')}</div>`;
    if (e.clistCount) html += `<div class="ns-tt-row"><b>C-list</b> ${e.clistCount} entr${e.clistCount !== 1 ? 'ies' : 'y'}</div>`;
    const flags = [];
    if (lim.f) flags.push('<span class="ns-tt-flag">F Far/Tunnel</span>');
    if (lim.b) flags.push('<span class="ns-tt-flag">B</span>');
    if (e.gBit) flags.push('<span class="ns-tt-flag">G GC-live</span>');
    if (e.chainable) flags.push('<span class="ns-tt-flag">Chainable</span>');
    if (flags.length) html += `<div class="ns-tt-row" style="flex-wrap:wrap;gap:4px;"><b>Flags</b> ${flags.join(' ')}</div>`;

    tt.innerHTML = html;
    tt.classList.add('visible');
    // Anchor to the left edge of the 3rd column (W0: Location) of the hovered row
    const row = evt.target.closest('tr');
    const col3 = row ? row.querySelectorAll('td')[2] : null;
    _positionNSTooltip(tt, evt, col3);
}

function _positionNSTooltip(tt, evt, anchorEl) {
    const margin = 8;
    tt.style.left = '0px'; tt.style.top = '0px';
    const tw = tt.offsetWidth || 260;
    const th = tt.offsetHeight || 140;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Use the left edge of the anchor element (3rd column) as the right boundary
    const anchorX = anchorEl ? anchorEl.getBoundingClientRect().left : evt.clientX;
    let x = anchorX - tw - margin;
    let y = evt.clientY - th / 2;
    if (x < 8) x = anchorX + margin;
    if (x + tw > vw - 8) x = vw - tw - 8;
    if (y < 8) y = 8;
    if (y + th > vh - 8) y = vh - th - 8;
    tt.style.left = x + 'px';
    tt.style.top  = y + 'px';
}

function hideNSEntryTooltip() {
    const tt = document.getElementById('nsEntryTooltip');
    if (tt) tt.classList.remove('visible');
}

let selectedAbsIndex = null;
let absCollapsedLayers = {};
let bootEntrySlot = (() => { const s = parseInt(localStorage.getItem('bootEntrySlot'), 10); return Number.isFinite(s) ? Math.max(0, Math.min(255, s)) : 3; })();
let userMethodData = {};
let userMethodLists = {};

// ── Boot Sequence Code ─────────────────────────────────────────────────────
// Actual hardware boot steps that install each Layer-0 abstraction.
// Mirrors simulator.js _bootStep() exactly.
