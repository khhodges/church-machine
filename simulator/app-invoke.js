// ── app-invoke.js — Method Invocation Popup + Register Watch Strip ────────────
// Provides:
//   openInvokeModal()    — opens the "Invoke Method" dialog
//   refreshInvokeBtn()   — shows/hides the button based on sim state
//   renderWatchStrip()   — updates the watch strip above the DR panel
//   addWatchPin(name)    — pins a register name to the watch strip

// ─── Watch-strip state ────────────────────────────────────────────────────────
// Default pins: DR0 (selector / return), DR1, DR2 shown when abstraction loaded.
let _watchPins = ['DR0', 'DR1', 'DR2'];
let _prevWatchValues = {};

function _parseRegPin(name) {
    // Returns { kind:'dr'|'cr', idx:number } or null
    const u = name.trim().toUpperCase();
    const dr = u.match(/^DR(\d+)$/);
    if (dr) { const i = parseInt(dr[1]); return (i >= 0 && i <= 15) ? { kind:'dr', idx:i } : null; }
    const cr = u.match(/^CR(\d+)$/);
    if (cr) { const i = parseInt(cr[1]); return (i >= 0 && i <= 15) ? { kind:'cr', idx:i } : null; }
    return null;
}

function _readPin(pin) {
    if (!sim) return 0;
    if (pin.kind === 'dr') return (sim.dr && sim.dr[pin.idx] !== undefined) ? (sim.dr[pin.idx] >>> 0) : 0;
    if (pin.kind === 'cr') {
        const cr = sim.cr && sim.cr[pin.idx];
        return cr ? (cr.word0 >>> 0) : 0;
    }
    return 0;
}

function _pinLabel(pinName, pin) {
    if (!pin) return pinName;
    // Semantic labels for well-known slots
    const dr0label = 'selector / return';
    const labels = {
        DR0: dr0label, DR1: 'arg 1', DR2: 'arg 2', DR3: 'arg 3',
        DR4: 'arg 4', DR5: 'arg 5', DR6: 'arg 6',
    };
    // Override with abstraction-specific parameter names if available
    const result = window._lastCLOOMCResult;
    if (result && result.methods) {
        const publicMethods = result.methods.filter(m => (m.visibility || 'public') === 'public' && m.name !== 'Dispatch');
        if (pin.kind === 'dr' && pin.idx >= 1 && pin.idx <= 6) {
            // Try to find the most recent method's param name for this DR index
            const argIdx = pin.idx - 1; // DR1 → param 0
            const paramSets = publicMethods.map(m => (m.params || [])[argIdx]).filter(Boolean);
            if (paramSets.length > 0 && paramSets.every(p => p === paramSets[0])) {
                return paramSets[0]; // all methods agree on the name
            }
        }
    }
    return labels[pinName] || pinName;
}

// Called by updateDashboard() in app-tools.js after every Step.
function renderWatchStrip() {
    if (!sim) return;
    const el = document.getElementById('watchStrip');
    if (!el) return;

    const hasAbs = !!(window._lastCLOOMCResult && window._lastCLOOMCResult.methods);
    if (!hasAbs && !sim.bootComplete) { el.innerHTML = ''; return; }

    let html = '<div class="watch-strip-inner">';

    for (const name of _watchPins) {
        const pin = _parseRegPin(name);
        if (!pin) continue;
        const val = _readPin(pin);
        const prev = _prevWatchValues[name];
        const changed = prev !== undefined && prev !== val;
        const hex = '0x' + (val >>> 0).toString(16).toUpperCase().padStart(8, '0');
        const dec = val >>> 0;

        // Special highlight: DR0 after a RETURN (checked via last step opcode)
        const isReturn = window._lastStepWasReturn && name === 'DR0';

        const cls = isReturn ? 'watch-chip watch-chip-return'
                  : changed  ? 'watch-chip watch-chip-changed'
                  :            'watch-chip';

        const lbl = _pinLabel(name, pin);
        html += `<div class="${cls}" title="${name} = ${hex} (${dec})">`;
        html += `<span class="watch-chip-name">${name}</span>`;
        if (lbl !== name) html += `<span class="watch-chip-label">${lbl}</span>`;
        html += `<span class="watch-chip-val">${hex}</span>`;
        html += `<button class="watch-chip-rm" onclick="removeWatchPin('${name}')" title="Unpin ${name}">&times;</button>`;
        html += '</div>';
    }

    // "+ Add" button
    html += `<button class="watch-add-btn" onclick="promptAddWatchPin()" title="Pin a register to the watch strip">+ Pin</button>`;
    html += '</div>';

    el.innerHTML = html;
    // Snapshot current values for change detection on the next step
    for (const name of _watchPins) {
        const pin = _parseRegPin(name);
        if (pin) _prevWatchValues[name] = _readPin(pin);
    }
}

function addWatchPin(name) {
    const u = name.trim().toUpperCase();
    if (!_parseRegPin(u)) return;
    if (_watchPins.includes(u)) return;
    _watchPins.push(u);
    renderWatchStrip();
}

function removeWatchPin(name) {
    _watchPins = _watchPins.filter(p => p !== name);
    renderWatchStrip();
}

function promptAddWatchPin() {
    const name = prompt('Pin a register to the watch strip.\nExamples: DR0, DR1, CR6, CR8');
    if (name) addWatchPin(name.trim());
}

// ─── Invoke Method button ─────────────────────────────────────────────────────
function refreshInvokeBtn() {
    const btn = document.getElementById('btnInvokeMethod');
    if (!btn) return;
    const canInvoke = !!(sim && sim.bootComplete && window._lastCLOOMCResult && window._lastCLOOMCResult.methods);
    btn.style.display = canInvoke ? '' : 'none';
}

