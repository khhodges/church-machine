'use strict';

// Canonical Bank LUMP binding gate.
//
// Bank is dynamic: its SELF c-list identity chooses the proof-bound system
// implementation, but never grants custody authority itself. The browser uses
// the generated identity projection; Node tooling can additionally validate
// the full manifest/sidecar/binary artifact before accepting that projection.

(function exposeBankLumpBinding(root) {
    const DOT_NAME = 'Bank';
    const ISSUE_N = 1;
    const TOKEN = '8f5edf1d';
    const BINARY_HASH = '3bb89caf9a074f5618187787e1e007e7fb8f7587eec18783149ff6692f0d9cf9';
    const IDENTITY_HASH = '3b19718e37c1f36fcca3457e3016ec722737bd33103fac22f1c616de0fd63b11';
    const SELF_GT = 0x4B19718E;
    const REGISTRY_INDEX = 54;
    const DISPATCH = 'SystemAbstractions';
    const AUTHORITY = 'proof-bound dynamic custody';
    const GENESIS_AUTHORITY = 'human-IDE';

    function sha256(value) {
        if (typeof require !== 'function') {
            throw new Error('full Bank artifact hashing is available only in Node tooling');
        }
        return require('crypto').createHash('sha256').update(value).digest('hex');
    }

    function fail(message) {
        return { ok: false, fault: 'BANK_LUMP_IDENTITY', message };
    }

    function validateProjection(identity) {
        if (!identity || typeof identity !== 'object') return fail('missing generated identity projection');
        if (identity.dot_name !== DOT_NAME || identity.issue_n !== ISSUE_N) {
            return fail('dot-name or issue does not identify Bank#1');
        }
        if (identity.token !== TOKEN || identity.binary_hash !== BINARY_HASH ||
            identity.identity_hash !== IDENTITY_HASH) {
            return fail('projection does not match the canonical Bank#1 seals');
        }
        if (identity.ns_slot !== null || identity.ns_slot_policy !== 'dynamic' ||
            identity.boot_resident !== false) {
            return fail('Bank must remain a dynamic, non-resident LUMP');
        }
        const binding = identity.runtime_binding || {};
        if (binding.registry_index !== REGISTRY_INDEX ||
            binding.dispatch !== DISPATCH ||
            binding.authority !== AUTHORITY ||
            binding.credential_abi !== 'capability-register-v1' ||
            binding.fixed_hardware_boot_slot !== false) {
            return fail('projection does not match the canonical Bank runtime binding');
        }
        if (identity.genesis_authority !== GENESIS_AUTHORITY ||
            identity.genesis_certificate_verification !== 'deferred') {
            return fail('Bank T3.3 must remain an explicit deferred human-IDE authority decision');
        }
        const capabilityABI = identity.capability_abi || {};
        const createdVariable = capabilityABI.Create && capabilityABI.Create.returns;
        const createErrorCodes = capabilityABI.Create && capabilityABI.Create.error_codes;
        const createPolicy = capabilityABI.Create && capabilityABI.Create.policy;
        const inspectVariable = capabilityABI.InspectVariable;
        if (Object.keys(capabilityABI).some(name =>
                ['MintKey', 'Deposit', 'Withdraw', 'Inspect', 'Revoke',
                    'ObtainPassKey', 'ExportRecovery', 'Recover', 'List'].includes(name)) ||
             !createdPolicyMatches(createPolicy) ||
             !createdVariable || createdVariable.register !== 'CR0' ||
             capabilityABI.Create.returns_nullable !== true ||
             !createErrorCodes || createErrorCodes.IDENTITY !== 0x103 ||
             createErrorCodes.NO_CAPABILITY !== 0x101 ||
            createdVariable.kind !== 'capability' || createdVariable.secure_type !== 'BankVariable' ||
            !inspectVariable || !inspectVariable.returns ||
            inspectVariable.returns.register !== 'DR1' ||
            !Array.isArray(inspectVariable.outputs) ||
            inspectVariable.outputs.map(output => output.register).join(',') !== 'DR1,DR2,DR3,DR4') {
            return fail('projection does not describe the canonical capability-register ABI');
        }
        if (identity.self_gt !== SELF_GT) {
            return fail('Bank SELF does not identify canonical Bank#1');
        }
        return { ok: true, result: identity };
    }

    function createdPolicyMatches(policy) {
        return policy && policy.validation === 'T3.1-T3.4-approval-before-private-custody' &&
            policy.commit === 'atomic-private-custody-or-cleanup' &&
            policy.issuance === 'nullable-typed-bankvariable-capability-after-commit' &&
            policy.input_register === 'CR1' &&
            policy.result_register === 'CR0' &&
            policy.status_register === 'DR0' &&
            JSON.stringify(policy.approval_gates) === JSON.stringify(['T3.1', 'T3.2', 'T3.3', 'T3.4']) &&
            policy.T3_3 === 'deferred-genesis-certificate; human-IDE-authority';
    }

    function validateArtifact({ manifestEntry, sidecar, binary }) {
        const projection = validateProjection(manifestEntry);
        if (!projection.ok) return projection;
        if (!sidecar || !binary || typeof binary.length !== 'number') {
            return fail('manifest, sidecar, and binary are all required');
        }
        const token = sha256(Buffer.concat([Buffer.from(DOT_NAME, 'utf8'), binary])).slice(0, 8);
        const identityHash = sha256(`${DOT_NAME}#${ISSUE_N}`);
        const binaryHash = sha256(binary);
        if (token !== manifestEntry.token || binaryHash !== manifestEntry.binary_hash ||
            identityHash !== manifestEntry.identity_hash) {
            return fail('canonical manifest seals do not match the binary');
        }
        for (const field of ['token', 'binary_hash', 'identity_hash', 'ns_slot', 'ns_slot_policy', 'boot_resident']) {
            if (sidecar[field] !== manifestEntry[field]) return fail(`sidecar ${field} disagrees with manifest`);
        }
        if (sidecar.genesis_authority !== manifestEntry.genesis_authority ||
            sidecar.genesis_certificate_verification !== manifestEntry.genesis_certificate_verification) {
            return fail('sidecar T3.3 authority decision disagrees with manifest');
        }
        if (JSON.stringify(sidecar.runtime_binding) !== JSON.stringify(manifestEntry.runtime_binding)) {
            return fail('sidecar runtime binding disagrees with manifest');
        }
        if (sidecar.identity_string !== `${DOT_NAME}#${ISSUE_N}` ||
            binary.length < 8 || binary.readUInt32BE(binary.length - 4) !== manifestEntry.self_gt ||
            !sidecar.permissions || !sidecar.permissions.c_list_row_0 ||
            sidecar.permissions.c_list_row_0.gt !== `0x${manifestEntry.self_gt.toString(16).padStart(8, '0')}`) {
            return fail('sidecar identity or binary SELF c-list row is invalid');
        }
        return { ok: true, result: manifestEntry };
    }

    // Validate a LUMP value before Bank allocates private custody for it.
    // `metadata` is an assertion, not an authority: every asserted identity
    // field is recomputed from the bytes and the embedded API name.
    function validateLump({ binary, metadata }, hashFn) {
        if (!binary || typeof binary.length !== 'number' || binary.length % 4 !== 0) {
            return fail('LUMP binary must be a non-empty whole-word byte sequence');
        }
        const bytes = Uint8Array.from(binary);
        const readWord = offset => (((bytes[offset] << 24) | (bytes[offset + 1] << 16) |
            (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0);
        const utf8 = value => typeof TextEncoder !== 'undefined'
            ? new TextEncoder().encode(value)
            : Uint8Array.from(Buffer.from(value, 'utf8'));
        const concat = (...parts) => {
            const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
            let offset = 0;
            for (const part of parts) {
                result.set(part, offset);
                offset += part.length;
            }
            return result;
        };
        const hash = value => hashFn
            ? hashFn(typeof value === 'string' ? utf8(value) : value)
            : sha256(value);
        const hex = value => typeof value === 'string'
            ? value : Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
        if (bytes.length < 8) return fail('LUMP binary is too small');
        const header = readWord(0);
        if ((header >>> 27) !== 0x1F) return fail('LUMP header magic is invalid');
        const nMinus6 = (header >>> 23) & 0x0F;
        if (nMinus6 > 9) return fail('LUMP size exponent exceeds the architectural bound');
        const size = 1 << (nMinus6 + 6);
        const cw = (header >>> 10) & 0x1FFF;
        const typ = (header >>> 8) & 0x03;
        const cc = header & 0xFF;
        if (typ !== 0) return fail('Bank.Create accepts only typ=lump values');
        if (bytes.length !== size * 4 || (size & (size - 1)) !== 0) {
            return fail('LUMP size must be an exact power-of-two allocation');
        }
        if (cc < 1 || 1 + cw + cc > size) return fail('LUMP code/c-list bounds are invalid');

        const contentOffset = (cw + 1) * 4;
        const clistOffset = (size - cc) * 4;
        if (contentOffset >= clistOffset) return fail('LUMP has no freespace between code and c-list');
        if (contentOffset + 4 > bytes.length) return fail('LUMP has no self-definition frame');
        const contentHeader = readWord(contentOffset);
        if ((contentHeader >>> 24) !== 0xAB) return fail('LUMP self-definition frame is missing');
        const flags = (contentHeader >>> 16) & 0xFF;
        if (![0, 1, 3].includes(flags)) return fail('LUMP self-definition flags are invalid');
        const apiLength = contentHeader & 0xFFFF;
        const apiStart = contentOffset + 4;
        const apiEnd = apiStart + apiLength;
        if (apiLength === 0 || apiEnd > clistOffset) return fail('LUMP API frame is truncated');
        let api;
        try {
            const apiText = typeof TextDecoder !== 'undefined'
                ? new TextDecoder().decode(bytes.subarray(apiStart, apiEnd))
                : Buffer.from(bytes.subarray(apiStart, apiEnd)).toString('utf8');
            api = JSON.parse(apiText);
        } catch (_) {
            return fail('LUMP embedded API is not valid JSON');
        }
        if (!api || typeof api.name !== 'string' || !api.name ||
                !Array.isArray(api.methods) || (flags & 0x03) === 0) {
            return fail('LUMP embedded API metadata is incomplete');
        }
        const apiPaddedEnd = (apiEnd + 3) & ~3;
        if (apiPaddedEnd > clistOffset) return fail('LUMP API frame exceeds freespace');
        for (let offset = apiEnd; offset < apiPaddedEnd; offset++) {
            if (bytes[offset] !== 0) return fail('LUMP API alignment padding is non-zero');
        }
        let payloadEnd = apiPaddedEnd;
        if (flags >= 1) {
            if (payloadEnd + 4 > clistOffset) return fail('LUMP source length is missing');
            const sourceLength = readWord(payloadEnd);
            payloadEnd += 4;
            if (sourceLength === 0 || payloadEnd + sourceLength > clistOffset) {
                return fail('LUMP embedded source frame is truncated');
            }
            const sourceEnd = payloadEnd + sourceLength;
            const sourcePaddedEnd = (sourceEnd + 3) & ~3;
            if (sourcePaddedEnd > clistOffset) return fail('LUMP source frame exceeds freespace');
            for (let offset = sourceEnd; offset < sourcePaddedEnd; offset++) {
                if (bytes[offset] !== 0) return fail('LUMP source alignment padding is non-zero');
            }
            payloadEnd = sourcePaddedEnd;
        }
        for (let offset = payloadEnd; offset < clistOffset; offset += 4) {
            if (readWord(offset) !== 0) return fail('LUMP freespace has non-zero trailing data');
        }
        // A public method must point at executable code, while private
        // methods may deliberately retain the builder's zero entry.
        const rejectsMixedDomainRights = capability => {
            const rights = Array.isArray(capability && capability.rights)
                ? capability.rights.map(String)
                : [];
            return rights.includes('X') && rights.includes('E');
        };
        if ((api.capabilities || []).some(rejectsMixedDomainRights)) {
            return fail('LUMP declared capability cannot combine X and E rights');
        }
        for (const method of api.methods) {
            if (!Number.isInteger(method.index) || method.index < 0 || method.index >= cw) {
                return fail('LUMP API method index is outside the dispatch table');
            }
            const entry = readWord(4 + method.index * 4);
            if (entry === 0 || entry > cw) return fail('LUMP API method has an invalid entry point');
            const methodCapabilities = [
                ...(Array.isArray(method.inputs) ? method.inputs : []),
                method.returns,
                ...(Array.isArray(method.outputs) ? method.outputs : []),
            ];
            if (methodCapabilities.some(rejectsMixedDomainRights)) {
                return fail('LUMP method capability cannot combine X and E rights');
            }
        }
        const asserted = metadata && typeof metadata === 'object' ? metadata : {};
        const dotName = api.name;
        const issue = asserted.issue_n;
        if (!Number.isInteger(issue) || issue <= 0 || issue > 0xFFFFFFFF) {
            return fail('LUMP issue_n metadata is required for identity verification');
        }
        const identityString = `${dotName}#${issue}`;
        // T3.1: derive every content-dependent identity value from the
        // submitted bytes and embedded name. Caller metadata is never input.
        const binaryHash = hex(hash(bytes));
        const token = hex(hash(concat(utf8(dotName), bytes))).slice(0, 8);
        const identityHash = hex(hash(identityString));
        const expectedSelf = (0x4A000000 |
            (Number.parseInt(identityHash.slice(0, 8), 16) & 0x01FFFFFF)) >>> 0;
        const selfOffset = (size - cc) * 4;
        const selfGT = readWord(selfOffset);
        const checks = [
            ['dot_name', asserted.dot_name, dotName],
            ['token', asserted.token, token],
            ['binary_hash', asserted.binary_hash, binaryHash],
            ['identity_hash', asserted.identity_hash, identityHash],
            ['self_gt', asserted.self_gt, expectedSelf],
        ];
        // T3.2: compare the caller's requested identity against the pure
        // recomputation. This catches substitution, stale metadata, and
        // tampering even when the caller recomputes only some fields.
        for (const [field, actual, expected] of checks) {
            if (actual !== expected) {
                return fail(`Bank T3.2 requested identity mismatch: ${field}`);
            }
        }
        const selfType = (selfGT >>> 25) & 0x03;
        const selfDomain = (selfGT >>> 27) & 0x01;
        const selfRights = (selfGT >>> 28) & 0x07;
        // T3.4: the compiler-owned SELF must be the exact E identity derived
        // from the embedded dot name and requested issue.
        if (selfGT !== expectedSelf) return fail('Bank T3.4 SELF does not equal the embedded dot-name identity');
        if (selfType !== 1 || selfDomain !== 1 || selfRights !== 4) {
            return fail('LUMP c-list row zero must be an exact E-permission SELF GT');
        }
        if (asserted.identity_string !== undefined && asserted.identity_string !== identityString) {
            return fail('Bank T3.2 requested identity mismatch: identity_string');
        }
        // T3.3 is intentionally not a cryptographic verifier. It records the
        // current provenance boundary explicitly and rejects an absent or
        // contradictory decision rather than silently treating integrity as
        // genesis authority.
        if (asserted.genesis_authority !== GENESIS_AUTHORITY ||
            asserted.genesis_certificate_verification !== 'deferred') {
            return fail('Bank T3.3 deferred genesis authority requires human-IDE approval');
        }
        return {
            ok: true,
            result: {
                dot_name: dotName, issue_n: issue, token, binary_hash: binaryHash,
                identity_hash: identityHash, identity_string: identityString,
                self_gt: expectedSelf, lump_size: size, cw, cc, api,
                approval: {
                    T3_1: 'passed: canonical content address recomputed from bytes',
                    T3_2: 'passed: requested identity matches recomputation',
                    T3_3: 'deferred: human-IDE authority',
                    T3_4: 'passed: compiler-owned SELF matches dot-name identity'
                },
                t3: {
                    T3_1: { ok: true, decision: 'recomputed-from-submitted-bytes' },
                    T3_2: { ok: true, decision: 'requested-identity-compared' },
                    T3_3: { ok: true, decision: 'deferred-human-IDE-authority' },
                    T3_4: { ok: true, decision: 'SELF-equals-derived-E-identity' }
                }
            }
        };
    }

    function resolveRuntime(registry, identity) {
        const projection = validateProjection(identity);
        if (!projection.ok) return projection;
        const descriptor = registry && typeof registry.getByName === 'function'
            ? registry.getByName(DOT_NAME)
            : null;
        if (!descriptor || descriptor.index !== identity.runtime_binding.registry_index ||
            descriptor.freedNSSlot !== true) {
            return fail('Bank registry binding is missing or claims a physical Namespace slot');
        }
        return { ok: true, result: { index: descriptor.index, token: identity.token, selfGT: identity.self_gt } };
    }

    const api = { validateProjection, validateArtifact, validateLump, resolveRuntime };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.BankLumpBinding = api;
})(typeof window !== 'undefined' ? window : globalThis);