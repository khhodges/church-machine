var _crDetailHighlightPC = null;

// Bank custody is intentionally not bridged through browser state or JSON.
// The sanctum retains its private proof; browser callers hold only the CR0
// BankVariable Golden Token and invoke the typed Bank methods directly.

// ── ns-state.json committed slot→token map ───────────────────────────────────
// Fetched once at load and refreshed after every successful Save Namespace.
// _findSrcLump uses this as its primary lookup to avoid the 3-level fallback.
window._nsState = null;
(function _initNsStateFetch() {
    fetch('/api/boot-image/ns-state', { cache: 'no-store' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(s) { if (s && typeof s === 'object') window._nsState = s; })
        .catch(function() {});
})();

// ── NS table dirty tracking ──────────────────────────────────────────────────
// Set to true when in-memory NS state or next-build load policy diverges from
// the committed files.  The UI deliberately presents this as one save action:
// programmers should not need to understand the separate binary/config stores.
// Cleared to false after both saves succeed.
window._nsTableDirty = false;

// Update the Save NS button appearance to reflect dirty state.
// Looks for #nsSaveBtn in the DOM (rendered by updateNamespace).
function _setNsDirty(dirty) {
    window._nsTableDirty = Boolean(dirty);
    const btn = document.getElementById('nsSaveBtn');
    if (!btn) return;
    if (dirty) {
        btn.textContent = '\u25cf Unsaved NS';
        btn.style.color = '#f0a040';
        btn.style.borderColor = 'rgba(240,160,64,0.5)';
        btn.style.background  = '#2a1e0a';
    } else {
        btn.textContent = '\u{1F4BE} Save for next build';
        btn.style.color = '#7ec87e';
        btn.style.borderColor = 'rgba(100,200,100,0.35)';
        btn.style.background  = '#1a2a1f';
    }
}

// _findSrcLump(slotIdx, slotLabel)
// Identity is the dot name — slot number is not part of the logical model.
// Primary:   dot name is in the committed ns-state.json abstractions list.
// Secondary: name match covers unsaved in-memory additions (the slot is already
//            visible in the NS table, so membership is implied by its presence there).
// Returns the matching lump cache entry, or null.
// Hardware-capability name matcher used by the NS table render loop to decide
// whether a row's Source button should be hidden.  Module-level constant so it
// is compiled once, not once per row per render.
const _hwCapRe = /^(LED[0-5]?|LED_DEV|UART(_TX|_RX|_DEV)?|BTN|BTN_DEV|Button|SlideRule|Timer|TIMER_DEV|M_BIT_DEV|Display|Boot\.NS|Boot\.Nucs|Boot\.Abstr)$/i;

function _isResidentIORegister(slot) {
    const contracts = (typeof globalThis !== 'undefined')
        ? globalThis.ChurchArchitectureContracts : null;
    const mBitSlot = contracts && contracts.boot && contracts.boot.minimalSlots
        ? contracts.boot.minimalSlots.M_BIT_DEV : 13;
    return (slot >= 2 && slot <= 5) || slot === mBitSlot;
}

function _findSrcLump(slotIdx, slotLabel) {
    if (typeof _lumpsCache === 'undefined' || !Array.isArray(_lumpsCache)) return null;
    if (!slotLabel) return null;
    return _lumpsCache.find(l => l.abstraction === slotLabel) || null;
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
    if (typeof window !== 'undefined') {
        window._currentCodeControlFlowAddresses = {
            CALL: new Set(), RETURN: new Set(), CHANGE: new Set(),
        };
    }
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
        if (!sim.bootComplete && (crIdx === 12 || crIdx === 14)) {
            try {
                // Show the saved image currently selected by the stopped
                // Thread switcher, not always Boot.Thread.  The selected
                // image is meaningful before boot because its five zones are
                // already present in the uploaded memory.
                let _selectedThreadSlot = 1;
                if (typeof sim.activeThreadStatus === 'function') {
                    const _threadStatus = sim.activeThreadStatus();
                    if (_threadStatus && Number.isInteger(_threadStatus.slot)) {
                        _selectedThreadSlot = _threadStatus.slot;
                    }
                }
                const threadNSWord0Addr = sim._nsSlotBase(_selectedThreadSlot);
                const threadBase = threadNSWord0Addr !== undefined
                    ? (sim.memory[threadNSWord0Addr] >>> 0) : 0;
                // Word address zero is a valid Thread body location.
                if (threadBase >= 0 && threadBase < sim.memory.length) {
                    if (crIdx === 12) {
                        // CR12 pre-boot: render the full 5-zone thread memory layout
                        // (⑤DR, ④Heap, ③Free, ②Stack, ①Caps) exactly as shown in
                        // the tutorials, reading from the selected stopped image.
                        const _threadLabel = (sim.nsLabels && sim.nsLabels[_selectedThreadSlot])
                            || `Thread slot ${_selectedThreadSlot}`;
                        let hBar = '<div class="crd-menu-bar">';
                        hBar += `<span class="crd-menu-active-label">${_threadLabel} \u2014 Suspended Memory Image</span>`;
                        hBar += `<span class="crd-zone-nav" title="Jump to zone \u00b7 hover for live data">`;
                        hBar += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone('hdr')" onmouseenter="showZonePopup(event,'hdr',${_selectedThreadSlot})" onmouseleave="hideZonePopup()">Hdr</button>`;
                        hBar += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(5)" onmouseenter="showZonePopup(event,5,${_selectedThreadSlot})" onmouseleave="hideZonePopup()">&#x2464;\u202FDR</button>`;
                        hBar += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(4)" onmouseenter="showZonePopup(event,4,${_selectedThreadSlot})" onmouseleave="hideZonePopup()">&#x2463;\u202FHeap</button>`;
                        hBar += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(3)" onmouseenter="showZonePopup(event,3,${_selectedThreadSlot})" onmouseleave="hideZonePopup()">&#x2462;\u202FFree</button>`;
                        hBar += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(2)" onmouseenter="showZonePopup(event,2,${_selectedThreadSlot})" onmouseleave="hideZonePopup()">&#x2461;\u202FStack</button>`;
                        hBar += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(1)" onmouseenter="showZonePopup(event,1,${_selectedThreadSlot})" onmouseleave="hideZonePopup()">&#x2460;\u202FCaps</button>`;
                        hBar += `</span>`;
                        hBar += '</div>';
                        contentEl.innerHTML = hBar + renderThreadMemoryLayout(_selectedThreadSlot, true);
                        contentEl.classList.add('crd-content-thread');
                        return;
                    }
                    // CR14 pre-boot: show the designed startup value (Thread.CR0 at offset +244)
                    const CAPS_OFF = 244;
                    const word = sim.memory[threadBase + CAPS_OFF] >>> 0;
                    let preBootHtml = '';
                    const _selectedThreadLabel = (sim.nsLabels && sim.nsLabels[_selectedThreadSlot])
                        || `Thread slot ${_selectedThreadSlot}`;
                    preBootHtml += `<div style="padding:0.75rem 1rem 0.25rem;color:#f4b942;font-weight:600;font-size:0.85rem;letter-spacing:0.04em;">SUSPENDED THREAD IMAGE</div>`;
                    preBootHtml += `<div style="padding:0 1rem 0.75rem;color:var(--text-secondary);font-size:0.8rem;">CR14 is not live yet. This is the selected ${_selectedThreadLabel} CR0 home:</div>`;
                    preBootHtml += `<table class="abs-clist-table" style="margin:0 1rem 1rem;"><thead><tr><th>CR</th><th>GT (HEX)</th><th>PERMS</th><th>TYPE</th><th>NAME</th></tr></thead><tbody>`;
                    if (word === 0) {
                        preBootHtml += `<tr><td class="abs-clist-idx">CR0</td><td colspan="4" class="abs-clist-empty-slot">\u2014 (empty)</td></tr>`;
                    } else {
                        const parsed = sim.parseGT(word);
                        const p = { ...parsed.permissions, F: parsed.type === 2 ? 1 : 0 };
                        let permHtml = '';
                        for (const bit of ['B','R','W','X','E','L','S','F']) {
                            permHtml += `<span class="abs-perm-badge ${p[bit] ? 'perm-on' : 'perm-off'}">${bit}</span>`;
                        }
                        const nsIdx2 = parsed.index;
                        const label2 = (sim.nsLabels && sim.nsLabels[nsIdx2]) || null;
                        const isBootEntry = (p.E && nsIdx2 === sim.bootEntrySlot);
                        const nameStr = label2
                            ? (isBootEntry
                                ? `<span class="abs-nsdecoder-badge-boot">\u26a1</span> <strong>${label2}</strong> <span style="color:#6b7280;font-size:0.8em;margin-left:4px;">NS[${nsIdx2}]</span>`
                                : `<strong>${label2}</strong> <span style="color:#6b7280;font-size:0.8em;margin-left:4px;">NS[${nsIdx2}]</span>`)
                            : `NS[${nsIdx2}]`;
                        preBootHtml += `<tr><td class="abs-clist-idx">CR0</td><td class="abs-clist-gt">0x${word.toString(16).toUpperCase().padStart(8,'0')}</td><td class="abs-clist-perms">${permHtml}</td><td class="abs-clist-type">${parsed.typeName}</td><td class="abs-clist-name">${nameStr}</td></tr>`;
                    }
                    preBootHtml += `</tbody></table>`;
                    preBootHtml += `<div style="padding:0 1rem 1rem;color:#4b5563;font-size:0.78rem;">Click <b style="color:var(--text-secondary);">Boot</b> to run the sequence and activate these registers.</div>`;
                    contentEl.innerHTML = preBootHtml;
                    contentEl.classList.remove('crd-content-thread');
                    return;
                }
            } catch(e) { /* fall through to generic message */ }
        }
        if (!sim.bootComplete) {
            const bootHint = (crIdx === 14 || crIdx === 12)
                ? `CR${crIdx} will be loaded from the Thread LUMP on boot.`
                : `CR${crIdx} may be populated during the boot sequence.`;
            contentEl.innerHTML =
                `<div style="color:var(--text-secondary);padding:1rem;">` +
                `<div style="margin-bottom:0.5rem;">Machine not booted yet (BOOT ${sim.bootStep}/4 · RESET).</div>` +
                `<div>${bootHint} Click <b>Boot</b> (top-right) to run the boot sequence.</div>` +
                `</div>`;
        } else {
            contentEl.innerHTML = '<div style="color:var(--text-secondary);padding:1rem;">Register is empty (all words zero).</div>';
        }
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
    const threadRegs = [8, 12, 13];
    const nsRegs = [15];
    const showCode = hasX || (crMbit && codeRegs.includes(crIdx));
    const showCList = hasL || (crMbit && clistRegs.includes(crIdx));
    const showThread = _isThreadNamespaceSlot(nsIdx) || threadRegs.includes(crIdx);
    const showNS = crMbit && nsRegs.includes(crIdx);
    const showData = (hasR || hasW) && !showCode && !showCList;

    // Check if the base location holds a valid lump header (needed for Edit button).
    const _editBaseLoc = cr.word1_location >>> 0;
    const _editWord0 = (_editBaseLoc < sim.memory.length) ? (sim.memory[_editBaseLoc] >>> 0) : 0;
    const _editLumpHdr = sim.parseLumpHeader(_editWord0);
    const showEditButton = showCode && _editLumpHdr.valid;

    // ── Correct default tab for this CR's capabilities ───────────────────────
    crDetailTab = correctCRDetailTab(crDetailTab, showCode, showCList, showData);
    // Thread/IRQ registers always default to Lump tab so the 5 zones are
    // immediately visible — the thread layout lives in crdPanel-lump.
    if (showThread) crDetailTab = 'lump';

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
            // Canonical NS ABI: limit is W1[16:0]; c-list count is entry metadata
            // (readNSEntry: resident header cc or side-table), NOT a W1 field.
            const _nsLimtmp = sim.parseNSWord1(_nsEtmp.word1_limit);
            const _ccTmp    = _nsEtmp.clistCount || 0;
            if (_ccTmp > 0) {
                _lumpClistBase = (_nsEtmp.word0_location >>> 0) + (_nsLimtmp.limit + 1) - _ccTmp;
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

    const _headingText = _absLabel
        ? (_activeTabLabel && _activeTabLabel !== 'Code' ? `${_absLabel} \u2014 ${_activeTabLabel}` : _absLabel)
        : _activeTabLabel;

    const activeLabelEl = document.getElementById('crdMenuActiveLabel');
    if (activeLabelEl) {
        activeLabelEl.textContent = _headingText;
        activeLabelEl.setAttribute('data-abs-label', _absLabel ? _absLabel.replace(/"/g,'&quot;') : '');
    }

    let dynMenuHtml = '';

    // Abstraction Views
    dynMenuHtml += '<div class="crd-menu-divider"></div>';
    dynMenuHtml += '<div class="crd-menu-section-label">Inspect Abstraction</div>';
    if (showCode) {
        dynMenuHtml += `<button class="crd-menu-item${crDetailTab==='code'?' crd-menu-item-active':''}" data-tab="code" onclick="switchCRDetailTab('code'); toggleDashMenu()">Code</button>`;
    }
    dynMenuHtml += `<button class="crd-menu-item${crDetailTab==='clist'?' crd-menu-item-active':''}" data-tab="clist" onclick="switchCRDetailTab('clist'); toggleDashMenu()">C-List</button>`;
    dynMenuHtml += `<button class="crd-menu-item${crDetailTab==='api'?' crd-menu-item-active':''}" data-tab="api" onclick="switchCRDetailTab('api'); toggleDashMenu()">API</button>`;
    dynMenuHtml += `<button class="crd-menu-item${crDetailTab==='lump'?' crd-menu-item-active':''}" data-tab="lump" onclick="switchCRDetailTab('lump'); toggleDashMenu()">Lump</button>`;
    dynMenuHtml += `<button class="crd-menu-item${crDetailTab==='register'?' crd-menu-item-active':''}" data-tab="register" onclick="switchCRDetailTab('register'); toggleDashMenu()">Register</button>`;
    dynMenuHtml += `<button class="crd-menu-item${crDetailTab==='binary'?' crd-menu-item-active':''}" data-tab="binary" onclick="switchCRDetailTab('binary'); toggleDashMenu()">Binary</button>`;

    // Actions
    let actionItems = '';
    if (showCode && showEditButton) {
        actionItems += `<button class="crd-menu-item crd-menu-item-action" onclick="editCRCodeInEditor(); toggleDashMenu()" title="Edit \u2014 Load this code lump into the assembly editor">Edit Source</button>`;
        actionItems += `<button class="crd-menu-item crd-menu-item-action" onclick="patchSimulator(); toggleDashMenu()" title="Patch \u2014 Assemble editor code and write it directly into simulator memory at this lump\u2019s base address.">Patch Memory</button>`;
    }
    if (showCode && _lumpHdr.valid) {
        const _cmpLsz = _lumpHdr.lumpSize;
        let _cmpMin = 64;
        while (_cmpMin < (1 + _lumpHdr.cw + _lumpHdr.cc)) _cmpMin <<= 1;
        const _canCmp2 = _cmpMin < _cmpLsz;
        actionItems += `<button class="crd-menu-item crd-menu-item-action${_canCmp2 ? '' : ' crd-action-btn-dim'}" ` +
                `onclick="${_canCmp2 ? `lumpCompress(${nsIdx}); toggleDashMenu()` : ''}" ` +
                `${_canCmp2 ? '' : 'disabled '}` +
                `title="${_canCmp2 ? `Compress \u2014 shrink freespace + trim unused c-list GTs, then auto-save` : 'Already at minimum size \u2014 no freespace or unused GTs'}">Compress Lump</button>`;
        actionItems += `<button class="crd-menu-item crd-menu-item-action" ` +
                `onclick="lumpSaveLump(${nsIdx}); toggleDashMenu()" ` +
                `title="Save Lump \u2014 persist the current lump binary to server/lumps/ so it survives restarts">Save Lump</button>`;
    }

    if (actionItems) {
        dynMenuHtml += '<div class="crd-menu-divider"></div>';
        dynMenuHtml += '<div class="crd-menu-section-label">Modify Abstraction</div>';
        dynMenuHtml += actionItems;
    }

    if (showEditButton) {
        dynMenuHtml += '<div class="crd-menu-divider"></div>';
        dynMenuHtml += '<div class="crd-menu-section-label">Deploy &amp; Share</div>';
        dynMenuHtml += `<button class="crd-menu-item crd-menu-item-fpga" onclick="patchFPGA();toggleDashMenu()" title="Patch FPGA \u2014 Runs Patch Simulator first, then uploads the updated lump to the FPGA board over WebSerial (UART). Requires an active hardware connection.">&#x21A9; Patch FPGA</button>`;
        dynMenuHtml += `<button class="crd-menu-item crd-menu-item-fpga" onclick="exportPatchFile();toggleDashMenu()" title="Export Patch \u2014 Assembles the code and downloads a .patch file with UART frames, CRC, and RUN sentinel. Flash with: python3 patch_fpga.py /dev/ttyUSB1 file.patch">&#x2B73; Export Patch</button>`;
        dynMenuHtml += `<button class="crd-menu-item crd-menu-item-fpga" onclick="exportLumpAsPatch();toggleDashMenu()" title="Lump\u2192Patch \u2014 Pick a pre-built .lump binary, validate its header, and wrap it into a .patch UART frame file for FPGA flashing.">&#x2B73; Lump\u2192Patch</button>`;
        dynMenuHtml += '<div class="crd-menu-divider"></div>';
        dynMenuHtml += `<button class="crd-menu-item crd-menu-item-publish" onclick="publishToLibrary();toggleDashMenu()" title="Publish \u2014 Compile and publish this abstraction to the Mum Tunnel Library on GitHub, including machine words, c-list, source, and metadata.">&#x21E1; Publish to Library</button>`;
    }

    const dynMenuEl = document.getElementById('dynamicAbstractionMenu');
    if (dynMenuEl) {
        dynMenuEl.innerHTML = dynMenuHtml;
        dynMenuEl.style.display = 'block';
    }

    let html = '';
    if (showThread) {
        html += '<div class="crd-menu-bar" style="margin-bottom:0.5rem;padding:0.25rem 0.5rem;border:1px solid var(--border);border-radius:6px;background:rgba(0,0,0,0.2);">';
        html += `<span class="crd-zone-nav" title="Jump to zone \u00b7 hover for live data">`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone('hdr')" onmouseenter="showZonePopup(event,'hdr',${nsIdx})" onmouseleave="hideZonePopup()">Hdr</button>`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(5)" onmouseenter="showZonePopup(event,5,${nsIdx})" onmouseleave="hideZonePopup()">⑤\u202FDR</button>`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(4)" onmouseenter="showZonePopup(event,4,${nsIdx})" onmouseleave="hideZonePopup()">④\u202FHeap</button>`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(3)" onmouseenter="showZonePopup(event,3,${nsIdx})" onmouseleave="hideZonePopup()">③\u202FFree</button>`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(2)" onmouseenter="showZonePopup(event,2,${nsIdx})" onmouseleave="hideZonePopup()">②\u202FStack</button>`;
        html += `<button class="crd-tab crd-tab-zone" onclick="scrollToThreadZone(1)" onmouseenter="showZonePopup(event,1,${nsIdx})" onmouseleave="hideZonePopup()">①\u202FCaps</button>`;
        html += `</span>`;
        html += '</div>';
    }

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
                { addr: 'B:01', desc: 'LOAD_NS',     decomp: 'CR15 \u2190 NS[0] Boot.NS.' },
                { addr: 'B:02', desc: 'INIT_THRD',   decomp: 'CR12 \u2190 NS[1] thread stack GT (M=1, Inform, zero perms)' },
                { addr: 'B:03', desc: 'INIT_HEAP',   decomp: 'CR5(RW) \u2190 thread heap \u00b7 CHANGE-consistent synthesis' },
                { addr: 'B:04', desc: 'CALL_HOME',   decomp: 'Plaintext FW=2 call-home/status exchange \u00b7 await IDE acknowledgement' },
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
            const typNames  = ['code', 'namespace', 'thread', '?'];
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
        if (typeof window !== 'undefined') {
            for (let w = _methodTableCount; w < _codeWords.length; w++) {
                const opcode = (_codeWords[w] >>> 27) & 0x1F;
                const operation = opcode === 2 ? 'CALL'
                    : opcode === 3 ? 'RETURN'
                    : opcode === 4 ? 'CHANGE' : null;
                if (operation) {
                    window._currentCodeControlFlowAddresses[operation].add(codeStart + w);
                }
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

            // physicalPC is the NIA used by the execution/trace path. Prefer
            // it over the logical PC so the highlighted row remains correct
            // across CR14 changes and call/return transitions.
            const _liveNIA = Number.isInteger(sim.physicalPC)
                ? (sim.physicalPC >>> 0) : null;
            const isPC    = _liveNIA !== null
                ? addr === _liveNIA
                : (lumpHdr.valid
                    ? (addr === baseLoc + 1 + sim.pc)
                    : ((addr === (sim.programBaseAddr || 0) + sim.pc) || (addr === sim.pc)));
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
            const _opcode = (word >>> 27) & 0x1F;
            const _controlFlowName = _opcode === 2 ? 'CALL'
                : _opcode === 3 ? 'RETURN'
                : _opcode === 4 ? 'CHANGE' : null;
            const _controlFlowAddresses = _controlFlowName &&
                typeof window !== 'undefined'
                ? window._currentCodeControlFlowAddresses[_controlFlowName] : null;
            const _operationGroupArmed = !!(_controlFlowAddresses &&
                _controlFlowAddresses.size > 0 &&
                [..._controlFlowAddresses].every(address => simBreakpoints.has(address)));
            let rowClass = isPC ? 'code-pc-row' : (isBP ? 'code-bp-row' : (isCompiler ? 'code-row-compiler' : ''));
            if (_controlFlowName) rowClass = (rowClass ? rowClass + ' ' : '') + 'code-control-flow-row';
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
            const _controlFlowButton = _controlFlowName
                ? `<button type="button" class="code-breakpoint-btn${_operationGroupArmed ? ' active' : ''}" ` +
                  `onclick="event.stopPropagation();toggleBreakpointAtAddress(${addr},'${_controlFlowName}')" ` +
                  `data-breakpoint-operation="${_controlFlowName}" data-breakpoint-address="0x${addr.toString(16).toUpperCase().padStart(4,'0')}" ` +
                  `aria-label="${_operationGroupArmed ? 'Remove' : 'Set'} breakpoints for all ${_controlFlowName} instructions" ` +
                  `title="${_operationGroupArmed ? 'Remove' : 'Set'} breakpoints for all ${_controlFlowName} instructions">${_operationGroupArmed ? '&#x25CF;' : '&#x25CB;'}</button>`
                : '';
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
            codeHtml += `<td class="code-disasm">${_controlFlowButton}${bpDot}${_clobberIcon}${_clobberOriginIcon}${decoded}</td>`;
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
        html += renderThreadMemoryLayout(nsIdx, true);
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
            html += '<th>Label</th><th class="popup-sub-id">Idx</th><th>W0: Location</th><th>Type</th><th>W1: F</th><th>W1: G</th><th>C-list</th>';
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
                html += `<td>${e.clistCount || 0}</td>`;
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
            html += '<div style="color:var(--text-secondary);font-size:0.72rem;padding-bottom:0.3rem;">bit[0]=R drives pin \u00b7 bit[1]=G \u00b7 bit[2]=B (Wukong: only R connected)</div>';
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
        const _owAbs = (sim.abstractionRegistry && _absName)
            ? (sim.abstractionRegistry.getByName ? sim.abstractionRegistry.getByName(_absName) : null)
            : null;
        const _owApproval = _findSrcLump(nsIdx, _absName);
        html += '<div class="crd-lump-section">';
        html += '<div class="crd-lump-section-label">Ownership</div>';
        if (_mfst) {
            html += '<table class="cr-table cr-detail-words"><tbody>';
            const _owRows = [
                ['Name',           _absName],
                ['Author',         _owApproval && _owApproval.author],
                ['Version',        _owApproval && _owApproval.version],
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
        } else if (_owApproval && (_owApproval.author || _owApproval.version)) {
            html += '<table class="cr-table cr-detail-words"><tbody>';
            html += `<tr><td style="color:var(--church-blue);width:130px;">Name</td><td>${_escHtml(_absName)}</td></tr>`;
            if (_owApproval.author) html += `<tr><td style="color:var(--church-blue)">Author</td><td>${_escHtml(_owApproval.author)}</td></tr>`;
            if (_owApproval.version) html += `<tr><td style="color:var(--church-blue)">Version</td><td>${_escHtml(_owApproval.version)}</td></tr>`;
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
    html += `<tr><td>R3: Integrity</td><td>0x${(cr.word3 >>> 0).toString(16).toUpperCase().padStart(8,'0')}</td><td>32-bit unkeyed integrity32 check</td></tr>`;
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
        // Canonical NS ABI: gt_seq lives in W1[29:21] (authority word); W2 is a
        // full 32-bit integrity32 hash of {W0, W1(bits31:30 masked)}, not a CRC16.
        const sealGtSeq = lim.gtSeq;
        const integrity32 = entry.word2_seals >>> 0;
        const gtPermStr = cr.perms;
        const typeNames = ['NULL','Inform','Outform','Abstract'];

        html += '<table class="cr-table"><tbody>';
        html += `<tr><td>W0: Location</td><td>0x${loc.toString(16).toUpperCase().padStart(8,'0')}</td></tr>`;
        html += `<tr><td>Type (meta)</td><td>${typeNames[entry.gtType] || '?'}</td></tr>`;
        html += `<tr><td>W1: F (Far)</td><td>${lim.f}</td></tr>`;
        html += `<tr><td>W1: G (GC)</td><td>${entry.gBit}</td></tr>`;
        html += `<tr><td>C-list count (meta)</td><td>${entry.clistCount || 0}</td></tr>`;
        html += `<tr><td>W1: Limit</td><td>0x${lim.limit.toString(16).toUpperCase().padStart(5,'0')} (${lim.limit + 1} words)</td></tr>`;
        html += `<tr><td>W1: GT Seq</td><td>${sealGtSeq}</td></tr>`;
        html += `<tr><td>W2: Integrity32</td><td>0x${integrity32.toString(16).toUpperCase().padStart(8,'0')}</td></tr>`;
        const w3raw = (entry.word3_cache_token || 0) >>> 0;
        html += `<tr><td>W3: Cache token T</td><td>0x${w3raw.toString(16).toUpperCase().padStart(8,'0')} <span style="color:#aaa;font-size:0.85em;">[lookup only; non-authoritative]</span></td></tr>`;
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
            const typNames = ['lump', 'namespace', 'thread', '?'];
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
        // A gate/error highlight is a one-time navigation aid. During live
        // execution the current NIA must win, otherwise a stale clicked row
        // keeps the code view parked on the old page.
        const liveTarget = contentEl.querySelector('.code-pc-row');
        const scrollTarget = liveTarget ||
            (_crDetailHighlightPC !== null
                ? contentEl.querySelector('.code-gate-row')
                : null);
        if (scrollTarget) {
            // Repeated smooth-scroll animations are continuously cancelled by
            // Run-mode state updates and can leave the view on an old page.
            scrollTarget.scrollIntoView({
                behavior: liveTarget ? 'auto' : 'smooth',
                block: 'center'
            });
        }
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
    // ── Hardware-driven status overrides simulator state while board is live ───
    // _wukongGetHwConnected / _wukongGetHwFaulted are getter functions exposed
    // by app-run.js via window so they always read the latest live values.
    const _hwConnected = (typeof window._wukongGetHwConnected === 'function')
                       && window._wukongGetHwConnected();
    const _hwFaulted   = _hwConnected
                       && (typeof window._wukongGetHwFaulted === 'function')
                       && window._wukongGetHwFaulted();
    const statusLabel = _hwConnected
        ? (_hwFaulted ? 'HW FAULTED' : 'HW RUNNING')
        : (sim.halted ? 'HALTED' : (sim.bootComplete ? 'READY' : 'RESET'));
    // sim.halted is a software-simulator concept; when hardware is live it must
    // not pollute the hardware status chip (e.g. after a board reconnect where
    // the simulator was previously halted).  Only _hwFaulted drives the halted
    // chip while the board is connected; sim.halted applies only when no board
    // is present.
    const statusHalted = _hwFaulted || (!_hwConnected && sim.halted);
    const statusExplanation = statusHalted
        ? 'Execution is halted; inspect the fault log or reset to continue.'
        : '';
    const cap = sim.lastCapability;

    // ── Compact status chip in the flags-led-row ──────────────────────────
    container.innerHTML =
        (bootLabel ? `<span class="flag-info flag-boot">${bootLabel}</span>` : '') +
        `<span class="flag-info flag-status${statusHalted ? ' flag-status-halted' : ''}">` +
        `<strong>${statusHalted ? 'FAULT' : statusLabel}</strong>` +
        (statusExplanation
            ? `<span class="flag-status-explanation">${statusExplanation}</span>`
            : '') +
        `</span>`;

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
    const hwSnapshot = sim && sim.hardwareSnapshot;
    const hwHex = (value) => '0x' + (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
    const hardwareContextHtml = hwSnapshot
        ? `<div class="info-item"><span class="info-label">Hardware Snapshot</span><span class="info-value">STOP ${hwSnapshot.reason} · NIA ${hwHex(hwSnapshot.nia)} · STO ${hwHex(hwSnapshot.sto)} · Thread base ${hwHex(hwSnapshot.thread_base)} · live M=${hwSnapshot.m_flag ? 1 : 0}<br><span style="color:var(--text-secondary);">Suspended context — stored CR12 GT ${hwHex(hwSnapshot.stored_cr12_gt)} · packed PC ${hwHex(hwSnapshot.stored_packed_pc)} · saved M word ${hwHex(hwSnapshot.stored_mflag)}</span></span></div>`
        : '';
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
        ${hardwareContextHtml}
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
                <a href="#" onclick="event.preventDefault();switchView('lumps');setTimeout(()=>showLumpDetail('2570eade'),200);" style="color:#c89b3c;text-decoration:none;font-size:0.78rem;margin-left:0.5rem;">view LUMP</a>
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
    html += `<div class="boot-section-label">② NS Table &nbsp;<span class="boot-section-note">at 0x${sim.NS_TABLE_BASE.toString(16).toUpperCase().padStart(4,'0')} · ${sim.nsCount} entries × 4 words = ${nsWords} words (${nsWords*4} bytes)</span></div>`;
    html += '<table class="ns-mem-table boot-ns-table"><thead><tr>';
    html += '<th>Entry</th><th>Label</th><th>W0 · Base Addr</th><th>W1 · Type / Flags / Limit / Seq</th><th>W2 · Integrity32</th><th>C-list</th>';
    html += '</tr></thead><tbody>';
    for (let i = 0; i < sim.nsCount; i++) {
        // Canonical NS ABI: inverted table layout (_nsSlotBase); gt_seq is W1[29:21];
        // W2 is integrity32; type + c-list count are entry metadata (readNSEntry),
        // NOT W1 fields.
        const base  = sim._nsSlotBase(i);
        const w0    = sim.memory[base]     || 0;
        const w1    = sim.memory[base + 1] || 0;
        const w2    = sim.memory[base + 2] || 0;
        const p     = sim.parseNSWord1(w1);
        const _ent  = sim.readNSEntry(i);
        const _gtType = _ent ? _ent.gtType : 1;
        const _cc     = _ent ? (_ent.clistCount || 0) : 0;
        const ver   = p.gtSeq;
        const seal  = w2 >>> 0;
        const label = sim.nsLabels[i] || '-';
        const tName = typeNames[_gtType] || '?';
        const tCol  = typeColors[_gtType] || '#888';
        const empty = (w0 === 0 && w1 === 0 && w2 === 0);
        const flags = (p.f ? ' F' : '') + (p.g ? ' G' : '');
        html += `<tr${empty ? ' style="opacity:0.28;"' : ''}>`;
        html += `<td class="boot-ns-idx">NS[${i}]</td>`;
        html += `<td class="boot-ns-label">${_bootHtmlEsc(label)}</td>`;
        html += `<td class="boot-ns-addr">0x${(w0>>>0).toString(16).toUpperCase().padStart(4,'0')}</td>`;
        html += `<td style="color:${tCol};font-family:monospace;font-size:0.75rem;">${tName}${flags} · Lim=0x${p.limit.toString(16).toUpperCase().padStart(4,'0')} (${p.limit+1}w)</td>`;
        html += `<td style="color:#71717a;font-family:monospace;font-size:0.73rem;">v${ver} · i32=0x${seal.toString(16).toUpperCase().padStart(8,'0')}</td>`;
        html += `<td style="color:#f59e0b;font-size:0.73rem;">${_cc ? _cc + ' GT' + (_cc!==1?'s':'') : ''}</td>`;
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
        const clistCount = s2hdr.valid ? s2hdr.cc : (bootAbstrEntry.clistCount || 0);
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

// Thread geometry is derived from the selected Namespace entry's own
// resident body.  Do not substitute a default layout: that would show
// Boot.Thread or live-register state for a different Thread instance.
function _threadLayoutForSlot(nsIndex) {
    if (!sim || typeof sim.getThreadInstanceLayout !== 'function') {
        return { valid: false, nsIndex, reason: 'Thread memory is unavailable in this simulator.' };
    }
    return sim.getThreadInstanceLayout(nsIndex);
}

// Known Thread labels retain a Thread-specific unavailable state when the body
// has been evicted or malformed.  A valid typ=2 header identifies any other
// generated/resident Thread regardless of its label or Namespace slot number.
function _isThreadNamespaceSlot(nsIndex, entry) {
    if (_threadLayoutForSlot(nsIndex).valid) return true;
    const label = String((entry && entry.label) || (sim && sim.nsLabels && sim.nsLabels[nsIndex]) || '');
    return label === 'Boot.Thread' || /^Thread#\d+$/.test(label);
}

function renderThreadMemoryLayout(nsIndex, expandAll = false) {
    const TL = _threadLayoutForSlot(nsIndex);
    const label = sim.nsLabels[nsIndex] || ('Slot ' + nsIndex);
    if (!TL.valid) {
        const reason = String(TL.reason || 'The selected Thread body is unavailable.')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<div class="thread-layout-view thread-layout-unavailable" data-thread-slot="${nsIndex}">` +
            `<div class="thread-layout-sticky" id="thread-zone-hdr">` +
            `<div class="thread-layout-header">${label} — Thread Memory Layout` +
            `<span class="thread-layout-subhead">NS Slot ${nsIndex} · read-only</span></div></div>` +
            `<div style="margin:16px;padding:14px;border:1px solid rgba(248,113,113,0.45);border-radius:6px;background:rgba(127,29,29,0.15);">` +
            `<strong style="color:#fca5a5;">THREAD BODY UNAVAILABLE</strong>` +
            `<p style="margin:7px 0 0;color:#d1d5db;line-height:1.45;">${reason} No values are shown because a Thread detail view only reads the selected Namespace body.</p>` +
            `</div></div>`;
    }
    const slotBase = TL.base;

    const _collapsedCls = expandAll ? '' : ' thread-zone-collapsed';
    const _bodyDisplay  = expandAll ? '' : 'display:none;';
    const _chevron      = expandAll ? '▼' : '▶';
    const secHdr = (num, title, note, color, id='') =>
        `<div class="thread-zone-wrap">` +
        `<div class="thread-zone-hdr${_collapsedCls}"${id ? ` id="${id}"` : ''} style="border-left-color:${color};" onclick="_tzToggle(this)">` +
        `<span class="thread-zone-chevron">${_chevron}</span>${num} ${title}` +
        `<span class="thread-zone-note">${note}</span></div>` +
        `<div class="thread-zone-body" style="${_bodyDisplay}">`;
    const secBody = () => `</div></div>`;

    const addrOf = (off) => '0x' + (slotBase + off).toString(16).toUpperCase().padStart(4, '0');
    const hexOf  = (w)   => '0x' + (w >>> 0).toString(16).toUpperCase().padStart(8, '0');

    let html = '<div class="thread-layout-view">';

    // Thread geometry is self-contained: n-6 supplies the total size, cc
    // identifies the 12 capability homes at the tail, and cw/sw reserves the
    // stack immediately before them. Threads have no free-space zone.
    const threadCapsWords = 12;
    const threadCapsStart = TL.lumpSize - threadCapsWords;
    const threadCapsEnd = TL.lumpSize - 1;
    const threadStackEnd = threadCapsStart - 1;
    const threadStackStart = threadStackEnd - TL.stackWords + 1;
    const threadHeapStart = TL.heapStart;
    const threadHeapEnd = threadStackStart - 1;
    const threadHeapWords = Math.max(0, threadHeapEnd - threadHeapStart + 1);
    const threadHeapFormula = 'HeapWords = 2^((n−6)+6) − cw − 30';

    // ── Sticky header block (title + lump header) ─────────────────────────
    const headerWord = TL.headerWord;
    html += `<div class="thread-layout-sticky" id="thread-zone-hdr" data-thread-slot="${nsIndex}">`;
    html += `<div class="thread-layout-header">${label} — Thread Memory Layout<span class="thread-layout-subhead">NS Slot ${nsIndex} · base ${addrOf(0)} · ${TL.lumpSize} words·FS (${TL.lumpSize * 4}\u202Fbytes)</span></div>`;
    html += `<div class="thread-lump-hdr-block">`;
    html += `<span class="thread-lump-hdr-label">Lump Header</span>`;
    html += `<span class="thread-lump-hdr-note">word 0 · magic=0x1F · n\u22126=${TL.header.n_minus_6} (${TL.lumpSize}w total) · cw/sw=${TL.stackWords}\u202F(stack words) · typ=10 (Thread) · cc=${TL.header.cc}\u202F(capability homes)</span>`;
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
    html += '<table class="ns-mem-table thread-zone-table"><thead><tr><th>Offset</th><th>Addr</th><th>DR</th><th>Value (hex)</th><th>Value (dec)</th></tr></thead><tbody>';
    for (let i = 0; i < TL.drWords; i++) {
        const off  = TL.drStart + i;
        const word = sim.memory[slotBase + off] || 0;
        const rowStyle = word ? '' : ' style="opacity:0.28;"';
        html += `<tr${rowStyle}><td class="thread-offset-cell" style="color:#555;">+${off}</td><td class="thread-address-cell" style="font-family:monospace;">${addrOf(off)}</td><td style="color:#a855f7;">DR${i}</td><td style="color:#c084fc;font-family:monospace;">${hexOf(word)}</td><td style="color:#9ca3af;">${word >>> 0}</td></tr>`;
    }
    html += '</tbody></table>';
    html += secBody();

    // ── Protected machine state: STO (+17) ───────────────────────────────
    const stoOff = TL.protectedStoOffset;
    const stoWord = sim.memory[slotBase + stoOff] >>> 0;
    const stoValue = stoWord & 0xFFF;
    const stoSize = (stoWord >>> 12) & 1;
    const stoFlags = (stoWord >>> 28) & 0xF;
    html += secHdr('◆', 'Protected STO', `1 machine-protected Thread word · offset +${stoOff} · FLAGS[31:28] | SZ[12] | STO[11:0] · outside CR5 heap bounds`, '#f59e0b', 'thread-zone-sto');
    html += '<table class="ns-mem-table thread-zone-table"><thead><tr><th>Offset</th><th>Addr</th><th>State</th><th>Value</th></tr></thead><tbody>';
    html += `<tr><td class="thread-offset-cell" style="color:#f59e0b;">+${stoOff}</td><td class="thread-address-cell">${addrOf(stoOff)}</td><td>FLAGS=${stoFlags.toString(2).padStart(4,'0')} · SZ=${stoSize} · STO=${stoValue}</td><td>${hexOf(stoWord)}</td></tr>`;
    html += '</tbody></table>';
    html += secBody();

    // ── Zone ④: Heap ───────────────────────────────────────────────────────
    let heapNonZero = 0;
    for (let i = threadHeapStart; i <= threadHeapEnd; i++) {
        if (sim.memory[slotBase + i]) heapNonZero++;
    }
    html += secHdr('④', 'Heap ↑', `${threadHeapWords} words · ${threadHeapFormula} · offset +${threadHeapStart} … +${threadHeapEnd} · base ${addrOf(threadHeapStart)} · grows when lump size grows · ${heapNonZero} word${heapNonZero!==1?'s':''} allocated`, '#22c55e', 'thread-zone-4');
    html += '<table class="ns-mem-table thread-zone-table"><thead><tr><th>Offset</th><th>Addr</th><th>Hex</th><th>Decoded</th></tr></thead><tbody>';
    for (let i = 0; i < threadHeapWords; i++) {
        const off  = threadHeapStart + i;
        const word = sim.memory[slotBase + off] || 0;
        const rowStyle = word ? '' : ' style="opacity:0.22;"';
        const decoded  = word ? `<span style="color:#9ca3af;">0x${word.toString(16).toUpperCase().padStart(8,'0')}</span>` : '<span style="color:#374151;">free</span>';
        html += `<tr${rowStyle}><td class="thread-offset-cell" style="color:#22c55e;">+${off}</td><td class="thread-address-cell" style="font-family:monospace;">${addrOf(off)}</td><td style="color:rgba(206,145,120,0.8);font-family:monospace;">${hexOf(word)}</td><td>${decoded}</td></tr>`;
    }
    html += '</tbody></table>';
    html += secBody();

    // ── Zone ②: LIFO Stack (immediately before tail capability homes) ────
    const stackWords = sim.memory.slice(slotBase + threadStackStart, slotBase + threadStackEnd + 1);
    const stackUsed  = stackWords.filter(Boolean).length;
    html += secHdr('②', 'LIFO Stack ↓', `${TL.stackWords} words · offset +${threadStackStart} … +${threadStackEnd} · immediately before capability homes · grows ↓ · ${stackUsed} word${stackUsed!==1?'s':''} non-zero`, '#38bdf8', 'thread-zone-2');
    html += '<table class="ns-mem-table thread-zone-table"><thead><tr><th>Offset</th><th>Addr</th><th>Hex</th><th>Decoded</th></tr></thead><tbody>';
    for (let i = 0; i < TL.stackWords; i++) {
        const off  = threadStackStart + i;
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
        html += `<tr id="thread-stack-row-${off}"${rowStyle}><td class="thread-offset-cell" style="color:#38bdf8;">+${off}</td><td class="thread-address-cell" style="font-family:monospace;">${addrOf(off)}</td><td style="color:rgba(206,145,120,0.85);font-family:monospace;">${hex}</td><td>${decoded}</td></tr>`;
    }
    html += '</tbody></table>';
    html += secBody();

    // ── Zone ①: Capabilities (tail-derived) ──────────────────────────────
    html += secHdr('①', 'Capabilities', `${threadCapsWords} words · CR0–CR11 · offset +${threadCapsStart} … +${threadCapsEnd} · tail-derived private-ABI homes · saved/restored on context switch`, '#f4b942', 'thread-zone-1');
    html += '<div class="abs-clist-heading">GOLDEN TOKENS</div>';
    html += `<div class="abs-clist-count">${threadCapsWords} capability-home slots (cc=12)</div>`;
    html += '<table class="abs-clist-table"><thead><tr>';
    html += '<th>Offset</th><th>Addr</th><th>CR</th><th>GT (HEX)</th><th>PERMS</th><th>TYPE</th><th>NAME</th>';
    html += '</tr></thead><tbody>';
    for (let i = 0; i < threadCapsWords; i++) {
        const off  = threadCapsStart + i;
        const word = sim.memory[slotBase + off] || 0;
        if (word === 0) {
            html += `<tr><td class="thread-offset-cell abs-clist-offset">+${off}</td><td class="thread-address-cell abs-clist-address">${addrOf(off)}</td><td class="abs-clist-idx">CR${i}</td><td colspan="4" class="abs-clist-empty-slot">\u2014 (empty)</td></tr>`;
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
            const nameStr = label
                ? `<strong>${label}</strong> <span style="color:#6b7280;font-size:0.8em;margin-left:4px;">NS[${nsIdx}]</span>`
                : `NS[${nsIdx}]`;
            const gtHex = '0x' + word.toString(16).toUpperCase().padStart(8, '0');
            html += `<tr>`;
            html += `<td class="thread-offset-cell abs-clist-offset">+${off}</td>`;
            html += `<td class="thread-address-cell abs-clist-address">${addrOf(off)}</td>`;
            html += `<td class="abs-clist-idx">CR${i}</td>`;
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
    const bEntry = sim.readNSEntry(bSlot);
    const bSeq = bEntry ? sim.parseNSWord1(bEntry.word1_limit).gtSeq : 0;
    const gtWord = sim.createGT(bSeq, bSlot, {E:1}, 1);
    // Write to the primary thread (NS slot 1 — the boot thread).
    const targets = new Set([1]);
    let wrote = false;
    for (const nsIdx of targets) {
        const entry = sim.readNSEntry(nsIdx);
        // The canonical boot thread is rooted at address 0, which is a valid
        // location and must not be rejected by a truthiness check.
        if (entry && typeof entry.word0_location === 'number') {
            const layout = _threadLayoutForSlot(nsIdx);
            if (!layout.valid) continue;
            sim.writePersistentWord(layout.base + layout.capsStart, gtWord);
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
    if (_isThreadNamespaceSlot(nsIndex)) return renderThreadMemoryLayout(nsIndex);

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
            const typNames   = ['lump','namespace','Thread','?'];
            const nsEntry    = sim.readNSEntry(nsIndex);
            // Canonical NS ABI: gt_seq is W1[29:21]; W2 is a full integrity32 hash.
            const lumpVer    = nsEntry ? (sim.parseNSWord1(nsEntry.word1_limit).gtSeq) : 0;
            const lumpSeal   = nsEntry ? (nsEntry.word2_seals >>> 0) : 0;
            const lumpNote   = `magic=0x${hdr.magic.toString(16).toUpperCase()}`
                             + ` \u00b7 n\u22126=${hdr.n_minus_6}\u2192${lumpSize}w`
                             + ` \u00b7 cw=${cw} \u00b7 typ=${typNames[hdr.typ]||hdr.typ} \u00b7 cc=${cc}`
                             + ` \u00b7 ver=${lumpVer} \u00b7 integrity32=0x${lumpSeal.toString(16).toUpperCase().padStart(8,'0')}`;
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
                // Canonical NS ABI: c-list count is entry metadata (resident-header
                // / side-table via readNSEntry), gt_seq is W1[29:21], W2 is integrity32.
                const cc2        = nsEntry2.clistCount || 0;
                const allocSize2 = lim2.limit + 1;
                const clistStart2 = cc2 > 0 ? (allocSize2 - cc2) : allocSize2;
                const lumpVer2   = lim2.gtSeq;
                const lumpSeal2  = nsEntry2.word2_seals >>> 0;
                const locHex2    = '0x' + location.toString(16).toUpperCase().padStart(4, '0');
                const hdrHex2    = '0x' + (hdrWord >>> 0).toString(16).toUpperCase().padStart(8, '0');

                html  = `<div style="color:rgba(156,220,254,0.3);font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:0.2rem;">Header`;
                html += ` <span style="color:#3f3f46;font-size:0.72rem;">no lump header at ${locHex2}`;
                html += ` \u00b7 layout from NS entry \u00b7 alloc=${allocSize2}w \u00b7 cc=${cc2}`;
                html += ` \u00b7 ver=${lumpVer2} \u00b7 integrity32=0x${lumpSeal2.toString(16).toUpperCase().padStart(8,'0')}</span></div>`;
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

// ---------------------------------------------------------------------------
// Boot Image Designer — Step 1: memory allocation (Task #214)
// ---------------------------------------------------------------------------
// Loads/saves a project-level boot config via /api/boot-config. The config is
// also exposed as window.bootConfig so simulator.js (initSim) can pick up
// programmer-chosen lump sizes when constructing the boot image.
// See docs/foundation-lump-design.md §4 for the design rationale.
// ---------------------------------------------------------------------------
let _hardwareProfiles = null;
let _lumpCatalog = [];          // [{abstraction, nsSlot, lumpSize, token}]
function _normalizeLumpCatalogEntries(entries) {
    return (Array.isArray(entries) ? entries : []).map(item => {
        item = item || {};
        const rawCacheToken = item.cacheToken ?? item.cache_token ?? item.token;
        const cacheToken = typeof rawCacheToken === 'string'
            ? parseInt(rawCacheToken.replace(/^0x/i, ''), 16)
            : Number(rawCacheToken);
        return {
            ...item,
            dotName: item.dotName || item.dot_name || item.abstraction || '',
            issueN: item.issueN ?? item.issue_n ?? item.issue_number,
            identityHash: item.identityHash || item.identity_hash || null,
            binaryHash: item.binaryHash || item.binary_hash || null,
            grants: Array.isArray(item.grants) ? item.grants :
                (Array.isArray(item.rights) ? item.rights : []),
            capabilityType: item.capabilityType ?? item.capability_type ??
                item.gtType ?? item.gt_type ?? item.type,
            cacheToken: Number.isInteger(cacheToken) ? (cacheToken >>> 0) : null,
            authorized: item.authorized === true || item.authorization === true ||
                item.install_authorized === true,
        };
    });
}
let _bdLimits = { maxNsEntries: 256, baseNamedNsCount: 47 };
// Used by the modal to refresh state. The DOMContentLoaded handler
// performs the *initial* prefetch so window.bootConfig is set before
// the simulator boots; this function just refreshes from the server.
function _loadBootConfig() {
    return fetch('/api/boot-config')
        .then(r => r.json())
        .then(data => {
            _setActiveBootConfig((data && data.config) || null);
            _hardwareProfiles = (data && data.profiles) || {};
            _lumpCatalog      = _normalizeLumpCatalogEntries((data && data.lumpCatalog) || []);
            if (data && data.limits) _bdLimits = data.limits;
            return data;
        })
        .catch(err => {
            console.warn('[bootConfig] fetch failed:', err);
            return null;
        });
}

function _reportBootImageRejection(message, resultEl) {
    const detail = message || (sim && sim.lastBootImageError) ||
        'Saved boot image was rejected. Regenerate it for the current memory configuration.';
    console.warn('[bootImage] ' + detail);
    if (resultEl) resultEl.textContent = detail;
    const con = document.getElementById('editorConsole');
    if (con && !con.textContent.includes(detail)) {
        con.textContent += (con.textContent ? '\n' : '') + '[BOOTIMG] ' + detail;
    }
}

function _setActiveBootConfig(config, serverInvalidated, invalidatedImageWords) {
    const previousWords = window.bootConfig && window.bootConfig.step1
        ? window.bootConfig.step1.totalNamespaceWords : null;
    const nextWords = config && config.step1
        ? config.step1.totalNamespaceWords : null;
    window.bootConfig = config || null;
    if (serverInvalidated || (
        Number.isInteger(previousWords) && Number.isInteger(nextWords) &&
        previousWords !== nextWords
    )) {
        window.bootImage = null;
        window.bootImageAvailable = false;
        const imageWords = Number.isInteger(invalidatedImageWords)
            ? invalidatedImageWords : previousWords;
        _reportBootImageRejection(
            `Saved boot image has ${Number(imageWords || 0).toLocaleString()} words, but the configured Namespace memory has ${Number(nextWords || 0).toLocaleString()} words. The previous saved boot image is no longer usable; regenerate it for the current memory configuration.`
        );
        return true;
    }
    return false;
}
window._setActiveBootConfig = _setActiveBootConfig;



// Task #217 — fetch the saved boot-image.bin (if any) without triggering
// a 404 console error noise. Returns ArrayBuffer or null.
function _probeBootImage() {
    return fetch('/api/boot-image/binary', { cache: 'no-store' })
        .then(async r => {
            if (r.ok) return r.arrayBuffer();
            let detail = '';
            try {
                const body = await r.json();
                detail = body && body.error ? body.error : '';
            } catch (_) {}
            if (detail) _reportBootImageRejection(detail);
            return null;
        })
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
        // Task #2867: honour the loader's verdict.  A cached binary that the
        // loader now rejects (e.g. a format-tag bump made it stale) must clear
        // the active/available state instead of masquerading as booted memory.
        try {
            if (sim.loadBootImage(window.bootImage) === true) {
                _applyBootEntryToSim(); _evictBootImgPatches();
            } else {
                _reportBootImageRejection(sim.lastBootImageError);
                window.bootImage = null;
                window.bootImageAvailable = false;
            }
        } catch (e) {
            _reportBootImageRejection('Saved boot image could not be applied: ' + e.message);
            window.bootImage = null;
            window.bootImageAvailable = false;
        }
        return;
    }
    if (window.bootImageAvailable) {
        _probeBootImage().then(buf => {
            if (buf) {
                try {
                    if (sim.loadBootImage(buf) === true) {
                        window.bootImage = buf;
                        _applyBootEntryToSim(); _evictBootImgPatches();
                    } else {
                        _reportBootImageRejection(sim.lastBootImageError);
                        window.bootImage = null;
                        window.bootImageAvailable = false;
                    }
                } catch(e){
                    _reportBootImageRejection('Saved boot image could not be applied: ' + e.message);
                    window.bootImage = null;
                    window.bootImageAvailable = false;
                }
            }
        });
    }
}

// Task #217 — Generate the binary boot image from the persisted boot
// config. The server writes server/lumps/boot-image.bin and returns
// download / inline-binary URLs; we surface the download link and arm
// the simulator to load the image on the next reset.
function generateBootImage(onApplied) {
    const result = document.getElementById('le-rl-gen-result');
    const btn    = document.getElementById('le-rl-gen-btn');
    const notifyApplied = typeof onApplied === 'function' ? onApplied : function() {};
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
                notifyApplied(false);
                return;
            }
            const kib = (body.bytes / 1024).toFixed(1);
            if (result) {
                let html =
                    `Generated <strong>${body.bytes.toLocaleString()}</strong> bytes ` +
                    `(${body.words.toLocaleString()} words, ${kib}\u00a0KiB) \u2014 ` +
                    `<a href="${body.downloadUrl}" download="boot-image.bin" ` +
                    `style="color:#9bd;text-decoration:underline;">Download boot-image.bin</a>. ` +
                    `Reset the simulator to apply this image at boot.`;
                const driftWarnings = Array.isArray(body.warnings) ? body.warnings : [];
                if (driftWarnings.length > 0) {
                    html += driftWarnings.map(w =>
                        `<div style="margin-top:6px;padding:4px 8px;background:#3a2a00;border-left:3px solid #f90;color:#fc0;font-size:0.9em;">\u26A0\uFE0F ${w}</div>`
                    ).join('');
                }
                result.innerHTML = html;
            }
            // Cache the freshly-generated binary so the next sim.reset()
            // immediately overlays it (no extra round-trip needed). The
            // 'reset' listener calls _maybeApplyBootImage which prefers
            // window.bootImage when present.
            // Task #2867: only mark available once loadBootImage() accepts it.
            _probeBootImage().then(buf => {
                if (buf) {
                    try {
                        if (sim.loadBootImage(buf) === true) {
                            window.bootImage = buf;
                            window.bootImageAvailable = true;
                            _applyBootEntryToSim();
                            if (typeof window._clearBootImageStickyPatches === 'function') window._clearBootImageStickyPatches(sim.nsCount || 0);
                            notifyApplied(true);
                        } else {
                            window.bootImage = null;
                            window.bootImageAvailable = false;
                            _reportBootImageRejection(sim.lastBootImageError, result);
                            notifyApplied(false);
                        }
                    } catch(e) {
                        window.bootImage = null;
                        window.bootImageAvailable = false;
                        _reportBootImageRejection('Generated boot image could not be applied: ' + e.message, result);
                        notifyApplied(false);
                    }
                } else {
                    notifyApplied(false);
                }
            });
        })
        .catch(err => {
            if (result) result.textContent = 'Generation failed: ' + err;
            notifyApplied(false);
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
                // Task #2867: an uploaded image is server-validated, but the
                // browser loader is the final gate — only mark available if it
                // accepts the binary.
                _probeBootImage().then(buf => {
                    if (buf) {
                        try {
                            if (sim.loadBootImage(buf) === true) {
                                window.bootImage = buf;
                                window.bootImageAvailable = true;
                                _syncBootEntryFromSim();
                            } else {
                                window.bootImage = null;
                                window.bootImageAvailable = false;
                                _reportBootImageRejection(sim.lastBootImageError, result);
                            }
                        } catch(e) {
                            window.bootImage = null;
                            window.bootImageAvailable = false;
                            _reportBootImageRejection('Uploaded boot image could not be applied: ' + e.message, result);
                        }
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
    if (window._nsPrefetchDirty === undefined) window._nsPrefetchDirty = false;
    // Lazily warm the LumpRegistry server list so Source buttons appear even on
    // first NS view load, before the user has visited the Repository view.
    // _lumpsCacheWarmPending — in-flight guard; cleared on settle.
    //
    // Guard uses LumpRegistry.isServerListFetched() which is set by
    // registerFromServer() on any settled fetch (even an empty-repo result),
    // so renderLumps() fetching at page init correctly suppresses a second
    // fetch here — regardless of how many lumps the server returned.
    if (window.LumpRegistry && !window.LumpRegistry.isServerListFetched()) {
        window.LumpRegistry.warmServerList().then(function (lumps) {
            if (lumps && lumps.length > 0) updateNamespace();
        });
    }
    // --- Slot count stats ---
    // Use readNSEntry() so the inverted NS table layout is handled correctly.
    let _cntResident = 0, _cntLazy = 0, _cntGarbage = 0;
    const _cntMax = (sim.MAX_NS_ENTRIES != null) ? sim.MAX_NS_ENTRIES : 0;
    const _scanTo = Math.min(sim.nsCount || 0, _cntMax);
    for (let _si = 0; _si < _scanTo; _si++) {
        const _e = sim.readNSEntry(_si);
        if (!_e) continue;
        const _sw0 = _e.word0_location || 0;
        const _sw1 = _e.word1_limit    || 0;
        // Canonical NS ABI: gt_seq lives in W1[29:21] (not W2 — W2 is integrity32).
        const _gtSeq = sim.parseNSWord1(_sw1 >>> 0).gtSeq;
        if (_sw0 !== 0) {
            const _mfe = sim.lazyManifest ? sim.lazyManifest[_si] : null;
            let _notResident = false;
            if (_mfe && _sw0 > 0 && sim.parseLumpHeader) {
                const _hdr = sim.parseLumpHeader(sim.memory[_sw0]);
                if (_hdr && !_hdr.valid) _notResident = true;
            }
            if (_notResident) _cntLazy++; else _cntResident++;
        } else if (_gtSeq > 0) {
            // W0==0 but a bumped gt_seq survives in W1 → a GC-reclaimed (garbage) slot.
            _cntGarbage++;
        }
    }
    const _cntFree = Math.max(0, _cntMax - _cntResident - _cntLazy - _cntGarbage);
    const _statChip = (label, val, color, title) =>
        `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px 2px 7px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);font-size:0.72rem;white-space:nowrap;" title="${title}"><span style="color:${color};font-weight:600;">${label}</span><span style="color:#ccc;">${val}</span></span>`;
    let html = '<div class="ns-layout-header">NS_ENTRY_LAYOUT: 4 words per entry (128 bits; word3 reserved) \u2014 click a row to inspect memory</div>';
    html += `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 10px 4px;border-bottom:1px solid rgba(255,255,255,0.07);">`;
    html += _statChip('Max',      _cntMax,      '#a0a0b0', 'Total NS slots available in this boot image');
    html += _statChip('Resident', _cntResident, '#4ec9b0', 'Slots with lump code fully resident in DMEM');
    html += _statChip('Lazy Load',_cntLazy,     '#f0a040', 'Slots evicted — code loads on first CALL');
    html += _statChip('Garbage',  _cntGarbage,  '#f87171', 'Cleared slots — GT cycle count bumped, content zeroed');
    html += _statChip('Free',     _cntFree,     '#6a9f6a', 'Slots available for allocation');
    html += `<span id="nsBoltDrag" class="ns-bolt-drag" draggable="true" title="Drag \u26a1 onto any NS row to crown that abstraction as Boot.Thread.CR0 \u2014 the first abstraction invoked after boot">\u26a1 Boot entry</span>`;
    html += `<button id="nsSaveBtn" onclick="event.stopPropagation();_nsTableSave(this)" style="margin-left:auto;background:#1a2a1f;color:#7ec87e;border:1px solid rgba(100,200,100,0.35);border-radius:3px;padding:2px 10px;font-size:0.72rem;cursor:pointer;white-space:nowrap;" title="Save Namespace changes and load policies for the next build">\u{1F4BE} Save for next build</button>`;
    html += `<button onclick="event.stopPropagation();_nsTableAdd()" style="background:#1a2e1a;color:#4ec9b0;border:1px solid rgba(78,201,176,0.35);border-radius:3px;padding:2px 10px;font-size:0.72rem;cursor:pointer;white-space:nowrap;" title="Install a LUMP from the repository into the next free NS slot">+ Add LUMP</button>`;
    html += '</div>';
    // Bank custody status deliberately projects no raw NS slot, address,
    // contents, or credential. It is a safe operational view only.
    try {
        const bankBoxes = sim.systemAbstractions &&
            typeof sim.systemAbstractions.getBankLockboxes === 'function'
            ? sim.systemAbstractions.getBankLockboxes() : [];
        if (bankBoxes.length) {
            const badges = bankBoxes.map(box => {
                const color = box.state === 'deposited' ? '#4ec9b0'
                    : (box.state === 'revoked' ? '#f87171' : '#f0a040');
                const value = box.state === 'deposited'
                    ? `${box.contentsType} · ${box.contentsWords}w`
                    : box.state;
                return `<span style="border:1px solid ${color}66;color:${color};border-radius:9px;padding:2px 7px;font-size:0.7rem;">Lockbox ${box.lockboxId}: ${value}</span>`;
            }).join('');
            html += `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 10px;border-bottom:1px solid rgba(255,255,255,0.07);font-size:0.72rem;"><strong style="color:#c4a7ff;">Bank custody</strong>${badges}<span style="color:#777;">Credentials, locations, and stored words are hidden.</span></div>`;
        }
    } catch (_) { /* Namespace rendering must not depend on Bank availability. */ }
    html += '<table class="ns-table"><thead><tr>';
    html += '<th>Idx</th><th class="ns-label-col">Label</th>';
    html += '<th>W0: Location</th>';
    html += '<th>W1: Type</th><th>W1: F</th><th>W1: G</th><th>W1: Limit</th>';
    html += '<th>W1: Seq</th><th>W2: Integrity32</th>';
    html += '<th>Source</th>';
    html += '</tr></thead><tbody>';

    const typeNames = ['NULL','Inform','Outform','Abstract'];

    // Namespace Table is the primary policy surface.  Each slot has exactly
    // one policy; transport order, hashes, capacity and bridge details remain
    // derived implementation data.
    function _nsPrefetchRow(slot, manifest) {
        if (_isResidentIORegister(slot)) {
            return '<span class="ns-fixed-policy" title="Fixed MMIO capability; no LUMP source or identity">Resident I/O register</span>';
        }
        // The fixed boot catalog entries are always resident and are not
        // programmer-configurable; only user LUMP slots expose the selector.
        if (slot <= 10) {
            return '<span class="ns-fixed-policy" title="Boot catalog slots are always resident">Resident</span>';
        }
        if (!manifest || !manifest.bootUpload) return '';
        const cfg = window.bootConfig || {};
        const rows = cfg.step2 && Array.isArray(cfg.step2.lumps) ? cfg.step2.lumps : [];
        const saved = rows.find(row => row && row.nsSlot === slot) || null;
        const value = saved && (saved.loadPolicy || saved.load_policy) ||
            (saved && saved.resident ? 'Resident' : (saved && saved.prefetch ? 'Preload' : 'Lazy'));
        return `<select aria-label="Load policy for slot ${slot}" onchange="event.stopPropagation();_nsPrefetchChange(${slot},this.value)" style="margin-left:5px;background:#0d0d1a;color:#d0d0e8;border:1px solid #6b5320;border-radius:3px;font-size:0.68rem;padding:1px 3px;"><option ${value==='Empty'?'selected':''}>Empty</option><option ${value==='Resident'?'selected':''}>Resident</option><option ${value==='Preload'?'selected':''}>Preload</option><option ${value==='Lazy'?'selected':''}>Lazy</option></select>`;
    }

    // Keep the canonical identity compact in the Namespace Table.  The
    // complete dot.name/T-ID pair belongs in a row-local popup so long names
    // do not stretch the table or get confused with the policy control.
    window._nsShowIdentity = function(slot) {
        const existing = document.getElementById('_nsIdentityModalOverlay');
        if (existing) existing.remove();

        const entry = sim && typeof sim.readNSEntry === 'function' ? sim.readNSEntry(slot) : null;
        const src = (typeof _findSrcLump === 'function' && entry)
            ? _findSrcLump(slot, entry.label) : null;
        const identity = sim && typeof sim.getSlotIdentity === 'function'
            ? sim.getSlotIdentity(slot) : null;
        const dotName = (identity && identity.dotName) ||
            (src && (src.dotName || src.dot_name || src.abstraction)) ||
            (entry && entry.label) || 'Unavailable';
        const tId = (identity && identity.cacheToken != null)
            ? (identity.cacheToken >>> 0).toString(16).padStart(8, '0')
            : ((src && src.token) || 'Unavailable');

        const overlay = document.createElement('div');
        overlay.id = '_nsIdentityModalOverlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', `NS[${slot}] LUMP identity`);
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);padding:16px;box-sizing:border-box;';
        overlay.innerHTML = `
            <div style="background:#12121f;border:1px solid #2a2a4a;border-radius:8px;padding:20px 24px;min-width:320px;max-width:560px;width:100%;color:#d0d0e8;box-shadow:0 14px 48px rgba(0,0,0,0.45);">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;">
                    <div style="color:#c89b3c;font-size:1rem;font-weight:600;">LUMP identity · NS[${slot}]</div>
                    <button type="button" class="ns-identity-close" aria-label="Close identity popup" style="background:none;border:none;color:#888;font-size:1.2rem;cursor:pointer;padding:0 4px;">✕</button>
                </div>
                <div style="display:grid;grid-template-columns:auto 1fr;gap:10px 16px;align-items:baseline;font-size:0.82rem;">
                    <span style="color:#888;">dot.name</span>
                    <code style="color:#d0d0e8;overflow-wrap:anywhere;">${_escHtml(dotName)}</code>
                    <span style="color:#888;">T-ID</span>
                    <code style="color:#4ec9b0;overflow-wrap:anywhere;">${_escHtml(tId)}</code>
                </div>
            </div>`;
        overlay.addEventListener('click', function(event) {
            if (event.target === overlay || event.target.closest('.ns-identity-close')) overlay.remove();
        });
        document.body.appendChild(overlay);
        const close = overlay.querySelector('.ns-identity-close');
        if (close) close.focus();
    };

    window._nsPrefetchChange = function(slot, value) {
        // Boot catalog slots 0–10 are permanently resident.  Keep this guard
        // at the mutation boundary as well as in the renderer.
        if (slot <= 10 || _isResidentIORegister(slot)) return;
        const cfg = window.bootConfig || {};
        if (!cfg.step2) cfg.step2 = { lumps: [] };
        if (!Array.isArray(cfg.step2.lumps)) cfg.step2.lumps = [];
        let row = cfg.step2.lumps.find(item => item && item.nsSlot === slot);
        const manifest = sim.lazyManifest && sim.lazyManifest[slot];
        const src = (typeof _findSrcLump === 'function') ? _findSrcLump(slot, sim.nsLabels && sim.nsLabels[slot]) : null;
        if (!row) {
            row = {
                nsSlot: slot,
                resident: false,
                abstraction: (manifest && manifest.label) || (sim.nsLabels && sim.nsLabels[slot]) || ('Slot ' + slot),
                lumpToken: (src && src.token) || ''
            };
            cfg.step2.lumps.push(row);
        }
        row.loadPolicy = ['Empty', 'Resident', 'Preload', 'Lazy'].includes(value) ? value : 'Lazy';
        row.resident = row.loadPolicy === 'Resident'; // legacy readers
        // Source metadata is catalog-owned.  The server fills any omitted
        // binding, but retain a cached catalog record when it is available so
        // the pending Namespace row remains self-describing before save.
        if (row.loadPolicy === 'Preload' && src) {
            row.abstraction = src.dot_name || src.dotName || src.abstraction || row.abstraction;
            row.lumpToken = src.token || row.lumpToken;
            const size = src.lumpSize != null ? src.lumpSize : src.lump_size;
            const binaryHash = src.binaryHash || src.binary_hash;
            const identityHash = src.identityHash || src.identity_hash;
            if (Number.isInteger(size)) row.lumpSize = size;
            if (binaryHash) row.binaryHash = binaryHash;
            if (identityHash) row.identityHash = identityHash;
            row.grants = Array.isArray(src.grants) ? src.grants.slice() :
                (Array.isArray(src.rights) ? src.rights.slice() : []);
            row.capabilityType = src.capabilityType ?? src.capability_type ??
                src.gtType ?? src.gt_type ?? src.type;
            row.cacheToken = src.cacheToken ?? src.cache_token ?? null;
            row.authorized = src.authorized === true || src.authorization === true ||
                src.install_authorized === true;
        }
        delete row.prefetch;
        delete row.prefetchRequired;
        delete row.prefetchOrder;
        delete row.downloadUrl;
        window._nsPrefetchDirty = true;
        _setNsDirty(true);
        updateNamespace();
    };

    // Build a complete config even on a fresh project.  The old UI required
    // opening Builder and saving Step 1 before Namespace policies could be
    // saved.  That was an implementation detail leaking into the user flow.
    window._ensureNamespaceBuildConfig = async function() {
        const localCfg = (window.bootConfig && typeof window.bootConfig === 'object')
            ? window.bootConfig : {};
        let selectedBootEntry = null;
        try {
            const storedBootEntry = Number.parseInt(localStorage.getItem('bootEntrySlot'), 10);
            if (Number.isInteger(storedBootEntry) && storedBootEntry >= 0) {
                selectedBootEntry = storedBootEntry;
            }
        } catch (_) {}
        let serverData = null;
        if (!localCfg.step1) {
            const configResponse = await fetch('/api/boot-config');
            serverData = await configResponse.json();
            if (!configResponse.ok) {
                throw new Error((serverData && serverData.error) || `HTTP ${configResponse.status}`);
            }
        }
        const baseCfg = (serverData && (serverData.config || serverData.defaults)) || {};
        const cfg = {
            targetBoard: localCfg.targetBoard || baseCfg.targetBoard || 'wukong-xc7a100t',
            bootEntrySlot: selectedBootEntry != null
                ? selectedBootEntry
                : (Number.isInteger(localCfg.bootEntrySlot)
                    ? localCfg.bootEntrySlot
                    : (Number.isInteger(baseCfg.bootEntrySlot) ? baseCfg.bootEntrySlot : 6)),
            step1: localCfg.step1 || baseCfg.step1,
            step2: localCfg.step2 || baseCfg.step2 || { lumps: [] },
            step3: localCfg.step3 || baseCfg.step3 || { emptySlotCount: 0 }
        };
        if (!cfg.step1) {
            throw new Error('The default build configuration is unavailable.');
        }
        const response = await fetch('/api/boot-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetBoard: cfg.targetBoard,
                bootEntrySlot: cfg.bootEntrySlot,
                step1: cfg.step1,
                step2: cfg.step2 || { lumps: [] },
                step3: cfg.step3 || { emptySlotCount: 0 }
            })
        });
        const body = await response.json();
        if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
        _setActiveBootConfig(
            body.config || cfg,
            body.bootImageInvalidated === true,
            body.invalidatedBootImageWords
        );
        window._nsPrefetchDirty = false;
        return window.bootConfig;
    };

    window._nsPrefetchSave = async function() {
        return window._ensureNamespaceBuildConfig();
    };
    window._nsPrefetchSaveClick = async function(btn) {
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Saving…';
        }
        try {
            await window._nsPrefetchSave();
            if (btn) {
                btn.textContent = '✓ Prefetch saved';
                btn.style.color = '#4ec9b0';
                setTimeout(() => {
                    btn.disabled = false;
                    btn.textContent = 'Save for next build';
                    btn.style.color = '';
                }, 1800);
            }
        } catch (err) {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '⚠ ' + err.message;
                btn.style.color = '#f87171';
            }
        }
    };
    for (let i = 0; i < sim.nsCount; i++) {
        const e = sim.readNSEntry(i);
        if (!e) {
            html += `<tr id="ns-row-${i}" class="ns-row" style="opacity:0.45;">`;
            html += `<td class="ns-idx-cell"><span style="color:#666;">${i}</span></td>`;
            const _gapLabel = (sim.nsLabels && sim.nsLabels[i] && sim.nsLabels[i] !== '(free)' && sim.nsLabels[i] !== '(reserved)') ? sim.nsLabels[i] : '';
            if (_gapLabel) {
                html += `<td style="color:#666;font-style:italic;">${_gapLabel}</td>`;
                html += `<td colspan="7" style="color:#555;font-style:italic;font-size:0.8rem;">(no DMEM entry)</td>`;
            } else {
                html += `<td colspan="8" style="color:#555;font-style:italic;font-size:0.8rem;">(no entry installed)</td>`;
            }
            html += `<td class="ns-entry-actions"></td>`;
            html += '</tr>';
            continue;
        }
        const privateBankSlot = sim._bankPrivateSlots && sim._bankPrivateSlots[i];
        if (privateBankSlot) {
            html += `<tr id="ns-row-${i}" class="ns-row" style="opacity:0.78;">`;
            html += `<td class="ns-idx-cell"><span style="color:#8f7ac8;">◈</span></td>`;
            html += `<td class="ns-label" style="color:#c4a7ff;">Bank private custody</td>`;
            html += `<td colspan="6" style="color:#777;font-size:0.78rem;">Lockbox ${privateBankSlot.lockboxId} — protected backing record</td>`;
            html += `<td class="ns-entry-actions"></td></tr>`;
            continue;
        }
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
        // Canonical NS ABI: gt_seq is W1[29:21] (authority); W2 is integrity32.
        const ver = lim.gtSeq;
        const seal = e.word2_seals >>> 0;
        const isBootNS = (i === bootEntrySlot);
        const warmStyle = codeNotResident ? 'color:#f0a040;font-style:italic;' : '';
        const rowOpacity = codeNotResident ? 'opacity:0.8;' : '';
        const isStub = sim._nsStubFlags && sim._nsStubFlags[i] === true;
        const stubLabelStyle = isStub ? 'color:#f87171;' : '';
        const stubBadge = isStub ? ' <span style="color:#f87171;font-size:0.7rem;" title="Stub fault \u2014 all methods are bare stubs; calls will fault">\u26d4</span>' : '';
        const _clearBtn = (i >= 2 && i !== bootEntrySlot)
            ? `<button class="btn btn-xs" onclick="event.stopPropagation();_nsTableClear(${i})" style="background:#2e1a1a;color:#f87171;border:1px solid rgba(248,113,113,0.35);margin-right:4px;font-size:0.65rem;padding:1px 5px;" title="Clear slot — bumps the GT cycle count to revoke all existing tokens for this slot">Clear</button>`
            : '';
        html += `<tr id="ns-row-${i}" class="ns-row" data-ns-slot="${i}" style="${rowOpacity}">`;
        html += `<td class="ns-idx-cell" style="white-space:nowrap;">${_clearBtn}<span class="ns-boot-btn${isBootNS ? ' boot-entry-active' : ''}" onclick="event.stopPropagation();setBootEntrySlot(${i})" title="${isBootNS ? 'Current boot entry' : 'Set as boot entry'}">${isBootNS ? '\u26a1' : i}</span></td>`;
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
        html += `<td class="ns-label ns-label-clickable" style="${warmStyle}${stubLabelStyle}cursor:pointer;text-decoration:underline dotted;" onclick="_nsLabelOpen(${i})" title="Open full view for NS[${i}]">${nsLabelInner}${stubBadge}</td>`;
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
        html += `<td style="${warmStyle}">0x${seal.toString(16).toUpperCase().padStart(8, '0')}</td>`;
        {
            const _srcLump = _findSrcLump(i, e.label);
            const _srcToken = _srcLump ? _srcLump.token : null;
            const _residentIO = _isResidentIORegister(i);
            const _identityBtn = (i > 10 && !_residentIO)
                ? `<button type="button" class="btn btn-xs ns-identity-btn" aria-haspopup="dialog" onclick="event.stopPropagation();_nsShowIdentity(${i})" style="background:#27233b;color:#c4a7ff;border:1px solid rgba(196,167,255,0.35);margin-left:5px;font-size:0.65rem;padding:1px 5px;" title="Show canonical dot.name and T-ID">Identity</button>`
                : '';
            // Show Source for Inform (gtType 1) and Outform (gtType 2) only.
            // Hide for Null (0), Abstract (3), Thread slots, and hardware I/O caps.
            // has_source is intentionally NOT checked — lumps saved before source persistence
            // was active (e.g. SelfTest, Tunnel) have has_source:false but real CLOOMC source.
            //
            // Hardware exclusion covers three name spaces:
            //   • NS entry labels used in the boot catalog  (LED_DEV, UART_DEV, …)
            //   • HW_NAMESPACE labels (LED, UART, Button, Timer, Display at slots 11-15)
            //   • User-facing cap names from _isHardwareCapName (LED0-5, UART, BTN, …)
            //   • Namespace-root entry (Boot.NS)
            const _hideSource = (e.gtType !== 1 && e.gtType !== 2) ||
                                _isThreadNamespaceSlot(i, e) ||
                                _hwCapRe.test(e.label || '') ||
                                _residentIO;
            if (codeNotResident) {
                html += `<td class="ns-entry-actions"><span style="${warmStyle}">not resident</span>${_nsPrefetchRow(i, manifest)}${_identityBtn}</td>`;
            } else {
                let _srcBtn = '';
                if (!_hideSource) {
                    // Prefer the cached token; fall back to the NS slot index so
                    // _openLumpSource can do a safe label lookup without needing to
                    // embed a label string inside an HTML attribute (injection-safe).
                    const _onclickTarget = _srcToken
                        ? `'${_srcToken}'`
                        : `null,${i}`;
                    _srcBtn = `<button class="btn btn-xs" onclick="event.stopPropagation();_openLumpSource(${_onclickTarget})" style="background:#2d4a3e;color:#4ec9b0;border:1px solid rgba(78,201,176,0.35);" title="Open source in Repository view">Source</button>`;
                }
                html += `<td class="ns-entry-actions">${_srcBtn}${_nsPrefetchRow(i, manifest)}${_identityBtn}</td>`;
            }
        }
        html += '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;
    _initNSBolt();
    // Restore dirty indicator after re-render (innerHTML wipes the previous button state)
    _setNsDirty(window._nsTableDirty);
}

// ── NS table: boot-entry drag bolt ────────────────────────────────────────────
// Wires up drag-and-drop on the ⚡ bolt in the NS table toolbar.
// Dragging the bolt onto any NS row calls setBootEntrySlot(i), crowning that
// abstraction as Boot.Thread.CR0 — the first abstraction invoked after boot.
function _initNSBolt() {
    const bolt = document.getElementById('nsBoltDrag');
    if (!bolt) return;

    bolt.addEventListener('dragstart', function(e) {
        e.dataTransfer.setData('text/plain', 'nsBoot');
        e.dataTransfer.effectAllowed = 'move';
    });

    document.querySelectorAll('#namespaceTable tr[data-ns-slot]').forEach(function(row) {
        const slotIdx = parseInt(row.getAttribute('data-ns-slot'), 10);
        row.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            row.classList.add('ns-row-drop-active');
        });
        row.addEventListener('dragleave', function() {
            row.classList.remove('ns-row-drop-active');
        });
        row.addEventListener('drop', function(e) {
            e.preventDefault();
            row.classList.remove('ns-row-drop-active');
            if (e.dataTransfer.getData('text/plain') !== 'nsBoot') return;
            if (typeof setBootEntrySlot === 'function') setBootEntrySlot(slotIdx);
            _setNsDirty(true);
        });
    });
}

// ── NS table: Add LUMP ────────────────────────────────────────────────────────
// Fetch the server lump list, filter out lumps already live in the NS table,
// and show a picker modal with a full metadata panel. On Install, copy the
// lump binary into the extended DMEM region and write a valid NS entry using
// the programmer's chosen load mode, slot, policy and GT type.

// Module-level state shared between _nsTableAdd and _nsTableAddConfirm.
window._nsAddCurrentApproval = null;   // hash-bound approval view for selected LUMP
window._nsAddAvailableList   = null;   // full _available array from last list fetch
window._nsAddCurrentWords        = null;   // cached words[] from per-selection /words fetch
window._nsAddCurrentToken        = null;   // token these cached words belong to
window._nsAddCurrentInspection = null; // immutable-binary inspection for selected LUMP

// Persistent token-keyed cache for ns_slot_policy / ns_slot choices made by the
// programmer.  Unlike the per-modal state above, this is intentionally NOT cleared
// by _nsTableAdd() so that re-opening the ADD modal pre-populates the fields with
// the previous install's choices even before the async PATCH reaches the server.
// Keys are LUMP token strings; values are { ns_slot_policy, ns_slot }.
window._nsPersistedSlotMeta = window._nsPersistedSlotMeta || {};

/* ---- NS_SLOT_PERSIST_UNIT_TEST_EXPORT_START ---- */
// Pure helpers extracted for unit testing.  These mirror the inline logic in
// _nsPopulateAddMeta (cache overlay) and _nsTableAddConfirm (persist-on-install)
// without any DOM or fetch dependency.
//
// _nsSlotPolicyResolve: given approved display hints, a token, and Namespace state,
//   return the { nsSlotVal, policy } pair that the ADD modal should display.
//   Mirrors the overlay block at the top of _nsPopulateAddMeta.
function _nsSlotPolicyResolve(approvedMetadata, token, nsPersistedSlotMeta) {
    const _persistedSlotMeta = nsPersistedSlotMeta && nsPersistedSlotMeta[token];
    if (_persistedSlotMeta) {
        if (_persistedSlotMeta.ns_slot_policy !== undefined) {
            approvedMetadata = Object.assign({}, approvedMetadata, { ns_slot_policy: _persistedSlotMeta.ns_slot_policy });
        }
        if (_persistedSlotMeta.ns_slot !== undefined) {
            approvedMetadata = Object.assign({}, approvedMetadata, { ns_slot: _persistedSlotMeta.ns_slot });
        }
    }
    const rawSlot   = approvedMetadata.ns_slot;
    // Slots above the built-in catalog were formerly used as private,
    // hard-coded identities.  Treat those values as legacy metadata unless
    // the programmer explicitly saved the choice in this session.
    const hasExplicitSavedSlot = _persistedSlotMeta &&
        _persistedSlotMeta.ns_slot !== undefined &&
        _persistedSlotMeta.ns_slot !== null &&
        _persistedSlotMeta.ns_slot !== '';
    const legacyHighSlot = !hasExplicitSavedSlot &&
        Number.isInteger(Number(rawSlot)) && Number(rawSlot) > 10;
    const nsSlotVal = legacyHighSlot
        ? ''
        : ((rawSlot !== null && rawSlot !== undefined) ? String(rawSlot) : '');
    const policy    = legacyHighSlot
        ? 'dynamic'
        : (approvedMetadata.ns_slot_policy || (nsSlotVal !== '' ? 'static' : 'dynamic'));
    return { nsSlotVal, policy };
}
// _nsSlotPersistRecord: given the user's chosen policy and the allocated slot,
//   return { patchedPolicy, patchedSlot } — the values written to both the PATCH
//   body and to window._nsPersistedSlotMeta[token] in _nsTableAddConfirm.
function _nsSlotPersistRecord(slotPolicy, slot) {
    const patchedPolicy = slotPolicy;
    const patchedSlot   = slotPolicy === 'dynamic' ? null : slot;
    return { patchedPolicy, patchedSlot };
}

async function _nsHashImmutableWords(words) {
    if (!Array.isArray(words) || words.length === 0 ||
        typeof crypto === 'undefined' || !crypto.subtle) {
        throw new Error('SHA-256 inspection of immutable words is unavailable');
    }
    const bytes = new Uint8Array(words.length * 4);
    words.forEach(function(word, index) {
        const value = Number(word) >>> 0;
        bytes[index * 4] = value >>> 24;
        bytes[index * 4 + 1] = value >>> 16;
        bytes[index * 4 + 2] = value >>> 8;
        bytes[index * 4 + 3] = value;
    });
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), function(byte) {
        return byte.toString(16).padStart(2, '0');
    }).join('');
}

