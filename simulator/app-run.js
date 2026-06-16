function _normalizePetNameKeys(rawMap) {
    const out = {};
    for (const [k, v] of Object.entries(rawMap || {})) {
        const n = (typeof k === 'string' && k.match(/^[A-Za-z]+\d+$/))
            ? parseInt(k.replace(/^[A-Za-z]+/, ''))
            : parseInt(k);
        if (!isNaN(n) && v) out[n] = v;
    }
    return out;
}

function _applyLumpPetNames(lump, methodIdx) {
    const globalDR = _normalizePetNameKeys(((lump.pet_names || {}).DR) || {});
    const globalCR = _normalizePetNameKeys(((lump.pet_names || {}).CR) || {});
    const mergedDR = Object.assign({}, globalDR);
    const mergedCR = Object.assign({}, globalCR);
    if (methodIdx !== undefined && methodIdx !== null) {
        const method = (lump.methods || [])[methodIdx];
        if (method && method.pet_names) {
            Object.assign(mergedDR, _normalizePetNameKeys((method.pet_names.DR) || {}));
            Object.assign(mergedCR, _normalizePetNameKeys((method.pet_names.CR) || {}));
        }
    }
    _petNameDRMap = mergedDR;
    _petNameCRMap = mergedCR;
}

function _clearLumpPetNames() {
    _petNameDRMap = {};
    _petNameCRMap = {};
}

// Cache of lump binary words for tier-4 boot matching (null = not started).
// Populated asynchronously; keyed by token → Uint32Array of lump words.
let _lumpWordsCache = null;

function _triggerLumpWordsPreload() {
    if (_lumpWordsCache !== null) return;
    _lumpWordsCache = {};
    if (!Array.isArray(_lumpsCache) || _lumpsCache.length === 0) return;
    for (const lump of _lumpsCache) {
        const tok = lump.token;
        if (!tok) continue;
        fetch(`/api/lump/${tok}/words`)
            .then(r => r.ok ? r.json() : null)
            .then(words => {
                if (Array.isArray(words) && words.length > 0) {
                    _lumpWordsCache[tok] = new Uint32Array(words.map(w => w >>> 0));
                }
            })
            .catch(() => {});
    }
}

function _applyBootLumpPetNames() {
    if (!sim || !sim.bootComplete) return;
    const cr14 = sim.getFormattedCR ? sim.getFormattedCR(14) : null;
    if (!cr14 || cr14.isNull) return;
    const nsIdx = cr14.gtIndex;
    if (nsIdx === undefined || nsIdx === null) return;
    if (!Array.isArray(_lumpsCache) || _lumpsCache.length === 0) return;

    // Trigger async word preload on first call (results available on next boot).
    _triggerLumpWordsPreload();

    // Tier 1: match by ns_slot metadata
    let lump = _lumpsCache.find(l =>
        l.ns_slot !== undefined && l.ns_slot !== null && parseInt(l.ns_slot) === nsIdx
    );
    // Tier 2: match by NS label name (case-insensitive)
    if (!lump) {
        const nsLabel = (sim.nsLabels && sim.nsLabels[nsIdx]) ? sim.nsLabels[nsIdx].toLowerCase() : null;
        if (nsLabel) {
            lump = _lumpsCache.find(l => l.name && l.name.toLowerCase() === nsLabel);
        }
    }
    // Tier 3: match by CR14 word1_location falling within an nsTable slot range
    if (!lump) {
        const cr14Loc = (cr14.word1_location !== undefined && cr14.word1_location !== null)
            ? (cr14.word1_location >>> 0) : null;
        if (cr14Loc !== null && sim.nsTable) {
            for (const [slotIdx, nse] of Object.entries(sim.nsTable)) {
                const slotBase = nse && nse.word0_location !== undefined
                    ? (nse.word0_location >>> 0) : null;
                if (slotBase !== null && cr14Loc >= slotBase && cr14Loc < slotBase + 0x10000) {
                    const si = parseInt(slotIdx);
                    lump = _lumpsCache.find(l =>
                        l.ns_slot !== undefined && l.ns_slot !== null && parseInt(l.ns_slot) === si
                    );
                    if (lump) break;
                }
            }
        }
    }
    // Tier 4: binary-word comparison — compare sim.memory at the NS slot base
    // against preloaded lump word arrays (available after first async preload).
    if (!lump && _lumpWordsCache && Object.keys(_lumpWordsCache).length > 0 && sim.nsTable) {
        const nse = sim.nsTable[nsIdx];
        const slotBase = (nse && nse.word0_location !== undefined) ? (nse.word0_location >>> 0) : null;
        if (slotBase !== null && sim.memory) {
            const COMPARE_WORDS = 8;
            for (const tok of Object.keys(_lumpWordsCache)) {
                const cached = _lumpWordsCache[tok];
                if (!cached || cached.length < COMPARE_WORDS) continue;
                let matches = 0;
                for (let wi = 0; wi < COMPARE_WORDS; wi++) {
                    if ((sim.memory[slotBase + wi] >>> 0) === cached[wi]) matches++;
                }
                if (matches >= COMPARE_WORDS - 1) {
                    lump = _lumpsCache.find(l => l.token === tok);
                    if (lump) break;
                }
            }
        }
    }
    if (lump) _applyLumpPetNames(lump);
}

// Push live snippet history for raw assembly programs.
// Splits the source by label definitions (matching result.labels keys) so that
// each labelled section is stored as a separate method entry, exactly mirroring
// how the high-level CLOOMC++ path stores per-method sourceLines.
// Falls back to pushing the entire source under the program name when no labels
// are present (e.g. unlabelled linear programs).
function _pushAsmLabelSnippets(source, labels, progName) {
    if (typeof ChurchAssembler === 'undefined') return;
    const _nameMatch = source.match(/^;\s*(?:Disassembly\s+of\s+\S+\s+)?([^\n@]+?)\s+(?:NS\[|\@\s*0x)/m);
    const absName = (_nameMatch ? _nameMatch[1].trim() : null) || progName || 'Assembly';
    const lines = source.split('\n');
    const labelNames = Object.keys(labels || {});
    if (labelNames.length === 0) {
        ChurchAssembler.pushLiveSnippet(absName, absName, source);
        return;
    }
    // Mirror the assembler's own label detection (assembler.js line 654):
    // a label is a line whose trimmed content ends with ':', name = slice before ':'.
    const labelLineMap = {};
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.endsWith(':')) {
            const candidateName = trimmed.slice(0, -1).trim();
            if (labels[candidateName] !== undefined) {
                labelLineMap[candidateName] = i;
            }
        }
    }
    const sortedByLine = Object.entries(labelLineMap).sort((a, b) => a[1] - b[1]);
    if (sortedByLine.length === 0) {
        ChurchAssembler.pushLiveSnippet(absName, absName, source);
        return;
    }
    for (let li = 0; li < sortedByLine.length; li++) {
        const [lName, lLine] = sortedByLine[li];
        const nextLine = li + 1 < sortedByLine.length ? sortedByLine[li + 1][1] : lines.length;
        const snippet = lines.slice(lLine, nextLine).join('\n').trimEnd();
        if (snippet) ChurchAssembler.pushLiveSnippet(absName, lName, snippet);
    }
}

function assembleAndLoad() {
    const editor = document.getElementById('asmEditor');
    if (!editor) return;
    const source = editor.value;
    saveEditorState();
    _clearLumpPetNames();

    _runStopped = true;
    sim.running = false;

    const con = document.getElementById('editorConsole');

    const isHighLevel = cloomcCompiler && (
        cloomcCompiler._detectPetName(source) ||
        cloomcCompiler._detectEnglish(source) ||
        cloomcCompiler._detectHaskell(source) ||
        cloomcCompiler._detectSymbolic(source) ||
        /^\s*abstraction\s+\w+/m.test(source)
    );

    if (isHighLevel) {
        const result = cloomcCompiler.compile(source, []);
        if (result.errors.length > 0) {
            const errText = result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
            if (con) con.textContent = `CLOOMC++ errors:\n${errText}`;
            window._assemblerSymbols = null;
            switchCodeTab('console');
            showNextSteps('error');
            return;
        }
        const methods = result.methods || [];
        const methodTableSize = methods.length;
        const words = [];
        const labels = {};
        // Layout: words[0..N-1] = method table entries; words[N..] = method bodies.
        // loadProgram writes words[k] at lump word k+1 (word 0 is lump header).
        // Method-table entries are BRANCH instructions (opcode 17, 15-bit signed offset),
        // matching _assembleLumpFromCatalog / _tryAutoAssembleLump (Tasks #1134, #1145).
        // CALL dispatcher: pc = (methodIndex-1) + soff = i + (codeOffset-i) = codeOffset
        // Fetch: physAddr = lumpBase + 1 + codeOffset → body first instruction. ✓
        let codeOffset = methodTableSize; // lump-relative PC of first body (table = PCs 0..N-1)
        const methodTableEntries = [];
        // Emit BRANCH-encoded method-table entries (opcode 17, 15-bit signed offset).
        // Matches _assembleLumpFromCatalog / _tryAutoAssembleLump (Task #1134 / #1145).
        // Table entry i sits at lump word i+1, lump-relative PC = i.
        // branchOffset = bodyOffset(=codeOffset) - i
        // CALL dispatcher: pc = (methodIndex-1) + soff = i + (codeOffset-i) = codeOffset ✓
        for (let i = 0; i < methods.length; i++) {
            const m = methods[i];
            const branchOffset = codeOffset - i;
            methodTableEntries.push(m.visibility === 'private' ? 0 : (((17 << 27) | (branchOffset & 0x7FFF)) >>> 0));
            labels[m.name] = codeOffset;      // lump-relative PC: body at lumpBase+1+codeOffset
            codeOffset += (m.code || []).length;
        }
        for (const entry of methodTableEntries) words.push(entry);
        for (const m of methods) {
            for (const w of (m.code || [])) words.push(w);
        }
        lastAssembledWords = words.slice();
        lastAssembledCapabilities = (result.capabilities && result.capabilities.length > 0) ? result.capabilities.slice() : null;
        lastAssembledNamedSlots = (result.namedSlots && result.namedSlots.length > 0) ? result.namedSlots.slice() : null;
        lastMethodTableSize = methodTableSize;
        _defaultProgramLoaded = true;
        sim.programLabels = labels;
        sim.programCapabilities = result.capabilities ? result.capabilities.slice() : [];
        sim.programName = result.abstractionName || (methods.length > 0 ? methods[0].name : 'prog');
        window._assemblerSymbols = { labels, lumpName: sim.programName };
        _pendingSimLoad = true;
        const manifestByMethod = {};
        if (result.manifest) {
            for (const entry of result.manifest) {
                const comments = {};
                if (entry.mapping) {
                    let seqIdx = 0;
                    for (const m of entry.mapping) {
                        if (m.comment !== undefined) {
                            comments[seqIdx++] = m.comment;
                        } else if (m.addr !== undefined && m.desc) {
                            comments[m.addr] = m.desc;
                        }
                    }
                }
                manifestByMethod[entry.name] = comments;
            }
        }
        let listing = `; Assembled ${words.length} word${words.length !== 1 ? 's' : ''} — ${result.abstractionName || 'CLOOMC++'} (${methods.length} method${methods.length !== 1 ? 's' : ''})\n\n`;
        for (let mi = 0; mi < methods.length; mi++) {
            listing += `; [method table] ${mi}: offset ${methodTableEntries[mi]}\n`;
        }
        listing += '\n';
        for (const m of methods) {
            if (m.aliasOf) {
                listing += `; method ${m.name} → alias of ${m.aliasOf}\n\n`;
                continue;
            }
            listing += `; method ${m.name}\n`;
            const mCode = m.code || [];
            const comments = manifestByMethod[m.name] || {};
            for (let i = 0; i < mCode.length; i++) {
                const w = mCode[i];
                const mnem = _applyMethodDRNames(w === 0 ? 'NOP' : assembler.disassemble(w), m);
                const comment = comments[i];
                listing += comment ? `${mnem.padEnd(40)}; ${comment}\n` : `${mnem}\n`;
            }
            listing += '\n';
        }
        if (result.abstractionName === 'EnglishLoops' && methods.length > 0) {
            listing += '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n';
            listing += '  LOOP STYLE COMPARISON\n';
            listing += '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n';
            const countInstrs = (codeArr) => {
                let branches = 0, calls = 0, lambdas = 0, mcmps = 0, total = codeArr.length;
                for (const w of codeArr) {
                    const op = (w >>> 27) & 0x1F;
                    if (op === 17) branches++;
                    if (op === 2) calls++;
                    if (op === 7) lambdas++;
                    if (op === 14) mcmps++;
                }
                return { branches, calls, lambdas, mcmps, total };
            };
            const styleMap = {
                'WhileSum': 'WHILE LOOP (MCMP + BRANCH)',
                'RecurseSum': 'RECURSIVE REPEAT (CALL CR6, SZ=1)',
                'LambdaSum': 'LAMBDA RECURSION (LAMBDA CR6, SZ=0)'
            };
            for (const m of methods) {
                const s = countInstrs(m.code || []);
                const style = styleMap[m.name] || m.name;
                listing += '  ' + m.name + ' \u2014 ' + style + ':\n';
                listing += '    ' + s.total + ' instructions, ' + s.branches + ' BRANCH, ' + s.calls + ' CALL, ' + s.lambdas + ' LAMBDA, ' + s.mcmps + ' MCMP\n\n';
            }
            const whileM = methods.find(m => m.name === 'WhileSum');
            const recurseM = methods.find(m => m.name === 'RecurseSum');
            const lambdaM = methods.find(m => m.name === 'LambdaSum');
            if (whileM && recurseM && lambdaM) {
                const ws = countInstrs(whileM.code || []);
                const rs = countInstrs(recurseM.code || []);
                const ls = countInstrs(lambdaM.code || []);
                listing += '  \u2500\u2500 TRADEOFF \u2500\u2500\n';
                listing += '    While loop:      ' + ws.branches + ' BRANCH per iteration (compare + loop-back)\n';
                listing += '    Repeat (CALL):   ' + rs.calls + ' CALL per iteration (2-word frame, namespace swap)\n';
                listing += '    Lambda (LAMBDA): ' + ls.lambdas + ' LAMBDA per iteration (1-word frame, no swap)\n';
                listing += '\n';
                listing += '    \u2192 While: compact but branches can stall the pipeline\n';
                listing += '    \u2192 CALL:  capability-checked, predictable, heavier frame (SZ=1)\n';
                listing += '    \u2192 LAMBDA: lightest recursion \u2014 1-word frame, no namespace gate\n';
                listing += '    \u2192 All three produce identical results: n + (n-1) + ... + 1\n';
                listing += '\n';
            }
        }
        if (result.abstractionName === 'ChurchVsCompiled' && methods.length > 0) {
            listing += '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n';
            listing += '  INSTRUCTION COUNT COMPARISON\n';
            listing += '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n';
            const compiledMethods = methods.filter(m => m.name.startsWith('compiled_'));
            const churchMethods = methods.filter(m => m.name.startsWith('church_'));
            const countInstrs = (codeArr) => {
                let branches = 0, calls = 0, mcmps = 0, total = codeArr.length;
                for (const w of codeArr) {
                    const op = (w >>> 27) & 0x1F;
                    if (op === 17) branches++;
                    if (op === 2) calls++;
                    if (op === 14) mcmps++;
                }
                return { branches, calls, mcmps, total };
            };
            let totalCompiledBranch = 0, totalCompiledInstr = 0;
            let totalChurchBranch = 0, totalChurchInstr = 0, totalChurchCall = 0;
            if (compiledMethods.length > 0) {
                listing += '  COMPILED (if/then/else \u2192 CMP + BRANCH):\n';
                for (const m of compiledMethods) {
                    const s = countInstrs(m.code || []);
                    totalCompiledBranch += s.branches;
                    totalCompiledInstr += s.total;
                    listing += '    ' + m.name + ': ' + s.total + ' instructions, ' + s.branches + ' BRANCH, ' + s.mcmps + ' MCMP\n';
                }
                listing += '\n';
            }
            if (churchMethods.length > 0) {
                listing += '  CHURCH (\u03BB-application \u2192 CALL selectors, no BRANCH):\n';
                for (const m of churchMethods) {
                    const s = countInstrs(m.code || []);
                    totalChurchBranch += s.branches;
                    totalChurchCall += s.calls;
                    totalChurchInstr += s.total;
                    listing += '    ' + m.name + ': ' + s.total + ' instructions, ' + s.branches + ' BRANCH, ' + s.calls + ' CALL\n';
                }
                listing += '\n';
            }
            if (compiledMethods.length > 0 && churchMethods.length > 0) {
                listing += '  \u2500\u2500 SUMMARY \u2500\u2500\n';
                listing += '    Compiled path: ' + totalCompiledInstr + ' total instructions, ' + totalCompiledBranch + ' branches\n';
                listing += '    Church path:   ' + totalChurchInstr + ' total instructions, ' + totalChurchBranch + ' branches, ' + totalChurchCall + ' CALLs\n';
                const saved = totalCompiledBranch - totalChurchBranch;
                if (saved > 0) {
                    listing += '    \u2192 Church eliminates ' + saved + ' branch instruction(s) using CALL selectors\n';
                    listing += '    \u2192 Avoids branch misprediction risk\n';
                    listing += '    \u2192 More predictable control-flow timing (selection by CALL, not BRANCH)\n';
                }
                listing += '\n';
            }
        }
        if (result.capabilities && result.capabilities.length > 0) {
            if (typeof _autoFillCapRights === 'function') _autoFillCapRights(result.capabilities);
            const _cc = result.capabilities.length;
            listing += `\n; c-list  (${_cc} entr${_cc !== 1 ? 'ies' : 'y'})\n`;
            listing += `; rights key: [R]=read  [W]=write  [X]=execute  [E]=entry\n`;
            for (let i = 0; i < result.capabilities.length; i++) {
                const cap = result.capabilities[i];
                const capName   = typeof cap === 'string' ? cap : (cap.name || String(cap));
                const capRights = typeof cap === 'string' ? [] : (cap.rights || []);
                const permsStr  = capRights.length > 0 ? '  [' + capRights.join('') + ']' : '';
                const typeStr   = _clistTypeLabel(capName);
                listing += `  * [${i}]  ${capName.padEnd(14)}${typeStr.padEnd(8)}${permsStr}\n`;
            }
        }
        if (con) con.innerHTML = _highlightCodeListing(listing);
        if (typeof _clearAsmErrors === 'function') _clearAsmErrors();
        if (typeof _clearAsmWarnings === 'function') _clearAsmWarnings();
        if (typeof _showAsmWarnings === 'function') _showAsmWarnings(result.warnings || []);
        // Push live snippet history for each method that carried source text
        if (typeof ChurchAssembler !== 'undefined' && result.abstractionName) {
            for (const _m of result.methods) {
                if (_m.sourceLines) {
                    ChurchAssembler.pushLiveSnippet(result.abstractionName, _m.name, _m.sourceLines);
                }
            }
        }
        showNextSteps('assembled');
        const saveBtn = document.getElementById('btnSaveNS');
        if (saveBtn) saveBtn.disabled = false;
        const _expBtn0 = document.getElementById('btnExportLump');
        if (_expBtn0) _expBtn0.disabled = false;
        updateDashboard();
        return;
    }

    // ── Pass null-GT row pet names to the assembler ──────────────────────────
    // CListViewer tracks which c-list slot each pet name (e.g. "Mum") occupies.
    // Inverting slot→name to name→slot lets _resolveNSName resolve "Mum" to its
    // c-list offset, so  LOAD CR2, Mum  and  Tunnel.Connect(Mum)  compile cleanly.
    if (window.CListViewer && typeof window.CListViewer.getNullSlotPetNames === 'function') {
        const _nullPets  = window.CListViewer.getNullSlotPetNames();
        const _nameToSlot = {};
        for (const [slot, name] of Object.entries(_nullPets)) {
            if (name) _nameToSlot[name] = parseInt(slot, 10);
        }
        assembler.setClistSlots(_nameToSlot);
    }

    const result = assembler.assemble(source);

    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line}: ${e.message}`).join('\n');
        if (con) con.textContent = `Assembly errors:\n${errText}`;
        window._assemblerSymbols = null;
        lastAssembledWords = null;
        lastAssembledCapabilities = null;
        lastAssembledNamedSlots = null;
        const _errSaveBtn = document.getElementById('btnSaveNS');
        if (_errSaveBtn) _errSaveBtn.disabled = true;
        const _errExpBtn = document.getElementById('btnExportLump');
        if (_errExpBtn) _errExpBtn.disabled = true;
        switchCodeTab('console');
        if (typeof _showAsmErrors === 'function') _showAsmErrors(result.errors);
        if (typeof _clearAsmWarnings === 'function') _clearAsmWarnings();
        showNextSteps('error');
        return;
    }
    if (typeof _clearAsmErrors === 'function') _clearAsmErrors();
    if (typeof _showAsmWarnings === 'function') _showAsmWarnings(result.warnings || []);

    lastAssembledWords = result.words.slice();
    lastAssembledCapabilities = (result.capabilities && result.capabilities.length > 0)
        ? result.capabilities.slice() : null;
    lastAssembledNamedSlots = (result.namedSlots && result.namedSlots.length > 0)
        ? result.namedSlots.slice() : null;
    _defaultProgramLoaded = true;
    sim.programLabels = result.labels || {};
    sim.programCapabilities = result.capabilities ? result.capabilities.slice() : [];
    const entryLabel = Object.keys(result.labels || {}).find(k => (result.labels[k] === 0)) || null;
    sim.programName = entryLabel || (Object.keys(result.labels || {})[0]) || 'prog';
    window._assemblerSymbols = { labels: result.labels || {}, lumpName: sim.programName };
    _pendingSimLoad = true;

    const _srcComments = (() => {
        const out = [];
        for (const rawLine of source.split('\n')) {
            const semi = rawLine.indexOf(';');
            const code = (semi >= 0 ? rawLine.slice(0, semi) : rawLine).trim();
            const cmt  = semi >= 0 ? rawLine.slice(semi + 1).trim() : '';
            let rest = code;
            const colonIdx = code.search(/\w+\s*:/);
            if (colonIdx >= 0) rest = code.slice(code.indexOf(':') + 1).trim();
            if (!rest) continue;
            const padM = rest.match(/^PAD\s+(\d+)/i);
            if (padM) { const n = parseInt(padM[1]); for (let j = 0; j < n; j++) out.push(''); continue; }
            out.push(cmt);
        }
        return out;
    })();

    const _asmSlotNames = ChurchAssembler.buildSlotNames(result.capabilities || [],
        (typeof sim !== 'undefined' && sim) ? sim.nsLabels : null);
    let listing = `; Assembled ${result.words.length} instruction${result.words.length !== 1 ? 's' : ''}\n`;
    for (let i = 0; i < result.words.length; i++) {
        const mnem = result.words[i] === 0 ? 'NOP' : assembler.disassemble(result.words[i], _asmSlotNames);
        const cmt  = _srcComments[i] || '';
        listing += cmt ? `${mnem.padEnd(40)}; ${cmt}\n` : `${mnem}\n`;
    }
    if (result.capabilities && result.capabilities.length > 0) {
        if (typeof _autoFillCapRights === 'function') _autoFillCapRights(result.capabilities);
        const _cc2 = result.capabilities.length;
        listing += `\n; c-list  (${_cc2} entr${_cc2 !== 1 ? 'ies' : 'y'})\n`;
        listing += `; rights key: [R]=read  [W]=write  [X]=execute  [E]=entry\n`;
        for (let i = 0; i < result.capabilities.length; i++) {
            const cap = result.capabilities[i];
            const capName   = typeof cap === 'string' ? cap : (cap.name || String(cap));
            const capRights = typeof cap === 'string' ? [] : (cap.rights || []);
            const permsStr  = capRights.length > 0 ? '  [' + capRights.join('') + ']' : '';
            const typeStr   = _clistTypeLabel(capName);
            listing += `  * [${i}]  ${capName.padEnd(14)}${typeStr.padEnd(8)}${permsStr}\n`;
        }
    }
    if (con) con.innerHTML = _highlightCodeListing(listing);
    // Push live snippet history for each labelled section of the raw assembly source
    _pushAsmLabelSnippets(source, result.labels || {}, sim.programName);
    showNextSteps('assembled');

    const saveBtn = document.getElementById('btnSaveNS');
    if (saveBtn) saveBtn.disabled = false;
    const _expBtn = document.getElementById('btnExportLump');
    if (_expBtn) _expBtn.disabled = false;

    updateDashboard();
}

function _capRightsHTML(text) {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const titles = { R: 'read', W: 'write', X: 'execute', E: 'entry' };
    return escaped.replace(/\[([RWXE]+)\]/g, function(_m, rights) {
        const letters = rights.split('').map(function(ch) {
            const cls = { R: 'cap-right-r', W: 'cap-right-w', X: 'cap-right-x', E: 'cap-right-e' }[ch];
            return cls ? '<span class="' + cls + '" title="' + titles[ch] + '">' + ch + '</span>' : ch;
        }).join('');
        return '[' + letters + ']';
    });
}

// Syntax-highlight a plain-text disassembly listing for the Code View.
// Uses the same .lump-hl-* token colours as the Abstractions view, plus
// condition-code tooltips inside mnemonic spans and cap-rights [RWXE] badges.
function _highlightCodeListing(listing) {
    if (typeof _highlightCLOOMCSource !== 'function') return _capRightsHTML(listing);
    // Step 1 — apply CLOOMC/Assembly token colours (handles HTML escaping internally)
    let html = _highlightCLOOMCSource(listing, 'assembly');
    // Step 2 — inject condition-code tooltips inside already-highlighted mnemonic spans
    //   e.g. <span class="lump-hl-mnemonic">LOADEQ</span>
    //     →  <span class="lump-hl-mnemonic">LOAD<span class="cond-abbr" …>EQ</span></span>
    const _condAbbr = ['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE','','NV'];
    const _condLong = ['Equal','Not Equal','Carry Set','Carry Clear','Minus','Plus',
                       'Overflow Set','Overflow Clear','Higher','Lower or Same',
                       'Greater or Equal','Less Than','Greater Than','Less or Equal','Always','Never'];
    for (let _ci = 0; _ci < _condAbbr.length; _ci++) {
        const _abbr = _condAbbr[_ci];
        if (!_abbr) continue;
        const _tip = `<span class="cond-abbr" title="${_abbr}\u00A0\u2014\u00A0${_condLong[_ci]}">${_abbr}</span>`;
        html = html.replace(
            new RegExp(`(<span class="lump-hl-mnemonic">)([A-Z]+)(${_abbr})(</span>)`, 'g'),
            (_, open, prefix, _ca, close) => `${open}${prefix}${_tip}${close}`
        );
    }
    // Step 3 — colour cap-rights badges [R], [W], [X], [E]
    const _titles = { R: 'read', W: 'write', X: 'execute', E: 'entry' };
    html = html.replace(/\[([RWXE]+)\]/g, function(_m, rights) {
        const letters = rights.split('').map(function(ch) {
            const cls = { R: 'cap-right-r', W: 'cap-right-w', X: 'cap-right-x', E: 'cap-right-e' }[ch];
            return cls ? '<span class="' + cls + '" title="' + _titles[ch] + '">' + ch + '</span>' : ch;
        }).join('');
        return '[' + letters + ']';
    });
    return html;
}

function _permsHTML(permsStr) {
    const titles = { R: 'read', W: 'write', X: 'execute', E: 'entry' };
    const cls    = { R: 'cap-right-r', W: 'cap-right-w', X: 'cap-right-x', E: 'cap-right-e' };
    return permsStr.split('').map(function(ch) {
        return cls[ch]
            ? '<span class="' + cls[ch] + '" title="' + titles[ch] + '">' + ch + '</span>'
            : ch;
    }).join('');
}

function _rightsLegendHTML() {
    return '<span class="rights-legend">' +
        'rights key:&nbsp;' +
        '<span class="cap-right-r" title="read">[R]</span>=read&nbsp; ' +
        '<span class="cap-right-w" title="write">[W]</span>=write&nbsp; ' +
        '<span class="cap-right-x" title="execute">[X]</span>=execute&nbsp; ' +
        '<span class="cap-right-e" title="entry">[E]</span>=entry' +
        '</span>';
}

function _clistTypeLabel(name) {
    if (typeof _lumpsCache !== 'undefined' && Array.isArray(_lumpsCache)) {
        const lump = _lumpsCache.find(l =>
            (l.abstraction && l.abstraction === name) || (l.name && l.name === name));
        if (lump) {
            const ct = (lump.content_type || '').toLowerCase();
            const lt = (lump.lump_type   || '').toLowerCase();
            if (lt === 'namespace')              return 'NS';
            if (ct.startsWith('io'))             return 'IO';
            if (ct.startsWith('math') || ct.startsWith('num')) return 'Math';
            if (ct.startsWith('mem'))            return 'Mem';
            if (ct.startsWith('str') || ct.startsWith('text')) return 'Text';
            if (ct.startsWith('sys') || ct.startsWith('boot')) return 'Sys';
            if (ct.startsWith('crypto') || ct.startsWith('sec')) return 'Sec';
            if (ct) {
                const first = ct.split('/')[0];
                return first.charAt(0).toUpperCase() + first.slice(1);
            }
            return 'Abstr';
        }
    }
    const reg = (typeof ChurchAssembler !== 'undefined') ? ChurchAssembler._sharedRegistry : null;
    if (reg) {
        const abs = reg.getByName(name);
        if (abs !== null) {
            // Callable abstractions (have methods) are always shown as 'Abstr'
            // regardless of architectural layer — the layer numbering (0=HW, 1=Mem,
            // 2=Mint, 3=IO, …) does not map cleanly to display intent.
            if (abs.methods && abs.methods.length > 0) return 'Abstr';
            const layerLabels = ['HW', 'Mem', 'Mint', 'IO', 'Math', 'Data', 'App', 'User', 'Sys'];
            return layerLabels[abs.layer] || 'Abstr';
        }
    }
    // Peripheral name patterns — hardware capabilities not backed by a lump
    const up = name.toUpperCase();
    if (/^LED\d*$/.test(up) || /^GPIO\d*$/.test(up))             return 'IO';
    if (/^UART\d*$/.test(up) || /^USART\d*$/.test(up))           return 'IO';
    if (/^SPI\d*$/.test(up) || /^I2C\d*$/.test(up))              return 'IO';
    if (/^PWM\d*$/.test(up) || /^TIMER\d*$/.test(up) || /^TIM\d*$/.test(up)) return 'IO';
    if (/^ADC\d*$/.test(up) || /^DAC\d*$/.test(up))              return 'IO';
    if (/^CAN\d*$/.test(up) || /^USB\d*$/.test(up))              return 'IO';
    if (/^FLASH\d*$/.test(up) || /^SDRAM\d*$/.test(up))          return 'Mem';
    if (/^CLOCK\d*$/.test(up) || /^CLK\d*$/.test(up) || /^PLL\d*$/.test(up)) return 'HW';
    if (/^FPGA\d*$/.test(up) || /^JTAG\d*$/.test(up))            return 'HW';
    return '\u2014';
}

function _nsOwnerOf(addr) {
    if (!sim || !sim.nsCount) return null;
    for (let i = 0; i < sim.nsCount; i++) {
        const nsBase  = sim.NS_TABLE_BASE + i * sim.NS_ENTRY_WORDS;
        const loc     = sim.memory[nsBase];
        const w1      = sim.memory[nsBase + 1];
        if (!loc && !w1) continue;
        const limit   = w1 & 0x1FFFF;
        if (addr >= loc && addr < loc + limit) {
            return { label: sim.nsLabels[i] || `NS[${i}]`, nsIdx: i, offset: addr - loc };
        }
    }
    return null;
}

function _niaMeta(addr) {
    if (addr === null || addr === undefined || addr < 0) return null;
    const word = (sim.memory && addr < sim.memory.length) ? sim.memory[addr] : 0;
    const dis = (typeof assembler !== 'undefined' && assembler) ? assembler.disassemble(word) : '';
    const base   = sim.programBaseAddr || 0;
    const labels = sim.programLabels  || {};
    const rel    = addr - base;
    let bestName = null, bestDist = Infinity;
    for (const [name, labelRel] of Object.entries(labels)) {
        const dist = rel - labelRel;
        if (dist >= 0 && dist < bestDist) { bestDist = dist; bestName = name; }
    }
    const ns = !bestName ? _nsOwnerOf(addr) : null;
    return {
        addr,
        disasm: dis || (word === 0 ? 'HALT' : `0x${word.toString(16).padStart(8,'0')}`),
        label:  bestName || (ns ? ns.label : null),
        offset: bestName ? bestDist : (ns ? ns.offset : null),
        prog:   sim.programName || ''
    };
}

function _buildNIARows(prevAddr, currAddr) {
    return {
        last: _niaMeta(prevAddr),
        curr: _niaMeta(currAddr),
        next: _niaMeta(currAddr !== null && currAddr !== undefined ? currAddr + 1 : null)
    };
}

const _BOOT_STEPS = [
    { addrStr: 'B:00', disasm: 'FAULT_RST',  label: 'Capture fault context \u2192 clear all CRs / DRs',                              offset: null, prog: 'boot' },
    { addrStr: 'B:01', disasm: 'LOAD_NS',    label: 'CR15 \u2190 NS[0] Namespace (base=0x0000, full memory)',                         offset: null, prog: 'boot' },
    { addrStr: 'B:02', disasm: 'INIT_THRD',  label: 'CR12 \u2190 NS[1] thread stack GT (zero perms, Inform)',                         offset: null, prog: 'boot' },
    { addrStr: 'B:03', disasm: 'INIT_HEAP',  label: 'CR5(RW) \u2190 thread heap \u00b7 CHANGE-consistent synthesis',                  offset: null, prog: 'boot' },
    { addrStr: 'B:04', disasm: 'CALL_HOME',  label: 'Tunnel.Register \u2192 23-byte packet \u00b7 await ACK',                         offset: null, prog: 'boot' },
    { addrStr: 'B:05', disasm: 'INIT_ABSTR', label: 'CR6(E) \u2190 NS[3] Boot.Abstr',                                                 offset: null, prog: 'boot' },
    { addrStr: 'B:06', disasm: 'NUC_CLIST',  label: 'CR6(E) \u2190 lump c-list \u00b7 push sentinel',                                 offset: null, prog: 'boot' },
    { addrStr: 'B:07', disasm: 'NUC_CODE',   label: 'CR14(R+X) \u2190 lump code \u00b7 PC\u21900 \u00b7 CALL CR0 \u2192 dispatch begins', offset: null, prog: 'boot' },
];

function _bootNIARows(bootStep) {
    const prevIdx = bootStep - 1;
    const currIdx = bootStep;
    const nextIdx = bootStep + 1;
    return {
        last:    prevIdx >= 0 ? _BOOT_STEPS[prevIdx] : null,
        curr:    _BOOT_STEPS[currIdx] || null,
        next:    nextIdx < _BOOT_STEPS.length ? _BOOT_STEPS[nextIdx] : null,
        all:     _BOOT_STEPS,
        currIdx: currIdx,
    };
}

function stepSim() {
    if (!sim.bootComplete) {
        // If a compiled abstraction is waiting, skip the manual boot ceremony
        // and silently complete all boot phases so the user can step their code.
        if (_pendingSimLoad) {
            const ok = instantBoot();
            const con = document.getElementById('editorConsole');
            if (con) {
                con.className = '';
                if (ok) {
                    const r = window._lastCLOOMCResult;
                    const name    = (r && r.abstractionName) || 'abstraction';
                    const nWords  = (lastAssembledWords  && lastAssembledWords.length)  || 0;
                    const nMeth   = lastMethodTableSize || 0;
                    const mLabel  = nMeth === 1 ? 'method' : 'methods';
                    con.textContent = `Auto-booted \u2014 \u201c${name}\u201d loaded \u2014 ${nWords} words, ${nMeth} ${mLabel} \u2014 click Step or Run`;
                } else {
                    con.textContent = 'Auto-boot failed \u2014 machine halted during boot sequence';
                }
            }
            if (ok) switchView('dashboard');
            return;
        }
        // If the boot animation is running (Boot button was clicked), cancel it
        // so the user can step through boot manually.
        if (bootAnimating) {
            if (_bootAnimTimer !== null) { clearTimeout(_bootAnimTimer); _bootAnimTimer = null; }
            bootAnimating = false;
        }
        const con = document.getElementById('editorConsole');
        if (con && sim.bootStep === 0 && con.textContent.trim() === '') {
            con.textContent = '--- Stepping through boot sequence ---\n(Click Step to advance one phase at a time)';
        }
        sim.auditLog = [];
        const _stepPhaseNum = sim.bootStep + 1;  // capture before _bootStep() — case 6 (COMPLETE) doesn't increment bootStep
        try {
            sim._bootStep();
        } catch(e) {
            console.error('stepSim _bootStep error:', e);
            updateDashboard();
            return;
        }
        // Accumulate this step's gate entries into the persistent boot audit trail
        if (sim.auditLog.length > 0) {
            _bootAuditAccum.push(...sim.auditLog);
        }
        if (con) {
            con.textContent += `\n[boot ${_stepPhaseNum}/7] ${sim.output.split('\n').filter(l => l).pop()}`;
            con.scrollTop = con.scrollHeight;
        }
        if (pipelineViz) {
            pipelineViz.setNIA(_bootNIARows(sim.bootStep));
            if (pipelineViz.mode === 'audit') {
                const _auditSource = _bootAuditAccum.length > 0 ? _bootAuditAccum : sim.auditLog;
                pipelineViz.showFullPipeline(_auditSource.map(a => {
                    const checks = Object.entries(a.checks || {}).map(([k, v]) => ({ name: k.toUpperCase(), pass: v.pass, perm: v.perm || null }));
                    const desc = a.desc !== undefined ? a.desc
                        : (a.nsIndex !== null && a.nsIndex !== undefined)
                            ? `${a.gate}(NS[${a.nsIndex}]="${a.label}"${a.requiredPerm ? ', '+a.requiredPerm : ''})`
                            : `${a.gate} — ${a.label}`;
                    return { stage: a.gate, type: a.gate, desc, label: a.label, nsIndex: a.nsIndex, requiredPerm: a.requiredPerm, checks, status: a.result, b: a.b, f: a.f };
                }));
            } else {
                pipelineViz.render();
            }
        }
        if (sim.bootComplete) {
            // Clear boot-microcode gate entries so the Gate Log starts empty
            // for user-code debugging after a clean boot.
            sim.auditLog = [];
            _autoLoadDefaultProgram();
            updateDashboard();
            switchView('lumps');
            openCRDetail(14);
        } else {
            updateDashboard();
            switchView('pipeline');  // keep boot-step overview in view while stepping through boot
        }
        return;
    }
    // Apply any pending program load (e.g. from "Load into Sim" button) before
    // the first step so we execute the right code, not whatever was in memory.
    _applyPendingSimLoad();
    let result;
    try {
        result = sim.step();
    } catch(e) {
        console.error('stepSim step error:', e);
        updateDashboard();
        switchView('dashboard');
        openCRDetail(14);
        return;
    }
    // Track RETURN so the watch strip can highlight DR0 (the return value)
    window._lastStepWasReturn = !!(result && result.opName === 'RETURN');
    if (result && result.absent) {
        // Absent-lump: simulator suspended waiting for a lazy-load fetch.
        const con = document.getElementById('editorConsole');
        if (con) {
            con.textContent += `\n⟳ Absent lump — fetching Slot ${result.nsIndex} (${result.label}) token=0x${result.token}`;
            con.scrollTop = con.scrollHeight;
        }
        updateDashboard();
        // Stay on the current view (editor/console if from runLazyLoadTest).
        // triggerLazyLoad() will switch to editor/console when finished.
        triggerLazyLoad(result, 'step');
        return;
    }
    if (result && result.suspended) {
        const con = document.getElementById('editorConsole');
        if (con) {
            const al = result.awaitingLump;
            con.textContent += `\n⟳ Still fetching lump for Slot ${al ? al.nsIndex : '?'} — please wait…`;
            con.scrollTop = con.scrollHeight;
        }
        updateDashboard();
        return;
    }
    if (result && result.lazySuspended) {
        // Lazy-Resolve: thread suspended waiting for IDE to supply a GT (Task #1519).
        const con = document.getElementById('editorConsole');
        if (con) {
            const petName = result.petName || '?';
            const slot = result.slot !== undefined ? result.slot : '?';
            con.textContent += `\n⏸ Thread suspended — waiting for '${petName}' (c-list slot ${slot})\n  Link it via the Pending Capabilities panel below to resume.`;
            con.scrollTop = con.scrollHeight;
        }
        _registerLazyResolvePending(result);
        updateDashboard();
        return;
    }
    if (result) {
        const con = document.getElementById('editorConsole');
        if (con) {
            con.textContent += `\n[${sim.stepCount}] ${result.desc || 'executed'}`;
            if (Array.isArray(result.pipeline)) {
                for (const s of result.pipeline) {
                    const stagePad = (s.stage || '').padEnd(6);
                    con.textContent += `\n     \u2192 ${stagePad}  ${s.desc || ''}`;
                }
            }
            con.scrollTop = con.scrollHeight;
        }
        if (pipelineViz) {
            pipelineViz.setNIA(_buildNIARows(result.physicalPC ?? result.pc, sim._nextPhysicalAddr()));
            if (pipelineViz.mode === 'audit' && result.auditPipeline) {
                pipelineViz.showFullPipeline(result.auditPipeline);
            } else if (result.pipeline) {
                pipelineViz.showFullPipeline(result.pipeline);
            }
        } else if (result.pipeline) {
            _pendingPipelineBuffer = { pc: result.physicalPC ?? result.pc, pipeline: result.pipeline };
            setTimeout(_flushPendingPipelineBuffer, 0);
        }
    }
    updateDashboard();
    switchView('dashboard');
    openCRDetail(14);
}

let _pendingPipelineBuffer = null;

function _flushPendingPipelineBuffer() {
    if (pipelineViz && _pendingPipelineBuffer) {
        const buf = _pendingPipelineBuffer;
        _pendingPipelineBuffer = null;
        pipelineViz.setNIA(_buildNIARows(buf.pc, sim._nextPhysicalAddr()));
        pipelineViz.showFullPipeline(buf.pipeline);
    }
}

let walkRunning = false;
let walkTimer = null;

// ── Run popover ─────────────────────────────────────────────────────────────
let runBatchSize = 500;
let _runStopped = false;

let _runClickTimer = null;

function onRunBtnClick() {
    if (_runClickTimer) {
        clearTimeout(_runClickTimer);
        _runClickTimer = null;
        showRunPopover();
    } else {
        _runClickTimer = setTimeout(() => {
            _runClickTimer = null;
            runSimGo();
        }, 280);
    }
}

function showRunPopover() {
    const pop = document.getElementById('runPopover');
    if (!pop) { runSimGo(); return; }
    if (pop.style.display !== 'none') { hideRunPopover(); return; }
    const sel = document.getElementById('runBatchSelect');
    if (sel) sel.value = String(runBatchSize);
    pop.style.display = 'block';
}

function hideRunPopover() {
    const pop = document.getElementById('runPopover');
    if (pop) pop.style.display = 'none';
}

// ── _injectClistNow ───────────────────────────────────────────────────────────
// Shared c-list injection helper — safe to call any time after boot is complete.
// Called from _applyPendingSimLoad (on first Run after compile) AND from
// _autoLoadDefaultProgram (on every boot/reset, so the c-list survives resets).
//
// CASE A — no user capabilities { } block (capability_test, raw examples, …):
//   Always injects the full 18-entry DEMO_CLIST regardless of current clistCount.
//   This is the critical fix for the RANGE fault that occurred when switching from
//   a capabilities-block program (which left clistCount=1) to a raw-offset program
//   (which needs clistCount=18).  The old code only fired CASE A when clistCount===0,
//   so the second program would run with cc=1 and hit a RANGE fault on CR6[8].
//
// CASE B — user-compiled program with a capabilities { } block:
//   Mirrors the assembler's 0-based block-position layout at runtime:
//     • Hardware device (LED0–5, UART, BTN, SlideRule, Timer) → demoClistGTs slot
//     • NS-based abstraction → freshly-created E-GT pointing to its NS slot
//     • Unknown name → null GT (0)
//   cc = lastAssembledCapabilities.length.
function _injectClistNow() {
    if (!sim.bootComplete || !sim.demoClistGTs || !sim.demoClistGTs.length) return;

    // Guard against stale named-slot entries from a previous program (Task #1547).
    // Reset petNameMemory to the hardware boot defaults before any markNamedSlots()
    // call so that slots declared only by program A cannot suppress NULL_CAP faults
    // in program B (which never declared those slots).
    sim.resetNamedSlots();

    const _hasUserCaps = !!(lastAssembledCapabilities && lastAssembledCapabilities.length > 0);

    const _devSlotMap = {
        LED0: 8, LED1: 9, LED2: 10, LED3: 11, LED4: 12, LED5: 13,
        UART: 14, BTN: 15, SlideRule: 16, Timer: 17, Display: 14,
    };

    const BOOT_ABSTR_SLOT = 3;
    const nsBase    = sim.NS_TABLE_BASE + BOOT_ABSTR_SLOT * sim.NS_ENTRY_WORDS;
    const w1f       = sim.parseNSWord1(sim.memory[nsBase + 1]);
    const lumpBase  = sim.memory[nsBase] >>> 0;
    const lumpHdr   = sim.memory[lumpBase] >>> 0;
    const hdrParsed = sim.parseLumpHeader(lumpHdr);
    const SLOT_SIZE = hdrParsed.lumpSize;

    if (_hasUserCaps) {
        // ── CASE B: block-position injection ────────────────────────────────
        const cc        = lastAssembledCapabilities.length;
        const clistBase = lumpBase + SLOT_SIZE - cc;

        for (let i = 0; i < cc; i++) {
            const cap     = lastAssembledCapabilities[i];
            const capName = (typeof cap === 'string' ? cap : (cap.name || '')).trim();
            const rights  = typeof cap === 'string' ? [] : (cap.rights || []);
            if (!capName) { sim.memory[clistBase + i] = 0; continue; }

            const devKey = Object.keys(_devSlotMap)
                .find(k => k.toLowerCase() === capName.toLowerCase());
            if (devKey !== undefined) {
                sim.memory[clistBase + i] =
                    (sim.demoClistGTs[_devSlotMap[devKey]] || 0) >>> 0;
                continue;
            }

            let nsIdx = -1;
            for (const [idx, lbl] of Object.entries(sim.nsLabels)) {
                if (lbl.toUpperCase() === capName.toUpperCase()) {
                    nsIdx = parseInt(idx); break;
                }
            }
            if (nsIdx >= 0) {
                const perms = {R:0, W:0, X:0, L:0, S:0, E:1};
                for (const r of rights) {
                    if      (r === 'R') perms.R = 1;
                    else if (r === 'W') perms.W = 1;
                    else if (r === 'X') perms.X = 1;
                    else if (r === 'E') perms.E = 1;
                }
                sim.memory[clistBase + i] =
                    sim.createGT(0, nsIdx, perms, 1) >>> 0;
                continue;
            }

            // Unknown name → pending sentinel (named but not yet introduced to a live GT).
            // This preserves the pet name so the c-list viewer and fault messages can
            // display it, instead of silently writing NULL and losing the identity.
            const _pendingWord = (typeof ChurchSimulator !== 'undefined' && ChurchSimulator.makePendingGT)
                ? ChurchSimulator.makePendingGT(capName)
                : 0;
            sim.memory[clistBase + i] = _pendingWord >>> 0;
        }

        sim.memory[lumpBase] = ((lumpHdr & ~0xFF) | (cc & 0xFF)) >>> 0;
        const nsWord1B = sim.packNSWord1(
            w1f.limit, w1f.b, w1f.g, w1f.chainable, w1f.gtType, cc
        );
        sim.memory[nsBase + 1] = nsWord1B;
        const cr6GTb = sim.createGT(0, BOOT_ABSTR_SLOT, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);
        sim.cr[6] = {
            word0: cr6GTb,
            word1: clistBase >>> 0,
            word2: nsWord1B >>> 0,
            word3: sim.memory[nsBase + 2] >>> 0,
            m: 0,
        };
        // Task #1531: mark every named capability slot in petNameMemory so that
        // LAZY_RESOLVE fires instead of NULL_CAP hard fault on first access.
        // Mirrors the DWRITE-to-IO_PORT_PET_NAME_WR hardware path.
        if (lastAssembledNamedSlots && lastAssembledNamedSlots.length > 0) {
            sim.markNamedSlots(lastAssembledNamedSlots);
        }

    } else {
        // ── CASE A: no capabilities block → inject full DEMO_CLIST ──────────
        // Fires unconditionally (not just when clistCount===0) so that programs
        // without a capabilities block always get the correct 18-entry layout,
        // even after a previous CASE B run left clistCount=1.
        const cc        = sim.demoClistGTs.length;
        const clistBase = lumpBase + SLOT_SIZE - cc;
        for (let i = 0; i < cc; i++) {
            sim.memory[clistBase + i] = sim.demoClistGTs[i] >>> 0;
        }
        sim.memory[lumpBase] = ((lumpHdr & ~0xFF) | (cc & 0xFF)) >>> 0;
        const nsWord1A = sim.packNSWord1(
            w1f.limit, w1f.b, w1f.g, w1f.chainable, w1f.gtType, cc
        );
        sim.memory[nsBase + 1] = nsWord1A;
        const cr6GTa = sim.createGT(0, BOOT_ABSTR_SLOT, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);
        sim.cr[6] = {
            word0: cr6GTa,
            word1: clistBase >>> 0,
            word2: nsWord1A >>> 0,
            word3: sim.memory[nsBase + 2] >>> 0,
            m: 0,
        };
    }
}

function _applyPendingSimLoad() {
    if (!_pendingSimLoad || !lastAssembledWords || !lastAssembledWords.length) return;
    console.log('[applyPendingSimLoad] v20260513k caps=', JSON.stringify(lastAssembledCapabilities));
    sim.loadProgram(lastAssembledWords, 0);
    if (typeof _syncBootEntryFromSim === 'function') _syncBootEntryFromSim();
    // Skip past the lump header (word 0) and method table so PC starts at the
    // first real instruction, matching _autoLoadDefaultProgram() on boot/reset.
    if (lastMethodTableSize > 0) sim.pc = lastMethodTableSize;
    if (pipelineViz) pipelineViz.setNIA(null);
    const abstrBase2 = sim.NS_TABLE_BASE + 2 * sim.NS_ENTRY_WORDS;
    const abstrBase3 = sim.NS_TABLE_BASE + 3 * sim.NS_ENTRY_WORDS;
    // When Boot.Abstr (slot 3) was relocated to the extended-code area for a
    // large program (base >= 0x0400), use that base+1 as the code start so
    // labels resolve correctly.  For ordinary small programs the existing
    // slot-2 base is used unchanged.
    const slot3Base  = sim.bootComplete ? (sim.memory[abstrBase3] >>> 0) : 0;
    const slot2Base  = sim.bootComplete ? (sim.memory[abstrBase2] || (2 * sim.SLOT_SIZE)) : 0;
    const progBase   = (slot3Base >= 0x0400) ? slot3Base + 1 : slot2Base;
    sim.programBaseAddr = progBase;
    _injectClistNow();
    _pendingSimLoad = false;
}

function runSimGo() {
    const sel = document.getElementById('runBatchSelect');
    if (sel) runBatchSize = parseInt(sel.value, 10) || 500;
    hideRunPopover();
    _applyPendingSimLoad();
    runSim();
}

function stopSim() {
    _runStopped = true;
}

function _showStopBtn(show) {
    const runBtn  = document.getElementById('btnRunSim');
    const stopBtn = document.getElementById('btnStopSim');
    if (runBtn)  runBtn.style.display  = show ? 'none' : '';
    if (stopBtn) stopBtn.style.display = show ? '' : 'none';
}

document.addEventListener('mousedown', function(e) {
    const wrap = document.getElementById('runWrap');
    const pop = document.getElementById('runPopover');
    if (wrap && pop && pop.style.display !== 'none' && !wrap.contains(e.target)) {
        hideRunPopover();
    }
});

// ── Breakpoints ────────────────────────────────────────────────────────────
const simBreakpoints = new Set();

function updateBreakpointBtn() {
    const btn = document.getElementById('toolBreakBtn');
    if (!btn) return;
    const n = simBreakpoints.size;
    btn.textContent = n > 0 ? `\u25CF\u202F${n}` : '\u25CF';
    btn.classList.toggle('break-active', n > 0);
}

function renderBreakList() {
    const el = document.getElementById('breakList');
    if (!el) return;
    if (simBreakpoints.size === 0) {
        el.innerHTML = '<div class="break-empty">No breakpoints set</div>';
        return;
    }
    el.innerHTML = [...simBreakpoints].sort((a,b) => a-b).map(addr =>
        `<div class="break-item">
            <code class="break-addr-label">0x${addr.toString(16).toUpperCase().padStart(4,'0')}</code>
            <button class="btn break-remove-btn" onclick="removeBreakpoint(${addr})" title="Remove this breakpoint">&#x1F5D1;</button>
        </div>`
    ).join('');
}

function toggleBreakPopover() {
    const pop = document.getElementById('breakPopover');
    if (!pop) return;
    const open = pop.style.display !== 'none';
    pop.style.display = open ? 'none' : 'block';
    if (!open) renderBreakList();
}

function openBreakPopoverAt(addr) {
    const pop = document.getElementById('breakPopover');
    if (!pop) return;
    pop.style.display = 'block';
    renderBreakList();
    const inp = document.getElementById('breakAddrInput');
    if (inp) {
        inp.value = '0x' + (addr >>> 0).toString(16).toUpperCase().padStart(4, '0');
        inp.focus();
        inp.select();
    }
}

function addBreakpoint(addr) {
    simBreakpoints.add(addr >>> 0);
    updateBreakpointBtn();
    renderBreakList();
    updateDashboard();
}

function removeBreakpoint(addr) {
    simBreakpoints.delete(addr >>> 0);
    updateBreakpointBtn();
    renderBreakList();
    updateDashboard();
}

function clearAllBreakpoints() {
    simBreakpoints.clear();
    updateBreakpointBtn();
    renderBreakList();
    updateDashboard();
}

function addBreakpointFromInput() {
    const inp = document.getElementById('breakAddrInput');
    if (!inp) return;
    const raw = inp.value.trim().replace(/^0x/i, '');
    const addr = parseInt(raw, 16);
    if (isNaN(addr)) { inp.style.borderColor = '#ef4444'; return; }
    inp.style.borderColor = '';
    inp.value = '';
    addBreakpoint(addr);
    const pop = document.getElementById('breakPopover');
    if (pop) pop.style.display = 'none';
}

// Close breakpoint popover when clicking outside it
document.addEventListener('click', function(e) {
    const wrap = document.getElementById('breakWrap');
    if (wrap && !wrap.contains(e.target)) {
        const pop = document.getElementById('breakPopover');
        if (pop) pop.style.display = 'none';
    }
});

function updateWalkBtn() {
    const btn = document.getElementById('toolWalkBtn');
    if (!btn) return;
    if (walkRunning) {
        btn.classList.add('walk-active');
        btn.setAttribute('data-tooltip', 'Walk (running) — Click to stop');
    } else {
        btn.classList.remove('walk-active');
        btn.setAttribute('data-tooltip', 'Walk — Animate step-by-step execution');
    }
}

function walkToggle() {
    if (walkRunning) {
        walkRunning = false;
        if (walkTimer) { clearTimeout(walkTimer); walkTimer = null; }
        if (pipelineViz) pipelineViz.stopAnimation();
        updateWalkBtn();
        updateDashboard();
        return;
    }
    if (!sim.bootComplete) {
        slowBoot();
        const waitForBoot = setInterval(() => {
            if (sim.bootComplete && !bootAnimating) {
                clearInterval(waitForBoot);
                walkRunning = true;
                switchView('dashboard');
                openCRDetail(14);
                updateWalkBtn();
                updateDashboard();
                walkNext();
            }
        }, 200);
        return;
    }
    walkRunning = true;
    switchView('dashboard');
    openCRDetail(14);
    updateWalkBtn();
    updateDashboard();
    walkNext();
}

function walkNext() {
    if (!walkRunning || !sim.bootComplete) {
        walkRunning = false;
        updateWalkBtn();
        updateDashboard();
        return;
    }
    const result = sim.step();
    window._lastStepWasReturn = !!(result && result.opName === 'RETURN');
    if (!result) {
        walkRunning = false;
        updateWalkBtn();
        updateDashboard();
        return;
    }
    // Stop-before-execute breakpoint check: after the step, ask the simulator for the
    // physical address of the NEXT instruction (current this.pc + CR14 lump base).
    // This gives "stop before executing the instruction at the BP address" semantics,
    // matching the run() loop in simulator.js.
    if (simBreakpoints.size > 0 && !sim.halted) {
        const nextAddr = sim._nextPhysicalAddr();
        if (nextAddr >= 0 && simBreakpoints.has(nextAddr >>> 0)) {
            walkRunning = false;
            updateWalkBtn();
            const con2 = document.getElementById('editorConsole');
            if (con2) {
                con2.textContent += `\n[BP] Breakpoint at 0x${(nextAddr >>> 0).toString(16).toUpperCase().padStart(4,'0')}`;
                con2.scrollTop = con2.scrollHeight;
            }
            updateDashboard();
            return;
        }
    }
    const con = document.getElementById('editorConsole');
    if (con) {
        con.textContent += `\n[${sim.stepCount}] ${result.desc || 'executed'}`;
        con.scrollTop = con.scrollHeight;
    }
    if (result.pipeline && pipelineViz) {
        pipelineViz.setNIA(_buildNIARows(result.physicalPC ?? result.pc, sim._nextPhysicalAddr()));
        pipelineViz.animate(result.pipeline, 500).then(() => {
            updateDashboard();
            if (walkRunning && sim.bootComplete) {
                walkTimer = setTimeout(walkNext, 600);
            } else {
                walkRunning = false;
                updateWalkBtn();
                updateDashboard();
            }
        }).catch(err => {
            console.error('walkNext animate error:', err);
            walkRunning = false;
            updateWalkBtn();
            updateDashboard();
        });
    } else {
        updateDashboard();
        if (walkRunning && sim.bootComplete) {
            walkTimer = setTimeout(walkNext, 1000);
        } else {
            walkRunning = false;
            updateWalkBtn();
            updateDashboard();
        }
    }
}

let bootAnimating = false;
let _bootAnimTimer = null;

// Accumulates TSB audit gate entries across ALL boot phases so the audit panel
// shows the full capability gate history even after later steps clear auditLog.
// Cleared only when the sim is reset (resetSim / resetAndStep / faultClear).
let _bootAuditAccum = [];
let _defaultProgramLoaded = false;
function _autoLoadDefaultProgram() {
    // Re-apply any sticky patches (set via patchSimulator()) that should survive
    // reset.  Safe to call here because the NS table and lump addresses are stable
    // after every boot sequence completes.
    if (typeof _reapplyStickyPatches === 'function') _reapplyStickyPatches();

    if (_defaultProgramLoaded) {
        if (lastAssembledWords && lastAssembledWords.length > 0) {
            sim.loadProgram(lastAssembledWords, 0);
            if (lastMethodTableSize > 0) {
                // Skip method table so PC lands on the first instruction (body at word N).
                sim.pc = lastMethodTableSize;
            }
            // Restore the namespace label for Boot.Abstr (sim.reset() clears
            // nsLabels) so the CR detail heading shows the abstraction name
            // rather than the boot-image default after reset.
            const _bSlot = (typeof BOOT_ABSTR_NS_SLOT !== 'undefined') ? BOOT_ABSTR_NS_SLOT : 3;
            if (sim.nsLabels && sim.programName) sim.nsLabels[_bSlot] = sim.programName;
            _injectClistNow();
        }
        // Only apply boot lump pet names when no source-compiled program is
        // loaded — in source-assembled context the compiler owns the alias maps.
        if (!lastAssembledWords || lastAssembledWords.length === 0) {
            _applyBootLumpPetNames();
        }
        if (typeof _syncBootEntryFromSim === 'function') _syncBootEntryFromSim();
        return;
    }
    _defaultProgramLoaded = true;
    loadExample('capability_test');
    // Do NOT auto-assemble here. assembleAndLoad() → sim.loadProgram() would
    // overwrite Boot.Abstr word[0] with the capability_test first instruction,
    // masking the boot image's correct value in Code View on every boot.
    // The capability_test example comments already direct the user to assemble
    // manually ("2. Assemble this code, then click Step").  Once they do,
    // lastAssembledWords is set and the if-branch above reloads it on every
    // subsequent boot automatically.
    _applyBootLumpPetNames();
    if (typeof updateLiveLumpBanner === 'function') updateLiveLumpBanner();
}
// ── instantBoot ──────────────────────────────────────────────────────────────
// Silently completes all boot phases in a tight loop — no animation, no view
// switches, no delays.  Used by "Load into Sim" and the stepSim() fallback so
// the user lands on a fully-booted machine ready to step their abstraction.
// Returns true on clean boot, false if the machine halted or failed.
function instantBoot() {
    if (sim.bootComplete) return true;
    if (bootAnimating) {
        if (_bootAnimTimer !== null) { clearTimeout(_bootAnimTimer); _bootAnimTimer = null; }
        bootAnimating = false;
    }
    _bootAuditAccum = [];
    sim.auditLog = [];
    let safety = 0;
    while (!sim.bootComplete && !sim.halted && safety++ < 30) {
        try { sim._bootStep(); } catch(e) { console.error('instantBoot error:', e); break; }
        if (sim.auditLog.length > 0) { _bootAuditAccum.push(...sim.auditLog); sim.auditLog = []; }
    }
    if (sim.bootComplete && !sim.halted) {
        sim.auditLog = [];
        _autoLoadDefaultProgram();
        updateDashboard();
        return true;
    }
    return false;
}

function slowBoot() {
    if (bootAnimating || sim.bootComplete || sim.halted) return;
    bootAnimating = true;
    if (pipelineViz) { pipelineViz.setNIA(_bootNIARows(0)); pipelineViz.render(); }  // prime NIA to B:00 before first step
    switchView('pipeline');  // show pipeline so boot-step overview is immediately visible
    const delay = 800;
    function nextPhase() {
        try {
            if (sim.bootComplete || sim.halted) {
                bootAnimating = false;
                _bootAnimTimer = null;
                const con = document.getElementById('editorConsole');
                if (con) {
                    if (sim.halted) {
                        con.textContent += '\n--- Boot sequence FAULTED ---';
                    } else {
                        con.textContent += '\n--- Boot sequence complete ---';
                    }
                    con.scrollTop = con.scrollHeight;
                }
                if (pipelineViz) { pipelineViz.setNIA(null); pipelineViz.render(); }
                if (!sim.halted) {
                    // Clear boot-microcode gate entries so the Gate Log starts
                    // empty for user-code debugging after a clean boot.
                    sim.auditLog = [];
                    _autoLoadDefaultProgram();
                    // Restore user-assigned namespace labels that sim.reset()
                    // wiped (nsLabels = {}).  Must run after _autoLoadDefaultProgram
                    // so any program-load-triggered NS writes have already landed.
                    // Skips slots where isNSEntryValid() is true so boot-image
                    // catalog entries always take precedence over saved labels.
                    if (typeof loadNamespaceState === 'function') loadNamespaceState();
                }
                updateDashboard();
                if (!sim.halted) {
                    // Land on the user's default page (⚡ bolt setting) or
                    // fall back to lumps. Clear the guard so subsequent
                    // manual resets redirect to dashboard as normal.
                    // Search: _startupDefaultView
                    const _dest = window._startupDefaultView || 'lumps';
                    window._startupDefaultView = null;
                    switchView(_dest);
                }
                return;
            }
            const _slowPhaseNum = sim.bootStep + 1;  // capture before _bootStep() — case 6 (COMPLETE) doesn't increment bootStep
            sim.auditLog = [];
            sim._bootStep();
            // Accumulate this step's gate entries into the persistent boot audit trail
            if (sim.auditLog.length > 0) {
                _bootAuditAccum.push(...sim.auditLog);
            }
            const con = document.getElementById('editorConsole');
            if (con) {
                const lastLine = (sim.output || '').split('\n').filter(l => l).pop() || '';
                con.textContent += `\n[boot ${_slowPhaseNum}/7] ${lastLine}`;
                con.scrollTop = con.scrollHeight;
            }
            if (pipelineViz) {
                pipelineViz.setNIA(_bootNIARows(sim.bootStep));
                if (pipelineViz.mode === 'audit') {
                    const _auditSource = _bootAuditAccum.length > 0 ? _bootAuditAccum : sim.auditLog;
                    pipelineViz.showFullPipeline(_auditSource.map(a => {
                        const checks = Object.entries(a.checks || {}).map(([k, v]) => ({ name: k.toUpperCase(), pass: v.pass, perm: v.perm || null }));
                        const desc = a.desc !== undefined ? a.desc
                            : (a.nsIndex !== null && a.nsIndex !== undefined)
                                ? `${a.gate}(NS[${a.nsIndex}]="${a.label}"${a.requiredPerm ? ', '+a.requiredPerm : ''})`
                                : `${a.gate} — ${a.label}`;
                        return { stage: a.gate, type: a.gate, desc, label: a.label, nsIndex: a.nsIndex, requiredPerm: a.requiredPerm, checks, status: a.result, b: a.b, f: a.f };
                    }));
                } else {
                    pipelineViz.render();
                }
            }
            updateDashboard();
            _bootAnimTimer = setTimeout(nextPhase, delay);
        } catch(e) {
            bootAnimating = false;
            _bootAnimTimer = null;
            console.error('slowBoot nextPhase error:', e);
            if (pipelineViz) pipelineViz.render();
            updateDashboard();
        }
    }
    nextPhase();
}

function runSim() {
    while (!sim.bootComplete && !sim.halted) {
        try {
            sim._bootStep();
        } catch(e) {
            console.error('runSim _bootStep error:', e);
            if (pipelineViz) { pipelineViz.setNIA(_bootNIARows(sim.bootStep)); pipelineViz.render(); }
            updateDashboard();
            switchView('dashboard');
            openCRDetail(14);
            return;
        }
    }
    if (pipelineViz) { pipelineViz.setNIA(_bootNIARows(sim.bootStep)); pipelineViz.render(); }
    // Clear boot-microcode gate entries so the Gate Log starts empty for
    // user-code debugging after a clean boot.
    if (!sim.halted) sim.auditLog = [];
    _autoLoadDefaultProgram();

    const MAX_STEPS   = 10000;
    const BATCH_SIZE  = runBatchSize;
    const breakpoints = simBreakpoints.size > 0 ? simBreakpoints : null;
    const con         = document.getElementById('editorConsole');
    const runBtn      = document.getElementById('btnRunSim');

    _runStopped = false;
    _showStopBtn(true);

    // Switch to the dashboard with CR14 open so the user sees live execution state
    switchView('dashboard');
    openCRDetail(14);

    if (con) {
        con.textContent += '\nRunning…';
        con.scrollTop = con.scrollHeight;
    }

    let totalSteps = 0;

    function runBatch() {
        if (_runStopped) {
            finishRun('userStopped');
            return;
        }
        if (!sim.bootComplete || sim.halted || totalSteps >= MAX_STEPS) {
            finishRun('stopped');
            return;
        }
        try {
            const batchMax = Math.min(BATCH_SIZE, MAX_STEPS - totalSteps);
            const result   = sim.run(batchMax, breakpoints);
            totalSteps += result.steps;

            // Update the progress line live
            if (con) {
                // Replace the last line with updated step count + PC
                const phys = sim.physicalPC;
                const pcHex = '0x' + (phys >>> 0).toString(16).toUpperCase().padStart(4, '0');
                const lines  = con.textContent.split('\n');
                lines[lines.length - 1] = `Running… ${totalSteps} steps  PC=${pcHex}`;
                con.textContent = lines.join('\n');
                con.scrollTop = con.scrollHeight;
            }

            // Live-update the fault-free counter badge during the run.
            // _isSourceStale() is NOT checked here — _simRunHash is only set by
            // patchSimulator(), so it is always empty on a normal run; checking
            // staleness would permanently block the live update.
            {
                const _ffEl = document.getElementById('faultFreeCounter');
                if (_ffEl) {
                    const _liveClean = sim.faultLog.length === 0;
                    const _liveFfi = _faultFreeInstrTotal + (_liveClean ? totalSteps : 0);
                    if (_liveFfi >= 1000) {
                        _ffEl.textContent = '\u2713 MTBF 0.0001';
                        _ffEl.className = 'fault-free-badge ff-eligible';
                    } else if (_liveFfi > 0) {
                        _ffEl.textContent = `${_liveFfi.toLocaleString()}\u202F/\u202F1K`;
                        _ffEl.className = 'fault-free-badge ff-progress';
                    } else {
                        _ffEl.textContent = '0\u202F/\u202F1K';
                        _ffEl.className = 'fault-free-badge ff-zero';
                    }
                }
            }

            // Absent-lump: sim suspended mid-run waiting for a lazy fetch.
            if (sim.awaitingLump) {
                _showStopBtn(false);
                if (con) {
                    const al = sim.awaitingLump;
                    const lines = con.textContent.split('\n');
                    lines[lines.length - 1] = `⟳ Absent lump — fetching Slot ${al.nsIndex} token=0x${al.token}  (${totalSteps} steps)`;
                    con.textContent = lines.join('\n');
                    con.scrollTop = con.scrollHeight;
                }
                updateDashboard();
                triggerLazyLoad({ token: sim.awaitingLump.token, nsIndex: sim.awaitingLump.nsIndex, label: sim.nsLabels[sim.awaitingLump.nsIndex] || 'entry_'+sim.awaitingLump.nsIndex });
                return;
            }
            // Lazy-resolve NULL GT: sim suspended waiting for IDE to supply the GT (Task #1519).
            if (sim._lazySuspended) {
                _showStopBtn(false);
                if (con) {
                    const pending = [...(sim._pendingResolves || new Map()).values()];
                    const names = pending.map(p => `'${p.petName}'`).join(', ') || '(unknown)';
                    const lines = con.textContent.split('\n');
                    lines[lines.length - 1] = `⏸ Thread suspended — waiting for ${names} (${totalSteps} steps)`;
                    con.textContent = lines.join('\n');
                    con.scrollTop = con.scrollHeight;
                }
                for (const p of (sim._pendingResolves || new Map()).values()) {
                    _registerLazyResolvePending(p);
                }
                updateDashboard();
                return;
            }
            if (result.stopReason !== 'maxSteps') {
                finishRun(result.stopReason, result.breakpointAddr);
            } else if (totalSteps >= MAX_STEPS) {
                finishRun('maxSteps');
            } else {
                // Auto-pause when cumulative fault-free instruction count crosses 1,000
                if (sim.faultLog.length === 0
                        && _faultFreeInstrTotal < 1000
                        && (_faultFreeInstrTotal + totalSteps) >= 1000) {
                    finishRun('faultFreeLimit');
                    return;
                }
                try { updateDashboard(); } catch(e) { console.error('runBatch updateDashboard:', e); }
                setTimeout(runBatch, 0);
            }
        } catch(e) {
            console.error('runSim batch error:', e);
            finishRun('error');
        }
    }

    function finishRun(stopReason, breakpointAddr) {
        _showStopBtn(false);
        console.log('[finishRun] stopReason=', stopReason, 'halted=', sim.halted, 'bootComplete=', sim.bootComplete, 'faultLog=', sim.faultLog.length, 'steps=', totalSteps);
        if (sim.faultLog.length > 0) console.log('[finishRun] FAULTS:', JSON.stringify(sim.faultLog.map(f => f.type + ': ' + f.message)));
        const ranClean = ((stopReason === 'halted' || sim.halted) && sim.faultLog.length === 0)
            || stopReason === 'faultFreeLimit';
        const countable = stopReason !== 'breakpoint' && stopReason !== 'bootExit'
            && sim.bootComplete && totalSteps >= 1;
        // faultFreeLimit: always update the counter regardless of _simRunHash so
        // lumpBtn() sees >= 1000 when showNextSteps is called.
        if (stopReason === 'faultFreeLimit' && countable) {
            _faultFreeInstrTotal += totalSteps;
            _updateMtbfIndicator();
            if (typeof _updateFaultFreeCounter === 'function') _updateFaultFreeCounter();
        }
        if (countable && _simRunHash) {
            _simRunHistory.push({ hash: _simRunHash, passed: ranClean, timestamp: Date.now() });
            if (ranClean && stopReason !== 'faultFreeLimit') _faultFreeInstrTotal += totalSteps;
            _updateMtbfIndicator();
            if (typeof _updateFaultFreeCounter === 'function') _updateFaultFreeCounter();
        }
        if (con) {
            let status = 'Stopped.';
            if (stopReason === 'bootExit' || !sim.bootComplete) {
                status = 'PP250: Returned to boot sequence.';
            } else if (stopReason === 'halted' || sim.halted) {
                status = sim.faultLog.length > 0 ? 'Faulted.' : 'Done.';
            } else if (stopReason === 'breakpoint' && breakpointAddr != null) {
                status = `Breakpoint at 0x${breakpointAddr.toString(16).toUpperCase().padStart(4,'0')}.`;
            } else if (stopReason === 'maxSteps') {
                status = `Max steps (${totalSteps}) reached.`;
            } else if (stopReason === 'userStopped') {
                status = 'Stopped by user.';
            } else if (stopReason === 'error') {
                status = 'Runtime error — see console.';
            }
            const lines = con.textContent.split('\n');
            if (stopReason === 'faultFreeLimit') {
                lines[lines.length - 1] = `Boot complete. Ran ${totalSteps} steps.`;
                lines.push('\u2B50 1,000 fault-free instructions \u2014 LUMP unlocked.');
                lines.push('\uD83D\uDCBE Click \u201COpen Lump\u201D in Next Steps to view your LUMP.');
            } else {
                lines[lines.length - 1] = `Boot complete. Ran ${totalSteps} steps. ${status}`;
            }
            con.textContent = lines.join('\n');
            con.scrollTop = con.scrollHeight;
        }
        // Guard: updateDashboard can crash (e.g. null NS entry after stack overflow fault);
        // catch here so the Run button is always re-enabled regardless.
        try { updateDashboard(); } catch(e) { console.error('finishRun updateDashboard:', e); }
        // Clean HALT (no faults, boot complete) → open LUMP page for save workflow.
        // faultFreeLimit: go to editor first, then render Next Steps so lumpBtn sees >= 1000.
        // Faults, errors, breakpoints, maxSteps, and userStopped stay on dashboard.
        // S-IDE v1 auto-progress: Step 3 — successful build+run
        if (ranClean && sim.bootComplete) {
            if (typeof window._r1SetStep === 'function') window._r1SetStep(3);
        }
        if (stopReason === 'faultFreeLimit') {
            switchView('editor');
            if (typeof showNextSteps === 'function') showNextSteps('ran-clean');
        } else {
            if (sim.bootComplete && (stopReason === 'halted' || sim.halted)) {
                if (typeof showNextSteps === 'function')
                    showNextSteps(ranClean ? 'ran-clean' : 'ran-fault');
            }
            switchView(ranClean && sim.bootComplete ? 'lumps' : 'dashboard');
            openCRDetail(14);
        }
        // Persist the fault log so it survives a page reload.
        _saveFaultLog();
    }

    // Kick off the first batch
    setTimeout(runBatch, 0);
}

// ── FPGA connection status indicator ─────────────────────────────────────────

function updateFPGAStatusBtn() {
    const btn = document.getElementById('fpgaConnBtn');
    if (!btn) return;
    if (typeof TangSerial === 'undefined') {
        btn.className = 'ham-item';
        btn.textContent = 'FPGA';
        btn.title = 'WebSerial not available';
        return;
    }
    if (TangSerial.isConnected()) {
        btn.className = 'ham-item';
        btn.textContent = 'FPGA ✓';
        btn.setAttribute('data-tooltip', 'FPGA Connected — click to disconnect');
    } else {
        btn.className = 'ham-item';
        btn.textContent = 'FPGA';
        btn.setAttribute('data-tooltip', 'FPGA Disconnected — click to connect');
    }
}

let _fpgaToastTimer = null;
function _dismissFpgaToast() {
    if (_fpgaToastTimer) { clearTimeout(_fpgaToastTimer); _fpgaToastTimer = null; }
    var el = document.getElementById('fpgaToastEl');
    if (el) el.remove();
}
function _showFpgaToast(title, body, level, duration) {
    level = level || 'info';
    if (duration === undefined || duration === null) duration = 5000;
    _dismissFpgaToast();

    var icons = { info: '\u2139', ok: '\u2713', warn: '\u26A0', err: '\u2717' };
    var el = document.createElement('div');
    el.id = 'fpgaToastEl';
    el.className = 'fpga-toast fpga-toast-' + level;

    var header = document.createElement('div');
    header.className = 'fpga-toast-header';

    var iconSpan = document.createElement('span');
    iconSpan.className = 'fpga-toast-icon';
    iconSpan.textContent = icons[level] || icons.info;

    var titleSpan = document.createElement('span');
    titleSpan.className = 'fpga-toast-title';
    titleSpan.textContent = title;

    var closeBtn = document.createElement('button');
    closeBtn.className = 'fpga-toast-close';
    closeBtn.textContent = '\u2715';
    closeBtn.addEventListener('click', _dismissFpgaToast);

    header.appendChild(iconSpan);
    header.appendChild(titleSpan);
    header.appendChild(closeBtn);

    var bodyDiv = document.createElement('div');
    bodyDiv.className = 'fpga-toast-body';
    bodyDiv.textContent = body;

    el.appendChild(header);
    el.appendChild(bodyDiv);
    document.body.appendChild(el);

    if (duration > 0) {
        _fpgaToastTimer = setTimeout(function() {
            el.classList.add('fpga-toast-fade');
            setTimeout(function() { if (el.parentNode) el.remove(); }, 400);
        }, duration);
    }
}

function _fpgaLog(msg) {
    const con = document.getElementById('editorConsole');
    if (con) {
        con.textContent += '\n' + msg;
        con.scrollTop = con.scrollHeight;
    }
}

async function fpgaConnectToggle() {
    const btn = document.getElementById('fpgaConnBtn');
    if (typeof TangSerial === 'undefined') {
        _showFpgaToast('FPGA', 'WebSerial driver not loaded.', 'err');
        _fpgaLog('FPGA: WebSerial driver not loaded.');
        return;
    }
    if (TangSerial.isConnected()) {
        try {
            await TangSerial.disconnect();
            _showFpgaToast('FPGA Disconnected', 'Serial port closed.', 'info', 3000);
            _fpgaLog('FPGA: Disconnected.');
        } catch(e) {
            _showFpgaToast('FPGA', 'Disconnect error: ' + e.message, 'err');
            _fpgaLog('FPGA disconnect error: ' + e.message);
        }
        updateFPGAStatusBtn();
        return;
    }
    if (!TangSerial.isSupported()) {
        _showFpgaToast('WebSerial Not Available',
            'WebSerial is not supported in this browser or context.\n\nUse Chrome or Edge and open the app URL directly (not the Replit preview iframe).',
            'warn', 8000);
        _fpgaLog('FPGA: WebSerial not supported in this browser.\nUse Chrome or Edge, and open the app directly (not through the Replit preview iframe).');
        updateFPGAStatusBtn();
        return;
    }
    // Guard: board-specific connection guide before the browser port picker opens
    const _board = getSelectedBoard();
    const _boardHints = {
        'ti60-f225':          { chip: 'FTDI FT2232H',  look: 'look for "Dual RS232-HS" or "USB Serial Port"',      driver: 'install the FTDI VCP driver from ftdichip.com' },
        'tang-nano-20k-iot':  { chip: 'CH340 / CH341', look: 'look for "USB-SERIAL CH340" or "CH341 USB Bridge"',  driver: 'install the CH340 driver from wch-ic.com' },
        'wukong-xc7a100t':    { chip: 'FTDI FT232',    look: 'look for "USB Serial Port" or "FT232R USB UART"',    driver: 'install the FTDI VCP driver from ftdichip.com' },
    };
    const _h = _boardHints[_board] || _boardHints['wukong-xc7a100t'];
    const _label = getBoardLabel(_board);
    const _ready = window.confirm(
        'Connecting to ' + _label + '\n' +
        '─────────────────────────────────\n\n' +
        'USB chip on this board: ' + _h.chip + '\n\n' +
        'In the port picker that opens next:\n' +
        '  \u2022 ' + _h.look + '\n' +
        '  \u2022 If nothing appears, ' + _h.driver + '\n' +
        '  \u2022 Try a different USB cable if the port is still missing\n' +
        '  \u2022 Avoid choosing a built-in Intel or Bluetooth COM port\n\n' +
        'Click OK to open the port picker, or Cancel to abort.'
    );
    if (!_ready) {
        updateFPGAStatusBtn();
        return;
    }
    if (btn) {
        btn.className = 'ham-item';
        btn.textContent = '\u2B21 FPGA \u2026';
    }
    _showFpgaToast('FPGA Connecting\u2026', 'Select your FPGA serial port in the browser dialog.', 'info', 0);
    _fpgaLog('FPGA: Connecting \u2014 select your FPGA serial port in the browser dialog\u2026');
    try {
        await TangSerial.connect();
        var _pi = TangSerial.portInfo();
        var _pidMsg = (_pi && _pi.vid) ? ' [VID=0x' + _pi.vid + ' PID=0x' + _pi.pid + ']' : '';
        var _warn8086 = (_pi && _pi.vid === '8086') ? '\n\u26A0 This looks like your PC\u2019s built-in Intel UART, not the FPGA.\nTry a different port (USB1/USB2/USB3).' : '';
        _showFpgaToast('FPGA Connected', 'Serial port open' + _pidMsg + _warn8086, _warn8086 ? 'warn' : 'ok', _warn8086 ? 10000 : 4000);
        _fpgaLog('FPGA: Connected \u2713' + _pidMsg + (_warn8086 ? '\n  WARNING: Intel VID detected — likely wrong port!' : ''));
    } catch(e) {
        const msg = e.message || String(e);
        if (msg.includes('permissions policy') || msg.includes('disallowed')) {
            _showFpgaToast('WebSerial Blocked',
                'The browser permissions policy blocks WebSerial in this context.\n\nOpen the published app URL directly in Chrome to connect.',
                'warn', 10000);
            _fpgaLog('FPGA: WebSerial blocked by the browser permissions policy.\n' +
                     'This happens in the Replit preview iframe.\n' +
                     'To connect your FPGA: open the published/deployed app URL directly in Chrome,\n' +
                     'or use the dedicated "Deploy to Tang" button in the Build tab.');
        } else if (msg.includes('No port selected') || msg.includes('user cancelled') || msg.includes('AbortError')) {
            _showFpgaToast('FPGA', 'Port selection cancelled \u2014 no port chosen.', 'warn', 3000);
            _fpgaLog('FPGA: Port selection cancelled \u2014 no port chosen.');
        } else {
            _showFpgaToast('FPGA Connect Failed', msg, 'err', 6000);
            _fpgaLog('FPGA connect failed: ' + msg);
        }
    }
    updateFPGAStatusBtn();
}

async function fpgaBridgeConnect() {
    if (typeof TangSerial === 'undefined') {
        _showFpgaToast('Bridge', 'TangSerial driver not loaded.', 'err');
        _fpgaLog('FPGA: TangSerial driver not loaded.');
        return;
    }
    if (TangSerial.isConnected()) {
        try {
            await TangSerial.disconnect();
            _showFpgaToast('Bridge Disconnected', 'Bridge session closed.', 'info', 3000);
            _fpgaLog('FPGA Bridge: Disconnected.');
        } catch(e) {
            _showFpgaToast('Bridge', 'Disconnect error: ' + e.message, 'err');
            _fpgaLog('FPGA Bridge disconnect error: ' + e.message);
        }
        updateFPGAStatusBtn();
        return;
    }
    _showBridgeModal();
}

function _showBridgeModal() {
    var existing = document.getElementById('bridgeModalOverlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'bridgeModalOverlay';
    overlay.className = 'modal-overlay';

    var savedUrl = localStorage.getItem('ti60BridgeUrl') || 'https://penguin.linux.test:8766';
    var dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.innerHTML =
        '<div class="modal-title">FPGA Bridge Connect</div>' +
        '<p style="font-size:0.8rem;color:var(--text-secondary);margin:0 0 0.4rem">1\ufe0f\u20e3  Run this from the <strong>church-machine/</strong> project root (Crostini):</p>' +
        '<pre style="background:var(--bg-input);padding:0.5rem;border-radius:4px;font-size:0.78rem;color:#22c55e;margin:0 0 0.75rem;white-space:pre-wrap;overflow-x:auto">cd ~/church_project/SoC/church-machine\npython3 server/local_bridge.py /dev/ttyUSB2 115200 8766</pre>' +
        '<p style="font-size:0.8rem;color:var(--text-secondary);margin:0 0 0.4rem">2\ufe0f\u20e3  First time only \u2014 accept the self-signed cert:</p>' +
        '<p style="font-size:0.78rem;margin:0 0 0.75rem">Open <a href="https://penguin.linux.test:8766/status" target="_blank" rel="noopener" ' +
            'style="color:#a0d4a0">https://penguin.linux.test:8766/status</a> in a new Chrome tab and click <em>Advanced \u2192 Proceed</em>.</p>' +
        '<p style="font-size:0.8rem;color:var(--text-secondary);margin:0 0 0.4rem">3\ufe0f\u20e3  Enter bridge URL and click Connect:</p>' +
        '<label class="modal-label">Bridge URL' +
            '<input id="bridgeUrlInput" class="modal-input" type="text" value="' + savedUrl + '" placeholder="https://penguin.linux.test:8766">' +
        '</label>' +
        '<div class="modal-buttons">' +
            '<button id="bridgeModalCancel" class="btn">Cancel</button>' +
            '<button id="bridgeModalOk" class="btn btn-primary">Connect</button>' +
        '</div>';

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    var urlInput = document.getElementById('bridgeUrlInput');
    urlInput.focus();
    urlInput.select();

    function closeModal() { overlay.remove(); document.removeEventListener('keydown', onEsc); }
    function onEsc(e) { if (e.key === 'Escape') closeModal(); }
    document.addEventListener('keydown', onEsc);
    document.getElementById('bridgeModalCancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });

    var submitted = false;
    async function submit() {
        if (submitted) return;
        submitted = true;
        var url = urlInput.value.trim();
        closeModal();
        if (!url) {
            _showFpgaToast('Bridge', 'No URL entered \u2014 cancelled.', 'warn', 3000);
            _fpgaLog('FPGA Bridge: Cancelled.');
            return;
        }
        var btn = document.getElementById('fpgaConnBtn');
        if (btn) { btn.className = 'ham-item'; btn.textContent = '\u2B21 FPGA \u2026'; }
        _showFpgaToast('Bridge Connecting\u2026', 'Reaching ' + url, 'info', 0);
        _fpgaLog('FPGA Bridge: Connecting to ' + url + ' \u2026');
        try {
            await TangSerial.connectBridge(url);
            _showFpgaToast('Bridge Connected', 'Using local bridge at ' + url, 'ok', 4000);
            _fpgaLog('FPGA Bridge: Connected \u2713  (using local bridge, not WebSerial)');
        } catch(e) {
            var _bridgeCmd = 'python3 server/local_bridge.py /dev/ttyUSB2 115200 8766';
            _showFpgaToast('Bridge Connect Failed',
                (e.message || String(e)) + '\n\nIs the bridge running?\n' + _bridgeCmd +
                '\n\nAlso accept the self-signed cert first:\nhttps://penguin.linux.test:8766/status',
                'err', 10000);
            _fpgaLog('FPGA Bridge connect failed: ' + (e.message || String(e)) +
                '\n\nMake sure the bridge is running:\n  ' + _bridgeCmd +
                '\n\nFirst-time cert setup: open https://penguin.linux.test:8766/status in Chrome \u2192 Advanced \u2192 Proceed');
        }
        updateFPGAStatusBtn();
    }

    document.getElementById('bridgeModalOk').addEventListener('click', submit);
    urlInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
}

// Poll FPGA status every 2 s so the indicator stays current
setInterval(updateFPGAStatusBtn, 2000);

// ── BRAM readback ─────────────────────────────────────────────────────────────
// Sends 0xBEAD to the Ti60 F225 debug FSM and dumps the returned words to the
// editor console as a hex table.  Useful to verify PATCH_LUMP actually wrote the
// correct words after a patch.
function fpgaReadBRAM() {
    if (typeof TangSerial === 'undefined' || !TangSerial.isConnected()) {
        _showFpgaToast('Read BRAM', 'FPGA not connected \u2014 click \u2B21 FPGA to connect first.', 'warn', 5000);
        _fpgaLog('Read BRAM: FPGA not connected \u2014 click \u2B21 FPGA to connect first.');
        return;
    }

    const existing = document.getElementById('bramModalOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'bramModalOverlay';
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.innerHTML = `
        <div class="modal-title">Read BRAM</div>
        <label class="modal-label">Start word address (hex)
            <input id="bramAddrInput" class="modal-input" type="text" value="0x0000">
        </label>
        <label class="modal-label">Word count
            <input id="bramCountInput" class="modal-input" type="text" value="256">
        </label>
        <div class="modal-buttons">
            <button id="bramModalCancel" class="btn">Cancel</button>
            <button id="bramModalOk" class="btn btn-primary">OK</button>
        </div>`;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const addrInput  = document.getElementById('bramAddrInput');
    const countInput = document.getElementById('bramCountInput');
    addrInput.focus();
    addrInput.select();

    function closeModal() { overlay.remove(); document.removeEventListener('keydown', onEscape); }

    document.getElementById('bramModalCancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });
    function onEscape(e) { if (e.key === 'Escape') closeModal(); }
    document.addEventListener('keydown', onEscape);

    let submitted = false;
    async function submit() {
        if (submitted) return;
        submitted = true;
        const addrStr  = addrInput.value;
        const countStr = countInput.value;
        closeModal();

        const baseAddr = parseInt(addrStr, 16) || 0;
        const count    = Math.min(Math.max(parseInt(countStr, 10) || 256, 1), 2048);

        _fpgaLog(`Read BRAM: addr=0x${baseAddr.toString(16).toUpperCase().padStart(4,'0')} count=${count}…`);

        _showFpgaToast('Reading BRAM\u2026', `addr=0x${baseAddr.toString(16).toUpperCase().padStart(4,'0')}  count=${count}`, 'info', 0);
        try {
            const result = await TangSerial.readBRAM(baseAddr, count, (msg) => _fpgaLog(msg));
            if (result.words.length === 0) {
                _showFpgaToast('Read BRAM', 'No data received \u2014 is the bitstream built with READ_BRAM?', 'err', 8000);
                _fpgaLog('Read BRAM: no data received \u2014 is the Ti60 F225 bitstream built with READ_BRAM support?');
                return;
            }
            const PER_LINE = 8;
            let out = `\nBRAM dump  addr=0x${baseAddr.toString(16).toUpperCase().padStart(4,'0')}  (${result.words.length} words):\n`;
            for (let i = 0; i < result.words.length; i += PER_LINE) {
                const lineAddr = baseAddr + i;
                const hex = result.words.slice(i, i + PER_LINE)
                    .map(w => w.toString(16).toUpperCase().padStart(8, '0'))
                    .join('  ');
                out += `  +${String(lineAddr).padStart(4)}  ${hex}\n`;
            }
            const con = document.getElementById('editorConsole');
            if (con) { con.textContent += out; con.scrollTop = con.scrollHeight; }
            _showFpgaToast('BRAM Read Complete', result.words.length + ' words dumped to console.', 'ok', 4000);
        } catch(e) {
            _showFpgaToast('Read BRAM Error', e.message, 'err', 6000);
            _fpgaLog('Read BRAM error: ' + e.message);
        }
    }

    document.getElementById('bramModalOk').addEventListener('click', submit);
    addrInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); countInput.focus(); countInput.select(); } });
    countInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
}

let _lastFault = null;
let _lastRetryLump = null;

function faultAlertOn() {
    const btn = document.getElementById('toolFaultBtn');
    if (!btn) return;
    btn.classList.remove('fault-idle');
    btn.classList.add('fault-alert');
}

function faultAlertOff() {
    const btn = document.getElementById('toolFaultBtn');
    if (!btn) return;
    btn.classList.remove('fault-alert');
    btn.classList.add('fault-idle');
}

function faultRecall() {
    if (_lastFault) {
        showFaultModal(_lastFault);
    } else {
        faultClear();
    }
}

function faultClear() {
    _lastFault = null;
    faultAlertOff();
    _defaultProgramLoaded = false;
    _bootAuditAccum = [];
    _clearLumpPetNames();
    try { localStorage.removeItem(_FAULT_LOG_LS_KEY); } catch(e) {}
    sim.reset();
    _initLazyLoadManifest();
    pipelineViz.reset();
    const con = document.getElementById('editorConsole');
    if (con) con.textContent = 'FAULT: Machine cleared.';
    updateDashboard();
}

const _FAULT_COLORS = {
    BOUNDS:       '#e05555', NULL_CAP:    '#e05555', PERM_X:       '#e07030',
    PERMISSION:   '#e07030', VERSION:     '#c0a030', SEAL:         '#c0a030',
    BIND:         '#c0a030', F_BIT:       '#c08030', DOMAIN_PURITY:'#e05555',
    BOOT:         '#e05555', MATH_ERROR:  '#c0a030', DOMAIN_ERROR: '#c0a030',
    STACK_OVERFLOW:'#e05555', STACK_UNDERFLOW:'#e05555', TYPE: '#e05555',
    RANGE:        '#e05555',
    OUTFORM_CRC:  '#c07020', OUTFORM_ALLOC:'#c07020', OUTFORM_MINT:'#c07020', OUTFORM_HDR:'#c07020',
    LUMP_MAGIC:   '#c07020', LUMP_SIZE:   '#c07020', LUMP_LAYOUT:'#c07020', LUMP_OOM:   '#c07020',
};

// Numeric fault codes matching hw_types.py FaultType enum (5-bit UART field).
// null = simulator-only fault with no hardware code.
const _FAULT_CODES = {
    PERM_R:0x01, PERM_W:0x02, PERM_X:0x03, PERM_L:0x04, PERM_S:0x05, PERM_E:0x06,
    NULL_CAP:0x07, BOUNDS:0x08, VERSION:0x09, SEAL:0x0A, INVALID_OP:0x0B,
    TPERM_RSV:0x0C, DOMAIN_PURITY:0x0D, BIND:0x0E, F_BIT:0x0F,
    STACK_OVERFLOW:0x10, ABSENT_OUTFORM:0x11, STACK_CORRUPT:0x12, STACK_UNDERFLOW:0x13,
    OUTFORM_CRC:0x15, OUTFORM_ALLOC:0x16, OUTFORM_MINT:0x17, OUTFORM_HDR:0x18,
    RANGE:        0x10,   // stack overflow manifests as RANGE violation on CR14 (same code)
    // Software-only (no hardware code):
    PERM:null, BOOT:null, MATH_ERROR:null,
    DOMAIN_ERROR:null, HANDLER:null, PERMISSION:null, TYPE:null,
    LUMP_MAGIC:null, LUMP_SIZE:null, LUMP_LAYOUT:null, LUMP_OOM:null,
};

// Human-readable descriptions for firmware download (outform) fault codes
// and lump structural integrity fault codes.
const _OUTFORM_DESCRIPTIONS = {
    OUTFORM_CRC:   'CRC-32 mismatch in the downloaded lump — the binary was corrupted in transit. Try re-downloading or re-flashing.',
    OUTFORM_ALLOC: 'Memory allocator rejected the lump — not enough free lump space to install this abstraction. Evict unused lumps and retry.',
    OUTFORM_MINT:  'Capability minting failed during lump install — the lump\u2019s GT could not be sealed. Check lump permissions and slot type.',
    OUTFORM_HDR:   'Lump header validation failed — bad length or alignment in the downloaded binary. The lump file may be truncated or malformed.',
    LUMP_MAGIC:    'Lump header magic byte is invalid — the slot has no compiled lump installed, or memory has been zeroed. Compile and install an abstraction into this namespace slot, then retry the boot.',
    LUMP_LAYOUT:   'Lump capability-list length is zero (cc=0) — the lump has no C-List. The lump binary may be corrupt or was compiled without any capability slots. Recompile and reinstall the abstraction.',
};
// Map simulator-internal LUMP_* fault names to their OUTFORM_* equivalents.
const _LUMP_TO_OUTFORM = {
    LUMP_MAGIC:  'OUTFORM_HDR',
    LUMP_SIZE:   'OUTFORM_HDR',
    LUMP_LAYOUT: 'OUTFORM_HDR',
    LUMP_OOM:    'OUTFORM_ALLOC',
};

// English-language explanations for every named fault type.
// OUTFORM/LUMP faults are covered by _OUTFORM_DESCRIPTIONS; all others live here.
const _FAULT_DESCRIPTIONS = {
    RANGE:          'A capability register was used to access memory outside its permitted range. The offset computed by the instruction exceeded the capability\'s scope. Check that the base, limit, and offset are correct, and that the right capability is in the source register.',
    BOUNDS:         'A c-list or memory scope violation: the instruction tried to read or write beyond the boundary described by the capability. Verify that the capability was minted with the correct limit and that loop indices or offsets cannot overflow it.',
    NULL_CAP:       'The instruction attempted to dereference a null (zeroed) capability register. Ensure the capability has been loaded into the register before use and that no earlier fault or reset cleared it prematurely.',
    PERM_R:         'Read permission (R) was required but the capability does not grant it. The capability must have R set to allow data reads through this register.',
    PERM_W:         'Write permission (W) was required but the capability does not grant it. The capability must have W set to allow data writes through this register.',
    PERM_X:         'Execute permission (X) was required but the capability does not grant it. Only capabilities sealed for execution may be invoked as call targets.',
    PERM_L:         'Load permission (L) was required but the capability does not grant it. L must be set on a capability that is used to load other capabilities from the c-list.',
    PERM_S:         'Store permission (S) was required but the capability does not grant it. S must be set on the capability used to write a new capability into the c-list.',
    PERM_E:         'Enter permission (E) was required but the capability does not grant it. E allows a capability to be used as an entry point for a sealed domain.',
    PERM:           'A required permission bit was absent on the capability. Check which permission the operation needs (R, W, X, L, S, or E) and ensure the capability was minted or passed in with that permission.',
    PERMISSION:     'A required permission bit was absent on the capability. Check which permission the operation needs (R, W, X, L, S, or E) and ensure the capability was minted or passed in with that permission.',
    VERSION:        'Capability version mismatch: the capability\'s revocation counter no longer matches the current GT sequence number. The GT was likely revoked by a CHANGE instruction after this capability was issued. Reload the capability from the authoritative source.',
    SEAL:           'The capability\'s seal bit did not match what the operation requires. Sealed capabilities can only be invoked (CALL), not read or written directly; unsealed capabilities cannot be used as call targets.',
    BIND:           'The capability is bound to a specific domain and cannot be used outside it. This protects the security model by preventing capabilities from leaking across trust boundaries.',
    F_BIT:          'The F (foreign) bit on a capability violated the domain-purity rule. Foreign capabilities cannot be stored into a local c-list or passed as a sealed argument without explicit permission.',
    TYPE:           'The GT type field did not match what the operation requires. For example, a CALL requires a type-2 (output) capability; using a type-1 (input) capability as a call target will raise this fault.',
    TPERM_RSV:      'X\u2295LSE domain-purity violation: an instruction attempted to combine mutually exclusive permission sets (e.g. execute and load/store/enter on the same capability). This is reserved by the ISA and is never valid.',
    DOMAIN_PURITY:  'A domain-purity constraint was violated. The operation mixed capabilities or register state from incompatible domains, breaking the isolation guarantee between trust boundaries.',
    DOMAIN_ERROR:   'An internal domain consistency error occurred. This usually indicates a misconfigured capability tree or an attempt to cross a domain boundary without the required sealing.',
    STACK_OVERFLOW: 'The call stack is full — too many nested calls without matching returns. Reduce call depth, check for runaway recursion, or increase the stack limit if the design permits it.',
    STACK_UNDERFLOW:'The call stack is empty — a RETURN was executed without a matching CALL. Check that every code path through the method returns exactly once and that no extraneous RETURN instructions are present.',
    INVALID_OP:     'The instruction encoding is not valid for this ISA version. The raw word does not correspond to any defined opcode. Check for a linker or assembler bug that produced a corrupt instruction word.',
    BOOT:           'A fault occurred during the boot sequence before normal execution began. Review the boot log for the specific failing step.',
    MATH_ERROR:     'A mathematical operation produced an undefined result (e.g. division by zero or an overflow that the ISA does not permit). Add bounds checks before the operation.',
    HANDLER:        'A fault handler itself faulted, leaving the machine in an unrecoverable state. Inspect the fault handler code and ensure it does not perform operations that could themselves fault.',
    ABSENT_OUTFORM: 'A firmware download (outform) was expected but no lump was provided. Ensure the namespace slot is populated with a compiled abstraction before booting.',
    STACK_CORRUPT:  'The call-stack integrity check failed — the saved return address or frame data has been overwritten. This may indicate a buffer overflow or stray write that corrupted the stack region.',
};

// ── Fault-note localStorage persistence ──────────────────────────────────────
const _FAULT_NOTE_LS_PREFIX = 'cm_fault_note:';

function _faultNoteKey(f) {
    const pc = (f.physicalPC !== undefined && f.physicalPC !== null) ? f.physicalPC : f.pc;
    return _FAULT_NOTE_LS_PREFIX + f.type + ':' + (pc >>> 0) + ':' + f.step;
}

function _saveFaultNote(f, note) {
    try {
        if (note) {
            localStorage.setItem(_faultNoteKey(f), note);
        } else {
            localStorage.removeItem(_faultNoteKey(f));
        }
    } catch(e) {}
    _saveFaultLog();
}

function _loadFaultNote(f) {
    try { return localStorage.getItem(_faultNoteKey(f)) || ''; } catch(e) { return ''; }
}

function _clearAllFaultNotes() {
    try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(_FAULT_NOTE_LS_PREFIX)) keys.push(k);
        }
        for (const k of keys) localStorage.removeItem(k);
    } catch(e) {}
    try { localStorage.removeItem(_FAULT_LOG_LS_KEY); } catch(e) {}
}

// ── Fault-log localStorage persistence ───────────────────────────────────────
const _FAULT_LOG_LS_KEY = 'cm_fault_log';

// The subset of fault-object fields we serialise (skips the large instrHistory array).
const _FAULT_LOG_FIELDS = ['type','message','pc','physicalPC','step','faultStep','userNote',
                           '_nsSnapshot','faultLabel','crSnapshot','drSnapshot','flagsSnapshot',
                           'malformedReason',
                           'tier','catchInvoked','irqInvoked','tier3Recovery',
                           'faultCode','faultingAbstractionSlot','faultingAbstractionLabel'];

function _saveFaultLog() {
    try {
        if (!sim || !sim.faultLog || sim.faultLog.length === 0) {
            localStorage.removeItem(_FAULT_LOG_LS_KEY);
            return;
        }
        const slim = sim.faultLog.map(f => {
            // Eagerly resolve the ns snapshot when it hasn't been set yet
            // (the modal sets it lazily; we want it persisted even if the modal
            // was never opened in this session).
            if (!Object.prototype.hasOwnProperty.call(f, '_nsSnapshot')) {
                // Prefer CR14 snapshot gtIndex — directly names the executing lump's
                // ns slot without depending on memory range lookups.
                const _cr14s = f.crSnapshot && f.crSnapshot[14];
                if (_cr14s && _cr14s.word0) {
                    const _ni = _cr14s.word0 & 0xFFFF;
                    // Prefer the label captured at fault() time (immune to eviction churn);
                    // fall back to the live nsLabels table only when not available.
                    const _lbl = f.faultLabel || (sim.nsLabels && sim.nsLabels[_ni]) || `NS[${_ni}]`;
                    const _base = (_cr14s.word1 !== undefined && _cr14s.word1 !== null) ? (_cr14s.word1 >>> 0) : 0;
                    const _fpc = (f.physicalPC !== undefined && f.physicalPC !== null) ? f.physicalPC : f.pc;
                    f._nsSnapshot = { label: _lbl, nsIdx: _ni, offset: _fpc - _base };
                } else {
                    const _pc = (f.physicalPC !== undefined && f.physicalPC !== null) ? f.physicalPC : f.pc;
                    f._nsSnapshot = _nsOwnerOf(_pc);
                }
            }
            const out = {};
            for (const k of _FAULT_LOG_FIELDS) {
                if (Object.prototype.hasOwnProperty.call(f, k)) out[k] = f[k];
            }
            // Persist the raw instruction word so disasm survives a reload.
            const _histEntry = (f.instrHistory || []).find(h => h.step === f.faultStep)
                            || (f.instrHistory && f.instrHistory.length
                                ? f.instrHistory[f.instrHistory.length - 1] : null);
            if (_histEntry && _histEntry.raw !== undefined) out._faultRawWord = _histEntry.raw;
            return out;
        });
        localStorage.setItem(_FAULT_LOG_LS_KEY, JSON.stringify(slim));
    } catch(e) {}
}

function _restoreFaultLog() {
    try {
        const raw = localStorage.getItem(_FAULT_LOG_LS_KEY);
        if (!raw) return;
        const faults = JSON.parse(raw);
        if (!Array.isArray(faults) || faults.length === 0) return;
        // Basic shape validation: skip entries that lack a fault type or step.
        const valid = faults.filter(f => f && typeof f.type === 'string' && typeof f.step === 'number');
        if (valid.length === 0) return;
        for (const f of valid) {
            // Reconstruct a synthetic instrHistory so showFaultModal can get the raw word.
            if (f._faultRawWord !== undefined && !f.instrHistory) {
                f.instrHistory = [{ step: f.faultStep != null ? f.faultStep : f.step, raw: f._faultRawWord }];
            }
            // Fill userNote from the dedicated note key if not embedded in the slim entry.
            if (!f.userNote) {
                const storedNote = _loadFaultNote(f);
                if (storedNote) f.userNote = storedNote;
            }
        }
        if (sim && sim.faultLog) {
            sim.faultLog = valid;
        }
    } catch(e) { console.warn('[_restoreFaultLog] failed:', e); }
}

function showFaultModal(f) {
    const existing = document.getElementById('faultModalOverlay');
    if (existing) existing.remove();

    // Populate userNote from localStorage if not already set in memory
    if (!f.userNote) {
        const stored = _loadFaultNote(f);
        if (stored) f.userNote = stored;
    }

    // Snapshot the current awaitingLump so the Retry Download button can use it
    // even if sim.awaitingLump is cleared before the user clicks.
    if (sim.awaitingLump && sim.awaitingLump.token != null) {
        _lastRetryLump = { token: sim.awaitingLump.token, nsIndex: sim.awaitingLump.nsIndex };
    }

    // Use physicalPC (actual memory address of the faulting instruction) when available;
    // fall back to f.pc (relative PC) for pre-boot faults or older entries.
    const pc     = (f.physicalPC !== undefined && f.physicalPC !== null) ? f.physicalPC : f.pc;
    const pcHex  = '0x' + pc.toString(16).toUpperCase().padStart(4, '0');
    const _histEntry = (f.instrHistory || []).find(h => h.step === f.faultStep)
                    || (f.instrHistory && f.instrHistory.length ? f.instrHistory[f.instrHistory.length - 1] : null);
    const word   = _histEntry ? _histEntry.raw : ((sim.memory && pc < sim.memory.length) ? sim.memory[pc] : 0);
    const disasm = assembler ? assembler.disassemble(word) : '???';
    if (!Object.prototype.hasOwnProperty.call(f, '_nsSnapshot')) {
        // Prefer CR14 snapshot — directly names the executing lump's ns slot
        // without depending on memory-range lookups.
        const _cr14lazy = f.crSnapshot && f.crSnapshot[14];
        if (_cr14lazy && _cr14lazy.word0) {
            const _ni = _cr14lazy.word0 & 0xFFFF;
            // Prefer the label captured at fault() time; fall back to live nsLabels.
            const _lbl = f.faultLabel || (sim.nsLabels && sim.nsLabels[_ni]) || `NS[${_ni}]`;
            const _base = (_cr14lazy.word1 !== undefined && _cr14lazy.word1 !== null) ? (_cr14lazy.word1 >>> 0) : 0;
            f._nsSnapshot = { label: _lbl, nsIdx: _ni, offset: pc - _base };
        } else {
            f._nsSnapshot = _nsOwnerOf(pc);
        }
    }
    const ns     = f._nsSnapshot;

    // locationNs — the authoritative lump label and offset for display.
    // Prefers crSnapshot[14] (captured at fault time) over _nsSnapshot so
    // heap-loaded lumps (e.g. LED flash) are shown instead of Boot.NS.
    const _cr14snap = f.crSnapshot && f.crSnapshot[14];
    let locationNs;
    if (_cr14snap && _cr14snap.word0) {
        const _ni   = _cr14snap.word0 & 0xFFFF;
        // Prefer the label captured at fault() time; fall back to live nsLabels.
        const _lbl  = f.faultLabel || (sim.nsLabels && sim.nsLabels[_ni]) || `NS[${_ni}]`;
        const _base = (_cr14snap.word1 !== undefined && _cr14snap.word1 !== null) ? (_cr14snap.word1 >>> 0) : 0;
        locationNs  = { label: _lbl, nsIdx: _ni, offset: pc - _base };
    } else {
        locationNs  = ns;
    }
    const nsStr  = locationNs ? `${locationNs.label} +${locationNs.offset}` : '\u2014';

    // Authoritative ns index for "view lump" navigation.
    // crSnapshot[14].gtIndex is captured at fault time and directly names
    // the executing code lump's namespace slot — more reliable than
    // _nsOwnerOf which does a memory-range search that can find the wrong
    // lump or return null.
    const nsIdxForViewLump = (_cr14snap && _cr14snap.word0)
        ? (_cr14snap.word0 & 0xFFFF)
        : (ns ? ns.nsIdx : null);
    const color  = _FAULT_COLORS[f.type] || '#e05555';

    // Numeric hardware fault code
    const codeVal = _FAULT_CODES.hasOwnProperty(f.type) ? _FAULT_CODES[f.type] : undefined;
    const codeStr = codeVal != null
        ? `0x${codeVal.toString(16).toUpperCase().padStart(2,'0')} (${codeVal})`
        : 'SW only';

    const allFaults  = sim.faultLog || [];
    const historyHtml = allFaults.length > 1
        ? allFaults.slice(-5).map((fl, i, arr) => {
            const isCurrent = (i === arr.length - 1);
            return `<span class="fault-hist-item${isCurrent ? ' fault-hist-current' : ''}"><button class="gate-loc-step-link fault-hist-step-link" onclick="faultModalDismiss();jumpToTraceStep(${fl.step},'${fl.type.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}');" title="Jump to step ${fl.step} in the Trace view">[step ${fl.step}]</button> ${fl.type}</span>`;
          }).join('')
        : '';

    // ── C-List pet name for the faulting instruction ───────────────────────
    // When the faulting instruction is a LOAD or CALL that reads from CR6 (the
    // C-List register), resolve the pet name of the referenced slot and surface
    // it in the fault description.
    let _faultCListSlot = null;
    let _faultCListPetName = null;
    let _faultCListGT = null;
    {
        const _op = (word >>> 27) & 0x1F;
        const _isLoadOrCall = (_op === 0 || _op === 2); // LOAD=0, CALL=2
        if (_isLoadOrCall) {
            const _crSrc = (word >>> 15) & 0xF;
            if (_crSrc === 6 && sim.cr && sim.cr[6]) {
                const _slotIdx = word & 0x7FFF;
                const _clistBase = sim.cr[6].word1 >>> 0;
                const _slotAddr = _clistBase + _slotIdx;
                if (sim.memory && _slotAddr < sim.memory.length) {
                    const _slotGT = sim.memory[_slotAddr] >>> 0;
                    const _name = (typeof _resolveCListPetName === 'function') ? _resolveCListPetName(_slotGT) : null;
                    if (_name) {
                        _faultCListSlot = _slotIdx;
                        _faultCListPetName = _name;
                        _faultCListGT = _slotGT;
                    }
                }
            }
        }
    }

    // ── C-List slot permissions badge (precomputed for template clarity) ─────
    let _faultCListPermsHTML = '';
    if (_faultCListGT !== null) {
        try {
            const _p = sim.parseGT(_faultCListGT);
            const _perms = ['R','W','X','L','S','E'].filter(k => _p.permissions[k]).join('');
            if (_perms) _faultCListPermsHTML = ' ' + _permsHTML(_perms);
        } catch(e) {}
    }

    // ── Capability register snapshot ──────────────────────────────────────
    const crSnap = f.crSnapshot || [];
    let crTableRows = '';
    crSnap.forEach((c, i) => {
        if (!c || c.word0 === 0) return;
        try {
            const p = sim.parseGT(c.word0);
            const typeChar = ['\u2014','I','O','A'][p.type] || '?';
            const perms = ['R','W','X','L','S','E'].filter(k => p.permissions[k]).join('') || '\u2014';
            const base  = c.word1 ? '0x'+((c.word1>>>0).toString(16).toUpperCase()) : '\u2014';
            const crName = (typeof _resolveCListPetName === 'function') ? (_resolveCListPetName(c.word0) || '\u2014') : '\u2014';
            crTableRows += `<tr>
                <td class="freg-name">CR${i}</td>
                <td class="freg-type">${typeChar}</td>
                <td class="freg-slot">S${p.index}</td>
                <td class="freg-perms">${perms === '\u2014' ? perms : _permsHTML(perms)}</td>
                <td class="freg-base">${base}</td>
                <td class="freg-petname">${crName}</td>
            </tr>`;
        } catch(e) {}
    });
    const crSection = crTableRows ? `
        <div class="fault-regs-section">
            <div class="fault-regs-label">Capability Registers <span class="fault-regs-legend">${_rightsLegendHTML()}</span></div>
            <div class="fault-regs-scroll">
                <table class="fault-regs-table">
                    <thead><tr><th>Reg</th><th>Type</th><th>Slot</th><th>Perms</th><th>Base</th><th>Name</th></tr></thead>
                    <tbody>${crTableRows}</tbody>
                </table>
            </div>
        </div>` : '';

    // ── Data register + flags snapshot ────────────────────────────────────
    const drSnap = f.drSnapshot || [];
    const drParts = drSnap
        .map((v, i) => ({ v: v >>> 0, i }))
        .filter(({v}) => v !== 0)
        .map(({v, i}) => `<span class="freg-dr">DR${i}=0x${v.toString(16).toUpperCase().padStart(8,'0')}</span>`);

    const fl = f.flagsSnapshot || {};
    const flagsStr = ['Z','N','C','V'].map(k => `<span class="freg-flag ${fl[k]?'flag-set':''}">${k}=${fl[k]?1:0}</span>`).join('');

    const drSection = (drParts.length > 0 || flagsStr) ? `
        <div class="fault-regs-section">
            ${drParts.length > 0 ? `<div class="fault-regs-label">Data Registers (non-zero)</div>
            <div class="fault-dr-row">${drParts.join(' ')}</div>` : ''}
            <div class="fault-flags-row">Flags: ${flagsStr}</div>
        </div>` : '';

    // ── Pet name alias maps (number → name) for register annotation ──────────
    // Seed from global lump pet names first, then layer in compiler aliases so
    // source-compiled names win over lump metadata when both are present.
    const _petCR = Object.assign({}, _petNameCRMap || {});
    const _petDR = Object.assign({}, _petNameDRMap || {});
    if (assembler) {
        const _al = assembler.getAliases();
        for (const [nm, num] of Object.entries(_al.cr || {})) _petCR[num] = nm;
        for (const [nm, num] of Object.entries(_al.dr || {})) _petDR[num] = nm;
    }
    // Apply pet names and (optionally) highlight a specific offset bracket in a disasm string.
    // offsetToHighlight: string like "[0x0008]" to wrap in .itrace-offset-fault, or null.
    function _petDisasm(str, offsetToHighlight) {
        let s = str
            .replace(/\bCR(\d+)\b/g, (m, n) => {
                const a = _petCR[+n];
                return a ? `<span class="itrace-pet" title="CR${n}">${a}</span>` : m;
            })
            .replace(/\bDR(\d+)\b/g, (m, n) => {
                const a = _petDR[+n];
                return a ? `<span class="itrace-pet" title="DR${n}">${a}</span>` : m;
            });
        if (offsetToHighlight) {
            // Escape for use in regex
            const escaped = offsetToHighlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            s = s.replace(new RegExp(escaped, 'g'),
                `<span class="itrace-offset-fault">${offsetToHighlight}</span>`);
        }
        return s;
    }

    // Rewrite the raw simulator fault message to use pet names and offset notation.
    // Input:  "LOAD: CR6: address 455 outside valid range [447..447]"
    // Output: "LOAD: cloomc\u00a0(CR6): offset [0x0008] outside valid range [0x0000..0x0000]"
    function _transformFaultMsg(msg) {
        let s = msg
            .replace(/\bCR(\d+)\b/g, (m, n) => {
                const a = _petCR[+n];
                return a ? `${a}\u00a0(CR${n})` : m;
            })
            .replace(/\bDR(\d+)\b/g, (m, n) => {
                const a = _petDR[+n];
                return a ? `${a}\u00a0(DR${n})` : m;
            });
        // Rewrite "address N outside valid range [base..limit]" → offset-relative form
        s = s.replace(
            /address\s+(\d+)\s+outside valid range\s+\[(\d+)\.\.(\d+)\]/,
            (m, addr, base, limit) => {
                const badOff = parseInt(addr) - parseInt(base);
                const maxOff = parseInt(limit) - parseInt(base);
                const badHex = '[0x' + badOff.toString(16).toUpperCase().padStart(4, '0') + ']';
                const maxHex = '[0x' + (maxOff >= 0 ? maxOff : 0).toString(16).toUpperCase().padStart(4, '0') + ']';
                return `offset ${badHex} outside valid range [0x0000..${maxHex.slice(1)}`;
            }
        );
        // Annotate clist[N] references with the resolved pet name when available
        if (_faultCListPetName != null && _faultCListSlot != null) {
            s = s.replace(
                new RegExp(`clist\\[${_faultCListSlot}\\]`, 'g'),
                `clist[${_faultCListSlot}]\u00a0<span class="fault-clist-petname">(${_faultCListPetName})</span>`
            );
        }
        return s;
    }

    // ── Click-to-edit: resolve physicalPC → source line number ───────────────
    // ns.offset is the word offset from the lump base (including header word at 0).
    // lineNums[instrIdx] (instrIdx = ns.offset - 1) gives the source editor line.
    const _editLineNum = (() => {
        if (!ns || ns.offset === undefined || ns.offset < 1 || !assembler) return null;
        const instrIdx = ns.offset - 1;
        const lns = assembler.getLastLineNums ? assembler.getLastLineNums() : [];
        const ln = lns[instrIdx];
        return (typeof ln === 'number' && ln > 0) ? ln : null;
    })();

    // ── Find the faulting trace entry (used by scope section below) ───────────
    const _faultTraceEntry = (f.instrHistory || []).find(h => h.step === f.faultStep)
                          || ((f.instrHistory || []).length > 0 ? f.instrHistory[f.instrHistory.length - 1] : null);

    // ── Scope callout for BOUNDS / range faults ────────────────────────────
    // When a DREAD/DWRITE range check fails, sim.auditLog has a checks.range entry.
    // Surface it here so the user can see exactly which offset exceeded which limit.
    let scopeSection = '';
    let _scopeBadOffsetStr = null; // shared with trace renderer to highlight same token
    if (f.type === 'BOUNDS' || f.type === 'RANGE') {
        const auditEntries = sim.auditLog || [];
        const lastEntry = auditEntries.length > 0 ? auditEntries[auditEntries.length - 1] : null;
        if (lastEntry && lastEntry.checks && lastEntry.checks.range && !lastEntry.checks.range.pass) {
            const rc = lastEntry.checks.range;
            if (rc.address !== undefined) {
                // Derive offset and capacity from absolute address + range
                const badOffset  = rc.address - rc.base;
                const maxOffset  = rc.limit  - rc.base;
                const badOffHex  = '[0x' + badOffset.toString(16).toUpperCase().padStart(4, '0') + ']';
                const maxOffHex  = '[0x' + maxOffset.toString(16).toUpperCase().padStart(4, '0') + ']';
                const entryCount = maxOffset + 1;
                _scopeBadOffsetStr = badOffHex;

                // Identify the source register (crSrc of the faulting instruction)
                let crSrcLabel = '';
                if (_faultTraceEntry) {
                    const crSrcNum = (_faultTraceEntry.raw >>> 15) & 0xF;
                    const pet = _petCR[crSrcNum];
                    crSrcLabel = pet
                        ? `<span class="itrace-pet" title="CR${crSrcNum}">${pet}</span>`
                        : `CR${crSrcNum}`;
                }

                scopeSection = `
        <div class="fault-scope-section">
            <div class="fault-scope-label">&#x26A0; Scope violation</div>
            <div class="fault-scope-detail">
                Offset <code class="fault-offset-bad">${badOffHex}</code> is out of range${crSrcLabel ? ` &mdash; ${crSrcLabel} has <code>${entryCount}</code> ${entryCount === 1 ? 'entry' : 'entries'}` : ''}.
                Valid indices: <code>&#x5B;0x0000..${maxOffHex.slice(1)}</code>.
            </div>
        </div>`;
            } else {
                const offHex = '[0x' + (rc.offset !== undefined ? rc.offset.toString(16).toUpperCase().padStart(4, '0') : '????') + ']';
                const limHex = '[0x' + (rc.limit  !== undefined ? rc.limit .toString(16).toUpperCase().padStart(4, '0') : '????') + ']';
                _scopeBadOffsetStr = offHex;
                scopeSection = `
        <div class="fault-scope-section">
            <div class="fault-scope-label">&#x26A0; Scope violation</div>
            <div class="fault-scope-detail">
                Offset <code class="fault-offset-bad">${offHex}</code> exceeds NS limit &mdash;
                valid range is <code>[0x0000..${limHex.slice(1)}</code>.
            </div>
        </div>`;
            }
        }
    }

    // ── Malformed GT callout (any fault carrying a malformedReason) ──────────
    let malformedGTSection = '';
    if (f.malformedReason) {
        malformedGTSection = `
        <div class="fault-scope-section fault-malformed-gt-section">
            <div class="fault-scope-label">&#x26A0; Malformed Golden Token</div>
            <div class="fault-detail-row fault-malformed-reason-row">
                <span class="fault-detail-label fault-malformed-reason-label">Malformed GT reason:</span>
                <span class="fault-detail-value fault-malformed-reason-value"><code class="fault-malformed-reason-code">${f.malformedReason}</code></span>
            </div>
            <div class="fault-scope-detail">
                The GT in the C-List was rejected before mLoad ran.
                Hand-crafted or STORE-written GTs must satisfy both
                domain-purity (no mixing of Turing {R,W,X} and Church {L,S,E} bits)
                and single-permission rules.
            </div>
        </div>`;
    }

    // ── General fault description callout ────────────────────────────────────
    let descSection = '';
    {
        const descText = _FAULT_DESCRIPTIONS[f.type];
        if (descText) {
            const color2 = _FAULT_COLORS[f.type] || '#e05555';
            descSection = `
        <div class="fault-desc-section" style="border-left-color:${color2}">
            <div class="fault-desc-label" style="color:${color2}">&#x2139; ${f.type}</div>
            <div class="fault-desc-detail">${descText}</div>
        </div>`;
        }
    }

    // ── Firmware download / lump integrity failure callout ────────────────────
    let outformSection = '';
    let isOutformFault = false;
    {
        const outformKey = _OUTFORM_DESCRIPTIONS[f.type]
            ? f.type
            : (_LUMP_TO_OUTFORM[f.type] || null);
        if (outformKey) {
            isOutformFault = true;
            const desc = _OUTFORM_DESCRIPTIONS[outformKey];
            const isLumpFault = f.type.startsWith('LUMP_');
            const sectionLabel = isLumpFault ? '&#x26A0; Lump Integrity Failure' : '&#x26A0; Firmware Download Failure';
            outformSection = `
        <div class="fault-scope-section">
            <div class="fault-scope-label">${sectionLabel}</div>
            <div class="fault-scope-detail">${desc}</div>
        </div>`;
        }
    }

    // ── Three-tier fault recovery display (Task #1077) ────────────────────────
    let recoverySection = '';
    {
        const hasTier = f.tier != null;
        const hasStructured = f.faultCode != null || f.faultingMnemonic != null ||
            f.pipelineStage != null || f.involvedGT != null ||
            f.faultingAbstractionSlot != null;

        if (hasTier || hasStructured) {
            const tierLabel = f.tier === 1 ? 'Tier 1 (.catch recovered)'
                : f.tier === 2 ? 'Tier 2 (Scheduler.IRQ recovered)'
                : f.tier === 3 ? 'Tier 3 (double-fault \u2014 PP250 recovery)'
                : 'Unhandled (halted)';
            const tierColor = f.tier === 1 ? '#4caf50'
                : f.tier === 2 ? '#ff9800'
                : f.tier === 3 ? '#e91e63'
                : '#e05555';
            const faultCodeStr = f.faultCode != null
                ? `0x${(f.faultCode >>> 0).toString(16).toUpperCase().padStart(2, '0')}`
                : '\u2014';
            const mnemonicStr = f.faultingMnemonic || '\u2014';
            const pipelineStr = f.pipelineStage || '\u2014';
            const gtStr = f.involvedGT != null
                ? `0x${(f.involvedGT >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
                : '\u2014';
            const absStr = f.faultingAbstractionSlot != null
                ? `NS[${f.faultingAbstractionSlot}] ${f.faultingAbstractionLabel || ''}`
                : '\u2014';

            const rows = [
                hasTier ? `<div class="fault-detail-row">
                    <span class="fault-detail-label">Recovery</span>
                    <span class="fault-detail-value"><span style="color:${tierColor};font-weight:600">${tierLabel}</span></span>
                </div>` : '',
                hasTier && f.catchInvoked ? `<div class="fault-detail-row">
                    <span class="fault-detail-label">.catch</span>
                    <span class="fault-detail-value"><code>invoked on ${absStr}</code></span>
                </div>` : '',
                hasTier && f.irqInvoked ? `<div class="fault-detail-row">
                    <span class="fault-detail-label">IRQ</span>
                    <span class="fault-detail-value"><code>Scheduler.IRQ dispatched</code></span>
                </div>` : '',
                hasTier && f.tier3Recovery ? `<div class="fault-detail-row">
                    <span class="fault-detail-label">Tier 3</span>
                    <span class="fault-detail-value"><code>CHANGE to CR13 (PP250)</code></span>
                </div>` : '',
                f.faultCode != null ? `<div class="fault-detail-row">
                    <span class="fault-detail-label">HW Code</span>
                    <span class="fault-detail-value"><code>${faultCodeStr}</code></span>
                </div>` : '',
                f.faultingMnemonic ? `<div class="fault-detail-row">
                    <span class="fault-detail-label">Mnemonic</span>
                    <span class="fault-detail-value"><code>${mnemonicStr}</code></span>
                </div>` : '',
                f.pipelineStage ? `<div class="fault-detail-row">
                    <span class="fault-detail-label">Pipeline</span>
                    <span class="fault-detail-value"><code>${pipelineStr}</code></span>
                </div>` : '',
                f.involvedGT != null ? `<div class="fault-detail-row">
                    <span class="fault-detail-label">GT</span>
                    <span class="fault-detail-value"><code>${gtStr}</code></span>
                </div>` : '',
            ].filter(Boolean).join('\n');

            if (rows) {
                recoverySection = `
        <div class="fault-scope-section fault-recovery-section">
            <div class="fault-scope-label" style="color:${tierColor}">&#x26A1; Fault Recovery</div>
            <div class="fault-detail-grid">${rows}</div>
        </div>`;
            }
        }
    }

    const instrTrace = f.instrHistory || [];
    let traceTableHtml = '';
    if (instrTrace.length > 0) {
        let traceRows = '';
        for (const h of instrTrace) {
            const addr = '0x' + (h.physicalPC >>> 0).toString(16).toUpperCase().padStart(4, '0');
            const rawHex = '0x' + (h.raw >>> 0).toString(16).toUpperCase().padStart(8, '0');
            const rawDisasm = assembler ? assembler.disassemble(h.raw) : `${h.opName} CR${h.crDst}, CR${h.crSrc}, ${h.imm}`;
            const isFault = (f.faultStep != null && h.step === f.faultStep);
            const instrHtml = _petDisasm(rawDisasm, isFault ? _scopeBadOffsetStr : null);
            let clistAnnotation = '';
            {
                const _op = (h.raw >>> 27) & 0x1F;
                const _isLoadOrCall = (_op === 0 || _op === 2);
                if (_isLoadOrCall && h.crSrc === 6 && sim.cr && sim.cr[6]) {
                    const _slotIdx = h.imm;
                    const _clistBase = sim.cr[6].word1 >>> 0;
                    const _slotAddr = _clistBase + _slotIdx;
                    if (sim.memory && _slotAddr < sim.memory.length) {
                        const _slotGT = sim.memory[_slotAddr] >>> 0;
                        const _name = (typeof _resolveCListPetName === 'function') ? _resolveCListPetName(_slotGT) : null;
                        if (_name) {
                            clistAnnotation = ` <span class="fault-clist-petname">${_name}</span>`;
                        }
                    }
                }
            }
            const rowOnclick = isFault
                ? (_editLineNum
                    ? ` onclick="faultModalOpenEditor(${_editLineNum})" title="Click to open editor at line ${_editLineNum}" style="cursor:pointer"`
                    : (nsIdxForViewLump != null
                        ? ` onclick="faultModalOpenBinaryLump(${nsIdxForViewLump})" title="Click to open lump in code view" style="cursor:pointer"`
                        : ''))
                : '';
            const cls = isFault ? ' class="itrace-fault"' : '';
            traceRows += `<tr${cls}${rowOnclick}><td class="itrace-step">${h.step}</td><td class="itrace-addr">${addr}</td><td class="itrace-raw">${rawHex}</td><td class="itrace-instr">${instrHtml}${clistAnnotation}</td></tr>`;
        }
        traceTableHtml = `
                <div class="fault-trace-scroll">
                    <table class="fault-trace-table">
                        <thead><tr><th>Step</th><th>Address</th><th>Raw</th><th>Instruction</th></tr></thead>
                        <tbody>${traceRows}</tbody>
                    </table>
                </div>
                <div class="fault-trace-legend">${_rightsLegendHTML()}</div>`;
    }
    const _traceFaultDetailsHtml = `
                <div class="fault-detail-grid fault-trace-fault-details">
                    <div class="fault-detail-row">
                        <span class="fault-detail-label">Code</span>
                        <span class="fault-detail-value"><code class="fault-code-val">${codeStr}</code></span>
                    </div>
                    <div class="fault-detail-row">
                        <span class="fault-detail-label">PC</span>
                        <span class="fault-detail-value"><code>${pcHex}</code></span>
                    </div>
                    <div class="fault-detail-row fault-instr-row"
                         ${_editLineNum
                            ? `onclick="faultModalOpenEditor(${_editLineNum})" title="Click to open editor at line ${_editLineNum}"`
                            : (nsIdxForViewLump != null
                                ? `onclick="faultModalOpenBinaryLump(${nsIdxForViewLump})" title="Click to open lump in code view"`
                                : `onclick="faultModalOpenEditor(null)" title="Click to open editor"`)}
                         style="cursor:pointer">
                        <span class="fault-detail-label">Instruction</span>
                        <span class="fault-detail-value">
                            <code class="fault-instr-code">${_petDisasm(disasm, _scopeBadOffsetStr)}</code>
                            <span class="fault-instr-edit-hint">&#x270E;${_editLineNum ? `&nbsp;line&nbsp;${_editLineNum}` : (nsIdxForViewLump != null ? '&nbsp;view lump' : '&nbsp;edit')}</span>
                        </span>
                    </div>
                    ${_faultCListPetName != null ? `<div class="fault-detail-row">
                        <span class="fault-detail-label">C-List</span>
                        <span class="fault-detail-value"><code>clist[${_faultCListSlot}]</code> <span class="fault-clist-petname">${_faultCListPetName}</span>${_faultCListPermsHTML}</span>
                    </div>` : ''}
                    <div class="fault-detail-row">
                        <span class="fault-detail-label">Location</span>
                        <span class="fault-detail-value">${nsStr}</span>
                    </div>
                    <div class="fault-detail-row">
                        <span class="fault-detail-label">Step</span>
                        <span class="fault-detail-value"><button class="gate-loc-step-link fault-step-link" onclick="faultModalDismiss();jumpToTraceStep(${f.step},'${(f.type||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")}');" title="Jump to this step in the Trace view">#${f.step}</button></span>
                    </div>
                </div>`;
    const instrTraceSection = `
        <div class="fault-trace-section fault-trace-collapsible">
            <div class="fault-trace-toggle" onclick="this.closest('.fault-trace-collapsible').classList.toggle('fault-trace-open')" title="Click to expand/collapse trace">
                <span class="fault-trace-toggle-arrow">&#x25B6;</span>
                <span class="fault-trace-toggle-label">TRACE</span>
                ${instrTrace.length > 0 ? `<span class="fault-trace-toggle-count">(last ${instrTrace.length} instruction${instrTrace.length !== 1 ? 's' : ''})</span>` : ''}
            </div>
            <div class="fault-trace-body">
                ${_traceFaultDetailsHtml}
                ${traceTableHtml}
            </div>
        </div>`;

    const overlay = document.createElement('div');
    overlay.id = 'faultModalOverlay';
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog fault-dialog';
    const _editOnclick = _editLineNum
        ? `onclick="faultModalOpenEditor(${_editLineNum})" title="Click to open editor at line ${_editLineNum}"`
        : (nsIdxForViewLump != null
            ? `onclick="faultModalOpenBinaryLump(${nsIdxForViewLump})" title="Click to open lump in code view"`
            : '');
    const _editBadge = _editLineNum
        ? `<span class="fault-edit-hint">&#x270E; line&nbsp;${_editLineNum}</span>`
        : (nsIdxForViewLump != null ? `<span class="fault-edit-hint">&#x270E; view lump</span>` : '');
    const _msgClass = (_editLineNum || nsIdxForViewLump != null) ? 'fault-modal-message fault-msg-editable' : 'fault-modal-message';
    dialog.innerHTML = `
        <div class="fault-modal-header">
            <span class="fault-type-badge" style="background:${color}22;border-color:${color};color:${color}">${f.type}</span>
            <span class="fault-modal-title">Machine Fault</span>
            ${locationNs && locationNs.label ? (nsIdxForViewLump != null
                ? `<button class="fault-modal-lump-chip fault-modal-lump-chip-link" onclick="faultModalOpenBinaryLump(${nsIdxForViewLump})" title="Click to open lump in code view">${locationNs.label.replace(/</g,'&lt;').replace(/>/g,'&gt;')}<span class="fault-modal-lump-offset">+${locationNs.offset}</span></button>`
                : `<span class="fault-modal-lump-chip">${locationNs.label.replace(/</g,'&lt;').replace(/>/g,'&gt;')}<span class="fault-modal-lump-offset">+${locationNs.offset}</span></span>`) : ''}
            <button class="fault-modal-close" onclick="faultModalDismiss()" title="Close">&times;</button>
        </div>
        <div class="modal-buttons fault-modal-actions">
            <button class="btn btn-danger" onclick="faultModalReboot()">&#x21BA; Reboot</button>
            <button class="btn btn-warning" onclick="faultModalInvestigate()">&#x1F50D; Investigate</button>
            ${isOutformFault ? '<button class="btn btn-primary" onclick="faultModalRetryDownload()">&#x21BB; Retry Download</button>' : ''}
            <button class="btn btn-primary" onclick="faultModalEditCode()" title="Open the assembly editor to inspect and correct the faulting code">&#x270E; Edit Code</button>
            <button class="btn btn-muted" onclick="faultModalClearAndDismiss()" title="Clear fault state — stops the flashing alert">&#x2715; Clear</button>
        </div>
        <div class="${_msgClass}" ${_editOnclick}>${_transformFaultMsg(f.message)}${_editBadge}</div>
        ${descSection}
        <div class="fault-user-note-row">
            <label class="fault-user-note-label" for="faultUserNoteInput">Note</label>
            <input id="faultUserNoteInput" class="fault-user-note-input" type="text" maxlength="300"
                placeholder="Add a plain-English description of this fault\u2026"
                value="${(f.userNote || '').replace(/"/g, '&quot;')}"
                oninput="(function(v){var fl=sim.faultLog;if(fl&&fl.length>0){fl[fl.length-1].userNote=v;if(typeof _saveFaultNote==='function')_saveFaultNote(fl[fl.length-1],v);}if(typeof updateGateLog==='function')updateGateLog();})(this.value)">
        </div>
        ${historyHtml ? `<div class="fault-detail-grid">
            <div class="fault-detail-row fault-history-row">
                <span class="fault-detail-label">History</span>
                <span class="fault-detail-value">${historyHtml}</span>
            </div>
        </div>` : ''}
        ${malformedGTSection}
        ${scopeSection}
        ${outformSection}
        ${recoverySection}
        ${instrTraceSection}
        ${crSection}
        ${drSection}`;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) faultModalDismiss(); });
}

function faultModalDismiss() {
    const el = document.getElementById('faultModalOverlay');
    if (el) el.remove();
}

function faultModalToggleTrace(btn) {
    const overlay = document.getElementById('faultModalOverlay');
    if (!overlay) return;
    const section = overlay.querySelector('.fault-trace-collapsible');
    if (!section) return;
    const isOpen = section.classList.toggle('fault-trace-open');
    if (btn) {
        btn.innerHTML = (isOpen ? '&#x25BC; Trace' : '&#x25B6; Trace');
        btn.classList.toggle('fault-trace-btn-active', isOpen);
    }
    if (isOpen) section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function faultModalOpenEditor(lineNum) {
    faultModalDismiss();
    switchView('editor');
    if (lineNum) _jumpToAsmLine(lineNum);
}

function faultModalOpenBinaryLump(nsIdx) {
    faultModalDismiss();
    // Prefer opening the lump directly in the editor (CREATE view).
    if (typeof _lumpsCache !== 'undefined' && _lumpsCache) {
        var lump = null;
        for (var li = 0; li < _lumpsCache.length; li++) {
            var ns = parseInt(_lumpsCache[li].ns_slot);
            if (!isNaN(ns) && ns === nsIdx) { lump = _lumpsCache[li]; break; }
        }
        if (lump && lump.token && typeof openLumpInEditor === 'function') {
            openLumpInEditor(lump.token);
            return;
        }
    }
    // Fallback: open namespace view scrolled to the relevant slot.
    switchView('namespace');
    if (typeof nsExpandedSlot !== 'undefined' && typeof updateNamespace === 'function') {
        nsExpandedSlot = nsIdx;
        updateNamespace();
        setTimeout(function() {
            var row = document.getElementById('ns-row-' + nsIdx);
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
    }
}

function faultModalEditCode(crIdx) {
    faultModalDismiss();
    switchView('editor');
}

function faultModalReboot() {
    faultModalDismiss();
    _lastFault = null;
    faultAlertOff();
    if (sim && sim.faultLog) sim.faultLog = [];
    try { localStorage.removeItem(_FAULT_LOG_LS_KEY); } catch(e) {}
    if (pipelineViz) pipelineViz.setNIA(null);
    _defaultProgramLoaded = false;
    _bootAuditAccum = [];
    sim.reset();
    _initLazyLoadManifest();
    pipelineViz.reset();
    if (_bootAnimTimer !== null) { clearTimeout(_bootAnimTimer); _bootAnimTimer = null; }
    bootAnimating = false;
    const con = document.getElementById('editorConsole');
    if (con) con.textContent = '';
    slowBoot();
}

function faultModalInvestigate() {
    faultModalDismiss();
    switchView('dashboard');
    switchDashTab('gatelog');
}

function faultModalClearAndDismiss() {
    faultModalDismiss();
    _lastFault = null;
    faultAlertOff();
    _clearAllFaultNotes();
    if (sim && sim.faultLog) sim.faultLog = [];
    if (typeof updateGateLog === 'function') updateGateLog();
}

function faultModalRetryDownload() {
    faultModalDismiss();
    // Prefer the live awaitingLump; fall back to the snapshot taken when the modal opened.
    const al = (sim.awaitingLump && sim.awaitingLump.token != null) ? sim.awaitingLump : _lastRetryLump;
    if (!al || al.token == null) {
        const con = document.getElementById('editorConsole');
        if (con) { con.textContent += '\n⊿ Retry Download: no pending lump token available.'; con.scrollTop = con.scrollHeight; }
        console.warn('[faultModalRetryDownload] no awaitingLump token');
        return;
    }
    const con = document.getElementById('editorConsole');
    if (con) { con.textContent += `\n⟳ Retrying download for token=0x${al.token.toString(16)}...`; con.scrollTop = con.scrollHeight; }
    console.log('[faultModalRetryDownload] retrying token=0x' + al.token.toString(16));
    triggerLazyLoad({ token: al.token, nsIndex: al.nsIndex, label: sim.nsLabels[al.nsIndex] || 'entry_' + al.nsIndex });
}

// ── Lazy-load lump fetch ──────────────────────────────────────────────────────
// ── Pending Capabilities panel (Task #1519 — NULL GT Lazy-Resolve) ────────────
//
// Tracks NULL-GT slots that suspended the thread.  The IDE renders a small
// collapsible panel so the user can link each pet name to a live NS entry.

const _lazyResolvePending = new Map();   // slotIdx → { petName, slot, instrName, ts }
const _LAZY_RESOLVE_TIMEOUT_KEY = 'church_lazy_resolve_timeout_ms';

function _getLazyResolveTimeoutMs() {
    try {
        const v = parseInt(localStorage.getItem(_LAZY_RESOLVE_TIMEOUT_KEY), 10);
        return isNaN(v) ? 30 * 24 * 3600 * 1000 : v;   // default: 30 days
    } catch(e) { return 30 * 24 * 3600 * 1000; }
}

function _registerLazyResolvePending(info) {
    if (!info) return;
    const slotIdx  = info.slot !== undefined ? info.slot : -1;
    const petName  = info.petName || '?';
    const instrName = info.instrName || 'LOAD';
    if (!_lazyResolvePending.has(slotIdx)) {
        _lazyResolvePending.set(slotIdx, {
            petName, slot: slotIdx, instrName, ts: Date.now()
        });
    }
    _renderPendingCapPanel();

    // Schedule deadline escalation.
    const deadline = _getLazyResolveTimeoutMs();
    if (deadline < Infinity && deadline > 0) {
        setTimeout(() => {
            if (_lazyResolvePending.has(slotIdx) && sim && sim._lazySuspended) {
                console.warn(`[LazyResolve] Deadline expired for slot ${slotIdx} ('${petName}') — escalating to NULL_CAP fault.`);
                if (typeof sim.escalateLazyResolve === 'function') {
                    sim.escalateLazyResolve(slotIdx);
                }
                _lazyResolvePending.delete(slotIdx);
                _renderPendingCapPanel();
                updateDashboard();
            }
        }, deadline);
    }
}

function _renderPendingCapPanel() {
    const area = document.getElementById('editorConsole');
    if (!area) return;
    const PANEL_ID = 'lazyResolvePendingPanel';
    let panel = document.getElementById(PANEL_ID);
    if (_lazyResolvePending.size === 0) {
        if (panel) panel.remove();
        return;
    }
    if (!panel) {
        panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = 'margin-top:8px;padding:8px 10px;background:#2a1a00;border:1px solid #c8960c;border-radius:4px;font-family:monospace;font-size:12px;color:#f5d87a;';
        panel.innerHTML = '<b>⏸ Pending Capabilities</b> <small style="color:#aaa">(thread suspended)</small>';
        const list = document.createElement('ul');
        list.id = PANEL_ID + '_list';
        list.style.cssText = 'margin:6px 0 0 0;padding:0 0 0 16px;';
        panel.appendChild(list);
        area.parentNode && area.parentNode.insertBefore(panel, area.nextSibling);
    }
    const list = document.getElementById(PANEL_ID + '_list');
    if (!list) return;
    list.innerHTML = '';
    for (const [slotIdx, entry] of _lazyResolvePending) {
        const li = document.createElement('li');
        li.style.cssText = 'margin:3px 0;';
        li.textContent = `Slot ${slotIdx}: '${entry.petName}' (${entry.instrName}) — waiting for NS link`;
        list.appendChild(li);
    }
}

// ── End Pending Capabilities panel ─────────────────────────────────────────────

// Called when the simulator returns { absent: true } from step() or stops a
// run() batch with sim.awaitingLump set.  Fetches the lump from the IDE server,
// validates the magic, writes it into simulator memory via sim.receiveLump(),
// and resumes execution from the retry PC.
async function triggerLazyLoad(absentResult, mode) {
    const token = absentResult.token;
    const label = absentResult.label || ('Slot ' + absentResult.nsIndex);
    const con   = document.getElementById('editorConsole');
    function log(msg) {
        if (con) { con.textContent += '\n' + msg; con.scrollTop = con.scrollHeight; }
        console.log('[lazyLoad]', msg);
    }

    // ── 1. Fetch the lump binary from /api/lump/<token> ─────────────────────
    let words, source;
    try {
        const resp = await fetch(`/api/lump/${token}`);
        source = resp.headers.get('X-Lump-Source') || 'local';
        if (!resp.ok) {
            let errText = '';
            try { const j = await resp.json(); errText = j.error || ''; } catch(_) {}
            log(`⊿ Lazy load failed (HTTP ${resp.status}) for 0x${token}: ${errText}`);
            updateDashboard(); switchView('editor'); switchCodeTab('console');
            return;
        }
        const buf = await resp.arrayBuffer();
        words = [];
        const view = new DataView(buf);
        for (let i = 0; i < Math.floor(buf.byteLength / 4); i++) {
            words.push(view.getUint32(i * 4, false));  // big-endian
        }
    } catch (e) {
        log(`⊿ Lazy load fetch error: ${e.message}`);
        console.error('[lazyLoad] fetch error:', e);
        updateDashboard(); switchView('editor'); switchCodeTab('console');
        return;
    }

    // ── 2. Install into simulator ────────────────────────────────────────────
    const installResult = sim.receiveLump(words);
    if (!installResult.ok) {
        // Check if there is a new OUTFORM_* or LUMP_* fault to surface a descriptive message.
        const installFault = sim.faultLog && sim.faultLog.length
            ? sim.faultLog[sim.faultLog.length - 1]
            : null;
        const outformKey = installFault
            ? (_OUTFORM_DESCRIPTIONS[installFault.type]
                ? installFault.type
                : (_LUMP_TO_OUTFORM[installFault.type] || null))
            : null;
        if (outformKey) {
            const desc = _OUTFORM_DESCRIPTIONS[outformKey];
            log(`\u26a0 Firmware download failed [${outformKey}]: ${desc}`);
        } else {
            log(`\u22bf Install failed: ${installResult.message}`);
        }
        updateDashboard(); switchView('editor'); switchCodeTab('console');
        return;
    }
    const srcLabel = source.startsWith('library:')
        ? `Mum Tunnel Library — ${source.slice(8)}`
        : 'local cache';
    log(`✓ Installed: ${label} — ${installResult.lumpSize} words @ 0x${installResult.freeBase.toString(16).toUpperCase()} [${srcLabel}]`);

    // ── 3. Auto-retry the LOAD (PC was reset to retryPC by receiveLump) ──────
    const faultsBefore = sim.faultLog ? sim.faultLog.length : 0;
    let retryResult;
    try {
        retryResult = sim.step();
    } catch (e) {
        log(`⊿ Retry step threw: ${e.message}`);
        updateDashboard(); switchView('dashboard'); openCRDetail(14);
        return;
    }

    if (retryResult && retryResult.absent) {
        // Nested absent — recurse (another Outform in the same chain)
        log(`⟳ Retry hit another absent: Slot ${retryResult.nsIndex} (${retryResult.label})`);
        updateDashboard(); switchView('dashboard'); openCRDetail(14);
        triggerLazyLoad(retryResult);
        return;
    }
    if (!retryResult || (sim.faultLog && sim.faultLog.length > faultsBefore)) {
        const fault = sim.faultLog && sim.faultLog.length
            ? sim.faultLog[sim.faultLog.length - 1]
            : null;
        if (fault) {
            const retryOutformKey = _OUTFORM_DESCRIPTIONS[fault.type]
                ? fault.type
                : (_LUMP_TO_OUTFORM[fault.type] || null);
            if (retryOutformKey) {
                const desc = _OUTFORM_DESCRIPTIONS[retryOutformKey];
                log(`\u26a0 Firmware download failed [${retryOutformKey}]: ${desc}`);
            } else {
                log(`\u22bf Retry LOAD faulted: ${fault.type} \u2014 ${fault.message}`);
            }
        } else {
            log(`\u22bf Retry LOAD faulted: unknown fault`);
        }
        updateDashboard(); switchView('editor'); switchCodeTab('console');
        return;
    }
    if (retryResult.desc && retryResult.desc.startsWith('HALT')) {
        const cr3ok = sim.cr[3] && sim.cr[3].word0 !== 0;
        if (!cr3ok) {
            log(`⊿ FAIL — HALT reached but CR3.word0 is null (LOAD did not populate CR3)`);
        } else {
            log(`✓ CR3.word0=0x${sim.cr[3].word0.toString(16).padStart(8,'0')} — capability installed`);
            log(`✓ PASS — HALT after retry (1 step).`);
        }
        updateDashboard(); switchView('editor'); switchCodeTab('console');
        return;
    }
    if (mode === 'step') {
        log(`↪ Retry LOAD succeeded — stepped.`);
        updateDashboard(); switchView('dashboard'); openCRDetail(14);
        return;
    }

    log(`↪ Retry LOAD succeeded — continuing…`);

    // ── 4. Run to HALT / breakpoint (up to 10 000 steps) ────────────────────
    const breakpoints = simBreakpoints.size > 0 ? simBreakpoints : null;
    const faultsMid = sim.faultLog ? sim.faultLog.length : 0;
    const runResult = sim.run(10000, breakpoints);

    if (sim.awaitingLump) {
        log(`⟳ Another absent lump — Slot ${sim.awaitingLump.nsIndex}`);
        triggerLazyLoad({
            token: sim.awaitingLump.token,
            nsIndex: sim.awaitingLump.nsIndex,
            label: sim.nsLabels[sim.awaitingLump.nsIndex] || 'entry_' + sim.awaitingLump.nsIndex
        });
        return;
    }

    // ── 5. Report final outcome ──────────────────────────────────────────────
    const newFaults = sim.faultLog ? sim.faultLog.length - faultsMid : 0;
    if (runResult.stopReason === 'breakpoint' && runResult.breakpointAddr != null) {
        log(`[BP] Breakpoint at 0x${runResult.breakpointAddr.toString(16).toUpperCase().padStart(4,'0')} after ${runResult.steps} step(s) post-retry.`);
    } else if (sim.halted && newFaults === 0) {
        const cr3ok = sim.cr[3] && sim.cr[3].word0 !== 0;
        if (!cr3ok) {
            log(`⊿ FAIL — HALT reached but CR3.word0 is null (capability not installed)`);
        } else {
            log(`✓ CR3.word0=0x${sim.cr[3].word0.toString(16).padStart(8,'0')} — capability installed`);
            log(`✓ PASS — reached HALT after ${runResult.steps + 1} step(s) post-retry.`);
        }
    } else if (newFaults > 0) {
        const f = sim.faultLog[sim.faultLog.length - 1];
        log(`⊿ FAIL — fault after retry: ${f ? f.type + ' @ PC=' + f.pc : 'unknown'}`);
    } else {
        log(`? Stopped after ${runResult.steps} steps (no HALT, no fault).`);
    }
    updateDashboard();
    switchView('editor');
    switchCodeTab('console');
}

// Lazy-load end-to-end test.
// Program: LOAD CR3, CR6, 3  →  HALT
//   - Targets NS slot 3 (Math.Add, Outform gtType=2) via Boot.Abstr c-list slot 3.
//   - First step suspends (absent-lump intercept) → triggerLazyLoad() fires.
//   - Server returns Math.Add binary lump; receiveLump() promotes slot 3 to Inform.
//   - Auto-retry LOAD succeeds; CR3 ← Math.Add GT; then HALT.
// Expected console output:
//   ⟳ Absent lump — fetching Slot 3 (Math.Add)
//   ✓ Installed: Math.Add — 64 words @ 0x<addr> [local cache]
//   ✓ PASS — reached HALT after 2 step(s) post-retry.
function runLazyLoadTest() {
    // Switch to the editor/console view FIRST so the user can watch the log live.
    switchView('editor');
    switchCodeTab('console');

    const con = document.getElementById('editorConsole');
    function log(msg) {
        if (con) { con.textContent += '\n' + msg; con.scrollTop = con.scrollHeight; }
    }

    // 1. Finish boot if needed.
    while (!sim.bootComplete && !sim.halted) {
        try { sim._bootStep(); } catch(e) { break; }
    }
    if (!sim.bootComplete) {
        log('[LazyTest] ⊿ Boot failed — cannot run test.');
        return;
    }

    // 2. Clear any previous suspension.
    sim.awaitingLump = null;

    // 3. Inject the test program into Boot.Abstr's code region.
    //    LOAD CR3, CR6, 3 = (opcode=0, cond=14=AL, crDst=3, crSrc=6, imm=3)
    //    Encoding: (14<<23)|(3<<19)|(6<<15)|3 = 0x071B0003
    const LOAD_CR3_CR6_3 = (14 << 23) | (3 << 19) | (6 << 15) | 3;   // 0x071B0003
    sim.loadProgram([LOAD_CR3_CR6_3, 0x00000000 /*HALT*/], 0);
    if (typeof _syncBootEntryFromSim === 'function') _syncBootEntryFromSim();
    // loadProgram resets: pc=0, halted=false, callStack=[], stepCount=0

    log('[LazyTest] ──────────────────────────────────────────────────');
    log('[LazyTest] Program: LOAD CR3,CR6,3 → HALT');
    log('[LazyTest] Slot 3 is Outform (Math.Add, absent). Stepping…');

    // 4. Show test source in editor.
    const ed = document.getElementById('codeEditor');
    if (ed) ed.value = '; Lazy-load test — absent Math.Add (Outform token=0xDEAD0003)\nLOAD CR3, CR6, 3   ; triggers fetch if absent\nHALT               ; machine stops after retry succeeds\n';

    // 5. Run first step — should trigger the absent-lump intercept.
    //    Call sim.step() directly and invoke triggerLazyLoad in 'run' mode
    //    so it auto-runs to HALT after the retry (stepSim uses 'step' mode).
    const result = sim.step();
    if (result && result.absent) {
        log(`[LazyTest] ⟳ Absent lump — fetching Slot ${result.nsIndex} (${result.label}) token=0x${result.token}`);
        updateDashboard();
        triggerLazyLoad(result, 'run');
    } else {
        log('[LazyTest] ⊿ Expected absent-lump intercept, but step returned: ' + JSON.stringify(result));
        updateDashboard();
    }
}
// ─────────────────────────────────────────────────────────────────────────────

function resetSim() {
    // Skip dashboard redirect when a startup default view is pending —
    // slowBoot() will navigate there after boot completes.
    // Search: _startupDefaultView
    if (!window._startupDefaultView) switchView('dashboard');
    _lastFault = null;
    faultAlertOff();
    if (sim && sim.faultLog) sim.faultLog = [];
    try { localStorage.removeItem(_FAULT_LOG_LS_KEY); } catch(e) {}
    if (pipelineViz) pipelineViz.setNIA(null);
    // Do NOT clear _defaultProgramLoaded — _autoLoadDefaultProgram() will
    // reload the user's compiled program after boot completes so the PC
    // returns to the correct start instruction automatically.
    _bootAuditAccum = [];
    _clearLumpPetNames();
    sim.reset();
    _initLazyLoadManifest();
    pipelineViz.reset();
    if (_bootAnimTimer !== null) { clearTimeout(_bootAnimTimer); _bootAnimTimer = null; }
    bootAnimating = false;
    const con = document.getElementById('editorConsole');
    if (con) con.textContent = '';
    slowBoot();
}

// Fast-reset, complete the boot sequence immediately, then land on the
// CR14 step view.  Bound to the "↺ Reset & Step" button in the Gate Log panel.
function resetAndStep() {
    _lastFault = null;
    faultAlertOff();
    if (sim && sim.faultLog) sim.faultLog = [];
    try { localStorage.removeItem(_FAULT_LOG_LS_KEY); } catch(e) {}
    if (pipelineViz) pipelineViz.setNIA(null);
    // Do NOT clear _defaultProgramLoaded — see resetSim() comment.
    _bootAuditAccum = [];
    _clearLumpPetNames();
    sim.reset();
    _initLazyLoadManifest();
    pipelineViz.reset();
    if (_bootAnimTimer !== null) { clearTimeout(_bootAnimTimer); _bootAnimTimer = null; }
    bootAnimating = false;
    const con = document.getElementById('editorConsole');
    if (con) con.textContent = '';
    // Complete boot immediately (no animation) so the machine is ready to step.
    while (!sim.bootComplete && !sim.halted) {
        try { sim._bootStep(); } catch(e) {
            console.error('resetAndStep _bootStep error:', e);
            if (pipelineViz) { pipelineViz.setNIA(_bootNIARows(sim.bootStep)); pipelineViz.render(); }
            updateDashboard();
            return;
        }
    }
    if (pipelineViz) { pipelineViz.setNIA(_bootNIARows(sim.bootStep)); pipelineViz.render(); }
    if (!sim.halted) _autoLoadDefaultProgram();
    updateDashboard();
    switchView('dashboard');
    openCRDetail(14);
}

function runGC() {
    if (!sim.bootComplete) {
        showGCConsole(
            [{ heading: '=== PP250 Garbage Collection ===', lines: [
                'ERROR: Machine has not been booted.',
                '',
                'Click the Boot button (top-right) to initialize the',
                'Church Machine before running garbage collection.',
                '',
                'The boot sequence loads system abstractions into the',
                'namespace and prepares the GC subsystem.'
            ]}],
            { freedSlots: 0, freedWords: 0, liveCount: 0, report: '' },
            true
        );
        return;
    }

    sim.output += '[I/O] GC button pressed \u2014 invoking GC safe abstraction\n';
    sim.mElevation = true;
    const result = sim.runGC();
    sim.mElevation = false;
    sim.output += '[I/O] GC abstraction complete \u2014 RETURN\n';
    _lastGCResult = result;
    if (currentView === 'gc') renderToolsView();

    const lines = result.report.split('\n');
    const phases = [];
    let current = null;
    for (const line of lines) {
        if (line.startsWith('===') || line.startsWith('---')) {
            if (current) phases.push(current);
            current = { heading: line, lines: [] };
        } else if (current) {
            current.lines.push(line);
        }
    }
    if (current) phases.push(current);

    showGCConsole(phases, result, false);
}

function showGCConsole(phases, result, isError) {
    let existing = document.getElementById('gcConsoleOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'gcConsoleOverlay';
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'gc-console-dialog';

    const title = document.createElement('div');
    title.className = 'gc-console-title';
    title.textContent = 'PP250 Garbage Collection';
    dialog.appendChild(title);

    const output = document.createElement('pre');
    output.className = 'gc-console-output';
    output.id = 'gcConsoleOutput';
    dialog.appendChild(output);

    const status = document.createElement('div');
    status.className = 'gc-console-status';
    status.id = 'gcConsoleStatus';
    dialog.appendChild(status);

    const buttons = document.createElement('div');
    buttons.className = 'gc-console-buttons';

    const stepBtn = document.createElement('button');
    stepBtn.className = 'btn';
    stepBtn.textContent = 'Step';
    stepBtn.style.cssText = 'background:#9b59b6;color:#fff;border:none;font-weight:bold;';
    stepBtn.id = 'gcStepBtn';

    const runBtn = document.createElement('button');
    runBtn.className = 'btn';
    runBtn.textContent = 'Run All';
    runBtn.style.cssText = 'background:#27ae60;color:#fff;border:none;font-weight:bold;';
    runBtn.id = 'gcRunBtn';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn';
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'background:#555;color:#fff;border:none;';

    if (isError) {
        for (const phase of phases) {
            const body = phase.lines.join('\n');
            output.textContent = phase.heading + '\n' + body;
        }
        output.style.color = '#e74c3c';
        status.textContent = 'Boot the machine first, then run GC.';
        status.style.borderLeftColor = '#e74c3c';
        buttons.appendChild(closeBtn);
    } else {
        status.textContent = 'GC executed — Step through the report one phase at a time, or Run All to replay.';
        buttons.appendChild(stepBtn);
        buttons.appendChild(runBtn);
        buttons.appendChild(closeBtn);
    }
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let currentPhase = 0;
    let runTimer = null;

    function appendPhase(idx) {
        const phase = phases[idx];
        if (!phase) return;
        const heading = phase.heading;
        const body = phase.lines.filter(function(l) { return l.trim(); }).join('\n');
        output.textContent += (output.textContent ? '\n' : '') + heading + '\n' + body + '\n';
        output.scrollTop = output.scrollHeight;
    }

    function updateStatus() {
        const statusEl = document.getElementById('gcConsoleStatus');
        if (!statusEl) return;
        if (currentPhase >= phases.length) {
            statusEl.textContent = 'GC Complete — ' + result.freedSlots + ' slots freed, ' + result.freedWords + ' words reclaimed.';
            stepBtn.disabled = true;
            runBtn.disabled = true;
            stepBtn.style.opacity = '0.5';
            runBtn.style.opacity = '0.5';
        } else {
            statusEl.textContent = 'Phase ' + (currentPhase + 1) + ' of ' + phases.length + ' ready.';
        }
    }

    stepBtn.addEventListener('click', function() {
        if (currentPhase >= phases.length) return;
        appendPhase(currentPhase);
        currentPhase++;
        updateStatus();
        updateDashboard();
    });

    runBtn.addEventListener('click', function() {
        if (runTimer) return;
        runBtn.textContent = 'Running...';
        runTimer = setInterval(function() {
            if (currentPhase >= phases.length) {
                clearInterval(runTimer);
                runTimer = null;
                runBtn.textContent = 'Run All';
                updateStatus();
                updateDashboard();
                return;
            }
            appendPhase(currentPhase);
            currentPhase++;
            updateStatus();
        }, 400);
    });

    function closeConsole() {
        if (runTimer) clearInterval(runTimer);
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
        updateDashboard();
    }

    function escHandler(e) {
        if (e.key === 'Escape') closeConsole();
    }

    closeBtn.addEventListener('click', closeConsole);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeConsole();
    });

    document.addEventListener('keydown', escHandler);

    if (!isError) updateStatus();
    (isError ? closeBtn : stepBtn).focus();
}

var _ghCommunityLoaded = false;

function _ghTimeAgo(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    var now = new Date();
    var sec = Math.floor((now - d) / 1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    var day = Math.floor(hr / 24);
    if (day < 30) return day + 'd ago';
    var mon = Math.floor(day / 30);
    return mon + 'mo ago';
}

async function loadGitHubCommunity() {
    if (_ghCommunityLoaded && !arguments[0]) return;
    var refreshBtn = document.querySelector('.gh-refresh-btn');
    if (refreshBtn) refreshBtn.classList.add('spinning');

    try {
        var [communityResp, activityResp, contribResp] = await Promise.all([
            fetch('/api/github/community').then(function(r) { return r.json(); }),
            fetch('/api/github/activity').then(function(r) { return r.json(); }),
            fetch('/api/github/contributors').then(function(r) { return r.json(); })
        ]);
        _renderGhRepos(communityResp.repos || []);
        _renderGhActivity(activityResp.commits || []);
        _renderGhContributors(contribResp.contributors || []);
        _renderGhQuickLinks(communityResp.repos || []);
        _ghCommunityLoaded = true;
    } catch (e) {
        var row = document.getElementById('ghReposRow');
        if (row) row.innerHTML = '<div class="gh-loading-placeholder">Could not load community data: ' + e.message + '</div>';
    } finally {
        if (refreshBtn) refreshBtn.classList.remove('spinning');
    }
}

function _renderGhRepos(repos) {
    var row = document.getElementById('ghReposRow');
    if (!row) return;
    if (repos.length === 0) {
        row.innerHTML = '<div class="gh-loading-placeholder">No repositories configured.</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < repos.length; i++) {
        var r = repos[i];
        if (r.error) {
            html += '<div class="gh-repo-card"><div class="gh-repo-name">' + escapeHTML(r.label) + '</div><div class="gh-repo-desc">' + escapeHTML(r.error) + '</div></div>';
            continue;
        }
        html += '<div class="gh-repo-card">';
        html += '<div class="gh-repo-name"><a href="' + escapeHTML(r.url) + '" target="_blank" rel="noopener">' + escapeHTML(r.label) + '</a></div>';
        html += '<div class="gh-repo-desc">' + escapeHTML(r.description || r.name) + '</div>';
        html += '<div class="gh-repo-stats">';
        html += '<span class="gh-stat"><span class="gh-stat-icon">&#x2605;</span> <span class="gh-stat-val">' + r.stars + '</span> stars</span>';
        html += '<span class="gh-stat"><span class="gh-stat-icon">&#x2442;</span> <span class="gh-stat-val">' + r.forks + '</span> forks</span>';
        html += '<span class="gh-stat"><span class="gh-stat-icon">&#x25CB;</span> <span class="gh-stat-val">' + r.openIssues + '</span> issues</span>';
        html += '<span class="gh-stat"><span class="gh-stat-icon">&#x1F441;</span> <span class="gh-stat-val">' + r.watchers + '</span> watchers</span>';
        if (r.license) html += '<span class="gh-stat">' + escapeHTML(r.license) + '</span>';
        html += '</div>';
        html += '</div>';
    }
    row.innerHTML = html;
}

function _renderGhActivity(commits) {
    var list = document.getElementById('ghActivityList');
    if (!list) return;
    if (commits.length === 0) {
        list.innerHTML = '<div class="gh-loading-placeholder">No recent commits found.</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < commits.length; i++) {
        var c = commits[i];
        html += '<div class="gh-commit-item">';
        if (c.avatar) {
            html += '<img class="gh-commit-avatar" src="' + escapeHTML(c.avatar) + '&s=48" alt="" loading="lazy">';
        } else {
            html += '<div class="gh-commit-avatar"></div>';
        }
        html += '<div class="gh-commit-info">';
        html += '<div class="gh-commit-msg"><a href="' + escapeHTML(c.url) + '" target="_blank" rel="noopener">' + escapeHTML(c.message) + '</a></div>';
        html += '<div class="gh-commit-meta"><span class="gh-commit-sha">' + escapeHTML(c.sha) + '</span> by ' + escapeHTML(c.author) + ' &middot; ' + _ghTimeAgo(c.date) + '</div>';
        html += '</div>';
        html += '</div>';
    }
    list.innerHTML = html;
}

function _renderGhContributors(contributors) {
    var grid = document.getElementById('ghContributorsGrid');
    if (!grid) return;
    if (contributors.length === 0) {
        grid.innerHTML = '<div class="gh-loading-placeholder">No contributors found.</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < contributors.length; i++) {
        var c = contributors[i];
        html += '<a class="gh-contributor" href="' + escapeHTML(c.url) + '" target="_blank" rel="noopener">';
        if (c.avatar) {
            html += '<img class="gh-contributor-avatar" src="' + escapeHTML(c.avatar) + '&s=44" alt="" loading="lazy">';
        } else {
            html += '<div class="gh-contributor-avatar"></div>';
        }
        html += '<span class="gh-contributor-name">' + escapeHTML(c.login) + '</span>';
        html += '<span class="gh-contributor-count">' + c.contributions + '</span>';
        html += '</a>';
    }
    grid.innerHTML = html;
}

function _renderGhQuickLinks(repos) {
    var el = document.getElementById('ghQuickLinks');
    if (!el) return;
    var links = [];
    for (var i = 0; i < repos.length; i++) {
        var r = repos[i];
        if (!r.url) continue;
        links.push({label: r.label + ' Code', url: r.url, icon: '&#x2630;'});
        links.push({label: 'Issues', url: r.url + '/issues', icon: '&#x25CB;'});
        links.push({label: 'Pull Requests', url: r.url + '/pulls', icon: '&#x21C4;'});
        links.push({label: 'Discussions', url: r.url + '/discussions', icon: '&#x1F4AC;'});
        links.push({label: 'Wiki', url: r.url + '/wiki', icon: '&#x1F4D6;'});
        break;
    }
    links.push({label: 'Contributing Guide', url: '/docs/contributing.md', icon: '&#x1F91D;'});
    var html = '';
    for (var j = 0; j < links.length; j++) {
        var lk = links[j];
        html += '<a class="gh-quick-link" href="' + escapeHTML(lk.url) + '" target="_blank" rel="noopener">' + lk.icon + ' ' + escapeHTML(lk.label) + '</a>';
    }
    el.innerHTML = html;
}

var _ghConsoleOutput = null;
var _ghConsoleStatus = null;
var _ghConsoleOverlay = null;
var _ghConsoleToken = 0;
var _ghAutoCloseTimer = null;

function showGitHubConsole(phases, mode, initialStatus) {
    closeGitHubConsole();

    _ghConsoleToken++;
    var token = _ghConsoleToken;

    var overlay = document.createElement('div');
    overlay.id = 'ghConsoleOverlay';
    overlay.className = 'modal-overlay';
    overlay._token = token;
    _ghConsoleOverlay = overlay;

    var dialog = document.createElement('div');
    dialog.className = 'gc-console-dialog';
    dialog.style.borderColor = '#C89B3C';
    dialog.style.boxShadow = '0 8px 32px rgba(200,155,60,0.3)';

    var title = document.createElement('div');
    title.className = 'gc-console-title';
    title.style.color = '#C89B3C';
    title.textContent = mode === 'push' ? 'Push to GitHub' : 'Get from GitHub';
    dialog.appendChild(title);

    var output = document.createElement('pre');
    output.className = 'gc-console-output';
    output.id = 'ghConsoleOutput';
    _ghConsoleOutput = output;
    dialog.appendChild(output);

    for (var i = 0; i < phases.length; i++) {
        var p = phases[i];
        var body = p.lines.filter(function(l) { return l.trim(); }).join('\n');
        output.textContent += (output.textContent ? '\n' : '') + p.heading + '\n' + body + '\n';
    }

    var status = document.createElement('div');
    status.className = 'gc-console-status';
    status.id = 'ghConsoleStatus';
    status.style.borderLeftColor = '#C89B3C';
    status.textContent = initialStatus || 'Working...';
    _ghConsoleStatus = status;
    dialog.appendChild(status);

    var buttons = document.createElement('div');
    buttons.className = 'gc-console-buttons';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'btn';
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'background:#555;color:#fff;border:none;';
    closeBtn.addEventListener('click', closeGitHubConsole);
    buttons.appendChild(closeBtn);

    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeGitHubConsole();
    });

    function escHandler(e) {
        if (e.key === 'Escape') closeGitHubConsole();
    }
    document.addEventListener('keydown', escHandler);
    overlay._escHandler = escHandler;

    return token;
}

function appendGitHubPhase(phase, token) {
    if (token !== undefined && token !== _ghConsoleToken) return;
    if (!_ghConsoleOutput) return;
    var body = phase.lines.filter(function(l) { return l.trim(); }).join('\n');
    _ghConsoleOutput.textContent += '\n' + phase.heading + '\n' + body + '\n';
    _ghConsoleOutput.scrollTop = _ghConsoleOutput.scrollHeight;
}

function updateGitHubStatus(msg, isError, token) {
    if (token !== undefined && token !== _ghConsoleToken) return;
    if (!_ghConsoleStatus) return;
    _ghConsoleStatus.textContent = msg;
    if (isError) {
        _ghConsoleStatus.style.borderLeftColor = '#e74c3c';
        if (_ghConsoleOutput) _ghConsoleOutput.style.color = '#e74c3c';
    }
}

function closeGitHubConsole() {
    if (_ghAutoCloseTimer) { clearTimeout(_ghAutoCloseTimer); _ghAutoCloseTimer = null; }
    if (_ghConsoleOverlay) {
        if (_ghConsoleOverlay._escHandler) document.removeEventListener('keydown', _ghConsoleOverlay._escHandler);
        _ghConsoleOverlay.remove();
        _ghConsoleOverlay = null;
    }
    _ghConsoleOutput = null;
    _ghConsoleStatus = null;
}

// ── Turing DR Test source ─────────────────────────────────────────────────
// Canonical source for the Turing DR Test ✦ section of the led_control example.
// Used by loadExample() and runTuringSimGate() (pre-flash simulation gate).
const _TURING_DR_TEST_SOURCE = `; ============================================================
; Abstraction:  TuringDRTest
; Description:  Full ISA visual test across all DR0-DR15 registers
; Author:       Church Machine Educational Platform
; Version:      1.1
; Created:      2026-05-09
; Language:     Assembly
; Dependencies: LED device (Abstract GT — boot C-List slot 8)
; ============================================================
; Capabilities required by this lump:
capabilities {
    LED0 RW
    LED1 RW
    LED2 RW
    LED3 RW
    LED4 RW
    LED5 RW
}
; Methods:
;   1. main — 6-phase visual test; all pass → 6 LEDs blink 3×; fault → LED2 latches
; ============================================================
; Turing DR Test ✦ — Full ISA Visual Test Across All DR0–DR15
; Exercises all 10 Turing instructions across 16 data registers:
;   DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR
; ============================================================
;
; HOW TO WATCH THIS IN THE SIMULATOR:
; 1. Boot the machine (click Boot, or Step x6).
; 2. Assemble this code, then click Run (or Step repeatedly).
; 3. Switch to Ti60 255 IDE — watch the LED strip animate
;    through 6 phases. All pass → all 6 LEDs blink 3×.
;    Any failure → LED2 (red FAULT) latches ON permanently.
;
; LED indicators:
;   LED0   = heartbeat — blinks at each phase transition
;   LED1   = sub-test pulse — blinks once per passing check
;   LED2   = FAULT — ON permanently if any assertion fails
;   LED3-5 = 3-bit phase counter (001 Ph1 … 110 Ph6)
;
; Phase map (LEDs 3-5 bit pattern):
;   Ph1  IADD count cycling        001
;   Ph2  ISUB count cycling        010
;   Ph3  SHL  bit walk             011
;   Ph4  SHR  bit walk             100
;   Ph5  BFEXT / BFINS mask+insert 101
;   Ph6  DREAD / DWRITE roundtrip  110
;
; Conventions:
;   DR0 = 0 (hardwired zero, never a write destination)
;   DR1 = 1 (LED-on constant; tested last in each phase,
;            restored with IADD DR1, DR0, #1 afterward)
;   CR3 = LED device (C-List[8] loaded in setup)
; ============================================================

; ── Setup ────────────────────────────────────────────────────
LOAD CR3, LED0            ; LED0 Abstract GT → CR3 (boot C-List slot 8, R+W)
IADD DR1, DR0, #1         ; DR1 = 1 (LED on-constant throughout)
DWRITE DR0, CR3, 0        ; clear all LEDs
DWRITE DR0, CR3, 1
DWRITE DR0, CR3, 2
DWRITE DR0, CR3, 3
DWRITE DR0, CR3, 4
DWRITE DR0, CR3, 5

; ═══════════════════════════════════════════════════════════════
; PHASE 1 — IADD count cycling   (LEDs 3-5 = 001)
; Each DR N: load seed=N, add 1 three times, subtract N+3 → 0.
; MCMP vs DR0 (hardwired zero). DR1 tested last and restored.
; ═══════════════════════════════════════════════════════════════
ph1:
DWRITE DR1, CR3, 0        ; LED0 heartbeat
DWRITE DR1, CR3, 3        ; LED3=1 (phase bit 0)
DWRITE DR0, CR3, 4        ; LED4=0
DWRITE DR0, CR3, 5        ; LED5=0

; DR2: seed=2, +3 → 5, -5 → 0
IADD DR2, DR0, #2
IADD DR2, DR2, #1
IADD DR2, DR2, #1
IADD DR2, DR2, #1         ; DR2 = 5
ISUB DR2, DR2, #5         ; DR2 = 0
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR3: seed=3, +3 → 6, -6 → 0
IADD DR3, DR0, #3
IADD DR3, DR3, #1
IADD DR3, DR3, #1
IADD DR3, DR3, #1
ISUB DR3, DR3, #6
MCMP DR3, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR4: seed=4, +3 → 7, -7 → 0
IADD DR4, DR0, #4
IADD DR4, DR4, #1
IADD DR4, DR4, #1
IADD DR4, DR4, #1
ISUB DR4, DR4, #7
MCMP DR4, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR5: seed=5, +3 → 8, -8 → 0
IADD DR5, DR0, #5
IADD DR5, DR5, #1
IADD DR5, DR5, #1
IADD DR5, DR5, #1
ISUB DR5, DR5, #8
MCMP DR5, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR6: seed=6, +3 → 9, -9 → 0
IADD DR6, DR0, #6
IADD DR6, DR6, #1
IADD DR6, DR6, #1
IADD DR6, DR6, #1
ISUB DR6, DR6, #9
MCMP DR6, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR7: seed=7, +3 → 10, -10 → 0
IADD DR7, DR0, #7
IADD DR7, DR7, #1
IADD DR7, DR7, #1
IADD DR7, DR7, #1
ISUB DR7, DR7, #10
MCMP DR7, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR8: seed=8, +3 → 11, -11 → 0
IADD DR8, DR0, #8
IADD DR8, DR8, #1
IADD DR8, DR8, #1
IADD DR8, DR8, #1
ISUB DR8, DR8, #11
MCMP DR8, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR9: seed=9, +3 → 12, -12 → 0
IADD DR9, DR0, #9
IADD DR9, DR9, #1
IADD DR9, DR9, #1
IADD DR9, DR9, #1
ISUB DR9, DR9, #12
MCMP DR9, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR10: seed=10, +3 → 13, -13 → 0
IADD DR10, DR0, #10
IADD DR10, DR10, #1
IADD DR10, DR10, #1
IADD DR10, DR10, #1
ISUB DR10, DR10, #13
MCMP DR10, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR11: seed=11, +3 → 14, -14 → 0
IADD DR11, DR0, #11
IADD DR11, DR11, #1
IADD DR11, DR11, #1
IADD DR11, DR11, #1
ISUB DR11, DR11, #14
MCMP DR11, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR12: seed=12, +3 → 15, -15 → 0
IADD DR12, DR0, #12
IADD DR12, DR12, #1
IADD DR12, DR12, #1
IADD DR12, DR12, #1
ISUB DR12, DR12, #15
MCMP DR12, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR13: seed=13, +3 → 16, -16 → 0
IADD DR13, DR0, #13
IADD DR13, DR13, #1
IADD DR13, DR13, #1
IADD DR13, DR13, #1
ISUB DR13, DR13, #16
MCMP DR13, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR14: seed=14, +3 → 17, -17 → 0
IADD DR14, DR0, #14
IADD DR14, DR14, #1
IADD DR14, DR14, #1
IADD DR14, DR14, #1
ISUB DR14, DR14, #17
MCMP DR14, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR15: seed=15, +3 → 18, -18 → 0
IADD DR15, DR0, #15
IADD DR15, DR15, #1
IADD DR15, DR15, #1
IADD DR15, DR15, #1
ISUB DR15, DR15, #18
MCMP DR15, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR1 tested last (seed=1, +3 → 4, -4 → 0); restore DR1=1 after
IADD DR1, DR0, #1
IADD DR1, DR1, #1
IADD DR1, DR1, #1
IADD DR1, DR1, #1         ; DR1 = 4
ISUB DR1, DR1, #4         ; DR1 = 0
MCMP DR1, DR0
BRANCHNE fail
IADD DR1, DR0, #1         ; restore DR1 = 1
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; ═══════════════════════════════════════════════════════════════
; PHASE 2 — ISUB count cycling   (LEDs 3-5 = 010)
; Each DR N: load N, ISUB N → 0. MCMP vs DR0.
; ═══════════════════════════════════════════════════════════════
ph2:
DWRITE DR1, CR3, 0        ; LED0 heartbeat
DWRITE DR0, CR3, 3        ; LED3=0
DWRITE DR1, CR3, 4        ; LED4=1 (phase bit 1)
DWRITE DR0, CR3, 5        ; LED5=0

; DR2
IADD DR2, DR0, #2
ISUB DR2, DR2, #2
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR3
IADD DR3, DR0, #3
ISUB DR3, DR3, #3
MCMP DR3, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR4
IADD DR4, DR0, #4
ISUB DR4, DR4, #4
MCMP DR4, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR5
IADD DR5, DR0, #5
ISUB DR5, DR5, #5
MCMP DR5, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR6
IADD DR6, DR0, #6
ISUB DR6, DR6, #6
MCMP DR6, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR7
IADD DR7, DR0, #7
ISUB DR7, DR7, #7
MCMP DR7, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR8
IADD DR8, DR0, #8
ISUB DR8, DR8, #8
MCMP DR8, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR9
IADD DR9, DR0, #9
ISUB DR9, DR9, #9
MCMP DR9, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR10
IADD DR10, DR0, #10
ISUB DR10, DR10, #10
MCMP DR10, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR11
IADD DR11, DR0, #11
ISUB DR11, DR11, #11
MCMP DR11, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR12
IADD DR12, DR0, #12
ISUB DR12, DR12, #12
MCMP DR12, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR13
IADD DR13, DR0, #13
ISUB DR13, DR13, #13
MCMP DR13, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR14
IADD DR14, DR0, #14
ISUB DR14, DR14, #14
MCMP DR14, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR15
IADD DR15, DR0, #15
ISUB DR15, DR15, #15
MCMP DR15, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR1 tested last; restore after
IADD DR1, DR0, #1
ISUB DR1, DR1, #1         ; DR1 = 0
MCMP DR1, DR0
BRANCHNE fail
IADD DR1, DR0, #1         ; restore DR1 = 1
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; ═══════════════════════════════════════════════════════════════
; PHASE 3 — SHL bit walk   (LEDs 3-5 = 011)
; Each DR: load 1, SHL by 1 thirty-one times → 0x80000000.
; One more SHL by 1 → 0 (overflow). All shifts are SHL by 1.
; DR2 used as loop counter (reset before each test); DR3 as counter for DR2.
; Expected (0x80000000) pre-computed in DR15 via loop; re-built in DR14 for DR15/DR1.
; ═══════════════════════════════════════════════════════════════
ph3:
DWRITE DR1, CR3, 0        ; LED0 heartbeat
DWRITE DR1, CR3, 3        ; LED3=1
DWRITE DR1, CR3, 4        ; LED4=1
DWRITE DR0, CR3, 5        ; LED5=0

; Pre-compute expected 0x80000000 in DR15 using SHL by 1 ×31 (counter in DR14)
IADD DR15, DR0, #1
IADD DR14, DR0, #31
p3_ex:
SHL DR15, DR15, 1
ISUB DR14, DR14, #1
BRANCHNE p3_ex             ; DR15 = 0x80000000

; DR2: SHL by 1 ×31, counter in DR3
IADD DR2, DR0, #1
IADD DR3, DR0, #31
p3_sh2:
SHL DR2, DR2, 1
ISUB DR3, DR3, #1
BRANCHNE p3_sh2            ; DR2 = 0x80000000
MCMP DR2, DR15
BRANCHNE fail
SHL DR2, DR2, 1            ; overflow → 0
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR3: SHL by 1 ×31, counter in DR2
IADD DR3, DR0, #1
IADD DR2, DR0, #31
p3_sh3:
SHL DR3, DR3, 1
ISUB DR2, DR2, #1
BRANCHNE p3_sh3
MCMP DR3, DR15
BRANCHNE fail
SHL DR3, DR3, 1
MCMP DR3, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR4: counter in DR2
IADD DR4, DR0, #1
IADD DR2, DR0, #31
p3_sh4:
SHL DR4, DR4, 1
ISUB DR2, DR2, #1
BRANCHNE p3_sh4
MCMP DR4, DR15
BRANCHNE fail
SHL DR4, DR4, 1
MCMP DR4, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR5
IADD DR5, DR0, #1
IADD DR2, DR0, #31
p3_sh5:
SHL DR5, DR5, 1
ISUB DR2, DR2, #1
BRANCHNE p3_sh5
MCMP DR5, DR15
BRANCHNE fail
SHL DR5, DR5, 1
MCMP DR5, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR6
IADD DR6, DR0, #1
IADD DR2, DR0, #31
p3_sh6:
SHL DR6, DR6, 1
ISUB DR2, DR2, #1
BRANCHNE p3_sh6
MCMP DR6, DR15
BRANCHNE fail
SHL DR6, DR6, 1
MCMP DR6, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR7
IADD DR7, DR0, #1
IADD DR2, DR0, #31
p3_sh7:
SHL DR7, DR7, 1
ISUB DR2, DR2, #1
BRANCHNE p3_sh7
MCMP DR7, DR15
BRANCHNE fail
SHL DR7, DR7, 1
MCMP DR7, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR8
IADD DR8, DR0, #1
IADD DR2, DR0, #31
p3_sh8:
SHL DR8, DR8, 1
ISUB DR2, DR2, #1
BRANCHNE p3_sh8
MCMP DR8, DR15
BRANCHNE fail
SHL DR8, DR8, 1
MCMP DR8, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR9
IADD DR9, DR0, #1
IADD DR2, DR0, #31
p3_sh9:
SHL DR9, DR9, 1
ISUB DR2, DR2, #1
BRANCHNE p3_sh9
MCMP DR9, DR15
BRANCHNE fail
SHL DR9, DR9, 1
MCMP DR9, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR10
IADD DR10, DR0, #1
IADD DR2, DR0, #31
p3_sh10:
SHL DR10, DR10, 1
ISUB DR2, DR2, #1
BRANCHNE p3_sh10
MCMP DR10, DR15
BRANCHNE fail
SHL DR10, DR10, 1
MCMP DR10, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR11
IADD DR11, DR0, #1
IADD DR2, DR0, #31
p3_sh11:
SHL DR11, DR11, 1
ISUB DR2, DR2, #1
BRANCHNE p3_sh11
MCMP DR11, DR15
BRANCHNE fail
SHL DR11, DR11, 1
MCMP DR11, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR12
IADD DR12, DR0, #1
IADD DR2, DR0, #31
p3_sh12:
SHL DR12, DR12, 1
ISUB DR2, DR2, #1
BRANCHNE p3_sh12
MCMP DR12, DR15
BRANCHNE fail
SHL DR12, DR12, 1
MCMP DR12, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR13
IADD DR13, DR0, #1
IADD DR2, DR0, #31
p3_sh13:
SHL DR13, DR13, 1
ISUB DR2, DR2, #1
BRANCHNE p3_sh13
MCMP DR13, DR15
BRANCHNE fail
SHL DR13, DR13, 1
MCMP DR13, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR14: counter in DR2; DR15 still holds expected 0x80000000
IADD DR14, DR0, #1
IADD DR2, DR0, #31
p3_sh14:
SHL DR14, DR14, 1
ISUB DR2, DR2, #1
BRANCHNE p3_sh14
MCMP DR14, DR15
BRANCHNE fail
SHL DR14, DR14, 1
MCMP DR14, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR15: rebuild expected in DR14 (single shift for helper value), counter in DR2
IADD DR14, DR0, #1
SHL DR14, DR14, 31        ; DR14 = 0x80000000 (expected — helper, not under test)
IADD DR15, DR0, #1
IADD DR2, DR0, #31
p3_sh15:
SHL DR15, DR15, 1
ISUB DR2, DR2, #1
BRANCHNE p3_sh15
MCMP DR15, DR14
BRANCHNE fail
SHL DR15, DR15, 1
MCMP DR15, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR1 tested last: expected in DR14, counter in DR2; restore DR1 = 1 after
IADD DR14, DR0, #1
SHL DR14, DR14, 31        ; DR14 = 0x80000000 (expected — helper)
IADD DR1, DR0, #1
IADD DR2, DR0, #31
p3_sh1:
SHL DR1, DR1, 1
ISUB DR2, DR2, #1
BRANCHNE p3_sh1
MCMP DR1, DR14
BRANCHNE fail
SHL DR1, DR1, 1            ; DR1 = 0
MCMP DR1, DR0
BRANCHNE fail
IADD DR1, DR0, #1         ; restore DR1 = 1
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; ═══════════════════════════════════════════════════════════════
; PHASE 4 — SHR bit walk   (LEDs 3-5 = 100)
; Each DR: load 0x80000000 via BFINS, SHR by 1 ×31 → 1.
; DR2 used as loop counter (DR3 for DR2 test).
; Verify: ISUB ctr, DRx, #1; MCMP ctr, DR0.
; Then: ASR sign-extension test; logical SHR of -1.
; ═══════════════════════════════════════════════════════════════
ph4:
DWRITE DR1, CR3, 0        ; LED0 heartbeat
DWRITE DR0, CR3, 3        ; LED3=0
DWRITE DR0, CR3, 4        ; LED4=0
DWRITE DR1, CR3, 5        ; LED5=1

; DR2: SHR by 1 ×31, counter in DR3
IADD DR2, DR0, #0
BFINS DR2, DR1, 31, 1     ; DR2 = 0x80000000 (bit 31 set via DR1[0]=1)
IADD DR3, DR0, #31
p4_sh2:
SHR DR2, DR2, 1
ISUB DR3, DR3, #1
BRANCHNE p4_sh2
ISUB DR3, DR2, #1         ; DR3 = 0 iff DR2 = 1
MCMP DR3, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR3: counter in DR2
IADD DR3, DR0, #0
BFINS DR3, DR1, 31, 1
IADD DR2, DR0, #31
p4_sh3:
SHR DR3, DR3, 1
ISUB DR2, DR2, #1
BRANCHNE p4_sh3
ISUB DR2, DR3, #1
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR4: counter in DR2
IADD DR4, DR0, #0
BFINS DR4, DR1, 31, 1
IADD DR2, DR0, #31
p4_sh4:
SHR DR4, DR4, 1
ISUB DR2, DR2, #1
BRANCHNE p4_sh4
ISUB DR2, DR4, #1
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR5: counter in DR2
IADD DR5, DR0, #0
BFINS DR5, DR1, 31, 1
IADD DR2, DR0, #31
p4_sh5:
SHR DR5, DR5, 1
ISUB DR2, DR2, #1
BRANCHNE p4_sh5
ISUB DR2, DR5, #1
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR6: counter in DR2
IADD DR6, DR0, #0
BFINS DR6, DR1, 31, 1
IADD DR2, DR0, #31
p4_sh6:
SHR DR6, DR6, 1
ISUB DR2, DR2, #1
BRANCHNE p4_sh6
ISUB DR2, DR6, #1
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR7: counter in DR2
IADD DR7, DR0, #0
BFINS DR7, DR1, 31, 1
IADD DR2, DR0, #31
p4_sh7:
SHR DR7, DR7, 1
ISUB DR2, DR2, #1
BRANCHNE p4_sh7
ISUB DR2, DR7, #1
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR8: counter in DR2
IADD DR8, DR0, #0
BFINS DR8, DR1, 31, 1
IADD DR2, DR0, #31
p4_sh8:
SHR DR8, DR8, 1
ISUB DR2, DR2, #1
BRANCHNE p4_sh8
ISUB DR2, DR8, #1
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR9: counter in DR2
IADD DR9, DR0, #0
BFINS DR9, DR1, 31, 1
IADD DR2, DR0, #31
p4_sh9:
SHR DR9, DR9, 1
ISUB DR2, DR2, #1
BRANCHNE p4_sh9
ISUB DR2, DR9, #1
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR10: counter in DR2
IADD DR10, DR0, #0
BFINS DR10, DR1, 31, 1
IADD DR2, DR0, #31
p4_sh10:
SHR DR10, DR10, 1
ISUB DR2, DR2, #1
BRANCHNE p4_sh10
ISUB DR2, DR10, #1
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR11: counter in DR2
IADD DR11, DR0, #0
BFINS DR11, DR1, 31, 1
IADD DR2, DR0, #31
p4_sh11:
SHR DR11, DR11, 1
ISUB DR2, DR2, #1
BRANCHNE p4_sh11
ISUB DR2, DR11, #1
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR12: counter in DR2
IADD DR12, DR0, #0
BFINS DR12, DR1, 31, 1
IADD DR2, DR0, #31
p4_sh12:
SHR DR12, DR12, 1
ISUB DR2, DR2, #1
BRANCHNE p4_sh12
ISUB DR2, DR12, #1
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR13: counter in DR2
IADD DR13, DR0, #0
BFINS DR13, DR1, 31, 1
IADD DR2, DR0, #31
p4_sh13:
SHR DR13, DR13, 1
ISUB DR2, DR2, #1
BRANCHNE p4_sh13
ISUB DR2, DR13, #1
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR14: counter in DR2
IADD DR14, DR0, #0
BFINS DR14, DR1, 31, 1
IADD DR2, DR0, #31
p4_sh14:
SHR DR14, DR14, 1
ISUB DR2, DR2, #1
BRANCHNE p4_sh14
ISUB DR2, DR14, #1
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR15: counter in DR2
IADD DR15, DR0, #0
BFINS DR15, DR1, 31, 1
IADD DR2, DR0, #31
p4_sh15:
SHR DR15, DR15, 1
ISUB DR2, DR2, #1
BRANCHNE p4_sh15
ISUB DR2, DR15, #1
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; DR1 tested last: build source=1 in DR3, zero DR1, BFINS, loop with counter in DR2
IADD DR3, DR0, #1         ; DR3 = 1 (source for BFINS, since DR1 is the test target)
IADD DR1, DR0, #0
BFINS DR1, DR3, 31, 1     ; DR1 = 0x80000000
IADD DR2, DR0, #31
p4_sh1:
SHR DR1, DR1, 1
ISUB DR2, DR2, #1
BRANCHNE p4_sh1
ISUB DR2, DR1, #1         ; DR2 = 0 iff DR1 = 1 (non-tautological)
MCMP DR2, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; ASR test: DR2 = -1 (0xFFFFFFFF), ASR 1 → still -1
ISUB DR2, DR0, #1         ; DR2 = 0xFFFFFFFF (-1)
SHR DR3, DR2, 1, ASR      ; DR3 = 0xFFFFFFFF (sign bit replicated)
MCMP DR3, DR2             ; must be equal
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; Logical SHR of -1: 0xFFFFFFFF >> 1 logical = 0x7FFFFFFF
; Build 0x7FFFFFFF: BFINS 0x80000000, subtract 1
IADD DR4, DR0, #0
BFINS DR4, DR1, 31, 1     ; DR4 = 0x80000000 (DR1 = 1 after loop)
ISUB DR5, DR4, #1         ; DR5 = 0x7FFFFFFF (expected)
SHR DR6, DR2, 1           ; DR6 = 0x7FFFFFFF (logical SHR of -1)
MCMP DR6, DR5
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; ═══════════════════════════════════════════════════════════════
; PHASE 5 — BFEXT / BFINS mask and insert   (LEDs 3-5 = 101)
; Source: DR2 = 0xA5 = 0b10100101
; Test (pos, width) pairs on DR3-DR15 + DR1 round-robin.
; BFINS roundtrip: zero DR, insert field, BFEXT back, check.
; ═══════════════════════════════════════════════════════════════
ph5:
DWRITE DR1, CR3, 0        ; LED0 heartbeat
DWRITE DR1, CR3, 3        ; LED3=1
DWRITE DR0, CR3, 4        ; LED4=0
DWRITE DR1, CR3, 5        ; LED5=1

IADD DR2, DR0, #165       ; DR2 = 0xA5 = 0b10100101 (source pattern)

; Pair 1: pos=0, w=4 → bits[3:0] of 0xA5 = 0b0101 = 5  → DR3
BFEXT DR3, DR2, 0, 4
ISUB DR3, DR3, #5
MCMP DR3, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; BFINS roundtrip: zero DR4, insert pos=0 w=4 from DR2, BFEXT back → DR5 = 5
IADD DR4, DR0, #0
BFINS DR4, DR2, 0, 4      ; DR4[3:0] = DR2[3:0] = 5
BFEXT DR5, DR4, 0, 4      ; DR5 = 5
ISUB DR5, DR5, #5
MCMP DR5, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; Pair 2: pos=4, w=4 → bits[7:4] of 0xA5 = 0b1010 = 10  → DR6
BFEXT DR6, DR2, 4, 4
ISUB DR6, DR6, #10
MCMP DR6, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; BFINS roundtrip: DR7 zero, insert pos=4 w=4, BFEXT back → DR8 = 10
IADD DR7, DR0, #0
BFINS DR7, DR2, 4, 4      ; DR7[7:4] = DR2[3:0] = 0b0101 (low nibble of 0xA5)
BFEXT DR8, DR7, 4, 4      ; DR8 should equal DR2[3:0] = 5
; Note: BFINS inserts DRs[width-1:0] at pos in DRd.
; DR2[3:0] = 5 inserted at pos=4 → DR7 = 0b01010000 = 80; BFEXT DR8 from DR7 pos=4 w=4 → DR8 = 5
ISUB DR8, DR8, #5
MCMP DR8, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; Pair 3: pos=0, w=8 → all 8 bits = 0xA5 = 165  → DR9
BFEXT DR9, DR2, 0, 8
ISUB DR9, DR9, #165
MCMP DR9, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; BFINS roundtrip pos=0 w=8 → DR10, verify via DR11
IADD DR10, DR0, #0
BFINS DR10, DR2, 0, 8     ; DR10[7:0] = 0xA5
BFEXT DR11, DR10, 0, 8    ; DR11 = 0xA5 = 165
ISUB DR11, DR11, #165
MCMP DR11, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; Pair 4: pos=2, w=4 → bits[5:2] of 0xA5 = 0b1001 = 9  → DR12
; 0xA5 = 0b10100101: bit2=1, bit3=0, bit4=0, bit5=1 → 0b1001 = 9
BFEXT DR12, DR2, 2, 4
ISUB DR12, DR12, #9
MCMP DR12, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; Pair 5: pos=1, w=3 → bits[3:1] of 0xA5 = 0b010 = 2  → DR13
; 0xA5 = 0b10100101: bit1=0, bit2=1, bit3=0 → 0b010 = 2
BFEXT DR13, DR2, 1, 3
ISUB DR13, DR13, #2
MCMP DR13, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; Pair 6: pos=0, w=1 → bit[0] of 0xA5 = 1  → DR14
BFEXT DR14, DR2, 0, 1
ISUB DR14, DR14, #1
MCMP DR14, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; Pair 7: pos=7, w=1 → bit[7] of 0xA5 = 1  → DR15
BFEXT DR15, DR2, 7, 1
ISUB DR15, DR15, #1
MCMP DR15, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; Pair 8: pos=0, w=1 using DR1 (tested last); bit[0] of 0xA5 = 1 → DR1 = 1 (no restore needed)
BFEXT DR1, DR2, 0, 1      ; DR1 = 1 (happens to equal the constant we need)
ISUB DR1, DR1, #1         ; DR1 = 0
MCMP DR1, DR0
BRANCHNE fail
IADD DR1, DR0, #1         ; restore DR1 = 1
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; ═══ High-bit / full-word BFEXT/BFINS pairs (Pairs 9-12) ═══════════════
; Build DR3 = 0xA5000000: insert 0xA5 at the high byte (pos=24, w=8)
IADD DR3, DR0, #0
BFINS DR3, DR2, 24, 8     ; DR3[31:24] = DR2[7:0] = 0xA5 → DR3 = 0xA5000000

; Pair 9: pos=24, w=8 — extract high byte back → 0xA5 = 165
BFEXT DR4, DR3, 24, 8     ; DR4 = 0xA5 = 165
ISUB DR4, DR4, #165
MCMP DR4, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; Pair 10: pos=28, w=4 — top nibble of 0xA5000000 = 0b1010 = 10
BFEXT DR5, DR3, 28, 4     ; DR5 = 10
ISUB DR5, DR5, #10
MCMP DR5, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; Pair 11: pos=31, w=1 — single MSB of 0xA5000000 = 1
BFEXT DR6, DR3, 31, 1     ; DR6 = 1 (MSB of 0xA5 is 1)
ISUB DR6, DR6, #1
MCMP DR6, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; Pair 12: BFINS roundtrip at top nibble — insert 0xA=10, extract back
IADD DR7, DR0, #10        ; DR7 = 0xA (source)
IADD DR8, DR0, #0         ; DR8 = 0 (destination)
BFINS DR8, DR7, 28, 4     ; DR8[31:28] = DR7[3:0] = 0xA → DR8 = 0xA0000000
BFEXT DR9, DR8, 28, 4     ; DR9 = 0xA = 10
ISUB DR9, DR9, #10
MCMP DR9, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; Pair 13: pos=0, w=31 — maximum supported BFEXT width from DR2=0xA5=165
; 0xA5 fits in 31 bits; extract gives exactly 165 (bits 31-1 are 0 in source)
BFEXT DR10, DR2, 0, 31    ; DR10 = 0xA5 = 165
ISUB DR10, DR10, #165
MCMP DR10, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; ═══════════════════════════════════════════════════════════════
; PHASE 6 — DREAD / DWRITE roundtrip   (LEDs 3-5 = 110)
; For LED offsets 0-5: DWRITE 1, DREAD back (scratch DR2-DR7),
;   MCMP vs DR1 (=1); DWRITE 0, DREAD back (DR8-DR11 for 0-3),
;   MCMP vs DR0.  LED1 blinks each offset.
; End: all LEDs restored to OFF.
; ═══════════════════════════════════════════════════════════════
ph6:
DWRITE DR1, CR3, 0        ; LED0 heartbeat
DWRITE DR0, CR3, 3        ; LED3=0
DWRITE DR1, CR3, 4        ; LED4=1
DWRITE DR1, CR3, 5        ; LED5=1

; LED offset 0 — scratch DR2 (ON), DR8 (OFF)
DWRITE DR1, CR3, 0        ; write 1 → LED0
DREAD  DR2, CR3, 0        ; read back
MCMP   DR2, DR1           ; expect 1
BRANCHNE fail
DWRITE DR0, CR3, 0        ; write 0 → LED0
DREAD  DR8, CR3, 0        ; read back using DR8
MCMP   DR8, DR0           ; expect 0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; LED offset 1 — scratch DR3 (ON), DR9 (OFF)
DWRITE DR1, CR3, 1
DREAD  DR3, CR3, 1
MCMP   DR3, DR1
BRANCHNE fail
DWRITE DR0, CR3, 1
DREAD  DR9, CR3, 1
MCMP   DR9, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; LED offset 2 — scratch DR4 (ON), DR10 (OFF)
DWRITE DR1, CR3, 2
DREAD  DR4, CR3, 2
MCMP   DR4, DR1
BRANCHNE fail
DWRITE DR0, CR3, 2
DREAD  DR10, CR3, 2
MCMP   DR10, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; LED offset 3 — scratch DR5 (ON), DR11 (OFF)
DWRITE DR1, CR3, 3
DREAD  DR5, CR3, 3
MCMP   DR5, DR1
BRANCHNE fail
DWRITE DR0, CR3, 3
DREAD  DR11, CR3, 3
MCMP   DR11, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; LED offset 4 — scratch DR6 (ON + OFF)
DWRITE DR1, CR3, 4
DREAD  DR6, CR3, 4
MCMP   DR6, DR1
BRANCHNE fail
DWRITE DR0, CR3, 4
DREAD  DR6, CR3, 4
MCMP   DR6, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; LED offset 5 — scratch DR7 (ON + OFF)
DWRITE DR1, CR3, 5
DREAD  DR7, CR3, 5
MCMP   DR7, DR1
BRANCHNE fail
DWRITE DR0, CR3, 5
DREAD  DR7, CR3, 5
MCMP   DR7, DR0
BRANCHNE fail
DWRITE DR1, CR3, 1
DWRITE DR0, CR3, 1

; Restore all LEDs to OFF at end of Phase 6
DWRITE DR0, CR3, 0
DWRITE DR0, CR3, 1
DWRITE DR0, CR3, 2
DWRITE DR0, CR3, 3
DWRITE DR0, CR3, 4
DWRITE DR0, CR3, 5

; ═══════════════════════════════════════════════════════════════
; PASS — all 6 phases passed; blink all LEDs 3x then restart
; ═══════════════════════════════════════════════════════════════
pass:
DWRITE DR1, CR3, 0
DWRITE DR1, CR3, 1
DWRITE DR1, CR3, 2
DWRITE DR1, CR3, 3
DWRITE DR1, CR3, 4
DWRITE DR1, CR3, 5        ; all ON
IADD DR2, DR0, #200
pass_dly1:
ISUB DR2, DR2, #1
BRANCHNE pass_dly1
DWRITE DR0, CR3, 0
DWRITE DR0, CR3, 1
DWRITE DR0, CR3, 2
DWRITE DR0, CR3, 3
DWRITE DR0, CR3, 4
DWRITE DR0, CR3, 5        ; all OFF
IADD DR2, DR0, #100
pass_dly2:
ISUB DR2, DR2, #1
BRANCHNE pass_dly2
DWRITE DR1, CR3, 0
DWRITE DR1, CR3, 1
DWRITE DR1, CR3, 2
DWRITE DR1, CR3, 3
DWRITE DR1, CR3, 4
DWRITE DR1, CR3, 5        ; all ON
IADD DR2, DR0, #200
pass_dly3:
ISUB DR2, DR2, #1
BRANCHNE pass_dly3
DWRITE DR0, CR3, 0
DWRITE DR0, CR3, 1
DWRITE DR0, CR3, 2
DWRITE DR0, CR3, 3
DWRITE DR0, CR3, 4
DWRITE DR0, CR3, 5        ; all OFF
IADD DR2, DR0, #100
pass_dly4:
ISUB DR2, DR2, #1
BRANCHNE pass_dly4
DWRITE DR1, CR3, 0
DWRITE DR1, CR3, 1
DWRITE DR1, CR3, 2
DWRITE DR1, CR3, 3
DWRITE DR1, CR3, 4
DWRITE DR1, CR3, 5        ; all ON (3rd blink)
IADD DR2, DR0, #200
pass_dly5:
ISUB DR2, DR2, #1
BRANCHNE pass_dly5
DWRITE DR0, CR3, 0
DWRITE DR0, CR3, 1
DWRITE DR0, CR3, 2
DWRITE DR0, CR3, 3
DWRITE DR0, CR3, 4
DWRITE DR0, CR3, 5        ; all OFF
BRANCH ph1                ; loop back to phase 1 forever

; ═══════════════════════════════════════════════════════════════
; FAIL — latch LED2 (FAULT) ON, halt forever
; ═══════════════════════════════════════════════════════════════
fail:
DWRITE DR0, CR3, 0        ; LED0 off
DWRITE DR0, CR3, 1        ; LED1 off
DWRITE DR1, CR3, 2        ; LED2 = FAULT (red, permanent)
DWRITE DR0, CR3, 3        ; LED3 off
DWRITE DR0, CR3, 4        ; LED4 off
DWRITE DR0, CR3, 5        ; LED5 off
BRANCH fail               ; infinite halt loop
`;

function loadExample(name) {
    // User explicitly chose an example — discard any wizard scaffold.
    window._wizardScaffoldActive = false;
    const editor = document.getElementById('asmEditor');
    if (!editor) return;
    _editorCREditActive = false;
    _editorCREditCR = null;
    _editorCREditNS = null;
    _updateEditorPatchBar();
    if (activeUserTabId && userTabDirty) saveActiveUserTab();
    activeUserTabId = null;
    userTabDirty = false;
    // Loading a built-in example abandons any in-progress catalog edit context
    if (typeof clearPseudoEditContext === 'function') clearPseudoEditContext();
    renderUserTabs();
    updateSaveUserTabBtn();

    const examples = {
        'ada_note_g': `; ============================================================
; Abstraction:  NoteGAssembly
; Description:  Ada Lovelace's Note G (1843): 25 ops on Church Machine assembly
; Author:       Church Machine Educational Platform
; Version:      1.0
; Created:      2026-05-09
; Language:     Assembly
; Dependencies: None
; ============================================================
; Methods:
;   1. main — 25 assembly operations computing B7 = -1/30 (integer truncated)
; ============================================================
; ============================================
; Ada Lovelace — Note G (1843)
; The First Computer Program
; Computes B7 (Bernoulli number = -1/30)
; 25 operations from the original diagram
; ============================================
;
; Ada wrote this for Babbage's Analytical
; Engine, which was never built. Here it runs
; on the Church Machine — 181 years later.
;
; The Analytical Engine had multiply and
; divide in hardware. The Church Machine has
; no multiply or divide — so Ada's × becomes
; repeated addition (IADD loop) and ÷ becomes
; repeated subtraction (ISUB loop), exactly
; as a child would compute them by hand.
;
; *** INTEGER ARITHMETIC WARNING ***
; This assembly rendering uses INTEGER arithmetic
; only. All registers hold whole numbers; division
; discards the remainder (truncates toward zero).
;
; As a direct consequence, Operation 4 computes
; 7 ÷ 9 = 0 (remainder 7), NOT 7/9. Every
; subsequent coefficient built on that result is
; also 0, so the final value in DR15 (V24) will
; be 0 — not the expected -1/30.
;
; This is not a bug: integer truncation is the
; correct behaviour for a machine with no
; rational-number support. The assembly listing
; exists to demonstrate Ada's 25-operation
; structure on real Church Machine opcodes.
;
; To see exact rational results (-1/30 in DR24),
; load the CLOOMC preset instead. The CLOOMC
; symbolic front-end compiles to rational-
; arithmetic bytecode and produces all
; intermediate fractions exactly as Ada's
; trace shows (Op 4 → 7/9, Op 5 → 7/18, …).
;
; Variable mapping (Ada → Church Machine):
;   DR1  = V1  = 1 (constant)
;   DR2  = V2  = 2 (constant)
;   DR3  = V3  = n (4 for B7)
;   DR4  = V4  (working: 2n, then 2n-1)
;   DR5  = V5  (working: 2n, then 2n+1)
;   DR6  = V6  (working: 2n, decrements)
;   DR7  = V7  (denominator counter)
;   DR8  = V8  (fraction quotient)
;   DR9  = V9  (fraction quotient)
;   DR10 = V10 (loop counter)
;   DR11 = V11 (working coefficient)
;   DR12 = V12 (product Bk × Ak)
;   DR13 = V13 (accumulator)
;   DR14 = scratch (loop counter for ×/÷)
;   DR15 = V24 (result: B7)
;
; DR0 = 0 always (hardwired zero register).
; Constants loaded via DREAD from a data
; table at the end of this program (CR14 code lump exception).
; ============================================

; --- Initialize Ada's Store columns ---
DREAD DR1, CR14, 100       ; V1 = 1
DREAD DR2, CR14, 101       ; V2 = 2
DREAD DR3, CR14, 102       ; V3 = n = 4

; ============================================
; OPERATION 1: × (V2 × V3 → V4, V5, V6)
; "Multiply 2 by n"
; 2 × 4 = 8 — by repeated addition
; ============================================
IADD DR4, DR0, DR0         ; V4 = 0
IADD DR14, DR3, DR0        ; counter = n
op1_loop:
MCMP DR14, DR0
BRANCHEQ op1_done
IADD DR4, DR4, DR2         ; V4 += 2
ISUB DR14, DR14, DR1       ; counter--
BRANCH op1_loop
op1_done:
IADD DR5, DR4, DR0         ; V5 = 2n
IADD DR6, DR4, DR0         ; V6 = 2n

; ============================================
; OPERATION 2: − (V4 − V1 → V4)
; "2n minus 1"
; ============================================
ISUB DR4, DR4, DR1         ; V4 = 2n - 1 = 7

; ============================================
; OPERATION 3: + (V5 + V1 → V5)
; "2n plus 1"
; ============================================
IADD DR5, DR5, DR1         ; V5 = 2n + 1 = 9

; ============================================
; OPERATION 4: ÷ (V4 ÷ V5 → V11)
; "(2n-1) / (2n+1)" = 7 / 9 = 0 remainder 7
; NOTE: Published as V5÷V4 — typo per
; Bromley (1990). Corrected here.
; ============================================
IADD DR11, DR0, DR0        ; quotient = 0
IADD DR14, DR4, DR0        ; dividend = V4
op4_loop:
MCMP DR14, DR5
BRANCHLT op4_done
ISUB DR14, DR14, DR5       ; dividend -= V5
IADD DR11, DR11, DR1       ; quotient++
BRANCH op4_loop
op4_done:

; ============================================
; OPERATION 5: ÷ (V11 ÷ V2 → V11)
; "Divide coefficient by 2"
; ============================================
SHR DR11, DR11, 1          ; V11 / 2

; ============================================
; OPERATION 6: − (V13 − V11 → V13)
; "Accumulator A0 = 0 − coefficient"
; ============================================
IADD DR13, DR0, DR0        ; V13 = 0
ISUB DR13, DR13, DR11      ; V13 = -V11

; ============================================
; OPERATION 7: − (V3 − V1 → V10)
; "Loop counter = n − 1 = 3"
; ============================================
ISUB DR10, DR3, DR1        ; V10 = 4 - 1 = 3

; ============================================
; OPERATION 8: + (V2 + V7 → V7)
; "Set denominator counter = 2"
; ============================================
IADD DR7, DR2, DR0         ; V7 = 2

; ============================================
; OPERATION 9: ÷ (V6 ÷ V7 → V11)
; "2n / counter" = 8 / 2 = 4
; ============================================
IADD DR11, DR0, DR0        ; quotient = 0
IADD DR14, DR6, DR0        ; dividend = V6
op9_loop:
MCMP DR14, DR7
BRANCHLT op9_done
ISUB DR14, DR14, DR7
IADD DR11, DR11, DR1       ; quotient++
BRANCH op9_loop
op9_done:

; ============================================
; OPERATION 10: × (V21 × V11 → V12)
; "B1 × coefficient"
; B1 = 1 (integer stand-in for 1/6)
; 1 × 4 = 4 — multiplication loop
; ============================================
DREAD DR15, CR14, 103       ; DR15 = B1 = 1
IADD DR12, DR0, DR0        ; V12 = 0
IADD DR14, DR11, DR0       ; counter = V11
op10_loop:
MCMP DR14, DR0
BRANCHEQ op10_done
IADD DR12, DR12, DR15      ; V12 += B1
ISUB DR14, DR14, DR1       ; counter--
BRANCH op10_loop
op10_done:

; ============================================
; OPERATION 11: + (V12 + V13 → V13)
; "Accumulate: sum += B1 × A1"
; ============================================
IADD DR13, DR12, DR13      ; V13 += V12

; ============================================
; OPERATION 12: − (V10 − V1 → V10)
; "Decrement loop counter"
; ============================================
ISUB DR10, DR10, DR1       ; V10 = 3 - 1 = 2

; ============================================
; OPERATION 13: − (V6 − V1 → V6)
; "Decrement working variable"
; ============================================
ISUB DR6, DR6, DR1         ; V6 = 8 - 1 = 7

; ============================================
; OPERATION 14: + (V1 + V7 → V7)
; "Increment denominator"
; ============================================
IADD DR7, DR1, DR7         ; V7 = 2 + 1 = 3

; ============================================
; OPERATION 15: ÷ (V6 ÷ V7 → V8)
; "Fraction part" = 7 / 3 = 2
; ============================================
IADD DR8, DR0, DR0         ; quotient = 0
IADD DR14, DR6, DR0        ; dividend = V6
op15_loop:
MCMP DR14, DR7
BRANCHLT op15_done
ISUB DR14, DR14, DR7
IADD DR8, DR8, DR1
BRANCH op15_loop
op15_done:

; ============================================
; OPERATION 16: × (V8 × V11 → V11)
; "Update coefficient" = 2 × 4 = 8
; ============================================
IADD DR14, DR11, DR0       ; save old V11
IADD DR11, DR0, DR0        ; V11 = 0
IADD DR15, DR8, DR0        ; counter = V8
op16_loop:
MCMP DR15, DR0
BRANCHEQ op16_done
IADD DR11, DR11, DR14      ; V11 += old V11
ISUB DR15, DR15, DR1       ; counter--
BRANCH op16_loop
op16_done:

; ============================================
; OPERATION 17: − (V6 − V1 → V6)
; "Decrement working variable"
; ============================================
ISUB DR6, DR6, DR1         ; V6 = 7 - 1 = 6

; ============================================
; OPERATION 18: + (V1 + V7 → V7)
; "Increment denominator"
; ============================================
IADD DR7, DR1, DR7         ; V7 = 3 + 1 = 4

; ============================================
; OPERATION 19: ÷ (V6 ÷ V7 → V9)
; "Fraction part" = 6 / 4 = 1
; ============================================
IADD DR9, DR0, DR0         ; quotient = 0
IADD DR14, DR6, DR0        ; dividend = V6
op19_loop:
MCMP DR14, DR7
BRANCHLT op19_done
ISUB DR14, DR14, DR7
IADD DR9, DR9, DR1
BRANCH op19_loop
op19_done:

; ============================================
; OPERATION 20: × (V9 × V11 → V11)
; "Coefficient → A3" = 1 × 8 = 8
; ============================================
IADD DR14, DR11, DR0       ; save V11
IADD DR11, DR0, DR0        ; V11 = 0
IADD DR15, DR9, DR0        ; counter = V9
op20_loop:
MCMP DR15, DR0
BRANCHEQ op20_done
IADD DR11, DR11, DR14
ISUB DR15, DR15, DR1
BRANCH op20_loop
op20_done:

; ============================================
; OPERATION 21: × (V22 × V11 → V12)
; "B3 × coefficient"
; B3 = 1 (integer stand-in for -1/30)
; ============================================
DREAD DR15, CR14, 104       ; DR15 = B3 = 1
IADD DR12, DR0, DR0        ; V12 = 0
IADD DR14, DR11, DR0       ; counter = V11
op21_loop:
MCMP DR14, DR0
BRANCHEQ op21_done
IADD DR12, DR12, DR15      ; V12 += B3
ISUB DR14, DR14, DR1       ; counter--
BRANCH op21_loop
op21_done:

; ============================================
; OPERATION 22: + (V12 + V13 → V13)
; "Accumulate: sum += B3 × A3"
; ============================================
IADD DR13, DR12, DR13      ; V13 += V12

; ============================================
; OPERATION 23: − (V10 − V1 → V10)
; "Decrement loop counter"
; ============================================
ISUB DR10, DR10, DR1       ; V10 = 2 - 1 = 1

; ============================================
; Ada writes: "Here follows a repetition of
; Operations thirteen to twenty-three."
; The inner loop repeats for each Bernoulli
; term. For B7, it runs twice: once for B3
; (above), once for B5 (below).
; ============================================

; --- Second iteration: B5 term ---
; OPERATION 13b: V6 = V6 - V1
ISUB DR6, DR6, DR1         ; V6 = 6 - 1 = 5

; OPERATION 14b: V7 = V1 + V7
IADD DR7, DR1, DR7         ; V7 = 4 + 1 = 5

; OPERATION 15b: V8 = V6 / V7 = 5/5 = 1
IADD DR8, DR0, DR0
IADD DR14, DR6, DR0
op15b_loop:
MCMP DR14, DR7
BRANCHLT op15b_done
ISUB DR14, DR14, DR7
IADD DR8, DR8, DR1
BRANCH op15b_loop
op15b_done:

; OPERATION 16b: V11 = V8 × V11 = 1 × 8 = 8
IADD DR14, DR11, DR0
IADD DR11, DR0, DR0
IADD DR15, DR8, DR0
op16b_loop:
MCMP DR15, DR0
BRANCHEQ op16b_done
IADD DR11, DR11, DR14
ISUB DR15, DR15, DR1
BRANCH op16b_loop
op16b_done:

; OPERATION 17b: V6 = V6 - V1
ISUB DR6, DR6, DR1         ; V6 = 5 - 1 = 4

; OPERATION 18b: V7 = V1 + V7
IADD DR7, DR1, DR7         ; V7 = 5 + 1 = 6

; OPERATION 19b: V9 = V6 / V7 = 4/6 = 0
IADD DR9, DR0, DR0
IADD DR14, DR6, DR0
op19b_loop:
MCMP DR14, DR7
BRANCHLT op19b_done
ISUB DR14, DR14, DR7
IADD DR9, DR9, DR1
BRANCH op19b_loop
op19b_done:

; OPERATION 20b: V11 = V9 × V11 = 0 × 8 = 0
IADD DR14, DR11, DR0
IADD DR11, DR0, DR0
IADD DR15, DR9, DR0
op20b_loop:
MCMP DR15, DR0
BRANCHEQ op20b_done
IADD DR11, DR11, DR14
ISUB DR15, DR15, DR1
BRANCH op20b_loop
op20b_done:

; OPERATION 21b: V12 = V23 × V11 = B5 × 0 = 0
DREAD DR15, CR14, 105       ; DR15 = B5 = 1
IADD DR12, DR0, DR0
IADD DR14, DR11, DR0
op21b_loop:
MCMP DR14, DR0
BRANCHEQ op21b_done
IADD DR12, DR12, DR15
ISUB DR14, DR14, DR1
BRANCH op21b_loop
op21b_done:

; OPERATION 22b: V13 = V12 + V13
IADD DR13, DR12, DR13

; OPERATION 23b: V10 = V10 - V1
ISUB DR10, DR10, DR1       ; V10 = 1 - 1 = 0

; ============================================
; OPERATION 24: − (V24 − V13 → V24)
; "Final result: B7 = −accumulated sum"
; ============================================
IADD DR15, DR0, DR0        ; V24 = 0
ISUB DR15, DR15, DR13      ; V24 = -V13

; ============================================
; OPERATION 25: + (V1 + V3 → V3)
; "Increment n for next Bernoulli number"
; ============================================
IADD DR3, DR1, DR3         ; V3 = 4 + 1 = 5

; ============================================
; Result: DR15 = B7 (negated accumulator)
; DR13 = accumulated sum of Bk × Ak terms
;
; Ada, 1843: "The Analytical Engine weaves
; algebraical patterns just as the Jacquard
; loom weaves flowers and leaves."
;
; The first program — running 181 years later
; inside a capability-secured namespace where
; no instruction can escape its lump.
; ============================================
HALT

; --- Data table (Ada's Store constants) ---
; Placed at offset 100 via .org directive.
; DREAD DR, CR14, offset reads these values (CR14 code lump exception).
.org 100
.word 1                    ; offset 100: V1 = 1
.word 2                    ; offset 101: V2 = 2
.word 4                    ; offset 102: V3 = n = 4
.word 1                    ; offset 103: B1 (stand-in)
.word 1                    ; offset 104: B3 (stand-in)
.word 1                    ; offset 105: B5 (stand-in)
`,
        'ada_note_g_published_bug': `-- ============================================================
-- Abstraction:  NoteGPublishedBug
-- Description:  Ada's Note G with Op 4 operand order as published (incorrect)
-- Author:       Church Machine Educational Platform
-- Version:      1.0
-- Created:      2026-05-09
-- Language:     Symbolic Math
-- Dependencies: None
-- ============================================================
-- Methods:
--   1. compute() — 25 operations with Ada's published (buggy) Op 4; result ≠ -1/30
-- ============================================================
-- Ada Lovelace — Note G (1843)
-- The First Computer Program — PUBLISHED (BUGGY) VERSION
-- Computes B7 with Ada's original (incorrect) Op 4 operand order.
--
-- Op 4 is left exactly as Ada published it: V5 / V4 (= 9/7) instead of
-- the corrected V4 / V5 (= 7/9). Every other operation is identical to
-- simulator/cloomc/ada_note_g.cloomc.
--
-- Expected result in DR24: 139/630 ≈ 0.2206  (NOT -1/30)
--
-- The error propagates as follows:
--   Op 4:  V11 = 9/7   (should be 7/9)
--   Op 5:  V11 = 9/14  (should be 7/18)
--   Op 6:  V13 = -9/14 (should be -7/18)  — accumulator seeded wrongly
--   Op 9 resets V11 from V6/V7, so V11 re-converges from Op 9 onward;
--   the Ak coefficient arithmetic (Ops 13-20) is unaffected.
--   Op 11: V13 = 1/42  (should be 5/18)   — coincidentally equals B5
--   Op 22a: V13 = -31/70 (should be -17/90)
--   Op 22b: V13 = -139/630 (should be 1/30)
--   Op 24:  V24 = 139/630  (should be -1/30)
--
-- See docs/ada-note-g.md §"Bug Propagation Table" for the full step-by-step
-- divergence, and §"Buggy-Path Simulator Variant" for how to run this file.
--
-- Variable mapping follows Ada's original (identical to ada_note_g.cloomc):
--   V1  = 1 (constant)
--   V2  = 2 (constant)
--   V3  = n = 4 (for B7)
--   V4  = working: 2n, then 2n-1
--   V5  = working: 2n, then 2n+1
--   V6  = working: 2n, decrements through loop
--   V7  = denominator counter
--   V8  = fraction quotient (first ratio per loop pass)
--   V9  = fraction quotient (second ratio per loop pass)
--   V10 = loop counter
--   V11 = working coefficient (Ak)
--   V12 = product Bk * Ak
--   V13 = accumulator (running sum) — carries the wrong value throughout
--   V21 = B1 = 1/6  (pre-loaded; consumed in Op 10)
--   V22 = Bk = B3 = -1/30 initially; advances to B5 = 1/42 after first loop pass
--   V23 = B5 = 1/42 (pre-loaded; used to advance V22 inside the loop)
--   V24 = result (Ada's original result column) — will show 139/630, NOT -1/30

abstraction NoteGPublishedBug {
    capabilities {
    }

    method compute() {
        -- Initialize Ada's Store columns
        let V1 = 1
        let V2 = 2
        let V3 = 4

        -- Pre-load previously computed Bernoulli numbers into Ada's Store
        -- (identical to the corrected version)
        let V21 = 1 / 6       -- B1
        let V22 = -1 / 30     -- B3
        let V23 = 1 / 42      -- B5

        -- Operation 1: multiply V2 * V3 -> V4, V5, V6
        -- "Multiply 2 by n" = 2 * 4 = 8
        let V4, V5, V6 = V2 * V3

        -- Operation 2: subtract V4 - V1 -> V4
        -- "2n minus 1" = 7
        let V4 = V4 - V1

        -- Operation 3: add V5 + V1 -> V5
        -- "2n plus 1" = 9
        let V5 = V5 + V1

        -- Operation 4: divide V5 / V4 -> V11
        -- BUG: Ada's published table lists V5 as dividend and V4 as divisor.
        -- This gives (2n+1)/(2n-1) = 9/7 instead of the intended 7/9.
        -- The corrected form (V4/V5) is in ada_note_g.cloomc.
        let V11 = V5 / V4

        -- Operation 5: divide V11 / V2 -> V11
        -- Propagated bug: 9/7 / 2 = 9/14 (should be 7/18)
        let V11 = V11 / V2

        -- Operation 6: subtract V13 - V11 -> V13
        -- Propagated bug: A0 = 0 - 9/14 = -9/14 (should be -7/18)
        let V13 = 0
        let V13 = V13 - V11

        -- Operation 7: subtract V3 - V1 -> V10
        -- "Loop counter = n - 1 = 3" — unaffected by the bug
        let V10 = V3 - V1

        -- Operation 8: add V2 + V7 -> V7
        -- "Set denominator counter = 2" — unaffected
        let V7 = V2

        -- Operation 9: divide V6 / V7 -> V11
        -- "2n / counter" = 8 / 2 = 4 — resets V11 from V6/V7; same in both versions
        let V11 = V6 / V7

        -- Operation 10: multiply B1 * V11 -> V12
        -- "B1 * A1" = (1/6) * 4 = 2/3 — same in both versions
        let V12 = V21 * V11

        -- Operation 11: add V12 + V13 -> V13
        -- Propagated bug: 2/3 + (-9/14) = 28/42 - 27/42 = 1/42
        -- (should be 5/18; coincidentally equals B5 = 1/42)
        let V13 = V12 + V13

        -- Operation 12: subtract V10 - V1 -> V10
        -- "Decrement loop counter" = 2 — unaffected
        let V10 = V10 - V1

        -- Operations 13-23: Loop body (repeats for each subsequent Bk term)
        -- V11 is identical to the corrected version throughout; only V13 differs.
        repeat V10 as V10

            -- Operation 13: subtract V6 - V1 -> V6
            let V6 = V6 - V1

            -- Operation 14: add V1 + V7 -> V7
            let V7 = V1 + V7

            -- Operation 15: divide V6 / V7 -> V8
            let V8 = V6 / V7

            -- Operation 16: multiply V8 * V11 -> V11
            let V11 = V8 * V11

            -- Operation 17: subtract V6 - V1 -> V6
            let V6 = V6 - V1

            -- Operation 18: add V1 + V7 -> V7
            let V7 = V1 + V7

            -- Operation 19: divide V6 / V7 -> V9
            let V9 = V6 / V7

            -- Operation 20: multiply V9 * V11 -> V11
            let V11 = V9 * V11

            -- Operation 21: multiply Bk * V11 -> V12
            -- V22 holds the current Bk — same values as corrected version
            let V12 = V22 * V11

            -- Operation 22: add V12 + V13 -> V13
            -- Propagated bug accumulates:
            --   pass 1: -7/15 + 1/42  = -31/70  (should be -17/90)
            --   pass 2:  2/9  + (-31/70) = -139/630 (should be 1/30)
            let V13 = V12 + V13

            -- Advance Bk register (same as corrected version)
            let V22 = V23

        end

        -- Operation 24: subtract 0 - V13 -> V24
        -- Propagated bug: 0 - (-139/630) = 139/630 (should be -1/30)
        let V24 = 0
        let V24 = V24 - V13

        -- Operation 25: add V1 + V3 -> V3
        -- "Increment n for next Bernoulli number" — unaffected
        let V3 = V1 + V3

        -- Result: V24 = 139/630 (WRONG — confirms the Bug Propagation Table)
        -- The correct result is -1/30; see ada_note_g.cloomc.
        halt
    }
}
`,
        'capability_test': `; ============================================================
; Abstraction:  CapabilityTest
; Description:  Church Machine capability-based self-test: LOAD, TPERM, CALL
; Author:       Church Machine Educational Platform
; Version:      1.1
; Created:      2026-05-09
; Language:     Assembly
; Dependencies: None
; ============================================================
; Methods:
;   1. test1_load — LOAD all system abstractions from boot C-List
;   2. test2_tperm_pass — TPERM: verify E/RW permissions pass
;   3. test3_tperm_fail — TPERM: verify L permission fails (Z=0)
;   4. test4_conditional — LOADEQ/LOADNE conditional loads
;   5. test5_switch — SWITCH register swap
;   6. test6_turing — IADD, ISUB, MCMP, SHL, SHR arithmetic
;   7. test7_call — CALL Salvation via named method selectors
;   8. test8_eloadcall — ELOADCALL fused Load+TPERM+Call
; ============================================================

capabilities {
    Salvation E,
    Navana E,
    Mint E,
    Memory E,
    LED RW,
    UART RW
}

; ============================================
; Church Machine Self-Test
; Tests opcodes using boot C-List (12 entries)
; Boot must complete before assembling
; ============================================
;
; Two-operand shorthand and named method selectors are used throughout (recommended).
; Each line shows the raw equivalent in the trailing comment.
;
; Boot C-List layout (indices into the boot thread's c-list; NS slot in parens):
;   [0] Boot.NS (NS 0)  [1] Thread (NS 1)  [2] Boot.Abstr E-GT (NS 3)
;   [3] (empty)  [4] Salvation (E, NS 4)  [5] Navana (E, NS 5)
;   [6] Mint (E) [7] Memory (E)
;   [8] LED (RW) [9] UART (RW) [10] BTN (R) [11] TIMER (RW)

; --- TEST 1: LOAD system abstractions (two-operand shorthand) ---
LOAD CR0, Salvation    ; CR0 = Salvation (E)   — equiv: LOAD CR0, CR6, 4
LOAD CR1, Navana       ; CR1 = Navana    (E)   — equiv: LOAD CR1, CR6, 5
LOAD CR2, Mint         ; CR2 = Mint      (E)   — equiv: LOAD CR2, CR6, 6
LOAD CR3, Memory       ; CR3 = Memory    (E)   — equiv: LOAD CR3, CR6, 7
LOAD CR4, LED          ; CR4 = LED       (RW)  — equiv: LOAD CR4, CR6, 8
LOAD CR5, UART         ; CR5 = UART      (RW)  — equiv: LOAD CR5, CR6, 9

; --- TEST 2: TPERM - permission checks ---
TPERM CR0, E           ; Salvation has E? PASS (Z=1)
TPERM CR1, E           ; Navana has E? PASS (Z=1)
TPERM CR4, RW          ; LED has R+W? PASS (Z=1)
TPERM CR5, RW          ; UART has R+W? PASS (Z=1)

; --- TEST 3: TPERM failure ---
TPERM CR0, L           ; Salvation has L? FAIL (Z=0)

; --- TEST 4: Conditional execution (two-operand shorthand) ---
; Z=0 from failed TPERM above
LOADEQ CR0, Navana     ; SKIP (Z=0, not equal)    — equiv: LOADEQ CR0, CR6, 5
LOADNE CR0, Salvation  ; EXEC (Z=0, is not-equal) — equiv: LOADNE CR0, CR6, 4

; --- TEST 5: SWITCH - swap registers ---
SWITCH CR0, 1          ; CR0 <-> CR1
; Now CR0=Navana, CR1=Salvation
SWITCH CR0, 1          ; Swap back
; CR0=Salvation, CR1=Navana again

; --- TEST 6: Turing ISA ---
IADD DR1, DR0, #42     ; DR1 = 42
IADD DR2, DR1, #8      ; DR2 = 50
ISUB DR3, DR2, DR1     ; DR3 = 8
MCMP DR1, DR2          ; 42 < 50 → N=1, Z=0
IADD DR4, DR0, #1      ; DR4 = 1
SHL DR4, DR4, 3        ; DR4 = 8
SHR DR4, DR4, 1        ; DR4 = 4

; --- TEST 7: CALL (named method selectors) ---
LOAD CR0, Salvation    ; CR0 = Salvation          — equiv: LOAD CR0, CR6, 4
CALL Salvation.main    ; enter Salvation (atomic) — equiv: CALL CR0, 0xF

; --- TEST 8: ELOADCALL - fused Load+TPERM+Call (two-operand shorthand + named method selectors) ---
ELOADCALL CR0, Salvation, main  ; Load + E check + call — equiv: ELOADCALL CR0, CR6, 4

; --- All tests complete ---
HALT
`,
        'system_patterns': `; ============================================================
; Abstraction:  SystemPatterns
; Description:  System-level patterns: load/save, conditional, GC test
; Author:       Church Machine Educational Platform
; Version:      1.0
; Created:      2026-05-09
; Language:     Assembly
; Dependencies: None
; ============================================================
; Methods:
;   1. load_and_save — LOAD/TPERM/CALL sequence using boot C-List
;   2. conditional — TPERM-conditioned LOAD and CALL patterns
;   3. gc_test — PP250 GC cycle exercise with LOAD/TPERM/CALL
; ============================================================

; ── Section 1: Load and Save ──────────────────────────────
; Boot C-List: [4]=Salvation(E) [5]=Navana(E) [8]=LED(RW)
LOAD CR0, CR6, 4       ; CR0 = Salvation (E)
TPERM CR0, E           ; Check E permission → Z=1
LOAD CR1, CR6, 5       ; CR1 = Navana (E)
TPERM CR1, E           ; Check E → Z=1
LOAD CR2, CR6, 8       ; CR2 = LED (RW)
TPERM CR2, RW          ; Check R+W → Z=1
CALL CR0, 0xF          ; CALL Salvation (atomic dispatch)
HALT

; ── Section 2: Conditional Execution ──────────────────────
; Boot C-List: [4]=Salvation(E) [5]=Navana(E) [8]=LED(RW)
LOAD CR0, CR6, 4       ; Load Salvation (E)
TPERM CR0, E           ; Check E — sets Z=1 (pass)
LOADEQ CR1, CR6, 5    ; Load Navana only if equal (Z=1) → EXEC
CALLNE CR0, 0xF       ; SKIP (Z=1, so NE is false)
TPERM CR0, L           ; Salvation has L? FAIL → Z=0
LOADEQ CR2, CR6, 6    ; SKIP (Z=0, not equal)
LOADNE CR2, CR6, 7    ; EXEC (Z=0, is not-equal) → Memory
HALT

; ── Section 3: GC Test (PP250) ────────────────────────────
; Boot C-List: [4]=Salvation(E) [5]=Navana(E) [6]=Mint(E) [7]=Memory(E)
LOAD CR0, CR6, 4       ; CR0 = Salvation (E)
LOAD CR1, CR6, 5       ; CR1 = Navana    (E)
LOAD CR2, CR6, 6       ; CR2 = Mint      (E)
LOAD CR3, CR6, 7       ; CR3 = Memory    (E)
LOAD CR4, CR6, 8       ; CR4 = LED       (RW)
TPERM CR0, E           ; Salvation has E? PASS
TPERM CR1, E           ; Navana has E? PASS
TPERM CR2, E           ; Mint has E? PASS
TPERM CR3, E           ; Memory has E? PASS
TPERM CR4, RW          ; LED has R+W? PASS
CALL CR0, 0xF          ; Direct mode: enter Salvation (atomic dispatch)
HALT
`,
        'compute_demo': `; ============================================================
; Abstraction:  ComputeDemo
; Description:  Bernoulli sum identity and Turing ISA exercise
; Author:       Church Machine Educational Platform
; Version:      1.0
; Created:      2026-05-09
; Language:     Assembly
; Dependencies: None
; ============================================================
; Methods:
;   1. bernoulli_sum — Bernoulli sum S(n) = n(n+1)/2 (Ada's insight)
;   2. turing_test — Exercise IADD, ISUB, MCMP, BRANCH, SHL, SHR
; ============================================================

; ── Section 1: Bernoulli Sum Identity ──────────────────────
; Bernoulli Sum Identity — Pure Turing Arithmetic
; Computes S(n) = 1 + 2 + ... + n = n(n+1)/2
; Ada's insight: summation formulas ARE Bernoulli numbers
; B0 = 1, and sum(k, k=1..n) = n²/2 + n*B0/1
;
; Uses only boot-level Turing instructions:
; IADD, ISUB, MCMP, BRANCH, SHR

; --- Setup ---
IADD DR1, DR0, #10     ; n = 10
IADD DR2, DR1, #1      ; DR2 = n + 1 = 11

; --- Software multiply: DR3 = n * (n+1) ---
IADD DR3, DR0, DR0     ; product = 0
IADD DR4, DR2, DR0     ; counter = n + 1
mul:
MCMP DR4, DR0          ; counter == 0?
BRANCHEQ div           ; → done with multiply
IADD DR3, DR3, DR1     ; product += n
ISUB DR4, DR4, #1      ; counter--
BRANCH mul

; --- Divide by 2 ---
div:
SHR DR3, DR3, 1        ; DR3 = n(n+1)/2 = 55

; --- Verify by loop: DR5 = 1+2+...+n ---
IADD DR5, DR0, DR0     ; sum = 0
IADD DR6, DR0, #1      ; k = 1
loop:
MCMP DR6, DR1          ; k > n?
BRANCHGT done          ; → finished
IADD DR5, DR5, DR6     ; sum += k
IADD DR6, DR6, #1      ; k++
BRANCH loop

done:
; DR3 = 55 (formula), DR5 = 55 (loop) — match!

; ── Section 2: Turing ISA Test ────────────────────────
; Exercises IADD, ISUB, MCMP, BRANCH, SHL, SHR
;
; Turing ISA (11 instructions):
;   DREAD, DWRITE, BFEXT, BFINS  (R/W via GT)
;   MCMP, IADD, ISUB, BRANCH
;   SHL, SHR (logical/arithmetic)
;   RETURN (shared with Church)

; --- Initialize DR1 = 0 ---
IADD DR1, DR0, DR0     ; DR1 = 0 (Z=1)

; --- Load system abstractions (boot C-List) ---
LOAD CR0, CR6, 4       ; CR0 = Salvation (E)
TPERM CR0, E           ; Verify E → Z=1

; --- Integer arithmetic ---
IADD DR3, DR1, DR2     ; DR3 = DR1 + DR2
ISUB DR4, DR3, DR1     ; DR4 = DR3 - DR1

; --- MCMP: compare DR4 vs DR2 ---
MCMP DR4, DR2          ; Should be equal (Z=1)
BRANCHEQ +2            ; Skip if equal
IADD DR5, DR1, DR1     ; Skipped

; --- MCMP: nonzero compare ---
MCMP DR3, DR4          ; DR3 vs DR4
BRANCHNE +2            ; Skip if not equal
ISUB DR6, DR1, DR1     ; Skipped if equal

; --- Zero flag test ---
ISUB DR7, DR3, DR3     ; DR7 = 0 (Z=1)
BRANCHEQ +2            ; Branch taken
IADD DR8, DR1, DR1     ; Skipped

; --- SHL: Shift left ---
IADD DR9, DR3, DR0     ; DR9 = DR3 (copy)
SHL DR10, DR9, 4       ; DR10 = DR9 << 4

; --- SHR: Logical shift right ---
SHR DR11, DR10, 2      ; DR11 = DR10 >> 2

; --- SHR: Arithmetic shift right ---
ISUB DR12, DR0, DR3    ; DR12 = negative
SHR DR13, DR12, 1, ASR ; DR13 sign-extending

; --- Verify: SHL then SHR restores ---
SHL DR14, DR3, 8       ; DR14 = DR3 << 8
SHR DR15, DR14, 8      ; DR15 = DR14 >> 8
MCMP DR15, DR3         ; Should be equal (Z=1)

HALT`,
        'salvation': `; ============================================================
; Abstraction:  Salvation
; Description:  Boot entry points \u2014 demonstrates .main on all four
;               system abstractions (Salvation, Navana, Mint, Memory)
; Author:       Church Machine Educational Platform
; Version:      1.2
; Created:      2026-05-09
; Language:     Assembly
; Dependencies: None
; ============================================================
; Methods:
;   1. main \u2014 LOAD + TPERM + CALL .main for each boot abstraction
; ============================================================

capabilities {
    Salvation E
    Navana    E
    Mint      E
    Memory    E
}

; ============================================
; Boot Abstraction Entry Points
; Each boot-level abstraction exposes a named
; 'main' selector \u2014 the canonical entry point.
; Use dot-notation: CALL AbstrName.main
; The assembler resolves the method index for
; you so code stays correct if selectors change.
; ============================================

; \u2500\u2500 Salvation \u2014 NS[4], 'main' at index 14 (selector 0xF) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
; GT guardian: issues, revokes, transfers, and audits GTs.
; Transitions to Navana (does not RETURN).
LOAD CR0, Salvation    ; CR0 = Salvation (E)
TPERM CR0, E           ; Verify E permission
CALL Salvation.main    ; selector 0xF \u2014 equiv: CALL CR0, 15

; \u2500\u2500 Navana \u2014 NS[5], 'main' at index 7 (selector 8) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
; Namespace guardian: allocates, releases, resolves NS slots.
; Runs indefinitely as namespace controller.
LOAD CR1, Navana       ; CR1 = Navana (E)
TPERM CR1, E           ; Verify E permission
CALL Navana.main       ; selector 8 \u2014 equiv: CALL CR1, 8

; \u2500\u2500 Mint \u2014 NS[6], 'main' at index 4 (selector 5) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
; GT issuance: encodes GTs with bounded permissions.
LOAD CR2, Mint         ; CR2 = Mint (E)
TPERM CR2, E           ; Verify E permission
CALL Mint.main         ; selector 5 \u2014 equiv: CALL CR2, 5

; \u2500\u2500 Memory \u2014 NS[7], 'main' at index 5 (selector 6) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
; RAM zone guardian: allocates and releases memory regions.
LOAD CR3, Memory       ; CR3 = Memory (E)
TPERM CR3, E           ; Verify E permission
CALL Memory.main       ; selector 6 \u2014 equiv: CALL CR3, 6

HALT
`,
        'perm_attack': `; ============================================================
; Abstraction:  PermAttack
; Description:  Adversarial permission-violation and TPERM guard tests
; Author:       Church Machine Educational Platform
; Version:      1.0
; Created:      2026-05-09
; Language:     Assembly
; Dependencies: None
; ============================================================
; Methods:
;   1. attack_perm_violations — CALL/DREAD/DWRITE without required permissions → FAULT
;   2. tperm_guard — TPERM E before CALL, failure path, recursive overflow
; ============================================================
;
; ─────────────────────────────────────────────────
; Method 1: attack_perm_violations
; ─────────────────────────────────────────────────
;
; Boot C-List layout:
;   [4] Salvation (E)  [5] Navana (E)
;   [6] Mint (E)       [7] Memory (E)
;   [8] LED (RW)       [9] UART (RW)
;   [10] BTN (R)       [11] TIMER (RW)
;

; --- ATTACK 1: CALL device without E ---
; LED (slot 8) has R+W but no E.
; CALL requires E via mLoad. Should FAULT.
LOAD CR0, CR6, 8       ; CR0 = LED (RW, no E)
CALL CR0, 0xF          ; FAULT: LED lacks E permission

; --- ATTACK 2: DREAD without R ---
; Salvation (slot 4) has E but no R.
; DREAD requires R. Should FAULT.
LOAD CR1, CR6, 4       ; CR1 = Salvation (E only)
DREAD DR1, CR1, 0      ; FAULT: Salvation lacks R permission

; --- ATTACK 3: DWRITE without W ---
; BTN (slot 10) has R only, no W.
; DWRITE requires W. Should FAULT.
LOAD CR2, CR6, 10      ; CR2 = BTN (R only)
DWRITE DR1, CR2, 0     ; FAULT: BTN lacks W permission

; --- If we get here, something is broken ---
HALT

; ─────────────────────────────────────────────────
; Method 2: tperm_guard
; ─────────────────────────────────────────────────
;
; Three tests in one run:
;   1. CALL guard — TPERM checks E on Salvation. Z=1 → CALL; Z=0 → HALT.
;   2. TPERM failure — check RW on Salvation (has E only). Z=0 confirms failure.
;   3. Recursive CALL — self-call via Boot.Abstr (~15 frames → BOUNDS FAULT).
;
; NOTE: Salvation has handler methods so CALL dispatches atomically.
; Boot.Abstr is our own code — CALL pushes a real 2-word stack frame.

; --- TEST 1: CALL guard (TPERM E) ---
LOAD CR0, CR6, 4
TPERM CR0, E           ; Z=1 if Execute permitted
BRANCHEQ tperm_ok
HALT                   ; Fail: E permission missing
tperm_ok:
CALL CR0, 0            ; Call Salvation — handler, no frame pushed

; --- TEST 2: TPERM failure (check RW on E-only token) ---
TPERM CR0, RW          ; Z=0: Salvation has E only, not RW
BRANCHEQ tperm_fail    ; If somehow Z=1, that is wrong → fall to test 3
tperm_fail:

; --- TEST 3: Recursive CALL overflow ---
LOAD CR3, CR6, 2       ; Boot.Abstr (our own code, no handler)
recurse:
CALL CR3, 0            ; Push 2-word frame each time
BRANCH recurse         ; Unreachable: BOUNDS FAULT terminates first

HALT`,
        'bind_attack': `; ============================================================
; Abstraction:  BindAttack
; Description:  Adversarial bind-bit enforcement test — SAVE without B=1 must FAULT
; Author:       Church Machine Educational Platform
; Version:      1.0
; Created:      2026-05-09
; Language:     Assembly
; Dependencies: None
; ============================================================
; Methods:
;   1. attack_save_no_b — SAVE without B bit set → FAULT
; ============================================================
;
; ============================================
; ADVERSARIAL TEST: B-Bit Enforcement
; Tests TWO security boundaries:
;   1. SAVE requires B=1 (B defaults to 0)
;   2. CALL auto-clears B on passed GTs
; ============================================
;
; B-bit security model:
;   B defaults to 0 on namespace entries.
;   SAVE checks B=1 before committing.
;   CALL auto-clears B on all preserved CRs.
;   TPERM with B mask is the ONLY way to
;   allow bind (delegation).
; ============================================

; --- ATTACK 1: SAVE with default B=0 ---
; After boot, B defaults to 0 on all entries.
; SAVE should FAULT because B=0.
LOAD CR0, CR6, 4       ; CR0 = Salvation (E, B=0)
SAVE CR0, CR6, 3       ; FAULT: B=0, cannot bind to empty slot 3

; --- If we get here, B-bit default failed ---
HALT`,
        'dijkstra_flag': `; ============================================================
; Abstraction:  DijkstraFlag
; Description:  Flag-based synchronisation — Test, Signal,
;               Wait, and Reset a shared flag object
; Author:       Church Machine Educational Platform
; Version:      1.0
; Created:      2026-05-13
; Language:     Assembly
; Dependencies: DijkstraFlag (NS[10])
; ============================================================
; Methods demonstrated:
;   DijkstraFlag.Test()    — read flag state non-destructively
;                            DR1 = 1 signaled | 0 unsignaled
;   DijkstraFlag.Signal()  — raise the flag (mark signaled)
;   DijkstraFlag.Wait()    — block until flag is signaled
;   DijkstraFlag.Reset()   — lower the flag (mark unsignaled)
; ============================================================

capabilities {
    DijkstraFlag E
}

;
; DijkstraFlag is a one-bit synchronisation object.  A thread
; calls Signal to raise it and Wait to block until raised.
; Reset returns it to the unsignaled state.  Test reads the
; state non-destructively without consuming the signal.
;
; Typical producer/consumer pattern:
;   Producer thread:  CALL DijkstraFlag.Signal
;   Consumer thread:  CALL DijkstraFlag.Wait   (blocks until signaled)
;                     CALL DijkstraFlag.Reset   (consume — ready for next cycle)
;
; Input convention:
;   CR0 = DijkstraFlag capability (loaded below)
;   No data registers required for any method
;
; ── Load and verify DijkstraFlag capability ──────────────────
LOAD CR0, DijkstraFlag    ; CR0 = DijkstraFlag (E, NS[10])
TPERM CR0, E              ; Verify E permission → Z=1

; ── Section 1: Test initial state (should be unsignaled) ─────
CALL DijkstraFlag.Test    ; DR1 = 0  (unsignaled at boot)

; ── Section 2: Signal the flag ────────────────────────────────
CALL DijkstraFlag.Signal  ; raise flag → DR1 = 1

; ── Section 3: Test again — flag is now signaled ──────────────
CALL DijkstraFlag.Test    ; DR1 = 1  (signaled)

; ── Section 4: Wait — returns immediately (already signaled) ──
CALL DijkstraFlag.Wait    ; DR1 = 1  (flag was already up)

; ── Section 5: Reset the flag ────────────────────────────────
CALL DijkstraFlag.Reset   ; lower flag → DR1 = 0

; ── Section 6: Test final state (unsignaled after reset) ──────
CALL DijkstraFlag.Test    ; DR1 = 0  (unsignaled after reset)

HALT`,
        'post_flash_selftest': `; Church Machine Post-Flash Exhaustive Self-Test v1.1
; ====================================================
; Run after FPGA flash to validate full hardware correctness.
;
; Coverage
; --------
;   SECTION A   Tests   1-15   Data register independence (DR1-DR15)
;   SECTION B   Tests  16-23   IADD arithmetic (zero, sum, identity, Z/N flags)
;   SECTION C   Tests  24-30   ISUB arithmetic (zero, N-flag, C-flag borrow)
;   SECTION D   Tests  31-36   SHL shift-left (carry out, zero result, N-flag)
;   SECTION E   Tests  37-41   SHR LSR (logical right, carry, N-clear)
;   SECTION F   Tests  42-45   SHR ASR (arithmetic right, sign-extension)
;   SECTION G   Tests  46-57   Branch conditions (EQ, NE, CS, CC, MI, PL, GE, LT, GT, LE, HI, LS)
;   SECTION H   Tests  58-62   BFEXT / BFINS bit-field operations
;   SECTION I   Tests  63-73   TPERM presets + domain purity enforcement
;   SECTION J   Tests  74-77   TPERM EXACT credential-pinning assertion
;   SECTION K   Tests  78-79   CHANGE (CR swap) + post-swap permission verify
;   SECTION L   Tests  80-81   LOAD from multiple c-list slots
;
; Result on RETURN:
;   DR0 = 0    all 81 tests passed
;   DR0 = N    test N was the first to fail (fail-fast)
;
; Register conventions
; --------------------
;   DR0       result register (0 = pass; set to N only on first failure)
;   DR1, DR2  primary arithmetic operands / scratch
;   DR3       expected-value comparison scratch
;   DR4-DR15  register-independence pattern storage (Section A only)
;
; C-list slots used (populated by boot image):
;   Slot 7  (Boot.Nucs)  = X-GT  Turing domain  dom=0  perm[2]=X=1
;   Slot 3  (Boot.Abstr) = E-GT  Church domain  dom=1  perm[2]=E=1
;
; Fail-fast pattern (every instruction on its own line, ; is comment):
;   BRANCHEQ ok_N        -- Z=1 = correct, skip fail
;   IADD DR0, DR0, #N    -- set result = test number
;   RETURN               -- return to caller with DR0 = N
; ok_N:
;
; To zero a DR:        ISUB DRn, DRn, DRn   (DRn = DRn - DRn = 0)
; To set DR to N:      ISUB DRn, DRn, DRn   then   IADD DRn, DRn, #N
; To copy DR2→DR1:     IADD DR1, DR2, #0
; RETURN takes no operand (bare RETURN unwinds the call frame).

; ── Initialise ───────────────────────────────────────────────────────────────
    ISUB DR0, DR0, DR0

    LOAD CR1, Boot.Nucs
    LOAD CR2, Boot.Abstr
    LOAD CR3, Boot.Nucs

; ═══════════════════════════════════════════════════════════════════════════════
; SECTION A — Data register independence  (Tests 1-15)
; ═══════════════════════════════════════════════════════════════════════════════
; Fill DR1-DR15 with distinct multiples of 11, then verify each still holds its
; value after all writes complete.  Register-file aliasing would corrupt one
; value when another DR is written.

    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #11
    ISUB DR2, DR2, DR2
    IADD DR2, DR2, #22
    ISUB DR3, DR3, DR3
    IADD DR3, DR3, #33
    ISUB DR4, DR4, DR4
    IADD DR4, DR4, #44
    ISUB DR5, DR5, DR5
    IADD DR5, DR5, #55
    ISUB DR6, DR6, DR6
    IADD DR6, DR6, #66
    ISUB DR7, DR7, DR7
    IADD DR7, DR7, #77
    ISUB DR8, DR8, DR8
    IADD DR8, DR8, #88
    ISUB DR9, DR9, DR9
    IADD DR9, DR9, #99
    ISUB DR10, DR10, DR10
    IADD DR10, DR10, #110
    ISUB DR11, DR11, DR11
    IADD DR11, DR11, #121
    ISUB DR12, DR12, DR12
    IADD DR12, DR12, #132
    ISUB DR13, DR13, DR13
    IADD DR13, DR13, #143
    ISUB DR14, DR14, DR14
    IADD DR14, DR14, #154
    ISUB DR15, DR15, DR15
    IADD DR15, DR15, #165

    ISUB DR1, DR1, #11
    BRANCHEQ tA2
    IADD DR0, DR0, #1
    RETURN
tA2:
    ISUB DR2, DR2, #22
    BRANCHEQ tA3
    IADD DR0, DR0, #2
    RETURN
tA3:
    ISUB DR3, DR3, #33
    BRANCHEQ tA4
    IADD DR0, DR0, #3
    RETURN
tA4:
    ISUB DR4, DR4, #44
    BRANCHEQ tA5
    IADD DR0, DR0, #4
    RETURN
tA5:
    ISUB DR5, DR5, #55
    BRANCHEQ tA6
    IADD DR0, DR0, #5
    RETURN
tA6:
    ISUB DR6, DR6, #66
    BRANCHEQ tA7
    IADD DR0, DR0, #6
    RETURN
tA7:
    ISUB DR7, DR7, #77
    BRANCHEQ tA8
    IADD DR0, DR0, #7
    RETURN
tA8:
    ISUB DR8, DR8, #88
    BRANCHEQ tA9
    IADD DR0, DR0, #8
    RETURN
tA9:
    ISUB DR9, DR9, #99
    BRANCHEQ tA10
    IADD DR0, DR0, #9
    RETURN
tA10:
    ISUB DR10, DR10, #110
    BRANCHEQ tA11
    IADD DR0, DR0, #10
    RETURN
tA11:
    ISUB DR11, DR11, #121
    BRANCHEQ tA12
    IADD DR0, DR0, #11
    RETURN
tA12:
    ISUB DR12, DR12, #132
    BRANCHEQ tA13
    IADD DR0, DR0, #12
    RETURN
tA13:
    ISUB DR13, DR13, #143
    BRANCHEQ tA14
    IADD DR0, DR0, #13
    RETURN
tA14:
    ISUB DR14, DR14, #154
    BRANCHEQ tA15
    IADD DR0, DR0, #14
    RETURN
tA15:
    ISUB DR15, DR15, #165
    BRANCHEQ tBstart
    IADD DR0, DR0, #15
    RETURN

; ═══════════════════════════════════════════════════════════════════════════════
; SECTION B — IADD arithmetic  (Tests 16-23)
; ═══════════════════════════════════════════════════════════════════════════════
; At entry: DR1-DR15 = 0  (zeroed by Section A verify phase)
tBstart:
    ; Test 16: 0 + 0 = 0  (Z=1)
    ISUB DR1, DR1, DR1
    ISUB DR2, DR2, DR2
    IADD DR3, DR1, DR2
    BRANCHEQ tB17
    IADD DR0, DR0, #16
    RETURN
tB17:
    ; Test 17: 5 + 3 = 8  (Z=0 and value = 8)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #5
    ISUB DR2, DR2, DR2
    IADD DR2, DR2, #3
    IADD DR3, DR1, DR2
    BRANCHNE tB17v
    IADD DR0, DR0, #17
    RETURN
tB17v:
    ISUB DR3, DR3, #8
    BRANCHEQ tB18
    IADD DR0, DR0, #17
    RETURN
tB18:
    ; Test 18: 100 + 155 = 255
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #100
    ISUB DR2, DR2, DR2
    IADD DR2, DR2, #155
    IADD DR3, DR1, DR2
    ISUB DR3, DR3, #255
    BRANCHEQ tB19
    IADD DR0, DR0, #18
    RETURN
tB19:
    ; Test 19: DRs + #0 = DRs  (identity with immediate 0)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #42
    IADD DR3, DR1, #0
    ISUB DR3, DR3, #42
    BRANCHEQ tB20
    IADD DR0, DR0, #19
    RETURN
tB20:
    ; Test 20: IADD result Z=0 for nonzero sum
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #7
    IADD DR3, DR1, #0
    BRANCHNE tB21
    IADD DR0, DR0, #20
    RETURN
tB21:
    ; Test 21: commutativity — a+b == b+a
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #37
    ISUB DR2, DR2, DR2
    IADD DR2, DR2, #63
    IADD DR3, DR1, DR2
    IADD DR4, DR2, DR1
    ISUB DR3, DR3, DR4
    BRANCHEQ tB22
    IADD DR0, DR0, #21
    RETURN
tB22:
    ; Test 22: IADD with max 14-bit immediate (16383)
    ISUB DR1, DR1, DR1
    IADD DR3, DR1, #16383
    ISUB DR3, DR3, #16383
    BRANCHEQ tB23
    IADD DR0, DR0, #22
    RETURN
tB23:
    ; Test 23: IADD nonzero + nonzero gives Z=0
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #100
    ISUB DR2, DR2, DR2
    IADD DR2, DR2, #200
    IADD DR3, DR1, DR2
    BRANCHNE tCstart
    IADD DR0, DR0, #23
    RETURN

; ═══════════════════════════════════════════════════════════════════════════════
; SECTION C — ISUB arithmetic  (Tests 24-30)
; ═══════════════════════════════════════════════════════════════════════════════
tCstart:
    ; Test 24: N - N = 0  (Z=1)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #99
    ISUB DR3, DR1, DR1
    BRANCHEQ tC25
    IADD DR0, DR0, #24
    RETURN
tC25:
    ; Test 25: 10 - 3 = 7  (Z=0, value verify)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #10
    ISUB DR2, DR2, DR2
    IADD DR2, DR2, #3
    ISUB DR3, DR1, DR2
    ISUB DR3, DR3, #7
    BRANCHEQ tC26
    IADD DR0, DR0, #25
    RETURN
tC26:
    ; Test 26: 3 - 10 gives N=1 (signed negative result)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #3
    ISUB DR2, DR2, DR2
    IADD DR2, DR2, #10
    ISUB DR3, DR1, DR2
    BRANCHMI tC27
    IADD DR0, DR0, #26
    RETURN
tC27:
    ; Test 27: 0 - 1 gives borrow  (C=0, BRANCHCC)
    ISUB DR1, DR1, DR1
    ISUB DR3, DR1, #1
    BRANCHCC tC28
    IADD DR0, DR0, #27
    RETURN
tC28:
    ; Test 28: 5 - 3 gives no borrow  (C=1, BRANCHCS)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #5
    ISUB DR3, DR1, #3
    BRANCHCS tC29
    IADD DR0, DR0, #28
    RETURN
tC29:
    ; Test 29: subtract immediate to zero
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #200
    ISUB DR3, DR1, #200
    BRANCHEQ tC30
    IADD DR0, DR0, #29
    RETURN
tC30:
    ; Test 30: nonzero ISUB result is nonzero  (Z=0)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #50
    ISUB DR3, DR1, #49
    BRANCHNE tDstart
    IADD DR0, DR0, #30
    RETURN

; ═══════════════════════════════════════════════════════════════════════════════
; SECTION D — SHL shift-left  (Tests 31-36)
; ═══════════════════════════════════════════════════════════════════════════════
tDstart:
    ; Test 31: SHL by 0 leaves value unchanged
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #7
    SHL DR3, DR1, #0
    ISUB DR3, DR3, #7
    BRANCHEQ tD32
    IADD DR0, DR0, #31
    RETURN
tD32:
    ; Test 32: SHL by 1 doubles value  (6 → 12)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #6
    SHL DR3, DR1, #1
    ISUB DR3, DR3, #12
    BRANCHEQ tD33
    IADD DR0, DR0, #32
    RETURN
tD33:
    ; Test 33: SHL by 8 multiplies by 256  (1 → 256)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #1
    SHL DR3, DR1, #8
    ISUB DR3, DR3, #256
    BRANCHEQ tD34
    IADD DR0, DR0, #33
    RETURN
tD34:
    ; Test 34: SHL carry flag — MSB shifted out sets C=1
    ; 0x80000000 << 1 → 0  (Z=1, C=1)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #1
    SHL DR1, DR1, #31
    SHL DR3, DR1, #1
    BRANCHEQ tD34c
    IADD DR0, DR0, #34
    RETURN
tD34c:
    BRANCHCS tD35
    IADD DR0, DR0, #34
    RETURN
tD35:
    ; Test 35: SHL result is negative  (N=1 when bit 31 set)
    ; 1 << 31 = 0x80000000  (N=1)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #1
    SHL DR3, DR1, #31
    BRANCHMI tD36
    IADD DR0, DR0, #35
    RETURN
tD36:
    ; Test 36: SHL by 4 on pattern 0xF gives 0xF0
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #15
    SHL DR3, DR1, #4
    ISUB DR3, DR3, #240
    BRANCHEQ tEstart
    IADD DR0, DR0, #36
    RETURN

; ═══════════════════════════════════════════════════════════════════════════════
; SECTION E — SHR logical right shift  (Tests 37-41)
; ═══════════════════════════════════════════════════════════════════════════════
tEstart:
    ; Test 37: SHR LSR by 0 leaves value unchanged
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #240
    SHR DR3, DR1, #0
    ISUB DR3, DR3, #240
    BRANCHEQ tE38
    IADD DR0, DR0, #37
    RETURN
tE38:
    ; Test 38: SHR LSR by 1 halves an even value  (8 → 4, C=0)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #8
    SHR DR3, DR1, #1
    ISUB DR3, DR3, #4
    BRANCHEQ tE39
    IADD DR0, DR0, #38
    RETURN
tE39:
    ; Test 39: SHR LSR carry flag — bit 0 shifted out sets C=1
    ; 1 >> 1 → 0  (Z=1, C=1)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #1
    SHR DR3, DR1, #1
    BRANCHEQ tE39c
    IADD DR0, DR0, #39
    RETURN
tE39c:
    BRANCHCS tE40
    IADD DR0, DR0, #39
    RETURN
tE40:
    ; Test 40: SHR LSR by 8  (0x800 = 2048 >> 8 = 8)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #1
    SHL DR1, DR1, #11
    SHR DR3, DR1, #8
    ISUB DR3, DR3, #8
    BRANCHEQ tE41
    IADD DR0, DR0, #40
    RETURN
tE41:
    ; Test 41: SHR LSR does not sign-extend  (N=0 after shift of 0x80000000)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #1
    SHL DR1, DR1, #31
    SHR DR3, DR1, #1
    BRANCHPL tFstart
    IADD DR0, DR0, #41
    RETURN

; ═══════════════════════════════════════════════════════════════════════════════
; SECTION F — SHR arithmetic right shift  (Tests 42-45)
; ═══════════════════════════════════════════════════════════════════════════════
tFstart:
    ; Test 42: -1 ASR 1 = -1  (sign extended, Z=0, N=1)
    ISUB DR1, DR1, DR1
    ISUB DR1, DR1, #1
    SHR DR3, DR1, #1 ASR
    ISUB DR3, DR3, DR1
    BRANCHEQ tF43
    IADD DR0, DR0, #42
    RETURN
tF43:
    ; Test 43: -2 ASR 1 gives C=0  (bit 0 of -2 was 0)
    ISUB DR1, DR1, DR1
    ISUB DR1, DR1, #2
    SHR DR3, DR1, #1 ASR
    BRANCHCC tF44
    IADD DR0, DR0, #43
    RETURN
tF44:
    ; Test 44: -1 ASR 1 gives C=1  (bit 0 of -1 was 1)
    ISUB DR1, DR1, DR1
    ISUB DR1, DR1, #1
    SHR DR3, DR1, #1 ASR
    BRANCHCS tF45
    IADD DR0, DR0, #44
    RETURN
tF45:
    ; Test 45: ASR preserves N=1 for any negative input
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #1
    SHL DR1, DR1, #31
    SHR DR3, DR1, #4 ASR
    BRANCHMI tGstart
    IADD DR0, DR0, #45
    RETURN

; ═══════════════════════════════════════════════════════════════════════════════
; SECTION G — Branch conditions  (Tests 46-57)
; ═══════════════════════════════════════════════════════════════════════════════
; Each test forces the required flags using arithmetic, then verifies the
; condition code fires correctly.
tGstart:
    ; Test 46: BRANCHEQ taken when Z=1
    ISUB DR1, DR1, DR1
    BRANCHEQ tG47
    IADD DR0, DR0, #46
    RETURN
tG47:
    ; Test 47: BRANCHNE taken when Z=0
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #1
    ISUB DR3, DR1, #2
    BRANCHNE tG48
    IADD DR0, DR0, #47
    RETURN
tG48:
    ; Test 48: BRANCHCS taken when C=1  (no borrow: 5-3)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #5
    ISUB DR3, DR1, #3
    BRANCHCS tG49
    IADD DR0, DR0, #48
    RETURN
tG49:
    ; Test 49: BRANCHCC taken when C=0  (borrow: 0-1)
    ISUB DR1, DR1, DR1
    ISUB DR3, DR1, #1
    BRANCHCC tG50
    IADD DR0, DR0, #49
    RETURN
tG50:
    ; Test 50: BRANCHMI taken when N=1  (0-1 = 0xFFFFFFFF)
    ISUB DR1, DR1, DR1
    ISUB DR3, DR1, #1
    BRANCHMI tG51
    IADD DR0, DR0, #50
    RETURN
tG51:
    ; Test 51: BRANCHPL taken when N=0  (positive result)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #1
    ISUB DR3, DR1, #0
    BRANCHPL tG52
    IADD DR0, DR0, #51
    RETURN
tG52:
    ; Test 52: BRANCHGE taken when N=V  (10-3=7, N=0, V=0)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #10
    ISUB DR3, DR1, #3
    BRANCHGE tG53
    IADD DR0, DR0, #52
    RETURN
tG53:
    ; Test 53: BRANCHLT taken when N≠V  (3-10=-7, N=1, V=0)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #3
    ISUB DR2, DR2, DR2
    IADD DR2, DR2, #10
    ISUB DR3, DR1, DR2
    BRANCHLT tG54
    IADD DR0, DR0, #53
    RETURN
tG54:
    ; Test 54: BRANCHGT taken when Z=0 and N=V  (10-3=7, Z=0, N=V=0)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #10
    ISUB DR3, DR1, #3
    BRANCHGT tG55
    IADD DR0, DR0, #54
    RETURN
tG55:
    ; Test 55: BRANCHLE taken when Z=1 or N≠V  (5-5=0, Z=1)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #5
    ISUB DR3, DR1, #5
    BRANCHLE tG56
    IADD DR0, DR0, #55
    RETURN
tG56:
    ; Test 56: BRANCHHI taken when C=1 and Z=0  (8-3=5, C=1, Z=0)
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #8
    ISUB DR3, DR1, #3
    BRANCHHI tG57
    IADD DR0, DR0, #56
    RETURN
tG57:
    ; Test 57: BRANCHLS taken when C=0 or Z=1  (borrow: 0-1, C=0)
    ISUB DR1, DR1, DR1
    ISUB DR3, DR1, #1
    BRANCHLS tHstart
    IADD DR0, DR0, #57
    RETURN

; ═══════════════════════════════════════════════════════════════════════════════
; SECTION H — BFEXT / BFINS bit-field operations  (Tests 58-62)
; ═══════════════════════════════════════════════════════════════════════════════
tHstart:
    ; Test 58: BFEXT bits [3:0] from 0xABCD = 0xD = 13
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #16383
    SHL DR1, DR1, #2
    IADD DR1, DR1, #3
    BFEXT DR3, DR1, #0, #4
    ISUB DR3, DR3, #13
    BRANCHEQ tH59
    IADD DR0, DR0, #58
    RETURN
tH59:
    ; Test 59: BFEXT 8-bit field at bit 0 from 0x00AB = 171
    ; Build 0xAB = 171 in DR1
    ISUB DR1, DR1, DR1
    IADD DR1, DR1, #171
    BFEXT DR3, DR1, #0, #8
    ISUB DR3, DR3, #171
    BRANCHEQ tH60
    IADD DR0, DR0, #59
    RETURN
tH60:
    ; Test 60: BFINS lower nibble — insert 0xF into bits [3:0] of 0
    ISUB DR3, DR3, DR3
    ISUB DR2, DR2, DR2
    IADD DR2, DR2, #15
    BFINS DR3, DR2, #0, #4
    ISUB DR3, DR3, #15
    BRANCHEQ tH61
    IADD DR0, DR0, #60
    RETURN
tH61:
    ; Test 61: BFINS upper nibble — insert 0xA into bits [7:4] of 0
    ISUB DR3, DR3, DR3
    ISUB DR2, DR2, DR2
    IADD DR2, DR2, #10
    BFINS DR3, DR2, #4, #4
    ISUB DR3, DR3, #160
    BRANCHEQ tH62
    IADD DR0, DR0, #61
    RETURN
tH62:
    ; Test 62: BFEXT round-trip — insert 7 into bits [7:5], extract back
    ISUB DR3, DR3, DR3
    ISUB DR2, DR2, DR2
    IADD DR2, DR2, #7
    BFINS DR3, DR2, #5, #3
    BFEXT DR1, DR3, #5, #3
    ISUB DR1, DR1, #7
    BRANCHEQ tIstart
    IADD DR0, DR0, #62
    RETURN

; ═══════════════════════════════════════════════════════════════════════════════
; SECTION I — TPERM presets + domain purity  (Tests 63-73)
; ═══════════════════════════════════════════════════════════════════════════════
; CR1 = X-GT  (Turing dom=0, perm[2]=X=1, W=0, R=0)
; CR2 = E-GT  (Church dom=1, perm[2]=E=1, S=0, L=0)
tIstart:
    ; Test 63: X-GT satisfies TPERM X  (Z=1)
    TPERM CR1, X
    BRANCHEQ tI64
    IADD DR0, DR0, #63
    RETURN
tI64:
    ; Test 64: X-GT does NOT satisfy TPERM R  (Z=0: X-GT has no R bit)
    TPERM CR1, R
    BRANCHNE tI65
    IADD DR0, DR0, #64
    RETURN
tI65:
    ; Test 65: X-GT does NOT satisfy TPERM E  (Z=0: domain purity, dom=0 ≠ dom=1)
    TPERM CR1, E
    BRANCHNE tI66
    IADD DR0, DR0, #65
    RETURN
tI66:
    ; Test 66: X-GT does NOT satisfy TPERM L  (Z=0)
    TPERM CR1, L
    BRANCHNE tI67
    IADD DR0, DR0, #66
    RETURN
tI67:
    ; Test 67: X-GT does NOT satisfy TPERM S  (Z=0)
    TPERM CR1, S
    BRANCHNE tI68
    IADD DR0, DR0, #67
    RETURN
tI68:
    ; Test 68: E-GT satisfies TPERM E  (Z=1)
    TPERM CR2, E
    BRANCHEQ tI69
    IADD DR0, DR0, #68
    RETURN
tI69:
    ; Test 69: E-GT does NOT satisfy TPERM X  (Z=0: domain purity, dom=1 ≠ dom=0)
    TPERM CR2, X
    BRANCHNE tI70
    IADD DR0, DR0, #69
    RETURN
tI70:
    ; Test 70: E-GT does NOT satisfy TPERM R  (Z=0)
    TPERM CR2, R
    BRANCHNE tI71
    IADD DR0, DR0, #70
    RETURN
tI71:
    ; Test 71: TPERM CLEAR always succeeds on a valid GT  (Z=1)
    LOAD CR4, Boot.Nucs
    TPERM CR4, CLEAR
    BRANCHEQ tI72
    IADD DR0, DR0, #71
    RETURN
tI72:
    ; Test 72: TPERM RX on X-GT  → Z=0  (X-GT has X but not R)
    LOAD CR4, Boot.Nucs
    TPERM CR4, RX
    BRANCHNE tI73
    IADD DR0, DR0, #72
    RETURN
tI73:
    ; Test 73: TPERM RWX on X-GT  → Z=0  (X-GT has only X; R and W absent)
    LOAD CR4, Boot.Nucs
    TPERM CR4, RWX
    BRANCHNE tJstart
    IADD DR0, DR0, #73
    RETURN

; ═══════════════════════════════════════════════════════════════════════════════
; SECTION J — TPERM EXACT credential-pinning  (Tests 74-77)
; ═══════════════════════════════════════════════════════════════════════════════
; TPERM EXACT asserts bit-for-bit identity of two GT words.
; Match → Z=1.  Mismatch → BIND fault (hard fault, no Z=0 path).
; CR1 and CR3 were both loaded from slot 7 at the top of this program.
tJstart:
    ; Test 74: EXACT on CR1 vs CR3 — both loaded from slot 7  → Z=1
    TPERM CR1, EXACT, CR3
    BRANCHEQ tJ75
    IADD DR0, DR0, #74
    RETURN
tJ75:
    ; Test 75: EXACT is symmetric — CR3 vs CR1 also matches
    TPERM CR3, EXACT, CR1
    BRANCHEQ tJ76
    IADD DR0, DR0, #75
    RETURN
tJ76:
    ; Test 76: Third load from slot 7 must be bit-identical
    LOAD CR5, Boot.Nucs
    TPERM CR1, EXACT, CR5
    BRANCHEQ tJ77
    IADD DR0, DR0, #76
    RETURN
tJ77:
    ; Test 77: E-GT loaded twice from slot 3 must match
    LOAD CR4, Boot.Abstr
    TPERM CR2, EXACT, CR4
    BRANCHEQ tKstart
    IADD DR0, DR0, #77
    RETURN

; ═══════════════════════════════════════════════════════════════════════════════
; SECTION K — CHANGE (CR register swap)  (Tests 78-79)
; ═══════════════════════════════════════════════════════════════════════════════
; CHANGE swaps the full contents of two CRs.
; After swapping CR1 (X-GT) ↔ CR2 (E-GT), permission checks must reverse.
tKstart:
    LOAD CR1, Boot.Nucs
    LOAD CR2, Boot.Abstr
    CHANGE CR1, CR2

    ; Test 78: CR1 is now E-GT → must satisfy TPERM E
    TPERM CR1, E
    BRANCHEQ tK79
    IADD DR0, DR0, #78
    RETURN
tK79:
    ; Test 79: CR2 is now X-GT → must satisfy TPERM X
    TPERM CR2, X
    BRANCHEQ tLstart
    IADD DR0, DR0, #79
    RETURN

; ═══════════════════════════════════════════════════════════════════════════════
; SECTION L — LOAD from multiple c-list slots  (Tests 80-81)
; ═══════════════════════════════════════════════════════════════════════════════
; Reload fresh and verify into different CRs to confirm LOAD coverage.
tLstart:
    LOAD CR1, Boot.Nucs
    LOAD CR2, Boot.Abstr

    ; Test 80: fresh LOAD slot 7 into CR9 → must satisfy TPERM X
    LOAD CR9, Boot.Nucs
    TPERM CR9, X
    BRANCHEQ tL81
    IADD DR0, DR0, #80
    RETURN
tL81:
    ; Test 81: fresh LOAD slot 3 into CR9 → must satisfy TPERM E
    LOAD CR9, Boot.Abstr
    TPERM CR9, E
    BRANCHEQ done
    IADD DR0, DR0, #81
    RETURN

; ═══════════════════════════════════════════════════════════════════════════════
; All 81 tests passed
; ═══════════════════════════════════════════════════════════════════════════════
done:
    ISUB DR0, DR0, DR0
    RETURN`,
        'gt_v1_1_test': `; GT Encoding v1.1 Hardware Self-Test
; =====================================
; A CLOOMC program that exercises the live mLoad capability pipeline to
; verify that the dom+perm GT word layout is working correctly in hardware/sim.
;
; What is being tested:
;
;   The v1.1 GT word compresses six permission bits (R,W,X,L,S,E) into four
;   bits using Turing/Church mutual exclusion:
;
;     [31]    b_flag
;     [30:28] perm[2:0]  — {X,W,R} when dom=0 (Turing) or {E,S,L} when dom=1 (Church)
;     [27]    dom        — 0=Turing {XWR}, 1=Church {ESL}
;     [25]    f_flag     — Far indicator (per-token)
;     [24:23] gt_type
;     [22:16] gt_seq
;     [15:0]  slot_id
;
;   Domain purity is structurally enforced: a Church GT (dom=1) carries only
;   E/S/L bits, never X/W/R.  A Turing GT (dom=0) carries only X/W/R, never E.
;
;   TPERM EXACT (preset 14, new in v1.1) performs a 32-bit word-for-word
;   identity assertion between two CRs.  It is a credential-pinning instruction:
;   match → Z=1; mismatch → BIND fault (same semantics as an mLoad failure).
;   There is no Z=0 path — EXACT has no alternative meaning.
;
; C-list slots used (populated by boot image):
;
;   Slot 7  (Boot.Nucs)  — X-GT: Turing domain, dom=0, perm[2]=X=1
;   Slot 3  (Boot.Abstr) — E-GT: Church domain, dom=1, perm[2]=E=1
;
; Result protocol:
;   DR0 = 0        all five tests passed
;   DR0 = 1..5     test N was the first to fail
;
; To run: paste into the simulator Code tab and click Run.
; All five assertions should complete without fault; DR0 stays 0.
;
; Note: RETURN (bare, no operand) unwinds the call frame.
;       RETURN CR8 is incorrect syntax — RETURN takes an optional mask, not a CR.

    ISUB DR0, DR0, DR0

    LOAD CR1, Boot.Nucs
    LOAD CR2, Boot.Abstr
    LOAD CR3, Boot.Nucs

; ── Test 1: X-GT satisfies TPERM X ──────────────────────────────────────────
    TPERM CR1, X
    BRANCHEQ t2
    IADD DR0, DR0, #1
    RETURN
t2:
; ── Test 2: X-GT fails TPERM E ───────────────────────────────────────────────
    TPERM CR1, E
    BRANCHNE t3
    IADD DR0, DR0, #2
    RETURN
t3:
; ── Test 3: E-GT satisfies TPERM E ───────────────────────────────────────────
    TPERM CR2, E
    BRANCHEQ t4
    IADD DR0, DR0, #3
    RETURN
t4:
; ── Test 4: E-GT fails TPERM X ───────────────────────────────────────────────
    TPERM CR2, X
    BRANCHNE t5
    IADD DR0, DR0, #4
    RETURN
t5:
; ── Test 5: TPERM EXACT — identical GTs match  (Z=1, no fault) ──────────────
    TPERM CR1, EXACT, CR3
    BRANCHEQ done
    IADD DR0, DR0, #5
    RETURN

done:
    ISUB DR0, DR0, DR0
    RETURN`,
        'scheduler_yield': `; ============================================================
; Abstraction:  SchedulerYield
; Description:  Cooperative multi-threading — voluntarily yield
;               the time slice so other ready threads can run
; Author:       Church Machine Educational Platform
; Version:      1.0
; Created:      2026-05-13
; Language:     Assembly
; Dependencies: Scheduler (NS[8])
; ============================================================

capabilities {
    Scheduler E
}

; Methods demonstrated:
;   Scheduler.Spawn(code_GT, entry) — create a new thread
;   Scheduler.Yield()               — cooperatively yield time slice
; ============================================================
;
; ============================================================
; Cooperative multi-threading pattern
; ============================================================
;
; Scheduler.Yield() saves the calling thread's register state and
; switches immediately to the next ready thread in round-robin
; order.  The calling thread is re-queued and will resume at the
; instruction after CALL Scheduler.Yield when its turn arrives.
;
; Scheduler.Spawn creates a new thread given a code_GT (the
; abstraction body) and an entry offset (DR1).  The new thread
; starts with an isolated CR set and its own stack.
;
; Input convention for Spawn:
;   CR2 = code_GT  (Golden Token for the thread body abstraction)
;   DR1 = entry    (instruction offset within that abstraction)
;
; This example reuses the Scheduler GT as a stand-in code_GT so
; the program assembles and shows the calling convention without
; requiring additional NS entries.  In production code CR2 would
; hold the GT of the actual worker abstraction.
;
; ── Load and verify Scheduler capability ─────────────────────
LOAD CR0, Scheduler    ; CR0 = Scheduler capability (E, NS[8])
TPERM CR0, E           ; Verify E permission  (Z=1 on success)

; ── Section 1: Spawn a worker thread ─────────────────────────
;   In a real program, LOAD CR2, MyWorker to supply the thread
;   body.  Here we reuse Scheduler as a code_GT placeholder so
;   the example runs with a single NS entry (Scheduler → 8).
LOAD CR2, Scheduler    ; CR2 = code_GT (placeholder — see note)
IADD DR1, DR0, #0      ; DR1 = entry offset 0 (first instruction)
CALL Scheduler.Spawn   ; create thread → DR1 = new threadID

; ── Section 2: Cooperative yields ────────────────────────────
;   After spawning, yield so the new thread gets to run.
;   Each CALL Scheduler.Yield is one voluntary preemption point.
;   The scheduler resumes this thread when its turn comes around.
CALL Scheduler.Yield   ; give up time slice — new thread runs
CALL Scheduler.Yield   ; yield again — round-robin through ready threads

HALT`,
        'scheduler_pause': `; ============================================================
; Abstraction:  SchedulerPause
; Description:  Timer-sleep pattern — suspend calling thread for
;               N ticks via Scheduler.pause; Scheduler.IRQ wakes it
; Author:       Church Machine Educational Platform
; Version:      1.0
; Created:      2026-05-13
; Language:     Assembly
; Dependencies: Scheduler (NS[8])
; ============================================================

capabilities {
    Scheduler E
}

; Methods demonstrated:
;   Scheduler.pause(ticks)  — suspend thread for DR1 ticks
;   Scheduler.Yield()       — voluntarily yield after waking
; ============================================================
;
; ============================================================
; Timer-sleep pattern
; ============================================================
;
; Scheduler.pause(ticks) suspends the calling thread for a
; fixed number of simulator steps.  When the deadline fires,
; Scheduler.IRQ (a hidden ELOADCALL) wakes the thread and
; execution resumes at the instruction after CALL Scheduler.pause.
;
; Input convention:
;   DR1 = number of ticks to sleep (positive integer)
;   CR0 = Scheduler capability (loaded below)
;
; How it works:
;   1. CALL Scheduler.pause  — sets irqState.timerArmed=true,
;      timerDeadline = stepCount + DR1, suspends thread.
;   2. After deadline: Scheduler.IRQ is injected before the
;      next instruction fetch — it wakes the sleeping thread.
;   3. Execution resumes at the instruction following CALL.
;
; ── Load Scheduler capability ────────────────────────────
LOAD CR0, Scheduler    ; CR0 = Scheduler capability (E, NS[8])
TPERM CR0, E           ; Verify E permission  (Z=1 on success)

; ── Section 1: sleep for 50 ticks ─────────────────────────────────────
IADD DR1, DR0, #50     ; DR1 = 50  (tick count — tunable)
CALL Scheduler.pause   ; arm timer, suspend thread
;                       ; ─── woken by Scheduler.IRQ here ───

; ── Section 2: shorter second sleep, then yield ────────────────────────
IADD DR1, DR0, #10     ; DR1 = 10  (second, shorter sleep)
CALL Scheduler.pause   ; arm timer again, suspend thread
;                       ; ─── woken by Scheduler.IRQ here ───

; ── Thread resumes — yield once to allow other threads to run ──────────
CALL Scheduler.Yield   ; give up remaining time slice  (DR1 = 0)

HALT`,
        'scheduler_wait': `; ============================================================
; Abstraction:  SchedulerWait
; Description:  Blocking synchronisation — wait on a DijkstraFlag
;               then stop a thread cleanly via Scheduler.Stop
; Author:       Church Machine Educational Platform
; Version:      1.0
; Created:      2026-05-13
; Language:     Assembly
; Dependencies: Scheduler (NS[8]), DijkstraFlag (NS[10])
; ============================================================

capabilities {
    Scheduler E,
    DijkstraFlag E
}

; Methods demonstrated:
;   DijkstraFlag.Signal()           — release the semaphore
;   Scheduler.Wait(flag_GT)         — block until flag signaled
;   Scheduler.Stop(threadID)        — terminate a thread
; ============================================================
;
; ============================================================
; Blocking-wait + thread-stop pattern
; ============================================================
;
; Scheduler.Wait(flag_GT) suspends the calling thread until
; the DijkstraFlag held in CR2 is signaled.  Once the flag
; fires the thread is re-queued and resumes at the instruction
; following CALL Scheduler.Wait.
;
; Scheduler.Stop(threadID) terminates the thread whose ID is
; in DR1.  DR1 = 0 refers to the calling thread itself,
; producing a clean self-exit rather than a HALT fault.
;
; DijkstraFlag.Signal() atomically releases the flag once.
; If a thread is already waiting it wakes immediately; if not,
; the signal is remembered so the next Wait returns without
; blocking.
;
; In this example the flag is pre-signaled so Scheduler.Wait
; returns immediately — demonstrating the calling convention
; without requiring a second thread to fire the flag.
;
; Input convention for Scheduler.Wait:
;   CR0 = Scheduler capability   (E, NS[8])
;   CR2 = flag_GT                (DijkstraFlag capability)
;
; Input convention for Scheduler.Stop:
;   CR0 = Scheduler capability   (E, NS[8])
;   DR1 = threadID to terminate  (0 = calling thread)
;
; ── Section 1: load capabilities and verify ──────────────────
LOAD CR0, Scheduler    ; CR0 = Scheduler capability (E, NS[8])
TPERM CR0, E           ; Verify E permission  (Z=1 on success)

; ── Section 2: pre-signal the DijkstraFlag ───────────────────
;   Signal before Wait so Wait returns without blocking.
;   In production a separate thread calls DijkstraFlag.Signal
;   to wake the waiting thread.
LOAD CR0, DijkstraFlag ; CR0 = DijkstraFlag (needed for CALL)
CALL DijkstraFlag.Signal ; atomically release the semaphore

; ── Section 3: wait for the (already-signaled) flag ──────────
LOAD CR0, Scheduler    ; CR0 = Scheduler (for CALL Scheduler.Wait)
LOAD CR2, DijkstraFlag ; CR2 = flag_GT argument for Wait
CALL Scheduler.Wait    ; block until signaled → returns immediately here

; ── Section 4: stop a thread ─────────────────────────────────
IADD DR1, DR0, #0      ; DR1 = 0  (threadID — 0 = calling thread)
CALL Scheduler.Stop    ; terminate thread 0 (clean self-stop)

HALT`,
        'constants_dot': `; ============================================================
; Abstraction:  ConstantsDot
; Description:  Named method selectors (dot-notation form) — CALL AbstrName.Method
;               and ELOADCALL with two-operand shorthand + named method selectors
; Author:       Church Machine Educational Platform
; Version:      1.1
; Created:      2026-05-12
; Language:     Assembly
; Dependencies: Constants (NS[18])
; ============================================================

capabilities {
    Constants E
}

; TWO recommended calling styles are shown here:
;
;   Style A — two-step (two-operand shorthand LOAD, then CALL with named method selectors):
;     LOAD   CR11, Constants      ; bind CR11 to the abstraction
;     CALL   Constants.Pi         ; call method by name via CR11
;
;   Style B — fused single instruction (ELOADCALL two-operand shorthand + named method selectors):
;     ELOADCALL CR8, Constants, Pi    ; load + TPERM + call in one op
;
; Both styles resolve method names automatically from
; METHOD_REGISTER_CONVENTIONS — no raw numeric offsets needed.
;
; Method table (0-based index):
;   Pi   (0)  → DR1 = 0x40490FDB  (π  ≈ 3.14159265)
;   E    (1)  → DR1 = 0x402DF854  (e  ≈ 2.71828183)
;   Phi  (2)  → DR1 = 0x3FCFBE77  (φ  ≈ 1.61803399)
;   Zero (3)  → DR1 = 0x00000000  (0.0 IEEE 754)
;   One  (4)  → DR1 = 0x3F800000  (1.0 IEEE 754)
; ============================================================

; ══════════════════════════════════════════════════════════
; Style A: LOAD then CALL AbstrName.Method  (two-step)
; ══════════════════════════════════════════════════════════
; Bind Constants into CR11 once, then call each method by
; name. The assembler encodes CALL CR11, <index+1> for you.

LOAD   CR11, Constants   ; CR11 = Constants (E perm, NS[18])
TPERM  CR11, E           ; Verify E permission → Z=1

CALL   Constants.Pi      ; DR1 <- 0x40490FDB  (π ≈ 3.14159265)
CALL   Constants.E       ; DR1 <- 0x402DF854  (e ≈ 2.71828183)
CALL   Constants.Phi     ; DR1 <- 0x3FCFBE77  (φ ≈ 1.61803399)
CALL   Constants.Zero    ; DR1 <- 0x00000000  (IEEE 754 +0.0)
CALL   Constants.One     ; DR1 <- 0x3F800000  (IEEE 754 1.0)

; ── Verify π is non-zero (Z=0 after MCMP) ───────────────────
CALL   Constants.Pi      ; DR1 <- π
MCMP   DR1, DR0          ; DR1 vs 0 → Z=0 (π is non-zero)
BRANCHNE style_b         ; take branch — π ≠ 0 confirmed

; ══════════════════════════════════════════════════════════
; Style B: ELOADCALL CRd, AbstrName, Method  (fused, recommended)
; ══════════════════════════════════════════════════════════
; ELOADCALL fuses three operations into one instruction:
;   1. LOAD  — fetch the E-GT from the namespace by name
;   2. TPERM — verify E permission (faults if absent)
;   3. CALL  — enter the method's lambda body
;
; This is the recommended style when you call a method only
; once and don't need to hold the capability in a CR register.
; It is also one instruction shorter than the two-step form.
;
; Note: use CR0–CR11 as destination; CR12–CR15 are reserved
; for microcode (Thread, Nucleus, Current-Lump, Namespace).

style_b:
ELOADCALL CR8, Constants, Pi    ; DR1 <- π  (load+check+call in 1 op)
ELOADCALL CR8, Constants, E     ; DR1 <- e
ELOADCALL CR8, Constants, Phi   ; DR1 <- φ  (golden ratio)
ELOADCALL CR8, Constants, Zero  ; DR1 <- 0.0
ELOADCALL CR8, Constants, One   ; DR1 <- 1.0

; ── Confirm π from fused path equals π from two-step path ───
ELOADCALL CR8, Constants, Pi    ; DR1 <- π  (fused path)
MCMP   DR1, DR0                  ; Z=0 → π ≠ 0
BRANCHNE done

done:
HALT`,
        'led_control': `; ============================================================
; Abstraction:  LedControl
; Description:  LED control — Section 1: LED blink (Ti60 F225 nucleus) / Section 2: Turing DR Test (full ISA exercise)
; Author:       Church Machine Educational Platform
; Version:      1.2
; Created:      2026-05-09
; Language:     Assembly
; Dependencies: LED device (Abstract GT — boot C-List slot 8)
; ============================================================
; Capabilities required by this lump:
capabilities { LED0 RW }
; Methods:
;   1. blink — toggle LED0 at 1 Hz using nested delay loops (Ti60 F225 nucleus program)
; ============================================================
; ============================================
; LED Blink — Ti60 F225 Hardware Nucleus Code
; ============================================
;
; This is the exact binary burned into the
; Ti60 F225 FPGA. It produces the 1 Hz LED
; blink you can see on the board right now.
;
; HOW TO WATCH THIS IN THE SIMULATOR:
; 1. Boot the machine (click Boot, or Step x6).
; 2. Assemble this code, then click Step.
; 3. Switch to Ti60 255 IDE — watch the Ti60 F225
;    LED strip: LED0 (green) toggles with each
;    DWRITE, exactly as on the physical board.
;
; ── Two-operand shorthand for LOAD (recommended) ────────────
;
;   LOAD CR3, LED0            ; two-operand shorthand — resolves by device name
;
; Equivalent raw form (slot number explicit):
;
;   LOAD CR3, CR6, 8          ; CR6 = boot C-List; slot 8 = LED0
;
; Both produce identical machine code.  The named form (used here)
; is preferred: it stays correct if the boot C-List is renumbered.
;
; LED0 is a device GT (W-perm only) — it is accessed with DWRITE,
; not CALL.  Device GTs have no callable methods, so named method selectors
; do not apply here; two-operand shorthand for LOAD is still recommended.
;
; Path: LOAD CR3, LED0   → resolves LED0 → C-List[8] → LED_DEV GT
;       DWRITE DR1, CR3, 0 → LED0 on
;       DWRITE DR0, CR3, 0 → LED0 off
;
; On the FPGA (50 MHz): 380 × 16383 iters ≈ 0.5 s
; per phase → 1 Hz blink total.
; ============================================

; --- Load LED0 Abstract GT from the boot C-List (two-operand shorthand) ---
; Named load: equiv. to raw form  LOAD CR3, CR6, 8
LOAD CR3, LED0            ; LED0 Abstract GT → CR3 (boot C-List slot 8)

; --- DR1 = 1 (the "on" value) ---
IADD DR1, DR0, #1

; ── LED ON phase ─────────────────────────────
led_on:
DWRITE DR1, CR3, 0        ; LED0 = 1  (write 1 through gate)
IADD DR3, DR0, #3         ; outer delay count  (FPGA: 380)
outer_on:
IADD DR2, DR0, #3         ; inner delay count  (FPGA: 16383)
inner_on:
ISUB DR2, DR2, #1
BRANCHNE inner_on
ISUB DR3, DR3, #1
BRANCHNE outer_on

; ── LED OFF phase ────────────────────────────
DWRITE DR0, CR3, 0        ; LED0 = 0  (write 0 through gate)
IADD DR3, DR0, #3
outer_off:
IADD DR2, DR0, #3
inner_off:
ISUB DR2, DR2, #1
BRANCHNE inner_off
ISUB DR3, DR3, #1
BRANCHNE outer_off

BRANCH led_on             ; loop forever
`,
        'led_dr_test': _TURING_DR_TEST_SOURCE,
    };

    window._asmExampleSources      = examples;
    window._asmExampleSourcesReady = true;

    const code = examples[name];
    if (code) {
        editor.value = code;
        saveEditorState();
        updateLineNumbers();
        document.querySelectorAll('.example-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.example === name);
        });
        const activeBtn = document.querySelector(`.example-tab[data-example="${name}"]`);
        _updateEditorCodeName(activeBtn ? activeBtn.textContent.trim() : name);
        const sel = document.getElementById('langSelector');
        if (sel) {
            const cloomcLangs = window._cloomcExampleLanguages || {};
            sel.value = cloomcLangs[name] || 'assembly';
        }
        if (typeof historySetCodeExample === 'function') historySetCodeExample(name);
    }
    const noticeBar = document.getElementById('presetNoticeBar');
    if (noticeBar) {
        const textEl = noticeBar.querySelector('.preset-notice-text');
        if (name === 'ada_note_g') {
            if (textEl) textEl.textContent = 'Integer arithmetic only \u2014 load the CLOOMC preset for exact fractions.';
            noticeBar.style.display = 'flex';
        } else if (name === 'ada_note_g_published_bug') {
            if (textEl) textEl.textContent = 'Ada\u2019s published Op\u00a04 has the dividend and divisor swapped. Expected result: DR24\u00a0=\u00a0139/630 (not \u22121/30). Compare with \u201cAda: Note G (corrected)\u201d to see the difference.';
            noticeBar.style.display = 'flex';
        } else {
            noticeBar.style.display = 'none';
        }
    }
}

var _polaChangedLines = [];

function _highlightPolaChangedLines(lineNums) {
    document.querySelectorAll('#lineNumbers span.line-num-pola').forEach(function(el) {
        el.classList.remove('line-num-pola');
    });
    _polaChangedLines = lineNums ? lineNums.slice() : [];
    _polaChangedLines.forEach(function(n) {
        var span = document.getElementById('ln-' + n);
        if (span) span.classList.add('line-num-pola');
    });
}

function updateLineNumbers() {
    const editor = document.getElementById('asmEditor');
    const gutter = document.getElementById('lineNumbers');
    if (!editor || !gutter) return;
    const lines = editor.value.split('\n');
    let html = '';
    for (let i = 1; i <= lines.length; i++) {
        html += '<span id="ln-' + i + '">' + i + '</span>\n';
    }
    gutter.innerHTML = html;
    if (typeof _activeAsmErrors !== 'undefined' && _activeAsmErrors.length > 0) {
        _highlightAsmErrorLines(_activeAsmErrors);
    }
    if (typeof _polaChangedLines !== 'undefined' && _polaChangedLines.length > 0) {
        _highlightPolaChangedLines(_polaChangedLines);
    }
}

function syncLineScroll() {
    const editor = document.getElementById('asmEditor');
    const gutter = document.getElementById('lineNumbers');
    if (editor && gutter) {
        gutter.scrollTop = editor.scrollTop;
        const overlay = document.getElementById('asmErrorOverlay');
        if (overlay) {
            overlay.scrollTop = editor.scrollTop;
            overlay.scrollLeft = editor.scrollLeft;
        }
        const warnOverlay = document.getElementById('asmWarningOverlay');
        if (warnOverlay) {
            warnOverlay.scrollTop = editor.scrollTop;
            warnOverlay.scrollLeft = editor.scrollLeft;
        }
    }
}

function scrollExamples(dir) {
    const container = document.getElementById('exampleTabsScroll');
    if (container) {
        container.scrollBy({ left: dir * 120, behavior: 'smooth' });
    }
}

let currentChallenge = null;

function generateChallenge() {
    const settings = getStudentSettings();
    const progress = getStudentProgress();
    const grade = settings.grade || '';
    const solved = progress.challengesSolved || 0;

    const tier = getGradeTier(grade);
    const problem = pickProblem(tier, solved);
    currentChallenge = problem;

    const promptEl = document.getElementById('challengePrompt');
    const inputEl = document.getElementById('challengeInput');
    const resultEl = document.getElementById('challengeResult');
    const explainEl = document.getElementById('challengeExplain');
    const answerEl = document.getElementById('challengeAnswer');

    promptEl.innerHTML = problem.story +
        `<div class="challenge-question">${escapeHtml(problem.question)}</div>`;
    inputEl.style.display = 'block';
    resultEl.innerHTML = '';
    resultEl.className = 'challenge-result';
    explainEl.innerHTML = '';
    if (answerEl) { answerEl.value = ''; answerEl.focus(); }
}

function pickProblem(tier, solved) {
    const pools = {
        early: [
            () => { const a = rr(1,9), b = rr(1,9); return mp(a+' + '+b, a+b, 'addition', a, b, 'add'); },
            () => { const a = rr(5,15), b = rr(1,a); return mp(a+' - '+b, a-b, 'subtraction', a, b, 'sub'); },
            () => { const a = rr(1,5), b = rr(1,5); return mp(a+' + '+b, a+b, 'addition', a, b, 'add'); },
            () => { const a = rr(2,10), b = rr(1,a-1); return mp(a+' - '+b, a-b, 'subtraction', a, b, 'sub'); },
            () => { const a = rr(1,9), b = rr(1,9); return mp(a+' + '+b+' = ?', a+b, 'addition', a, b, 'add'); },
        ],
        elementary: [
            () => { const a = rr(2,12), b = rr(2,12); return mp(a+' \u00d7 '+b, a*b, 'multiplication', a, b, 'mul'); },
            () => { const b = rr(2,12), c = rr(2,12); const a = b*c; return mp(a+' \u00f7 '+b, c, 'division', a, b, 'div'); },
            () => { const a = rr(10,99), b = rr(10,99); return mp(a+' + '+b, a+b, 'addition', a, b, 'add'); },
            () => { const a = rr(50,200), b = rr(10,a); return mp(a+' - '+b, a-b, 'subtraction', a, b, 'sub'); },
            () => { const a = rr(5,20), b = rr(2,9); return mp(a+' \u00d7 '+b, a*b, 'multiplication', a, b, 'mul'); },
        ],
        middle: [
            () => { const a = rr(10,50), b = rr(2,10), c = rr(1,20); return mp(a+' \u00d7 '+b+' + '+c, a*b+c, 'mixed ops', a*b, c, 'add', a, b); },
            () => { const b = rr(2,15), c = rr(2,15); const a = b*c; return mp(a+' \u00f7 '+b, c, 'division', a, b, 'div'); },
            () => { const a = rr(2,15); return mp('What is ' + a + '\u00b2 ?', a*a, 'squaring', a, a, 'mul'); },
            () => { const a = rr(100,999), b = rr(10,99); return mp(a+' - '+b, a-b, 'subtraction', a, b, 'sub'); },
            () => { const a = rr(2,12), b = rr(2,12), c = rr(1,10); return mp(a+' \u00d7 '+b+' + '+c, a*b+c, 'mixed ops', a*b, c, 'add', a, b); },
        ],
        high: [
            () => { const a = rr(2,15), b = rr(2,15); const p = a*b; return mp('If y = '+a+'x and x = '+b+', what is y?', p, 'algebra', a, b, 'mul'); },
            () => { const r = rr(1,10), h = rr(2,15); const v = r*r*h; return mp('Volume: r='+r+', h='+h+', r\u00b2\u00d7h = ?', v, 'volume', r*r, h, 'mul'); },
            () => { const x1=rr(1,5),y1=rr(1,5),x2=rr(6,10),y2=rr(6,10); return mp('Rise/Run: ('+x1+','+y1+') to ('+x2+','+y2+'). Rise = ?', y2-y1, 'slope (rise)', y2, y1, 'sub'); },
            () => { const a = rr(2,20), b = rr(2,20); return mp(a+'\u00b2 + '+b+'\u00b2 = ?', a*a+b*b, 'Pythagorean sum', a*a, b*b, 'add'); },
        ],
        advanced: [
            () => { const n = rr(2,8); let f=1; for(let i=2;i<=n;i++) f*=i; return mp(n+'! (factorial)', f, 'factorial', n, 0, 'factorial'); },
            () => { const a=rr(2,6),b=rr(2,6),c=rr(1,5); return mp(a+'\u00d7'+b+' + '+a+'\u00d7'+c+' = '+a+'('+b+'+'+c+')', a*(b+c), 'distributive', a, b+c, 'mul'); },
            () => { const a=rr(2,10),n=rr(2,4); let p=1; for(let i=0;i<n;i++) p*=a; return mp(a+'^'+n, p, 'exponent', a, n, 'exp'); },
            () => { const a=rr(10,99),b=rr(10,99); return mp('GCD-step: '+a+' mod '+b+' = ?', a%b, 'modular', a, b, 'mod'); },
        ],
    };

    const pool = pools[tier] || pools.early;
    const fn = pool[solved % pool.length];

    const base = fn();
    const stories = {
        early: [
            'You have some apples in a basket.',
            'Count the stars in the sky!',
            'Help the robot count blocks.',
        ],
        elementary: [
            'A farmer is planting rows of seeds.',
            'How many tiles cover the floor?',
            'Split the candies equally among friends.',
        ],
        middle: [
            'Calculate the area of the garden.',
            'Divide the supplies for the expedition.',
            'Find the missing measurement.',
        ],
        high: [
            'Solve for the unknown variable.',
            'Calculate the geometric measurement.',
            'Apply the formula to find the answer.',
        ],
        advanced: [
            'Evaluate the mathematical expression.',
            'Apply the algebraic identity.',
            'Compute the result step by step.',
        ],
    };
    const storyPool = stories[tier] || stories.early;
    base.story = storyPool[Math.floor(Math.random() * storyPool.length)];
    return base;
}

function rr(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function mp(question, answer, opName, a, b, opType, origA, origB) {
    return { question, answer, opName, a, b, opType, origA, origB, story: '' };
}

function checkChallenge() {
    if (!currentChallenge) return;
    const answerEl = document.getElementById('challengeAnswer');
    const resultEl = document.getElementById('challengeResult');
    const explainEl = document.getElementById('challengeExplain');
    if (!answerEl || !resultEl) return;

    const userAnswer = parseFloat(answerEl.value.trim());
    if (isNaN(userAnswer)) {
        resultEl.className = 'challenge-result incorrect';
        resultEl.textContent = 'Please enter a number.';
        return;
    }

    if (userAnswer === currentChallenge.answer) {
        resultEl.className = 'challenge-result correct';
        resultEl.textContent = 'Correct! The answer is ' + currentChallenge.answer + '.';

        const progress = getStudentProgress();
        progress.challengesSolved = (progress.challengesSolved || 0) + 1;
        saveStudentProgress(progress);

        showChallengeExplanation(explainEl, currentChallenge);
    } else {
        resultEl.className = 'challenge-result incorrect';
        resultEl.textContent = 'Not quite. Try again!';
    }
}

function showChallengeHint() {
    if (!currentChallenge) return;
    const resultEl = document.getElementById('challengeResult');
    if (!resultEl) return;

    const c = currentChallenge;
    let hint = '';
    if (c.opType === 'add') hint = 'Add ' + c.a + ' and ' + c.b + ' together.';
    else if (c.opType === 'sub') hint = 'Subtract ' + c.b + ' from ' + c.a + '.';
    else if (c.opType === 'mul') hint = 'Multiply ' + c.a + ' by ' + c.b + '.';
    else if (c.opType === 'div') hint = 'Divide ' + c.a + ' by ' + c.b + '.';
    else if (c.opType === 'factorial') hint = 'Multiply all numbers from 1 up to ' + c.a + '.';
    else if (c.opType === 'exp') hint = 'Multiply ' + c.a + ' by itself ' + c.b + ' times.';
    else if (c.opType === 'mod') hint = 'What is the remainder when ' + c.a + ' is divided by ' + c.b + '?';
    else hint = 'Think about ' + c.opName + ' step by step.';

    resultEl.className = 'challenge-result hint';
    resultEl.textContent = 'Hint: ' + hint;
}

function challengeOpName(opType) {
    const names = { add: 'ADD', sub: 'SUB', mul: 'MUL', div: 'DIV', factorial: 'FACTORIAL', exp: 'POW', mod: 'MOD' };
    return names[opType] || 'COMPUTE';
}

function challengeOpSymbol(opType) {
    const syms = { add: '+', sub: '-', mul: '\u00d7', div: '\u00f7', exp: '^', mod: '%' };
    return syms[opType] || '?';
}

function challengeOpSlot(opType) {
    const slots = { add: 22, sub: 23, mul: 24, div: 25, factorial: 26, exp: 24, mod: 25 };
    return slots[opType] || 22;
}

function buildTuringLines(c) {
    const lines = [];
    if (c.opType === 'add') {
        lines.push({asm: 'IADD DR1, DR1, DR2', desc: 'Add DR1 + DR2, store result (' + c.answer + ') in DR1'});
        lines.push({note: 'DR1 = ' + c.a + ', DR2 = ' + c.b + '. IADD is "integer add". Everything is a number. The body works in numbers.'});
    } else if (c.opType === 'sub') {
        lines.push({asm: 'ISUB DR1, DR1, DR2', desc: 'Subtract DR2 from DR1, store result (' + c.answer + ') in DR1'});
        lines.push({note: 'DR1 = ' + c.a + ', DR2 = ' + c.b + '. ISUB is "integer subtract". DR1, DR2 are physical addresses holding numbers.'});
    } else if (c.opType === 'mul') {
        lines.push({asm: 'IADD DR3, DR0, #0', desc: 'Set DR3 to 0 (running total)'});
        lines.push({asm: 'IADD DR3, DR3, DR1', desc: 'Add DR1 to DR3 (repeat DR2 times)'});
        lines.push({asm: 'ISUB DR2, DR2, #1', desc: 'Count down: subtract 1 from DR2'});
        lines.push({asm: 'BRANCH NE, -2', desc: 'If DR2 is not zero, jump back and add again'});
        lines.push({asm: 'IADD DR1, DR0, DR3', desc: 'Copy result to DR1'});
        lines.push({note: 'No multiply instruction! The body loops: add ' + c.a + ' to itself ' + c.b + ' times. ' + c.a + ' \u00d7 ' + c.b + ' = ' + c.answer + '. Loops can run forever \u2014 the body can fail.'});
    } else if (c.opType === 'div') {
        lines.push({asm: 'IADD DR3, DR0, #0', desc: 'Set DR3 to 0 (counts subtractions)'});
        lines.push({asm: 'ISUB DR1, DR1, DR2', desc: 'Subtract DR2 from DR1'});
        lines.push({asm: 'IADD DR3, DR3, #1', desc: 'Add 1 to the counter'});
        lines.push({asm: 'BRANCH PL, -2', desc: 'If DR1 is still positive, keep subtracting'});
        lines.push({asm: 'IADD DR1, DR0, DR3', desc: 'Copy result to DR1'});
        lines.push({note: 'Division is repeated subtraction. Subtract ' + c.b + ' from ' + c.a + ' and count: ' + c.answer + ' times. All numbers, all physical.'});
    } else if (c.opType === 'factorial') {
        lines.push({asm: 'IADD DR2, DR0, DR1', desc: 'Copy ' + c.a + ' into DR2 (counter)'});
        lines.push({asm: 'IADD DR1, DR0, #1', desc: 'Set DR1 to 1 (running product)'});
        lines.push({asm: '-- outer loop:', desc: 'For each counter value, multiply DR1 by DR2'});
        lines.push({asm: 'IADD DR3, DR0, DR1', desc: 'Copy the current product into DR3'});
        lines.push({asm: 'IADD DR1, DR0, #0', desc: 'Reset DR1 for the add loop'});
        lines.push({asm: 'IADD DR4, DR0, DR2', desc: 'Copy counter into DR4 (inner loop count)'});
        lines.push({asm: 'IADD DR1, DR1, DR3', desc: 'Add DR3 to DR1 (repeated DR2 times = multiply)'});
        lines.push({asm: 'ISUB DR4, DR4, #1', desc: 'Decrease inner loop counter'});
        lines.push({asm: 'BRANCH NE, -2', desc: 'Inner loop: keep adding until DR4 = 0'});
        lines.push({asm: 'ISUB DR2, DR2, #1', desc: 'Decrease the outer counter by 1'});
        lines.push({asm: 'BRANCH NE, -8', desc: 'Outer loop: repeat for next factor'});
        lines.push({note: c.a + '! = ' + c.answer + '. Two nested loops of addition \u2014 the body builds complexity from simple parts. Result ends up in DR1.'});
    } else if (c.opType === 'exp') {
        lines.push({asm: 'IADD DR3, DR0, #1', desc: 'Set DR3 to 1 (result starts at 1)'});
        lines.push({asm: '-- outer loop:', desc: 'Multiply DR3 by DR1, using an add loop'});
        lines.push({asm: 'IADD DR4, DR0, DR3', desc: 'Copy current result into DR4'});
        lines.push({asm: 'IADD DR3, DR0, #0', desc: 'Reset DR3 for the add loop'});
        lines.push({asm: 'IADD DR5, DR0, DR1', desc: 'Copy base into DR5 (inner loop count)'});
        lines.push({asm: 'IADD DR3, DR3, DR4', desc: 'Add DR4 to DR3 (repeated DR1 times = multiply)'});
        lines.push({asm: 'ISUB DR5, DR5, #1', desc: 'Decrease inner counter'});
        lines.push({asm: 'BRANCH NE, -2', desc: 'Inner loop: keep adding'});
        lines.push({asm: 'ISUB DR2, DR2, #1', desc: 'Decrease exponent counter'});
        lines.push({asm: 'BRANCH NE, -8', desc: 'Outer loop until exponent reaches 0'});
        lines.push({asm: 'IADD DR1, DR0, DR3', desc: 'Copy result to DR1'});
        lines.push({note: c.a + '^' + c.b + ' = ' + c.answer + '. Repeated multiplication, each multiplication repeated addition. Two nested loops, all numbers. Result in DR1.'});
    } else if (c.opType === 'mod') {
        lines.push({asm: 'ISUB DR1, DR1, DR2', desc: 'Subtract DR2 from DR1'});
        lines.push({asm: 'BRANCH PL, -1', desc: 'If still positive, keep subtracting'});
        lines.push({asm: 'IADD DR1, DR1, DR2', desc: 'Add back once (remainder = ' + c.answer + ')'});
        lines.push({note: 'Modulo: subtract ' + c.b + ' from ' + c.a + ' until it goes negative, then add back once. Result ' + c.answer + ' is in DR1.'});
    } else {
        lines.push({asm: 'Operation', desc: 'Compute ' + c.a + ' op ' + c.b + ' = ' + c.answer});
        lines.push({note: 'The body computes the result in DR1. All numbers, all physical addresses.'});
    }
    return lines;
}

function showChallengeExplanation(el, c) {
    if (!el) return;

    const opName = challengeOpName(c.opType);
    const slot = challengeOpSlot(c.opType);
    const sym = challengeOpSymbol(c.opType);
    const exprStr = c.opType === 'factorial' ? c.a + '!' : c.a + ' ' + sym + ' ' + c.b;

    let html = '';

    html += `<div class="explain-turing">`;
    html += `<div class="explain-header">The body \u2014 Turing (numbers)</div>`;
    if (c.opType === 'factorial') {
        html += `<div style="font-size:0.78rem;color:rgba(130,200,255,0.7);margin-bottom:0.3rem;">Inside the envelope: DR1 = ${c.a}</div>`;
    } else {
        html += `<div style="font-size:0.78rem;color:rgba(130,200,255,0.7);margin-bottom:0.3rem;">Inside the envelope: DR1 = ${c.a}, DR2 = ${c.b}</div>`;
    }
    const turingLines = buildTuringLines(c);
    for (const line of turingLines) {
        if (line.note) {
            html += `<div style="margin-top:0.3rem;font-size:0.78rem;font-style:italic;color:rgba(130,200,255,0.8);">${escapeHtml(line.note)}</div>`;
        } else {
            html += `<div class="code-line">`;
            html += `<span class="code-asm" style="color:rgba(130,200,255,0.9);">${escapeHtml(line.asm)}</span>`;
            html += `<span class="code-desc">${escapeHtml(line.desc)}</span>`;
            html += `</div>`;
        }
    }
    html += `</div>`;

    html += `<div class="explain-church">`;
    html += `<div class="explain-header">The mind \u2014 Church (symbols)</div>`;

    const churchLines = [];
    if (c.opType === 'factorial') {
        churchLines.push({label: 'A', expr: '= ' + c.a});
        churchLines.push({label: 'C', expr: '= CALL.FACTORIAL (A!)'});
    } else {
        churchLines.push({label: 'A', expr: '= ' + c.a});
        churchLines.push({label: 'B', expr: '= ' + c.b});
        churchLines.push({label: 'C', expr: '= CALL.' + opName + ' (A ' + sym + ' B)'});
    }

    for (const line of churchLines) {
        html += `<div class="code-line">`;
        html += `<span class="code-hex" style="min-width:28px;color:var(--church-gold);font-weight:700;">${escapeHtml(line.label)}</span>`;
        html += `<span class="code-asm">${escapeHtml(line.expr)}</span>`;
        html += `</div>`;
    }
    html += `<div style="margin-top:0.3rem;font-size:0.78rem;font-style:italic;color:var(--church-gold);opacity:0.8;">CALL names the abstraction. A and B are symbols, not addresses. The mind works in mathematics.</div>`;
    html += `</div>`;

    el.innerHTML = html;
}

function showMathGuidePopup(force) {
    if (POPUPS_DISABLED) return;
    if (!force && localStorage.getItem('churchMachine_mathGuideDismissed_perm')) return;
    if (!force && localStorage.getItem('churchMachine_mathGuideDismissed')) return;
    if (!force && !localStorage.getItem('church_welcome_dismissed')) return;

    const modal = document.getElementById('mathGuideModal');
    const body = document.getElementById('mathGuideBody');
    if (!modal || !body) return;

    body.innerHTML =
        `<p style="font-size:0.9rem;line-height:1.65;margin-bottom:0.75rem;">` +
        `This page has two sides, separated by a moveable bar.</p>` +

        `<div style="display:flex;gap:1rem;margin-bottom:0.75rem;">` +

        `<div style="flex:1;background:rgba(218,165,32,0.08);border:1px solid rgba(218,165,32,0.25);border-radius:8px;padding:0.6rem 0.8rem;">` +
        `<div style="font-weight:700;color:var(--church-gold);margin-bottom:0.3rem;">Left &mdash; The Mind</div>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0;">` +
        `Church domain. Symbols and permissions. The calculation becomes: ` +
        `<strong>A = 3, B = 1, C = CALL.ADD (A + B)</strong> &mdash; pure mathematics, no registers. ` +
        `CALL names the abstraction, the envelope opens, the body runs inside, and the envelope closes. ` +
        `<a href="https://en.wikipedia.org/wiki/Lambda_calculus" target="_blank" rel="noopener" style="color:var(--church-gold);">More</a></p>` +
        `</div>` +

        `<div style="flex:1;background:rgba(100,180,255,0.08);border:1px solid rgba(100,180,255,0.25);border-radius:8px;padding:0.6rem 0.8rem;">` +
        `<div style="font-weight:700;color:rgba(130,200,255,0.95);margin-bottom:0.3rem;">Right &mdash; The Body</div>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0;">` +
        `Turing domain. Numbers and physical addresses. The challenge panel shows how the body computes: ` +
        `<strong>IADD DR0, DR0, DR1</strong> &mdash; add two registers. ` +
        `Values that can overflow. Loops that can run forever. The body can fail. ` +
        `<a href="https://en.wikipedia.org/wiki/Turing_machine" target="_blank" rel="noopener" style="color:rgba(130,200,255,0.95);">More</a></p>` +
        `</div>` +

        `</div>` +

        `<div style="background:rgba(180,140,255,0.06);border:1px solid rgba(180,140,255,0.2);border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.75rem;">` +
        `<div style="font-weight:700;color:rgba(180,140,255,0.95);margin-bottom:0.3rem;">Where Mind meets Body &mdash; Pythagoras to Church</div>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0 0 0.4rem 0;">` +
        `Pythagoras discovered that a stretched string half the length produces a note one octave higher. ` +
        `The <span style="color:rgba(100,200,100,0.95);font-weight:600;">symbol</span> (the ratio 2:1) and the ` +
        `<span style="color:rgba(130,200,255,0.95);font-weight:600;">mechanism</span> (the vibrating string) are different things &mdash; ` +
        `but one governs the other. This is the oldest known link between mathematics and physics.</p>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0 0 0.4rem 0;">` +
        `The slide rule shows it perfectly. The <span style="color:rgba(100,200,100,0.95);font-weight:600;">green C scale</span> is the symbol &mdash; ` +
        `an abstract logarithmic ruler where <em>position</em> represents a number. ` +
        `The <span style="color:rgba(130,200,255,0.95);font-weight:600;">physical slide</span> is the mechanism &mdash; ` +
        `moving it adds lengths, and because the scale is logarithmic, adding lengths <em>multiplies numbers</em>. ` +
        `The symbol (log) controls what the body (slide) does.</p>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0 0 0.4rem 0;">` +
        `The Church Machine works the same way. ` +
        `<span style="color:rgba(100,200,100,0.95);font-weight:600;">Symbols</span>: Golden Tokens, permissions, ` +
        `<code>CALL R0, #greet</code>. ` +
        `<span style="color:rgba(130,200,255,0.95);font-weight:600;">Mechanics</span>: registers, memory addresses, ` +
        `<code>ADD R2, R0, R1</code>. ` +
        `The symbol controls what the registers do &mdash; just as the ratio 2:1 controls what the string does, ` +
        `and just as log(a) + log(b) controls what the slide rule computes.</p>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0;">` +
        `Pythagoras heard it in strings. Napier carved it into slide rules. Church wrote it in functions. ` +
        `The Church Machine runs it in hardware. ` +
        `<a href="https://en.wikipedia.org/wiki/Musica_universalis" target="_blank" rel="noopener" style="color:rgba(180,140,255,0.95);">More</a></p>` +
        `</div>` +

        `<div style="background:rgba(100,200,100,0.06);border:1px solid rgba(100,200,100,0.2);border-radius:8px;padding:0.6rem 0.8rem;">` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0 0 0.4rem 0;">` +
        `Ada wrote the first program in 1843 using symbols &mdash; no compiler, no OS, no superuser. ` +
        `The Church Machine returns to what she had. ` +
        `<a href="https://en.wikipedia.org/wiki/Ada_Lovelace" target="_blank" rel="noopener" style="color:rgba(100,200,100,0.9);">More</a></p>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0 0 0.4rem 0;">` +
        `Turing was Church\u2019s student. He built the body. His teacher gave it a mind.</p>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0 0 0.4rem 0;">` +
        `The von Neumann design that every computer uses today is like body parts without an integrated mental framework \u2014 ` +
        `many exposed mechanics sharing the same mindless open space, ` +
        `every gear can touch every other gear, and every new part makes collisions more likely.</p>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0 0 0.4rem 0;">` +
        `The more it grows, the more unreliable it becomes.</p>` +
        `<p style="font-size:0.82rem;line-height:1.5;margin:0;">` +
        `The Church Machine puts each clockwork inside its own sealed envelope, ` +
        `so they can only interact through the tokens they have been given.</p>` +
        `</div>`;

    modal.style.display = 'flex';
}

function dismissMathGuide() {
    const dontShow = document.getElementById('mathGuideDontShow');
    if (dontShow && dontShow.checked) {
        localStorage.setItem('churchMachine_mathGuideDismissed_perm', '1');
    }
    localStorage.setItem('churchMachine_mathGuideDismissed', '1');
    const modal = document.getElementById('mathGuideModal');
    if (modal) modal.style.display = 'none';
    const activeTab = document.querySelector('.math-mode-tab.active');
    const activeModeId = activeTab ? activeTab.id.replace('mathTab', '').toLowerCase() : 'hp35';
    const modeMap = { 'hp35': 'hp35', 'abacus': 'abacus', 'sliderule': 'sliderule', 'interactive': 'interactive' };
    showToolGuide(modeMap[activeModeId] || 'hp35');
}

function resetAllPopups() {
    localStorage.removeItem('church_welcome_dismissed');
    localStorage.removeItem('church_welcome_dismissed_perm');
    localStorage.removeItem('churchMachine_mathGuideDismissed');
    localStorage.removeItem('churchMachine_mathGuideDismissed_perm');
    localStorage.removeItem('churchMachine_toolGuide_interactive');
    localStorage.removeItem('churchMachine_toolGuide_interactive_perm');
    localStorage.removeItem('churchMachine_toolGuide_hp35');
    localStorage.removeItem('churchMachine_toolGuide_hp35_perm');
    localStorage.removeItem('churchMachine_toolGuide_abacus');
    localStorage.removeItem('churchMachine_toolGuide_abacus_perm');
    localStorage.removeItem('churchMachine_toolGuide_sliderule');
    localStorage.removeItem('churchMachine_toolGuide_sliderule_perm');
    closeSettings();
}

const TOOL_GUIDES = {
    interactive: {
        title: 'Pure Math',
        body:
            `<div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.75rem;">` +
            `<span style="font-size:2rem;">&#955;</span>` +
            `<div><strong style="font-size:1rem;">Your lambda calculus notebook</strong>` +
            `<p style="font-size:0.82rem;color:var(--text-secondary);margin:0.2rem 0 0;">Type maths, see it run on the Church Machine.</p></div></div>` +

            `<div style="background:rgba(218,165,32,0.08);border:1px solid rgba(218,165,32,0.25);border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.65rem;">` +
            `<div style="font-weight:700;color:var(--church-gold);margin-bottom:0.3rem;">What can I do?</div>` +
            `<ul style="font-size:0.82rem;line-height:1.6;margin:0;padding-left:1.2rem;">` +
            `<li>Type <code>let x = 2 + 3</code> and press Enter to compute</li>` +
            `<li>Build up calculations step by step \u2014 each line remembers the last</li>` +
            `<li>Click <strong>Compile Session</strong> to turn your work into real Church Machine code</li>` +
            `<li>The right panel shows how the machine runs your calculation</li></ul></div>` +

            `<div style="background:rgba(100,200,100,0.06);border:1px solid rgba(100,200,100,0.2);border-radius:8px;padding:0.6rem 0.8rem;">` +
            `<div style="font-weight:600;color:rgba(100,200,100,0.9);font-size:0.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.3rem;">How to learn</div>` +
            `<p style="font-size:0.82rem;line-height:1.55;margin:0;">` +
            `Start simple: <code>let a = 5</code>, then <code>let b = a * 2</code>. ` +
            `Watch the right side \u2014 it shows what the processor does with your symbols. ` +
            `This is how Ada Lovelace wrote her first program in 1843: symbols first, then the machine runs them. ` +
            `<a href="https://en.wikipedia.org/wiki/Ada_Lovelace" target="_blank" rel="noopener" style="color:rgba(100,200,100,0.9);">More</a></p></div>`
    },
    hp35: {
        title: 'HP-35 Scientific Calculator',
        body:
            `<div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.75rem;">` +
            `<span style="font-size:2rem;">&#128425;</span>` +
            `<div><strong style="font-size:1rem;">The calculator that changed the world</strong>` +
            `<p style="font-size:0.82rem;color:var(--text-secondary);margin:0.2rem 0 0;">A 1972 HP-35, rebuilt in pure lambda calculus. <a href="https://en.wikipedia.org/wiki/HP-35" target="_blank" rel="noopener" style="color:var(--church-gold);">More</a></p></div></div>` +

            `<div style="background:rgba(218,165,32,0.08);border:1px solid rgba(218,165,32,0.25);border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.65rem;">` +
            `<div style="font-weight:700;color:var(--church-gold);margin-bottom:0.3rem;">What can I do?</div>` +
            `<ul style="font-size:0.82rem;line-height:1.6;margin:0;padding-left:1.2rem;">` +
            `<li>Type a number, press <strong>ENTER</strong> to push it onto the stack</li>` +
            `<li>Type another number, then press an operator (+, \u2212, \u00d7, \u00f7)</li>` +
            `<li>Use scientific functions: <strong>sin</strong>, <strong>cos</strong>, <strong>tan</strong>, <strong>log</strong>, <strong>ln</strong>, <strong>\u221a</strong></li>` +
            `<li>The <strong>stack</strong> panel shows X, Y, Z, T registers \u2014 just like the real HP-35</li></ul></div>` +

            `<div style="background:rgba(100,180,255,0.08);border:1px solid rgba(100,180,255,0.25);border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.65rem;">` +
            `<div style="font-weight:600;color:rgba(130,200,255,0.95);font-size:0.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.3rem;">RPN \u2014 Reverse Polish Notation</div>` +
            `<p style="font-size:0.82rem;line-height:1.55;margin:0;">` +
            `Instead of typing <code>2 + 3 =</code>, you type <code>2 ENTER 3 +</code>. ` +
            `Put the numbers in first, then say what to do with them. ` +
            `No brackets needed, ever. Astronauts used this on Apollo missions! ` +
            `<a href="https://en.wikipedia.org/wiki/Reverse_Polish_notation" target="_blank" rel="noopener" style="color:rgba(130,200,255,0.95);">More</a></p></div>` +

            `<div style="background:rgba(100,200,100,0.06);border:1px solid rgba(100,200,100,0.2);border-radius:8px;padding:0.6rem 0.8rem;">` +
            `<div style="font-weight:600;color:rgba(100,200,100,0.9);font-size:0.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.3rem;">How to learn</div>` +
            `<p style="font-size:0.82rem;line-height:1.55;margin:0;">` +
            `Try this: press <strong>5</strong>, then <strong>ENTER</strong>, then <strong>3</strong>, then <strong>+</strong>. ` +
            `The answer (8) appears in X. Watch the lambda trace on the right \u2014 ` +
            `it shows Church numerals doing the same calculation with pure logic.</p></div>`
    },
    abacus: {
        title: 'Soroban Abacus',
        body:
            `<div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.75rem;">` +
            `<span style="font-size:2rem;">&#129518;</span>` +
            `<div><strong style="font-size:1rem;">The oldest computer in the world</strong>` +
            `<p style="font-size:0.82rem;color:var(--text-secondary);margin:0.2rem 0 0;">A Japanese soroban \u2014 people have used these for 2,500 years. <a href="https://en.wikipedia.org/wiki/Soroban" target="_blank" rel="noopener" style="color:var(--church-gold);">More</a></p></div></div>` +

            `<div style="background:rgba(218,165,32,0.08);border:1px solid rgba(218,165,32,0.25);border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.65rem;">` +
            `<div style="font-weight:700;color:var(--church-gold);margin-bottom:0.3rem;">What can I do?</div>` +
            `<ul style="font-size:0.82rem;line-height:1.6;margin:0;padding-left:1.2rem;">` +
            `<li>Click beads to move them \u2014 beads touching the bar count</li>` +
            `<li>Each <strong>top bead</strong> (heaven bead) is worth <strong>5</strong></li>` +
            `<li>Each <strong>bottom bead</strong> (earth bead) is worth <strong>1</strong></li>` +
            `<li>The digital readout shows your current number</li>` +
            `<li>Columns go right to left: ones, tens, hundreds, thousands\u2026</li></ul></div>` +

            `<div style="background:rgba(100,200,100,0.06);border:1px solid rgba(100,200,100,0.2);border-radius:8px;padding:0.6rem 0.8rem;">` +
            `<div style="font-weight:600;color:rgba(100,200,100,0.9);font-size:0.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.3rem;">How to learn</div>` +
            `<p style="font-size:0.82rem;line-height:1.55;margin:0;">` +
            `Start by making the number 7: move one heaven bead down (5) and two earth beads up (1+1). ` +
            `Now try 42: on the tens column move 4 earth beads up, on the ones column move 2 earth beads up. ` +
            `The trace shows CALL Abacus instructions \u2014 every click is a Church Machine operation.</p></div>`
    },
    sliderule: {
        title: 'Logarithmic Slide Rule',
        body:
            `<div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.75rem;">` +
            `<span style="font-size:2rem;">&#128207;</span>` +
            `<div><strong style="font-size:1rem;">The tool that built the modern world</strong>` +
            `<p style="font-size:0.82rem;color:var(--text-secondary);margin:0.2rem 0 0;">Engineers used slide rules for 350 years \u2014 from bridges to moon rockets. <a href="https://en.wikipedia.org/wiki/Slide_rule" target="_blank" rel="noopener" style="color:var(--church-gold);">More</a></p></div></div>` +

            `<div style="background:rgba(218,165,32,0.08);border:1px solid rgba(218,165,32,0.25);border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.65rem;">` +
            `<div style="font-weight:700;color:var(--church-gold);margin-bottom:0.3rem;">What can I do?</div>` +
            `<ul style="font-size:0.82rem;line-height:1.6;margin:0;padding-left:1.2rem;">` +
            `<li><strong>Drag the green C scale</strong> left or right to set the first number</li>` +
            `<li><strong>Drag the red cursor</strong> to read the answer on the D scale</li>` +
            `<li>Use the <strong>preset buttons</strong> (2\u00d73, \u03c0\u00d72) to see worked examples</li>` +
            `<li>Switch scale modes: C/D (multiply), A/B (squares), S/T (trig) and more</li></ul></div>` +

            `<div style="background:rgba(100,180,255,0.08);border:1px solid rgba(100,180,255,0.25);border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.65rem;">` +
            `<div style="font-weight:600;color:rgba(130,200,255,0.95);font-size:0.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.3rem;">How does it work?</div>` +
            `<p style="font-size:0.82rem;line-height:1.55;margin:0;">` +
            `Multiplication is just <em>adding lengths</em>. The scales are spaced by logarithms, so ` +
            `sliding log(a) + log(b) gives log(a\u00d7b). The labels <span style="color:#ff6644;">a</span> and ` +
            `<span style="color:#44aaff;">b</span> above the scale show you what\u2019s happening. ` +
            `<a href="https://en.wikipedia.org/wiki/Logarithm" target="_blank" rel="noopener" style="color:rgba(130,200,255,0.95);">More</a></p></div>` +

            `<div style="background:rgba(100,200,100,0.06);border:1px solid rgba(100,200,100,0.2);border-radius:8px;padding:0.6rem 0.8rem;">` +
            `<div style="font-weight:600;color:rgba(100,200,100,0.9);font-size:0.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:0.3rem;">How to learn</div>` +
            `<p style="font-size:0.82rem;line-height:1.55;margin:0;">` +
            `Click <strong>2 \u00d7 3</strong> to see the slide rule compute 6. Watch the hand-drawn arrow appear below. ` +
            `Then try dragging the C scale yourself and moving the cursor. ` +
            `NASA engineers calculated the Apollo trajectory with slide rules like this one.</p></div>`
    }
};

let currentToolGuide = null;
let currentMathMode = 'hp35';

function openCurrentToolGuide() {
    showToolGuide(currentMathMode, true);
}

function showToolGuide(tool, force) {
    if (POPUPS_DISABLED) return;
    if (!TOOL_GUIDES[tool]) return;
    if (!force && localStorage.getItem('churchMachine_toolGuide_' + tool + '_perm')) return;
    if (!force && localStorage.getItem('churchMachine_toolGuide_' + tool)) return;
    if (!force && !localStorage.getItem('church_welcome_dismissed')) return;
    if (!force && !localStorage.getItem('churchMachine_mathGuideDismissed')) return;

    const modal = document.getElementById('toolGuideModal');
    const title = document.getElementById('toolGuideTitle');
    const body = document.getElementById('toolGuideBody');
    if (!modal || !title || !body) return;

    const guide = TOOL_GUIDES[tool];
    title.textContent = guide.title;
    body.innerHTML = guide.body;
    currentToolGuide = tool;
    modal.style.display = 'flex';
}

function dismissToolGuide() {
    if (currentToolGuide) {
        localStorage.setItem('churchMachine_toolGuide_' + currentToolGuide, '1');
        const dontShow = document.getElementById('toolGuideDontShow');
        if (dontShow && dontShow.checked) {
            localStorage.setItem('churchMachine_toolGuide_' + currentToolGuide + '_perm', '1');
        }
    }
    const modal = document.getElementById('toolGuideModal');
    if (modal) modal.style.display = 'none';
    currentToolGuide = null;
}

function updateMathWelcome() {
    const el = document.getElementById('replWelcomeMsg');
    if (!el) return;
    const settings = getStudentSettings();
    const progress = getStudentProgress();
    const grade = settings.grade || '';
    const name = settings.name || '';
    const sessions = progress.replSessions || 0;

    let prompt = '';
    const greeting = name ? `Hi ${escapeHtml(name)}! ` : '';

    if (grade === 'K' || grade === '1' || grade === '2') {
        if (sessions === 0) prompt = greeting + 'Try typing: let x = 2 + 3';
        else if (sessions < 3) prompt = greeting + 'Nice work! Now try: let y = 5 - 1';
        else if (sessions < 6) prompt = greeting + 'Can you try: let z = 4 + 4';
        else prompt = greeting + 'Keep going! Try adding bigger numbers together.';
    } else if (grade === '3' || grade === '4' || grade === '5') {
        if (sessions === 0) prompt = greeting + 'Try typing: let x = 6 * 7';
        else if (sessions < 3) prompt = greeting + 'Great! Now try: let y = 100 / 4';
        else if (sessions < 6) prompt = greeting + 'Try this: let area = 12 * 8';
        else prompt = greeting + 'Challenge: try let total = 25 * 4 + 10';
    } else if (grade === '6' || grade === '7' || grade === '8') {
        if (sessions === 0) prompt = greeting + 'Try typing: let ratio = 355 / 113';
        else if (sessions < 3) prompt = greeting + 'Now try: let area = 3 * 3 + 4 * 4';
        else if (sessions < 6) prompt = greeting + 'Try: let percent = 45 / 200 * 100';
        else prompt = greeting + 'Explore: try defining variables and using them in expressions.';
    } else if (grade === '9' || grade === '10') {
        if (sessions === 0) prompt = greeting + 'Try typing: let slope = (8 - 2) / (5 - 1)';
        else if (sessions < 3) prompt = greeting + 'Try: let area = 3 * 3 + 4 * 4';
        else prompt = greeting + 'Try the Compile Session button to see your math become machine code.';
    } else if (grade === '11' || grade === '12' || grade === 'IB') {
        if (sessions === 0) prompt = greeting + 'Try typing: let n = 5   then: let f = 1 * 2 * 3 * 4 * 5';
        else if (sessions < 3) prompt = greeting + 'Try: let series = 1 + 1/2 + 1/6 + 1/24';
        else prompt = greeting + 'Try Compile Session to see your math compile to machine instructions.';
    } else {
        if (sessions === 0) prompt = (greeting || 'Welcome! ') + 'Try typing: let x = 2 + 3';
        else if (sessions < 3) prompt = (greeting || '') + 'Nice! Now try: let y = 10 * 5';
        else if (sessions < 6) prompt = (greeting || '') + 'Try: let answer = 7 * 8 / 4';
        else prompt = (greeting || '') + 'Keep exploring! Type HELP to see all available commands.';
    }

    el.textContent = prompt;
}

var SUPERSCRIPT_MAP = {
    '0':'\u2070','1':'\u00B9','2':'\u00B2','3':'\u00B3','4':'\u2074',
    '5':'\u2075','6':'\u2076','7':'\u2077','8':'\u2078','9':'\u2079',
    '+':'\u207A','-':'\u207B','n':'\u207F','i':'\u2071'
};

function convertCaretToSuperscript(text) {
    return text.replace(/\^([0-9+\-ni]+)/g, function(match, digits) {
        var result = '';
        for (var i = 0; i < digits.length; i++) {
            result += SUPERSCRIPT_MAP[digits[i]] || digits[i];
        }
        return result;
    });
}

function _appendToTraceTab(command, result) {
    const traceLog = document.querySelector('.repl-trace-log');
    if (!traceLog) return;
    const hint = document.querySelector('.repl-trace-hint');
    if (hint) hint.style.display = 'none';

    const entry = document.createElement('div');
    entry.className = 'repl-trace-entry';

    const header = document.createElement('div');
    header.className = 'repl-trace-entry-header';
    header.textContent = '\u03BB> ' + command;
    entry.appendChild(header);

    const resultLine = document.createElement('div');
    resultLine.className = 'repl-trace-entry-result';
    resultLine.textContent = result.text;
    entry.appendChild(resultLine);

    if (result.churchSteps) {
        for (const step of result.churchSteps) {
            const stepEl = document.createElement('div');
            stepEl.className = 'repl-trace-entry-step';
            stepEl.textContent = step;
            entry.appendChild(stepEl);
        }
    }

    if (result.cycles) {
        const cyclesEl = document.createElement('div');
        cyclesEl.className = 'repl-trace-entry-cycles';
        cyclesEl.textContent = '\u23F1 ' + result.cycles + ' cycles';
        cyclesEl.title = 'The number of hardware clock cycles the Church Machine processor needs to evaluate this expression on the Tang Nano 20K FPGA. Each instruction (ELOADCALL, XLOADLAMBDA, RETURN) takes one cycle. Compound expressions chain multiple operations, so the total is the sum of all steps. Lower counts mean faster execution.';
        cyclesEl.style.cursor = 'help';
        entry.appendChild(cyclesEl);
    }

    traceLog.appendChild(entry);
    traceLog.scrollTop = traceLog.scrollHeight;
}

function _buildReplEchoWithUnderline(command, colStart, colEnd) {
    if (colStart !== undefined && colEnd !== undefined && colEnd > colStart) {
        var before = escapeHtml(command.substring(0, colStart));
        var mid    = escapeHtml(command.substring(colStart, colEnd));
        var after  = escapeHtml(command.substring(colEnd));
        return convertCaretToSuperscript(before) +
               '<span class="repl-error-underline">' + convertCaretToSuperscript(mid) + '</span>' +
               convertCaretToSuperscript(after);
    }
    return convertCaretToSuperscript(escapeHtml(command));
}

function replExecute(cmdOverride) {
    const input = document.getElementById('replInput');
    const output = document.getElementById('replOutput');
    if (!input || !output) return;

    const command = cmdOverride || input.value.trim();
    if (!command) return;

    const result = repl.execute(command);

    var echoInner = (result && result.type === 'error')
        ? _buildReplEchoWithUnderline(command, result.colStart, result.colEnd)
        : convertCaretToSuperscript(escapeHtml(command));
    output.innerHTML += `<div class="repl-input-echo">\u03BB&gt; ${echoInner}</div>`;

    if (result) {
        if (result.type === 'result') {
            output.innerHTML += `<div class="repl-result">${convertCaretToSuperscript(escapeHtml(result.text))}</div>`;
            _appendToTraceTab(command, result);
            if (result.pipeline && pipelineViz) {
                pipelineViz.showFullPipeline(result.pipeline);
            }
        } else if (result.type === 'error') {
            output.innerHTML += `<div class="repl-error">${escapeHtml(result.text)}</div>`;
        } else if (result.type === 'info') {
            output.innerHTML += `<div class="repl-info">${escapeHtml(result.text)}</div>`;
        }
    }

    if (!cmdOverride) input.value = '';
    output.scrollTop = output.scrollHeight;
}

function switchMathMode(mode) {
    currentMathMode = mode;
    const containers = {
        interactive: document.getElementById('interactiveMathContent'),
        hp35: document.getElementById('hp35Container'),
        abacus: document.getElementById('abacusContainer'),
        sliderule: document.getElementById('slideruleContainer')
    };
    const tabs = {
        interactive: document.getElementById('mathTabInteractive'),
        hp35: document.getElementById('mathTabHP35'),
        abacus: document.getElementById('mathTabAbacus'),
        sliderule: document.getElementById('mathTabSlideRule')
    };

    for (const key in containers) {
        if (containers[key]) {
            containers[key].style.display = key === mode ? (key === 'interactive' ? 'flex' : 'block') : 'none';
        }
    }
    for (const key in tabs) {
        if (tabs[key]) {
            tabs[key].classList.toggle('active', key === mode);
        }
    }

    if (mode === 'hp35' && !hp35State.rendered) renderHP35Calculator();
    if (mode === 'abacus' && !abacusState.rendered && typeof renderAbacusCalculator === 'function') renderAbacusCalculator();
    if (mode === 'sliderule' && !slideruleState.rendered && typeof renderSlideRuleCalculator === 'function') renderSlideRuleCalculator();

    const hiwTab = document.getElementById('sidebarTabHowItWorks');
    const htuTab = document.getElementById('sidebarTabHowToUse');
    const trTab = document.getElementById('sidebarTabTrace');
    if (hiwTab) hiwTab.style.display = '';
    if (htuTab) htuTab.style.display = '';
    if (trTab) trTab.style.display = '';
    populateHowItWorks(mode);
    populateHowToUse(mode);
    populateTrace(mode);
    switchSidebarTab('trace');

    if (typeof historySetTool === 'function') historySetTool(mode);

    showToolGuide(mode);
}

function switchCodeTab(tab) {
    const consoleContent = document.getElementById('codeConsoleContent');
    const historyPanel = document.getElementById('codeHistoryPanel');
    const syntaxPanel = document.getElementById('codeSyntaxPanel');
    const jsPanel = document.getElementById('codeJsPanel');
    const tabConsole = document.getElementById('codeTabConsole');
    const tabHistory = document.getElementById('codeTabHistory');
    const tabSyntax = document.getElementById('codeTabSyntax');
    const tabJs = document.getElementById('codeTabJs');

    if (consoleContent) consoleContent.style.display = 'none';
    if (historyPanel) historyPanel.style.display = 'none';
    if (syntaxPanel) syntaxPanel.style.display = 'none';
    if (jsPanel) jsPanel.style.display = 'none';
    if (tabConsole) tabConsole.classList.remove('active');
    if (tabHistory) tabHistory.classList.remove('active');
    if (tabSyntax) tabSyntax.classList.remove('active');
    if (tabJs) tabJs.classList.remove('active');

    if (tab === 'history') {
        if (historyPanel) historyPanel.style.display = 'flex';
        if (tabHistory) tabHistory.classList.add('active');
        const area = document.getElementById('codeHistoryContent');
        if (area && !area.innerHTML.trim() && typeof historyRefreshCode === 'function') historyRefreshCode();
    } else if (tab === 'syntax') {
        if (syntaxPanel) syntaxPanel.style.display = 'block';
        if (tabSyntax) tabSyntax.classList.add('active');
        if (typeof renderSyntaxRef === 'function') renderSyntaxRef();
    } else if (tab === 'js') {
        if (jsPanel) jsPanel.style.display = 'flex';
        if (tabJs) tabJs.classList.add('active');
        renderJsTab();
    } else {
        if (consoleContent) consoleContent.style.display = 'flex';
        if (tabConsole) tabConsole.classList.add('active');
    }
}

const _JS_TAB_FILES = [
    { name: 'simulator.js',          label: 'simulator',          desc: 'Core CPU, boot sequence, GC, NS table, memory layout' },
    { name: 'assembler.js',          label: 'assembler',          desc: 'Church Machine assembler — encodes instructions to 32-bit words' },
    { name: 'boot_uploads.js',       label: 'boot_uploads',       desc: 'Boot ROM upload handling — sends binary to FPGA over WebSerial' },
    { name: 'system_abstractions.js',label: 'system_abstractions',desc: 'System abstraction definitions loaded into the NS table at boot' },
    { name: 'device_abstractions.js',label: 'device_abstractions',desc: 'Device register abstractions (MMIO, UART, GPIO, …)' },
    { name: 'app.js',                label: 'app',                desc: 'IDE front-end — views, panels, GC UI, CR table rendering' },
    {
        name: 'call_overflow_guard',
        label: 'call-overflow',
        desc: 'Stack overflow guard — CALL and ELOADCALL handlers in simulator.js (inline excerpt)',
        inline: true,
        content:
`// ═══════════════════════════════════════════════════════════════════════════
//  Stack Overflow Guard — simulator.js  (two sites)
// ═══════════════════════════════════════════════════════════════════════════
//
//  The Church Machine thread lump is 256 words.
//  Call frames live at the TOP of that lump, growing downward.
//  Boot sets STO = sp_max = 243 (the sentinel / empty-stack mark).
//
//  Each CALL or ELOADCALL writes a 2-word frame and decrements STO by 2:
//    lump[STO]   = frameWord  — returnPC · flags · sz · prev_STO  (packed)
//    lump[STO-1] = old CR6    — caller's E-type Golden Token
//
//  After ~121 nested calls STO reaches 1.  Without the guard, the next
//  (savedSTO - 2) & 0xFFF would silently wrap around to 4094, corrupting
//  the heap and producing baffling incorrect behaviour.
//  With the guard, the CPU raises a clean STACK_OVERFLOW fault instead.
//
// ───────────────────────────────────────────────────────────────────────────
//  Site 1 of 2 — _execCall()   (simulator.js ~line 1492)
//  Fires on direct CALL CRd instructions (GT already in register).
// ───────────────────────────────────────────────────────────────────────────

        // Stack overflow: need 2 words for frame (at sto and sto-1)
        if (this.sto < 2) {
            this.fault('STACK_OVERFLOW',
                \`CALL CR\${d.crDst}: call stack overflow — STO=\${this.sto}, \` +
                \`stack exhausted after \${this.callStack.length} frame(s). Thread lump full.\`);
            return null;
        }
        const savedSTO = this.sto;
        const oldCR6GT = this.cr[6].word0 >>> 0;   // capture BEFORE callee overwrites CR6
        const frameWord = this._packFrameWord(this.pc + 1, 1, savedSTO);
        this.callStack.push({
            returnPC:   this.pc + 1,
            savedCRs:   this.cr.map(c => ({...c})),
            savedDRs:   [...this.dr],
            savedFlags: {...this.flags},
            savedSTO,
            sz: 1,
            frameWord,
        });
        // Write 2-word CALL frame to thread lump stack zone (hardware-accurate):
        //   lump[STO]   = frameWord   (returnPC, flags, sz, prev_STO)
        //   lump[STO-1] = old CR6 GT  (caller's E-type c-list token, restored by RETURN)
        const callThreadBase = this.cr[12] && this.cr[12].word1;
        if (callThreadBase) {
            this.memory[callThreadBase + savedSTO]     = frameWord;
            this.memory[callThreadBase + savedSTO - 1] = oldCR6GT;
        }
        this.sto = (savedSTO - 2) & 0xFFF;

// ───────────────────────────────────────────────────────────────────────────
//  Site 2 of 2 — _execEloadcall()   (simulator.js ~line 2005)
//  Fires on ELOADCALL CRd, [CRs + imm] instructions (LOAD + TPERM + CALL).
//  These are the capability-based cross-abstraction calls generated by the
//  CLOOMC++ compiler for  call(Abstraction.method())  expressions.
// ───────────────────────────────────────────────────────────────────────────

        // Stack overflow: need 2 words for frame (at sto and sto-1)
        if (this.sto < 2) {
            this.fault('STACK_OVERFLOW',
                \`ELOADCALL CR\${d.crDst}: call stack overflow — STO=\${this.sto}, \` +
                \`stack exhausted after \${this.callStack.length} frame(s). Thread lump full.\`);
            return null;
        }
        const savedSTO_ec = this.sto;
        const frameWord_ec = this._packFrameWord(this.pc + 1, 1, savedSTO_ec);
        this.callStack.push({
            returnPC:   this.pc + 1,
            savedCRs:   this.cr.map(c => ({...c})),
            savedDRs:   [...this.dr],
            savedFlags: {...this.flags},
            savedSTO:   savedSTO_ec,
            sz: 1,
            frameWord:  frameWord_ec,
        });
        this.sto = (savedSTO_ec - 2) & 0xFFF;

// ═══════════════════════════════════════════════════════════════════════════
//  Stack budget calculation
//
//  STO at boot:      243   (= sp_max sentinel after boot sequence)
//  Words per frame:    2
//  Max frames:       243 ÷ 2  =  121 full frames before STO reaches 1
//
//  Try it: load the "Stack Overflow ✦" example, compile, create the
//  abstraction, then run — the recursive self-call drains STO by 2 on
//  every ELOADCALL until the guard fires at frame 122.
// ═══════════════════════════════════════════════════════════════════════════`
    },
];
let _jsTabActiveFile = null;

function renderJsTab() {
    const bar = document.getElementById('codeJsFileBar');
    const src = document.getElementById('codeJsSource');
    if (!bar) return;
    if (!bar.innerHTML.trim()) {
        bar.innerHTML = _JS_TAB_FILES.map(f =>
            `<button class="btn btn-sm js-file-btn" id="jsFileBtn_${f.name.replace('.','_')}"
                onclick="loadJsFile('${f.name}')"
                data-tooltip="${f.desc}"
                style="font-size:0.7rem;padding:0.15rem 0.5rem;">${f.label}</button>`
        ).join('');
    }
    if (!_jsTabActiveFile && src) {
        src.textContent = 'Select a file above to view its source.';
    }
}

function loadJsFile(filename) {
    const src = document.getElementById('codeJsSource');
    if (!src) return;
    if (_jsTabActiveFile === filename) return;
    _jsTabActiveFile = filename;

    document.querySelectorAll('.js-file-btn').forEach(b => b.classList.remove('active'));
    const active = document.getElementById('jsFileBtn_' + filename.replace(/\./g, '_'));
    if (active) active.classList.add('active');

    const entry = _JS_TAB_FILES.find(f => f.name === filename);
    if (entry && entry.inline) {
        src.textContent = entry.content;
        return;
    }

    src.textContent = 'Loading…';
    fetch('/simulator/' + filename)
        .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(text => { src.textContent = text; })
        .catch(err => { src.textContent = 'Could not load ' + filename + ': ' + err.message; });
}

function switchSidebarTab(tab) {
    const panels = {
        challenge: document.getElementById('sidebarChallengeContent'),
        history: document.getElementById('sidebarHistoryContent'),
        howitworks: document.getElementById('sidebarHowItWorksContent'),
        howtouse: document.getElementById('sidebarHowToUseContent'),
        trace: document.getElementById('sidebarTraceContent')
    };
    const tabs = {
        challenge: document.getElementById('sidebarTabChallenge'),
        history: document.getElementById('sidebarTabHistory'),
        howitworks: document.getElementById('sidebarTabHowItWorks'),
        howtouse: document.getElementById('sidebarTabHowToUse'),
        trace: document.getElementById('sidebarTabTrace')
    };

    for (const key in panels) { if (panels[key]) panels[key].style.display = 'none'; }
    for (const key in tabs) { if (tabs[key]) tabs[key].classList.remove('active'); }

    if (panels[tab]) panels[tab].style.display = 'block';
    if (tabs[tab]) tabs[tab].classList.add('active');

    if (tab === 'history' && typeof historyRefresh === 'function') {
        const area = document.getElementById('historyContent');
        if (area && !area.innerHTML.trim()) historyRefresh();
    }

    if (tab === 'trace') {
        const traceContainer = document.getElementById('sidebarTraceContent');
        if (traceContainer && !traceContainer.innerHTML.trim()) {
            const currentMode = document.querySelector('.math-tab.active');
            if (currentMode) {
                const modeId = currentMode.id.replace('mathTab', '').toLowerCase();
                const modeMap = { 'hp35': 'hp35', 'abacus': 'abacus', 'sliderule': 'sliderule', 'interactivemath': 'interactive' };
                populateTrace(modeMap[modeId] || 'interactive');
            }
        }
    }
}

function populateHowItWorks(mode) {
    const container = document.getElementById('sidebarHowItWorksContent');
    if (!container) return;

    const content = {
        hp35: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">How the HP-35 Works</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    The HP-35 uses <strong>Reverse Polish Notation</strong> (RPN) &mdash; you enter numbers first, then the operation.
                    Type <code>2 ENTER 3 +</code> instead of <code>2 + 3 =</code>.
                    There are no brackets and no equals key. A <strong>4-register stack</strong> (X, Y, Z, T) holds intermediate results automatically.
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(130,200,255,0.95);">The Stack</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.4rem 0;">Every number you enter goes onto the <strong>X register</strong>. When you press ENTER, X is copied up to Y, making room for the next number.</p>
                    <p style="margin:0 0 0.4rem 0;">Operations like <code>+</code> take X and Y, compute the result, and put it back in X. The stack drops down &mdash; no lost values, no parentheses needed.</p>
                    <p style="margin:0;">This is exactly how the Church Machine&rsquo;s Turing domain manages data registers &mdash; push, operate, pop.</p>
                </div>
            </div>
            <div class="panel">
                <div class="panel-title" style="color:rgba(100,200,100,0.9);">Church Machine Connection</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.4rem 0;">Every key press is a <strong>Church Machine instruction</strong>. The trace panel shows each operation as a lambda expression.</p>
                    <p style="margin:0;"><code>SIN</code>, <code>LOG</code>, and <code>e<sup>x</sup></code> are all computed using the CORDIC algorithm &mdash; the same method used in the original 1972 chip, rebuilt here in pure lambda calculus.</p>
                </div>
            </div>`,

        abacus: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">The Church Abstraction as a Digital Abacus</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.5rem 0;">A Church Machine <strong>abstraction</strong> is like a digital abacus &mdash; a self-contained block with rods (methods) and beads (data) that only the owner can move.</p>
                </div>
                <div style="display:flex;flex-direction:column;gap:0.25rem;margin-bottom:0.6rem;">
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.25rem 0.5rem;background:rgba(0,0,0,0.2);border-radius:4px;">
                        <span style="color:var(--church-gold);">Abacus Frame</span><span style="color:var(--text-secondary);">\u2194</span><span style="color:rgba(130,200,255,0.95);">Abstraction (NS Entry)</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.25rem 0.5rem;background:rgba(0,0,0,0.2);border-radius:4px;">
                        <span style="color:var(--church-gold);">Rods</span><span style="color:var(--text-secondary);">\u2194</span><span style="color:rgba(130,200,255,0.95);">Methods (code at offset 0)</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.25rem 0.5rem;background:rgba(0,0,0,0.2);border-radius:4px;">
                        <span style="color:var(--church-gold);">Beads</span><span style="color:var(--text-secondary);">\u2194</span><span style="color:rgba(130,200,255,0.95);">Data (within the lump)</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.25rem 0.5rem;background:rgba(0,0,0,0.2);border-radius:4px;">
                        <span style="color:var(--church-gold);">Heaven Beads (5)</span><span style="color:var(--text-secondary);">\u2194</span><span style="color:rgba(130,200,255,0.95);">Capabilities (c-list, Church domain)</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.25rem 0.5rem;background:rgba(0,0,0,0.2);border-radius:4px;">
                        <span style="color:var(--church-gold);">Earth Beads (1 each)</span><span style="color:var(--text-secondary);">\u2194</span><span style="color:rgba(130,200,255,0.95);">Data words (Turing domain)</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.25rem 0.5rem;background:rgba(0,0,0,0.2);border-radius:4px;">
                        <span style="color:var(--church-gold);">Beam Bar</span><span style="color:var(--text-secondary);">\u2194</span><span style="color:rgba(130,200,255,0.95);">Domain purity boundary</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:0.25rem 0.5rem;background:rgba(0,0,0,0.2);border-radius:4px;">
                        <span style="color:var(--church-gold);">Place Value (10\u207f)</span><span style="color:var(--text-secondary);">\u2194</span><span style="color:rgba(130,200,255,0.95);">Abstraction layer (1\u20139)</span>
                    </div>
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(100,200,100,0.9);">Why It Matters</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    On a soroban, each rod is independent &mdash; you can only change beads on the rod you&rsquo;re touching. In the Church Machine, each abstraction works the same way: you can only call its methods through a <strong>Golden Token</strong> with the right permissions. No token, no access.
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(130,200,255,0.95);">Structure of a Lump</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;font-family:monospace;background:rgba(0,0,0,0.2);padding:0.4rem 0.6rem;border-radius:4px;font-size:0.78rem;"><span style="color:var(--church-gold);">[Code at offset 0]</span> <span style="color:var(--text-secondary);">[Free space]</span> <span style="color:rgba(130,200,255,0.95);">[C-list at end]</span></p>
                    <p style="margin:0;">Methods live at the start. The capability list (c-list) lives at the end. Free space grows between them &mdash; just like beads slide along rods.</p>
                </div>
            </div>
            <div class="panel">
                <div class="panel-title" style="color:rgba(180,140,255,0.95);">Functional Methods</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    Each method is a pure function: give it inputs, get outputs. No side effects, no hidden state changes. Just as sliding a bead is a single, visible action &mdash; every method call is explicit and auditable through the trace below.
                </div>
            </div>`,

        sliderule: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">How the Slide Rule Works</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    The slide rule computes by <em>adding or comparing logarithmic lengths</em>.
                    On the C/D scales, sliding by log(a) and reading at C=b gives D = a&times;b.
                    <span style="color:#ff6644;">a</span> and <span style="color:#44aaff;">b</span> are labelled above the scale. The <span style="color:#ff3333;">red arrow</span> below shows a &times; b.
                    Other scales use the same principle for squares (A/B), cubes (K),
                    reciprocals (CI), and trigonometry (S/T) &mdash; all backed by
                    CALL SlideRule at NS[16].
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(130,200,255,0.95);">Floating Point &mdash; The Slide Rule Inside Your Computer</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.5rem 0;">Every floating-point number works like a slide rule reading: a <strong>mantissa</strong> (scale position) and an <strong>exponent</strong> (power of 10). IEEE 754 does the same in binary.</p>
                    <div style="display:flex;flex-direction:column;gap:0.3rem;background:rgba(0,0,0,0.2);border-radius:6px;padding:0.5rem;margin-bottom:0.5rem;font-size:0.78rem;font-family:monospace;">
                        <div><span style="color:var(--church-gold);">Slide Rule:</span> &plusmn; scale position (1&ndash;10) &times; 10&#8319;</div>
                        <div><span style="color:rgba(130,200,255,0.95);">IEEE 754:</span> sign bit &middot; mantissa (1.xxx&#8322;) &times; 2&#7497;</div>
                    </div>
                    <p style="margin:0 0 0.3rem 0;"><strong style="color:var(--church-gold);">Multiply = add logs:</strong> <span style="color:var(--church-gold);">log(a &times; b) = log(a) + log(b)</span>. CPUs do the same: add exponents, multiply mantissas.</p>
                    <p style="margin:0;"><strong style="color:var(--church-gold);">In the Church Machine:</strong> 32-bit Turing data words follow the same mantissa + exponent structure.</p>
                </div>
            </div>`,

        interactive: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">How Pure Math Works</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    Type expressions using <code>let</code> bindings to define variables and build calculations step by step.
                    For example: <code>let x = 5</code>, then <code>let y = x * 3</code>.
                    The REPL evaluates each line and remembers your variables.
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(130,200,255,0.95);">Compile Session</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.4rem 0;">Click <strong>Compile Session</strong> to convert your let-bindings into Church Machine assembly code. Each variable becomes a register allocation and each operation becomes an instruction.</p>
                    <p style="margin:0;">This is Ada Lovelace&rsquo;s symbolic math notation &mdash; the same front-end used by the CLOOMC++ compiler. Your calculator session becomes a real program.</p>
                </div>
            </div>
            <div class="panel">
                <div class="panel-title" style="color:rgba(100,200,100,0.9);">Church Machine Connection</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.4rem 0;">Every <code>let</code> binding is a <strong>lambda abstraction</strong>: <code>let x = 5 in ...</code> is (&lambda;x. ...) 5.</p>
                    <p style="margin:0;">The Compile Session button shows this transformation explicitly &mdash; from symbolic math to Church Machine instructions, proving that your calculator and the processor speak the same language.</p>
                </div>
            </div>`
    };

    container.innerHTML = content[mode] || content.interactive;
}

function populateHowToUse(mode) {
    const container = document.getElementById('sidebarHowToUseContent');
    if (!container) return;

    const content = {
        hp35: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">How to Use RPN</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.5rem 0;">The HP-35 uses a <strong>4-level stack</strong> instead of an <strong>=</strong> key. You enter numbers first, then press the operation.</p>
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(130,200,255,0.95);">Key Actions</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;"><strong>ENTER \u2191</strong> \u2014 Pushes X up into Y (and Y\u2192Z, Z\u2192T). Use between numbers.</p>
                    <p style="margin:0 0 0.3rem 0;"><strong>+  \u2212  \u00d7  \u00f7</strong> \u2014 Takes X and Y, puts the result in X, stack drops down.</p>
                    <p style="margin:0 0 0.3rem 0;"><strong>x\u21c4y</strong> \u2014 Swaps X and Y. Fix wrong order without retyping.</p>
                    <p style="margin:0;"><strong>R\u2193</strong> \u2014 Rolls the whole stack down: T\u2192X, X\u2192Y, Y\u2192Z, Z\u2192T.</p>
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(100,200,100,0.9);">Try It</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.4rem 0;"><strong>(3 + 4) \u00d7 5:</strong></p>
                    <p style="margin:0 0 0.6rem 0;font-family:monospace;background:rgba(0,0,0,0.2);padding:0.4rem 0.6rem;border-radius:4px;">3 <span style="color:var(--church-gold);">ENTER</span> 4 <span style="color:var(--church-gold);">+</span> 5 <span style="color:var(--church-gold);">\u00d7</span> \u2192 35</p>
                    <p style="margin:0 0 0.4rem 0;"><strong>(9 \u2212 2) \u00f7 (1 + 6):</strong></p>
                    <p style="margin:0;font-family:monospace;background:rgba(0,0,0,0.2);padding:0.4rem 0.6rem;border-radius:4px;">9 <span style="color:var(--church-gold);">ENTER</span> 2 <span style="color:var(--church-gold);">\u2212</span> 1 <span style="color:var(--church-gold);">ENTER</span> 6 <span style="color:var(--church-gold);">+</span> <span style="color:var(--church-gold);">\u00f7</span> \u2192 1</p>
                </div>
            </div>
            <div class="panel">
                <div class="panel-title" style="color:rgba(180,140,255,0.95);">Why RPN?</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    No parentheses needed. No = key. Complex expressions flow naturally left to right. The stack remembers intermediate results for you \u2014 like how you'd work it out on paper, one step at a time.
                </div>
            </div>`,

        abacus: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">How to Use the Abacus</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    Click beads to move them toward or away from the centre bar. Each column is one digit.
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(130,200,255,0.95);">Reading a Number</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;"><strong>Top bead</strong> (above bar) = <strong>5</strong> when moved down.</p>
                    <p style="margin:0 0 0.3rem 0;"><strong>Bottom beads</strong> (below bar) = <strong>1 each</strong> when moved up.</p>
                    <p style="margin:0;">Count active beads in each column. Rightmost column = ones, next = tens, and so on.</p>
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(100,200,100,0.9);">Try It: Enter 42</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;">In the <strong>tens</strong> column: move 4 bottom beads up.</p>
                    <p style="margin:0;">In the <strong>ones</strong> column: move 2 bottom beads up.</p>
                </div>
            </div>
            <div class="panel">
                <div class="panel-title" style="color:rgba(180,140,255,0.95);">Addition</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;">Set the first number, then add the second by moving more beads.</p>
                    <p style="margin:0;">When a column exceeds 9, reset it and carry 1 to the next column left \u2014 exactly like the Church Machine\u2019s binary carry.</p>
                </div>
            </div>`,

        sliderule: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">How to Use the Slide Rule</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;"><strong>Drag the <span style="color:#33cc66;">green slide</span></strong> to set the first value.</p>
                    <p style="margin:0;"><strong>Drag the <span style="color:#ff3333;">red cursor</span></strong> to read the result at any point on the scale.</p>
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(130,200,255,0.95);">Scales</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;"><strong>C / D</strong> \u2014 Multiplication and division.</p>
                    <p style="margin:0 0 0.3rem 0;"><strong>A / B</strong> \u2014 Squares and square roots.</p>
                    <p style="margin:0 0 0.3rem 0;"><strong>C / CI</strong> \u2014 Reciprocals (inverted C).</p>
                    <p style="margin:0 0 0.3rem 0;"><strong>D / K</strong> \u2014 Cubes and cube roots.</p>
                    <p style="margin:0;"><strong>S / T</strong> \u2014 Sine and tangent.</p>
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(100,200,100,0.9);">Try It: 2 \u00d7 3</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;">On C/D: slide the C scale so its 1 aligns with D=2.</p>
                    <p style="margin:0;">Move the cursor to C=3. Read D under the cursor \u2192 6.</p>
                </div>
            </div>
            <div class="panel">
                <div class="panel-title" style="color:rgba(180,140,255,0.95);">Try the Presets</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    Click the <strong>Try</strong> buttons below the slide rule to see multiplication and square root examples animated automatically.
                </div>
            </div>`,

        interactive: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">How to Use Pure Math</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    Type expressions into the REPL input and press Enter. Use <code>let</code> to define variables.
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(130,200,255,0.95);">Commands</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0 0 0.3rem 0;"><code>let x = 5</code> \u2014 Define a variable.</p>
                    <p style="margin:0 0 0.3rem 0;"><code>let y = x * 3 + 1</code> \u2014 Use variables in expressions.</p>
                    <p style="margin:0 0 0.3rem 0;"><code>VARS</code> \u2014 Show all defined variables.</p>
                    <p style="margin:0;"><code>CLEAR</code> \u2014 Reset everything.</p>
                </div>
            </div>
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:rgba(100,200,100,0.9);">Try It</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    <p style="margin:0;font-family:monospace;background:rgba(0,0,0,0.2);padding:0.4rem 0.6rem;border-radius:4px;line-height:1.8;">let r = 5<br>let area = 3.14159 * r * r<br>area</p>
                </div>
            </div>
            <div class="panel">
                <div class="panel-title" style="color:rgba(180,140,255,0.95);">Compile Session</div>
                <div style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);">
                    Click <strong>Compile Session</strong> to convert your let-bindings into Church Machine assembly. Each variable becomes a register and each operation becomes an instruction.
                </div>
            </div>`
    };

    container.innerHTML = content[mode] || content.interactive;
}

function populateTrace(mode) {
    const container = document.getElementById('sidebarTraceContent');
    if (!container) return;

    const content = {
        hp35: `
            <div class="panel" style="margin-bottom:0.75rem;">
                <div class="panel-title" style="color:var(--church-gold);">4-Register Stack</div>
                <div class="hp35-stack-display">
                    <div class="hp35-stack-reg" data-reg="3"></div>
                    <div class="hp35-stack-reg" data-reg="2"></div>
                    <div class="hp35-stack-reg" data-reg="1"></div>
                    <div class="hp35-stack-reg" data-reg="0"></div>
                </div>
                <div class="hp35-stack-diagram">
                    <div class="hp35-stack-row"><span class="hp35-sreg">T</span> <span class="hp35-sdesc">Top \u2014 oldest value, falls off when full</span></div>
                    <div class="hp35-stack-row"><span class="hp35-sreg">Z</span> <span class="hp35-sdesc">Third level \u2014 holds earlier numbers</span></div>
                    <div class="hp35-stack-row"><span class="hp35-sreg">Y</span> <span class="hp35-sdesc">Second operand for +, \u2212, \u00d7, \u00f7</span></div>
                    <div class="hp35-stack-row"><span class="hp35-sreg">X</span> <span class="hp35-sdesc">Display \u2014 what you see and type into</span></div>
                </div>
            </div>
            <div class="panel">
                <div class="panel-title" style="color:var(--church-gold);">Lambda Calculus Trace</div>
                <div class="hp35-trace-area"></div>
            </div>`,

        abacus: `
            <div class="panel">
                <div class="panel-title" style="color:var(--church-gold);">Church Machine Trace</div>
                <div class="abacus-trace-area"></div>
            </div>`,

        sliderule: `
            <div class="panel">
                <div class="panel-title" style="color:var(--church-gold);">Church Machine Trace</div>
                <div class="sliderule-trace-area"></div>
            </div>`,

        interactive: `
            <div class="panel">
                <div class="panel-title" style="color:var(--church-gold);">Church Machine Trace</div>
                <div class="repl-trace-log"></div>
                <div class="repl-trace-hint" style="font-size:0.82rem;line-height:1.55;color:var(--text-secondary);padding:0.5rem 0;">
                    Enter expressions in Pure Math to see Church Machine operations here.
                </div>
            </div>`
    };

    container.innerHTML = content[mode] || content.interactive;

    if (mode === 'hp35' && typeof hp35UpdateDisplay === 'function') hp35UpdateDisplay();
    if (mode === 'abacus' && typeof abacusUpdateDisplay === 'function') abacusUpdateDisplay();
    if (mode === 'sliderule' && typeof slideruleRenderDisplay === 'function') slideruleRenderDisplay();
}

function replKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        replExecute();
    }
}

var MATH_SYMBOLS = {
    'Greek': [
        ['\u03B1','alpha'], ['\u03B2','beta'], ['\u03B3','gamma'], ['\u03B4','delta'],
        ['\u03B5','epsilon'], ['\u03B6','zeta'], ['\u03B7','eta'], ['\u03B8','theta'],
        ['\u03B9','iota'], ['\u03BA','kappa'], ['\u03BB','lambda'], ['\u03BC','mu'],
        ['\u03BD','nu'], ['\u03BE','xi'], ['\u03C0','pi'], ['\u03C1','rho'],
        ['\u03C3','sigma'], ['\u03C4','tau'], ['\u03C6','phi'], ['\u03C7','chi'],
        ['\u03C8','psi'], ['\u03C9','omega'],
        ['\u0393','Gamma'], ['\u0394','Delta'], ['\u0398','Theta'], ['\u039B','Lambda'],
        ['\u03A0','Pi'], ['\u03A3','Sigma'], ['\u03A6','Phi'], ['\u03A8','Psi'], ['\u03A9','Omega']
    ],
    'Arithmetic': [
        ['\u00B1','plus-minus'], ['\u00D7','times'], ['\u00F7','divide'],
        ['\u2212','minus'], ['\u22C5','dot product'], ['\u2219','bullet dot'],
        ['\u221A','square root'], ['\u221B','cube root'], ['\u221C','fourth root'],
        ['\u2070','superscript 0'], ['\u00B9','superscript 1'], ['\u00B2','superscript 2'],
        ['\u00B3','superscript 3'], ['\u2074','superscript 4'], ['\u2075','superscript 5'],
        ['\u2076','superscript 6'], ['\u2077','superscript 7'], ['\u2078','superscript 8'],
        ['\u2079','superscript 9'], ['\u207A','superscript +'], ['\u207B','superscript -'],
        ['\u207F','superscript n'],
        ['\u2080','subscript 0'], ['\u2081','subscript 1'], ['\u2082','subscript 2'],
        ['\u2083','subscript 3'], ['\u2084','subscript 4'], ['\u2085','subscript 5'],
        ['\u2086','subscript 6'], ['\u2087','subscript 7'], ['\u2088','subscript 8'],
        ['\u2089','subscript 9'],
        ['\u2260','not equal'], ['\u2248','approx equal'], ['\u2261','identical'],
        ['\u2264','less or equal'], ['\u2265','greater or equal'],
        ['\u226A','much less'], ['\u226B','much greater'],
        ['\u221E','infinity'], ['\u2030','per mille']
    ],
    'Constants': [
        ['\u03C0','pi = 3.14159...'], ['e','Euler\'s number = 2.71828...'],
        ['\u03C6','golden ratio = 1.61803...'], ['\u221E','infinity'],
        ['c','speed of light'], ['G','gravitational constant'],
        ['g','gravitational accel = 9.81'], ['h','Planck constant'],
        ['\u210F','reduced Planck (h-bar)'], ['k\u0299','Boltzmann constant'],
        ['N\u2090','Avogadro number'], ['R','gas constant'],
        ['\u03B5\u2080','vacuum permittivity'], ['\u03BC\u2080','vacuum permeability'],
        ['e\u207B','electron charge'], ['m\u2091','electron mass'],
        ['m\u209A','proton mass'], ['\u03C3','Stefan-Boltzmann'],
        ['i','imaginary unit'], ['\u03B3','Euler-Mascheroni = 0.5772...'],
        ['\u03B6','Ap\u00E9ry\'s constant \u03B6(3)'], ['\u221A2','Pythagoras = 1.4142...'],
        ['ln2','natural log of 2 = 0.6931...'], ['ln10','natural log of 10 = 2.3025...']
    ],
    'Sets': [
        ['\u2205','empty set'], ['\u2208','element of'], ['\u2209','not element of'],
        ['\u220B','contains'], ['\u2282','subset'], ['\u2283','superset'],
        ['\u2286','subset or equal'], ['\u2287','superset or equal'],
        ['\u222A','union'], ['\u2229','intersection'], ['\u2216','set minus'],
        ['\u2295','direct sum'], ['\u2297','tensor product'],
        ['\u2115','naturals N'], ['\u2124','integers Z'], ['\u211A','rationals Q'],
        ['\u211D','reals R'], ['\u2102','complex C'],
        ['\u2200','for all'], ['\u2203','exists'], ['\u2204','not exists']
    ],
    'Logic': [
        ['\u00AC','not'], ['\u2227','and'], ['\u2228','or'],
        ['\u2295','xor'], ['\u21D2','implies'], ['\u21D4','iff'],
        ['\u22A2','proves'], ['\u22A8','models'], ['\u22A4','true/top'],
        ['\u22A5','false/bottom'],
        ['\u25A1','necessity'], ['\u25C7','possibility'],
        ['\u2234','therefore'], ['\u2235','because'],
        ['\u22A3','does not prove']
    ],
    'Calculus': [
        ['\u2202','partial derivative'], ['\u222B','integral'], ['\u222C','double integral'],
        ['\u222D','triple integral'], ['\u222E','contour integral'],
        ['\u2207','nabla/del'], ['\u2206','increment/Laplacian'],
        ['\u2211','summation'], ['\u220F','product'],
        ['\u2032','prime'], ['\u2033','double prime'],
        ['\u1D45','dx'], ['\u2202','del'],
        ['\u221D','proportional to'], ['\u2243','asymptotic'],
        ['\u2A01','big oplus'], ['\u2A02','big otimes']
    ],
    'Physics': [
        ['\u210F','h-bar'], ['\u212B','angstrom'],
        ['\u2126','ohm'], ['\u00B5','micro'],
        ['\u2220','angle'], ['\u22A5','perpendicular'], ['\u2225','parallel'],
        ['\u2190','left arrow'], ['\u2192','right arrow'],
        ['\u2194','left-right arrow'], ['\u21C0','harpoon right'],
        ['\u2191','up arrow'], ['\u2193','down arrow'],
        ['\u20D7','combining vector'], ['\u00B0','degree'],
        ['\u2297','cross product'], ['\u2299','circled dot']
    ],
    'Lambda': [
        ['\u03BB','lambda'], ['\u2192','arrow'], ['\u21A6','maps to'],
        ['\u2218','compose'], ['\u2261','definitional equal'],
        ['\u03B1','alpha (rename)'], ['\u03B2','beta (reduce)'],
        ['\u03B7','eta (expand)'],
        ['\u22A2','turnstile'], ['\u22A8','double turnstile'],
        ['\u2200','forall'], ['\u2203','exists'],
        ['\u27E8','left angle bracket'], ['\u27E9','right angle bracket'],
        ['\u2983','left brace bar'], ['\u2984','right brace bar'],
        ['\u22C6','star'], ['\u2022','bullet']
    ]
};

var symbolPickerCat = 'Greek';

var SYMBOL_DESCRIPTIONS = {
    '\u03B1': 'Used for angles, coefficients, and fine-structure constant',
    '\u03B2': 'Used for angles, velocity ratio v/c, and beta functions',
    '\u03B3': 'Euler-Mascheroni constant, Lorentz factor, gamma function',
    '\u03B4': 'Small change or variation, Dirac delta function',
    '\u03B5': 'Small positive quantity, permittivity',
    '\u03B6': 'Riemann zeta function argument',
    '\u03B7': 'Efficiency, viscosity, Dirichlet eta function',
    '\u03B8': 'Angle measure in trigonometry and polar coordinates',
    '\u03B9': 'Index variable, inclusion map',
    '\u03BA': 'Curvature, thermal conductivity',
    '\u03BB': 'Wavelength in physics, anonymous function in lambda calculus',
    '\u03BC': 'Micro prefix (10\u207B\u2076), mean in statistics, magnetic permeability',
    '\u03BD': 'Frequency, kinematic viscosity',
    '\u03BE': 'Random variable, damping ratio',
    '\u03C0': 'Ratio of circumference to diameter \u2248 3.14159',
    '\u03C1': 'Density, resistivity, correlation coefficient',
    '\u03C3': 'Standard deviation, surface charge density, Stefan-Boltzmann constant',
    '\u03C4': 'Torque, time constant, tau = 2\u03C0 \u2248 6.28318',
    '\u03C6': 'Golden ratio \u2248 1.61803, phase angle, Euler totient',
    '\u03C7': 'Chi-squared distribution, electric susceptibility',
    '\u03C8': 'Wave function in quantum mechanics, angle',
    '\u03C9': 'Angular velocity, angular frequency',
    '\u0393': 'Gamma function, circulation in fluid dynamics',
    '\u0394': 'Change or difference (\u0394x = x\u2082 - x\u2081)',
    '\u0398': 'Heaviside step function, big-O related notation',
    '\u039B': 'Cosmological constant, diagonal matrix of eigenvalues',
    '\u03A0': 'Product operator \u2014 multiply a sequence of terms',
    '\u03A3': 'Summation operator \u2014 add a sequence of terms',
    '\u03A6': 'Magnetic flux, cumulative distribution function',
    '\u03A8': 'Quantum state vector, wave function',
    '\u03A9': 'Ohm (unit of resistance), sample space in probability',

    '\u00B1': 'Plus or minus \u2014 indicates two possible values',
    '\u00D7': 'Multiplication (cross product in vectors)',
    '\u00F7': 'Division of two quantities',
    '\u2212': 'Subtraction or negative sign',
    '\u22C5': 'Scalar (dot) product of two vectors',
    '\u221A': 'Principal square root of a number',
    '\u221B': 'Cube root \u2014 the number whose cube equals the input',
    '\u221C': 'Fourth root of a number',
    '\u2070': 'Superscript 0 \u2014 any number to the power 0 equals 1',
    '\u00B9': 'Superscript 1 \u2014 identity exponent',
    '\u00B2': 'Squared \u2014 multiply a number by itself',
    '\u00B3': 'Cubed \u2014 multiply a number by itself three times',
    '\u2074': 'Raised to the fourth power',
    '\u2075': 'Raised to the fifth power',
    '\u2076': 'Raised to the sixth power',
    '\u2077': 'Raised to the seventh power',
    '\u2078': 'Raised to the eighth power',
    '\u2079': 'Raised to the ninth power',
    '\u207A': 'Positive exponent',
    '\u207B': 'Negative exponent (reciprocal)',
    '\u207F': 'Raised to the nth power',
    '\u2080': 'Subscript 0 \u2014 base or initial value',
    '\u2081': 'Subscript 1 \u2014 first element or index',
    '\u2082': 'Subscript 2 \u2014 second element or index',
    '\u2083': 'Subscript 3',
    '\u2084': 'Subscript 4',
    '\u2085': 'Subscript 5',
    '\u2086': 'Subscript 6',
    '\u2087': 'Subscript 7',
    '\u2088': 'Subscript 8',
    '\u2089': 'Subscript 9',
    '\u2260': 'Not equal to \u2014 two values are different',
    '\u2248': 'Approximately equal \u2014 close but not exact',
    '\u2261': 'Identically equal \u2014 true by definition',
    '\u2264': 'Less than or equal to',
    '\u2265': 'Greater than or equal to',
    '\u226A': 'Much less than \u2014 orders of magnitude smaller',
    '\u226B': 'Much greater than \u2014 orders of magnitude larger',
    '\u221E': 'Infinity \u2014 unbounded quantity, not a real number',
    '\u2030': 'Per mille \u2014 parts per thousand',

    '\u2205': 'The empty set \u2014 a set with no elements',
    '\u2208': 'Element of \u2014 x \u2208 S means x belongs to set S',
    '\u2209': 'Not an element of \u2014 x is not in the set',
    '\u220B': 'Contains \u2014 the set contains the element',
    '\u2282': 'Proper subset \u2014 all elements of A are in B, but A \u2260 B',
    '\u2283': 'Proper superset \u2014 B contains all elements of A',
    '\u2286': 'Subset or equal \u2014 A is contained in or equals B',
    '\u2287': 'Superset or equal \u2014 B contains or equals A',
    '\u222A': 'Union \u2014 all elements in A or B (or both)',
    '\u2229': 'Intersection \u2014 elements in both A and B',
    '\u2216': 'Set difference \u2014 elements in A but not in B',
    '\u2295': 'Direct sum or XOR \u2014 exclusive combination',
    '\u2297': 'Tensor product or cross product',
    '\u2115': 'Natural numbers: 0, 1, 2, 3, 4, \u2026',
    '\u2124': 'Integers: \u2026, -2, -1, 0, 1, 2, \u2026',
    '\u211A': 'Rational numbers \u2014 fractions p/q',
    '\u211D': 'Real numbers \u2014 all points on the number line',
    '\u2102': 'Complex numbers \u2014 a + bi where i\u00B2 = -1',
    '\u2200': 'For all \u2014 universal quantifier, every element',
    '\u2203': 'There exists \u2014 at least one element satisfies this',
    '\u2204': 'There does not exist \u2014 no element satisfies this',

    '\u00AC': 'Logical NOT \u2014 negation, flips true to false',
    '\u2227': 'Logical AND \u2014 true only when both sides are true',
    '\u2228': 'Logical OR \u2014 true when at least one side is true',
    '\u21D2': 'Implies \u2014 if A is true then B must be true',
    '\u21D4': 'If and only if \u2014 both sides are equivalent',
    '\u22A2': 'Proves (turnstile) \u2014 derivable from axioms',
    '\u22A8': 'Models \u2014 semantically entails, is satisfied by',
    '\u22A4': 'Top/True \u2014 always true, the unit type',
    '\u22A5': 'Bottom/False \u2014 always false, contradiction',
    '\u25A1': 'Necessity \u2014 must be true in all possible worlds',
    '\u25C7': 'Possibility \u2014 true in at least one possible world',
    '\u2234': 'Therefore \u2014 the conclusion follows',
    '\u2235': 'Because \u2014 the reason or premise',
    '\u22A3': 'Does not prove \u2014 not derivable',

    '\u2202': 'Partial derivative \u2014 rate of change in one variable',
    '\u222B': 'Integral \u2014 area under a curve, antiderivative',
    '\u222C': 'Double integral \u2014 over a 2D region',
    '\u222D': 'Triple integral \u2014 over a 3D volume',
    '\u222E': 'Contour integral \u2014 integral around a closed path',
    '\u2207': 'Nabla/del \u2014 gradient, divergence, or curl operator',
    '\u2206': 'Laplacian or finite difference operator',
    '\u2211': 'Summation \u2014 add up a sequence of terms',
    '\u220F': 'Product \u2014 multiply a sequence of terms',
    '\u2032': 'Prime \u2014 derivative f\u2032(x) or transformed variable',
    '\u2033': 'Double prime \u2014 second derivative f\u2033(x)',
    '\u221D': 'Proportional to \u2014 y \u221D x means y = kx for some k',
    '\u2243': 'Asymptotically equal \u2014 same behaviour for large values',

    '\u210F': 'Reduced Planck constant h/(2\u03C0) \u2248 1.055 \u00D7 10\u207B\u00B3\u2074 J\u00B7s',
    '\u212B': 'Angstrom \u2014 10\u207B\u00B9\u2070 metres, atomic scale length',
    '\u2126': 'Ohm \u2014 SI unit of electrical resistance',
    '\u00B5': 'Micro \u2014 prefix meaning 10\u207B\u2076',
    '\u2220': 'Angle \u2014 the figure formed by two rays from a point',
    '\u2225': 'Parallel \u2014 lines that never meet',
    '\u2190': 'Left arrow \u2014 direction, assignment, or mapping',
    '\u2192': 'Right arrow \u2014 function type, maps to, implies',
    '\u2194': 'Left-right arrow \u2014 bidirectional, if and only if',
    '\u2191': 'Up arrow \u2014 increasing, exponentiation (Knuth)',
    '\u2193': 'Down arrow \u2014 decreasing',
    '\u00B0': 'Degree \u2014 unit of angle (360\u00B0 in a circle) or temperature',
    '\u2299': 'Circled dot \u2014 direct product, solar symbol',

    '\u2218': 'Function composition \u2014 (f \u2218 g)(x) = f(g(x))',
    '\u21A6': 'Maps to \u2014 x \u21A6 f(x), element-level mapping',
    '\u27E8': 'Left angle bracket \u2014 inner product, bra in quantum mechanics',
    '\u27E9': 'Right angle bracket \u2014 inner product, ket in quantum mechanics',
    '\u22C6': 'Star operator \u2014 Kleene star, convolution',
    '\u2022': 'Bullet \u2014 list marker, binary operation',
};

var CONSTANT_VALUES = {
    '\u03C0': '\u2248 3.14159265',
    'e': '\u2248 2.71828183',
    '\u03C6': '\u2248 1.61803399',
    '\u221E': 'unbounded',
    'c': '299,792,458 m/s',
    'G': '6.674 \u00D7 10\u207B\u00B9\u00B9 N\u00B7m\u00B2/kg\u00B2',
    'g': '9.80665 m/s\u00B2',
    'h': '6.626 \u00D7 10\u207B\u00B3\u2074 J\u00B7s',
    '\u210F': '1.055 \u00D7 10\u207B\u00B3\u2074 J\u00B7s',
    'k\u0299': '1.381 \u00D7 10\u207B\u00B2\u00B3 J/K',
    'N\u2090': '6.022 \u00D7 10\u00B2\u00B3 mol\u207B\u00B9',
    'R': '8.314 J/(mol\u00B7K)',
    '\u03B5\u2080': '8.854 \u00D7 10\u207B\u00B9\u00B2 F/m',
    '\u03BC\u2080': '1.257 \u00D7 10\u207B\u2076 H/m',
    'e\u207B': '1.602 \u00D7 10\u207B\u00B9\u2079 C',
    'm\u2091': '9.109 \u00D7 10\u207B\u00B3\u00B9 kg',
    'm\u209A': '1.673 \u00D7 10\u207B\u00B2\u2077 kg',
    '\u03C3': '5.670 \u00D7 10\u207B\u2078 W/(m\u00B2\u00B7K\u2074)',
    'i': '\u221A(-1)',
    '\u03B3': '\u2248 0.57721566',
    '\u03B6': '\u2248 1.20206 (\u03B6(3))',
    '\u221A2': '\u2248 1.41421356',
    'ln2': '\u2248 0.69314718',
    'ln10': '\u2248 2.30258509',
};

function buildSymbolPicker() {
    var dd = document.getElementById('symbolPickerDropdown');
    if (!dd) return;

    var tooltip = document.getElementById('symbolTooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'symbolTooltip';
        tooltip.className = 'symbol-tooltip';
        document.body.appendChild(tooltip);
    }

    var catsHtml = '<div class="symbol-picker-cats">';
    for (var cat in MATH_SYMBOLS) {
        catsHtml += '<button class="symbol-cat-btn' + (cat === symbolPickerCat ? ' active' : '') + '" data-cat="' + cat + '">' + cat + '</button>';
    }
    catsHtml += '</div>';

    var gridHtml = '<div class="symbol-grid">';
    var syms = MATH_SYMBOLS[symbolPickerCat] || [];
    for (var i = 0; i < syms.length; i++) {
        gridHtml += '<button class="symbol-grid-btn" data-sym="' + syms[i][0] + '" data-name="' + syms[i][1].replace(/'/g, '&#39;') + '">' + syms[i][0] + '</button>';
    }
    gridHtml += '</div>';

    dd.innerHTML = catsHtml + gridHtml;

    dd.querySelectorAll('.symbol-cat-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            symbolPickerCat = btn.dataset.cat;
            buildSymbolPicker();
            dd.classList.add('open');
        });
    });

    dd.querySelectorAll('.symbol-grid-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            insertSymbol(btn.dataset.sym);
        });
        btn.addEventListener('mouseenter', function() {
            var sym = btn.dataset.sym;
            var name = btn.dataset.name;
            var desc = SYMBOL_DESCRIPTIONS[sym] || '';
            var val = CONSTANT_VALUES[sym] || '';
            var html = '<div class="symbol-tooltip-sym">' + sym + '</div>';
            html += '<div class="symbol-tooltip-name">' + name + '</div>';
            if (desc) html += '<div class="symbol-tooltip-desc">' + desc + '</div>';
            if (val) html += '<div class="symbol-tooltip-val">' + val + '</div>';
            tooltip.innerHTML = html;
            var rect = btn.getBoundingClientRect();
            var top = rect.top - tooltip.offsetHeight - 6;
            if (top < 4) top = rect.bottom + 6;
            var left = rect.left + rect.width / 2 - 60;
            if (left < 4) left = 4;
            if (left + 240 > window.innerWidth) left = window.innerWidth - 244;
            tooltip.style.top = top + 'px';
            tooltip.style.left = left + 'px';
            tooltip.classList.add('visible');
        });
        btn.addEventListener('mouseleave', function() {
            tooltip.classList.remove('visible');
        });
    });
}

function toggleSymbolPicker() {
    var dd = document.getElementById('symbolPickerDropdown');
    if (!dd) return;
    var tooltip = document.getElementById('symbolTooltip');
    if (dd.classList.contains('open')) {
        dd.classList.remove('open');
        if (tooltip) tooltip.classList.remove('visible');
    } else {
        buildSymbolPicker();
        dd.classList.add('open');
    }
}

function insertSymbol(sym) {
    var input = document.getElementById('replInput');
    if (!input) return;
    var start = input.selectionStart || 0;
    var end = input.selectionEnd || 0;
    var val = input.value;
    input.value = val.slice(0, start) + sym + val.slice(end);
    input.focus();
    var newPos = start + sym.length;
    input.setSelectionRange(newPos, newPos);
}

document.addEventListener('click', function(e) {
    var dd = document.getElementById('symbolPickerDropdown');
    if (dd && !e.target.closest('.symbol-picker-wrap')) {
        dd.classList.remove('open');
        var tooltip = document.getElementById('symbolTooltip');
        if (tooltip) tooltip.classList.remove('visible');
    }
});

function loadBernoulliInREPL() {
    const output = document.getElementById('replOutput');
    if (!output) return;

    repl._clear();
    output.innerHTML = '<div class="repl-info">Running Bernoulli program...</div>';

    const bernoulli = `let n = succ(3)
let two = succ(1)
let n_plus_1 = succ(n)
let two_n = two * n
let two_n_plus_1 = succ(two_n)
let prod1 = n * n_plus_1
let product = prod1 * two_n_plus_1
let six = two * 3
let sum_of_squares = product / six
let sq1 = 1 ^ two
let sq2 = two ^ two
let sq3 = 3 ^ two
let sq4 = n ^ two
let partial1 = sq1 + sq2
let partial2 = partial1 + sq3
let verify = partial2 + sq4
VARS`;

    const results = repl.runProgram(bernoulli);
    for (const r of results) {
        if (r.type === 'result') {
            output.innerHTML += `<div class="repl-result">${escapeHtml(r.text)}</div>`;
            if (r.churchSteps && r.churchSteps.length > 0) {
                let html = '<div class="repl-trace">';
                for (const s of r.churchSteps) {
                    html += `<div class="repl-trace-step">${escapeHtml(s)}</div>`;
                }
                html += '</div>';
                output.innerHTML += html;
            }
        } else if (r.type === 'info') {
            output.innerHTML += `<div class="repl-info">${escapeHtml(r.text)}</div>`;
        }
    }

    output.innerHTML += '<div class="repl-info">Bernoulli computation complete: sum_of_squares = verify = 30</div>';
    output.scrollTop = output.scrollHeight;
}

function replCompileSession() {
    const output = document.getElementById('replOutput');
    if (!output || !repl) return;

    const result = repl.compileSession();
    if (!result) return;

    if (result.type === 'info') {
        output.innerHTML += `<div class="repl-info">${escapeHtml(result.text)}</div>`;
    } else if (result.type === 'compile_errors') {
        const sourceLines = result.source.split('\n');
        output.innerHTML += `<div class="repl-error">Compile errors (${result.errors.length}):</div>`;
        for (const e of result.errors) {
            const lineIdx = (e.line || 1) - 1;
            const rawLine = sourceLines[lineIdx] || '';
            var lineHtml;
            if (e.colStart !== undefined && e.colEnd !== undefined && e.colEnd > e.colStart) {
                var before = escapeHtml(rawLine.substring(0, e.colStart));
                var mid    = escapeHtml(rawLine.substring(e.colStart, e.colEnd));
                var after  = escapeHtml(rawLine.substring(e.colEnd));
                lineHtml = before + '<span class="repl-error-underline">' + mid + '</span>' + after;
            } else {
                lineHtml = escapeHtml(rawLine);
            }
            output.innerHTML += `<div class="repl-input-echo" style="font-family:monospace;white-space:pre;">${lineHtml}</div>`;
            output.innerHTML += `<div class="repl-error" style="padding-left:1rem;">\u2514\u2500 ${escapeHtml(e.message)}</div>`;
        }
    } else if (result.type === 'result') {
        trackAction('repl', { name: 'Compile Session', lang: 'symbolic' });
        output.innerHTML += `<div class="repl-result" style="white-space:pre;font-family:monospace;">${escapeHtml(result.text)}</div>`;
    }
    output.scrollTop = output.scrollHeight;
}

function appendOutput(text, type) {
    const editorConsole = document.getElementById('editorConsole');
    if (editorConsole) {
        // Guard: if the console is showing rich cmp-html content (e.g. a CLOOMC++
        // compile listing with interactive buttons), textContent+= would destroy all
        // child elements. Skip the append so the HTML is never clobbered.
        if (editorConsole.classList.contains('cmp-html')) return;
        editorConsole.textContent += '\n' + text;
        editorConsole.scrollTop = editorConsole.scrollHeight;
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _updateEditorCodeName(name) {
    const el = document.getElementById('editorCodeName');
    if (el) el.textContent = name || '';
}

function saveEditorState() {
    const editor = document.getElementById('asmEditor');
    if (editor) {
        localStorage.setItem('church_editor_code', editor.value);
    }
    const sel = document.getElementById('langSelector');
    if (sel) {
        localStorage.setItem('church_editor_lang', sel.value);
    }
}

function loadEditorState() {
    const editor = document.getElementById('asmEditor');
    if (editor) {
        const saved = localStorage.getItem('church_editor_code');
        if (saved) {
            editor.value = saved;
        }
    }
    const sel = document.getElementById('langSelector');
    const savedLang = localStorage.getItem('church_editor_lang');
    if (sel && savedLang) {
        sel.value = savedLang;
        onLangChange(true);
    } else if (sel) {
        sel.value = 'cloomc';
        onLangChange(false);
    }
    if (typeof updateSavePseudoBtn === 'function') updateSavePseudoBtn();
    // Restore code name label from active user tab or active example tab
    if (typeof activeUserTabId !== 'undefined' && activeUserTabId) {
        const tab = (typeof userTabs !== 'undefined') && userTabs.find(t => t.id === activeUserTabId);
        if (tab) _updateEditorCodeName(tab.name);
    } else {
        const activeEx = document.querySelector('.example-tab.active');
        if (activeEx) _updateEditorCodeName(activeEx.textContent.trim());
    }
}

function showCreateNamespace() {
    if (!requirePermission('createNS', 'Create Namespace Entries')) return;
    if (!sim.bootComplete) {
        const con = document.getElementById('editorConsole');
        if (con) con.textContent = 'Boot not complete — run boot sequence first.';
        showNextSteps('error');
        return;
    }
    document.getElementById('createNSName').value = '';
    document.getElementById('createNSGTType').value = '1';
    document.getElementById('createNSAllocSize').value = '32';
    document.getElementById('createNSClistCount').value = '0';
    document.getElementById('createNSDialog').style.display = '';
    document.getElementById('createNSName').focus();
}

function confirmCreateNamespace() {
    const name = document.getElementById('createNSName').value.trim();
    if (!name) {
        alert('Please enter a name for the namespace entry.');
        return;
    }
    const gtType = parseInt(document.getElementById('createNSGTType').value) || 1;
    const allocSize = parseInt(document.getElementById('createNSAllocSize').value) || 32;
    const clistCount = Math.min(511, Math.max(0, parseInt(document.getElementById('createNSClistCount').value) || 0));

    if (clistCount >= allocSize) {
        alert(`C-List slots (${clistCount}) must be less than allocation size (${allocSize}).`);
        return;
    }

    const memResult = abstractionRegistry.dispatchMethod(7, 'Allocate', sim, { size: allocSize });
    if (!memResult || !memResult.ok) {
        const con = document.getElementById('editorConsole');
        if (con) con.textContent = `Create Namespace failed: Memory.Allocate error — ${memResult ? memResult.message : 'unknown'}`;
        showNextSteps('error');
        document.getElementById('createNSDialog').style.display = 'none';
        return;
    }

    const location = memResult.result.location;
    const limit = allocSize - 1;

    const addResult = abstractionRegistry.dispatchMethod(5, 'Add', sim, {
        location: location,
        limit: limit,
        clistCount: clistCount,
        gtType: gtType,
        label: name
    });

    document.getElementById('createNSDialog').style.display = 'none';

    if (!addResult || !addResult.ok) {
        const con = document.getElementById('editorConsole');
        if (con) con.textContent = `Create Namespace failed: Navana.Add error — ${addResult ? addResult.message : 'unknown'}`;
        showNextSteps('error');
        return;
    }

    const r = addResult.result;
    const typeNames = ['NULL','Inform','Outform','Abstract'];
    const clistStart = allocSize - clistCount;
    const freespace = allocSize - clistCount;

    let listing = `Namespace entry "${name}" created via Navana.Add:\n\n`;
    listing += `  NS Index:     ${r.nsIndex}\n`;
    listing += `  GT Seq:       ${r.version}\n`;
    listing += `  W1 Type:      ${typeNames[gtType] || 'Unknown'}\n`;
    listing += `  W0 Location:  0x${location.toString(16)}\n`;
    listing += `  W1 Limit:     ${limit}\n`;
    listing += `  Alloc Size:   ${allocSize} words\n`;
    listing += `  C-List Slots: ${clistCount}\n`;
    listing += `  Freespace:    ${freespace} words\n`;
    if (clistCount > 0) {
        listing += `\n  Lump Layout:\n`;
        listing += `    Code region:  0x${location.toString(16)} — offset 0 to ${clistStart - 1}\n`;
        listing += `    C-List:       offset ${clistStart} to ${allocSize - 1} (${clistCount} slots)\n`;
    }
    listing += `\nThis namespace entry is ready. Write your abstraction code,\nthen use "Create Abstraction" to populate NS[${r.nsIndex}].\n`;

    const con = document.getElementById('editorConsole');
    if (con) con.textContent = listing;
    showNextSteps('compiled');
    trackAction('namespace', { name: name, index: r.nsIndex });
    appendOutput(`Created NS[${r.nsIndex}] "${name}" — ${allocSize} words, ${clistCount} c-list slots`, 'info');
    updateDashboard();
}

function showSaveToNamespace() {
    if (!lastAssembledWords || lastAssembledWords.length === 0) {
        alert('Assemble code first before saving to namespace.');
        return;
    }
    const slotSel = document.getElementById('saveNSSlot');
    slotSel.innerHTML = '';
    const newOpt = document.createElement('option');
    newOpt.value = 'new';
    newOpt.textContent = '\u2014 New Entry \u2014';
    slotSel.appendChild(newOpt);
    for (let i = 0; i < sim.nsCount; i++) {
        const e = sim.readNSEntry(i);
        if (!e) continue;
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `[${i}] ${e.label}`;
        slotSel.appendChild(opt);
    }
    slotSel.value = 'new';
    document.getElementById('saveNSLabel').value = '';
    document.getElementById('saveNSLabel').disabled = false;
    document.getElementById('saveNSType').value = '0';
    document.getElementById('permR').checked = false;
    document.getElementById('permW').checked = false;
    document.getElementById('permX').checked = true;
    document.getElementById('permL').checked = false;
    document.getElementById('permS').checked = false;
    document.getElementById('permE').checked = false;
    const info = document.getElementById('saveNSInfo');
    info.textContent = `Code size: ${lastAssembledWords.length} words (${lastAssembledWords.length * 4} bytes)`;
    document.getElementById('saveNSDialog').style.display = '';
    document.getElementById('saveNSLabel').focus();
}

function onSlotChange() {
    const slotSel = document.getElementById('saveNSSlot');
    const labelInput = document.getElementById('saveNSLabel');
    if (slotSel.value === 'new') {
        labelInput.value = '';
        labelInput.disabled = false;
        document.getElementById('saveNSType').value = '0';
        document.getElementById('permR').checked = false;
        document.getElementById('permW').checked = false;
        document.getElementById('permX').checked = true;
        document.getElementById('permL').checked = false;
        document.getElementById('permS').checked = false;
        document.getElementById('permE').checked = false;
    } else {
        const idx = parseInt(slotSel.value);
        const entry = sim.readNSEntry(idx);
        if (entry) {
            labelInput.value = entry.label;
            labelInput.disabled = false;
            document.getElementById('saveNSType').value = String(entry.gtType || 0);
            const gt = sim.memory[entry.word0_location];
            const p = sim.parseGT(gt).permissions;
            document.getElementById('permR').checked = !!p.R;
            document.getElementById('permW').checked = !!p.W;
            document.getElementById('permX').checked = !!p.X;
            document.getElementById('permL').checked = !!p.L;
            document.getElementById('permS').checked = !!p.S;
            document.getElementById('permE').checked = !!p.E;
        }
    }
}

function closeSaveDialog() {
    document.getElementById('saveNSDialog').style.display = 'none';
}

function getNextStepTip(lang) {
    const progress = getStudentProgress();
    const c = progress.compilations || 0;
    const a = progress.abstractions || 0;
    const d = progress.drafts || 0;
    const langs = progress.langsUsed || [];

    if (c === 0) {
        if (lang === 'symbolic') return `<div class="intro-tip intro-next-step"><strong>Step 1:</strong> Click the gold <strong>Compile</strong> button below the abstraction creator. This translates Ada's math into machine code -- you will see every instruction with a comment explaining what it does.</div>`;
        if (lang === 'assembly') return `<div class="intro-tip intro-next-step"><strong>Step 1:</strong> Click the <strong>Self-Test</strong> example button, then click <strong>Compile</strong>. Watch each instruction appear with its hex encoding.</div>`;
        if (lang === 'javascript') return `<div class="intro-tip intro-next-step"><strong>Step 1:</strong> Click <strong>JS: Hello</strong> to load a simple program, then click <strong>Compile</strong> to see it translated into machine instructions.</div>`;
        if (lang === 'haskell') return `<div class="intro-tip intro-next-step"><strong>Step 1:</strong> Click <strong>HS: Math</strong> to load arithmetic functions, then click <strong>Compile</strong> to see how math becomes machine code.</div>`;
        if (lang === 'lambda') return `<div class="intro-tip intro-next-step"><strong>Step 1:</strong> Click <strong>LC: Church</strong> to load Church numerals, then click <strong>Compile</strong> to see how pure lambda calculus becomes machine code.</div>`;
        return `<div class="intro-tip intro-next-step"><strong>Step 1:</strong> Click the <strong>Compile</strong> button below the abstraction creator to translate the program into machine instructions.</div>`;
    }

    if (d === 0) {
        return `<div class="intro-tip intro-next-step"><strong>Next step:</strong> You have compiled code -- now click <strong>Draft</strong> to see how the program maps to memory. You will see the lump layout: code region, capability list, and free space.</div>`;
    }

    if (a === 0) {
        return `<div class="intro-tip intro-next-step"><strong>Next step:</strong> Click <strong>Boot</strong> in the top-left first (the machine needs to start), then click <strong>Create Abstraction</strong> to load your program into the Church Machine's namespace as a real abstraction with its own security entry.</div>`;
    }

    if (langs.length <= 1) {
        const suggest = lang === 'symbolic' ? 'JavaScript' : (lang === 'javascript' ? 'Haskell' : (lang === 'haskell' ? 'Lambda Calculus' : (lang === 'lambda' ? 'Symbolic Math (Ada)' : 'JavaScript')));
        return `<div class="intro-tip intro-next-step"><strong>Challenge:</strong> You have compiled, drafted, and created an abstraction! Try switching to <strong>${suggest}</strong> in the language dropdown -- the same 20 machine instructions work for every language.</div>`;
    }

    if (c < 5) {
        return `<div class="intro-tip intro-next-step"><strong>Keep going:</strong> You have used ${langs.length} languages so far. Try editing the code -- change a variable or add a new operation, then <strong>Compile</strong> again to see how the machine code changes.</div>`;
    }

    if (lang === 'symbolic') {
        return `<div class="intro-tip intro-next-step"><strong>Explore:</strong> Try the <strong>Pure Math</strong> tab to experiment with expressions interactively, then click <strong>Compile Session</strong> to turn your experiments into a program. Or visit the <strong>Tutorial</strong> tab for a guided walkthrough.</div>`;
    }

    return `<div class="intro-tip intro-next-step"><strong>Explore:</strong> Open the <strong>Tutorial</strong> tab for a guided discovery path, try the <strong>Pure Math</strong> for interactive experiments, or view your progress in the <strong>Settings</strong> (gear icon below).</div>`;
}

const langIntros = {
    english: {
        title: "English -- Programming in Your Own Words",
        body: `
            <p>What if you could <span class="intro-highlight">tell a computer what to do in plain English?</span></p>
            <p>The Church Machine's English front-end makes this real. You write sentences,
            and the compiler translates them into the same 32-bit machine instructions
            as JavaScript, Haskell, or Ada's notation.</p>
            <div class="intro-example">Create an abstraction called Hello

Add a method called Greet that takes who
Set result to who plus 1
Return the result</div>
            <p>The compiler understands verbs like <span class="intro-highlight">create</span>,
            <span class="intro-highlight">set</span>, <span class="intro-highlight">return</span>,
            <span class="intro-highlight">call</span>, and <span class="intro-highlight">if/when</span>.
            Arithmetic uses words: <em>plus</em>, <em>minus</em>, <em>times</em>, <em>divided by</em>.</p>
            <p>In 1952, <span class="intro-highlight">Grace Hopper</span> was told computers could only
            understand numbers. She invented the compiler to prove them wrong.
            This English front-end carries her dream to its conclusion.</p>
        `
    },
    symbolic: {
        title: "Symbolic Math -- Ada Lovelace's Notation (1843)",
        body: `
            <p>You are looking at <span class="intro-highlight">the first computer program ever written.</span></p>
            <p>In 1843, a mathematician named <span class="intro-highlight">Ada Lovelace</span> wrote a program
            for Charles Babbage's Analytical Engine -- a mechanical computer that was never built.
            Her program computed a special number called B7, the seventh Bernoulli number.</p>
            <p>Ada used a simple notation: named variables (like store columns on the Engine)
            and one operation per line. Here is what it looks like:</p>
            <div class="intro-example">let V1 = 1
let V2 = 2
let V4 = V2 * V3    -- multiply V2 by V3
let V11 = V4 / V5   -- divide V4 by V5</div>
            <p>Each <span class="intro-highlight">V-variable</span> is a storage column --
            V1 is the first column, V2 is the second, and so on.
            You write one operation per line, just like Ada did on paper.</p>
            <p>The Church Machine can now run Ada's program -- 183 years after she wrote it.
            Her notation is a real programming language here.</p>
        `
    },
    assembly: {
        title: "Assembly -- Church Machine Instructions",
        body: `
            <p>This is <span class="intro-highlight">assembly language</span> --
            the lowest level you can program the Church Machine.</p>
            <p>Every line is one instruction that the processor executes directly.
            The Church Machine has <span class="intro-highlight">20 instructions</span> split into two worlds:</p>
            <p><span class="intro-highlight">Church domain</span> (10 instructions) --
            for security and capabilities: LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, XLOADLAMBDA</p>
            <p><span class="intro-highlight">Turing domain</span> (10 instructions) --
            for computation and data: DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR</p>
            <div class="intro-example">LOAD CR0, CR6, 4    ; Load from capability list
TPERM CR0, XL       ; Check permissions
LAMBDA CR0          ; Execute
RETURN                ; Return result</div>
            <p>Assembly gives you direct control over registers, memory, and Golden Token permissions.
            Every instruction can have a <span class="intro-highlight">condition code</span> (like EQ, NE, GT)
            so it only runs when the condition is true.</p>
        `
    },
    cloomc: {
        title: "CLOOMC++ -- Abstraction Language",
        body: `
            <p><span class="intro-highlight">CLOOMC++</span> is the Church Machine's
            high-level abstraction language. Write programs with
            <em>abstraction</em> blocks, <em>capabilities</em> lists, and <em>method</em>
            bodies -- the compiler turns them into Church Machine instructions.</p>
            <div class="intro-example">abstraction Hello {
    capabilities { }

    method Greet(who) {
        result = who + 1
        return(result)
    }
}</div>
            <p>Every program is an <span class="intro-highlight">abstraction</span> --
            a secure block of code with its own capabilities list.
            Methods inside the abstraction are the functions you can call.</p>
            <p>The compiler translates your code into the same 20 instructions
            that assembly uses. Variables become data registers (DR0-DR15),
            and multiply/divide become loops of addition and subtraction.</p>
        `
    },
    haskell: {
        title: "Haskell -- Functional Programming on Hardware",
        body: `
            <p>The <span class="intro-highlight">Haskell front-end</span> proves that
            the Church Machine is a true universal target -- functional programming
            compiles to the same 20 instructions as JavaScript and assembly.</p>
            <div class="intro-example">abstraction ChurchMath {
    capabilities { }

    method successor(n) = n + 1
    method add(a, b) = a + b
    method isZero(n) = if n == 0 then 1 else 0
}</div>
            <p>You get <span class="intro-highlight">pattern matching</span> (case expressions),
            <span class="intro-highlight">pairs</span> (fst/snd),
            <span class="intro-highlight">let bindings</span>,
            and <span class="intro-highlight">Church numerals</span> -- the building blocks of lambda calculus,
            running on real hardware.</p>
            <p>The name "Church Machine" comes from Alonzo Church, who invented lambda calculus.
            This front-end connects his mathematics to actual silicon.</p>
        `
    },
    lambda: {
        title: "Lambda Calculus -- The Foundation of Computing (1936)",
        body: `
            <p>In 1936, mathematician <span class="intro-highlight">Alonzo Church</span> invented
            <span class="intro-highlight">lambda calculus</span> -- a tiny formal system that turned out
            to be the mathematical foundation of all computing.</p>
            <p>Lambda calculus has only three things: variables, abstraction (\u03BBx.body),
            and application (f x). From these three primitives, you can build
            <em>everything</em> -- numbers, booleans, pairs, loops, even entire operating systems.</p>
            <div class="intro-example">abstraction ChurchNumerals {
    capabilities { }

    method two() = \u03BBf.\u03BBx.(f (f x))
    method add(m, n) = \u03BBf.\u03BBx.((m f) ((n f) x))
    method succ(n) = \u03BBf.\u03BBx.(f ((n f) x))
}</div>
            <p><span class="intro-highlight">Church numerals</span> encode numbers as functions:
            zero applies f zero times, one applies f once, two applies f twice.
            Addition is function composition. Multiplication is iterated addition.</p>
            <p>Church proved that lambda calculus is equivalent to Turing machines --
            anything one can compute, the other can too. The Church Machine is named
            after him because it unifies both models in hardware: Turing's data processing
            <em>and</em> Church's function abstraction, on the same chip.</p>
        `
    }
};

function showIntro(lang) {
    if (isWelcomeNeeded()) return;
    const dismissed = localStorage.getItem('church_intro_dismissed_' + lang);
    if (dismissed === 'true') return;

    const intro = langIntros[lang];
    if (!intro) return;

    const adapted = getGradeAdaptedIntro(lang) || intro;
    const nextStep = getNextStepTip(lang);
    document.getElementById('introTitle').innerHTML = adapted.title;
    document.getElementById('introBody').innerHTML = adapted.body + nextStep;
    document.getElementById('introDismiss').checked = false;
    document.getElementById('introModal').style.display = 'flex';
    document.getElementById('introModal').setAttribute('data-lang', lang);
    const goBtn = document.getElementById('introGoBtn');
    if (goBtn) {
        const progress = getStudentProgress();
        const c = progress.compilations || 0;
        const d = progress.drafts || 0;
        const a = progress.abstractions || 0;
        if (c === 0) goBtn.textContent = "Let's Try It!";
        else if (d === 0) goBtn.textContent = 'See the Draft!';
        else if (a === 0) goBtn.textContent = 'Create It!';
        else goBtn.textContent = "Let's Go!";
    }

    const body = document.getElementById('introBody');
    const arrow = document.getElementById('introScrollArrow');
    if (body && arrow) {
        const updateArrow = () => {
            const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 8;
            arrow.classList.toggle('hidden', atBottom || body.scrollHeight <= body.clientHeight);
        };
        body.removeEventListener('scroll', body._introScrollHandler);
        body._introScrollHandler = updateArrow;
        body.addEventListener('scroll', updateArrow);
        requestAnimationFrame(updateArrow);
    }
}

function closeIntro() {
    const modal = document.getElementById('introModal');
    const lang = modal.getAttribute('data-lang');
    const dismiss = document.getElementById('introDismiss').checked;
    if (dismiss && lang) {
        localStorage.setItem('church_intro_dismissed_' + lang, 'true');
    }
    modal.style.display = 'none';
    const body = document.getElementById('introBody');
    if (body && body._introScrollHandler) {
        body.removeEventListener('scroll', body._introScrollHandler);
        body._introScrollHandler = null;
    }
    const arrow = document.getElementById('introScrollArrow');
    if (arrow) arrow.classList.add('hidden');
}

const FAMILY_PERMISSIONS = [
    { key: 'compile',       label: 'Compile Programs',        desc: 'Use the CLOOMC++ compiler' },
    { key: 'browseLibrary', label: 'Browse Library',           desc: 'Access Mum Tunnel shared abstractions' },
    { key: 'publish',       label: 'Publish to Library',       desc: 'Share abstractions publicly' },
    { key: 'createNS',      label: 'Create Namespace Entries', desc: 'Reserve namespace slots' },
    { key: 'deploy',        label: 'Deploy to Tang',           desc: 'Upload to FPGA hardware' },
    { key: 'editCode',      label: 'Edit Code',                desc: 'Write and modify source code' },
    { key: 'viewPipeline',  label: 'View Pipeline',            desc: 'See the mLoad pipeline' },
    { key: 'mathTools',     label: 'Use Math Tools',           desc: 'HP-35, Abacus, Slide Rule' },
    { key: 'settings',      label: 'Change Settings',          desc: 'Modify family settings' }
];

function mintGoldenToken() {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return '0x' + arr[0].toString(16).toUpperCase().padStart(8, '0');
}

function getFamilyAbstraction() {
    try {
        const raw = localStorage.getItem('church_family_abstraction');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
}

function saveFamilyAbstraction(fa) {
    localStorage.setItem('church_family_abstraction', JSON.stringify(fa));
}

function initFamilyAbstraction(parentName) {
    const parentGT = mintGoldenToken();
    const allPerms = {};
    FAMILY_PERMISSIONS.forEach(p => { allPerms[p.key] = true; });
    const fa = {
        nsSlot: 42,
        name: 'Family',
        owner: parentGT,
        clist: [
            { gtId: parentGT, role: 'Parent', name: parentName, permissions: allPerms, immutable: true, mintedAt: Date.now() }
        ]
    };
    saveFamilyAbstraction(fa);
    return fa;
}

function mintChildGT(fa, childName, role) {
    const childGT = mintGoldenToken();
    const childPerms = {};
    FAMILY_PERMISSIONS.forEach(p => {
        childPerms[p.key] = (p.key !== 'settings' && p.key !== 'deploy' && p.key !== 'publish');
    });
    fa.clist.push({
        gtId: childGT,
        role: role || 'Child',
        name: childName,
        permissions: childPerms,
        immutable: true,
        mintedAt: Date.now()
    });
    saveFamilyAbstraction(fa);
    return childGT;
}

function familyAllow(fa, gtId, permKey) {
    const entry = fa.clist.find(e => e.gtId === gtId);
    if (!entry) return false;
    if (entry.gtId === fa.owner) return false;
    entry.permissions[permKey] = true;
    saveFamilyAbstraction(fa);
    return true;
}

function familyDeny(fa, gtId, permKey) {
    const entry = fa.clist.find(e => e.gtId === gtId);
    if (!entry) return false;
    if (entry.gtId === fa.owner) return false;
    entry.permissions[permKey] = false;
    saveFamilyAbstraction(fa);
    return true;
}

function getActiveGT() {
    return localStorage.getItem('church_active_gt') || null;
}

function setActiveGT(gtId) {
    localStorage.setItem('church_active_gt', gtId);
}

function checkPermission(permKey) {
    const fa = getFamilyAbstraction();
    if (!fa) return true;
    const activeGT = getActiveGT();
    if (!activeGT) return true;
    const entry = fa.clist.find(e => e.gtId === activeGT);
    if (!entry) return true;
    return entry.permissions[permKey] !== false;
}

function getStudentSettings() {
    try {
        const raw = localStorage.getItem('church_student_settings');
        if (raw) {
            const s = JSON.parse(raw);
            if (!s.familyMembers) s.familyMembers = [];
            return s;
        }
    } catch (e) {}
    return {
        name: '',
        familyMembers: [],
        profession: 'student',
        language: 'english',
        nationality: 'us',
        ageTier: '13-17',
        fpgaBoard: 'wukong-xc7a100t',
        selectedSubjects: []
    };
}

function getStudentProgress() {
    try {
        const raw = localStorage.getItem('church_student_progress');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { compilations: 0, abstractions: 0, drafts: 0, replSessions: 0, langsUsed: [], history: [] };
}

function saveStudentProgress(progress) {
    localStorage.setItem('church_student_progress', JSON.stringify(progress));
}

function trackAction(action, detail) {
    const progress = getStudentProgress();
    if (action === 'compile') progress.compilations++;
    if (action === 'abstract') progress.abstractions++;
    if (action === 'draft') progress.drafts++;
    if (action === 'repl') progress.replSessions++;
    if (detail && detail.lang && !progress.langsUsed.includes(detail.lang)) {
        progress.langsUsed.push(detail.lang);
    }
    const ts = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const entry = `${ts} ${action}${detail && detail.name ? ': ' + detail.name : ''}`;
    progress.history.unshift(entry);
    if (progress.history.length > 50) progress.history.length = 50;
    saveStudentProgress(progress);
}

function renderFamilyIntroQR() {
    const el = document.getElementById('familyIntroQR');
    if (!el) return;
    const fa = getFamilyAbstraction();
    const seed = fa ? parseInt(fa.owner.replace('0x',''), 16) : 0xDEADBEEF;
    const size = 9;
    const cells = [];
    let s = seed;
    for (let y = 0; y < size; y++) {
        cells[y] = [];
        for (let x = 0; x < size; x++) {
            if ((x < 3 && y < 3) || (x >= size - 3 && y < 3) || (x < 3 && y >= size - 3)) {
                const ox = x < 3 ? x : (x >= size - 3 ? x - (size - 3) : x);
                const oy = y < 3 ? y : (y >= size - 3 ? y - (size - 3) : y);
                cells[y][x] = (ox === 0 || ox === 2 || oy === 0 || oy === 2 || (ox === 1 && oy === 1)) ? 1 : 0;
            } else {
                s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
                cells[y][x] = (s >> 16) & 1;
            }
        }
    }
    const cellSize = 6;
    const svgSize = size * cellSize;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}" width="${svgSize}" height="${svgSize}">`;
    svg += `<rect width="${svgSize}" height="${svgSize}" fill="rgba(200,155,60,0.08)" rx="2"/>`;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (cells[y][x]) {
                svg += `<rect x="${x*cellSize}" y="${y*cellSize}" width="${cellSize}" height="${cellSize}" fill="rgba(200,155,60,0.6)" rx="0.5"/>`;
            }
        }
    }
    svg += '</svg>';
    el.innerHTML = svg;
}

function openShareLink() {
    const url = window.location.href.split('#')[0];
    const input = document.getElementById('shareLinkURL');
    if (input) input.value = url;
    const status = document.getElementById('shareLinkStatus');
    if (status) status.textContent = '';
    document.getElementById('shareLinkModal').style.display = 'flex';
    setTimeout(() => { if (input) { input.focus(); input.select(); } }, 100);
}

function copyShareLink() {
    const input = document.getElementById('shareLinkURL');
    const status = document.getElementById('shareLinkStatus');
    if (!input) return;
    const url = input.value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            if (status) { status.textContent = 'Copied to clipboard'; status.className = 'share-link-status success'; }
        }).catch(() => {
            input.select();
            document.execCommand('copy');
            if (status) { status.textContent = 'Copied to clipboard'; status.className = 'share-link-status success'; }
        });
    } else {
        input.select();
        document.execCommand('copy');
        if (status) { status.textContent = 'Copied to clipboard'; status.className = 'share-link-status success'; }
    }
}

function nativeShare() {
    const url = document.getElementById('shareLinkURL')?.value || window.location.href;
    if (navigator.share) {
        navigator.share({ title: 'Church Machine', url: url }).catch(() => { copyShareLink(); });
    } else {
        copyShareLink();
    }
}

function getSelectedBoard() {
    return localStorage.getItem('fpga_board_target') || 'wukong-xc7a100t';
}

function getBoardShortLabel(board) {
    if (board === 'ti60-f225') return 'Ti60 F225';
    if (board === 'tang-nano-20k-iot') return 'Tang Nano 20K';
    if (board === 'wukong-xc7a100t') return 'Wukong XC7A100T';
    return 'Tang Nano 20K';
}

function setSelectedBoard(board) {
    localStorage.setItem('fpga_board_target', board);
    const sel = document.getElementById('hardwareBoardSel');
    if (sel) sel.value = board;
    const settingSel = document.getElementById('settingFPGABoard');
    if (settingSel) settingSel.value = board;
    const lbl = document.getElementById('hwLedBoardLabel');
    if (lbl) lbl.textContent = getBoardShortLabel(board);
    const ti60Btn = document.getElementById('toolbarTi60ConnectBtn');
    if (ti60Btn) {
        const _boardShort = {'ti60-f225': 'Ti60', 'tang-nano-20k-iot': 'Tang 20K', 'wukong-xc7a100t': 'Wukong'};
        ti60Btn.innerHTML = '&#x1F50C; ' + (_boardShort[board] || 'Board');
        ti60Btn.classList.add('ti60-connect-active');
    }
    if (typeof window.lumpEditorRender === 'function') window.lumpEditorRender();
    if (typeof window.lumpEditorRenderResidentPanel === 'function') window.lumpEditorRenderResidentPanel();
}

function getBoardLabel(board) {
    if (board === 'ti60-f225') return 'Efinix Ti60 F225';
    if (board === 'tang-nano-20k-iot') return 'Sipeed Tang Nano 20K';
    if (board === 'wukong-xc7a100t') return 'QMTECH Wukong Artix-7 XC7A100T';
    return 'Sipeed Tang Nano 20K';
}

function switchBuilderViewTab(tab) {
    try { localStorage.setItem('church_builderTab', tab); } catch(e) {}
    document.querySelectorAll('.builder-view-tab').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('builderViewTab-' + tab);
    if (btn) btn.classList.add('active');
    const cyberspace  = document.getElementById('builderView');
    const details     = document.getElementById('buildDetailsPanel');
    const lumpThread  = document.getElementById('lumpThreadPanel');
    const lumpNS      = document.getElementById('lumpNSPanel');
    const lumpResident  = document.getElementById('lumpResidentPanel');
    const ti60Connect   = document.getElementById('ti60ConnectPanel');
    if (cyberspace)   cyberspace.style.display   = (tab === 'cyberspace')     ? '' : 'none';
    if (details)      details.style.display      = (tab === 'buildlog')       ? '' : 'none';
    if (lumpThread)   lumpThread.style.display   = (tab === 'lump-thread')    ? '' : 'none';
    if (lumpNS)       lumpNS.style.display       = (tab === 'lump-ns')        ? '' : 'none';
    if (lumpResident) lumpResident.style.display = (tab === 'lump-resident')  ? '' : 'none';
    if (ti60Connect)  ti60Connect.style.display  = (tab === 'ti60-connect')   ? '' : 'none';
    if ((tab === 'lump-thread' || tab === 'lump-ns') && typeof initLumpEditor === 'function') initLumpEditor();
    if (tab === 'lump-resident' && typeof initResidentPanel === 'function') initResidentPanel();
    if (tab === 'ti60-connect' && typeof Ti60Connect !== 'undefined') Ti60Connect.onTabOpen();
}

function _setBuildStatus(state, label, board) {
    const dot = document.getElementById('buildStatusDot');
    const lbl = document.getElementById('buildStatusLabel');
    const brd = document.getElementById('buildStatusBoard');
    if (dot) { dot.className = 'build-status-dot ' + state; }
    if (lbl) lbl.textContent = label;
    if (brd && board) brd.textContent = board;
}

function _buildLogScroll() {
    const area = document.getElementById('buildLogArea');
    if (!area) return;
    setTimeout(() => { area.scrollTop = area.scrollHeight; }, 50);
}

function _buildLogAppend(text) {
    const area = document.getElementById('buildLogArea');
    if (!area) return;
    area.textContent += text;
    _buildLogScroll();
}

function _buildLogSet(text) {
    const area = document.getElementById('buildLogArea');
    if (!area) return;
    area.textContent = text;
    _buildLogScroll();
}

function _renderBuildFiles(files, isTi60, board) {
    const list = document.getElementById('buildFileList');
    if (!list) return;
    if (!files || !files.length) {
        list.innerHTML = '<div class="build-file-empty">No files reported.</div>';
        return;
    }
    const iconMap = { v: '📄', edif: '🔌', il: '⚙️', json: '📋', cst: '📍', makefile: '🛠️', md: '📖', isf: '📌', xdc: '📌', tcl: '📜', xml: '🗂️', sh: '🖥️', py: '🐍', c: '🔧', s: '⚙️', h: '📋', ld: '📍' };

    const optionalByBoard = {
        'tang-nano-20k-iot': [
            { name: 'church_tang_nano_20k.v',    reason: 'Yosys synthesis' },
            { name: 'church_tang_nano_20k.json',  reason: 'Yosys synthesis' },
        ],
        'wukong-xc7a100t': [
            { name: 'church_wukong_xc7a100t.v',  reason: 'Yosys synthesis' },
        ],
    };
    const boardKey = board || (isTi60 ? 'ti60-f225' : 'tang-nano-20k-iot');
    const optionalDefs = optionalByBoard[boardKey] || [];

    const presentSet = new Set(files);
    const absentOptional = optionalDefs.filter(o => !presentSet.has(o.name));

    const presentRows = files.map(f => {
        const ext = f.split('.').pop().toLowerCase();
        const icon = iconMap[ext] || '📄';
        return `<div class="build-file-row"><span class="build-file-icon">${icon}</span><span>${f}</span></div>`;
    });

    const absentRows = absentOptional.map(o => {
        const ext = o.name.split('.').pop().toLowerCase();
        const icon = iconMap[ext] || '📄';
        return `<div class="build-file-row build-file-absent" title="Not in this ZIP — generated locally if ${o.reason} succeeds"><span class="build-file-icon">${icon}</span><span>${o.name}</span><span class="build-file-optional-badge">optional</span></div>`;
    });

    list.innerHTML = [...presentRows, ...absentRows].join('');
}

function _renderBuildNextSteps(isTi60, board) {
    const el = document.getElementById('buildNextSteps');
    if (!el) return;
    var steps;
    if (isTi60) {
        steps = [
            'Extract the zip — all files land in one folder',
            'Run setup_ti60_peri.py with Efinity\'s Python to add the PLL (see BUILD.md)',
            'In the SDC file: switch from Phase A (25 MHz) to Phase B (50 MHz) per the comments',
            'File → Open Project → church_ti60_f225.xml',
            'Run Synthesis → P&R → Generate Bitstream',
            'Tool → Programmer → Program (JTAG / USB)',
        ];
    } else if (board === 'wukong-xc7a100t') {
        steps = [
            'Install Vivado 2020.x or later (Xilinx / AMD)',
            'Extract church-wukong-package.zip to any folder',
            'In the Vivado Tcl Console: cd /path/to/extracted && source wukong_xc7a100t.tcl',
            'The script creates the project, runs synthesis + implementation, writes the bitstream',
            'Tools \u2192 Hardware Manager \u2192 Open Target \u2192 Program Device \u2192 select church_wukong_xc7a100t.bit',
        ];
    } else {
        steps = [
            'Install OSS CAD Suite (oss-cad-suite-build on GitHub)',
            'Unzip the package, then run: make pnr pack',
            'Connect Tang Nano 20K via USB',
            'Run: make prog  — or use the Deploy to FPGA button',
        ];
    }
    el.innerHTML = steps.map((s, i) =>
        `<div class="build-step-row"><span class="build-step-num">${i + 1}</span><span>${s}</span></div>`
    ).join('');
}

function toggleBuildNextSteps() {
    var el = document.getElementById('buildNextSteps');
    var ch = document.getElementById('buildNextStepsChevron');
    if (!el) return;
    var collapsed = el.classList.toggle('collapsed');
    if (ch) ch.textContent = collapsed ? '\u25BA' : '\u25BC';
}

function initHardwareBuildPanel() {
    const sel = document.getElementById('hardwareBoardSel');
    if (sel) sel.value = getSelectedBoard();
    const lbl = document.getElementById('hwLedBoardLabel');
    if (lbl) lbl.textContent = getBoardShortLabel(getSelectedBoard());
    const ti60Btn = document.getElementById('toolbarTi60ConnectBtn');
    if (ti60Btn) {
        const _board = getSelectedBoard();
        const _boardShort = {'ti60-f225': 'Ti60', 'tang-nano-20k-iot': 'Tang 20K', 'wukong-xc7a100t': 'Wukong'};
        ti60Btn.innerHTML = '&#x1F50C; ' + (_boardShort[_board] || 'Board');
        ti60Btn.classList.add('ti60-connect-active');
    }
    updateHardwarePanelLabel();
}

function updateHardwarePanelLabel() {
    const board = getSelectedBoard();
    const info = document.getElementById('hwBuildInfoText');
    const buildBtn = document.getElementById('btnHWBuild');
    const BASE_BUILD_TIP = 'Build \u2014 Run Amaranth elaboration + Yosys synthesis and save RTL artifacts to server';
    if (!info) return;
    if (board === 'ti60-f225') {
        info.textContent = 'Output: church_ti60_f225.v + church_ti60_f225.edif + ti60_f225.isf  \u2014  open in Efinity IDE (Titanium project)';
        if (buildBtn) buildBtn.dataset.tooltip = BASE_BUILD_TIP;
    } else if (board === 'wukong-xc7a100t') {
        info.textContent = '';
        if (buildBtn) buildBtn.dataset.tooltip = BASE_BUILD_TIP + '  |  Output: church_wukong_xc7a100t.v + wukong_xc7a100t.xdc + wukong_xc7a100t.tcl \u2014 source tcl in Vivado to build + program';
    } else {
        info.textContent = '';
        if (buildBtn) buildBtn.dataset.tooltip = BASE_BUILD_TIP;
    }
}

function openSettings() {
    if (!requirePermission('settings', 'Change Settings')) return;
    const settings = getStudentSettings();
    document.getElementById('settingName').value = settings.name || '';
    const profSel = document.getElementById('settingProfession');
    if (profSel) profSel.value = settings.profession || 'student';
    const langSel = document.getElementById('settingLanguage');
    if (langSel) langSel.value = settings.language || 'english';
    const natSel = document.getElementById('settingNationality');
    if (natSel) natSel.value = settings.nationality || 'us';
    const ageSel = document.getElementById('settingAgeTier');
    if (ageSel) ageSel.value = settings.ageTier || '13-17';
    renderFamilyMembers(settings.familyMembers || []);
    renderProgressReport();
    renderFamilyIntroQR();
    const releaseEl = document.getElementById('settingsReleasePublishedAt');
    if (releaseEl) releaseEl.textContent = '2026-05-15 UTC';
    const anyPerm = hasAnyPopupDismissedPerm();
    const showAllCheck = document.getElementById('showAllPopupsCheck');
    if (showAllCheck) showAllCheck.checked = !anyPerm;
    const osCb = document.getElementById('settingOpenSource');
    if (osCb) osCb.checked = !!settings.openSource;
    const boardSel = document.getElementById('settingFPGABoard');
    if (boardSel) boardSel.value = getSelectedBoard();
    const notifPrefs = getNotifPrefs();
    const nb = document.getElementById('notifBoardNew');       if (nb) nb.checked = notifPrefs.boardNew;
    const nr = document.getElementById('notifBoardReconnect'); if (nr) nr.checked = notifPrefs.boardReconnect;
    const nf = document.getElementById('notifFault');          if (nf) nf.checked = notifPrefs.fault;
    const nc = document.getElementById('notifCompile');        if (nc) nc.checked = notifPrefs.compile;
    document.getElementById('settingsModal').style.display = 'flex';
}

function hasAnyPopupDismissedPerm() {
    const keys = [
        'church_welcome_dismissed_perm',
        'churchMachine_mathGuideDismissed_perm',
        'churchMachine_toolGuide_interactive_perm',
        'churchMachine_toolGuide_hp35_perm',
        'churchMachine_toolGuide_abacus_perm',
        'churchMachine_toolGuide_sliderule_perm'
    ];
    return keys.some(k => localStorage.getItem(k));
}

function toggleShowAllPopups(checked) {
    if (checked) {
        resetAllPopupsFlags();
    } else {
        dismissAllPopupsPerm();
    }
}

function resetAllPopupsFlags() {
    localStorage.removeItem('church_welcome_dismissed');
    localStorage.removeItem('church_welcome_dismissed_perm');
    localStorage.removeItem('churchMachine_mathGuideDismissed');
    localStorage.removeItem('churchMachine_mathGuideDismissed_perm');
    localStorage.removeItem('churchMachine_toolGuide_interactive');
    localStorage.removeItem('churchMachine_toolGuide_interactive_perm');
    localStorage.removeItem('churchMachine_toolGuide_hp35');
    localStorage.removeItem('churchMachine_toolGuide_hp35_perm');
    localStorage.removeItem('churchMachine_toolGuide_abacus');
    localStorage.removeItem('churchMachine_toolGuide_abacus_perm');
    localStorage.removeItem('churchMachine_toolGuide_sliderule');
    localStorage.removeItem('churchMachine_toolGuide_sliderule_perm');
}

function dismissAllPopupsPerm() {
    localStorage.setItem('church_welcome_dismissed', '1');
    localStorage.setItem('church_welcome_dismissed_perm', '1');
    localStorage.setItem('churchMachine_mathGuideDismissed', '1');
    localStorage.setItem('churchMachine_mathGuideDismissed_perm', '1');
    localStorage.setItem('churchMachine_toolGuide_interactive', '1');
    localStorage.setItem('churchMachine_toolGuide_interactive_perm', '1');
    localStorage.setItem('churchMachine_toolGuide_hp35', '1');
    localStorage.setItem('churchMachine_toolGuide_hp35_perm', '1');
    localStorage.setItem('churchMachine_toolGuide_abacus', '1');
    localStorage.setItem('churchMachine_toolGuide_abacus_perm', '1');
    localStorage.setItem('churchMachine_toolGuide_sliderule', '1');
    localStorage.setItem('churchMachine_toolGuide_sliderule_perm', '1');
}

function closeSettings() {
    document.getElementById('settingsModal').style.display = 'none';
}

function showReleaseHistory() {
    const history = [
        { date: '2026-05-15 UTC', title: 'Builder: 3-Board ZIP Downloads — Release 1.2', changes: [
            'Builder "Download FPGA Package" supports the ZIP for all three boards',
            'New <code>test_zip_contents.py</code> suite enforces the contract',
            'Release 1 document set (14 PDFs) remains the definitive hardware specification',
        ] },
        { date: '2026-05-12 UTC', title: 'Capability Access Rights, Console Improvements & Navigation', changes: [
            'Access rights declarations in capabilities: write <code>capabilities { LED0 RW }</code> to declare R/W access — assembler and CLOOMC++ compiler parse rights tokens (R/W/X/E) and carry them as structured objects throughout the pipeline',
            'Cross-check in Draft output: declared rights are compared against sidecar grants; the draft shows a warning when declared rights exceed what the sidecar permits; fault-tolerant — a runtime error in the check can no longer prevent the draft from displaying',
            'Rights flow through all four LUMP save payloads (CLOOMC++ build, assembly save, NS slot save, server save); editor injection shows <code>capabilities { LED0 RW }</code> with rights pulled from sidecar grants',
            'LUMP disassembly summary line extended: header comment now reads <code>(N words, cc=M, F free)</code> — code words, C-list slot count, and freespace visible at a glance in both the CR-register editor path and the Lumps panel path',
            'C-list section appended to console listing after a successful assemble or CLOOMC++ compile — each capability shown as <code>; row N  name</code>',
            'CTMM → CM rename completed in ctmm_cap_amaranth Amaranth HDL source: 15 classes (CTMMCapCore→CMCapCore, etc.) and 6 enums (CTMMOpcode→CMOpcode, etc.) renamed across all import sites',
            'Navigation shortcut: double-clicking any group heading (Develop / Test / Review / Hardware / Configure / Install) in the landing-page nav or IDE hamburger menu navigates directly to that group\'s primary view',
        ] },
        { date: '2026-05-02 UTC', title: 'Doc Audit, ISA Corrections & Hardware Alignment', changes: [
            'Full 14-item stale-documentation audit completed: all stale claims corrected across docs, simulator comments, and figures',
            'RETURN mask: marked as not implemented in all docs (call-stack.md, church-instructions.md, boot-rom-layout.md, instruction-matrix.md) — mask field silently ignored by hardware; assembler now warns on any non-zero mask (Task #888)',
            'SWITCH semantics: replaced "atomic CR swap" with correct "PassKey-gated one-way install into CR13/CR15" in assembler.js comments and app-lumps.js disassembler output',
            'TPERM D-3 closed: removed 3 stale notes claiming simulator produces Z=0 for reserved preset codes — simulator now faults with TPERM_RSV identical to hardware (Task #873)',
            'ISA reference E-2 corrected: "Assembler should reject" → "Assembler warns" to match Task #888 warn-only implementation',
            'CALL PC entry: replaced all PC=0 claims with hardware method-table dispatch description (method index in imm15; index 0 → word 1) across call-stack.md, architecture.md, and two SVG figures',
            'HARDWARE-DEVIATIONS.md: section header updated from "Open Deviations (D-1 through D-9)" to a status summary (9 closed, D-7/D-8/D-11 open)',
            'Method-table lump layout: replaced stale "M00 Dispatch — auto-generated" diagrams in namespace-vocabulary-tutorial.md and IDE-Designer.md with correct hardware table layout',
            'locator.md NS table size corrected: 16 bytes → 12 bytes, 4 KB → 3 KB (3-word NS entries)',
            '"TPERM never traps" phrasing clarified to "does not fault" in church-instructions.md and instruction-set.md — avoids confusion with TPERM_RSV reserved-preset fault',
            'Historical audit docs stamped: CONSISTENCY-AUDIT, AMARANTH-SIMULATOR-AUDIT, SIMULATOR-HARDWARE-GAPS, SIMULATOR-HARDWARE-MISMATCH all carry SUPERSEDED banners pointing to HARDWARE-DEVIATIONS.md',
            'Task #887 merged: D-9 LAMBDA hardware fix — CR6 state correctly preserved on LAMBDA CR6 re-entry path in Amaranth hardware',
            'Task #888 merged: RETURN mask assembler warning — assembler warns on any non-zero mask or reserved bit 6 instead of silently encoding',
            'Task #890 merged: LAMBDA CR6 re-entry simulator test added to gate suite',
            'Task #17 merged: Navana.Init wired as a callable method-table entry — 3-word lump injected at ROM word 320 (NS slot 5); method index 1 → PC=2 → RETURN AL; PRIVATE_METHOD fault eliminated (D-5 CLOSED)',
            'Task #891 merged: boot entry CALL test corrected — PC after a method-index-0 CALL is 1 (word 1, first code word after lump header), not 0; both default and custom_step1 configurations now pass',
            'Task #880 closed (D-11): simulator SWITCH instruction now matches hardware — PassKey-gated one-way install into CR13/CR15 only; three hard checks enforced: target validity (5→CR13, 7→CR15), Abstract GT type, and sentinel address (0xFFFFFFFE/0xFFFFFFFF); source CR unchanged; all hardware deviations D-1 through D-12 now closed',
        ] },
        { date: '2026-04-30 UTC', title: 'Hello Mum Pipeline, Hardware Bridge & LUMP Tokens Tab', changes: [
            'QR code display fixed: identity QR now rendered with a self-contained pure-stdlib generator — no external package required',
            'Hello Mum pipeline complete: board registration triggers Navana.Init → Keystone.Connect → Keystone.Hello automatically; tunnel_status ("online" / "offline" / "pending") stored per device and returned in every heartbeat response',
            'Tunnel auto-re-verify: when a board reconnects after going offline, the full Hello-Mum chain re-runs and the tunnel badge updates in place',
            'Tunnel status badges in Devices view: green "Tunnel online", muted-red "Tunnel offline", and neutral "Checking…" — auto-refresh every 12 s without a full page reload',
            'Board online/offline status and "last seen" time also auto-refresh live in the Devices view between polls',
            'UART bridge reader fixed: one-byte hold-back in the CALLHOME_MAGIC scanner eliminated; final byte of any UART response is no longer silently held back until the next read cycle',
            'GTKN replay test suite: pty loopback harness verifies the full serial framing path (tag big-endian on the wire, count, payload); golden 12-byte fixture captured from Ti60 hardware',
            'LUMP detail panel: new Tokens tab (inserted after Content) showing POLA — Principle of Least Authority section with ⚡ Apply POLA button, and the full MyGoldenTokens capability-chip viewer; Content tab now shows code/data only',
            'Gate test infrastructure: 3 pre-existing failures fixed (far_cap_fault, outform_load_lazy, outform_eloadcall_lazy); shared bootSim/setupCR6 helpers extracted; XLOADLAMBDA harness fixed; Python pytest wrappers added for all JS-only gate harnesses; gate suite grows to 52 tests',
            'Boot stability: Navana.Init skips NS entries for failed code allocations; boot succeeds even when both AllocCode calls return OOM',
        ] },
        { date: '2026-04-24 UTC', title: 'Assembler Upgrades, Editor Polish & Test Infrastructure', changes: ['Named method syntax in CALL: write CALL SlideRule.Multiply or CALL CR11, Multiply — the assembler looks up the method index automatically from the loaded abstraction conventions', 'Disassembler now outputs dot-notation (CALL SlideRule.Multiply) instead of raw method indices', 'BRANCH labels round-trip through assemble/disassemble; out-of-range BRANCH targets caught at assemble time with a clear error message', 'Error panel entries are clickable — clicking a compiler or assembler error jumps the editor to the exact failing line', 'Error lines highlighted in the assembly editor gutter (red marker on the broken line)', 'LUMP header strip gains a Shrink button; resize is available for all lump types, not just code lumps', 'Boot Lump (NS slot 3, LED flash) added to the Lump Repository view', 'Keyboard shortcuts added to the hamburger menu; single-character activators for all menu items', 'Fix CALL step display and step-into: stepping into a CALL now shows the correct target CR and method', 'Assembler regression test suite with 30+ named-method CALL test cases registered as a named validation step', 'Simulator test watcher (watch_assembler_tests.js) extended to discover and run all *_test.js files automatically'] },
        { date: '2026-04-16 UTC', title: 'LUMP Hardware Verification Fixes', changes: ['Fixed Build LUMP binary: removed embedded method dispatch table (raw word offsets were incorrectly written as code words that the FPGA would try to execute as instructions)', 'Method offsets in sidecar metadata now start at 0, matching the Python build_lumps.py spec and the manifest.json format used by FPGA tooling', 'Added Export Lump as Patch flow: pick any pre-built .lump file, validate the header (magic 0x1F, size, cw, cc), and wrap all words into a .patch file for FPGA flashing via patch_fpga.py', 'Byte-order correctness: .lump files remain big-endian per spec; Lump→Patch automatically byte-swaps each word to little-endian for the UART PATCH_LUMP protocol', 'Lump→Patch button added to editor toolbar, editor actions dropdown, and CRD FPGA action bar', 'Lump→Patch prompts for target BRAM word address (default 0x0100) and produces a CHPF v1 .patch with CRC-16/CCITT and RUN sentinel'] },
        { date: '2026-04-16 UTC', title: 'One-Click Build LUMP', changes: ['Build LUMP button: one-click compile-to-binary for any CLOOMC++ abstraction in any language mode', 'Produces spec-compliant .lump binary: header (magic 0x1F + n-6 + cw + typ + cc), code region, c-list, big-endian uint32', 'Console shows full lump layout: header hex, methods with offsets, capability list, freespace, file size', 'Available in toolbar (green button) and Editor Actions dropdown; auto-disabled in Assembly mode'] },
        { date: '2026-04-16 UTC', title: 'English String Abstraction', changes: ['EN: String example — 14 of 15 planned methods for packed 4-char-per-word string operations written in plain English (ReplaceChar deferred: requires bitwise AND/OR masking not yet in English translator)', 'Pack4/Unpack, IsLetter/IsDigit/IsUpper/IsLower/IsSpace, ToUpper/ToLower, CharToDigit/DigitToChar, ReverseWord, CompareWords, CountLetters', 'Byte extraction via shift-and-subtract (no bfext needed) — pure English front-end, zero hardware dependencies', 'New EN: String tab in CLOOMC++ IDE with category-organized source and ASCII reference header'] },
        { date: '2026-04-15 UTC', title: 'Patent Portfolio & Figure Audit', changes: ['Browsable /patents/ page: 8 PDFs with color-coded badges (FULL/BASE/CIP/COVER), 45 HTML figures with category filters and live search', 'Figure audit complete: 14 dark-background figures converted to white, 5 missing figures created (HP-35 opcode chart, Ada Lovelace model, 3 Lambda Recursion CIP figures), 4 new I/O Addressing figures', 'Consolidated patent document (2,818 lines): cover letter + Part I base patent + Addendum A (CLOOMC++) + Addendum B (Abstract GT I/O) + Addendum C (Lambda Recursion)', 'Lambda Recursion CIP finalized: 7 patent claims — CR6 self-invocation, idempotent re-entry, O(1) trifecta, two-RETURN exit, three loop styles, English NL compilation, pet-name constants', 'All patent PDFs regenerated with fpdf2: Unicode support, letter-size pages, multi-line table cells, page numbering', 'Server routes added: /patents/, /patents/files/, /figures/ for browsing patent portfolio'] },
        { date: '2026-04-12 UTC', title: 'SlideRule Abstraction, LED MMIO & Doc Review', changes: ['SlideRule abstraction complete (NS slot 16): 22 methods in CLOOMC++ source — 13 core (Add, Sub, Mul, Div, Mod, Sqrt, Pow, Sin, Cos, Tan, ASin, ACos, ATan2) + 9 extended (Sinh, Cosh, Exp, Log, Log2, Log10, ToDegrees, ToRadians, Bernoulli)', 'CLOOMC++ compiler bugs fixed: multi-word method bodies, semicolon handling, capability block parsing', '4 lumps build cleanly: Constants, LED, SlideRule, SlideRuleHS (token=00001000, cw=2602, methods=22)', 'LED abstraction (NS slot 12): FPGA MMIO bindings for Efinix Ti60 F225 (NS slot 12)', 'Navana.Init boot sequence: ordered capability grants, slot pre-population on boot ROM start', 'IntegerOps (Clamp+Abs) and PackedString (Pack4+Unpack+IsLetter+ToUpper) JS examples in IDE tabs', 'CR5 instance-data convention clarified: CR5 is a thread register installed by CHANGE from Zone ④ bounds; not saved/restored by CALL/RETURN', 'Branding cleanup: CTMM_64 → ChurchMachine_64, RV32_CAP → IoT_32 throughout docs', 'Doc review (9 fixes): GT type table, register count, GT width, patent dates, network-transparency status, TSB line count (329 → ~300), Results row in prologue property table'] },
        { date: '2026-04-11 19:30 UTC', title: 'Cryptographic Build Signatures', changes: ['HMAC-SHA256 build signatures replace single-byte build tag', 'Server-side signature verification with constant-time comparison', '23-byte call-home packet with 4-byte HMAC, boot_reason, last_fault, fault_nia fields', 'Official/Custom Build badges (green/amber) in Devices view', 'MTBF gate: maxSteps runs count as failed; editor input clears history', 'Quick-start docs improved with toolbar icon reference and DigiKey link'] },
        { date: '2026-03-29 22:15 UTC', title: 'Consistency & Hardware Updates', changes: ['Consistency audits completed', 'Simulator GT type mapping fixed (Inform/Outform/Abstract)', 'Hardware deployment plan for Efinix Ti60 F225 created', 'Settings button order corrected', 'Lump size specification unified (64-word minimum)'] },
        { date: '2026-03-24 00:00 UTC', title: 'Locator & Docs', changes: ['Locator rename completed', 'Namespace docs refreshed', 'CLOOMC++ tutorials updated'] }
    ];
    let html = '<div style="max-height:60vh;overflow-y:auto;font-size:0.85rem;">';
    history.forEach(rel => {
        html += `<div style="margin-bottom:1.5rem;border-bottom:1px solid #444;padding-bottom:0.5rem;">`;
        html += `<div style="color:var(--church-gold);font-weight:bold;margin-bottom:0.3rem;">${rel.date}</div>`;
        html += `<div style="color:#bbb;font-size:0.9rem;margin-bottom:0.5rem;">${rel.title}</div>`;
        html += `<ul style="margin:0;padding-left:1.5rem;color:#999;">`;
        rel.changes.forEach(change => {
            html += `<li>${change}</li>`;
        });
        html += `</ul></div>`;
    });
    html += '</div>';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.style.maxWidth = '600px';
    dialog.innerHTML = `
        <div class="modal-title">Release History</div>
        ${html}
        <div class="modal-buttons" style="margin-top:1rem;">
            <button class="btn btn-warning" onclick="this.parentElement.parentElement.parentElement.remove()">Close</button>
        </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
}

function saveSettings() {
    const settings = {
        name: document.getElementById('settingName').value.trim(),
        familyMembers: collectFamilyMembers(),
        profession: document.getElementById('settingProfession')?.value || 'student',
        language: document.getElementById('settingLanguage')?.value || 'english',
        nationality: document.getElementById('settingNationality')?.value || 'us',
        ageTier: document.getElementById('settingAgeTier')?.value || '13-17',
        fpgaBoard: document.getElementById('settingFPGABoard')?.value || 'wukong-xc7a100t',
        openSource: !!document.getElementById('settingOpenSource')?.checked,
        selectedSubjects: getSelectedSubjects(),
        notif: {
            boardNew:       !!document.getElementById('notifBoardNew')?.checked,
            boardReconnect: !!document.getElementById('notifBoardReconnect')?.checked,
            fault:          !!document.getElementById('notifFault')?.checked,
            compile:        !!document.getElementById('notifCompile')?.checked
        }
    };
    localStorage.setItem('church_student_settings', JSON.stringify(settings));

    const boardSel = document.getElementById('settingFPGABoard');
    if (boardSel) setSelectedBoard(boardSel.value);

    let fa = getFamilyAbstraction();
    const members = settings.familyMembers;
    if (members.length > 0) {
        const adultRoles = ['Mum', 'Dad', 'Grandpa', 'Grandma', 'Uncle', 'Auntie', 'Teacher'];
        const firstAdult = members.find(m => adultRoles.includes(m.role));
        if (!fa && firstAdult) {
            fa = initFamilyAbstraction(firstAdult.name);
            fa.clist[0].role = firstAdult.role;
            saveFamilyAbstraction(fa);
            setActiveGT(fa.owner);
        }
        if (fa) {
            members.forEach(m => {
                const existing = fa.clist.find(e => e.name === m.name && e.role === m.role);
                if (!existing && m.name) {
                    if (adultRoles.includes(m.role) && fa.clist.filter(e => adultRoles.includes(e.role)).length === 0) {
                        fa.owner = mintGoldenToken();
                        fa.clist.unshift({ gtId: fa.owner, role: m.role, name: m.name, permissions: (() => { const p = {}; FAMILY_PERMISSIONS.forEach(x => { p[x.key] = true; }); return p; })(), immutable: true, mintedAt: Date.now() });
                        saveFamilyAbstraction(fa);
                    } else {
                        mintChildGT(fa, m.name, m.role);
                    }
                }
            });
        }
    }
    closeSettings();
}

function onGradeChange() {
    renderProgressReport();
}

const familyRoles = ['Mum', 'Me', 'Friend', 'Friend', 'Friend', 'Friend', 'Friend', 'Friend'];

function renderFamilyMembers(members) {
    const container = document.getElementById('familyMembersList');
    if (!container) return;
    container.innerHTML = '';
    if (!members || members.length === 0) {
        addFamilyMemberRow('Mum', '');
        addFamilyMemberRow('Me', '');
        return;
    }
    members.forEach(m => addFamilyMemberRow(m.role || 'Me', m.name || ''));
}

function addFamilyMemberRow(role, name) {
    const container = document.getElementById('familyMembersList');
    if (!container) return;
    const count = container.children.length;
    if (count >= 8) return;
    const defaultRole = count < 2 ? (count === 0 ? 'Mum' : 'Me') : 'Friend';
    const r = role || defaultRole;
    const n = name || '';
    const fa = getFamilyAbstraction();
    const entry = fa ? fa.clist.find(e => e.name === n && e.role === r) : null;
    const gtDisplay = entry ? entry.gtId : '';
    const isOwner = entry && fa && entry.gtId === fa.owner;

    const row = document.createElement('div');
    row.className = 'family-member-row';

    let gtBadge = '';
    if (gtDisplay) {
        gtBadge = `<span class="gt-badge${isOwner ? ' gt-owner' : ''}" title="${isOwner ? 'Owner GT — full permissions' : 'Child GT — permissions set by parent'}">${gtDisplay}</span>`;
    }

    let permsHTML = '';
    if (entry && !isOwner && fa) {
        permsHTML = `<div class="gt-perms-row">`;
        FAMILY_PERMISSIONS.forEach(p => {
            const checked = entry.permissions[p.key] !== false ? ' checked' : '';
            permsHTML += `<label class="gt-perm-label" title="${escapeHtml(p.desc)}"><input type="checkbox" class="gt-perm-cb" data-gt="${entry.gtId}" data-perm="${p.key}"${checked} onchange="toggleFamilyPerm(this)"> ${escapeHtml(p.label)}</label>`;
        });
        permsHTML += `</div>`;
    }

    const roleOptions = ['Mum', 'Dad', 'Me', 'Brother', 'Sister', 'Grandpa', 'Grandma', 'Uncle', 'Auntie', 'Cousin', 'Friend', 'School Friend', 'Class Mate', 'Teacher'];
    let roleSelectHTML = `<select class="modal-input family-role-select">`;
    roleOptions.forEach(opt => {
        roleSelectHTML += `<option value="${opt}"${r === opt ? ' selected' : ''}>${opt}</option>`;
    });
    roleSelectHTML += `</select>`;

    row.innerHTML =
        `<div class="family-member-top">` +
        roleSelectHTML +
        `<input type="text" class="modal-input family-name-input" placeholder="Pet Name" value="${escapeHtml(n)}">` +
        gtBadge +
        `<button class="btn-remove-member" onclick="this.closest('.family-member-row').remove()" title="Remove">&times;</button>` +
        `</div>` +
        permsHTML;
    container.appendChild(row);
}

function toggleFamilyPerm(cb) {
    const fa = getFamilyAbstraction();
    if (!fa) return;
    const activeGT = getActiveGT();
    if (activeGT !== fa.owner) {
        cb.checked = !cb.checked;
        appendOutput('Only the parent (owner GT) can change permissions.', 'error');
        return;
    }
    const gtId = cb.dataset.gt;
    const permKey = cb.dataset.perm;
    if (cb.checked) {
        familyAllow(fa, gtId, permKey);
    } else {
        familyDeny(fa, gtId, permKey);
    }
}

function requirePermission(permKey, actionLabel) {
    if (!checkPermission(permKey)) {
        appendOutput(`Permission denied: ${actionLabel}. Ask your parent to enable "${permKey}" on your GT.`, 'error');
        return false;
    }
    return true;
}

function collectFamilyMembers() {
    const container = document.getElementById('familyMembersList');
    if (!container) return [];
    const members = [];
    container.querySelectorAll('.family-member-row').forEach(row => {
        const role = row.querySelector('.family-role-select');
        const name = row.querySelector('.family-name-input');
        if (role && name && name.value.trim()) {
            members.push({ role: role.value, name: name.value.trim() });
        }
    });
    return members;
}

function isWelcomeNeeded() {
    if (localStorage.getItem('church_welcome_dismissed_perm')) return false;
    const settings = getStudentSettings();
    const hasFamily = settings.familyMembers && settings.familyMembers.length > 0 &&
        settings.familyMembers.some(m => m.name && m.name.trim() !== '');
    if (!hasFamily) return true;
    return !localStorage.getItem('church_welcome_dismissed');
}

const WELCOME_SLIDES = [
    {
        html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">Why does security matter?</div>` +
        `<p style="font-size:0.9rem;line-height:1.65;margin-bottom:0.75rem;">` +
        `Every computer your child uses &mdash; phones, tablets, laptops &mdash; runs software that can be tricked. ` +
        `Programs pretend to be other programs. Apps ask for permissions they should not have. ` +
        `A child clicks one wrong link and strangers can see their data. ` +
        `This is not a new problem. It is <em>the</em> problem of computing, and it was solved in 1936.</p>` +
        `<div style="background:rgba(218,165,32,0.06);border:1px solid rgba(218,165,32,0.2);border-radius:8px;padding:0.75rem 1rem;margin-bottom:0.75rem;font-size:0.88rem;line-height:1.6;">` +
        `<strong style="color:var(--church-gold);">Did you know?</strong> Cybercrime is now the world's third biggest economy &mdash; ` +
        `behind only the USA and China. If it were a country, it would be richer than Japan, Germany, and the UK combined. ` +
        `<a href="https://sipantic.blogspot.com/2025/11/the-cybercrime-tsunami.html" target="_blank" rel="noopener" style="color:var(--church-gold);">Read more</a></div>` +
        `<p style="font-size:0.88rem;line-height:1.6;margin:0;">` +
        `The Church Machine implements the <strong>Lambda Calculus</strong>: a universal model of computation that provides ` +
        `a rigorous mathematical foundation for designing secure and provably correct software and hardware, ` +
        `offering an alternative to the problematic von Neumann model. ` +
        `<a href="https://en.wikipedia.org/wiki/Lambda_calculus" target="_blank" rel="noopener" style="color:var(--church-gold);">More</a></p>`
    },
    {
        html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">How Alonzo Church solved it</div>` +
        `<p style="font-size:0.9rem;line-height:1.65;margin-bottom:0.75rem;">` +
        `In 1936, mathematician <strong>Alonzo Church</strong> invented the lambda calculus &mdash; a way of computing where ` +
        `you can only use something if someone explicitly gives it to you. No sneaking, no stealing, no tricks. ` +
        `If you do not hold the key, the door does not open. ` +
        `<a href="https://en.wikipedia.org/wiki/Alonzo_Church" target="_blank" rel="noopener" style="color:var(--church-gold);">More</a></p>` +
        `<div style="background:rgba(218,165,32,0.08);border:1px solid rgba(218,165,32,0.25);border-radius:8px;padding:0.75rem 1rem;margin-bottom:0.75rem;">` +
        `<div style="font-weight:700;color:var(--church-gold);margin-bottom:0.5rem;">Golden Tokens</div>` +
        `<p style="font-size:0.88rem;line-height:1.6;margin:0;">` +
        `The Church Machine is built on this idea. Every action requires a <strong>Golden Token</strong> &mdash; ` +
        `an unforgeable digital key. Your child cannot send a message, share a file, or connect with anyone ` +
        `unless they hold the right token. And <em>you</em> control which tokens they hold. ` +
        `<a href="https://en.wikipedia.org/wiki/Capability-based_security" target="_blank" rel="noopener" style="color:var(--church-gold);">More</a></p>` +
        `</div>` +
        `<p style="font-size:0.85rem;color:#aaa;line-height:1.5;margin:0;">` +
        `This is not access control bolted on top &mdash; it is the mathematics itself. There is no way around it.</p>`
    },
    {
        html: `<div style="font-weight:700;color:var(--church-green);font-size:1.05rem;margin-bottom:0.75rem;">Hello Mum &mdash; the first safe message</div>` +
        `<div style="background:rgba(100,200,100,0.06);border:1px solid rgba(100,200,100,0.2);border-radius:8px;padding:0.75rem 1rem;margin-bottom:0.75rem;">` +
        `<p style="font-size:0.9rem;line-height:1.65;margin:0 0 0.75rem 0;">` +
        `When you register your family, the Church Machine creates a secure link between parent and child. ` +
        `Your child can then write their first program: <strong>Hello(Mum)</strong> &mdash; ` +
        `a message that travels through the Family security block, verified by Golden Tokens at every step.</p>` +
        `<p style="font-size:0.9rem;line-height:1.65;margin:0;">` +
        `No one else can send that message. No one else can intercept it. It works because Mum is not just a name &mdash; ` +
        `she is a <strong>Golden Token</strong>, alive, in charge, unforgeable and unique.</p>` +
        `</div>` +
        `<p style="font-size:0.88rem;color:#aaa;line-height:1.55;margin:0;">` +
        `That is what Church's mathematics gives us: a computer where &ldquo;Hello Mum&rdquo; &mdash; unlike ` +
        `Hello World from 1972 &mdash; actually means something safe.</p>`
    },
    {
        html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">The Church Machine &mdash; 32-bit clean-start architecture</div>` +
        `<p style="font-size:0.88rem;line-height:1.6;margin-bottom:0.75rem;">` +
        `The Church-Turing Meta-Machine (CM) is a <strong>32-bit clean-start architecture</strong> devised by Kenneth J Hamer-Hodges, FIEE. ` +
        `It replaces the legacy von Neumann model with hardware-enforced Church instructions &mdash; ` +
        `every capability access goes through an unforgeable Golden Token.</p>` +
        `<div style="font-weight:600;color:var(--church-gold);font-size:0.88rem;margin-bottom:0.45rem;">The 11 Church Instructions</div>` +
        `<table style="width:100%;border-collapse:collapse;font-size:0.8rem;line-height:1.5;">` +
        `<thead><tr>` +
        `<th style="text-align:left;padding:0.25rem 0.5rem;border-bottom:1px solid rgba(218,165,32,0.3);color:var(--church-gold);font-weight:600;">Instruction</th>` +
        `<th style="text-align:left;padding:0.25rem 0.5rem;border-bottom:1px solid rgba(218,165,32,0.3);color:var(--church-gold);font-weight:600;">Description</th>` +
        `</tr></thead><tbody>` +
        `<tr><td style="padding:0.2rem 0.5rem;font-family:monospace;color:#ddd;white-space:nowrap;">LOAD</td><td style="padding:0.2rem 0.5rem;color:#bbb;">Copy a Golden Token from a C-List slot into a Context Register</td></tr>` +
        `<tr style="background:rgba(255,255,255,0.03);"><td style="padding:0.2rem 0.5rem;font-family:monospace;color:#ddd;white-space:nowrap;">SAVE</td><td style="padding:0.2rem 0.5rem;color:#bbb;">Write a Context Register&rsquo;s Golden Token back into a C-List slot</td></tr>` +
        `<tr><td style="padding:0.2rem 0.5rem;font-family:monospace;color:#ddd;white-space:nowrap;">LOADX</td><td style="padding:0.2rem 0.5rem;color:#bbb;">Load Exclusive &mdash; atomic capability load for lock-free synchronisation</td></tr>` +
        `<tr style="background:rgba(255,255,255,0.03);"><td style="padding:0.2rem 0.5rem;font-family:monospace;color:#ddd;white-space:nowrap;">SAVEX</td><td style="padding:0.2rem 0.5rem;color:#bbb;">Store Exclusive &mdash; conditionally store only if exclusive monitor is valid</td></tr>` +
        `<tr><td style="padding:0.2rem 0.5rem;font-family:monospace;color:#ddd;white-space:nowrap;">LDM</td><td style="padding:0.2rem 0.5rem;color:#bbb;">Load Multiple &mdash; fill several Context Registers from consecutive C-List entries</td></tr>` +
        `<tr style="background:rgba(255,255,255,0.03);"><td style="padding:0.2rem 0.5rem;font-family:monospace;color:#ddd;white-space:nowrap;">STM</td><td style="padding:0.2rem 0.5rem;color:#bbb;">Store Multiple &mdash; write several Context Registers to consecutive C-List entries</td></tr>` +
        `<tr><td style="padding:0.2rem 0.5rem;font-family:monospace;color:#ddd;white-space:nowrap;">CALL</td><td style="padding:0.2rem 0.5rem;color:#bbb;">Enter an abstraction &mdash; push return state and switch capability context</td></tr>` +
        `<tr style="background:rgba(255,255,255,0.03);"><td style="padding:0.2rem 0.5rem;font-family:monospace;color:#ddd;white-space:nowrap;">RETURN</td><td style="padding:0.2rem 0.5rem;color:#bbb;">Leave an abstraction &mdash; pop return state and restore caller&rsquo;s context</td></tr>` +
        `<tr><td style="padding:0.2rem 0.5rem;font-family:monospace;color:#ddd;white-space:nowrap;">CHANGE</td><td style="padding:0.2rem 0.5rem;color:#bbb;">Privileged register write &mdash; install a Golden Token into CR12&ndash;CR15; CR14/CR15 trigger a full per-thread context switch</td></tr>` +
        `<tr style="background:rgba(255,255,255,0.03);"><td style="padding:0.2rem 0.5rem;font-family:monospace;color:#ddd;white-space:nowrap;">SWITCH</td><td style="padding:0.2rem 0.5rem;color:#bbb;">Switch namespace &mdash; atomically reload CR15 with a new namespace root for domain isolation</td></tr>` +
        `<tr><td style="padding:0.2rem 0.5rem;font-family:monospace;color:#ddd;white-space:nowrap;">TPERM</td><td style="padding:0.2rem 0.5rem;color:#bbb;">Test GT permissions and bounds &mdash; verify a Golden Token carries required permission bits before use (sets Z flag)</td></tr>` +
        `</tbody></table>`
    },
    {
        html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">Getting started</div>` +
        `<div class="welcome-step">` +
        `<span class="welcome-step-num">1</span>` +
        `<div class="welcome-step-text"><strong>Register your family.</strong> Click "Set Up My Family" below to enter your name (or your children's names) and select a grade level. This creates the Golden Token link between you.</div>` +
        `</div>` +
        `<div class="welcome-step">` +
        `<span class="welcome-step-num">2</span>` +
        `<div class="welcome-step-text"><strong>Try the Math tab.</strong> Type a simple calculation like <code style="background:#1a1a2e;padding:0.15rem 0.4rem;border-radius:3px;color:var(--church-gold);">let x = 2 + 3</code> and press Enter. The answer appears instantly. Try the Challenge panel on the right for grade-level problems.</div>` +
        `</div>` +
        `<div class="welcome-step">` +
        `<span class="welcome-step-num">3</span>` +
        `<div class="welcome-step-text"><strong>Watch their progress.</strong> Open Settings (the gear icon) to see problems solved, languages tried, and recent activity. Everything stays on this device &mdash; no accounts, no cloud.</div>` +
        `</div>` +
        `<div class="welcome-step">` +
        `<span class="welcome-step-num">4</span>` +
        `<div class="welcome-step-text"><strong>Explore.</strong> The Code tab has four programming languages. The Tutorial tab has guided lessons. The Docs tab has the full reference. There is no wrong way to learn.</div>` +
        `</div>`
    }
];

let _welcomeSlideIdx = 0;

function _getNextWelcomeSlide() {
    const stored = parseInt(localStorage.getItem('church_welcome_slide') || '0', 10);
    const next = isNaN(stored) ? 0 : (stored + 1) % WELCOME_SLIDES.length;
    localStorage.setItem('church_welcome_slide', String(next));
    return next;
}

function _renderWelcomeSlide(idx) {
    const body = document.getElementById('welcomeBody');
    const indicator = document.getElementById('welcomeSlideIndicator');
    if (!body) return;
    _welcomeSlideIdx = ((idx % WELCOME_SLIDES.length) + WELCOME_SLIDES.length) % WELCOME_SLIDES.length;
    body.scrollTop = 0;
    body.innerHTML = WELCOME_SLIDES[_welcomeSlideIdx].html;
    if (indicator) indicator.textContent = `${_welcomeSlideIdx + 1} / ${WELCOME_SLIDES.length}`;
    const arrow = document.getElementById('welcomeScrollArrow');
    if (arrow) {
        const checkScroll = () => {
            const gap = body.scrollHeight - body.scrollTop - body.clientHeight;
            if (gap > 30) arrow.classList.remove('hidden');
            else arrow.classList.add('hidden');
        };
        if (body._scrollHandler) body.removeEventListener('scroll', body._scrollHandler);
        body._scrollHandler = checkScroll;
        body.addEventListener('scroll', checkScroll);
        checkScroll();
    }
}

function stepWelcomeSlide(dir) {
    _renderWelcomeSlide(_welcomeSlideIdx + dir);
    localStorage.setItem('church_welcome_slide', String(_welcomeSlideIdx));
}

function showWelcomePopup(force) {
    if (POPUPS_DISABLED) return;
    if (!force && !isWelcomeNeeded()) return;

    const idx = force ? _welcomeSlideIdx : _getNextWelcomeSlide();
    _renderWelcomeSlide(idx);
    document.getElementById('welcomeModal').style.display = 'flex';
}

function closeWelcome() {
    const dontShow = document.getElementById('welcomeDontShow');
    if (dontShow && dontShow.checked) {
        localStorage.setItem('church_welcome_dismissed_perm', '1');
    }
    localStorage.setItem('church_welcome_dismissed', '1');
    sessionStorage.setItem('church_welcome_dismissed_session', '1');
    const modal = document.getElementById('welcomeModal');
    if (modal) modal.style.display = 'none';
    const welcomeBody = document.getElementById('welcomeBody');
    if (welcomeBody && welcomeBody._scrollHandler) {
        welcomeBody.removeEventListener('scroll', welcomeBody._scrollHandler);
        delete welcomeBody._scrollHandler;
    }
    const arrow = document.getElementById('welcomeScrollArrow');
    if (arrow) arrow.classList.add('hidden');
}

function welcomeSetup() {
    closeWelcome();
    openSettings();
}

function welcomeSkip() {
    closeWelcome();
}

const WHATS_NEW_VERSION = '2026-05-15';   // bump this when content changes, not on every deploy
const WHATS_NEW_FEATURES = [
    {
        title: "Builder ZIP downloads fixed",
        html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">&#x1F4E6; Download FPGA Package &mdash; what you see is what you get</div>` +
            `<p style="font-size:0.9rem;line-height:1.65;margin-bottom:0.75rem;">` +
            `The build log printed after a ZIP download now exactly matches what is inside the file &mdash; for all three boards. ` +
            `Ti60 F225 no longer lists a phantom <code style="background:#1a1a2e;padding:0.15rem 0.4rem;border-radius:3px;color:var(--church-gold);">.edif</code> that was never generated; ` +
            `Wukong and Tang Nano now list <code style="background:#1a1a2e;padding:0.15rem 0.4rem;border-radius:3px;color:var(--church-gold);">local_bridge.py</code> which was silently included; ` +
            `Tang Nano marks <code style="background:#1a1a2e;padding:0.15rem 0.4rem;border-radius:3px;color:var(--church-gold);">.v</code> and <code style="background:#1a1a2e;padding:0.15rem 0.4rem;border-radius:3px;color:var(--church-gold);">.json</code> as conditional.</p>` +
            `<p style="font-size:0.88rem;color:#aaa;line-height:1.5;margin:0;">` +
            `A new test suite enforces that ZIP contents and build log can never drift apart again.</p>`
    },
    {
        title: "Capability access rights",
        html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">&#x1F512; capabilities { LED0 RW } &mdash; declare what you need</div>` +
            `<p style="font-size:0.9rem;line-height:1.65;margin-bottom:0.75rem;">` +
            `You can now declare access rights directly in the <code style="background:#1a1a2e;padding:0.15rem 0.4rem;border-radius:3px;color:var(--church-gold);">capabilities { }</code> block. ` +
            `Write <code style="background:#1a1a2e;padding:0.15rem 0.4rem;border-radius:3px;color:var(--church-gold);">LED0 RW</code> to declare read-write access, ` +
            `<code style="background:#1a1a2e;padding:0.15rem 0.4rem;border-radius:3px;color:var(--church-gold);">Memory E</code> for execute-only, and so on. ` +
            `Rights tokens (R / W / X / E) are parsed by both the assembler and the CLOOMC++ compiler and carried through to Draft output, save payloads, and editor injection.</p>` +
            `<p style="font-size:0.88rem;color:#aaa;line-height:1.5;margin:0;">` +
            `Draft now cross-checks declared rights against sidecar grants and warns if you claimed more than the capability allows.</p>`
    },
    {
        title: "C-list in console & extended LUMP summary",
        html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">&#x1F4CB; See your C-list and LUMP layout at a glance</div>` +
            `<p style="font-size:0.9rem;line-height:1.65;margin-bottom:0.75rem;">` +
            `After a successful assemble or compile the console now appends a <strong>c-list section</strong> listing every capability by row index. ` +
            `The LUMP disassembly header comment is also extended: ` +
            `<code style="background:#1a1a2e;padding:0.15rem 0.4rem;border-radius:3px;color:var(--church-gold);">(17 words, cc=1, 46 free)</code> ` +
            `shows code-word count, C-list slot count, and freespace in a single line.</p>` +
            `<p style="font-size:0.88rem;color:#aaa;line-height:1.5;margin:0;">` +
            `Both the CR-register editor path and the Lumps panel disassembly path show the extended summary.</p>`
    },
    {
        title: "Named method syntax",
        html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">&#x1F4AC; CALL SlideRule.Multiply &mdash; write what you mean</div>` +
            `<p style="font-size:0.9rem;line-height:1.65;margin-bottom:0.75rem;">` +
            `You can now write <code style="background:#1a1a2e;padding:0.15rem 0.4rem;border-radius:3px;color:var(--church-gold);">CALL SlideRule.Multiply</code> or ` +
            `<code style="background:#1a1a2e;padding:0.15rem 0.4rem;border-radius:3px;color:var(--church-gold);">CALL CR11, Multiply</code> ` +
            `instead of looking up method indices by hand. The assembler resolves the method name automatically from the abstraction's loaded conventions.</p>` +
            `<p style="font-size:0.88rem;color:#aaa;line-height:1.5;margin:0;">` +
            `The disassembler also produces dot-notation output, so what you write is what you read back.</p>`
    },
    {
        title: "Clickable error panel",
        html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">&#x1F4CD; Click an error &mdash; jump straight to the line</div>` +
            `<p style="font-size:0.9rem;line-height:1.65;margin-bottom:0.75rem;">` +
            `Compiler and assembler errors in the error panel are now clickable. Click any message and the editor scrolls to the ` +
            `exact failing line and highlights it in the gutter &mdash; no more manually counting lines to find your mistake.</p>` +
            `<p style="font-size:0.88rem;color:#aaa;line-height:1.5;margin:0;">` +
            `BRANCH out-of-range errors are also caught at assemble time with a clear message.</p>`
    },
    {
        title: "One-command flash",
        html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">&#x26A1; flash.sh &mdash; one command to build and flash</div>` +
            `<p style="font-size:0.9rem;line-height:1.65;margin-bottom:0.75rem;">` +
            `The FPGA download package now includes <code style="background:#1a1a2e;padding:0.15rem 0.4rem;border-radius:3px;color:var(--church-gold);">flash.sh</code> &mdash; ` +
            `a single command that runs the full build-to-flash pipeline (nextpnr &rarr; gowin_pack &rarr; openFPGALoader). ` +
            `It stops on the first error with a diagnostic hint, and ends with an LED success checklist.</p>` +
            `<p style="font-size:0.88rem;color:#aaa;line-height:1.5;margin:0;">` +
            `Go to <strong>Builder</strong> &rarr; <strong>Download FPGA Package</strong> to get the new ZIP.</p>`
    },
    {
        title: "Serial bridge in the ZIP",
        html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">&#x1F310; bridge.sh &mdash; connect your board to the IDE</div>` +
            `<p style="font-size:0.9rem;line-height:1.65;margin-bottom:0.75rem;">` +
            `The download package now includes <code style="background:#1a1a2e;padding:0.15rem 0.4rem;border-radius:3px;color:var(--church-gold);">bridge.sh</code> and ` +
            `<code style="background:#1a1a2e;padding:0.15rem 0.4rem;border-radius:3px;color:var(--church-gold);">local_bridge.py</code>. ` +
            `After flashing, run <code style="background:#1a1a2e;padding:0.15rem 0.4rem;border-radius:3px;color:var(--church-gold);">./bridge.sh --ide=https://cloomc.org</code> ` +
            `and your board appears in the <strong>Devices</strong> panel within seconds.</p>` +
            `<p style="font-size:0.88rem;color:#aaa;line-height:1.5;margin:0;">` +
            `No need to clone the repo separately &mdash; the ZIP is fully self-contained.</p>`
    },
    {
        title: "Devices panel",
        html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">&#x1F4F1; Devices panel &mdash; see and manage connected boards</div>` +
            `<p style="font-size:0.9rem;line-height:1.65;margin-bottom:0.75rem;">` +
            `Open <strong>Devices</strong> from the hamburger menu to see every connected FPGA board. ` +
            `Each board shows its status (online/offline), board type, firmware version, and boot count. ` +
            `Click <strong>Deploy</strong> to push a compiled abstraction to any board, or ` +
            `<strong>Deploy All</strong> to update every online board at once.</p>` +
            `<p style="font-size:0.88rem;color:#aaa;line-height:1.5;margin:0;">` +
            `Label your boards to keep track of multi-device IoT deployments.</p>`
    },
    {
        title: "FPGA call-home",
        html: `<div style="font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;">&#x1F4E1; FPGA call-home &mdash; boards register automatically</div>` +
            `<p style="font-size:0.9rem;line-height:1.65;margin-bottom:0.75rem;">` +
            `When a board boots with the current bitstream, it sends a 23-byte call-home packet ` +
            `over UART (including boot reason, last fault code, and faulting instruction address). The bridge detects this, sends an acknowledgment, and registers the board with the IDE. ` +
            `A 60-second heartbeat keeps the board marked as online.</p>` +
            `<p style="font-size:0.88rem;color:#bbb;line-height:1.6;margin-bottom:0.5rem;">` +
            `Board type byte in the packet: <code>0x01</code> = Tang Nano 20K &nbsp;·&nbsp; ` +
            `<code>0x03</code> = Ti60 F225 &nbsp;·&nbsp; ` +
            `<code>0x06</code> = Wukong XC7A100T</p>` +
            `<p style="font-size:0.88rem;color:#aaa;line-height:1.5;margin:0;">` +
            `No manual registration needed &mdash; plug in, flash, run bridge, done.</p>`
    }
];

let _whatsNewIdx = 0;

function showWhatsNew(force) {
    if (POPUPS_DISABLED) return;
    if (!force && localStorage.getItem('church_whatsnew_dismissed_perm')) return;
    if (WHATS_NEW_FEATURES.length === 0) return;
    _whatsNewIdx = 0;
    _renderWhatsNewSlide(0);
    document.getElementById('whatsNewModal').style.display = 'flex';
}

function _renderWhatsNewSlide(idx) {
    const body = document.getElementById('whatsNewBody');
    const indicator = document.getElementById('whatsNewIndicator');
    const title = document.getElementById('whatsNewTitle');
    if (!body) return;
    _whatsNewIdx = ((idx % WHATS_NEW_FEATURES.length) + WHATS_NEW_FEATURES.length) % WHATS_NEW_FEATURES.length;
    const feature = WHATS_NEW_FEATURES[_whatsNewIdx];
    body.innerHTML = feature.html;
    if (indicator) indicator.textContent = `${_whatsNewIdx + 1} / ${WHATS_NEW_FEATURES.length}`;
    if (title) title.textContent = "What's New";
}

function stepWhatsNew(dir) {
    _renderWhatsNewSlide(_whatsNewIdx + dir);
}

function closeWhatsNew() {
    const dontShow = document.getElementById('whatsNewDontShow');
    if (dontShow && dontShow.checked) {
        localStorage.setItem('church_whatsnew_dismissed_perm', '1');
    }
    localStorage.setItem('church_whatsnew_version', WHATS_NEW_VERSION);
    const modal = document.getElementById('whatsNewModal');
    if (modal) modal.style.display = 'none';
}

function toggleHelpMenu() {
    const dd = document.getElementById('helpDropdown');
    if (!dd) return;
    const open = dd.style.display !== 'none';
    dd.style.display = open ? 'none' : 'block';
    if (!open) {
        setTimeout(() => {
            document.addEventListener('click', _helpMenuOutsideClick, { once: true, capture: true });
        }, 0);
    }
}

function closeHelpMenu() {
    const dd = document.getElementById('helpDropdown');
    if (dd) dd.style.display = 'none';
}

function _helpMenuOutsideClick(e) {
    const wrap = document.getElementById('helpMenuWrap');
    if (wrap && !wrap.contains(e.target)) {
        closeHelpMenu();
    } else if (wrap && wrap.contains(e.target)) {
        document.addEventListener('click', _helpMenuOutsideClick, { once: true, capture: true });
    }
}

const SUBJECTS = [
    {
        key: 'english',
        name: 'English',
        icon: '\uD83D\uDCD6',
        color: '#4fc3f7',
        desc: 'Write programs in plain English sentences',
        lessons: [
            { title: 'Your First Program', code: 'create abstraction called Hello\nadd method greet that prints "Hello World"', desc: 'Learn to write commands the Church Machine understands' },
            { title: 'Variables & Storage', code: 'create abstraction called Counter\nadd data count starting at 0\nadd method increment that adds 1 to count', desc: 'Store and change values using data words' },
            { title: 'Conditions', code: 'create abstraction called Guard\nadd method check that if count is greater than 10 then print "Too many"', desc: 'Make decisions with if-then logic' },
            { title: 'First-Class Variables', code: 'create abstraction called Mapper\nadd method apply that takes a function and a value and returns the function applied to the value', desc: 'Pass functions as values — the key difference from basic machine code' }
        ]
    },
    {
        key: 'javascript',
        name: 'JavaScript',
        icon: '\uD83D\uDCBB',
        color: '#f0c674',
        desc: 'Modern programming with functions and objects',
        lessons: [
            { title: 'Functions', code: 'function add(a, b) {\n  return a + b;\n}', desc: 'Define reusable blocks of code' },
            { title: 'First-Class Variables', code: 'let double = (x) => x * 2;\nlet apply = (f, x) => f(x);\nlet result = apply(double, 5);\n// result = 10', desc: 'Store functions in variables and pass them as arguments — not just values' },
            { title: 'Arrays & Loops', code: 'let nums = [1, 2, 3, 4, 5];\nfor (let n of nums) {\n  console.log(n * n);\n}', desc: 'Work with lists and repeat actions' },
            { title: 'Objects as Abstractions', code: 'let counter = {\n  count: 0,\n  increment() { this.count++; },\n  read() { return this.count; }\n};', desc: 'Group data and methods together' }
        ]
    },
    {
        key: 'haskell',
        name: 'Haskell',
        icon: '\u03BB',
        color: '#b48ead',
        desc: 'Pure functional programming with lambda calculus',
        lessons: [
            { title: 'Lambda Expressions', code: 'double = \\x -> x * 2\nadd = \\x y -> x + y', desc: 'Define functions with lambda notation' },
            { title: 'First-Class Variables', code: 'apply f x = f x\ndouble = \\x -> x * 2\nresult = apply double 5\n-- result = 10\n-- "double" is passed as an argument, not called directly', desc: 'Functions are values — pass them, store them, return them' },
            { title: 'Pattern Matching', code: 'factorial 0 = 1\nfactorial n = n * factorial (n - 1)', desc: 'Handle different cases elegantly' },
            { title: 'Higher-Order Functions', code: 'map (\\x -> x * x) [1, 2, 3, 4, 5]', desc: 'Pass functions as arguments' }
        ]
    },
    {
        key: 'symbolic',
        name: 'Symbolic Math',
        icon: '\u222B',
        color: '#f0c674',
        desc: 'Ada Lovelace\'s mathematical notation',
        lessons: [
            { title: 'Let Bindings', code: 'let x = 2 + 3\nlet y = x * 4\nlet result = y - 1', desc: 'Define values step by step, like algebra' },
            { title: 'First-Class Variables', code: 'let double = \\x -> x * 2\nlet apply = \\f x -> f(x)\nlet result = apply(double, 5)', desc: 'A variable holds a function — Ada did this in 1843' },
            { title: 'Expressions', code: 'let area = 3.14159 * r * r\nlet circumference = 2 * 3.14159 * r', desc: 'Write mathematical formulas' },
            { title: 'Bernoulli Numbers', code: 'let b0 = 1\nlet b1 = -1/2\nlet b2 = 1/6', desc: 'Ada\'s original computation from Note G' }
        ]
    },
    {
        key: 'assembly',
        name: 'Assembly \u2014 CLOOMC',
        icon: '\u2699',
        color: '#81a1c1',
        desc: 'Church + Turing: not just values, but functions and capabilities',
        lessons: [
            { title: 'Turing: Load & Store', code: '; === TURING DOMAIN ===\n; Move numbers between registers and memory.\n; This is what ALL processors can do.\n;\nLOAD  R0, #42        ; put the number 42 into R0\nSTORE R0, [R1]       ; write R0 to memory at address R1\nLOAD  R2, [R1]       ; read it back into R2\n;\n; R0, R1, R2 hold VALUES — plain numbers.\n; They cannot hold functions or permissions.', desc: 'Basic Turing: move numbers — every processor does this' },
            { title: 'Turing: Arithmetic', code: '; === TURING DOMAIN ===\n; Add and multiply numbers in registers.\n;\nLOAD R0, #7\nLOAD R1, #5\nADD  R2, R0, R1      ; R2 = 7 + 5 = 12\nMUL  R3, R2, R0      ; R3 = 12 * 7 = 84\n;\n; This is computation on VALUES.\n; No security. No isolation. No functions.\n; Any program can read any register.', desc: 'Turing adds values — but cannot pass functions or enforce security' },
            { title: 'Church: CALL with GT', code: '; === CHURCH DOMAIN ===\n; CALL does what Turing cannot:\n; it passes a FUNCTION, not a value.\n;\nMINT  R0             ; create a Golden Token (unforgeable key)\nSEAL  R0, R1         ; bind the GT to abstraction at NS index R1\nCALL  R0, #greet     ; invoke method "greet" on that abstraction\n;\n; What just happened:\n;   1. R0 holds a GT — a capability, not a number\n;   2. SEAL locked it to a specific abstraction\n;   3. CALL passed the function body to the processor\n;      through a secure envelope (the lump)\n;\n; The body runs INSIDE the envelope.\n; When it finishes, the envelope closes.\n; No other program can see inside.\n;\n; THIS is first-class: the GT in R0 is a function\n; passed as a value. Ada did this in 1843.', desc: 'CALL passes a function via a Golden Token — this is what makes CLOOMC different' },
            { title: 'Church vs Turing', code: '; === THE DIFFERENCE ===\n;\n; TURING (every processor):\n;   ADD R0, R1, R2     — adds two numbers\n;   R0 is a VALUE (plain 32-bit integer)\n;   Any program can read R0\n;   No isolation, no security\n;\n; CHURCH (only CLOOMC):\n;   CALL R0, #method   — invokes an abstraction\n;   R0 is a GOLDEN TOKEN (unforgeable capability)\n;   Only the holder can invoke it\n;   The function runs in a sealed envelope\n;   No other program can see inside\n;\n; Ada wrote functions that took other functions\n; as arguments. Church formalised it. CLOOMC\n; builds it into the hardware with MINT,\n; SEAL, and CALL.\n;\n; Basic assembly: values only.\n; CLOOMC assembly: values AND functions.', desc: 'Turing moves values. Church passes functions. CLOOMC does both.' },
            { title: 'First-Class Variables', code: '; === FIRST-CLASS VARIABLES ===\n;\n; In Turing, a variable holds a number:\n;   LOAD R0, #5       ; R0 = 5 (a value)\n;\n; In CLOOMC, a variable holds a function:\n;   MINT R0           ; R0 = Golden Token (a capability)\n;   SEAL R0, R1       ; R0 now refers to an abstraction\n;   CALL R0, #run     ; invoke the function R0 points to\n;\n; You can pass R0 to another abstraction:\n;   STORE R0, [R2]    ; give your GT to someone else\n;   ; They can CALL it too — if they have permission\n;\n; This is what "first-class" means:\n; functions are values you can store, pass,\n; and return — just like numbers.', desc: 'A variable can hold a function, not just a number — that is first-class' }
        ]
    },
    {
        key: 'math',
        name: 'Math Tools',
        icon: '\uD83E\uDDEE',
        color: '#8B7355',
        desc: 'HP-35, Abacus, Slide Rule',
        lessons: [
            { title: 'RPN Calculator', code: '', desc: 'Use the HP-35 reverse Polish notation calculator', view: 'repl', tab: 'hp35' },
            { title: 'Soroban Abacus', code: '', desc: 'Learn place value with the Japanese abacus', view: 'repl', tab: 'abacus' },
            { title: 'Slide Rule', code: '', desc: 'Multiply with logarithmic scales', view: 'repl', tab: 'sliderule' }
        ]
    },
    {
        key: 'lambda',
        name: 'Lambda Calculus',
        icon: '\u03BB',
        color: '#81c784',
        desc: 'The foundation of computing — pure functions from 1936',
        lessons: [
            { title: 'Church Numerals', code: '-- LAMBDA CALCULUS\n-- Church numerals: numbers as functions\n\nzero = \u03BBf.\u03BBx.x\none  = \u03BBf.\u03BBx.(f x)\ntwo  = \u03BBf.\u03BBx.(f (f x))\n\nsucc = \u03BBn.\u03BBf.\u03BBx.(f ((n f) x))\nthree = succ two', desc: 'Encode numbers as repeated function application' },
            { title: 'Booleans', code: '-- LAMBDA CALCULUS\n-- Church booleans: true and false as selectors\n\ntrue  = \u03BBa.\u03BBb.a\nfalse = \u03BBa.\u03BBb.b\n\nand = \u03BBp.\u03BBq.((p q) false)\nor  = \u03BBp.\u03BBq.((p true) q)\nnot = \u03BBp.((p false) true)', desc: 'Booleans are functions that select between two arguments' },
            { title: 'Pairs', code: '-- LAMBDA CALCULUS\n-- Church-encoded pairs\n\npair = \u03BBa.\u03BBb.\u03BBf.((f a) b)\nfst  = \u03BBp.(p \u03BBa.\u03BBb.a)\nsnd  = \u03BBp.(p \u03BBa.\u03BBb.b)\n\nlet myPair = ((pair one) two) in\n  (fst myPair)', desc: 'Build data structures from pure functions' },
            { title: 'Recursion (Y Combinator)', code: '-- LAMBDA CALCULUS\n-- The Y combinator: recursion from pure lambda calculus\n\nY = \u03BBf.(\u03BBx.(f (x x)) \u03BBx.(f (x x)))\n\nfactorial = Y \u03BBself.\u03BBn.\n  ((iszero n) one (mult n (self (pred n))))', desc: 'Fixed-point combinators enable recursion without named self-reference' }
        ]
    },
    {
        key: 'security',
        name: 'Security',
        icon: '\uD83D\uDD10',
        color: '#C89B3C',
        desc: 'Capability security and Golden Tokens',
        lessons: [
            { title: 'What is a Golden Token?', code: '', desc: 'Unforgeable 32-bit keys that control access', view: 'reference' },
            { title: 'Namespace & Abstractions', code: '', desc: 'How programs are isolated from each other', view: 'abstractions' },
            { title: 'The mLoad Pipeline', code: '', desc: 'How capabilities are checked in hardware', view: 'pipeline' }
        ]
    }
];

function renderSubjects() {
    const el = document.getElementById('subjectsGrid');
    if (!el) return;
    const progress = getStudentProgress();
    const langsUsed = progress.langsUsed || [];

    let html = '';
    for (const subject of SUBJECTS) {
        const used = langsUsed.includes(subject.key);
        const statusClass = used ? ' subject-active' : '';
        html += `<div class="subject-card${statusClass}" onclick="openSubject('${subject.key}')">`;
        html += `<div class="subject-card-icon" style="color:${subject.color}">${subject.icon}</div>`;
        html += `<div class="subject-card-info">`;
        html += `<div class="subject-card-name">${escapeHtml(subject.name)}</div>`;
        html += `<div class="subject-card-desc">${escapeHtml(subject.desc)}</div>`;
        if (used) {
            html += `<div class="subject-card-status">Started</div>`;
        }
        html += `</div>`;
        html += `</div>`;
    }
    el.innerHTML = html;
}

function openSubject(key) {
    const subject = SUBJECTS.find(s => s.key === key);
    if (!subject) return;

    const el = document.getElementById('subjectsGrid');
    if (!el) return;

    let html = `<button class="btn subject-back-btn" onclick="renderSubjects()">&larr; Back to Subjects</button>`;
    html += `<div class="subject-lesson-header">`;
    html += `<span class="subject-lesson-icon" style="color:${subject.color}">${subject.icon}</span>`;
    html += `<span class="subject-lesson-title">${escapeHtml(subject.name)}</span>`;
    html += `</div>`;

    for (const lesson of subject.lessons) {
        html += `<div class="subject-lesson-card" onclick="startLesson('${subject.key}', '${escapeHtml(lesson.title)}')">`;
        html += `<div class="subject-lesson-name">${escapeHtml(lesson.title)}</div>`;
        html += `<div class="subject-lesson-desc">${escapeHtml(lesson.desc)}</div>`;
        html += `</div>`;
    }
    el.innerHTML = html;
}

function startLesson(subjectKey, lessonTitle) {
    const subject = SUBJECTS.find(s => s.key === subjectKey);
    if (!subject) return;
    const lesson = subject.lessons.find(l => l.title === lessonTitle);
    if (!lesson) return;

    closeSettings();

    if (lesson.view) {
        switchView(lesson.view);
        if (lesson.tab) {
            setTimeout(() => {
                const tabBtn = document.querySelector(`.math-tab[data-tab="${lesson.tab}"]`);
                if (tabBtn) tabBtn.click();
            }, 100);
        }
        return;
    }

    switchView('editor');
    const langMap = { english: 'english', javascript: 'javascript', haskell: 'haskell', symbolic: 'symbolic', lambda: 'lambda', assembly: 'assembly' };
    const sel = document.getElementById('langSelector');
    if (sel && langMap[subjectKey]) {
        sel.value = langMap[subjectKey];
        onLangChange(false);
    }
    if (lesson.code) {
        const editor = document.getElementById('asmEditor');
        if (editor) {
            editor.value = lesson.code;
        }
    }
    appendOutput(`Lesson: ${lessonTitle} \u2014 ${lesson.desc}`, 'info');
}

function getSelectedSubjects() {
    const checkboxes = document.querySelectorAll('input[name="subjectCheckbox"]');
    const selected = [];
    checkboxes.forEach(cb => {
        if (cb.checked) selected.push(cb.dataset.subject);
    });
    return selected;
}

function renderProgressReport() {
    renderSubjects();
}

function getGradeLabel(grade) {
    if (!grade) return '';
    const validGrades = { 'K': 'Kindergarten', '1': 'Grade 1', '2': 'Grade 2', '3': 'Grade 3', '4': 'Grade 4', '5': 'Grade 5', '6': 'Grade 6', '7': 'Grade 7', '8': 'Grade 8', '9': 'Grade 9', '10': 'Grade 10', '11': 'Grade 11', '12': 'Grade 12', 'IB': 'IB Programme' };
    return validGrades[grade] || escapeHtml(grade);
}

function getGradeTier(grade) {
    if (!grade) return 'default';
    if (grade === 'K' || grade === '1' || grade === '2') return 'early';
    if (grade === '3' || grade === '4' || grade === '5') return 'elementary';
    if (grade === '6' || grade === '7' || grade === '8') return 'middle';
    if (grade === '9' || grade === '10') return 'high';
    if (grade === '11' || grade === '12') return 'advanced';
    if (grade === 'IB') return 'ib';
    return 'default';
}

function getGradeAdaptedIntro(lang) {
    const settings = getStudentSettings();
    const tier = getGradeTier(settings.grade);
    const name = settings.name || '';
    const greeting = name ? `Hi ${escapeHtml(name)}! ` : '';

    const base = langIntros[lang];
    if (!base || tier === 'default') return base;

    const gradeTag = settings.grade ? `<span class="grade-indicator">${getGradeLabel(settings.grade)}</span>` : '';

    const adapted = { title: base.title + gradeTag };

    if (lang === 'symbolic') {
        if (tier === 'early') {
            adapted.body = `
                <p>${greeting}You are about to see <span class="intro-highlight">the first computer program ever written!</span></p>
                <p>A very clever woman named <span class="intro-highlight">Ada Lovelace</span> wrote it a long, long time ago -- in 1843!
                That is over 180 years ago! She wrote instructions for a special machine that could do math.</p>
                <p>Her instructions look like this:</p>
                <div class="intro-example">let V1 = 1
let V2 = 2
let V4 = V2 * V3    -- multiply!</div>
                <p>Each <span class="intro-highlight">V</span> is like a box that holds a number.
                V1 holds the number 1, V2 holds 2, and so on. You tell the machine what to do with the numbers!</p>
            `;
        } else if (tier === 'elementary') {
            adapted.body = `
                <p>${greeting}<span class="intro-highlight">The first computer program ever written</span> is right here.</p>
                <p>In 1843, <span class="intro-highlight">Ada Lovelace</span> wrote a program for a machine called
                the Analytical Engine. The machine was never built, but her program was real. It calculated
                a special number called B7 -- the seventh Bernoulli number.</p>
                <p>Ada used variables like storage boxes:</p>
                <div class="intro-example">let V1 = 1
let V2 = 2
let V4 = V2 * V3    -- multiply V2 by V3
let V11 = V4 / V5   -- divide V4 by V5</div>
                <p>Each <span class="intro-highlight">V-variable</span> holds a number.
                You write one math operation per line. The Church Machine can actually run Ada's program today!</p>
            `;
        } else if (tier === 'middle') {
            adapted.body = `
                <p>${greeting}This is <span class="intro-highlight">the first computer program in history</span> --
                written by Ada Lovelace in 1843 for Charles Babbage's Analytical Engine.</p>
                <p>Her program computes B7, the seventh Bernoulli number, using a sequence of 25 operations.
                The notation maps directly to hardware: each V-variable is a register, each line is an instruction.</p>
                <div class="intro-example">let V1 = 1
let V2 = 2
let V4 = V2 * V3    -- Operation 1: 2n
let V11 = V4 / V5   -- Operation 4: ratio</div>
                <p>Multiply and divide compile to loops of addition and subtraction --
                the same way early computers actually worked.</p>
            `;
        } else if (tier === 'high') {
            adapted.body = `
                <p>${greeting}${base.body}`;
        } else if (tier === 'advanced' || tier === 'ib') {
            adapted.body = `
                <p>${greeting}You are examining <span class="intro-highlight">Note G</span> from Ada Lovelace's 1843 translation
                of Menabrea's paper on the Analytical Engine. This is the first published algorithm --
                a computation of the seventh Bernoulli number B7 = -1/30.</p>
                <p>The notation mirrors Ada's original: V-variables map to store columns (here, data registers DR1-DR15).
                Operation 4 uses the correction identified by Bromley (1990) -- Ada's original had V5/V4 instead of V4/V5.</p>
                <div class="intro-example">let V4 = V2 * V3    -- IADD loop: DR4 += DR2, counter DR3
let V11 = V4 / V5   -- ISUB loop: quotient++, remainder -= divisor</div>
                <p>Multiplication compiles to shift-and-add loops; division to repeated subtraction.
                The compiler allocates temporary registers dynamically to avoid clobbering.
                ${tier === 'ib' ? 'This connects to the IB Computer Science core -- abstraction, algorithms, and machine architecture as a unified system.' : ''}</p>
            `;
        }
    } else if (lang === 'assembly') {
        if (tier === 'early') {
            adapted.body = `
                <p>${greeting}This is <span class="intro-highlight">assembly language</span> -- the simplest instructions
                a computer understands!</p>
                <p>Each line tells the Church Machine to do one tiny thing -- like adding two numbers
                or checking if something is allowed.</p>
                <div class="intro-example">IADD DR0, DR1, DR2   ; add two numbers
MCMP DR0, DR1        ; compare them</div>
                <p>There are <span class="intro-highlight">20 instructions</span> the machine knows.
                Some do math, and some check security permissions -- like asking a parent for permission!</p>
            `;
        } else if (tier === 'elementary' || tier === 'middle') {
            adapted.body = `
                <p>${greeting}${base.body}`;
        } else if (tier === 'advanced' || tier === 'ib') {
            adapted.body = `
                <p>${greeting}Assembly provides direct access to the Church Machine's 20-instruction dual-domain ISA.
                The <span class="intro-highlight">Church domain</span> (LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, XLOADLAMBDA)
                enforces capability-based security through Golden Tokens.
                The <span class="intro-highlight">Turing domain</span> (DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR)
                handles computation.</p>
                <div class="intro-example">LOAD CR0, CR6, 4    ; capability load from c-list
TPERM CR0, XL       ; permission check (execute + load)
CALL CR0, 0xF       ; direct mode — CR0 is the E-GT</div>
                <p>ARM-style condition codes on every instruction. The F-bit auto-set on Outform GTs prevents
                the confused deputy problem.${tier === 'ib' ? ' This maps directly to IB CS topics: machine architecture, instruction sets, and security models.' : ''}</p>
            `;
        }
    } else if (lang === 'javascript') {
        if (tier === 'early' || tier === 'elementary') {
            adapted.body = `
                <p>${greeting}This is <span class="intro-highlight">CLOOMC++</span> -- a language that looks a lot
                like regular programming! You write code with curly braces and the Church Machine runs it.</p>
                <div class="intro-example">abstraction Hello {
    capabilities { }
    method Greet(who) {
        result = who + 1
        return(result)
    }
}</div>
                <p>An <span class="intro-highlight">abstraction</span> is like a little program with its own rules.
                Methods are the things it can do -- like greeting someone!</p>
            `;
        } else if (tier === 'advanced' || tier === 'ib') {
            adapted.body = `
                <p>${greeting}${base.body}
                <p>The CLOOMC++ compiler proves the Church Machine is a universal target -- the same 20-instruction ISA
                accepts programs from JavaScript, Haskell, and Symbolic Math front-ends. Variables map to DR0-DR15,
                multiply/divide compile to IADD/ISUB loops.${tier === 'ib' ? ' Relevant to IB CS: compilers, abstraction layers, and universal computation.' : ''}</p>
            `;
        } else {
            adapted.body = `<p>${greeting}${base.body}`;
        }
    } else if (lang === 'haskell') {
        if (tier === 'early' || tier === 'elementary') {
            adapted.body = `
                <p>${greeting}This is <span class="intro-highlight">Haskell</span> -- a language based on math!
                Instead of telling the computer what to do step by step, you describe what things are.</p>
                <div class="intro-example">method add(a, b) = a + b
method isZero(n) = if n == 0 then 1 else 0</div>
                <p>It looks like math equations! The Church Machine turns these into the same instructions
                as the other languages.</p>
            `;
        } else if (tier === 'advanced' || tier === 'ib') {
            adapted.body = `
                <p>${greeting}The Haskell front-end demonstrates that lambda calculus compiles to the Church Machine's
                20-instruction set -- pattern matching becomes MCMP+BRANCH chains, pairs use BFINS/BFEXT packing,
                and let-bindings map to register allocation.</p>
                <div class="intro-example">method factorial(n) = case n of 0 -> 1, _ -> n * (n - 1)
method swap(p) = (snd p, fst p)</div>
                <p>Named after Alonzo Church, this front-end connects his lambda calculus to silicon.${tier === 'ib' ? ' This relates to IB CS abstract data structures, recursion, and computational thinking.' : ''}</p>
            `;
        } else {
            adapted.body = `<p>${greeting}${base.body}`;
        }
    }

    if (!adapted.body) adapted.body = `<p>${greeting}${base.body}`;
    return adapted;
}

function confirmSaveToNamespace() {
    const slotSel = document.getElementById('saveNSSlot');
    const label = document.getElementById('saveNSLabel').value.trim();
    if (!label) {
        alert('Please enter a label for this namespace entry.');
        return;
    }
    const perms = {
        R: document.getElementById('permR').checked ? 1 : 0,
        W: document.getElementById('permW').checked ? 1 : 0,
        X: document.getElementById('permX').checked ? 1 : 0,
        L: document.getElementById('permL').checked ? 1 : 0,
        S: document.getElementById('permS').checked ? 1 : 0,
        E: document.getElementById('permE').checked ? 1 : 0,
    };
    const gtType = parseInt(document.getElementById('saveNSType').value) || 0;
    let idx;
    if (slotSel.value === 'new') {
        idx = sim.saveToNamespace(label, lastAssembledWords, perms, gtType);
    } else {
        idx = parseInt(slotSel.value);
        sim.saveToNamespaceAt(idx, label, lastAssembledWords, perms, gtType);
    }
    closeSaveDialog();
    saveNamespaceState();
    const con = document.getElementById('editorConsole');
    if (con) {
        con.textContent += `\nSaved ${lastAssembledWords.length} words to namespace[${idx}] "${label}" (${lastAssembledWords.length * 4} bytes)`;
        con.scrollTop = con.scrollHeight;
    }
    updateDashboard();
}

function exportEntryMemory(idx) {
    const data = sim.getEntryMemory(idx);
    if (!data) return;
    const entry = sim.readNSEntry(idx);
    const hexWords = data.words.map(w => '0x' + (w >>> 0).toString(16).padStart(8, '0'));
    let permObj = {};
    if (data.gt) {
        const sp = sim.parseGT(data.gt).permissions;
        permObj = { B: sp.B?1:0, R: sp.R?1:0, W: sp.W?1:0, X: sp.X?1:0, L: sp.L?1:0, S: sp.S?1:0, E: sp.E?1:0 };
    }
    const typeNames = ['NULL','Inform','Outform','Abstract'];
    const exportObj = {
        label: data.label,
        index: idx,
        location: '0x' + data.location.toString(16).toUpperCase().padStart(8, '0'),
        gt: '0x' + (data.gt >>> 0).toString(16).toUpperCase().padStart(8, '0'),
        gtType: typeNames[entry ? entry.gtType : 0] || 'NULL',
        codeLength: data.codeLength,
        permissions: permObj,
        code: hexWords,
        entry: entry,
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.label || 'entry_' + idx}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function exportAllNamespace() {
    const entries = [];
    for (let i = 0; i < sim.nsCount; i++) {
        const e = sim.readNSEntry(i);
        if (!e) continue;
        const mem = sim.getEntryMemory(i);
        const hexWords = mem ? mem.words.map(w => '0x' + (w >>> 0).toString(16).padStart(8, '0')) : [];
        entries.push({
            index: i,
            label: e.label,
            gt: mem ? '0x' + (mem.gt >>> 0).toString(16).padStart(8, '0') : '0x00000000',
            codeLength: mem ? mem.codeLength : 0,
            code: hexWords,
            entry: e,
        });
    }
    const blob = new Blob([JSON.stringify({ namespace: entries }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'church_namespace.json';
    a.click();
    URL.revokeObjectURL(url);
}

function downloadNamespaceLump() {
    fetch('/api/namespace-lump.json')
        .then(r => {
            if (!r.ok) return r.json().then(d => { throw new Error(d.error || r.statusText); });
            return r.text();
        })
        .then(text => {
            const blob = new Blob([text], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = 'namespace-lump.json';
            a.click();
            URL.revokeObjectURL(url);
        })
        .catch(err => {
            alert('Download Namespace JSON failed: ' + err.message);
        });
}

let importTargetIdx = null;

function importEntryMemory(idx) {
    importTargetIdx = idx;
    document.getElementById('nsImportFile').click();
}

function importNamespaceFile() {
    importTargetIdx = null;
    document.getElementById('nsImportFile').click();
}

function parseCodeWords(codeArr) {
    if (!Array.isArray(codeArr)) return [];
    return codeArr.map(w => {
        if (typeof w === 'string') return parseInt(w, 16) >>> 0;
        return w >>> 0;
    });
}

function handleNSImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (importTargetIdx !== null) {
                const words = parseCodeWords(data.code || data.words || []);
                if (words.length > 0) {
                    sim.setEntryMemory(importTargetIdx, words);
                    if (data.label) {
                        sim.nsLabels[importTargetIdx] = data.label;
                    }
                }
                importTargetIdx = null;
            } else if (data.namespace && Array.isArray(data.namespace)) {
                for (const item of data.namespace) {
                    const words = parseCodeWords(item.code || item.words || []);
                    if (words.length > 0) {
                        const idx = item.index !== undefined ? item.index : sim.nsCount;
                        const loc = idx * sim.SLOT_SIZE;
                        const lim17 = Math.min(words.length - 1, 0x1FFFF);
                        const gtType = (item.entry && item.entry.gtType != null) ? item.entry.gtType : 1;
                        const chainable = (item.entry && item.entry.chainable) ? 1 : 0;
                        sim.writeNSEntry(idx, loc, lim17, 0, 0, chainable, gtType, 0);
                        sim.nsLabels[idx] = item.label || (item.entry && item.entry.label) || `import_${idx}`;
                        for (let j = 0; j < words.length; j++) {
                            sim.memory[loc + j] = words[j] >>> 0;
                        }
                    }
                }
            } else if (data.label) {
                const words = parseCodeWords(data.code || data.words || []);
                const idx = sim.nsCount;
                const loc = idx * sim.SLOT_SIZE;
                const lim17 = Math.min(Math.max(words.length - 1, 0), 0x1FFFF);
                const gtType = (data.entry && data.entry.gtType != null) ? data.entry.gtType : 1;
                const chainable = (data.entry && data.entry.chainable) ? 1 : 0;
                sim.writeNSEntry(idx, loc, lim17, 0, 0, chainable, gtType, 0);
                sim.nsLabels[idx] = data.label;
                for (let j = 0; j < words.length; j++) {
                    sim.memory[loc + j] = words[j] >>> 0;
                }
            }
            saveNamespaceState();
            updateDashboard();
            updateNamespace();
        } catch (err) {
            alert('Failed to import: ' + err.message);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function saveNamespaceState() {
    const entries = [];
    for (let i = 0; i < sim.nsCount; i++) {
        const e = sim.readNSEntry(i);
        if (!e) { entries.push(null); continue; }
        const mem = sim.getEntryMemory(i);
        const base = sim.NS_TABLE_BASE + i * sim.NS_ENTRY_WORDS;
        entries.push({
            nsWords: [sim.memory[base], sim.memory[base + 1], sim.memory[base + 2]],
            label: e.label,
            dataWords: mem ? [mem.gt, ...mem.words] : [],
        });
    }
    localStorage.setItem('church_namespace', JSON.stringify(entries));
}

function loadNamespaceState() {
    const saved = localStorage.getItem('church_namespace');
    if (!saved) return;
    try {
        const entries = JSON.parse(saved);
        for (let i = 0; i < entries.length; i++) {
            const item = entries[i];
            if (!item) continue;
            if (sim.isNSEntryValid(i)) continue;
            if (item.nsWords && item.nsWords.length === 3) {
                const base = sim.NS_TABLE_BASE + i * sim.NS_ENTRY_WORDS;
                sim.memory[base + 0] = item.nsWords[0] >>> 0;
                sim.memory[base + 1] = item.nsWords[1] >>> 0;
                sim.memory[base + 2] = item.nsWords[2] >>> 0;
                if (i >= sim.nsCount) sim.nsCount = i + 1;
                if (item.label) sim.nsLabels[i] = item.label;
                if (item.dataWords && item.dataWords.length > 0) {
                    const loc = item.nsWords[0] >>> 0;
                    for (let j = 0; j < item.dataWords.length; j++) {
                        sim.memory[loc + j] = item.dataWords[j] >>> 0;
                    }
                }
            } else if (item.entry) {
                const loc = item.entry.word0_location || (i * sim.SLOT_SIZE);
                const lim = sim.parseNSWord1(item.entry.word1_limit || 0);
                const restoredGtType = (item.entry.gtType === 3)
                    ? (console.warn(`[NS restore] slot ${i}: gtType=3 (Abstract) is not valid in NS table; treating as Inform (1)`), 1)
                    : (item.entry.gtType != null ? item.entry.gtType : 1);
                sim.writeNSEntry(i, loc, lim.limit, lim.b, item.entry.gBit || 0, item.entry.chainable ? 1 : 0, restoredGtType, 0);
                sim.nsLabels[i] = item.entry.label || '';
                if (item.words && item.words.length > 0) {
                    for (let j = 0; j < item.words.length; j++) {
                        sim.memory[loc + j] = item.words[j] >>> 0;
                    }
                }
            }
        }
    } catch (e) {}
}

function downloadHardwareImage() {
    if (!requirePermission('deploy', 'Deploy to Tang')) return;
    const image = sim.exportHardwareImage();
    const NS_WORDS = 192;
    const CLIST_WORDS = 64;
    const totalWords = NS_WORDS + CLIST_WORDS;

    const buffer = new ArrayBuffer(4 + totalWords * 4);
    const view = new DataView(buffer);

    view.setUint32(0, totalWords, true);

    for (let i = 0; i < NS_WORDS; i++) {
        const w = i < image.namespace.length ? image.namespace[i] : 0;
        view.setUint32(4 + i * 4, w >>> 0, true);
    }

    for (let i = 0; i < CLIST_WORDS; i++) {
        const w = i < image.clist.length ? image.clist[i] : 0;
        view.setUint32(4 + (NS_WORDS + i) * 4, w >>> 0, true);
    }

    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'church_image.bin';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const con = document.getElementById('editorConsole');
    if (con) {
        con.textContent = `Downloaded church_image.bin (${4 + totalWords * 4} bytes)\n`;
        con.textContent += `  Namespace: ${image.namespace.length} words\n`;
        con.textContent += `  C-list: ${image.clist.length} words\n\n`;
        con.textContent += `To upload to ${getBoardLabel(getSelectedBoard())}, use the Deploy to FPGA button or WebSerial.\n`;
    }
}

async function buildFPGAOnly() {
    if (!requirePermission('deploy', 'Deploy to Tang')) return;
    const board = getSelectedBoard();
    const boardLabel = getBoardLabel(board);
    const isTi60 = (board === 'ti60-f225');

    const hwBtn = document.getElementById('btnHWBuild');
    const dlBtn = document.getElementById('btnFPGAPkg');
    if (hwBtn) { hwBtn.disabled = true; hwBtn.innerHTML = '<span class="spinner"></span> Building...'; }
    if (dlBtn) dlBtn.disabled = true;

    switchView('builder');
    switchBuilderViewTab('buildlog');

    const ts = new Date().toLocaleTimeString();
    _buildLogSet(`[${ts}] Building FPGA RTL for ${boardLabel}...\nRunning Amaranth elaboration + Yosys synthesis (may take up to 5 min).\n`);
    _setBuildStatus('running', `Building ${boardLabel}…`, boardLabel);
    document.getElementById('buildFileList').innerHTML = '<div class="build-file-empty">Building…</div>';
    document.getElementById('buildNextSteps').innerHTML = '<div class="build-file-empty">Waiting for build…</div>';

    try {
        const resp = await fetch(`/api/build/fpga?board=${encodeURIComponent(board)}`);
        const data = await resp.json();
        if (!resp.ok || data.error) {
            const msg = data.error || `Server returned ${resp.status}`;
            _buildLogAppend('\nFailed: ' + msg + (data.stderr ? '\n\n--- stderr ---\n' + data.stderr : '') + '\n');
            _setBuildStatus('error', 'Build failed — see log', boardLabel);
            return;
        }
        const doneTs = new Date().toLocaleTimeString();
        _buildLogAppend(`\n[${doneTs}] Build complete. Files saved on server:\n`);
        (data.file_paths || data.files || []).forEach(f => { _buildLogAppend(`  ✓ ${f}\n`); });
        if (data.warning) {
            _buildLogAppend(`\n⚠ ${data.warning}\nThe RTLIL file is included — run Yosys locally for full synthesis.\n`);
            _setBuildStatus('ok', `Build partial — ${boardLabel} (RTLIL only)`, boardLabel);
        } else {
            _setBuildStatus('ok', `Build succeeded — ${boardLabel}`, boardLabel);
        }
        _buildLogAppend('\nClick "Download FPGA Package" to download the ZIP.\n');
        _renderBuildFiles(data.files || [], isTi60, board);
        _renderBuildNextSteps(isTi60, board);
        if (dlBtn) dlBtn.disabled = false;
    } catch (e) {
        _buildLogAppend('\nError: ' + e.message + '\n');
        _setBuildStatus('error', 'Build error — see log', boardLabel);
    } finally {
        if (hwBtn) { hwBtn.disabled = false; hwBtn.textContent = 'Build'; }
    }
}

async function downloadFPGAPackage() {
    if (!requirePermission('deploy', 'Deploy to Tang')) return;
    const board = getSelectedBoard();
    const boardLabel = getBoardLabel(board);
    const isTi60 = (board === 'ti60-f225');
    const zipName = isTi60 ? 'church-ti60-package.zip'
        : board === 'wukong-xc7a100t' ? 'church-wukong-package.zip'
        : 'church-nano-package.zip';

    const btn = document.getElementById('btnFPGAPkg');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Downloading...'; }

    switchView('builder');
    switchBuilderViewTab('buildlog');
    const ts = new Date().toLocaleTimeString();
    _buildLogAppend(`\n[${ts}] Downloading FPGA package for ${boardLabel}...\n`);

    try {
        const resp = await fetch(`/api/download/fpga-zip?board=${encodeURIComponent(board)}`);
        if (!resp.ok) {
            let errMsg = `Server returned ${resp.status}`;
            try {
                const errData = await resp.json();
                errMsg = errData.error || errMsg;
            } catch (_) {}
            _buildLogAppend('\nFailed: ' + errMsg + '\n');
            if (errMsg.includes('No build found')) {
                _buildLogAppend('Run "Build" first to synthesise the RTL.\n');
            }
            return;
        }
        const buildWarnings = resp.headers.get('X-Build-Warnings');
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        const doneTs = new Date().toLocaleTimeString();
        _buildLogAppend(`[${doneTs}] Downloaded ${zipName} (${(blob.size / 1024).toFixed(0)} KB)\n`);
        if (buildWarnings) {
            const msgs = buildWarnings.split(' | ');
            _buildLogAppend('\n⚠  BUILD WARNINGS:\n');
            msgs.forEach(m => _buildLogAppend(`   • ${m}\n`));
            _buildLogAppend('\n');
            _setBuildStatus('warn', `Downloaded with warnings — ${boardLabel}`, boardLabel);
        }
        _buildLogAppend('\nPackage contents:\n');
        if (isTi60) {
            _buildLogAppend('  church_ti60_f225.xml      — Efinity project file (open this in Efinity IDE)\n');
            _buildLogAppend('  church_ti60_f225.v        — Synthesisable Verilog\n');
            _buildLogAppend('  church_ti60_f225.sdc      — Timing constraints\n');
            _buildLogAppend('  church_ti60_f225.peri.xml — Periphery I/O configuration\n');
            _buildLogAppend('  setup_ti60_peri.py        — DesignAPI script to add PLL (run once)\n');
            _buildLogAppend('  ti60_f225.isf             — Pin constraints (Efinity IDE)\n');
            _buildLogAppend('  BUILD.md                  — Instructions\n');
            _buildLogAppend('\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '  NEXT STEPS — Ti60 F225\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '  1. Unzip the downloaded file\n' +
                '  2. Open the project in Efinity IDE\n' +
                '  3. Run synthesis + place-and-route in Efinity\n' +
                '  4. Flash via Efinity Programmer (JTAG)\n' +
                '  5. Watch LEDs — walking pattern confirms boot OK\n' +
                '\n' +
                '  See BUILD.md inside the zip for full details.\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        } else if (board === 'wukong-xc7a100t') {
            _buildLogAppend('  church_wukong_xc7a100t.il  — Amaranth RTLIL (authoritative)\n');
            _buildLogAppend('  church_wukong_xc7a100t.v   — Synthesisable Verilog (Yosys from RTLIL)\n');
            _buildLogAppend('  wukong_xc7a100t.xdc        — Vivado XDC pin constraints\n');
            _buildLogAppend('  wukong_xc7a100t.tcl        — Vivado project creation + build script\n');
            _buildLogAppend('  local_bridge.py            — Serial bridge server (used by bridge.sh)\n');
            _buildLogAppend('  BUILD.md                   — Instructions\n');
            _buildLogAppend('\n' +
                '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n' +
                '  NEXT STEPS \u2014 QMTECH Wukong Artix-7 XC7A100T\n' +
                '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n' +
                '  Requires Vivado 2020.x or later (Xilinx / AMD).\n' +
                '\n' +
                '    cd ~/Downloads\n' +
                '    unzip church-wukong-package.zip\n' +
                '    cd church-wukong-package\n' +
                '\n' +
                '  In the Vivado Tcl Console:\n' +
                '\n' +
                '    cd /path/to/church-wukong-package\n' +
                '    source wukong_xc7a100t.tcl\n' +
                '\n' +
                '  The script creates vivado_wukong/, runs synthesis +\n' +
                '  implementation, and writes church_wukong_xc7a100t.bit.\n' +
                '\n' +
                '  Tools \u2192 Hardware Manager \u2192 Open Target \u2192 Program Device\n' +
                '  Select church_wukong_xc7a100t.bit and click Program.\n' +
                '\n' +
                '  See BUILD.md inside the zip for full details.\n' +
                '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n');
        } else {
            _buildLogAppend('  church_tang_nano_20k.il   — Amaranth RTLIL (authoritative)\n');
            _buildLogAppend('  church_tang_nano_20k.v    — Synthesisable Verilog (when Yosys synthesis succeeded)\n');
            _buildLogAppend('  church_tang_nano_20k.json — Yosys netlist (when Yosys synthesis succeeded)\n');
            _buildLogAppend('  tang_nano_20k.cst         — Pin constraints\n');
            _buildLogAppend('  Makefile                  — Build targets\n');
            _buildLogAppend('  flash.sh                  — One-command build + flash\n');
            _buildLogAppend('  bridge.sh                 — Connect board to IDE\n');
            _buildLogAppend('  local_bridge.py           — Serial bridge server (used by bridge.sh)\n');
            _buildLogAppend('  BUILD.md                  — Instructions\n');
            _buildLogAppend('\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '  NEXT STEPS — Tang Nano 20K\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '  Open a terminal and run these commands:\n' +
                '\n' +
                '    cd ~/Downloads\n' +
                '    unzip church-nano-package.zip\n' +
                '    cd church-nano-package\n' +
                '    chmod +x flash.sh bridge.sh\n' +
                '    ./flash.sh\n' +
                '\n' +
                '  flash.sh does everything: nextpnr, gowin_pack, and\n' +
                '  openFPGALoader — just plug in your Tang Nano 20K via USB.\n' +
                '\n' +
                '  After flashing, connect the board to this IDE:\n' +
                '\n' +
                '    ./bridge.sh --ide=https://cloomc.org\n' +
                '\n' +
                '  LEDs: 3-LED chase pattern = boot OK.\n' +
                '  See BUILD.md inside the zip for troubleshooting.\n' +
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        }
    } catch (e) {
        _buildLogAppend('\nError: ' + e.message + '\n');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Download FPGA Package'; }
    }
}

// ── Turing DR Test pre-flash simulation gate ─────────────────────────────────
// Assembles and runs the led_control (Section 2: Turing DR Test) in a fresh, headless
// ChurchSimulator instance.  Returns { passed, steps, error? }.
// A 'fail' breakpoint is set so the run terminates immediately on any assertion
// failure rather than spinning in the infinite fail loop.  If the breakpoint is
// never hit within MAX_GATE_STEPS the test is considered passing.
// The fresh sim runs independently of the IDE's live simulator state.
function runTuringSimGate() {
    const BOOT_ABSTR_NS_SLOT = 3;   // Boot.Abstr — see simulator.js constant
    const MAX_GATE_STEPS     = 50000;

    if (typeof ChurchSimulator === 'undefined') {
        return { passed: false, error: 'ChurchSimulator not loaded' };
    }
    if (typeof ChurchAssembler === 'undefined') {
        return { passed: false, error: 'ChurchAssembler not loaded' };
    }

    const testSim = new ChurchSimulator();
    testSim.reset();

    // Boot the fresh simulator
    let bootIterations = 0;
    while (!testSim.bootComplete && !testSim.halted && bootIterations < 200) {
        testSim._bootStep();
        bootIterations++;
    }
    if (!testSim.bootComplete) {
        return { passed: false, error: 'Simulation gate: boot did not complete' };
    }

    // Assemble the Turing DR Test
    const testAssembler = new ChurchAssembler({});
    const asmResult = testAssembler.assemble(_TURING_DR_TEST_SOURCE);
    if (asmResult.errors && asmResult.errors.length > 0) {
        return { passed: false, error: 'Turing DR Test assembly failed: ' + asmResult.errors.join('; ') };
    }

    // Load the assembled program into the fresh simulator (resets pc, faultLog, etc.)
    testSim.loadProgram(asmResult.words, 0);

    // ── Expand limit17 and relocate the DEMO_CLIST ────────────────────────────
    // After loadProgram, limit17=63 (Boot.Abstr lump is only 64 words) and the
    // DEMO_CLIST would normally be installed at lumpBase+46..63 — directly over-
    // writing program words at pc=45‥62, causing a NULL_CAP fault on the first
    // BRANCHNE at pc=45 and a false "gate pass" (sim crashes before reaching fail).
    //
    // Fix: set limit17 = progWords (863) so CR14 can fetch all instructions, then
    // place the c-list at lumpBase+progWords+1 (well past the last code word).
    // Re-seal the NS entry so mLoad version/seal checks still pass.
    {
        const _nsBase     = testSim.NS_TABLE_BASE + BOOT_ABSTR_NS_SLOT * testSim.NS_ENTRY_WORDS;
        const _lumpBase   = testSim.memory[_nsBase] >>> 0;
        const _progWords  = asmResult.words.length;          // 863
        const _newLimit17 = _progWords;                      // fetchAddr for pc=progWords-1 is lumpBase+progWords = lumpBase+limit17
        const _oldW1f     = testSim.parseNSWord1(testSim.memory[_nsBase + 1]);
        const _oldGtSeq   = (testSim.memory[_nsBase + 2] >>> 25) & 0x7F;

        // Update NS entry word1: new limit17, cc stays 0 (c-list lives elsewhere)
        const _newW1 = testSim.packNSWord1(
            _newLimit17, _oldW1f.b, _oldW1f.g, _oldW1f.chainable, _oldW1f.gtType, 0
        );
        testSim.memory[_nsBase + 1] = _newW1;

        // Reseal NS entry word2 so validateMAC passes with the new limit17
        const _newW2 = testSim.makeVersionSeals(_oldGtSeq, _lumpBase, _newLimit17);
        testSim.memory[_nsBase + 2] = _newW2;

        // Mirror into CR14 (the code-region capability held live in the register file)
        if (testSim.cr[14]) {
            testSim.cr[14].word2 = _newW1;
            testSim.cr[14].word3 = _newW2;
        }

        // Install DEMO_CLIST immediately after the last program word — no overlap
        if (testSim.demoClistGTs && testSim.demoClistGTs.length > 0) {
            const _cc        = testSim.demoClistGTs.length;   // 19 (slot 18 = ChurchHW, Task #1542)
            const _clistBase = _lumpBase + _progWords + 1;    // lumpBase + 864

            for (let i = 0; i < _cc; i++) {
                testSim.memory[_clistBase + i] = testSim.demoClistGTs[i] >>> 0;
            }

            // CR6: E-GT for Boot.Abstr (gt_seq=0 matches NS entry), c-list at _clistBase
            // word2 carries the clistCount (18) so _execLoad can bound-check slot offsets
            const _cr6W1 = testSim.packNSWord1(
                _newLimit17, _oldW1f.b, _oldW1f.g, _oldW1f.chainable, _oldW1f.gtType, _cc
            );
            const _cr6GT = testSim.createGT(0, BOOT_ABSTR_NS_SLOT, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);
            testSim.cr[6] = {
                word0: _cr6GT,
                word1: _clistBase >>> 0,
                word2: _cr6W1    >>> 0,
                word3: _newW2    >>> 0,
                m: 0,
            };
        }
    }

    // Locate the 'fail' label word-offset in the assembled program
    const failOffset = asmResult.labels && asmResult.labels['fail'];
    if (failOffset === undefined || failOffset === null) {
        return { passed: false, error: 'Simulation gate: no "fail" label found in Turing DR Test' };
    }

    // Compute the physical address of 'fail'.
    // _nextPhysicalAddr() returns  entry.word0_location + 1 + pc
    // where entry = readNSEntry(BOOT_ABSTR_NS_SLOT).
    const nsEntry = testSim.readNSEntry(BOOT_ABSTR_NS_SLOT);
    if (!nsEntry) {
        return { passed: false, error: 'Simulation gate: Boot.Abstr NS entry not found' };
    }
    const failPhysAddr = (nsEntry.word0_location + 1 + failOffset) >>> 0;

    // Run with a breakpoint at the 'fail' label
    const breakpoints  = new Set([failPhysAddr]);
    const runResult    = testSim.run(MAX_GATE_STEPS, breakpoints);

    if (runResult.stopReason === 'breakpoint' && runResult.breakpointAddr === failPhysAddr) {
        return { passed: false, steps: runResult.steps,
                 error: 'Turing DR Test hit the FAIL path at step ' + runResult.steps };
    }
    if (testSim.faultLog && testSim.faultLog.length > 0) {
        const faultTypes = testSim.faultLog.map(f => f.type).join(', ');
        return { passed: false, steps: runResult.steps,
                 error: 'Fault(s) during simulation gate: ' + faultTypes };
    }
    return { passed: true, steps: runResult.steps };
}

async function uploadToTang() {
    if (!requirePermission('deploy', 'Deploy to Tang')) return;
    switchView('editor');
    switchCodeTab('console');
    const con = document.getElementById('editorConsole');
    if (!con) return;

    const board = getSelectedBoard();
    const boardLabel = getBoardLabel(board);
    const isTi60Board = board === 'ti60-f225';

    if (typeof TangSerial === 'undefined') {
        con.textContent = 'Error: WebSerial module not loaded (webserial.js missing)';
        return;
    }

    // Ti60 note: the firmware has no UART RX upload handler.
    // The namespace is baked into the bitstream at synthesis time.
    // UART TX (H14) sends the startup banner; the board is programmed via Efinity JTAG.
    if (isTi60Board) {
        con.textContent =
            'Ti60 F225 — UART namespace upload is not yet supported in firmware.\n\n' +
            'The namespace is baked into the bitstream at build time.\n' +
            'Use Efinity IDE to program the board via JTAG after building the package.\n\n' +
            'HOW TO CONFIRM YOUR BOARD IS RUNNING:\n' +
            '  LEDs after JTAG flash + power-on:\n' +
            '    Boot in progress  →  LED0 on (steady)\n' +
            '    Boot complete     →  LED0→1→2→3→off walking pattern (0.5 s each)\n' +
            '    CPU in free-run   →  LED1 has 1 Hz heartbeat blink\n' +
            '    Fault             →  LED2 stays on\n\n' +
            '  UART TX (pin H14, 115200 8N1) sends  CHURCH Ti60 v1.0  on startup.\n' +
            '  (Requires an external USB-UART adapter — the Ti60 FT4232H is JTAG-only.)\n\n' +
            'WORKFLOW:\n' +
            '  1. Build FPGA Package  →  downloads the Efinity project zip\n' +
            '  2. Open zip in Efinity IDE  →  synthesise + place-and-route\n' +
            '  3. Programme via Efinity Programmer (JTAG)\n' +
            '  4. Watch LEDs — walking pattern confirms successful boot\n';
        return;
    }

    // ── Pre-flash simulation gate ─────────────────────────────────────────────
    // Run the Turing DR Test in a headless simulator before touching hardware.
    // Any assertion failure blocks the flash and surfaces a clear error.
    con.textContent = 'Pre-flash check: running Turing DR Test in simulation…\n';
    await new Promise(r => setTimeout(r, 0));   // let the UI render the status line
    const _gateResult = runTuringSimGate();
    if (!_gateResult.passed) {
        con.textContent  = '✗ SIMULATION GATE FAILED — flash blocked.\n\n';
        con.textContent += (_gateResult.error || 'Turing DR Test failed in simulation.') + '\n\n';
        con.textContent += 'Fix the regression in the assembly before flashing to hardware.\n';
        if (_gateResult.steps !== undefined) {
            con.textContent += '(simulation ran ' + _gateResult.steps + ' steps)\n';
        }
        return;
    }
    con.textContent  = '✓ Simulation gate passed';
    if (_gateResult.steps !== undefined) {
        con.textContent += ' (' + _gateResult.steps + ' steps)';
    }
    con.textContent += '. Proceeding with flash…\n\n';

    if (board === 'tang-nano-20k-iot' && typeof checkUploadProfile === 'function') {
        const fullNames = [];
        if (typeof BOOT_UPLOADS !== 'undefined') {
            for (const u of BOOT_UPLOADS) {
                const check = checkUploadProfile(u, board);
                if (!check.allowed) fullNames.push(u.abstraction);
            }
        }
        if (abstractionRegistry) {
            const allAbs = abstractionRegistry.getAllAbstractions();
            for (const abs of allAbs) {
                const profile = _getAbstractionProfile(abs);
                if (profile === 'Full') {
                    if (!fullNames.includes(abs.name)) fullNames.push(abs.name);
                }
            }
        }
        if (fullNames.length > 0) {
            con.textContent += `ERROR: ${fullNames.length} abstraction(s) tagged "Full" cannot run on the Tang Nano 20K (IoT profile): ${fullNames.join(', ')}\n\n`;
            con.textContent += 'Full-only opcodes (LAMBDA, CHANGE, SWITCH, ELOADCALL, XLOADLAMBDA) are not available on the Tang Nano 20K.\n';
            con.textContent += 'Switch to Ti60 F225 or remove Full-only instructions from these abstractions.\n';
            return;
        }
    }

    TangSerial.setBoardLabel(boardLabel);

    if (!TangSerial.isSupported()) {
        con.textContent = `WebSerial is not supported in this browser.\nUse Chrome or Edge to deploy to ${boardLabel}.`;
        return;
    }

    function isPermissionsPolicyError(e) {
        const m = (e.message || '').toLowerCase();
        return m.includes('permissions policy') || m.includes('disallowed') || e.name === 'SecurityError';
    }

    function directUrl() {
        return window.location.origin + '/simulator/';
    }

    try {
        const image = sim.exportHardwareImage();
        con.textContent = `Ready: ${image.namespace.length} NS words + ${image.clist.length} C-list words\n\n`;

        if (!TangSerial.isConnected()) {
            con.textContent += 'Select the FPGA UART port when prompted...\n';
            con.textContent += `(Choose the ${boardLabel} serial port)\n\n`;
            try {
                await TangSerial.connect();
            } catch(e) {
                if (e.name === 'NotFoundError') {
                    con.textContent += 'No port selected. Cancelled.\n';
                    return;
                }
                if (isPermissionsPolicyError(e)) {
                    con.textContent = 'WebSerial blocked: the app is running inside an embedded preview frame\n';
                    con.textContent += 'that does not allow hardware access.\n\n';
                    con.textContent += 'SOLUTION: Open the app directly in a browser tab:\n\n';
                    con.textContent += '  ' + directUrl() + '\n\n';
                    con.textContent += `Then click "Deploy to FPGA" from that tab. Chrome or Edge required.\n`;
                    return;
                }
                con.textContent += e.message + '\n\n';
                con.textContent += `Check that the ${boardLabel} is connected via USB and no other app (e.g. Efinity IDE serial terminal) has the port open, then try again.\n`;
                return;
            }
        }

        con.textContent += 'Port connected. Sending data...\n';

        const result = await TangSerial.uploadToFPGA(
            image.namespace,
            image.clist,
            function(msg) {
                con.textContent += msg + '\n';
            }
        );

        if (result.success) {
            con.textContent += '\nUpload complete. Decoding FPGA readback...\n';
            const rb = TangSerial.parseReadback(result.rawBytes);
            const hex = w => '0x' + w.toString(16).toUpperCase().padStart(8, '0');
            const dec = w => w.toString(10).padStart(10, ' ');

            con.textContent += '─'.repeat(56) + '\n';

            if (rb.headerEcho !== null) {
                const ok = rb.headerEcho === 256 ? ' ✓' : ' ✗ (expected 256)';
                con.textContent += `  Header echo: ${rb.headerEcho} words${ok}\n`;
            }

            if (rb.words.length < 2) {
                con.textContent += `  ${rb.vals.length} value bytes (${rb.words.length} complete words) — too short for register decode.\n`;
                con.textContent += `  Raw values: ${rb.vals.slice(0, 64).map(b => b.toString(16).padStart(2,'0')).join(' ')}\n`;
            } else {
                if (rb.crs.length > 0) {
                    con.textContent += '\n  Context Registers:\n';
                    for (let i = 0; i < rb.crs.length; i++) {
                        const priv = i >= 12 ? ' [priv]' : '';
                        const label = ('CR' + i).padEnd(4);
                        con.textContent += `    ${label}  ${hex(rb.crs[i])}  ${dec(rb.crs[i])}${priv}\n`;
                    }
                }
                if (rb.drs.length > 0) {
                    con.textContent += '\n  Data Registers:\n';
                    for (let i = 0; i < rb.drs.length; i++) {
                        const label = ('DR' + i).padEnd(4);
                        con.textContent += `    ${label}  ${hex(rb.drs[i])}  ${dec(rb.drs[i])}\n`;
                    }
                }
                if (rb.extra.length > 0) {
                    con.textContent += `\n  Additional words: ${rb.extra.length}`;
                    con.textContent += ` (${rb.vals.length} value bytes total, ${rb.leftover} leftover)\n`;
                }
            }

            con.textContent += '─'.repeat(56) + '\n';

            sim.ledBits = 0b111111;
            sim.ledMode = 'boot';
            sim.bootComplete = true;
            updateLedStrip();

        } else {
            con.textContent += '\nNo response from FPGA after sending data.\n\n';
            con.textContent += 'TIPS:\n';
            con.textContent += `  1. Press the RESET button on the ${boardLabel}\n`;
            con.textContent += '  2. Click "Deploy to FPGA" within 1-2 seconds of releasing reset\n';
            con.textContent += '  3. Make sure no other app has the serial port open\n';
        }

        try {
            await TangSerial.disconnect();
            con.textContent += 'Port closed.\n';
        } catch(e) {}

    } catch(e) {
        con.textContent += 'Error: ' + e.message + '\n';
        try { await TangSerial.disconnect(); } catch(_) {}
    }
}

async function testUART() {
    // Show output in the Build Details panel (visible in the Builder view)
    switchView('builder');
    switchBuilderViewTab('buildlog');

    const board = getSelectedBoard ? getSelectedBoard() : 'wukong-xc7a100t';
    const boardLabel = getBoardLabel ? getBoardLabel(board) : 'FPGA';

    function log(text) { _buildLogAppend(text); }
    function logSet(text) { _buildLogSet(text); }

    function isPermissionsPolicyError(e) {
        const m = (e.message || '').toLowerCase();
        return m.includes('permissions policy') || m.includes('disallowed') || e.name === 'SecurityError';
    }

    if (!TangSerial.isSupported()) {
        _setBuildStatus('error', 'WebSerial not supported', boardLabel);
        logSet(
            'WebSerial is not supported in this browser.\n' +
            'Use Chrome or Edge (desktop) to test the UART connection.\n\n' +
            'If you are inside the Replit preview pane, open the app in a\n' +
            'separate browser tab first:\n\n  ' + window.location.origin + '/simulator/\n'
        );
        return;
    }

    // ── Step 1: Open port ────────────────────────────────────────────────────
    _setBuildStatus('running', 'Testing UART…', boardLabel);
    logSet('UART CONNECTION TEST\n' + '─'.repeat(40) + '\n\n');
    log('Step 1/3  Open serial port...\n');
    log(`(Select the ${boardLabel} USB-UART port in the browser dialog)\n\n`);

    TangSerial.setBoardLabel(boardLabel);

    if (!TangSerial.isConnected()) {
        try {
            await TangSerial.connect();
        } catch(e) {
            if (e.name === 'NotFoundError') {
                log('Cancelled — no port selected.\n');
                _setBuildStatus('error', 'Cancelled', boardLabel);
                return;
            }
            if (isPermissionsPolicyError(e)) {
                log(
                    'WebSerial blocked: running inside an embedded preview frame.\n\n' +
                    'Open the app directly in a tab:\n  ' +
                    window.location.origin + '/simulator/\n' +
                    'Then run Test UART from there.\n'
                );
                _setBuildStatus('error', 'WebSerial blocked', boardLabel);
                return;
            }
            log(
                'Could not open port: ' + e.message + '\n\n' +
                'Check:\n' +
                '  • FPGA is plugged in via USB\n' +
                '  • Efinity IDE serial terminal (or any serial monitor) is closed\n' +
                '  • Wait 5 s then try again\n'
            );
            _setBuildStatus('error', 'Port open failed', boardLabel);
            return;
        }
    }

    log('✓  Port opened at 115200 8-N-1\n\n');

    // ── Step 2: Send probe ───────────────────────────────────────────────────
    log('Step 2/3  Sending 4-byte probe (0xCEFACEFA)...\n');
    let result;
    try {
        result = await TangSerial.pingFPGA(function(msg) {
            log('          ' + msg + '\n');
        });
    } catch(e) {
        log('Error during probe: ' + e.message + '\n');
        _setBuildStatus('error', 'Probe error', boardLabel);
        return;
    }

    // ── Step 3: Report ───────────────────────────────────────────────────────
    log('\nStep 3/3  Result\n' + '─'.repeat(40) + '\n');
    log(`  Bytes sent:      ${result.bytesSent}\n`);
    log(`  Bytes received:  ${result.bytesReceived}\n`);

    if (result.bytesReceived > 0) {
        const hex = result.rawBytes.map(b => b.toString(16).padStart(2,'0')).join(' ');
        log(`  RX data:         ${hex}\n`);
    }

    log('\n');

    if (result.bytesReceived > 0) {
        log(
            '✓  TX and RX both work — the UART link is alive.\n' +
            '   (The probe bytes may look like garbage if the FPGA\n' +
            '    firmware does not recognise the 0xCEFACEFA sequence;\n' +
            '    any reply at all means the serial path is good.)\n'
        );
        _setBuildStatus('ok', 'UART OK — TX + RX alive', boardLabel);
    } else {
        log(
            '⚠  No bytes received within 1.5 s.\n\n' +
            'Possible causes:\n' +
            '  • FPGA firmware is not running (try pressing reset)\n' +
            '  • UART RX is connected but UART TX is not wired back\n' +
            '  • Baud mismatch (firmware expects a different rate)\n' +
            '  • Wrong port selected (try a different COM/tty entry)\n\n' +
            'TX path is confirmed OK — the port opened and bytes were sent.\n'
        );
        _setBuildStatus('error', 'UART TX ok — no RX response', boardLabel);
    }
}

const INSTRUCTION_DATA = [
    {
        opcode: 0, mnemonic: 'LOAD', domain: 'church',
        mState: 'up', mStateNote: 'Sets CRd.M=1 when loading via a NULL-perm GT during M-elevation (CR12/CR15 boot path). No M change on normal post-boot LOADs.',
        syntax: 'LOAD CRd, CRs, offset',
        brief: 'Load a Golden Token from a C-List into a context register',
        encoding: 'opcode[5]=00000 | cond[4] | CRd[4] | CRs[4] | offset[15]',
        fields: [
            { name: 'CRd',    desc: 'Destination context register (CR0-CR15)' },
            { name: 'CRs',    desc: 'C-List — the capability list to read from (word-addressed)' },
            { name: 'offset', desc: 'Word address offset within the C-List (0–32767)' },
        ],
        permission: 'L (Load) — checked by mLoad on the GT at CRs + offset',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │00000 │ cond │  CRd │  CRs │      offset       │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit       15-bit\n\n'
          + 'CRs is the C-List (capability list), word-addressed.\n'
          + 'offset is the word address within the C-List.\n'
          + 'mLoad fetches the GT at CRs + offset, validates version\n'
          + 'and seal, then copies it into CRd.',
        example: 'LOAD CR0, CR6, 7    ; Load word 7 of C-List CR6 into CR0',
        mState: { badge: 'M↑', note: 'CR15 / CR12 only: M=1 set when loaded GT has all-NULL perms (boot init path). LOAD into CR15 or CR12 with non-NULL perms during M-elevation → fault. All other destination CRs: M-neutral.' },
    },
    {
        opcode: 1, mnemonic: 'SAVE', domain: 'church',
        mState: null, mStateNote: null,
        syntax: 'SAVE CRd, CRs, offset',
        brief: 'Save a Golden Token into a C-List (capability list)',
        encoding: 'opcode[5]=00001 | cond[4] | CRd[4] | CRs[4] | offset[15]',
        fields: [
            { name: 'CRd',    desc: 'C-List — the capability list to save into (S permission required, word-addressed)' },
            { name: 'CRs',    desc: 'Source GT (must have B=1 — Bind bit set)' },
            { name: 'offset', desc: 'Word address within the C-List at CRd (0–32767)' },
        ],
        permission: 'S on CRd (C-List); B=1 on CRs (source GT) — mSave validates all',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │00001 │ cond │  CRd │  CRs │      offset       │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit       15-bit\n\n'
          + 'CRd    = the C-List (capability list), word-addressed.\n'
          + 'CRs    = the source GT to save (B=1 — Bind bit — must be set).\n'
          + 'offset = word address within the C-List at CRd.\n\n'
          + 'mSave writes the GT from CRs into the C-List at CRd + offset.\n'
          + 'mSave validates: S permission on CRd, B=1 on CRs, version, seal,\n'
          + 'and bounds. B=1 is the delegation gate: a callee cannot propagate\n'
          + 'GTs it was only passed for use.',
        example: 'SAVE CR6, CR1, 20   ; Save CR1 (B=1) into word 20 of C-List CR6',
        mState: { badge: null, note: 'M-neutral — no effect on any CR M-bit.' },
    },
    {
        opcode: 2, mnemonic: 'CALL', domain: 'church',
        mState: 'up', mStateNote: 'At CALL boundary: _mwinWriteback() gates and clears CR15.M; _resetAllMBits() zeroes all CRs; then CR6.M=1 and CR14.M=1 are set explicitly (both produced by M-elevated mLoad). Net: M↑ on CR6+CR14 after the boundary reset.',
        syntax: 'CALL CRs, offset',
        brief: 'Enter an abstraction — fetch E-GT via C-List or directly from CRs, set up CR6/CR14, push context',
        encoding: 'opcode[5]=00010 | cond[4] | CRs[4] | offset[4] | 0[15]',
        fields: [
            { name: 'CRs',    desc: 'Source: C-List (L permission — mLoad fetches E-GT at CRs[offset]) or direct E-GT (E permission — offset must be 0xF)' },
            { name: 'offset', desc: '4-bit index into the C-List (0–14, C-List mode). All-1s (0xF = 15) selects direct mode: CRs itself is the E-GT.' },
        ],
        permission: 'L on CRs (C-List mode) or E on CRs (direct mode, offset=0xF)',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │00010 │ cond │  CRs │offset│         0         │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit  4-bit       15-bit\n\n'
          + 'CRs field identifies the source register (always a caller-specified CRn).\n'
          + 'CRd is implicit and always CR6 — CALL hardcodes CR6 as the callee c-list output.\n\n'
          + 'C-List mode (offset 0–14, L on CRs):\n'
          + '  mLoad fetches the E-GT stored at CRs[offset] from the C-List.\n\n'
          + 'Direct mode (offset = 0xF = all-1s, E on CRs):\n'
          + '  CRs itself is the E-GT — no C-List lookup. offset = 0xF is the sentinel.\n\n'
          + 'Each abstraction occupies one shared GT (one slot). The slot layout is:\n'
          + '  [ code | · · · free space · · · | c-list ]\n'
          + '    ↑ base                          ↑ limit\n\n'
          + 'Code starts at the slot base address; the C-List is packed at the top\n'
          + '(limit). mLoad reads the same slot metadata to derive both registers:\n'
          + '  CR14 (code):   base = slot base address, limit = code size  [privileged]\n'
          + '  CR6  (c-list): base = slot limit − GTcount  [implicit CRd, always CR6]\n\n'
          + 'CALL pushes exactly 2 words onto the LIFO stack (region of thread lump addressed by CR12 + STO):\n'
          + '  Word 0: caller\'s E-GT — RETURN revalidates it to re-derive CR6 and CR14.\n'
          + '  Word 1: frame word — 32-bit packed word:\n'
          + '    31  28 │ 27      13 │ 12  │ 11       0\n'
          + '    ┌──────┬───────────┬─────┬────────────┐\n'
          + '    │FLAGS │  PC[14:0] │ SZ  │  STO[11:0] │\n'
          + '    └──────┴───────────┴─────┴────────────┘\n'
          + '    FLAGS: N Z C V condition codes at call site.\n'
          + '    PC:    15-bit return address (offset into caller\'s code, 0–32767).\n'
          + '    SZ:    1 = 2-word CALL frame (distinguishes from 1-word LAMBDA frame).\n'
          + '    STO:   saved stack-top-offset hidden register (0–4095 words from stack base).\n\n'
          + 'Hidden register STO is updated to (savedSTO + 2) after the push.\n'
          + 'No DRs and no capability registers are pushed; callee inherits them.\n'
          + 'B bit is cleared on every passed GT (hardware "use it, don\'t keep it").\n'
          + 'PC is set to 0. RETURN (with a MASK literal) is the only exit.',
        example: 'CALL CR6, 3          ; C-List mode: fetch E-GT at offset 3 from C-List in CR6\n'
               + 'CALL CR2, 0xF        ; Direct mode: CR2 is the E-GT (offset=0xF sentinel)',
        mState: { badge: 'M↓', note: 'Hardware clears M on all CRs at the dispatch boundary. CR6 M=1 is set transiently for the callee\'s duration (microcode L-perm gate). CR14 is created with RX, M=0. B bit is cleared on all passed GTs.' },
    },
    {
        opcode: 3, mnemonic: 'RETURN', domain: 'church',
        mState: 'down', mStateNote: 'At RETURN boundary: _mwinWriteback() commits and clears the M-window on CR15; _resetAllMBits() zeroes all CRs; caller CRs are then restored from the saved frame snapshot (which carried their pre-CALL M=0 state).',
        syntax: 'RETURN [mask]',
        brief: 'Exit an abstraction \u2014 restore caller context; optionally scrub working CRs',
        encoding: 'opcode[5]=00011 | cond[4] | 0[11] | mask[12]',
        fields: [
            { name: 'mask', desc: '12-bit literal (bits [11:0]). Bit N = 1 clears CR_N to NULL after frame restoration. Bit 6 reserved (must be 0 — CR6 is always restored from the frame E-GT). mask=0 is the no-op default (bare RETURN).' },
        ],
        permission: 'None',
        flags: 'None',
        details:
            '  31    27│26   23│22          12│11          0\n'
          + '  ┌──────┬──────┬─────────────┬─────────────┐\n'
          + '  │00011 │ cond │      0      │    mask     │\n'
          + '  └──────┴──────┴─────────────┴─────────────┘\n'
          + '   5-bit   4-bit    11-bit        12-bit\n\n'
          + 'mask[11:0]: 12-bit literal embedded in the instruction.\n'
          + '  Bit N = 1 → clear CR_N to NULL after frame restoration.\n'
          + '  Bit 6 reserved (must be 0): CR6 is always restored from the frame E-GT.\n'
          + '  mask = 0 → no clearing; bare RETURN is fully backward-compatible.\n\n'
          + 'Execution order:\n'
          + '  1. Read frame word at top of LIFO stack; check SZ bit.\n'
          + '     SZ=1 (CALL frame): pop 2 words (E-GT word 0 + frame word 1).\n'
          + '     SZ=0 (LAMBDA frame): pop 1 word (frame word only).\n'
          + '  2. Restore FLAGS, PC, and STO from the frame word fields.\n'
          + '     Hidden STO register ← frame[11:0] (the saved pre-call STO value).\n'
          + '  3. SZ=1 only: revalidate caller E-GT (word 0) via mLoad — FAULT on failure.\n'
          + '     NS split re-runs to re-derive CR6 (c-list) and CR14 (code) for caller.\n'
          + '  4. Apply mask: all marked CRs written to NULL in one parallel clock edge.\n'
          + '     The 12-bit literal fans directly into CR write enables — zero overhead.\n\n'
          + 'Why mask is in the instruction (not the frame):\n'
          + '  GTs are first-class. The callee may return a GT in CR0.\n'
          + '  Only the programmer knows which CRs carry return values vs. working state.\n'
          + '  The CLOOMC compiler emits the mask as a compile-time literal from a\n'
          + '  "clear:" annotation. The hardware enforces it as part of the instruction.\n'
          + '  The freed 12 bits in the frame word are used for STO instead.\n\n'
          + 'DRs and non-masked CRs retain whatever values the callee left.\n'
          + 'Shared between Church and Turing domains — the only exit from a safe\n'
          + 'Turing abstraction. If the call stack is empty, the machine halts.',
        example: 'RETURN                   ; mask=0 — no scrub, backward-compatible\n'
               + 'RETURN 0b111111011111    ; clear CR0–CR5, CR7–CR11 — scrub all working regs\n'
               + 'RETURN 0b000000011110    ; clear CR1–CR4 only — CR0 carries a return GT',
        mState: { badge: 'M↓', note: 'Hardware clears all CR M-bits at function exit. CHANGE (not RETURN) is the mechanism that saves and restores M-bits across context switches.' },
    },
    {
        opcode: 4, mnemonic: 'CHANGE', domain: 'church',
        mState: 'swap', mStateNote: 'CR14/CR15 context-switch path: saves outgoing thread state (including all CR .M fields) into its context record; restores incoming thread state (including CR .M fields). M-bits are fully preserved across a CHANGE context switch.',
        syntax: 'CHANGE CRd, CRs[idx]',
        brief: 'Privileged register write \u2014 install a GT from CRs[idx] into privileged CR12\u2013CR15; CR14/CR15 also trigger a full per-thread context switch',
        encoding: 'opcode[5]=00100 | cond[4] | 1[1] | 1[1] | Tgt[2] | CRs[4] | idx[15]',
        fields: [
            { name: 'Tgt', desc: '2-bit privileged target: 0=CR12 (thread stack, system-wide), 1=CR13 (interrupt, system-wide), 2=CR14 (code register, per-thread context switch), 3=CR15 (namespace root, per-thread context switch). Bits 22:21 are fixed 11 — indicating the privileged register bank. Bits 20:19 = Tgt.' },
            { name: 'CRs', desc: 'Source capability register providing the GT to install. At boot, CR12 itself may be used as source to initialise the thread stack slot from the boot namespace.' },
            { name: 'idx', desc: 'NS slot index within CRs \u2014 identifies the GT or Thread Abstraction to install' },
        ],
        permission: 'Bits 22:21 must be 11 (Tgt field 0\u20133 = CR12\u2013CR15); hardware faults if CRd < 12',
        flags: 'None',
        details:
            '  31    27│26   23│22 21│20 19│18   15│14                0\n'
          + '  ┌──────┬──────┬────┬────┬──────┬───────────────────┐\n'
          + '  │00100 │ cond │ 11 │Tgt │  CRs │       idx         │\n'
          + '  └──────┴──────┴────┴────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   2    2    4-bit       15-bit\n\n'
          + 'Bits 22:21 = 11 (fixed — marks the privileged-register bank).\n'
          + 'Tgt [bits 20:19] = 2-bit privileged-register selector:\n'
          + '    0 = CR12  thread stack         — system-wide\n'
          + '    1 = CR13  interrupt handler   — system-wide\n'
          + '    2 = CR14  code register       — per-thread context switch\n'
          + '    3 = CR15  namespace root      — per-thread context switch\n'
          + 'CRs = source capability providing the GT to install.\n'
          + 'idx = NS slot index within CRs.\n\n'
          + 'Execution semantics by destination:\n\n'
          + '  CR12 / CR13 (system-wide): load the GT from CRs[idx] into CRd.\n'
          + '    No per-thread save/restore occurs. CR12 and CR13 are unchanged\n'
          + '    by any context switch.\n\n'
          + '  CR14 / CR15 (per-thread context switch, atomic):\n'
          + '    1. Save outgoing thread state into its context record:\n'
          + '         CR0\u2013CR11, CR14, CR15, DR0\u2013DR15, STO, PC, flags.\n'
          + '         CR12/CR13 are system-wide \u2014 NOT saved or restored.\n'
          + '    2a. If the incoming thread has a saved context: restore it\n'
          + '         (CR0\u2013CR11, CR14, CR15, DRs, STO, PC, flags) and resume.\n'
          + '    2b. First activation: install GT from CRs[idx] into CRd\n'
          + '         and begin execution from PC=0.\n'
          + '  The suspended thread resumes exactly where it left off.',
        example: 'CHANGE CR12, CR12, 1 ; B:02 INIT_THRD: load thread stack GT from slot 1\n'
               + 'CHANGE CR14, CR6, 3  ; Context switch: activate Thread Abstraction at CR6[3]',
        mState: { badge: 'M±', note: 'Saves outgoing thread M-bits (per CR) into the context record; restores incoming thread M-bits on resumption. M-state is transparent to CHANGE — it does not add, remove, or inspect M-bits.' },
    },
    {
        opcode: 5, mnemonic: 'SWITCH', domain: 'church',
        mState: 'up', mStateNote: 'Copies the source Abstract PassKey CR (including its .M field) into the target (CR13 or CR15) via an M-elevated mLoad. The HDL sets sub_m_elevated=1 (switch.py:71), causing the mLoad to set M=1 on the target CR.',
        syntax: 'SWITCH CRs, imm',
        brief: 'Switch namespace \u2014 reload CR15 with a new namespace root',
        encoding: 'opcode[5]=00101 | cond[4] | 0[4] | CRs[4] | idx[15]',
        fields: [
            { name: 'CRs', desc: 'GT pointing to the new namespace to switch to' },
            { name: 'imm', desc: 'Namespace control flags' },
        ],
        permission: 'CRs must point to a valid namespace',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │00101 │ cond │  ─   │  CRs │      flags        │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit  zero   4-bit       15-bit\n\n'
          + 'CRs   = GT pointing to the new namespace root.\n'
          + 'dst field is zero (unused).\n'
          + 'flags = namespace control flags (imm15).\n\n'
          + 'Atomically reloads CR15 (the namespace root register) with the new\n'
          + 'namespace. CR15 is the machine\'s view of the entire capability world —\n'
          + 'all LOADs, SAVEs, and CALLs resolve through it. The switch is the\n'
          + 'mechanism for domain isolation, sandboxing, and controlled transitions.',
        example: 'SWITCH CR3, 0        ; Switch namespace root (CR15) to namespace in CR3',
        mState: { badge: null, note: 'M-neutral — no effect on any CR M-bit.' },
    },
    {
        opcode: 6, mnemonic: 'TPERM', domain: 'church',
        mState: 'fault', mStateNote: 'Architecture spec: fault immediately if the target CR has M=1 (M-window open, GT actively in use — programming error to attenuate). NOTE: this check is not yet implemented in the simulator (_execTperm) or the Amaranth HDL (tperm.py) — see isa-m-state-documentation.md DISCREPANCY #2.',
        syntax: 'TPERM CRs, preset [, offset]  |  TPERM CRd, preset',
        brief: 'Two forms, one opcode: health-check (sets Z flag) or permission restriction (monotonic).',
        encoding: 'opcode[5]=00110 | cond[4] | reg[4] | preset[4] | offset[15]',
        fields: [
            { name: 'reg',    desc: 'CRs for health-check; CRd for restriction' },
            { name: 'preset', desc: '4-bit permission code (see table below)' },
            { name: 'offset', desc: 'Health-check: base+offset tested against limit (0\u201332766 valid). Restriction: 0x7FFF (all ones \u2014 sentinel that distinguishes restriction from health-check; never a valid bounds offset)' },
        ],
        permission: 'None \u2014 never traps',
        flags: 'Health-check: Z=1 all pass, Z=0 any fail. Restriction: Z=1 result non-zero.',
        details:
            '┌─ FORM 1: HEALTH CHECK ──────────────────────────────────────────┐\n'
          + '│  Assembly:  TPERM CRs, preset, offset                           │\n'
          + '│                                                                  │\n'
          + '│  31    27│26   23│22   19│18   15│14                0│          │\n'
          + '│  ┌──────┬──────┬──────┬──────┬───────────────────┐  │          │\n'
          + '│  │00110 │ cond │  CRs │preset│      offset       │  │          │\n'
          + '│  └──────┴──────┴──────┴──────┴───────────────────┘  │          │\n'
          + '│   op=6    4-bit   4-bit   4-bit       15-bit          │          │\n'
          + '│                                                                  │\n'
          + '│  Checks in one cycle:                                            │\n'
          + '│    1. Does CRs hold the preset permissions?                      │\n'
          + '│    2. Is the GT valid (version + MAC)?                           │\n'
          + '│    3. Is base + offset within the GT\'s limit?                   │\n'
          + '│  Result: Z=1 all pass  Z=0 any fail  Never traps.               │\n'
          + '└──────────────────────────────────────────────────────────────────┘\n\n'
          + '┌─ FORM 2: PERMISSION RESTRICTION ────────────────────────────────┐\n'
          + '│  Assembly:  TPERM CRd, preset                                   │\n'
          + '│                                                                  │\n'
          + '│  31    27│26   23│22   19│18   15│14                0│          │\n'
          + '│  ┌──────┬──────┬──────┬──────┬───────────────────┐  │          │\n'
          + '│  │00110 │ cond │  CRd │preset│      0x7FFF       │  │          │\n'
          + '│  └──────┴──────┴──────┴──────┴───────────────────┘  │          │\n'
          + '│   op=6    4-bit   4-bit   4-bit   0x7FFF (15-bit)     │          │\n'
          + '│                                                                  │\n'
          + '│  Sentinel: imm15=0x7FFF (all ones) marks restriction mode.      │\n'
          + '│  This frees the full 0\u201332766 range for health-check offsets,     │\n'
          + '│  including offset=0 (test the base address itself).             │\n'
          + '│  ANDs preset mask with CRd\'s current permissions (monotonic).   │\n'
          + '│  Local to the cached CR — not written to namespace until SAVE.  │\n'
          + '│  Z=1 if result is non-zero.                                     │\n'
          + '└──────────────────────────────────────────────────────────────────┘\n\n'
          + '┌─ PRESET TABLE ───────────────────────────────────────────────────┐\n'
          + '│  Turing domain (R,W,X):                                          │\n'
          + '│    0=CLEAR  1=R  2=RW  3=X  4=RX  5=RWX                         │\n'
          + '│  Church domain (L,S,E):                                          │\n'
          + '│    6=L  7=S  8=E  9=LS                                           │\n'
          + '│    10,11,12 = FAULT  (E+L, E+S, E+LS — E must be standalone)    │\n'
          + '│    13      = FAULT  (cross-domain mix)                           │\n'
          + '│  B-modifier (+0x10): RB  RWB  XB  EB  LSB                       │\n'
          + '│                                                                  │\n'
          + '│  Rule 1 — Domain purity: Turing and Church bits never combined.  │\n'
          + '│  Rule 2 — E isolation:   E must be standalone. E+L or E+S lets  │\n'
          + '│           a caller traverse the c-list AND enter the abstraction │\n'
          + '│           — an attack path into the nodal c-list.                │\n'
          + '└──────────────────────────────────────────────────────────────────┘',
        example:
            '; FORM 1 — health check with try-catch\n'
          + 'TPERM CR5, RW, 4       ; check R+W, valid, offset 4 in bounds\n'
          + 'readEQ  val, CR5, 4    ; happy path — fires only if Z=1\n'
          + 'IADDEQ  val, val, 1    ;\n'
          + 'writeEQ CR5, 4, val    ;\n'
          + 'returnEQ(val)          ; done — skipped if Z=0\n'
          + 'MOVNE   DR1, 0         ; catch — fires only if Z=0\n'
          + 'returnNE(DR1)          ; return error\n'
          + '\n'
          + '; FORM 2 — strip write before handing off\n'
          + 'TPERM CR0, RX          ; remove W, L, S, E — keep R and X only\n'
          + 'CALL  CR2              ; callee gets read+execute, nothing else\n'
          + '\n'
          + '; FORM 2 + B-modifier — allow callee to keep the GT\n'
          + 'TPERM CR1, EB          ; keep E, set B (Bind allows SAVE by callee)\n'
          + 'CALL  CR2              ; callee may save CR1 to its own c-list',
        mState: null,
    },
    {
        opcode: 7, mnemonic: 'LAMBDA', domain: 'church',
        mState: null, mStateNote: null,
        syntax: 'LAMBDA CRd | LAMBDA CRd, offset',
        brief: 'In-scope lambda reduction — immediate (CRd holds GT) or store (load from CRd[offset])',
        encoding: 'opcode[5]=00111 | cond[4] | CRd[4] | 0[4] | imm15[15]  (imm15=0x7FFF → immediate; else store)',
        fields: [
            { name: 'CRd', desc: 'Immediate: X-perm GT to apply. Store: C-List source (GT loaded into CRd)' },
            { name: 'imm15', desc: '0x7FFF (all ones) = immediate mode; 0–32766 = store-mode offset into CRd C-List' },
        ],
        permission: 'X (Execute in-scope) on the resolved GT in CRd',
        flags: 'None',
        details:
            'Two forms, same opcode — distinguished by bits[14:0]:\n\n'
          + 'Form 1 — Immediate (bits[14:0] = 0x7FFF, all ones):\n'
          + '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │00111 │ cond │  CRd │  ─   │  111111111111111  │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit  zero  all ones (15-bit 0x7FFF)\n'
          + 'CRd already holds the X-perm GT — use it directly.\n\n'
          + 'Form 2 — Store (bits[14:0] = offset, 0–32766):\n'
          + '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │00111 │ cond │  CRd │  ─   │      offset       │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit  zero       15-bit\n'
          + 'CRd is the C-List; the X GT is fetched from CRd[offset]\n'
          + 'into CRd (self-loading, single-register), then applied.\n'
          + 'Contrast: XLOADLAMBDA uses a separate CRs for the C-List.\n\n'
          + 'Both forms push a minimal 1-word frame (SZ=0) onto the LIFO\n'
          + 'stack (region of thread lump addressed by CR12 + STO):\n'
          + '  31  28 │ 27      13 │ 12  │ 11       0\n'
          + '  ┌──────┬───────────┬─────┬────────────┐\n'
          + '  │FLAGS │  PC[14:0] │  0  │  STO[11:0] │\n'
          + '  └──────┴───────────┴─────┴────────────┘\n'
          + 'SZ=0 tells RETURN this is a LAMBDA frame (1 word, no E-GT).\n'
          + 'Hidden STO is updated to (savedSTO + 1) after the slot reservation.\n'
          + 'RETURN (with its MASK literal) is required to exit the reduction.\n\n'
          + 'Leaf-lambda optimisation: the 1-word frame is NOT written to the\n'
          + 'thread lump stack buffer when LAMBDA executes. The write is deferred\n'
          + 'until a nested CALL or CHANGE occurs within the lambda body (the\n'
          + 'nested push lands at the new STO slot, requiring the prior LAMBDA\n'
          + 'frame to be in place). If RETURN is reached with no intervening CALL\n'
          + 'or CHANGE ("leaf lambda"), the frame word is never committed to\n'
          + 'memory — RETURN restores PC from an in-flight pipeline register and\n'
          + 'pops STO back. Only the STO reservation (STO ← savedSTO + 1) is\n'
          + 'unconditional. A leaf lambda therefore has zero memory traffic to\n'
          + 'the thread lump stack buffer.\n\n'
          + 'Code-fetch authority: PC is set to CRd.base on entry; instruction\n'
          + 'fetch for the lambda body is bounded by CRd.limit. CRd acts as the\n'
          + 'code-fetch authority for the duration of the reduction, analogous\n'
          + 'to CR14 in a CALL frame — but it is NOT derived from an NS-slot\n'
          + 'lookup. On RETURN (SZ=0), CR6 and CR14 are restored from the saved\n'
          + 'register snapshot, not re-derived from an E-GT.\n\n'
          + 'Used for fast-path lambda calculus operations: SUCC, ADD, MUL, etc.',
        example: 'LAMBDA CR0           ; Immediate — apply reduction via CR0\n'
               + 'LAMBDA CR6, 5        ; Store — load X GT from CR6[5] into CR6, then apply',
        mState: { badge: null, note: 'M-neutral — in-scope lambda reduction does not cross a capability domain boundary. No CR M-bit is modified.' },
    },
    {
        opcode: 8, mnemonic: 'ELOADCALL', domain: 'church',
        mState: 'up', mStateNote: 'Fused LOAD+TPERM+CALL. The CALL phase sets CR6.M=1 explicitly (M-elevated mLoad). CR14 carries XR grants from the CALL microcode and does not need M=1. Net: M↑ on CR6 only.',
        syntax: 'ELOADCALL CRd, CRs, offset',
        brief: 'Fused LOAD + TPERM(E) + CALL in one instruction',
        encoding: 'opcode[5]=01000 | cond[4] | CRd[4] | CRs[4] | offset[15]',
        fields: [
            { name: 'CRd',    desc: 'Destination for loaded GT' },
            { name: 'CRs',    desc: 'C-List — the capability list (word-addressed)' },
            { name: 'offset', desc: 'Word address offset within the C-List (0–32767)' },
        ],
        permission: 'mLoad checks L on fetched GT, then E on loaded GT',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │01000 │ cond │  CRd │  CRs │      offset       │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit       15-bit\n\n'
          + 'CRd    = destination for the loaded GT.\n'
          + 'CRs    = the C-List (capability list), word-addressed.\n'
          + 'offset = word address within the C-List.\n\n'
          + 'Fused micro-op sequence in one cycle:\n'
          + '  1. LOAD  — fetch GT at CRs + offset via mLoad\n'
          + '  2. TPERM — verify E permission on the loaded GT\n'
          + '  3. CALL  — enter the abstraction\n'
          + 'Reduces the common 3-instruction entry sequence to a single word.',
        example: 'ELOADCALL CR0, CR6, 12  ; Load word 12 of C-List CR6, verify E, enter',
        mState: { badge: 'M↑', note: 'Fused LOAD+TPERM(E)+CALL. Caller CRs saved to call stack; CR6 written and CR6.M=1 set explicitly. CR14 is written with XR grants from CALL microcode — M bit not set. Net: M↑ on CR6 only for the callee duration.' },
    },
    {
        opcode: 9, mnemonic: 'XLOADLAMBDA', domain: 'church',
        mState: null, mStateNote: null,
        syntax: 'XLOADLAMBDA CRd, CRs, offset',
        brief: 'Fused LOAD + TPERM(X) + LAMBDA in one instruction',
        encoding: 'opcode[5]=01001 | cond[4] | CRd[4] | CRs[4] | offset[15]',
        fields: [
            { name: 'CRd',    desc: 'Destination for loaded GT' },
            { name: 'CRs',    desc: 'C-List — the capability list (word-addressed)' },
            { name: 'offset', desc: 'Word address offset within the C-List (0–32767)' },
        ],
        permission: 'mLoad checks L on fetched GT, then X on loaded GT',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │01001 │ cond │  CRd │  CRs │      offset       │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit       15-bit\n\n'
          + 'CRd    = destination for the loaded GT.\n'
          + 'CRs    = the C-List (capability list), word-addressed.\n'
          + 'offset = word address within the C-List.\n\n'
          + 'Fused micro-op sequence in one cycle:\n'
          + '  1. LOAD   — fetch GT at CRs + offset via mLoad\n'
          + '  2. TPERM  — verify X permission on the loaded GT\n'
          + '  3. LAMBDA — apply the reduction in-scope (no context save)\n'
          + 'After the fused sequence, CRd holds the loaded GT and acts as the\n'
          + 'code-fetch authority: PC ← CRd.base, instruction fetch bounded by\n'
          + 'CRd.limit. CRd is NOT derived from an NS-slot lookup — it comes\n'
          + 'directly from the C-List entry. On RETURN (SZ=0), CR6 and CR14 are\n'
          + 'restored from the saved register snapshot, not re-derived from an\n'
          + 'E-GT.\n\n'
          + 'Contrast with LAMBDA store-mode: LAMBDA store (bits[14:0] ≠ 0x7FFF)\n'
          + 'uses CRd as both the C-List source and GT destination (one register);\n'
          + 'XLOADLAMBDA uses a separate CRs register as the C-List.\n\n'
          + 'Leaf-lambda optimisation: the 1-word frame is NOT written to the\n'
          + 'thread lump stack buffer when the LAMBDA step executes. The write\n'
          + 'is deferred until a nested CALL or CHANGE occurs within the lambda\n'
          + 'body. If RETURN is reached with no intervening CALL or CHANGE\n'
          + '("leaf lambda"), the frame word is never committed to memory —\n'
          + 'RETURN restores PC from an in-flight pipeline register and pops\n'
          + 'STO back. Only the STO reservation (STO ← savedSTO + 1) is\n'
          + 'unconditional. A leaf lambda therefore has zero memory traffic to\n'
          + 'the thread lump stack buffer.\n\n'
          + 'Used for fast-path Church reductions where load + apply is one operation.',
        example: 'XLOADLAMBDA CR0, CR6, 7  ; Load word 7 of C-List CR6, verify X, reduce',
        mState: { badge: null, note: 'M-neutral — fused LOAD+TPERM(X)+LAMBDA is in-scope. No capability domain boundary is crossed; no CR M-bit is modified.' },
    },
    {
        opcode: 10, mnemonic: 'DREAD', domain: 'turing',
        mState: 'pulse', mStateNote: 'Abstract GT dispatch path only: sets CRs.M=1 to open the M-inspection window (_setMWindow), dispatches to the Abstract Manager, then clears CRs.M=0 (_clearMWindow). Net effect on M is zero — transient only. Normal data GTs: no M interaction.',
        syntax: 'DREAD DRd, CRs, imm',
        brief: 'Read a data word from a GT-protected address into a data register',
        encoding: 'opcode[5]=01010 | cond[4] | DRd[4] | CRs[4] | offset[15]',
        fields: [
            { name: 'DRd', desc: 'Destination data register (DR0-DR15)' },
            { name: 'CRs', desc: 'GT pointing to data object (R permission; or CR14 with X permission — code lump exception)' },
            { name: 'imm', desc: 'Word offset within the data object' },
        ],
        permission: 'R on CRs; exception: CR14 accepted with X permission (code lump read-only data)',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │01010 │ cond │  DRd │  CRs │      offset       │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit       15-bit\n\n'
          + 'DRd    = destination data register for the 32-bit result.\n'
          + 'CRs    = GT covering the data object (R permission required).\n'
          + 'offset = word offset within the protected region.\n\n'
          + 'mLoad validates: version, seal, R permission, base+offset within limit.\n'
          + 'Unified address space: works on memory, devices, or device registers.\n\n'
          + 'CR14 exception: DREAD may use CR14 (the privileged code register) as\n'
          + 'CRs with X permission only — R is not required. This preserves the\n'
          + 'DREAD DR, CR14, offset pattern for read-only constants packed after\n'
          + 'HALT in the code lump. Decode fault rule: (CRs>=12) AND NOT (CRs==14).',
        example: 'DREAD DR1, CR2, 0    ; Read word 0 from data object CR2\n'
               + 'DREAD DR1, CR14, 100 ; Read constant at offset 100 in code lump',
        mState: { badge: null, note: 'M-neutral — Turing-domain data read. No effect on any CR M-bit.' },
    },
    {
        opcode: 11, mnemonic: 'DWRITE', domain: 'turing',
        mState: 'pulse', mStateNote: 'Abstract GT dispatch path only: sets CRs.M=1 to open the M-inspection window (_setMWindow), dispatches to the Abstract Manager, then clears CRs.M=0 (_clearMWindow). Net effect on M is zero — transient only. Normal data GTs: no M interaction.',
        syntax: 'DWRITE DRd, CRs, imm',
        brief: 'Write a data register value to a GT-protected address',
        encoding: 'opcode[5]=01011 | cond[4] | DRd[4] | CRs[4] | offset[15]',
        fields: [
            { name: 'DRd', desc: 'Source data register (value to write)' },
            { name: 'CRs', desc: 'GT pointing to data object (W permission required; CR14 is not faulted at decode, but mLoad still enforces W at execution time)' },
            { name: 'imm', desc: 'Word offset within the data object' },
        ],
        permission: 'W on CRs (enforced at execute time by mLoad); CR14 decode-fence exception — not faulted at decode, but W is still required',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │01011 │ cond │  DRd │  CRs │      offset       │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit       15-bit\n\n'
          + 'DRd    = source data register (value to write).\n'
          + 'CRs    = GT covering the data object (must have W permission).\n'
          + 'offset = word offset within the protected region.\n\n'
          + 'mLoad validates: version, seal, W permission, base+offset within limit.\n'
          + 'Works on memory, device registers, or any GT-protected address range.\n\n'
          + 'CR14 decode exception: the privilege-register decode fence does not fault\n'
          + 'on CR14 in the CRs field (same exception as DREAD). mLoad still requires\n'
          + 'W permission at execute time — the carve-out is a decode-fence rule only.\n'
          + 'Decode fault rule: fault = (CRs >= 12) AND NOT (CRs == 14).',
        example: 'DWRITE DR3, CR2, 4   ; Write DR3 to word 4 of data object CR2',
        mState: { badge: null, note: 'M-neutral — Turing-domain data write. No effect on any CR M-bit.' },
    },
    {
        opcode: 12, mnemonic: 'BFEXT', domain: 'turing',
        mState: null, mStateNote: null,
        syntax: 'BFEXT DRd, DRs, pos, width',
        brief: 'Extract a bitfield from a data register',
        encoding: 'opcode[5]=01100 | cond[4] | DRd[4] | DRs[4] | pos[5]<<5 | width[5]',
        fields: [
            { name: 'DRd', desc: 'Destination data register (receives extracted bits, zero-extended)' },
            { name: 'DRs', desc: 'Source data register to extract from' },
            { name: 'pos', desc: 'Bit position to start extraction (0-31)' },
            { name: 'width', desc: 'Number of bits to extract (1-32)' },
        ],
        permission: 'None',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14  10│9    5│4    0\n'
          + '  ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┐\n'
          + '  │01100 │ cond │  DRd │  DRs │  ─   │ pos  │ wid  │\n'
          + '  └──────┴──────┴──────┴──────┴──────┴──────┴──────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit  5-bit  5-bit  5-bit\n\n'
          + 'DRd = destination (extracted bits, right-aligned, zero-extended).\n'
          + 'DRs = source data register (Turing domain only — no capability required).\n'
          + 'imm15 split:  [14:10] = unused (─)  [9:5] = pos  [4:0] = width\n'
          + '  pos   = bit position to start extraction (0–31)\n'
          + '  width = number of bits to extract (1–32)\n\n'
          + 'Extracts bits [pos+width-1:pos] from DRs, right-aligns them,\n'
          + 'and zero-extends into DRd. Pure data-register operation — no\n'
          + 'capability or memory access required.\n'
          + 'Useful for parsing packed integers, pair fields (fst/snd), and\n'
          + 'protocol fields packed into a single 32-bit word.',
        example: 'BFEXT DR1, DR2, 8, 4  ; Extract 4 bits starting at bit 8 of DR2',
        mState: { badge: null, note: 'M-neutral — pure data-register operation. No capability or M-state involvement.' },
    },
    {
        opcode: 13, mnemonic: 'BFINS', domain: 'turing',
        mState: null, mStateNote: null,
        syntax: 'BFINS DRd, DRs, pos, width',
        brief: 'Insert a bitfield from one data register into another',
        encoding: 'opcode[5]=01101 | cond[4] | DRd[4] | DRs[4] | pos[5]<<5 | width[5]',
        fields: [
            { name: 'DRd', desc: 'Destination data register (read-modify-write: receives inserted bits)' },
            { name: 'DRs', desc: 'Source data register (low bits are inserted into DRd)' },
            { name: 'pos', desc: 'Bit position to start insertion (0-31)' },
            { name: 'width', desc: 'Number of bits to insert (1-32)' },
        ],
        permission: 'None',
        flags: 'None',
        details:
            '  31    27│26   23│22   19│18   15│14  10│9    5│4    0\n'
          + '  ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┐\n'
          + '  │01101 │ cond │  DRd │  DRs │  ─   │ pos  │ wid  │\n'
          + '  └──────┴──────┴──────┴──────┴──────┴──────┴──────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit  5-bit  5-bit  5-bit\n\n'
          + 'DRd = destination (read-modify-write: all bits outside [pos+width-1:pos] preserved).\n'
          + 'DRs = source — its low \'width\' bits are inserted at position pos of DRd.\n'
          + 'imm15 split:  [14:10] = unused (─)  [9:5] = pos  [4:0] = width\n'
          + '  pos   = bit position to start insertion (0–31)\n'
          + '  width = number of bits to insert (1–32)\n\n'
          + 'Reads DRd, replaces bits [pos+width-1:pos] with the low \'width\'\n'
          + 'bits of DRs, and writes back to DRd. Pure data-register operation —\n'
          + 'no capability or memory access required.\n'
          + 'Complement of BFEXT. Used to pack two values into one word,\n'
          + 'e.g. pair packing: SHL DRd, fst, 16  then  BFINS DRd, snd, 0, 16.',
        example: 'BFINS DR1, DR2, 8, 4  ; Insert low 4 bits of DR2 into DR1 at bit 8',
        mState: { badge: null, note: 'M-neutral — pure data-register operation. No capability or M-state involvement.' },
    },
    {
        opcode: 14, mnemonic: 'MCMP', domain: 'turing',
        mState: null, mStateNote: null,
        syntax: 'MCMP DRa, DRb',
        brief: 'Compare two data registers and set condition flags',
        encoding: 'opcode[5]=01110 | cond[4] | DRa[4] | DRb[4] | 0[15]',
        fields: [
            { name: 'DRa', desc: 'First data register' },
            { name: 'DRb', desc: 'Second data register' },
        ],
        permission: 'None',
        flags: 'Z (zero/equal), N (negative), C (carry/unsigned \u2265), V (signed overflow)',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │01110 │ cond │  DRa │  DRb │        0          │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit       zero\n\n'
          + 'DRa    = first operand (minuend, in dst field).\n'
          + 'DRb    = second operand (subtrahend, in src field).\n'
          + 'imm15  = 0 (unused).\n\n'
          + 'Computes DRa - DRb internally and sets all four ARM-style flags.\n'
          + 'Result is discarded — no destination register is written.\n\n'
          + 'Z = 1 if DRa == DRb\n'
          + 'N = 1 if result is negative (signed)\n'
          + 'C = 1 if DRa >= DRb (unsigned, no borrow)\n'
          + 'V = 1 if signed overflow',
        example: 'MCMP DR1, DR2        ; Compare DR1 with DR2\nBRANCHEQ equal       ; Branch if DR1 == DR2',
        mState: { badge: null, note: 'M-neutral — pure data-register comparison. No capability or M-state involvement.' },
    },
    {
        opcode: 15, mnemonic: 'IADD', domain: 'turing',
        mState: null, mStateNote: null,
        syntax: 'IADD DRd, DRa, DRb',
        brief: 'Integer addition with flag setting',
        encoding: 'opcode[5]=01111 | cond[4] | DRd[4] | DRa[4] | DRb[4] in imm[3:0]',
        fields: [
            { name: 'DRd', desc: 'Destination data register (result)' },
            { name: 'DRa', desc: 'First source register (in src field)' },
            { name: 'DRb', desc: 'Second source register (in imm bits 0-3)' },
        ],
        permission: 'None',
        flags: 'Z (zero), N (negative), C (unsigned carry), V (signed overflow)',
        details:
            '  31    27│26   23│22   19│18   15│14     4│3     0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────┬──────┐\n'
          + '  │01111 │ cond │  DRd │  DRa │     0     │ DRb  │\n'
          + '  └──────┴──────┴──────┴──────┴───────────┴──────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit   11-bit    4-bit\n\n'
          + 'DRd = destination (result).\n'
          + 'DRa = first source (in src field).\n'
          + 'DRb = second source (in imm15[3:0] — low 4 bits of imm15).\n'
          + 'imm15[14:4] = 0 (unused).\n\n'
          + 'Computes DRd = DRa + DRb as unsigned 32-bit integers.\n'
          + 'DR0 is hardwired to zero: IADD DRd, DR0, DR0 initialises DRd = 0.\n\n'
          + 'Z = 1 if result is zero\n'
          + 'N = 1 if bit 31 of result is set\n'
          + 'C = 1 if carry out (result > 0xFFFFFFFF)\n'
          + 'V = 1 if signed overflow',
        example: 'IADD DR3, DR1, DR2   ; DR3 = DR1 + DR2, set flags',
        mState: { badge: null, note: 'M-neutral — pure data-register arithmetic. No capability or M-state involvement.' },
    },
    {
        opcode: 16, mnemonic: 'ISUB', domain: 'turing',
        mState: null, mStateNote: null,
        syntax: 'ISUB DRd, DRa, DRb',
        brief: 'Integer subtraction with flag setting',
        encoding: 'opcode[5]=10000 | cond[4] | DRd[4] | DRa[4] | DRb[4] in imm[3:0]',
        fields: [
            { name: 'DRd', desc: 'Destination data register (result)' },
            { name: 'DRa', desc: 'First source register (minuend)' },
            { name: 'DRb', desc: 'Second source register (subtrahend, in imm bits 0-3)' },
        ],
        permission: 'None',
        flags: 'Z (zero), N (negative), C (borrow: C=1 if DRa \u2265 DRb), V (signed overflow)',
        details:
            '  31    27│26   23│22   19│18   15│14     4│3     0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────┬──────┐\n'
          + '  │10000 │ cond │  DRd │  DRa │     0     │ DRb  │\n'
          + '  └──────┴──────┴──────┴──────┴───────────┴──────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit   11-bit    4-bit\n\n'
          + 'DRd = destination (result).\n'
          + 'DRa = minuend (in src field).\n'
          + 'DRb = subtrahend (in imm15[3:0] — low 4 bits of imm15).\n'
          + 'imm15[14:4] = 0 (unused).\n\n'
          + 'Computes DRd = DRa - DRb as unsigned 32-bit integers.\n'
          + 'ISUB DRd, DR0, DRx computes two\'s complement negation (0 - DRx).\n\n'
          + 'Z = 1 if result is zero\n'
          + 'N = 1 if bit 31 of result is set\n'
          + 'C = 1 if no borrow (DRa >= DRb unsigned — ARM convention)\n'
          + 'V = 1 if signed overflow',
        example: 'ISUB DR4, DR3, DR1   ; DR4 = DR3 - DR1, set flags',
        mState: { badge: null, note: 'M-neutral — pure data-register arithmetic. No capability or M-state involvement.' },
    },
    {
        opcode: 17, mnemonic: 'BRANCH', domain: 'turing',
        mState: null, mStateNote: null,
        syntax: 'BRANCH[cond] offset',
        brief: 'Conditional branch with signed PC-relative offset \u2014 use for error catch after a conditional instruction',
        encoding: 'opcode[5]=10001 | cond[4] | 0[4] | 0[4] | signed_offset[15]',
        fields: [
            { name: 'offset', desc: 'Signed 15-bit PC-relative offset (-16384 to +16383)' },
        ],
        permission: 'None',
        flags: 'None (reads flags, does not set them)',
        details:
            '  31    27│26   23│22   19│18   15│14                0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────────────┐\n'
          + '  │10001 │ cond │  ─   │  ─   │  signed offset    │\n'
          + '  └──────┴──────┴──────┴──────┴───────────────────┘\n'
          + '   5-bit   4-bit  zero   zero        15-bit\n\n'
          + 'cond          = condition code (the branch condition)\n'
          + 'dst, src      = zero (unused)\n'
          + 'signed offset = sign-extended 15-bit PC-relative displacement\n'
          + '                range: -16384 to +16383 instructions\n\n'
          + 'If the condition is true, PC = PC + sign_ext(offset).\n'
          + 'The cond field IS the branch condition — no separate comparison needed\n'
          + 'if flags were set by a prior MCMP or arithmetic instruction.\n'
          + 'Branch targets are bounded within the current abstraction.',
        example: 'BRANCHEQ +3          ; If Z=1, skip 3 instructions\nBRANCHNE -5          ; If Z=0, loop back 5',
        mState: { badge: null, note: 'M-neutral — conditional branch reads flags only. No capability or M-state involvement.' },
    },
    {
        opcode: 18, mnemonic: 'SHL', domain: 'turing',
        mState: null, mStateNote: null,
        syntax: 'SHL DRd, DRs, shamt',
        brief: 'Logical shift left with flag setting',
        encoding: 'opcode[5]=10010 | cond[4] | DRd[4] | DRs[4] | shamt[5] in imm[4:0]',
        fields: [
            { name: 'DRd', desc: 'Destination data register (result)' },
            { name: 'DRs', desc: 'Source data register (value to shift)' },
            { name: 'shamt', desc: 'Shift amount (0-31)' },
        ],
        permission: 'None',
        flags: 'Z (zero), N (sign bit of result), C (last bit shifted out)',
        details:
            '  31    27│26   23│22   19│18   15│14     5│4     0\n'
          + '  ┌──────┬──────┬──────┬──────┬───────────┬──────┐\n'
          + '  │10010 │ cond │  DRd │  DRs │     0     │shamt │\n'
          + '  └──────┴──────┴──────┴──────┴───────────┴──────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit   10-bit    5-bit\n\n'
          + 'DRd   = destination (shifted result).\n'
          + 'DRs   = source (value to shift).\n'
          + 'shamt = shift amount 0–31 (in imm15[4:0]).\n'
          + 'imm15[14:5] = 0 (unused).\n\n'
          + 'DRd = DRs << shamt. Vacated low bits are filled with zeros.\n'
          + 'Equivalent to multiplication by 2^shamt.\n\n'
          + 'Z = 1 if result is zero\n'
          + 'N = 1 if bit 31 of result is set\n'
          + 'C = last bit shifted out (bit 32-shamt of original value)\n'
          + 'V = always 0',
        example: 'SHL DR2, DR1, 4      ; DR2 = DR1 << 4 (multiply by 16)',
        mState: { badge: null, note: 'M-neutral — pure data-register shift. No capability or M-state involvement.' },
    },
    {
        opcode: 19, mnemonic: 'SHR', domain: 'turing',
        mState: null, mStateNote: null,
        syntax: 'SHR DRd, DRs, shamt [, ASR]',
        brief: 'Logical or arithmetic shift right with flag setting',
        encoding: 'opcode[5]=10011 | cond[4] | DRd[4] | DRs[4] | arith[1]<<5 | shamt[5]',
        fields: [
            { name: 'DRd', desc: 'Destination data register (result)' },
            { name: 'DRs', desc: 'Source data register (value to shift)' },
            { name: 'shamt', desc: 'Shift amount (0-31)' },
            { name: 'ASR', desc: 'Optional: arithmetic shift (sign-extending). Omit for logical shift.' },
        ],
        permission: 'None',
        flags: 'Z (zero), N (sign bit of result), C (last bit shifted out)',
        details:
            '  31    27│26   23│22   19│18   15│14   6│5│4     0\n'
          + '  ┌──────┬──────┬──────┬──────┬──────────┬─┬──────┐\n'
          + '  │10011 │ cond │  DRd │  DRs │    0     │A│shamt │\n'
          + '  └──────┴──────┴──────┴──────┴──────────┴─┴──────┘\n'
          + '   5-bit   4-bit   4-bit   4-bit   9-bit  1   5-bit\n\n'
          + 'DRd   = destination (shifted result).\n'
          + 'DRs   = source (value to shift).\n'
          + 'shamt = shift amount 0–31 (imm15[4:0]).\n'
          + 'A     = arithmetic mode flag (imm15[5]).\n'
          + '        0 = logical shift (fill high bits with 0)\n'
          + '        1 = arithmetic shift / ASR (fill with sign bit)\n'
          + 'imm15[14:6] = 0 (unused).\n\n'
          + 'Logical (A=0):    DRd = DRs >> shamt, high bits = 0\n'
          + 'Arithmetic (A=1): DRd = DRs >>> shamt, high bits = sign bit\n'
          + 'ASR preserves sign — equivalent to signed division by 2^shamt.\n\n'
          + 'Z = 1 if result is zero\n'
          + 'N = 1 if bit 31 of result is set\n'
          + 'C = last bit shifted out (bit shamt-1 of original value)\n'
          + 'V = always 0',
        example: 'SHR DR2, DR1, 3      ; DR2 = DR1 >> 3 (logical)\nSHR DR3, DR1, 1, ASR ; DR3 = DR1 >>> 1 (arithmetic, sign-extending)',
        mState: { badge: null, note: 'M-neutral — pure data-register shift. No capability or M-state involvement.' },
    },
];

const PSEUDO_INSTR_DATA = [
    {
        id: 'petname',
        mnemonic: '.petname',
        brief: 'Register a c-list slot for lazy demand-loading via PetNameMemory',
        syntax: '.petname <n>      ; preferred directive form\nPETNAME  <n>      ; alternative uppercase form\n.petname #<n>     ; # prefix on immediate also accepted',
        range: '0–63 (c-list slot index)',
        clobbers: 'CR11 (ChurchHW capability), DR1 (slot number)',
        expansion:
            'LOAD  CR11, CR6, 18   ; fetch ChurchHW device cap (boot c-list slot 18)\n'
          + 'IADD  DR1,  DR0, #n   ; load slot number n into DR1\n'
          + 'DWRITE DR1, CR11, 0   ; register slot n with PetNameMemory',
        details:
            'Marks c-list slot n as "named" (demand-loadable) in PetNameMemory.\n\n'
          + 'By default, accessing a NULL c-list slot triggers a NULL_CAP fault\n'
          + 'and halts the thread. After .petname n is called, the simulator\n'
          + 'intercepts the NULL access and fires Scheduler.IRQ(LAZY_RESOLVE)\n'
          + 'instead, suspending the thread gracefully until the abstraction is\n'
          + 'delivered by the Tunnel fetch pipeline.\n\n'
          + 'This is the demand-loading pattern used throughout the Church Machine\n'
          + 'namespace: slots are registered before they are populated, so code\n'
          + 'can reference them without knowing when they will arrive.\n\n'
          + 'Implementation: .petname is a three-instruction pseudo-instruction\n'
          + '(assembler macro). The three emitted instructions use ChurchHW\n'
          + '(NS boot c-list slot 18), a hardware-control Abstract GT added in\n'
          + 'Task #1542. A DWRITE through it invokes _dispatchAbstractDwrite\n'
          + 'with DEVICE_CLASS_CHURCHHW, which calls _petNamedSlots.add(n).\n\n'
          + 'Slot n must be in range 0–63.',
        example: '.petname 5          ; slot 5 — lazy-resolved; NULL access suspends, not faults\nPETNAME 10          ; same effect using the uppercase form',
    },
];

let selectedInstr = null;
let selectedPseudoInstr = null;

function _refTipShow(text, e) {
    let tip = document.getElementById('_refBriefTip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = '_refBriefTip';
        tip.style.cssText = [
            'position:fixed',
            'z-index:9999',
            'background:#1b2d45',
            'color:#e0e0e0',
            'font-size:0.75rem',
            'line-height:1.45',
            'padding:0.4rem 0.75rem',
            'border-radius:5px',
            'border:1px solid #3a86ff',
            'max-width:320px',
            'pointer-events:none',
            'box-shadow:0 2px 10px rgba(0,0,0,0.5)',
            'white-space:normal',
            'display:none',
        ].join(';');
        document.body.appendChild(tip);
    }
    tip.textContent = text;
    tip.style.display = 'block';
    _refTipMove(e);
}

function _refTipMove(e) {
    const tip = document.getElementById('_refBriefTip');
    if (!tip || tip.style.display === 'none') return;
    const x = e.clientX + 16;
    const y = e.clientY - 6;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    tip.style.left = (x + tw > window.innerWidth  ? window.innerWidth  - tw - 10 : x) + 'px';
    tip.style.top  = (y + th > window.innerHeight ? window.innerHeight - th - 10 : y) + 'px';
}

function _refTipHide() {
    const tip = document.getElementById('_refBriefTip');
    if (tip) tip.style.display = 'none';
}

function _attachRefTip(card, brief) {
    card.addEventListener('mouseenter', e => _refTipShow(brief, e));
    card.addEventListener('mousemove',  _refTipMove);
    card.addEventListener('mouseleave', _refTipHide);
}

const ABSTRACTION_DATA = [
    {
        id: 'abstraction',
        name: 'Abstraction',
        brief: 'A named, capability-gated execution unit occupying a namespace slot.',
        detail: `An abstraction is the Church Machine's unit of software. Each abstraction occupies one namespace slot (slot 0 = boot, slot 1 = CLOOMC kernel, slots 2+ = user).

Structure of an abstraction in memory (Thread Lump, typ=0x0A):
  ┌───────────────────────────────────┐
  │ Header[0]   typ | cc | reserved   │  ← base address (word 0)
  │ Data Registers  DR0–DR15 (saved)  │
  │ Heap ↓      cc words, bump alloc  │
  │ Freespace   (grows/shrinks)       │
  │ Stack ↑     LIFO, CALL/LAMBDA     │
  │ C-List tail CR0–CR11 (12 words)   │
  └───────────────────────────────────┘

Entry: via CALL instruction through C-List slot holding an E-perm Golden Token pointing to the code lump.`,
        example: `; Declare abstraction (CLOOMC JS syntax)
abstraction Greeter {
  capabilities { Family }
  method Hello(name) {
    call(Family.Send(name))
    return(0)
  }
}`
    },
    {
        id: 'method',
        name: 'Method',
        brief: 'A lambda-captured function stored in the C-List, invoked via CALL.',
        detail: `A method is a LAMBDA closure stored as a Golden Token in the C-List.

Lifecycle:
  1. Compiler emits LAMBDA CRd, offset → creates closure GT with X-perm
  2. Closure is stored in a C-List slot (SAVE instruction)
  3. Caller invokes via CALL CRs, 0xF (direct E-perm) or ELOADCALL (load+call)
  4. On entry: CR6 = callee c-list, CR14 = code region (X-only)
  5. CHANGE swaps DR0–DR15 and CR6/CR14/CR15 between caller and callee
  6. RETURN restores caller context

Register conventions:
  DR1–DR3   Arguments (DR1 = return value, DR0 = hardwired zero)
  DR4–DR11  Callee-saved locals
  DR12–DR15 Caller-saved temporaries`,
        example: `; CLOOMC JS method call
result = call(Memory.Allocate(size))

; Compiles to:
ELOADCALL CRd, [CR6, slot]   ; load + call in one instruction
; or:
LOAD CRd, [CR6, slot]        ; load closure GT
CALL CRd, 0xF                ; call direct (E perm)`
    },
    {
        id: 'golden-token',
        name: 'Golden Token (GT)',
        brief: 'A 128-bit unforgeable capability granting specific permissions to a resource.',
        detail: `A Golden Token (GT) is a 128-bit value stored in a Context Register (CR).

Layout (4 × 32-bit words — R0 to R3):
  R0 [31:24] perms  — R W X L S E B F (8 bits)
  R0 [23:16] cc     — heap size in words (IDE-defined)
  R0 [15:0]  version — revocation counter
  R1 [31:0]  node   — memory address of the lump
  R2 [31:0]  seal   — sealing key (0 = unsealed)
  R3 [31:0]  sig    — CRC or integrity seal

Permission bits:
  R = DREAD   — read data words
  W = DWRITE  — write data words
  X = LAMBDA  — capture as closure
  L = LOAD    — load GT from C-List into a CR
  S = SAVE    — store GT into lump
  E = CALL    — direct invocation (E-perm CALL)
  B = boot    — present in boot C-List
  F = freeze  — token cannot be further restricted

Monotonic restriction: TPERM can only remove permissions, never add.
Revocation: CHANGE with version bump invalidates all outstanding copies.`,
        example: `; Check if GT has read permission (TPERM health-check form)
TPERM CR0, #R        ; sets Z flag if CR0 has R perm
BRANCH.NE fault      ; branch if no R perm

; Restrict to read-only (TPERM restriction form)
TPERM CR0, #R        ; keep only R bit — monotonic, irreversible`
    },
    {
        id: 'clist',
        name: 'C-List (Capability List)',
        brief: 'The 12-word tail of a thread holding Golden Tokens CR0–CR11.',
        detail: `Each thread has a C-List tail: 12 programmer-accessible Golden Token slots.

Slots:
  CR0   Result / first argument
  CR1   Second argument
  CR2   Third argument
  CR3   Fourth argument
  CR4   General purpose
  CR5   General purpose
  CR6   Current C-List base (set by CALL, read-only in CLOOMC)
  CR7   General purpose
  CR8   General purpose
  CR9   General purpose
  CR10  General purpose
  CR11  General purpose

Privileged zone (CR12–CR15) — hardware FAULT if used in most instructions:
  CR12  Thread stack (system-wide, unchanged by CHANGE)
  CR13  Interrupt handler (system-wide, unchanged by CHANGE)
  CR14  Code region (X-only, set by CALL; per-thread, saved/restored by CHANGE)
  CR15  Namespace root (per-thread, saved/restored by CHANGE)

The C-List is loaded at boot via mLoad(NS Slot 1, B-perm check).
CALL updates CR6 and CR14. CHANGE swaps the full context.`,
        example: `; Load a GT from C-List slot 3 into CR0
LOAD CR0, [CR6, 3]

; Save a GT from CR1 into slot 5 of target object
SAVE [CR0, 5], CR1

; Call abstraction via slot 2 in current C-List
CALL CR6, 2          ; L perm required on slot 2`
    },
    {
        id: 'thread',
        name: 'Thread',
        brief: 'The execution context: registers, stack, heap, and C-List tail in one lump.',
        detail: `A thread is a single execution context managed by the CHANGE instruction.

Memory layout (FS words total; HS, SS, FS are set by the IDE under programmer control):
  [0]              Header word      typ=0x0A | cc=HS (heap words) | cw=SS (stack words)
  [1–16]           DR0–DR15         Saved data registers (32-bit each)              Zone ⑤
  [17..HS]         Heap ↑           HS words; bump allocation; DR5 = frontier        Zone ④
  [HS+1..FS-13-SS] Freespace        dynamic gap; Mint-verified all-zero              Zone ③
  [FS-12-SS..FS-13] Stack ↓         SS words; CALL: [E-GT · frame-word] (STO -= 2)  Zone ②
                                              LAMBDA: [frame-word] (STO -= 1)
  [FS-12..FS-1]    C-List           CR0–CR11 (12 words, architecture-fixed tail)    Zone ①

STO register = current stack top (word index).
CHANGE saves current DRs into [1–16] and per-thread CRs (CR0–CR11, CR14, CR15); CR12/CR13 are system-wide and unchanged.`,
        example: `; CLOOMC compiler places locals in DR registers
; On CALL, hardware saves DR0–DR15 in thread header
; CHANGE instruction — write privileged register from NS entry:
CHANGE CR14, CR6, 3  ; context switch to Thread Abstraction at CR6[3]
CHANGE CR12, CR12, 1 ; install thread stack GT from NS slot 1`
    },
    {
        id: 'namespace',
        name: 'Namespace',
        brief: 'The 192-slot address space. Each slot holds a Golden Token to an abstraction.',
        detail: `The Namespace (NS) is the global directory of abstractions.

Capacity: 192 slots (slots 0–191), each holding a 128-bit Golden Token.

Reserved slots:
  Slot 0   Boot microcode (6-step hardwired state machine, not a real code word)
  Slot 1   CLOOMC kernel / thread manager

User abstractions:
  Slot 2+  IDE-assigned at compile time

Boot sequence (B:00–B:07, 8 steps):
  B:00  FAULT_RST  — capture fault context; clear all CRs / DRs
  B:01  LOAD_NS    — CR15 ← NS[0] Namespace GT
  B:02  INIT_THRD  — CR12 ← NS[1] thread stack GT (zero perms)
  B:03  INIT_HEAP  — CR5(RW) ← thread heap (CHANGE-consistent)
  B:04  CALL_HOME  — Tunnel.Register → 23-byte packet; await ACK
  B:05  INIT_ABSTR — CR6(E) ← NS[3] Boot.Abstr (pre-CALL token)
  B:06  NUC_CLIST  — CR6(E) ← lump c-list; push sentinel
  B:07  NUC_CODE   — CR14(R+X) ← lump code; PC←0; CALL CR0 → dispatch begins

Access: LOAD/SAVE instructions using a namespace-scoped GT with L/S perm.`,
        example: `; Assembly: load namespace entry for slot 3
LOAD CR0, [CR15, 3]  ; CR15 = namespace base GT
CALL CR0, 0xF        ; call directly (E perm)`
    },
    {
        id: 'change',
        name: 'CHANGE — Context Switch',
        brief: 'Hardware thread switch: saves DR0–DR15, loads new thread context.',
        detail: `CHANGE is the mechanism for both function calls and thread (abstraction) context switches.

What CHANGE does:
  1. Save DR0–DR15 into current thread header (words [1–16])
  2. Load DR0–DR15 from new thread header
  3. Swap CR6  (C-List pointer)
  4. Swap CR14 (Code region pointer)
  5. Swap CR15 (Stack/boot anchor)
  6. Adjust STO for new thread

When the compiler emits a CALL, it uses CHANGE internally.
CHANGE enables capability-isolated context switching:
  — The new thread runs in its own C-List (CR6)
  — Code region is swapped (CR14)
  — DR registers are fully saved and restored

Syntax:  CHANGE CRd, imm     (imm = context-switch mode)`,
        example: `; Hardware CHANGE during CALL:
; 1. DR0–DR15 saved to current thread [1..16]
; 2. New thread's DRs loaded
; 3. CR6 = new C-List, CR14 = new code lump
; RETURN undoes this`
    },
    {
        id: 'switch',
        name: 'SWITCH — Namespace Switch',
        brief: 'Reload CR15 with a new namespace root GT — changes the machine\'s capability world view.',
        detail: `SWITCH atomically reloads CR15 (the namespace root register) with the
namespace GT held in a source CR. CR15 is the machine's view of the
entire capability namespace — every LOAD, SAVE, and CALL resolves
through it.

SWITCH does NOT change permission bits. The GT permission set
(R, W, X, L, S, E, B, G, F) of any existing capability register is
unaffected by a SWITCH. Only the namespace root changes.

Use cases:
  — Domain isolation: switch to a restricted sub-namespace for a sandboxed task
  — Controlled handoff: hand a thread a different view of the capability world
  — Boot: the boot sequence installs the full namespace via CR15 at B:00

Syntax:  SWITCH CRs, imm     (CRs = GT for the target namespace; imm = flags)`,
        example: `; Switch namespace root to the GT in CR3
SWITCH CR3, 0        ; CR15 <- namespace GT from CR3`
    },
];

let _refActiveTab = 'abstractions';
let _selectedAbstraction = null;

function switchRefTab(tab) {
    _refActiveTab = tab;
    document.querySelectorAll('.ref-tab').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('refTab-' + tab);
    if (btn) btn.classList.add('active');
    document.getElementById('refPanel-abstractions').style.display = (tab === 'abstractions') ? '' : 'none';
    document.getElementById('refPanel-hardware').style.display = (tab === 'hardware') ? '' : 'none';
    const title = document.getElementById('instrDetailTitle');
    const body = document.getElementById('instrDetailContent');
    if (title) title.textContent = 'Select a concept or instruction';
    if (body) body.innerHTML = '<div class="instr-placeholder">Click any item on the left to see details.</div>';
}

function showAbstractionRefDetail(id) {
    _selectedAbstraction = id;
    selectedPseudoInstr = null;
    selectedInstr = null;
    const item = ABSTRACTION_DATA.find(a => a.id === id);
    if (!item) return;
    renderReference();
    const title = document.getElementById('instrDetailTitle');
    const body = document.getElementById('instrDetailContent');
    if (title) title.textContent = item.name;
    if (!body) return;
    body.innerHTML = `
        <div class="instr-detail-section">
            <div class="instr-detail-badge church">Abstraction Model</div>
            <div class="instr-detail-desc">${item.brief}</div>
        </div>
        <div class="instr-detail-section">
            <div class="instr-detail-label">Detail</div>
            <pre class="instr-detail-text">${item.detail}</pre>
        </div>
        <div class="instr-detail-section">
            <div class="instr-detail-label">Example</div>
            <pre class="instr-detail-example">${item.example}</pre>
        </div>
    `;
}

function showApiAbstractionDetail(slot) {
    if (typeof API_DATA === 'undefined') return;
    _selectedAbstraction = 'api:' + slot;
    selectedPseudoInstr = null;
    selectedInstr = null;
    renderReference();
    const title = document.getElementById('instrDetailTitle');
    const body = document.getElementById('instrDetailContent');
    const abs = apiLookupBySlot(slot);
    if (!abs || !body) return;

    const layerName = (typeof API_LAYER_NAMES !== 'undefined' && API_LAYER_NAMES[abs.layer])
        || ('Layer ' + abs.layer);
    if (title) title.textContent = abs.name + ' \u2014 NS[' + abs.slot + ']';

    function esc(s) {
        if (!s) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    const implBadge = abs.implemented === true
        ? '<span class="api-ref-impl-badge api-ref-impl-true">Implemented</span>'
        : abs.implemented === 'partial'
        ? '<span class="api-ref-impl-badge api-ref-impl-partial">Partial</span>'
        : '<span class="api-ref-impl-badge api-ref-impl-false">Planned</span>';

    const profileClass = abs.profile === 'IoT' ? 'iot' : abs.profile === 'XC7A100T' ? 'xc7a100t' : '';
    const profileBadge = abs.profile !== 'Full'
        ? `<span class="api-profile-chip ${profileClass}">${esc(abs.profile)}</span>` : '';

    let methodsHtml = '';
    if (abs.methods.length > 0) {
        const rows = abs.methods.map(m => {
            const mImplBadge = m.implemented
                ? '<span class="api-ref-impl-badge api-ref-impl-true" title="Implemented in simulator">✓</span>'
                : '<span class="api-ref-impl-badge api-ref-impl-false" title="Planned">planned</span>';
            const rowClass = m.implemented ? '' : ' class="api-method-planned"';
            return `<tr${rowClass}>
                <td class="api-method-name">${esc(m.name)}</td>
                <td class="api-method-sig">${esc(m.signature)}</td>
                <td class="api-method-perm">${esc(m.perms)}</td>
                <td class="api-method-desc">${esc(m.description)}</td>
                <td>${mImplBadge}</td>
            </tr>`;
        }).join('');
        methodsHtml = `
        <div class="instr-detail-section">
            <div class="instr-detail-label">Methods (${abs.methods.length})</div>
            <table class="api-method-table">
                <thead><tr>
                    <th>Name</th><th>Signature</th><th>Perm</th><th>Description</th><th></th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    } else {
        methodsHtml = `
        <div class="instr-detail-section">
            <div class="instr-detail-label">Methods</div>
            <div class="instr-detail-value" style="color:var(--text-secondary);font-style:italic;">No callable methods — boot primitive or pure lambda value.</div>
        </div>`;
    }

    body.innerHTML = `
        <div class="instr-detail-section">
            <div class="instr-detail-badge church">${esc(layerName)}</div>
            <div style="margin-top:0.4rem;" class="api-detail-perms-row">
                <span style="font-size:0.72rem;color:var(--text-secondary);">Permission:</span>
                <span class="api-perm-chip">${esc(abs.perms)}</span>
                ${profileBadge}
                ${implBadge}
            </div>
            <div class="instr-detail-desc">${esc(abs.description)}</div>
        </div>
        ${methodsHtml}
        <div class="instr-detail-section">
            <div class="instr-detail-label">Quick reference</div>
            <div class="instr-detail-value" style="font-size:0.78rem;">
                See <code style="color:var(--church-gold);font-size:0.75rem;">docs/api-reference.md</code> for the full reference document,
                or <a href="#" style="color:var(--church-blue);text-decoration:none;" onclick="event.preventDefault();if(typeof switchView==='function')switchView('docs');">open the Docs view</a>.
            </div>
        </div>
    `;
}

/* ── Assembly structural globals ─────────────────────────────────────────────
 * Exposes window._asmExampleSources at module-load time (analogous to
 * _initCloomcStructuralGlobals in app-compile.js) so the Source Library can
 * discover assembly example keys without requiring a prior loadExample() call.
 * Keys are seeded with empty strings; loadExample() overwrites them with real
 * source text on first use.  The Source Library re-renders automatically once
 * the real sources become available (see _slRenderedWithSources logic).       */
(function _initAsmStructuralGlobals() {
    if (window._asmExampleSourcesReady) return;
    window._asmExampleSourcesReady = false;
    /* app-compile.js loads before this script (see index.html), so
       window._cloomcLangExampleGroups is already set by _initCloomcStructuralGlobals().
       Fall back to an inline list only as a safety net if load order changes. */
    const asmKeys = (window._cloomcLangExampleGroups || {}).assembly ||
        ['ada_note_g', 'capability_test', 'system_patterns', 'compute_demo',
         'led_control', 'salvation', 'constants_dot', 'perm_attack', 'bind_attack', 'scheduler_pause', 'scheduler_yield'];
    const seed = {};
    for (const key of asmKeys) seed[key] = '';
    window._asmExampleSources = seed;
})();
