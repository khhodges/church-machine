'use strict';

/*
 * Portable LUMP universal binding contract.
 *
 * Canonical artifacts contain names and content locks.  This module is the
 * destination linker: it verifies exact issued identity (N), the issue-blind
 * cache token (T), the authoritative full binary hash, requested rights/type,
 * authorization, and only then produces destination-local GT words (B).
 *
 * The functions are deliberately pure.  Callers commit the returned copy only
 * after every row has bound successfully, which makes browser/server/boot
 * installation atomic.
 */
(function exposePortableLumpBinding(root) {
    const SCHEMA = 'church.portable-lump-binding/v1';
    const SELF_SYMBOL = '__SELF__';
    const HEX8 = /^[0-9a-f]{8}$/;
    const HEX64 = /^[0-9a-f]{64}$/;
    const NAME = /^([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*)#([1-9][0-9]*)$/;
    const RIGHTS = ['R', 'W', 'X', 'L', 'S', 'E'];
    const TYPE_NAMES = Object.freeze({ null: 0, inform: 1, outform: 2, abstract: 3 });

    function failure(code, message, row, details) {
        return { ok: false, code, message, row: row == null ? null : row, details: details || null };
    }

    function canonicalName(value) {
        const text = String(value || '').trim();
        const match = text.match(NAME);
        if (!match) throw new Error(`universal name "${text}" must be exact name#issue`);
        const issue = Number(match[2]);
        if (!Number.isSafeInteger(issue) || issue <= 0) {
            throw new Error(`universal name "${text}" has an invalid issue`);
        }
        return { name: `${match[1]}#${issue}`, dot_name: match[1], issue_n: issue };
    }

    function normalizeRights(value) {
        const raw = Array.isArray(value) ? value : String(value || '').split('');
        const out = [];
        for (const item of raw) {
            const right = String(item).toUpperCase();
            if (!RIGHTS.includes(right)) throw new Error(`invalid capability right "${item}"`);
            if (!out.includes(right)) out.push(right);
        }
        const turing = out.some(r => 'RWX'.includes(r));
        const church = out.some(r => 'LSE'.includes(r));
        if (turing && church) throw new Error(`mixed Turing/Church rights ${out.join('')}`);
        if (!out.length) throw new Error('capability rights must not be empty');
        return out;
    }

    function normalizeType(value) {
        if (Number.isInteger(value) && value >= 0 && value <= 3) return value;
        const key = String(value == null ? 'inform' : value).toLowerCase();
        if (!(key in TYPE_NAMES)) throw new Error(`invalid capability type "${value}"`);
        return TYPE_NAMES[key];
    }

    function descriptor(cap, row, ownerName) {
        cap = cap || {};
        const self = cap.symbolic_self === true || cap.compiler_owned_self === true ||
            String(cap.name || '').toUpperCase() === SELF_SYMBOL;
        const nValue = self ? ownerName :
            (cap.N || cap.universal_name || cap.identity_string || cap.name);
        const n = canonicalName(nValue);
        const token = String(cap.T || cap.token || cap.cache_token || '').toLowerCase();
        const binaryHash = String(cap.binary_hash || cap.content_hash || '').toLowerCase();
        const identityHash = cap.identity_hash == null ? null :
            String(cap.identity_hash).toLowerCase();
        if (!self && !HEX8.test(token)) throw new Error(`${n.name} requires expected T (8 lowercase hex)`);
        if (!HEX64.test(binaryHash)) {
            throw new Error(`${n.name} requires authoritative binary_hash (64 lowercase hex)`);
        }
        if (identityHash !== null && !HEX64.test(identityHash)) {
            throw new Error(`${n.name} has malformed identity_hash`);
        }
        if (!HEX64.test(identityHash || '')) {
            throw new Error(`${n.name} requires authoritative identity_hash (64 lowercase hex)`);
        }
        const relocationRow = cap.relocation_row == null ? row : Number(cap.relocation_row);
        if (!Number.isInteger(relocationRow) || relocationRow < 0 || relocationRow > 255) {
            throw new Error(`${n.name} has invalid relocation row`);
        }
        return {
            N: n.name,
            dot_name: n.dot_name,
            issue_n: n.issue_n,
            T: self ? null : token,
            binary_hash: binaryHash,
            identity_hash: identityHash,
            rights: normalizeRights(self ? ['E'] : (cap.rights || cap.grants)),
            capability_type: normalizeType(cap.capability_type ?? cap.gt_type ?? cap.type),
            relocation_row: relocationRow,
            symbolic_self: self,
        };
    }

    function createContract(owner, capabilities, options) {
        options = options || {};
        const ownerN = canonicalName(owner);
        const dependencies = (capabilities || []).map((cap, row) =>
            descriptor(cap, row, ownerN.name));
        const rows = new Set();
        for (const dep of dependencies) {
            if (rows.has(dep.relocation_row)) throw new Error(`duplicate relocation row ${dep.relocation_row}`);
            rows.add(dep.relocation_row);
        }
        if (dependencies.some(d => d.symbolic_self) &&
            !(dependencies[0] && dependencies[0].symbolic_self && dependencies[0].relocation_row === 0)) {
            throw new Error('symbolic Self must be compiler-owned relocation row 0');
        }
        return {
            schema: SCHEMA,
            owner: ownerN.name,
            dependencies,
            compatibility: options.compatibility || 'strong',
            canonical_gt_words: 'unresolved',
        };
    }

    function candidateName(candidate) {
        if (!candidate) return '';
        if (candidate.N || candidate.universal_name || candidate.identity_string) {
            return String(candidate.N || candidate.universal_name || candidate.identity_string);
        }
        const dot = candidate.dot_name || candidate.abstraction || candidate.name;
        const issue = candidate.issue_n ?? candidate.issue_number;
        return dot && issue != null ? `${dot}#${issue}` : '';
    }

    // One owner derivation for compile and load. dot_name, when supplied by a
    // verified catalog/detail response, is already the complete dotted owner
    // prefix and therefore takes precedence over separately transported parts.
    function deriveOwner(meta) {
        meta = meta || {};
        const issue = meta.issue_n ?? meta.issue_number ?? meta.issueN ?? meta.issue;
        const abstraction = String(meta.abstraction || meta.name || '').trim();
        const petname = String(meta.petname || '').trim().replace(/^\.+|\.+$/g, '');
        const dotName = String(meta.dot_name || meta.dotName ||
            [petname, abstraction].filter(Boolean).join('.')).trim();
        return canonicalName(`${dotName}#${issue}`).name;
    }

    function grantedRights(candidate) {
        try { return normalizeRights(candidate.grants || candidate.rights || []); }
        catch (_) { return []; }
    }

    function bind(contract, destination, options) {
        options = options || {};
        if (!contract || contract.schema !== SCHEMA || !Array.isArray(contract.dependencies)) {
            return failure('INVALID_CONTRACT', `portable binding schema must be ${SCHEMA}`);
        }
        let owner;
        try { owner = canonicalName(contract.owner); }
        catch (err) { return failure('INVALID_OWNER', err.message); }
        // A portable executable always owns row zero.  Do not accept a
        // sidecar which quietly omits Self (or puts it in a user row): otherwise
        // an arbitrary supplied GT can become the object's identity.
        let ownerRow;
        try {
            ownerRow = descriptor(contract.dependencies[0], 0, owner.name);
        } catch (err) {
            return failure('INVALID_SELF', err.message, 0);
        }
        if (!ownerRow.symbolic_self || ownerRow.relocation_row !== 0 ||
            ownerRow.N !== owner.name || ownerRow.capability_type !== TYPE_NAMES.inform ||
            ownerRow.rights.length !== 1 || ownerRow.rights[0] !== 'E') {
            return failure('INVALID_SELF',
                'portable contract requires compiler-owned __SELF__ as Inform E-only relocation row 0', 0);
        }
        if (contract.dependencies.slice(1).some(dep => {
            try { return descriptor(dep, dep.relocation_row, owner.name).symbolic_self; }
            catch (_) { return false; }
        })) {
            return failure('INVALID_SELF', 'portable contract may contain __SELF__ only at relocation row 0');
        }
        const relocationRows = new Set();
        for (let index = 0; index < contract.dependencies.length; index++) {
            let checked;
            try { checked = descriptor(contract.dependencies[index], index, owner.name); }
            catch (err) { return failure('INVALID_DESCRIPTOR', err.message, index); }
            if (relocationRows.has(checked.relocation_row)) {
                return failure('DUPLICATE_RELOCATION_ROW',
                    `portable contract repeats relocation row ${checked.relocation_row}`, checked.relocation_row);
            }
            relocationRows.add(checked.relocation_row);
        }
        const candidates = Array.isArray(destination)
            ? destination : Object.values((destination && destination.entries) || {});
        const localized = [];
        const words = Object.assign({}, options.baseWords || {});
        const ownerCandidate = options.ownerCandidate || options.selfCandidate ||
            candidates.find(candidate => candidateName(candidate) === owner.name);
        if (!ownerCandidate || candidateName(ownerCandidate) !== owner.name) {
            return failure('OWNER_IDENTITY_MISMATCH',
                `installed artifact owner must be verified as exact ${owner.name}`, 0);
        }
            if (ownerCandidate.verified !== true || ownerCandidate.approved !== true) {
            return failure('OWNER_UNVERIFIED',
                `installed artifact owner ${owner.name} has no verified content record`, 0);
        }
        const lockedOwnerHash = contract.owner_binary_hash || contract.owner_content_hash;
        if (lockedOwnerHash && String(ownerCandidate.binary_hash || ownerCandidate.content_hash || '').toLowerCase() !==
            String(lockedOwnerHash).toLowerCase()) {
            return failure('OWNER_CONTENT_MISMATCH', `${owner.name} full content hash mismatch`, 0);
        }
        const lockedOwnerIdentity = contract.owner_identity_hash;
        if (lockedOwnerIdentity && String(ownerCandidate.identity_hash || '').toLowerCase() !==
            String(lockedOwnerIdentity).toLowerCase()) {
            return failure('OWNER_IDENTITY_HASH_MISMATCH', `${owner.name} identity hash mismatch`, 0);
        }
        for (const dep of contract.dependencies) {
            const row = dep.relocation_row;
            let normalized;
            try {
                normalized = descriptor(dep, row, owner.name);
            }
            catch (err) { return failure('INVALID_DESCRIPTOR', err.message, row); }
            let candidate;
            if (normalized.symbolic_self) {
                candidate = options.selfCandidate || candidates.find(c => candidateName(c) === owner.name);
            } else {
                candidate = candidates.find(c => candidateName(c) === normalized.N);
            }
            if (!candidate) return failure('EXACT_ISSUE_NOT_FOUND', `no destination object matches ${normalized.N}`, row);
            if (candidate.verified !== true || candidate.approved !== true) {
                return failure('UNVERIFIED_DESTINATION',
                    `${normalized.N} is not backed by verified registry bytes and a live Namespace entry`, row);
            }
            if (candidateName(candidate) !== normalized.N) {
                return failure('ISSUE_MISMATCH', `destination candidate does not match exact ${normalized.N}`, row);
            }
            const actualT = String(candidate.T || candidate.cache_token || candidate.token || '').toLowerCase();
            if (!normalized.symbolic_self && actualT !== normalized.T) {
                return failure('TOKEN_MISMATCH', `${normalized.N} expected T ${normalized.T}, got ${actualT || '(missing)'}`, row);
            }
            const actualHash = String(candidate.binary_hash || candidate.content_hash || '').toLowerCase();
            if (!HEX64.test(actualHash) || actualHash !== normalized.binary_hash) {
                return failure('BINARY_HASH_MISMATCH', `${normalized.N} full content hash mismatch`, row);
            }
            const actualIdentityHash = String(candidate.identity_hash || '').toLowerCase();
            if (!HEX64.test(actualIdentityHash) || actualIdentityHash !== normalized.identity_hash) {
                return failure('IDENTITY_HASH_MISMATCH', `${normalized.N} identity hash mismatch`, row);
            }
            const grants = new Set(grantedRights(candidate));
            const missing = normalized.rights.filter(r => !grants.has(r));
            if (missing.length) {
                return failure('INSUFFICIENT_RIGHTS', `${normalized.N} does not grant ${missing.join('')}`, row);
            }
            const actualType = normalizeType(candidate.capability_type ?? candidate.gt_type ?? candidate.type);
            if (actualType !== normalized.capability_type) {
                return failure('TYPE_MISMATCH', `${normalized.N} has incompatible capability type`, row);
            }
            const slot = Number(candidate.ns_slot ?? candidate.nsIndex ?? candidate.slot);
            const sequence = Number(candidate.sequence ?? candidate.gt_seq ?? candidate.seq);
            if (!Number.isInteger(slot) || slot < 0 || slot > 0xFFFF ||
                !Number.isInteger(sequence) || sequence < 0 || sequence > 0x1FF) {
                return failure('INVALID_LOCAL_BINDING', `${normalized.N} has no valid destination slot/sequence`, row);
            }
            let word;
            if (typeof options.mintGT === 'function') {
                word = options.mintGT(sequence, slot, normalized.rights, normalized.capability_type);
            } else {
                return failure('MINT_UNAVAILABLE', 'destination GT minting function is unavailable', row);
            }
            words[row] = word >>> 0;
            localized.push({ ...normalized, ns_slot: slot, sequence, B: word >>> 0, status: 'materialized' });
        }
        return { ok: true, schema: SCHEMA, owner: owner.name, words, bindings: localized };
    }

    const api = { SCHEMA, SELF_SYMBOL, canonicalName, deriveOwner, normalizeRights, normalizeType, descriptor, createContract, bind };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.PortableLumpBinding = api;
})(typeof window !== 'undefined' ? window : globalThis);