// ─── Invoke Method modal ──────────────────────────────────────────────────────
let _invokeMethodIdx = 0;
let _invokeTrigger = null;
let _invokeTrap = null;

function openInvokeModal() {
    const result = window._lastCLOOMCResult;
    if (!result || !result.methods) return;

    // Populate method dropdown (skip Dispatch / M00 — user calls named methods)
    const methods = result.methods.filter(m => m.name !== 'Dispatch' && m.name !== 'M00');
    const sel = document.getElementById('invokeMethodSel');
    if (!sel) return;
    sel.innerHTML = methods.map((m, i) =>
        `<option value="${result.methods.indexOf(m)}">${m.name}(${(m.params || []).join(', ')})</option>`
    ).join('');

    _invokeMethodIdx = result.methods.indexOf(methods[0]);
    sel.value = _invokeMethodIdx;
    _renderInvokeParams();

    _invokeTrigger = document.activeElement;
    document.getElementById('invokeDialog').style.display = 'flex';
    if (!_invokeTrap) _invokeTrap = _makeModalFocusTrap('invokeDialog', closeInvokeModal);
    document.addEventListener('keydown', _invokeTrap, true);
    if (sel) sel.focus();
}

function closeInvokeModal() {
    const d = document.getElementById('invokeDialog');
    if (d) d.style.display = 'none';
    if (_invokeTrap) document.removeEventListener('keydown', _invokeTrap, true);
    if (_invokeTrigger && _invokeTrigger.isConnected) _invokeTrigger.focus();
    _invokeTrigger = null;
}

function _isCapabilityParam(paramName, capabilities) {
    const lp = paramName.toLowerCase();
    // Heuristic: names that suggest a Golden Token / capability handle
    if (lp === 'gt' || lp.endsWith('_gt') || lp.endsWith('_token') ||
        lp.endsWith('_cap') || lp.endsWith('_handle') || lp.endsWith('_cred')) return true;
    // If the param name (stripped of prefix) matches a known capability
    if (capabilities) {
        for (const cap of capabilities) {
            if (lp.includes(cap.toLowerCase())) return true;
        }
    }
    return false;
}

function _renderInvokeParams() {
    const result = window._lastCLOOMCResult;
    if (!result) return;
    const sel = document.getElementById('invokeMethodSel');
    if (!sel) return;
    const idx = parseInt(sel.value);
    _invokeMethodIdx = idx;
    const method = result.methods[idx];
    if (!method) return;

    const params = method.params || [];
    const caps = result.capabilities || [];
    const container = document.getElementById('invokeParams');
    if (!container) return;

    if (params.length === 0) {
        container.innerHTML = '<div class="invoke-no-params">No parameters — DR0 = selector will be set.</div>';
        return;
    }

    let drIdx = 1; // DR1, DR2, ... for integer params
    let crIdx = 8; // CR8, CR9, ... for capability params (above demo c-list)
    let html = '';
    for (const p of params) {
        const isCap = _isCapabilityParam(p, caps);
        const regName = isCap ? `CR${crIdx++}` : `DR${drIdx++}`;
        const hint = isCap
            ? 'Golden Token — enter word0 in hex (e.g. 0x10001234)'
            : 'Integer value';
        html += `<div class="invoke-param-row">`;
        html += `<label class="invoke-param-label">`;
        html += `  <span class="invoke-param-name">${p}</span>`;
        html += `  <span class="invoke-param-reg">${regName}</span>`;
        html += `</label>`;
        html += `<input class="invoke-param-input" type="text" placeholder="${hint}" data-reg="${regName}" data-param="${p}" value="0">`;
        html += `</div>`;
    }
    container.innerHTML = html;

    // Auto-pin any new registers to the watch strip
    drIdx = 1; crIdx = 8;
    for (const p of params) {
        const isCap = _isCapabilityParam(p, caps);
        const regName = isCap ? `CR${crIdx++}` : `DR${drIdx++}`;
        addWatchPin(regName);
    }
    if (!_watchPins.includes('DR0')) _watchPins.unshift('DR0');
}

function invokeSetupCall() {
    const result = window._lastCLOOMCResult;
    if (!result) return;
    const method = result.methods[_invokeMethodIdx];
    if (!method) return;

    // DR0 = method selector (its index in the method table)
    sim.dr[0] = _invokeMethodIdx >>> 0;

    // Apply each parameter input
    const inputs = document.querySelectorAll('#invokeParams .invoke-param-input');
    inputs.forEach(input => {
        const reg = input.dataset.reg;
        const rawVal = input.value.trim();
        const val = rawVal.startsWith('0x') || rawVal.startsWith('0X')
            ? parseInt(rawVal, 16)
            : parseInt(rawVal, 10);
        const numVal = isNaN(val) ? 0 : (val >>> 0);

        const pin = _parseRegPin(reg);
        if (!pin) return;
        if (pin.kind === 'dr') {
            sim.dr[pin.idx] = numVal;
        } else if (pin.kind === 'cr') {
            // Write word0 of the CR (the GT word that holds the tag/NS index)
            if (!sim.cr[pin.idx]) sim.cr[pin.idx] = { word0:0, word1:0, word2:0, word3:0 };
            sim.cr[pin.idx].word0 = numVal;
        }
        // Ensure the register is pinned so the user can see it change
        addWatchPin(reg.toUpperCase());
    });

    updateDashboard();
    closeInvokeModal();

    // Surface the DR panel so the user can see the configured registers
    if (typeof switchDashTab === 'function') switchDashTab('dr');
}
