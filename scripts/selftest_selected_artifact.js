'use strict';

// Read-only selected-input validation. No compiler or repository example is an
// authority here. Freshness and target execution are separate checks.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function inspectSelectedSelfTest(dir) {
    const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const rows = read('manifest.json').filter(e => e.abstraction === 'SelfTest' && !e.archived);
    const bindings = (read('ns-state.json').abstractions || []).filter(e => e.name === 'SelfTest');
    if (rows.length !== 1 || bindings.length !== 1)
        throw new Error('SelfTest requires exactly one selected manifest and Namespace binding');
    const entry = rows[0], binding = bindings[0];
    if (typeof entry.filename !== 'string' || path.basename(entry.filename) !== entry.filename)
        throw new Error('invalid selected SelfTest filename');
    const bytes = fs.readFileSync(path.join(dir, entry.filename));
    if (bytes.length < 4 || bytes.length % 4) throw new Error('invalid SelfTest binary length');
    const header = bytes.readUInt32BE(0);
    const size = 2 ** (((header >>> 23) & 15) + 6);
    const cw = (header >>> 10) & 8191, cc = header & 255;
    if ((header >>> 27) !== 31 || bytes.length !== size * 4 || !cw || cc !== 1 || cw + cc + 1 >= size)
        throw new Error('invalid SelfTest structure: requires bounded code and SELF-only C-list');
    const { slot, seq } = binding;
    if (!Number.isInteger(slot) || slot < 0 || slot > 65535 ||
        !Number.isInteger(seq) || seq < 0 || seq > 511)
        throw new Error('invalid SelfTest Namespace slot/sequence');
    const selfGT = (0x4a000000 | (seq << 16) | slot) >>> 0;
    const token = selfGT.toString(16).padStart(8, '0');
    if (bytes.readUInt32BE(bytes.length - 4) !== selfGT)
        throw new Error('selected SelfTest row-zero SELF GT differs from the Namespace binding');
    const hash = sha256(bytes);
    const issue = entry.issue_n || entry.lump_version;
    if (!Number.isInteger(issue) || issue <= 0 || entry.token !== token ||
        entry.filename !== binding.filename || entry.lump_version !== binding.lump_version)
        throw new Error('manifest canonical SelfTest locator is stale');
    if (binding.token !== token || binding.binary_hash !== hash ||
        binding.issue_n !== entry.issue_n || binding.lump_version !== entry.lump_version ||
        binding.ns_slot_policy !== 'static' || binding.load_policy !== 'Resident' ||
        binding.resident !== true || binding.boot_resident !== true)
        throw new Error('ns-state canonical SelfTest binding is stale');
    const approval = read('approvals.json').approvals?.[hash];
    const identity = `SelfTest#${issue}`;
    if (!approval || approval.binary_hash !== hash || approval.filename !== entry.filename ||
        approval.abstraction !== 'SelfTest' || approval.dot_name !== 'SelfTest' ||
        approval.issue_n !== issue || approval.bootstrap_t !== token ||
        approval.bootstrap_runtime_gt !== selfGT || approval.capability_type !== 'inform' ||
        JSON.stringify(approval.grants) !== '["E"]' ||
        (approval.token != null && approval.token !== token) ||
        (approval.identity_string != null && approval.identity_string !== identity) ||
        (approval.identity_hash != null && approval.identity_hash !== sha256(identity)) ||
        (approval.identity_seal_location != null && approval.identity_seal_location !== 'approval'))
        throw new Error('SelfTest hash-bound approval is missing or stale: ' +
            (!approval ? 'no approval for selected binary hash' : 'existing approval does not match selected revision metadata; no approval was modified'));

    const end = bytes.length - cc * 4;
    let cursor = (cw + 1) * 4;
    const frame = bytes.readUInt32BE(cursor);
    const flags = (frame >>> 16) & 255;
    if ((frame >>> 24) !== 0xab || (flags & 3) !== 3 || (flags & ~7))
        throw new Error('invalid SelfTest embedded source frame');
    cursor += 4;
    const apiLength = frame & 65535;
    if (cursor + Math.ceil(apiLength / 4) * 4 + 4 > end)
        throw new Error('SelfTest API frame exceeds freespace');
    JSON.parse(bytes.subarray(cursor, cursor + apiLength).toString('utf8'));
    cursor += Math.ceil(apiLength / 4) * 4;
    const sourceLength = bytes.readUInt32BE(cursor);
    cursor += 4;
    if (cursor + Math.ceil(sourceLength / 4) * 4 > end)
        throw new Error('SelfTest source frame exceeds freespace');
    const stored = bytes.subarray(cursor, cursor + sourceLength);
    const source = (flags & 4 ? zlib.inflateRawSync(stored, { maxOutputLength: 4 * 1024 * 1024 }) : stored).toString('utf8');
    const words = Array.from({ length: size }, (_, i) => bytes.readUInt32BE(i * 4));
    return { entry, binding, bytes, words, source, hash, selfGT, cw, cc };
}

module.exports = { inspectSelectedSelfTest };
