const PicoSerial = (function() {
    let port = null;

    const BAUD = 115200;
    const NS_WORDS = 192;
    const CLIST_WORDS = 64;
    const TOTAL_WORDS = NS_WORDS + CLIST_WORDS;

    function isSupported() {
        return 'serial' in navigator;
    }

    function isConnected() {
        return port !== null && port.readable !== null;
    }

    async function connect() {
        if (!isSupported()) {
            throw new Error('WebSerial not supported. Use Chrome or Edge.');
        }
        if (isConnected()) return;

        port = await navigator.serial.requestPort();
        try {
            await port.open({ baudRate: BAUD, dataBits: 8, stopBits: 1, parity: 'none' });
        } catch(e) {
            if (e.message && e.message.includes('already open')) {
                // port already open from previous session, that's fine
            } else {
                throw e;
            }
        }
    }

    async function disconnect() {
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

    async function resetFPGA(onStatus) {
        const status = onStatus || function() {};

        if (!port) return;

        status('Resetting pico-ice...');
        try {
            await port.setSignals({ dataTerminalReady: true });
            await sleep(100);
            await port.setSignals({ dataTerminalReady: false });
            await sleep(500);
        } catch(e) {
            status('DTR toggle not supported, sending data directly...');
        }
    }

    async function drainInput() {
        if (!port || !port.readable) return;
        const r = port.readable.getReader();
        try {
            while (true) {
                const { value, done } = await Promise.race([
                    r.read(),
                    new Promise(resolve => setTimeout(() => resolve({ value: null, done: true }), 100))
                ]);
                if (done || !value) break;
            }
        } catch(e) {}
        finally { try { r.releaseLock(); } catch(e) {} }
    }

    async function uploadToFPGA(nsWords, clistWords, onStatus) {
        if (!isConnected()) {
            await connect();
        }

        const status = onStatus || function() {};

        await resetFPGA(status);
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

        status(`Sending ${payload.length} bytes (${totalWords} words)...`);

        const w = port.writable.getWriter();
        try {
            await w.write(payload);
        } finally {
            w.releaseLock();
        }

        status('Data sent. Waiting for banner...');

        const bannerLines = [];
        const deadline = Date.now() + 10000;
        let accumulated = '';

        const r = port.readable.getReader();
        try {
            while (Date.now() < deadline) {
                const { value, done } = await Promise.race([
                    r.read(),
                    new Promise(resolve => setTimeout(() => resolve({ value: null, done: true }), 3000))
                ]);

                if (done || !value) break;

                accumulated += new TextDecoder().decode(value);

                const lines = accumulated.split(/\r?\n/);
                accumulated = lines.pop();

                for (const line of lines) {
                    if (line.trim()) {
                        bannerLines.push(line.trim());
                        status(line.trim());
                    }
                    if (line.includes('HALT')) {
                        r.releaseLock();
                        const success = bannerLines.some(l => l.includes('CHURCH'));
                        return { success, lines: bannerLines };
                    }
                }
            }
        } catch(e) {
            status('Read error: ' + e.message);
        } finally {
            try { r.releaseLock(); } catch(e) {}
        }

        const success = bannerLines.some(l => l.includes('CHURCH'));
        return { success, lines: bannerLines };
    }

    return {
        isSupported,
        isConnected,
        connect,
        disconnect,
        uploadToFPGA,
        NS_WORDS,
        CLIST_WORDS,
        TOTAL_WORDS
    };
})();
