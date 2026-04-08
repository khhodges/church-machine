const TangSerial = (function() {
    let port = null;
    let activeReader = null;
    let _boardLabel = 'Tang Nano 20K';

    // ── Local Bridge (ChromeOS / WebSerial-blocked environments) ────────────
    let _bridgeMode = false;
    let _bridgeUrl  = '';
    let _bridgeOpen = false;

    async function _bFetch(path, opts) {
        const r = await fetch(_bridgeUrl + path, opts);
        if (!r.ok) throw new Error(`Bridge HTTP ${r.status}`);
        return r.json();
    }

    async function connectBridge(url) {
        _bridgeUrl  = (url || 'http://penguin.linux.test:8766').replace(/\/$/, '');
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

    // Send tx bytes, wait for exactly rxCount bytes back (or timeout)
    async function _bTransact(txArr, rxCount, timeoutMs) {
        return _bFetch('/transact', { method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ tx: txArr, rx_count: rxCount, timeout_ms: timeoutMs }) });
    }

    async function _bDrain() {
        try { await _bFetch('/drain'); } catch(e) {}
    }

    // ── end bridge helpers ───────────────────────────────────────────────────

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

    async function connect() {
        if (!isSupported()) {
            throw new Error(`WebSerial not supported. Use Chrome or Edge to connect to your ${_boardLabel}.`);
        }

        // Cancel any active reader first so the port can be closed cleanly
        if (activeReader) {
            try { await activeReader.cancel(); } catch(e) {}
            activeReader = null;
            await new Promise(r => setTimeout(r, 100));
        }

        if (port) {
            try { await port.close(); } catch(e) {}
            port = null;
            await new Promise(r => setTimeout(r, 400));
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
    }

    async function disconnect() {
        if (_bridgeMode) { await disconnectBridge(); return; }
        if (port) {
            try { await port.close(); } catch(e) {}
            port = null;
        }
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

    async function drainInput() {
        if (_bridgeMode) { await _bDrain(); return; }
        if (!port || !port.readable) return;
        const r = port.readable.getReader();
        activeReader = r;
        try {
            while (true) {
                const { value, done } = await Promise.race([
                    r.read(),
                    new Promise(resolve => setTimeout(() => resolve({ value: null, done: true }), 100))
                ]);
                if (done || !value) break;
            }
        } catch(e) {}
        finally {
            activeReader = null;
            try { r.releaseLock(); } catch(e) {}
        }
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

        const w = port.writable.getWriter();
        try {
            await w.write(payload);
        } finally {
            w.releaseLock();
        }

        status(`Data sent to ${_boardLabel}. Waiting for FPGA response...`);

        const rxBytes = [];
        const deadline = Date.now() + 5000;

        const r = port.readable.getReader();
        activeReader = r;
        try {
            while (Date.now() < deadline) {
                const { value, done } = await Promise.race([
                    r.read(),
                    new Promise(resolve => setTimeout(() => resolve({ value: null, done: true }), 2000))
                ]);
                if (done || !value || value.length === 0) break;
                for (let i = 0; i < value.length; i++) rxBytes.push(value[i]);
            }
        } catch(e) {
            status('Read error: ' + e.message);
        } finally {
            activeReader = null;
            try { r.releaseLock(); } catch(e) {}
        }

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
        // Protocol: every pair is 0xFA <value_byte>
        // 0xFA 0xFA = escaped literal 0xFA in the data stream.
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

        // Group value bytes into 32-bit little-endian words
        const words = [];
        for (let j = 0; j + 3 < vals.length; j += 4) {
            words.push((vals[j] | (vals[j+1] << 8) | (vals[j+2] << 16) | (vals[j+3] << 24)) >>> 0);
        }
        const leftover = vals.length % 4;

        // Interpret structure:
        //  word[0]       = header echo (total words sent, should = 256)
        //  words[1..16]  = CR0–CR15
        //  words[17..32] = DR0–DR15
        //  words[33..]   = additional (NS readback or firmware-specific)
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

        // Send a 4-byte probe: little-endian word 0xCEFACEFA ("CAFE CAFE").
        // The FPGA may not understand this — that is fine.  We just want to
        // confirm that bytes flow in both directions.
        const probe = new Uint8Array([0xFA, 0xCE, 0xFA, 0xCE]);
        status(`Sending 4-byte probe (0xCEFACEFA)...`);

        const w = port.writable.getWriter();
        try { await w.write(probe); } finally { w.releaseLock(); }

        status('Probe sent. Listening for 1.5 s...');

        const rxBytes = [];
        const deadline = Date.now() + 1500;
        const r = port.readable.getReader();
        activeReader = r;
        try {
            while (Date.now() < deadline) {
                const { value, done } = await Promise.race([
                    r.read(),
                    new Promise(resolve => setTimeout(() => resolve({ done: true }), 500))
                ]);
                if (done || !value || value.length === 0) break;
                for (let i = 0; i < value.length; i++) rxBytes.push(value[i]);
            }
        } catch(e) {
            status('Read error: ' + e.message);
        } finally {
            activeReader = null;
            try { r.releaseLock(); } catch(e) {}
        }

        return { bytesSent: probe.length, bytesReceived: rxBytes.length, rawBytes: rxBytes };
    }

    window.addEventListener('pagehide', () => {
        if (activeReader) {
            try { activeReader.cancel(); } catch(e) {}
            activeReader = null;
        }
        if (port) {
            try { port.close(); } catch(e) {}
            port = null;
        }
    });

    // PATCH_LUMP — write N words at an arbitrary BRAM address.
    // Protocol: [0xBE][0xEF][addrHi][addrLo][countHi][countLo][w0_LE ... wN-1_LE][crcHi][crcLo]
    // The FPGA echoes back [addrHi][addrLo][countHi][countLo] on success.
    // Requires hardware/boot_rom.py UART FSM extension to decode opcode 0xBEEF.
    async function patchLump(baseAddr, words, onStatus) {
        const status = onStatus || function() {};

        if (!isConnected()) {
            throw new Error('Not connected. Call connect() first.');
        }

        const N = words.length;
        if (N === 0) { status('Nothing to send (0 words).'); return { success: true }; }

        // Build payload: 2 magic + 2 addr + 2 count + N*4 data + 2 CRC
        const payloadBody = new Uint8Array(2 + 2 + 2 + N * 4);
        payloadBody[0] = 0xBE;
        payloadBody[1] = 0xEF;
        payloadBody[2] = (baseAddr >>> 8) & 0xFF;
        payloadBody[3] = baseAddr & 0xFF;
        payloadBody[4] = (N >>> 8) & 0xFF;
        payloadBody[5] = N & 0xFF;
        for (let i = 0; i < N; i++) {
            const w = words[i] >>> 0;
            payloadBody[6 + i * 4 + 0] = w & 0xFF;
            payloadBody[6 + i * 4 + 1] = (w >>> 8) & 0xFF;
            payloadBody[6 + i * 4 + 2] = (w >>> 16) & 0xFF;
            payloadBody[6 + i * 4 + 3] = (w >>> 24) & 0xFF;
        }

        // CRC-16/CCITT-FALSE over the body (excluding the two CRC bytes themselves)
        let crc = 0xFFFF;
        for (const byte of payloadBody) {
            for (let i = 0; i < 8; i++) {
                const bit = ((byte >>> (7 - i)) & 1) ^ ((crc >>> 15) & 1);
                crc = ((crc << 1) & 0xFFFF) ^ (bit ? 0x1021 : 0);
            }
        }
        const frame = new Uint8Array(payloadBody.length + 2);
        frame.set(payloadBody, 0);
        frame[payloadBody.length]     = (crc >>> 8) & 0xFF;
        frame[payloadBody.length + 1] = crc & 0xFF;

        status(`PATCH_LUMP: addr=0x${baseAddr.toString(16).toUpperCase().padStart(4,'0')} N=${N} CRC=0x${crc.toString(16).toUpperCase().padStart(4,'0')} — sending ${frame.length} bytes...`);

        await drainInput();

        // ── bridge path ──────────────────────────────────────────────────────
        if (_bridgeMode) {
            const res = await _bTransact(Array.from(frame), 4, 3000);
            if (!res.ok) { status('Bridge error: ' + res.error); return { success: false }; }
            const rxBytes = res.rx || [];
            if (rxBytes.length >= 4) {
                const echoAddr  = (rxBytes[0] << 8) | rxBytes[1];
                const echoCount = (rxBytes[2] << 8) | rxBytes[3];
                const ok = echoAddr === (baseAddr & 0xFFFF) && echoCount === N;
                status(ok ? `Echo OK: addr=0x${echoAddr.toString(16).toUpperCase().padStart(4,'0')} count=${echoCount}`
                          : `Echo mismatch`);
                return { success: ok };
            }
            status(`No echo received (${rxBytes.length} bytes).`);
            return { success: false };
        }

        const w = port.writable.getWriter();
        try { await w.write(frame); } finally { w.releaseLock(); }

        status('Bytes sent. Waiting for echo...');

        const rxBytes = [];
        const deadline = Date.now() + 3000;
        const r = port.readable.getReader();
        activeReader = r;
        try {
            while (Date.now() < deadline) {
                const { value, done } = await Promise.race([
                    r.read(),
                    new Promise(resolve => setTimeout(() => resolve({ done: true }), 1000))
                ]);
                if (done || !value || value.length === 0) break;
                for (let i = 0; i < value.length; i++) rxBytes.push(value[i]);
                if (rxBytes.length >= 4) break;
            }
        } catch(e) {
            status('Read error: ' + e.message);
        } finally {
            activeReader = null;
            try { r.releaseLock(); } catch(e) {}
        }

        if (rxBytes.length >= 4) {
            const echoAddr  = (rxBytes[0] << 8) | rxBytes[1];
            const echoCount = (rxBytes[2] << 8) | rxBytes[3];
            const addrOk  = echoAddr  === (baseAddr & 0xFFFF);
            const countOk = echoCount === N;
            if (addrOk && countOk) {
                status(`Echo OK: addr=0x${echoAddr.toString(16).toUpperCase().padStart(4,'0')} count=${echoCount}`);
                return { success: true };
            } else {
                status(`Echo mismatch: expected addr=0x${(baseAddr&0xFFFF).toString(16).toUpperCase().padStart(4,'0')} count=${N}, got addr=0x${echoAddr.toString(16).toUpperCase().padStart(4,'0')} count=${echoCount}`);
                return { success: false };
            }
        } else {
            status(`No echo received (${rxBytes.length} bytes). Firmware may not support PATCH_LUMP yet — update hardware/boot_rom.py.`);
            return { success: false, rxBytes };
        }
    }

    // READ_BRAM — read N words from BRAM starting at word address baseAddr.
    // Protocol (Ti60 F225 debug_fsm, opcode 0xBEAD):
    //   Send:    [0xBE][0xAD][addrHi][addrLo][countHi][countLo]
    //   Receive: count × 4 raw LE bytes  (no framing or escaping)
    // Requires the Ti60 F225 bitstream built with the READ_BRAM hardware extension.
    async function readBRAM(baseAddr, count, onStatus) {
        const status = onStatus || function() {};
        await ensureOpen();
        await drainInput();

        const frame = new Uint8Array(6);
        frame[0] = 0xBE;
        frame[1] = 0xAD;
        frame[2] = (baseAddr >>> 8) & 0xFF;
        frame[3] =  baseAddr        & 0xFF;
        frame[4] = (count    >>> 8) & 0xFF;
        frame[5] =  count           & 0xFF;

        status(`READ_BRAM: addr=0x${baseAddr.toString(16).toUpperCase().padStart(4,'0')} ` +
               `count=${count} — awaiting ${count * 4} bytes…`);

        // ── bridge path ──────────────────────────────────────────────────────
        if (_bridgeMode) {
            const res = await _bTransact(Array.from(frame), count * 4, 5000);
            if (!res.ok) { status('Bridge error: ' + res.error); return { success: false, words: [], rxLen: 0 }; }
            const rb = res.rx || [];
            const words = [];
            for (let i = 0; i + 3 < rb.length; i += 4) {
                words.push(((rb[i]) | (rb[i+1] << 8) | (rb[i+2] << 16) | (rb[i+3] << 24)) >>> 0);
            }
            const ok = rb.length >= count * 4;
            status(ok ? `READ_BRAM: ${words.length} words received ✓`
                      : `READ_BRAM: timeout — got ${rb.length}/${count*4} bytes`);
            return { success: ok, words, rxBytes: new Uint8Array(rb), rxLen: rb.length };
        }

        const writer = port.writable.getWriter();
        try { await writer.write(frame); } finally { writer.releaseLock(); }

        const expected = count * 4;
        const rxBytes  = new Uint8Array(expected);
        let rxLen = 0;

        const r = port.readable.getReader();
        try {
            while (rxLen < expected) {
                const { value, done } = await Promise.race([
                    r.read(),
                    sleep(5000).then(() => ({ value: null, done: true })),
                ]);
                if (done || !value) break;
                for (const b of value) {
                    if (rxLen < expected) rxBytes[rxLen++] = b;
                }
            }
        } finally {
            r.releaseLock();
        }

        const words = [];
        for (let i = 0; i < Math.min(count, Math.floor(rxLen / 4)); i++) {
            const w = (rxBytes[i*4])
                    | (rxBytes[i*4+1] << 8)
                    | (rxBytes[i*4+2] << 16)
                    | (rxBytes[i*4+3] << 24);
            words.push(w >>> 0);
        }

        const ok = rxLen >= expected;
        if (ok) {
            status(`READ_BRAM: ${words.length} words received ✓`);
        } else {
            status(`READ_BRAM: timeout — got ${rxLen}/${expected} bytes (${words.length} complete words)`);
        }
        return { success: ok, words, rxBytes, rxLen };
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
        const w = port.writable.getWriter();
        try { await w.write(frame); } finally { w.releaseLock(); }
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
