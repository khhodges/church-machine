window.Ti60Connect = (function () {
    const BAUD        = 115200;
    const STEPS       = ['uart', 'callhome', 'register', 'release'];
    const DEFAULT_BRIDGE = 'https://penguin.linux.test:8766';

    let _port    = null;
    let _reader  = null;
    let _running = false;
    let _bridgeRunning = false;

    // ── logging ────────────────────────────────────────────────────────────
    function _log(msg, cls) {
        const log = document.getElementById('ti60ConnectLog');
        if (!log) return;
        const line = document.createElement('div');
        line.className = 'ti60-log-line' + (cls ? ' ' + cls : '');
        line.textContent = new Date().toLocaleTimeString() + '  ' + msg;
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

    function _reset() {
        STEPS.forEach(s => _setStep(s, 'pending'));
        const log = document.getElementById('ti60ConnectLog');
        if (log) log.innerHTML = '';
        const btn  = document.getElementById('ti60ConnectBtn');
        const bBtn = document.getElementById('ti60BridgeBtn');
        if (btn)  { btn.disabled  = false; btn.textContent  = '🔌 Connect'; }
        if (bBtn) { bBtn.disabled = false; bBtn.textContent = '🌉 Via Bridge'; }
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
        const d = await r.json();
        return d.ok === true;
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

    async function _finishSteps(pkt, greetingSeen) {
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
            const ok = await _registerWithIDE(pkt);
            if (ok) {
                _setStep('register', 'pass', 'Device registered in IDE (uid=' + pkt.uid + ')');
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
                if (done) break;
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

    function _noSerial() {
        const log = document.getElementById('ti60ConnectLog');
        if (log) {
            log.innerHTML = '';
            const line = document.createElement('div');
            line.className = 'ti60-log-line log-fail';
            line.innerHTML =
                '<strong>WebSerial not available</strong> in this context (iframe or unsupported browser). ' +
                'Use <strong>🌉 Via Bridge</strong> instead — run the bridge script in your Linux terminal ' +
                'and click "Via Bridge" to connect from any tab including the published site.';
            log.appendChild(line);
        }
        const btn = document.getElementById('ti60ConnectBtn');
        if (btn) { btn.disabled = false; btn.textContent = '🔌 Connect'; }
    }

    async function connect() {
        if (!('serial' in navigator)) {
            _noSerial();
            return;
        }
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

        _setStep('uart', 'active');
        _log('Port open at 115200 baud — waiting for firmware…');
        const dBtn = document.getElementById('ti60DisconnectBtn');
        if (dBtn) dBtn.style.display = '';

        _running = true;
        _readLoop().catch(e => _log('Loop error: ' + e.message, 'log-fail'));
    }

    async function disconnect() {
        _running = false;
        _bridgeRunning = false;
        try { if (_reader) await _reader.cancel(); }  catch (e) {}
        try { if (_port)   await _port.close();    }  catch (e) {}
        _port   = null;
        _reader = null;
        _log('Disconnected.');
        const btn  = document.getElementById('ti60ConnectBtn');
        const bBtn = document.getElementById('ti60BridgeBtn');
        if (btn)  { btn.disabled  = false; btn.textContent  = '🔌 Connect'; }
        if (bBtn) { bBtn.disabled = false; bBtn.textContent = '🌉 Via Bridge'; }
        const dBtn = document.getElementById('ti60DisconnectBtn');
        if (dBtn) dBtn.style.display = 'none';
    }

    // ── Bridge mode ────────────────────────────────────────────────────────
    async function connectViaBridge() {
        _reset();
        const bBtn = document.getElementById('ti60BridgeBtn');
        if (bBtn) { bBtn.disabled = true; bBtn.textContent = 'Connecting…'; }

        const bridgeUrl = DEFAULT_BRIDGE;

        // Step 1: verify bridge is reachable and port is open
        _setStep('uart', 'active');
        _log('Connecting to bridge at ' + bridgeUrl + ' …');
        let status;
        try {
            const r = await fetch(bridgeUrl + '/status');
            status = await r.json();
        } catch (e) {
            _setStep('uart', 'fail',
                'Bridge not reachable at ' + bridgeUrl + '. ' +
                'Run: python3 server/local_bridge.py /dev/ttyUSB2 — ' +
                'then accept the cert at ' + bridgeUrl + '/status');
            if (bBtn) { bBtn.disabled = false; bBtn.textContent = '🌉 Via Bridge'; }
            return;
        }

        if (!status.open) {
            // Try to open the port
            _log('Bridge running but port closed — opening /dev/ttyUSB2 …');
            try {
                const r2 = await fetch(bridgeUrl + '/connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ port: '/dev/ttyUSB2', baud: BAUD }),
                });
                const d2 = await r2.json();
                if (!d2.ok) throw new Error(d2.error || 'connect failed');
            } catch (e) {
                _setStep('uart', 'fail', 'Could not open /dev/ttyUSB2 via bridge: ' + e.message);
                if (bBtn) { bBtn.disabled = false; bBtn.textContent = '🌉 Via Bridge'; }
                return;
            }
        }

        _setStep('uart', 'pass', 'Bridge connected — ' + (status.port || '/dev/ttyUSB2') + ' @ ' + (status.baud || BAUD));
        _setStep('callhome', 'active');
        _log('Waiting for firmware CALLHOME packet (up to 30 s)…');

        const dBtn = document.getElementById('ti60DisconnectBtn');
        if (dBtn) dBtn.style.display = '';

        // Step 2: poll /drain for CALLHOME text (30 s timeout)
        _bridgeRunning = true;
        let buf          = '';
        let greetingSeen = false;
        let pkt          = null;
        const deadline   = Date.now() + 30000;

        while (_bridgeRunning && Date.now() < deadline && !pkt) {
            await new Promise(r => setTimeout(r, 400));
            try {
                const dr = await fetch(bridgeUrl + '/drain');
                const dd = await dr.json();
                if (dd.bytes && dd.bytes.length) {
                    buf += String.fromCharCode(...dd.bytes);
                    const lines = buf.split('\n');
                    buf = lines.pop();
                    for (const raw of lines) {
                        const line = raw.replace(/\r$/, '').trim();
                        if (!line) continue;
                        _log('← ' + line);
                        if (line.includes('CHURCH Ti60 SoC+CM') && !greetingSeen) {
                            greetingSeen = true;
                            _setStep('uart', 'pass', 'Greeting received');
                        }
                        if (line.startsWith('CALLHOME:')) {
                            pkt = _parseCallhome(line);
                        }
                    }
                }
            } catch (e) {
                _log('Bridge read error: ' + e.message, 'log-fail');
                break;
            }
        }

        if (!_bridgeRunning) return;

        if (!pkt) {
            _setStep('callhome', 'fail', 'No CALLHOME received in 30 s — power-cycle the board and try again');
            if (bBtn) { bBtn.disabled = false; bBtn.textContent = '🌉 Via Bridge'; }
            return;
        }

        await _finishSteps(pkt, greetingSeen);
        _bridgeRunning = false;
        if (bBtn) { bBtn.disabled = false; bBtn.textContent = '🌉 Via Bridge'; }
        if (dBtn) dBtn.style.display = 'none';
    }

    function onTabOpen() {
        const origin = window.location.origin;
        ['ti60PolUrl', 'ti60PolUrl2'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = origin;
        });
        // Fill the bridge command spans
        const bc = document.getElementById('ti60BridgeCmd');
        if (bc) bc.textContent =
            'python3 server/local_bridge.py /dev/ttyUSB2 115200 8766';
    }

    return { connect, connectViaBridge, disconnect, onTabOpen };
})();
