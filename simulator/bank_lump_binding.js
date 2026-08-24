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
    const TOKEN = '5382e0e2';
    const BINARY_HASH = '6985e92299b1c9828a7f0633fd4ddab74b9d356be0568ae4bc36aba0d5594982';
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
            binding.fixed_hardware_boot_slot !== false) {
            return fail('projection does not match the canonical Bank runtime binding');
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

    const api = { validateProjection, validateArtifact, resolveRuntime };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.BankLumpBinding = api;
})(typeof window !== 'undefined' ? window : globalThis);