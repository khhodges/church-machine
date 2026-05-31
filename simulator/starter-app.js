// starter-app.js — Church Machine Starter IDE controller
// Minimal wiring for the /start page. Uses the same ChurchSimulator and
// ChurchAssembler as the full IDE — no shortcuts on the security model.

'use strict';

var sim           = null;
var assembler     = null;
var cloomcCompiler = null;
var _booted      = false;
var _lastFault   = null;
var _hexRows     = [];
var _hexRowIdx   = 0;
var _lessonPhase = 1;
var _methodCount  = 0;

var _L5_DRAFT_KEY = 'church_l5_draft';

function _saveL5Draft() {
    try {
        var name = _el('absName') ? (_el('absName').value || '') : '';
        var desc = _el('absDesc') ? (_el('absDesc').value || '') : '';
        var rows = document.querySelectorAll('.s-method-row-wrap');
        var methods = [];
        rows.forEach(function(row) {
            methods.push({
                name: (row.querySelector('.s-method-name').value || ''),
                desc: (row.querySelector('.s-method-desc').value || ''),
                deps: (row.querySelector('.s-method-deps').value || '')
            });
        });
        localStorage.setItem(_L5_DRAFT_KEY, JSON.stringify({ name: name, desc: desc, methods: methods }));
    } catch (e) {}
}

function _restoreL5Draft() {
    try {
        var raw = localStorage.getItem(_L5_DRAFT_KEY);
        if (!raw) return false;
        var d = JSON.parse(raw);
        if (!d || (!d.name && !d.desc && !(d.methods && d.methods.length))) return false;
        if (_el('absName')) _el('absName').value = d.name || '';
        if (_el('absDesc')) _el('absDesc').value = d.desc || '';
        if (d.methods && d.methods.length) {
            _el('methodList').innerHTML = '';
            _methodCount = 0;
            d.methods.forEach(function(m) {
                starterAddMethod();
                var row = _el('methodList').lastElementChild;
                if (row) {
                    row.querySelector('.s-method-name').value = m.name || '';
                    row.querySelector('.s-method-desc').value = m.desc || '';
                    row.querySelector('.s-method-deps').value = m.deps || '';
                }
            });
        }
        return true;
    } catch (e) { return false; }
}

// ── Friendly fault explanations ────────────────────────────────────────────

var FAULT_FRIENDLY = {
    PERM_R:    { what: 'read from memory',    why: 'you did not have a Read capability for that address' },
    PERM_W:    { what: 'write to memory',     why: 'you did not have a Write capability for that address' },
    PERM_X:    { what: 'execute code',        why: 'you did not have an Execute capability for that location' },
    PERM_L:    { what: 'load a capability',   why: 'you did not have Load permission' },
    PERM_S:    { what: 'store a capability',  why: 'you did not have Store permission' },
    NULL_CAP:  { what: 'use a capability',    why: 'the capability was empty (null Golden Token)' },
    BOUNDS:    { what: 'access memory',       why: 'the address was outside the allowed region' },
    SEAL:      { what: 'use a capability',    why: 'the capability seal did not match — it may have been tampered with' },
    OPCODE:    { what: 'run an instruction',  why: 'that instruction is not supported on this profile' },
};

function _faultExplanation(entry) {
    var code = (entry && entry.faultCode) || '';
    var info = FAULT_FRIENDLY[code];
    if (info) {
        return 'The program tried to <strong>' + info.what + '</strong>, but ' + info.why + '.<br><br>'
            + 'This is the capability security model working exactly as designed — '
            + 'the hardware stopped the program the moment it stepped out of bounds. '
            + 'No damage done. Fix the capability grant and try again.';
    }
    return 'The hardware detected a security violation and stopped the program safely. '
        + 'Read the fault code below to find out what happened.';
}

// ── DOM helpers ─────────────────────────────────────────────────────────────

function _el(id) { return document.getElementById(id); }

function _setBadge(state) {
    var badge = _el('stateBadge');
    badge.className = 's-state-badge';
    var map = { IDLE: 'badge-idle', RUNNING: 'badge-running', HALTED: 'badge-halted', FAULT: 'badge-fault' };
    badge.classList.add(map[state] || 'badge-idle');
    badge.textContent = state;
}

function _setOutput(html) {
    _el('outputArea').innerHTML = html;
}

