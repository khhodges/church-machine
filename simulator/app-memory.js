var _crDetailHighlightPC = null;

// _findSrcLump(slotIdx, slotLabel)
// Primary:   fixed-slot match — lump manifest carries a non-null ns_slot equal to slotIdx.
// Secondary: floating-lump match — ns_slot is null/undefined but the lump's abstraction
//            name matches the live NS entry's label (set when the Loader dynamically places
//            the lump into slotIdx at runtime).
// Returns the matching lump cache entry, or null.
function _findSrcLump(slotIdx, slotLabel) {
    if (typeof _lumpsCache === 'undefined' || !Array.isArray(_lumpsCache)) return null;
    const bySlot = _lumpsCache.find(l => l.ns_slot !== null && l.ns_slot !== undefined && parseInt(l.ns_slot) === slotIdx);
    if (bySlot) return bySlot;
    if (slotLabel) {
        return _lumpsCache.find(l => (l.ns_slot === null || l.ns_slot === undefined) && l.abstraction === slotLabel) || null;
    }
    return null;
}

function _resolveCListPetName(gtWord) {
    if (!gtWord || gtWord === 0) return null;
    try {
        const parsed = sim.parseGT(gtWord);
        if (parsed.type === 3) {
            const ab = sim.parseAbstractGT(gtWord);
            const DEVICE_CLASSES = { 1: 'LED', 2: 'UART', 3: 'Button', 4: 'Timer', 5: 'Display' };
            if (ab.ab_type === 0) {
                const dc = DEVICE_CLASSES[ab.device_class] || `dc${ab.device_class}`;
                return `${dc}[${ab.device_data}]`;
            } else {
                const AB_TYPE_NAMES = { 0: 'I/O', 1: 'M-Elevation' };
                return `${AB_TYPE_NAMES[ab.ab_type] || `ab${ab.ab_type}`} 0x${ab.ab_data.toString(16).toUpperCase()}`;
            }
        } else {
            return (sim.nsLabels && sim.nsLabels[parsed.index]) ? sim.nsLabels[parsed.index] : null;
        }
    } catch(e) { return null; }
}