function _nsMatchingApproval(wordsPayload, listedApproval, binaryHash) {
    const embeddedApproval = wordsPayload && wordsPayload.approved_metadata;
    const fromEmbeddedApproval = embeddedApproval && typeof embeddedApproval === 'object';
    const candidate = embeddedApproval && typeof embeddedApproval === 'object'
        ? embeddedApproval : listedApproval;
    if (!candidate || typeof candidate !== 'object') return null;
    if (!fromEmbeddedApproval && candidate.approved !== true) return null;
    const record = candidate.metadata && typeof candidate.metadata === 'object'
        ? Object.assign({}, candidate, candidate.metadata) : candidate;
    const approvedHash = String(record.binary_hash || record.artifact_hash || '').toLowerCase();
    return approvedHash === binaryHash && /^[0-9a-f]{64}$/.test(approvedHash)
        ? record : null;
}
/* ---- NS_SLOT_PERSIST_UNIT_TEST_EXPORT_END ---- */

function _nsTableAdd() {
    if (!sim) return;
    const _existing = document.getElementById('_nsAddModalOverlay');
    if (_existing) _existing.remove();
    window._nsAddCurrentApproval      = null;
    window._nsAddAvailableList        = null;
    window._nsAddCurrentWords         = null;
    window._nsAddCurrentToken         = null;
    window._nsAddCurrentInspection    = null;

    // Show loading overlay immediately
    const _overlay = document.createElement('div');
    _overlay.id = '_nsAddModalOverlay';
    _overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
    _overlay.innerHTML = '<div style="background:#12121f;border:1px solid #2a2a4a;border-radius:8px;padding:24px 28px;min-width:340px;max-width:580px;width:100%;color:#d0d0e8;font-size:0.85rem;max-height:90vh;overflow-y:auto;"><div style="color:#c89b3c;font-size:1rem;font-weight:600;margin-bottom:12px;">+ Add LUMP to Namespace</div><div id="_nsAddStatus" style="color:#888;">Loading LUMP list\u2026</div></div>';
    _overlay.addEventListener('click', function(ev) { if (ev.target === _overlay) _overlay.remove(); });
    document.body.appendChild(_overlay);

    fetch('/api/lumps/list')
        .then(function(r) { return r.ok ? r.json() : Promise.reject('HTTP ' + r.status); })
        .then(function(list) {
            if (!Array.isArray(list) || list.length === 0) {
                document.getElementById('_nsAddStatus').textContent = 'No LUMPs available on the server.';
                return;
            }

            // Build set of tokens already in the NS table (by _tokenSlotMap or fixed ns_slot)
            const _occupied = new Set();
            if (sim._tokenSlotMap) {
                for (const [tok] of sim._tokenSlotMap) _occupied.add(tok);
            }
            // Only exclude LUMPs whose token is already installed (occupied slot is not
            // a pre-filter: the programmer can override the slot in the Install Options
            // section, so the LUMP stays selectable even if its default ns_slot is taken).
            const _available = list.filter(function(l) {
                return !_occupied.has(l.token);
            });

            if (_available.length === 0) {
                document.getElementById('_nsAddStatus').textContent = 'All server LUMPs are already installed in the namespace.';
                return;
            }

            window._nsAddAvailableList = _available;

            // Render picker
            const inner = _overlay.querySelector('div');
            let optHtml = '';
            for (const l of _available) {
                const name = (l.abstraction || l.name || l.token).replace(/</g,'&lt;').replace(/>/g,'&gt;');
                optHtml += `<option value="${l.token}">${name}</option>`;
            }
            inner.innerHTML = `
                <div style="color:#c89b3c;font-size:1rem;font-weight:600;margin-bottom:12px;">+ Add LUMP to Namespace</div>
                <div style="margin-bottom:8px;color:#888;font-size:0.8rem;">${_available.length} LUMP${_available.length === 1 ? '' : 's'} available</div>
                <select id="_nsAddSelect" style="width:100%;background:#0d0d1a;color:#d0d0e8;border:1px solid #2a2a4a;border-radius:4px;padding:6px 8px;font-size:0.85rem;margin-bottom:10px;">${optHtml}</select>
                <div id="_nsAddMeta" style="margin-bottom:8px;"></div>
                <div id="_nsAddError" style="color:#f87171;font-size:0.78rem;min-height:1.2em;margin-bottom:8px;"></div>
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button onclick="document.getElementById('_nsAddModalOverlay').remove()" style="background:transparent;color:#888;border:1px solid #2a2a4a;border-radius:4px;padding:5px 14px;font-size:0.82rem;cursor:pointer;">Cancel</button>
                    <button id="_nsAddConfirmBtn" onclick="_nsTableAddConfirm()" style="background:#1a4a2e;color:#4ec9b0;border:1px solid rgba(78,201,176,0.4);border-radius:4px;padding:5px 14px;font-size:0.82rem;cursor:pointer;font-weight:600;">Install</button>
                </div>`;

            // Wire change event → populate metadata panel
            const sel = document.getElementById('_nsAddSelect');
            sel.addEventListener('change', function() { _nsPopulateAddMeta(sel.value); });
            // Populate for the initially selected LUMP immediately
            _nsPopulateAddMeta(sel.value);
        })
        .catch(function(err) {
            const st = document.getElementById('_nsAddStatus');
            if (st) st.textContent = 'Failed to load LUMP list: ' + err;
        });
}

