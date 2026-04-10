const TangSerial = (function() {
    let port = null;
    let _boardLabel = 'Tang Nano 20K';

    let _reader = null;
    let _readerLoopRunning = false;
    let _rxBuffer = [];
    let _rxWaiters = [];

    let _bridgeMode = false;
    let _bridgeUrl  = '';
    let _bridgeOpen = false;

    async function _bFetch(path, opts) {
        const r = await fetch(_bridgeUrl + path, opts);
        if (!r.ok) throw new Error(`Bridge HTTP ${r.status}`);
        return r.json();
    }

    async function connectBridge(url) {
        _bridgeUrl  = (url || 'https://penguin.linux.test:8766').replace(/\/$/, '');
        const r = await _bFetch('/connect', { method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({}) });
        if (!r.ok) throw new Error(r.error || 'Bridge connect failed');
        _bridgeMode = true;
        _bridgeOpen = true;
    }

    async function disconnectBridge() {
        try { await _bFetch('/disconnect', { method: 'POST',
            headers: {'Content-Type': 'application/json'}, body: '{}' }); }
        catch(e) {}
        _bridgeMode = false;
        _bridgeOpen = false;
    }

    async function _bTransact(txArr, rxCount, timeoutMs) {
        return _bFetch('/transact', { method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ tx: txArr, rx_count: rxCount, timeout_ms: timeoutMs }) });
    }

    async function _bDrain() {
        try { await _bFetch('/drain'); } catch(e) {}
    }

    const BAUD = 115200;
    const NS_WORDS = 192;
    const CLIST_WORDS = 64;
    const TOTAL_WORDS = NS_WORDS + CLIST_WORDS;

    function isSupported() {
        return _bridgeMode || 'serial' in navigator;
    }

    function isConnected() {
        if (_bridgeMode) return _bridgeOpen;
        return port !== null && port.readable !== null && port.writable !== null;
    }

    async function ensureOpen() {
        if (_bridgeMode) {
            if (!_bridgeOpen) throw new Error('Bridge not connected. Call connectBridge() first.');
            return;
        }
        if (!port) {
            throw new Error('No port selected. Call connect() first.');
        }
        if (!port.readable || !port.writable) {
            throw new Error('Port is not open. Call connect() again.');
        }
    }

    function setBoardLabel(label) {
        _boardLabel = label || 'Tang Nano 20K';
    }

    function _startReadLoop() {
        if (_readerLoopRunning || !port || !port.readable) return;
        _reader = port.readable.getReader();
        _readerLoopRunning = true;
        (async function loop() {
            try {
                while (_readerLoopRunning) {
                    var result = await _reader.read();
                    if (result.done) break;
                    if (result.value && result.value.length > 0) {
                        for (var i = 0; i < result.value.length; i++) {
                            _rxBuffer.push(result.value[i]);
                        }
                        var snapshot = _rxWaiters.slice();
                        for (var wi = 0; wi < snapshot.length; wi++) {
                            snapshot[wi]();
                        }
                    }
                }
            } catch(e) {
            } finally {
                _readerLoopRunning = false;
                try { _reader.releaseLock(); } catch(e2) {}
                _reader = null;
            }
        })();
    }

    async function _stopReadLoop() {
        if (!_readerLoopRunning && !_reader) return;
        _readerLoopRunning = false;
        if (_reader) {
            try { await _reader.cancel(); } catch(e) {}
        }
        var waited = 0;
        while (_reader && waited < 500) {
            await new Promise(function(r) { setTimeout(r, 20); });
            waited += 20;
        }
    }

    function _addWaiter(fn) {
        _rxWaiters.push(fn);
    }

    function _removeWaiter(fn) {
        var idx = _rxWaiters.indexOf(fn);
        if (idx !== -1) _rxWaiters.splice(idx, 1);
    }

    function _readBytes(n, timeoutMs) {
        return new Promise(function(resolve) {
            var collected = [];
            var deadline = Date.now() + timeoutMs;
            var timer = null;
            var resolved = false;

            function finish() {
                if (resolved) return;
                resolved = true;
                if (timer) clearTimeout(timer);
                _removeWaiter(check);
                resolve(collected);
            }

            function check() {
                if (resolved) return;
                while (collected.length < n && _rxBuffer.length > 0) {
                    collected.push(_rxBuffer.shift());
                }
                if (collected.length >= n) { finish(); return; }
                var remaining = deadline - Date.now();
                if (remaining <= 0) { finish(); return; }
                if (timer) clearTimeout(timer);
                timer = setTimeout(finish, remaining);
            }

            _addWaiter(check);
            check();
        });
    }

    function _readBytesGreedy(maxBytes, timeoutMs) {
        return new Promise(function(resolve) {
            var collected = [];
            var deadline = Date.now() + timeoutMs;
            var timer = null;
            var resolved = false;

            function finish() {
                if (resolved) return;
                resolved = true;
                if (timer) clearTimeout(timer);
                _removeWaiter(check);
                resolve(collected);
            }

            function check() {
                if (resolved) return;
                while (collected.length < maxBytes && _rxBuffer.length > 0) {
                    collected.push(_rxBuffer.shift());
                }
                var remaining = deadline - Date.now();
                if (remaining <= 0 || collected.length >= maxBytes) { finish(); return; }
                if (timer) clearTimeout(timer);
                timer = setTimeout(finish, remaining);
            }

            _addWaiter(check);
            check();
        });
    }

    async function connect() {
        if (!isSupported()) {
            throw new Error(`WebSerial not supported. Use Chrome or Edge to connect to your ${_boardLabel}.`);
        }

        await _stopReadLoop();

        if (port) {
            try { await port.close(); } catch(e) {}
            port = null;
            await new Promise(function(r) { setTimeout(r, 400); });
        }

        port = await navigator.serial.requestPort({ filters: [] });

        try {
            await port.open({ baudRate: BAUD, dataBits: 8, stopBits: 1, parity: 'none' });
        } catch(e) {
            port = null;
            const msg = e.message || String(e);
            if (msg.includes('Failed to open') || msg.includes('Access denied') || msg.includes('busy')) {
                throw new Error(
                    `Could not open port — it is held by another app.\n\n` +
                    `Fix: close Efinity IDE's serial terminal (or any other serial monitor), ` +
                    `wait 5 seconds, then try again.`
                );
            }
            throw e;
        }

        _rxBuffer.length = 0;
        _startReadLoop();
    }

    async function disconnect() {
        if (_bridgeMode) { await disconnectBridge(); return; }
        await _stopReadLoop();
        if (port) {
            try { await port.close(); } catch(e) {}
            port = null;
        }
        _rxBuffer.length = 0;
        _rxWaiters.length = 0;
    }

    function wordToLE(word) {
        const buf = new Uint8Array(4);
        buf[0] = word & 0xFF;
        buf[1] = (word >>> 8) & 0xFF;
        buf[2] = (word >>> 16) & 0xFF;
        buf[3] = (word >>> 24) & 0xFF;
        return buf;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function _writeBytes(data) {
        var w = port.writable.getWriter();
        try { await w.write(data); } finally { w.releaseLock(); }
    }

    async function drainInput() {
        if (_bridgeMode) { await _bDrain(); return; }
        _rxBuffer.length = 0;
        await sleep(50);
        _rxBuffer.length = 0;
    }

    async function uploadToFPGA(nsWords, clistWords, onStatus) {
        const status = onStatus || function() {};

        if (!isConnected()) {
            throw new Error(`Not connected. Call connect() first — make sure your ${_boardLabel} is plugged in via USB.`);
        }

        await drainInput();

        const totalWords = NS_WORDS + CLIST_WORDS;
        const payload = new Uint8Array(4 + totalWords * 4);

        const header = wordToLE(totalWords);
        payload.set(header, 0);

        for (let i = 0; i < NS_WORDS; i++) {
            const w = i < nsWords.length ? nsWords[i] : 0;
            payload.set(wordToLE(w >>> 0), 4 + i * 4);
        }

        for (let i = 0; i < CLIST_WORDS; i++) {
            const w = i < clistWords.length ? clistWords[i] : 0;
            payload.set(wordToLE(w >>> 0), 4 + (NS_WORDS + i) * 4);
        }

        status(`Sending ${payload.length} bytes (${totalWords} words) to ${_boardLabel}...`);

        await _writeBytes(payload);

        status(`Data sent to ${_boardLabel}. Waiting for FPGA response...`);

        var rxBytes = await _readBytesGreedy(2048, 5000);

        const rxTotal = rxBytes.length;
        const success = rxTotal > 0;

        if (rxTotal === 0) {
            status('No response from FPGA. Check baud rate and reset timing.');
        } else {
            status(`Received ${rxTotal} bytes from FPGA.`);
        }

        return { success, rxTotal, rawBytes: rxBytes };
    }

    function parseReadback(rawBytes) {
        const vals = [];
        let i = 0;
        while (i < rawBytes.length) {
            if (rawBytes[i] === 0xFA) {
                if (i + 1 < rawBytes.length) {
                    vals.push(rawBytes[i + 1]);
                    i += 2;
                } else {
                    i++;
                }
            } else {
                i++;
            }
        }

        const words = [];
        for (let j = 0; j + 3 < vals.length; j += 4) {
            words.push((vals[j] | (vals[j+1] << 8) | (vals[j+2] << 16) | (vals[j+3] << 24)) >>> 0);
        }
        const leftover = vals.length % 4;

        const headerEcho = words.length > 0 ? words[0] : null;
        const crs = words.slice(1, 17);
        const drs = words.slice(17, 33);
        const extra = words.slice(33);

        return { vals, words, leftover, headerEcho, crs, drs, extra };
    }

    async function pingFPGA(onStatus) {
        const status = onStatus || function() {};

        if (!isConnected()) {
            throw new Error(`Not connected. Call connect() first.`);
        }

        await drainInput();

        const probe = new Uint8Array([0xFA, 0xCE, 0xFA, 0xCE]);
        status(`Sending 4-byte probe (0xCEFACEFA)...`);

        await _writeBytes(probe);

        status('Probe sent. Listening for 1.5 s...');

        var rxBytes = await _readBytesGreedy(64, 1500);

        return { bytesSent: probe.length, bytesReceived: rxBytes.length, rawBytes: rxBytes };
    }

    window.addEventListener('pagehide', () => {
        _readerLoopRunning = false;
        if (_reader) {
            try { _reader.cancel(); } catch(e) {}
        }
        if (port) {
            try { port.close(); } catch(e) {}
            port = null;
        }
    });

    async function patchLump(baseAddr, words, onStatus) {
        var status = onStatus || function() {};

        if (!isConnected()) {
            throw new Error('Not connected. Call connect() first.');
        }

        var N = words.length;
        if (N === 0) { status('Nothing to send (0 words).'); return { success: true }; }

        var payloadBody = new Uint8Array(2 + 2 + 2 + N * 4);
        payloadBody[0] = 0xBE;
        payloadBody[1] = 0xEF;
        payloadBody[2] = (baseAddr >>> 8) & 0xFF;
        payloadBody[3] = baseAddr & 0xFF;
        payloadBody[4] = (N >>> 8) & 0xFF;
        payloadBody[5] = N & 0xFF;
        for (var i = 0; i < N; i++) {
            var w = words[i] >>> 0;
            payloadBody[6 + i * 4 + 0] = w & 0xFF;
            payloadBody[6 + i * 4 + 1] = (w >>> 8) & 0xFF;
            payloadBody[6 + i * 4 + 2] = (w >>> 16) & 0xFF;
            payloadBody[6 + i * 4 + 3] = (w >>> 24) & 0xFF;
        }

        var crc = 0xFFFF;
        for (var ci = 0; ci < payloadBody.length; ci++) {
            var byte = payloadBody[ci];
            for (var bi = 0; bi < 8; bi++) {
                var bit = ((byte >>> (7 - bi)) & 1) ^ ((crc >>> 15) & 1);
                crc = ((crc << 1) & 0xFFFF) ^ (bit ? 0x1021 : 0);
            }
        }
        var frame = new Uint8Array(payloadBody.length + 2);
        frame.set(payloadBody, 0);
        frame[payloadBody.length]     = (crc >>> 8) & 0xFF;
        frame[payloadBody.length + 1] = crc & 0xFF;

        status('PATCH_LUMP: addr=0x' + baseAddr.toString(16).toUpperCase().padStart(4,'0') +
               ' N=' + N + ' CRC=0x' + crc.toString(16).toUpperCase().padStart(4,'0') +
               ' \u2014 sending ' + frame.length + ' bytes\u2026');

        await drainInput();
        await sleep(50);
        await drainInput();

        if (_bridgeMode) {
            var res = await _bTransact(Array.from(frame), 4, 5000);
            if (!res.ok) { status('Bridge error: ' + res.error); return { success: false }; }
            var rb = res.rx || [];
            if (rb.length >= 4) {
                var bAddr  = (rb[0] << 8) | rb[1];
                var bCount = (rb[2] << 8) | rb[3];
                var bOk = bAddr === (baseAddr & 0xFFFF) && bCount === N;
                status(bOk ? 'Echo OK: addr=0x' + bAddr.toString(16).toUpperCase().padStart(4,'0') + ' count=' + bCount
                           : 'Echo mismatch');
                return { success: bOk };
            }
            if (rb.length === 1 && rb[0] === 0x15) {
                status('NAK received \u2014 CRC mismatch on FPGA side.');
                return { success: false };
            }
            status('No echo received (' + rb.length + ' bytes).');
            return { success: false };
        }

        await _writeBytes(frame);
        status('Bytes sent. Waiting for echo\u2026');
        var rxBytes = await _readBytes(4, 5000);

        if (rxBytes.length === 0) {
            status('No echo \u2014 retrying with drain\u2026');
            await drainInput();
            await sleep(200);
            await drainInput();
            await _writeBytes(frame);
            status('Bytes re-sent. Waiting for echo\u2026');
            rxBytes = await _readBytes(4, 5000);
        }

        if (rxBytes.length >= 4) {
            var echoAddr  = (rxBytes[0] << 8) | rxBytes[1];
            var echoCount = (rxBytes[2] << 8) | rxBytes[3];
            var addrOk  = echoAddr  === (baseAddr & 0xFFFF);
            var countOk = echoCount === N;
            if (addrOk && countOk) {
                status('Echo OK: addr=0x' + echoAddr.toString(16).toUpperCase().padStart(4,'0') + ' count=' + echoCount);
                return { success: true };
            } else {
                status('Echo mismatch: expected addr=0x' + (baseAddr&0xFFFF).toString(16).toUpperCase().padStart(4,'0') +
                       ' count=' + N + ', got addr=0x' + echoAddr.toString(16).toUpperCase().padStart(4,'0') +
                       ' count=' + echoCount);
                return { success: false };
            }
        } else if (rxBytes.length === 1 && rxBytes[0] === 0x15) {
            status('NAK (0x15) received \u2014 CRC mismatch on FPGA side. Frame may be corrupted.');
            return { success: false };
        } else {
            status('No echo received (' + rxBytes.length + ' bytes). Check: FPGA connected? Bitstream includes debug FSM?');
            return { success: false, rxBytes: rxBytes };
        }
    }

    async function readBRAM(baseAddr, count, onStatus) {
        const status = onStatus || function() {};
        await ensureOpen();

        await drainInput();
        await sleep(50);
        await drainInput();

        function buildFrame(addr, cnt) {
            var f = new Uint8Array(6);
            f[0] = 0xBE; f[1] = 0xAD;
            f[2] = (addr >>> 8) & 0xFF; f[3] = addr & 0xFF;
            f[4] = (cnt  >>> 8) & 0xFF; f[5] = cnt  & 0xFF;
            return f;
        }

        var frame = buildFrame(baseAddr, count);

        status(`READ_BRAM: addr=0x${baseAddr.toString(16).toUpperCase().padStart(4,'0')} ` +
               `count=${count} — awaiting ${count * 4} bytes…`);

        if (_bridgeMode) {
            var res = await _bTransact(Array.from(frame), count * 4, 8000);
            if (!res.ok) { status('Bridge error: ' + res.error); return { success: false, words: [], rxLen: 0 }; }
            var rb = res.rx || [];
            var bWords = [];
            for (var bi = 0; bi + 3 < rb.length; bi += 4) {
                bWords.push(((rb[bi]) | (rb[bi+1] << 8) | (rb[bi+2] << 16) | (rb[bi+3] << 24)) >>> 0);
            }
            var bOk = rb.length >= count * 4;
            status(bOk ? `READ_BRAM: ${bWords.length} words received ✓`
                       : `READ_BRAM: timeout — got ${rb.length}/${count*4} bytes`);
            return { success: bOk, words: bWords, rxBytes: new Uint8Array(rb), rxLen: rb.length };
        }

        await _writeBytes(frame);
        var expected = count * 4;
        var rxArr = await _readBytes(expected, 8000);

        if (rxArr.length === 0) {
            status('READ_BRAM: no response — retrying with drain…');
            await drainInput();
            await sleep(200);
            await drainInput();
            await _writeBytes(buildFrame(baseAddr, count));
            rxArr = await _readBytes(expected, 8000);
        }

        var rxBuf = new Uint8Array(rxArr);
        var rxLen = rxBuf.length;

        var words = [];
        var nWords = Math.min(count, Math.floor(rxLen / 4));
        for (var i = 0; i < nWords; i++) {
            var w = (rxBuf[i*4])
                  | (rxBuf[i*4+1] << 8)
                  | (rxBuf[i*4+2] << 16)
                  | (rxBuf[i*4+3] << 24);
            words.push(w >>> 0);
        }

        var ok = rxLen >= expected;
        if (ok) {
            status(`READ_BRAM: ${words.length} words received ✓`);
        } else if (rxLen > 0) {
            status(`READ_BRAM: partial — got ${rxLen}/${expected} bytes (${words.length} complete words)`);
        } else {
            status(`READ_BRAM: timeout — got 0/${expected} bytes. The FPGA did not respond to 0xBEAD. Check: (1) is the bitstream built with READ_BRAM? (2) is this the Ti60 F225 (not Tang Nano)?`);
        }
        return { success: ok, words: words, rxBytes: rxBuf, rxLen: rxLen };
    }

    async function runFPGA(onStatus) {
        const status = onStatus || function() {};
        if (!isConnected()) {
            throw new Error('Not connected. Call connect() first.');
        }
        const frame = new Uint8Array([0xBE, 0xAA]);
        status('Sending RUN command (0xBE 0xAA)...');
        await drainInput();
        if (_bridgeMode) {
            const res = await _bTransact(Array.from(frame), 0, 500);
            if (!res.ok) { status('Bridge error: ' + res.error); return { success: false }; }
            status('RUN sent — core executing from PC=0.');
            return { success: true };
        }
        await _writeBytes(frame);
        status('RUN sent — core executing from PC=0.');
        return { success: true };
    }

    return {
        isSupported,
        isConnected,
        connect,
        disconnect,
        connectBridge,
        disconnectBridge,
        uploadToFPGA,
        patchLump,
        runFPGA,
        readBRAM,
        pingFPGA,
        parseReadback,
        setBoardLabel,
        NS_WORDS,
        CLIST_WORDS,
        TOTAL_WORDS
    };
})();
