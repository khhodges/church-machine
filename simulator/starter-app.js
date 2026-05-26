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

function _switchLesson(fromId, toId, label, outputHtml, nextPhase, disableNext) {
    _el(fromId).classList.add('hidden');
    _el(toId).classList.remove('hidden');
    _el('lessonLabel').textContent = '\u2014 ' + label;
    if (disableNext) {
        _el('btnNext').disabled = true;
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
    if (_lessonPhase === 1) {
        // Lesson 1 → 2: reveal abstraction + capabilities { (none) } inline
        _el('capsInline').classList.remove('hidden');
        var caps = _el('capsSection');
        caps.classList.remove('hidden');
        caps.classList.add('active');
        _el('statusPanel').classList.add('s-panel-lit');
        _el('outputPanel').classList.add('s-panel-lit');
        _el('lessonLabel').textContent = '\u2014 Lesson 2 of 3';
        _el('btnNext').textContent = 'Lesson 2 \u2192';
        _lessonPhase = 2;
        _setOutput('<span class="out-dim">This simple example is a terminal atomic abstraction that needs nothing other than machine registers. The next lesson demonstrates local (private) memory access.</span>');
        _updateRegisters();
    } else if (_lessonPhase === 2) {
        // Lesson 2 → 3: full swap to myScratchPad lesson
        _switchLesson('lesson1Code', 'lesson3Code', 'Lesson 3 of 3',
            '<span class="out-dim">The programmer adds new capability defined objects using Pet Names. <strong>myScratchPad RW</strong> grants this abstraction read/write access to a private memory region. The <strong>LOAD</strong> instruction fetches that capability from the c-list ready for use.</span>',
            3, true);
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
        _setOutput('');
    } catch (e) {
        _setBadge('FAULT');
        _setOutput('<span class="out-red">Boot failed: ' + e.message + '</span>');
    }
}

// ── Single step ─────────────────────────────────────────────────────────────

function starterStep() {
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
})();
