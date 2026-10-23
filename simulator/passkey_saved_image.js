'use strict';

// Genesis-side persistence only: no simulator dispatch, installation or pool generation.
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const FORMAT = 'phase1-passkey-private-v1';

function words(value, label) {
    if (!(Array.isArray(value) || value instanceof Uint32Array) ||
        !value.length || value.length > 1048576 ||
        !Array.from(value).every(w => Number.isInteger(w) && w >= 0 && w <= 0xffffffff)) {
        throw new Error(`Invalid ${label} words`);
    }
    return Array.from(value);
}

function validate(artifact, state) {
    if (artifact.length < 103) throw new Error('Missing embedded Passkey pool');
    const pool = artifact.slice(3, 103);
    if (pool.some(w => (w >>> 29) !== 1 || ((w >>> 25) & 3) !== 3)) {
        throw new Error('Invalid embedded Passkey pool');
    }
    const [ , count, capacity, cursor, scratch, reserved] = state;
    if (!(capacity >= 1 && capacity <= 1024) ||
        state.length < 6 + 33 * capacity || count > capacity ||
        cursor > 100 || count > cursor || scratch !== 0 || reserved !== 0) {
        throw new Error('Invalid or non-quiescent Passkey state');
    }
    const consumed = new Set(pool.slice(0, cursor));
    const names = new Set(), tokens = new Set();
    for (let i = 0; i < count; i++) {
        const p = 6 + i * 33, length = state[p], token = state[p + 1];
        const chars = state.slice(p + 2, p + 2 + length);
        if (length < 1 || length > 31 || chars.some(c => c < 33 || c > 126) ||
            !consumed.has(token) || tokens.has(token)) {
            throw new Error('Invalid issued Passkey record');
        }
        const name = String.fromCharCode(...chars);
        if (names.has(name)) throw new Error('Duplicate issued Passkey name');
        names.add(name);
        tokens.add(token);
    }
}

function digest(payload) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

// Caller must serialize issuance and stop execution before capturing BOTH arrays.
// The full artifact includes header, embedded pool, code and capability bindings.
function savePasskeyImage(filename, {artifactWords, stateWords}) {
    const artifact = words(artifactWords, 'artifact'), state = words(stateWords, 'state');
    validate(artifact, state);
    const payload = {format: FORMAT, artifact, state};
    const data = JSON.stringify({payload, sha256: digest(payload)}) + '\n';
    const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
    let fd;
    try {
        fd = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(fd, data);
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(temporary, filename);
        const dir = fs.openSync(path.dirname(filename), 'r');
        try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

// Expected artifact comes from the caller's trusted selection, not from the image.
// Missing/corrupt images fail closed: never call stateImage() as a restart fallback.
function restorePasskeyImage(filename, expectedArtifactWords) {
    const expected = words(expectedArtifactWords, 'expected artifact');
    const envelope = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const payload = envelope?.payload;
    if (!payload || payload.format !== FORMAT || envelope.sha256 !== digest(payload)) {
        throw new Error('Invalid Passkey saved-image integrity or format');
    }
    const artifact = words(payload.artifact, 'artifact'), state = words(payload.state, 'state');
    if (artifact.length !== expected.length || artifact.some((w, i) => w !== expected[i])) {
        throw new Error('Passkey saved image does not match the exact selected artifact');
    }
    validate(artifact, state);
    return {artifactWords: Uint32Array.from(artifact), stateWords: Uint32Array.from(state)};
}

module.exports = {savePasskeyImage, restorePasskeyImage};