// ── Render the metadata panel below the LUMP dropdown ─────────────────────────
// Called on initial render and every time the dropdown changes.
// Performs a real per-selection fetch of /api/lump/<token>/words to get
// authoritative cw/cc from the binary; shows spinner while loading, error inline
// on failure. Caches fetched words in window._nsAddCurrentWords for confirm.
async function _nsPopulateAddMeta(token) {
    const container = document.getElementById('_nsAddMeta');
    if (!container) return;

    const approval = (window._nsAddAvailableList || []).find(function(l) { return l.token === token; }) || null;

    if (!approval) { container.innerHTML = ''; return; }

    // ── Per-selection fetch: immutable binary words only ──────────────────────
    container.innerHTML = '<div style="color:#888;font-size:0.78rem;padding:6px 0;">&#9680; Loading LUMP metadata\u2026</div>';

    // Disable Install while metadata is loading so confirm cannot run with stale data.
    const _cfBtn = document.getElementById('_nsAddConfirmBtn');
    if (_cfBtn) { _cfBtn.disabled = true; _cfBtn.title = 'Waiting for LUMP metadata\u2026'; }

    let approvedMetadata = null;
    let artifactDetail = window._nsAddCurrentInspection;
    let binaryCw = null, binaryCc = null;

    // Cache hit: same token and immutable-binary inspection already fetched.
    if (window._nsAddCurrentToken === token && window._nsAddCurrentWords && window._nsAddCurrentInspection) {
        const hdr = sim ? sim.parseLumpHeader(window._nsAddCurrentWords[0] >>> 0) : null;
        if (hdr && hdr.valid) { binaryCw = hdr.cw; binaryCc = hdr.cc; }
        approvedMetadata = window._nsAddCurrentApproval;
    } else {
        window._nsAddCurrentApproval = null;
        try {
            const wordsResp = await fetch('/api/lump/' + token + '/words', { cache: 'no-store' });

            // Stale-guard: abort if user changed selection while fetching.
            const nowSel = document.getElementById('_nsAddSelect');
            if (!nowSel || nowSel.value !== token) return;

            if (!wordsResp.ok) throw new Error('HTTP ' + wordsResp.status + ' from /words');

            const wordsData = await wordsResp.json();

            // Cache words + parse authoritative cw/cc/lumpSize from binary header.
            const words = Array.isArray(wordsData) ? wordsData
                        : (wordsData && Array.isArray(wordsData.words) ? wordsData.words : null);
            if (!words || words.length === 0) throw new Error('Empty word list from /words');

            window._nsAddCurrentWords = words;
            window._nsAddCurrentToken = token;

            const hdr = sim ? sim.parseLumpHeader(words[0] >>> 0) : null;
            if (hdr && hdr.valid) { binaryCw = hdr.cw; binaryCc = hdr.cc; }
            const inspect = typeof LumpContentFrame !== 'undefined' &&
                LumpContentFrame && LumpContentFrame.lumpInspectContentFrame;
            if (!inspect) throw new Error('Binary content inspector is unavailable');
            window._nsAddCurrentInspection = await inspect(words);
            artifactDetail = window._nsAddCurrentInspection;
            const actualBinaryHash = await _nsHashImmutableWords(words);
            approvedMetadata = _nsMatchingApproval(wordsData, approval, actualBinaryHash);
            window._nsAddCurrentApproval = approvedMetadata;

        } catch (fetchErr) {
            const nowSel2 = document.getElementById('_nsAddSelect');
            if (!nowSel2 || nowSel2.value !== token) return;
            container.innerHTML = `<div style="color:#f87171;font-size:0.78rem;padding:4px 0;">&#9888; Failed to load LUMP: ${String(fetchErr).replace(/</g,'&lt;')}</div>`;
            return;
        }
    }

    // ── Overlay persistent slot-policy choices + compute editable-field defaults ─
    // _nsSlotPolicyResolve() applies the in-memory cache (window._nsPersistedSlotMeta)
    // on top of approved hints, then derives { nsSlotVal, policy }.
    // window._nsPersistedSlotMeta is NOT cleared by _nsTableAdd(), so it carries the
    // programmer's last-chosen policy and slot across modal lifecycles and before the
    // async PATCH reaches the server.  The shared helper is unit-tested in
    // test_ns_slot_modal_persist.js so drift between test and production is impossible.
    const { nsSlotVal, policy } = _nsSlotPolicyResolve(
        approvedMetadata || {}, token, window._nsPersistedSlotMeta);

    // Approved fields are presentation hints only; Namespace owns placement.
    const displayMetadata = approvedMetadata || {};
    const bootResident  = !!(displayMetadata.boot_resident);
    const loadPolicyDefault = ['Resident', 'Preload', 'Lazy'].includes(
        displayMetadata.loadPolicy || displayMetadata.load_policy)
        ? (displayMetadata.loadPolicy || displayMetadata.load_policy)
        : (bootResident ? 'Resident' : 'Lazy');
    const typField      = binaryCc !== null && window._nsAddCurrentWords
        ? ((window._nsAddCurrentWords[0] >>> 8) & 0x03) : 0;
    const contentType   = typField === 2 ? 'outform' : 'code';
    const gtTypeDefault = (contentType === 'outform' || typField === 2) ? 2 : 1;

    // ── Read-only display helpers ─────────────────────────────────────────────
    const esc = function(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    const grants    = Array.isArray(displayMetadata.grants) ? displayMetadata.grants.join(', ') : esc(displayMetadata.grants || 'E');
    const descText  = esc(displayMetadata.description || '');

    // Capabilities table — shows index, name, target NS slot, and permissions.
    let capsHtml = '<span style="color:#6b7280;font-size:0.75rem;">None</span>';
    if (Array.isArray(displayMetadata.capabilities) && displayMetadata.capabilities.length > 0) {
        capsHtml = '<table style="width:100%;border-collapse:collapse;font-size:0.72rem;margin-top:3px;">'
            + '<tr style="color:#a78bfa;">'
            + '<th style="text-align:left;padding:1px 5px;">#</th>'
            + '<th style="text-align:left;padding:1px 5px;">Name</th>'
            + '<th style="text-align:left;padding:1px 5px;">NS slot</th>'
            + '<th style="text-align:left;padding:1px 5px;">Perm</th></tr>';
        for (let ci = 0; ci < displayMetadata.capabilities.length; ci++) {
            const cap           = displayMetadata.capabilities[ci];
            const capName       = esc(cap.name || '—');
            const nsSlotDisplay = cap.ns_slot != null ? cap.ns_slot : '—';
            const permDisplay   = Array.isArray(cap.grants) ? cap.grants.join(',')
                                : (cap.grants ? esc(cap.grants) : (cap.permissions ? esc(cap.permissions) : 'E'));
            capsHtml += `<tr>`
                + `<td style="padding:1px 5px;color:#888;">${ci}</td>`
                + `<td style="padding:1px 5px;">${capName}</td>`
                + `<td style="padding:1px 5px;color:#6b7280;">${nsSlotDisplay}</td>`
                + `<td style="padding:1px 5px;color:#4ec9b0;">${permDisplay}</td></tr>`;
        }
        capsHtml += '</table>';
    }

    // ── Shared style strings ──────────────────────────────────────────────────
    const sLabel   = 'color:#a78bfa;font-size:0.7rem;font-weight:600;letter-spacing:0.04em;margin-bottom:3px;display:block;text-transform:uppercase;';
    const sRoVal   = 'color:#d0d0e8;font-size:0.79rem;';
    const sInput   = 'background:#0d0d1a;color:#d0d0e8;border:1px solid #2a2a4a;border-radius:3px;padding:3px 6px;font-size:0.79rem;width:100%;box-sizing:border-box;';
    const sSelect  = 'background:#0d0d1a;color:#d0d0e8;border:1px solid #2a2a4a;border-radius:3px;padding:3px 5px;font-size:0.79rem;width:100%;box-sizing:border-box;';
    const sCard    = 'background:#0d0d1a;border:1px solid #1e1e3a;border-radius:6px;padding:10px 12px;margin-bottom:6px;';
    const sGH      = 'color:#c89b3c;font-size:0.7rem;font-weight:700;letter-spacing:0.06em;margin-bottom:7px;';

    const cwDisplay = binaryCw != null ? binaryCw : '—';
    const ccDisplay = binaryCc != null ? binaryCc : '—';

    container.innerHTML = `
        <div style="${sCard}">
            <div style="${sGH}">INSTALL OPTIONS</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <div>
                    <span style="${sLabel}">Load Policy</span>
                    <select id="_nsLoadPolicy" style="${sSelect}" title="The IDE derives transport, capacity, hash, and Namespace metadata.">
                        <option value="Resident" ${loadPolicyDefault === 'Resident' ? 'selected' : ''}>Resident</option>
                        <option value="Preload" ${loadPolicyDefault === 'Preload' ? 'selected' : ''}>Preload</option>
                        <option value="Lazy" ${loadPolicyDefault === 'Lazy' ? 'selected' : ''}>Lazy load</option>
                    </select>
                    <div style="color:#6b7280;font-size:0.68rem;margin-top:3px;">Empty is available from an installed Namespace row.</div>
                </div>
                <div>
                    <span style="${sLabel}">NS Slot</span>
                    <input type="number" id="_nsSlotInput" min="11" max="${sim.MAX_NS_ENTRIES - 1}"
                           placeholder="Auto-assign" value="${nsSlotVal}" style="${sInput}">
                    <div style="color:#6b7280;font-size:0.68rem;margin-top:2px;">Blank = auto (first free slot ≥ 11)</div>
                </div>
                <div>
                    <span style="${sLabel}">Slot Policy</span>
                    <select id="_nsSlotPolicy" style="${sSelect}">
                        <option value="static"  ${policy === 'static'  ? 'selected' : ''}>Static</option>
                        <option value="dynamic" ${policy === 'dynamic' ? 'selected' : ''}>Dynamic</option>
                    </select>
                </div>
                <div>
                    <span style="${sLabel}">GT Type</span>
                    <select id="_nsGtType" style="${sSelect}">
                        <option value="1" ${gtTypeDefault === 1 ? 'selected' : ''}>Inform (code/thread)</option>
                        <option value="2" ${gtTypeDefault === 2 ? 'selected' : ''}>Outform (data)</option>
                    </select>
                </div>
            </div>
        </div>
        <div style="${sCard}">
            <div style="${sGH}">LUMP METADATA</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px 12px;font-size:0.78rem;">
                <div><span style="${sLabel}">Token</span>
                     <span style="${sRoVal};font-family:monospace;">${esc(displayMetadata.token || token || '—')}</span></div>
                <div><span style="${sLabel}">Canonical dot.name</span>
                     <span style="${sRoVal}">${esc(displayMetadata.dot_name || displayMetadata.dotName || (artifactDetail && artifactDetail.apiDefinition && artifactDetail.apiDefinition.name) || approval.abstraction || approval.name || '—')}</span></div>
                <div><span style="${sLabel}">T-ID</span>
                     <span style="${sRoVal};font-family:monospace;">${esc(displayMetadata.cache_token || token || '—')}</span></div>
                <div><span style="${sLabel}">Code Words (CW)</span>
                     <span style="${sRoVal}">${cwDisplay}</span></div>
                <div><span style="${sLabel}">C-List (CC)</span>
                     <span style="${sRoVal}">${ccDisplay}</span></div>
                <div><span style="${sLabel}">Grants</span>
                     <span style="${sRoVal}">${grants}</span></div>
                <div><span style="${sLabel}">Language</span>
                     <span style="${sRoVal}">${esc(displayMetadata.language || (artifactDetail && artifactDetail.apiDefinition && artifactDetail.apiDefinition.language) || '—')}</span></div>
                <div><span style="${sLabel}">Version</span>
                     <span style="${sRoVal}">${esc(displayMetadata.version || '—')}</span></div>
                <div><span style="${sLabel}">Author</span>
                     <span style="${sRoVal}">${esc(displayMetadata.author || '—')}</span></div>
                ${displayMetadata.profile ? `<div><span style="${sLabel}">Profile</span>
                     <span style="${sRoVal}">${esc(displayMetadata.profile)}</span></div>` : ''}
                ${descText ? `<div style="grid-column:1/-1"><span style="${sLabel}">Description</span>
                     <div style="color:#b0b0c8;font-size:0.74rem;max-height:52px;overflow-y:auto;line-height:1.4;">${descText}</div></div>` : ''}
            </div>
            ${(Array.isArray(displayMetadata.capabilities) && displayMetadata.capabilities.length > 0) ? `
            <div style="margin-top:8px;">
                <span style="${sLabel}">Capabilities</span>
                ${capsHtml}
            </div>` : ''}
        </div>`;

    // Metadata fully loaded — re-enable Install.
    const _cfBtn2 = document.getElementById('_nsAddConfirmBtn');
    if (_cfBtn2) { _cfBtn2.disabled = false; _cfBtn2.title = ''; }
}

function _nsTableAddConfirm() {
    const sel = document.getElementById('_nsAddSelect');
    const errEl = document.getElementById('_nsAddError');
    const confirmBtn = document.getElementById('_nsAddConfirmBtn');
    if (!sel || !sim) return;
    const token = sel.value;
    const name = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : token;
    if (!token) { if (errEl) errEl.textContent = 'Please select a LUMP.'; return; }

    // Guard: refuse to install until immutable binary inspection has completed.
    // _nsPopulateAddMeta keeps Install disabled while loading, but this catch handles
    // any race where confirm fires before the async fetch completes.
    if (!window._nsAddCurrentWords || window._nsAddCurrentToken !== token) {
        if (errEl) errEl.textContent = 'LUMP metadata is still loading — please wait a moment and try again.';
        return;
    }

    const approvedMetadata = window._nsAddCurrentApproval;
    const artifactDetail = window._nsAddCurrentInspection;

    // ── Read editable field values ────────────────────────────────────────────
    const loadPolicyEl  = document.getElementById('_nsLoadPolicy');
    const loadPolicy    = loadPolicyEl ? loadPolicyEl.value : 'Lazy';
    const loadMode      = loadPolicy === 'Resident' ? 'resident' : 'lazy';
    const slotInputEl   = document.getElementById('_nsSlotInput');
    const slotInputVal  = slotInputEl ? slotInputEl.value.trim() : '';
    const gtTypeEl      = document.getElementById('_nsGtType');
    const gtType        = gtTypeEl ? parseInt(gtTypeEl.value, 10) : 1;
    const policyEl      = document.getElementById('_nsSlotPolicy');
    const slotPolicy    = policyEl ? policyEl.value : 'static';

    // ── NS slot validation (only for static policy with explicit slot) ─────────
    let userSlot = null;
    if (slotPolicy !== 'dynamic' && slotInputVal !== '') {
        userSlot = parseInt(slotInputVal, 10);
        const firstUserSlot = sim.firstUserNsSlot();
        if (isNaN(userSlot) || userSlot < firstUserSlot || userSlot >= sim.MAX_NS_ENTRIES) {
            if (errEl) errEl.textContent = `Slot must be between ${firstUserSlot} and ${sim.MAX_NS_ENTRIES - 1}.`;
            return;
        }
        if (sim.isNSEntryValid(userSlot)) {
            if (errEl) errEl.textContent = `Slot ${userSlot} is already occupied. Choose a free slot.`;
            return;
        }
    }

    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Installing\u2026'; }
    if (errEl) errEl.textContent = '';

    // Use cached words from the per-selection fetch if available; otherwise fetch now.
    const _doInstall = async function(words) {
        const hdr = sim.parseLumpHeader(words[0] >>> 0);
        if (!hdr.valid) return Promise.reject('Invalid LUMP header (magic mismatch)');
        if (!artifactDetail) return Promise.reject('Immutable LUMP inspection is unavailable');
        const actualBinaryHash = await _nsHashImmutableWords(words);
        const _canonicalHash = function(value) {
            if (value == null) return null;
            const hash = String(value).trim().replace(/^sha256:/i, '').toLowerCase();
            return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
        };
        // A Wukong Preload is bound to the exact fetched immutable words.
        // Identity annotations are included only from the matching approval.
        const _preloadBinding = loadPolicy === 'Preload' ? {
            lumpSize: hdr.lumpSize,
            binaryHash: actualBinaryHash,
            identityHash: _canonicalHash(approvedMetadata &&
                (approvedMetadata.identity_hash || approvedMetadata.identityHash))
        } : null;
        if (_preloadBinding && !_preloadBinding.binaryHash) {
            return Promise.reject(
                'Preload requires the selected LUMP’s canonical binary hash; refusing to install an unbound bridge request.');
        }

        // ── Determine target NS slot based on Slot Policy ─────────────────────
        // Dynamic: always auto-allocate (slot may change between reboots).
        // Static: use user-specified slot, or fall back to auto-allocate.
        let slot;
        if (slotPolicy === 'dynamic') {
            // Probe for a free slot without reserving this token yet.  The
            // identity and Outform preflight below can still reject the LUMP;
            // reserving early would make the picker hide a failed install as
            // though it were already present.
            slot = sim.allocOrFindNsSlot(null, name);
        } else if (userSlot !== null) {
            slot = userSlot;
        } else {
            slot = sim.allocOrFindNsSlot(null, name);
        }
        if (slot === null) return Promise.reject('Namespace table is full');

        // Copy lump words into this slot's extended DMEM region
        const EXTENDED_BASE   = 0x0800;
        const EXTENDED_STRIDE = 0x0100;
        const PROG_SLOT       = sim.firstUserNsSlot();
        const slotOffset      = Math.max(0, slot - PROG_SLOT);
        const lumpBase        = EXTENDED_BASE + slotOffset * EXTENDED_STRIDE;

        // Ordinary code LUMPs are checked and minted on a private copy before
        // *any* simulator mutation.  This prevents a stale self GT, wrong
        // sequence, or mismatched Namespace location from leaving a half-added
        // body/entry behind when the ADD modal rejects it.
        const _embeddedApi = artifactDetail.apiDefinition;
        const _hasEmbeddedIdentity = !!(_embeddedApi && typeof _embeddedApi.name === 'string' &&
            _embeddedApi.name && hdr.typ === 0);
        const _row0 = hdr.cc > 0 ? (words[hdr.lumpSize - hdr.cc] >>> 0) : 0;
        const _parsedSelf = hdr.cc > 0 && typeof sim.parseGT === 'function'
            ? sim.parseGT(_row0) : null;
        const _selfPerms = _parsedSelf && _parsedSelf.permissions;
        const _liveSelf = !!(_parsedSelf && _parsedSelf.type === 1 && _selfPerms &&
            _selfPerms.E === 1 && !_selfPerms.R && !_selfPerms.W && !_selfPerms.X &&
            !_selfPerms.L && !_selfPerms.S && !_selfPerms.B);
        const _selfPlaceholder = sim.constructor &&
            Number.isInteger(sim.constructor.SELF_CAPABILITY_PLACEHOLDER) &&
            _row0 === (sim.constructor.SELF_CAPABILITY_PLACEHOLDER >>> 0);
        const _compilerOwnedSelf = _hasEmbeddedIdentity;
        if (_selfPlaceholder && !_compilerOwnedSelf) {
            return Promise.reject('Compiler SELF placeholder lacks an intrinsic embedded identity');
        }
        if (_compilerOwnedSelf && hdr.cc < 1) {
            return Promise.reject('Embedded executable identity requires compiler-owned C-List row zero');
        }
        if (_compilerOwnedSelf && !_selfPlaceholder && !_liveSelf) {
            return Promise.reject('Compiler-owned SELF is not proven by the binary C-List');
        }
        const _sourceSelfSlot = _liveSelf ? Number(_parsedSelf.index) : NaN;
        const _sourceSelfValid = Number.isInteger(_sourceSelfSlot) &&
            _sourceSelfSlot >= 0 && sim.isNSEntryValid(_sourceSelfSlot);
        const _sourceSelfSeq = _sourceSelfValid
            ? sim.parseNSWord1(sim.memory[sim._nsSlotBase(_sourceSelfSlot) + 1] >>> 0).gtSeq
            : NaN;
        const _identity = sim._mintOrdinaryLumpIdentity(words, slot, lumpBase, {
            // A compiler marker cannot be bypassed by selecting an Outform in
            // the modal.  Raw assembly remains an explicit non-ordinary layout.
            architectural: hdr.typ !== 0 || (gtType !== 1 && !_compilerOwnedSelf),
            compilerOwnedSelf: _compilerOwnedSelf,
            // A saved live self row can be reminted only after its own GT points
            // at a currently valid Namespace entry with the same sequence.
            remintCompilerOwnedSelf: _compilerOwnedSelf && _sourceSelfValid,
            sourceSelfSlot: _sourceSelfSlot,
            sourceSelfSeq: _sourceSelfSeq
        });
        if (!_identity.ok) {
            return Promise.reject(
                `Namespace identity validation failed (${_identity.code}): ${_identity.message}`
            );
        }
        words = _identity.words;

        // limit17: always hdr.cw (real grant interval) regardless of load mode.
        // For Lazy Load the header word is zeroed after the c-list is written so
        // Mode 1 (Restore) fires on first CALL/LOAD rather than setting limit17=0
        // (which would leave no callable range and break the seal after lazyLoad).
        const limit17    = hdr.cw;

        // ── Task #2862: trusted identity registration for network Outform ──────
        // Derive network identity only from the matching hash-bound approval.
        // BEFORE the lazy Outform NS entry is created.  The cache token T is the
        // canonical W3 for a secure Outform (NOT an Abstract GT).  For a secure
        // Outform (gtType === 2, i.e. a lump that will be fetched over the
        // network on first CALL/LOAD) the metadata is MANDATORY: if the trusted
        // discriminator fields are missing we fail closed rather than create an
        // unverifiable Outform whose later promotion might rely on T alone.
        // Cache tag T is a 32-bit value; hashes remain CANONICAL 64-hex strings
        // (SHA-256) and are NEVER parseInt'd/truncated.
        const _hexToU32 = function(v) {
            if (v == null) return null;
            if (typeof v === 'number') {
                return Number.isInteger(v) && v >= 0 && v <= 0xFFFFFFFF
                    ? (v >>> 0) : null;
            }
            const s = String(v).trim().replace(/^0x/i, '');
            return /^[0-9a-fA-F]{8}$/.test(s)
                ? (Number.parseInt(s, 16) >>> 0) : null;
        };
        const _positiveIssue = function(v) {
            if (typeof v === 'number') {
                return Number.isSafeInteger(v) && v > 0 ? v : NaN;
            }
            if (v == null) return NaN;
            const s = String(v).trim();
            if (!/^[1-9][0-9]*$/.test(s)) return NaN;
            const n = Number(s);
            return Number.isSafeInteger(n) ? n : NaN;
        };
        const _canon64 = function(v) {
            if (v == null) return null;
            const s = String(v).trim().replace(/^0x/i, '').toLowerCase();
            return /^[0-9a-f]{64}$/.test(s) ? s : null;
        };
        const _idMeta = approvedMetadata || {};
        const cacheToken32 = _hexToU32(
            _idMeta.cache_token != null ? _idMeta.cache_token
          : _idMeta.cacheToken != null ? _idMeta.cacheToken
          : token);   // fall back to the lump token low 32 bits
        const issueN       = (_idMeta.issue_n != null) ? _positiveIssue(_idMeta.issue_n)
                           : (_idMeta.issueN  != null) ? _positiveIssue(_idMeta.issueN)
                           : (_idMeta.issue   != null) ? _positiveIssue(_idMeta.issue) : NaN;
        const identityHash = _canon64(_idMeta.identity_hash != null ? _idMeta.identity_hash : _idMeta.identityHash);
        const binaryHash   = actualBinaryHash;
        const dotName      = _idMeta.dot_name || _idMeta.dotName || name || '';

        // A SECURE Outform (gtType === 2, network-fetched on first CALL/LOAD)
        // requires the full trusted identity: cache tag T, a positive integer
        // issue, a non-empty dotName, and canonical 64-hex identity/binary
        // hashes.  If any is missing we FAIL CLOSED — never create an
        // unverifiable Outform whose later promotion might rely on T alone.
        // Compiler-owned self identity is always an Inform E-GT. A modal type
        // selection cannot turn it into an Outform after its identity was minted.
        const effectiveGtType = _identity.ordinary ? 1 : gtType;
        const isSecureOutform = (effectiveGtType === 2);
        if (isSecureOutform &&
            (cacheToken32 == null || !(Number.isInteger(issueN) && issueN > 0) ||
             !dotName || identityHash == null || binaryHash == null)) {
            if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Install'; }
            return Promise.reject(
                'Secure Outform requires trusted identity metadata (cache_token, positive issue_n, dot_name, 64-hex identity_hash and binary_hash) — refusing to create an unverifiable Outform.');
        }

        // W3 for the NS entry:
        //   • secure Outform → cache tag T (cacheToken32) — the canonical W3.
        //   • Inform / legacy → cache token when available, else 0.  W3 no longer
        //     carries an Abstract GT (Task #2862 W3=cache_token migration).
        const w3CacheToken = (cacheToken32 != null) ? (cacheToken32 >>> 0) : 0;
        const slotGtSeq = sim._nsSequenceForWrite(slot);

        // Register trusted identity outside the 4-word NS entry BEFORE the entry
        // is written, so receiveLump() can verify against it on resolution.  Only
        // a SECURE Outform gets a secure identity record (which enforces the
        // canonical-field requirements in registerSlotIdentity).
        if (typeof sim.registerSlotIdentity === 'function' && isSecureOutform) {
            // Canonical NS ABI: W1 is authority only — packNSWord1(limit, gtSeq,
            // gBit, fFlag). Type + c-list count are NOT W1 fields (side-tables /
            // resident header). W2 is the integrity32 of {W0, W1}. These opaque
            // words must match exactly what writeNSEntry() writes below.
            const _w1 = sim.packNSWord1(limit17, slotGtSeq, 0, 0) >>> 0;
            const _w2 = sim.makeVersionSeals(slotGtSeq, lumpBase, limit17) >>> 0;
            sim.registerSlotIdentity(slot, {
                cacheToken:   w3CacheToken,
                dotName:      dotName,
                issueN:       issueN,
                identityHash: identityHash,   // canonical 64-hex string
                binaryHash:   binaryHash,     // canonical 64-hex string
                grants:       Array.isArray(_idMeta.grants) ? _idMeta.grants : [],
                capabilityType: effectiveGtType,
                authorized:   _idMeta.authorized === true,
                outformWords: [_w1, _w2, w3CacheToken],
                gtSeq:        slotGtSeq,
            }, { secure: true });
        }

        // All validation has now succeeded.  Only now may the LUMP body or
        // token map mutate, so a rejected install leaves no hidden picker entry
        // and no orphaned body in programmable memory.
        const copyLen = Math.min(words.length, EXTENDED_STRIDE);
        for (let wi = 0; wi < copyLen; wi++) {
            sim.writePersistentWord(lumpBase + wi, words[wi]);
        }

        // Write NS entry with the verified identity type. W3 = cache token (T).
        sim.withNamespaceWrite('manual Namespace Add', function() {
            sim.writeNSEntry(slot, lumpBase, limit17, 0, 0, effectiveGtType,
                _identity.ordinary ? _identity.entry.seq : slotGtSeq, hdr.cc,
                _identity.ordinary ? _identity.entry.cacheToken : w3CacheToken);
        });
        if (sim._tokenSlotMap) sim._tokenSlotMap.set(token, slot);
        sim.nsLabels[slot] = name;

        // Persist slot→label to boot-config so the label survives hard resets.
        // Uses a lightweight PATCH endpoint that merges into the existing config
        // without wiping step1/step2/step3 fields.
        if (typeof window._persistNamespaceSlotLabel === 'function') {
            window._persistNamespaceSlotLabel(slot, name);
        } else {
            window.bootConfig = window.bootConfig || {};
            window.bootConfig.slotLabels = window.bootConfig.slotLabels || {};
            window.bootConfig.slotLabels[String(slot)] = name;
        }

        // Keep the programmer's Namespace placement choice in Namespace state.
        const { patchedPolicy: _patchedPolicy, patchedSlot: _patchedSlot } =
            _nsSlotPersistRecord(slotPolicy, slot);
        // Record it locally so reopening this modal keeps the current Namespace
        // decision without mutating artifact metadata.
        if (!window._nsPersistedSlotMeta) window._nsPersistedSlotMeta = {};
        window._nsPersistedSlotMeta[token] = {
            ns_slot_policy: _patchedPolicy,
            ns_slot:        _patchedSlot
        };
        // The policy is the complete programmer-facing loading decision.
        // All transport details are derived from canonical catalog metadata.
        window.bootConfig = window.bootConfig || {};
        window.bootConfig.step2 = window.bootConfig.step2 || { lumps: [] };
        const _rows = window.bootConfig.step2.lumps || (window.bootConfig.step2.lumps = []);
        const _canonicalName = (approvedMetadata &&
            (approvedMetadata.dot_name || approvedMetadata.dotName)) ||
            (_embeddedApi && _embeddedApi.name) || name;
        let _row = _rows.find(r => r && r.nsSlot === slot);
        if (!_row) {
            _row = { nsSlot: slot, abstraction: _canonicalName, lumpToken: token };
            _rows.push(_row);
        }
        _row.abstraction = _canonicalName;
        _row.lumpToken = token;
        _row.loadPolicy = loadPolicy;
        _row.resident = loadPolicy === 'Resident';
        delete _row.prefetch;
        delete _row.prefetchRequired;
        delete _row.prefetchOrder;
        delete _row.downloadUrl;
        if (_preloadBinding) {
            _row.lumpSize = _preloadBinding.lumpSize;
            _row.binaryHash = _preloadBinding.binaryHash;
            if (_preloadBinding.identityHash) _row.identityHash = _preloadBinding.identityHash;
            else delete _row.identityHash;
        } else {
            delete _row.binaryHash;
            delete _row.identityHash;
        }

        // The copied binary's C-List is authoritative. Approval metadata never
        // rewrites or authorizes capability rows at runtime.
        sim._compilerOwnedSelfSlots = sim._compilerOwnedSelfSlots || {};
        if (_identity.ordinary) sim._compilerOwnedSelfSlots[slot] = true;
        else delete sim._compilerOwnedSelfSlots[slot];

        // ── Lazy Load: zero header word + register manifest entry ─────────────
        // Mode 1 (Restore) fires when CALL/LOAD finds magic=0 at lumpBase.
        // Code words at lumpBase+1..+hdr.cw and c-list GTs at the tail are
        // left in place; lazyLoad() rewrites the header + code section only and
        // reseals word2. limit17 = hdr.cw was already written above, so the
        // grant interval and seal are correct after restore.
        if (loadMode === 'lazy') {
            sim.writePersistentWord(lumpBase, 0);   // magic=0 ≠ 0x1F → not resident
            if (!sim.lazyManifest) sim.lazyManifest = {};
            const _lazyCode = Array.from(words.slice(1, 1 + hdr.cw));
            sim.lazyManifest[slot] = {
                label:     name,
                source:    'ns-add',
            priority:  'warm',
            loadPolicy,
                size:      hdr.lumpSize,
                allocBase: lumpBase,
                allocSize: hdr.lumpSize,
                loaded:    false,
                loadCount: 0,
                bootUpload: {
                    methods:      [{ code: _lazyCode }],
                    data_words:   [],
                    // null placeholders preserve the cc count so lazyLoad re-packs
                    // the correct cc into the header without overwriting existing
                    // c-list GTs (only self-data-R entries are handled by lazyLoad).
                    capabilities: new Array(hdr.cc).fill(null),
                },
            };
        }

        const _overlay = document.getElementById('_nsAddModalOverlay');
        if (_overlay) _overlay.remove();
        _setNsDirty(true);
        if (typeof updateNamespace === 'function') updateNamespace();

        // Adding a row is a complete user action, not a draft edit. Commit it
        // immediately so a newly installed LUMP cannot disappear on reload
        // while waiting for a separate manual save.
        const saveBtn = document.getElementById('nsSaveBtn');
        if (typeof window._nsTableSave === 'function') {
            const saved = await window._nsTableSave(saveBtn);
            if (!saved) {
                console.warn('[_nsTableAddConfirm] new Namespace row remains unsaved; retry with Save for next build');
            }
        } else {
            console.error('[_nsTableAddConfirm] Namespace save handler is unavailable');
        }
    };

    const _onError = function(err) {
        if (errEl) errEl.textContent = 'Error: ' + err;
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Install'; }
    };

    // Re-use cached words from per-selection fetch when token matches.
    if (window._nsAddCurrentToken === token && window._nsAddCurrentWords) {
        _doInstall(window._nsAddCurrentWords).catch(_onError);
    } else {
        fetch('/api/lump/' + token + '/words')
            .then(function(r) { return r.ok ? r.json() : Promise.reject('HTTP ' + r.status); })
            .then(function(data) {
                const words = Array.isArray(data) ? data : (data && Array.isArray(data.words) ? data.words : null);
                if (!words || words.length === 0) return Promise.reject('Empty word list from server');
                window._nsAddCurrentWords = words;
                window._nsAddCurrentToken = token;
                return _doInstall(words);
            })
            .catch(_onError);
    }
}

// ── NS table: Clear slot ──────────────────────────────────────────────────────
// Revokes all existing GTs for the slot by bumping the gt_seq cycle count,
// then zeroes the entry. Any pre-Clear GT will fail GT validation on next use.
function _nsTableClear(slot) {
    if (!sim) return;
    // Slots 0–10 are the complete built-in catalog.  Only user allocations
    // may be cleared and returned to the allocator.
    if (slot < 11) return;

    // A free entry must be all-zero so the shared allocator can reuse it.
    // clearNSEntry keeps the bumped generation out-of-band until reissue.
    sim.withNamespaceWrite('manual Namespace Clear', function() {
        sim.clearNSEntry(slot);
    });

    _setNsDirty(true);
    if (typeof updateNamespace === 'function') updateNamespace();
}

// ── NS table: Save — the single write path for all NS mutations ───────────────
// Persists in-memory NS state to server/lumps/boot-image.bin AND
// server/lumps/ns-state.json via the /api/boot-image/save-ns endpoint, then
// persists the next-build configuration in the same user action.
// All NS mutations (Add LUMP, Clear slot, boot-entry drag, load policy changes)
// remain in-memory until the user clicks Save for next build.
// The boot image binary is little-endian 32-bit words (struct.pack "<{n}I"),
// matching Uint32Array's native byte order on x86/x64.
window._nsTableSave = async function(btn) {
    if (!sim) return false;

    // Check a boot image binary has actually been loaded (NS_TABLE_BASE must
    // have been set by loadBootImage — the default 0xF000 is valid too, but
    // if no binary was ever applied the upload would overwrite the server with
    // an uninitialised memory image).
    if (!window.bootImage || !window.bootImageAvailable) {
        const msg = 'No boot image loaded — reset the simulator first, or upload a boot-image.bin from the Boot Image Designer.';
        if (btn) { const _orig = btn.textContent; btn.textContent = '\u26a0\ufe0f ' + msg; btn.style.color = '#f87171'; setTimeout(() => { btn.textContent = _orig; btn.style.color = ''; }, 4000); }
        return false;
    }

    const origText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; btn.style.color = '#ccc'; }

    try {
        // Add/Save label writes and the binary commit form one canonical save.
        // Wait for every in-flight label update so a quick Save→reload cannot
        // observe the occupied slot before its committed custom label.
        const labelWrites = (window._nsLabelPersistPromises || []).slice();
        if (labelWrites.length) {
            await Promise.all(labelWrites);
            window._nsLabelPersistPromises = [];
        }

        // The boot image occupies exactly sim.NS_TABLE_BASE + sim.NS_TABLE_RESERVE
        // words, because the generator writes the NS table at the tail and the
        // format-tag scanner computes: NS_TABLE_BASE = tagIdx + 1, and
        // NS_TABLE_RESERVE = src.length - NS_TABLE_BASE  →  total = NS_TABLE_BASE + NS_TABLE_RESERVE.
        const bootWordCount = (sim.NS_TABLE_BASE >>> 0) + (sim.NS_TABLE_RESERVE >>> 0);
        if (bootWordCount < 8 || bootWordCount > sim.memory.length) {
            throw new Error(`Unexpected boot image size: ${bootWordCount} words`);
        }

        // Snapshot only persistent/static state. Runtime DREAD/DWRITE/LOAD/SAVE
        // effects remain live execution state and must not leak into the next
        // composite image merely because the Namespace is explicitly saved.
        const words = typeof sim.snapshotPersistentMemory === 'function'
            ? sim.snapshotPersistentMemory(bootWordCount)
            : new Uint32Array(sim.memory.slice(0, bootWordCount));

        // Keep the boot-entry sentinel in sync with the current UI selection.
        const sentinelIdx = (sim.NS_TABLE_BASE >>> 0) - 2;
        if (sentinelIdx >= 0 && sentinelIdx < bootWordCount) {
            words[sentinelIdx] = bootEntrySlot & 0xFF;
        }

        // ── Re-seal every active NS slot before encoding ───────────────────────
        // Recomputes word2 (the integrity32 hash) from word0/word1 so no stale
        // seal survives from an Add, Clear, or direct memory edit.
        // Canonical NS ABI: W2 = integrity32(W0, W1). gt_seq is NOT stored in W2 —
        // it is part of the W1 authority word (bits[29:21]) and is preserved
        // implicitly because we re-hash the existing W1 verbatim.
        {
            const nsBase  = sim.NS_TABLE_BASE >>> 0;
            const nsWords = sim.NS_ENTRY_WORDS;     // = 4
            const maxSl   = sim.MAX_NS_ENTRIES;
            for (let si = 0; si < maxSl; si++) {
                const b = nsBase + si * nsWords;
                if (b + 3 >= bootWordCount) break;
                const w0 = words[b] >>> 0;
                if (w0 === 0) continue;             // unoccupied slot — skip
                const w1     = words[b + 1] >>> 0;
                const gtSeq  = sim.parseNSWord1(w1).gtSeq;
                const lim17  = w1 & 0x1FFFF;
                words[b + 2] = sim.makeVersionSeals(gtSeq, w0, lim17) >>> 0;
            }
        }

        // ── Build ns_state: rich per-slot objects from the live NS table ─────────
        // Iterates sim.readNSEntry(i) for i = 0..sim.nsCount-1 to capture every
        // column the user sees in the NS table view.  Mirrors the rendered table
        // exactly: one object per occupied slot, "boot": true on bootEntrySlot.
        const _GT_TYPE_NAMES = ['Null', 'Inform', 'Outform', 'Abstract'];
        const _hex8  = v => '0x' + ((v >>> 0).toString(16).toUpperCase().padStart(8, '0'));
        const _hex5  = v => '0x' + ((v >>> 0).toString(16).toUpperCase().padStart(5, '0'));
        const _hex4  = v => '0x' + ((v >>> 0).toString(16).toUpperCase().padStart(4, '0'));
        const nsAbstractions = [];
        for (let _si = 0; _si < sim.nsCount; _si++) {
            const _e = sim.readNSEntry(_si);
            if (!_e) continue;   // unoccupied slot
            const _lbl = sim.nsLabels[_si] || `slot_${_si}`;
            if (!_lbl || _lbl === '(free)' || _lbl === '(reserved)') continue;
            const _pW1 = sim.parseNSWord1(_e.word1_limit);
            const _loc  = _e.word0_location >>> 0;
            const _lim  = _pW1.limit & 0x1FFFF;
            // Canonical NS ABI: gt_seq is W1[29:21]; W2 is a full integrity32 hash;
            // type is entry-level metadata (side-table via readNSEntry), not W1.
            const _seq  = _pW1.gtSeq;
            const _seal = _e.word2_seals >>> 0;
            const _rich = {
                name:     _lbl,
                slot:     _si,
                location: _hex8(_loc),
                type:     _GT_TYPE_NAMES[_e.gtType] || 'Inform',
                // F bit: taken truthfully from parseNSWord1(word1) — never hardcoded.
                // In v2.0 the far-lump F flag is retired and parseNSWord1 returns f:0
                // by design (bit[30] is the GC liveness mark); routing through the
                // parser means the saved value tracks the ISA definition, so if F is
                // ever reintroduced the save path stays truthful automatically.
                f:        _pW1.f,
                g:        _pW1.g,
                limit:    _hex5(_lim),
                seq:      _seq,
                seal:     _hex8(_seal),
            };
            if (_si === bootEntrySlot) _rich.boot = true;
            nsAbstractions.push(_rich);
        }
        const nsState = { abstractions: nsAbstractions };

        // Encode as base64 (little-endian bytes — matches struct.pack "<{n}I").
        const bytes = new Uint8Array(words.buffer);
        let binary = '';
        const chunk = 8192;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        const data_b64 = btoa(binary);

        // POST to the single-write-path endpoint that writes both files atomically.
        const resp = await fetch('/api/boot-image/save-ns', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ data_b64, ns_state: nsState }),
        });
        const data = await resp.json();
        if (!resp.ok || data.ok === false) throw new Error((data && data.error) || `HTTP ${resp.status}`);

        // Keep the live table and the next-build policy in one explicit save
        // action.  This also creates the default Step 1 configuration on a
        // fresh project, so the user never has to visit Builder just to unlock
        // the Namespace save button.
        try {
            await window._ensureNamespaceBuildConfig();
        } catch (configErr) {
            throw new Error('Namespace saved, but next-build settings were not saved: ' + configErr.message);
        }

        // Replace cached binary so the next reset re-applies the new image.
        window.bootImage          = words.buffer;
        window.bootImageAvailable = true;

        // Refresh the committed ns-state so _findSrcLump uses the new map.
        window._nsState = nsState;

        // Clear dirty flag — committed state now matches in-memory state.
        _setNsDirty(false);

        if (btn) {
            btn.textContent = '\u2713 Saved';
            btn.style.color = '#4ec9b0';
            setTimeout(() => {
                btn.disabled = false;
                _setNsDirty(false);   // restore clean button state after timeout
            }, 2000);
        }
        return true;
    } catch (err) {
        console.error('[_nsTableSave]', err);
        if (btn) {
            btn.textContent = '\u2717 ' + err.message;
            btn.style.color = '#f87171';
            setTimeout(() => {
                btn.disabled = false;
                _setNsDirty(window._nsTableDirty);   // restore previous indicator
            }, 4000);
        }
        return false;
    }
};

