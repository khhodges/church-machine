// Static diagnostic metadata only. No instruction lowering or runtime authority.
(function (root) {
    'use strict';
    const WORD = 0xf7000000;
    const DOMAIN = 'church-hardfault-map/v1\n';
    const HASH = /^[a-f0-9]{64}$/;
    const keys = (o, expected) => o && typeof o === 'object' && !Array.isArray(o) &&
        Object.keys(o).sort().join(',') === expected.slice().sort().join(',');
    const text = (s, max) => typeof s === 'string' && s.length > 0 &&
        s.length <= max && !/[\x00-\x1f\x7f]/.test(s);
    const wordsValid = ws => Array.isArray(ws) && ws.length > 1 &&
        ws.every(w => Number.isInteger(w) && w >= 0 && w <= 0xffffffff);
    function wordBytes(words) {
        const out = new Uint8Array(words.length * 4);
        const view = new DataView(out.buffer);
        words.forEach((w, i) => view.setUint32(i * 4, w, false));
        return out;
    }
    // Strict allowlist: never serialize CRs, DRs, proofs or authority envelopes.
    function normalize(map) {
        if (!keys(map, ['version', 'encoding', 'binaryHash', 'codeHash', 'sites']) ||
            map.version !== 1 || map.encoding !== WORD ||
            !HASH.test(map.binaryHash) || !HASH.test(map.codeHash) ||
            !Array.isArray(map.sites) || !map.sites.length || map.sites.length > 8191) return null;
        let previous = 0;
        const sites = [];
        for (const s of map.sites) {
            if (!keys(s, ['offset', 'reason', 'method', 'sourceLine', 'explanation']) ||
                !Number.isInteger(s.offset) || s.offset <= previous || s.offset > 8191 ||
                !/^[A-Z][A-Z0-9_]{0,63}$/.test(s.reason) ||
                !text(s.method, 128) || !Number.isSafeInteger(s.sourceLine) || s.sourceLine < 1 ||
                !text(s.explanation, 512)) return null;
            previous = s.offset;
            sites.push({ offset: s.offset, reason: s.reason, method: s.method,
                sourceLine: s.sourceLine, explanation: s.explanation });
        }
        return { version: 1, encoding: WORD, binaryHash: map.binaryHash,
            codeHash: map.codeHash, sites };
    }
    function signingBytes(map) {
        const canonical = normalize(map);
        if (!canonical) throw new Error('Invalid static HARDFAULT map');
        return new TextEncoder().encode(DOMAIN + JSON.stringify(canonical));
    }
    function createVerifier(subtle, trustedKeys) {
        const pins = Object.freeze({ ...trustedKeys });
        const digest = async bytes => Array.from(new Uint8Array(
            await subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
        return async function verify(input) {
            // Snapshot before the first await: callers may navigate/reload meanwhile.
            try {
                const { envelope, artifactWords, capturedCodeWords, capturedIdentity,
                    offset, capturedOffset, rawWord, faultType, occurrence } = JSON.parse(JSON.stringify(input));
                if (!keys(envelope, ['keyId', 'map', 'signature']) ||
                    !Object.prototype.hasOwnProperty.call(pins, envelope.keyId)) return null;
                const map = normalize(envelope.map);
                if (!map || !wordsValid(artifactWords) || !wordsValid(capturedCodeWords) ||
                    artifactWords.length > 1048576 || faultType !== 'INVALID_OP' ||
                    rawWord !== WORD || !Number.isInteger(offset) || capturedOffset !== offset ||
                    typeof occurrence !== 'string' || !occurrence ||
                    !capturedIdentity || capturedIdentity.secure !== true ||
                    typeof capturedIdentity.binaryHash !== 'string' ||
                    capturedIdentity.binaryHash.toLowerCase() !== map.binaryHash) return null;
                const cw = (artifactWords[0] >>> 10) & 0x1fff;
                if ((artifactWords[0] >>> 27) !== 31 || !cw ||
                    capturedCodeWords.length !== cw + 1 || offset < 1 || offset > cw ||
                    capturedCodeWords.some((w, i) => artifactWords[i] !== w) ||
                    map.sites.some(s => s.offset > cw || artifactWords[s.offset] !== WORD)) return null;
                const site = map.sites.find(s => s.offset === offset);
                if (!site || artifactWords[offset] !== rawWord) return null;
                if (await digest(wordBytes(artifactWords)) !== map.binaryHash ||
                    await digest(wordBytes(capturedCodeWords)) !== map.codeHash) return null;
                if (typeof envelope.signature !== 'string' ||
                    !/^[a-f0-9]{128}$/.test(envelope.signature)) return null;
                const signature = Uint8Array.from(envelope.signature.match(/../g), b => parseInt(b, 16));
                const key = await subtle.importKey('jwk', pins[envelope.keyId],
                    { name: 'Ed25519' }, false, ['verify']);
                if (!await subtle.verify('Ed25519', key, signature, signingBytes(map))) return null;
                return Object.freeze({ ...site });
            } catch (_) {
                // Missing crypto, malformed/untrusted metadata: raw diagnostics survive.
                return null;
            }
        };
    }
    // Saved compiler records use the existing server attestation authority.
    // The server authenticates the exact artifact; no new browser trust pins.
    async function verifySavedCompilerSite(input) {
        try {
            if (typeof root.fetch !== 'function') return null;
            const snapshot = JSON.parse(JSON.stringify(Object.fromEntries(
                ['artifactWords', 'capturedCodeWords', 'offset', 'capturedOffset',
                    'rawWord', 'faultType', 'occurrence'].map(key => [key, input[key]]))));
            snapshot.capturedIdentity = {secure: input.capturedIdentity && input.capturedIdentity.secure,
                binaryHash: input.capturedIdentity && input.capturedIdentity.binaryHash};
            const response = await root.fetch('/api/hardfault/verify', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(snapshot), cache: 'no-store'
            });
            if (!response.ok) return null;
            return (await response.json()).site || null;
        } catch (_) { return null; }
    }
    const api = Object.freeze({
        emissionEnabled: true,
        verify: verifySavedCompilerSite
    });
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { ...api, createVerifier, signingBytes, normalize, wordBytes };
    } else root.ChurchHardfaultMap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