function _appendOutput(html) {
    var area = _el('outputArea');
    if (area.innerHTML === '<span class="out-dim">— boot the machine to begin —</span>'
        || area.innerHTML === '<span class="out-dim">— booting… —</span>') {
        area.innerHTML = '';
    }
    area.innerHTML += html;
    area.scrollTop = area.scrollHeight;
}

function _updateRegisters() {
    if (!sim) return;
    var hex = function(n) { return '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0'); };
    _el('regPC').textContent  = sim.pc !== undefined ? sim.pc : '—';
    _el('regDR0').textContent = sim.dr ? hex(sim.dr[0]) : '—';
    _el('regDR1').textContent = sim.dr ? hex(sim.dr[1]) : '—';
    _el('regDR2').textContent = sim.dr ? hex(sim.dr[2]) : '—';
    _el('regDR3').textContent = sim.dr ? hex(sim.dr[3]) : '—';
}

function _switchLesson(fromId, toId, label, outputHtml, nextPhase, disableNext, btnText) {
    _el(fromId).classList.add('hidden');
    _el(toId).classList.remove('hidden');
    _el('lessonLabel').textContent = '\u2014 ' + label;
    var btn = _el('btnNext');
    if (disableNext) {
        btn.disabled = true;
    } else {
        btn.disabled = false;
        btn.textContent = btnText || 'Next Lesson \u2192';
    }
    var caps = _el('capsSection');
    caps.classList.remove('hidden');
    caps.classList.add('active');
    _el('statusPanel').classList.add('s-panel-lit');
    _el('outputPanel').classList.add('s-panel-lit');
    if (sim) {
        sim.reset();
        _runBootSequence();
        sim._programLoaded = false;
    }
    _hideHexListing();
    _el('haltedMsg').style.display = 'none';
    _setBadge('IDLE');
    _updateRegisters();
    _lessonPhase = nextPhase;
    _setOutput(outputHtml);
}

function starterNext() {
    if (_lessonPhase === 5) {
        starterSaveDraft();
        return;
    }
    if (_lessonPhase === 1) {
        // Lesson 1 → 2: reveal abstraction + capabilities { (none) } inline
        _hideFault();
        _el('haltedMsg').style.display = 'none';
        if (sim) {
            sim.reset();
            _runBootSequence();
            sim._programLoaded = false;
        }
        _hideHexListing();
        _setBadge('IDLE');
        _el('lesson1Header').classList.add('hidden');
        _el('capsInline').classList.remove('hidden');
        var caps = _el('capsSection');
        caps.classList.remove('hidden');
        caps.classList.add('active');
        _el('statusPanel').classList.add('s-panel-lit');
        _el('outputPanel').classList.add('s-panel-lit');
        _el('lessonLabel').textContent = '\u2014 Lesson 2 of 5';
        _el('btnNext').textContent = 'Next Lesson \u2192';
        _lessonPhase = 2;
        _setOutput('<span class="out-dim">This simple example is a terminal atomic abstraction that needs nothing other than machine registers. The next lesson demonstrates local (private) memory access.</span>');
        _updateRegisters();
    } else if (_lessonPhase === 2) {
        // Lesson 2 → 3: full swap to myScratchPad lesson
        _switchLesson('lesson1Code', 'lesson3Code', 'Lesson 3 of 5',
            '<span class="out-dim">The programmer adds new capability defined objects using Pet Names. <strong>myScratchPad RW</strong> grants this abstraction read/write access to a private memory region. The <strong>LOAD</strong> instruction fetches that capability from the c-list ready for use.</span>\n\n<span class="out-dim">Symbolic addressing allows readable pet names in machine code statements!</span>',
            3, false, 'Next Lesson \u2192');
    } else if (_lessonPhase === 3) {
        // Lesson 3 → 4: full swap to LUMPs lesson
        _switchLesson('lesson3Code', 'lesson4Code', 'Lesson 4 of 5',
            '<span class="out-dim">The CLOOMC++ compiler understands Pet Names and makes machine code as readable as <strong>CONNECT (Me, MyMother)</strong></span>',
            4, false, 'Next Lesson \u2192');
    } else if (_lessonPhase === 4) {
        // Lesson 4 → 5: Create Abstraction planning form
        ['lesson1Code', 'lesson3Code', 'lesson4Code'].forEach(function(id) {
            var el = _el(id); if (el) el.classList.add('hidden');
        });
        var form5 = _el('lesson5Form');
        form5.classList.remove('hidden');
        _el('lessonLabel').textContent = '\u2014 Lesson 5 of 5 \u2014 Create Abstraction';
        _el('btnStep').disabled  = true;
        _el('btnReset').disabled = true;
        _el('btnNext').textContent = 'Save Draft';
        var btnOD = _el('btnOpenDraft');
        if (btnOD) btnOD.classList.remove('hidden');
        var ann = _el('starterAnnotation');
        if (ann) ann.innerHTML = 'Fill in the details, then click <strong>Save Draft</strong>. When ready, click <strong>Code Edit \u2192</strong> to open the editor with your framework.';
        _setOutput('<span class="out-dim">Plan your abstraction above. Click <strong style="color:#daa520">Save Draft</strong> to save your plan, then <strong style="color:#daa520">Code Edit \u2192</strong> when you\'re ready to start coding \u2014 the editor will open with your framework pre-filled.</span>');
        _lessonPhase = 5;
        // Restore any saved draft first; if nothing saved, add the first blank row
        var restored = _restoreL5Draft();
        if (!restored && _methodCount === 0) starterAddMethod();
        // Auto-save on every keystroke inside the form
        form5.addEventListener('input', _saveL5Draft);
    }
}

