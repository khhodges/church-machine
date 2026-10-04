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

    function _isThreadName(name) {
        return /^Boot\.Thread$/i.test(String(name || '')) ||
            /^Thread[.#]\d+$/i.test(String(name || ''));
    }

    function authoredRightsForName(name, lumps) {
        const lump = (Array.isArray(lumps) ? lumps : []).find(item =>
            _sameName(item && (item.abstraction || item.name), name));
        if (!lump) return null;
        const authored = lump.authored_rights || lump.permissions || lump.rights || lump.grants;
        if (!Array.isArray(authored)) return null;
        try {
            return normalizeRights({ rights: authored });
        } catch (_) {
            return null;
        }
    }

    const hierarchyPath = value => typeof value === 'string' &&
        /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(value);

    // Validate the whole server-provisioned configuration, including unused
    // foreign definitions. This checks structure, not global node ownership.
    function validateHierarchyConfiguration(config) {
        const invalid = reason => ({ ok: false,
            error: `IDE hierarchy is missing or malformed (${reason}). Configure server/ide-hierarchy.json: ask the operator to provision it using server/ide-hierarchy.example.json with the assigned IDE node, exact aliases and trusted foreign definitions; no ownership was inferred.` });
        const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
        if (!object(config) || !hierarchyPath(config.node)) return invalid('invalid node');
        for (const field of ['aliases', 'definitions']) {
            if (config[field] != null && !object(config[field])) return invalid(`${field} must be an object`);
        }
        // Alias keys are PetNames: numeric and hash-separated Thread instances
        // are allowed here, but never in canonical hierarchy paths.
        const petName = value => /^[A-Za-z_][A-Za-z0-9_-]*(?:[.#][A-Za-z0-9_-]+)*$/.test(value);
        for (const [key, value] of Object.entries(config.aliases || {})) {
            if (!petName(key) || !hierarchyPath(value)) return invalid(`invalid alias "${key}"`);
        }
        for (const [key, rights] of Object.entries(config.definitions || {})) {
            if (!hierarchyPath(key)) return invalid(`invalid definition path "${key}"`);
            if (!Array.isArray(rights)) return invalid(`definition "${key}" permissions must be an array`);
            try { normalizeRights({ rights }); }
            catch (e) { return invalid(`definition "${key}": ${e.message}`); }
        }
        return { ok: true, error: null };
    }

    // Compatibility entry point for the Format LUMP setup guard.
    function hierarchyConfigurationError(config) {
        return validateHierarchyConfiguration(config).error;
    }

    // Exact path components, not textual prefixes or imported short names.
    // Only the server-provisioned alias/definition table is ownership evidence.
    function checkLeafOwnership(cap, config) {
        const name = _nameOf(cap);
        if (name === 'NULL' || (cap && cap.null_row)) return { ownership: 'null', error: null };
        let rights;
        try { rights = normalizeRights(cap); }
        catch (e) { return { ownership: 'invalid', error: e.message }; }
        if (/^(SELF|__SELF__)$/i.test(name)) {
            return { ownership: 'compiler', error: rights.length &&
                (rights.length !== 1 || rights[0] !== 'E')
                ? 'SELF permissions are compiler-owned E. Use bare SELF or SELF E.' : null };
        }
        const configuration = validateHierarchyConfiguration(config);
        if (!configuration.ok) return { ownership: 'unconfigured', error: configuration.error };
        const aliases = config.aliases || {};
        const definitions = config.definitions || {};
        const explicit = cap && typeof cap === 'object' && (cap.N || cap.identity_string || cap.canonical_leaf);
        const canonical = explicit ? String(explicit).replace(/#[1-9][0-9]*$/, '') :
            Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] :
            name.includes('.') ? name : `${config.node}.${name}`;
        if (!hierarchyPath(canonical)) return { ownership: 'invalid', error:
            `Malformed canonical leaf "${canonical}". Configure an exact alias for PetName "${name}" in server/ide-hierarchy.json; no ownership was inferred.` };
        if (cap && cap.canonical_leaf && cap.canonical_leaf !== canonical) {
            return { ownership: 'invalid', error: `Capability "${name}" has conflicting canonical identities.` };
        }
        if (explicit && Object.prototype.hasOwnProperty.call(aliases, name) && aliases[name] !== canonical) {
            return { ownership: 'invalid', error: `Capability "${name}" conflicts with its configured canonical leaf ${aliases[name]}.` };
        }
        const parts = canonical.split('.');
        const parent = parts.slice(0, -1).join('.');
        if (parent === config.node) return { ownership: 'local', canonical, error: null };
        let defined;
        try {
            if (!Object.prototype.hasOwnProperty.call(definitions, canonical)) throw new Error('missing');
            defined = normalizeRights({ rights: definitions[canonical] });
        } catch (_) {
            return { ownership: 'foreign', canonical,
                error: `Foreign leaf "${canonical}" has no trusted permission definition. Configure its exact definition in server/ide-hierarchy.json; importing a PetName does not grant ownership.` };
        }
        return { ownership: 'foreign', canonical,
            error: rights.slice().sort().join('') === defined.slice().sort().join('') ? null :
                `Foreign leaf "${canonical}" cannot redefine permissions (${defined.join('') || 'none'}). Change its definition on the owning IDE, not this IDE.` };
    }

    function isContextualSelf(cap) {
        const name = _nameOf(cap).toUpperCase();
        return name === 'SELF' || name === '__SELF__' ||
            !!(cap && typeof cap === 'object' &&
                (cap.symbolic_self === true || cap.compiler_owned_self === true));
    }

    // A compiler-owned SELF is deliberately different from an unresolved
    // dependency.  The compiler may put this one exact marker in row zero
    // while the save-plan transaction is choosing the destination Namespace
    // entry; the server then remints the row from that authoritative entry.
    // Keep the predicate here so every caller uses the same provenance rule.
    function isCompilerOwnedSelf(cap) {
        return !!(cap && typeof cap === 'object' &&
            cap.compiler_owned_self === true &&
            (_sameName(cap.name, '__SELF__') || _sameName(cap.name, 'SELF')) &&
            isContextualSelf(cap));
    }

    function _selfPlaceholder(context) {
        const sim = context && context.sim;
        const simClass = sim && sim.constructor;
        const candidate = context && (
            context.selfCapabilityPlaceholder !== undefined
                ? context.selfCapabilityPlaceholder
                : context.compilerSelfPlaceholder
        );
        if (candidate !== undefined && candidate !== null) {
            return Number(candidate) >>> 0;
        }
        if (simClass && simClass.SELF_CAPABILITY_PLACEHOLDER !== undefined) {
            return Number(simClass.SELF_CAPABILITY_PLACEHOLDER) >>> 0;
        }
        return 0xFEED5E1F;
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
        if (cap && typeof cap === 'object' && cap.null_row === true) {
            return {
                name: 'NULL', rights: [], grants: [], nsIndex: null,
                source: 'explicit-null-row', null_row: true, error: null,
            };
        }
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

        if (isContextualSelf(cap)) {
            if (rights.length && (rights.length !== 1 || rights[0] !== 'E')) {
                return {
                    name: 'SELF', rights, grants: ['E'], nsIndex: null,
                    source: 'contextual-self', symbolic_self: true,
                    compiler_owned_self: true,
                    error: 'Capability "SELF" must declare exactly E permission.',
                };
            }
            return {
                name: 'SELF', rights: ['E'], grants: ['E'], nsIndex: null,
                source: 'contextual-self', symbolic_self: true,
                compiler_owned_self: true, placeholder: true, error: null,
            };
        }

        // Token inspection of historical artifacts is not a definition change.
        // Authoring callers supply the server's hierarchy explicitly.
        const ownership = Object.prototype.hasOwnProperty.call(context, 'ideHierarchy')
            ? checkLeafOwnership(cap, context.ideHierarchy) : { error: null };
        if (ownership.error) {
            return { name, rights, grants, nsIndex: null,
                source: ownership.ownership, error: ownership.error };
        }

        const allAbs = (sim && sim.abstractionRegistry && sim.abstractionRegistry.abstractions) || {};

        // SelfTest's Next capability is a reserved alias for the active
        // LightningBolt boot-entry GT. It is intentionally not required to
        // appear as a separately registered namespace/device pet name.
        if (_sameName(name, 'Next')) {
            const lightningSlot = _validTarget(sim && sim.bootEntrySlot);
            if (lightningSlot !== null) {
                nsIndex = lightningSlot;
                source = 'lightning-bolt';
            }
        }

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

        // Permissionless Thread GTs are valid for SWITCH/CHANGE. Permission
        // policy is enforced by the runtime M-bit mechanism, not compilation.
        if (_isThreadName(name)) {
            if (rights.length === 0) {
                return {
                    name, rights: [], grants: [], nsIndex: nsIndex === null ? -1 : nsIndex,
                    source, pending: nsIndex === null, error: null,
                };
            }
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

        if (nsIndex === null) {
            return {
                name, rights, grants, nsIndex: -1, source,
                pending: true,
                error: null,
            };
        }

        return { name, rights, grants, nsIndex, source, error: null };
    }

    function resolveCapabilities(caps, context) {
        return (Array.isArray(caps) ? caps : []).map((cap, index) => {
            const resolved = resolveCapability(cap, context);
            const identityKeys = ['N', 'T', 'binary_hash', 'identity_hash', 'identity_string', 'token'];
            if (cap && typeof cap.canonical_leaf === 'string') resolved.canonical_leaf = cap.canonical_leaf;
            const hasFullIdentity = identityKeys.some(key => cap && typeof cap[key] === 'string' &&
                (key !== 'token' || !Number.isInteger(cap.nsIndex) ||
                 cap[key].replace(/^0x/i, '').length > 8));
            for (const key of identityKeys) {
                if (cap && typeof cap[key] === 'string') resolved[key] = cap[key];
            }
            if (hasFullIdentity && !resolved.symbolic_self && !resolved.error) {
                // A name-only local match cannot prove an explicit content identity.
                resolved.nsIndex = -1;
                resolved.pending = true;
            }
            if (resolved.symbolic_self === true && index !== 0) {
                return {
                    ...resolved,
                    error: 'Capability "SELF" is contextual owner authority and may appear only in C-list row 0.',
                };
            }
            return resolved;
        });
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
            const entry = typeof sim.readNSEntry === 'function' ? sim.readNSEntry(nsIndex) : null;
            const sequence = entry && typeof sim.parseNSWord1 === 'function'
                ? sim.parseNSWord1(entry.word1_limit).gtSeq : 0;
            return sim.createGT(sequence, nsIndex, perms, 1) >>> 0;
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

        if (cap.null_row === true) {
            const parsed = _parseGT(word, context || {});
            return word === 0
                ? { ok: true, error: null, parsed }
                : { ok: false, error: `C-list NULL row contains nonzero word 0x${word.toString(16).padStart(8, '0')}.`, parsed };
        }
        if (cap.error) return { ok: false, error: cap.error, parsed: null };
        // A named pending declaration carries no GT authority. Save formatting
        // may preserve it alongside its embedded API name/rights; an ISA
        // operation resolves it through Navana when the row is actually used.
        if ((word >>> 16) === 0xFEED && cap.pending === true &&
                context && context.allowPendingPlaceholders === true) {
            return { ok: true, error: null, parsed: null, pending: true };
        }
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
        if (cap.symbolic_self === true) {
            const actual = parsed.permissions || {};
            const isEOnly = !!actual.E && !actual.R && !actual.W && !actual.X && !actual.L && !actual.S;
            return isEOnly
                ? { ok: true, error: null, parsed }
                : { ok: false, error: 'Capability "SELF" must contain an Inform E-only Golden Token.', parsed };
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
        context = context || {};
        const errors = [];
        const results = [];
        const pendingRows = Array.isArray(context.compilerPendingRows)
            ? context.compilerPendingRows : [];
        for (let i = 0; i < resolvedCaps.length; i++) {
            const word = (words[clistStart + i] || 0) >>> 0;
            // This is the sole client-side exception for an unbound SELF during
            // candidate preparation. It is intentionally narrow: exact compiler
            // provenance and exact c-list row zero. Server compiler artifacts
            // serialize that row as zero; older browser artifacts use the SELF
            // marker. Save validation enables this only with an embedded SELF
            // declaration; installation mints the destination-local SELF.
            const allowSelfPlaceholder =
                context.allowCompilerSelfPlaceholder === true &&
                i === 0 &&
                isCompilerOwnedSelf(resolvedCaps[i]) &&
                (word === 0 || word === _selfPlaceholder(context));
            const declaredPending = pendingRows.find(row =>
                row && row.pending_symbolic === true &&
                Number(row.relocation_row) === i);
            const embedded = context.embeddedApi &&
                Array.isArray(context.embeddedApi.capabilities) &&
                context.embeddedApi.capabilities.length === resolvedCaps.length
                ? context.embeddedApi.capabilities[i] : null;
            const capName = String(resolvedCaps[i] && resolvedCaps[i].name || '');
            const capRights = normalizeRights(resolvedCaps[i]);
            const declaredRights = normalizeRights(declaredPending);
            const allowAuthenticatedPending =
                word === 0 &&
                i > 0 &&
                !resolvedCaps[i].error &&
                declaredPending &&
                String(declaredPending.name || '').toUpperCase() === capName.toUpperCase() &&
                declaredRights.join('') === capRights.join('');
            const allowEmbeddedSymbol =
                i > 0 && !resolvedCaps[i].error && embedded && typeof embedded.name === 'string' &&
                (_isThreadName(embedded.name) ||
                    /^(?:[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*|0x[0-9a-fA-F]{8,})$/.test(embedded.name)) &&
                embedded.name === capName &&
                ['N', 'T', 'binary_hash', 'identity_hash', 'identity_string', 'token', 'canonical_leaf']
                    .every(key => embedded[key] === resolvedCaps[i][key]) &&
                normalizeRights(embedded).join('') === capRights.join('') &&
                (capRights.length > 0 || _isThreadName(capName)) &&
                (word === 0 || ((word >>> 16) === 0xFEED &&
                    word !== 0xFEED5E1F && word !== 0xFEEDDA7A));
            const check = (allowSelfPlaceholder || allowAuthenticatedPending || allowEmbeddedSymbol)
                ? {
                    ok: true, error: null, parsed: null,
                    ...(allowSelfPlaceholder ? { compiler_owned_self: true } :
                        { pending_symbolic: true, name: capName }),
                    intermediate: true,
                }
                : validateToken(word, resolvedCaps[i], context);
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
            if (resolvedCaps[i].null_row === true) {
                words[clistStart + i] = 0;
                continue;
            }
            if (resolvedCaps[i].symbolic_self === true) {
                words[clistStart + i] = 0xFEED5E1F;
                continue;
            }
            if (resolvedCaps[i].pending === true) {
                const simClass = context && context.sim && context.sim.constructor;
                words[clistStart + i] = simClass && typeof simClass.makePendingGT === 'function'
                    ? simClass.makePendingGT(resolvedCaps[i].name)
                    : 0xFEEDFFFF;
                continue;
            }
            words[clistStart + i] = _createGT(
                resolvedCaps[i].nsIndex,
                rightsToPerms(resolvedCaps[i].rights),
                context || {}
            );
        }
        const errors = [];
        const results = [];
        // A materialization is an explicitly intermediate compiler operation.
        // It may retain named pending sentinels for the later Namespace
        // resolver, while validateClist() remains strict by default.
        const materializeContext = Object.assign({}, context || {}, {
            allowPendingPlaceholders: true,
        });
        for (let i = 0; i < resolvedCaps.length; i++) {
            if (resolvedCaps[i].symbolic_self === true) {
                results.push({ ok: true, error: null, parsed: null, symbolic_self: true });
                continue;
            }
            const check = validateToken(
                (words[clistStart + i] || 0) >>> 0,
                resolvedCaps[i],
                materializeContext
            );
            results.push(check);
            if (!check.ok) errors.push(check.error);
        }
        return { ok: errors.length === 0, errors, resolvedCaps, results };
    }

    return {
        hierarchyConfigurationError,
        normalizeRights,
        validateHierarchyConfiguration,
        checkLeafOwnership,
        authoredRightsForName,
        rightsToPerms,
        isContextualSelf,
        isCompilerOwnedSelf,
        resolveCapability,
        resolveCapabilities,
        validateToken,
        validateClist,
        materialize,
    };
});