function updateCRDetail() {
    if (!sim) return;
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
        titleEl.innerHTML = '';
        titleEl.style.display = 'none';
        contentEl.innerHTML = '<div style="color:var(--text-secondary);padding:1rem;">Register is empty (all words zero).</div>';
        contentEl.classList.remove('crd-content-thread');
        return;
    }

    titleEl.innerHTML = '';
    titleEl.style.display = 'none';

    const parsedPerms = sim.parseGT(sim.cr[crIdx].word0).permissions;
    const hasX = parsedPerms.X;
    const hasL = parsedPerms.L;
    const hasR = parsedPerms.R;
    const hasW = parsedPerms.W;
    const crMbit = sim.cr[crIdx].m;
    const nsIdx = cr.gtIndex;
    // Switch the editor's source context to this NS slot (saves outgoing,
    // restores incoming from localStorage or sticky-patch src fallback).
    if (typeof _asmSrcSwitchContext === 'function') _asmSrcSwitchContext(nsIdx);

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

    // ── Correct default tab for this CR's capabilities ───────────────────────
    crDetailTab = correctCRDetailTab(crDetailTab, showCode, showCList, showData);

    // ── Hoist shared data used across multiple panels ─────────────────────────
    const _baseLoc      = cr.word1_location >>> 0;
    const _limitVal     = cr.limit17;
    const _baseWord0    = (_baseLoc < sim.memory.length) ? (sim.memory[_baseLoc] >>> 0) : 0;
    const _lumpHdr      = sim.parseLumpHeader(_baseWord0);
    let _lumpClistBase  = 0;
    if (_lumpHdr.valid && _lumpHdr.cc > 0) {
        _lumpClistBase = _baseLoc + _lumpHdr.lumpSize - _lumpHdr.cc;
    } else {
        const _nsEtmp = sim.readNSEntry(nsIdx);
        if (_nsEtmp) {
            const _nsLimtmp = sim.parseNSWord1(_nsEtmp.word1_limit);
            if (_nsLimtmp.clistCount > 0) {
                _lumpClistBase = (_nsEtmp.word0_location >>> 0) + (_nsLimtmp.limit + 1) - _nsLimtmp.clistCount;
            }
        }
    }
    const _sharedNSE    = sim.readNSEntry(nsIdx);
    const _clBase       = _sharedNSE ? (_sharedNSE.word0_location >>> 0) : 0;
    const _clHdr        = (_clBase > 0 && _clBase < sim.memory.length)
                          ? sim.parseLumpHeader(sim.memory[_clBase] >>> 0)
                          : { valid: false };
    const _clNSLim      = sim.parseNSWord1(cr.word2_limit_raw);
    const _clistCount   = (_clHdr.valid && _clHdr.cc > 0)
                          ? _clHdr.cc
                          : (_clNSLim.clistCount > 0 ? _clNSLim.clistCount : cr.limit17 + 1);
    const _clistBase    = cr.word1_location >>> 0;
    const _absName      = (sim.nsLabels && sim.nsLabels[nsIdx]) || '';
    const _absLabel     = _absName ? (_absName + ' Abstraction') : '';

    const _activeTabLabel =
        crDetailTab === 'code'     ? 'Code'     :
        crDetailTab === 'clist'    ? 'C-List'   :
        crDetailTab === 'api'      ? 'API'      :
        crDetailTab === 'lump'     ? 'Lump'     :
        crDetailTab === 'register' ? 'Register' :
        crDetailTab === 'binary'   ? 'Binary'   : 'Code';
    let html = '';
    html += '<div class="crd-menu-bar">';
    const _headingText = _absLabel
        ? (_activeTabLabel && _activeTabLabel !== 'Code' ? `${_absLabel} \u2014 ${_activeTabLabel}` : _absLabel)
        : _activeTabLabel;
    html += `<span class="crd-menu-active-label" id="crdMenuActiveLabel" data-abs-label="${_absLabel.replace(/"/g,'&quot;')}">${_headingText}</span>`;
    if (showCode) {
        html += '<div class="crd-tab-strip">';
        html += `<button class="crd-tab${crDetailTab==='code'?' active':''}" onclick="switchCRDetailTab('code')">Code</button>`;
        html += `<button class="crd-tab${crDetailTab==='clist'?' active':''}" onclick="switchCRDetailTab('clist')">C-List</button>`;
        html += `<button class="crd-tab${crDetailTab==='api'?' active':''}" onclick="switchCRDetailTab('api')">API</button>`;
        html += `<button class="crd-tab${crDetailTab==='lump'?' active':''}" onclick="switchCRDetailTab('lump')">Lump</button>`;
        if (showEditButton) {
            html += `<button class="crd-action-btn" onclick="editCRCodeInEditor()" title="Edit \u2014 Load this code lump into the assembly editor">\u270E\u202FEdit</button>`;
            html += `<button class="crd-action-btn" onclick="patchSimulator()" title="Patch \u2014 Assemble editor code and write it directly into simulator memory at this lump\u2019s base address.">\u21A9\u202FPatch</button>`;
        }
        if (_lumpHdr.valid) {
            const _cmpLsz = _lumpHdr.lumpSize;
            let _cmpMin = 64;
            while (_cmpMin < (1 + _lumpHdr.cw + _lumpHdr.cc)) _cmpMin <<= 1;
            const _canCmp2 = _cmpMin < _cmpLsz;
            html += `<button class="crd-action-btn crd-action-btn-compress${_canCmp2 ? '' : ' crd-action-btn-dim'}" ` +
                    `onclick="${_canCmp2 ? `lumpCompress(${nsIdx})` : ''}" ` +
                    `${_canCmp2 ? '' : 'disabled '}` +
                    `title="${_canCmp2 ? `Compress \u2014 shrink freespace + trim unused c-list GTs, then auto-save` : 'Already at minimum size \u2014 no freespace or unused GTs'}">\u2913\u202FCompress</button>`;
            html += `<button class="crd-action-btn crd-action-btn-compress" ` +
                    `onclick="lumpSaveLump(${nsIdx})" ` +
                    `title="Save Lump \u2014 persist the current lump binary to server/lumps/ so it survives restarts">\u2193\u202FSave</button>`;
        }
        html += '</div>';
    }
    if (showThread) {
        html += `<span class="crd-zone-nav" title="Jump to zone \u00b7 hover for live data">`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone('hdr')" onmouseenter="showZonePopup(event,'hdr',${nsIdx})" onmouseleave="hideZonePopup()">Hdr</button>`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(5)" onmouseenter="showZonePopup(event,5,${nsIdx})" onmouseleave="hideZonePopup()">⑤\u202FDR</button>`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(4)" onmouseenter="showZonePopup(event,4,${nsIdx})" onmouseleave="hideZonePopup()">④\u202FHeap</button>`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(3)" onmouseenter="showZonePopup(event,3,${nsIdx})" onmouseleave="hideZonePopup()">③\u202FFree</button>`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(2)" onmouseenter="showZonePopup(event,2,${nsIdx})" onmouseleave="hideZonePopup()">②\u202FStack</button>`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(1)" onmouseenter="showZonePopup(event,1,${nsIdx})" onmouseleave="hideZonePopup()">①\u202FCaps</button>`;
        html += `</span>`;
    }
    html += '<div class="crd-hamburger-wrap">';
    html += `<button class="crd-hamburger" onclick="toggleCRDetailMenu(event)" title="Views &amp; Actions">&#x2630;</button>`;
    html += '<div class="crd-menu-dropdown" id="crdMenuDropdown" style="display:none">';
    if (!showCode) {
        html += '<div class="crd-menu-section-label">View</div>';
        html += `<button class="crd-menu-item${crDetailTab==='clist'?' crd-menu-item-active':''}" data-tab="clist" onclick="switchCRDetailTab('clist');toggleCRDetailMenu()">C-List</button>`;
        html += `<button class="crd-menu-item${crDetailTab==='lump'?' crd-menu-item-active':''}" data-tab="lump" onclick="switchCRDetailTab('lump');toggleCRDetailMenu()">Lump</button>`;
        html += `<button class="crd-menu-item${crDetailTab==='register'?' crd-menu-item-active':''}" data-tab="register" onclick="switchCRDetailTab('register');toggleCRDetailMenu()">Register</button>`;
        html += `<button class="crd-menu-item${crDetailTab==='binary'?' crd-menu-item-active':''}" data-tab="binary" onclick="switchCRDetailTab('binary');toggleCRDetailMenu()">Binary</button>`;
        html += `<button class="crd-menu-item${crDetailTab==='api'?' crd-menu-item-active':''}" data-tab="api" onclick="switchCRDetailTab('api');toggleCRDetailMenu()">API</button>`;
    }
    if (showEditButton) {
        html += '<div class="crd-menu-divider"></div>';
        html += '<div class="crd-menu-section-label">FPGA</div>';
        html += `<button class="crd-menu-item crd-menu-item-fpga" onclick="patchFPGA();toggleCRDetailMenu()" title="Patch FPGA \u2014 Runs Patch Simulator first, then uploads the updated lump to the Ti60 F225 over WebSerial (UART). Requires an active hardware connection.">&#x21A9; Patch FPGA</button>`;
        html += `<button class="crd-menu-item crd-menu-item-fpga" onclick="exportPatchFile();toggleCRDetailMenu()" title="Export Patch \u2014 Assembles the code and downloads a .patch file with UART frames, CRC, and RUN sentinel. Flash with: python3 patch_fpga.py /dev/ttyUSB1 file.patch">&#x2B73; Export Patch</button>`;
        html += `<button class="crd-menu-item crd-menu-item-fpga" onclick="exportLumpAsPatch();toggleCRDetailMenu()" title="Lump\u2192Patch \u2014 Pick a pre-built .lump binary, validate its header, and wrap it into a .patch UART frame file for FPGA flashing.">&#x2B73; Lump\u2192Patch</button>`;
    }
    html += '<div class="crd-menu-divider"></div>';
    html += '<div class="crd-menu-section-label">Debug</div>';
    html += `<button class="crd-menu-item${crDetailTab==='register'?' crd-menu-item-active':''}" data-tab="register" id="crdTab-register" onclick="switchCRDetailTab('register');toggleCRDetailMenu()">Register</button>`;
    html += `<button class="crd-menu-item${crDetailTab==='binary'?' crd-menu-item-active':''}" data-tab="binary" id="crdTab-binary" onclick="switchCRDetailTab('binary');toggleCRDetailMenu()">Binary</button>`;
    if (showEditButton) {
        html += '<div class="crd-menu-divider"></div>';
        html += `<button class="crd-menu-item crd-menu-item-publish" onclick="publishToLibrary();toggleCRDetailMenu()" title="Publish \u2014 Compile and publish this abstraction to the Mum Tunnel Library on GitHub, including machine words, c-list, source, and metadata.">&#x21E1; Publish</button>`;
    }
    html += '</div>';
    html += '</div>';
    html += '</div>';

    // Pre-compute clobber analysis once (only when a panel that needs it will render);
    // reused by both the Code and C-List panels.
    // Prefer _clBase/_clHdr (from NS entry, always correct lump header) when valid;
    // fall back to _baseLoc/_lumpHdr for code-lump paths where _clBase may be absent.
    let _sharedRefResult = null;
    if (showCode || showCList) {
        const _sharedRefCodeBase  = (_clHdr && _clHdr.valid && _clHdr.cw > 0) ? _clBase  : _baseLoc;
        const _sharedRefCodeCount = (_clHdr && _clHdr.valid && _clHdr.cw > 0) ? _clHdr.cw
                                  : ((_lumpHdr.valid && _lumpHdr.cw > 0) ? _lumpHdr.cw : 0);
        if (_sharedRefCodeCount > 0) {
            _sharedRefResult = _computeReferencedCListSlots(_sharedRefCodeBase + 1, _sharedRefCodeCount);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel: Code — disassembly table (only rendered when X permission is held)
    // ═══════════════════════════════════════════════════════════════════════════
    if (showCode) {
    html += `<div class="crd-panel" id="crdPanel-code" style="display:${crDetailTab==='code'?'block':'none'}">`;
    html += '<div class="cr-detail-grid">';
    {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">Code View \u2014 Executable Memory</div>';
        // Sticky patch badge — shown when a patch is queued to survive reset
        if (typeof _stickyPatches !== 'undefined' && _stickyPatches[nsIdx]) {
            html += `<div class="crd-sticky-badge">` +
                `\uD83D\uDD12\u202FSticky patch active \u2014 re-applied after every reset.` +
                `<button class="crd-sticky-clear" onclick="clearStickyPatch(${nsIdx})" title="Remove sticky patch">\u2715\u202FClear</button>` +
                `</div>`;
        }
        const baseLoc   = _baseLoc;
        const limitVal  = _limitVal;
        const asm       = new ChurchAssembler();
        const word0     = _baseWord0;
        const lumpHdr   = _lumpHdr;

        let codeStart = baseLoc;
        let codeLimit = limitVal + 1;

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

        // Show boot preamble rows only while boot is in progress or has faulted.
        if (nsIdx === bootEntrySlot && !(sim.bootComplete && !sim.halted)) {
            const _beLabel = (sim.nsLabels && sim.nsLabels[bootEntrySlot]) || `Slot ${bootEntrySlot}`;
            const _bootPreamble = [
                { addr: 'B:00', desc: 'FAULT_RST',   decomp: 'CR0\u2013CR15 \u2190 NULL \u00b7 DR0\u2013DR15 \u2190 0' },
                { addr: 'B:01', desc: 'LOAD_NS',     decomp: 'CR15 \u2190 NS[0] Namespace (M=1, base=0x0000, perms=none)' },
                { addr: 'B:02', desc: 'INIT_THRD',   decomp: 'CR12 \u2190 NS[1] thread stack GT (M=1, Inform, zero perms)' },
                { addr: 'B:03', desc: 'INIT_HEAP',   decomp: 'CR5(RW) \u2190 thread heap \u00b7 CHANGE-consistent synthesis' },
                { addr: 'B:04', desc: 'CALL_HOME',   decomp: 'Tunnel.Register \u2192 23-byte packet [0xCE11, board, FW, HMAC(4), UID(8), reason, fault, NIA(4)] \u00b7 await ACK' },
                { addr: 'B:05', desc: 'INIT_ABSTR',  decomp: `CR6(E) \u2190 NS[${bootEntrySlot}] \u26a1 ${_beLabel} (M=1, pre-CALL token)` },
                { addr: 'B:06', desc: 'NUC_CLIST',   decomp: `CR6(M=1, E) \u2190 ${_beLabel} c-list \u00b7 push sentinel` },
                { addr: 'B:07', desc: 'NUC_CODE',    decomp: 'CR14(M=1, R+X) \u2190 lump code \u00b7 PC\u21900 \u00b7 CALL CR0 \u2192 dispatch begins' },
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
            const typNames  = ['code', 'namespace', 'thread', 'outform'];
            const typStr    = typNames[lumpHdr.typ] || String(lumpHdr.typ);
            const hdrDisasm = `.header ${typStr} n\u22126=${lumpHdr.n_minus_6}\u2192${lumpHdr.lumpSize}w`
                            + ` cw=${lumpHdr.cw} cc=${lumpHdr.cc}`;
            codeHtml += `<tr class="code-row-infra">`;
            codeHtml += `<td class="cr-idx">0x${baseLoc.toString(16).toUpperCase().padStart(4,'0')}</td>`;
            codeHtml += `<td class="cr-gt">0x${word0.toString(16).toUpperCase().padStart(8,'0')}</td>`;
            codeHtml += `<td class="code-disasm">${hdrDisasm}</td>`;
            if (_brArrows.hasBranches) codeHtml += '<td class="br-arrow-col"></td>';
            const _hdrLumpName = _absName || (nsIdx >= 0 ? `Slot ${nsIdx}` : '');
            codeHtml += `<td class="code-decompiled code-decompiled-infra">header${_hdrLumpName ? ' \u00b7 <span style="color:#4ec9b0;font-weight:600;">' + _hdrLumpName + '</span>' : ''}</td>`;
            codeHtml += '</tr>';
            codeStart = baseLoc + 1;
            codeLimit = lumpHdr.cw;
        }

        const _crPets3 = {};

        // Use the pre-computed clobber analysis to highlight offending rows
        const _earlyClobberWarnings = (_sharedRefResult && _sharedRefResult.clobberWarnings)
            ? _sharedRefResult.clobberWarnings : [];
        const _clobberWordMap = new Map(); // word index → [{cr, prevAliasedAtWord}]
        const _clobberOriginMap = new Map(); // prevAliasedAtWord → [{cr, clobberAtWord}]
        for (const _cwe of _earlyClobberWarnings) {
            if (!_clobberWordMap.has(_cwe.word)) _clobberWordMap.set(_cwe.word, []);
            _clobberWordMap.get(_cwe.word).push(_cwe);
            if (typeof _cwe.prevAliasedAtWord === 'number' && _cwe.prevAliasedAtWord >= 0) {
                if (!_clobberOriginMap.has(_cwe.prevAliasedAtWord)) _clobberOriginMap.set(_cwe.prevAliasedAtWord, []);
                _clobberOriginMap.get(_cwe.prevAliasedAtWord).push({ cr: _cwe.cr, clobberAtWord: _cwe.word });
            }
        }

        const _brLabelCondNames = ['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE','','NV'];
        const _brCondLong       = ['Equal','Not Equal','Carry Set','Carry Clear','Minus','Plus','Overflow Set','Overflow Clear','Higher','Lower or Same','Greater or Equal','Less Than','Greater Than','Less or Equal','Always','Never'];
        const _injectCondTooltip = (html, condCode) => {
            if (condCode === 14) return html;
            const abbr = _brLabelCondNames[condCode];
            if (!abbr) return html;
            return html.replace(
                new RegExp(`^([A-Z]+)(${abbr})(\\s|$)`),
                (m, prefix, ca, tail) =>
                    `${prefix}<span class="cond-abbr" title="${ca}\u00A0\u2014\u00A0${_brCondLong[condCode]}">${ca}</span>${tail}`
            );
        };
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

        // CLOOMC method table: the first N code words are method pointers, not
        // instructions.  Read the count from the manifest so we can render them
        // as .method_ptr rows instead of passing them to the disassembler.
        const _cloomcMethods = (typeof _lumpManifests !== 'undefined' &&
                                _lumpManifests[nsIdx] &&
                                Array.isArray(_lumpManifests[nsIdx]._methods))
            ? _lumpManifests[nsIdx]._methods : [];
        const _methodTableCount = _cloomcMethods.length;

        // Build a map from instruction word-index → method info, using the
        // pointer values stored in the method table (each value is the word
        // offset of that method's first instruction within _codeWords).
        const _methodStartMap = new Map();
        for (let i = 0; i < _methodTableCount; i++) {
            const offset = _codeWords[i]; // raw method table word = instruction offset
            const method = _cloomcMethods[i];
            if (method && typeof offset === 'number' && offset >= _methodTableCount) {
                _methodStartMap.set(offset, method);
            }
        }

        let hasCodeData = lumpHdr.valid;
        for (let w = 0; w < _codeWords.length; w++) {
            const addr = codeStart + w;
            const word = _codeWords[w];
            if (word === 0 && !hasCodeData) continue;
            hasCodeData = true;

            // Method table entry — render as data annotation, not an instruction
            if (w < _methodTableCount) {
                const _mth = _cloomcMethods[w];
                const _mthName = _mth ? _mth.name : `method_${w}`;
                const _mthInternal = _mth && _mth._internal;
                const _vis = _mthInternal
                    ? '<span style="color:#888">internal</span>'
                    : '<span style="color:#4ec9b0">public</span>';
                codeHtml += `<tr class="code-row-infra">`;
                codeHtml += `<td class="cr-idx">0x${addr.toString(16).toUpperCase().padStart(4,'0')}</td>`;
                codeHtml += `<td class="cr-gt">0x${word.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                codeHtml += `<td class="code-disasm">.method_ptr&nbsp;&nbsp;${_mthName}</td>`;
                if (_brArrows.hasBranches) codeHtml += '<td class="br-arrow-col"></td>';
                codeHtml += `<td class="code-decompiled code-decompiled-infra">method table[${w}] \u00b7 ${_vis}</td>`;
                codeHtml += '</tr>';
                continue;
            }

            const isPC    = lumpHdr.valid
                ? (addr === baseLoc + 1 + sim.pc)
                : ((addr === (sim.programBaseAddr || 0) + sim.pc) || (addr === sim.pc));
            const isGateHL = _crDetailHighlightPC !== null && (lumpHdr.valid
                ? (addr === baseLoc + 1 + _crDetailHighlightPC)
                : ((addr === (sim.programBaseAddr || 0) + _crDetailHighlightPC) || (addr === _crDetailHighlightPC)));
            const isBP    = simBreakpoints.has(addr);

            // Method-start banner — emitted before any branch label at this word
            if (_methodStartMap.has(w)) {
                const _ms = _methodStartMap.get(w);
                const _msVis = _ms._internal
                    ? '<span class="cmp-priv-lbl">internal</span>'
                    : '<span class="cmp-pub-lbl">public</span>';
                const _colspan = _brArrows.hasBranches ? 5 : 4;
                codeHtml += `<tr class="code-row-method-hdr"><td colspan="${_colspan}" class="code-method-hdr-line">\u25c6\u00a0${_ms.name}\u00a0\u2014\u00a0${_msVis}</td></tr>`;
            }

            if (_brLabelMap.has(w)) {
                const _lbl = _brLabelMap.get(w);
                const _colspan = _brArrows.hasBranches ? 5 : 4;
                codeHtml += `<tr class="code-row-label"><td colspan="${_colspan}" class="code-label-line">${_lbl}:</td></tr>`;
            }

            const decomp = _decompileWord(word, addr, nsIdx, _lumpClistBase, _crPets3);
            const isCompiler = decomp && decomp.compiler;
            let rowClass = isPC ? 'code-pc-row' : (isBP ? 'code-bp-row' : (isCompiler ? 'code-row-compiler' : ''));
            if (isGateHL) rowClass = (rowClass ? rowClass + ' ' : '') + 'code-gate-row';
            const _clobberInfos = _clobberWordMap.get(w);
            if (_clobberInfos) rowClass = (rowClass ? rowClass + ' ' : '') + 'code-row-clobber';
            const _clobberOriginInfos = _clobberOriginMap.get(w);
            if (_clobberOriginInfos && !_clobberInfos) rowClass = (rowClass ? rowClass + ' ' : '') + 'code-row-clobber-origin';

            let decoded;
            if (word === 0) {
                decoded = 'NOP / HALT';
            } else if (((word >>> 27) & 0x1F) === 17) {
                const _rawImm = word & 0x7FFF;
                const _soff = (_rawImm & 0x4000) ? (_rawImm | 0xFFFF8000) : _rawImm;
                const _tgt = w + _soff;
                const _condCode = (word >>> 23) & 0xF;
                const _condAbbr = _brLabelCondNames[_condCode];
                const _mnemonicHtml = _condCode === 14
                    ? 'BRANCH'
                    : `BRANCH<span class="cond-abbr" title="${_condAbbr}\u00A0\u2014\u00A0${_brCondLong[_condCode]}">${_condAbbr}</span>`;
                const _labelName = _brLabelMap.get(_tgt);
                const _disHl = (w2) => typeof _highlightCLOOMCSource === 'function'
                    ? _highlightCLOOMCSource(asm.disassemble(w2), 'assembly')
                    : asm.disassemble(w2);
                decoded = _labelName !== undefined
                    ? _wrapRegHover(`${_mnemonicHtml}\u00A0\u00A0${_labelName}`)
                    : _injectCondTooltip(_wrapRegHover(_disHl(word)), _condCode);
            } else {
                decoded = _injectCondTooltip(_wrapRegHover(
                    typeof _highlightCLOOMCSource === 'function'
                        ? _highlightCLOOMCSource(asm.disassemble(word), 'assembly')
                        : asm.disassemble(word)
                ), (word >>> 23) & 0xF);
            }
            if (_lumpClistBase > 0 && typeof _wrapCListHover === 'function') {
                decoded = _wrapCListHover(decoded, _lumpClistBase, _lumpHdr.cc || 0);
            }
            const bpDot    = isBP ? '<span class="bp-dot" title="Breakpoint">&#x25CF;</span> ' : '';
            const _clobberIcon = _clobberInfos
                ? `<span class="code-clobber-icon" title="${_clobberInfos.map(c => `CR${c.cr} alias clobbered here (alias set at word\u00A0${c.prevAliasedAtWord})`).join('\n')}">&#x26A0;</span> `
                : '';
            const _clobberOriginIcon = (_clobberOriginInfos && !_clobberInfos)
                ? `<span class="code-clobber-origin-icon" title="${_clobberOriginInfos.map(o => `CR${o.cr} alias set here \u2014 clobbered at word\u00A0${o.clobberAtWord}`).join('\n')}">&#x25CC;</span> `
                : '';
            const decompTd = decomp
                ? `<td class="code-decompiled ${isCompiler ? 'code-decompiled-compiler' : 'code-decompiled-user'}">${typeof _colorizeComment === 'function' ? _colorizeComment(decomp.desc) : (decomp.desc || '')}</td>`
                : '<td class="code-decompiled"></td>';

            codeHtml += `<tr class="${rowClass}" style="cursor:pointer;" title="Double-click to set breakpoint" ondblclick="openBreakPopoverAt(${addr})">`;
            codeHtml += `<td class="cr-idx">0x${addr.toString(16).toUpperCase().padStart(4,'0')}</td>`;
            codeHtml += `<td class="cr-gt">0x${word.toString(16).toUpperCase().padStart(8,'0')}</td>`;
            codeHtml += `<td class="code-disasm">${bpDot}${_clobberIcon}${_clobberOriginIcon}${decoded}</td>`;
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

        html += '</div>';
    }

    html += '</div></div>';
    } // end if (showCode) — Code panel

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel: C-List — capability slots
    // ═══════════════════════════════════════════════════════════════════════════
    html += `<div class="crd-panel" id="crdPanel-clist" style="display:${crDetailTab==='clist'?'block':'none'}">`;
    html += '<div class="cr-detail-grid">';
    html += '<div class="cr-detail-section">';
    html += '<div class="cr-detail-heading">C-List \u2014 Capability Slots</div>';

    if (showCList) {
        const _refResult    = _sharedRefResult;
        const _refSlots     = _refResult ? _refResult.direct   : null;
        const _indSlots     = _refResult ? _refResult.indirect : null;
        const _clobberWarnings = (_refResult && _refResult.clobberWarnings) ? _refResult.clobberWarnings : [];
        // POLA strip — unreferenced GTs and/or interior null gaps
        { let _pu = 0, _pt = 0, _hasGaps = false;
          // Unreferenced: non-null GTs not in refSlots and not in indSlots; when refSlots===null all non-null are unref
          for (let _i = 0; _i < _clistCount; _i++) { const _gw = sim.memory[_clistBase + _i] >>> 0; if (_gw !== 0 && (_refSlots === null || (!_refSlots.has(_i) && !(_indSlots && _indSlots.has(_i))))) _pu++; }
          // Interior gap: null slot at position < index of last non-null slot
          let _lastNN = -1;
          for (let _i = _clistCount - 1; _i >= 0; _i--) { if ((sim.memory[_clistBase + _i] >>> 0) !== 0) { _lastNN = _i; break; } }
          for (let _i = 0; _i < _lastNN; _i++) { if ((sim.memory[_clistBase + _i] >>> 0) === 0) { _hasGaps = true; break; } }
          // Eligible tail slots (null or unref, contiguous from end)
          { let _seenNN = false;
            for (let _i = _clistCount - 1; _i >= 0; _i--) { const _gw = sim.memory[_clistBase + _i] >>> 0; const _nullOrUnref = _gw === 0 || (_refSlots === null || (!_refSlots.has(_i) && !(_indSlots && _indSlots.has(_i)))); if (!_seenNN && _nullOrUnref) _pt++; else _seenNN = true; }
          }
          if (_pu > 0 || _hasGaps) {
            const _polaMsg = [_pu > 0 ? `${_pu} unreferenced GT slot${_pu !== 1 ? 's' : ''}` : '', _hasGaps ? 'interior null gaps' : ''].filter(Boolean).join(', ');
            html += `<div class="clist-pola-strip"><span class="clist-pola-label">POLA</span>` +
              `<span class="clist-pola-msg">${_polaMsg}</span>` +
              `<button class="clist-pola-btn" onclick="applyPOLA(${nsIdx})">\u26A1\u202FApply POLA</button>` +
              (_pt > 0 ? `<span class="clist-pola-compress-hint">\u2192 enables \u2913\u202FCompress after (${_pt} tail slot${_pt !== 1 ? 's' : ''} eligible)</span>` : '') +
              `</div>`;
          } }
        // Clobber warning strip — aliased CRs overwritten before use
        if (_clobberWarnings.length > 0) {
          const _clobberStripId = `clobber-strip-${nsIdx}-a`;
          const _clobberEntries = _clobberWarnings.map(w =>
            `<span class="clist-clobber-entry">CR${w.cr} alias (set at word\u00A0${w.prevAliasedAtWord}) clobbered at word\u00A0${w.word}</span>`
          ).join('');
          html += `<div class="clist-clobber-strip" id="${_clobberStripId}">` +
            `<span class="clist-clobber-label">CLOBBER</span>` +
            `<span class="clist-clobber-body">${_clobberEntries}</span>` +
            `<button class="clist-clobber-dismiss" onclick="var el=document.getElementById('${_clobberStripId}');if(el)el.style.display='none';" title="Dismiss">\u00D7</button>` +
            `</div>`;
        }
        html += '<table class="cr-table"><thead><tr>';
        html += '<th>Slot</th><th>GT Word</th><th>NS Idx</th><th>Type</th><th>Perms</th><th>Pet Name</th><th></th>';
        html += '</tr></thead><tbody>';
        for (let i = 0; i < _clistCount; i++) {
            const addr = _clistBase + i;
            const gtWord = (addr < sim.memory.length) ? (sim.memory[addr] >>> 0) : 0;
            const isPending = (typeof ChurchSimulator !== 'undefined' && ChurchSimulator.isPendingGT) ? ChurchSimulator.isPendingGT(gtWord) : false;
            const isHighlighted = (window._pendingHighlightCListSlot === i);
            if (isPending) {
                const _pendingName = (typeof ChurchSimulator !== 'undefined' && ChurchSimulator.pendingGTName) ? ChurchSimulator.pendingGTName(gtWord) : `slot${i}`;
                const _hlClass = isHighlighted ? ' clist-pending-highlight' : '';
                const _pendingId = isHighlighted ? ` id="clist-pending-slot-${i}"` : '';
                html += `<tr class="clist-pending-row${_hlClass}"${_pendingId}>`;
                html += `<td class="cr-idx">${i}</td>`;
                html += `<td class="abs-clist-gt" style="color:#f59e0b;">0x${gtWord.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                html += `<td>\u2014</td>`;
                html += `<td><span class="clist-pending-type-badge">Pending</span></td>`;
                html += `<td>\u2014</td>`;
                html += `<td class="abs-clist-name" style="color:#f59e0b;">\u201C${_pendingName}\u201D</td>`;
                html += `<td><span class="clist-pending-badge-inline">\u26A1\u202FUnresolved</span></td>`;
                html += `</tr>`;
                continue;
            }
            const parsed = sim.parseGT(gtWord);
            let nsLabel = '';
            if (parsed.type === 3 && gtWord !== 0) {
                const ab = sim.parseAbstractGT(gtWord);
                const AB_TYPE_NAMES  = { 0: 'I/O', 1: 'M-Elevation' };
                const DEVICE_CLASSES = { 1: 'LED', 2: 'UART', 3: 'Button', 4: 'Timer', 5: 'Display' };
                if (ab.ab_type === 0) {
                    const dc = DEVICE_CLASSES[ab.device_class] || `dc${ab.device_class}`;
                    nsLabel = `${dc}[${ab.device_data}]`;
                } else {
                    nsLabel = `${AB_TYPE_NAMES[ab.ab_type] || `ab${ab.ab_type}`} 0x${ab.ab_data.toString(16).toUpperCase()}`;
                }
            } else {
                nsLabel = (sim.nsLabels && sim.nsLabels[parsed.index]) ? sim.nsLabels[parsed.index] : '';
            }
            const isExpanded = (clistExpandedIdx === i);
            const hasGT = gtWord !== 0;
            const isAbstract = hasGT && parsed.type === 3;
            const isIndirect = hasGT && _indSlots && _indSlots.has(i);
            const isUnref = hasGT && !isIndirect && (_refSlots === null || !_refSlots.has(i));
            const _p1 = { ...parsed.permissions, F: parsed.type === 2 ? 1 : 0 };
            let permHtml1 = '';
            if (hasGT) {
                for (const bit of ['B','R','W','X','E','L','S','F']) {
                    const cls = _p1[bit] ? 'perm-on' : 'perm-off';
                    permHtml1 += `<span class="abs-perm-badge ${cls}">${bit}</span>`;
                }
            }
            const nameStr1 = hasGT
                ? (isAbstract ? nsLabel : (nsLabel ? `NS[${parsed.index}] \u2014 ${nsLabel}` : `NS[${parsed.index}]`))
                : '\u2014';
            const _hlClass2 = isHighlighted ? ' clist-pending-highlight' : '';
            const _hlId2 = isHighlighted ? ` id="clist-pending-slot-${i}"` : '';
            html += `<tr class="${hasGT ? 'cr-active clist-clickable' : ''}${isExpanded ? ' clist-selected' : ''}${isUnref ? ' clist-unref-row' : ''}${isIndirect ? ' clist-indirect-row' : ''}${_hlClass2}"${_hlId2} `;
            html += hasGT ? `onclick="toggleCListEntry(${i})" title="${isAbstract ? nsLabel + ' (Abstract GT \u2014 no NS slot)' : 'Click to inspect NS[' + parsed.index + ']'}"` : '';
            html += '>';
            html += `<td class="cr-idx">${i}</td>`;
            html += `<td class="abs-clist-gt">0x${gtWord.toString(16).toUpperCase().padStart(8,'0')}</td>`;
            html += `<td>${hasGT ? (isAbstract ? '\u2014' : parsed.index) : '\u2014'}</td>`;
            html += `<td class="${hasGT ? 'abs-clist-type' : ''}">${hasGT ? parsed.typeName : '\u2014'}</td>`;
            html += `<td class="abs-clist-perms">${hasGT ? permHtml1 : '\u2014'}</td>`;
            html += `<td class="abs-clist-name">${nameStr1}</td>`;
            if (isIndirect) {
                html += `<td onclick="event.stopPropagation()"><span class="clist-indirect-badge" title="Accessed via a register loaded from CR6 \u2014 slot preserved by POLA">\u26A0\u202Findirect</span></td>`;
            } else if (isUnref) {
                html += `<td onclick="event.stopPropagation()"><span class="clist-unref-badge">unref</span><button class="clist-zero-btn" onclick="zeroLumpSlot(${addr})" title="Zero this slot — marks GT as null/empty">&#xD7;&nbsp;zero</button></td>`;
            } else {
                html += '<td></td>';
            }
            html += '</tr>';
            if (isExpanded && hasGT) {
                const nsEntry = sim.readNSEntry(parsed.index);
                if (nsEntry) {
                    html += `<tr class="clist-detail-row"><td colspan="7">${renderCListEntryDetail(parsed.index, nsEntry)}</td></tr>`;
                }
            }
        }
        html += '</tbody></table>';
    } else if (showCode && _lumpHdr.valid && _lumpHdr.cc > 0 && _lumpClistBase > 0) {
        const _ref2Result    = _sharedRefResult;
        const _ref2Slots     = _ref2Result ? _ref2Result.direct   : null;
        const _ind2Slots     = _ref2Result ? _ref2Result.indirect : null;
        const _clobberWarnings2 = (_ref2Result && _ref2Result.clobberWarnings) ? _ref2Result.clobberWarnings : [];
        // POLA strip — unreferenced GTs and/or interior null gaps
        { let _pu2 = 0, _pt2 = 0, _hasGaps2 = false;
          // Unreferenced: non-null GTs not in ref2Slots and not in ind2Slots; when ref2Slots===null all non-null are unref
          for (let _i = 0; _i < _lumpHdr.cc; _i++) { const _gw = sim.memory[_lumpClistBase + _i] >>> 0; if (_gw !== 0 && (_ref2Slots === null || (!_ref2Slots.has(_i) && !(_ind2Slots && _ind2Slots.has(_i))))) _pu2++; }
          // Interior gap: null slot at position < index of last non-null slot
          let _lastNN2 = -1;
          for (let _i = _lumpHdr.cc - 1; _i >= 0; _i--) { if ((sim.memory[_lumpClistBase + _i] >>> 0) !== 0) { _lastNN2 = _i; break; } }
          for (let _i = 0; _i < _lastNN2; _i++) { if ((sim.memory[_lumpClistBase + _i] >>> 0) === 0) { _hasGaps2 = true; break; } }
          // Eligible tail slots (null or unref, contiguous from end)
          { let _seenNN2 = false;
            for (let _i = _lumpHdr.cc - 1; _i >= 0; _i--) { const _gw = sim.memory[_lumpClistBase + _i] >>> 0; const _nullOrUnref2 = _gw === 0 || (_ref2Slots === null || (!_ref2Slots.has(_i) && !(_ind2Slots && _ind2Slots.has(_i)))); if (!_seenNN2 && _nullOrUnref2) _pt2++; else _seenNN2 = true; }
          }
          if (_pu2 > 0 || _hasGaps2) {
            const _polaMsg2 = [_pu2 > 0 ? `${_pu2} unreferenced GT slot${_pu2 !== 1 ? 's' : ''}` : '', _hasGaps2 ? 'interior null gaps' : ''].filter(Boolean).join(', ');
            html += `<div class="clist-pola-strip"><span class="clist-pola-label">POLA</span>` +
              `<span class="clist-pola-msg">${_polaMsg2}</span>` +
              `<button class="clist-pola-btn" onclick="applyPOLA(${nsIdx})">\u26A1\u202FApply POLA</button>` +
              (_pt2 > 0 ? `<span class="clist-pola-compress-hint">\u2192 enables \u2913\u202FCompress after (${_pt2} tail slot${_pt2 !== 1 ? 's' : ''} eligible)</span>` : '') +
              `</div>`;
          } }
        // Clobber warning strip — aliased CRs overwritten before use
        if (_clobberWarnings2.length > 0) {
          const _clobberStripId2 = `clobber-strip-${nsIdx}-b`;
          const _clobberEntries2 = _clobberWarnings2.map(w =>
            `<span class="clist-clobber-entry">CR${w.cr} alias (set at word\u00A0${w.prevAliasedAtWord}) clobbered at word\u00A0${w.word}</span>`
          ).join('');
          html += `<div class="clist-clobber-strip" id="${_clobberStripId2}">` +
            `<span class="clist-clobber-label">CLOBBER</span>` +
            `<span class="clist-clobber-body">${_clobberEntries2}</span>` +
            `<button class="clist-clobber-dismiss" onclick="var el=document.getElementById('${_clobberStripId2}');if(el)el.style.display='none';" title="Dismiss">\u00D7</button>` +
            `</div>`;
        }
        html += '<table class="cr-table"><thead><tr>';
        html += '<th>Slot</th><th>GT Word</th><th>NS Idx</th><th>Type</th><th>Perms</th><th>Pet Name</th><th></th>';
        html += '</tr></thead><tbody>';
        for (let i = 0; i < _lumpHdr.cc; i++) {
            const addr = _lumpClistBase + i;
            const gtWord = (addr < sim.memory.length) ? (sim.memory[addr] >>> 0) : 0;
            const parsed = sim.parseGT(gtWord);
            let nsLabel = '';
            if (parsed.type === 3 && gtWord !== 0) {
                const ab = sim.parseAbstractGT(gtWord);
                const AB_TYPE_NAMES  = { 0: 'I/O', 1: 'M-Elevation' };
                const DEVICE_CLASSES = { 1: 'LED', 2: 'UART', 3: 'Button', 4: 'Timer', 5: 'Display' };
                if (ab.ab_type === 0) {
                    const dc = DEVICE_CLASSES[ab.device_class] || `dc${ab.device_class}`;
                    nsLabel = `${dc}[${ab.device_data}]`;
                } else {
                    nsLabel = `${AB_TYPE_NAMES[ab.ab_type] || `ab${ab.ab_type}`} 0x${ab.ab_data.toString(16).toUpperCase()}`;
                }
            } else {
                nsLabel = (sim.nsLabels && sim.nsLabels[parsed.index]) ? sim.nsLabels[parsed.index] : '';
            }
            const hasGT = gtWord !== 0;
            const isAbstract2 = hasGT && parsed.type === 3;
            const isIndirect2 = hasGT && _ind2Slots && _ind2Slots.has(i);
            const isUnref2 = hasGT && !isIndirect2 && (_ref2Slots === null || !_ref2Slots.has(i));
            const _p2 = { ...parsed.permissions, F: parsed.type === 2 ? 1 : 0 };
            let permHtml2 = '';
            if (hasGT) {
                for (const bit of ['B','R','W','X','E','L','S','F']) {
                    const cls = _p2[bit] ? 'perm-on' : 'perm-off';
                    permHtml2 += `<span class="abs-perm-badge ${cls}">${bit}</span>`;
                }
            }
            const nameStr2 = hasGT
                ? (isAbstract2 ? nsLabel : (nsLabel ? `NS[${parsed.index}] \u2014 ${nsLabel}` : `NS[${parsed.index}]`))
                : '\u2014';
            html += `<tr class="${hasGT ? 'cr-active' : ''}${isUnref2 ? ' clist-unref-row' : ''}${isIndirect2 ? ' clist-indirect-row' : ''}">`;
            html += `<td class="cr-idx">${i}</td>`;
            html += `<td class="abs-clist-gt">0x${gtWord.toString(16).toUpperCase().padStart(8,'0')}</td>`;
            html += `<td>${hasGT ? (isAbstract2 ? '\u2014' : parsed.index) : '\u2014'}</td>`;
            html += `<td class="${hasGT ? 'abs-clist-type' : ''}">${hasGT ? parsed.typeName : '\u2014'}</td>`;
            html += `<td class="abs-clist-perms">${hasGT ? permHtml2 : '\u2014'}</td>`;
            html += `<td class="abs-clist-name">${nameStr2}</td>`;
            if (isIndirect2) {
                html += `<td><span class="clist-indirect-badge" title="Accessed via a register loaded from CR6 \u2014 slot preserved by POLA">\u26A0\u202Findirect</span></td>`;
            } else if (isUnref2) {
                html += `<td><span class="clist-unref-badge">unref</span><button class="clist-zero-btn" onclick="zeroLumpSlot(${addr})" title="Zero this slot — marks GT as null/empty">&#xD7;&nbsp;zero</button></td>`;
            } else {
                html += '<td></td>';
            }
            html += '</tr>';
        }
        html += '</tbody></table>';
    } else if (showCode && _lumpHdr.valid && _lumpHdr.cc === 0) {
        html += '<div style="color:var(--text-secondary);font-style:italic;padding:0.5rem 0;">(no c-list entries in this lump)</div>';
    } else {
        html += '<div style="color:var(--text-secondary);font-style:italic;padding:0.5rem 0;">(no c-list entries in this lump)</div>';
    }

    html += '</div>';
    html += '</div></div>';

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel: Lump — memory layout + Ownership + MTBF + Error Report
    // ═══════════════════════════════════════════════════════════════════════════
    html += `<div class="crd-panel" id="crdPanel-lump" style="display:${crDetailTab==='lump'?'block':'none'}">`;
    html += '<div class="cr-detail-grid">';

    // Compress / Save Lump action toolbar — code lumps only
    if (showCode && _lumpHdr.valid) {
        const _lsz   = _lumpHdr.lumpSize;
        const _free  = _lsz - 1 - _lumpHdr.cw - _lumpHdr.cc;
        let _minSz   = 64;
        while (_minSz < (1 + _lumpHdr.cw + _lumpHdr.cc)) _minSz <<= 1;
        const _canCmp = _minSz < _lsz;
        html += `<div class="crd-lump-actions">`;
        html += `<button class="crd-lump-btn${_canCmp ? '' : ' crd-lump-btn-disabled'}" ` +
                `onclick="lumpCompress(${nsIdx})" ` +
                `${_canCmp ? '' : 'disabled title="Already at minimum size"'}>` +
                `\u2913\u202FCompress</button>`;
        html += `<button class="crd-lump-btn" onclick="lumpSaveLump(${nsIdx})">\u2193\u202FSave Lump</button>`;
        html += `<span class="crd-lump-info">${_lsz}w\u202F=\u202F1\u202Fhdr\u202F+\u202F${_lumpHdr.cw}w\u202Fcode` +
                `\u202F+\u202F${_lumpHdr.cc}\u202Fc-list\u202F+\u202F${_free}\u202Ffree</span>`;
        html += `</div>`;
    }

    // Memory layout (renderCListEntryDetail) — only if permitted
    if ((showCode || showCList) && _sharedNSE) {
        html += renderCListEntryDetail(nsIdx, _sharedNSE);
    } else if (!(showCode || showCList)) {
        html += `<div class="cr-detail-section"><div style="color:var(--text-secondary);padding:0.5rem 0;">GT permissions control memory layout visibility.</div></div>`;
    } else {
        html += `<div class="cr-detail-section"><div style="color:var(--text-secondary);padding:0.5rem 0;">No NS entry for slot ${nsIdx}.</div></div>`;
    }

    // Thread memory layout (if applicable)
    if (showThread) {
        html += '<div class="cr-detail-section cr-detail-section-thread">';
        html += renderThreadMemoryLayout(nsIdx);
        html += '</div>';
    }

    // Namespace root view (if applicable)
    if (showNS) {
        html += '<div class="cr-detail-section">';
        html += '<div class="cr-detail-heading">Namespace Root \u2014 All Entries</div>';
        if (sim.nsCount === 0) {
            html += '<div style="color:var(--text-secondary);padding:0.5rem;">Namespace table is empty.</div>';
        } else {
            html += '<table class="cr-table"><thead><tr>';
            html += '<th>Label</th><th class="popup-sub-id">Idx</th><th>W0: Location</th><th>W1: Type</th><th>W1: F</th><th>W1: G</th><th>W1: Chain</th>';
            html += '</tr></thead><tbody>';
            const typeNames = ['NULL','Inform','Outform','Abstract'];
            for (let i = 0; i < sim.nsCount; i++) {
                const e = sim.readNSEntry(i);
                if (!e) continue;
                const loc = e.word0_location >>> 0;
                html += '<tr class="cr-active">';
                html += `<td class="cr-name">${e.label || ''}</td>`;
                html += `<td class="cr-idx popup-sub-id">${i}</td>`;
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

    // Data view (if applicable)
    if (showData) {
        const dataBase = cr.word1_location >>> 0;
        const dataLimit = cr.limit17;
        const wordCount = Math.min(dataLimit + 1, 64);
        const nsEntryD = _sharedNSE;
        const nsLabelD = nsEntryD ? (nsEntryD.label || `NS[${nsIdx}]`) : `NS[${nsIdx}]`;
        const permDesc = [hasR ? 'R' : '', hasW ? 'W' : ''].filter(Boolean).join('|');

        const DEVICE_SLOTS = { 12: 'LED', 11: 'UART', 13: 'Button', 14: 'Timer' };
        const isDevice = nsIdx in DEVICE_SLOTS;

        html += '<div class="cr-detail-section">';
        html += `<div class="cr-detail-heading">Data View \u2014 ${nsLabelD} (NS[${nsIdx}]) [${permDesc}]</div>`;

        html += '<table class="cr-table cr-detail-words"><tbody>';
        html += `<tr><td style="color:var(--church-blue)">Target</td><td>NS[${nsIdx}] \u2014 <strong>${nsLabelD}</strong></td></tr>`;
        html += `<tr><td style="color:var(--church-blue)">Permissions</td><td class="cr-perms">[${permDesc}]</td></tr>`;
        html += `<tr><td style="color:var(--church-blue)">Base address</td><td>0x${dataBase.toString(16).toUpperCase().padStart(8,'0')}</td></tr>`;
        html += `<tr><td style="color:var(--church-blue)">Size</td><td>${wordCount} word${wordCount !== 1 ? 's' : ''} (limit ${dataLimit})</td></tr>`;
        if (isDevice) {
            html += `<tr><td style="color:var(--church-blue)">Kind</td><td style="color:var(--church-yellow)">Hardware Device \u2014 ${DEVICE_SLOTS[nsIdx]}</td></tr>`;
        }
        html += '</tbody></table>';

        if (isDevice && nsIdx === 12) {
            html += '<div class="cr-detail-heading" style="margin-top:0.75rem;">LED Registers</div>';
            html += '<table class="cr-table code-view-table" style="margin-bottom:0.3rem;">';
            html += '<thead><tr><th>Offset</th><th>Name</th><th>Hex</th><th>Pin</th></tr></thead><tbody>';
            for (let ledIdx = 0; ledIdx <= 4; ledIdx++) {
                const addr = dataBase + ledIdx;
                const val = (addr < sim.memory.length) ? (sim.memory[addr] >>> 0) : 0;
                const rBit = val & 1;
                const pinLabel = ledIdx <= 3 ? (rBit ? 'ON' : 'off') : (rBit ? 'ON (no pin)' : '\u2014');
                const pinColor = (rBit && ledIdx <= 3) ? '#22ff44' : (rBit ? '#ffaa22' : 'var(--text-secondary)');
                html += `<tr><td class="cr-idx">+${ledIdx}</td><td>LED${ledIdx}</td><td class="cr-gt">0x${val.toString(16).toUpperCase().padStart(8,'0')}</td><td style="color:${pinColor};font-weight:${rBit?'bold':'normal'}">${pinLabel}</td></tr>`;
            }
            html += '</tbody></table>';
            html += '<div style="color:var(--text-secondary);font-size:0.72rem;padding-bottom:0.3rem;">bit[0]=R drives pin \u00b7 bit[1]=G \u00b7 bit[2]=B (Ti60: only R connected)</div>';
        }

        if (wordCount > 0 && nsIdx !== 12) {
            html += '<div class="cr-detail-heading" style="margin-top:0.75rem;">Memory Contents</div>';
            html += '<table class="cr-table code-view-table"><thead><tr><th>Addr</th><th>Hex</th><th>Dec</th></tr></thead><tbody>';
            for (let w = 0; w < wordCount; w++) {
                const addr = dataBase + w;
                if (addr >= sim.memory.length) break;
                const val = sim.memory[addr] >>> 0;
                html += `<tr><td class="cr-idx">+${w}</td><td class="cr-gt">0x${val.toString(16).toUpperCase().padStart(8,'0')}</td><td>${val}</td></tr>`;
            }
            html += '</tbody></table>';
        }
        html += '</div>';
    }

    // ── Ownership ─────────────────────────────────────────────────────────────
    {
        const _mfst = _lumpManifests[nsIdx];
        const _owAbs = sim.abstractionRegistry && sim.abstractionRegistry.getAbstraction && sim.abstractionRegistry.getAbstraction(nsIdx);
        const _owSidecar = _findSrcLump(nsIdx, _absName);
        html += '<div class="crd-lump-section">';
        html += '<div class="crd-lump-section-label">Ownership</div>';
        if (_mfst) {
            html += '<table class="cr-table cr-detail-words"><tbody>';
            const _owRows = [
                ['Name',           _absName],
                ['Author',         _owSidecar && _owSidecar.author],
                ['Version',        _owSidecar && _owSidecar.version],
                ['Profile',        _mfst.profile],
                ['Grants',         Array.isArray(_mfst.grants) && _mfst.grants.length ? _mfst.grants.join(', ') : (_mfst.grants || null)],
                ['Built at',       _mfst.deployment && _mfst.deployment.built_at],
                ['Target board',   _mfst.deployment && _mfst.deployment.target_board],
                ['Deploy profile', _mfst.deployment && _mfst.deployment.profile],
            ];
            let _anyOwRow = false;
            for (const [k, v] of _owRows) {
                if (v == null || v === '' || v === false) continue;
                html += `<tr><td style="color:var(--church-blue);width:130px;">${k}</td><td>${_escHtml(String(v))}</td></tr>`;
                _anyOwRow = true;
            }
            if (!_anyOwRow) {
                html += `<tr><td colspan="2" style="color:var(--text-secondary);font-style:italic;">No ownership fields in manifest.</td></tr>`;
            }
            html += '</tbody></table>';
        } else if (_owAbs) {
            const _layerNamesMap = (sim.abstractionRegistry && sim.abstractionRegistry.getLayerNames && sim.abstractionRegistry.getLayerNames()) || {};
            const _layerLabel = _layerNamesMap[_owAbs.layer] != null ? `Layer ${_owAbs.layer} \u2014 ${_layerNamesMap[_owAbs.layer]}` : `Layer ${_owAbs.layer}`;
            html += '<table class="cr-table cr-detail-words"><tbody>';
            html += `<tr><td style="color:var(--church-blue);width:130px;">Name</td><td>${_escHtml(_owAbs.name || _absName)}</td></tr>`;
            if (_owAbs.author) {
                html += `<tr><td style="color:var(--church-blue)">Author</td><td>${_escHtml(_owAbs.author)}</td></tr>`;
            }
            if (_owAbs.version) {
                html += `<tr><td style="color:var(--church-blue)">Version</td><td>${_escHtml(_owAbs.version)}</td></tr>`;
            }
            html += `<tr><td style="color:var(--church-blue)">Layer</td><td>${_escHtml(_layerLabel)}</td></tr>`;
            if (_owAbs.description) {
                html += `<tr><td style="color:var(--church-blue)">Description</td><td style="font-size:0.82rem;">${_escHtml(_owAbs.description)}</td></tr>`;
            }
            if (_owAbs.methods && _owAbs.methods.length > 0) {
                html += `<tr><td style="color:var(--church-blue)">Methods</td><td style="font-size:0.82rem;">${_owAbs.methods.map(_escHtml).join(', ')}</td></tr>`;
            }
            html += '</tbody></table>';
        } else if (_owSidecar && (_owSidecar.author || _owSidecar.version)) {
            html += '<table class="cr-table cr-detail-words"><tbody>';
            html += `<tr><td style="color:var(--church-blue);width:130px;">Name</td><td>${_escHtml(_absName)}</td></tr>`;
            if (_owSidecar.author) html += `<tr><td style="color:var(--church-blue)">Author</td><td>${_escHtml(_owSidecar.author)}</td></tr>`;
            if (_owSidecar.version) html += `<tr><td style="color:var(--church-blue)">Version</td><td>${_escHtml(_owSidecar.version)}</td></tr>`;
            html += '</tbody></table>';
        } else {
            html += '<div style="color:var(--text-secondary);font-style:italic;">(no ownership metadata \u2014 compile and publish to add)</div>';
        }
        html += '</div>';
    }

    // ── MTBF Reliability ──────────────────────────────────────────────────────
    {
        const _mfst  = _lumpManifests[nsIdx];
        const _mtbf  = _mfst && _mfst.mtbf;
        const _abs   = sim.abstractionRegistry && sim.abstractionRegistry.getAbstraction && sim.abstractionRegistry.getAbstraction(nsIdx);
        const _rtFaults  = _abs ? (_abs.faultCount  || 0) : null;
        const _rtInvokes = _abs ? (_abs.invokeCount  || 0) : null;
        const _rtMTBF   = (_abs && _rtFaults > 0 && sim.abstractionRegistry.getMTBF)
                          ? sim.abstractionRegistry.getMTBF(nsIdx) : null;
        const _errCount  = (sim.auditLog || []).filter(e => e.nsIndex === nsIdx).length;

        html += '<div class="crd-lump-section">';
        html += '<div class="crd-lump-section-label">MTBF Reliability</div>';

        if (!_mtbf && _rtFaults === null) {
            html += '<div style="color:var(--text-secondary);font-style:italic;">(no MTBF data recorded yet)</div>';
        } else {
            html += '<table class="cr-table cr-detail-words"><tbody>';
            if (_mtbf) {
                const _mtbfStatus = (_mtbf.status || 'unknown').toLowerCase();
                const _mtbfClass  = _mtbfStatus === 'green' ? 'mtbf-green'
                                  : _mtbfStatus === 'amber' ? 'mtbf-amber'
                                  : _mtbfStatus === 'red'   ? 'mtbf-red'
                                  : 'mtbf-unknown';
                const _mtbfLabel  = _mtbf.status ? _mtbf.status.charAt(0).toUpperCase() + _mtbf.status.slice(1) : 'Unknown';
                html += `<tr><td style="color:var(--church-blue);width:130px;">Status</td><td><span class="mtbf-badge ${_mtbfClass}">${_mtbfLabel}</span></td></tr>`;
                if (_mtbf.consecutive_clean != null) {
                    html += `<tr><td style="color:var(--church-blue)">Clean runs</td><td>${_mtbf.consecutive_clean}</td></tr>`;
                }
                if (_mtbf.total_runs != null) {
                    html += `<tr><td style="color:var(--church-blue)">Total runs</td><td>${_mtbf.total_runs}</td></tr>`;
                }
                if (_mtbf.source_hash) {
                    html += `<tr><td style="color:var(--church-blue)">Source hash</td><td><code>${_mtbf.source_hash}</code></td></tr>`;
                }
            }
            html += `<tr><td style="color:var(--church-blue);width:130px;">Invocations</td><td>${_rtInvokes !== null ? _rtInvokes : '\u2014'}</td></tr>`;
            html += `<tr><td style="color:var(--church-blue);width:130px;">Fault count</td><td>${_rtFaults !== null ? _rtFaults : '\u2014'}</td></tr>`;
            html += `<tr><td style="color:var(--church-blue);width:130px;">Error count</td><td>${_errCount}</td></tr>`;
            const _liveFaultRateStr = (_rtInvokes === null || _rtFaults === null) ? '\u2014'
                                    : _rtInvokes === 0 ? '0.00%'
                                    : ((_rtFaults / _rtInvokes) * 100).toFixed(2) + '%';
            html += `<tr><td style="color:var(--church-blue)">Fault rate</td><td>${_liveFaultRateStr}</td></tr>`;
            const _liveMTBFStr = _rtFaults === null ? '\u2014'
                               : _rtMTBF != null    ? (_rtMTBF / 1000).toFixed(1) + 's'
                               : '\u221e (no faults)';
            html += `<tr><td style="color:var(--church-blue)">MTBF</td><td>${_liveMTBFStr}</td></tr>`;
            html += `<tr><td colspan="2" style="color:var(--text-secondary);font-size:0.78rem;font-style:italic;padding-top:4px;">Invocations and Fault count are cumulative across sessions \u00b7 Error count is session-only (cleared after clean boot)</td></tr>`;
            html += '</tbody></table>';
        }
        html += '</div>';
    }

    // ── Error Report ──────────────────────────────────────────────────────────
    {
        const _slotFaults = (sim.auditLog || []).filter(e => e.nsIndex === nsIdx);
        html += '<div class="crd-lump-section">';
        html += '<div class="crd-lump-section-label">Error Report</div>';
        if (_slotFaults.length === 0) {
            html += '<div style="color:var(--text-secondary);font-style:italic;">(no gate log events recorded for this slot \u2014 boot gate log is cleared after clean boot)</div>';
        } else {
            const _maxRows = Math.min(_slotFaults.length, 50);
            html += '<table class="cr-table crd-error-table"><thead><tr><th>Step</th><th>Event</th><th>Detail</th></tr></thead><tbody>';
            for (let i = 0; i < _maxRows; i++) {
                const _ef = _slotFaults[i];
                // stepCtx is either an object {step, pc, opName, ...} or a plain string or null
                let _evtStep = '\u2014';
                if (_ef.stepCtx != null) {
                    if (typeof _ef.stepCtx === 'object') {
                        _evtStep = _ef.stepCtx.step != null ? '#' + _ef.stepCtx.step : ('PC:0x' + (_ef.stepCtx.pc || 0).toString(16));
                    } else {
                        _evtStep = String(_ef.stepCtx);
                    }
                }
                const _evtEvent = _ef.gate || '\u2014';
                // Build a concise summary string for the collapsed row
                let _evtDetail = '';
                if (_ef.detail) {
                    _evtDetail = _ef.detail;
                } else if (_ef.desc) {
                    _evtDetail = _ef.desc;
                } else if (_ef.checks && typeof _ef.checks === 'object') {
                    const _failedChecks = Object.entries(_ef.checks)
                        .filter(([, v]) => v && v.pass === false)
                        .map(([k]) => k.toUpperCase());
                    if (_failedChecks.length > 0) {
                        _evtDetail = 'FAIL: ' + _failedChecks.join(', ');
                    } else {
                        _evtDetail = _ef.result === 'pass' ? 'pass' : (_ef.result || '');
                        if (_ef.requiredPerm) _evtDetail += ' perm=' + _ef.requiredPerm;
                    }
                } else {
                    _evtDetail = _ef.result || '';
                }
                const _truncated = _evtDetail.length > 60 ? _evtDetail.slice(0, 60) + '\u2026' : _evtDetail;
                const _isFail = _ef.result === 'fail';
                const _rowColor = _isFail ? 'color:var(--church-red,#e05555);' : '';
                const _hasChecks = _ef.checks && typeof _ef.checks === 'object' && Object.keys(_ef.checks).length > 0;
                // Build detail grid HTML (pre-rendered into the hidden row)
                let _detailHtml = '';
                if (_hasChecks) {
                    _detailHtml += '<div class="crd-check-grid">';
                    for (const [_ck, _cv] of Object.entries(_ef.checks)) {
                        if (!_cv || typeof _cv !== 'object') continue;
                        const _pass = _cv.pass !== false;
                        const _badgeClass = _pass ? 'pass' : 'fail';
                        const _badgeLabel = _pass ? 'OK' : 'FAIL';
                        // Build the human-readable value for this check
                        let _valStr = '';
                        if (_ck === 'perm') {
                            _valStr = _cv.perm ? 'requires ' + _cv.perm : '';
                            if (!_pass) _valStr += (_valStr ? ' \u2014 ' : '') + 'missing';
                        } else if (_ck === 'range') {
                            const _addr = '0x' + (_cv.address >>> 0).toString(16);
                            const _base = '0x' + (_cv.base >>> 0).toString(16);
                            const _lim  = '0x' + (_cv.limit >>> 0).toString(16);
                            _valStr = _addr + ' in [' + _base + '..' + _lim + ']';
                            if (!_pass) _valStr = _addr + ' outside [' + _base + '..' + _lim + ']';
                        } else if (_ck === 'version' && !_pass) {
                            _valStr = 'GT seq mismatch';
                        } else if (_ck === 'seal' && !_pass) {
                            _valStr = 'CRC invalid';
                        } else if (_ck === 'bind' && !_pass) {
                            _valStr = 'bind check failed';
                        } else if (_ck === 'far' && !_pass) {
                            _valStr = 'far check failed';
                        }
                        _detailHtml += '<span class="crd-check-item">';
                        _detailHtml += `<span class="crd-check-name">${_ck}</span>`;
                        _detailHtml += `<span class="crd-check-badge ${_badgeClass}">${_badgeLabel}</span>`;
                        if (_valStr) _detailHtml += `<span class="crd-check-value">${_valStr}</span>`;
                        _detailHtml += '</span>';
                    }
                    _detailHtml += '</div>';
                } else if (_ef.desc) {
                    _detailHtml = `<span style="color:var(--text-secondary);font-size:0.76rem;">${_ef.desc}</span>`;
                }
                const _rowId = 'crd-fault-detail-' + nsIdx + '-' + i;
                const _clickable = _hasChecks || _ef.desc;
                const _rowClass = _clickable ? 'crd-fault-row' : '';
                const _onclickAttr = _clickable ? ` onclick="window.__crdToggleFaultDetail('${_rowId}',this)"` : '';
                html += `<tr class="${_rowClass}" style="${_rowColor}"${_onclickAttr}><td class="cr-idx">${_evtStep}</td><td>${_evtEvent}</td><td style="font-size:0.78rem;">${_truncated}</td></tr>`;
                if (_clickable) {
                    html += `<tr id="${_rowId}" class="crd-fault-detail-row" style="display:none;"><td colspan="3">${_detailHtml}</td></tr>`;
                }
            }
            html += '</tbody></table>';
            if (_slotFaults.length > 50) {
                html += `<div style="color:var(--text-secondary);font-size:0.75rem;padding-top:0.25rem;">(${_slotFaults.length - 50} more entries not shown)</div>`;
            }
        }
        html += '</div>';
    }

    html += '<pre id="crInjectLog" class="cr-inject-log" style="display:none;"></pre>';

    html += '</div></div>';

    // ═══════════════════════════════════════════════════════════════════════════
    // ── API tab panel ────────────────────────────────────────────────────────
    // Shows per-method CLOOMC example blocks with a generated .pet preamble
    // derived from the lump manifest's pet_names.  The examples are only
    // available after the abstraction has been compiled (which populates
    // _lumpManifests[nsIdx]._methods).
    let _apiMethodsHtml = '';
    _apiMethodsHtml += '<div class="cr-detail-grid">';
    _apiMethodsHtml += '<div class="cr-detail-section">';
    _apiMethodsHtml += '<div class="cr-detail-heading">API \u2014 Method Examples</div>';

    const _apiManifest = _lumpManifests[nsIdx] || {};
    const _apiMethods  = _apiManifest._methods  || [];
    const _apiAbsName  = (sim && sim.nsLabels && sim.nsLabels[nsIdx]) || `NS[${nsIdx}]`;

    if (_apiMethods.length === 0) {
        // Fallback: show pet name aliases from global _petNameDRMap / _petNameCRMap if available
        const _fallbackDREntries = Object.entries(_petNameDRMap).filter(([, v]) => v);
        const _fallbackCREntries = Object.entries(_petNameCRMap).filter(([, v]) => v);
        if (_fallbackDREntries.length > 0 || _fallbackCREntries.length > 0) {
            _apiMethodsHtml += '<div style="color:var(--text-secondary);font-size:0.82rem;padding:0.5rem 0 0.25rem;">Pet name aliases (from current context):</div>';
            let fbEx = '';
            for (const [idx, name] of _fallbackDREntries.sort(([a], [b]) => parseInt(a) - parseInt(b))) {
                fbEx += `.pet ${name.padEnd(12)} DR${idx}\n`;
            }
            for (const [idx, name] of _fallbackCREntries.sort(([a], [b]) => parseInt(a) - parseInt(b))) {
                fbEx += `.pet ${name.padEnd(12)} CR${idx}\n`;
            }
            const escapedFb = fbEx.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            _apiMethodsHtml += `<pre class="abs-method-panel-code" style="font-size:0.72rem;line-height:1.55;background:#0a0a1a;padding:0.75rem;border-radius:6px;overflow-x:auto;white-space:pre;">${escapedFb}</pre>`;
            _apiMethodsHtml += '<div style="color:var(--text-secondary);font-size:0.75rem;margin-top:0.25rem;">Compile the abstraction source to generate full method examples.</div>';
        } else {
            _apiMethodsHtml += '<div style="color:var(--text-secondary);font-size:0.82rem;padding:0.5rem 0;">';
            _apiMethodsHtml += 'No method manifest available for this abstraction.<br>';
            _apiMethodsHtml += '<span style="font-size:0.75rem;">Compile the abstraction source to generate API examples.</span>';
            _apiMethodsHtml += '</div>';
        }
    } else {
        // Build global pet_names from the merged manifest (fallback for methods
        // that don't declare their own).
        const _apiGlobalDR = Object.assign({}, (_apiManifest.pet_names || {}).DR || {});
        const _apiGlobalCR = Object.assign({}, (_apiManifest.pet_names || {}).CR || {});
        // Lump-level pet_names empty flag — used to conditionally show the no-pet note
        const _lumpHasPetNames = Object.keys(_apiGlobalDR).length > 0 || Object.keys(_apiGlobalCR).length > 0;

        for (let mIdx = 0; mIdx < _apiMethods.length; mIdx++) {
            const method = _apiMethods[mIdx];
            // Priority: method-specific > manifest-global; _petNameDRMap/_petNameCRMap are
            // NOT merged here — they are only shown in the no-methods fallback branch.
            const methodDR = Object.assign({}, _apiGlobalDR, (method.pet_names || {}).DR || {});
            const methodCR = Object.assign({}, _apiGlobalCR, (method.pet_names || {}).CR || {});

            // ── Resolve a DR/CR token (returns pet name if one exists) ───────
            const drToken = (n) => methodDR[String(n)] || `DR${n}`;
            const crToken = (n) => methodCR[String(n)] || `CR${n}`;

            // ── Collect DRs mentioned in inputs/outputs ──────────────────────
            const inputDRs  = [];
            const outputDRs = [];
            for (const s of (method.inputs  || [])) { for (const m2 of (s.matchAll(/\bDR(\d+)\b/g) || [])) { const n = parseInt(m2[1]); if (!inputDRs.includes(n)) inputDRs.push(n); } }
            for (const s of (method.outputs || [])) { for (const m2 of (s.matchAll(/\bDR(\d+)\b/g) || [])) { const n = parseInt(m2[1]); if (!outputDRs.includes(n)) outputDRs.push(n); } }
            const outputOnlyDRs = outputDRs.filter(n => !inputDRs.includes(n));

            // ── Build the example block text ─────────────────────────────────
            const ruler = '\u2500'.repeat(48);
            let ex = `; \u2500\u2500 ${_apiAbsName}.${method.name} \u2500 method ${mIdx} ${ruler}\n`;
            let anyPet = false;   // track whether any .pet lines were emitted (used for note below)
            if (method.aliasOf) {
                ex += `; Alias of: ${method.aliasOf}\n`;
            } else {
                if (method.inputs  && method.inputs.length  > 0) ex += `; Inputs:  ${method.inputs.join(', ')}\n`;
                if (method.outputs && method.outputs.length > 0) ex += `; Outputs: ${method.outputs.join(', ')}\n`;
                ex += ';\n';

                // ── .pet preamble ─────────────────────────────────────────────
                // Emit .pet lines only for DRs that appear in this method's
                // inputs/outputs (not every named DR in the manifest).
                // Ordering: input DRs ascending first, then output-only DRs ascending.
                const emittedDRs = new Set();
                const drOrder = [
                    ...inputDRs.slice().sort((a, b) => a - b),
                    ...outputOnlyDRs.slice().sort((a, b) => a - b),
                ];
                for (const drNum of drOrder) {
                    const petName = methodDR[String(drNum)];
                    if (!petName || emittedDRs.has(drNum)) continue;
                    emittedDRs.add(drNum);
                    const isInput  = inputDRs.includes(drNum);
                    const isOutput = outputDRs.includes(drNum);
                    const role = isInput && isOutput ? 'input/output' : isOutput ? 'output' : 'input';
                    ex += `.pet ${petName.padEnd(12)} DR${drNum}          ; ${role}\n`;
                    anyPet = true;
                }
                // Emit .pet for every CR referenced in the generated example that
                // has a pet name.  For the standard CALL example the referenced CRs
                // are: callDstCR (CR0, the CALL destination) and callCR (CR14 by
                // convention, the CLOOMC method register).
                const callDstCR = 0;   // CALL destination register
                const callCR    = 14;  // CLOOMC method register by convention
                const crsInExample = [...new Set([callDstCR, callCR])].sort((a, b) => a - b);
                for (const crNum of crsInExample) {
                    if (methodCR[String(crNum)]) {
                        const crRole = crNum === callCR ? 'CLOOMC register' : 'capability register';
                        ex += `.pet ${methodCR[String(crNum)].padEnd(12)} CR${crNum}          ; ${crRole}\n`;
                        anyPet = true;
                    }
                }
                if (anyPet) {
                    ex += ';\n';
                }

                // ── LOAD lines for each input DR ─────────────────────────────
                for (const drNum of inputDRs.sort((a, b) => a - b)) {
                    ex += `LOAD  ${drToken(drNum).padEnd(12)}, #<value>       ; input\n`;
                }
                // ── CALL line ────────────────────────────────────────────────
                const callCRTok    = crToken(callCR);
                const callDstTok   = crToken(callDstCR);
                ex += `CALL  ${callDstTok}, ${callCRTok}, #${mIdx}       ; \u2192 ${_apiAbsName}.${method.name}\n`;
                // ── Result comment ───────────────────────────────────────────
                for (const drNum of outputDRs.sort((a, b) => a - b)) {
                    ex += `; result in ${drToken(drNum)} (DR${drNum})\n`;
                }
            }

            const escapedEx = ex
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            const _anchorId = `crd-api-ex-${nsIdx}-${mIdx}`;
            const _isInternal = !!method._internal;
            const _badge = _isInternal
                ? `<span style="font-size:0.65rem;background:#2a2a3a;color:var(--text-secondary);border-radius:3px;padding:1px 5px;margin-left:0.5rem;vertical-align:middle;">internal</span>`
                : `<span style="font-size:0.65rem;background:#1a2a1a;color:#6fbf6f;border-radius:3px;padding:1px 5px;margin-left:0.5rem;vertical-align:middle;">public</span>`;
            _apiMethodsHtml += `<div id="${_anchorId}" style="margin-bottom:1.5rem;scroll-margin-top:4px;">`;
            _apiMethodsHtml += `<div style="font-size:0.78rem;font-weight:700;color:var(--church-gold);margin-bottom:0.35rem;">${method.name}${_badge}</div>`;
            _apiMethodsHtml += `<pre class="abs-method-panel-code" style="font-size:0.72rem;line-height:1.55;background:#0a0a1a;padding:0.75rem;border-radius:6px;overflow-x:auto;white-space:pre;">${escapedEx}</pre>`;
            if (!method.aliasOf && !_lumpHasPetNames) {
                _apiMethodsHtml += `<div style="color:var(--text-secondary);font-size:0.75rem;margin-top:0.25rem;font-style:italic;">; (no pet names defined \u2014 compile abstraction to add aliases)</div>`;
            }
            _apiMethodsHtml += `</div>`;
        }
    }

    _apiMethodsHtml += '</div>';
    _apiMethodsHtml += '</div>';
    // Panel: API — pet names + method conventions
    // ═══════════════════════════════════════════════════════════════════════════
    html += `<div class="crd-panel" id="crdPanel-api" style="display:${crDetailTab==='api'?'block':'none'}">`;
    html += '<div class="cr-detail-grid">';
    html += '<div class="cr-detail-section">';

    // Pet Names
    html += '<div class="crd-api-section-label">Pet Names</div>';
    {
        const _mfstPN  = _lumpManifests[nsIdx];
        const _mfstDR  = (_mfstPN && _mfstPN.pet_names && _mfstPN.pet_names.DR) || {};
        const _mfstCR  = (_mfstPN && _mfstPN.pet_names && _mfstPN.pet_names.CR) || {};
        const _pnRows  = [];
        for (let i = 0; i < 16; i++) {
            const _alias = _mfstDR[i] || _mfstDR[String(i)] || _petNameDRMap[i] || _petNameDRMap[String(i)];
            if (_alias) _pnRows.push([`DR${i}`, _alias]);
        }
        for (let i = 0; i < 16; i++) {
            const _alias = _mfstCR[i] || _mfstCR[String(i)] || _petNameCRMap[i] || _petNameCRMap[String(i)];
            if (_alias) _pnRows.push([`CR${i}`, _alias]);
        }
        if (_pnRows.length === 0) {
            html += '<div style="color:var(--text-secondary);font-style:italic;margin-bottom:0.75rem;">(no pet names defined for this abstraction)</div>';
        } else {
            html += '<table class="cr-table" style="margin-bottom:0.75rem;"><thead><tr><th>Register</th><th>Alias</th></tr></thead><tbody>';
            for (const [reg, alias] of _pnRows) {
                html += `<tr><td class="cr-idx">${reg}</td><td class="cr-name">${alias}</td></tr>`;
            }
            html += '</tbody></table>';
        }
    }

    // Methods & Example API — clickable method index linking to anchored example blocks
    html += '<div class="crd-api-section-label">Methods &amp; Example API</div>';
    {
        // Prefer the _methods array (populated by CLOOMC load); fall back to the
        // legacy METHOD_REGISTER_CONVENTIONS dict for system abstractions.
        const _idxMethods = (_lumpManifests[nsIdx] && _lumpManifests[nsIdx]._methods) || [];
        const _conv       = (typeof METHOD_REGISTER_CONVENTIONS !== 'undefined' && METHOD_REGISTER_CONVENTIONS[_absName]) || {};
        const _convKeys   = Object.keys(_conv).sort((a, b) => {
            const ia = _conv[a].index != null ? _conv[a].index : 999;
            const ib = _conv[b].index != null ? _conv[b].index : 999;
            return ia - ib;
        });

        if (_idxMethods.length === 0 && _convKeys.length === 0) {
            html += '<div style="color:var(--text-secondary);font-style:italic;">(no methods defined \u2014 compile the abstraction source to see methods)</div>';
        } else if (_idxMethods.length > 0) {
            // CLOOMC-compiled: show a pill list where each pill scrolls to the
            // anchored example block in the API — Method Examples section below.
            html += '<div style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.5rem;">';
            for (let _mi = 0; _mi < _idxMethods.length; _mi++) {
                const _m = _idxMethods[_mi];
                const _isInt = !!_m._internal;
                const _anchorId = `crd-api-ex-${nsIdx}-${_mi}`;
                const _pillBg   = _isInt ? '#1e1e2e' : '#1a2a1a';
                const _pillClr  = _isInt ? 'var(--text-secondary)' : '#6fbf6f';
                const _pillBdr  = _isInt ? '#2a2a4a' : '#2a4a2a';
                const _tag      = _isInt ? 'internal' : 'public';
                html += `<button onclick="var el=document.getElementById('${_anchorId}');if(el){el.scrollIntoView({behavior:'smooth',block:'nearest'});el.style.outline='2px solid var(--church-gold)';setTimeout(()=>{el.style.outline=''},1500);}" `
                      + `style="background:${_pillBg};color:${_pillClr};border:1px solid ${_pillBdr};`
                      + `border-radius:5px;padding:2px 8px;font-size:0.72rem;cursor:pointer;font-family:inherit;`
                      + `display:inline-flex;align-items:center;gap:0.3rem;" `
                      + `title="${_tag} method — click to jump to example">`
                      + `${_m.name}`
                      + `<span style="font-size:0.6rem;opacity:0.6;">${_mi}</span>`
                      + `</button>`;
            }
            html += '</div>';
            html += '<div style="color:var(--text-secondary);font-size:0.72rem;">Click a method to jump to its call example below.</div>';
        } else {
            // Legacy conventions dict path (system abstractions without CLOOMC compile).
            for (const _mname of _convKeys) {
                const _mc   = _conv[_mname];
                const _midx = _mc.index != null ? _mc.index : '\u2014';
                const _min  = _mc.input  || '\u2014';
                const _mout = _mc.output || '\u2014';
                const _mdis = _mc.dispatch || null;
                const _mnote= _mc.note    || null;

                html += '<div class="crd-api-method-block">';
                html += `<div style="font-weight:700;color:var(--church-gold);margin-bottom:0.25rem;">${_mname}</div>`;
                html += '<table class="cr-table" style="margin-bottom:0.4rem;"><tbody>';
                html += `<tr><td style="color:var(--church-blue);width:100px;">Index</td><td>${_midx}</td></tr>`;
                html += `<tr><td style="color:var(--church-blue)">Input DRs</td><td>${_min}</td></tr>`;
                html += `<tr><td style="color:var(--church-blue)">Output DRs</td><td>${_mout}</td></tr>`;
                if (_mdis) {
                    html += `<tr><td style="color:var(--church-blue)">Dispatch</td><td><code>${_mdis}</code></td></tr>`;
                }
                html += '</tbody></table>';

                const _exLines = [];
                if (_midx !== '\u2014') _exLines.push(`LOAD  DR3, #${_midx}     ; method selector`);
                if (_mdis) {
                    _exLines.push(`${_mdis}  ; ${_absName || 'abs'}.${_mname}`);
                } else {
                    _exLines.push(`CALL  CR0, CR14, #0  ; ${_absName || 'abs'}.${_mname}`);
                }
                html += `<pre class="crd-api-dispatch">${_exLines.join('\n')}</pre>`;
                if (_mnote) html += `<div class="crd-api-note">${_mnote}</div>`;
                html += '</div>';
            }
        }
    }

    html += '</div>';
    html += '</div>';
    html += _apiMethodsHtml;
    html += '</div>';

    html += `<div class="crd-panel" id="crdPanel-register" style="display:${crDetailTab==='register'?'block':'none'}">`;
    html += '<div class="cr-detail-grid">';

    html += '<div class="cr-detail-section">';
    html += '<div class="cr-detail-heading">128-bit Context Register Words</div>';
    html += '<table class="cr-table cr-detail-words"><thead><tr>';
    html += '<th>Word</th><th>Value</th><th>Decoded</th>';
    html += '</tr></thead><tbody>';
    {
        const _gt32 = sim.cr[crIdx].word0 >>> 0;
        const _parsed = sim.parseGT(_gt32);
        const _p = { ..._parsed.permissions, F: _parsed.type === 2 ? 1 : 0 };
        let _permHtml = '';
        for (const _bit of ['B','R','W','X','E','L','S','F']) {
            const _cls = _p[_bit] ? 'perm-on' : 'perm-off';
            _permHtml += `<span class="abs-perm-badge ${_cls}">${_bit}</span>`;
        }
        const _gtHex = '0x' + _gt32.toString(16).toUpperCase().padStart(8, '0');
        let _gtDecoded;
        if (_parsed.type === 3) {
            const _ab = sim.parseAbstractGT(_gt32);
            const _AB_TYPE = { 0: 'I/O', 1: 'M-Elevation' };
            const _DC = { 1: 'LED', 2: 'UART', 3: 'Button', 4: 'Timer', 5: 'Display' };
            const _abDetail = _ab.ab_type === 0
                ? `${_DC[_ab.device_class] || 'dc' + _ab.device_class}[${_ab.device_data}]`
                : `${_AB_TYPE[_ab.ab_type] || 'ab' + _ab.ab_type} 0x${_ab.ab_data.toString(16).toUpperCase()}`;
            _gtDecoded = `<span class="abs-clist-perms">${_permHtml}</span> <span class="abs-clist-type">${_parsed.typeName}</span> <span class="abs-clist-name">${_abDetail}</span><span style="color:#555;font-size:0.68rem;"> seq${_parsed.gt_seq}</span>`;
        } else {
            const _gtNsIdx2 = _parsed.index;
            const _gtLabel = (sim.nsLabels && sim.nsLabels[_gtNsIdx2]) || null;
            const _gtNameStr = _gtLabel ? `NS[${_gtNsIdx2}] \u2014 ${_gtLabel}` : `NS[${_gtNsIdx2}]`;
            _gtDecoded = `<span class="abs-clist-perms">${_permHtml}</span> <span class="abs-clist-type">${_parsed.typeName}</span> <span class="abs-clist-name">${_gtNameStr}</span><span style="color:#555;font-size:0.68rem;"> seq${_parsed.gt_seq}</span>`;
        }
        html += `<tr><td>R0: GT</td><td class="abs-clist-gt">${_gtHex}</td><td>${_gtDecoded}</td></tr>`;
    }
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
            const typNames = ['lump', 'namespace', 'thread', 'outform'];
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
        const scrollTarget = (_crDetailHighlightPC !== null
            ? contentEl.querySelector('.code-gate-row')
            : null) || contentEl.querySelector('.code-pc-row');
        if (scrollTarget) scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}

function updateDRDisplay() {
    if (!sim) return;
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

let _flagsHoverReady = false;
function _initFlagsHover() {
    if (_flagsHoverReady) return;
    _flagsHoverReady = true;
    const stepBtn = document.getElementById('toolStepBtn');
    const pop     = document.getElementById('flagsPopover');
    if (!stepBtn || !pop) return;
    function _posFlagsPop() {
        const r = stepBtn.getBoundingClientRect();
        pop.style.top  = (r.bottom + 5) + 'px';
        const left = Math.max(4, r.left + r.width / 2 - (pop.offsetWidth || 120) / 2);
        pop.style.left = left + 'px';
    }
    stepBtn.addEventListener('mouseenter', () => {
        _posFlagsPop();
        pop.style.display = 'flex';
        setTimeout(_posFlagsPop, 0);
    });
    stepBtn.addEventListener('mouseleave', (e) => {
        if (!pop.contains(e.relatedTarget)) pop.style.display = 'none';
    });
    pop.addEventListener('mouseleave', (e) => {
        if (!stepBtn.contains(e.relatedTarget)) pop.style.display = 'none';
    });
}

function updateFlagsDisplay() {
    if (!sim) return;
    const container = document.getElementById('flagsDisplay');
    if (!container) return;
    _initFlagsHover();
    const f = sim.flags;
    const bootLabel   = !sim.bootComplete ? `BOOT ${sim.bootStep}/4` : '';
    const statusLabel = sim.halted ? 'HALTED' : (sim.bootComplete ? 'READY' : 'RESET');
    const cap = sim.lastCapability;

    // ── Compact status chip in the flags-led-row ──────────────────────────
    container.innerHTML =
        (bootLabel ? `<span class="flag-info flag-boot">${bootLabel}</span>` : '') +
        `<span class="flag-info flag-status${sim.halted ? ' flag-status-halted' : ''}">${statusLabel}</span>`;

    // ── Flags popover (anchored below step button, shown on hover) ─────────
    const flagsPop = document.getElementById('flagsPopover');
    if (flagsPop) {
        flagsPop.innerHTML =
            `<span class="flag ${f.N ? 'flag-set' : ''}">N</span>` +
            `<span class="flag ${f.Z ? 'flag-set' : ''}">Z</span>` +
            `<span class="flag ${f.C ? 'flag-set' : ''}">C</span>` +
            `<span class="flag ${f.V ? 'flag-set' : ''}">V</span>` +
            `<span class="flags-sep"></span>` +
            `<span class="flag-info">PC:&nbsp;${sim.pc}</span>` +
            `<span class="flag-info">Steps:&nbsp;${sim.stepCount}</span>` +
            `<span class="flag-info">Stack:&nbsp;${sim.callStack.length}</span>` +
            `<span class="flag-info">STO:&nbsp;${sim.sto}</span>`;
    }

    // ── Cap popover (disabled) ──────────────────────────────────────────────
    const capPop = document.getElementById('capPopover');
    if (capPop) { capPop.innerHTML = ''; capPop.style.display = 'none'; }
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
        ${(() => {
            if (!sim || !sim.bootComplete) return '';
            const _irq = sim.irqState || {};
            const _sa = sim.systemAbstractions || null;
            const _ss = _sa ? _sa._schedulerState : null;
            const _sweepCount = _ss ? (_ss._irqSweepCount || 0) : 0;
            const _timerArmed = !!_irq.timerArmed;
            const _timerDeadline = _irq.timerDeadline || 0;
            const _timerDuration = _irq.timerDuration || 0;
            const _countdown = _timerArmed ? Math.max(0, _timerDeadline - (sim.stepCount || 0)) : 0;
            const _irqActive = !!_irq.irqActive;
            const _threads = (_ss && Array.isArray(_ss.threads)) ? _ss.threads.length : 0;

            const timerHtml = _timerArmed
                ? `<span style="color:#66bb6a;font-weight:600;">&#x23F0; ARMED</span> &mdash; deadline&nbsp;${_timerDeadline}, ${_countdown}&nbsp;step${_countdown !== 1 ? 's' : ''} remaining (duration&nbsp;${_timerDuration})`
                : `<span style="color:#555;">disarmed</span>`;

            const irqHtml = _irqActive
                ? `<span style="color:#ff9800;font-weight:600;">active</span>`
                : `<span style="color:#555;">idle</span>`;

            const _waitingOnFlags = _irq.waitingOnFlags || {};
            const _lazyWaiters = Object.entries(_waitingOnFlags).filter(([, flag]) => flag && flag.startsWith('lazy_resolve:'));
            let _pendingCapHtml = '';
            if (_lazyWaiters.length > 0) {
                _pendingCapHtml = '<div class="info-item">' +
                    '<span class="info-label">Pending Capabilities</span>' +
                    '<span class="info-value lr-pending-value">';
                for (const [tid, flag] of _lazyWaiters) {
                    const _slotIdx = parseInt(flag.split(':')[1], 10);
                    const _resolveInfo = sim._pendingResolves && sim._pendingResolves.get(_slotIdx);
                    const _petName = (_resolveInfo && _resolveInfo.petName) ? _resolveInfo.petName : `slot\u00a0${_slotIdx}`;
                    _pendingCapHtml += `<button class="lr-pending-badge" onclick="_openPendingCListInNS(${_slotIdx})" title="Thread ${tid} suspended\u2014click to navigate to c-list slot ${_slotIdx} in the Namespace view">` +
                        `\u23F8\u202FPending: \u201C${_petName}\u201D \u2192 view slot</button> `;
                }
                _pendingCapHtml += '</span></div>';
            }

            return `<div class="info-item"><span class="info-label">Scheduler Timer</span><span class="info-value">${timerHtml}</span></div>`
                 + `<div class="info-item"><span class="info-label">Scheduler.IRQ</span><span class="info-value">${irqHtml} &mdash; <span style="color:#ffb74d;font-weight:600;">${_sweepCount}</span> sweep${_sweepCount !== 1 ? 's' : ''}, ${_threads} thread${_threads !== 1 ? 's' : ''} &mdash; <a href="#" onclick="event.preventDefault();switchView('abstractions');showAbstractionDetail(8);" style="color:#c89b3c;text-decoration:none;font-size:0.8rem;">view detail</a></span></div>`
                 + _pendingCapHtml;
        })()}
        <div class="info-item info-item-selftest">
            <span class="info-label">Post-Flash Selftest</span>
            <span class="info-value">
                <button id="dashSelftestBtn" class="btn btn-sm dash-selftest-btn" onclick="runSelftestLump()" title="Load PostFlashSelftest LUMP and run all 81 hardware correctness tests \u2014 DR0=0 on pass">Run Selftest</button>
                <a href="#" onclick="event.preventDefault();switchView('lumps');setTimeout(()=>showLumpDetail('82f5ef56'),200);" style="color:#c89b3c;text-decoration:none;font-size:0.78rem;margin-left:0.5rem;">view LUMP</a>
            </span>
        </div>
        ${(typeof _lastSelftestResult !== 'undefined' && _lastSelftestResult !== null)
            ? `<div id="dashSelftestPanel" class="selftest-result-panel">${_buildSelftestPanel(_lastSelftestResult.dr0, _lastSelftestResult.passed)}</div>`
            : `<div id="dashSelftestPanel" class="selftest-result-panel" style="display:none"></div>`
        }
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

// Called when the user clicks an audit gate label in the pipeline TSB panel.
// Finds the CR that currently holds a GT pointing at nsIdx, opens its detail
// in the Dashboard Register view.  Falls back to the Namespace table view if
// no CR carries that slot.
function pipelineGateClick(nsIdx) {
    // Scan CRs 0–15: find the first one whose GT index matches nsIdx
    let found = -1;
    for (let c = 0; c < 16; c++) {
        const cr = sim.cr[c];
        if (!cr || !cr.word0) continue;
        const parsed = sim.parseGT(cr.word0);
        if (parsed.index === nsIdx) { found = c; break; }
    }
    if (found >= 0) {
        switchView('dashboard');
        openCRDetail(found);
    } else {
        switchView('namespace');
    }
}

let nsExpandedSlot = -1;

function toggleNSDetail(idx) {
    nsExpandedSlot = (nsExpandedSlot === idx) ? -1 : idx;
    updateNamespace();
}

function _gtPetName(gtWord) {
    gtWord = gtWord >>> 0;
    if (!gtWord) return '';
    const p = sim.parseGT(gtWord);
    if (p.type === 3) {
        const ab = sim.parseAbstractGT(gtWord);
        const DC = { 1: 'LED', 2: 'UART', 3: 'Button', 4: 'Timer', 5: 'Display' };
        if (ab.ab_type === 0) return `${DC[ab.device_class] || 'dc' + ab.device_class}[${ab.device_data}]`;
        return `M-Elev 0x${ab.ab_data.toString(16).toUpperCase()}`;
    }
    return (sim.nsLabels && sim.nsLabels[p.index]) ? sim.nsLabels[p.index] : '';
}

function _renderGTRow(idx, addr, word) {
    const hex = '0x' + (word >>> 0).toString(16).toUpperCase().padStart(8, '0');
    const crPetName = (typeof _petNameCRMap !== 'undefined' && _petNameCRMap) ? _petNameCRMap[idx] : null;
    const crPetPrefix = crPetName
        ? `<span style="color:rgba(156,220,254,0.9);font-weight:600;">${crPetName}</span><span style="color:#777;">(CR${idx})</span> `
        : '';
    if (word === 0) {
        return `<tr><td style="color:rgba(200,155,60,0.7);">${idx}</td><td>0x${addr.toString(16).toUpperCase().padStart(4,'0')}</td><td style="color:rgba(206,145,120,0.6);">${hex}</td><td><span style="color:#666;">${crPetPrefix}0 (empty)</span></td></tr>`;
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
        decoded  = crPetPrefix;
        decoded += `<span style="color:rgba(52,211,153,0.9);">Abstract</span>`;
        decoded += ` <span style="color:rgba(200,155,60,0.55);">[${rwStr}]</span>`;
        decoded += ` <span style="color:rgba(156,220,254,0.7);">${abTypeName}${deviceDetail}</span>`;
        decoded += ` <span style="color:#555;">seq${ab.gt_seq}</span>`;
    } else {
        const permStr = (p.permissions.B ? 'B' : '-') + (p.permissions.R ? 'R' : '-') + (p.permissions.W ? 'W' : '-') + (p.permissions.X ? 'X' : '-') + (p.permissions.L ? 'L' : '-') + (p.permissions.S ? 'S' : '-') + (p.permissions.E ? 'E' : '-');
        const label = sim.nsLabels[p.index] || '';
        decoded  = crPetPrefix;
        decoded += `<span style="color:rgba(78,201,176,0.7);">${p.typeName}</span>`;
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
            const slotLabel= _gtPetName(gtWord) || '-';
            const perms    = gt.permissions;
            const permStr  = Object.entries(perms).filter(([,v])=>v).map(([k])=>k).join('') || 'none';
            const tCol     = typeColors[gt.type] || '#888';
            html += '<tr>';
            html += `<td style="color:rgba(200,155,60,0.8);font-size:0.73rem;">${i}</td>`;
            html += `<td style="font-family:monospace;color:#525252;font-size:0.73rem;">${addrHex}</td>`;
            html += `<td style="font-family:monospace;color:rgba(206,145,120,0.85);font-size:0.73rem;">${gtHex}</td>`;
            html += `<td style="color:#f59e0b;font-size:0.73rem;">${gt.type === 3 ? '\u2014' : gt.index}</td>`;
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

// Thread lump sizing parameters — set by the IDE under programmer control.
// FS = Full lump size  (F = full):  total words in the thread lump.
// HS = Heap size       (H = heap):  max heap words; stored in header cc field.
// SS = Stack size      (S = stack): stack words;    stored in header cw field.
// Architecture-fixed zones: DR = 16 words (DR0–DR15), Caps = 12 words (CR0–CR11).
const THREAD_FS = 256;  // Full size  (FS)
const THREAD_HS =  64;  // Heap size  (HS)
const THREAD_SS =  32;  // Stack size (SS)

// Physical layout (word 0 at top, word FS-1 at bottom):
//   +0                     Lump Header (1 word)
//   +1        … +16        Zone ⑤ Data Registers — DR0..DR15 (16 words, fixed)
//   +17       … +HS        Zone ④ Heap ↑ — HS words; grows upward
//   +HS+1     … +FS-13-SS  Zone ③ Freespace — dynamic gap; Mint-verified all-zero
//   +FS-12-SS … +FS-13     Zone ② LIFO Stack ↓ — SS words; grows downward
//   +FS-12    … +FS-1      Zone ① Capabilities — CR0..CR11 GT Word 0; c-list tail (12 words, fixed)
const THREAD_LAYOUT = {
    HEADER_WORD:   0,
    THREAD_HEADER: 0xF900_8240,  // magic=0x1F · n-6=log2(FS)-6 · cw=SS · typ=10 · cc=HS
    DR_START:      1,              DR_END:    16,                        DR_WORDS:   16,
    HEAP_START:   17,              HEAP_END:  17 + THREAD_HS - 1,        HEAP_WORDS: THREAD_HS,
    FREE_START:   17 + THREAD_HS, FREE_END:  THREAD_FS - THREAD_SS - 13, FREE_WORDS: THREAD_FS - 17 - THREAD_HS - THREAD_SS - 12,
    STACK_START:  THREAD_FS - THREAD_SS - 12, STACK_END: THREAD_FS - 13, STACK_WORDS: THREAD_SS,
    CAPS_START:   THREAD_FS - 12, CAPS_END:  THREAD_FS - 1,             CAPS_WORDS: 12,
    TOTAL:        THREAD_FS,
};
const THREAD_NS_SLOTS = new Set([1, 45]);

function renderThreadMemoryLayout(nsIndex) {
    const entry = sim.readNSEntry(nsIndex);
    const slotBase = entry ? entry.word0_location : (nsIndex * sim.SLOT_SIZE);
    const label = sim.nsLabels[nsIndex] || ('Slot ' + nsIndex);
    const TL = THREAD_LAYOUT;

    const secHdr = (num, title, note, color, id='') =>
        `<div class="thread-zone-wrap">` +
        `<div class="thread-zone-hdr thread-zone-collapsed"${id ? ` id="${id}"` : ''} style="border-left-color:${color};" onclick="_tzToggle(this)">` +
        `<span class="thread-zone-chevron">▶</span>${num} ${title}` +
        `<span class="thread-zone-note">${note}</span></div>` +
        `<div class="thread-zone-body" style="display:none;">`;
    const secBody = () => `</div></div>`;

    const addrOf = (off) => '0x' + (slotBase + off).toString(16).toUpperCase().padStart(4, '0');
    const hexOf  = (w)   => '0x' + (w >>> 0).toString(16).toUpperCase().padStart(8, '0');

    let html = '<div class="thread-layout-view">';

    // ── Sticky header block (title + lump header) ─────────────────────────
    const headerWord = sim.memory[slotBase + TL.HEADER_WORD] || TL.THREAD_HEADER;
    html += `<div class="thread-layout-sticky" id="thread-zone-hdr">`;
    html += `<div class="thread-layout-header">${label} — Thread Memory Layout<span class="thread-layout-subhead">NS Slot ${nsIndex} · base ${addrOf(0)} · ${THREAD_FS} words·FS (${THREAD_FS * 4}\u202Fbytes)</span></div>`;
    html += `<div class="thread-lump-hdr-block">`;
    html += `<span class="thread-lump-hdr-label">Lump Header</span>`;
    html += `<span class="thread-lump-hdr-note">word 0 · magic=0x1F · n\u22126=${Math.log2(THREAD_FS) - 6} (${THREAD_FS}w·FS) · cw=${THREAD_SS}\u202F(SS) · typ=10 (Thread) · cc=${THREAD_HS}\u202F(HS)</span>`;
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
    html += secBody();

    // ── Zone ④: Heap (+17 … +80) ─────────────────────────────────────────
    let heapNonZero = 0;
    for (let i = TL.HEAP_START; i <= TL.HEAP_END; i++) {
        if (sim.memory[slotBase + i]) heapNonZero++;
    }
    html += secHdr('④', 'Heap ↑', `${THREAD_HS} words·HS · offset +${TL.HEAP_START} … +${TL.HEAP_END} · base ${addrOf(TL.HEAP_START)} · ${heapNonZero} word${heapNonZero!==1?'s':''} allocated`, '#22c55e', 'thread-zone-4');
    html += '<table class="ns-mem-table thread-zone-table"><thead><tr><th>Off</th><th>Addr</th><th>Hex</th><th>Decoded</th></tr></thead><tbody>';
    for (let i = 0; i < TL.HEAP_WORDS; i++) {
        const off  = TL.HEAP_START + i;
        const word = sim.memory[slotBase + off] || 0;
        const rowStyle = word ? '' : ' style="opacity:0.22;"';
        const decoded  = word ? `<span style="color:#9ca3af;">0x${word.toString(16).toUpperCase().padStart(8,'0')}</span>` : '<span style="color:#374151;">free</span>';
        html += `<tr${rowStyle}><td style="color:#22c55e;">+${off}</td><td style="font-family:monospace;">${addrOf(off)}</td><td style="color:rgba(206,145,120,0.8);font-family:monospace;">${hexOf(word)}</td><td>${decoded}</td></tr>`;
    }
    html += '</tbody></table>';
    html += secBody();

    // ── Zone ③: Freespace (+81 … +211) ───────────────────────────────────
    let freeNonZero = 0;
    for (let i = TL.FREE_START; i <= TL.FREE_END; i++) {
        if (sim.memory[slotBase + i]) freeNonZero++;
    }
    html += secHdr('③', 'Freespace', `${TL.FREE_WORDS} words · offset +${TL.FREE_START} … +${TL.FREE_END} · ${freeNonZero} non-zero · shrinks as stack grows ↓ and heap grows ↑`, '#6b7280', 'thread-zone-3');
    if (freeNonZero === 0) {
        html += `<div class="thread-free-empty">All ${TL.FREE_WORDS} words are zero — region is unallocated.</div>`;
    } else {
        html += '<table class="ns-mem-table thread-zone-table"><thead><tr><th>Off</th><th>Addr</th><th>Hex</th><th>Note</th></tr></thead><tbody>';
        for (let i = TL.FREE_START; i <= TL.FREE_END; i++) {
            const word = sim.memory[slotBase + i] || 0;
            if (!word) continue;
            html += `<tr><td style="color:#6b7280;">+${i}</td><td style="font-family:monospace;">${addrOf(i)}</td><td style="color:rgba(206,145,120,0.8);font-family:monospace;">${hexOf(word)}</td><td style="color:#4b5563;">non-zero</td></tr>`;
        }
        html += '</tbody></table>';
    }
    html += secBody();

    // ── Zone ②: LIFO Stack (+212 … +243) ─────────────────────────────────
    const stackWords = sim.memory.slice(slotBase + TL.STACK_START, slotBase + TL.STACK_END + 1);
    const stackUsed  = stackWords.filter(Boolean).length;
    const stoLive    = (sim.sto != null) ? sim.sto : TL.STACK_END;
    html += secHdr('②', 'LIFO Stack ↓', `${THREAD_SS} words·SS · offset +${TL.STACK_START} … +${TL.STACK_END} · STO=${stoLive} · grows ↓ · ${stackUsed} word${stackUsed!==1?'s':''} non-zero`, '#38bdf8', 'thread-zone-2');
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
                    const lbl = _gtPetName(word);
                    decoded = `GT → <span style="color:#38bdf8;">${gt.typeName}</span>${gt.type === 3 ? '' : ' Slot='+gt.index}${lbl?' <i style="color:#93c5fd;">('+lbl+')</i>':''} [${perms}]`;
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
    html += secBody();

    // ── Zone ①: Capabilities (+244 … +255) ───────────────────────────────
    html += secHdr('①', 'Capabilities', `12 words·fixed · CR0–CR11 · offset +${TL.CAPS_START} … +${TL.CAPS_END} · c-list tail · saved/restored on context switch`, '#f4b942', 'thread-zone-1');
    html += '<div class="abs-clist-heading">GOLDEN TOKENS</div>';
    html += `<div class="abs-clist-count">cc\u00a0=\u00a0${TL.CAPS_WORDS} slots</div>`;
    html += '<table class="abs-clist-table"><thead><tr>';
    html += '<th>#</th><th>GT (HEX)</th><th>PERMS</th><th>TYPE</th><th>RESOLVED NAME</th>';
    html += '</tr></thead><tbody>';
    for (let i = 0; i < TL.CAPS_WORDS; i++) {
        const off  = TL.CAPS_START + i;
        const word = sim.memory[slotBase + off] || 0;
        const _cr0Hint = (i === 0 && word === 0 && sim.bootEntrySlot !== null && sim.bootEntrySlot !== undefined)
            ? ` ondblclick="_installBootEntryGTIntoCR0()" style="cursor:pointer;" title="Double-click to install boot-entry E-GT (Slot ${sim.bootEntrySlot}) into CR0"`
            : '';
        if (word === 0) {
            let emptyCell = `<td colspan="4" class="abs-clist-empty-slot">\u2014 (empty slot)`;
            if (i === 0 && sim.bootEntrySlot !== null && sim.bootEntrySlot !== undefined) {
                emptyCell += `<span style="color:#6b7280;font-size:0.8em;margin-left:8px;" title="Double-click this row to install the first-LUMP E-GT">\u26a1 double-click to install E-GT for Slot ${sim.bootEntrySlot}</span>`;
            }
            emptyCell += '</td>';
            html += `<tr${_cr0Hint}><td class="abs-clist-idx">${i}</td>${emptyCell}</tr>`;
        } else {
            const parsed = sim.parseGT(word);
            const p = { ...parsed.permissions, F: parsed.type === 2 ? 1 : 0 };
            let permHtml = '';
            for (const bit of ['B','R','W','X','E','L','S','F']) {
                const cls = p[bit] ? 'perm-on' : 'perm-off';
                permHtml += `<span class="abs-perm-badge ${cls}">${bit}</span>`;
            }
            const nsIdx = parsed.index;
            const label = (sim.nsLabels && sim.nsLabels[nsIdx]) ||
                (typeof abstractionRegistry !== 'undefined' && abstractionRegistry &&
                 abstractionRegistry.abstractions && abstractionRegistry.abstractions[nsIdx] &&
                 abstractionRegistry.abstractions[nsIdx].name) || null;
            const nameStr = label ? `NS[${nsIdx}] \u2014 ${label}` : `NS[${nsIdx}]`;
            const gtHex = '0x' + word.toString(16).toUpperCase().padStart(8, '0');
            html += `<tr${_cr0Hint}>`;
            html += `<td class="abs-clist-idx">${i}</td>`;
            html += `<td class="abs-clist-gt">${gtHex}</td>`;
            html += `<td class="abs-clist-perms">${permHtml}</td>`;
            html += `<td class="abs-clist-type">${parsed.typeName}</td>`;
            html += `<td class="abs-clist-name">${nameStr}</td>`;
            html += `</tr>`;
        }
    }
    html += '</tbody></table>';
    html += secBody();

    html += '</div>';
    return html;
}

function _tzToggle(hdr) {
    const wrap = hdr.closest('.thread-zone-wrap');
    const body = wrap && wrap.querySelector('.thread-zone-body');
    if (!body) return;
    const nowCollapsed = hdr.classList.toggle('thread-zone-collapsed');
    const chevron = hdr.querySelector('.thread-zone-chevron');
    body.style.display = nowCollapsed ? 'none' : '';
    if (chevron) chevron.textContent = nowCollapsed ? '▶' : '▼';
}

function _installBootEntryGTIntoCR0() {
    if (!sim) return false;
    const bSlot = sim.bootEntrySlot;
    if (bSlot === null || bSlot === undefined) return false;
    const gtWord = sim.createGT(0, bSlot, {E:1}, 1);
    // Write to the primary thread (NS slot 1 — the boot thread).
    // If the user is currently viewing a different thread slot in the namespace
    // panel, also write there, so the visible Zone ① table immediately updates.
    const targets = new Set([1]);
    if (nsExpandedSlot >= 0 && THREAD_NS_SLOTS.has(nsExpandedSlot)) targets.add(nsExpandedSlot);
    let wrote = false;
    for (const nsIdx of targets) {
        const entry = sim.readNSEntry(nsIdx);
        if (entry && entry.word0_location) {
            sim.memory[entry.word0_location + THREAD_LAYOUT.CAPS_START] = gtWord;
            wrote = true;
        }
    }
    if (wrote) {
        const gtHex = '0x' + (gtWord >>> 0).toString(16).toUpperCase().padStart(8, '0');
        const logLine = `[IDE] CR0 \u2190 E-GT(Slot ${bSlot}) ${gtHex} \u2014 boot-entry first-LUMP installed`;
        sim.output += logLine + '\n';
        const con = document.getElementById('editorConsole');
        if (con) {
            con.textContent += '\n' + logLine;
            con.scrollTop = con.scrollHeight;
        }
        if (typeof updateCRDetail === 'function') updateCRDetail();
        if (typeof updateNamespace === 'function') updateNamespace();
    }
    return wrote;
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
            const typNames   = ['lump','namespace','Thread','Outform'];
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
                let decoded = word === 0 ? '<span style="color:#666;">0 (empty)</span>'
                    : (typeof _highlightCLOOMCSource === 'function' ? _highlightCLOOMCSource(asm.disassemble(word), 'assembly') : asm.disassemble(word));
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
                    const decoded = word === 0 ? '<span style="color:#666;">0 (empty)</span>'
                        : (typeof _highlightCLOOMCSource === 'function' ? _highlightCLOOMCSource(asm2.disassemble(word), 'assembly') : asm2.disassemble(word));
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
                let decoded = word === 0 ? '<span style="color:#666;">0 (empty)</span>'
                    : (typeof _highlightCLOOMCSource === 'function' ? _highlightCLOOMCSource(asm.disassemble(word), 'assembly') : asm.disassemble(word));
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



// Task #217 — fetch the saved boot-image.bin (if any) without triggering
// a 404 console error noise. Returns ArrayBuffer or null.
function _probeBootImage() {
    return fetch('/api/boot-image/binary', { cache: 'no-store' })
        .then(r => r.ok ? r.arrayBuffer() : null)
        .catch(() => null);
}

// Reset hook: re-overlay the cached boot image (or fetch once) so the
// programmer-authored binary survives manual resets.
function _maybeApplyBootImage() {
    // After every successful loadBootImage call, evict stale sticky patches
    // for all NS slots the boot image owns.  Patches that differ from the new
    // binary are cleared with a console + toast warning; matching (redundant)
    // patches are cleared silently.  Must run before _reapplyStickyPatches()
    // fires at boot completion.
    function _evictBootImgPatches() {
        if (typeof window._clearBootImageStickyPatches === 'function') {
            window._clearBootImageStickyPatches(sim.nsCount || 0);
        }
    }
    if (window.bootImage) {
        try { sim.loadBootImage(window.bootImage); _applyBootEntryToSim(); _evictBootImgPatches(); } catch (e) { console.warn('[bootImage] apply failed:', e); }
        return;
    }
    if (window.bootImageAvailable) {
        _probeBootImage().then(buf => {
            if (buf) { window.bootImage = buf;
                       try { sim.loadBootImage(buf); _applyBootEntryToSim(); _evictBootImgPatches(); } catch(e){ console.warn('[bootImage] apply failed:', e); } }
        });
    }
}

// Task #217 — Generate the binary boot image from the persisted boot
// config. The server writes server/lumps/boot-image.bin and returns
// download / inline-binary URLs; we surface the download link and arm
// the simulator to load the image on the next reset.
function generateBootImage() {
    const result = document.getElementById('le-rl-gen-result');
    const btn    = document.getElementById('le-rl-gen-btn');
    if (result) result.textContent = 'Generating\u2026';
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    fetch('/api/boot-image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entrySlot: bootEntrySlot }),
    })
        .then(r => r.json().then(j => ({ ok: r.ok, body: j })))
        .then(({ ok, body }) => {
            if (!ok || body.ok === false) {
                if (result) result.textContent = (body && body.error) || 'Generation failed.';
                return;
            }
            const kib = (body.bytes / 1024).toFixed(1);
            if (result) {
                result.innerHTML =
                    `Generated <strong>${body.bytes.toLocaleString()}</strong> bytes ` +
                    `(${body.words.toLocaleString()} words, ${kib}\u00a0KiB) \u2014 ` +
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
                    try { sim.loadBootImage(buf); _applyBootEntryToSim(); if (typeof window._clearBootImageStickyPatches === 'function') window._clearBootImageStickyPatches(sim.nsCount || 0); } catch(e) { console.warn('[bootImage] apply failed:', e); }
                }
            });
        })
        .catch(err => {
            if (result) result.textContent = 'Generation failed: ' + err;
        })
        .finally(() => {
            if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
        });
}

function uploadBootImageFile(file) {
    if (!file) return;
    const result  = document.getElementById('le-rl-gen-result');
    const btn     = document.getElementById('le-rl-gen-btn');
    if (result) result.textContent = 'Uploading\u2026';
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
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
                    if (result) result.textContent = (body && body.error) || 'Upload failed.';
                    return;
                }
                const kib = (body.bytes / 1024).toFixed(1);
                if (result) {
                    result.innerHTML =
                        `Uploaded <strong>${body.bytes.toLocaleString()}</strong> bytes ` +
                        `(${body.words.toLocaleString()} words, ${kib}\u00a0KiB) \u2014 ` +
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
                if (result) result.textContent = 'Upload failed: ' + err;
            })
            .finally(() => {
                if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
            });
    };
    reader.onerror = function() {
        if (result) result.textContent = 'Failed to read file.';
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
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
    if (!sim) return;
    // Lazily warm _lumpsCache so Source buttons appear even on first NS view load,
    // before the user has visited the Repository view.
    // _lumpsCacheWarmPending  — in-flight guard; cleared on settle.
    // _lumpsCacheWarmAttempted — set after the first settled fetch so a genuinely
    //   empty repository (zero lumps) does not trigger a fetch on every render.
    if ((typeof _lumpsCache === 'undefined' || !Array.isArray(_lumpsCache) || _lumpsCache.length === 0)
            && !window._lumpsCacheWarmPending
            && !window._lumpsCacheWarmAttempted) {
        window._lumpsCacheWarmPending = true;
        fetch('/api/lumps/list').then(r => r.ok ? r.json() : null).then(lumps => {
            window._lumpsCacheWarmPending  = false;
            window._lumpsCacheWarmAttempted = true;
            if (lumps && lumps.length > 0) { _lumpsCache = lumps; updateNamespace(); }
        }).catch(() => {
            window._lumpsCacheWarmPending  = false;
            window._lumpsCacheWarmAttempted = true;
        });
    }
    let html = '<div class="ns-layout-header">NS_ENTRY_LAYOUT: 4 words per entry (128 bits; word3 reserved) \u2014 click a row to inspect memory</div>';
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
        html += `<tr id="ns-row-${i}" class="ns-row${isExpanded ? ' ns-row-active' : ''}" onclick="toggleNSDetail(${i})" style="cursor:pointer;${rowOpacity}">`;
        html += `<td class="ns-idx-cell"><span class="ns-boot-btn${isBootNS ? ' boot-entry-active' : ''}" onclick="event.stopPropagation();setBootEntrySlot(${i})" title="${isBootNS ? 'Current boot entry' : 'Set as boot entry'}">${isBootNS ? '\u26a1' : i}</span></td>`;
        let nsLabelInner = e.label || '-';
        {
            const _reg = (abstractionRegistry && typeof abstractionRegistry.getAbstraction === 'function')
                ? abstractionRegistry
                : (sim && sim.abstractionRegistry && typeof sim.abstractionRegistry.getAbstraction === 'function' ? sim.abstractionRegistry : null);
            if (_reg) {
                const _nsAbs = _reg.getAbstraction(i);
                if (_nsAbs) {
                    const _nsProfile = (typeof _getAbstractionProfile === 'function') ? _getAbstractionProfile(_nsAbs) : (_nsAbs.profile || null);
                    if (_nsProfile === 'XC7A100T') {
                        nsLabelInner += ` <span class="ns-perm-chip">E</span><span class="abs-profile-badge profile-badge-xc7a100t" style="font-size:0.6rem;padding:1px 5px;vertical-align:middle;margin-left:3px;">XC7A100T</span>`;
                    } else if (_nsProfile === 'Full') {
                        nsLabelInner += ` <span class="abs-profile-badge profile-badge-full" style="font-size:0.6rem;padding:1px 5px;vertical-align:middle;margin-left:3px;">Full</span>`;
                    }
                }
            }
        }
        html += `<td class="ns-label" style="${warmStyle}" onmouseenter="showNSEntryTooltip(event,${i})" onmouseleave="hideNSEntryTooltip()">${nsLabelInner}</td>`;
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
        {
            const _srcLump = _findSrcLump(i, e.label);
            const _srcToken = _srcLump ? _srcLump.token : null;
            if (codeNotResident) {
                html += `<td class="ns-entry-actions"><span style="${warmStyle}">not resident</span></td>`;
            } else {
                const _srcBtn = _srcToken
                    ? ` <button class="btn btn-xs" onclick="event.stopPropagation();_openLumpSource('${_srcToken}')" style="background:#2d4a3e;color:#4ec9b0;border:1px solid rgba(78,201,176,0.35);" title="Open source in Repository view">Source</button>`
                    : '';
                html += `<td class="ns-entry-actions"><button class="btn btn-primary btn-xs" onclick="event.stopPropagation();exportEntryMemory(${i})">Export</button> <button class="btn btn-xs" onclick="event.stopPropagation();importEntryMemory(${i})" style="background:#3a86ff;color:#fff;border:none;">Import</button>${_srcBtn}</td>`;
            }
        }
        html += '</tr>';
        if (isExpanded) {
            html += `<tr class="ns-detail-row"><td colspan="10">`;
            html += `<div class="ns-detail-panel">`;
            html += `<div class="ns-detail-title">Memory at 0x${e.word0_location.toString(16).toUpperCase().padStart(4, '0')} \u2014 ${e.label || 'Slot '+i} (${lim.limit + 1} words)</div>`;
            html += renderMemoryDump(e.word0_location, lim.limit + 1, i);
            if (lim.clistCount > 0) {
                const _nsClistBase = (e.word0_location >>> 0) + lim.limit + 1 - lim.clistCount;
                const _hlSlot = window._pendingHighlightCListSlot;
                html += `<div class="ns-clist-section">`;
                html += `<div class="ns-clist-title">C-List &mdash; ${lim.clistCount} slot${lim.clistCount !== 1 ? 's' : ''} &mdash; base 0x${_nsClistBase.toString(16).toUpperCase().padStart(4,'0')}</div>`;
                html += `<table class="cr-table ns-clist-inline-table"><thead><tr>`;
                html += `<th>Slot</th><th>GT Word</th><th>NS Idx</th><th>Type</th><th>Pet Name</th></tr></thead><tbody>`;
                for (let _ci = 0; _ci < lim.clistCount; _ci++) {
                    const _cAddr = _nsClistBase + _ci;
                    const _cGT = (sim.memory && _cAddr < sim.memory.length) ? (sim.memory[_cAddr] >>> 0) : 0;
                    const _isHL = (_hlSlot === _ci);
                    const _isPend = (typeof ChurchSimulator !== 'undefined' && ChurchSimulator.isPendingGT) ? ChurchSimulator.isPendingGT(_cGT) : false;
                    const _hlCls = _isHL ? ' clist-pending-highlight' : '';
                    const _hlId  = _isHL ? ` id="ns-clist-pending-slot-${_ci}"` : '';
                    if (_isPend) {
                        const _pName = (typeof ChurchSimulator !== 'undefined' && ChurchSimulator.pendingGTName) ? ChurchSimulator.pendingGTName(_cGT) : `slot${_ci}`;
                        html += `<tr class="clist-pending-row${_hlCls}"${_hlId}>`;
                        html += `<td class="cr-idx">${_ci}</td>`;
                        html += `<td class="abs-clist-gt" style="color:#f59e0b;">0x${_cGT.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                        html += `<td>\u2014</td>`;
                        html += `<td><span class="clist-pending-type-badge">Pending</span></td>`;
                        html += `<td class="abs-clist-name" style="color:#f59e0b;">\u201C${_pName}\u201D <span class="clist-pending-badge-inline">\u26A1\u202FUnresolved</span></td>`;
                        html += `</tr>`;
                    } else {
                        const _cParsed = sim.parseGT(_cGT);
                        const _cLabel = (_cGT !== 0) ? ((sim.nsLabels && sim.nsLabels[_cParsed.index]) ? `NS[${_cParsed.index}] \u2014 ${sim.nsLabels[_cParsed.index]}` : `NS[${_cParsed.index}]`) : '\u2014';
                        html += `<tr class="${_isHL ? 'clist-pending-highlight' : ''}${_cGT !== 0 ? ' cr-active' : ''}"${_hlId}>`;
                        html += `<td class="cr-idx">${_ci}</td>`;
                        html += `<td class="abs-clist-gt">0x${_cGT.toString(16).toUpperCase().padStart(8,'0')}</td>`;
                        html += `<td>${_cGT !== 0 ? _cParsed.index : '\u2014'}</td>`;
                        html += `<td>${_cGT !== 0 ? _cParsed.typeName : '\u2014'}</td>`;
                        html += `<td class="abs-clist-name">${_cLabel}</td>`;
                        html += `</tr>`;
                    }
                }
                html += `</tbody></table></div>`;
            }
            html += `</div></td></tr>`;
        }
    }

    // Append virtual rows for board-specific abstraction slots not yet in the loaded namespace
    {
        // Static manifest of known board-specific slots (source of truth: abstractions.js)
        const _BOARD_SLOTS = [{ index: 51, name: 'Ethernet', profile: 'XC7A100T' }];
        const _nsMax = (sim && sim.nsCount != null) ? sim.nsCount : 0;

        // Try to get live data from the registry; fall back to static manifest
        let _boardAbs = [];
        const _reg = (abstractionRegistry && typeof abstractionRegistry.getAbstraction === 'function')
            ? abstractionRegistry
            : (sim && sim.abstractionRegistry && typeof sim.abstractionRegistry.getAbstraction === 'function' ? sim.abstractionRegistry : null);
        if (_reg && _reg.getAllAbstractions) {
            const _allAbs = _reg.getAllAbstractions();
            _boardAbs = _allAbs.filter(a => {
                const p = (typeof _getAbstractionProfile === 'function') ? _getAbstractionProfile(a) : (a.profile || null);
                return p && p !== 'IoT' && a.index >= _nsMax;
            });
        }
        if (_boardAbs.length === 0) {
            // Static fallback — always show known board-specific slots below loaded namespace
            _boardAbs = _BOARD_SLOTS.filter(s => s.index >= _nsMax);
        }

        if (_boardAbs.length > 0) {
            html += `<tr><td colspan="10" style="padding:4px 8px 2px;font-size:0.68rem;color:#6b7280;letter-spacing:0.05em;border-top:1px solid rgba(167,139,250,0.15);">BOARD-SPECIFIC SLOTS \u2014 not loaded in current boot profile</td></tr>`;
            for (const _bAbs of _boardAbs) {
                const _bp = (typeof _getAbstractionProfile === 'function' && _bAbs.profile !== undefined && typeof _bAbs.dispatch === 'undefined')
                    ? (_bAbs.profile || '')
                    : ((typeof _getAbstractionProfile === 'function') ? _getAbstractionProfile(_bAbs) : (_bAbs.profile || ''));
                const _bBadgeClass = _bp === 'XC7A100T' ? 'profile-badge-xc7a100t' : 'profile-badge-full';
                const _bLabelInner = `${_bAbs.name} <span class="ns-perm-chip">E</span><span class="abs-profile-badge ${_bBadgeClass}" style="font-size:0.6rem;padding:1px 5px;vertical-align:middle;margin-left:3px;">${_bp}</span>`;
                html += `<tr class="ns-row" style="opacity:0.55;cursor:default;" title="Not loaded in current board profile">`;
                html += `<td class="ns-idx-cell"><span class="ns-boot-btn">${_bAbs.index}</span></td>`;
                html += `<td class="ns-label">${_bLabelInner}</td>`;
                html += `<td style="color:#6b7280;font-family:monospace;font-size:0.7rem;" colspan="7">\u2014 slot reserved, ROM only in ${_bp} profile \u2014</td>`;
                html += `<td class="ns-entry-actions"><button class="btn btn-xs" onclick="showAbstractionDetail(${_bAbs.index})" style="background:#4b3f6b;color:#a78bfa;border:1px solid rgba(167,139,250,0.3);">Docs</button></td>`;
                html += `</tr>`;
            }
        }
    }

    html += '</tbody></table>';
    container.innerHTML = html;
}

// ── Memory dump view ──────────────────────────────────────────────────────────

window.memoryViewAddr = 0;

function _openLumpSource(token) {
    // Pass a pending-token and pending-tab to renderLumps() via window properties.
    // renderLumps() reads these after all auto-select logic runs, so the user's
    // explicit slot click always wins over the live CR14 auto-select.
    window._pendingLumpToken = token;
    window._pendingLumpTab = 'clooms';
    if (typeof switchView === 'function') switchView('lumps');
}

function jumpToMemory(addr) {
    if (isNaN(addr) || addr < 0) addr = 0;
    addr = addr >>> 0;
    window.memoryViewAddr = addr;
    const inp = document.getElementById('memAddrInput');
    if (inp) inp.value = '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
    switchView('memory');
}

// ── Pending Capability Navigation (Task #1528) ────────────────────────────────
// Called when the user clicks a "Pending" badge in the Dashboard info panel.
// Finds the NS entry whose lump contains the c-list slot, switches to the
// Namespace view, expands that row, and scrolls to/highlights the pending slot.
window._pendingHighlightCListSlot = null;

function _openPendingCListInNS(slotIdx) {
    if (!sim || !sim.bootComplete) return;

    // Resolve c-list base address: prefer the saved CR6 from the pending resolve
    // record (present when _lazySuspended is true), fall back to live CR6.
    let clistBase = null;
    if (sim._pendingResolves && sim._pendingResolves.has(slotIdx)) {
        const _ctx = sim._pendingResolves.get(slotIdx);
        if (_ctx.savedCRs && _ctx.savedCRs[6] && _ctx.savedCRs[6].word1) {
            clistBase = _ctx.savedCRs[6].word1 >>> 0;
        }
    }
    if (clistBase === null && sim.cr && sim.cr[6] && sim.cr[6].word1) {
        clistBase = sim.cr[6].word1 >>> 0;
    }
    // Also try irqState.waitingOnFlags to get c-list info from Scheduler suspend path
    if (clistBase === null) {
        const _wof = (sim.irqState && sim.irqState.waitingOnFlags) || {};
        for (const [, flag] of Object.entries(_wof)) {
            if (flag === `lazy_resolve:${slotIdx}` && sim.cr && sim.cr[6] && sim.cr[6].word1) {
                clistBase = sim.cr[6].word1 >>> 0;
                break;
            }
        }
    }

    // Search the NS table for the entry whose c-list region contains clistBase + slotIdx
    let targetNSIdx = -1;
    if (clistBase !== null && clistBase > 0) {
        const slotAddr = clistBase + slotIdx;
        for (let _ni = 0; _ni < sim.nsCount; _ni++) {
            const _ne = sim.readNSEntry(_ni);
            if (!_ne || !_ne.word0_location) continue;
            const _lumpBase = _ne.word0_location >>> 0;
            const _lim = sim.parseNSWord1(_ne.word1_limit);
            if (!_lim || _lim.clistCount === 0) continue;
            const _clistStart = _lumpBase + _lim.limit + 1 - _lim.clistCount;
            const _clistEnd   = _lumpBase + _lim.limit + 1;
            if (slotAddr >= _clistStart && slotAddr < _clistEnd) {
                targetNSIdx = _ni;
                break;
            }
        }
    }

    // Set the highlight slot so the c-list renderers can mark it
    window._pendingHighlightCListSlot = slotIdx;

    // Navigate to the Namespace view
    if (typeof switchView === 'function') switchView('namespace');

    if (targetNSIdx >= 0) {
        if (typeof nsExpandedSlot !== 'undefined') {
            nsExpandedSlot = targetNSIdx;
        } else {
            window.nsExpandedSlot = targetNSIdx;
        }
        if (typeof updateNamespace === 'function') updateNamespace();
        // Scroll the NS row into view and then scroll to the highlighted c-list slot
        setTimeout(() => {
            const _nsRow = document.getElementById('ns-row-' + targetNSIdx);
            if (_nsRow) _nsRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(() => {
                const _slotEl = document.getElementById('ns-clist-pending-slot-' + slotIdx)
                    || document.getElementById('clist-pending-slot-' + slotIdx);
                if (_slotEl) _slotEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 200);
        }, 100);
    } else if (typeof updateNamespace === 'function') {
        updateNamespace();
    }
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
        const ttProfileClass = ttProfile === 'Full' ? 'profile-badge-full' : ttProfile === 'XC7A100T' ? 'profile-badge-xc7a100t' : 'profile-badge-iot';
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

    const _ttSrcLump = _findSrcLump(idx, e.label);
    const _ttSrcToken = _ttSrcLump ? _ttSrcLump.token : null;
    if (_ttSrcToken && !codeNotResident) {
        html += `<div style="margin-top:0.5rem;text-align:right;"><a href="#" style="color:#4ec9b0;font-size:0.72rem;text-decoration:none;" onclick="event.preventDefault();hideNSEntryTooltip();_openLumpSource('${_ttSrcToken}')">View Source \u2192</a></div>`;
    }

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
    // Anchor to the left edge of the Location column — popup opens over Location, never hides Label
    const anchorX = anchorEl ? anchorEl.getBoundingClientRect().left : evt.clientX;
    let x = anchorX;
    let y = evt.clientY - th / 2;
    if (x + tw > vw - 8) x = vw - tw - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    if (y + th > vh - 8) y = vh - th - 8;
    tt.style.left = x + 'px';
    tt.style.top  = y + 'px';
}

function hideNSEntryTooltip() {
    const tt = document.getElementById('nsEntryTooltip');
    if (tt) tt.classList.remove('visible');
}

function toggleCRDetailMenu(evt) {
    const dd = document.getElementById('crdMenuDropdown');
    if (!dd) return;
    const isOpen = dd.style.display !== 'none' && dd.style.display !== '';
    if (isOpen) {
        dd.style.display = 'none';
    } else {
        dd.style.display = 'block';
        setTimeout(() => {
            document.addEventListener('click', _closeCRDetailMenuOnce, { once: true });
        }, 0);
    }
    if (evt) evt.stopPropagation();
}

function _closeCRDetailMenuOnce() {
    const dd = document.getElementById('crdMenuDropdown');
    if (dd) dd.style.display = 'none';
}

let selectedAbsIndex = null;
let absCollapsedLayers = {};
let bootEntrySlot = (() => { const s = parseInt(localStorage.getItem('bootEntrySlot'), 10); return Number.isFinite(s) ? Math.max(0, Math.min(255, s)) : 3; })();
let userMethodData = {};
let userMethodLists = {};

// ── Lump Compress ─────────────────────────────────────────────────────────
// Resizes the lump at nsIdx in simulator memory to its minimum power-of-2 size.
// Also trims trailing null (zero-word) c-list GTs that are not referenced by
// any instruction, reducing cc before computing the minimum size.
// After a successful shrink the lump is automatically saved to server/lumps/.
window.lumpCompress = async function(nsIdx) {
    const logEl = document.getElementById('crInjectLog');
    function log(msg) { if (logEl) { logEl.style.display = 'block'; logEl.textContent = msg; } }

    const nse = sim.readNSEntry(nsIdx);
    if (!nse) { log('No NS entry for slot ' + nsIdx); return; }
    const baseLoc = nse.word0_location >>> 0;
    if (baseLoc === 0 || baseLoc >= sim.memory.length) { log('Bad lump base address'); return; }

    const hdr = sim.parseLumpHeader(sim.memory[baseLoc] >>> 0);
    if (!hdr.valid) { log('No valid lump header at 0x' + baseLoc.toString(16)); return; }

    const { cw, typ, n_minus_6 } = hdr;
    let cc = hdr.cc;
    const currentSize = hdr.lumpSize;

    // ── Step 1: read c-list words from their current position ────────────────
    const clistWords = [];
    for (let i = 0; i < cc; i++) clistWords.push(sim.memory[baseLoc + currentSize - cc + i] >>> 0);

    // ── Step 2: trim trailing null GTs not referenced by any instruction ──────
    const { direct: refSlots, indirect: indSlots_lc } = _computeReferencedCListSlots(baseLoc + 1, cw);
    let trimmed = 0;
    while (cc > 0) {
        const slotIdx = cc - 1;
        if (clistWords[slotIdx] === 0 && !refSlots.has(slotIdx) && !indSlots_lc.has(slotIdx)) {
            clistWords.pop();
            cc--;
            trimmed++;
        } else {
            break;
        }
    }

    // ── Step 3: compute minimum lump size with effective cc ───────────────────
    let minSize = 64;
    while (minSize < (1 + cw + cc)) minSize <<= 1;

    const didShrink   = minSize < currentSize;
    const didTrim     = trimmed > 0;

    if (!didShrink && !didTrim) {
        log(`Already at minimum size (${currentSize}w = 1 hdr + ${cw}w code + ${hdr.cc} c-list + ${currentSize - 1 - cw - hdr.cc} free). No unused GT slots to trim.`);
        return;
    }

    let newNM6 = 0;
    while ((64 << newNM6) < minSize) newNM6++;

    // ── Step 4: write new header ──────────────────────────────────────────────
    sim.memory[baseLoc] = sim.packLumpHeader(newNM6, cw, cc, typ) >>> 0;

    // Zero freespace within new lump (code already in-place at [1..cw])
    for (let i = cw + 1; i < minSize - cc; i++) sim.memory[baseLoc + i] = 0;

    // Write c-list at new tail
    for (let i = 0; i < cc; i++) sim.memory[baseLoc + minSize - cc + i] = clistWords[i];

    // Zero freed trailing words
    for (let i = minSize; i < currentSize; i++) sim.memory[baseLoc + i] = 0;

    // ── Step 5: update NS entry word1 ─────────────────────────────────────────
    const nsBase = sim.NS_TABLE_BASE + nsIdx * sim.NS_ENTRY_WORDS;
    const oldW1  = sim.memory[nsBase + 1] >>> 0;
    const topBits = oldW1 & 0xFC000000;
    sim.memory[nsBase + 1] = (topBits | ((cc & 0x1FF) << 17) | ((minSize - 1) & 0x1FFFF)) >>> 0;

    const parts = [];
    if (didShrink) parts.push(`freespace ${currentSize - minSize}w removed (${currentSize}w \u2192 ${minSize}w)`);
    if (didTrim)   parts.push(`${trimmed} null GT${trimmed !== 1 ? 's' : ''} trimmed from c-list tail`);
    const _saveName  = (sim.nsLabels && sim.nsLabels[nsIdx]) || 'Unnamed';
    const _saveTitle = `Compress \u2014 NS${nsIdx} \u201C${_saveName}\u201D`;
    const _detail    = [
        parts.join('; '),
        '\u2139 Compress complete \u2014 click \u2193\u202FSave Lump to persist this lump to the repository.',
    ].filter(Boolean).join('\n');
    log(`Compressed NS${nsIdx}: ${parts.join('; ')}.`);
    updateCRDetail();
    if (typeof showPatchModal === 'function') showPatchModal(true, _saveTitle, _detail);
    if (typeof renderLumps   === 'function') renderLumps();
};

// ── Live Lump State Helper ──────────────────────────────────────────────────
// Reads CR14 from the running simulator and returns a plain descriptor for
// the lump currently loaded there, or null if the sim is not booted.
let _pendingLumpMeta = {};

function _getLiveLumpState() {
    if (!sim || !sim.bootComplete) return null;
    const cr14 = (typeof sim.getFormattedCR === 'function') ? sim.getFormattedCR(14) : null;
    if (!cr14 || cr14.isNull) return null;
    const nsIdx = cr14.gtIndex;
    if (nsIdx === undefined || nsIdx === null) return null;
    const nse = (typeof sim.readNSEntry === 'function') ? sim.readNSEntry(nsIdx) : null;
    if (!nse) return null;
    const baseLoc = nse.word0_location >>> 0;
    if (!baseLoc || baseLoc >= sim.memory.length) return null;
    const hdrWord = sim.memory[baseLoc] >>> 0;
    const hdr = (typeof sim.parseLumpHeader === 'function') ? sim.parseLumpHeader(hdrWord) : null;
    const absName = (sim.nsLabels && sim.nsLabels[nsIdx]) || 'Unnamed';

    // ── Bad magic — return partial state so the banner can surface the warning
    if (!hdr || !hdr.valid) {
        return {
            nsIdx, absName, baseLoc,
            lumpSize: null, cw: null, cc: null,
            sealOk: false, storedSeal: '????', expectedSeal: '????',
            warnings: [`BAD MAGIC: header=0x${hdrWord.toString(16).toUpperCase().padStart(8, '0')} (expected magic=0x1F)`],
            invalid: true,
        };
    }

    const sealOk = (typeof sim.validateMAC === 'function') ? sim.validateMAC(nse) : false;
    const lim = (typeof sim.parseNSWord1 === 'function') ? sim.parseNSWord1(nse.word1_limit) : { limit: 0 };
    const storedSeal = (nse.word2_seals & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
    const expectedSeal = (typeof sim.computeSeal === 'function')
        ? (sim.computeSeal(baseLoc, lim.limit) & 0xFFFF).toString(16).toUpperCase().padStart(4, '0')
        : '????';

    // ── Dry-run validation warnings ────────────────────────────────────────
    const warnings = [];
    if (hdr.cw < 1) {
        warnings.push('cw=0: lump must have at least one code word');
    }
    if (1 + hdr.cw + hdr.cc > hdr.lumpSize) {
        warnings.push(`BOUNDS: 1+cw+cc=${1 + hdr.cw + hdr.cc} exceeds lumpSize=${hdr.lumpSize}`);
    }
    if (!sealOk) {
        warnings.push(`SEAL FAIL: stored=0x${storedSeal} \u2260 computed=0x${expectedSeal}`);
    }
    if (hdr.cc > 0 && typeof sim.parseGT === 'function') {
        const clistBase = baseLoc + hdr.lumpSize - hdr.cc;
        const slot0gt   = sim.memory[clistBase] >>> 0;
        const parsed0   = sim.parseGT(slot0gt);
        if (parsed0 && parsed0.permissions) {
            const p = parsed0.permissions;
            const hasX = !!p.X;
            const onlyXrx = hasX && !p.W && !p.L && !p.S && !p.E;
            if (!onlyXrx) {
                const pStr = Object.entries(p).filter(([, v]) => v).map(([k]) => k).join('');
                warnings.push(`c-list[0] perm=${pStr || 'none'}: slot 0 must be X or RX only`);
            }
        }
    }

    return { nsIdx, absName, baseLoc, lumpSize: hdr.lumpSize, cw: hdr.cw, cc: hdr.cc, sealOk, storedSeal, expectedSeal, warnings };
}

// ── Lump Save (to server) ──────────────────────────────────────────────────
// Reads the current lump binary from simulator memory and POSTs it to
// /api/lumps/save, storing it as a named .lump file in server/lumps/.
window.lumpSaveLump = async function(nsIdx) {
    let absName = (sim.nsLabels && sim.nsLabels[nsIdx]) || 'Unnamed';
    const _meta = _pendingLumpMeta || {};
    _pendingLumpMeta = {};
    if (_meta.name) absName = _meta.name;
    const opName  = `Save Lump \u2014 NS${nsIdx} \u201C${absName}\u201D`;
    const checks  = [];   // collected validation lines shown before save
    let   failed  = false;

    // ── 1. NS entry ────────────────────────────────────────────────────────
    const nse = sim.readNSEntry(nsIdx);
    if (!nse) {
        if (typeof showPatchModal === 'function')
            showPatchModal(false, opName, `NS slot ${nsIdx}: no entry in namespace table.`);
        return;
    }
    checks.push(`NS${nsIdx}  word0=0x${(nse.word0_location>>>0).toString(16).toUpperCase().padStart(8,'0')}` +
                `  word1=0x${(nse.word1_limit>>>0).toString(16).toUpperCase().padStart(8,'0')}` +
                `  word2=0x${(nse.word2_seals>>>0).toString(16).toUpperCase().padStart(8,'0')}`);

    // ── 2. Base address ────────────────────────────────────────────────────
    const baseLoc = nse.word0_location >>> 0;
    if (baseLoc === 0 || baseLoc >= sim.memory.length) {
        if (typeof showPatchModal === 'function')
            showPatchModal(false, opName, `Bad lump base address: 0x${baseLoc.toString(16)}`);
        return;
    }
    checks.push(`base=0x${baseLoc.toString(16).toUpperCase().padStart(4,'0')}`);

    // ── 3. Lump header magic ───────────────────────────────────────────────
    const hdr = sim.parseLumpHeader(sim.memory[baseLoc] >>> 0);
    if (!hdr.valid) {
        checks.push(`\u2717 BAD MAGIC: header word 0x${(sim.memory[baseLoc]>>>0).toString(16).toUpperCase().padStart(8,'0')} (expected magic=0x1F)`);
        if (typeof showPatchModal === 'function') showPatchModal(false, opName, checks.join('\n'));
        return;
    }
    checks.push(`\u2713 magic=0x1F  lumpSize=${hdr.lumpSize}  cw=${hdr.cw}  cc=${hdr.cc}  typ=${hdr.typ}`);

    // ── 4. Lump bounds (cw + cc + 1 ≤ lumpSize) ───────────────────────────
    if (hdr.cw < 1) {
        checks.push('\u2717 cw=0: lump must have at least one code word.');
        failed = true;
    } else {
        checks.push(`\u2713 cw=${hdr.cw} \u2265 1`);
    }
    if (1 + hdr.cw + hdr.cc > hdr.lumpSize) {
        checks.push(`\u2717 BOUNDS: 1+cw+cc = ${1+hdr.cw+hdr.cc} exceeds lumpSize=${hdr.lumpSize}`);
        failed = true;
    } else {
        checks.push(`\u2713 1+cw+cc=${1+hdr.cw+hdr.cc} \u2264 lumpSize=${hdr.lumpSize}`);
    }

    // ── 5. SEAL (version-seal CRC check) ──────────────────────────────────
    const sealOk = sim.validateMAC(nse);
    const storedSeal   = (nse.word2_seals & 0xFFFF).toString(16).toUpperCase().padStart(4,'0');
    const lim          = sim.parseNSWord1(nse.word1_limit);
    const expectedSeal = (sim.computeSeal(baseLoc, lim.limit) & 0xFFFF).toString(16).toUpperCase().padStart(4,'0');
    if (sealOk) {
        checks.push(`\u2713 SEAL OK: stored=0x${storedSeal}  computed=0x${expectedSeal}  limit17=${lim.limit}`);
    } else {
        checks.push(`\u2717 SEAL FAIL: stored=0x${storedSeal} \u2260 computed=0x${expectedSeal}  limit17=${lim.limit}`);
        failed = true;
    }

    if (failed) {
        if (typeof showPatchModal === 'function') showPatchModal(false, opName, checks.join('\n'));
        return;
    }

    // ── 6. Lump construction test: all c-list slot refs must be in-bounds ──
    // Encoding: opcode=[31:27], crSrc=[18:15], slot=[14:0]
    // LOAD=0 SAVE=1 ELOADCALL=8 XLOADLAMBDA=9 each read from crSrc=6 (CR6 = c-list root).
    // If any slot operand >= cc the code was assembled against a different c-list
    // layout than the one recorded in the lump header — saving would produce a
    // lump that faults at runtime.  Catch it here before touching disk.
    if (hdr.cc > 0) {
        const _CLIST_OPS = new Set([0, 1, 8, 9]);
        let _clistOk = true;
        for (let _wi = 1; _wi <= hdr.cw; _wi++) {
            const _ww    = (sim.memory[baseLoc + _wi] >>> 0);
            const _op    = (_ww >>> 27) & 0x1F;
            const _crSrc = (_ww >>> 15) & 0xF;
            const _slot  = _ww & 0x7FFF;
            if (_CLIST_OPS.has(_op) && _crSrc === 6 && _slot >= hdr.cc) {
                checks.push(
                    `\u2717 LUMP CONSTRUCTION ERROR: code[${_wi}]=0x${_ww.toString(16).toUpperCase().padStart(8,'0')} ` +
                    `references c-list slot ${_slot} but cc=${hdr.cc} (valid: 0\u2013${hdr.cc - 1}). ` +
                    `Re-run POLA or reset cc before saving.`
                );
                failed = true;
                _clistOk = false;
                break;
            }
        }
        if (_clistOk) checks.push(`\u2713 c-list: all code slot refs < cc=${hdr.cc}`);
    } else {
        checks.push(`\u2139 c-list: cc=0 (LAZY injection will supply c-list at runtime)`);
    }

    if (failed) {
        if (typeof showPatchModal === 'function') showPatchModal(false, opName, checks.join('\n'));
        return;
    }

    // ── 6b. Pet Name Audit ─────────────────────────────────────────────────
    // Verify every occupied c-list slot has a canonical name and every Church
    // instruction (LOAD/SAVE/ELOADCALL/XLOADLAMBDA) via CR6 references a
    // non-null, named capability.  Soft warnings do not block the save;
    // a null-GT fault (ok=false) does.
    {
        const _pnaWords = [];
        for (let i = 0; i < hdr.lumpSize; i++) _pnaWords.push(sim.memory[baseLoc + i] >>> 0);
        const _pnaResult = (typeof petNameAudit === 'function') ? petNameAudit(
            _pnaWords,
            { cw: hdr.cw, cc: hdr.cc, lumpSize: hdr.lumpSize },
            (sim && sim.nsLabels) || {},
            (typeof assembler !== 'undefined' && assembler && assembler.nsSymbols)
                ? assembler.nsSymbols : {}
        ) : null;
        if (_pnaResult) {
            for (const l of _pnaResult.lines) checks.push(l);
            if (!_pnaResult.ok) {
                failed = true;
                if (typeof showPatchModal === 'function') showPatchModal(false, opName, checks.join('\n'));
                return;
            }
        }
    }

    // ── 7. All checks passed — write to repository ─────────────────────────
    checks.push(`\u2139 All checks passed. Saving ${hdr.lumpSize}-word lump\u2026`);
    const words = [];
    for (let i = 0; i < hdr.lumpSize; i++) words.push(sim.memory[baseLoc + i] >>> 0);
    const typeNames = ['code', 'namespace', 'thread', 'outform'];
    const metadata = {
        abstraction: absName,
        ns_slot:     nsIdx,
        content_type: typeNames[hdr.typ] || 'code',
        cw:          hdr.cw,
        cc:          hdr.cc,
        lump_size:   hdr.lumpSize,
    };
    if (_meta.version) metadata.version = _meta.version;
    try {
        const resp = await fetch('/api/lumps/save', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ binary: words, metadata }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Server error');
        const biLine = data.boot_image_refreshed
            ? '\u2713 boot-image.bin refreshed \u2014 change persists on reboot'
            : data.boot_image_note
            ? `\u26A0 boot image not updated: ${data.boot_image_note}`
            : '';
        checks.push(`\u2713 Saved \u2014 token: ${data.token}`);
        if (data.lump_path)  checks.push(data.lump_path);
        if (biLine)          checks.push(biLine);
        if (typeof showPatchModal === 'function') showPatchModal(true, opName, checks.join('\n'));
        if (typeof renderLumps   === 'function') renderLumps();
    } catch (e) {
        checks.push(`\u2717 Save failed: ${e.message}`);
        if (typeof showPatchModal === 'function') showPatchModal(false, opName, checks.join('\n'));
    }
};

window.__crdToggleFaultDetail = function(detailRowId, summaryRow) {
    const detailRow = document.getElementById(detailRowId);
    if (!detailRow) return;
    const isOpen = detailRow.style.display !== 'none';
    detailRow.style.display = isOpen ? 'none' : '';
    if (summaryRow) {
        summaryRow.classList.toggle('expanded', !isOpen);
    }
};

// ── C-List static analysis helpers ─────────────────────────────────────────

// Scan the code words at [codeBase .. codeBase+codeCount-1] and return
// { direct, indirect, clobberWarnings } where:
//   direct          — Set of c-list row indices referenced by LOAD/SAVE/ELOADCALL/
//                     XLOADLAMBDA instructions whose crSrc field is 6 (CR6 = c-list root).
//   indirect        — Set of c-list row indices reached via a CR alias: a register
//                     that was loaded from CR6 (or transitively from another alias)
//                     and has not since been clobbered by a LOAD from a non-alias source.
//                     Chained aliases (CR2 ← CR1, CR1 ← CR6[n]) are also tracked.
//   clobberWarnings — Array of { word, cr, prevAliasedAtWord } entries emitted when a
//                     LOAD overwrites a previously-aliased CR with an unrelated value.
//                     prevAliasedAtWord is -1 when the alias entered the block from a
//                     predecessor (back-edge or merge).  Callers may surface these as
//                     notes to the user.
// Slots absent from both direct and indirect are candidates for POLA removal.
//
// Algorithm overview:
//   The function uses a basic-block CFG with an iterative worklist (fixpoint) to
//   propagate alias information across back-edges.  This makes alias tracking
//   accurate inside loops: an alias established in one iteration of a loop body is
//   visible to earlier instructions in the next iteration.
//
//   Phase 1 — Identify basic-block entry points by scanning for BRANCH (opcode 17)
//              instructions; branch targets and fall-through successors start new
//              blocks.
//   Phase 2 — Build the CFG successor list for each block.
//   Phase 3 — Fixpoint: propagate CR alias bitmasks (one bit per CR 0-15) across
//              the CFG using a worklist until the entry alias set of every block
//              stabilises.  The alias bitmask is a 16-bit integer; a 1 in bit n
//              means CRn currently holds a c-list capability.
//   Phase 4 — Final collection pass: walk each block using its fixpoint entry
//              alias mask and accumulate direct / indirect / clobberWarnings.
//
// Opcodes that use crSrc as a c-list base and may write crDst:
//   0 = LOAD  crDst ← memory[crSrc + imm]   (crSrc is address base; writes crDst)
//   1 = SAVE  memory[crSrc + imm] ← crDst   (crSrc is address base; crDst not written)
//   8 = ELOADCALL                            (crSrc is the c-list base; not written)
//   9 = XLOADLAMBDA                          (crSrc is the c-list base; not written)
// Only LOAD (opcode 0) modifies crDst as a register; the others only dereference crSrc.
function _computeReferencedCListSlots(codeBase, codeCount) {
    const BRANCH_OPCODE = 17;

    // ── Phase 1: Collect basic-block entry points ─────────────────────────────
    // Word 0 always starts a block.  Every branch target and every fall-through
    // successor (word after a branch) also starts a block.

    const blockStartSet = new Set([0]);
    for (let w = 0; w < codeCount; w++) {
        const addr = codeBase + w;
        if (addr >= sim.memory.length) break;
        const word   = sim.memory[addr] >>> 0;
        const opcode = (word >>> 27) & 0x1F;
        if (opcode === BRANCH_OPCODE) {
            if (w + 1 < codeCount) blockStartSet.add(w + 1);
            let off = word & 0x7FFF;
            if (off & 0x4000) off = off - 0x8000; // sign-extend 15-bit
            const target = w + off;
            if (target >= 0 && target < codeCount) blockStartSet.add(target);
        }
    }

    const sortedStarts = Array.from(blockStartSet).sort((a, b) => a - b);
    const numBlocks    = sortedStarts.length;

    // Build word → block-index map.
    const wordToBlock = new Int32Array(codeCount).fill(-1);
    for (let bi = 0; bi < numBlocks; bi++) {
        const start = sortedStarts[bi];
        const end   = bi + 1 < numBlocks ? sortedStarts[bi + 1] : codeCount;
        for (let w = start; w < end; w++) wordToBlock[w] = bi;
    }

    // ── Phase 2: Build successor lists ───────────────────────────────────────
    const successors = [];
    for (let bi = 0; bi < numBlocks; bi++) {
        successors.push([]);
        const start = sortedStarts[bi];
        const end   = bi + 1 < numBlocks ? sortedStarts[bi + 1] : codeCount;
        let hasBranch = false;
        for (let w = start; w < end; w++) {
            const addr = codeBase + w;
            if (addr >= sim.memory.length) break;
            const word   = sim.memory[addr] >>> 0;
            const opcode = (word >>> 27) & 0x1F;
            if (opcode === BRANCH_OPCODE) {
                hasBranch = true;
                // Fall-through successor.
                if (w + 1 < codeCount) {
                    const ft = wordToBlock[w + 1];
                    if (ft !== -1 && !successors[bi].includes(ft)) successors[bi].push(ft);
                }
                // Branch-target successor.
                let off = word & 0x7FFF;
                if (off & 0x4000) off = off - 0x8000;
                const target = w + off;
                if (target >= 0 && target < codeCount) {
                    const tb = wordToBlock[target];
                    if (tb !== -1 && !successors[bi].includes(tb)) successors[bi].push(tb);
                }
            }
        }
        if (!hasBranch && bi + 1 < numBlocks) {
            successors[bi].push(bi + 1);
        }
    }

    // ── Phase 3: Fixpoint over alias bitmasks ────────────────────────────────
    // inAliases[bi]  = bitmask of CRs known to hold a c-list cap at block entry.
    // outAliases[bi] = bitmask of CRs holding a c-list cap at block exit.
    // We use a "may" (union) join — if a CR is aliased on any incoming path it is
    // treated as aliased at the merge point.
    const inAliases  = new Uint32Array(numBlocks);
    const outAliases = new Uint32Array(numBlocks);

    function blockExitMask(bi, entryMask) {
        const start = sortedStarts[bi];
        const end   = bi + 1 < numBlocks ? sortedStarts[bi + 1] : codeCount;
        let mask = entryMask >>> 0;
        for (let w = start; w < end; w++) {
            const addr = codeBase + w;
            if (addr >= sim.memory.length) break;
            const word   = sim.memory[addr] >>> 0;
            const opcode = (word >>> 27) & 0x1F;
            if (opcode === 0 || opcode === 1 || opcode === 8 || opcode === 9) {
                const crDst = (word >>> 19) & 0xF;
                const crSrc = (word >>> 15) & 0xF;
                if (crSrc === 6) {
                    if (opcode === 0) mask = (mask | (1 << crDst)) >>> 0;
                } else if (mask & (1 << crSrc)) {
                    if (opcode === 0) mask = (mask | (1 << crDst)) >>> 0;
                } else if (opcode === 0) {
                    mask = (mask & ~(1 << crDst)) >>> 0; // clobber
                }
            }
        }
        return mask;
    }

    // Initialise worklist with all blocks.
    const inWorklist = new Uint8Array(numBlocks).fill(1);
    const worklist   = Array.from({length: numBlocks}, (_, i) => i);

    while (worklist.length > 0) {
        const bi    = worklist.shift();
        inWorklist[bi] = 0;
        const newOut = blockExitMask(bi, inAliases[bi]);
        if (newOut !== outAliases[bi]) {
            outAliases[bi] = newOut;
            for (const succ of successors[bi]) {
                const newIn = (inAliases[succ] | newOut) >>> 0;
                if (newIn !== inAliases[succ]) {
                    inAliases[succ] = newIn;
                    if (!inWorklist[succ]) {
                        inWorklist[succ] = 1;
                        worklist.push(succ);
                    }
                }
            }
        }
    }

    // ── Phase 4: Final collection pass ───────────────────────────────────────
    // Walk each block using its fixpoint entry alias mask, collecting direct /
    // indirect slot references and clobber warnings.
    const direct          = new Set();
    const indirect        = new Set();
    const clobberWarnings = [];

    for (let bi = 0; bi < numBlocks; bi++) {
        const start = sortedStarts[bi];
        const end   = bi + 1 < numBlocks ? sortedStarts[bi + 1] : codeCount;
        let aliasMask = inAliases[bi] >>> 0;

        // Track the word index where each CR was most recently aliased within
        // this block.  -1 means the alias arrived from a predecessor block.
        const aliasOrigin = {};
        for (let cr = 0; cr < 16; cr++) {
            if (aliasMask & (1 << cr)) aliasOrigin[cr] = -1;
        }

        for (let w = start; w < end; w++) {
            const addr = codeBase + w;
            if (addr >= sim.memory.length) break;
            const word   = sim.memory[addr] >>> 0;
            const opcode = (word >>> 27) & 0x1F;
            const crDst  = (word >>> 19) & 0xF;
            const crSrc  = (word >>> 15) & 0xF;
            const imm    = word & 0x7FFF;

            if (opcode === 0 || opcode === 1 || opcode === 8 || opcode === 9) {
                if (crSrc === 6) {
                    // Direct access via CR6 (c-list root).
                    direct.add(imm);
                    if (opcode === 0) {
                        aliasMask = (aliasMask | (1 << crDst)) >>> 0;
                        aliasOrigin[crDst] = w;
                    }
                } else if (aliasMask & (1 << crSrc)) {
                    // Indirect access via an aliased CR.
                    if (!direct.has(imm)) indirect.add(imm);
                    if (opcode === 0) {
                        // Chained alias: crDst now holds a transitive c-list cap.
                        aliasMask = (aliasMask | (1 << crDst)) >>> 0;
                        aliasOrigin[crDst] = w;
                    }
                } else if (opcode === 0) {
                    // LOAD from a non-alias source: crDst is clobbered.
                    if (aliasMask & (1 << crDst)) {
                        const prev = (aliasOrigin[crDst] !== undefined) ? aliasOrigin[crDst] : -1;
                        clobberWarnings.push({ word: w, cr: crDst, prevAliasedAtWord: prev });
                        aliasMask = (aliasMask & ~(1 << crDst)) >>> 0;
                        delete aliasOrigin[crDst];
                    }
                }
            }
        }
    }

    return { direct, indirect, clobberWarnings };
}

// Zero a single c-list row in simulator memory (marks the GT as null/empty).
// Called by the "× zero" button in the C-List panel.
function zeroLumpSlot(addr) {
    if (!sim || addr < 0 || addr >= sim.memory.length) return;
    sim.memory[addr] = 0;
    updateCRDetail();
}

// Zero all unreferenced (non-null) GT slots in the c-list of NS[nsIdx].
// Implements Principle of Least Authority: every GT that no instruction
// references via CR6 is cleared, minimising ambient authority. After zeroing,
// trailing null slots become eligible for removal by lumpCompress().
window.zeroAllUnrefSlots = function(nsIdx) {
    if (!sim) return;
    const nse = sim.readNSEntry(nsIdx);
    if (!nse) return;
    const baseLoc = nse.word0_location >>> 0;
    if (baseLoc === 0 || baseLoc >= sim.memory.length) return;
    const hdr = sim.parseLumpHeader(sim.memory[baseLoc] >>> 0);
    if (!hdr.valid || hdr.cc === 0) return;

    const clistBase = baseLoc + hdr.lumpSize - hdr.cc;
    const { direct: refSlots, indirect: indSlots } = _computeReferencedCListSlots(baseLoc + 1, hdr.cw);

    let zeroed = 0;
    let preserved = 0;
    for (let i = 0; i < hdr.cc; i++) {
        const addr = clistBase + i;
        if ((sim.memory[addr] >>> 0) !== 0) {
            if (refSlots.has(i) || indSlots.has(i)) continue;
            sim.memory[addr] = 0;
            zeroed++;
        }
    }
    preserved = indSlots.size;

    updateCRDetail();

    const absName = (sim.nsLabels && sim.nsLabels[nsIdx]) || 'Unnamed';
    if (typeof showPatchModal === 'function') {
        const indNote = preserved > 0 ? `\n\u26A0 ${preserved} indirect slot${preserved !== 1 ? 's' : ''} preserved (accessed via a loaded register).` : '';
        showPatchModal(
            zeroed > 0,
            `POLA \u2014 NS${nsIdx} \u201C${absName}\u201D`,
            zeroed > 0
                ? `Zeroed ${zeroed} unreferenced GT slot${zeroed !== 1 ? 's' : ''}.\nUse \u2913\u202FCompress to shrink the lump.${indNote}`
                : `No unreferenced GT slots found \u2014 already minimal authority.${indNote}`
        );
    }
};

// ── C-List POLA Optimizer ──────────────────────────────────────────────────
// Single async pipeline triggered by the "⚡ Apply POLA" button:
//   1. Zero every non-null GT that is neither directly referenced via CR6 nor
//      indirectly referenced via a register that was loaded from CR6 (dataflow).
//   2. If indirect slots exist: save zeroing results and stop — compaction is
//      unsafe because non-CR6 instructions cannot be auto-rewritten.
//   3. Otherwise pack remaining non-null GTs to consecutive low slot indices.
//   4. Rewrite LOAD/SAVE/ELOADCALL/XLOADLAMBDA instruction words where crSrc=6
//      to use the new slot index: (word & 0xFFFF8000) | (newSlot & 0x7FFF).
//   5. Update lump header cc + NS entry word1.
//   6. Auto-save to server/lumps/ and show a patch-modal with full report.
window.applyPOLA = async function(nsIdx) {
    if (!sim) return;
    const nse = sim.readNSEntry(nsIdx);
    if (!nse) return;
    const baseLoc = nse.word0_location >>> 0;
    if (baseLoc === 0 || baseLoc >= sim.memory.length) return;
    const hdr = sim.parseLumpHeader(sim.memory[baseLoc] >>> 0);
    if (!hdr.valid || hdr.cc === 0) {
        if (typeof showPatchModal === 'function') showPatchModal(false, `POLA \u2014 NS${nsIdx}`, 'No valid c-list to optimize.');
        return;
    }

    const { cw, cc, typ, n_minus_6, lumpSize } = hdr;
    const clistBase = baseLoc + lumpSize - cc;
    const absName   = (sim.nsLabels && sim.nsLabels[nsIdx]) || 'Unnamed';
    const title     = `\u26A1 Apply POLA \u2014 NS${nsIdx} \u201C${absName}\u201D`;

    // ── Step 1: read current c-list words ──────────────────────────────────
    const oldGTs = [];
    for (let i = 0; i < cc; i++) oldGTs.push(sim.memory[clistBase + i] >>> 0);

    // ── Step 2: compute slots referenced via CR6 and via alias registers ──
    const { direct: refSlots, indirect: indSlots } = _computeReferencedCListSlots(baseLoc + 1, cw);

    // ── Step 3: zero unreferenced non-null GTs (skip indirect slots) ───────
    let zeroedCount = 0;
    const zeroedLog = [];
    for (let i = 0; i < cc; i++) {
        if (oldGTs[i] !== 0 && !refSlots.has(i) && !indSlots.has(i)) {
            const _pg = sim.parseGT(oldGTs[i]);
            const _pn = (_pg && sim.nsLabels && sim.nsLabels[_pg.index]) ? sim.nsLabels[_pg.index] : `GT@slot${i}`;
            zeroedLog.push(`  slot ${i} \u201C${_pn}\u201D (unreferenced)`);
            oldGTs[i] = 0;
            sim.memory[clistBase + i] = 0;
            zeroedCount++;
        }
    }

    // ── Step 4a: if any indirect slots exist, skip compaction ──────────────
    // Null-gap compaction shifts slot indices. Non-CR6 instructions that access
    // c-list via an alias register cannot be auto-rewritten, so compaction when
    // indirect slots are present would silently corrupt those accesses.
    // Safe strategy: zero unreferenced slots (step 3 above), report, save, stop.
    if (indSlots.size > 0) {
        updateCRDetail();
        const logLines0 = [];
        if (zeroedCount > 0) {
            logLines0.push(`Zeroed ${zeroedCount} unreferenced GT slot${zeroedCount !== 1 ? 's' : ''}:`);
            logLines0.push(...zeroedLog);
        } else {
            logLines0.push('No unreferenced GT slots found \u2014 nothing to zero.');
        }
        logLines0.push(`\u26A0 Compaction skipped: ${indSlots.size} indirect slot${indSlots.size !== 1 ? 's' : ''} detected (accessed via a register loaded from CR6).`);
        logLines0.push('  Null-gap compaction cannot safely rewrite non-CR6 instructions.');
        logLines0.push('  Resolve indirect accesses first, then re-run POLA.');
        for (const s of [...indSlots].sort((a, b) => a - b)) {
            const _pgInd = sim.parseGT(oldGTs[s] || 0);
            const _pnInd = (_pgInd && sim.nsLabels && sim.nsLabels[_pgInd.index]) ? sim.nsLabels[_pgInd.index] : `slot${s}`;
            logLines0.push(`  \u26A0 indirect: slot ${s} \u201C${_pnInd}\u201D`);
        }
        if (zeroedCount > 0)
            logLines0.push('\u2139 Zeroing complete \u2014 click \u2193\u202FSave Lump to persist this lump to the repository.');
        if (typeof showPatchModal === 'function') showPatchModal(true, title, logLines0.join('\n'));
        if (typeof renderLumps === 'function') renderLumps();
        return;
    }

    // ── Step 4b: build compacted list and old→new slot mapping ────────────
    // (Only reached when indSlots is empty — safe to move all surviving slots.)
    const newGTs   = [];
    const oldToNew = new Map();
    for (let i = 0; i < cc; i++) {
        if (oldGTs[i] !== 0) {
            oldToNew.set(i, newGTs.length);
            newGTs.push(oldGTs[i]);
        }
    }
    const newCC = newGTs.length;

    // ── Step 4c: update assembler.nsSymbols for Abstract LED GTs ───────────
    // Abstract GT:      type bits [24:23] = 0b11
    // AB_TYPE_IO:       bits [31:27] = 0x00
    // DEVICE_CLASS_LED: bits [15:8]  = 0x01
    // device_data:      bits [7:0]   = LED index (0–5)
    const ledRemappings = [];
    for (let i = 0; i < cc; i++) {
        const gt = oldGTs[i];
        if (gt === 0) continue;
        if (((gt >>> 23) & 0x3) === 3 &&
            ((gt >>> 27) & 0x1F) === 0 &&
            ((gt >>> 8) & 0xFF) === 1) {
            const deviceData = gt & 0xFF;
            if (deviceData >= 0 && deviceData <= 5 && oldToNew.has(i)) {
                const newSlot = oldToNew.get(i);
                const key = 'LED' + deviceData;
                if (typeof assembler !== 'undefined' && assembler && assembler.nsSymbols) {
                    assembler.nsSymbols[key] = newSlot;
                }
                // Persist to the shared class-level map so every future ChurchAssembler
                // instance (including those created in flushAsmBlock during compilePetName)
                // inherits the correct POLA-compacted slot rather than the stale boot default.
                if (typeof ChurchAssembler !== 'undefined') {
                    ChurchAssembler._sharedNsSymbols = ChurchAssembler._sharedNsSymbols || {};
                    ChurchAssembler._sharedNsSymbols[key] = newSlot;
                }
                if (newSlot !== i) {
                    ledRemappings.push(`  ${key}: slot ${i} \u2192 ${newSlot}`);
                }
            }
        }
    }

    // Early exit if nothing changed
    if (zeroedCount === 0 && newCC === cc) {
        if (typeof showPatchModal === 'function')
            showPatchModal(true, title, 'C-list is already compact \u2014 no unreferenced GTs, no null gaps.');
        return;
    }

    // ── Step 5: rewrite LOAD/SAVE/ELOADCALL/XLOADLAMBDA via CR6 ───────────
    let rewriteCount = 0;
    const indirectWarnings = [];
    for (let w = 0; w < cw; w++) {
        const addr = baseLoc + 1 + w;
        if (addr >= sim.memory.length) break;
        const word    = sim.memory[addr] >>> 0;
        const opcode  = (word >>> 27) & 0x1F;
        const crSrcW  = (word >>> 15) & 0xF;
        const oldSlot = word & 0x7FFF;
        if ((opcode === 0 || opcode === 1 || opcode === 8 || opcode === 9) && crSrcW === 6) {
            if (oldToNew.has(oldSlot)) {
                const newSlot = oldToNew.get(oldSlot);
                if (newSlot !== oldSlot) {
                    sim.memory[addr] = ((word & 0xFFFF8000) | (newSlot & 0x7FFF)) >>> 0;
                    rewriteCount++;
                }
            }
        }
    }
    // Flag ALL instructions with crSrc != 6 whose slot was moved — indSlots is
    // empty here, so every such instruction is a genuinely untracked indirect.
    for (let w = 0; w < cw; w++) {
        const addr = baseLoc + 1 + w;
        if (addr >= sim.memory.length) break;
        const word2   = sim.memory[addr] >>> 0;
        const opcode2 = (word2 >>> 27) & 0x1F;
        const crSrc2  = (word2 >>> 15) & 0xF;
        const slot2   = word2 & 0x7FFF;
        if ((opcode2 === 0 || opcode2 === 1 || opcode2 === 8 || opcode2 === 9) && crSrc2 !== 6) {
            if (oldToNew.has(slot2) && oldToNew.get(slot2) !== slot2) {
                const newSlot2 = oldToNew.get(slot2);
                const _pgI = sim.parseGT(newGTs[newSlot2]);
                const _pnI = (_pgI && sim.nsLabels && sim.nsLabels[_pgI.index]) ? sim.nsLabels[_pgI.index] : `slot${slot2}`;
                indirectWarnings.push(`  code[${w}] slot ${slot2}\u2192${newSlot2} \u201C${_pnI}\u201D (crSrc=CR${crSrc2}, not rewritten)`);
            }
        }
    }

    // ── Step 5.5: sync assembly source text in editor ──────────────────────
    // Mirrors assembler._assembleLine() tokenisation exactly:
    //   · comment stripping: sequential ';' then '--' then '//' (not first-match)
    //   · normalise brackets/commas → spaces, then split on whitespace
    // Covers all valid source forms:
    //   · 3-operand explicit: LOAD CRd, CR6, slot  (or 6, 0x6, .pet alias)
    //   · bracket/disasm:     LOAD CRd, CR6[0x0003]
    //   · condition suffixes: LOADNE, ELOADCALLGT, …  (no dot)
    //   · decimal/hex/binary immediates with optional # or + prefix
    //   · 2-operand NS shorthand: LOAD CRd, Name → expanded to LOAD CRd, CR6, newSlot
    const changedSourceLines = [];
    const _asmEd = document.getElementById('asmEditor');
    if (typeof _highlightPolaChangedLines === 'function') _highlightPolaChangedLines([]);
    if (_asmEd && oldToNew.size > 0) {
        const _targetOps = new Set(['LOAD', 'SAVE', 'ELOADCALL', 'XLOADLAMBDA']);
        const _condSet   = new Set(['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE','AL','NV','HS','LO']);

        const _srcLines = _asmEd.value.split('\n');

        // Pre-scan source for .pet <alias> CR6 declarations (case-sensitive alias names)
        const _cr6Pets = new Set();
        for (const _sl of _srcLines) {
            let _pl = _sl.trim();
            let _ci = _pl.indexOf(';');  if (_ci >= 0) _pl = _pl.slice(0, _ci).trim();
            let _di = _pl.indexOf('--'); if (_di >= 0) _pl = _pl.slice(0, _di).trim();
            let _si = _pl.indexOf('//'); if (_si >= 0) _pl = _pl.slice(0, _si).trim();
            const _pm = _pl.match(/^\.pet\s+([A-Za-z_][A-Za-z0-9_]*)\s+CR6\s*$/i);
            if (_pm) _cr6Pets.add(_pm[1]);
        }

        // Resolve a register token to its index, including .pet CR6 aliases
        const _parseRegIdx = tok => {
            const u = tok.toUpperCase();
            const cm = u.match(/^CR(\d+)$/);        if (cm) return parseInt(cm[1]);
            const hm = u.match(/^0X([0-9A-F]+)$/); if (hm) return parseInt(hm[1], 16);
            const dm = u.match(/^(\d+)$/);          if (dm) return parseInt(dm[1]);
            if (_cr6Pets.has(tok)) return 6;        // case-sensitive alias
            return -1;
        };

        // Parse an immediate token (matches assembler._parseImm minus label lookup)
        const _parseImm = tok => {
            const s = tok.replace(/^[#+]/, '');
            if (/^0[xX][0-9A-Fa-f]+$/.test(s)) return parseInt(s, 16);
            if (/^0[bB][01]+$/.test(s))         return parseInt(s.slice(2), 2);
            if (/^\d+$/.test(s))                return parseInt(s, 10);
            return NaN;
        };

        // NS symbol table for resolving 2-operand shorthand (name → old c-list row)
        const _nsSyms = (typeof assembler !== 'undefined' && assembler && assembler.nsSymbols)
            ? assembler.nsSymbols
            : ((typeof ChurchAssembler !== 'undefined' && ChurchAssembler._sharedNsSymbols) || {});

        // Track which abstraction names are currently bound to CR6 via 2-operand
        // LOAD (simulates assembler.nsLoaded for CR6, updated sequentially).
        // Only LOAD instructions set nsLoaded in the assembler; rebinding to a
        // different CR removes the name from the CR6 set.
        const _cr6Bound = new Set();

        let _srcChanged = false;
        for (let _li = 0; _li < _srcLines.length; _li++) {
            const rawLine = _srcLines[_li];

            // Strip comments sequentially — mirrors assembler Pass-1 exactly
            let codePart = rawLine.trim();
            let _ci = codePart.indexOf(';');  if (_ci >= 0) codePart = codePart.slice(0, _ci).trim();
            let _di = codePart.indexOf('--'); if (_di >= 0) codePart = codePart.slice(0, _di).trim();
            let _si = codePart.indexOf('//'); if (_si >= 0) codePart = codePart.slice(0, _si).trim();

            // Tokenise: commas/brackets → spaces, split on whitespace
            const parts = codePart.replace(/,/g, ' ').replace(/\[/g, ' ').replace(/\]/g, ' ')
                                  .split(/\s+/).filter(Boolean);
            if (parts.length < 2) continue;

            // Identify mnemonic (with optional condition suffix, no dot)
            const mnemU = parts[0].toUpperCase();
            let baseOp = null;
            for (const op of _targetOps) {
                if (mnemU === op) { baseOp = op; break; }
                if (mnemU.startsWith(op) && _condSet.has(mnemU.slice(op.length))) { baseOp = op; break; }
            }
            if (!baseOp) continue;

            // Update _cr6Bound: LOAD and SAVE 2-operand shorthand both set nsLoaded in the
            // assembler (see assembler.js case 0 line 415 and case 1 line 430).
            // We mirror that here so subsequent 3-operand lines can match the bound name.
            if ((baseOp === 'LOAD' || baseOp === 'SAVE') && parts.length === 3) {
                const _crDst = _parseRegIdx(parts[1]);
                if (_crDst === 6) {
                    _cr6Bound.add(parts[2]);          // Name now bound to CR6
                } else if (_crDst >= 0) {
                    _cr6Bound.delete(parts[2]);        // Name rebound away from CR6
                }
            }

            let rewritten = null;

            if (parts.length >= 4 && (_parseRegIdx(parts[2]) === 6 || _cr6Bound.has(parts[2]))) {
                // ── 3-operand explicit form: MNEM CRd, CR6(or alias), slot ──
                const oldSlot = _parseImm(parts[3]);
                if (isNaN(oldSlot) || !oldToNew.has(oldSlot) || oldToNew.get(oldSlot) === oldSlot) continue;
                const newSlot = oldToNew.get(oldSlot);
                // Precisely replace the slot token in the raw line, preserving
                // surrounding separators (commas, brackets, whitespace).
                // Lookahead after source-reg ensures no partial matches (e.g. CR60 ≠ CR6).
                const crEsc   = parts[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const slotEsc = parts[3].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // Use [^\w] ("non-word char") so any separator — comma, bracket,
                // space, semicolon, etc. — satisfies the boundary.  This is
                // simpler and more robust than enumerating specific separators.
                rewritten = rawLine.replace(
                    new RegExp(`(${crEsc}(?=[^\\w])([\\s,\\[\\]]*))` +
                               `(${slotEsc})(?=[^\\w]|$)`, 'i'),
                    `$1${newSlot}`
                );
                if (rewritten === rawLine) continue;

            } else if (parts.length === 3) {
                // ── 2-operand NS shorthand: MNEM CRd, Name ──────────────────
                // The assembler resolves Name via nsSymbols[Name] to a c-list row.
                // After POLA that slot has moved; expand to explicit 3-operand form.
                const nameToken = parts[2];
                const oldSlot   = _nsSyms[nameToken];
                if (oldSlot === undefined || !oldToNew.has(oldSlot) || oldToNew.get(oldSlot) === oldSlot) continue;
                const newSlot  = oldToNew.get(oldSlot);
                // Preserve leading whitespace and any trailing comment from rawLine
                const leadWS   = rawLine.match(/^(\s*)/)[1];
                const origMnem = rawLine.trimStart().split(/[\s,\[]/)[0];
                let trailCmt   = '';
                for (const cs of [';', '--', '//']) {
                    const tci = rawLine.indexOf(cs);
                    if (tci >= 0) { trailCmt = ' ' + rawLine.slice(tci); break; }
                }
                rewritten = `${leadWS}${origMnem} ${parts[1]}, CR6, ${newSlot}${trailCmt}`;
            }

            if (rewritten && rewritten !== rawLine) {
                _srcLines[_li] = rewritten;
                changedSourceLines.push(_li + 1);
                _srcChanged = true;
            }
        }

        if (_srcChanged) {
            _asmEd.value = _srcLines.join('\n');
            if (typeof updateLineNumbers === 'function') updateLineNumbers();
            if (typeof _highlightPolaChangedLines === 'function') _highlightPolaChangedLines(changedSourceLines);
        }
    }

    // ── Step 6: write compacted c-list at new tail position ────────────────
    const newClistBase = baseLoc + lumpSize - newCC;
    for (let j = 0; j < newCC; j++) sim.memory[newClistBase + j] = newGTs[j] >>> 0;
    // Zero freed region between old and new c-list start
    for (let addr = clistBase; addr < newClistBase; addr++) sim.memory[addr] = 0;

    // ── Step 7: update lump header and NS entry ────────────────────────────
    sim.memory[baseLoc] = sim.packLumpHeader(n_minus_6, cw, newCC, typ) >>> 0;
    const nsBase = sim.NS_TABLE_BASE + nsIdx * sim.NS_ENTRY_WORDS;
    const oldW1  = sim.memory[nsBase + 1] >>> 0;
    const oldW2  = sim.memory[nsBase + 2] >>> 0;
    const gtSeqP = (oldW2 >>> 25) & 0x7F;
    const w1fP   = sim.parseNSWord1(oldW1);
    // Only update clistCount; preserve limit17 so the CRC seal stays coherent.
    // (The old code used lumpSize-1 here, which silently changed limit17 and
    //  invalidated the seal on every POLA run.)
    const newW1P = sim.packNSWord1(w1fP.limit, w1fP.b, w1fP.g, w1fP.chainable, w1fP.gtType, newCC);
    sim.memory[nsBase + 1] = newW1P;
    // Recompute seal: baseLoc and limit17 are both unchanged so this is
    // equivalent to the original seal, but correct even if a prior POLA run
    // left limit17 in a bad state.
    sim.memory[nsBase + 2] = sim.makeVersionSeals(gtSeqP, baseLoc, w1fP.limit);
    // Propagate updated NS words to any CR currently holding a GT for this slot.
    for (let _ci = 0; _ci < 16; _ci++) {
        const _cr = sim.cr[_ci];
        if (_cr && sim.parseGT && (sim.parseGT(_cr.word0) || {}).index === nsIdx) {
            _cr.word2 = sim.memory[nsBase + 1];
            _cr.word3 = sim.memory[nsBase + 2];
        }
    }

    updateCRDetail();

    // ── Step 8: build report ───────────────────────────────────────────────
    const logLines = [];
    if (zeroedCount > 0) {
        logLines.push(`Zeroed ${zeroedCount} unreferenced GT slot${zeroedCount !== 1 ? 's' : ''}:`);
        logLines.push(...zeroedLog);
    }
    const gapsRemoved = cc - newCC;
    if (gapsRemoved > 0) {
        logLines.push(`Compacted: ${cc} \u2192 ${newCC} slots (${gapsRemoved} null gap${gapsRemoved !== 1 ? 's' : ''} removed)`);
        for (const [oldSlot, newSlot] of oldToNew) {
            if (newSlot !== oldSlot) {
                const _pg3 = sim.parseGT(newGTs[newSlot]);
                const _pn3 = (_pg3 && sim.nsLabels && sim.nsLabels[_pg3.index]) ? sim.nsLabels[_pg3.index] : '';
                logLines.push(`  slot ${oldSlot} \u2192 ${newSlot}${_pn3 ? ` \u201C${_pn3}\u201D` : ''}`);
            }
        }
    }
    if (ledRemappings.length > 0) {
        logLines.push(`LED pet-name${ledRemappings.length !== 1 ? 's' : ''} remapped:`);
        logLines.push(...ledRemappings);
    }
    if (rewriteCount > 0) logLines.push(`Rewrote ${rewriteCount} instruction word${rewriteCount !== 1 ? 's' : ''}`);
    if (changedSourceLines.length > 0)
        logLines.push(`Updated source: ${changedSourceLines.length} line${changedSourceLines.length !== 1 ? 's' : ''} rewritten (line${changedSourceLines.length !== 1 ? 's' : ''} ${changedSourceLines.join(', ')})`);
    if (indirectWarnings.length > 0) {
        logLines.push(`\u26A0 ${indirectWarnings.length} slot${indirectWarnings.length !== 1 ? 's' : ''} moved, accessed by non-CR6 instruction (verify manually):`);
        logLines.push(...indirectWarnings);
    }

    // ── Step 9: report — programmer must click ↓ Save Lump to persist ─────
    logLines.push('\u2139 POLA complete \u2014 click \u2193\u202FSave Lump to persist this lump to the repository.');

    if (typeof showPatchModal === 'function') showPatchModal(true, title, logLines.join('\n'));
    if (typeof renderLumps === 'function') renderLumps();
};

// ── Boot Sequence Code ─────────────────────────────────────────────────────
// Actual hardware boot steps that install each Layer-0 abstraction.
// Mirrors simulator.js _bootStep() exactly.