function _showFault(entry) {
    _lastFault = entry;
    var panel = _el('faultPanel');
    panel.classList.remove('hidden');
    _el('faultBody').innerHTML = _faultExplanation(entry);
    var detail = '';
    if (entry) {
        if (entry.faultCode)            detail += 'Code: '       + entry.faultCode + '\n';
        if (entry.faultingMnemonic)     detail += 'Instruction: ' + entry.faultingMnemonic + '\n';
        if (entry.pipelineStage)        detail += 'Stage: '      + entry.pipelineStage + '\n';
        if (entry.faultingAbstractionLabel) detail += 'In: '     + entry.faultingAbstractionLabel + '\n';
    }
    _el('faultDetail').textContent = detail.trim();
}

function _hideFault() {
    _el('faultPanel').classList.add('hidden');
    _lastFault = null;
}

function _enableControls(booted) {
    _el('btnStep').disabled  = !booted;
    _el('btnReset').disabled = !booted;
}

function _buildHexRows(src, result) {
    _hexRows   = [];
    _hexRowIdx = 0;
    if (!result || !result.words) return;
    var words    = result.words;
    var lineNums = result.lineNums || [];
    var srcLines = src.split('\n');
    for (var i = 0; i < words.length; i++) {
        var hex     = '0x' + (words[i] >>> 0).toString(16).toUpperCase().padStart(8, '0');
        var lineIdx = lineNums[i] != null ? lineNums[i] - 1 : -1;
        var srcLine = lineIdx >= 0 ? srcLines[lineIdx] : '';
        var semiIdx = srcLine.indexOf(';');
        var row;
        if (semiIdx >= 0) {
            var before  = srcLine.slice(0, semiIdx).trimEnd();
            var comment = srcLine.slice(semiIdx + 1).trim();
            row = '<span class="s-hex-src">' + _esc(before) + '</span>'
                + '<span class="s-hex-cmt"> ; </span>'
                + '<span class="s-hex-word">' + hex + '</span>'
                + '<span class="s-hex-cmt">  ' + _esc(comment) + '</span>';
        } else {
            var trimmed = srcLine.trim();
            row = '<span class="s-hex-src">' + _esc(trimmed) + '</span>'
                + '<span class="s-hex-cmt"> ; </span>'
                + '<span class="s-hex-word">' + hex + '</span>';
        }
        _hexRows.push('<div class="s-hex-row">' + row + '</div>');
    }
}

function _hideHexListing() {
    _hexRows   = [];
    _hexRowIdx = 0;
    _setOutput('');
}

// ── Session start (from welcome card) ───────────────────────────────────────

function startSession() {
    _el('welcomeCard').classList.add('hidden');
    _el('mainArea').classList.remove('hidden');
    starterBoot();
}

// ── Boot ────────────────────────────────────────────────────────────────────

function _runBootSequence() {
    // Drive the multi-step boot sequence to completion (mirrors resetAndStep in app-run.js).
    var MAX_BOOT_STEPS = 200;
    var steps = 0;
    while (!sim.bootComplete && !sim.halted && steps < MAX_BOOT_STEPS) {
        sim._bootStep();
        steps++;
    }
    return sim.bootComplete;
}