// ── NS label click — dispatch on GT type ──────────────────────────────────────
// Rule: Inform → lump detail modal (header + c-list + disassembly)
//       Null / Outform / Abstract → type description panel

function _nsLabelOpen(slotIdx) {
    if (!sim) return;
    const e = sim.readNSEntry(slotIdx);
    if (!e) { _showNSTypeDescModal(slotIdx, null); return; }
    if (_isThreadNamespaceSlot(slotIdx, e)) {
        _showNSThreadModal(slotIdx);
        return;
    }
    // If a server-side LUMP is registered for this slot, always show the lump
    // detail modal — even when the boot-image NS entry has gtType != 1.
    // Boot-image lazy stubs pack gtType=3 in the hardware bit layout until the
    // lump is promoted to Inform at runtime; the server binary is authoritative.
    const _hasSrcLump = typeof _findSrcLump === 'function' && !!_findSrcLump(slotIdx, e.label);
    if (e.gtType === 1 || _hasSrcLump) {
        _showNSLumpModal(slotIdx, e);
    } else {
        _showNSTypeDescModal(slotIdx, e);
    }
}

// Dedicated read-only popup for a selected Thread instance.  It intentionally
// does not reuse the generic LUMP modal because Thread zone geometry and values
// come from the selected Thread body rather than ordinary code/c-list fields.
function _showNSThreadModal(slotIdx) {
    const old = document.getElementById('_nsLumpModalOverlay');
    if (old) old.remove();
    const entry = sim && sim.readNSEntry(slotIdx);
    const rawLabel = (entry && entry.label) || (sim && sim.nsLabels && sim.nsLabels[slotIdx]) || `NS[${slotIdx}]`;
    const label = String(rawLabel).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const body = renderThreadMemoryLayout(slotIdx, true);
    const html = `<div id="_nsLumpModalOverlay" data-testid="thread-detail-modal" style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);" onclick="if(event.target===this)this.remove();">` +
        `<div style="background:#1e1e1e;border:1px solid rgba(168,85,247,0.45);border-radius:8px;padding:18px 20px;max-width:1100px;width:94%;max-height:88vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.7);">` +
        `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">` +
        `<div><span style="color:#c084fc;font-weight:700;font-size:1rem;">${label}</span>` +
        `<span style="color:#9ca3af;font-size:0.78rem;margin-left:8px;">NS[${slotIdx}] — selected Thread instance · read-only</span></div>` +
        `<button onclick="document.getElementById('_nsLumpModalOverlay').remove()" aria-label="Close Thread details" style="background:none;border:none;color:#aaa;font-size:1.25rem;cursor:pointer;padding:0 4px;">✕</button>` +
        `</div>${body}</div></div>`;
    document.body.insertAdjacentHTML('beforeend', html);
}

