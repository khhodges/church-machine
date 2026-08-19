'use strict';

/**
 * Resolve declared capability pet names and materialize validated v2.0
 * Inform Golden Tokens for a LUMP c-list.
 *
 * The browser passes its live simulator and LUMP catalogue through `context`.
 * Keeping this logic in one module prevents Compile, Format LUMP, Save, Run,
 * and Code view from drifting into different token formats.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.CapabilityTokens = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const RIGHT_KEYS = ['R', 'W', 'X', 'L', 'S', 'E'];

    function _nameOf(cap) {
        return typeof cap === 'string' ? cap.trim() : String((cap && cap.name) || '').trim();
    }

    function normalizeRights(cap) {
        const raw = typeof cap === 'string' ? [] : ((cap && (cap.rights || cap.grants)) || []);
        if (!Array.isArray(raw)) {
            throw new TypeError('permissions must be an array of permission strings');
        }
        const out = [];
        for (const value of raw) {
            if (typeof value !== 'string' || value.trim() === '') {
                throw new TypeError('each permission must be a non-empty string');
            }
            const normalized = value.trim().toUpperCase();
            const invalid = [...normalized].filter(ch => !RIGHT_KEYS.includes(ch));
            if (invalid.length > 0) {
                throw new TypeError(
                    `invalid permission character${invalid.length === 1 ? '' : 's'} "${invalid.join('')}"`
                );
            }
            for (const ch of normalized) {
                if (!out.includes(ch)) out.push(ch);
            }
        }
        return out;
    }

    function rightsToPerms(rights) {
        const set = new Set((rights || []).map(r => String(r).toUpperCase()));
        return {
            R: set.has('R') ? 1 : 0,
            W: set.has('W') ? 1 : 0,
            X: set.has('X') ? 1 : 0,
            L: set.has('L') ? 1 : 0,
            S: set.has('S') ? 1 : 0,
            E: set.has('E') ? 1 : 0,
        };
    }

    function _grantsFromPerms(perms) {
        if (!perms || typeof perms !== 'object') return [];
        return RIGHT_KEYS.filter(key => perms[key]);
    }

    function _sameName(a, b) {
        return String(a || '').toUpperCase() === String(b || '').toUpperCase();
    }

    function _validTarget(value) {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(value);
        return Number.isInteger(n) && n >= 0 && n <= 0xFFFF ? n : null;
    }

    function resolveCapability(cap, context) {
        context = context || {};
        const sim = context.sim || null;
        const lumps = Array.isArray(context.lumps) ? context.lumps : [];
        const name = _nameOf(cap);
        let rights;
        try {
            rights = normalizeRights(cap);
        } catch (err) {
            return {
                name, rights: [], grants: [], nsIndex: -1, source: '',
                error: `Capability "${name || '(unnamed capability)'}" has malformed permissions: ${err.message}.`,
            };
        }
        const declaredNsIndex = _validTarget(cap && typeof cap === 'object' ? cap.nsIndex : null);
        let nsIndex = null;
        let grants = [];
        let source = '';

        if (!name) {
            return { name, rights, grants, nsIndex: -1, source, error: 'Capability has no name.' };
        }

        const allAbs = (sim && sim.abstractionRegistry && sim.abstractionRegistry.abstractions) || {};

        // Device pet names are the most specific mapping. LED0 and UART_TX must
        // resolve to their physical NS targets, not to a similarly named
        // catalogue abstraction.
        if (nsIndex === null) {
            outer:
            for (const key of Object.keys(allAbs)) {
                const entry = allAbs[key];
                if (!entry || !Array.isArray(entry.capabilities)) continue;
                for (const deviceCap of entry.capabilities) {
                    if (_sameName(deviceCap && deviceCap.name, name)) {
                        const target = _validTarget(deviceCap.target);
                        if (target !== null) {
                            nsIndex = target;
                            try {
                                grants = normalizeRights({ grants: deviceCap.grants || [] });
                            } catch (err) {
                                return {
                                    name, rights, grants: [], nsIndex: target,
                                    source: 'device-registry',
                                    error: `Capability "${name}" has malformed active grants: ${err.message}.`,
                                };
                            }
                            source = 'device-registry';
                            break outer;
                        }
                    }
                }
            }
        }

        // The running namespace is authoritative for installed abstractions.
        if (nsIndex === null && sim && sim.nsLabels) {
            for (const [key, label] of Object.entries(sim.nsLabels)) {
                if (_sameName(label, name)) {
                    nsIndex = _validTarget(key);
                    source = 'namespace';
                    break;
                }
            }
        }

        // Sidecars cover distinct dot-named binaries such as
        // WukongCallHome.hw that share an installed namespace target.
        if (nsIndex === null) {
            const lump = lumps.find(item =>
                _sameName(item && (item.abstraction || item.name), name));
            if (lump) {
                nsIndex = _validTarget(lump.ns_slot);
                try {
                    grants = normalizeRights({ grants: lump.grants || [] });
                } catch (err) {
                    return {
                        name, rights, grants: [], nsIndex: nsIndex === null ? -1 : nsIndex,
                        source: 'lump-registry',
                        error: `Capability "${name}" has malformed active grants: ${err.message}.`,
                    };
                }
                source = 'lump-registry';
            }
        }

        // A ".hw" variant may intentionally share its parent abstraction's
        // active NS slot even when the sidecar list has not finished loading.
        if (nsIndex === null && /\.hw$/i.test(name) && sim && sim.nsLabels) {
            const parent = name.replace(/\.hw$/i, '');
            for (const [key, label] of Object.entries(sim.nsLabels)) {
                if (_sameName(label, parent)) {
                    nsIndex = _validTarget(key);
                    source = 'namespace-variant';
                    break;
                }
            }
        }

        // Catalogue abstraction indices are the final resolution source.
        if (nsIndex === null) {
            for (const key of Object.keys(allAbs)) {
                const entry = allAbs[key];
                if (entry && _sameName(entry.name, name)) {
                    nsIndex = _validTarget(entry.index !== undefined ? entry.index : key);
                    grants = _grantsFromPerms(entry.perms);
                    source = 'abstraction-registry';
                    break;
                }
            }
        }

        if (declaredNsIndex !== null && nsIndex !== null && declaredNsIndex !== nsIndex) {
            return {
                name, rights, grants, nsIndex, source,
                error: `Capability "${name}" metadata targets NS[${declaredNsIndex}] but the active registry resolves it to NS[${nsIndex}].`,
            };
        }

        if (rights.length === 0) {
            return {
                name, rights, grants, nsIndex: nsIndex === null ? -1 : nsIndex, source,
                error: `Capability "${name}" has no declared permissions.`,
            };
        }

        const requested = rightsToPerms(rights);
        const hasTuring = requested.R || requested.W || requested.X;
        const hasChurch = requested.L || requested.S || requested.E;
        if (hasTuring && hasChurch) {
            return {
                name, rights, grants, nsIndex: nsIndex === null ? -1 : nsIndex, source,
                error: `Capability "${name}" mixes Turing and Church permissions (${rights.join('')}).`,
            };
        }

        if (grants.length > 0) {
            const allowed = new Set(grants);
            const excess = rights.filter(right => !allowed.has(right));
            if (excess.length > 0) {
                return {
                    name, rights, grants, nsIndex: nsIndex === null ? -1 : nsIndex, source,
                    error: `Capability "${name}" requests ${excess.join('')} but its active target grants ${grants.join('')}.`,
                };
            }
        }

        if (nsIndex === null) {
            return {
                name, rights, grants, nsIndex: -1, source,
                error: `Capability "${name}" is unresolved in the active namespace/device registry.`,
            };
        }

        return { name, rights, grants, nsIndex, source, error: null };
    }

    function resolveCapabilities(caps, context) {
        return (Array.isArray(caps) ? caps : []).map(cap => resolveCapability(cap, context));
    }

    function _parseGT(word, context) {
        const sim = context && context.sim;
        if (sim && typeof sim.parseGT === 'function') return sim.parseGT(word >>> 0);
        const gt32 = word >>> 0;
        const perm3 = (gt32 >>> 28) & 0x7;
        const dom = (gt32 >>> 27) & 1;
        return {
            gt_seq: (gt32 >>> 16) & 0x1FF,
            index: gt32 & 0xFFFF,
            type: (gt32 >>> 25) & 3,
            permissions: dom === 0
                ? { R: perm3 & 1, W: (perm3 >>> 1) & 1, X: (perm3 >>> 2) & 1, L: 0, S: 0, E: 0 }
                : { R: 0, W: 0, X: 0, L: perm3 & 1, S: (perm3 >>> 1) & 1, E: (perm3 >>> 2) & 1 },
            malformed: dom === 1 && ((perm3 & 1) + ((perm3 >>> 1) & 1) + ((perm3 >>> 2) & 1) > 1),
        };
    }

    function _createGT(nsIndex, perms, context) {
        const sim = context && context.sim;
        if (sim && typeof sim.createGT === 'function') {
            return sim.createGT(0, nsIndex, perms, 1) >>> 0;
        }
        const church = perms.L || perms.S || perms.E;
        const dom = church ? 1 : 0;
        const perm3 = dom
            ? ((perms.E << 2) | (perms.S << 1) | perms.L)
            : ((perms.X << 2) | (perms.W << 1) | perms.R);
        return (((perm3 & 7) << 28) | (dom << 27) | (1 << 25) | (nsIndex & 0xFFFF)) >>> 0;
    }

    function validateToken(word, resolvedCap, context) {
        const cap = resolvedCap || {};
        const name = cap.name || '(unnamed capability)';
        word = word >>> 0;

        if (cap.error) return { ok: false, error: cap.error, parsed: null };
        if ((word >>> 16) === 0xFEED) {
            return { ok: false, error: `Capability "${name}" is still an unresolved placeholder (0x${word.toString(16).padStart(8, '0')}).`, parsed: null };
        }

        const parsed = _parseGT(word, context || {});
        if (parsed.type === 0) {
            return { ok: false, error: `Capability "${name}" has a NULL Golden Token and must be resolved before save or run.`, parsed };
        }
        if (parsed.type !== 1) {
            return { ok: false, error: `Capability "${name}" has Golden Token type ${parsed.type}; a c-list entry must be an Inform token.`, parsed };
        }
        if (parsed.malformed) {
            return { ok: false, error: `Capability "${name}" has a malformed Golden Token${parsed.malformedReason ? ` (${parsed.malformedReason})` : ''}.`, parsed };
        }
        if ((parsed.permissions || {}).B) {
            return {
                ok: false,
                error: `Capability "${name}" has B=1; declared c-list tokens must clear the B flag.`,
                parsed,
            };
        }
        if (parsed.index !== cap.nsIndex) {
            return { ok: false, error: `Capability "${name}" targets NS[${parsed.index}] but the active registry resolves it to NS[${cap.nsIndex}].`, parsed };
        }

        const expected = rightsToPerms(cap.rights);
        const actual = parsed.permissions || {};
        for (const key of RIGHT_KEYS) {
            if ((actual[key] ? 1 : 0) !== expected[key]) {
                return {
                    ok: false,
                    error: `Capability "${name}" has permissions ${RIGHT_KEYS.filter(k => actual[k]).join('') || 'none'}; expected ${cap.rights.join('')}.`,
                    parsed,
                };
            }
        }
        return { ok: true, error: null, parsed };
    }

    function validateClist(words, clistStart, resolvedCaps, context) {
        const errors = [];
        const results = [];
        for (let i = 0; i < resolvedCaps.length; i++) {
            const check = validateToken((words[clistStart + i] || 0) >>> 0, resolvedCaps[i], context || {});
            results.push(check);
            if (!check.ok) errors.push(check.error);
        }
        return { ok: errors.length === 0, errors, results };
    }

    function materialize(caps, words, clistStart, context) {
        const resolvedCaps = resolveCapabilities(caps, context || {});
        const resolutionErrors = resolvedCaps.filter(cap => cap.error).map(cap => cap.error);
        if (resolutionErrors.length > 0) {
            return { ok: false, errors: resolutionErrors, resolvedCaps };
        }
        for (let i = 0; i < resolvedCaps.length; i++) {
            words[clistStart + i] = _createGT(
                resolvedCaps[i].nsIndex,
                rightsToPerms(resolvedCaps[i].rights),
                context || {}
            );
        }
        const validated = validateClist(words, clistStart, resolvedCaps, context || {});
        return { ok: validated.ok, errors: validated.errors, resolvedCaps, results: validated.results };
    }

    return {
        normalizeRights,
        rightsToPerms,
        resolveCapability,
        resolveCapabilities,
        validateToken,
        validateClist,
        materialize,
    };
});