function starterBoot() {
    _hideFault();
    _el('haltedMsg').style.display = 'none';
    _setOutput('<span class="out-dim">— booting… —</span>');
    _setBadge('RUNNING');

    try {
        if (!sim) {
            sim = new ChurchSimulator();
            assembler = new ChurchAssembler(
                typeof METHOD_REGISTER_CONVENTIONS !== 'undefined' ? METHOD_REGISTER_CONVENTIONS : {}
            );
            cloomcCompiler = new CLOOMCCompiler();
        } else {
            sim.reset();
        }
        var ok = _runBootSequence();
        if (!ok) throw new Error('Boot sequence did not complete');
        sim.output = '';
        _booted = true;
        sim._programLoaded = false;
        _hideHexListing();
        _enableControls(true);
        _setBadge('HALTED');
        _updateRegisters();
        _setOutput('<span class="out-dim">Machine booted. Click <strong style="color:#daa520">›\u202fStep</strong> to walk through your first program one instruction at a time.</span>');
    } catch (e) {
        _setBadge('FAULT');
        _setOutput('<span class="out-red">Boot failed: ' + e.message + '</span>');
    }
}

// ── Single step ─────────────────────────────────────────────────────────────

function starterStep() {
    if (_lessonPhase >= 5) return;
    if (!sim || !_booted) return;
    _hideFault();

    // If not yet loaded, assemble and load first
    if (sim.pc === 0 && !sim._programLoaded) {
        var src;
        if (_lessonPhase >= 3) {
            // Lesson 3 — caps block + LOAD are display-only, compile clean IADD/HALT
            src =
                '; The programmer adds new capability defined objects using Pet Names\n' +
                '; \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
                '; DR1 holds A, DR2 holds B, result goes into DR1.\n' +
                '\n' +
                '    IADD  DR1, DR1, #12  ; A = 12\n' +
                '    IADD  DR2, DR2, #30  ; B = 30\n' +
                '    IADD  DR1, DR1, DR2  ; A + B  \u2192  DR1 = 42\n' +
                '    HALT                 ; done \u2014 result is in DR1\n';
        } else {
            // Lessons 1 & 2 — caps block is display-only, compile clean IADD/HALT
            src =
                '; The Church Machine adds hardened symbolic addressing\n' +
                '; \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
                '; Simple A + B programs are unchanged\n' +
                '; DR1 holds A, DR2 holds B, result goes into DR1.\n' +
                '\n' +
                '    IADD  DR1, DR1, #12  ; A = 12\n' +
                '    IADD  DR2, DR2, #30  ; B = 30\n' +
                '    IADD  DR1, DR1, DR2  ; A + B  \u2192  DR1 = 42\n' +
                '    HALT                 ; done \u2014 result is in DR1\n';
        }
        var result;
        try { result = cloomcCompiler.compile(src, []); } catch (e) {
            _setOutput('<span class="out-red">Compiler error: ' + e.message + '</span>');
            return;
        }
        if (result.errors && result.errors.length) {
            _setOutput('<span class="out-red">Compiler error: ' + result.errors[0].message + '</span>');
            return;
        }
        var m0 = result.methods && result.methods[0];
        var normResult = { words: m0 ? (m0.code || []) : [], lineNums: m0 ? (m0.lineNums || []) : [] };
        sim.reset();
        _runBootSequence();
        sim.output = '';
        sim.loadProgram(normResult.words);
        sim._programLoaded = true;
        _buildHexRows(src, normResult);
        _setOutput('');
    }

    if (sim.halted) {
        sim.reset();
        _runBootSequence();
        sim._programLoaded = false;
        _hideHexListing();
        _el('haltedMsg').style.display = 'none';
        _setBadge('HALTED');
        _updateRegisters();
        return;
    }

    var r = sim.step();
    if (_hexRowIdx < _hexRows.length) {
        _appendOutput(_hexRows[_hexRowIdx++]);
    }
    _updateRegisters();

    if (sim.faultLog && sim.faultLog.length > 0) {
        var entry = sim.faultLog[sim.faultLog.length - 1];
        _showFault(entry);
        _setBadge('FAULT');
        _appendOutput('<span class="out-red">⚡ Capability fault at PC=' + sim.pc + '</span>\n');
    } else if (sim.halted) {
        _setBadge('HALTED');
        _el('haltedMsg').style.display = '';
        _appendOutput('<span class="out-green">✓ Done</span>\n' + _registerResult());
    } else {
        _setBadge('RUNNING');
    }
}

