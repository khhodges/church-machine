window.Ti60Connect = (function () {
    const BAUD        = 115200;
    const VENDOR_ID   = 0x0403;
    const PRODUCT_ID  = 0x6011;
    const STEPS       = ['uart', 'callhome', 'register', 'release'];

    let _port    = null;
    let _reader  = null;
    let _running = false;

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
        if (btn)  { btn.disabled = false; btn.textContent = '🔌 Connect'; }
        const dBtn = document.getElementById('ti60DisconnectBtn');
        if (dBtn) dBtn.style.display = 'none';
    }

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
                        if (pkt && pkt.boot_ok === 1) {
                            if (!greetingSeen) {
                                greetingSeen = true;
                                _setStep('uart', 'pass', 'Board detected via CALLHOME (board=' + pkt.board + ')');
                            }
                            _setStep('callhome', 'pass',
                                'CALLHOME valid: board=' + pkt.board +
                                ' fw=' + (pkt.fw_major || 1) + '.' + (pkt.fw_minor || 0) +
                                ' nia=' + pkt.nia);
                            _setStep('register', 'active');
                            registered = true;

                            try {
                                const ok = await _registerWithIDE(pkt);
                                if (ok) {
                                    _setStep('register', 'pass', 'Device registered in IDE (uid=' + pkt.uid + ')');
                                    _setStep('release', 'active');
                                    await _reportLaunchTest('passing', 'Ti60 CALLHOME confirmed via WebSerial');
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
                '<strong>WebSerial not available.</strong> ' +
                'Open the app directly in Chrome/Edge — ' +
                'WebSerial is blocked inside the Replit preview iframe. ' +
                'Copy the URL from the address bar and paste it into a new tab.';
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
            // No filter — show all available serial ports so the user can
            // manually pick /dev/ttyUSB2 (or whichever port Chrome can see).
            // A strict VID/PID filter hides the device if the driver hasn't
            // presented it or if it's claimed by the Linux VM on ChromeOS.
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
        try { if (_reader) await _reader.cancel(); }  catch (e) {}
        try { if (_port)   await _port.close();    }  catch (e) {}
        _port   = null;
        _reader = null;
        _log('Disconnected.');
        const btn  = document.getElementById('ti60ConnectBtn');
        if (btn)  { btn.disabled = false; btn.textContent = '🔌 Connect'; }
        const dBtn = document.getElementById('ti60DisconnectBtn');
        if (dBtn) dBtn.style.display = 'none';
    }

    function onTabOpen() {
        // Fill the terminal-script command with the current IDE origin
        const origin = window.location.origin;
        ['ti60PolUrl', 'ti60PolUrl2'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = origin;
        });
    }

    return { connect, disconnect, onTabOpen };
})();