// ── NS slot load-mode cycling badge ─────────────────────────────────────────
// Cycles: resident → lazy → dynamic → resident
// Updates both badges from Namespace runtime state; it never patches LUMP metadata endpoints.
// the modal (#_nsModeBadgeToken and #_nsModeBadgeSubtitle) optimistically.
window._nsSlotCycleMode = function(token, currentMode) {
    if (!token) return;
    const _MODES = ['resident', 'lazy', 'dynamic'];
    const _CFG = {
        resident: { label: 'Resident',  color: '#4ec9b0', border: 'rgba(78,201,176,0.35)',  bg: 'rgba(78,201,176,0.08)',  boot_resident: true,  ns_slot_policy: 'static',  desc: 'physically resident in DMEM' },
        lazy:     { label: 'Lazy Load', color: '#f0a040', border: 'rgba(240,160,64,0.35)',  bg: 'rgba(240,160,64,0.08)',  boot_resident: false, ns_slot_policy: 'static',  desc: 'code fetched on demand' },
        dynamic:  { label: 'Dynamic',   color: '#9ca3af', border: 'rgba(156,163,175,0.35)', bg: 'rgba(156,163,175,0.08)', boot_resident: false, ns_slot_policy: 'dynamic', desc: 'resolved at runtime' }
    };
    const nextMode = _MODES[(_MODES.indexOf(currentMode) + 1) % _MODES.length];
    const cfg = _CFG[nextMode];

    // Optimistic update of both badges
    ['_nsModeBadgeToken', '_nsModeBadgeSubtitle'].forEach(function(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.dataset.mode = nextMode;
        el.textContent  = cfg.label;
        el.style.color  = cfg.color;
        if (id === '_nsModeBadgeToken') {
            el.style.borderColor = cfg.border;
            el.style.background  = cfg.bg;
        }
    });
    const descEl = document.getElementById('_nsModeBadgeDesc');
    if (descEl) descEl.textContent = cfg.desc;

    // This is Namespace runtime state, not mutable LUMP metadata. Persist it
    // with the boot configuration on the next Namespace save.
    window.bootConfig = window.bootConfig || {};
    window.bootConfig.nsLoadModes = window.bootConfig.nsLoadModes || {};
    window.bootConfig.nsLoadModes[String(slotIdx)] = nextMode;
};