// ── Reset ────────────────────────────────────────────────────────────────────

function starterReset() {
    _hideFault();
    _el('haltedMsg').style.display = 'none';
    if (sim) {
        sim.reset();
        _runBootSequence();
        sim._programLoaded = false;
    }
    _hideHexListing();
    _setBadge('HALTED');
    _updateRegisters();
    _setOutput('<span class="out-dim">— reset — program cleared, machine re-booted —</span>');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function _registerResult() {
    if (!sim || !sim.dr) return '';
    var out = '';
    var anyNonZero = false;
    for (var i = 0; i < 4; i++) {
        var v = sim.dr[i] >>> 0;
        if (v !== 0) {
            anyNonZero = true;
            var signed = v | 0;
            var hex = '0x' + v.toString(16).toUpperCase().padStart(8, '0');
            out += '<span class="out-green" style="font-size:1.1em;font-weight:bold;">DR' + i + ' = ' + signed + '</span>'
                + ' <span class="out-dim">(' + hex + ')</span>\n';
        }
    }
    if (!anyNonZero) {
        out += '<span class="out-dim">All registers are zero.</span>\n';
    }
    return out;
}

function _registerDump() {
    if (!sim || !sim.dr) return '';
    var hex = function(n) { return '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0'); };
    var out = '<span class="out-dim">Registers: ';
    for (var i = 0; i < 4; i++) {
        out += 'DR' + i + '=' + hex(sim.dr[i]) + ' ';
    }
    out += '</span>\n';
    return out;
}

// ── Lesson 5 helpers ─────────────────────────────────────────────────────────

function starterAddMethod() {
    _methodCount++;
    var idx = _methodCount;
    var div = document.createElement('div');
    div.className = 's-method-row-wrap';
    div.id = 's-method-' + idx;
    var removeBtn = idx > 1
        ? '<button class="s-method-remove" onclick="starterRemoveMethod(' + idx + ')" title="Remove this function">\u00d7</button>'
        : '';
    div.innerHTML =
        '<div class="s-method-num">Function ' + idx + '</div>' + removeBtn +
        '<div class="s-method-2col">' +
        '  <div><label class="s-form-label">Name</label>' +
        '    <input type="text" class="s-form-input s-method-name" placeholder="e.g. add, save, validate" autocomplete="off" /></div>' +
        '  <div><label class="s-form-label">What it does</label>' +
        '    <input type="text" class="s-form-input s-method-desc" placeholder="Brief description" /></div>' +
        '</div>' +
        '<label class="s-form-label">Depends on (optional \u2014 comma-separated abstraction names)</label>' +
        '<input type="text" class="s-form-input s-method-deps" placeholder="e.g. sliderule, myScratchPad \u2014 leave blank if none" />';
    _el('methodList').appendChild(div);
    div.querySelector('.s-method-name').focus();
}

function starterRemoveMethod(idx) {
    var el = _el('s-method-' + idx);
    if (el) el.parentNode.removeChild(el);
    _saveL5Draft();
}

function starterSaveDraft() {
    _saveL5Draft();
    _setOutput('<span class="out-dim">\u2713 Draft saved. Click <strong style="color:#daa520">Code Edit \u2192</strong> when you\'re ready to start coding.</span>');
}

