window.Ti60Connect = (function () {
    const BAUD           = 57600;
    const STEPS          = ['uart', 'callhome', 'register', 'release'];
    const DEFAULT_BRIDGE = 'https://penguin.linux.test:8766';

    let _port    = null;
    let _reader  = null;
    let _running = false;
    let _bridgeRunning = false;
    let _tunnelMode    = false;
    let _bridgeEverConfirmed = localStorage.getItem('ti60BridgeCertAccepted') === '1';
    let _detectedPort  = null;
    let _streamLineCount = 0;
    let _bootLump = null;
    let _bootRom  = null;
    let _activeBaud = BAUD;

    // ── helpers ────────────────────────────────────────────────────────────
    function _log(msg, cls) {
        const log = document.getElementById('ti60ConnectLog');
        if (!log) return;
        const line = document.createElement('div');
        line.className = 'ti60-log-line' + (cls ? ' ' + cls : '');
        line.textContent = new Date().toLocaleTimeString() + '  ' + msg;
        log.appendChild(line);
        log.scrollTop = log.scrollHeight;
    }

    function _logHtml(html) {
        const log = document.getElementById('ti60ConnectLog');
        if (!log) return;
        const line = document.createElement('div');
        line.className = 'ti60-log-line';
        line.innerHTML = html;
        log.appendChild(line);
        log.scrollTop = log.scrollHeight;
    }

    function _streamLog(text, cls) {
        const body = document.getElementById('ti60NiaStreamBody');
        if (!body) return;
        const line = document.createElement('div');
        line.className = 'ti60-stream-line' + (cls ? ' ' + cls : '');
        line.textContent = text;
        body.appendChild(line);
        while (body.children.length > 500) body.removeChild(body.firstChild);
        body.scrollTop = body.scrollHeight;
        _streamLineCount++;
        const cnt = document.getElementById('ti60NiaStreamCount');
        if (cnt) cnt.textContent = _streamLineCount + ' line' + (_streamLineCount === 1 ? '' : 's');
    }

    function _expandPolBody() {
        const body = document.getElementById('ti60PolBody');
        const chev = document.getElementById('ti60PolChev');
        if (body && body.style.display === 'none') {
            body.style.display = '';
            if (chev) chev.textContent = '▾';
        }
    }

    function _showStreamPanel() {
        _expandPolBody();
        const p = document.getElementById('ti60NiaStreamPanel');
        if (p) p.style.display = '';
    }

    function _hideStreamPanel() {
        const p = document.getElementById('ti60NiaStreamPanel');
        if (p) p.style.display = 'none';
        const body = document.getElementById('ti60NiaStreamBody');
        if (body) body.innerHTML = '';
        const cnt = document.getElementById('ti60NiaStreamCount');
        if (cnt) cnt.textContent = '0 lines';
        _streamLineCount = 0;
    }

    function _setStep(step, state, detail) {
        const el     = document.getElementById('ti60Step-' + step);
        const status = document.getElementById('ti60StepStatus-' + step);
        if (!el) return;
        el.className = 'ti60-step ti60-step-' + state;
        if (status) {
            status.textContent =
                state === 'pass'   ? '✓' :
                state === 'fail'   ? '✗' :
                state === 'active' ? '…' : '—';
        }
        if (detail) _log(detail, state === 'pass' ? 'log-pass' : state === 'fail' ? 'log-fail' : '');
    }

    function _setActivePort(label) {
        const row = document.getElementById('ti60ActivePortRow');
        const val = document.getElementById('ti60ActivePortValue');
        if (!row || !val) return;
        if (label) { val.textContent = label; row.style.display = ''; }
        else        { val.textContent = '';    row.style.display = 'none'; }
    }

    function _reset() {
        STEPS.forEach(s => _setStep(s, 'pending'));
        _setActivePort(null);
        const log = document.getElementById('ti60ConnectLog');
        if (log) log.innerHTML = '';
        const sBanner = document.getElementById('ti60SuccessBanner');
        if (sBanner) sBanner.style.display = 'none';
        _hideStreamPanel();
        const btn  = document.getElementById('ti60ConnectBtn');
        if (btn)  { btn.disabled = false; btn.textContent = '🔌 Connect Board'; }
        const bBtn = document.getElementById('ti60BridgeBtn');
        if (bBtn) { bBtn.disabled = false; bBtn.textContent = '🌉 Via Bridge'; }
        const dBtn = document.getElementById('ti60DisconnectBtn');
        if (dBtn) dBtn.style.display = 'none';
    }

    // ── Bridge helpers ─────────────────────────────────────────────────────
    async function _fetchPorts(url) {
        try {
            const r = await fetch(url + '/ports', { signal: AbortSignal.timeout(3000) });
            const d = await r.json();
            if (d.ok && Array.isArray(d.ports) && d.ports.length > 0) return d.ports;
        } catch (_e) {}
        return null;
    }

    function _pickBestPort(ports) {
        if (!ports || ports.length === 0) return null;
        return ports.find(p => p === '/dev/ttyUSB2') || ports[0];
    }

    function _updateRunCmds(port) {
        const p   = port || '/dev/ttyUSB2';
        const ide = window.location.origin;
        const cmd = 'cd ~/church_project/SoC/church-machine\npython3 server/local_bridge.py ' + p + ' 57600 8766 --ide=' + ide + ' --insecure';
        ['ti60SetupBridgeCmd', 'ti60BridgeCmd'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.textContent = cmd;
        });
    }

    function _showBridgeSetup() {
        const panel = document.getElementById('ti60BridgeSetupPanel');
        if (!panel) return;
        const url  = _bridgeUrl();
        const link = document.getElementById('ti60SetupCertLink');
        if (link) { link.href = url + '/status'; link.textContent = url + '/status'; }
        panel.style.display = '';
    }

    function _hideBridgeSetup() {
        const panel = document.getElementById('ti60BridgeSetupPanel');
        if (panel) panel.style.display = 'none';
    }

    function _bridgeUrl() {
        const inp = document.getElementById('ti60BridgeUrl');
        const v   = (inp ? inp.value : '').trim();
        return v || DEFAULT_BRIDGE;
    }

    function _updateForgetBtnVisibility() {
        const btn = document.querySelector('.ti60-forget-bridge-btn');
        if (btn) btn.style.display = _bridgeEverConfirmed ? '' : 'none';
    }

    // ── Server forwarding (WebSerial → IDE server) ─────────────────────────
    // Every CALLHOME, TRACE, FAULT_EVENT, and HUNG packet received from the
    // board over WebSerial is forwarded to the IDE server so the Dashboard,
    // Fault Log, and call-home history stay live without a bridge script.

    async function _forwardCallhome(pkt) {
        try {
            await fetch('/api/device/call-home', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_uid:  pkt.uid,
                    board_type:  pkt.board,
                    fw_major:    pkt.fw_major    || 1,
                    fw_minor:    pkt.fw_minor    || 0,
                    boot_reason: pkt.boot_reason || 0,
                    last_fault:  pkt.fault       || 0,
                    fault_nia:   0,
                    nia:         pkt.nia         || '0x0',
                    boot_ok:     pkt.boot_ok,
                    fault_code:  pkt.fault_code  || 0,
                    fault_name:  pkt.fault_name  || '',
                    ns_manifest: pkt.ns_manifest || [],
                    ts:          pkt.ts          || (Date.now() / 1000),
                }),
            });
        } catch (_e) {}
    }

    async function _forwardTrace(line) {
        // line: TRACE:[0x00000004,0x00000004,...]
        try {
            const raw = line.slice('TRACE:'.length).trim();
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr) || arr.length === 0) return;
            const uid = _lastUid;
            if (!uid) return;
            await fetch('/api/device/trace', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_uid: uid,
                    nia_trace:  arr,
                    ts:         Date.now() / 1000,
                }),
            });
        } catch (_e) {}
    }

    async function _forwardFault(line) {
        // line: FAULT_EVENT:{...}
        try {
            const raw = line.slice('FAULT_EVENT:'.length).trim();
            const pkt = JSON.parse(raw);
            if (!pkt || !pkt.uid) return;
            await fetch('/api/device/fault', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_uid:  pkt.uid,
                    nia:         pkt.nia          || '0x0',
                    fault_code:  pkt.fault_code   || 0,
                    fault_name:  pkt.fault_name   || '',
                    fault_gt:    pkt.fault_gt     || '0x00000000',
                    fault_instr: pkt.fault_instr  || '0x00000000',
                    fault_cr14:  pkt.fault_cr14   || '0x00000000',
                    fault_stage: pkt.fault_stage  || 0,
                    ts:          pkt.ts           || (Date.now() / 1000),
                }),
            });
        } catch (_e) {}
    }

    async function _forwardHung(line) {
        // line: HUNG:{...}
        try {
            const raw = line.slice('HUNG:'.length).trim();
            const pkt = JSON.parse(raw);
            if (!pkt || !pkt.uid) return;
            await fetch('/api/device/call-home', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_uid:  pkt.uid,
                    board_type:  pkt.board || 'Ti60F225',
                    nia:         pkt.nia   || '0x0',
                    boot_ok:     1,
                    hung:        true,
                    hung_loops:  pkt.loops || 0,
                    ts:          pkt.ts    || (Date.now() / 1000),
                }),
            });
        } catch (_e) {}
    }

    // ── Shared IDE calls ───────────────────────────────────────────────────
    let _lastUid = null;

    function _parseCallhome(line) {
        if (!line.startsWith('CALLHOME:')) return null;
        try {
            const pkt = JSON.parse(line.slice('CALLHOME:'.length));
            const req = ['board', 'uid', 'nia', 'boot_ok', 'fault', 'fault_code'];
            return req.every(k => k in pkt) ? pkt : null;
        } catch (e) { return null; }
    }

    async function _registerWithIDE(pkt) {
        const r = await fetch('/api/device/call-home', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                device_uid:  pkt.uid,
                board_type:  pkt.board,
                fw_major:    pkt.fw_major    || 1,
                fw_minor:    pkt.fw_minor    || 0,
                boot_reason: pkt.boot_reason || 0,
                last_fault:  pkt.fault       || 0,
                fault_nia:   0,
                nia:         pkt.nia         || '0x0',
                boot_ok:     pkt.boot_ok,
                fault_code:  pkt.fault_code  || 0,
                fault_name:  pkt.fault_name  || '',
                ns_manifest: pkt.ns_manifest || [],
                ts:          pkt.ts          || (Date.now() / 1000),
            }),
        });
        return await r.json();
    }

    async function _reportLaunchTest(status, notes) {
        try {
            const r = await fetch('/api/launch-tests/TEST-09', {
                method:  'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status, device_uid: '', notes }),
            });
            const d = await r.json();
            return d.ok === true;
        } catch (_e) { return false; }
    }

    async function _confirmLaunchTest() {
        try {
            const r = await fetch('/api/launch-tests');
            const d = await r.json();
            const t09 = (d.tests || []).find(t => t.test_id === 'TEST-09');
            return t09 && t09.status === 'passing';
        } catch (_e) { return false; }
    }

    async function _finishSteps(pkt, greetingSeen, skipRegister) {
        if (!greetingSeen) {
            _setStep('uart', 'pass', 'Board detected via CALLHOME (board=' + pkt.board + ')');
        }
        if (pkt.boot_ok !== 1) {
            _setStep('callhome', 'fail', 'boot_ok=' + pkt.boot_ok + '  fault_code=' + pkt.fault_code + ' — firmware booted with fault');
            return;
        }
        if (typeof window._r1SetStep === 'function') window._r1SetStep(1);
        _setStep('callhome', 'pass',
            'CALLHOME valid: board=' + pkt.board +
            ' fw=' + (pkt.fw_major || 1) + '.' + (pkt.fw_minor || 0) +
            ' nia=' + pkt.nia);
        _setStep('register', 'active');

        try {
            let reg;
            if (skipRegister) {
                reg = { ok: true, boot_count: pkt.boot_count };
            } else {
                reg = await _registerWithIDE(pkt);
            }
            if (reg.ok) {
                const bootNum = reg.boot_count != null ? '  boot #' + reg.boot_count : '';
                _setStep('register', 'pass', 'Device registered in IDE (uid=' + pkt.uid + ')' + bootNum);
                if (typeof window._r1SetStep === 'function') window._r1SetStep(2);
                _setStep('release', 'active');
                await _reportLaunchTest('passing', 'Ti60 CALLHOME confirmed');
                const confirmed = await _confirmLaunchTest();
                if (confirmed) {
                    _setStep('release', 'pass', 'TEST-09 confirmed passing in IDE ✅');
                    const sBanner = document.getElementById('ti60SuccessBanner');
                    if (sBanner) sBanner.style.display = '';
                } else {
                    _setStep('release', 'fail', 'TEST-09 not confirmed in IDE DB');
                }
            } else {
                _setStep('register', 'fail', 'IDE registration returned ok:false');
            }
        } catch (e) {
            _setStep('register', 'fail', 'IDE call failed: ' + e.message);
        }
    }

    // ── WebSerial ──────────────────────────────────────────────────────────
    function _isIframe() {
        try { return window.self !== window.top; } catch (e) { return true; }
    }

    function _showIframeBanner() {
        const banner = document.getElementById('ti60IframeBanner');
        if (banner) {
            banner.style.display = 'flex';
            banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    function _noSerial() {
        const log = document.getElementById('ti60ConnectLog');
        if (!log) return;
        log.innerHTML = '';
        if (_isIframe()) {
            _logHtml(
                '<strong>WebSerial is not available inside a preview iframe.</strong><br>' +
                'Click <strong>Open in full tab →</strong> above to connect directly via USB.'
            );
        } else {
            _logHtml(
                '<strong>WebSerial not supported.</strong> ' +
                'Use Chrome or Edge 89+.'
            );
        }
        const btn = document.getElementById('ti60ConnectBtn');
        if (btn) { btn.disabled = false; btn.textContent = '🔌 Connect Board'; }
    }

    const _isCrOS = /CrOS/.test(navigator.userAgent);
    let _crosPickerTipShown = false;

    async function _readLoop() {
        let greetingSeen = false;
        let registered   = false;
        let lastNia      = null;

        while (_running) {
            const _textDecoder = new TextDecoder();
            _reader = _port.readable.getReader();

            let buf      = '';
            let hitBreak = false;

            try {
                while (_running) {
                    const { value, done } = await _reader.read();
                    if (done) {
                        if (_running) {
                            _log('⚠ Serial port closed unexpectedly.', 'log-warn');
                            _running = false;
                            _reset();
                        }
                        break;
                    }
                    buf += _textDecoder.decode(value, { stream: true });
                    const lines = buf.split('\n');
                    buf = lines.pop();

                    for (const raw of lines) {
                        const line = raw.replace(/\r$/, '').trim();
                        if (!line) continue;

                        // ── greeting ──
                        if (line.includes('CHURCH Ti60 SoC+CM') && !greetingSeen) {
                            greetingSeen = true;
                            _setStep('uart', 'pass', 'Greeting: ' + line);
                            _setStep('callhome', 'active');
                        }

                        // ── first CALLHOME → register ──
                        if (line.startsWith('CALLHOME:') && !registered) {
                            const pkt = _parseCallhome(line);
                            if (pkt) {
                                registered = true;
                                _lastUid   = pkt.uid;
                                await _finishSteps(pkt, greetingSeen);
                                _showStreamPanel();
                                _fetchBootLump();
                                _fetchBootRom();
                            }

                        // ── HUNG before first CALLHOME → register via HUNG ──
                        } else if (line.startsWith('HUNG:') && !registered) {
                            try {
                                const h = JSON.parse(line.slice('HUNG:'.length));
                                if (h && h.uid) {
                                    if (!greetingSeen) {
                                        greetingSeen = true;
                                        _setStep('uart', 'pass',
                                            'Board detected (already running, uid=' + h.uid + ')');
                                        _setStep('callhome', 'active');
                                    }
                                    registered = true;
                                    _lastUid   = h.uid;
                                    _log('Board already booted — registering via HUNG packet', 'log-warn');
                                    const syntheticPkt = {
                                        uid: h.uid, board: h.board || 'Ti60F225',
                                        nia: h.nia || '0x0',
                                        boot_ok: 1, fault: 0, fault_code: 0,
                                    };
                                    await _finishSteps(syntheticPkt, true);
                                    _showStreamPanel();
                                    _fetchBootLump();
                                    _fetchBootRom();
                                    await _forwardHung(line);
                                }
                            } catch (_e) {}

                        // ── ongoing stream after registration ──
                        } else if (registered) {
                            // Forward everything that the bridge would forward
                            if (line.startsWith('CALLHOME:')) {
                                const newPkt = _parseCallhome(line);
                                if (newPkt) {
                                    _log('⟳ Board reboot detected', 'log-warn');
                                    _streamLog('── REBOOT ──', 'sl-boot');
                                    lastNia = null;
                                    _lastUid = newPkt.uid;
                                    await _forwardCallhome(newPkt);
                                    await _finishSteps(newPkt, true, true);
                                }
                            } else if (line.startsWith('FAULT_EVENT:')) {
                                _streamLog('⚡ ' + line, 'sl-fault');
                                _log('⚡ ' + line, 'log-warn');
                                await _forwardFault(line);
                            } else if (line.startsWith('TRACE:')) {
                                _streamLog(line, 'sl-trace');
                                await _forwardTrace(line);
                            } else if (line.startsWith('HUNG:')) {
                                _streamLog('🔄 ' + line, 'sl-hung');
                                _log('🔄 Hung: ' + line, 'log-warn');
                                await _forwardHung(line);
                            } else {
                                const niaMatch = line.match(/\bNIA=0x([0-9A-Fa-f]+)/i);
                                if (niaMatch) {
                                    const nia    = '0x' + niaMatch[1].toUpperCase().padStart(8, '0');
                                    const niaNum = parseInt(niaMatch[1], 16);
                                    const anno   = _decodeNIA(niaNum, _bootRom, _bootLump);
                                    const label  = anno ? 'NIA → ' + nia + '  ' + anno
                                                        : 'NIA → ' + nia;
                                    _streamLog(label, 'sl-nia');
                                    if (nia !== lastNia) {
                                        lastNia = nia;
                                        _log('NIA → ' + nia + (anno ? '  ' + anno : ''), 'log-nia');
                                    }
                                } else {
                                    _streamLog('← ' + line);
                                    _log('← ' + line);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                if (!_running) break;
                const isBreak = e.message && /break/i.test(e.message);
                if (isBreak) {
                    _log('Board reset detected — waiting for firmware…', 'log-warn');
                    greetingSeen = false;
                    registered   = false;
                    lastNia      = null;
                    hitBreak     = true;
                } else {
                    _log('Read error: ' + e.message, 'log-fail');
                }
            } finally {
                try { _reader.releaseLock(); } catch (_) {}
                _reader = null;
            }

            if (!_running || !hitBreak) break;

            try {
                await _port.close();
                await new Promise(r => setTimeout(r, 400));
                await _port.open({ baudRate: _activeBaud || BAUD });
            } catch (reErr) {
                _log('Reconnect failed: ' + reErr.message, 'log-fail');
                _running = false;
                _reset();
                break;
            }
        }
    }

    async function connect() {
        if (_isIframe()) {
            _showIframeBanner();
            const log = document.getElementById('ti60ConnectLog');
            if (!log || !log.textContent.includes('not available inside a preview')) {
                _log('WebSerial is not available inside a preview iframe.', 'log-warn');
                _log('Click "Open in full tab →" above for direct USB access.', 'log-warn');
            }
            return;
        }
        if (_port) {
            _running = false;
            try { if (_reader) { await _reader.cancel(); } } catch (e) {}
            _reader = null;
            try { await _port.close(); } catch (e) {}
            _port = null;
        }
        _reset();
        if (!('serial' in navigator)) { _noSerial(); return; }

        const btn = document.getElementById('ti60ConnectBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }

        if (_isCrOS && !_crosPickerTipShown) {
            _crosPickerTipShown = true;
            _log('💡 ChromeOS tip: the board must NOT be shared with Linux. Go to Settings → Linux → USB devices → FT4232H → turn OFF, then try again.', 'log-warn');
        }

        try {
            _port = await navigator.serial.requestPort({});
        } catch (e) {
            _log('Port selection cancelled.', 'log-fail');
            if (_isCrOS) {
                _log('💡 ChromeOS: make sure the FT4232H is NOT shared with Linux (Settings → Linux → USB devices → turn OFF). Or use 🌉 Via Bridge in Advanced / Troubleshooting below.', 'log-warn');
            }
            if (btn) { btn.disabled = false; btn.textContent = '🔌 Connect Board'; }
            return;
        }

        try {
            await _port.open({ baudRate: BAUD });
        } catch (e) {
            _log('Failed to open port: ' + e.message, 'log-fail');
            if (e.message && /busy|in use/i.test(e.message)) {
                _log('💡 Port is busy — close screen/minicom/any other serial app, then retry.', 'log-warn');
            }
            _setStep('uart', 'fail', 'Port open failed: ' + e.message);
            if (btn) { btn.disabled = false; btn.textContent = '🔌 Connect Board'; }
            return;
        }

        _activeBaud = BAUD;
        _setStep('uart', 'active');
        _log('Port open at 57600 baud — waiting for firmware…');
        const dBtn = document.getElementById('ti60DisconnectBtn');
        if (dBtn) dBtn.style.display = '';

        _running = true;
        _readLoop().catch(e => _log('Loop error: ' + e.message, 'log-fail'));
    }

    async function disconnect() {
        _running       = false;
        _bridgeRunning = false;
        _tunnelMode    = false;
        try { if (_reader) await _reader.cancel(); } catch (e) {}
        _reader = null;
        try { if (_port)   await _port.close();   } catch (e) {}
        _port   = null;
        _setActivePort(null);
        _log('Disconnected.');
        const btn  = document.getElementById('ti60ConnectBtn');
        if (btn)  { btn.disabled = false; btn.textContent = '🔌 Connect Board'; }
        const bBtn = document.getElementById('ti60BridgeBtn');
        if (bBtn) { bBtn.disabled = false; bBtn.textContent = '🌉 Via Bridge'; }
        const dBtn = document.getElementById('ti60DisconnectBtn');
        if (dBtn) dBtn.style.display = 'none';
        _hideStreamPanel();
    }

    // ── Bridge diagnostics ─────────────────────────────────────────────────
    async function testBridge() {
        const tBtn = document.getElementById('ti60TestBridgeBtn');
        if (tBtn) tBtn.disabled = true;
        if (!_bridgeEverConfirmed) _showBridgeSetup();
        const url = _bridgeUrl();
        _log('Testing bridge at ' + url + ' …');
        try {
            const r = await fetch(url + '/status', { signal: AbortSignal.timeout(5000) });
            const d = await r.json();
            if (d.ok) {
                _bridgeEverConfirmed = true;
                localStorage.setItem('ti60BridgeCertAccepted', '1');
                localStorage.setItem('ti60BridgeUrl', url);
                _updateForgetBtnVisibility();
                const ports = await _fetchPorts(url);
                const best  = _pickBestPort(ports);
                if (best) { _detectedPort = best; _updateRunCmds(best); }
                _hideBridgeSetup();
                _log('✓ Bridge is reachable. Port open: ' + d.open +
                     (d.port ? '  (' + d.port + ')' : ''), 'log-pass');
                if (ports && ports.length > 0) {
                    _log('Available serial ports: ' + ports.join(', ') +
                         (best ? '  → will use ' + best : ''), '');
                }
                if (!d.open) {
                    _log('Port is not open — bridge will try to open it when you click Via Bridge.', '');
                }
            } else {
                _log('Bridge responded but ok=false: ' + JSON.stringify(d), 'log-fail');
                _showBridgeSetup();
            }
        } catch (e) {
            _log('✗ Bridge not reachable: ' + (e.message || String(e)), 'log-fail');
            _showBridgeSetup();
        }
        if (tBtn) tBtn.disabled = false;
    }

    async function retryBridge() {
        await testBridge();
    }

    // ── Bridge tunnel mode ─────────────────────────────────────────────────
    async function connectViaBridge() {
        _reset();
        _tunnelMode    = true;
        _bridgeRunning = true;
        const bBtn = document.getElementById('ti60BridgeBtn');
        const dBtn = document.getElementById('ti60DisconnectBtn');
        if (bBtn) { bBtn.disabled = true; bBtn.textContent = 'Waiting…'; }
        if (dBtn) dBtn.style.display = '';

        _setStep('uart', 'active');
        _log('Waiting for board to call home via the bridge tunnel…');
        _log('(If the board has already booted, power-cycle it now to resend CALLHOME)');

        let pkt = null;
        try {
            const r = await fetch('/api/device/latest-callhome?since=0');
            const d = await r.json();
            if (d.ok && d.callhome) {
                pkt = d.callhome;
                const age    = Math.round((Date.now() / 1000) - (pkt.ts || 0));
                const ageStr = age < 60 ? age + ' s' : Math.round(age / 60) + ' min';
                _log('✓ Board already registered — last CALLHOME ' + ageStr + ' ago (uid=' + pkt.uid + ')');
            }
        } catch (_e) {}

        const deadline = Date.now() + 90000;
        if (!pkt) _log('No existing registration — waiting for board to send CALLHOME (power-cycle the board)…');
        while (_bridgeRunning && Date.now() < deadline && !pkt) {
            await new Promise(r => setTimeout(r, 500));
            try {
                const r = await fetch('/api/device/latest-callhome?since=0');
                const d = await r.json();
                if (d.ok && d.callhome) pkt = d.callhome;
            } catch (e) {
                if (_bridgeRunning) _log('⚠ Server poll error: ' + e.message, 'log-warn');
            }
        }

        if (!_bridgeRunning) return;

        if (!pkt) {
            _setStep('callhome', 'fail', 'No CALLHOME received in 90 s — is the bridge running with --ide=<URL>?');
            _log('Start the bridge with:', 'log-warn');
            _log('  python3 server/local_bridge.py /dev/ttyUSB2 57600 8766 --ide=' + window.location.origin, 'log-warn');
            _bridgeRunning = false;
            if (bBtn) { bBtn.disabled = false; bBtn.textContent = '🌉 Via Bridge'; }
            if (dBtn) dBtn.style.display = 'none';
            return;
        }

        _setStep('uart', 'pass', 'Bridge tunnel active — board=' + pkt.board + '  uid=' + pkt.uid);
        await _finishSteps(pkt, /*greetingSeen=*/true, /*skipRegister=*/true);
        await _niaTunnelStream(pkt.uid, bBtn, dBtn);
    }

    async function _niaTunnelStream(uid, bBtn, dBtn) {
        let buf     = '';
        let lastNia = null;
        _log('— Live NIA stream active via server tunnel — (Disconnect to stop)', 'log-pass');
        _log('💡 No output yet? Power-cycle the board (unplug/replug USB) to capture the boot stream.', 'log-warn');
        _fetchBootLump();
        _fetchBootRom();
        _showStreamPanel();
        while (_bridgeRunning) {
            await new Promise(r => setTimeout(r, 400));
            try {
                const dr = await fetch('/api/device/pull-drain/' + uid,
                    { signal: AbortSignal.timeout(10000) });
                const dd = await dr.json();
                if (dd.bytes && dd.bytes.length) {
                    buf += String.fromCharCode(...dd.bytes);
                    const lines = buf.split('\n');
                    buf = lines.pop();
                    for (const raw of lines) {
                        const line = raw.replace(/\r$/, '').trim();
                        if (!line) continue;
                        const niaMatch = line.match(/\bNIA=0x([0-9A-Fa-f]+)/i);
                        if (niaMatch) {
                            const nia    = '0x' + niaMatch[1].toUpperCase().padStart(8, '0');
                            const niaNum = parseInt(niaMatch[1], 16);
                            const anno   = _decodeNIA(niaNum, _bootRom, _bootLump);
                            const label  = anno ? 'NIA → ' + nia + '  ' + anno : 'NIA → ' + nia;
                            _streamLog(label, 'sl-nia');
                            if (nia !== lastNia) {
                                lastNia = nia;
                                _log('NIA → ' + nia + (anno ? '  ' + anno : ''), 'log-nia');
                            }
                            continue;
                        }
                        if (line.startsWith('CALLHOME:')) {
                            const newPkt = _parseCallhome(line);
                            if (newPkt) {
                                _log('⟳ Board reboot detected', 'log-warn');
                                _streamLog('── REBOOT ──', 'sl-boot');
                                lastNia = null;
                                await _finishSteps(newPkt, true, true);
                            }
                        } else {
                            _streamLog('← ' + line);
                            _log('← ' + line);
                        }
                    }
                }
            } catch (e) {
                if (!_bridgeRunning) break;
                const transient = e.name === 'TimeoutError' || e.name === 'AbortError' ||
                                  e.name === 'TypeError'    || e.name === 'NetworkError';
                if (transient) { await new Promise(r => setTimeout(r, 1000)); continue; }
                _log('⚠ Stream stopped: ' + e.message, 'log-warn');
                break;
            }
        }
        _bridgeRunning = false;
        _tunnelMode    = false;
        _hideStreamPanel();
        if (bBtn) { bBtn.disabled = false; bBtn.textContent = '🌉 Via Bridge'; }
        if (dBtn) dBtn.style.display = 'none';
    }

    function copyBridgeCmd() {
        const pre = document.getElementById('ti60BridgeCmd');
        if (!pre) return;
        const text = pre.textContent;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                const btn = document.querySelector('.ti60-bridge-cmd-copy');
                if (btn) {
                    btn.innerHTML = '&#x2713; Copied';
                    setTimeout(function () { btn.innerHTML = '&#x1F4CB; Copy'; }, 1800);
                }
            }).catch(function () { _log('Copy failed — select the command and copy manually.', 'log-warn'); });
        } else {
            _log('Clipboard API not available — select the command and copy manually.', 'log-warn');
        }
    }

    function resetBridgeCert() {
        localStorage.removeItem('ti60BridgeCertAccepted');
        _bridgeEverConfirmed = false;
        _updateForgetBtnVisibility();
        _log('Bridge cert memory cleared — setup guide will reappear on next connection attempt.');
    }

    // ── Boot LUMP disassembler helpers ─────────────────────────────────────
    async function _fetchBootLump() {
        try {
            const r = await fetch('/api/boot-lump-words', { signal: AbortSignal.timeout(5000) });
            const d = await r.json();
            if (d.ok) { _bootLump = d; return d; }
        } catch (_e) {}
        _bootLump = null;
        return null;
    }

    async function _fetchBootRom() {
        try {
            const r = await fetch('/api/boot-rom-words', { signal: AbortSignal.timeout(5000) });
            const d = await r.json();
            if (d.ok) { _bootRom = d; return d; }
        } catch (_e) {}
        _bootRom = null;
        return null;
    }

    function _decodeNIA(niaNum, bootRom, lump) {
        let word        = null;
        let activeClist = null;

        if (bootRom && bootRom.rom && (niaNum & 3) === 0) {
            const romIdx = niaNum >>> 2;
            if (romIdx < bootRom.rom.length) {
                word = bootRom.rom[romIdx] >>> 0;
                activeClist = bootRom.demo_clist || null;
            }
        }

        if (word === null && lump && lump.code && (niaNum & 3) === 0) {
            const codeStartByte = (lump.lump_base + 1) * 4;
            const idx = (niaNum - codeStartByte) >>> 2;
            if (idx >= 0 && idx < lump.code.length) {
                word = lump.code[idx] >>> 0;
                activeClist = lump.clist || null;
            }
        }

        if (word === null) return null;

        let mnemonic;
        try {
            const asm = new ChurchAssembler();
            mnemonic = asm.disassemble(word);
        } catch (_e) { mnemonic = '???'; }

        const opcode = (word >>> 27) & 0x1F;
        const crSrc  = (word >>> 15) & 0xF;
        const imm    = word & 0x7FFF;
        let clSlot = null;
        if (crSrc === 6) {
            if (opcode === 0 || opcode === 1 || opcode === 4 || opcode === 9) {
                clSlot = imm & 0xFF;
            } else if (opcode === 8) {
                clSlot = imm & 0xFF;
            }
        }
        let gtStr = '';
        if (clSlot !== null && activeClist && clSlot < activeClist.length) {
            const gt      = activeClist[clSlot] >>> 0;
            const bFlag   = (gt >>> 31) & 1;
            const perm3   = (gt >>> 28) & 0x7;
            const dom     = (gt >>> 27) & 0x1;
            const gtType  = (gt >>> 23) & 0x3;
            const typeName = ['NULL', 'Inform', 'Outform', 'Abstract'][gtType];
            let permStr = '';
            if (gt === 0) {
                permStr = 'NULL';
            } else if (dom === 0) {
                if ((perm3 >> 0) & 1) permStr += 'R';
                if ((perm3 >> 1) & 1) permStr += 'W';
                if ((perm3 >> 2) & 1) permStr += 'X';
            } else {
                if ((perm3 >> 0) & 1) permStr += 'L';
                if ((perm3 >> 1) & 1) permStr += 'S';
                if ((perm3 >> 2) & 1) permStr += 'E';
            }
            if (bFlag) permStr += 'B';
            const gtHex = '0x' + gt.toString(16).toUpperCase().padStart(8, '0');
            gtStr = '   GT[' + clSlot + ']: ' + gtHex + ' ' + typeName +
                    (permStr ? '(' + permStr + ')' : '');
        }
        return '[0x' + word.toString(16).toUpperCase().padStart(8, '0') + ']  ' +
               mnemonic + gtStr;
    }

    function onTabOpen() {
        _updateForgetBtnVisibility();

        const savedUrl = localStorage.getItem('ti60BridgeUrl');
        const inp = document.getElementById('ti60BridgeUrl');
        if (inp && savedUrl) inp.value = savedUrl;

        const origin = window.location.origin;
        ['ti60PolUrl', 'ti60PolUrl2'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = origin;
        });

        if (_isCrOS && !localStorage.getItem('ti60ChromeosCardDismissed') && !_isIframe()) {
            const card = document.getElementById('ti60ChromeosCard');
            if (card) card.style.display = '';
        }

        if (_isIframe()) {
            const connectBtn = document.getElementById('ti60ConnectBtn');
            if (connectBtn) connectBtn.style.display = 'none';
            _showIframeBanner();
            const log = document.getElementById('ti60ConnectLog');
            if (log && log.children.length === 0) {
                _logHtml(
                    '<strong>USB connect requires a full browser tab.</strong> ' +
                    'Click <strong>Open in full tab →</strong> above, or ' +
                    'expand <strong>Advanced / Troubleshooting</strong> below to connect via Bridge.'
                );
            }
        }
    }

    return {
        connect,
        connectViaBridge,
        testBridge,
        retryBridge,
        disconnect,
        onTabOpen,
        copyBridgeCmd,
        hideBridgeSetup: _hideBridgeSetup,
        resetBridgeCert,
        get _streamLineCount() { return _streamLineCount; },
        set _streamLineCount(v) { _streamLineCount = v; },
    };
})();
