window.Ti60Connect = (function () {
    const BAUD         = 115200;
    const STEPS        = ['uart', 'callhome', 'register', 'release'];
    const DEFAULT_BRIDGE = 'https://penguin.linux.test:8766';

    let _port    = null;
    let _reader  = null;
    let _running = false;
    let _bridgeRunning = false;
    let _tunnelMode = false;
    let _streamLineCount = 0;
    let _bridgeEverConfirmed = localStorage.getItem('ti60BridgeCertAccepted') === '1';
    let _detectedPort = null;
    let _activeBaud = BAUD;

    // ── port detection ─────────────────────────────────────────────────────
    async function _fetchPorts(url) {
        try {
            const r = await fetch(url + '/ports', { signal: AbortSignal.timeout(3000) });
            const d = await r.json();
            if (d.ok && Array.isArray(d.ports) && d.ports.length > 0) return d.ports;
        } catch (e) {}
        return null;
    }

    function _pickBestPort(ports) {
        if (!ports || ports.length === 0) return null;
        const preferred = ports.find(p => p === '/dev/ttyUSB2');
        return preferred || ports[0];
    }

    function _updateRunCmds(port) {
        const p    = port || '/dev/ttyUSB2';
        const ide  = window.location.origin;
        const cmd  = 'python3 local_bridge.py ' + p + ' 115200 8766 --ide=' + ide;
        ['ti60SetupBridgeCmd', 'ti60BridgeCmd'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.textContent = cmd;
        });
    }

    // ── bridge setup panel ─────────────────────────────────────────────────
    function _showBridgeSetup() {
        const panel = document.getElementById('ti60BridgeSetupPanel');
        if (!panel) return;
        const url = _bridgeUrl();
        const link = document.getElementById('ti60SetupCertLink');
        if (link) {
            const certUrl = url + '/status';
            link.href = certUrl;
            link.textContent = certUrl;
        }
        panel.style.display = '';
    }

    function _hideBridgeSetup() {
        const panel = document.getElementById('ti60BridgeSetupPanel');
        if (panel) panel.style.display = 'none';
    }

    // ── helpers ────────────────────────────────────────────────────────────
    function _bridgeUrl() {
        const inp = document.getElementById('ti60BridgeUrl');
        const v   = (inp ? inp.value : '').trim();
        return v || DEFAULT_BRIDGE;
    }

    function _log(msg, cls) {
        const log = document.getElementById('ti60ConnectLog');
        if (!log) return;
        const line = document.createElement('div');
        line.className = 'ti60-log-line' + (cls ? ' ' + cls : '');
        line.textContent = new Date().toLocaleTimeString() + '  ' + msg;
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
        // Keep last 500 lines to avoid unbounded growth
        while (body.children.length > 500) body.removeChild(body.firstChild);
        body.scrollTop = body.scrollHeight;
        _streamLineCount++;
        const cnt = document.getElementById('ti60NiaStreamCount');
        if (cnt) cnt.textContent = _streamLineCount + ' line' + (_streamLineCount === 1 ? '' : 's');
    }

    function _showStreamPanel() {
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

    function _logHtml(html) {
        const log = document.getElementById('ti60ConnectLog');
        if (!log) return;
        const line = document.createElement('div');
        line.className = 'ti60-log-line';
        line.innerHTML = html;
        log.appendChild(line);
        log.scrollTop = log.scrollHeight;
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

    function _setActivePort(port) {
        const row = document.getElementById('ti60ActivePortRow');
        const val = document.getElementById('ti60ActivePortValue');
        if (!row || !val) return;
        if (port) {
            val.textContent = port;
            row.style.display = '';
        } else {
            val.textContent = '';
            row.style.display = 'none';
        }
    }

    function _reset() {
        STEPS.forEach(s => _setStep(s, 'pending'));
        _setActivePort(null);
        const log = document.getElementById('ti60ConnectLog');
        if (log) log.innerHTML = '';
        const sBanner = document.getElementById('ti60SuccessBanner');
        if (sBanner) sBanner.style.display = 'none';
        const btn  = document.getElementById('ti60ConnectBtn');
        const bBtn = document.getElementById('ti60BridgeBtn');
        const tBtn = document.getElementById('ti60TestBridgeBtn');
        if (btn)  { btn.disabled  = false; btn.textContent  = '🔌 Connect'; }
        if (bBtn) { bBtn.disabled = false; bBtn.textContent = '🌉 Via Bridge'; }
        if (tBtn) { tBtn.disabled = false; }
        const dBtn = document.getElementById('ti60DisconnectBtn');
        if (dBtn) dBtn.style.display = 'none';
    }

    // ── shared IDE calls ───────────────────────────────────────────────────
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
                fw_major:    pkt.fw_major  || 1,
                fw_minor:    pkt.fw_minor  || 0,
                boot_reason: 0,
                last_fault:  pkt.fault     || 0,
                fault_nia:   0,
            }),
        });
        return await r.json();
    }

    async function _reportLaunchTest(status, notes) {
        const r = await fetch('/api/launch-tests/TEST-09', {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, device_uid: '', notes }),
        });
        const d = await r.json();
        return d.ok === true;
    }

    async function _confirmLaunchTest() {
        const r = await fetch('/api/launch-tests');
        const d = await r.json();
        const t09 = (d.tests || []).find(t => t.test_id === 'TEST-09');
        return t09 && t09.status === 'passing';
    }

    async function _finishSteps(pkt, greetingSeen, skipRegister) {
        if (!greetingSeen) {
            _setStep('uart', 'pass', 'Board detected via CALLHOME (board=' + pkt.board + ')');
        }
        if (pkt.boot_ok !== 1) {
            _setStep('callhome', 'fail', 'boot_ok=' + pkt.boot_ok + '  fault_code=' + pkt.fault_code + ' — firmware booted with fault');
            return;
        }
        _setStep('callhome', 'pass',
            'CALLHOME valid: board=' + pkt.board +
            ' fw=' + (pkt.fw_major || 1) + '.' + (pkt.fw_minor || 0) +
            ' nia=' + pkt.nia);
        _setStep('register', 'active');

        try {
            let reg;
            if (skipRegister) {
                // Bridge already registered the device — reuse the boot_count from the CALLHOME data
                reg = { ok: true, boot_count: pkt.boot_count };
            } else {
                reg = await _registerWithIDE(pkt);
            }
            if (reg.ok) {
                const bootNum = reg.boot_count != null ? '  boot #' + reg.boot_count : '';
                _setStep('register', 'pass', 'Device registered in IDE (uid=' + pkt.uid + ')' + bootNum);
                const sBanner = document.getElementById('ti60SuccessBanner');
                if (sBanner) sBanner.style.display = '';
                _setStep('release', 'active');
                await _reportLaunchTest('passing', 'Ti60 CALLHOME confirmed');
                const confirmed = await _confirmLaunchTest();
                if (confirmed) {
                    _setStep('release', 'pass', 'TEST-09 confirmed passing in IDE ✅');
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

    // ── WebSerial mode ─────────────────────────────────────────────────────
    function _isIframe() {
        try { return window.self !== window.top; } catch (e) { return true; }
    }

    function _noSerial() {
        const log = document.getElementById('ti60ConnectLog');
        if (!log) return;
        log.innerHTML = '';

        if (_isIframe()) {
            _logHtml(
                '<strong>WebSerial is not available inside a preview iframe.</strong><br>' +
                'Two options:<br>' +
                '&nbsp;&nbsp;<strong>A)</strong> Open the IDE in its own tab: ' +
                '<a href="/simulator/" target="_blank" style="color:#daa520;">/simulator/</a> ' +
                'then click Connect there.<br>' +
                '&nbsp;&nbsp;<strong>B)</strong> Use <strong>🌉 Via Bridge</strong> instead — ' +
                'it works from any tab including this one.'
            );
        } else {
            _logHtml(
                '<strong>WebSerial not supported</strong> in this browser or context. ' +
                'Use <strong>🌉 Via Bridge</strong> instead, or open the IDE in Chrome/Edge.'
            );
        }

        const btn = document.getElementById('ti60ConnectBtn');
        if (btn) { btn.disabled = false; btn.textContent = '🔌 Connect'; }
    }

    async function _readLoop() {
        const decoder = new TextDecoderStream();
        _port.readable.pipeTo(decoder.writable).catch(() => {});
        _reader = decoder.readable.getReader();

        let buf          = '';
        let greetingSeen = false;
        let registered   = false;

        try {
            while (_running) {
                const { value, done } = await _reader.read();
                if (done) {
                    if (_running) {
                        _log('⚠ Serial port closed unexpectedly — port may still be held open.', 'log-warn');
                        _running = false;
                        _reset();
                    }
                    break;
                }
                buf += value;
                const lines = buf.split('\n');
                buf = lines.pop();

                for (const raw of lines) {
                    const line = raw.replace(/\r$/, '').trim();
                    if (!line) continue;

                    if (line.includes('CHURCH Ti60 SoC+CM') && !greetingSeen) {
                        greetingSeen = true;
                        _setStep('uart', 'pass', 'Greeting: ' + line);
                        _setStep('callhome', 'active');
                    }

                    if (line.startsWith('CALLHOME:') && !registered) {
                        const pkt = _parseCallhome(line);
                        if (pkt) {
                            registered = true;
                            await _finishSteps(pkt, greetingSeen);
                        }
                    }
                }
            }
        } catch (e) {
            if (_running) _log('Read error: ' + e.message, 'log-fail');
        } finally {
            try { _reader.releaseLock(); } catch (e) {}
        }
    }

    function _showIframeBanner() {
        const banner = document.getElementById('ti60IframeBanner');
        if (banner) {
            banner.style.display = 'flex';
            banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    async function connect() {
        if (_isIframe()) { _showIframeBanner(); return; }
        if (!('serial' in navigator)) { _noSerial(); return; }
        _reset();
        const btn = document.getElementById('ti60ConnectBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }

        try {
            _port = await navigator.serial.requestPort({});
        } catch (e) {
            _log('Port selection cancelled.', 'log-fail');
            if (btn) { btn.disabled = false; btn.textContent = '🔌 Connect'; }
            return;
        }

        try {
            await _port.open({ baudRate: BAUD });
        } catch (e) {
            _log('Failed to open port: ' + e.message, 'log-fail');
            _setStep('uart', 'fail', 'Port open failed: ' + e.message);
            if (btn) { btn.disabled = false; btn.textContent = '🔌 Connect'; }
            return;
        }

        _activeBaud = BAUD;
        _setStep('uart', 'active');
        _log('Port open at 115200 baud — waiting for firmware…');
        const dBtn = document.getElementById('ti60DisconnectBtn');
        if (dBtn) dBtn.style.display = '';

        _running = true;
        _readLoop().catch(e => _log('Loop error: ' + e.message, 'log-fail'));
    }

    async function disconnect() {
        _running = false;
        const wasBridge = _bridgeRunning;
        const wasTunnel = _tunnelMode;
        _bridgeRunning = false;
        _tunnelMode    = false;
        try { if (_reader) await _reader.cancel(); }  catch (e) {}
        try { if (_port)   await _port.close();    }  catch (e) {}
        _port   = null;
        _reader = null;
        _setActivePort(null);
        if (wasBridge && !wasTunnel) {
            // Direct bridge mode — tell the bridge to release the serial port
            let confirmedBaud = _activeBaud;
            let bridgeReachable = true;
            try {
                const r = await fetch(_bridgeUrl() + '/disconnect',
                    { method: 'POST', signal: AbortSignal.timeout(3000) });
                const d = await r.json();
                if (d && typeof d.baud === 'number') confirmedBaud = d.baud;
            } catch (e) { bridgeReachable = false; }
            if (bridgeReachable) {
                _log('Disconnected from bridge (was ' + confirmedBaud + ' baud).');
            } else {
                _log('Disconnected (bridge unreachable — port may still be held open).', 'log-warn');
            }
        } else if (wasTunnel) {
            _log('Disconnected from bridge tunnel.');
        } else {
            _log('Disconnected (was ' + _activeBaud + ' baud).');
        }
        const btn  = document.getElementById('ti60ConnectBtn');
        const bBtn = document.getElementById('ti60BridgeBtn');
        if (btn)  { btn.disabled  = false; btn.textContent  = '🔌 Connect'; }
        if (bBtn) { bBtn.disabled = false; bBtn.textContent = '🌉 Via Bridge'; }
        const dBtn = document.getElementById('ti60DisconnectBtn');
        if (dBtn) dBtn.style.display = 'none';
    }

    // ── Bridge diagnostics ─────────────────────────────────────────────────
    async function testBridge() {
        const tBtn = document.getElementById('ti60TestBridgeBtn');
        if (tBtn) tBtn.disabled = true;
        if (!_bridgeEverConfirmed) {
            _showBridgeSetup();
        }
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
                const best = _pickBestPort(ports);
                if (best) {
                    _detectedPort = best;
                    _updateRunCmds(best);
                }
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
            const msg = e.message || String(e);
            _log('✗ Bridge not reachable: ' + msg, 'log-fail');
            _showBridgeSetup();
        }
        if (tBtn) tBtn.disabled = false;
    }

    async function retryBridge() {
        await testBridge();
    }

    // ── Bridge tunnel mode ─────────────────────────────────────────────────
    // The bridge pushes serial bytes to the IDE server; the browser polls the
    // IDE server.  No direct browser→bridge connection — no cert, no flags,
    // no port forwarding.  Just run the bridge with --ide=<URL> and click.
    async function connectViaBridge() {
        _reset();
        _tunnelMode = true;
        const bBtn = document.getElementById('ti60BridgeBtn');
        const dBtn = document.getElementById('ti60DisconnectBtn');
        if (bBtn) { bBtn.disabled = true; bBtn.textContent = 'Waiting…'; }
        if (dBtn) dBtn.style.display = '';

        _setStep('uart', 'active');
        _log('Waiting for board to call home via the bridge tunnel…');
        _log('(If the board has already booted, power-cycle it now to resend CALLHOME)');

        _bridgeRunning = true;

        // First: check immediately for any existing CALLHOME (board already booted).
        let pkt = null;
        try {
            const r = await fetch('/api/device/latest-callhome?since=0');
            const d = await r.json();
            if (d.ok && d.callhome) {
                pkt = d.callhome;
                const age = Math.round((Date.now() / 1000) - (pkt.ts || 0));
                const ageStr = age < 60 ? age + ' s' : Math.round(age / 60) + ' min';
                _log('✓ Board already registered — last CALLHOME ' + ageStr + ' ago (uid=' + pkt.uid + ')');
            }
        } catch (e) { /* will fall through to polling loop */ }

        // If nothing yet, poll for up to 90 s waiting for the board to reboot.
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
            _setStep('callhome', 'fail',
                'No CALLHOME received in 90 s — is the bridge running with --ide=<URL>?');
            _log('Start the bridge with:', 'log-warn');
            _log('  python3 local_bridge.py /dev/ttyUSB2 115200 8766 --ide=' + window.location.origin, 'log-warn');
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
        _showStreamPanel();
        while (_bridgeRunning) {
            await new Promise(r => setTimeout(r, 400));
            try {
                const dr = await fetch('/api/device/pull-drain/' + uid,
                    { signal: AbortSignal.timeout(3000) });
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
                            const nia = '0x' + niaMatch[1].toUpperCase().padStart(8, '0');
                            _streamLog('NIA → ' + nia, 'sl-nia');
                            if (nia !== lastNia) {
                                lastNia = nia;
                                _log('NIA → ' + nia, 'log-nia');
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
                if (_bridgeRunning) _log('⚠ Stream error: ' + e.message, 'log-warn');
                break;
            }
        }
        _bridgeRunning = false;
        _tunnelMode    = false;
        _hideStreamPanel();
        if (bBtn) { bBtn.disabled = false; bBtn.textContent = '🌉 Via Bridge'; }
        if (dBtn) dBtn.style.display = 'none';
    }

    function onTabOpen() {
        _updateForgetBtnVisibility();

        // Pre-fill bridge URL input from localStorage (if saved from a previous session)
        const savedUrl = localStorage.getItem('ti60BridgeUrl');
        const inp = document.getElementById('ti60BridgeUrl');
        if (inp && savedUrl) inp.value = savedUrl;

        const origin = window.location.origin;
        ['ti60PolUrl', 'ti60PolUrl2'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = origin;
        });

        // Show the persistent banner and a log hint when inside an iframe
        if (_isIframe()) {
            _showIframeBanner();
            const log = document.getElementById('ti60ConnectLog');
            if (log && log.children.length === 0) {
                _logHtml(
                    '&#x26A0;&#xFE0F; <strong>Preview pane detected.</strong> ' +
                    'Use <strong>&#x1F309; Via Bridge</strong> below, or click ' +
                    '<strong>Open in full browser tab</strong> above to use USB Connect directly.'
                );
            }
        }
    }

    function _updateForgetBtnVisibility() {
        const btn = document.querySelector('.ti60-forget-bridge-btn');
        if (btn) btn.style.display = _bridgeEverConfirmed ? '' : 'none';
    }

    function resetBridgeCert() {
        localStorage.removeItem('ti60BridgeCertAccepted');
        _bridgeEverConfirmed = false;
        _updateForgetBtnVisibility();
        _log('Bridge cert memory cleared — setup guide will reappear on next connection attempt.');
    }

    return { connect, connectViaBridge, testBridge, retryBridge, disconnect, onTabOpen, hideBridgeSetup: _hideBridgeSetup, resetBridgeCert, get _streamLineCount() { return _streamLineCount; }, set _streamLineCount(v) { _streamLineCount = v; } };
})();