function starterOpenEditor() {
    var nameRaw = (_el('absName').value || '').trim().replace(/\s+/g, '');
    if (!nameRaw) {
        var inp = _el('absName');
        inp.classList.add('s-input-error');
        inp.focus();
        setTimeout(function() { inp.classList.remove('s-input-error'); }, 1800);
        return;
    }
    // Capitalise first letter
    var name = nameRaw.charAt(0).toUpperCase() + nameRaw.slice(1);
    var desc = (_el('absDesc').value || '').trim();

    // Collect methods
    var rows = document.querySelectorAll('.s-method-row-wrap');
    var methods = [];
    rows.forEach(function(row) {
        var mName = (row.querySelector('.s-method-name').value || '').trim().replace(/\s+/g, '');
        var mDesc = (row.querySelector('.s-method-desc').value || '').trim();
        var mDeps = (row.querySelector('.s-method-deps').value || '').trim();
        if (mName) methods.push({ name: mName, desc: mDesc, deps: mDeps });
    });
    if (!methods.length) methods.push({ name: 'run', desc: 'Main function', deps: '' });

    // Collect unique dep names for capabilities block
    var allDeps = [];
    methods.forEach(function(m) {
        if (m.deps) {
            m.deps.split(',').forEach(function(d) {
                var dep = d.trim().replace(/\s+/g, '');
                if (dep && allDeps.indexOf(dep) === -1) allDeps.push(dep);
            });
        }
    });

    // Build CLOOMC skeleton
    var HR = '; ' + '\u2500'.repeat(49);
    var lines = [];
    if (desc) { lines.push('; ' + desc); lines.push(HR); }
    else       { lines.push('; ' + name + ' abstraction'); lines.push(HR); }
    lines.push('');
    lines.push('abstraction ' + name + ' {');
    lines.push('    capabilities {');
    if (allDeps.length) {
        allDeps.forEach(function(dep) { lines.push('        ' + dep + ' E'); });
    } else {
        lines.push('        ; (none \u2014 add capability grants here)');
    }
    lines.push('    }');
    methods.forEach(function(m) {
        lines.push('');
        lines.push('    method ' + m.name + ' {');
        if (m.desc)  lines.push('        ; ' + m.desc);
        if (m.deps) {
            var depList = m.deps.split(',').map(function(d) { return d.trim(); }).filter(Boolean);
            if (depList.length) lines.push('        ; Depends on: ' + depList.join(', '));
        }
        lines.push('        ; ' + '\u2500'.repeat(35));
        lines.push('        ; TODO: write your code here');
        lines.push('');
        lines.push('        RETURN');
        lines.push('    }');
    });
    lines.push('}');

    var code = lines.join('\n');
    try {
        localStorage.setItem('church_editor_code', code);
        localStorage.setItem('church_editor_lang', 'cloomc');
    } catch (e) {}

    // Clear the Lesson 5 draft so the beforeunload handler doesn't fire
    // a popup when navigating to the editor. The code is already saved.
    try { localStorage.removeItem(_L5_DRAFT_KEY); } catch (e) {}

    window.location = '/simulator/#editor';
}

// ── Draft resume banner ──────────────────────────────────────────────────────

function _checkResumeBanner() {
    try {
        var raw = localStorage.getItem(_L5_DRAFT_KEY);
        if (!raw) return;
        var d = JSON.parse(raw);
        if (!d) return;
        var banner = _el('resumeDraftBanner');
        if (!banner) return;
        var nameEl = _el('resumeDraftName');
        var displayName = (d.name && d.name.trim()) ? d.name.trim() : 'unnamed abstraction';
        if (nameEl) nameEl.textContent = displayName;
        banner.classList.add('active');
    } catch (e) {}
}

function resumeLesson5Draft() {
    startSession();    // boot + show main area (synchronous)
    _lessonPhase = 4;  // prime starterNext for the 4→5 transition
    starterNext();     // jumps to Lesson 5, auto-restores the draft
}

function discardLesson5Draft() {
    try { localStorage.removeItem(_L5_DRAFT_KEY); } catch (e) {}
    var banner = _el('resumeDraftBanner');
    if (banner) banner.classList.remove('active');
}

// ── Challenge mode ───────────────────────────────────────────────────────────

(function() {
    var params = new URLSearchParams(window.location.search);

    // Challenge banner
    if (params.get('challenge') === '1') {
        _el('challengeBar').classList.add('active');
    }

    // If ?go=1, skip the welcome card and boot immediately
    if (params.get('go') === '1') {
        document.addEventListener('DOMContentLoaded', function() {
            startSession();
        });
    }

    // If ?abstraction=1, jump straight to the Lesson 5 planning form
    // and restore any saved draft automatically
    if (params.get('abstraction') === '1') {
        document.addEventListener('DOMContentLoaded', function() {
            resumeLesson5Draft();
        });
    }

    // Show "Resume your draft" banner if a Lesson 5 draft is saved
    document.addEventListener('DOMContentLoaded', _checkResumeBanner);

    // Warn before leaving the page if the user has unsaved Lesson 5 draft data
    window.addEventListener('beforeunload', function(e) {
        try {
            var raw = localStorage.getItem(_L5_DRAFT_KEY);
            if (raw) {
                var d = JSON.parse(raw);
                if (d && (d.name || d.desc || (d.methods && d.methods.length))) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            }
        } catch (_) {}
    });
})();
