// starter-app.js — Church Machine Starter IDE controller
// Minimal wiring for the /start page. Uses the same ChurchSimulator and
// ChurchAssembler as the full IDE — no shortcuts on the security model.

'use strict';

var sim        = null;
var assembler  = null;
var _booted    = false;
var _lastFault = null;

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
    _el('btnRun').disabled   = !booted;
    _el('btnStep').disabled  = !booted;
    _el('btnReset').disabled = !booted;
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
        } else {
            sim.reset();
        }
        var ok = _runBootSequence();
        if (!ok) throw new Error('Boot sequence did not complete');
        _booted = true;
        sim._programLoaded = false;
        _enableControls(true);
        _setBadge('HALTED');
        _updateRegisters();
        _setOutput('<span class="out-green">✓ Church Machine booted</span>\n'
            + '<span class="out-dim">Capability registers initialised. Namespace loaded.\n'
            + 'Click Run to assemble and execute your program.</span>');
    } catch (e) {
        _setBadge('FAULT');
        _setOutput('<span class="out-red">Boot failed: ' + e.message + '</span>');
    }
}

// ── Assemble + load + run ───────────────────────────────────────────────────

function starterRun() {
    if (!sim || !_booted) return;
    _hideFault();
    _el('haltedMsg').style.display = 'none';

    var src = _el('codeEditor').value;

    // Assemble
    var result;
    try {
        result = assembler.assemble(src);
    } catch (e) {
        _setBadge('FAULT');
        _setOutput('<span class="out-red">Assembler error: ' + e.message + '</span>');
        return;
    }

    if (result.errors && result.errors.length > 0) {
        _setBadge('FAULT');
        var errHtml = '<span class="out-red">Assembler errors:</span>\n';
        result.errors.forEach(function(e) {
            errHtml += '<span class="out-red">  Line ' + (e.line || '?') + ': ' + _esc(e.message || e) + '</span>\n';
        });
        _setOutput(errHtml);
        return;
    }

    var words = result.words || result;
    if (!words || !words.length) {
        _setOutput('<span class="out-dim">Nothing to run — write some code first.</span>');
        return;
    }

    // Re-boot clean then load
    sim.boot();
    sim.loadProgram(words);

    // Run to halt or fault (max 50 000 steps to avoid infinite loops)
    _setBadge('RUNNING');
    var MAX_STEPS = 50000;
    var steps = 0;
    var faulted = false;

    while (!sim.halted && steps < MAX_STEPS) {
        var r = sim.step();
        steps++;
        if (!r) break;
        if (sim.faultLog && sim.faultLog.length > 0) { faulted = true; break; }
    }

    _updateRegisters();

    // Build output
    var out = '';
    if (sim.output) {
        out += '<span class="out-dim">── machine output ──</span>\n'
            + '<span class="out-gold">' + _esc(sim.output) + '</span>\n';
    }

    if (faulted) {
        var entry = sim.faultLog[sim.faultLog.length - 1];
        _setBadge('FAULT');
        _showFault(entry);
        out += '<span class="out-red">⚡ Capability fault after ' + steps + ' step(s)</span>\n';
    } else if (sim.halted) {
        _setBadge('HALTED');
        _el('haltedMsg').style.display = '';
        out += '<span class="out-green">✓ Halted after ' + steps + ' step(s)</span>\n';
        out += _registerDump();
    } else {
        _setBadge('RUNNING');
        out += '<span class="out-dim">Reached step limit (' + MAX_STEPS + '). '
            + 'Check your program for an infinite loop.</span>\n';
    }

    _setOutput(out);
}

// ── Single step ─────────────────────────────────────────────────────────────

function starterStep() {
    if (!sim || !_booted) return;
    _hideFault();

    // If not yet loaded, assemble and load first
    if (sim.pc === 0 && !sim._programLoaded) {
        var src = _el('codeEditor').value;
        var result;
        try { result = assembler.assemble(src); } catch (e) {
            _setOutput('<span class="out-red">Assembler error: ' + e.message + '</span>');
            return;
        }
        if (result.errors && result.errors.length) {
            _setOutput('<span class="out-red">Fix assembler errors before stepping.</span>');
            return;
        }
        sim.boot();
        sim.loadProgram(result.words || result);
        sim._programLoaded = true;
        _setOutput('<span class="out-dim">Program loaded. Stepping…</span>\n');
    }

    if (sim.halted) {
        _appendOutput('<span class="out-dim">Already halted. Click Boot to start again.</span>\n');
        return;
    }

    var r = sim.step();
    _updateRegisters();

    if (sim.faultLog && sim.faultLog.length > 0) {
        var entry = sim.faultLog[sim.faultLog.length - 1];
        _showFault(entry);
        _setBadge('FAULT');
        _appendOutput('<span class="out-red">⚡ Capability fault at PC=' + sim.pc + '</span>\n');
    } else if (sim.halted) {
        _setBadge('HALTED');
        _el('haltedMsg').style.display = '';
        _appendOutput('<span class="out-green">✓ HALT — PC=' + sim.pc + '</span>\n' + _registerDump());
    } else {
        _setBadge('RUNNING');
        var instr = (r && r.mnemonic) ? r.mnemonic : '(step)';
        _appendOutput('<span class="out-dim">PC=' + sim.pc + '  ' + _esc(instr) + '</span>\n');
    }
}

// ── Reset ────────────────────────────────────────────────────────────────────

function starterReset() {
    _hideFault();
    _el('haltedMsg').style.display = 'none';
    if (sim) {
        sim.boot();
        sim._programLoaded = false;
    }
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