// ── Lump detail modal — Inform entries only ───────────────────────────────────
function _showNSLumpModal(slotIdx, nsEntry) {
    const _existingNsModal = document.getElementById('_nsLumpModalOverlay');
    if (_existingNsModal) _existingNsModal.remove();

    // ── Boot.NS (slot 0) is hardware ROM, not a lazy-loaded lump ────────────
    // Show the 3 boot ROM instructions and hardware c-list inline; no server
    // fetch required or valid for this slot.
    if (slotIdx === 0) {
        const _nsMT = `style="border-collapse:collapse;width:100%;font-size:0.8rem;"`;
        const _nsTD = `style="padding:3px 8px;border-bottom:1px solid rgba(255,255,255,0.05);"`;
        const _nsTH = `style="padding:3px 8px;border-bottom:1px solid rgba(200,155,60,0.2);color:#888;font-weight:500;text-align:left;"`;

        // 3 hardware boot ROM words (from hw_binary.js HW_BOOT_PROGRAM)
        const _hwProg = [
            { w: 0x077F8000, dis: 'LOAD   AL, CR15, CR15[0]   — refresh Namespace cap (slot 0 → CR15)' },
            { w: 0x27678001, dis: 'CHANGE AL, CR12, CR15, #1  — load Boot.Thread (slot 1) → CR0–CR11' },
            { w: 0x17000000, dis: 'CALL   AL, CR0,  CR0       — enter Thread.CR0 (Application LUMP)' },
        ];
        const _progRows = _hwProg.map((r, i) =>
            `<tr>
                <td ${_nsTD} style="color:#888;">${i}</td>
                <td ${_nsTD}><code style="font-size:0.74rem;">0x${r.w.toString(16).toUpperCase().padStart(8,'0')}</code></td>
                <td ${_nsTD} style="color:#dcdcaa;font-family:monospace;font-size:0.78rem;">${r.dis}</td>
            </tr>`
        ).join('');

        // Hardware boot c-list (from sim.demoClistGTs if booted, else static fallback)
        const _clistSrc = (sim && sim.demoClistGTs && sim.demoClistGTs.length)
            ? sim.demoClistGTs
            : [0,0,0,0,0,0,0,0,0,0,0];
        const _nsLbls = (sim && sim.nsLabels) || {};
        const _clistRows = _clistSrc.map((gt, i) => {
            const parsed = (sim && typeof sim.parseGT === 'function') ? sim.parseGT(gt >>> 0) : null;
            let permStr = '—', nameStr = '—';
            if (parsed && (gt >>> 0) !== 0) {
                const p = parsed.permissions || {};
                permStr = ['R','W','X','E','S','L'].filter(k => p[k]).join('') || '∅';
                const lbl = (parsed.type !== 3 && _nsLbls) ? _nsLbls[parsed.index] : null;
                nameStr = lbl || (parsed.type === 3 ? '(Abstract)' : `NS[${parsed.index}]`);
            }
            return `<tr>
                <td ${_nsTD} style="color:#888;">${i}</td>
                <td ${_nsTD}><code style="font-size:0.74rem;">0x${(gt>>>0).toString(16).toUpperCase().padStart(8,'0')}</code></td>
                <td ${_nsTD} style="color:#4ec9b0;">${nameStr}</td>
                <td ${_nsTD}><span class="ns-perm-chip" style="font-size:0.65rem;">${permStr}</span></td>
            </tr>`;
        }).join('');

        const _hwModalHtml = `<div id="_nsLumpModalOverlay" style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);" onclick="if(event.target===this)this.remove();">
            <div style="background:#1e1e1e;border:1px solid rgba(200,155,60,0.35);border-radius:8px;padding:20px 24px;max-width:680px;width:92%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.7);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
                    <div>
                        <span style="color:#c89b3c;font-weight:700;font-size:1rem;">Boot.NS</span>
                        <span style="color:#6b7280;font-size:0.78rem;margin-left:8px;">NS[0] — Hardware Boot ROM</span>
                    </div>
                    <button onclick="document.getElementById('_nsLumpModalOverlay').remove()" style="background:none;border:none;color:#888;font-size:1.2rem;cursor:pointer;padding:0 4px;">✕</button>
                </div>
                <div style="margin-bottom:10px;padding:6px 10px;background:rgba(200,155,60,0.08);border-left:3px solid rgba(200,155,60,0.4);border-radius:3px;color:#9ca3af;font-size:0.78rem;">
                    This slot is the hardware Boot ROM — 3 fixed instructions executed on every power-on reset. There is no lazy-loaded LUMP body.
                </div>
                <div style="margin-bottom:14px;">
                    <div style="color:#c89b3c;font-size:0.75rem;font-weight:600;letter-spacing:0.06em;margin-bottom:6px;">BOOT ROM PROGRAM (3 words)</div>
                    <table ${_nsMT}>
                        <thead><tr><th ${_nsTH}>PC</th><th ${_nsTH}>Word</th><th ${_nsTH}>Instruction</th></tr></thead>
                        <tbody>${_progRows}</tbody>
                    </table>
                </div>
                <div style="margin-bottom:4px;">
                    <div style="color:#c89b3c;font-size:0.75rem;font-weight:600;letter-spacing:0.06em;margin-bottom:6px;">HARDWARE BOOT C-LIST (${_clistSrc.length} entries)</div>
                    <table ${_nsMT}>
                        <thead><tr><th ${_nsTH}>#</th><th ${_nsTH}>GT word</th><th ${_nsTH}>Name</th><th ${_nsTH}>Perms</th></tr></thead>
                        <tbody>${_clistRows}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', _hwModalHtml);
        return;
    }
    // ── End Boot.NS intercept ────────────────────────────────────────────────

    const label = (nsEntry.label || `NS[${slotIdx}]`).replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const base  = nsEntry.word0_location;

    const hdrWord = sim.memory ? (sim.memory[base] >>> 0) : 0;
    const hdr     = (typeof sim.parseLumpHeader === 'function') ? sim.parseLumpHeader(hdrWord) : null;

    const _nsMT = `style="border-collapse:collapse;width:100%;font-size:0.8rem;"`;
    const _nsTD = `style="padding:3px 8px;border-bottom:1px solid rgba(255,255,255,0.05);"`;
    const _nsTH = `style="padding:3px 8px;border-bottom:1px solid rgba(200,155,60,0.2);color:#888;font-weight:500;text-align:left;"`;

    let headerHtml = '', clistHtml = '', codeHtml = '', tokenHtml = '';
    let _lazyFetchToken = null;
    let _modalToken = null, _modalMode = null;

    if (hdr && hdr.valid) {
        const { cw, cc, lumpSize } = hdr;

        headerHtml = `<div style="margin-bottom:14px;">
            <div style="color:#c89b3c;font-size:0.75rem;font-weight:600;letter-spacing:0.06em;margin-bottom:6px;">LUMP HEADER</div>
            <table ${_nsMT}>
                <tr><td ${_nsTD} style="color:#888;">Raw word</td><td ${_nsTD}><code>0x${hdrWord.toString(16).toUpperCase().padStart(8,'0')}</code></td></tr>
                <tr><td ${_nsTD} style="color:#888;">Magic</td><td ${_nsTD}><code>0x${hdr.magic.toString(16).toUpperCase()}</code> <span style="color:#4ec9b0;">✓ valid</span></td></tr>
                <tr><td ${_nsTD} style="color:#888;">Code words (cw)</td><td ${_nsTD}>${cw}</td></tr>
                <tr><td ${_nsTD} style="color:#888;">C-list words (cc)</td><td ${_nsTD}>${cc}</td></tr>
                <tr><td ${_nsTD} style="color:#888;">Total lump size</td><td ${_nsTD}>${lumpSize} words</td></tr>
                <tr><td ${_nsTD} style="color:#888;">Base address</td><td ${_nsTD}><code>0x${(base*4).toString(16).toUpperCase().padStart(4,'0')}</code></td></tr>
            </table></div>`;

        if (cc > 0 && sim.memory) {
            const clistBase = base + lumpSize - cc;
            // Snapshot current DR values for cross-reference
            const _drSnap = (sim.dr && sim.dr.length) ? [...sim.dr] : [];
            // Helper: format a 32-bit byte address
            const _fmtB = v => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
            let rows = '';
            for (let _ci = 0; _ci < cc; _ci++) {
                const gtw = sim.memory[clistBase + _ci] >>> 0;
                const parsed = (typeof sim.parseGT === 'function') ? sim.parseGT(gtw) : null;
                let permStr = '—', nameStr = '(null)', slotStr = '—', zoneStr = '—';
                if (parsed && gtw !== 0) {
                    const p = parsed.permissions || {};
                    permStr = ['R','W','X','E','S','L'].filter(k => p[k]).join('') || '∅';
                    slotStr = parsed.type === 3 ? '—' : String(parsed.index);
                    const lbl = (parsed.type !== 3 && sim.nsLabels) ? sim.nsLabels[parsed.index] : null;
                    nameStr = lbl || (parsed.type === 3 ? '(Abstract)' : `NS[${parsed.index}]`);
                    // Zone: [base_byte … limit_byte] from the NS entry for this slot
                    if (parsed.type !== 3 && typeof sim._nsSlotBase === 'function' && typeof sim.parseNSWord1 === 'function') {
                        const _nsB  = sim._nsSlotBase(parsed.index);
                        const _nW0  = sim.memory[_nsB + 0] >>> 0;
                        const _nW1  = sim.memory[_nsB + 1] >>> 0;
                        if (_nW0 !== 0 || _nW1 !== 0) {
                            const _pw1  = sim.parseNSWord1(_nW1);
                            const _baseB = (_nW0 * 4) >>> 0;
                            const _limB  = (_nW0 + _pw1.limit) * 4;
                            zoneStr = `<span style="font-family:monospace;font-size:0.71rem;color:#9ca3af;">${_fmtB(_baseB)}<span style="color:#555;margin:0 2px;">…</span>${_fmtB(_limB)}</span>`;
                        }
                    }
                }
                rows += `<tr>
                    <td ${_nsTD} style="color:#888;">${_ci}</td>
                    <td ${_nsTD}><code style="font-size:0.75rem;">0x${gtw.toString(16).toUpperCase().padStart(8,'0')}</code></td>
                    <td ${_nsTD} style="color:#888;">${slotStr}</td>
                    <td ${_nsTD} style="color:#4ec9b0;">${nameStr}</td>
                    <td ${_nsTD}>${zoneStr}</td>
                    <td ${_nsTD}><span class="ns-perm-chip" style="font-size:0.65rem;">${permStr}</span></td>
                </tr>`;
            }
            // Non-zero DR register snapshot
            const _drRows = _drSnap.map((v, i) => ({ i, v: v >>> 0 })).filter(x => x.v !== 0)
                .map(x => `<tr>
                    <td ${_nsTD} style="color:#888;font-family:monospace;">DR${x.i}</td>
                    <td ${_nsTD}><code style="color:#c89b3c;">${_fmtB(x.v)}</code></td>
                    <td ${_nsTD} style="color:#6b7280;font-size:0.75rem;">${x.v >>> 0}</td>
                </tr>`).join('');
            const _drHtml = _drRows ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);">
                <div style="color:#c89b3c;font-size:0.72rem;font-weight:600;letter-spacing:0.06em;margin-bottom:5px;">DATA REGISTERS (non-zero)</div>
                <table ${_nsMT}><tbody>${_drRows}</tbody></table>
            </div>` : '';
            clistHtml = `<div style="margin-bottom:14px;">
                <div style="color:#c89b3c;font-size:0.75rem;font-weight:600;letter-spacing:0.06em;margin-bottom:6px;">C-LIST / ZONES (${cc} entries)</div>
                <table ${_nsMT}>
                    <thead><tr><th ${_nsTH}>#</th><th ${_nsTH}>GT word</th><th ${_nsTH}>Slot</th><th ${_nsTH}>Name</th><th ${_nsTH}>Zone [base…limit]</th><th ${_nsTH}>Perms</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>${_drHtml}</div>`;
        } else {
            clistHtml = `<div style="margin-bottom:14px;">
                <div style="color:#c89b3c;font-size:0.75rem;font-weight:600;letter-spacing:0.06em;margin-bottom:6px;">C-LIST</div>
                <span style="color:#6b7280;font-size:0.8rem;">cc = 0 — no c-list entries</span></div>`;
        }

        if (cw > 0 && sim.memory) {
            let rows2 = '';
            for (let _ki = 0; _ki < cw; _ki++) {
                const widx = base + 1 + _ki;
                const w = sim.memory[widx] >>> 0;
                const dis = (typeof assembler !== 'undefined' && assembler && typeof assembler.disassemble === 'function')
                    ? assembler.disassemble(w).replace(/</g,'&lt;').replace(/>/g,'&gt;')
                    : `0x${w.toString(16).toUpperCase().padStart(8,'0')}`;
                rows2 += `<tr>
                    <td ${_nsTD} style="color:#888;">${_ki}</td>
                    <td ${_nsTD} style="color:#555;font-family:monospace;font-size:0.72rem;">+0x${(_ki+1).toString(16)}</td>
                    <td ${_nsTD}><code style="font-size:0.75rem;">0x${w.toString(16).toUpperCase().padStart(8,'0')}</code></td>
                    <td ${_nsTD} style="color:#dcdcaa;font-family:monospace;font-size:0.8rem;">${dis}</td>
                </tr>`;
            }
            codeHtml = `<div style="margin-bottom:14px;">
                <div style="color:#c89b3c;font-size:0.75rem;font-weight:600;letter-spacing:0.06em;margin-bottom:6px;">CODE (${cw} words)</div>
                <div style="overflow-y:auto;max-height:260px;border:1px solid rgba(255,255,255,0.06);border-radius:4px;">
                <table ${_nsMT}>
                    <thead><tr><th ${_nsTH} style="position:sticky;top:0;background:#1a1a2e;z-index:1;">Offset</th><th ${_nsTH} style="position:sticky;top:0;background:#1a1a2e;z-index:1;">+word</th><th ${_nsTH} style="position:sticky;top:0;background:#1a1a2e;z-index:1;">Word</th><th ${_nsTH} style="position:sticky;top:0;background:#1a1a2e;z-index:1;">Disassembly</th></tr></thead>
                    <tbody>${rows2}</tbody>
                </table></div></div>`;
        }

        const srcLump = (typeof _findSrcLump === 'function') ? _findSrcLump(slotIdx, nsEntry.label) : null;
        if (srcLump && srcLump.token) {
            const _slTok = srcLump.token;
            _modalToken = _slTok;
            _modalMode = (srcLump.ns_slot_policy === 'static' && srcLump.boot_resident) ? 'resident'
                       : (srcLump.ns_slot_policy === 'static')                        ? 'lazy'
                       :                                                                 'dynamic';
            tokenHtml = `<div style="margin-bottom:12px;">
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
                    <span style="color:#888;font-size:0.78rem;">Token:</span>
                    <code style="color:#c89b3c;">${_slTok}</code>
                    <button id="_nsModeBadgeToken" class="btn btn-xs" data-mode="resident" data-token="${_slTok}"
                        onclick="_nsSlotCycleMode(this.dataset.token,this.dataset.mode)"
                        style="color:#4ec9b0;border:1px solid rgba(78,201,176,0.35);background:rgba(78,201,176,0.08);border-radius:10px;padding:2px 9px;font-size:0.72rem;cursor:pointer;"
                        title="Click to cycle: Resident → Lazy Load → Dynamic">Resident</button>
                    <button class="btn btn-xs" onclick="document.getElementById('_nsLumpModalOverlay').remove();_openLumpSource('${_slTok}')"
                        style="background:#2d4a3e;color:#4ec9b0;border:1px solid rgba(78,201,176,0.35);">Open in Repository →</button>
                    <button class="btn btn-xs" onclick="document.getElementById('_nsLumpModalOverlay').remove();(typeof openLumpInEditor==='function'?openLumpInEditor('${_slTok}'):_openLumpSource('${_slTok}'))"
                        style="background:#1e3a5f;color:#60a5fa;border:1px solid rgba(96,165,250,0.35);">Open in Editor ✎</button>
                </div>
                <div style="color:#555;font-size:0.72rem;font-family:monospace;">&#x1F3E0; server/lumps/${_slTok}.lump</div>
            </div>`;
        } else {
            tokenHtml = `<div style="margin-bottom:12px;color:#6b7280;font-size:0.78rem;">Token: not in library — boot-resident or compiled in-memory</div>`;
        }
    } else {
        // Lump header is invalid at this NS entry's location (out-of-range MMIO
        // address, evicted lazy stub, or not-yet-loaded after Add+Save).
        // Distinguish: (a) known server binary → lazy fetch and render;
        //              (b) pure hardware MMIO → keep the "no lump" message.
        const _lazyEntry = (typeof _findSrcLump === 'function') ? _findSrcLump(slotIdx, nsEntry.label) : null;
        if (_lazyEntry && _lazyEntry.token) {
            _lazyFetchToken = _lazyEntry.token;
            _modalToken = _lazyFetchToken;
            _modalMode = (_lazyEntry.ns_slot_policy === 'static' && _lazyEntry.boot_resident) ? 'resident'
                       : (_lazyEntry.ns_slot_policy === 'static')                             ? 'lazy'
                       :                                                                        'dynamic';
            tokenHtml = `<div style="margin-bottom:12px;">
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
                    <span style="color:#888;font-size:0.78rem;">Token:</span>
                    <code style="color:#c89b3c;">${_lazyFetchToken}</code>
                    <button id="_nsModeBadgeToken" class="btn btn-xs" data-mode="lazy" data-token="${_lazyFetchToken}"
                        onclick="_nsSlotCycleMode(this.dataset.token,this.dataset.mode)"
                        style="color:#f0a040;border:1px solid rgba(240,160,64,0.35);background:rgba(240,160,64,0.08);border-radius:10px;padding:2px 9px;font-size:0.72rem;cursor:pointer;"
                        title="Click to cycle: Resident → Lazy Load → Dynamic">Lazy Load</button>
                    <button class="btn btn-xs" onclick="document.getElementById('_nsLumpModalOverlay').remove();_openLumpSource('${_lazyFetchToken}')"
                        style="background:#2d4a3e;color:#4ec9b0;border:1px solid rgba(78,201,176,0.35);">Open in Repository \u2192</button>
                    <button class="btn btn-xs" onclick="document.getElementById('_nsLumpModalOverlay').remove();(typeof openLumpInEditor==='function'?openLumpInEditor('${_lazyFetchToken}'):_openLumpSource('${_lazyFetchToken}'))"
                        style="background:#1e3a5f;color:#60a5fa;border:1px solid rgba(96,165,250,0.35);">Open in Editor \u270e</button>
                </div>
                <div style="color:#555;font-size:0.72rem;font-family:monospace;">&#x1F3E0; server/lumps/${_lazyFetchToken}.lump</div>
            </div>`;
            headerHtml = `<div id="_nsLumpLazyBody" style="color:#f0a040;font-size:0.8rem;padding:8px 0;">&#9680; Loading lump data\u2026</div>`;
        } else {
            const loc = `0x${(base*4).toString(16).toUpperCase().padStart(8,'0')}`;
            // ── Hardware register table for known MMIO devices ────────────────────
            const _LM_MMIO_REGS = {
                'UART_DEV': {
                    desc: 'Serial UART — 3 word-wide registers',
                    regs: [
                        { name: 'TX',     offset: 0, access: 'W',   desc: 'Transmit data word (write to send)' },
                        { name: 'STATUS', offset: 1, access: 'R',   desc: 'Bit 0: TX ready · Bit 1: RX valid' },
                        { name: 'RX',     offset: 2, access: 'R',   desc: 'Received data word (read to consume)' },
                    ]
                },
                'LED_DEV': {
                    desc: 'GPIO LEDs — 5 word-wide registers (one per LED)',
                    regs: [
                        { name: 'LED0', offset: 0, access: 'R/W', desc: 'LED 0 state (1 = on)' },
                        { name: 'LED1', offset: 1, access: 'R/W', desc: 'LED 1 state' },
                        { name: 'LED2', offset: 2, access: 'R/W', desc: 'LED 2 state' },
                        { name: 'LED3', offset: 3, access: 'R/W', desc: 'LED 3 state' },
                        { name: 'LED4', offset: 4, access: 'R/W', desc: 'LED 4 state' },
                    ]
                },
                'BTN_DEV': {
                    desc: 'GPIO button — 1 word-wide register',
                    regs: [
                        { name: 'BTN_STATE', offset: 0, access: 'R', desc: 'Button state (1 = pressed)' },
                    ]
                },
                'TIMER_DEV': {
                    desc: 'Hardware timer — 5 word-wide registers',
                    regs: [
                        { name: 'TICKS_LO',  offset: 0, access: 'R',   desc: 'Free-running tick counter, low 32 bits' },
                        { name: 'TICKS_HI',  offset: 1, access: 'R',   desc: 'Free-running tick counter, high 32 bits' },
                        { name: 'TOD_EPOCH', offset: 2, access: 'R/W', desc: 'Time-of-day epoch (Unix seconds)' },
                        { name: 'ALARM_CMP', offset: 3, access: 'R/W', desc: 'Alarm compare value (triggers IRQ when TICKS_LO matches)' },
                        { name: 'ALARM_CTL', offset: 4, access: 'R/W', desc: 'Bit 0: alarm enable · Bit 1: alarm armed (clear to ack)' },
                    ]
                },
            };
            const _mmioSpec = _LM_MMIO_REGS[nsEntry.label] || null;
            if (_mmioSpec) {
                const _baseB = (base * 4) >>> 0;
                const _limB  = _baseB + (_mmioSpec.regs.length - 1) * 4;
                const _fmt   = v => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
                const _tdS   = 'style="padding:3px 8px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.78rem;"';
                const _thS   = 'style="padding:3px 8px;border-bottom:1px solid rgba(255,255,255,0.1);font-size:0.72rem;color:#6b7280;font-weight:600;text-align:left;"';
                let _regRows = '';
                for (const r of _mmioSpec.regs) {
                    const _bA = _baseB + r.offset * 4;
                    const _ac = r.access === 'R' ? '#60a5fa' : r.access === 'W' ? '#f87171' : '#4ec9b0';
                    _regRows += `<tr>
                        <td ${_tdS}><code style="color:#c89b3c;">${r.name}</code></td>
                        <td ${_tdS}><code style="color:#9ca3af;">${_fmt(_bA)}</code></td>
                        <td ${_tdS}><span style="color:${_ac};font-family:monospace;">${r.access}</span></td>
                        <td ${_tdS} style="color:#6b7280;">${r.desc}</td>
                    </tr>`;
                }
                headerHtml = `<div style="margin-bottom:14px;">
                    <div style="color:#f0a040;font-size:0.75rem;font-weight:600;letter-spacing:0.06em;margin-bottom:6px;">&#x1F527; HARDWARE MMIO DEVICE — ${_mmioSpec.desc}</div>
                    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
                        <thead><tr>
                            <th ${_thS}>Register</th>
                            <th ${_thS}>Byte address</th>
                            <th ${_thS}>Access</th>
                            <th ${_thS}>Description</th>
                        </tr></thead>
                        <tbody>${_regRows}</tbody>
                    </table>
                    <div style="color:#6b7280;font-size:0.75rem;display:flex;gap:20px;">
                        <span>Base: <code style="color:#9ca3af;">${_fmt(_baseB)}</code></span>
                        <span>Limit: <code style="color:#9ca3af;">${_fmt(_limB)}</code></span>
                    </div>
                    <p style="margin:8px 0 0;color:#6b7280;font-size:0.8rem;line-height:1.5;">No lump header or c-list — capability enforced by the hardware address decoder.</p>
                </div>`;
            } else {
                // Not a known MMIO device and no lazy source lump — lump body
                // unavailable at this address (stale binary, evicted, or not yet loaded).
                headerHtml = `<div style="margin-bottom:14px;">
                    <div style="color:#888;font-size:0.75rem;font-weight:600;letter-spacing:0.06em;margin-bottom:6px;">LUMP BODY NOT AVAILABLE</div>
                    <p style="margin:0;color:#aaa;line-height:1.5;font-size:0.82rem;">No valid lump header found at word address <code style="color:#9ca3af;">${loc}</code>. The boot image may be stale — regenerate it via the Resident Lumps tab to fix this.</p>
                </div>`;
            }
        }
    }

    const overlay = document.createElement('div');
    overlay.id = '_nsLumpModalOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:#1a1a2e;border:1px solid rgba(200,155,60,0.35);border-radius:10px;padding:20px 24px;max-width:740px;width:95vw;max-height:82vh;overflow-y:auto;position:relative;box-shadow:0 8px 40px rgba(0,0,0,0.6);">
            <button onclick="document.getElementById('_nsLumpModalOverlay').remove()"
                style="position:absolute;top:12px;right:16px;background:none;border:none;color:#666;font-size:1.3rem;cursor:pointer;line-height:1;" title="Close (Esc)">&times;</button>
            <div style="color:#c89b3c;font-weight:700;font-size:1.05rem;margin-bottom:2px;">&#x1F4E6; ${label}</div>
            <div style="color:#6b7280;font-size:0.76rem;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:10px;">
                NS[${slotIdx}] &nbsp;·&nbsp;
                ${_modalToken ? `<button id="_nsModeBadgeSubtitle" class="btn btn-xs" data-mode="${_modalMode}" data-token="${_modalToken}"
                    onclick="_nsSlotCycleMode(this.dataset.token,this.dataset.mode)"
                    style="color:${_modalMode==='lazy'?'#f0a040':'#4ec9b0'};border:none;background:none;padding:0;font-size:0.76rem;cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px;"
                    title="Click to cycle: Resident → Lazy Load → Dynamic">${_modalMode==='lazy'?'Lazy Load':'Resident'}</button>` :
                    `<span style="color:${_lazyFetchToken?'#f0a040':'#4ec9b0'}">${_lazyFetchToken?'Lazy Load':'Inform'}</span>`}
                &nbsp;·&nbsp;
                <span id="_nsModeBadgeDesc">${_modalMode==='lazy'?'code fetched on demand':(_modalMode==='resident'?'physically resident in DMEM':'resolved at runtime')}</span>
            </div>
            ${tokenHtml}${headerHtml}${clistHtml}${codeHtml}
        </div>`;

    function _nsLumpEsc(ev) { if (ev.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', _nsLumpEsc); } }
    document.addEventListener('keydown', _nsLumpEsc);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) { overlay.remove(); document.removeEventListener('keydown', _nsLumpEsc); } });
    document.body.appendChild(overlay);

    // ── Async fetch for lazy/evicted lumps ────────────────────────────────────
    // When _lazyFetchToken is set the modal was opened for a lump whose binary is
    // not in sim.memory (out-of-range MMIO stub, post-Add+Save reload, etc.).
    // Fetch the real binary from the server and replace the loading placeholder.
    if (_lazyFetchToken) {
        const _lzTok = _lazyFetchToken;
        (async () => {
            const _lazyBody = document.getElementById('_nsLumpLazyBody');
            if (!_lazyBody) return;
            try {
                const [wordsResp] = await Promise.all([
                    fetch(`/api/lump/${_lzTok}/words`)
                ]);
                const _lazyBody2 = document.getElementById('_nsLumpLazyBody');
                if (!_lazyBody2) return;
                if (!wordsResp.ok) {
                    _lazyBody2.innerHTML = `<div style="color:#f87171;font-size:0.8rem;">&#9888; Server returned ${wordsResp.status} for token ${_lzTok}.</div>`;
                    return;
                }
                const wordsData = await wordsResp.json();
                const _lazyBody3 = document.getElementById('_nsLumpLazyBody');
                if (!_lazyBody3) return;
                const rawWords = wordsData && wordsData.words ? wordsData.words : null;
                if (!rawWords || rawWords.length === 0) {
                    _lazyBody3.innerHTML = `<div style="color:#f87171;font-size:0.8rem;">&#9888; No binary data returned for token ${_lzTok}.</div>`;
                    return;
                }
                const _hdr2 = sim.parseLumpHeader(rawWords[0] >>> 0);
                if (!_hdr2 || !_hdr2.valid) {
                    _lazyBody3.innerHTML = `<div style="color:#f87171;font-size:0.8rem;">&#9888; Binary header invalid (magic mismatch) for token ${_lzTok}.</div>`;
                    return;
                }
                const { cw, cc, lumpSize } = _hdr2;
                let fetchHtml = '';

                // Header table
                fetchHtml += `<div style="margin-bottom:14px;">
                    <div style="color:#c89b3c;font-size:0.75rem;font-weight:600;letter-spacing:0.06em;margin-bottom:6px;">LUMP HEADER <span style="color:#f0a040;font-weight:400;">(lazy \u2014 fetched from server)</span></div>
                    <table ${_nsMT}><tbody>
                        <tr><td ${_nsTD} style="color:#888;width:140px;">Magic</td><td ${_nsTD}><code>0x${_hdr2.magic.toString(16).toUpperCase()}</code> <span style="color:#4ec9b0;">&#10003; valid</span></td></tr>
                        <tr><td ${_nsTD} style="color:#888;">Code words (cw)</td><td ${_nsTD}>${cw}</td></tr>
                        <tr><td ${_nsTD} style="color:#888;">C-list words (cc)</td><td ${_nsTD}>${cc}</td></tr>
                        <tr><td ${_nsTD} style="color:#888;">Total lump size</td><td ${_nsTD}>${lumpSize} words (2<sup>${_hdr2.n_minus_6 + 6}</sup>)</td></tr>
                    </tbody></table></div>`;

                // C-list table
                if (cc > 0) {
                    const clistStart = lumpSize - cc;
                    let rows = '';
                    for (let _ci = 0; _ci < cc; _ci++) {
                        const gtw = (rawWords[clistStart + _ci] || 0) >>> 0;
                        let permStr = '\u2014', nameStr = '(null)', slotStr = '\u2014';
                        if (gtw !== 0 && typeof sim.parseGT === 'function') {
                            const parsed = sim.parseGT(gtw);
                            const p = parsed.permissions || {};
                            permStr = ['R','W','X','E','S','L'].filter(k => p[k]).join('') || '\u2205';
                            slotStr = parsed.type === 3 ? '\u2014' : String(parsed.index);
                            const lbl = (parsed.type !== 3 && sim.nsLabels) ? sim.nsLabels[parsed.index] : null;
                            nameStr = lbl || (parsed.type === 3 ? '(Abstract)' : `NS[${parsed.index}]`);
                        }
                        rows += `<tr>
                            <td ${_nsTD} style="color:#888;">${_ci}</td>
                            <td ${_nsTD}><code style="font-size:0.75rem;">0x${gtw.toString(16).toUpperCase().padStart(8,'0')}</code></td>
                            <td ${_nsTD} style="color:#888;">${slotStr}</td>
                            <td ${_nsTD} style="color:#4ec9b0;">${nameStr}</td>
                            <td ${_nsTD}><span class="ns-perm-chip" style="font-size:0.65rem;">${permStr}</span></td>
                        </tr>`;
                    }
                    fetchHtml += `<div style="margin-bottom:14px;">
                        <div style="color:#c89b3c;font-size:0.75rem;font-weight:600;letter-spacing:0.06em;margin-bottom:6px;">C-LIST (${cc} entries)</div>
                        <table ${_nsMT}>
                            <thead><tr><th ${_nsTH}>#</th><th ${_nsTH}>GT word</th><th ${_nsTH}>Slot</th><th ${_nsTH}>Name</th><th ${_nsTH}>Perms</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table></div>`;
                } else {
                    fetchHtml += `<div style="margin-bottom:14px;">
                        <div style="color:#c89b3c;font-size:0.75rem;font-weight:600;letter-spacing:0.06em;margin-bottom:6px;">C-LIST</div>
                        <span style="color:#6b7280;font-size:0.8rem;">cc = 0 \u2014 no c-list entries</span></div>`;
                }

                // Code table
                if (cw > 0) {
                    let rows2 = '';
                    for (let _ki = 0; _ki < cw; _ki++) {
                        const w = (rawWords[1 + _ki] || 0) >>> 0;
                        let dis = `0x${w.toString(16).toUpperCase().padStart(8,'0')}`;
                        if (typeof assembler !== 'undefined' && assembler && typeof assembler.disassemble === 'function') {
                            try { dis = assembler.disassemble(w).replace(/</g,'&lt;').replace(/>/g,'&gt;'); } catch (_) {}
                        }
                        rows2 += `<tr>
                            <td ${_nsTD} style="color:#888;">${_ki}</td>
                            <td ${_nsTD} style="color:#555;font-size:0.72rem;">+0x${(_ki+1).toString(16)}</td>
                            <td ${_nsTD}><code style="font-size:0.75rem;">0x${w.toString(16).toUpperCase().padStart(8,'0')}</code></td>
                            <td ${_nsTD} style="color:#dcdcaa;font-family:monospace;font-size:0.8rem;">${dis}</td>
                        </tr>`;
                    }
                    fetchHtml += `<div style="margin-bottom:14px;">
                        <div style="color:#c89b3c;font-size:0.75rem;font-weight:600;letter-spacing:0.06em;margin-bottom:6px;">CODE (${cw} word${cw === 1 ? '' : 's'})</div>
                        <div style="overflow-y:auto;max-height:260px;border:1px solid rgba(255,255,255,0.06);border-radius:4px;">
                        <table ${_nsMT}>
                            <thead><tr><th ${_nsTH} style="position:sticky;top:0;background:#1a1a2e;z-index:1;">Offset</th><th ${_nsTH} style="position:sticky;top:0;background:#1a1a2e;z-index:1;">+word</th><th ${_nsTH} style="position:sticky;top:0;background:#1a1a2e;z-index:1;">Word</th><th ${_nsTH} style="position:sticky;top:0;background:#1a1a2e;z-index:1;">Disassembly</th></tr></thead>
                            <tbody>${rows2}</tbody>
                        </table></div></div>`;
                } else {
                    fetchHtml += `<span style="color:#6b7280;font-size:0.8rem;">cw = 0 \u2014 no code words</span>`;
                }

                _lazyBody3.innerHTML = fetchHtml;
            } catch (err) {
                const _lb = document.getElementById('_nsLumpLazyBody');
                if (_lb) _lb.innerHTML = `<div style="color:#f87171;font-size:0.8rem;">&#9888; Failed to load: ${String(err).replace(/</g,'&lt;')}</div>`;
            }
        })();
    }
}

