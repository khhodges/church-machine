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
    const TOKEN = '234e0e62';
    const BINARY_HASH = 'a530bc1d92254c18079609a279bfacbab9cbe9b431c3ca0af3f1ce415ed533fb';
    const IDENTITY_HASH = '3b19718e37c1f36fcca3457e3016ec722737bd33103fac22f1c616de0fd63b11';
    const SELF_GT = 0x0B19718E;
    const REGISTRY_INDEX = 54;
    const DISPATCH = 'SystemAbstractions';
    const AUTHORITY = 'proof-bound dynamic custody';

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
        const capabilityABI = identity.capability_abi || {};
        const createdVariable = capabilityABI.Create && capabilityABI.Create.returns;
        const createErrorCodes = capabilityABI.Create && capabilityABI.Create.error_codes;
        const inspectVariable = capabilityABI.InspectVariable;
        if (Object.keys(capabilityABI).some(name =>
                ['MintKey', 'Deposit', 'Withdraw', 'Inspect', 'Revoke',
                    'ObtainPassKey', 'ExportRecovery', 'Recover', 'List'].includes(name)) ||
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
        if (bytes.length !== size * 4) return fail('LUMP byte length disagrees with its header');
        if (cc < 1 || 1 + cw + cc > size) return fail('LUMP code/c-list bounds are invalid');

        const contentOffset = (cw + 1) * 4;
        if (contentOffset + 4 > bytes.length) return fail('LUMP has no self-definition frame');
        const contentHeader = readWord(contentOffset);
        if ((contentHeader >>> 24) !== 0xAB) return fail('LUMP self-definition frame is missing');
        const flags = (contentHeader >>> 16) & 0xFF;
        const apiLength = contentHeader & 0xFFFF;
        const apiStart = contentOffset + 4;
        const apiEnd = apiStart + apiLength;
        if (apiLength === 0 || apiEnd > bytes.length) return fail('LUMP API frame is truncated');
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
        const asserted = metadata && typeof metadata === 'object' ? metadata : {};
        const dotName = api.name;
        const issue = asserted.issue_n;
        if (!Number.isInteger(issue) || issue <= 0 || issue > 0xFFFFFFFF) {
            return fail('LUMP issue_n metadata is required for identity verification');
        }
        const identityString = `${dotName}#${issue}`;
        const binaryHash = hex(hash(bytes));
        const token = hex(hash(concat(utf8(dotName), bytes))).slice(0, 8);
        const identityHash = hex(hash(identityString));
        const expectedSelf = (0x0A000000 |
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
        for (const [field, actual, expected] of checks) {
            if (actual !== expected) return fail(`LUMP ${field} metadata does not match trusted bytes`);
        }
        if (selfGT !== expectedSelf) return fail('LUMP c-list row zero is not its canonical SELF identity');
        if (asserted.identity_string !== undefined && asserted.identity_string !== identityString) {
            return fail('LUMP identity_string metadata disagrees with its issue');
        }
        return {
            ok: true,
            result: {
                dot_name: dotName, issue_n: issue, token, binary_hash: binaryHash,
                identity_hash: identityHash, identity_string: identityString,
                self_gt: expectedSelf, lump_size: size, cw, cc, api
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