// ── Type description modal — Null / Outform / Abstract entries ────────────────
function _showNSTypeDescModal(slotIdx, nsEntry) {
    const _existingDesc = document.getElementById('_nsTypeDescModalOverlay');
    if (_existingDesc) _existingDesc.remove();

    const typeNames = ['NULL','Inform','Outform','Abstract'];
    const gtType = nsEntry ? (nsEntry.gtType || 0) : 0;
    const label  = (nsEntry ? (nsEntry.label || `NS[${slotIdx}]`) : `NS[${slotIdx}]`).replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const loc    = nsEntry ? `0x${(nsEntry.word0_location*4).toString(16).toUpperCase().padStart(8,'0')}` : '—';

    const descs = {
        0: { icon: '○', color: '#6b7280', title: 'Empty slot',
             body: 'No lump is installed at this namespace slot. The entry exists in the table but has no backing lump, c-list, or code. Deploy a compiled abstraction here to make it callable.' },
        2: { icon: '⇥', color: '#60a5fa', title: 'Output endpoint',
             body: 'This entry defines an outgoing capability — a firmware download trigger, device binding, or external service reference. The capability system resolves it to a concrete lump at runtime when first accessed (lazy-load). It cannot be entered with a CALL until the lump is fetched and promoted to Inform.' },
        3: { icon: '◇', color: '#a78bfa', title: 'Advisory capability',
             body: 'No lump is directly resident here. This entry carries a permission-profile annotation used for authority delegation by the capability system. It is invisible to user-mode LOAD instructions (M-bit gated) and holds no code, no c-list, and no lump header.' },
    };
    const d = descs[gtType] || descs[0];

    // ── MMIO register map (slots 2-5 are hardware devices, not software lumps) ──
    // Registers are word-wide (4 bytes each); byte address = base + offset*4.
    // Base byte address = word0_location * 4 (matches the loc variable above).
    const _MMIO_REGS = {
        'UART_DEV': {
            desc: 'Serial UART — 3 word-wide registers',
            regs: [
                { name: 'TX',     offset: 0, access: 'W',  desc: 'Transmit data word (write to send)' },
                { name: 'STATUS', offset: 1, access: 'R',  desc: 'Bit 0: TX ready · Bit 1: RX valid' },
                { name: 'RX',     offset: 2, access: 'R',  desc: 'Received data word (read to consume)' },
            ]
        },
        'LED_DEV': {
            desc: 'GPIO LEDs — 5 word-wide registers (one per LED)',
            regs: [
                { name: 'LED0', offset: 0, access: 'R/W', desc: 'LED 0 state (1 = on)' },
                { name: 'LED1', offset: 1, access: 'R/W', desc: 'LED 1 state' },
                { name: 'LED2', offset: 2, access: 'R/W', desc: 'LED 2 state' },
                { name: 'LED3', offset: 3, access: 'R/W', desc: 'LED 3 state' },
                { name: 'LED4', offset: 4, access: 'R/W', desc: 'LED 4 state' },
            ]
        },
        'BTN_DEV': {
            desc: 'GPIO button — 1 word-wide register',
            regs: [
                { name: 'BTN_STATE', offset: 0, access: 'R', desc: 'Button state (1 = pressed)' },
            ]
        },
        'TIMER_DEV': {
            desc: 'Hardware timer — 5 word-wide registers',
            regs: [
                { name: 'TICKS_LO',  offset: 0, access: 'R',   desc: 'Free-running tick counter, low 32 bits' },
                { name: 'TICKS_HI',  offset: 1, access: 'R',   desc: 'Free-running tick counter, high 32 bits' },
                { name: 'TOD_EPOCH', offset: 2, access: 'R/W', desc: 'Time-of-day epoch (Unix seconds)' },
                { name: 'ALARM_CMP', offset: 3, access: 'R/W', desc: 'Alarm compare value (triggers IRQ when TICKS_LO matches)' },
                { name: 'ALARM_CTL', offset: 4, access: 'R/W', desc: 'Bit 0: alarm enable · Bit 1: alarm armed (clear to ack)' },
            ]
        },
    };

    // Strip HTML entities from label before using as a map key
    const _rawLabel = (nsEntry ? (nsEntry.label || '') : '');
    const _mmioInfo = _MMIO_REGS[_rawLabel] || null;
    let mmioHtml = '';
    if (_mmioInfo && nsEntry) {
        const baseByteAddr = (nsEntry.word0_location * 4) >>> 0;
        const _tdS = 'style="padding:3px 8px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.78rem;"';
        const _thS = 'style="padding:3px 8px;border-bottom:1px solid rgba(255,255,255,0.1);font-size:0.72rem;color:#6b7280;font-weight:600;text-align:left;"';
        const limitByteAddr = baseByteAddr + (_mmioInfo.regs.length - 1) * 4;
        const _fmtAddr = v => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
        let regRows = '';
        for (const r of _mmioInfo.regs) {
            const byteAddr = baseByteAddr + r.offset * 4;
            const _accColor = r.access === 'R' ? '#60a5fa' : r.access === 'W' ? '#f87171' : '#4ec9b0';
            regRows += `<tr>
                <td ${_tdS}><code style="color:#c89b3c;">${r.name}</code></td>
                <td ${_tdS}><code style="color:#9ca3af;">${_fmtAddr(byteAddr)}</code></td>
                <td ${_tdS}><span style="color:${_accColor};font-family:monospace;">${r.access}</span></td>
                <td ${_tdS} style="color:#6b7280;">${r.desc}</td>
            </tr>`;
        }
        mmioHtml = `
            <div style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.07);padding-top:12px;">
                <div style="color:#f0a040;font-size:0.72rem;font-weight:600;letter-spacing:0.06em;margin-bottom:6px;">&#x1F527; HARDWARE REGISTERS</div>
                <div style="color:#6b7280;font-size:0.75rem;margin-bottom:8px;">${_mmioInfo.desc}</div>
                <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
                    <thead><tr>
                        <th ${_thS}>Name</th>
                        <th ${_thS}>Byte address</th>
                        <th ${_thS}>Access</th>
                        <th ${_thS}>Description</th>
                    </tr></thead>
                    <tbody>${regRows}</tbody>
                </table>
                <div style="color:#6b7280;font-size:0.75rem;display:flex;gap:20px;">
                    <span>Base: <code style="color:#9ca3af;">${_fmtAddr(baseByteAddr)}</code></span>
                    <span>Limit: <code style="color:#9ca3af;">${_fmtAddr(limitByteAddr)}</code></span>
                </div>
            </div>`;
    } else {
        mmioHtml = `<div style="color:#6b7280;font-size:0.76rem;margin-top:14px;">Base address: <code>${loc}</code></div>`;
    }

    const overlay = document.createElement('div');
    overlay.id = '_nsTypeDescModalOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:#1a1a2e;border:1px solid rgba(107,114,128,0.35);border-radius:10px;padding:20px 24px;max-width:560px;width:90vw;position:relative;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
            <button onclick="document.getElementById('_nsTypeDescModalOverlay').remove()"
                style="position:absolute;top:12px;right:16px;background:none;border:none;color:#666;font-size:1.3rem;cursor:pointer;line-height:1;" title="Close (Esc)">&times;</button>
            <div style="color:${d.color};font-weight:700;font-size:1.05rem;margin-bottom:4px;">${d.icon} ${d.title}</div>
            <div style="color:#6b7280;font-size:0.76rem;margin-bottom:14px;">NS[${slotIdx}] &nbsp;·&nbsp; ${typeNames[gtType] || 'Unknown'} &nbsp;·&nbsp; ${label}</div>
            <p style="color:#ccc;line-height:1.65;margin:0 0 0;font-size:0.88rem;">${d.body}</p>
            ${mmioHtml}
        </div>`;

    function _nsDescEsc(ev) { if (ev.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', _nsDescEsc); } }
    document.addEventListener('keydown', _nsDescEsc);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) { overlay.remove(); document.removeEventListener('keydown', _nsDescEsc); } });
    document.body.appendChild(overlay);
}

// ── Memory dump view ──────────────────────────────────────────────────────────

window.memoryViewAddr = 0;

function _openLumpSource(token, nsSlotFallback) {
    // Pass a pending-token and pending-tab to renderLumps() via window properties.
    // renderLumps() reads these after all auto-select logic runs, so the user's
    // explicit slot click always wins over the live CR14 auto-select.

    if (token) {
        // Fast path: token already known — navigate immediately.
        window._pendingLumpToken = token;
        window._pendingLumpTab = 'clooms';
        if (typeof switchView === 'function') switchView('lumps');
        return;
    }

    if (typeof nsSlotFallback !== 'number') {
        // No useful hint — just open the Lumps view at whatever is currently selected.
        window._pendingLumpTab = 'clooms';
        if (typeof switchView === 'function') switchView('lumps');
        return;
    }

    // Fallback path: no cached token for this slot yet.
    // Resolve the label from the live NS entry, warm the registry if needed, then navigate.
    // nsSlotFallback is a number (the NS slot index), safe to embed directly in HTML onclick.
    (async function() {
        let absLabel = null;
        if (typeof sim !== 'undefined' && sim && typeof sim.readNSEntry === 'function') {
            const _nsEntry = sim.readNSEntry(nsSlotFallback);
            absLabel = _nsEntry ? _nsEntry.label : null;
        }
        let resolvedToken = null;
        if (absLabel && window.LumpRegistry) {
            // Warm the server list so the lookup reflects the current server state,
            // even on first click before any renderLumps() call has completed.
            if (!window.LumpRegistry.isServerListFetched()) {
                try { await window.LumpRegistry.warmServerList(); } catch (_e) {}
            }
            const _byLabel = window.LumpRegistry.getServerList().find(function(l) {
                return l.abstraction === absLabel;
            });
            if (_byLabel) resolvedToken = _byLabel.token;
        }
        if (resolvedToken) window._pendingLumpToken = resolvedToken;
        window._pendingLumpTab = 'clooms';
        if (typeof switchView === 'function') switchView('lumps');
    }());
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
            // Canonical NS ABI: limit is W1[16:0]; c-list count is entry metadata
            // (readNSEntry), NOT a W1 field.
            const _lim = sim.parseNSWord1(_ne.word1_limit);
            const _cc  = _ne.clistCount || 0;
            if (!_lim || _cc === 0) continue;
            const _clistStart = _lumpBase + _lim.limit + 1 - _cc;
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
// Restore the user's selected LightningBolt entry across IDE restarts.
// SelfTest at slot 6 remains the fallback for a missing or malformed value;
// app-abstractions.js applies architecture-specific slot migration/bounds.
let bootEntrySlot = 6;
try {
    const _storedBootEntry = Number.parseInt(localStorage.getItem('bootEntrySlot'), 10);
    if (Number.isInteger(_storedBootEntry) && _storedBootEntry >= 0 && _storedBootEntry <= 0xFFFF) {
        bootEntrySlot = _storedBootEntry;
    }
} catch (_e) {}
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
    sim.writePersistentWord(baseLoc, sim.packLumpHeader(newNM6, cw, cc, typ));

    // Zero freespace within new lump (code already in-place at [1..cw])
    for (let i = cw + 1; i < minSize - cc; i++) sim.writePersistentWord(baseLoc + i, 0);

    // Write c-list at new tail
    for (let i = 0; i < cc; i++) {
        sim.writePersistentWord(baseLoc + minSize - cc + i, clistWords[i]);
    }

    // Zero freed trailing words
    for (let i = minSize; i < currentSize; i++) sim.writePersistentWord(baseLoc + i, 0);

    // ── Step 5: update NS entry ───────────────────────────────────────────────
    // Canonical NS ABI: W1 is authority only (limit[20:0] | gtSeq[29:21] | G | F).
    // c-list count is NOT a W1 field — it lives in the resident header (updated
    // above) and the writeNSEntry side-table. Preserve gt_seq, g-bit, declared
    // type and W3; set the new limit17 (= minSize-1). writeNSEntry recomputes W2.
    const nsBase   = sim._nsSlotBase(nsIdx);
    const _w1c     = sim.parseNSWord1(sim.memory[nsBase + 1] >>> 0);
    const _entryC  = sim.readNSEntry(nsIdx) || {};
    sim.withNamespaceWrite('manual LUMP compression', function() {
        sim.writeNSEntry(nsIdx, baseLoc, (minSize - 1) & 0x1FFFF, 0, _w1c.g,
            _entryC.gtType != null ? _entryC.gtType : 1, _w1c.gtSeq, cc,
            _entryC.word3_cache_token || 0);
    });

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
            sealOk: false, storedSeal: '????????', expectedSeal: '????????',
            warnings: [`BAD MAGIC: header=0x${hdrWord.toString(16).toUpperCase().padStart(8, '0')} (expected magic=0x1F)`],
            invalid: true,
        };
    }

    const sealOk = (typeof sim.validateMAC === 'function') ? sim.validateMAC(nse) : false;
    const lim = (typeof sim.parseNSWord1 === 'function') ? sim.parseNSWord1(nse.word1_limit) : { limit: 0, gtSeq: 0 };
    // Canonical NS ABI: W2 is a full 32-bit integrity32 hash of {W0, W1}, not a
    // CRC16 in the low 16 bits. Expected value is recomputed via makeVersionSeals
    // (integrity32), which now reconstructs W1 from limit + gt_seq (W1[29:21]).
    const storedSeal = (nse.word2_seals >>> 0).toString(16).toUpperCase().padStart(8, '0');
    const expectedSeal = (typeof sim.makeVersionSeals === 'function')
        ? (sim.makeVersionSeals(lim.gtSeq, baseLoc, lim.limit) >>> 0).toString(16).toUpperCase().padStart(8, '0')
        : '????????';

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

    // ── 5. SEAL (integrity32 check) ───────────────────────────────────────
    // Canonical NS ABI: W2 is a full 32-bit integrity32 hash of {W0, W1}.
    const sealOk = sim.validateMAC(nse);
    const storedSeal   = (nse.word2_seals >>> 0).toString(16).toUpperCase().padStart(8,'0');
    const lim          = sim.parseNSWord1(nse.word1_limit);
    const expectedSeal = (sim.makeVersionSeals(lim.gtSeq, baseLoc, lim.limit) >>> 0).toString(16).toUpperCase().padStart(8,'0');
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
    // Encoding: opcode=[31:27], crSrc=[18:15], slot=[4:0]
    // LOAD=0, SAVE=1: imm15 = slot (5-bit, bits[4:0])
    // ELOADCALL=8, XLOADLAMBDA=9: imm15 = (methodIdx<<5)|row — row is bits[4:0] only.
    // Using & 0x7FFF (15-bit mask) would read the method index bits as part of the
    // slot for ELOADCALL/XLOADLAMBDA, producing false positives (e.g. slot=32 when
    // the actual row is 0).  Always mask with 0x1F (bits[4:0]).
    if (hdr.cc > 0) {
        const _CLIST_OPS = new Set([0, 1, 8, 9]);
        let _clistOk = true;
        for (let _wi = 1; _wi <= hdr.cw; _wi++) {
            const _ww    = (sim.memory[baseLoc + _wi] >>> 0);
            const _op    = (_ww >>> 27) & 0x1F;
            const _crSrc = (_ww >>> 15) & 0xF;
            const _slot  = _ww & 0x1F;   // row lives in bits[4:0] for all clist ops
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
        for (let i = 0; i < hdr.lumpSize; i++) {
            _pnaWords.push(typeof sim.persistentMemoryWord === 'function'
                ? sim.persistentMemoryWord(baseLoc + i)
                : (sim.memory[baseLoc + i] >>> 0));
        }
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
    for (let i = 0; i < hdr.lumpSize; i++) {
        words.push(typeof sim.persistentMemoryWord === 'function'
            ? sim.persistentMemoryWord(baseLoc + i)
            : (sim.memory[baseLoc + i] >>> 0));
    }
    const typeNames = ['code', 'namespace', 'thread', '?'];
    const metadata = {
        abstraction:  absName,
        // ns_slot intentionally omitted — ns-state.json is the authoritative
        // slot→token map; slot assignment is committed via Save for next build.
        content_type: typeNames[hdr.typ] || 'code',
        cw:           hdr.cw,
        cc:           hdr.cc,
        lump_size:    hdr.lumpSize,
    };
    if (_meta.version) metadata.version = _meta.version;
    try {
        if (typeof window._confirmLumpSavePlan !== 'function') {
            throw new Error('Save-plan approval helper is unavailable');
        }
        const approval = await window._confirmLumpSavePlan(
            words, metadata, () => `Save "${absName}" to the LUMP repository?`);
        if (!approval) return;
        metadata.approval_intent = approval.intent.intent;
        metadata.save_plan_id = approval.plan.plan_id;
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
    const BRANCH_OPCODE = 23; // v2.0 ISA: BRANCH is opcode 23

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
    sim.writePersistentWord(addr, 0);
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
            sim.writePersistentWord(addr, 0);
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
            sim.writePersistentWord(clistBase + i, 0);
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
                    sim.writePersistentWord(addr,
                        ((word & 0xFFFF8000) | (newSlot & 0x7FFF)) >>> 0);
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
    for (let j = 0; j < newCC; j++) sim.writePersistentWord(newClistBase + j, newGTs[j]);
    // Zero freed region between old and new c-list start
    for (let addr = clistBase; addr < newClistBase; addr++) sim.writePersistentWord(addr, 0);

    // ── Step 7: update lump header and NS entry ────────────────────────────
    // Canonical NS ABI: c-list count is NOT a W1 field. It lives in the resident
    // lump header (just rewritten via packLumpHeader) and the writeNSEntry side-
    // table. gt_seq is W1[29:21]; W2 is integrity32(W0, W1). The authority word
    // W1 is unchanged here (only the c-list count changed), and writeNSEntry
    // recomputes W2 coherently.
    sim.writePersistentWord(baseLoc, sim.packLumpHeader(n_minus_6, cw, newCC, typ));
    const nsBase = sim._nsSlotBase(nsIdx);
    const oldEntry = sim.readNSEntry(nsIdx) || {};
    const w1fP   = sim.parseNSWord1(sim.memory[nsBase + 1] >>> 0);
    const gtSeqP = w1fP.gtSeq;
    // Preserve limit17, g-bit, gt_seq, declared type and W3; only clistCount changes.
    sim.withNamespaceWrite('manual C-list compaction', function() {
        sim.writeNSEntry(nsIdx, baseLoc, w1fP.limit, 0, w1fP.g,
            oldEntry.gtType != null ? oldEntry.gtType : 1, gtSeqP, newCC,
            oldEntry.word3_cache_token || 0);
    });
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

// ── Unsaved NS changes — browser unload guard ─────────────────────────────────
// Warn the user if they try to navigate away with uncommitted NS changes so they
// don't accidentally lose Add LUMP / Clear slot / boot-entry drag work.
window.addEventListener('beforeunload', function _nsBeforeUnload(e) {
    if (!window._nsTableDirty) return;
    e.preventDefault();
    return (e.returnValue = 'Namespace changes have not been saved — click \u201cSave for next build\u201d before leaving.');
});

// ── Boot Sequence Code ─────────────────────────────────────────────────────
// Actual hardware boot steps that install each Layer-0 abstraction.
// Mirrors simulator.js _bootStep() exactly.
